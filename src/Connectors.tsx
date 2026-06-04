import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

interface Connector {
  id: string;
  name: string;
  logo: string; // logo image URL
  color: string; // brand color (used for the fallback monogram)
  desc: string;
}

// Brand logos: simple-icons CDN where available, Google's favicon service for
// the few brands not in open icon sets.
const si = (slug: string) => `https://cdn.simpleicons.org/${slug}`;
const fav = (domain: string) => `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;

const CONNECTORS: Connector[] = [
  { id: 'gdrive', name: 'Google Drive', logo: si('googledrive'), color: '#1FA463', desc: 'Search and read your files' },
  { id: 'gmail', name: 'Gmail', logo: si('gmail'), color: '#EA4335', desc: 'Read, search and draft emails' },
  { id: 'gcal', name: 'Google Calendar', logo: si('googlecalendar'), color: '#4285F4', desc: 'Check and create events' },
  { id: 'canva', name: 'Canva', logo: fav('canva.com'), color: '#00C4CC', desc: 'Designs and brand assets' },
  { id: 'figma', name: 'Figma', logo: si('figma'), color: '#F24E1E', desc: 'Design files and prototypes' },
  { id: 'notion', name: 'Notion', logo: si('notion'), color: '#111111', desc: 'Search and edit your workspace' },
  { id: 'atlassian', name: 'Atlassian Jira', logo: si('jira'), color: '#0052CC', desc: 'Search, read & create Jira issues' },
  { id: 'm365', name: 'Microsoft Outlook', logo: fav('outlook.com'), color: '#0078D4', desc: 'Outlook mail & calendar' },
  { id: 'slack', name: 'Slack', logo: fav('slack.com'), color: '#4A154B', desc: 'Read and send messages' },
  { id: 'hubspot', name: 'HubSpot', logo: si('hubspot'), color: '#FF7A59', desc: 'Contacts, deals & CRM' },
];

// All connectors run through Composio (OAuth + MCP). The endpoint slug is
// historical (`gmail-oauth`) but it connects any app via ?app=<id>.
const CONNECT_API = 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth';

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
      setStatus(next);
    } catch {
      /* offline — leave state as-is */
    }
  }

  useEffect(() => {
    refreshAll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Native: when the OAuth flow bounces back via gofarther://connected, iOS
  // reopens the app — close the in-app browser and refresh connection state.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    CapApp.addListener('appUrlOpen', (e) => {
      if (!e.url || !e.url.startsWith('gofarther://')) return;
      Browser.close().catch(() => {});
      refreshAll();
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
      await refreshAll();
      if (n >= 20) clearInterval(iv);
    }, 3000);
  }

  const count = CONNECTORS.filter((c) => status[c.id]?.connected).length;

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">Connectors</h1>
        <p className="page-sub">
          Connect Go Farther to your apps so it can use your data and take actions for you.
          {count > 0 && ` · ${count} connected`}
        </p>

        <div className="conn-list">
          {CONNECTORS.map((c) => {
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
                <button
                  className={`conn-btn ${on ? 'on' : ''}`}
                  onClick={() => connect(c.id)}
                  aria-pressed={on}
                >
                  {on ? 'Connected' : 'Connect'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
