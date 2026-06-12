import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API, byId, type Connector } from './connectorData';
import { tap } from './haptics';
import { BrandLogo } from './brandLogos';
import { hasBrand } from './brandData';
import ToolManager from './ToolManager';
import { IconArrowLeft, IconSpark } from './icons';
import { useFocusTrap } from './a11y';
import { useDismiss } from './motion';
import { PLAID_LOGO } from './plaidLogo';

// Full-screen "constellation" of connected apps (mirrors the Memory screen): a
// glowing hub with each connected app as a draggable node, plus "+" nodes to add
// more. Tap an app node -> choose tools / disconnect. Tap "+" -> the connect
// picker; right after connecting we open the tool picker so the user chooses what
// it can do first.

type XY = { x: number; y: number };
type Status = { connected: boolean; email?: string | null; emails?: string[]; broken?: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const POS_KEY = 'gf_connpos';
function loadPositions(): Record<string, XY> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; }
}

// Default constellation slots: alternate left/right down the stage, skipping the
// core's mid band so nothing sits on the central hub.
function layout(n: number): XY[] {
  if (n <= 1) return [{ x: 50, y: 27 }];
  return Array.from({ length: n }, (_, i) => {
    let y = 22 + (60 * i) / (n - 1);
    if (y > 41 && y < 59) y = i / (n - 1) < 0.5 ? 41 : 59;
    return { x: i % 2 === 0 ? 29 : 71, y };
  });
}

// Apps offered in the connect picker: those with a crisp bundled logo (the native
// webview can't load the remote CDN logos, so we only surface ones that render).
const CATALOG = CONNECTORS.filter((c) => hasBrand(c.id) || c.id === 'plaid');

function Tile({ id, size = 22 }: { id: string; size?: number }) {
  if (id === 'plaid') return <img src={PLAID_LOGO} width={size} height={size} alt="Plaid" style={{ display: 'block', borderRadius: '50%' }} />; // Plaid's real brand mark
  if (hasBrand(id)) return <BrandLogo app={id} size={size} />;
  const c = byId(id);
  return <span className="cg-mono" style={{ background: c?.color }}>{(c?.name ?? '?').charAt(0)}</span>;
}

export default function ConnectorsGraph({ onClose }: { onClose: () => void }) {
  // Three stacked dialogs; each traps focus while it's the top layer, and Esc
  // closes just that layer (sheet -> picker -> the screen itself).
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [positions, setPositions] = useState<Record<string, XY>>(loadPositions);
  const [dragId, setDragId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const [picker, setPicker] = useState(false);          // the "all apps" connect page
  const [detail, setDetail] = useState<Connector | null>(null); // tapped app -> tools/disconnect sheet
  useFocusTrap(!picker && !detail, rootRef, onClose);
  useFocusTrap(picker && !detail, pickerRef, () => setPicker(false));
  useFocusTrap(!!detail, sheetRef, () => setDetail(null));
  const [manage, setManage] = useState<Connector | null>(null); // ToolManager open
  // Animated dismissal for each layer; the sheet/manage content is latched so
  // it doesn't blank out during its exit beat.
  const pickerUi = useDismiss(picker);
  const detailUi = useDismiss(!!detail);
  const lastDetail = useRef(detail);
  if (detail) lastDetail.current = detail;
  const sheetConn = detail ?? lastDetail.current;
  const manageUi = useDismiss(!!manage);
  const lastManage = useRef(manage);
  if (manage) lastManage.current = manage;
  const manageConn = manage ?? lastManage.current;

  const aliveRef = useRef(true);
  const pendingConnect = useRef<string | null>(null);   // app we just kicked off OAuth for -> open tools on return
  const [connecting, setConnecting] = useState<string | null>(null); // OAuth in flight -> show a "finish in the browser" banner
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // safety: clear the banner even if the poll never resolves
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; kind: 'app' | 'add'; sx: number; sy: number; ox: number; oy: number; w: number; h: number; moved: boolean } | null>(null);
  const ptrs = useRef<Map<number, XY>>(new Map());
  const gest = useRef<
    | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
    | { mode: 'pinch'; d0: number; z0: number; px: number; py: number; mx: number; my: number }
    | null
  >(null);
  const bgMoved = useRef(false);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null); // connect poller (web + native)
  const refreshSeq = useRef(0);                          // newest refreshAll wins — kills out-of-order flicker
  const disconnectedAt = useRef<Map<string, number>>(new Map()); // id -> grace-until ms (suppress a stale "still connected")
  const pendBefore = useRef<{ count: number; broken: boolean } | null>(null); // pre-connect snapshot — resolve only on a REAL change
  const browserSub = useRef<{ remove: () => void } | null>(null); // native browserFinished listener for the active connect
  const slotAssign = useRef<Map<string, number>>(new Map()); // stable slot per app id (so a disconnect doesn't reshuffle the others)
  const slotHigh = useRef(4);                            // layout-size high-water mark (never shrinks in a session)
  const [actionErr, setActionErr] = useState('');        // transient connect/disconnect failure message
  // First-load state: the screen used to open straight into "Tap a + to connect"
  // while /list was still in flight (and stayed there forever if it failed) —
  // reading as "you have nothing connected" to someone who does.
  const [boot, setBoot] = useState<'loading' | 'ok' | 'error'>('loading');
  const bootedRef = useRef(false);

  async function token(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // Plaid lives outside Composio (its own Edge Function). We special-case the
  // `plaid` connector id for connect / status / disconnect throughout.
  async function plaidCall(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('plaid', { body: { action, ...extra } });
    if (error) throw new Error(error.message || 'Request failed');
    const d = (data || {}) as Record<string, unknown>;
    if (d.error) throw new Error(String(d.error));
    return d;
  }
  // Plaid Hosted Link: open Plaid's page in the in-app browser, then poll the
  // backend until the bank is linked (public token exchanged + stored server-side).
  async function connectPlaid() {
    if (connecting) return; // one connect at a time — ignore double-taps
    disconnectedAt.current.delete('plaid'); // (re)connecting cancels any disconnect grace
    setActionErr('');
    setConnecting('plaid');
    try {
      const d = await plaidCall('create_link_token');
      const url = d.hosted_link_url as string | undefined;
      const linkToken = d.link_token as string | undefined;
      if (!url || !linkToken) throw new Error('Could not start linking.');
      await Browser.open({ url });
      let closedAt = 0;
      const sub = await Browser.addListener('browserFinished', () => { closedAt = Date.now(); });
      const start = Date.now();
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 2500));
        try { const c = await plaidCall('complete', { link_token: linkToken }); if (c.ok) { done = true; break; } } catch { /* keep polling */ }
        if ((closedAt && Date.now() - closedAt > 12000) || Date.now() - start > 300000) break;
      }
      await sub.remove();
      if (done) await Browser.close().catch(() => {});
    } catch (e) { console.error('plaid link', e); }
    setConnecting((c) => (c === 'plaid' ? null : c));
    await refreshAll();
  }

  const accountCount = (s?: Status): number => (s?.connected ? (s.emails?.length ?? 1) : 0);

  // App ids still inside their post-disconnect grace window (the server is told
  // to keep them gone via ?exclude, and we force them gone in the UI too — covers
  // Composio's eventual consistency reporting a just-removed account as ACTIVE).
  function gracedIds(): string[] {
    const now = Date.now();
    const out: string[] = [];
    for (const [id, until] of disconnectedAt.current) { if (now < until) out.push(id); else disconnectedAt.current.delete(id); }
    return out;
  }

  // Resolve a pending connect ONLY on a genuine change vs the pre-connect
  // snapshot — so "Reconnect"/"Add another account" don't fake-succeed off the
  // very next background refresh while the user is still mid-OAuth.
  function maybeResolvePending(next: Record<string, Status>) {
    const pend = pendingConnect.current;
    if (!pend || pend === 'plaid') return;
    const after = next[pend];
    const before = pendBefore.current ?? { count: 0, broken: false };
    const healthyNow = !!after?.connected && !after?.broken;
    const resolved = before.broken
      ? healthyNow                              // reconnect: was broken → now healthy
      : before.count > 0
        ? accountCount(after) > before.count    // add-another: account count grew
        : healthyNow;                           // first connect
    if (!resolved) return;
    pendingConnect.current = null;
    pendBefore.current = null;
    if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null; }
    if (browserSub.current) { browserSub.current.remove(); browserSub.current = null; }
    if (connectTimer.current) { clearTimeout(connectTimer.current); connectTimer.current = null; }
    setConnecting((c) => (c === pend ? null : c));
    const c = byId(pend);
    if (c) setManage(c); // first connect -> pick tools
  }

  // One batched call returns every connected app for this user. A generation
  // counter makes the NEWEST call authoritative: overlapping refreshes (poller,
  // visibilitychange, post-disconnect timers) + Plaid's slow invoke used to
  // resolve out of order and flip a node connected→disconnected→connected.
  async function refreshAll() {
    const gen = ++refreshSeq.current;
    try {
      const t = await token();
      if (!t) { if (!bootedRef.current) setBoot('error'); return; }
      const graced = gracedIds();
      const ex = graced.length ? `?exclude=${encodeURIComponent(graced.join(','))}` : '';
      const r = await fetch(`${CONNECT_API}/list${ex}`, { headers: { authorization: `Bearer ${t}` } });
      if (!r.ok) { if (!bootedRef.current) setBoot('error'); return; }
      const j = await r.json();
      const map: Record<string, { email?: string | null; emails?: string[]; broken?: boolean }> = j.connected ?? {};
      const next: Record<string, Status> = {};
      const now = Date.now();
      for (const c of CONNECTORS) {
        // Belt-and-suspenders: even if the server didn't honor exclude, a graced
        // app stays gone in the UI for the window.
        if ((disconnectedAt.current.get(c.id) ?? 0) > now) { next[c.id] = { connected: false, email: null }; continue; }
        const m = map[c.id];
        next[c.id] = { connected: !!m, email: m?.email ?? null, emails: m?.emails, broken: !!m?.broken };
      }
      // Plaid's connected state comes from its own backend, not Composio.
      try {
        const pd = await plaidCall('list');
        const banks = (pd.banks as unknown[]) ?? [];
        next.plaid = (disconnectedAt.current.get('plaid') ?? 0) > Date.now()
          ? { connected: false, email: null }
          : { connected: banks.length > 0, email: banks.length ? `${banks.length} bank${banks.length > 1 ? 's' : ''} linked` : null };
      } catch { next.plaid = next.plaid ?? { connected: false, email: null }; }
      // A newer refresh (or a disconnect) superseded this one — drop the stale result.
      if (gen !== refreshSeq.current || !aliveRef.current) return;
      setStatus(next);
      bootedRef.current = true;
      setBoot('ok');
      maybeResolvePending(next);
    } catch {
      // offline — keep state; but a FIRST load that failed must say so, not
      // sit on the empty "tap + to connect" hint forever.
      if (!bootedRef.current && aliveRef.current) setBoot('error');
    }
  }

  // Poll /list every 3s while an OAuth connect is in flight (web + native), until
  // it resolves or ~75s. maybeResolvePending stops it the moment it succeeds.
  function startConnectPoll(id: string) {
    let n = 0;
    if (ivRef.current) clearInterval(ivRef.current);
    ivRef.current = setInterval(() => {
      n += 1;
      if (!aliveRef.current || pendingConnect.current !== id) { if (ivRef.current) clearInterval(ivRef.current); ivRef.current = null; return; }
      void refreshAll();
      if (n >= 25) { if (ivRef.current) clearInterval(ivRef.current); ivRef.current = null; } // the 75s banner timer is the final backstop
    }, 3000);
  }

  useEffect(() => {
    aliveRef.current = true;
    document.documentElement.classList.add('gf-modal-open');
    refreshAll();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      aliveRef.current = false;
      if (ivRef.current) clearInterval(ivRef.current);
      if (connectTimer.current) clearTimeout(connectTimer.current);
      if (browserSub.current) { browserSub.current.remove(); browserSub.current = null; }
      document.documentElement.classList.remove('gf-modal-open');
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native: OAuth bounces back via gofarther:// — close the in-app browser, then
  // either surface the failure or refresh until the new connection appears.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    let cancelled = false;
    CapApp.addListener('appUrlOpen', (e) => {
      if (!e.url || !e.url.startsWith('gofarther://')) return;
      Browser.close().catch(() => {});
      // A denied/failed consent returns gofarther://connected?error=… — don't
      // leave "Connecting…" spinning for the full 75s; say so and stop.
      let errParam = '';
      try { errParam = new URL(e.url).searchParams.get('error') ?? ''; } catch { /* ignore */ }
      if (errParam) {
        pendingConnect.current = null; pendBefore.current = null;
        if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null; }
        if (connectTimer.current) { clearTimeout(connectTimer.current); connectTimer.current = null; }
        setConnecting(null);
        setActionErr('Connection didn’t complete. Please try again.');
        return;
      }
      void refreshAll(); setTimeout(() => void refreshAll(), 2000); setTimeout(() => void refreshAll(), 5000);
    }).then((h) => { handle = h; if (cancelled) h.remove(); }); // unmount raced the promise
    return () => { cancelled = true; handle?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(id: string) {
    void tap(); // the only overlay whose primary actions had no haptic
    if (id === 'plaid') { setPicker(false); void connectPlaid(); return; }
    if (connecting) return; // one OAuth at a time — ignore double-taps (two flows clobber pendingConnect)
    const native = Capacitor.isNativePlatform();
    // Web: open the OAuth tab SYNCHRONOUSLY now, before any await — otherwise the
    // token/connect-init fetches spend the user-activation grant and Safari blocks
    // the later window.open, leaving the banner spinning with nothing opened.
    const win = native ? null : window.open('', '_blank');
    const t = await token();
    if (!t) { win?.close(); return; }
    const before = status[id];
    pendBefore.current = { count: accountCount(before), broken: !!before?.broken }; // resolve only on a real change
    pendingConnect.current = id; // open the tool picker once it's connected
    disconnectedAt.current.delete(id); // (re)connecting cancels any disconnect grace
    setPicker(false);
    setActionErr('');
    setConnecting(id); // visible feedback while the OAuth round-trip + poll runs
    if (connectTimer.current) clearTimeout(connectTimer.current);
    connectTimer.current = setTimeout(() => {
      // Give up on this connect: tear down EVERYTHING the flow armed, exactly
      // like the error path does. Leaving pendingConnect alive made a much-later
      // refresh pop the tool picker open unprompted, and a leaked browserFinished
      // listener kept firing phantom refreshes on every in-app-browser close.
      pendingConnect.current = null;
      pendBefore.current = null;
      if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null; }
      if (browserSub.current) { browserSub.current.remove(); browserSub.current = null; }
      connectTimer.current = null;
      setConnecting((c) => (c === id ? null : c));
    }, 75000);
    // Mint a one-time code so the session token never lands in the /start URL
    // (history/logs/referer). Falls back to the token param if minting fails.
    let q = `t=${encodeURIComponent(t)}`;
    try {
      const r = await fetch(`${CONNECT_API}/connect-init`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
      const j = await r.json().catch(() => ({}));
      if (j?.code) q = `code=${encodeURIComponent(j.code)}`;
    } catch { /* fall back to token in URL */ }
    const startUrl = `${CONNECT_API}/start?app=${id}&${q}${native ? '&native=1' : ''}`;
    if (native) {
      await Browser.open({ url: startUrl });
      // Returning from the in-app browser (success OR cancel) → refresh right
      // away, so a cancel doesn't hang and a slow connect isn't missed.
      if (browserSub.current) { browserSub.current.remove(); browserSub.current = null; }
      browserSub.current = await Browser.addListener('browserFinished', () => { void refreshAll(); setTimeout(() => void refreshAll(), 1500); });
    } else if (win) {
      win.location.href = startUrl;
    } else {
      window.open(startUrl, '_blank'); // blank-open was blocked — last resort
    }
    startConnectPoll(id);
  }

  async function disconnect(id: string) {
    void tap();
    setDetail(null);
    setActionErr('');
    disconnectedAt.current.set(id, Date.now() + 15000); // grace: suppress a stale "still connected" (Composio eventual consistency)
    refreshSeq.current++; // invalidate any in-flight refresh so it can't repaint this app connected
    setStatus((s) => ({ ...s, [id]: { connected: false, email: null } })); // optimistic
    if (id === 'plaid') {
      try { const d = await plaidCall('list'); for (const b of ((d.banks as { id: string }[]) ?? [])) await plaidCall('unlink', { id: b.id }); }
      catch (e) { disconnectedAt.current.delete('plaid'); setActionErr('Couldn’t unlink — please try again.'); console.error('plaid unlink', e); }
      setTimeout(() => void refreshAll(), 800);
      return;
    }
    const t = await token();
    if (!t) {
      // No session — the server never got the disconnect. Undo the optimistic
      // removal and say so, instead of the app vanishing for the 15s grace and
      // then quietly returning (the exact silent flicker this path exists to kill).
      disconnectedAt.current.delete(id);
      setActionErr(`Couldn’t disconnect ${byId(id)?.name ?? 'that app'} — please try again.`);
      setTimeout(() => void refreshAll(), 800);
      return;
    }
    try {
      const r = await fetch(`${CONNECT_API}/disconnect?app=${id}`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error || `status ${r.status}`);
    } catch (e) {
      // The server didn't actually disconnect — undo the optimistic removal and
      // say so, instead of letting it silently flicker back at the next refresh.
      disconnectedAt.current.delete(id);
      setActionErr(`Couldn’t disconnect ${byId(id)?.name ?? 'that app'} — please try again.`);
      console.error('disconnect', e);
    }
    setTimeout(() => void refreshAll(), 1500);
    setTimeout(() => void refreshAll(), 4000);
  }

  // ---- nodes: connected apps + a few "+" slots to invite adding ----
  const connected = CONNECTORS.filter((c) => status[c.id]?.connected);
  const count = connected.length;
  const plusCount = Math.max(1, 4 - count);
  const addIds = Array.from({ length: plusCount }, (_, i) => `__add${i}`);
  const nodeIds = [...connected.map((c) => c.id), ...addIds];
  // Stable slots: each id keeps its assigned constellation position, and the
  // layout size never shrinks within a session — so disconnecting one app no
  // longer makes the others jump to new slots (the index-based map did exactly
  // that). Freed slots are reused by the next new node.
  const slotOf = slotAssign.current;
  for (const id of [...slotOf.keys()]) if (!nodeIds.includes(id)) slotOf.delete(id);
  const usedSlots = new Set(slotOf.values());
  let freeSlot = 0;
  for (const id of nodeIds) {
    if (slotOf.has(id)) continue;
    while (usedSlots.has(freeSlot)) freeSlot++;
    slotOf.set(id, freeSlot); usedSlots.add(freeSlot);
  }
  slotHigh.current = Math.max(slotHigh.current, nodeIds.length, ...[...slotOf.values()].map((n) => n + 1));
  const coords = layout(slotHigh.current);
  const posOf = (id: string): XY => positions[id] ?? coords[slotOf.get(id) ?? 0] ?? { x: 50, y: 30 };

  function onDown(e: React.PointerEvent, id: string, kind: 'app' | 'add') {
    e.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = posOf(id);
    dragRef.current = { id, kind, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, w: rect.width, h: rect.height, moved: false };
    setDragId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    d.moved = true;
    const nx = clamp(d.ox + (dx / d.w / zoom) * 100, 10, 90);
    const ny = clamp(d.oy + (dy / d.h / zoom) * 100, 8, 92);
    setPositions((prev) => ({ ...prev, [d.id]: { x: nx, y: ny } }));
  }
  function onUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    if (!d) return;
    if (!d.moved) {
      if (d.kind === 'add') setPicker(true);
      else { const c = byId(d.id); if (c) setDetail(c); }
      return;
    }
    setPositions((prev) => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
      return prev;
    });
  }

  // ---- background pan / pinch-zoom (same feel as Memory) ----
  function clampPan(x: number, y: number, z: number): XY {
    const el = stageRef.current;
    if (!el) return { x, y };
    const cw = el.clientWidth, ch = el.clientHeight, sw = cw * z, sh = ch * z;
    // Zoomed in: keep the world covering the stage. Zoomed out (smaller than the
    // stage): center it instead of pinning to the top-left corner.
    const px = sw <= cw ? (cw - sw) / 2 : clamp(x, cw - sw, 0);
    const py = sh <= ch ? (ch - sh) / 2 : clamp(y, ch - sh, 0);
    return { x: px, y: py };
  }
  function localMid(pts: XY[]): XY {
    const r = stageRef.current?.getBoundingClientRect();
    const ox = r?.left ?? 0, oy = r?.top ?? 0;
    if (pts.length >= 2) return { x: (pts[0].x + pts[1].x) / 2 - ox, y: (pts[0].y + pts[1].y) / 2 - oy };
    return { x: (pts[0]?.x ?? 0) - ox, y: (pts[0]?.y ?? 0) - oy };
  }
  function startGesture() {
    const pts = [...ptrs.current.values()];
    if (pts.length === 1) gest.current = { mode: 'pan', sx: pts[0].x, sy: pts[0].y, px: pan.x, py: pan.y };
    else if (pts.length >= 2) {
      const m = localMid(pts);
      gest.current = { mode: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, z0: zoom, px: pan.x, py: pan.y, mx: m.x, my: m.y };
    }
  }
  function bgDown(e: React.PointerEvent) {
    if (ptrs.current.size === 0) bgMoved.current = false;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    startGesture();
  }
  function bgMove(e: React.PointerEvent) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];
    if (g.mode === 'pan' && pts.length === 1) {
      const dx = pts[0].x - g.sx, dy = pts[0].y - g.sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) bgMoved.current = true;
      setPan(clampPan(g.px + dx, g.py + dy, zoom));
    } else if (g.mode === 'pinch' && pts.length >= 2) {
      bgMoved.current = true;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const nz = clamp(+(g.z0 * (d / g.d0)).toFixed(3), 0.5, 3); // allow zooming out below 1
      const m = localMid(pts);
      const sxp = (g.mx - g.px) / g.z0, syp = (g.my - g.py) / g.z0;
      setZoom(nz);
      setPan(clampPan(m.x - sxp * nz, m.y - syp * nz, nz));
    }
  }
  function bgUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    gest.current = null;
    if (ptrs.current.size > 0) { startGesture(); return; }
  }

  return createPortal(
    <div className="memg" role="dialog" aria-label="Connectors" ref={rootRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={onClose} aria-label="Back"><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">Connectors</h1>
          <p className="memg-sub">{count > 0 ? `${count} connected` : boot === 'loading' ? 'Checking your connections…' : 'Connect your apps'}</p>
        </div>
        <span style={{ width: 40 }} />
      </div>

      {connecting && (
        <div className="cg-connecting" role="status" aria-live="polite">
          <span className="btn-spin" />
          <span>Connecting {byId(connecting)?.name ?? 'your app'}… finish in the browser, then come back.</span>
        </div>
      )}
      {actionErr && !connecting && (
        <button className="cg-actionerr" role="alert" onClick={() => setActionErr('')}>
          {actionErr} <span aria-hidden="true">✕</span>
        </button>
      )}

      <div
        ref={stageRef}
        className="memg-stage"
        onPointerDown={bgDown}
        onPointerMove={bgMove}
        onPointerUp={bgUp}
        onPointerCancel={bgUp}
      >
        <div className="memg-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <svg className="memg-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {nodeIds.map((id) => {
              const p = posOf(id);
              return <line key={id} x1={50} y1={50} x2={p.x} y2={p.y} className="memg-line" vectorEffect="non-scaling-stroke" />;
            })}
          </svg>

          <div className="memg-core" aria-hidden="true"><IconSpark size={26} /></div>

          {connected.map((c, i) => {
            const p = posOf(c.id);
            return (
              <button
                key={c.id}
                className={`cg-node ${dragId === c.id ? 'dragging' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${60 + i * 45}ms` }}
                onPointerDown={(e) => onDown(e, c.id, 'app')}
                onPointerMove={onMove}
                onPointerUp={(e) => { e.stopPropagation(); onUp(); }}
                onPointerCancel={() => { dragRef.current = null; setDragId(null); }}
              >
                <span className="cg-tile">
                  <Tile id={c.id} size={22} />
                  {status[c.id]?.broken && <span className="cg-broken" aria-label="Needs reconnecting">!</span>}
                </span>
                <span className="cg-name">{c.name}</span>
              </button>
            );
          })}

          {addIds.map((id, i) => {
            const p = posOf(id);
            return (
              <button
                key={id}
                className={`cg-node cg-add ${dragId === id ? 'dragging' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${60 + (count + i) * 45}ms` }}
                aria-label="Add an app"
                onPointerDown={(e) => onDown(e, id, 'add')}
                onPointerMove={onMove}
                onPointerUp={(e) => { e.stopPropagation(); onUp(); }}
                onPointerCancel={() => { dragRef.current = null; setDragId(null); }}
              >
                <span className="cg-add-tile">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </button>
            );
          })}
        </div>

        {count === 0 && boot === 'loading' && <div className="cg-hint" aria-live="polite">Checking your connections…</div>}
        {count === 0 && boot === 'error' && (
          <button className="cg-hint" onClick={() => { setBoot('loading'); void refreshAll(); }} style={{ font: 'inherit', background: 'none', border: 0, cursor: 'pointer' }}>
            Couldn’t check your connections — tap to retry
          </button>
        )}
        {count === 0 && boot === 'ok' && <div className="cg-hint">Tap a <b>+</b> to connect an app</div>}
      </div>

      {/* ---- connect picker: the page with all the apps ---- */}
      {pickerUi.mounted && (
        <div className={`cg-picker${pickerUi.closing ? ' closing' : ''}`} role="dialog" aria-label="Add an app" ref={pickerRef} tabIndex={-1}>
          <div className="memg-top">
            <button className="memg-back" onClick={() => setPicker(false)} aria-label="Back"><IconArrowLeft size={22} /></button>
            <div className="memg-titles">
              <h1 className="memg-title">Add an app</h1>
              <p className="memg-sub">Pick an app to connect</p>
            </div>
            <span style={{ width: 40 }} />
          </div>
          <div className="cg-pick-body">
            {CATALOG.filter((c) => !status[c.id]?.connected).map((c) => (
              <div className="cg-row" key={c.id}>
                <span className="cg-row-tile"><Tile id={c.id} size={24} /></span>
                <div className="cg-row-meta">
                  <div className="cg-row-name">{c.name}</div>
                  <div className="cg-row-desc">{c.desc}</div>
                </div>
                <button className="cg-connect" onClick={() => void connect(c.id)}>Connect</button>
              </div>
            ))}
            {CATALOG.every((c) => status[c.id]?.connected) && (
              <div className="cg-pick-empty">Everything's connected — you're all set.</div>
            )}
          </div>
        </div>
      )}

      {/* ---- tap an app node: choose tools / disconnect ---- */}
      {detailUi.mounted && sheetConn && (
        <>
          <div className={`cg-sheet-backdrop${detailUi.closing ? ' closing' : ''}`} onClick={() => setDetail(null)} />
          <div className={`cg-sheet${detailUi.closing ? ' closing' : ''}`} role="dialog" aria-label={sheetConn.name} ref={sheetRef} tabIndex={-1}>
            <div className="cg-sheet-head">
              <span className="cg-tile"><Tile id={sheetConn.id} size={22} /></span>
              <div>
                <b>{sheetConn.name}</b>
                <small>{status[sheetConn.id]?.broken
                  ? 'Connection expired — reconnect to keep using it'
                  : sheetConn.id === 'plaid'
                    ? (status[sheetConn.id]?.email || 'Bank linked')
                    : (status[sheetConn.id]?.emails?.length ?? 0) > 1
                      ? `${status[sheetConn.id]!.emails!.length} accounts: ${status[sheetConn.id]!.emails!.join(', ')}`
                      : (status[sheetConn.id]?.email ? `Connected as ${status[sheetConn.id]?.email}` : 'Connected')}</small>
              </div>
            </div>
            {status[sheetConn.id]?.broken && sheetConn.id !== 'plaid' && (
              <button className="cg-sheet-btn fix" onClick={() => { const c = sheetConn; setDetail(null); void connect(c.id); }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
                Reconnect
              </button>
            )}
            <button className="cg-sheet-btn" onClick={() => { const c = sheetConn; setDetail(null); setManage(c); }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 7a2 2 0 104 0 2 2 0 10-4 0M6 17a2 2 0 104 0 2 2 0 10-4 0" /></svg>
              Choose tools
            </button>
            {sheetConn.id === 'plaid' && (
              <button className="cg-sheet-btn" onClick={() => { setDetail(null); void connectPlaid(); }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Link another bank
              </button>
            )}
            {sheetConn.id !== 'plaid' && !status[sheetConn.id]?.broken && (
              <button className="cg-sheet-btn" onClick={() => { const c = sheetConn; setDetail(null); void connect(c.id); }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Add another account
              </button>
            )}
            <button className="cg-sheet-btn danger" onClick={() => disconnect(sheetConn.id)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              Disconnect
            </button>
          </div>
        </>
      )}

      {manageUi.mounted && manageConn && (
        <div style={{ display: 'contents' }} className={manageUi.closing ? 'gf-out' : undefined}>
          <ToolManager connector={manageConn} onClose={() => setManage(null)} />
        </div>
      )}
    </div>,
    document.body,
  );
}
