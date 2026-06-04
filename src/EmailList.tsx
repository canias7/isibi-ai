import { useEffect, useRef, useState } from 'react';
import { fetchEmailHtml, fetchAttachment, type MsgAttachment } from './api';

// Rich email rendering for chat replies. The assistant emits a fenced JSON block
// — ```gf-emails for an inbox list, ```gf-message for a single opened email —
// which AssistantMessage parses and hands to these components.

export interface EmailItem {
  id?: string;
  from: string;
  email?: string;
  subject: string;
  snippet?: string;
  time?: string;
  unread?: boolean;
}

export interface EmailMessage {
  id?: string;
  from: string;
  email?: string;
  to?: string;
  time?: string;
  unread?: boolean;
  subject: string;
  body: string;
  attachments?: { name: string; size?: string | number; type?: string }[];
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

export function EmailList({ items, onOpen }: { items: EmailItem[]; onOpen?: (it: EmailItem) => void }) {
  return (
    <div className="gf-emails">
      {items.map((it, i) => (
        <div
          key={i}
          className={`gf-email ${it.unread ? 'unread' : ''}${onOpen ? ' tappable' : ''}`}
          onClick={onOpen ? () => onOpen(it) : undefined}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
        >
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

// ---- Attachments ----
const ATT_COLORS: Record<string, string> = {
  pdf: '#E8453C', doc: '#2B7CD3', docx: '#2B7CD3', txt: '#5b6470',
  xls: '#1E8E3E', xlsx: '#1E8E3E', csv: '#1E8E3E', ppt: '#D24726', pptx: '#D24726',
  zip: '#B08900', rar: '#B08900', png: '#7A52CC', jpg: '#7A52CC', jpeg: '#7A52CC', gif: '#7A52CC',
};
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : 'file';
}
function humanSize(n?: string | number): string {
  if (n == null || n === '') return '';
  if (typeof n === 'string') return n;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

function AttachmentCard(
  { items, onPreview, onDownload }: {
    items: { name: string; size?: string | number; type?: string }[];
    onPreview?: (i: number) => void;
    onDownload?: (i: number) => void;
  },
) {
  return (
    <div className="gf-att-wrap">
      <div className="gf-att-count">{items.length} Attachment{items.length > 1 ? 's' : ''}</div>
      {items.map((a, i) => {
        const ext = extOf(a.name);
        const size = humanSize(a.size);
        return (
          <div key={i} className="gf-att">
            <span className="gf-att-icon" style={{ background: ATT_COLORS[ext] ?? '#5b6470' }}>
              {ext.slice(0, 4).toUpperCase()}
            </span>
            <div className="gf-att-info">
              <div className="gf-att-name">{a.name}</div>
              {size && <div className="gf-att-size">{size}</div>}
            </div>
            <div className="gf-att-actions">
              <button className="gf-att-btn" aria-label="Download" disabled={!onDownload} onClick={onDownload ? () => onDownload(i) : undefined}><DownloadIcon /></button>
              <button className="gf-att-btn" aria-label="Preview" disabled={!onPreview} onClick={onPreview ? () => onPreview(i) : undefined}><EyeIcon /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Real-HTML email body (sandboxed iframe) ----
// Block only REMOTE (http) images by default — privacy (they track opens).
// Inline cid: images (resolved to data: URIs from the user's own attachments)
// are safe and stay visible.
function stripRemoteImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    /\ssrc=["']?https?:/i.test(tag) ? tag.replace(/\s(src|srcset)=/gi, ' data-blk-$1=') : tag,
  );
}
const FRAME_HEAD =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<base target="_blank"><style>html,body{margin:0}body{padding:12px;background:#fff;color:#111;' +
  'font:14px/1.55 -apple-system,system-ui,sans-serif;word-break:break-word;overflow-x:hidden}' +
  'img{max-width:100%!important;height:auto}a{color:#1a73e8}table{max-width:100%!important}</style></head><body>';
const FRAME_FOOT = '</body></html>';

function EmailBody({ id, fallback }: { id: string; fallback: string }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [html, setHtml] = useState('');
  const [hasImages, setHasImages] = useState(false); // remote http images
  const [showImages, setShowImages] = useState(false);
  const [atts, setAtts] = useState<MsgAttachment[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    setStatus('loading'); setShowImages(false); setHtml(''); setAtts([]);
    (async () => {
      try {
        const r = await fetchEmailHtml(id);
        if (!alive) return;
        setAtts(r.attachments);
        setHasImages(r.hasImages);
        // Resolve inline cid: images from the user's own attachments (safe).
        let resolved = r.html;
        const cids = [...new Set([...r.html.matchAll(/cid:([^"')\s>]+)/gi)].map((m) => m[1]))];
        for (const cid of cids) {
          const att = r.attachments.find((a) => a.contentId && (a.contentId === cid || cid.includes(a.contentId)));
          if (!att) continue;
          try {
            const { b64, url } = await fetchAttachment(id, att.attachmentId);
            const src = url || (b64 ? `data:${att.mimeType || 'image/png'};base64,${b64}` : '');
            if (src) resolved = resolved.split('cid:' + cid).join(src);
          } catch { /* leave this one unresolved */ }
        }
        if (!alive) return;
        setHtml(resolved);
        setStatus(resolved ? 'ok' : 'fail');
      } catch {
        if (alive) setStatus('fail');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Size the frame to its content (sandbox allows same-origin reads; no scripts run).
  function fit() {
    const f = frameRef.current;
    try {
      const h = f?.contentWindow?.document?.body?.scrollHeight;
      if (f && h) f.style.height = Math.min(h + 8, 6000) + 'px';
    } catch { /* opaque — keep default height */ }
  }

  async function act(i: number, mode: 'preview' | 'download') {
    const att = atts[i];
    if (!att) return;
    try {
      const { b64, url } = await fetchAttachment(id, att.attachmentId);
      const src = url || (b64 ? `data:${att.mimeType || 'application/octet-stream'};base64,${b64}` : '');
      if (!src) return;
      if (mode === 'preview' && (att.mimeType || '').startsWith('image/')) {
        setLightbox(src);
        return;
      }
      const a = document.createElement('a');
      a.href = src;
      a.download = att.name;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch { /* ignore */ }
  }

  if (status === 'loading') return <div className="gf-msg-body gf-body-loading">Loading email…</div>;
  if (status === 'fail') return <div className="gf-msg-body">{fallback}</div>;

  return (
    <>
      <div className="gf-body-wrap">
        {hasImages && !showImages && (
          <button className="gf-show-images" onClick={() => setShowImages(true)}>🖼 Show images</button>
        )}
        <iframe
          ref={frameRef}
          className="gf-body-frame"
          title="Email"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={FRAME_HEAD + (showImages ? html : stripRemoteImages(html)) + FRAME_FOOT}
          onLoad={() => { fit(); setTimeout(fit, 500); }}
        />
      </div>
      {atts.length > 0 && (
        <AttachmentCard
          items={atts.map((a) => ({ name: a.name, size: a.size, type: a.mimeType }))}
          onPreview={(i) => act(i, 'preview')}
          onDownload={(i) => act(i, 'download')}
        />
      )}
      {lightbox && (
        <div className="gf-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  );
}

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

      {msg.id ? (
        <EmailBody id={msg.id} fallback={msg.body} />
      ) : (
        <>
          <div className="gf-msg-body">{msg.body}</div>
          {msg.attachments && msg.attachments.length > 0 && <AttachmentCard items={msg.attachments} />}
        </>
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
