import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { CONNECT_API, type Connector } from './connectorData';

interface ToolDef { slug: string; name: string; desc: string; write: boolean }

// Per-app "tool permissions" — choose which Composio tools Go Farther may use.
// Defaults come from the server (the curated set); the user's selection is saved
// and the MCP proxy then serves exactly what's enabled.
export default function ToolManager({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

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

  function toggle(slug: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const t = await token();
      if (!t) return;
      await fetch(`${CONNECT_API}/tools?app=${connector.id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: [...enabled] }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const groups = [
    { label: 'Read-only', items: tools.filter((t) => !t.write) },
    { label: 'Actions', items: tools.filter((t) => t.write) },
  ];

  return (
    <div className="tm-overlay">
      <div className="tm-head">
        <button className="tm-x" onClick={onClose} aria-label="Back">←</button>
        <span className="tm-title">{connector.name} · tools</span>
        <button className="tm-save" onClick={save} disabled={saving || loading || err}>
          {saving ? 'Saving…' : 'Save'}
        </button>
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
    </div>
  );
}
