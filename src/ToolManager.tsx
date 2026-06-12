import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { tap } from './haptics';
import { useFocusTrap } from './a11y';
import { CONNECT_API, type Connector } from './connectorData';
import { IconArrowLeft, IconInfo } from './icons';

// Trim Composio's long/technical descriptions to something readable in the popover.
function shortDesc(d: string): string {
  const t = (d || '').trim();
  if (!t) return 'No description available.';
  return t.length > 200 ? t.slice(0, 200).replace(/\s+\S*$/, '') + '…' : t;
}

interface ToolDef { slug: string; name: string; desc: string; write: boolean }

// Per-app "tool permissions" — choose which Composio tools Go Farther may use.
// Defaults come from the server (the curated set); the user's selection is saved
// and the MCP proxy then serves exactly what's enabled.
export default function ToolManager({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState(false);
  const [info, setInfo] = useState<{ desc: string; top: number; left: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Set<string>>(new Set());
  const dirty = useRef(false);
  const closing = useRef(false); // a close-flush is in flight — a second ← must wait for it, not bypass it
  // Own focus trap: without one, Esc fell through to the screen's root trap and
  // closed the WHOLE Connectors screen out from under this overlay (and Tab
  // could reach the covered controls behind it). Esc = ← (flushes the save).
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, overlayRef, () => void close());

  // Accepts mouse OR keyboard events (the info chip is keyboard-activatable),
  // so the param is the structural overlap of both.
  function openInfo(e: { stopPropagation: () => void; currentTarget: EventTarget | null }, t: ToolDef) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 260, H = 130; // H ≈ worst-case popover height (200-char desc at 260px)
    setInfo({
      desc: shortDesc(t.desc),
      // Clamp vertically too — bottom-row chips used to open the popover offscreen.
      top: Math.min(r.bottom + 8, window.innerHeight - H - 12),
      left: Math.max(12, Math.min(r.right - W, window.innerWidth - W - 12)),
    });
  }

  async function token(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // Load the tool catalog + the user's saved selection. Extracted so the
  // error state can offer a real "Try again" instead of a dead string.
  const load = useCallback(async () => {
    setErr(false);
    setLoading(true);
    try {
      const t = await token();
      if (!t) throw new Error('no auth');
      const r = await fetch(`${CONNECT_API}/tools?app=${connector.id}`, { headers: { authorization: `Bearer ${t}` } });
      const j = await r.json();
      if (j.error || !Array.isArray(j.tools)) throw new Error(j.error || 'bad');
      setTools(j.tools);
      setEnabled(new Set(j.enabled ?? []));
      latest.current = new Set(j.enabled ?? []); // toggles build on this, so it must start from the server's truth
      setLoading(false);
    } catch {
      setErr(true);
      setLoading(false);
    }
  }, [connector.id]);

  useEffect(() => { void load(); }, [load]);

  // Persist the current selection (auto-save). Marks state so the header can
  // show Saving…/Saved, and keeps `dirty` set until a save actually succeeds.
  const inflight = useRef<Promise<void> | null>(null); // the save currently on the wire — close() must await it, not race past it
  function persist(set: Set<string>): Promise<void> {
    const p = (async () => {
      dirty.current = false;
      setSaveState('saving');
      const t = await token();
      if (!t) { dirty.current = true; setSaveState('error'); return; }
      try {
        const r = await fetch(`${CONNECT_API}/tools?app=${connector.id}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: [...set] }),
        });
        // The body's ok matters too: the server used to answer HTTP 200 with
        // {ok:false} on a failed write, and this showed "Saved" for a save
        // that never happened.
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok !== false) { setSaveState('saved'); } else { dirty.current = true; setSaveState('error'); }
      } catch {
        dirty.current = true;
        setSaveState('error');
      }
    })();
    inflight.current = p;
    void p.finally(() => { if (inflight.current === p) inflight.current = null; });
    return p;
  }

  function toggle(slug: string) {
    void tap();
    // Build on `latest` (the authoritative pending set), not the `enabled` state
    // snapshot — two taps inside one render used to both read the same stale
    // state, and the first toggle silently lost.
    const next = new Set(latest.current);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    setEnabled(next);
    latest.current = next;
    dirty.current = true;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next), 350);
  }

  // Closing flushes any pending save FIRST and stays open if it fails — the old
  // unmount-flush fired the request into a dead component, so a network blip on
  // that last save had nowhere to show "Retry" and the toggles silently never stuck.
  async function close() {
    // Re-entrancy guard: persist() clears `dirty` while it runs, so a second ←
    // tapped DURING the flush used to read dirty=false and close immediately —
    // if that in-flight save then failed, the toggles were silently lost.
    if (closing.current) return;
    closing.current = true;
    try {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      // A save already on the wire clears `dirty` while it runs — without this
      // await, ← during that window closed instantly and a failure of that very
      // save had nowhere to land (the silent-loss path).
      if (inflight.current) await inflight.current;
      // First ← flushes and surfaces a failure; a second ← while the error is
      // showing leaves anyway (the unmount backstop makes one last attempt) — a
      // dead network must not trap anyone in this sheet.
      if (dirty.current && saveState !== 'error') {
        await persist(latest.current);
        if (dirty.current) return; // save failed — stay open so Retry is visible
      }
      onClose();
    } finally {
      closing.current = false;
    }
  }

  // Backstop for the paths where the parent unmounts us directly (not via ←).
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirty.current) void persist(latest.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = [
    { label: 'Read-only', items: tools.filter((t) => !t.write) },
    { label: 'Actions', items: tools.filter((t) => t.write) },
  ];

  return (
    <div className="tm-overlay" ref={overlayRef} tabIndex={-1}>
      <div className="tm-head">
        <button className="tm-x" onClick={() => void close()} aria-label="Back"><IconArrowLeft size={22} /></button>
        <span className="tm-title">{connector.name} tools</span>
        {saveState === 'error' ? (
          <button className="tm-status err" onClick={() => void persist(enabled)}>Retry</button>
        ) : (
          <span className="tm-status">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}</span>
        )}
      </div>
      <div className="tm-body">
        {loading ? (
          <div className="tm-msg">Loading tools…</div>
        ) : err ? (
          <div className="tm-msg">
            <span>Couldn't load tools.</span>
            <button className="tm-retry" onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <>
            <p className="tm-sub">
              Pick the tools Go Farther can use for {connector.name} — only what you turn on can be used.
            </p>
            {enabled.size === 0 && (
              <div className="tm-empty">No tools enabled yet — turn on what you want Go Farther to do here.</div>
            )}
            {groups.map((g) => g.items.length > 0 && (
              <div className="tm-group" key={g.label}>
                <div className="tm-group-head">{g.label} <span className="tm-count">{g.items.length}</span></div>
                <div className="tm-list">
                  {g.items.map((t) => {
                    const on = enabled.has(t.slug);
                    return (
                      <button key={t.slug} className="tm-row" onClick={() => toggle(t.slug)} aria-pressed={on}>
                        <span className="tm-name">{t.name}</span>
                        <span className="tm-info-btn" role="button" tabIndex={0} aria-label="What this does" onClick={(e) => openInfo(e, t)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInfo(e, t); } }}>
                          <IconInfo size={18} />
                        </span>
                        <span className={`tgl ${on ? 'on' : ''}`}><span className="tgl-knob" /></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {info && (
        <>
          <div className="tm-info-backdrop" onClick={() => setInfo(null)} />
          <div className="tm-info-pop" style={{ top: info.top, left: info.left }}>{info.desc}</div>
        </>
      )}
    </div>
  );
}
