import { useState } from 'react';

// Rich "inbox" rendering for email-list replies. The assistant emits a
// ```gf-emails JSON block (see the chat system prompt) which AssistantMessage
// parses and hands to <EmailList>. Pure presentation — no network here.

export interface EmailItem {
  from: string;
  email?: string;
  subject: string;
  snippet?: string;
  time?: string;
  unread?: boolean;
  starred?: boolean;
}

// Personal mailbox providers: their favicon is just the provider logo (useless
// as an avatar), so we fall back to colored initials for these senders.
const PERSONAL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'fastmail.com',
]);

const PALETTE = ['#E4572E', '#3A86FF', '#2A9D8F', '#8338EC', '#F4A261', '#118AB2', '#EF476F', '#06A77D'];

function domainOf(email?: string): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

// Marketing mail comes from subdomains (news.vans.com, e.sofi.com) that the
// favicon service has no icon for → generic globe. Strip to the registrable
// domain so the brand's real favicon resolves.
function rootDomain(d: string): string {
  const labels = d.split('.');
  if (labels.length <= 2) return d;
  const sld = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  return (sld.has(labels[labels.length - 2]) ? labels.slice(-3) : labels.slice(-2)).join('.');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic color per sender, so an avatar's color is stable across renders.
function hueColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function Avatar({ item }: { item: EmailItem }) {
  const [failed, setFailed] = useState(false);
  const dom = domainOf(item.email);
  const brand = dom && !PERSONAL.has(dom);
  if (brand && !failed) {
    return (
      <span className="gf-avatar">
        <img
          src={`https://www.google.com/s2/favicons?sz=128&domain=${rootDomain(dom!)}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  const name = item.from || item.email || '?';
  return (
    <span className="gf-avatar gf-avatar-mono" style={{ background: hueColor(name) }}>
      {initials(name)}
    </span>
  );
}

export function EmailList({ items }: { items: EmailItem[] }) {
  return (
    <div className="gf-emails">
      {items.map((it, i) => (
        <div key={i} className={`gf-email ${it.unread ? 'unread' : ''}`}>
          <span className="gf-num">{i + 1}</span>
          <span className="gf-avwrap">
            <Avatar item={it} />
            {it.unread && <span className="gf-dot" aria-hidden />}
          </span>
          <div className="gf-main">
            <div className="gf-line1">
              <span className="gf-from">{it.from || it.email || 'Unknown'}</span>
              {it.time && <span className="gf-time">{it.time}</span>}
              <span className={`gf-star ${it.starred ? 'on' : ''}`} aria-hidden>{it.starred ? '★' : '☆'}</span>
            </div>
            <div className="gf-subject">{it.subject}</div>
            {it.snippet && <div className="gf-snippet">{it.snippet}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Shown while the gf-emails block is still streaming in (JSON not yet complete).
export function EmailSkeleton() {
  return (
    <div className="gf-emails">
      {[0, 1, 2].map((i) => (
        <div key={i} className="gf-email gf-skel">
          <span className="gf-num" />
          <span className="gf-avwrap"><span className="gf-avatar gf-skel-box" /></span>
          <div className="gf-main">
            <div className="gf-skel-line w40" />
            <div className="gf-skel-line w90" />
          </div>
        </div>
      ))}
    </div>
  );
}
