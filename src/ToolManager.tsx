import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { supabase } from './supabase';
import { CONNECT_API, type Connector } from './connectorData';
import { IconInfo } from './icons';

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

  // Accepts mouse OR keyboard events (the info chip is keyboard-activatable),
  // so the param is the structural overlap of both.
  function openInfo(e: { stopPropagation: () => void; currentTarget: EventTarget | null }, t: ToolDef) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 260;
    setInfo({ desc: shortDesc(t.desc), top: r.bottom + 8, left: Math.max(12, Math.min(r.right - W, window.innerWidth - W - 12)) });
  }

  async function token(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await token();
        if (!t) throw new Error('no auth');
        const r = await fetch(`${CONNECT_API}/tools?app=${connector.id}`, { headers: { authorization: `Bearer ${t}` } });
        const j = await r.json();
        if (!alive) return;
        if (j.error || !Array.isArray(j.tools)) throw new Error(j.error || 'bad');
        setTools(j.tools);
        setEnabled(new Set(j.enabled ?? []));
        setLoading(false);
      } catch {
        if (alive) { setErr(true); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [connector.id]);

  // Persist the current selection (auto-save). Marks state so the header can
  // show Saving…/Saved, and keeps `dirty` set until a save actually succeeds.
  async function persist(set: Set<string>) {
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
      if (r.ok) { setSaveState('saved'); } else { dirty.current = true; setSaveState('error'); }
    } catch {
      dirty.current = true;
      setSaveState('error');
    }
  }

  function toggle(slug: string) {
    const next = new Set(enabled);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    setEnabled(next);
    latest.current = next;
    dirty.current = true;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next), 350);
  }

  // If the user closes before the debounce fires, flush the pending save.
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
    <div className="tm-overlay">
      <div className="tm-head">
        <button className="tm-x" onClick={onClose} aria-label="Back">←</button>
        <span className="tm-title">{connector.name} · tools</span>
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
          <div className="tm-msg">Couldn't load tools — try again.</div>
        ) : (
          <>
            <p className="tm-sub">
              Pick the tools Go Farther can use for {connector.name}. Only what's on counts toward cost.
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
