import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API, type Connector } from './connectorData';
import ToolManager from './ToolManager';

type Status = { connected: boolean; email?: string | null };

function Logo({ c }: { c: Connector }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <span className="conn-logo conn-mono" style={{ background: c.color }}>
        {c.name.charAt(0)}
      </span>
    );
  }
  return (
    <span className="conn-logo">
      <img src={c.logo} alt="" loading="lazy" onError={() => setErr(true)} />
    </span>
  );
}

export default function Connectors() {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [manage, setManage] = useState<Connector | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // app id whose "Connected" pill is armed to disconnect
  const aliveRef = useRef(true); // false after unmount — guards async setState + the connect() poll

  async function token(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // One batched call returns every connected app for this user.
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
      if (aliveRef.current) setStatus(next);
    } catch {
      /* offline — leave state as-is */
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    refreshAll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      aliveRef.current = false; // stop any in-flight refresh/poll from setState after unmount
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Native: when the OAuth flow bounces back via gofarther://connected, iOS
  // reopens the app — close the in-app browser and refresh connection state.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    CapApp.addListener('appUrlOpen', (e) => {
      if (!e.url || !e.url.startsWith('gofarther://')) return;
      Browser.close().catch(() => {});
      // Re-check now + a couple times: the new connection can take a moment to
      // show up in Composio's account list after the OAuth returns.
      refreshAll();
      setTimeout(refreshAll, 2000);
      setTimeout(refreshAll, 5000);
    }).then((h) => {
      handle = h;
    });
    return () => handle?.remove();
  }, []);

  async function connect(id: string) {
    const t = await token();
    if (!t) return;
    if (Capacitor.isNativePlatform()) {
      // In-app browser; the appUrlOpen listener closes it + refreshes on return.
      await Browser.open({ url: `${CONNECT_API}/start?app=${id}&t=${encodeURIComponent(t)}&native=1` });
      return;
    }
    window.open(`${CONNECT_API}/start?app=${id}&t=${encodeURIComponent(t)}`, '_blank');
    // Web: poll briefly so the card flips to "Connected" when they return.
    let n = 0;
    const iv = setInterval(async () => {
      n += 1;
      if (!aliveRef.current) { clearInterval(iv); return; } // left the screen — stop polling
      await refreshAll();
      if (n >= 20) clearInterval(iv);
    }, 3000);
  }

  // Disconnect an app: revoke the Composio connection, then refresh. Optimistic
  // so the card flips to "Connect" immediately.
  async function disconnect(id: string) {
    setArmed(null);
    const t = await token();
    if (!t) return;
    setStatus((s) => ({ ...s, [id]: { connected: false, email: null } }));
    try {
      await fetch(`${CONNECT_API}/disconnect?app=${id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t}` },
      });
    } catch {
      /* ignore — refreshAll reconciles real state */
    }
    // Composio's account list is eventually consistent, so re-check after a beat
    // (not instantly) or the just-removed app can briefly flip back to "Connected".
    setTimeout(refreshAll, 1500);
    setTimeout(refreshAll, 4000);
  }

  // Tapping "Connected" arms the pill into a red "Disconnect"; auto-disarm after
  // a few seconds so it never gets stuck red.
  function arm(id: string) {
    setArmed(id);
    setTimeout(() => setArmed((cur) => (cur === id ? null : cur)), 5000);
  }

  const count = CONNECTORS.filter((c) => status[c.id]?.connected).length;
  // Connected apps float to the top (stable sort keeps each group's order).
  const ordered = [...CONNECTORS].sort(
    (a, b) => Number(!!status[b.id]?.connected) - Number(!!status[a.id]?.connected),
  );

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">Connectors</h1>
        <p className="page-sub">
          Connect Go Farther to your apps so it can use your data and take actions for you.
          {count > 0 && ` · ${count} connected`}
        </p>

        <div className="conn-list">
          {ordered.map((c) => {
            const on = !!status[c.id]?.connected;
            const email = status[c.id]?.email;
            const desc = on && email ? `Connected as ${email}` : c.desc;
            return (
              <div className="conn-card" key={c.id}>
                <Logo c={c} />
                <div className="conn-meta">
                  <div className="conn-name">{c.name}</div>
                  <div className="conn-desc">{desc}</div>
                </div>
                <div className="conn-actions">
                  {on && (
                    <button
                      className="conn-tools"
                      onClick={() => setManage(c)}
                      aria-label={`Manage ${c.name} tools`}
                      title="Choose tools"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          d="M4 7h10M18 7h2M4 17h2M10 17h10M14 7a2 2 0 104 0 2 2 0 10-4 0M6 17a2 2 0 104 0 2 2 0 10-4 0"
                        />
                      </svg>
                    </button>
                  )}
                  <button
                    className={`conn-btn ${on ? (armed === c.id ? 'danger' : 'on') : ''}`}
                    onClick={() => (on ? (armed === c.id ? disconnect(c.id) : arm(c.id)) : connect(c.id))}
                    aria-pressed={on}
                  >
                    {on ? (armed === c.id ? 'Disconnect' : 'Connected') : 'Connect'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {manage && <ToolManager connector={manage} onClose={() => setManage(null)} />}
    </div>
  );
}
