import { useState } from 'react';

interface Connector {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

const CONNECTORS: Connector[] = [
  { id: 'gmail', name: 'Gmail', icon: '📧', desc: 'Read, search and draft emails' },
  { id: 'gdrive', name: 'Google Drive', icon: '📁', desc: 'Search and read your files' },
  { id: 'gcal', name: 'Google Calendar', icon: '📅', desc: 'Check and create events' },
  { id: 'slack', name: 'Slack', icon: '💬', desc: 'Read and send messages' },
  { id: 'notion', name: 'Notion', icon: '🗒️', desc: 'Search your workspace' },
  { id: 'github', name: 'GitHub', icon: '🐙', desc: 'Issues, pull requests and code' },
];

const STORAGE_KEY = 'gf_connectors';

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function Connectors() {
  const [connected, setConnected] = useState<Record<string, boolean>>(load);

  function toggle(id: string) {
    setConnected((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  const count = Object.values(connected).filter(Boolean).length;

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
            const on = !!connected[c.id];
            return (
              <div className="conn-card" key={c.id}>
                <span className="conn-ico">{c.icon}</span>
                <div className="conn-meta">
                  <div className="conn-name">{c.name}</div>
                  <div className="conn-desc">{c.desc}</div>
                </div>
                <button
                  className={`conn-btn ${on ? 'on' : ''}`}
                  onClick={() => toggle(c.id)}
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
