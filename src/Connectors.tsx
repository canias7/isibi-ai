import { useEffect, useState } from 'react';

interface Connector {
  id: string;
  name: string;
  logo: string; // logo image URL
  color: string; // brand color (used for the fallback monogram)
  desc: string;
}

// Brand logos: simple-icons CDN where available, Google's favicon service for
// the few brands not in open icon sets (Canva, Microsoft 365, Slack).
const si = (slug: string) => `https://cdn.simpleicons.org/${slug}`;
const fav = (domain: string) => `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;

const CONNECTORS: Connector[] = [
  { id: 'gdrive', name: 'Google Drive', logo: si('googledrive'), color: '#1FA463', desc: 'Search and read your files' },
  { id: 'gmail', name: 'Gmail', logo: si('gmail'), color: '#EA4335', desc: 'Read, search and draft emails' },
  { id: 'gcal', name: 'Google Calendar', logo: si('googlecalendar'), color: '#4285F4', desc: 'Check and create events' },
  { id: 'canva', name: 'Canva', logo: fav('canva.com'), color: '#00C4CC', desc: 'Designs and brand assets' },
  { id: 'figma', name: 'Figma', logo: si('figma'), color: '#F24E1E', desc: 'Design files and prototypes' },
  { id: 'notion', name: 'Notion', logo: si('notion'), color: '#111111', desc: 'Search and edit your workspace' },
  { id: 'atlassian', name: 'Atlassian Rovo', logo: si('atlassian'), color: '#0052CC', desc: 'Jira, Confluence & Rovo search' },
  { id: 'm365', name: 'Microsoft 365', logo: fav('microsoft365.com'), color: '#D83B01', desc: 'Outlook, Word, Excel & files' },
  { id: 'slack', name: 'Slack', logo: fav('slack.com'), color: '#4A154B', desc: 'Read and send messages' },
  { id: 'hubspot', name: 'HubSpot', logo: si('hubspot'), color: '#FF7A59', desc: 'Contacts, deals & CRM' },
];

// Gmail is wired for real (OAuth + MCP); the rest are placeholders for now.
const GMAIL_OAUTH = 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth';
const USER = 'primary';
const STORAGE_KEY = 'gf_connectors';

function loadLocal(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

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
  const [local, setLocal] = useState<Record<string, boolean>>(loadLocal);
  const [gmail, setGmail] = useState<{ connected: boolean; email?: string | null }>({ connected: false });

  async function refreshGmail() {
    try {
      const r = await fetch(`${GMAIL_OAUTH}/status?u=${USER}`);
      if (r.ok) {
        const j = await r.json();
        setGmail({ connected: !!j.connected, email: j.email });
      }
    } catch {
      /* offline — leave state as-is */
    }
  }

  useEffect(() => {
    refreshGmail();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshGmail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  function connectGmail() {
    window.open(`${GMAIL_OAUTH}/start?u=${USER}`, '_blank');
    // Poll briefly so the card flips to "Connected" when they return.
    let n = 0;
    const iv = setInterval(async () => {
      n += 1;
      await refreshGmail();
      if (n >= 20) clearInterval(iv);
    }, 3000);
  }

  function toggleLocal(id: string) {
    setLocal((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const count = CONNECTORS.filter((c) => (c.id === 'gmail' ? gmail.connected : !!local[c.id])).length;

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
            const isGmail = c.id === 'gmail';
            const on = isGmail ? gmail.connected : !!local[c.id];
            const desc = isGmail && gmail.connected && gmail.email ? `Connected as ${gmail.email}` : c.desc;
            return (
              <div className="conn-card" key={c.id}>
                <Logo c={c} />
                <div className="conn-meta">
                  <div className="conn-name">{c.name}</div>
                  <div className="conn-desc">{desc}</div>
                </div>
                <button
                  className={`conn-btn ${on ? 'on' : ''}`}
                  onClick={() => (isGmail ? connectGmail() : toggleLocal(c.id))}
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
