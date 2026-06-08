import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API, byId, type Connector } from './connectorData';
import { BrandLogo, hasBrand } from './brandLogos';
import ToolManager from './ToolManager';
import { IconArrowLeft, IconSpark } from './icons';

// Full-screen "constellation" of connected apps (mirrors the Memory screen): a
// glowing hub with each connected app as a draggable node, plus "+" nodes to add
// more. Tap an app node -> choose tools / disconnect. Tap "+" -> the connect
// picker; right after connecting we open the tool picker so the user chooses what
// it can do first.

type XY = { x: number; y: number };
type Status = { connected: boolean; email?: string | null };

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
const CATALOG = CONNECTORS.filter((c) => hasBrand(c.id));

function Tile({ id, size = 22 }: { id: string; size?: number }) {
  if (hasBrand(id)) return <BrandLogo app={id} size={size} />;
  const c = byId(id);
  return <span className="cg-mono" style={{ background: c?.color }}>{(c?.name ?? '?').charAt(0)}</span>;
}

export default function ConnectorsGraph({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [positions, setPositions] = useState<Record<string, XY>>(loadPositions);
  const [dragId, setDragId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const [picker, setPicker] = useState(false);          // the "all apps" connect page
  const [detail, setDetail] = useState<Connector | null>(null); // tapped app -> tools/disconnect sheet
  const [manage, setManage] = useState<Connector | null>(null); // ToolManager open

  const aliveRef = useRef(true);
  const pendingConnect = useRef<string | null>(null);   // app we just kicked off OAuth for -> open tools on return
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; kind: 'app' | 'add'; sx: number; sy: number; ox: number; oy: number; w: number; h: number; moved: boolean } | null>(null);
  const ptrs = useRef<Map<number, XY>>(new Map());
  const gest = useRef<
    | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
    | { mode: 'pinch'; d0: number; z0: number; px: number; py: number; mx: number; my: number }
    | null
  >(null);
  const bgMoved = useRef(false);

  async function token(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // One batched call returns every connected app for this user. If we were waiting
  // on a just-connected app, open its tool picker so they choose tools first.
  async function refreshAll() {
    try {
      const t = await token();
      if (!t) return;
      const r = await fetch(`${CONNECT_API}/list`, { headers: { authorization: `Bearer ${t}` } });
      if (!r.ok) return;
      const j = await r.json();
      const map: Record<string, { email?: string | null }> = j.connected ?? {};
      const next: Record<string, Status> = {};
      for (const c of CONNECTORS) next[c.id] = { connected: !!map[c.id], email: map[c.id]?.email ?? null };
      if (!aliveRef.current) return;
      setStatus(next);
      const pend = pendingConnect.current;
      if (pend && next[pend]?.connected) {
        pendingConnect.current = null;
        const c = byId(pend);
        if (c) setManage(c); // first connect -> pick tools
      }
    } catch { /* offline — keep state */ }
  }

  useEffect(() => {
    aliveRef.current = true;
    document.documentElement.classList.add('gf-modal-open');
    refreshAll();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      aliveRef.current = false;
      document.documentElement.classList.remove('gf-modal-open');
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native: OAuth bounces back via gofarther:// — close the in-app browser, refresh.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    CapApp.addListener('appUrlOpen', (e) => {
      if (!e.url || !e.url.startsWith('gofarther://')) return;
      Browser.close().catch(() => {});
      refreshAll(); setTimeout(refreshAll, 2000); setTimeout(refreshAll, 5000);
    }).then((h) => { handle = h; });
    return () => handle?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(id: string) {
    const t = await token();
    if (!t) return;
    pendingConnect.current = id; // open the tool picker once it's connected
    setPicker(false);
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: `${CONNECT_API}/start?app=${id}&t=${encodeURIComponent(t)}&native=1` });
      return;
    }
    window.open(`${CONNECT_API}/start?app=${id}&t=${encodeURIComponent(t)}`, '_blank');
    let n = 0;
    const iv = setInterval(async () => {
      n += 1;
      if (!aliveRef.current) { clearInterval(iv); return; }
      await refreshAll();
      if (n >= 20) clearInterval(iv);
    }, 3000);
  }

  async function disconnect(id: string) {
    setDetail(null);
    const t = await token();
    if (!t) return;
    setStatus((s) => ({ ...s, [id]: { connected: false, email: null } })); // optimistic
    try {
      await fetch(`${CONNECT_API}/disconnect?app=${id}`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
    } catch { /* refreshAll reconciles */ }
    setTimeout(refreshAll, 1500);
    setTimeout(refreshAll, 4000);
  }

  // ---- nodes: connected apps + a few "+" slots to invite adding ----
  const connected = CONNECTORS.filter((c) => status[c.id]?.connected);
  const count = connected.length;
  const plusCount = Math.max(1, 4 - count);
  const addIds = Array.from({ length: plusCount }, (_, i) => `__add${i}`);
  const nodeIds = [...connected.map((c) => c.id), ...addIds];
  const coords = layout(nodeIds.length);
  const slotOf = new Map(nodeIds.map((id, i) => [id, i]));
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
    <div className="memg" role="dialog" aria-label="Connectors">
      <div className="memg-top">
        <button className="memg-back" onClick={onClose} aria-label="Back"><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">Connectors</h1>
          <p className="memg-sub">{count > 0 ? `${count} connected` : 'Connect your apps'}</p>
        </div>
        <span style={{ width: 40 }} />
      </div>

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
                <span className="cg-tile"><Tile id={c.id} size={22} /></span>
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

        {count === 0 && <div className="cg-hint">Tap a <b>+</b> to connect an app</div>}
      </div>

      {/* ---- connect picker: the page with all the apps ---- */}
      {picker && (
        <div className="cg-picker" role="dialog" aria-label="Add an app">
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
      {detail && (
        <>
          <div className="cg-sheet-backdrop" onClick={() => setDetail(null)} />
          <div className="cg-sheet" role="dialog" aria-label={detail.name}>
            <div className="cg-sheet-head">
              <span className="cg-tile"><Tile id={detail.id} size={22} /></span>
              <div>
                <b>{detail.name}</b>
                <small>{status[detail.id]?.email ? `Connected as ${status[detail.id]?.email}` : 'Connected'}</small>
              </div>
            </div>
            <button className="cg-sheet-btn" onClick={() => { const c = detail; setDetail(null); setManage(c); }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 7a2 2 0 104 0 2 2 0 10-4 0M6 17a2 2 0 104 0 2 2 0 10-4 0" /></svg>
              Choose tools
            </button>
            <button className="cg-sheet-btn danger" onClick={() => disconnect(detail.id)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              Disconnect
            </button>
          </div>
        </>
      )}

      {manage && <ToolManager connector={manage} onClose={() => setManage(null)} />}
    </div>,
    document.body,
  );
}
