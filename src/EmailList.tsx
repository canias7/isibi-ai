import { useState } from 'react';

// Rich email rendering for chat replies. The assistant emits a fenced JSON block
// — ```gf-emails for an inbox list, ```gf-message for a single opened email —
// which AssistantMessage parses and hands to these components. Pure presentation.

export interface EmailItem {
  from: string;
  email?: string;
  subject: string;
  snippet?: string;
  time?: string;
  unread?: boolean;
}

export interface Attachment {
  name: string;
  size?: string;
  type?: string;
}

export interface EmailMessage {
  from: string;
  email?: string;
  to?: string;
  time?: string;
  unread?: boolean;
  subject: string;
  body: string;
  attachments?: Attachment[];
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

function Avatar({ from, email }: { from?: string; email?: string }) {
  const [failed, setFailed] = useState(false);
  const dom = domainOf(email);
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
  const name = from || email || '?';
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
            <Avatar from={it.from} email={it.email} />
            {it.unread && <span className="gf-dot" aria-hidden />}
          </span>
          <div className="gf-main">
            <div className="gf-line1">
              <span className="gf-from">{it.from || it.email || 'Unknown'}</span>
              {it.time && <span className="gf-time">{it.time}</span>}
            </div>
            <div className="gf-subject">{it.subject}</div>
            {it.snippet && <div className="gf-snippet">{it.snippet}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const ATT_COLORS: Record<string, string> = {
  pdf: '#E8453C', doc: '#2B7CD3', docx: '#2B7CD3', txt: '#5b6470',
  xls: '#1E8E3E', xlsx: '#1E8E3E', csv: '#1E8E3E', ppt: '#D24726', pptx: '#D24726',
  zip: '#B08900', rar: '#B08900', png: '#7A52CC', jpg: '#7A52CC', jpeg: '#7A52CC', gif: '#7A52CC',
};
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : 'file';
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
  </svg>
);
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export function EmailDetail({ msg }: { msg: EmailMessage }) {
  return (
    <div className="gf-msg">
      <div className="gf-msg-head">
        <Avatar from={msg.from} email={msg.email} />
        <div className="gf-msg-who">
          <div className="gf-msg-name">{msg.from || msg.email || 'Unknown'}</div>
          {msg.email && <div className="gf-msg-addr">{msg.email}</div>}
          {msg.to && <div className="gf-msg-to">To: {msg.to}</div>}
        </div>
        <div className="gf-msg-meta">
          {msg.time && <span className="gf-msg-time">{msg.time}</span>}
          {msg.unread && <span className="gf-msg-pill">Unread</span>}
        </div>
      </div>

      <div className="gf-msg-subject">{msg.subject}</div>
      <div className="gf-msg-body">{msg.body}</div>

      {msg.attachments && msg.attachments.length > 0 && (
        <div className="gf-att-wrap">
          <div className="gf-att-count">
            {msg.attachments.length} Attachment{msg.attachments.length > 1 ? 's' : ''}
          </div>
          {msg.attachments.map((a, i) => {
            const ext = extOf(a.name);
            return (
              <div key={i} className="gf-att">
                <span className="gf-att-icon" style={{ background: ATT_COLORS[ext] ?? '#5b6470' }}>
                  {ext.slice(0, 4).toUpperCase()}
                </span>
                <div className="gf-att-info">
                  <div className="gf-att-name">{a.name}</div>
                  {a.size && <div className="gf-att-size">{a.size}</div>}
                </div>
                <div className="gf-att-actions">
                  <button className="gf-att-btn" aria-label="Download" disabled><DownloadIcon /></button>
                  <button className="gf-att-btn" aria-label="Preview" disabled><EyeIcon /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Shown while a ```gf-emails block is still streaming in.
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

// Shown while a ```gf-message block is still streaming in.
export function EmailDetailSkeleton() {
  return (
    <div className="gf-msg gf-skel">
      <div className="gf-msg-head">
        <span className="gf-avatar gf-skel-box" />
        <div className="gf-msg-who">
          <div className="gf-skel-line w40" />
          <div className="gf-skel-line w70" />
        </div>
      </div>
      <div className="gf-skel-line w70" style={{ marginTop: 14 }} />
      <div className="gf-skel-line w90" />
      <div className="gf-skel-line w90" />
      <div className="gf-skel-line w40" />
    </div>
  );
}
