import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './a11y';
import { Browser } from '@capacitor/browser';
import { fetchEmailHtml, fetchAttachment, type MsgAttachment, type EmailMeta } from './api';

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
  app?: string; // mailbox provider ('gmail' | 'outlook'); themes the card
  draft?: boolean; // an unsent draft (shows a "Draft" badge); id = its message id
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
  app?: string; // mailbox provider ('gmail' | 'outlook')
  draft?: boolean;
  attachments?: { name: string; size?: string | number; type?: string }[];
}

// Which mailbox a card belongs to. The post-processor stamps `app` on the card;
// if it's missing we infer from the message-id shape (Gmail ids are short hex,
// Outlook ids are long) so the theme + reader routing are never wrong.
function providerOf(app?: string, id?: string): 'gmail' | 'outlook' {
  if (app === 'gmail' || app === 'outlook') return app;
  if (id && !/^[0-9a-f]{10,24}$/i.test(id)) return 'outlook';
  return 'gmail';
}

// Remember each listed email's sender/subject so that when one is opened the
// reader can show them instantly (real sender, avatar, colour) while it fetches
// the full body — instead of a blank "Unknown / Loading…" flash. Bounded so a
// long session can't grow it without limit (oldest entries are evicted).
const emailHints = new Map<string, Partial<EmailMessage>>();
const HINTS_MAX = 400;
function rememberHint(id: string, hint: Partial<EmailMessage>) {
  if (emailHints.has(id)) emailHints.delete(id); // re-insert so it counts as most-recent
  emailHints.set(id, hint);
  while (emailHints.size > HINTS_MAX) {
    const oldest = emailHints.keys().next().value;
    if (oldest === undefined) break;
    emailHints.delete(oldest);
  }
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
  const app = providerOf(items[0]?.app, items[0]?.id);
  for (const it of items) {
    if (it.id) rememberHint(it.id, { from: it.from, email: it.email, subject: it.subject, time: it.time, unread: it.unread, app: it.app, draft: it.draft });
  }
  return (
    <div className={`gf-emails gf-${app}`}>
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
              {it.draft && <span className="gf-draft-pill">Draft</span>}
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

// ---- Contacts (gf-contacts card: people / contact-search results) ----
export interface ContactItem {
  name: string;
  email?: string;
  phone?: string;
  photo?: string; // real profile photo url (default placeholders are dropped server-side)
}

// Real photo if the contact has one, otherwise colored initials (and fall back to
// initials if the photo url fails to load).
function ContactAvatar({ label, photo }: { label: string; photo?: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      <span className="gf-avatar">
        <img src={photo} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="gf-avatar gf-avatar-mono" style={{ background: hueColor(label) }}>{initials(label)}</span>
  );
}

// Contacts are a Gmail feature, so the card uses the same frosted-white glass as
// the Gmail email cards (gf-gmail).
export function ContactsList({ items }: { items: ContactItem[] }) {
  return (
    <div className="gf-contacts gf-gmail">
      {items.map((c, i) => {
        const label = c.name || c.email || c.phone || 'Unknown';
        const sub = c.email || c.phone || '';
        return (
          <div className="gf-contact" key={i}>
            <ContactAvatar label={label} photo={c.photo} />
            <div className="gf-main">
              <div className="gf-contact-name">{label}</div>
              {sub && <div className="gf-contact-sub">{sub}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Action receipt (gf-receipt: "Email sent ✓", "Deleted ✓", …) ----
export interface ReceiptData { kind?: string; title: string; detail?: string }
export function ReceiptCard({ data }: { data: ReceiptData }) {
  const danger = data.kind === 'deleted' || data.kind === 'trash';
  return (
    <div className={`gf-receipt ${danger ? 'gf-receipt-danger' : ''}`}>
      <span className="gf-receipt-ico">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <div className="gf-receipt-text">
        <div className="gf-receipt-title">{data.title}</div>
        {data.detail && <div className="gf-receipt-detail">{data.detail}</div>}
      </div>
    </div>
  );
}

// ---- Generated file (gf-file: a download the code-execution sandbox produced) ----
export interface FileData { name: string; mime?: string; size?: number; url: string }
export function FileCard({ data }: { data: FileData }) {
  const sz = data.size
    ? (data.size < 1024 * 1024 ? `${Math.max(1, Math.round(data.size / 1024))} KB` : `${(data.size / 1024 / 1024).toFixed(1)} MB`)
    : '';
  const open = () => { try { void Browser.open({ url: data.url }); } catch { window.open(data.url, '_blank'); } };
  return (
    <button className="gf-file" onClick={open}>
      <span className="gf-file-ico">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
        </svg>
      </span>
      <span className="gf-file-text">
        <span className="gf-file-name">{data.name}</span>
        <span className="gf-file-sub">{sz ? `${sz} · ` : ''}Tap to download</span>
      </span>
      <span className="gf-file-dl" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
        </svg>
      </span>
    </button>
  );
}

// ---- Generated image (gf-image: an image the assistant created) ----
export interface ImageData { url: string; prompt?: string }
export function GenImage({ data }: { data: ImageData }) {
  const open = () => { try { void Browser.open({ url: data.url }); } catch { window.open(data.url, '_blank'); } };
  return <img className="gf-image" src={data.url} alt={data.prompt || 'Generated image'} loading="lazy" onClick={open} />;
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
  { items, thumbs, onPreview, onDownload }: {
    items: { name: string; size?: string | number; type?: string }[];
    thumbs?: (string | undefined)[];
    onPreview?: (i: number) => void;
    onDownload?: (i: number) => void;
  },
) {
  return (
    <div className="gf-att-list">
      {items.map((a, i) => {
        const ext = extOf(a.name);
        const size = humanSize(a.size);
        const thumb = thumbs?.[i];
        return (
          <div key={i} className="gf-att">
            {thumb
              ? <img className="gf-att-thumb" src={thumb} alt="" loading="lazy" />
              : <span className="gf-att-icon" style={{ background: ATT_COLORS[ext] ?? '#5b6470' }}>{ext.slice(0, 4).toUpperCase()}</span>}
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
// Remote images load by default (like Gmail / Apple Mail); insecure http URLs are
// auto-upgraded to https below so they aren't blocked as mixed content. Inline
// cid: images are resolved to data: URIs from the user's own attachments.
const FRAME_HEAD =
  '<!doctype html><html><head>' +
  // Auto-upgrade insecure http:// images to https:// — otherwise the HTTPS app
  // blocks them as mixed content (many marketing emails use http image URLs).
  // Lock the email frame down: no scripts/objects/frames/connections, no form
  // submissions (anti-phishing); only images, inline styles, fonts and media are
  // allowed so marketing HTML still renders. (Scripts also can't run — the iframe
  // sandbox omits allow-scripts — this is defense-in-depth.)
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src http: https: data:; style-src \'unsafe-inline\'; font-src http: https: data:; media-src http: https: data:; base-uri \'none\'; form-action \'none\'; upgrade-insecure-requests">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<base target="_blank"><style>html,body{margin:0}body{padding:12px;background:#fff;color:#111;' +
  'font:14px/1.55 -apple-system,system-ui,sans-serif;word-break:break-word;overflow-x:hidden}' +
  'img{max-width:100%!important;height:auto}a{color:#1a73e8}table{max-width:100%!important}</style></head><body>';
const FRAME_FOOT = '</body></html>';

// Format an RFC date header into the short label the card shows ("9:41 AM" today,
// else "May 19"), in the viewer's locale/timezone.
function fmtTime(date?: string): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function EmailBody({ id, app, fallback, onMeta }: { id: string; app?: string; fallback: string; onMeta?: (m: EmailMeta) => void }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [html, setHtml] = useState('');
  const [atts, setAtts] = useState<MsgAttachment[]>([]);
  const [cidMap, setCidMap] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(!!lightbox, lightboxRef, () => setLightbox(null));
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Call the latest onMeta via a ref so the fetch effect depends only on id/app
  // (not the callback's identity) — otherwise it would re-fetch on every render.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  useEffect(() => {
    let alive = true;
    setStatus('loading'); setHtml(''); setAtts([]); setCidMap({}); setThumbs({});
    (async () => {
      try {
        const r = await fetchEmailHtml(id, app);
        if (!alive) return;
        onMetaRef.current?.(r.meta);
        setAtts(r.attachments);
        setHtml(r.html);
        setStatus(r.html ? 'ok' : 'fail');
        // Fetch a hosted URL for each image attachment once; reuse it for the
        // inline cid: images AND for the attachment thumbnails.
        const urlByAtt: Record<string, string> = {};
        for (const a of r.attachments) {
          if (!(a.mimeType || '').startsWith('image/')) continue;
          try {
            const { b64, url } = await fetchAttachment(id, a.attachmentId, a.name, app);
            const src = url || (b64 ? `data:${a.mimeType};base64,${b64}` : '');
            if (src) urlByAtt[a.attachmentId] = src;
          } catch { /* skip */ }
        }
        if (!alive) return;
        setThumbs(urlByAtt);
        // Resolve inline cid: images (applied at render AFTER remote-image
        // blocking, so these resolved URLs aren't treated as remote/blocked).
        const cids = [...new Set([...r.html.matchAll(/cid:([^"')\s>]+)/gi)].map((m) => m[1]))];
        const map: Record<string, string> = {};
        for (const cid of cids) {
          const att = r.attachments.find((a) => a.contentId && (a.contentId === cid || cid.includes(a.contentId)));
          if (att && urlByAtt[att.attachmentId]) map[cid] = urlByAtt[att.attachmentId];
        }
        if (Object.keys(map).length) setCidMap(map);
      } catch {
        if (alive) setStatus('fail');
      }
    })();
    return () => { alive = false; };
  }, [id, app]);

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
      let src = thumbs[att.attachmentId] || '';
      if (!src) {
        const { b64, url } = await fetchAttachment(id, att.attachmentId, att.name, app);
        src = url || (b64 ? `data:${att.mimeType || 'application/octet-stream'};base64,${b64}` : '');
      }
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
  if (status === 'fail') return <div className="gf-msg-body">{fallback || 'Couldn’t load this email.'}</div>;

  let doc = html;
  for (const [cid, src] of Object.entries(cidMap)) doc = doc.split('cid:' + cid).join(src);

  return (
    <>
      <div className="gf-body-wrap">
        <iframe
          ref={frameRef}
          className="gf-body-frame"
          title="Email"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={FRAME_HEAD + doc + FRAME_FOOT}
          onLoad={() => { fit(); setTimeout(fit, 500); }}
        />
      </div>
      {atts.length > 0 && (
        <AttachmentCard
          items={atts.map((a) => ({ name: a.name, size: a.size, type: a.mimeType }))}
          thumbs={atts.map((a) => thumbs[a.attachmentId])}
          onPreview={(i) => act(i, 'preview')}
          onDownload={(i) => act(i, 'download')}
        />
      )}
      {lightbox && (
        <div className="gf-lightbox" role="dialog" aria-label="Image preview" ref={lightboxRef} tabIndex={-1} onClick={() => setLightbox(null)}>
          <button className="sr-only" onClick={() => setLightbox(null)}>Close preview</button>
          <img src={lightbox} alt="Email image, enlarged" />
        </div>
      )}
    </>
  );
}

export function EmailDetail({ msg }: { msg: EmailMessage }) {
  // The model may send a full object or just an {"id"}; either way we fetch the
  // real message by id and fill any header field it didn't provide, so the card
  // is complete for every email.
  const [meta, setMeta] = useState<EmailMeta>({});
  // Seed from the tapped list row (if we have it) so the header shows instantly,
  // before the full message body finishes loading.
  const hint: Partial<EmailMessage> = (msg.id && emailHints.get(msg.id)) || {};
  const from = msg.from || hint.from || meta.from || '';
  const email = msg.email || hint.email || meta.email;
  const to = msg.to || meta.to;
  const subject = msg.subject || hint.subject || meta.subject || '';
  const time = msg.time || hint.time || fmtTime(meta.date);
  const unread = msg.unread ?? hint.unread ?? meta.unread;
  const draft = msg.draft ?? hint.draft;
  const app = providerOf(msg.app ?? hint.app ?? meta.app, msg.id);
  return (
    <div className={`gf-msg gf-${app}`}>
      <div className="gf-msg-head">
        <Avatar from={from} email={email} />
        <div className="gf-msg-who">
          <div className="gf-msg-name">{from || email || 'Unknown'}</div>
          {email && <div className="gf-msg-addr">{email}</div>}
          {to && <div className="gf-msg-to">To: {to}</div>}
        </div>
        <div className="gf-msg-meta">
          {time && <span className="gf-msg-time">{time}</span>}
          {draft ? <span className="gf-msg-pill gf-draft-pill">Draft</span> : unread && <span className="gf-msg-pill">Unread</span>}
        </div>
      </div>

      {subject && <div className="gf-msg-subject">{subject}</div>}

      {msg.id ? (
        <EmailBody id={msg.id} app={app} fallback={msg.body || ''} onMeta={setMeta} />
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
