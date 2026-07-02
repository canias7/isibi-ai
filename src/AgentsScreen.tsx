import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconInbox, IconRefresh, IconCheck, IconContacts,
  IconDoc, IconPlus, IconArrowUp, IconX, IconCopy,
  IconCalendar, IconWebhook, IconChart, IconGlobe, IconBolt, IconSearch,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox, fetchInboxMergedPaged, searchInbox, sendEmail, fetchEmailHtml, fetchMailboxProfile, fetchContacts, listSavedContacts, addSavedContact, updateSavedContact, deleteSavedContact, listCampaigns, createCampaign, sendCampaignBatch, unscheduleCampaign, campaignStats, type CampaignStats, getDeliverability, type Reputation, listWebhooks, addWebhook, removeWebhook, toggleWebhook, testWebhook, setWebhookEvents, listWebhookDeliveries, type WebhookDelivery, listAutomations, saveAutomation, toggleAutomation, removeAutomation, listSuppressions, removeSuppression, listTemplates, saveTemplate, deleteTemplate, chatTemplateStart, getTemplateJob, type TemplateJob, uploadEmailImage, tgChats, tgMessages, tgSend, type TgChat, type TgMessage, type Campaign, type WebhookEndpoint, type Automation, type AutomationStep, type SavedContact, type Suppression, type Template, type ChatMsg } from './api';
import { EmailList, EmailDetail, EmailSkeleton, ContactsList, buildSrcDoc, providerOf, type EmailItem, type ContactItem } from './EmailList';
import { SENDRA_LOGO } from './sendraLogo';
import { SENDRA_TOOLS, type SendraTab, type SendraNavId, type MktNavRequest } from './marketingNav';
import { mailerListDomains, mailerAddDomain, mailerDomainRecords, mailerVerifyDomain, mailerRemoveDomain, mailerSend, mailerMessages, mailerMessage, type SendingDomain, type DnsRecord, type Message as SentEmail } from './mailer';
import { discoverDomainConnect, type DcSupport } from './domainConnect';

// Minimal HTML escape for text we inject into a forwarded email's markup.
const escapeHtml = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Sendra is the comms agent (Gmail, Outlook & Telegram in one place). The app's
// home screen picks the agent, so this screen opens straight into Sendra's workspace.
type AgentId = 'email';
type IconCmp = typeof IconCompose;

// The communication apps Sendra can manage. `mail` apps (Gmail/Outlook) share the
// email workspace (inbox/compose/contacts); telegram has its own chat workspace.
type CommsId = 'gmail' | 'm365' | 'telegram';

// Sendra home tabs + their header copy.
const SENDRA_META: Record<SendraTab, { t: string; s: string }> = {
  campaigns: { t: 'Campaigns', s: 'Email to your lists' },
  templates: { t: 'Templates', s: 'Reusable messages' },
  domains: { t: 'Domains', s: 'Send from your own address' },
  schedule: { t: 'Schedule', s: 'Scheduled sends & reminders' },
  webhook: { t: 'Webhooks', s: 'Post events to your systems' },
  emails: { t: 'Emails', s: 'Individual emails you’ve sent' },
  logs: { t: 'Logs', s: 'Every email sent & what happened' },
  deliver: { t: 'Deliverability', s: 'Are your emails landing?' },
  automations: { t: 'Automations', s: 'Drip sequences on autopilot' },
};
// Sendra home menu (shared with the unified Marketing sidebar in App.tsx).
const HOME_TOOLS = SENDRA_TOOLS;

// The mail workspace's top cards. Sequence opens the Automations tab; Broadcast opens Campaigns.
const EMAIL_ACTIONS: { id: string; label: string; sub: string; icon: IconCmp }[] = [
  { id: 'inbox', label: 'Inbox', sub: 'View mail', icon: IconInbox },
  { id: 'new', label: 'New email', sub: 'Single send', icon: IconCompose },
  { id: 'sequence', label: 'Sequence', sub: 'Multi-step', icon: IconLayers },
  { id: 'broadcast', label: 'Broadcast', sub: 'To a list', icon: IconWaveform },
  { id: 'contacts', label: 'Contacts', sub: 'People', icon: IconContacts },
];

const PAGE_SIZE = 20;       // emails per page (kept small — GMAIL_FETCH_EMAILS is slow at high counts)

// Oldest fetched timestamp per mailbox — drives the merged-inbox watermark so a
// sparse mailbox's old mail isn't shown out of order before un-fetched newer mail.
function oldestPerApp(items: EmailItem[]): Record<string, number> {
  const f: Record<string, number> = {};
  for (const it of items) {
    const a = it.app; if (!a) continue;
    const ts = it.ts ?? 0;
    if (f[a] === undefined || ts < f[a]) f[a] = ts;
  }
  return f;
}
const PULL_THRESHOLD = 64;  // px of pull-down that triggers a refresh
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Append a segment tag to a comma-separated string (lowercased, deduped).
function addTagStr(tags: string, t: string): string {
  const cur = tags.split(',').map((x) => x.trim()).filter(Boolean);
  const tag = t.trim().toLowerCase();
  if (!tag || cur.includes(tag)) return tags;
  return [...cur, tag].join(', ');
}
// First line of a template's HTML body, as plain text — used as the list subtitle
// (more useful than the subject, which usually duplicates the name).
function tplSnippet(html?: string): string {
  if (!html) return '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(' ').slice(0, 12).join(' ');
}

// Session caches (in-memory only), keyed by app so re-opening a view is instant
// and Gmail/Outlook don't share each other's mail.
const inboxCache: Record<string, EmailItem[]> = {};
const contactsCache: Record<string, ContactItem[]> = {};
let tgChatsCache: TgChat[] | null = null;

const fmtTime = (ms: number | null): string => {
  if (!ms) return '';
  try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};


type EmailTab = 'home' | 'inbox' | 'compose' | 'contacts';
type SendState = 'idle' | 'confirm' | 'sending' | 'sent' | 'err';
type Loadable = 'idle' | 'loading' | 'ok' | 'err';

// Where the in-progress builder session (chat + current email) is autosaved so
// it survives an app close — restored next time you open Templates (Lovable-style).
const TPL_DRAFT_KEY = 'sendra_tpl_draft_v1';

// The webhook events an endpoint can subscribe to — only the ones Sendra actually
// fans out today (mail-events: delivered/bounced/complained, track: opened/clicked,
// address-book: contact.*). Must mirror KNOWN_EVENTS in the `webhooks` edge fn.
// An empty subscription on an endpoint means "all events".
const WH_EVENT_GROUPS: { group: string; events: { id: string; label: string }[] }[] = [
  { group: 'Email', events: [
    { id: 'sent', label: 'Sent' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'opened', label: 'Opened' },
    { id: 'clicked', label: 'Clicked' },
    { id: 'bounced', label: 'Bounced' },
    { id: 'complained', label: 'Complained' },
    { id: 'failed', label: 'Failed' },
  ] },
  { group: 'Contacts', events: [
    { id: 'contact.created', label: 'Contact created' },
    { id: 'contact.updated', label: 'Contact updated' },
    { id: 'contact.deleted', label: 'Contact deleted' },
  ] },
  { group: 'Domains', events: [
    { id: 'domain.created', label: 'Domain created' },
    { id: 'domain.updated', label: 'Domain updated' },
    { id: 'domain.deleted', label: 'Domain deleted' },
  ] },
];
const WH_ALL_EVENTS = WH_EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.id));
// An endpoint's effective subscription: a stored empty array means "all events".
const whEffective = (events?: string[]): string[] => (events && events.length ? events : WH_ALL_EVENTS);

// Resend-style event picker: a single dropdown trigger that opens a grouped,
// multi-select menu of events. `value` is the effective (non-empty) selection;
// `onToggle(id)` flips one event. Used both in the Add modal and the per-endpoint
// editor, so the toggle semantics live with the caller.
function WhEventPicker({ value, onToggle }: { value: string[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const all = value.length >= WH_ALL_EVENTS.length;
  const summary = all ? 'All events' : value.length === 1 ? '1 event' : `${value.length} events`;
  return (
    <div className="ag-wh-pick">
      <button type="button" className={`ag-wh-pick-trig${open ? ' open' : ''}`} onClick={() => { tap(); setOpen((o) => !o); }}>
        <span className="ag-wh-pick-sum">{summary}</span>
        <span className="ag-wh-pick-chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className="ag-wh-pick-back" onClick={() => setOpen(false)} />
          <div className="ag-wh-pick-pop" role="listbox" aria-multiselectable="true">
            {WH_EVENT_GROUPS.map((g) => (
              <div className="ag-wh-pick-grp" key={g.group}>
                <div className="ag-wh-pick-grphd">{g.group}</div>
                {g.events.map((ev) => {
                  const on = value.includes(ev.id);
                  return (
                    <button type="button" role="option" aria-selected={on} key={ev.id} className={`ag-wh-pick-opt${on ? ' on' : ''}`} onClick={() => onToggle(ev.id)}>
                      <span className="ag-wh-pick-box">{on ? '✓' : ''}</span>
                      <span className="ag-wh-pick-lbl">{ev.label}</span>
                      <code className="ag-wh-pick-id">{ev.id}</code>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Emails-page filters. Statuses mirror what individual sends actually report
// (the `messages` row's status), each with a Resend-style colored dot.
// Only statuses a transactional message row can actually hold (see the mailer /
// mail-events functions): sent | failed | delivered | complained | bounced |
// soft_bounced. Filters for statuses that never appear (opened/clicked/queued/…)
// were removed — selecting one always returned "no emails match", implying the
// user had none rather than that the filter was dead.
const MSG_STATUS_OPTS: { id: string; label: string; dot?: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'sent', label: 'Sent', dot: '#9298a2' },
  { id: 'delivered', label: 'Delivered', dot: '#34d399' },
  { id: 'soft_bounced', label: 'Delivery delayed', dot: '#fbbf24' },
  { id: 'bounced', label: 'Bounced', dot: '#ff6b6b' },
  { id: 'complained', label: 'Complained', dot: '#e0951f' },
  { id: 'failed', label: 'Failed', dot: '#ff6b6b' },
];
// Placeholder until API keys exist — the menu is here for parity with Resend;
// once keys are real, populate this and filter by the sending key.
const MSG_APIKEY_OPTS: { id: string; label: string }[] = [{ id: 'all', label: 'All API keys' }];
const MSG_RANGE_OPTS: { id: string; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '3d', label: 'Last 3 days', days: 3 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '15d', label: 'Last 15 days', days: 15 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: 'all', label: 'All time', days: 0 },
];
// Cutoff (ms) for a range filter. "Today" means the calendar day, not a rolling
// 24h window — otherwise something sent yesterday evening shows under Today, and
// the label is simply wrong in every timezone.
function rangeCutoffMs(id: string, days: number): number {
  if (days === 0) return 0;
  if (id === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return Date.now() - days * 86400000;
}

// Logs page (API request log) filter options.
const LOG_HTTP_OPTS: { id: string; label: string; dot?: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'success', label: 'Successes', dot: '#34d399' },
  { id: 'error', label: 'Errors', dot: '#ff6b6b' },
];
const LOG_SOURCE_OPTS: { id: string; label: string; dot?: string }[] = [
  { id: 'all', label: 'All sources' },
  { id: 'campaign', label: 'Campaigns', dot: '#8b9bff' },
  { id: 'api', label: 'API calls', dot: '#ff9a4d' },
];
// One row in the unified request log: a transactional send (/emails) or a
// campaign send (/campaigns), each modeled as a POST request with an HTTP code.
type LogEntry = { id: string; endpoint: string; method: string; code: number; at: string; source: 'api' | 'campaign'; q: string };

// A compact Resend-style single-select dropdown: a trigger showing the current
// value (with an optional colored dot) that opens a floating menu; the selected
// row gets a check. A transparent backdrop closes it on an outside tap.
function FilterMenu({ value, options, onChange, align, hint }: { value: string; options: { id: string; label: string; dot?: string }[]; onChange: (id: string) => void; align?: 'right'; hint?: string }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.id === value) || options[0];
  return (
    <div className="ag-fm">
      <button type="button" className={`ag-fm-trig${open ? ' open' : ''}`} onClick={() => { tap(); setOpen((o) => !o); }}>
        {cur.dot && <span className="ag-fm-dot" style={{ background: cur.dot }} />}
        <span className="ag-fm-cur">{cur.label}</span>
        <span className="ag-fm-chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className="ag-fm-back" onClick={() => setOpen(false)} />
          <div className={`ag-fm-pop${align === 'right' ? ' right' : ''}`} role="listbox">
            {options.map((o) => (
              <button type="button" role="option" aria-selected={o.id === value} key={o.id} className={`ag-fm-opt${o.id === value ? ' on' : ''}`} onClick={() => { tap(); onChange(o.id); setOpen(false); }}>
                <span className="ag-fm-dot" style={{ background: o.dot || 'transparent' }} />
                <span className="ag-fm-lbl">{o.label}</span>
                {o.id === value && <span className="ag-fm-chk"><IconCheck size={14} /></span>}
              </button>
            ))}
            {hint && <div className="ag-fm-hint">{hint}</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Short relative time for the version-history list (e.g. "just now", "5m", "3h", "2d").
const relTime = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Preview only: show a sample value for the {{name}} merge tag so the email reads
// naturally ("Hi there,"). The saved/sent body keeps {{name}} — campaigns swap in
// each recipient's real name (falling back to "there") at send time.
const fillMergeTags = (html: string) => html.replace(/\{\{\s*name\s*\}\}/gi, 'there');
// Copy text to the clipboard, with a hidden-textarea fallback for older webviews.
const copyToClipboard = async (s: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(s); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch { return false; }
};
// While Sendra works, cycle a few honest status words instead of a single "Designing…".
const BUILD_PHASES = ['Thinking…', 'Designing…', 'Writing the copy…', 'Making it look good…'];
function BuilderStatus({ withImage }: { withImage?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((n) => n + 1), 2000); return () => clearInterval(id); }, []);
  const phases = withImage ? ['Looking at your image…', ...BUILD_PHASES] : BUILD_PHASES;
  return (
    <div className="ag-cb-a ag-cb-typing">
      <span className="ag-cb-dots" aria-hidden="true"><i /><i /><i /></span>
      {phases[Math.min(i, phases.length - 1)]}
    </div>
  );
}
// Reveal an assistant reply one character at a time (skipped if reduced-motion).
function Typewriter({ text, on }: { text: string; on: boolean }) {
  const [n, setN] = useState(on ? 0 : text.length);
  useEffect(() => {
    if (!on) { setN(text.length); return; }
    setN(0); let i = 0;
    const id = setInterval(() => { i += 2; setN(i); if (i >= text.length) clearInterval(id); }, 18);
    return () => clearInterval(id);
  }, [text, on]);
  return <span>{text.slice(0, n)}</span>;
}

// A pending AI-builder job, persisted so it survives a full app restart. The server
// keeps generating regardless; on return we resume polling and apply the result.
type PendingJob = { jobId: string; editId: string; prev: { subject: string; body: string }; label: string; at: number };
const JOB_KEY = 'sendra_tpl_job';
function saveJob(j: PendingJob) { try { localStorage.setItem(JOB_KEY, JSON.stringify(j)); } catch { /* ignore */ } }
function loadJob(): PendingJob | null { try { const s = localStorage.getItem(JOB_KEY); const j = s ? JSON.parse(s) : null; return j && Date.now() - j.at < 300000 ? j : null; } catch { return null; } }
function clearJob() { try { localStorage.removeItem(JOB_KEY); } catch { /* ignore */ } }
// Only clear the stored job if it's still THIS jobId — a stale poll finishing
// must not wipe a newer session's just-saved job record (which would orphan the
// newer generation and let the user fire a duplicate).
function clearJobFor(jobId: string) { try { const j = loadJob(); if (!j || j.jobId === jobId) localStorage.removeItem(JOB_KEY); } catch { /* ignore */ } }

// `active`: false while this engine is the hidden half of the Marketing page —
// it stays mounted (state survives area flips) but its focus trap goes dormant
// so it can't eat Tab/Escape meant for the visible one.
export default function AgentsScreen({ connApps, onClose, navRequest, active = true }: { connApps: string[]; onClose: () => void; navRequest?: MktNavRequest; active?: boolean }) {
  const [agent] = useState<AgentId | null>('email'); // home already chose the agent; open straight into Sendra
  const [commsApp, setCommsApp] = useState<CommsId | null>(null); // null while Sendra shows its home / the app constellation
  const [sendraTab, setSendraTab] = useState<SendraTab>('emails'); // Sendra lands on Emails (sent log); the drawer is the nav
  const [drawerOpen, setDrawerOpen] = useState(false); // slide-out tool sidebar (primary nav)
  const [note, setNote] = useState(''); // transient explainer shown in the P0 scaffolds
  // Mail workspace
  const [emailTab, setEmailTab] = useState<EmailTab>('home');
  const [inbox, setInbox] = useState<EmailItem[]>([]);
  const [inboxState, setInboxState] = useState<Loadable>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextTok, setNextTok] = useState<string | null>(null);
  const [mergedTok, setMergedTok] = useState<Record<string, string | null>>({}); // combined inbox: each mailbox's next-page token
  const [frontier, setFrontier] = useState<Record<string, number>>({}); // combined inbox: oldest fetched ts per mailbox (watermark)
  const [reading, setReading] = useState<EmailItem | null>(null);
  // The address the open email was delivered to (the user's own mailbox
  // address) — surfaced from the message metadata so a reply's From row can
  // show the real account instead of just "Gmail".
  const [readingTo, setReadingTo] = useState('');
  useEffect(() => { if (reading?.id) setReadingTo(''); }, [reading?.id]);
  // Forward mode: the composer carries the original email's full HTML and an
  // optional note typed above it. `fwdSeq` invalidates an in-flight fetch of
  // the original if the user has moved on before it lands.
  // Each connected mailbox's own address ("you@gmail.com"), fetched once so
  // the composer's From shows real accounts instead of "Gmail"/"Outlook".
  const [acctEmails, setAcctEmails] = useState<Record<string, string>>({});
  const [forwarding, setForwarding] = useState(false);
  const [fwdNote, setFwdNote] = useState('');
  const [fwdLoading, setFwdLoading] = useState(false); // forward's full-HTML fetch still in flight
  const [sendErr, setSendErr] = useState('');          // inline compose error (bad Cc/Bcc, etc.)
  const fwdSeqRef = useRef(0);
  // Desktop two-pane inbox (list + reading pane). Static like App's
  // wideViewport — mid-session resizes across the breakpoint are rare.
  const [wide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const [pull, setPull] = useState(0);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactsState, setContactsState] = useState<Loadable>('idle');
  const [contactSearch, setContactSearch] = useState('');           // filter the contacts list
  const [contactSelMode, setContactSelMode] = useState(false);      // multi-select mode
  const [contactSel, setContactSel] = useState<Set<string>>(new Set()); // selected emails
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>([]); // Sendra's own address book
  const [cForm, setCForm] = useState<{ id?: string; name: string; email: string; tags: string } | null>(null); // add/edit overlay
  const [contactTag, setContactTag] = useState('');                 // active segment filter ('' = all)
  const [cFormBusy, setCFormBusy] = useState(false);
  const [cFormErr, setCFormErr] = useState('');
  const [cTag, setCTag] = useState(''); // pending segment-chip input in the contact form
  // Compose / reply state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [composeKind, setComposeKind] = useState<'text' | 'html'>('text'); // 'html' once a designed template is applied
  const [toPicker, setToPicker] = useState(false); // contacts dropdown under the To field
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [cc, setCc] = useState('');           // compose Cc (comma/semicolon separated)
  const [bcc, setBcc] = useState('');         // compose Bcc
  const [showCc, setShowCc] = useState(false); // reveal the Cc/Bcc fields
  const [inboxQ, setInboxQ] = useState('');   // inbox search box text
  const [searchResults, setSearchResults] = useState<EmailItem[] | null>(null); // server search hits (null = not searching)
  const [searchBusy, setSearchBusy] = useState(false); // a server search is in flight
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendApp, setSendApp] = useState<'gmail' | 'outlook'>('gmail'); // which mailbox a send/reply goes through
  const [inboxHome, setInboxHome] = useState(false); // Inbox opened from the Sendra home -> Back returns there, not the app grid
  // Telegram workspace
  const [tgList, setTgList] = useState<TgChat[]>(() => tgChatsCache ?? []);
  const [tgListState, setTgListState] = useState<Loadable>(tgChatsCache ? 'ok' : 'idle');
  const [tgChat, setTgChat] = useState<TgChat | null>(null);
  const [tgMsgs, setTgMsgs] = useState<TgMessage[]>([]);
  const [tgMsgsState, setTgMsgsState] = useState<Loadable>('idle');
  const [tgReply, setTgReply] = useState('');
  const [tgSending, setTgSending] = useState(false);
  // Email campaign builder
  const [campNew, setCampNew] = useState(false);
  const [campApp, setCampApp] = useState<'gmail' | 'outlook'>('gmail');
  const [campSubject, setCampSubject] = useState('');
  const [campBody, setCampBody] = useState('');
  const [campAb, setCampAb] = useState(false);          // A/B test toggle
  const [campSubjectB, setCampSubjectB] = useState(''); // variant B subject
  const [campBodyB, setCampBodyB] = useState('');       // variant B body (plain text)
  const [campRecips, setCampRecips] = useState('');
  const [campState, setCampState] = useState<'idle' | 'sending' | 'done' | 'scheduled' | 'err' | 'warmup' | 'retry'>('idle');
  const [campErr, setCampErr] = useState('');
  const [campProg, setCampProg] = useState({ sent: 0, total: 0, failed: 0 });
  const [campWhen, setCampWhen] = useState<'now' | 'later'>('now'); // send now vs schedule
  const [campSchedAt, setCampSchedAt] = useState('');                // datetime-local value
  const [campList, setCampList] = useState<Campaign[]>([]);
  const [campBodyKind, setCampBodyKind] = useState<'text' | 'html'>('text'); // 'html' when a designed template is applied
  // Per-email activity log (Logs tab)
  const [msgList, setMsgList] = useState<SentEmail[]>([]); // Emails tab: individual transactional sends
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgFilter, setMsgFilter] = useState<string>('all'); // Emails status filter (exact status or 'all')
  const [msgRange, setMsgRange] = useState<string>('30d');    // Emails date-range filter
  const [msgApiKey, setMsgApiKey] = useState<string>('all');  // Emails API-key filter (placeholder until keys exist)
  const [msgSearch, setMsgSearch] = useState(''); // Emails recipient/subject search
  const [msgOpen, setMsgOpen] = useState<SentEmail | null>(null); // selected email (detail view)
  const [msgDetail, setMsgDetail] = useState<SentEmail | null>(null); // fetched detail incl. body
  const [msgDetailBusy, setMsgDetailBusy] = useState(false);
  const [msgDetailErr, setMsgDetailErr] = useState(false); // detail fetch failed (vs body genuinely absent)
  const msgDetailSeqRef = useRef(0);
  const [logsQ, setLogsQ] = useState('');
  const [logsBusy, setLogsBusy] = useState(false);
  const [logRange, setLogRange] = useState<string>('30d');   // Logs date-range filter
  const [logHttp, setLogHttp] = useState<string>('all');     // Logs HTTP-status filter (all | success | error)
  const [logSource, setLogSource] = useState<string>('all'); // Logs source filter (all | campaign | api)
  const [logApiKey, setLogApiKey] = useState<string>('all'); // placeholder until API keys exist
  // Deliverability insights (Deliverability tab)
  const [deliv, setDeliv] = useState<{ reputation: Reputation } | null>(null);
  const [delivBusy, setDelivBusy] = useState(false);
  const [delivErr, setDelivErr] = useState(false);
  // Campaign views + the campaign "From" picker
  const [campView, setCampView] = useState<'list' | 'suppressions' | 'stats'>('list');
  const [campStats, setCampStats] = useState<{ campaign: Campaign; stats: CampaignStats; ab?: { a: { sent: number; opened: number; clicked: number }; b: { sent: number; opened: number; clicked: number } } | null } | null>(null);
  const [campStatsBusy, setCampStatsBusy] = useState(false);
  const [campStatsErr, setCampStatsErr] = useState(false); // stats fetch failed → don't present zeros as real
  const campGenRef = useRef(0);                            // bumps per campaign session; a stale drain loop's writes are dropped
  const [supList, setSupList] = useState<Suppression[]>([]);
  const [copied, setCopied] = useState('');   // last-copied value (webhook secret), for the "Copied" flash
  // Outbound webhooks
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [whNew, setWhNew] = useState('');
  // Automations (drip sequences)
  const [autoList, setAutoList] = useState<Automation[]>([]);
  const [autoNew, setAutoNew] = useState(false);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [autoName, setAutoName] = useState('');
  const [autoTag, setAutoTag] = useState('');
  const [autoDomain, setAutoDomain] = useState('');   // '' = mailbox, else a verified domain
  const [autoApp, setAutoApp] = useState<'gmail' | 'outlook'>('gmail');
  const [autoFromLocal, setAutoFromLocal] = useState('news');
  const [autoFromName, setAutoFromName] = useState('');
  const [autoSteps, setAutoSteps] = useState<AutomationStep[]>([{ delay_days: 0, subject: '', body: '' }]);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoErr, setAutoErr] = useState('');
  const [whBusy, setWhBusy] = useState(false);
  const [whErr, setWhErr] = useState('');
  const [whOpen, setWhOpen] = useState<string | null>(null);
  const [whTest, setWhTest] = useState<Record<string, string>>({}); // endpoint id -> last test result message
  const [whEvents, setWhEvents] = useState<string[]>(WH_ALL_EVENTS); // events the NEXT added endpoint will subscribe to
  const [whAddOpen, setWhAddOpen] = useState(false); // the Resend-style "Add endpoint" modal
  const [whDeliv, setWhDeliv] = useState<Record<string, WebhookDelivery[]>>({}); // endpoint id -> recent deliveries
  const [whDelivBusy, setWhDelivBusy] = useState<string | null>(null); // endpoint whose deliveries are loading
  const [whRmArm, setWhRmArm] = useState('');   // webhook Remove armed (id) — second tap confirms
  const [autoRmArm, setAutoRmArm] = useState(''); // automation Delete armed (id)
  const armTimerRef = useRef<number | null>(null); // shared disarm timer for wh/auto destructive actions
  const [campDomain, setCampDomain] = useState(''); // '' = mailbox; else a verified self-hosted domain
  const [campFromName, setCampFromName] = useState(''); // display name when sending built-in or from a domain
  const [campFromLocal, setCampFromLocal] = useState('news'); // local-part of the From address when sending from a domain
  // Custom sending domains (self-hosted, via the `mailer` fn) — the Domains tab +
  // the composer's verified-domain options (sent once the mail server is connected).
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [domNew, setDomNew] = useState('');     // the "add a domain" input
  const [domBusy, setDomBusy] = useState(false); // add in flight
  const [domErr, setDomErr] = useState('');      // add error message
  const [domOpen, setDomOpen] = useState<string | null>(null); // domain whose detail page is open
  const [domRecOpen, setDomRecOpen] = useState<string | null>(null); // expanded DNS record group (DKIM/SPF/DMARC) in the detail
  const [domVerifying, setDomVerifying] = useState('');  // domain currently being re-verified
  const [domRecords, setDomRecords] = useState<Record<string, DnsRecord[]>>({}); // per-domain DNS records
  const [domChecks, setDomChecks] = useState<Record<string, { dkim: boolean; spf: boolean }>>({}); // last verify detail
  const [dcInfo, setDcInfo] = useState<Record<string, DcSupport>>({}); // Domain Connect discovery per domain
  const [dcBusy, setDcBusy] = useState('');     // domain whose auto-configure is running
  const [testTo, setTestTo] = useState<Record<string, string>>({});   // per-domain test recipient
  const [testBusy, setTestBusy] = useState('');  // domain whose test send is in flight
  const [testMsg, setTestMsg] = useState<Record<string, string>>({}); // per-domain test result
  const [domRmArm, setDomRmArm] = useState('');   // Remove armed for this domain — second tap actually removes
  const domRmTimerRef = useRef<number | null>(null); // disarms Remove after a few seconds
  // Feedback is TAGGED with its domain — an in-flight verify for domain A must
  // not paint its message onto domain B's page after the user navigates.
  const [domVerErr, setDomVerErr] = useState<{ domain: string; msg: string } | null>(null);
  const [domRecsErr, setDomRecsErr] = useState(''); // domain whose records fetch failed
  const [domsLoaded, setDomsLoaded] = useState(false); // first domain-list fetch settled
  const [domsErr, setDomsErr] = useState(false);       // ...and whether it failed
  const domRemovedRef = useRef(new Set<string>()); // domains removed this session — late async results for them are dropped
  // Templates (reusable, AI-writable, or bring-your-own)
  const [tplList, setTplList] = useState<Template[]>([]);
  const [tplEdit, setTplEdit] = useState<null | { id?: string }>(null);
  const [tplName, setTplName] = useState('');
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');      // current email HTML for the AI chat builder
  const [tplImgBusy, setTplImgBusy] = useState(false);
  const [pendingImg, setPendingImg] = useState<string | null>(null); // image attached in the composer, sent on next message
  const [tplSaving, setTplSaving] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [, setChatJobId] = useState(''); // running AI-builder job id (async; survives backgrounding)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null); // chat bubble showing "Copied"
  const [typeIdx, setTypeIdx] = useState<number | null>(null);     // index of the assistant msg to typewriter-reveal
  const [chatErr, setChatErr] = useState('');
  const [chatHistory, setChatHistory] = useState<{ subject: string; body: string }[]>([]); // email state before each turn (Undo)
  const [chatView, setChatView] = useState<'chat' | 'preview' | 'history'>('chat'); // chat thread / email preview / version history
  const [tplVersions, setTplVersions] = useState<{ label: string; subject: string; body: string; at: number }[]>([]); // every build/edit, newest last

  const tokensRef = useRef<(string | undefined)[]>([undefined]);
  const pullStart = useRef<number | null>(null);
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const tgMsgsRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  const chatThreadRef = useRef<HTMLDivElement>(null);       // AI builder thread — auto-scrolls to newest render
  const mountedRef = useRef(true);
  // Set the flag in the SETUP body too: StrictMode (dev) runs setup → cleanup →
  // setup, and a cleanup-only effect would leave the ref permanently false —
  // silently dropping every guarded async update for the component's whole life.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (domRmTimerRef.current) { clearTimeout(domRmTimerRef.current); domRmTimerRef.current = null; }
      if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
    };
  }, []);
  const builderGenRef = useRef(0); // bumped on every AI-builder session change; an in-flight job whose gen no longer matches is dropped (never applied/saved to the wrong template)
  // The template id of the CURRENT builder session (undefined until it has a row).
  // persistTemplate targets this, not the closure's tplEdit?.id — so a stale
  // continuation can't POST a duplicate row or repoint the editor at a copy.
  const tplSessionIdRef = useRef<string | undefined>(undefined);
  const persistChainRef = useRef<Promise<void>>(Promise.resolve()); // serialize persists so two don't both create a row

  // Restore an unsaved builder draft on open (survives app close, Lovable-style).
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(TPL_DRAFT_KEY) || 'null');
      if (d && (d.body || (Array.isArray(d.chat) && d.chat.length))) {
        builderGenRef.current++; // a fresh builder session, like every other entry point
        tplSessionIdRef.current = d.id || undefined;
        setTplEdit({ id: d.id || undefined });
        setTplName(d.name || ''); setTplSubject(d.subject || ''); setTplBody(d.body || '');
        setChatMsgs(Array.isArray(d.chat) ? d.chat : []); setChatView(d.view === 'preview' ? 'preview' : 'chat');
        setTplVersions(Array.isArray(d.versions) ? d.versions : []);
        setPendingImg(typeof d.pending === 'string' ? d.pending : null);
        // A generation may still have been running when the app closed — resume it so its
        // result isn't orphaned and the user can't fire a duplicate over the top of it.
        const pj = loadJob();
        if (pj && pj.editId === (d.id || 'new')) resumeJob(pj, Array.isArray(d.chat) ? d.chat.length : 0);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Autosave the active builder session on every change.
  useEffect(() => {
    if (!tplEdit) return;
    const base = { id: tplEdit.id, name: tplName, subject: tplSubject, body: tplBody, chat: chatMsgs, view: chatView === 'history' ? 'chat' : chatView, pending: pendingImg };
    try { localStorage.setItem(TPL_DRAFT_KEY, JSON.stringify({ ...base, versions: tplVersions })); }
    catch {
      // Quota: the version history (up to 40 × ~50KB bodies) is the heavy part —
      // drop it and keep the live draft, rather than silently freezing at an old
      // snapshot and losing everything on the next app close.
      try { localStorage.setItem(TPL_DRAFT_KEY, JSON.stringify({ ...base, versions: [] })); } catch { /* still over quota — nothing more we can do */ }
    }
  }, [tplEdit, tplName, tplSubject, tplBody, chatMsgs, chatView, tplVersions, pendingImg]);
  const clearDraft = () => { try { localStorage.removeItem(TPL_DRAFT_KEY); } catch { /* ignore */ } };

  // Which provider the mail workspace is talking to (Composio app id -> our param).
  const mailApp = commsApp === 'm365' ? 'outlook' : 'gmail';
  const mailAppRef = useRef(mailApp);
  mailAppRef.current = mailApp;
  const mailConnected = commsApp === 'm365'
    ? connApps.includes('m365') || connApps.includes('outlook')
    : connApps.includes('gmail');
  // Connected mailboxes (api app names). With 2+, the Inbox is one merged,
  // newest-first feed with per-row badges; with 1, the existing paged inbox.
  const mailApiApps = ['gmail', 'outlook'].filter((a) => (a === 'gmail' ? connApps.includes('gmail') : connApps.includes('m365') || connApps.includes('outlook')));
  const combinedInbox = mailApiApps.length >= 2;
  // The general address book: Sendra's own saved contacts (editable) first, then any
  // mailbox-pulled contacts not already covered (deduped by email). Used by the
  // Contacts screen and the composer "To" picker so it's never empty.
  const mergedContacts: ContactItem[] = (() => {
    const own: ContactItem[] = savedContacts.map((c) => ({ id: c.id, name: c.name, email: c.email || undefined, tags: c.tags?.length ? c.tags : undefined }));
    const seen = new Set(own.map((c) => (c.email || '').toLowerCase()).filter(Boolean));
    return [...own, ...contacts.filter((c) => !c.email || !seen.has(c.email.toLowerCase()))];
  })();

  // Back steps one level: reader -> sub-view -> workspace -> deck -> list -> close.
  const back = () => {
    tap();
    if (drawerOpen) { setDrawerOpen(false); return; } // Esc / hardware-back closes the drawer first
    if (reading) setReading(null);
    else if (tgChat) setTgChat(null);
    else if (commsApp && commsApp !== 'telegram' && emailTab === 'compose') setEmailTab(inboxHome ? 'inbox' : 'home');
    else if (commsApp && commsApp !== 'telegram' && emailTab !== 'home' && !inboxHome) setEmailTab('home');
    else if (commsApp) { setCommsApp(null); setInboxHome(false); }
    // Only treat the builder as "open" for Back when it's actually the visible
    // tab — a restored draft sets tplEdit while the user may be on Emails, and
    // without this gate Back would silently save a hidden template first.
    else if (tplEdit && sendraTab === 'templates' && chatView === 'history') setChatView('preview');
    else if (tplEdit && sendraTab === 'templates' && chatView === 'preview') setChatView('chat');
    else if (tplEdit && sendraTab === 'templates') { builderGenRef.current++; if (tplBody.trim() && !tplSaving) saveTpl(); else { clearDraft(); setTplEdit(null); } } // leaving the builder saves a built email + invalidates any in-flight job

    else if (msgOpen) { setMsgOpen(null); setMsgDetail(null); }
    else if (domOpen) setDomOpen(null);
    else if (sendraTab !== 'emails') setSendraTab('emails');
    else onClose();
  };
  useFocusTrap(active, trapRef, back);

  // ---- mail workspace loaders (provider-aware) ----
  const loadPage = useCallback((idx: number) => {
    setRefreshing(true);
    // Seed from cache so a remount (state reset to []) shows the cached list
    // immediately instead of a skeleton, and a failed refresh keeps it visible.
    if (idx === 0 && inboxCache[mailApp]) { setInbox(inboxCache[mailApp]!); setInboxState('ok'); }
    else if (idx === 0) setInboxState('loading');
    fetchInbox(PAGE_SIZE, tokensRef.current[idx], mailApp)
      .then(({ items, nextPageToken }) => {
        if (!mountedRef.current) return;
        setInbox(items); setInboxState('ok'); setPageIdx(idx); setNextTok(nextPageToken);
        if (nextPageToken && tokensRef.current.length === idx + 1) tokensRef.current.push(nextPageToken);
        if (idx === 0) inboxCache[mailApp] = items;
        inboxScrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (idx !== 0) { setNote('Couldn’t load that page — check your connection and try again.'); return; }
        // Only surface an error when there's nothing cached to fall back to.
        if (inboxCache[mailApp]) { setInbox(inboxCache[mailApp]!); setInboxState('ok'); }
        else setInboxState('err');
      })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [mailApp]);
  const refreshInbox = useCallback(() => { tokensRef.current = [undefined]; loadPage(0); }, [loadPage]);
  // Combined inbox (2+ mailboxes): one merged, newest-first feed. Each mailbox
  // pages independently, so we keep a per-provider next-page token and append.
  const combinedApps = useCallback(() => ['gmail', 'outlook'].filter((a) => (a === 'gmail' ? connApps.includes('gmail') : connApps.includes('m365') || connApps.includes('outlook'))), [connApps]);
  const loadMerged = useCallback(() => {
    setRefreshing(true);
    if (inboxCache['all']) { setInbox(inboxCache['all']!); setInboxState('ok'); }
    else setInboxState('loading');
    fetchInboxMergedPaged(combinedApps().map((a) => ({ app: a })))
      .then(({ items, next }) => {
        if (!mountedRef.current) return;
        setInbox(items); setInboxState('ok'); inboxCache['all'] = items; setMergedTok(next); setFrontier(oldestPerApp(items));
        inboxScrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (inboxCache['all']) { setInbox(inboxCache['all']!); setInboxState('ok'); }
        else setInboxState('err');
      })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [combinedApps]);
  // "Load older": pull the next page from every mailbox that still has one, then
  // append + de-dupe + re-sort the whole feed so it stays newest-first.
  const loadMoreMerged = () => {
    if (refreshing) return;
    const reqs = Object.entries(mergedTok).filter(([, t]) => !!t).map(([app, token]) => ({ app, token: token as string }));
    if (!reqs.length) return;
    tap();
    setRefreshing(true);
    fetchInboxMergedPaged(reqs)
      .then(({ items, next }) => {
        if (!mountedRef.current) return;
        setInbox((prev) => {
          const seen = new Set<string>();
          const out: EmailItem[] = [];
          for (const it of [...prev, ...items].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))) {
            const k = it.id || `${it.from}|${it.subject}|${it.ts ?? ''}`;
            if (seen.has(k)) continue;
            seen.add(k); out.push(it);
          }
          inboxCache['all'] = out;
          return out;
        });
        setMergedTok((prev) => ({ ...prev, ...next }));
        setFrontier((prev) => ({ ...prev, ...oldestPerApp(items) }));
      })
      .catch(() => { /* keep what we have */ })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  };

  // Opening an email clears its unread dot immediately (optimistic, local). We
  // keep this client-side only: Composio's Gmail label tools (BATCH_MODIFY /
  // remove-label) are dead at execute time, so read state can't be persisted to
  // Gmail — a uniform local update beats a button that silently fails on one
  // provider. The dot returns only on a hard mailbox reload.
  const markReadLocal = (it: EmailItem) => {
    if (!it.unread || !it.id) return;
    setInbox((prev) => {
      const out = prev.map((m) => (m.id === it.id ? { ...m, unread: false } : m));
      inboxCache[combinedInbox ? 'all' : mailApp] = out;
      return out;
    });
    // The visible list may be server-search results, not `inbox` — clear the dot
    // there too so a read email doesn't keep its unread marker in search.
    setSearchResults((prev) => prev && prev.map((m) => (m.id === it.id ? { ...m, unread: false } : m)));
  };

  const loadContacts = useCallback(() => {
    const app = mailApp; // capture: a slow response for a since-switched mailbox must not repaint the current one
    if (contactsCache[app]) { setContacts(contactsCache[app]); setContactsState('ok'); }
    else setContactsState('loading');
    fetchContacts(app)
      .then((items) => { contactsCache[app] = items; if (mountedRef.current && app === mailAppRef.current) { setContacts(items); setContactsState('ok'); } })
      .catch(() => {
        if (!mountedRef.current || app !== mailAppRef.current) return;
        if (contactsCache[app]) { setContacts(contactsCache[app]); setContactsState('ok'); }
        else setContactsState('err');
      });
  }, [mailApp]);

  // ---- telegram workspace loaders ----
  const loadTgChats = useCallback(() => {
    if (!tgChatsCache) setTgListState('loading');
    tgChats(30)
      .then((items) => { if (mountedRef.current) { tgChatsCache = items; setTgList(items); setTgListState('ok'); } })
      .catch(() => { if (mountedRef.current && !tgChatsCache) setTgListState('err'); });
  }, []);
  const loadTgMsgs = useCallback((chatId: number | string) => {
    setTgMsgsState('loading');
    tgMessages(chatId, 40)
      .then((items) => {
        if (!mountedRef.current) return;
        setTgMsgs(items); setTgMsgsState('ok');
        requestAnimationFrame(() => tgMsgsRef.current?.scrollTo({ top: tgMsgsRef.current.scrollHeight }));
      })
      .catch(() => { if (mountedRef.current) setTgMsgsState('err'); });
  }, []);


  // Load the active workspace view.
  useEffect(() => {
    if (agent !== 'email' || commsApp === null) return;
    if (commsApp === 'telegram') {
      if (tgChat) loadTgMsgs(tgChat.id); else loadTgChats();
    } else if (emailTab === 'inbox') {
      if (combinedInbox) loadMerged(); else refreshInbox();
    } else if (emailTab === 'contacts') {
      loadContacts();
    }
  }, [agent, commsApp, emailTab, tgChat, combinedInbox, refreshInbox, loadMerged, loadContacts, loadTgChats, loadTgMsgs]);

  // Debounced server-side inbox search. Typing filters loaded mail instantly
  // (clientFiltered, above); 400ms after you stop we query the mailbox(es) so a
  // match that wasn't on the loaded page still shows. Clearing restores the feed.
  useEffect(() => {
    if (agent !== 'email' || !commsApp || commsApp === 'telegram' || emailTab !== 'inbox') return;
    const term = inboxQ.trim();
    if (term.length < 2) { setSearchResults(null); setSearchBusy(false); return; }
    let alive = true;
    // Clear last query's hits up front so the changed term doesn't render stale
    // results (or a wrong "No emails match") during the debounce + flight.
    setSearchResults(null);
    setSearchBusy(true);
    const t = setTimeout(() => {
      searchInbox(combinedApps(), term)
        .then((items) => { if (alive && mountedRef.current) setSearchResults(items); })
        .catch(() => { if (alive && mountedRef.current) setSearchResults([]); })
        .finally(() => { if (alive && mountedRef.current) setSearchBusy(false); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [inboxQ, agent, commsApp, emailTab, combinedApps]);

  // Load campaigns (Campaigns tab) and templates (Campaigns builder picker + the
  // Templates tab) when those tabs open.
  useEffect(() => {
    if (agent !== 'email' || commsApp !== null) return;
    if ((sendraTab === 'campaigns' && !campNew) || sendraTab === 'schedule') listCampaigns().then((c) => { if (mountedRef.current) setCampList(c); });
    if (sendraTab === 'campaigns' || sendraTab === 'templates') listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    if (sendraTab === 'logs') loadRequestLogs();
    if (sendraTab === 'emails') { setMsgBusy(true); mailerMessages().then((m) => { if (mountedRef.current) { setMsgList(m); setMsgBusy(false); } }).catch(() => { if (mountedRef.current) setMsgBusy(false); }); }
    if (sendraTab === 'deliver') loadDeliver();
    // Verified domains feed the composer's "Send from" picker; the Domains tab needs the full list.
    if (sendraTab === 'campaigns' || sendraTab === 'domains' || sendraTab === 'automations') mailerListDomains().then((d) => { if (mountedRef.current) setDomains(d); });
    if (sendraTab === 'automations') loadAutomations();
  }, [agent, commsApp, sendraTab, campNew]);

  // (No background auto-verify: it only refetched the stored flag, which can't
  // change without a real DNS re-check. Returns with Domain Connect one-click,
  // where the provider callback makes polling meaningful.)

  // If the open domain drops out of the list (removed elsewhere / stale link),
  // close the detail — otherwise back/Esc eats a dead press and a later list
  // refresh spontaneously reopens the page.
  useEffect(() => {
    if (domsLoaded && domOpen && !domains.some((d) => d.domain === domOpen)) setDomOpen(null);
  }, [domsLoaded, domOpen, domains]);

  // Keep the AI builder pinned to its newest message / rendered email.
  useEffect(() => { const el = chatThreadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chatMsgs, tplBody, chatBusy]);

  // Inbox opened straight from the Sendra home (top-level). Lands on the mail
  // inbox of the first connected mailbox — which is the merged feed when 2+ are
  // connected. `inboxHome` makes Back return to the home, not the app grid.
  const openInbox = () => {
    tap();
    setNote('');
    setReading(null);
    setInboxHome(true);
    const a: CommsId = !connApps.includes('gmail') && (connApps.includes('m365') || connApps.includes('outlook')) ? 'm365' : 'gmail';
    setCommsApp(a);
    setEmailTab('inbox');
  };
  const openContacts = () => {
    tap();
    setNote('');
    setReading(null);
    setInboxHome(true);
    setContactSearch(''); setContactSelMode(false); setContactSel(new Set());
    const a: CommsId = !connApps.includes('gmail') && (connApps.includes('m365') || connApps.includes('outlook')) ? 'm365' : 'gmail';
    setCommsApp(a);
    setEmailTab('contacts');
    loadSaved();
  };
  // Drawer navigation: jump straight to a tool (same actions the old home cards
  // fired) and close the sidebar. Clears any mail/reading state first so switching
  // sections from inside the inbox lands cleanly.
  const navTo = (id: SendraNavId) => {
    setDrawerOpen(false);
    setReading(null);
    if (id === 'inbox') { openInbox(); return; }
    if (id === 'contacts') { openContacts(); return; }
    tap(); setNote('');
    if (id === 'webhook') loadWebhooks();
    // logs/deliver are loaded by the tab-open effect below — don't also load here
    // (a double fetch raced the busy flags and cost two round-trips per open).
    if (id === 'logs') setLogsQ('');
    if (id === 'domains') { setDomNew(''); setDomErr(''); loadDomains(); }
    // Return to the campaign list, not a stale stats/suppressions view left over
    // from a previous visit — but never yank a send that's still draining.
    if (id === 'campaigns' && campState !== 'sending') { setCampView('list'); setCampNew(false); }
    setCommsApp(null); setInboxHome(false);
    setSendraTab(id);
  };

  // A click on the unified Marketing sidebar (App.tsx) lands here; `n` bumps
  // on every click so repeating the same section still resets its view.
  useEffect(() => {
    if (navRequest && navRequest.area === 'email' && navRequest.n > 0) navTo(navRequest.id as SendraNavId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.n]);

  // Resolve the connected mailboxes' own addresses for the From row.
  useEffect(() => {
    if (!commsApp || commsApp === 'telegram' || emailTab !== 'compose') return;
    for (const a of mailApiApps) {
      if (acctEmails[a]) continue; // resolved already; '' (in-flight/failed) may retry on the next compose open
      setAcctEmails((m) => ({ ...m, [a]: '' })); // mark in-flight
      fetchMailboxProfile(a)
        .then((e) => { if (mountedRef.current) { if (e) setAcctEmails((m) => ({ ...m, [a]: e })); else setAcctEmails((m) => { const n = { ...m }; delete n[a]; return n; }); } })
        .catch(() => { if (mountedRef.current) setAcctEmails((m) => { const n = { ...m }; delete n[a]; return n; }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commsApp, emailTab, mailApiApps.join(',')]);

  // The compose screen's template picker needs the list even when the
  // Templates/Campaigns tabs (which normally fetch it) were never opened.
  useEffect(() => {
    if (commsApp && commsApp !== 'telegram' && emailTab === 'compose' && tplList.length === 0) {
      listTemplates().then((t) => { if (mountedRef.current && t.length) setTplList(t); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commsApp, emailTab]);
  const toggleContact = (email: string) => setContactSel((s) => {
    const n = new Set(s);
    if (n.has(email)) n.delete(email); else n.add(email);
    return n;
  });
  // Selected contacts -> prefill a new campaign (the bulk-send engine handles the rest).
  const emailSelected = () => {
    // Respect the active segment so a selection can only send within the segment
    // it was made in (matches the count shown next to the button).
    const inSeg = contactTag ? mergedContacts.filter((c) => c.tags?.includes(contactTag)) : mergedContacts;
    const picked = inSeg.filter((c) => c.email && contactSel.has(c.email));
    if (!picked.length) return;
    tap();
    const recips = picked.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)).join('\n');
    setReading(null); setCommsApp(null); setInboxHome(false);
    setSendraTab('campaigns');
    openCampNew();
    setCampRecips(recips);
    setContactSelMode(false); setContactSel(new Set());
  };
  // ---- Sendra address book (own contacts) ----
  const loadSaved = () => listSavedContacts().then((c) => { if (mountedRef.current) setSavedContacts(c); });
  const openContactForm = (c?: ContactItem) => { tap(); setCFormErr(''); setCTag(''); setCForm({ id: c?.id, name: c?.name || '', email: c?.email || '', tags: c?.tags?.join(', ') || '' }); };
  const saveCForm = async () => {
    if (!cForm || cFormBusy) return;
    const name = cForm.name.trim(), email = cForm.email.trim().toLowerCase();
    const tags = cForm.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (!EMAIL_RE.test(email)) { setCFormErr('A valid email is required.'); return; }
    // No two contacts can share an email (checked here for an instant message; the
    // server + a DB unique index enforce it for real).
    if (savedContacts.some((c) => (c.email || '').trim().toLowerCase() === email && c.id !== cForm.id)) {
      setCFormErr('A contact with this email already exists.'); return;
    }
    setCFormBusy(true); setCFormErr('');
    try {
      const r = cForm.id ? await updateSavedContact(cForm.id, { name, email, tags }) : await addSavedContact({ name, email, tags });
      if (!mountedRef.current) return;
      if (r.error) setCFormErr(
        r.error === 'duplicate_email' ? 'A contact with this email already exists.'
        : r.error === 'email_required' ? 'A valid email is required.'
        : r.error === 'bad_email' ? 'Enter a valid email address.'
        : 'Couldn’t save — try again.');
      else { setCForm(null); await loadSaved(); }
    } catch { if (mountedRef.current) setCFormErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setCFormBusy(false); }
  };
  const delCForm = async () => {
    if (!cForm?.id || cFormBusy) return;
    tap(); setCFormBusy(true); setCFormErr('');
    const email = (cForm.email || '').trim().toLowerCase();
    try {
      await deleteSavedContact(cForm.id);
      if (!mountedRef.current) return;
      // Prune any stale selection referencing the deleted address so the bulk
      // "Email N people" count can't overstate.
      if (email) setContactSel((s) => { if (!s.has(email)) return s; const n = new Set(s); n.delete(email); return n; });
      setCForm(null); await loadSaved();
    } catch (e) {
      if (mountedRef.current) setCFormErr(e instanceof Error ? e.message : 'Couldn’t delete — try again.');
    } finally { if (mountedRef.current) setCFormBusy(false); }
  };

  const onPullStart = (e: React.TouchEvent<HTMLDivElement>) => {
    pullStart.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onPullMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStart.current === null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, 90) : 0);
  };
  const onPullEnd = () => {
    if (pullStart.current !== null && pull >= PULL_THRESHOLD && mailConnected && !refreshing) { if (combinedInbox) loadMerged(); else refreshInbox(); }
    pullStart.current = null;
    setPull(0);
  };

  // Compose helpers
  const openCompose = () => {
    tap();
    // Recover a send that failed while the overlay was closed (see doSend).
    let recovered = false;
    try {
      const raw = localStorage.getItem('gf_pending_send');
      if (raw) {
        const d = JSON.parse(raw);
        setReplyThreadId(d.reply ?? null); setTo(d.to || ''); setSubject(d.subject || '');
        setBodyText(d.body || ''); setComposeKind(d.kind === 'html' ? 'html' : 'text');
        setCc(d.cc || ''); setBcc(d.bcc || ''); setShowCc(!!d.showCc);
        setForwarding(!!d.fwd); setFwdNote(d.note || ''); setSendApp(d.app || mailApp);
        setSendErr('This draft didn’t send last time — review and try again.');
        localStorage.removeItem('gf_pending_send');
        recovered = true;
      }
    } catch { /* ignore */ }
    if (!recovered) {
      setReplyThreadId(null); setTo(''); setSubject(''); setBodyText(''); setComposeKind('text');
      setCc(''); setBcc(''); setShowCc(false);
      setForwarding(false); setFwdNote(''); setSendApp(mailApp); setSendErr('');
    }
    setToPicker(false); fwdSeqRef.current++;
    setSendState('idle'); setEmailTab('compose');
    loadContacts(); loadSaved();  // mailbox + saved contacts for the To picker
    listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });  // for the body template picker
  };
  const applyComposeTemplate = (t: Template) => {
    tap();
    if (t.subject) setSubject(t.subject);
    setBodyText(t.body);
    setComposeKind(t.kind === 'html' ? 'html' : 'text');
    setToPicker(false);
    if (sendState === 'err') setSendState('idle');
  };
  const openReply = () => {
    if (!reading) return;
    tap(); setSendErr('');
    const subj = reading.subject || '';
    setReplyThreadId(reading.threadId || null);
    setTo(reading.email || '');
    setSubject(/^re:/i.test(subj) ? subj : `Re: ${subj}`);
    setBodyText('');
    setCc(''); setBcc(''); setShowCc(false);
    setForwarding(false); setFwdNote(''); fwdSeqRef.current++;
    setSendState('idle');
    // Reply through the email's OWN mailbox — providerOf falls back to the id
    // shape when `app` is absent (Outlook cards often lack it), so an Outlook
    // reply doesn't wrongly route through Gmail.
    setSendApp(providerOf(reading.app, reading.id));
    setReading(null);
    setEmailTab('compose');
  };
  // Forward = a brand-new message (replyThreadId stays null) pre-filled with a
  // quoted header + the ORIGINAL email. Composio's dedicated forward tools are
  // dead (OUTLOOK_FORWARD_MESSAGE broken; Gmail has none), so this composes a
  // fresh send through the existing path — works the same on both mailboxes.
  // The full HTML loads in the background (the snippet stands in until then);
  // an optional note typed above it is prepended at send time (doSend).
  const openForward = () => {
    if (!reading) return;
    tap();
    const item = reading;
    const subj = item.subject || '';
    const who = item.email ? `${item.from || ''} <${item.email}>`.trim() : (item.from || 'Unknown');
    setReplyThreadId(null);
    setForwarding(true); setFwdNote(''); setSendErr('');
    setTo('');
    setSubject(/^fwd:/i.test(subj) ? subj : `Fwd: ${subj}`);
    setBodyText(`\n\n---------- Forwarded message ----------\nFrom: ${who}\n${item.time ? `Date: ${item.time}\n` : ''}Subject: ${subj}\n\n${item.snippet || ''}`);
    setComposeKind('text');
    setCc(''); setBcc(''); setShowCc(false);
    setSendState('idle');
    setSendApp(item.app === 'outlook' ? 'outlook' : 'gmail');
    setReading(null);
    setEmailTab('compose');
    loadContacts(); loadSaved();
    if (item.id) {
      const seq = ++fwdSeqRef.current;
      setFwdLoading(true);
      fetchEmailHtml(item.id, item.app).then((r) => {
        if (!mountedRef.current || fwdSeqRef.current !== seq) return;
        if (r.html) {
          const head = `<div style="font-family:Arial,sans-serif;font-size:13px;color:#555;margin:0 0 14px">---------- Forwarded message ----------<br>From: ${escapeHtml(who)}<br>${item.time ? `Date: ${escapeHtml(item.time)}<br>` : ''}Subject: ${escapeHtml(subj)}</div>`;
          setComposeKind('html');
          setBodyText(head + r.html);
        }
        setFwdLoading(false);
      }).catch(() => { if (mountedRef.current && fwdSeqRef.current === seq) setFwdLoading(false); });
    }
  };
  const validTo = EMAIL_RE.test(to.trim());
  // Split an addr field into valid entries + any non-empty token that FAILED to
  // parse (so a typo'd Cc isn't silently dropped from the send).
  const parseAddrs = (s: string) => {
    const toks = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return { valid: toks.filter((x) => EMAIL_RE.test(x)), bad: toks.filter((x) => !EMAIL_RE.test(x)) };
  };
  // Fire-and-forget: the mail sends in the background while the user goes
  // straight back to the inbox — no confirm sheet, no "sent" screen. A failed
  // send is never lost: the draft is stashed in localStorage for the whole
  // flight, restored to the composer if we're still there, and recovered on the
  // next open if the overlay was closed mid-flight.
  const doSend = () => {
    const ccP = parseAddrs(cc), bccP = parseAddrs(bcc);
    if (ccP.bad.length || bccP.bad.length) {
      setSendErr(`Fix ${ccP.bad.length ? 'Cc' : 'Bcc'}: “${(ccP.bad[0] || bccP.bad[0])}” isn’t a valid email.`);
      setShowCc(true);
      return;
    }
    if (forwarding && fwdLoading) { setSendErr('Still loading the original email — one moment.'); return; }
    tap(); setSendErr('');
    const note = forwarding && composeKind === 'html' && fwdNote.trim()
      ? `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;margin:0 0 16px">${escapeHtml(fwdNote.trim())}</div>`
      : '';
    const payload = { to: to.trim(), subject: subject.trim(), body: note + bodyText, threadId: replyThreadId || undefined, cc: ccP.valid.length ? ccP.valid : undefined, bcc: bccP.valid.length ? bccP.valid : undefined, app: sendApp, html: composeKind === 'html' };
    const draft = { to, cc, bcc, subject, body: bodyText, kind: composeKind, reply: replyThreadId, showCc, fwd: forwarding, note: fwdNote, app: sendApp };
    try { localStorage.setItem('gf_pending_send', JSON.stringify(draft)); } catch { /* quota */ }
    setSendState('idle');
    setTo(''); setCc(''); setBcc(''); setSubject(''); setBodyText(''); setComposeKind('text'); setShowCc(false);
    setForwarding(false); setFwdNote(''); fwdSeqRef.current++;
    setReplyThreadId(null);
    setEmailTab('inbox');
    sendEmail(payload)
      .then(() => { try { localStorage.removeItem('gf_pending_send'); } catch { /* ignore */ } })
      .catch(() => {
        // Unmounted, or the user already started a NEW draft → don't clobber their
        // work; leave the pending record so the next compose-open recovers it.
        if (!mountedRef.current || to || subject || bodyText || commsApp === null) { setSendState('idle'); return; }
        try { localStorage.removeItem('gf_pending_send'); } catch { /* ignore */ }
        setTo(draft.to); setCc(draft.cc); setBcc(draft.bcc); setSubject(draft.subject);
        setBodyText(draft.body); setComposeKind(draft.kind); setShowCc(draft.showCc);
        setForwarding(draft.fwd); setFwdNote(draft.note); setSendApp(draft.app);
        setReplyThreadId(draft.reply);
        setEmailTab('compose');
        setSendState('err');
      });
  };

  // Telegram send
  const doTgSend = () => {
    if (!tgChat || !tgReply.trim() || tgSending) return;
    tap();
    const text = tgReply.trim();
    setTgSending(true);
    tgSend(tgChat.id, text)
      .then(() => {
        if (!mountedRef.current) return;
        setTgReply('');
        setTgMsgs((m) => [...m, { id: Date.now(), text, date: Date.now(), outgoing: true, from: 'You' }]);
        requestAnimationFrame(() => tgMsgsRef.current?.scrollTo({ top: tgMsgsRef.current.scrollHeight }));
        if (tgChat) loadTgMsgs(tgChat.id);
      })
      .catch(() => { /* keep the draft so they can retry */ })
      .finally(() => { if (mountedRef.current) setTgSending(false); });
  };

  // ---- Email campaign builder ----
  // Plain text -> simple HTML (escape + line breaks); {{name}} survives for the
  // backend to personalize. Recipients: one per line/comma, "email" or "Name <email>".
  const campToHtml = (t: string) => t.split('\n').map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>');
  // Inverse of campToHtml — turn a stored step body back into the plain text the
  // editor's textarea expects, so editing + re-saving doesn't double-escape it
  // (`&` → `&amp;amp;`, newlines → literal `<br>`) on every round-trip.
  const htmlToPlain = (h: string) => h.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const parseRecips = (t: string) => t.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((tok) => {
    const m = tok.match(/^(.*?)\s*<([^>]+)>$/);
    return m ? { email: m[2].trim(), name: m[1].trim() || undefined } : { email: tok };
  });
  const openCampNew = () => {
    // Don't wipe a send that's still draining — a stray "new campaign" tap while
    // the loop runs would reset campState and let the old loop write onto the new
    // form. Bump the generation so any in-flight loop stops touching state.
    if (campState === 'sending') { setCampErr('A campaign is still sending — wait for it to finish.'); return; }
    campGenRef.current++;
    tap(); setCampNew(true); setCampState('idle'); setCampErr('');
    setCampSubject(''); setCampBody(''); setCampBodyKind('text'); setCampRecips(''); setCampProg({ sent: 0, total: 0, failed: 0 });
    setCampAb(false); setCampSubjectB(''); setCampBodyB('');
    setCampApp(connApps.includes('gmail') ? 'gmail' : 'outlook');
    setCampDomain(''); setCampFromName(''); setCampFromLocal('news');
    setCampWhen('now'); setCampSchedAt('');
  };
  const cancelScheduled = async (id: string) => {
    tap();
    try {
      const r = await unscheduleCampaign(id);
      const cl = await listCampaigns(); if (mountedRef.current) setCampList(cl);
      // The server only cancels a still-scheduled campaign; if the cron already
      // flipped it to sending, say so rather than implying a clean cancel.
      if (mountedRef.current && r && r.cancelled === false) setNote('That campaign already started sending — it couldn’t be cancelled.');
    } catch { if (mountedRef.current) setNote('Couldn’t cancel that scheduled campaign — try again.'); }
  };
  // Drain an already-created campaign's send batches. Shared by a fresh send and
  // by "Resume" on a campaign left in `sending` (e.g. the tab was closed mid-send).
  // Guarded by campGenRef so a superseded loop never writes stale progress/state.
  const drainCampaign = async (id: string, gen: number) => {
    let done = false;
    let idle = 0; // consecutive no-progress batches (cron holds the lock) → back off, then bail
    try {
      while (!done) {
        const r = await sendCampaignBatch(id);
        if (!mountedRef.current || campGenRef.current !== gen) return;
        if (r.error) { setCampState('err'); setCampErr('Couldn’t continue sending — reopen the campaign to resume.'); return; }
        if (r.paused) { setCampState('err'); setCampErr('Sending paused — your recent bounce or complaint rate is too high. Clean your list, then try again.'); return; }
        const moved = (r.sent || 0) + (r.failed || 0);
        setCampProg((p) => ({ total: p.total, sent: p.sent + (r.sent || 0), failed: p.failed + (r.failed || 0) }));
        if (r.warmup) { setCampState('warmup'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
        if (r.retry) { setCampState('retry'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
        done = r.done;
        if (!done && moved === 0) {
          // No progress: the server-side cron is draining this campaign in
          // parallel. Back off instead of hammering; after a few empty rounds
          // hand it fully to the cron and reassure the user.
          if (++idle >= 4) { setCampState('retry'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
          await new Promise((res) => setTimeout(res, 1500 * idle));
          if (!mountedRef.current || campGenRef.current !== gen) return;
        } else { idle = 0; }
      }
      setCampState('done');
      listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); });
    } catch {
      if (mountedRef.current && campGenRef.current === gen) { setCampState('err'); setCampErr('Something went wrong while sending — reopen the campaign to resume.'); }
    }
  };
  // Resume a campaign the list shows as still `sending` (rather than re-creating
  // it, which would double-send everyone the first pass already reached).
  const resumeCampaign = (c: Campaign) => {
    tap(); campGenRef.current++;
    const gen = campGenRef.current;
    setCampNew(true); setCampView('list'); setCampState('sending'); setCampErr('');
    setCampProg({ sent: c.sent, total: c.total, failed: c.failed });
    drainCampaign(c.id, gen);
  };
  const openCampStats = async (c: Campaign) => {
    tap(); setCampView('stats'); setCampStatsBusy(true); setCampStatsErr(false);
    setCampStats({ campaign: c, stats: { total: c.total, sent: c.sent, failed: c.failed, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 } });
    try {
      const r = await campaignStats(c.id);
      if (!mountedRef.current) return;
      if (r.campaign && r.stats) setCampStats({ campaign: r.campaign, stats: r.stats, ab: r.ab ?? null });
      else setCampStatsErr(true);
    } catch { if (mountedRef.current) setCampStatsErr(true); }
    finally { if (mountedRef.current) setCampStatsBusy(false); }
  };
  const applyTemplate = (t: Template) => { tap(); setCampSubject(t.subject); setCampBody(t.body); setCampBodyKind(t.kind === 'html' ? 'html' : 'text'); if (campState === 'err') setCampState('idle'); };
  const runCampaign = async () => {
    const recipients = parseRecips(campRecips);
    if (!campSubject.trim() || !campBody.trim() || !recipients.length || campState === 'sending') return;
    // Scheduling: validate the picked time is at least a minute out.
    let scheduledIso = '';
    if (campWhen === 'later') {
      const t = Date.parse(campSchedAt);
      if (!campSchedAt || !Number.isFinite(t) || t < Date.now() + 60000) {
        setCampState('err'); setCampErr('Pick a date and time at least a minute from now.'); return;
      }
      scheduledIso = new Date(t).toISOString();
    }
    campGenRef.current++;
    const gen = campGenRef.current;
    tap(); setCampState('sending'); setCampErr(''); setCampProg({ sent: 0, total: recipients.length, failed: 0 });
    try {
      // Mailbox (campDomain '') or the user's own verified self-hosted domain (send_via 'self').
      const sendCfg = campDomain
        ? { send_via: 'self' as const, from_email: `${(campFromLocal.trim() || 'news')}@${campDomain}`, from_name: campFromName.trim() || undefined }
        : {};
      const c = await createCampaign({
        app: campApp,
        subject: campSubject.trim(),
        body: campBodyKind === 'html' ? campBody : campToHtml(campBody.trim()),
        recipients,
        ...sendCfg,
        ...(scheduledIso ? { scheduled_at: scheduledIso } : {}),
        ...(campAb && campSubjectB.trim() ? { subject_b: campSubjectB.trim() } : {}),
        ...(campAb && campBodyKind === 'text' && campBodyB.trim() ? { body_b: campToHtml(campBodyB.trim()) } : {}),
      });
      if (!mountedRef.current || campGenRef.current !== gen) return;
      if (c.scheduled) { setCampState('scheduled'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
      // We asked to SCHEDULE but the server didn't schedule it (time too soon /
      // clock skew) — DO NOT fall through to an immediate blast. Surface it.
      if (scheduledIso && !c.scheduled) {
        setCampState('err'); setCampErr('Couldn’t schedule for that time — pick a time a few minutes further out. Nothing was sent.');
        if (c.id) unscheduleCampaign(c.id).catch(() => {}); // clean up the stray draft
        return;
      }
      if (c.error || !c.id) {
        setCampState('err');
        setCampErr(
          c.error === 'no_recipients' ? `No one to send to${c.invalid ? ` — ${c.invalid} invalid` : ''}${c.skipped ? `, ${c.skipped} unsubscribed` : ''}.`
            : c.error === 'missing_content' ? 'Add a subject and a message.'
              : c.error === 'domain_not_verified' ? 'That domain isn’t verified yet — check its DNS records under Domains.'
                : c.error === 'bad_from' ? 'Enter a valid From address.'
                : c.error === 'mail_server_unset' ? 'Your mail server isn’t connected yet — finish setup, then try again.'
                : c.error === 'reputation_paused' ? 'Sending is paused — your recent bounce or complaint rate is too high. Clean your list, then try again.'
                    : 'Couldn’t create the campaign — try again.');
        return;
      }
      setCampProg({ sent: 0, total: c.queued ?? recipients.length, failed: 0 });
      await drainCampaign(c.id, gen);
    } catch {
      if (mountedRef.current && campGenRef.current === gen) { setCampState('err'); setCampErr('Something went wrong while sending — check your connection and try again.'); }
    }
  };

  // Copy a value to the clipboard with a brief "Copied" flash (webhook secret + DNS records).
  // navigator.clipboard.writeText can reject (permissions policy, focus loss) — await it and
  // fall back to a hidden textarea + execCommand so the flash only shows when the copy landed.
  const copyText = async (s: string) => {
    tap();
    let ok = false;
    try { await navigator.clipboard.writeText(s); ok = true; } catch { /* fall through to legacy path */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (!ok || !mountedRef.current) return;
    setCopied(s);
    setTimeout(() => { if (mountedRef.current) setCopied(''); }, 1500);
  };

  // ---- Custom sending domains (self-hosted, via the `mailer` fn) ----
  // Add the domain (we generate its DKIM + return the records to publish), then
  // Verify re-checks DNS. Once verified it shows up under the composer's "Send from"
  // and can send a test. Private keys never leave the server.
  const loadDomains = () => mailerListDomains()
    .then((d) => { if (mountedRef.current) { setDomains(d); setDomsLoaded(true); setDomsErr(false); } })
    .catch(() => { if (mountedRef.current) { setDomsLoaded(true); setDomsErr(true); } });
  // Silent Domain Connect discovery — populates dcInfo so the UI can show whether
  // the domain's DNS host supports one-click setup (doesn't open anything).
  const runDiscovery = async (domain: string, records: DnsRecord[]) => {
    try { const info = await discoverDomainConnect(domain, records); if (mountedRef.current) setDcInfo((m) => ({ ...m, [domain]: info })); } catch { /* ignore */ }
  };
  const addDomain = async () => {
    if (domBusy) return;
    const d = domNew.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!d) { if (domNew.trim()) setDomErr('Enter a domain like yourbrand.com'); return; }
    tap(); setDomBusy(true); setDomErr('');
    try {
      const r = await mailerAddDomain(d);
      if (!mountedRef.current) return;
      domRemovedRef.current.delete(r.domain);
      setDomRecords((m) => ({ ...m, [r.domain]: r.records }));
      // Fresh page, fresh feedback — same reset openDom does, so a previous
      // domain's verify error can't render on the brand-new one.
      setTestMsg((m) => { const n = { ...m }; delete n[r.domain]; return n; });
      setDomChecks((m) => { const n = { ...m }; delete n[r.domain]; return n; });
      setDomVerErr(null); setDomRecsErr(''); setDomRmArm('');
      setDomNew(''); setDomOpen(r.domain);
      // Show the new domain immediately; the authoritative refresh runs in the
      // background so its failure can't misreport a successful add as an error.
      setDomains((ds) => [{ domain: r.domain, verified: false, created_at: new Date().toISOString() }, ...ds.filter((x) => x.domain !== r.domain)]);
      loadDomains();
      runDiscovery(r.domain, r.records);
    } catch (e) { if (mountedRef.current) setDomErr(e instanceof Error ? e.message : 'Couldn’t add the domain — try again.'); }
    finally { if (mountedRef.current) setDomBusy(false); }
  };
  // Lazy-load a domain's records (and discover Domain Connect) when its row expands.
  const openDom = async (domain: string) => {
    tap();
    setDomOpen(domain); setDomRecOpen(null);
    // Fresh page, fresh feedback: a test-send result or verify message from a
    // previous visit reads as current state and misleads (a long-fixed error
    // kept a user chasing a ghost).
    setTestMsg((m) => (m[domain] ? { ...m, [domain]: '' } : m));
    setDomVerErr(null); setDomRecsErr(''); setDomRmArm('');
    if (domRecords[domain]) { if (!dcInfo[domain]) runDiscovery(domain, domRecords[domain]); return; }
    try {
      const r = await mailerDomainRecords(domain);
      if (!mountedRef.current || domRemovedRef.current.has(domain)) return;
      setDomRecords((m) => ({ ...m, [domain]: r.records }));
      runDiscovery(domain, r.records);
    } catch { if (mountedRef.current && !domRemovedRef.current.has(domain)) setDomRecsErr(domain); }
  };
  const verifyDom = async (domain: string) => {
    if (domVerifying === domain) return;
    tap(); setDomVerifying(domain); setDomVerErr(null);
    try {
      const r = await mailerVerifyDomain(domain);
      // A removed domain's late verify result must not resurrect its caches —
      // a re-add would then show green chips for the old, deleted key.
      if (!mountedRef.current || domRemovedRef.current.has(domain)) return;
      setDomChecks((m) => ({ ...m, [domain]: r.checks }));
      setDomains((ds) => ds.map((d) => d.domain === domain ? { ...d, verified: r.verified } : d));
      if (!r.verified) {
        const msg = r.lookup_failed
          ? 'Couldn’t reach DNS to check just now — try again in a moment.'
          : r.checks.spf_multiple
            ? 'There’s more than one SPF (v=spf1) record on the domain — that breaks SPF entirely. Merge them into a single record.'
            : `Not verified yet — ${!r.checks.dkim && !r.checks.spf ? 'DKIM and SPF records aren’t' : !r.checks.dkim ? 'the DKIM record isn’t' : 'the SPF record isn’t'} visible in DNS. Records can take a few minutes to propagate; try again shortly.`;
        setDomVerErr({ domain, msg });
      }
      loadDomains();
    } catch (e) { if (mountedRef.current) setDomVerErr({ domain, msg: e instanceof Error ? e.message : 'Couldn’t check DNS — try again.' }); }
    finally { if (mountedRef.current) setDomVerifying((v) => (v === domain ? '' : v)); }
  };
  const removeDom = async (domain: string) => {
    try {
      await mailerRemoveDomain(domain);
      if (!mountedRef.current) return;
      domRemovedRef.current.add(domain);
      if (campDomain === domain) setCampDomain('');
      if (autoDomain === domain) setAutoDomain('');
      setDomOpen((cur) => (cur === domain ? null : cur));
      // Drop everything cached for it — a re-add generates a NEW DKIM key, so
      // stale checks/records would show green chips for a key that's gone.
      const drop = <T,>(m: Record<string, T>) => { const n = { ...m }; delete n[domain]; return n; };
      setDomChecks(drop); setTestMsg(drop); setDcInfo(drop); setDomRecords(drop);
      loadDomains();
    } catch (e) { if (mountedRef.current) setDomVerErr({ domain, msg: e instanceof Error ? e.message : 'Couldn’t remove the domain — try again.' }); }
  };
  // Remove is destructive (deletes the DKIM signing key): first tap arms the
  // button, the second within a few seconds actually removes.
  const armRemove = (domain: string) => {
    tap();
    if (domRmArm === domain) {
      if (domRmTimerRef.current) { clearTimeout(domRmTimerRef.current); domRmTimerRef.current = null; }
      setDomRmArm('');
      removeDom(domain);
      return;
    }
    setDomRmArm(domain);
    if (domRmTimerRef.current) clearTimeout(domRmTimerRef.current);
    domRmTimerRef.current = window.setTimeout(() => { if (mountedRef.current) setDomRmArm(''); }, 3500);
  };
  // Auto-configure: discover the host and, once our template is live, open the
  // one-click apply URL. Until then it just reports whether one-click is available.
  const autoConfigure = async (domain: string) => {
    const recs = domRecords[domain];
    if (!recs || dcBusy === domain) return;
    tap(); setDcBusy(domain);
    try {
      const info = await discoverDomainConnect(domain, recs);
      if (!mountedRef.current) return;
      setDcInfo((m) => ({ ...m, [domain]: info }));
      if (info.applyUrl) window.open(info.applyUrl, '_blank', 'noopener');
    } catch {
      // A network failure is NOT "your host doesn't support this" — say so.
      if (mountedRef.current) setDcInfo((m) => ({ ...m, [domain]: { supported: false, failed: true } }));
    }
    finally { if (mountedRef.current) setDcBusy((v) => (v === domain ? '' : v)); }
  };
  // Send a quick test from a verified domain to confirm delivery end-to-end.
  const sendTest = async (domain: string) => {
    const to = (testTo[domain] || '').trim();
    if (!to || testBusy === domain) return;
    tap(); setTestBusy(domain); setTestMsg((m) => ({ ...m, [domain]: '' }));
    try {
      const r = await mailerSend({ from: `no-reply@${domain}`, to, subject: `Test from ${domain}`, text: `This is a test email sent from ${domain} via Go Farther.`, html: `<p>This is a test email sent from <b>${domain}</b> via Go Farther.</p>` });
      if (!mountedRef.current) return;
      setTestMsg((m) => ({ ...m, [domain]: `Sent ✓${r.id ? ` (id ${r.id})` : ''} — delivery status lands in Logs` }));
    } catch (e) { if (mountedRef.current) setTestMsg((m) => ({ ...m, [domain]: e instanceof Error ? e.message : 'Couldn’t send — try again.' })); }
    finally { if (mountedRef.current) setTestBusy((v) => (v === domain ? '' : v)); }
  };

  const loadSuppressions = () => listSuppressions().then((s) => { if (mountedRef.current) setSupList(s); });
  // ---- Logs (API request log) — built from transactional sends + campaign sends ----
  const loadRequestLogs = () => {
    setLogsBusy(true);
    Promise.all([mailerMessages().catch(() => []), listCampaigns().catch(() => [])])
      .then(([m, c]) => { if (mountedRef.current) { setMsgList(m); setCampList(c); } })
      .finally(() => { if (mountedRef.current) setLogsBusy(false); });
  };
  // ---- Deliverability (auth + reputation) ----
  const loadDeliver = () => {
    setDelivBusy(true); setDelivErr(false);
    getDeliverability()
      .then((d) => { if (mountedRef.current) { setDeliv(d); setDelivBusy(false); } })
      // Surface the failure instead of leaving stale/empty stats that read as
      // "No sends yet"; keep whatever was already loaded.
      .catch(() => { if (mountedRef.current) { setDelivErr(true); setDelivBusy(false); } });
  };
  // Derive a display status from a recipient row (engagement is in the timestamps).
  // Transactional message status (mailer `messages`) -> pill.
  const msgStatus = (s: string): { label: string; cls: string } => {
    switch (s) {
      case 'delivered': return { label: 'Delivered', cls: 'sent' };
      case 'bounced': return { label: 'Bounced', cls: 'failed' };
      case 'soft_bounced': return { label: 'Soft bounce', cls: 'sending' };
      case 'complained': return { label: 'Complaint', cls: 'failed' };
      case 'failed': return { label: 'Failed', cls: 'failed' };
      default: return { label: 'Sent', cls: 'sending' };
    }
  };
  // Open an email's detail view; fetch the full row (incl. stored body) in the background.
  const openMsg = (m: SentEmail) => {
    tap(); setMsgOpen(m); setMsgDetail(null); setMsgDetailBusy(true); setMsgDetailErr(false);
    const seq = ++msgDetailSeqRef.current;
    mailerMessage(m.id)
      // Guard the open message: a slow fetch for A resolving after the user opened
      // B must not paint A's body/headers onto B, nor clear B's busy state.
      .then((d) => { if (mountedRef.current && msgDetailSeqRef.current === seq && d?.id === m.id) setMsgDetail(d); })
      .catch(() => { if (mountedRef.current && msgDetailSeqRef.current === seq) setMsgDetailErr(true); })
      .finally(() => { if (mountedRef.current && msgDetailSeqRef.current === seq) setMsgDetailBusy(false); });
  };
  const removeSup = async (email: string) => {
    tap();
    try { await removeSuppression(email); await loadSuppressions(); } catch { /* ignore */ }
  };

  // ---- Webhooks ----
  const loadAutomations = () => listAutomations().then((a) => { if (mountedRef.current) setAutoList(a); }).catch(() => { if (mountedRef.current) setNote('Couldn’t load your automations — reopen the tab to retry.'); });
  const openAutoNew = () => {
    tap(); setAutoNew(true); setAutoEditId(null); setAutoErr('');
    setAutoName(''); setAutoTag(''); setAutoDomain(''); setAutoApp(connApps.includes('gmail') ? 'gmail' : 'outlook');
    setAutoFromLocal('news'); setAutoFromName(''); setAutoSteps([{ delay_days: 0, subject: '', body: '' }]);
  };
  const openAutoEdit = (a: Automation) => {
    tap(); setAutoNew(true); setAutoEditId(a.id); setAutoErr('');
    setAutoName(a.name); setAutoTag(a.trigger_tag);
    // Only preselect the from-domain if it's STILL verified — otherwise the
    // <select> would show a value matching no option (blank) while the from
    // fields display a dead domain, and Save would fail confusingly.
    const dom = a.send_via === 'self' && a.from_email ? a.from_email.split('@')[1] : '';
    const domOk = dom && domains.some((d) => d.domain === dom && d.verified);
    setAutoDomain(domOk ? dom : '');
    setAutoApp(a.app === 'outlook' ? 'outlook' : 'gmail');
    setAutoFromLocal(domOk && a.from_email ? a.from_email.split('@')[0] : 'news');
    setAutoFromName(a.from_name || '');
    // Decode stored HTML step bodies back to plain text for the textarea.
    setAutoSteps(a.steps?.length ? a.steps.map((s) => ({ delay_days: s.delay_days, subject: s.subject, body: htmlToPlain(s.body) })) : [{ delay_days: 0, subject: '', body: '' }]);
  };
  const setStep = (i: number, patch: Partial<AutomationStep>) => setAutoSteps((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () => { tap(); setAutoSteps((arr) => [...arr, { delay_days: 3, subject: '', body: '' }]); };
  const removeStep = (i: number) => { tap(); setAutoSteps((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr)); };
  const saveAuto = async () => {
    // A half-filled step (subject but no body, or vice versa) is almost always a
    // mistake — warn instead of silently dropping it on save.
    if (autoSteps.some((s) => (s.subject.trim() && !s.body.trim()) || (!s.subject.trim() && s.body.trim()))) {
      setAutoErr('Every step needs both a subject and a message (or remove the empty one).'); return;
    }
    const steps = autoSteps.map((s) => ({ delay_days: Math.max(0, Math.round(Number(s.delay_days) || 0)), subject: s.subject.trim(), body: campToHtml(s.body.trim()) })).filter((s) => s.subject && s.body);
    if (!autoName.trim() || !autoTag.trim() || !steps.length) { setAutoErr('Add a name, a trigger tag, and at least one step with a subject and message.'); return; }
    setAutoBusy(true); setAutoErr('');
    try {
      const via = autoDomain ? 'self' as const : 'mailbox' as const;
      const r = await saveAutomation({
        ...(autoEditId ? { id: autoEditId } : {}),
        name: autoName.trim(), trigger_tag: autoTag.trim(), send_via: via, app: autoApp,
        ...(via === 'self' ? { from_email: `${(autoFromLocal.trim() || 'news')}@${autoDomain}`, from_name: autoFromName.trim() || undefined } : {}),
        steps,
      });
      if (!mountedRef.current) return;
      if (r.error) { setAutoErr(r.error === 'domain_not_verified' ? 'That domain isn’t verified yet — check Domains.' : r.error === 'bad_tag' ? 'Trigger tag: letters, numbers, spaces, - and _ only.' : r.error === 'no_steps' ? 'Add at least one step with a subject and message.' : r.error === 'bad_from' ? 'Pick a valid From address.' : 'Couldn’t save — try again.'); return; }
      setAutoNew(false); await loadAutomations();
    } catch { if (mountedRef.current) setAutoErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setAutoBusy(false); }
  };
  const toggleAuto = async (a: Automation) => {
    tap();
    try { await toggleAutomation(a.id, !a.enabled); if (mountedRef.current) await loadAutomations(); }
    catch { if (mountedRef.current) { setNote(`Couldn’t ${a.enabled ? 'pause' : 'resume'} that automation — try again.`); await loadAutomations(); } }
  };
  // Delete is destructive (kills an active drip sequence) — arm on first tap.
  const armRemoveAuto = (id: string) => {
    tap();
    if (autoRmArm === id) {
      if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
      setAutoRmArm(''); removeAuto(id); return;
    }
    setAutoRmArm(id); setWhRmArm('');
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = window.setTimeout(() => { if (mountedRef.current) setAutoRmArm(''); }, 3500);
  };
  const removeAuto = async (id: string) => {
    try { await removeAutomation(id); if (mountedRef.current) await loadAutomations(); }
    catch { if (mountedRef.current) setNote('Couldn’t delete that automation — try again.'); }
  };
  const loadWebhooks = () => listWebhooks().then((w) => { if (mountedRef.current) setWebhooks(w); }).catch(() => { if (mountedRef.current) setNote('Couldn’t load your webhook endpoints — reopen the tab to retry.'); });
  const addWh = async () => {
    const url = whNew.trim();
    if (!url || whBusy) return;
    tap(); setWhBusy(true); setWhErr('');
    try {
      // All selected → send [] (= all events); a subset is sent as-is.
      const events = whEvents.length === WH_ALL_EVENTS.length ? [] : whEvents;
      const r = await addWebhook(url, events);
      if (!mountedRef.current) return;
      if (r.error) setWhErr(r.error === 'bad_url' ? 'Enter a valid HTTPS URL (not localhost or a private address).' : 'Couldn’t add the endpoint — try again.');
      else { setWhNew(''); setWhEvents(WH_ALL_EVENTS); setWhAddOpen(false); if (r.endpoint) setWhOpen(r.endpoint.id); await loadWebhooks(); }
    } catch { if (mountedRef.current) setWhErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setWhBusy(false); }
  };
  // Open the "Add endpoint" modal with a clean slate (defaults to all events).
  const openWhAdd = () => { tap(); setWhNew(''); setWhEvents(WH_ALL_EVENTS); setWhErr(''); setWhAddOpen(true); };
  // Load (or refresh) an endpoint's recent delivery log on demand when expanded.
  const loadWhDeliveries = async (id: string) => {
    setWhDelivBusy(id);
    try { const d = await listWebhookDeliveries(id); if (mountedRef.current) setWhDeliv((m) => ({ ...m, [id]: d })); }
    catch { /* ignore */ }
    // Only clear if THIS endpoint's load is still the current one — an overlapping
    // load for another endpoint must not kill its spinner.
    finally { if (mountedRef.current) setWhDelivBusy((v) => (v === id ? null : v)); }
  };
  // Toggle an event in the "add endpoint" form's selection (kept non-empty).
  const toggleNewWhEvent = (id: string) => {
    tap();
    setWhEvents((prev) => (prev.includes(id) ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev) : [...prev, id]));
  };
  // Toggle an event on an EXISTING endpoint and persist (optimistic; empty = all).
  const toggleWhEventFor = async (w: WebhookEndpoint, id: string) => {
    const cur = whEffective(w.events);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length === 0) return; // never leave an endpoint subscribed to nothing
    const stored = next.length === WH_ALL_EVENTS.length ? [] : next;
    tap();
    setWebhooks((ws) => ws.map((x) => (x.id === w.id ? { ...x, events: stored } : x))); // optimistic
    try { await setWebhookEvents(w.id, stored); } catch { /* reload will resync */ }
    if (mountedRef.current) await loadWebhooks();
  };
  // Remove deletes the endpoint AND its signing secret (unrecoverable) — arm first.
  const armRemoveWh = (id: string) => {
    tap();
    if (whRmArm === id) {
      if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
      setWhRmArm(''); removeWh(id); return;
    }
    setWhRmArm(id); setAutoRmArm('');
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = window.setTimeout(() => { if (mountedRef.current) setWhRmArm(''); }, 3500);
  };
  const removeWh = async (id: string) => {
    try { await removeWebhook(id); if (mountedRef.current) { setWhOpen((o) => (o === id ? null : o)); await loadWebhooks(); } }
    catch { if (mountedRef.current) setNote('Couldn’t remove that endpoint — try again.'); }
  };
  const toggleWh = async (w: WebhookEndpoint) => {
    tap();
    try { await toggleWebhook(w.id, !w.enabled); if (mountedRef.current) await loadWebhooks(); }
    catch { if (mountedRef.current) { setNote(`Couldn’t ${w.enabled ? 'pause' : 'resume'} that endpoint — try again.`); await loadWebhooks(); } }
  };
  const sendWhTest = async (id: string) => {
    tap(); setWhTest((m) => ({ ...m, [id]: 'Sending…' }));
    try {
      const r = await testWebhook(id);
      if (!mountedRef.current) return;
      setWhTest((m) => ({ ...m, [id]: r.ok ? `Delivered ✓ (HTTP ${r.status})` : r.status ? `Endpoint returned HTTP ${r.status}` : 'Couldn’t reach the endpoint' }));
      await loadWebhooks();
    } catch { if (mountedRef.current) setWhTest((m) => ({ ...m, [id]: 'Something went wrong — try again.' })); }
  };

  // ---- Templates ----
  // Pick an image from the device and hand back raw base64 + content type.
  const pickImage = (cb: (b64: string, ct: string) => void) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { const s = String(rd.result || ''); cb(s.split(',')[1] || '', f.type || 'image/png'); };
      rd.readAsDataURL(f);
    };
    inp.click();
  };
  // New template -> straight into the AI chat builder.
  const startAI = () => {
    tap(); builderGenRef.current++; tplSessionIdRef.current = undefined; setTplEdit({}); setTplName(''); setTplSubject(''); setTplBody(''); setChatMsgs([]); setChatInput(''); setChatErr(''); setChatHistory([]); setTplVersions([]); setPendingImg(null); setChatBusy(false); setTplImgBusy(false); setCopiedIdx(null); setTypeIdx(null); setChatView('chat');
    const pj = loadJob(); // a generation that was still running when the app last closed
    // Only resume a genuinely NEW-template job here. A stored job for an existing
    // template (or a stale/foreign one) must not be injected into this blank
    // session, where it would generate + auto-persist a template the user walked
    // away from.
    if (pj && pj.editId === 'new') { setChatMsgs([{ role: 'user', content: pj.label }]); resumeJob(pj, 1); }
    else if (pj) clearJob(); // a job belonging to a now-abandoned session — don't let it resurface
  };
  const openTplEdit = (t: Template) => {
    tap(); builderGenRef.current++; tplSessionIdRef.current = t.id;
    setTplEdit({ id: t.id }); setTplName(t.name); setTplSubject(t.subject); setTplBody(t.body);
    setChatMsgs(t.chat && t.chat.length ? t.chat : []); setChatInput(''); setChatErr(''); setChatHistory([]); setPendingImg(null); setChatBusy(false); setTplImgBusy(false); setCopiedIdx(null); setTypeIdx(null); setChatView('chat');
    setTplVersions(t.body ? [{ label: 'Saved version', subject: t.subject, body: t.body, at: Date.parse(t.updated_at || '') || Date.now() }] : []);
    const pj = loadJob();
    if (pj && pj.editId === t.id) { setChatMsgs([...(t.chat || []), { role: 'user', content: pj.label }]); resumeJob(pj, (t.chat?.length || 0) + 1); }
  };
  // One chat turn: send the thread (+ any image) to the AI. It may just reply
  // (conversational) or also return a new email body, which we then apply.
  // Poll a running builder job until it finishes. Resilient to transient network
  // errors and to the app being backgrounded — the timer just resumes on return.
  // Auto-save the built template the moment it's generated, so it lands in the list
  // without an explicit Save. The first build creates the row; we hold its id so later
  // edits update the same template instead of duplicating it.
  const persistTemplate = (body: string, subject: string, chat: ChatMsg[], gen: number) => {
    const b = (body || '').trim();
    if (!b) return;
    // Serialize: a second persist for the same session waits for the first, so it
    // sees the id the first created (via tplSessionIdRef) and PATCHes it instead
    // of POSTing a duplicate row.
    persistChainRef.current = persistChainRef.current.then(async () => {
      if (builderGenRef.current !== gen) return; // session moved on — don't touch a new template
      const subj = (subject || '').trim() || 'Untitled email';
      const name = (tplName || '').trim() || subj;
      try {
        const r = await saveTemplate({ id: tplSessionIdRef.current, name, subject: subj, body: b, kind: 'html', chat: chat.slice(-40) });
        if (builderGenRef.current !== gen) return;
        if (r?.id && !tplSessionIdRef.current) { tplSessionIdRef.current = r.id; if (mountedRef.current) setTplEdit({ id: r.id }); }
        if (mountedRef.current) listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
      } catch { /* non-fatal — explicit Save / save-on-exit still cover it */ }
    });
  };
  const pollJob = async (jobId: string, gen: number): Promise<TemplateJob | null> => {
    const deadline = Date.now() + 240000; // give up after ~4 min
    while (Date.now() < deadline) {
      if (!mountedRef.current || builderGenRef.current !== gen) return null; // editor closed/switched — stop hitting the server
      try {
        const res = await getTemplateJob(jobId);
        const job = res.job;
        if (job && (job.status === 'done' || job.status === 'error')) return job;
        // A missing job (cleaned up / wrong device) will never complete — fail fast
        // instead of polling a ghost for the full 4 minutes.
        if (res.error === 'not_found') return null;
      } catch { /* network blip — keep polling */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
  };
  const applyJobResult = (job: TemplateJob | null, prev: { subject: string; body: string }, label: string, assistantIdx: number) => {
    if (!job) { setChatErr('That took too long — try again.'); return; }
    if (job.status === 'error') { setChatErr(job.error === 'ai_unset' ? 'AI builder isn’t set up on the server yet.' : 'Couldn’t do that — try again.'); return; }
    if (job.body) { // the email was created or changed
      setTplBody(job.body);
      if (job.subject) setTplSubject(job.subject);
      if (!tplName.trim() && job.subject) setTplName(job.subject.slice(0, 60));
      setChatHistory((h) => [...h, prev].slice(-20));
      setTplVersions((v) => [...v, { label: label.slice(0, 80), subject: job.subject || tplSubject, body: job.body as string, at: Date.now() }].slice(-40));
    }
    setTypeIdx(assistantIdx); // reveal this new assistant reply letter-by-letter
    setChatMsgs((m) => [...m, { role: 'assistant', content: job.reply || 'Done.' }]);
  };
  // Resume a job left running when the app was closed/backgrounded (server kept going).
  const resumeJob = (pj: PendingJob, assistantIdx: number) => {
    const myGen = builderGenRef.current; // the session we're resuming into
    setChatErr(''); setChatBusy(true); setChatJobId(pj.jobId);
    (async () => {
      const job = await pollJob(pj.jobId, myGen);
      if (!mountedRef.current) return;
      if (builderGenRef.current !== myGen) { clearJobFor(pj.jobId); return; } // builder switched/closed — drop only this job
      applyJobResult(job, pj.prev, pj.label, assistantIdx);
      setChatBusy(false); setChatJobId(''); clearJobFor(pj.jobId);
      if (job && job.status !== 'error' && job.body) {
        const chat: ChatMsg[] = [{ role: 'user', content: pj.label }, { role: 'assistant', content: job.reply || 'Done.' }];
        persistTemplate(job.body, job.subject || pj.prev.subject, chat, myGen);
      }
    })();
  };
  const runChat = async (next: ChatMsg[], images: string[]) => {
    const myGen = builderGenRef.current; // this builder session; if it changes mid-job we drop the result
    const prev = { subject: tplSubject, body: tplBody }; // snapshot for Undo (only used if the email changes)
    const label = [...next].reverse().find((m) => m.role === 'user')?.content?.trim() || 'Update';
    setChatMsgs(next); setChatBusy(true); setChatErr('');
    // Start the job — the server finishes it in the background, so it survives the app
    // being backgrounded or a dropped connection. One silent retry covers a stale-
    // connection blip right after a previous long request (the case that was erroring).
    let start: { job_id?: string; error?: string };
    try {
      try { start = await chatTemplateStart(next, tplBody, images); }
      catch { start = await chatTemplateStart(next, tplBody, images); }
    } catch { if (mountedRef.current) { setChatErr('Couldn’t start — check your connection and try again.'); setChatBusy(false); } return; }
    if (!mountedRef.current || builderGenRef.current !== myGen) return;
    if (start.error || !start.job_id) { setChatErr(start.error === 'ai_unset' ? 'AI builder isn’t set up on the server yet.' : 'Couldn’t start — try again.'); setChatBusy(false); return; }
    setChatJobId(start.job_id);
    saveJob({ jobId: start.job_id, editId: tplSessionIdRef.current || 'new', prev, label, at: Date.now() });
    const job = await pollJob(start.job_id, myGen);
    if (!mountedRef.current) return; // editor left — leave the persisted job to resume on return
    if (builderGenRef.current !== myGen) { clearJobFor(start.job_id); return; } // switched/closed builder — don't apply to the wrong template
    applyJobResult(job, prev, label, next.length);
    setChatBusy(false); setChatJobId(''); clearJobFor(start.job_id);
    if (job && job.status !== 'error' && job.body) {
      const chat: ChatMsg[] = [...next, { role: 'assistant', content: job.reply || 'Done.' }];
      persistTemplate(job.body, job.subject || tplSubject, chat, myGen);
    }
  };
  const copyMsg = async (i: number, text: string) => {
    if (!text) return;
    if (await copyToClipboard(text)) { tap(); setCopiedIdx(i); setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500); }
  };
  const sendChat = () => {
    const text = chatInput.trim();
    if ((!text && !pendingImg) || chatBusy) return;
    tap(); setChatInput('');
    const img = pendingImg; setPendingImg(null);
    runChat([...chatMsgs, { role: 'user', content: text, ...(img ? { img } : {}) }], img ? [img] : []);
  };
  const undoChat = () => {
    if (!chatHistory.length || chatBusy) return;
    tap();
    const last = chatHistory[chatHistory.length - 1];
    setTplSubject(last.subject); setTplBody(last.body);
    setChatMsgs((m) => m.slice(0, Math.max(0, m.length - 2)));
    setChatHistory((h) => h.slice(0, -1));
  };
  // Attaching an image uploads it and parks it as a thumbnail in the composer;
  // it's sent (with whatever you type) on the next message — it doesn't auto-submit.
  const attachImage = () => pickImage(async (b64, ct) => {
    if (!b64 || chatBusy) return;
    tap(); setTplImgBusy(true); setChatErr('');
    try {
      const url = await uploadEmailImage(b64, ct);
      if (!mountedRef.current) return;
      setPendingImg(url);
    } catch { if (mountedRef.current) setChatErr('Upload failed — try a smaller image.'); }
    finally { if (mountedRef.current) setTplImgBusy(false); }
  });
  const saveTpl = async () => {
    if (tplSaving) return;
    const body = tplBody.trim();
    if (!body) return; // nothing built yet
    builderGenRef.current++; // closing this session — drop any in-flight job so it can't re-apply or re-persist a duplicate
    const subject = tplSubject.trim() || tplName.trim() || 'Untitled email'; // never block saving on a missing subject
    const name = tplName.trim() || subject;
    tap(); setTplSaving(true); setChatErr('');
    try {
      await saveTemplate({ id: tplEdit?.id, name, subject, body, kind: 'html', chat: chatMsgs });
      if (!mountedRef.current) return;
      clearDraft();
      setTplEdit(null);
      listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    } catch { if (mountedRef.current) setChatErr('Couldn’t save — try again.'); }
    finally { if (mountedRef.current) setTplSaving(false); }
  };
  const delTpl = async () => {
    builderGenRef.current++;
    if (!tplEdit?.id) { clearDraft(); setTplEdit(null); return; }
    tap();
    await deleteTemplate(tplEdit.id).catch(() => {});
    if (!mountedRef.current) return;
    clearDraft();
    setTplEdit(null);
    listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
  };
  // Roll the email back to an earlier build/edit from the history panel.
  const restoreVersion = (v: { subject: string; body: string }) => {
    tap();
    setChatHistory((h) => [...h, { subject: tplSubject, body: tplBody }].slice(-20));
    setTplSubject(v.subject); setTplBody(v.body);
    setChatView('preview');
  };

  // Desktop: the inbox is a two-pane client (list + reading pane), so an open
  // email is NOT a sub-view there — the header, corner buttons and list all
  // stay put while the mail renders beside them.
  const splitMail = wide && !!commsApp && commsApp !== 'telegram' && emailTab === 'inbox';
  const inMailInbox = !!commsApp && commsApp !== 'telegram' && emailTab === 'inbox' && (!reading || splitMail);
  const inTgList = commsApp === 'telegram' && !tgChat;
  // In a sub-view (reading/compose/thread/builder) the header shows a Back arrow;
  // at a top-level destination it shows the hamburger that opens the tool drawer.
  const deepView = (!!reading && !splitMail) || !!tgChat
    || (!!commsApp && commsApp !== 'telegram' && emailTab === 'compose')
    || (sendraTab === 'campaigns' && campNew)
    || (sendraTab === 'templates' && !!tplEdit);
  const refreshSpin = refreshing || (inTgList && tgListState === 'loading');
  const doRefresh = () => { tap(); if (inMailInbox) { if (combinedInbox) loadMerged(); else refreshInbox(); } else if (inTgList) loadTgChats(); };
  const goPage = (idx: number) => { if (refreshing) return; tap(); loadPage(idx); };
  const hasPager = pageIdx > 0 || !!nextTok;
  const mergedMore = combinedInbox && Object.values(mergedTok).some(Boolean);
  // Merged inbox watermark: only show mail newer than the oldest fetched item of any
  // mailbox that still has more pages — so a sparse mailbox's old mail stays hidden
  // until "Load older" pages the timeline down to it (no out-of-order, no overflow).
  const visibleInbox = (() => {
    if (!combinedInbox) return inbox;
    const active = combinedApps().filter((a) => mergedTok[a]);
    if (!active.length) return inbox;
    const wm = Math.min(...active.map((a) => frontier[a] ?? -Infinity));
    return wm === -Infinity ? inbox : inbox.filter((it) => (it.ts ?? 0) >= wm);
  })();
  // Search filters the loaded mail by sender/subject/snippet. With a query active
  // we scan the whole loaded set (not just the watermarked window) so a match in
  // older mail isn't hidden; clearing it returns to the normal merged view.
  const inboxQuery = inboxQ.trim().toLowerCase();
  // Instant feedback over already-loaded mail while the server search runs; once
  // server hits arrive (searchResults) we show those — a real mailbox-wide
  // search, not just a filter over the page the client already had.
  const clientFiltered = inboxQuery
    ? inbox.filter((it) => `${it.from} ${it.email ?? ''} ${it.subject} ${it.snippet ?? ''}`.toLowerCase().includes(inboxQuery))
    : visibleInbox;
  const shownInbox = inboxQuery ? (searchResults ?? clientFiltered) : visibleInbox;

  const connectCard = (extra: string) => (
    <div className="ag-connect">
      <span className="ag-connect-ic"><IconConnectors size={20} /></span>
      <div className="ag-connect-text">
        <div className="ag-connect-title">Connect a communication app</div>
        <div className="ag-connect-sub">{extra}</div>
      </div>
    </div>
  );

  // ---- header titles ----
  const title = reading && !splitMail ? 'Email'
    : commsApp === null ? SENDRA_META[sendraTab].t
    : commsApp === 'telegram' ? (tgChat ? tgChat.title : 'Telegram')
    : emailTab === 'inbox' ? 'Inbox'
    : emailTab === 'contacts' ? 'Contacts'
    : emailTab === 'compose' ? (replyThreadId ? 'Reply' : forwarding ? 'Forward' : 'New email')
    : (commsApp === 'm365' ? 'Outlook' : 'Gmail');
  const subtitle = reading && !splitMail ? (reading.from || reading.email || 'Message')
    : commsApp === null ? SENDRA_META[sendraTab].s
    : commsApp === 'telegram' ? (tgChat ? (tgChat.username ? `@${tgChat.username}` : 'Chat') : `${tgList.length || ''} chats`.trim() || 'Your chats')
    : emailTab === 'inbox' ? 'Newest first'
    : emailTab === 'contacts' ? (mergedContacts.length ? `${mergedContacts.length} people` : 'Your address book')
    : emailTab === 'compose' ? 'Compose'
    : (mailConnected ? 'Ready' : 'Connect to begin');

  const sortedMsgs = [...tgMsgs].sort((a, b) => (a.date || 0) - (b.date || 0));

  // The AI template builder gets a Sendra-orange ambient instead of the default amber glow.
  const builderMode = !reading && agent !== null && commsApp === null && sendraTab === 'templates' && !!tplEdit;

  // The open email — the mobile full-screen reader and the desktop reading
  // pane render the same thing.
  const readerPane = reading ? (
    <div className="ag-stage ag-reader">
      {/* Desktop: quiet reply/forward chips above the mail. */}
      {splitMail && mailConnected && (
        <div className="ag-reader-topbar">
          {(reading.threadId || reading.email) && (
            <button className="ag-chip-btn" onClick={openReply}>Reply</button>
          )}
          <button className="ag-chip-btn" onClick={openForward}>Forward</button>
        </div>
      )}
      <EmailDetail
        msg={{
          id: reading.id, app: reading.app, from: reading.from, email: reading.email,
          subject: reading.subject, time: reading.time, unread: reading.unread,
          draft: reading.draft, body: reading.snippet || '',
        }}
        onMeta={(m) => {
          const t = (m.to || '').match(/<([^>]+)>/)?.[1] ?? (m.to || '');
          if (t.trim()) setReadingTo(t.trim());
        }}
      />
      {/* Mobile only — the desktop reading pane carries no bottom buttons. */}
      {mailConnected && !splitMail ? (
        <div className="ag-reader-actions" style={{ display: 'flex', gap: 10 }}>
          {(reading.threadId || reading.email) && (
            <button className="ag-send-btn ag-reply-btn" style={{ flex: 1 }} onClick={openReply}>Reply</button>
          )}
          <button className="ag-send-btn ghost" style={{ flex: 1 }} onClick={openForward}>Forward</button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={`memg ag${builderMode ? ' ag-builder' : ''}`} ref={trapRef} tabIndex={-1}>
      {/* Content column. On desktop the drawer below becomes a persistent
          sidebar and this is the main area beside it; on mobile it's the whole
          screen and the drawer is an overlay. */}
      <div className="ag-main">
      <div className="memg-top">
        {deepView ? (
          <button className="memg-back" onClick={back} aria-label="Back"><IconArrowLeft size={22} /></button>
        ) : (
          <button className="memg-back ag-burger" onClick={() => { tap(); setDrawerOpen(true); }} aria-label="Open menu">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        )}
        <div className="memg-titles">
          <h1 className="memg-title">{title}</h1>
          <p className="memg-sub">{subtitle}</p>
        </div>
        {inMailInbox ? (
          <button className="ag-corner" onClick={openCompose} aria-label="New email">
            <IconCompose size={18} />
          </button>
        ) : inTgList ? (
          <button
            className={`ag-corner${refreshSpin ? ' spinning' : ''}`}
            onClick={doRefresh}
            disabled={refreshSpin}
            aria-label="Refresh"
          >
            <IconRefresh size={18} />
          </button>
        ) : <span style={{ width: 40 }} />}
      </div>

      {reading && !splitMail ? (
        readerPane
      ) : commsApp === null ? (
          // ---- Tabs: Emails / Campaigns / Templates / Logs / Deliverability / Domains / Webhooks / Automations / Schedule ----
          <div className="ag-stage">
            {note && <div className="ag-note">{note}</div>}
            {sendraTab === 'campaigns' ? (
              campNew ? (
                campState === 'done' || campState === 'scheduled' || campState === 'warmup' || campState === 'retry' ? (
                  <div className="ag-sent">
                    <span className="ag-sent-ic"><IconCheck size={26} /></span>
                    <div className="ag-sent-title">{campState === 'scheduled' ? 'Campaign scheduled' : campState === 'warmup' ? 'Warming up' : campState === 'retry' ? 'Sending paused' : 'Campaign sent'}</div>
                    <div className="ag-sent-sub">{campState === 'scheduled'
                      ? `Sends ${campSchedAt ? new Date(campSchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'at the scheduled time'}.`
                      : campState === 'warmup'
                      ? `${campProg.sent} of ${campProg.total} sent. Your sending domain is new, so we ramp volume up gradually to protect deliverability — the rest will keep sending automatically over the next day or two.`
                      : campState === 'retry'
                      ? `${campProg.sent} of ${campProg.total} sent. The mail server is briefly unavailable — the rest will keep sending automatically as soon as it's back.`
                      : `${campProg.sent} sent${campProg.failed ? `, ${campProg.failed} failed` : ''}.`}</div>
                    <div className="ag-sent-actions">
                      <button className="ag-send-btn ghost" onClick={openCampNew}>New campaign</button>
                      <button className="ag-send-btn" onClick={() => { tap(); setCampNew(false); setCampState('idle'); if (campState === 'scheduled') setSendraTab('schedule'); }}>Done</button>
                    </div>
                  </div>
                ) : (
                  <div className="ag-compose">
                    {tplList.length > 0 && (
                      <div className="ag-tpl-row">
                        <span className="ag-tpl-lbl">Start from:</span>
                        {tplList.slice(0, 8).map((t) => (
                          <button key={t.id} className="ag-tpl-chip" onClick={() => applyTemplate(t)}>{t.name || t.subject}</button>
                        ))}
                      </div>
                    )}
                    <div className="ag-from">
                      <span className="ag-from-lbl">Send from</span>
                      <select className="ag-field ag-from-sel" value={campDomain} onChange={(e) => { tap(); setCampDomain(e.target.value); if (campState === 'err') setCampState('idle'); }}>
                        <option value="">My mailbox</option>
                        {domains.filter((d) => d.verified).map((d) => (
                          <option key={d.domain} value={d.domain}>{d.domain}</option>
                        ))}
                      </select>
                    </div>
                    {!campDomain && mailApiApps.length >= 2 && (
                      <div className="ag-seg">
                        <button className={campApp === 'gmail' ? 'on' : ''} onClick={() => { tap(); setCampApp('gmail'); }}>Gmail</button>
                        <button className={campApp === 'outlook' ? 'on' : ''} onClick={() => { tap(); setCampApp('outlook'); }}>Outlook</button>
                      </div>
                    )}
                    {campDomain && (
                      <div className="ag-from-fields">
                        <input className="ag-field" placeholder="From name (e.g. Acme News)" value={campFromName} onChange={(e) => setCampFromName(e.target.value)} />
                        <div className="ag-from-addr">
                          <input className="ag-field" placeholder="news" autoCapitalize="none" autoCorrect="off" value={campFromLocal} onChange={(e) => setCampFromLocal(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))} />
                          <span className="ag-from-at">@{campDomain}</span>
                        </div>
                        <p className="ag-foot ag-dom-hint">Sends from this address via your verified domain. Manage domains under Domains.</p>
                      </div>
                    )}
                    <input className="ag-field" placeholder="Subject" value={campSubject}
                      onChange={(e) => { setCampSubject(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                    {campBodyKind === 'html' ? (
                      <div className="ag-tpl-preview">
                        <div className="ag-tpl-preview-bar"><span>Designed template</span><button onClick={() => { tap(); setCampBody(''); setCampBodyKind('text'); }}>✕ Write plain text</button></div>
                        <iframe className="ag-tpl-frame" title="Template preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={buildSrcDoc(campBody)} />
                      </div>
                    ) : (
                      <textarea className="ag-field ag-body" placeholder="Write your message… use {{name}} to personalize each email" value={campBody}
                        onChange={(e) => { setCampBody(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#a6a6ae', margin: '2px 0' }}>
                      <input type="checkbox" checked={campAb} onChange={(e) => { tap(); setCampAb(e.target.checked); if (campState === 'err') setCampState('idle'); }} />
                      A/B test — try two versions, see which wins
                    </label>
                    {campAb && (
                      <div style={{ borderLeft: '2px solid #F8514E', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Variant B</div>
                        <input className="ag-field" placeholder="Variant B subject (blank = same as A)" value={campSubjectB}
                          onChange={(e) => { setCampSubjectB(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                        {campBodyKind === 'text' ? (
                          <textarea className="ag-field ag-body" placeholder="Variant B message (blank = same as A) — {{name}} works too" value={campBodyB}
                            onChange={(e) => { setCampBodyB(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                        ) : (
                          <p className="ag-foot">Using a designed template — A/B applies to the subject line.</p>
                        )}
                        <p className="ag-foot">Half your list gets A, half gets B. Compare opens &amp; clicks in the campaign's stats.</p>
                      </div>
                    )}
                    <textarea className="ag-field ag-camp-recips" placeholder={'Recipients — one per line:\njane@example.com\nJohn Smith <john@example.com>'} value={campRecips}
                      onChange={(e) => { setCampRecips(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                    <div className="ag-seg ag-when">
                      <button className={campWhen === 'now' ? 'on' : ''} onClick={() => { tap(); setCampWhen('now'); if (campState === 'err') setCampState('idle'); }}>Send now</button>
                      <button className={campWhen === 'later' ? 'on' : ''} onClick={() => { tap(); setCampWhen('later'); if (campState === 'err') setCampState('idle'); }}>Schedule</button>
                    </div>
                    {campWhen === 'later' && (
                      <input className="ag-field" type="datetime-local" value={campSchedAt} onChange={(e) => { setCampSchedAt(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                    )}
                    {campState === 'err' && <div className="ag-send-err">{campErr}</div>}
                    <button className="ag-send-btn" disabled={campState === 'sending' || !campSubject.trim() || !campBody.trim() || !campRecips.trim() || (campWhen === 'later' && !campSchedAt)} onClick={runCampaign}>
                      {campState === 'sending' ? (campWhen === 'later' ? 'Scheduling…' : `Sending… ${campProg.sent}/${campProg.total}`) : campWhen === 'later' ? 'Schedule campaign' : 'Send campaign'}
                    </button>
                    <button className="ag-send-btn ghost" disabled={campState === 'sending'} onClick={() => { tap(); setCampNew(false); }}>Cancel</button>
                    <p className="ag-foot">{campDomain ? `Sends from ${(campFromLocal.trim() || 'news')}@${campDomain} (your verified domain)` : `Sends from your ${campApp === 'outlook' ? 'Outlook' : 'Gmail'}`}, about one per second, each with a one-tap unsubscribe. Unsubscribed addresses are skipped automatically.</p>
                  </div>
                )
              ) : campView === 'suppressions' ? (
                <div className="ag-compose">
                  <div className="ag-dom-head">
                    <button className="ag-back-link" onClick={() => { tap(); setCampView('list'); }}>‹ Campaigns</button>
                    <span className="ag-dom-title">Suppressed contacts</span>
                  </div>
                  <p className="ag-foot ag-dom-hint">People who unsubscribed, bounced, or complained. They're skipped automatically on every campaign — remove someone to allow sending to them again.</p>
                  {supList.length === 0 ? (
                    <div className="ag-empty" style={{ marginTop: 12 }}>No suppressed contacts yet.</div>
                  ) : (
                    <div className="ag-sup-list">
                      {supList.map((s) => (
                        <div className="ag-sup" key={s.email}>
                          <span className="ag-sup-email">{s.email}</span>
                          <span className={`ag-badge${s.reason === 'complaint' ? ' is-bad' : s.reason === 'bounce' ? ' is-wait' : ''}`}><i className="ag-dot" />{s.reason}</span>
                          <button className="ag-sup-x" onClick={() => removeSup(s.email)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : campView === 'stats' && campStats ? (
                <div className="ag-compose">
                  <div className="ag-dom-head">
                    <button className="ag-back-link" onClick={() => { tap(); setCampView('list'); }}>‹ Campaigns</button>
                    <span className="ag-dom-title">Campaign stats</span>
                  </div>
                  <div className="ag-camp-stat-head">
                    <div className="ag-camp-name">{campStats.campaign.name || campStats.campaign.subject || 'Campaign'}</div>
                    <div className="ag-camp-sub">{campStats.campaign.subject}</div>
                  </div>
                  {(() => {
                    const s = campStats.stats;
                    const base = s.sent || 1;
                    const pct = (n: number) => `${Math.round((n / base) * 100)}%`;
                    const cards = [
                      { k: 'Sent', v: s.sent, sub: `of ${s.total}` },
                      { k: 'Opened', v: s.opened, sub: pct(s.opened) },
                      { k: 'Clicked', v: s.clicked, sub: pct(s.clicked) },
                      { k: 'Delivered', v: s.delivered, sub: s.delivered ? pct(s.delivered) : '—' },
                      { k: 'Bounced', v: s.bounced, sub: s.bounced ? pct(s.bounced) : '—' },
                      { k: 'Complaints', v: s.complained, sub: s.complained ? pct(s.complained) : '—' },
                    ];
                    return (
                      <div className="ag-stat-grid">
                        {cards.map((c) => (
                          <div className="ag-stat-card" key={c.k}>
                            <div className="ag-stat-v">{c.v}</div>
                            <div className="ag-stat-k">{c.k}</div>
                            <div className="ag-stat-sub">{c.sub}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {campStats.ab && (() => {
                    const { a, b } = campStats.ab!;
                    const rate = (n: number, base: number) => base ? Math.round((n / base) * 100) : 0;
                    const aOpen = rate(a.opened, a.sent), bOpen = rate(b.opened, b.sent);
                    const aClick = rate(a.clicked, a.sent), bClick = rate(b.clicked, b.sent);
                    const winner = (bOpen > aOpen || (bOpen === aOpen && bClick > aClick)) ? 'B' : 'A';
                    const col = (label: string, v: { sent: number; opened: number; clicked: number }, open: number, click: number, win: boolean) => (
                      <div style={{ flex: 1, border: `1px solid ${win ? '#F8514E' : '#26262b'}`, borderRadius: 12, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>Variant {label}</span>
                          {win && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#FF9A4D,#F8514E)', borderRadius: 6, padding: '2px 6px' }}>WINNER</span>}
                        </div>
                        <div style={{ fontSize: 13, color: '#a6a6ae', lineHeight: 1.6 }}>
                          <div>{v.sent} sent</div>
                          <div>{open}% opened <span style={{ color: '#6b6b73' }}>({v.opened})</span></div>
                          <div>{click}% clicked <span style={{ color: '#6b6b73' }}>({v.clicked})</span></div>
                        </div>
                      </div>
                    );
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', margin: '4px 0 8px' }}>A/B results</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          {col('A', a, aOpen, aClick, winner === 'A')}
                          {col('B', b, bOpen, bClick, winner === 'B')}
                        </div>
                        <p className="ag-foot">Winner = higher open rate (ties broken by clicks). On small lists treat it as a hint, not gospel.</p>
                      </div>
                    );
                  })()}
                  {campStatsErr && <div className="ag-send-err">Couldn’t refresh these stats — the numbers above may be out of date.</div>}
                  <button className="ag-send-btn ghost" disabled={campStatsBusy} onClick={() => openCampStats(campStats.campaign)}>{campStatsBusy ? 'Refreshing…' : 'Refresh'}</button>
                  <p className="ag-foot">Opens are approximate — some mail apps (Apple Mail, Gmail's image proxy) pre-load or block the tracking pixel, so treat opens as a trend. Clicks are exact. Delivered/bounced fill in for sends through Sendra’s built-in email or a verified domain.</p>
                </div>
              ) : (
                <>
                  {campList.length === 0 ? (
                    <div className="ag-dom-empty ag-camp-empty">
                      <div className="ag-dom-empty-ic"><IconWaveform size={30} /></div>
                      <div className="ag-dom-empty-ttl">No campaigns yet</div>
                      <p className="ag-ce-sub">Write once and send to your whole list — straight from your mailbox.</p>
                      <button className="ag-send-btn" onClick={openCampNew}><IconPlus size={16} /> New email campaign</button>
                      <button className="ag-back-link" onClick={() => { tap(); setCampView('suppressions'); loadSuppressions(); }}>Suppressed contacts{supList.length ? ` · ${supList.length}` : ''}</button>
                    </div>
                  ) : (
                    <>
                    <button className="ag-send-btn" onClick={openCampNew}>+ New email campaign</button>
                    <button className="ag-send-btn ghost ag-dom-link" onClick={() => { tap(); setCampView('suppressions'); loadSuppressions(); }}>Suppressed contacts{supList.length ? ` · ${supList.length}` : ''}</button>
                    <div className="ag-camp-list">
                      {campList.map((c) => {
                        // A campaign left mid-send (tab closed, error) can be resumed
                        // instead of re-created — re-creating would double-send.
                        const resumable = (c.status === 'sending' || c.status === 'paused' || c.status === 'draft') && c.sent < c.total;
                        return (
                        <div className="ag-camp" key={c.id} onClick={() => openCampStats(c)} role="button" tabIndex={0}>
                          <div className="ag-camp-main">
                            <div className="ag-camp-name">{c.name || c.subject || 'Campaign'}</div>
                            <div className="ag-camp-sub">{c.subject}</div>
                          </div>
                          <div className="ag-camp-meta">
                            <span className={`ag-camp-pill is-${c.status}`}>{c.status}</span>
                            <span className="ag-camp-count">{c.sent}/{c.total}</span>
                            {resumable && <button className="ag-camp-resume" onClick={(e) => { e.stopPropagation(); resumeCampaign(c); }}>Resume</button>}
                          </div>
                          <span className="ag-camp-chev">›</span>
                        </div>
                        );
                      })}
                    </div>
                    </>
                  )}
                </>
              )
            ) : sendraTab === 'templates' ? (
              tplEdit ? (
                chatView === 'preview' ? (
                  <div className="ag-tpl-view">
                    {tplVersions.length > 0 && (
                      <div className="ag-prev-top">
                        <button className="ag-prev-hist" onClick={() => { tap(); setChatView('history'); }} aria-label="Version history"><IconClock size={19} /></button>
                      </div>
                    )}
                    <div className="ag-mail">
                      <textarea className="ag-mail-subject" placeholder="Email subject" rows={1} value={tplSubject}
                        ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 96)}px`; } }}
                        onChange={(e) => setTplSubject(e.target.value)} />
                      <div className="ag-mail-from">
                        <span className="ag-mail-av" aria-hidden="true">{(tplSubject.trim()[0] || 'S').toUpperCase()}</span>
                        <div className="ag-mail-meta">
                          <span className="ag-mail-name">Your business <em>&lt;hello@yourdomain.com&gt;</em></span>
                          <span className="ag-mail-to">to there ▾</span>
                        </div>
                        <span className="ag-mail-time">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <iframe className="ag-tpl-frame" title="Email preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={buildSrcDoc(fillMergeTags(tplBody) || '<div style="padding:40px;text-align:center;color:#888;font-family:sans-serif">Nothing yet — chat to build it.</div>')} />
                    </div>
                    {chatErr && <div className="ag-send-err">{chatErr}</div>}
                    {tplEdit.id && <button className="ag-tpl-del" disabled={tplSaving} onClick={delTpl}>Delete template</button>}
                  </div>
                ) : chatView === 'history' ? (
                  <div className="ag-histwrap">
                    {tplVersions.length === 0 ? (
                      <div className="ag-empty" style={{ margin: '16px 4px' }}>No versions yet. Each time Sendra builds or edits this email, it’s saved here so you can roll back.</div>
                    ) : (
                      [...tplVersions].reverse().map((v, i) => (
                        <button className={`ag-histcard${i === 0 ? ' is-current' : ''}`} key={`${v.at}-${i}`} onClick={() => restoreVersion(v)}>
                          <span className="ag-histcard-accent" aria-hidden="true" />
                          <span className="ag-histcard-body">
                            <span className="ag-histcard-top">
                              <span className="ag-histcard-name">{v.label}</span>
                              {i === 0 ? <span className="ag-histcard-badge">Current</span> : <span className="ag-histcard-restore">Restore</span>}
                            </span>
                            <span className="ag-histcard-time">Saved {relTime(v.at)}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="ag-chatb">
                    {chatHistory.length > 0 && (
                      <div className="ag-chatb-tools"><button className="ag-chatb-undo" onClick={undoChat} disabled={chatBusy}>↩ Undo last change</button></div>
                    )}
                    <div className="ag-chatb-thread" ref={chatThreadRef}>
                      {chatMsgs.map((m, i) => (
                        m.role === 'user' ? (
                          <div key={i} className="ag-cb-u">
                            {m.img && <img className="ag-cb-img" src={m.img} alt="attachment" />}
                            {m.content && <span>{m.content}</span>}
                          </div>
                        ) : (
                          <div key={i} className="ag-cb-row">
                            <div className="ag-cb-a">{m.content ? <Typewriter text={m.content} on={i === typeIdx && !REDUCED_MOTION} /> : null}</div>
                            {m.content && (
                              <div className="msg-actions">
                                <button className="msg-act" aria-label="Copy message" onClick={() => copyMsg(i, m.content)}>
                                  {copiedIdx === i ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                  <span className="msg-act-label">{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      ))}
                      {chatBusy && <BuilderStatus withImage={!!chatMsgs[chatMsgs.length - 1]?.img} />}
                      {chatErr && <div className="ag-cb-err">{chatErr}</div>}
                    </div>
                    {tplBody.trim() && <button className="ag-chatb-peek" onClick={() => { tap(); setChatView('preview'); }} aria-label="View email preview"><span className="ar">→</span><span className="tx">VIEW</span></button>}
                    <div className="ag-chatb-dock">
                      {pendingImg && (
                        <div className="ag-chatb-atts">
                          <span className="ag-att-chip">
                            <img src={pendingImg} alt="attachment" />
                            <button className="ag-att-x" onClick={() => { tap(); setPendingImg(null); }} aria-label="Remove image"><IconX size={12} /></button>
                          </span>
                        </div>
                      )}
                      <div className="ag-chatb-bar">
                      <button className="ag-chatb-attach" disabled={tplImgBusy || chatBusy} onClick={attachImage} aria-label="Attach an image">{tplImgBusy ? '…' : <IconPlus size={20} />}</button>
                      <textarea className="ag-chatb-input" placeholder="Message Sendra" rows={1} value={chatInput}
                        ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; } }}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if ((chatInput.trim() || pendingImg) && !chatBusy) sendChat(); } }} />
                      <button className="ag-chatb-send" disabled={(!chatInput.trim() && !pendingImg) || chatBusy} onClick={sendChat} aria-label="Send"><IconArrowUp size={20} /></button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {tplList.length === 0 ? (
                    <div className="ag-dom-empty ag-tpl-empty">
                      <div className="ag-dom-empty-ic"><IconDoc size={30} /></div>
                      <div className="ag-dom-empty-ttl">No templates yet</div>
                      <p className="ag-ce-sub">Describe the email you want and let Sendra write it — then reuse it in any campaign.</p>
                      <button className="ag-send-btn" onClick={startAI}><IconPlus size={16} /> New template</button>
                    </div>
                  ) : (
                    <>
                    <button className="ag-send-btn" onClick={startAI}>+ New template</button>
                    <div className="ag-camp-list">
                      {tplList.map((t) => {
                        const nm = t.name || t.subject || 'Template';
                        const snip = tplSnippet(t.body) || t.subject || '';
                        return (
                          <button className="ag-camp" key={t.id} onClick={() => openTplEdit(t)}>
                            <span className="ag-tpl-ini" aria-hidden="true">{(nm.trim()[0] || 'T').toUpperCase()}</span>
                            <div className="ag-camp-main">
                              <div className="ag-camp-name">{nm}</div>
                              {snip && <div className="ag-camp-sub">{snip}</div>}
                            </div>
                            <span className="ag-chev" aria-hidden="true">›</span>
                          </button>
                        );
                      })}
                    </div>
                    </>
                  )}
                </>
              )
            ) : sendraTab === 'domains' ? (
              (() => { const sel = domOpen ? domains.find((x) => x.domain === domOpen) : null; return sel; })() ? (() => {
                const d = domains.find((x) => x.domain === domOpen)!;
                const verified = d.verified;
                const recs = domRecords[d.domain] || [];
                const dc = dcInfo[d.domain];
                const checks = domChecks[d.domain];
                const fmt = (t?: string | null) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
                const recStatus = (purpose: string): { label: string; cls: 'ok' | 'wait' | 'opt' } => {
                  if (purpose === 'DMARC') return { label: 'Optional', cls: 'opt' };
                  if (verified) return { label: 'Verified', cls: 'ok' };
                  if (checks) return (purpose === 'DKIM' ? checks.dkim : purpose === 'SPF' ? checks.spf : false) ? { label: 'Verified', cls: 'ok' } : { label: 'Pending', cls: 'wait' };
                  return { label: 'Pending', cls: 'wait' };
                };
                return (
                  <div className="ag-compose">
                    <button className="ag-back-link ag-back-arrow" onClick={() => { tap(); setDomOpen(null); }}><span className="ag-back-arrow-in"><IconArrowLeft size={15} /> All domains</span></button>
                    <div className="ag-emd-hd">
                      <span className="ag-em-ava ag-emd-ava"><IconGlobe size={20} /></span>
                      <span className="ag-emd-hd-meta"><span className="ag-emd-hd-lbl">Domain</span><span className="ag-emd-hd-to">{d.domain}</span></span>
                      <span className={`ag-em-pill is-${verified ? 'sent' : 'sending'}`}>{verified ? 'Verified' : 'Pending'}</span>
                    </div>
                    <div className="ag-emd-grid">
                      <div className="ag-emd-cell"><div className="ag-emd-k">Created</div><div className="ag-emd-v">{d.created_at ? fmt(d.created_at) : '—'}</div></div>
                      <div className="ag-emd-cell"><div className="ag-emd-k">Status</div><div className="ag-emd-v" style={{ color: verified ? '#34d399' : '#fbbf24', fontWeight: 700 }}>{verified ? 'Verified' : 'Pending'}</div></div>
                    </div>
                    {verified && <div className="ag-dom-ok">✓ Verified — pick this domain under “Send from” when sending.</div>}
                    <div className="ag-emd-sec">Domain events</div>
                    <div className="ag-emd-timeline">
                      <div className="ag-emd-ev"><span className="ag-emd-rail"><span className="ag-emd-dot is-ok"><IconGlobe size={12} /></span><span className="ag-emd-line" /></span><span className="ag-emd-ev-body"><span className="ag-emd-ev-name">Domain added</span>{d.created_at && <span className="ag-emd-ev-time">{fmt(d.created_at)}</span>}</span></div>
                      <div className="ag-emd-ev"><span className="ag-emd-rail"><span className={`ag-emd-dot is-${verified ? 'ok' : 'wait'}`}>{verified ? '✓' : '·'}</span></span><span className="ag-emd-ev-body"><span className="ag-emd-ev-name">{verified ? 'Verified' : 'Awaiting verification'}</span>{verified && d.verified_at && <span className="ag-emd-ev-time">{fmt(d.verified_at)}</span>}</span></div>
                    </div>
                    <div className="ag-emd-sec">DNS records</div>
                    {!verified && (
                      <>
                        <button className="ag-send-btn ag-dom-auto" disabled={dcBusy === d.domain || !recs.length} onClick={() => autoConfigure(d.domain)}>{dcBusy === d.domain ? 'Checking…' : '⚡ Auto-configure (one-click)'}</button>
                        {dc && <div className={`ag-dom-testmsg${dc.supported ? ' ok' : ''}`}>{dc.failed ? 'Couldn’t check your DNS host just now — add the records below.' : dc.applyUrl ? `Opening ${dc.host} to authorize…` : dc.supported ? `✓ ${dc.host} supports one-click — for now add the records below.` : 'Your DNS host needs manual setup — add the records below.'}</div>}
                        {recs.length > 0 && <p className="ag-foot ag-dom-hint">Add these TXT records at your DNS host, then tap Verify.</p>}
                      </>
                    )}
                    {!recs.length && !domRecsErr && <p className="ag-foot ag-dom-hint">Loading the DNS records…</p>}
                    <div className="ag-dnr-list">
                      {/* DMARC is optional for verification — dropped from the
                          setup list to keep it to what's actually required.
                          (Gmail/Yahoo require DMARC for 5k+/day bulk senders,
                          so this likely returns when users hit that scale.) */}
                      {recs.filter((r) => r.purpose !== 'DMARC').map((r) => {
                        const stt = recStatus(r.purpose);
                        const open = domRecOpen === r.purpose;
                        return (
                          <div className="ag-dnr" key={r.purpose}>
                            <button className={`ag-dnr-row${open ? ' open' : ''}`} onClick={() => { tap(); setDomRecOpen(open ? null : r.purpose); }}>
                              <span className="ag-dnr-nm">{r.purpose}</span>
                              <span className="ag-dnr-ty">{r.type}</span>
                              <span className={`ag-dnr-st is-${stt.cls}`}>{stt.cls === 'ok' && <IconCheck size={11} />}{stt.label}</span>
                              <span className="ag-dnr-chev">{open ? '▴' : '▾'}</span>
                            </button>
                            {open && (
                              <div className="ag-dnr-body">
                                <button className="ag-dnr-line" onClick={() => copyText(r.name)}><span className="ag-dnr-k">Name</span><code>{r.name}</code><span className="ag-dnr-cp">{copied === r.name ? 'Copied' : <IconCopy size={13} />}</span></button>
                                <button className="ag-dnr-line" onClick={() => copyText(r.value)}><span className="ag-dnr-k">Value</span><code>{r.value}</code><span className="ag-dnr-cp">{copied === r.value ? 'Copied' : <IconCopy size={13} />}</span></button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!recs.length && domRecsErr === d.domain && (
                      <button className="ag-send-btn ghost" onClick={() => openDom(d.domain)}>Couldn’t load the records — tap to retry</button>
                    )}
                    {verified && (
                      <>
                        <div className="ag-emd-sec">Send a test</div>
                        <div className="ag-dom-test">
                          <input className="ag-field" placeholder="you@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={testTo[d.domain] || ''} onChange={(e) => setTestTo((m) => ({ ...m, [d.domain]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') sendTest(d.domain); }} />
                          <button className="ag-send-btn" disabled={testBusy === d.domain || !(testTo[d.domain] || '').trim()} onClick={() => sendTest(d.domain)}>{testBusy === d.domain ? 'Sending…' : 'Send test'}</button>
                        </div>
                        {testMsg[d.domain] && <div className={`ag-dom-testmsg${testMsg[d.domain].includes('✓') ? ' ok' : ''}`}>{testMsg[d.domain]}</div>}
                      </>
                    )}
                    {domVerErr?.domain === d.domain && <div className="ag-send-err" role="status">{domVerErr.msg}</div>}
                    <div className="ag-dom-actions">
                      {!verified && <button className="ag-send-btn" disabled={domVerifying === d.domain} onClick={() => verifyDom(d.domain)}>{domVerifying === d.domain ? 'Verifying…' : 'Verify'}</button>}
                      <button
                        className={`ag-send-btn ghost danger${domRmArm === d.domain ? ' armed' : ''}`}
                        aria-live="polite"
                        aria-label={domRmArm === d.domain ? `Confirm removing ${d.domain} — this permanently deletes the domain and its signing key` : `Remove ${d.domain}`}
                        onClick={() => armRemove(d.domain)}
                      >{domRmArm === d.domain ? 'Tap again to remove' : 'Remove'}</button>
                    </div>
                  </div>
                );
              })() : (
              <div className="ag-compose">
                {!domsLoaded ? (
                  <p className="ag-foot ag-dom-hint">Loading your domains…</p>
                ) : domsErr && domains.length === 0 ? (
                  <button className="ag-send-btn ghost" onClick={() => { tap(); loadDomains(); }}>Couldn’t load your domains — tap to retry</button>
                ) : domains.length === 0 ? (
                  <div className="ag-dom-empty">
                    <div className="ag-dom-empty-ic"><IconGlobe size={32} /></div>
                    <div className="ag-dom-empty-ttl">Your sending domain</div>
                    <div className="ag-dom-add">
                      <input className="ag-field" placeholder="yourbrand.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={domNew} onChange={(e) => { setDomNew(e.target.value); if (domErr) setDomErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') addDomain(); }} />
                      <button className="ag-send-btn" disabled={domBusy || !domNew.trim()} onClick={addDomain}>{domBusy ? 'Adding…' : 'Add'}</button>
                    </div>
                    {domErr && <div className="ag-send-err">{domErr}</div>}
                  </div>
                ) : (
                  <>
                    <div className="ag-dom-add">
                      <input className="ag-field" placeholder="yourbrand.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={domNew} onChange={(e) => { setDomNew(e.target.value); if (domErr) setDomErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') addDomain(); }} />
                      <button className="ag-send-btn" disabled={domBusy || !domNew.trim()} onClick={addDomain}>{domBusy ? 'Adding…' : 'Add domain'}</button>
                    </div>
                    {domErr && <div className="ag-send-err">{domErr}</div>}
                    <div className="ag-dom-list">
                    {domains.map((d) => (
                      <button className="ag-dom ag-dom-row" onClick={() => openDom(d.domain)} key={d.domain}>
                        <span className="ag-dom-ic"><IconGlobe size={18} /></span>
                        <span className="ag-dom-info">
                          <span className="ag-dom-name">{d.domain}</span>
                          <span className="ag-dom-sub">{d.verified ? 'Sending enabled' : 'Awaiting DNS records'}</span>
                        </span>
                        <span className={`ag-badge is-${d.verified ? 'ok' : 'wait'}`}><i className="ag-dot" />{d.verified ? 'Verified' : 'Pending'}</span>
                        <span className="ag-dom-chev">›</span>
                      </button>
                    ))}
                    </div>
                  </>
                )}
              </div>
              )
            ) : sendraTab === 'emails' ? (
              msgOpen ? (() => {
                const m = msgDetail || msgOpen;
                const st = msgStatus(m.status);
                const events: { label: string; cls: string; at?: string | null; err?: string | null }[] = [];
                if (m.sent_at || m.status === 'sent' || m.delivered_at) events.push({ label: 'Sent', cls: 'ok', at: m.sent_at || m.created_at });
                if (m.delivered_at) events.push({ label: 'Delivered', cls: 'ok', at: m.delivered_at });
                {/* Bounce/complaint carry no timestamp of their own (mail-events sets
                    only status), so leave the time blank rather than stamping them
                    with the send/delivery time and implying it bounced when it was sent. */}
                if (m.status === 'bounced' || m.status === 'soft_bounced') events.push({ label: m.status === 'soft_bounced' ? 'Soft bounce' : 'Bounced', cls: 'bad', at: m.delivered_at || null, err: m.error });
                if (m.status === 'complained') events.push({ label: 'Complaint', cls: 'bad', at: m.delivered_at || null });
                if (m.status === 'failed') events.push({ label: 'Failed', cls: 'bad', at: m.created_at, err: m.error });
                if (!events.length) events.push({ label: st.label, cls: st.cls === 'failed' ? 'bad' : 'ok', at: m.created_at });
                const fmt = (t?: string | null) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
                return (
                  <div className="ag-compose">
                    <button className="ag-back-link" onClick={() => { tap(); setMsgOpen(null); setMsgDetail(null); }}>‹ Emails</button>
                    <div className="ag-emd-hd">
                      <span className="ag-em-ava ag-emd-ava"><IconInbox size={20} /></span>
                      <span className="ag-emd-hd-meta">
                        <span className="ag-emd-hd-lbl">Email</span>
                        <span className="ag-emd-hd-to">{m.to_email}</span>
                      </span>
                      <span className={`ag-em-pill is-${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="ag-emd-grid">
                      <div className="ag-emd-cell"><div className="ag-emd-k">From</div><div className="ag-emd-v">{m.from_email || '—'}</div></div>
                      <div className="ag-emd-cell"><div className="ag-emd-k">To</div><div className="ag-emd-v">{m.to_email}</div></div>
                      <div className="ag-emd-cell ag-emd-full"><div className="ag-emd-k">Subject</div><div className="ag-emd-v">{m.subject || '(no subject)'}</div></div>
                      <div className="ag-emd-cell ag-emd-full"><div className="ag-emd-k">Message ID</div><div className="ag-emd-id"><code>{m.id}</code><button className={copied === m.id ? 'ok' : ''} onClick={() => copyText(m.id)}>{copied === m.id ? 'Copied ✓' : 'Copy'}</button></div></div>
                    </div>
                    <div className="ag-emd-sec">Log</div>
                    <div className="ag-emd-log"><span className="ag-emd-log-method">POST</span><code className="ag-emd-log-path">/emails</code></div>
                    <div className="ag-emd-sec">Email events</div>
                    <div className="ag-emd-timeline">
                      {events.map((ev, i) => (
                        <div className="ag-emd-ev" key={i}>
                          <span className="ag-emd-rail"><span className={`ag-emd-dot is-${ev.cls}`}>{ev.cls === 'bad' ? '!' : '✓'}</span>{i < events.length - 1 && <span className="ag-emd-line" />}</span>
                          <span className="ag-emd-ev-body"><span className="ag-emd-ev-name">{ev.label}</span>{ev.at && <span className="ag-emd-ev-time">{fmt(ev.at)}</span>}{ev.err && <span className="ag-emd-ev-time ag-log-reason">{ev.err}</span>}</span>
                        </div>
                      ))}
                    </div>
                    <div className="ag-emd-sec">Preview</div>
                    {msgDetailBusy && !msgDetail ? (
                      <div className="ag-empty">Loading…</div>
                    ) : msgDetail?.body_html ? (
                      <iframe className="ag-emd-preview" sandbox="" title="Email preview" srcDoc={msgDetail.body_html} />
                    ) : msgDetail?.body_text ? (
                      <pre className="ag-emd-text">{msgDetail.body_text}</pre>
                    ) : msgDetailErr ? (
                      <button className="ag-send-btn ghost" onClick={() => openMsg(msgOpen!)}>Couldn’t load this email — tap to retry</button>
                    ) : (
                      <div className="ag-emd-nobody"><div className="ag-emd-nobody-t">No preview for this email</div><div className="ag-emd-nobody-s">It was sent before Sendra started saving message bodies. New sends will show their preview here.</div></div>
                    )}
                  </div>
                );
              })() : (
              <div className="ag-compose">
                {msgBusy && msgList.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Loading…</div>
                ) : msgList.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>No emails sent yet. Individual emails you send — from the composer or the API — show up here with their delivery status.</div>
                ) : (() => {
                  const q = msgSearch.trim().toLowerCase();
                  const _mr = MSG_RANGE_OPTS.find((r) => r.id === msgRange) || MSG_RANGE_OPTS[4];
                  const cutoff = rangeCutoffMs(_mr.id, _mr.days);
                  const filtered = msgList.filter((m) => {
                    if (msgFilter !== 'all' && m.status !== msgFilter) return false;
                    if (q && !m.to_email.toLowerCase().includes(q) && !(m.subject || '').toLowerCase().includes(q)) return false;
                    if (cutoff) { const t = Date.parse(m.created_at || m.sent_at || ''); if (t && t < cutoff) return false; }
                    return true;
                  });
                  return (
                    <>
                      <div className="ag-em-search">
                        <IconSearch size={15} />
                        <input placeholder="Search by recipient or subject" autoCapitalize="none" autoCorrect="off" value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)} />
                        {msgSearch && <button className="ag-em-clear" onClick={() => setMsgSearch('')} aria-label="Clear"><IconX size={14} /></button>}
                      </div>
                      <div className="ag-em-filters">
                        <FilterMenu value={msgRange} options={MSG_RANGE_OPTS} onChange={setMsgRange} />
                        <FilterMenu value={msgFilter} options={MSG_STATUS_OPTS} onChange={setMsgFilter} />
                        <FilterMenu value={msgApiKey} options={MSG_APIKEY_OPTS} onChange={setMsgApiKey} align="right" hint="API keys coming soon" />
                      </div>
                      {filtered.length === 0 ? (
                        <div className="ag-empty" style={{ marginTop: 8 }}>No emails match.</div>
                      ) : (
                        <div className="ag-em-list">
                          {filtered.map((m) => {
                            const st = msgStatus(m.status);
                            const when = m.delivered_at || m.sent_at || m.created_at;
                            return (
                              <button className="ag-em-row" key={m.id} onClick={() => openMsg(m)}>
                                <span className="ag-em-ava"><IconInbox size={17} /></span>
                                <span className="ag-em-meta">
                                  <span className="ag-em-to">{m.to_email}</span>
                                  <span className="ag-em-subj">{m.subject || '(no subject)'}</span>
                                  {m.error && <span className="ag-em-subj ag-log-reason">{m.error}</span>}
                                </span>
                                <span className="ag-em-right">
                                  <span className={`ag-em-pill is-${st.cls}`}>{st.label}</span>
                                  {when && <span className="ag-em-when">{relTime(Date.parse(when) || Date.now())}</span>}
                                </span>
                                <span className="ag-em-chev">›</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
                <p className="ag-foot">{msgList.length >= 100 ? 'Your 100 most recent individual emails' : 'Every individual email you’ve sent'} through Sendra — from the composer or the API — and where it landed. Campaign sends live under Logs.</p>
              </div>
              )
            ) : sendraTab === 'logs' ? (
              <div className="ag-compose">
                {(() => {
                  // Build the unified request log from transactional sends (/emails)
                  // and campaign sends (/campaigns), newest first.
                  const entries: LogEntry[] = [];
                  for (const m of msgList) {
                    // A failed transactional send is a mail-server/relay failure (502
                    // from the mailer fn), not a 422 validation error — don't fabricate
                    // a code that sends a debugging user chasing the wrong problem.
                    entries.push({ id: `m-${m.id}`, endpoint: '/emails', method: 'POST', code: m.status === 'failed' ? 502 : 200, at: m.created_at || m.sent_at || '', source: 'api', q: `${m.to_email} ${m.subject || ''} /emails` });
                  }
                  for (const c of campList) {
                    if (c.status === 'draft') continue;
                    const code = c.status === 'failed' ? 500 : c.status === 'scheduled' ? 202 : 200;
                    entries.push({ id: `c-${c.id}`, endpoint: '/campaigns', method: 'POST', code, at: c.scheduled_at || c.created_at || '', source: 'campaign', q: `${c.name || ''} ${c.subject || ''} /campaigns` });
                  }
                  entries.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
                  const q = logsQ.trim().toLowerCase();
                  const _lr = MSG_RANGE_OPTS.find((r) => r.id === logRange) || MSG_RANGE_OPTS[4];
                  const cutoff = rangeCutoffMs(_lr.id, _lr.days);
                  const filtered = entries.filter((e) => {
                    if (logSource !== 'all' && e.source !== logSource) return false;
                    if (logHttp === 'success' && e.code >= 400) return false;
                    if (logHttp === 'error' && e.code < 400) return false;
                    if (q && !e.q.toLowerCase().includes(q)) return false;
                    if (cutoff) { const t = Date.parse(e.at); if (t && t < cutoff) return false; }
                    return true;
                  });
                  const hasAny = msgList.length + campList.length > 0;
                  return (
                    <>
                      <div className="ag-em-search">
                        <IconSearch size={15} />
                        <input placeholder="Search logs" autoCapitalize="none" autoCorrect="off" value={logsQ} onChange={(e) => setLogsQ(e.target.value)} />
                        {logsQ && <button className="ag-em-clear" onClick={() => setLogsQ('')} aria-label="Clear"><IconX size={14} /></button>}
                      </div>
                      <div className="ag-em-filters">
                        <FilterMenu value={logRange} options={MSG_RANGE_OPTS} onChange={setLogRange} />
                        <FilterMenu value={logHttp} options={LOG_HTTP_OPTS} onChange={setLogHttp} />
                        <FilterMenu value={logSource} options={LOG_SOURCE_OPTS} onChange={setLogSource} />
                        <FilterMenu value={logApiKey} options={MSG_APIKEY_OPTS} onChange={setLogApiKey} align="right" hint="API keys coming soon" />
                      </div>
                      {logsBusy && !hasAny ? (
                        <div className="ag-empty" style={{ marginTop: 8 }}>Loading…</div>
                      ) : !hasAny ? (
                        <div className="ag-empty" style={{ marginTop: 8 }}>No requests yet. Sends through Sendra — campaigns and individual emails — show up here as they happen.</div>
                      ) : filtered.length === 0 ? (
                        <div className="ag-empty" style={{ marginTop: 8 }}>No logs match.</div>
                      ) : (
                        <div className="ag-em-list">
                          {filtered.map((e) => {
                            const ok = e.code < 400;
                            return (
                              <div className="ag-em-row ag-lg-row" key={e.id}>
                                <span className={`ag-em-ava ag-lg-ava ${e.source}`}>{e.source === 'campaign' ? <IconWaveform size={16} /> : <IconInbox size={16} />}</span>
                                <code className="ag-lg-endpoint">{e.endpoint}</code>
                                <span className={`ag-lg-code ${ok ? 'ok' : 'err'}`}>{e.code}</span>
                                <span className="ag-lg-method">{e.method}</span>
                                {e.at && <span className="ag-em-when">{relTime(Date.parse(e.at) || Date.now())}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
                <p className="ag-foot">{msgList.length >= 100 || campList.length >= 50 ? 'Your most recent requests' : 'Every request Sendra processed'} — campaign sends (/campaigns) and individual emails (/emails) — with its status. Filter by source to see one or the other.</p>
              </div>
            ) : sendraTab === 'deliver' ? (
              <div className="ag-compose">
                {delivBusy && !deliv ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Checking your delivery…</div>
                ) : delivErr && !deliv ? (
                  <button className="ag-send-btn ghost" style={{ marginTop: 12 }} onClick={loadDeliver}>Couldn’t load your delivery stats — tap to retry</button>
                ) : deliv && (deliv.reputation.accepted > 0 || (deliv.reputation.sent30 ?? 0) > 0) ? (
                  <>
                    {(() => {
                      const r = deliv.reputation;
                      const bPct = r.bounceRate * 100, cPct = r.complaintRate * 100;
                      const cards = [
                        { k: 'Sent (30d)', v: r.sent30 ?? 0, sub: 'last 30 days' },
                        { k: 'Sent', v: r.accepted, sub: 'accepted' },
                        { k: 'Delivered', v: r.delivered, sub: r.accepted ? `${Math.round((r.delivered / r.accepted) * 100)}%` : '—' },
                        { k: 'Bounced', v: r.bounced, sub: r.accepted ? `${bPct.toFixed(1)}%` : '—' },
                        { k: 'Complaints', v: r.complained, sub: r.delivered ? `${cPct.toFixed(2)}%` : '—' },
                      ];
                      return (
                        <>
                          <div className="ag-stat-grid">
                            {cards.map((c) => (
                              <div className="ag-stat-card" key={c.k}>
                                <div className="ag-stat-v">{c.v}</div>
                                <div className="ag-stat-k">{c.k}</div>
                                <div className="ag-stat-sub">{c.sub}</div>
                              </div>
                            ))}
                          </div>
                          {r.accepted > 0 && (bPct >= 2 || cPct >= 0.1) && (
                            <div className="ag-deliver-warn">
                              {cPct >= 0.1 ? `Complaint rate ${cPct.toFixed(2)}% — Gmail and Yahoo want this under 0.30%. ` : ''}
                              {bPct >= 2 ? `Bounce rate ${bPct.toFixed(1)}% — clean your list and only mail people who opted in.` : ''}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {delivErr && <div className="ag-send-err">Couldn’t refresh — the numbers above may be out of date.</div>}
                    <button className="ag-send-btn ghost" disabled={delivBusy} onClick={loadDeliver}>{delivBusy ? 'Refreshing…' : 'Refresh'}</button>
                    <p className="ag-foot">Your delivery and bounce/complaint rates across every campaign email you’ve sent. (Opens and clicks show per-campaign under each campaign’s stats.)</p>
                  </>
                ) : (
                  <div className="ag-empty" style={{ marginTop: 12 }}>No sends yet. Send a campaign and your delivery, opens, clicks and bounce rates show up here.</div>
                )}
              </div>
            ) : sendraTab === 'webhook' ? (
              <div className="ag-compose">
                <p className="ag-foot">Get email, contact and domain events POSTed to your own HTTPS endpoint in real time — each request signed so you can verify it came from Sendra.</p>
                {webhooks.length > 0 && (
                  <div className="ag-wh-bar">
                    <button className="ag-send-btn" onClick={openWhAdd}><IconPlus size={16} /> Add endpoint</button>
                  </div>
                )}
                {webhooks.length === 0 ? (
                  <div className="ag-dom-empty ag-wh-empty">
                    <div className="ag-dom-empty-ic"><IconWebhook size={32} /></div>
                    <div className="ag-dom-empty-ttl">No endpoints yet</div>
                    <p className="ag-ce-sub">Point Sendra at your HTTPS endpoint to get email, contact and domain events in real time.</p>
                    <button className="ag-send-btn" onClick={openWhAdd}><IconPlus size={16} /> Add endpoint</button>
                  </div>
                ) : (
                  <div className="ag-dom-list">
                    {webhooks.map((w) => {
                      const open = whOpen === w.id;
                      const ok = w.last_status != null && w.last_status >= 200 && w.last_status < 300;
                      const badge = !w.enabled ? 'wait' : w.last_status == null ? 'ok' : ok ? 'ok' : 'bad';
                      return (
                        <div className={`ag-dom${open ? ' open' : ''}`} key={w.id}>
                          <button className="ag-dom-row" onClick={() => { tap(); const next = open ? null : w.id; setWhOpen(next); if (next && whDeliv[w.id] === undefined) loadWhDeliveries(w.id); }}>
                            <span className="ag-dom-ic">🔗</span>
                            <span className="ag-dom-info">
                              <span className="ag-dom-name">{w.url}</span>
                              <span className="ag-dom-sub">{!w.enabled ? 'Paused' : w.last_event_at ? `Last delivery: HTTP ${w.last_status}` : 'Active — no events yet'}</span>
                            </span>
                            <span className={`ag-badge is-${badge}`}><i className="ag-dot" />{!w.enabled ? 'Paused' : w.last_status == null ? 'Active' : ok ? 'OK' : 'Failing'}</span>
                            <span className="ag-dom-chev">{open ? '▾' : '▸'}</span>
                          </button>
                          {open && (
                            <div className="ag-dom-body">
                              <div className="ag-dns-field"><label>Signing secret</label><div className="ag-dns-val"><code>{w.secret}</code><button className={copied === w.secret ? 'ok' : ''} onClick={() => copyText(w.secret)}>{copied === w.secret ? 'Copied ✓' : 'Copy'}</button></div></div>
                              <div className="ag-wh-evrow">
                                <span className="ag-wh-ev-lbl">Events</span>
                                <WhEventPicker value={whEffective(w.events)} onToggle={(id) => toggleWhEventFor(w, id)} />
                              </div>
                              <div className="ag-wh-deliv">
                                <div className="ag-wh-deliv-hd">
                                  <span className="ag-wh-ev-lbl">Recent deliveries</span>
                                  <button className="ag-wh-deliv-refresh" disabled={whDelivBusy === w.id} onClick={() => { tap(); loadWhDeliveries(w.id); }}>{whDelivBusy === w.id ? 'Refreshing…' : 'Refresh'}</button>
                                </div>
                                {(whDeliv[w.id] && whDeliv[w.id].length > 0) ? (
                                  <ul className="ag-wh-deliv-list">
                                    {whDeliv[w.id].map((d) => {
                                      const st = d.status === 'success' ? 'ok' : d.status === 'dead' ? 'bad' : 'wait';
                                      const lab = d.status === 'success' ? 'Delivered' : d.status === 'dead' ? 'Failed' : 'Retrying';
                                      const detail = d.last_status ? `HTTP ${d.last_status}` : d.last_error || (d.status === 'pending' ? `attempt ${d.attempts}` : '');
                                      return (
                                        <li className="ag-wh-deliv-it" key={d.id}>
                                          <span className={`ag-dot is-${st}`} />
                                          <code className="ag-wh-deliv-ev">{d.event_type}</code>
                                          <span className="ag-wh-deliv-meta">{lab}{detail ? ` · ${detail}` : ''}</span>
                                          <span className="ag-wh-deliv-when">{relTime(Date.parse(d.created_at) || Date.now())}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <p className="ag-foot ag-wh-deliv-empty">{whDelivBusy === w.id ? 'Loading…' : whDeliv[w.id] ? 'No deliveries yet. Real events (a send, a contact change, a bounce) show up here — the “Send test” result appears above, not in this list.' : ''}</p>
                                )}
                              </div>
                              <p className="ag-foot ag-dom-hint">Verify each POST: <code>sendra-signature: v1=&lt;hex&gt;</code> is the HMAC-SHA256 of <code>{'{sendra-timestamp}.{raw body}'}</code> keyed with this secret.</p>
                              {whTest[w.id] && <div className={`ag-dom-testmsg${whTest[w.id].includes('✓') ? ' ok' : ''}`}>{whTest[w.id]}</div>}
                              <div className="ag-dom-actions">
                                <button className="ag-send-btn" onClick={async () => { await sendWhTest(w.id); loadWhDeliveries(w.id); }}>Send test</button>
                                <button className="ag-send-btn ghost" onClick={() => toggleWh(w)}>{w.enabled ? 'Pause' : 'Resume'}</button>
                                <button className={`ag-send-btn ghost danger${whRmArm === w.id ? ' armed' : ''}`} aria-live="polite" onClick={() => armRemoveWh(w.id)}>{whRmArm === w.id ? 'Tap again to remove' : 'Remove'}</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {whAddOpen && (
                  <>
                    <div className="ag-confirm-scrim" onClick={() => { if (!whBusy) setWhAddOpen(false); }} />
                    <div className="ag-confirm ag-cform ag-wh-modal" role="dialog" aria-modal="true">
                      <div className="ag-wh-modal-hd">
                        <span className="ag-confirm-title">Add endpoint</span>
                        <button className="ag-wh-modal-x" onClick={() => { if (!whBusy) setWhAddOpen(false); }} aria-label="Close"><IconX size={18} /></button>
                      </div>
                      <label className="ag-wh-modal-lbl">Endpoint URL</label>
                      <input className="ag-field" placeholder="https://yourapp.com/webhooks/sendra" autoCapitalize="none" autoCorrect="off" autoFocus value={whNew} onChange={(e) => { setWhNew(e.target.value); if (whErr) setWhErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') addWh(); }} />
                      <label className="ag-wh-modal-lbl">Events to listen for</label>
                      <WhEventPicker value={whEvents} onToggle={toggleNewWhEvent} />
                      {whErr && <div className="ag-send-err">{whErr}</div>}
                      <div className="ag-confirm-actions">
                        <button className="ag-confirm-cancel" disabled={whBusy} onClick={() => setWhAddOpen(false)}>Cancel</button>
                        <button className="ag-confirm-send" disabled={whBusy || !whNew.trim()} onClick={addWh}>{whBusy ? 'Adding…' : 'Add endpoint'}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : sendraTab === 'automations' ? (
              autoNew ? (
                <div className="ag-compose">
                  <div className="ag-dom-head">
                    <button className="ag-back-link" onClick={() => { tap(); setAutoNew(false); }}>‹ Automations</button>
                    <span className="ag-dom-title">{autoEditId ? 'Edit automation' : 'New automation'}</span>
                  </div>
                  <input className="ag-field" placeholder="Name (e.g. Welcome series)" value={autoName} onChange={(e) => { setAutoName(e.target.value); if (autoErr) setAutoErr(''); }} />
                  <input className="ag-field" placeholder="Trigger tag — contacts with this tag get enrolled (e.g. lead)" autoCapitalize="none" autoCorrect="off" value={autoTag} onChange={(e) => { setAutoTag(e.target.value); if (autoErr) setAutoErr(''); }} />
                  <div className="ag-from">
                    <span className="ag-from-lbl">Send from</span>
                    <select className="ag-field ag-from-sel" value={autoDomain} onChange={(e) => { tap(); setAutoDomain(e.target.value); }}>
                      <option value="">My mailbox</option>
                      {domains.filter((d) => d.verified).map((d) => (<option key={d.domain} value={d.domain}>{d.domain}</option>))}
                    </select>
                  </div>
                  {autoDomain && (
                    <div className="ag-from-fields">
                      <input className="ag-field" placeholder="From name (e.g. Acme)" value={autoFromName} onChange={(e) => setAutoFromName(e.target.value)} />
                      <div className="ag-from-addr"><input className="ag-field" placeholder="news" autoCapitalize="none" autoCorrect="off" value={autoFromLocal} onChange={(e) => setAutoFromLocal(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))} /><span className="ag-from-at">@{autoDomain}</span></div>
                    </div>
                  )}
                  {autoSteps.map((s, i) => (
                    <div key={i} style={{ border: '1px solid #26262b', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, color: '#fff' }}>Step {i + 1}</span>
                        {autoSteps.length > 1 && <button onClick={() => removeStep(i)} style={{ background: 'none', border: 0, color: '#a6a6ae', cursor: 'pointer', fontSize: 13 }}>Remove</button>}
                      </div>
                      <label style={{ fontSize: 13, color: '#a6a6ae', display: 'flex', alignItems: 'center', gap: 8 }}>
                        Wait <input className="ag-field" type="number" min={0} style={{ width: 72 }} value={s.delay_days} onChange={(e) => setStep(i, { delay_days: Number(e.target.value) })} /> day(s) {i === 0 ? 'after tagging' : 'after the previous step'}
                      </label>
                      <input className="ag-field" placeholder="Subject" value={s.subject} onChange={(e) => { setStep(i, { subject: e.target.value }); if (autoErr) setAutoErr(''); }} />
                      <textarea className="ag-field ag-body" placeholder="Message… use {{name}} to personalize" value={s.body} onChange={(e) => { setStep(i, { body: e.target.value }); if (autoErr) setAutoErr(''); }} />
                    </div>
                  ))}
                  <button className="ag-send-btn ghost" onClick={addStep}>+ Add step</button>
                  {autoErr && <div className="ag-send-err">{autoErr}</div>}
                  <button className="ag-send-btn" disabled={autoBusy} onClick={saveAuto}>{autoBusy ? 'Saving…' : autoEditId ? 'Save changes' : 'Create automation'}</button>
                  <button className="ag-send-btn ghost" disabled={autoBusy} onClick={() => { tap(); setAutoNew(false); }}>Cancel</button>
                  <p className="ag-foot">Once enabled, any contact tagged “{autoTag.trim() || 'your tag'}” moves through these emails automatically — new contacts with the tag join on their own. Unsubscribes &amp; bounces drop out.</p>
                </div>
              ) : (
                <div className="ag-compose">
                  {autoList.length === 0 ? (
                    <div className="ag-dom-empty ag-auto-empty">
                      <div className="ag-dom-empty-ic"><IconBolt size={32} /></div>
                      <div className="ag-dom-empty-ttl">No automations yet</div>
                      <p className="ag-ce-sub">Tag a contact and they’ll move through a series of emails on their own — welcome flows, follow-ups, nudges.</p>
                      <button className="ag-send-btn" onClick={openAutoNew}><IconPlus size={16} /> New automation</button>
                    </div>
                  ) : (
                    <>
                    <p className="ag-foot">Drip sequences: tag a contact and they automatically receive a series of emails over time. Suppressed and unsubscribed contacts stop automatically.</p>
                    <button className="ag-send-btn" onClick={openAutoNew}>+ New automation</button>
                    <div className="ag-dom-list">
                      {autoList.map((a) => (
                        <div className="ag-dom open" key={a.id}>
                          <div className="ag-dom-row" style={{ cursor: 'default' }}>
                            <span className="ag-dom-ic">⚡</span>
                            <span className="ag-dom-info">
                              <span className="ag-dom-name">{a.name}</span>
                              <span className="ag-dom-sub">tag “{a.trigger_tag}” · {a.steps?.length || 0} step{(a.steps?.length || 0) === 1 ? '' : 's'} · {a.active || 0} active · {a.done || 0} done</span>
                            </span>
                            <span className={`ag-badge is-${a.enabled ? 'ok' : 'wait'}`}><i className="ag-dot" />{a.enabled ? 'On' : 'Off'}</span>
                          </div>
                          <div className="ag-dom-body">
                            <div className="ag-dom-actions">
                              <button className="ag-send-btn" onClick={() => toggleAuto(a)}>{a.enabled ? 'Pause' : 'Enable'}</button>
                              <button className="ag-send-btn ghost" onClick={() => openAutoEdit(a)}>Edit</button>
                              <button className={`ag-send-btn ghost danger${autoRmArm === a.id ? ' armed' : ''}`} aria-live="polite" onClick={() => armRemoveAuto(a.id)}>{autoRmArm === a.id ? 'Tap again to delete' : 'Delete'}</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    </>
                  )}
                </div>
              )
            ) : (
              (() => {
                const scheduled = campList.filter((c) => c.status === 'scheduled');
                return scheduled.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Nothing scheduled yet. Create a campaign and choose <b>Schedule</b> to line one up — it’ll send automatically.</div>
                ) : (
                  <div className="ag-camp-list">
                    {scheduled.map((c) => (
                      <div className="ag-camp" key={c.id}>
                        <div className="ag-camp-main">
                          <div className="ag-camp-name">{c.name || c.subject || 'Campaign'}</div>
                          <div className="ag-camp-sub">{c.scheduled_at ? new Date(c.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending'} · {c.total} recipient{c.total === 1 ? '' : 's'}</div>
                        </div>
                        <button className="ag-sup-x" onClick={() => cancelScheduled(c.id)}>Cancel</button>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

      ) : commsApp === 'telegram' ? (
        tgChat ? (
          // ---- telegram thread ----
          <div className="ag-stage ag-tg-thread">
            <div className="ag-tg-msgs" ref={tgMsgsRef}>
              {tgMsgsState === 'loading' && tgMsgs.length === 0 ? (
                <EmailSkeleton />
              ) : tgMsgsState === 'err' ? (
                <div className="ag-empty">Couldn’t load this chat.{' '}
                  <button className="ag-retry" onClick={() => { tap(); loadTgMsgs(tgChat.id); }}>Try again</button>
                </div>
              ) : sortedMsgs.length === 0 ? (
                <div className="ag-empty">No messages yet.</div>
              ) : (
                sortedMsgs.map((m) => (
                  <div key={m.id} className={`ag-bubble ${m.outgoing ? 'out' : 'in'}`}>
                    <span className="ag-bubble-text">{m.text || '—'}</span>
                    <span className="ag-bubble-time">{fmtTime(m.date)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="ag-tg-composer">
              <input
                className="ag-tg-input" placeholder="Message…" value={tgReply}
                onChange={(e) => setTgReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && tgReply.trim() && !tgSending) doTgSend(); }}
              />
              <button className="ag-tg-sendbtn" onClick={doTgSend} disabled={!tgReply.trim() || tgSending} aria-label="Send">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </div>
        ) : (
          // ---- telegram chats list ----
          <div className="ag-stage">
            {tgListState === 'err' ? (
              <div className="ag-empty">Couldn’t load your chats.{' '}
                <button className="ag-retry" onClick={() => { tap(); loadTgChats(); }}>Try again</button>
              </div>
            ) : tgListState === 'ok' && tgList.length === 0 ? (
              <div className="ag-empty">No chats found.</div>
            ) : tgList.length ? (
              <div className="ag-tg-list">
                {tgList.map((c) => (
                  <button key={String(c.id)} className="ag-tg-row" onClick={() => { tap(); setTgChat(c); }}>
                    <span className="ag-tg-ava" style={{ background: `hsl(${(String(c.title).charCodeAt(0) * 47) % 360} 55% 45%)` }}>
                      {(c.title || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="ag-tg-row-meta">
                      <span className="ag-tg-row-name">{c.title}</span>
                      {c.username ? <span className="ag-tg-row-sub">@{c.username}</span> : null}
                    </span>
                    <span className="ag-chev" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmailSkeleton />
            )}
          </div>
        )

      ) : emailTab === 'inbox' ? (
        // Mobile: the wrapper is display:contents (invisible). Desktop: it
        // becomes the two-pane split — list left, reading pane right.
        <div className={`ag-mailwrap${splitMail ? ' ag-split' : ''}`}>
        <div className="ag-stage" ref={inboxScrollRef} onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd}>
          <div
            className="ag-ptr"
            style={{ height: pull, transition: pullStart.current !== null ? 'none' : 'height 0.18s ease' }}
            aria-hidden="true"
          >
            <span className={`ag-ptr-ic${pull >= PULL_THRESHOLD || refreshing ? ' ready' : ''}${refreshing ? ' spinning' : ''}`}>
              <IconRefresh size={18} />
            </span>
          </div>
          {!mailConnected ? connectCard('Link this mailbox so the agent can read your inbox.')
            : inboxState === 'err' ? (
              <div className="ag-empty">
                Couldn’t load your inbox.{' '}
                <button className="ag-retry" onClick={() => { tap(); if (combinedInbox) loadMerged(); else refreshInbox(); }}>Try again</button>
              </div>
            ) : inboxState === 'ok' && inbox.length === 0 ? (
              <div className="ag-empty">Inbox is empty.</div>
            ) : inbox.length ? (
              <>
                <div className="ag-inbox-search" style={{ position: 'relative', marginBottom: 8 }}>
                  <input
                    className="ag-field"
                    type="search" inputMode="search" autoCapitalize="none" autoCorrect="off"
                    placeholder="Search mail…"
                    value={inboxQ}
                    onChange={(e) => setInboxQ(e.target.value)}
                    style={{ width: '100%', paddingRight: 34 }}
                  />
                  {inboxQ && (
                    <button
                      onClick={() => { tap(); setInboxQ(''); }}
                      aria-label="Clear search"
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 16, lineHeight: 1, cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: 4 }}
                    >✕</button>
                  )}
                </div>
                {shownInbox.length === 0 ? (
                  <div className="ag-empty">{searchBusy ? 'Searching…' : `No emails match “${inboxQ.trim()}”.`}</div>
                ) : (
                  <div className="ag-inbox" key={pageIdx}>
                    <EmailList items={shownInbox} onOpen={(it) => { tap(); markReadLocal(it); setReading(it); }} badges={combinedInbox} selectedId={splitMail ? reading?.id : undefined} />
                  </div>
                )}
                {!inboxQuery && !combinedInbox && hasPager && (
                  <div className="ag-pager">
                    <button onClick={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || refreshing}>‹ Prev</button>
                    <span className="ag-pager-n">Page {pageIdx + 1}</span>
                    <button onClick={() => goPage(pageIdx + 1)} disabled={!nextTok || refreshing}>Next ›</button>
                  </div>
                )}
                {!inboxQuery && mergedMore && (
                  <div className="ag-pager">
                    <button onClick={loadMoreMerged} disabled={refreshing}>{refreshing ? 'Loading…' : 'Load older'}</button>
                  </div>
                )}
              </>
            ) : (
              <EmailSkeleton />
            )}
        </div>
        {splitMail && (
          <div className="ag-split-read">
            {readerPane ?? (
              <div className="ag-split-empty">
                <IconInbox size={30} />
                <p>Select an email to read it here</p>
              </div>
            )}
          </div>
        )}
        </div>
      ) : emailTab === 'contacts' ? (
        <div className={`ag-stage${mergedContacts.length === 0 ? ' ag-contacts-stage-empty' : ''}`}>
          {(() => {
            const q = contactSearch.trim().toLowerCase();
            const allTags = [...new Set(mergedContacts.flatMap((c) => c.tags || []))].sort();
            const tag = contactTag && allTags.includes(contactTag) ? contactTag : '';
            const base = tag ? mergedContacts.filter((c) => c.tags?.includes(tag)) : mergedContacts;
            const list = q ? base.filter((c) => `${c.name || ''} ${c.email || ''}`.toLowerCase().includes(q)) : base;
            const loading = contactsState === 'loading' && mergedContacts.length === 0;
            return (
              <>
                <div className="ag-contacts-bar">
                  <div className="ag-search">
                    <svg className="ag-search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                    <input className="ag-search-in" placeholder="Search contacts" autoCapitalize="none" autoCorrect="off" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
                    {contactSearch && <button className="ag-search-clear" onClick={() => { tap(); setContactSearch(''); }} aria-label="Clear search">✕</button>}
                  </div>
                  {mergedContacts.length > 0 && (
                    <button className="ag-contacts-sel" onClick={() => openContactForm()}>+ Add</button>
                  )}
                  {mergedContacts.length > 0 && (
                    <button className={`ag-contacts-sel${contactSelMode ? ' on' : ''}`} onClick={() => { tap(); setContactSelMode((v) => !v); setContactSel(new Set()); }}>{contactSelMode ? 'Cancel' : 'Select'}</button>
                  )}
                </div>
                {allTags.length > 0 && (
                  <div className="ag-seg-row">
                    {/* Switching segments clears the selection so the bulk count
                        can't include people from a segment no longer in view. */}
                    <button className={`ag-seg${tag ? '' : ' on'}`} onClick={() => { tap(); setContactTag(''); setContactSel(new Set()); }}>All</button>
                    {allTags.map((t) => (
                      <button key={t} className={`ag-seg${tag === t ? ' on' : ''}`} onClick={() => { tap(); setContactTag(tag === t ? '' : t); setContactSel(new Set()); }}>{t}</button>
                    ))}
                  </div>
                )}
                {loading ? (
                  <EmailSkeleton />
                ) : mergedContacts.length === 0 ? (
                  <div className="ag-contacts-empty">
                    <div className="ag-ce-cluster" aria-hidden="true">
                      <span className="ag-ce-av"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM5 20a7 7 0 0 1 14 0" /></svg></span>
                      <span className="ag-ce-av ag-ce-av-mid"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM5 20a7 7 0 0 1 14 0" /></svg></span>
                      <span className="ag-ce-av"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM5 20a7 7 0 0 1 14 0" /></svg></span>
                    </div>
                    <div className="ag-ce-title">Your people, in one place</div>
                    <p className="ag-ce-sub">Keep everyone you email here — tag them into segments and reach a whole group in one send.</p>
                    <button className="ag-send-btn ag-ce-cta" onClick={() => openContactForm()}>+ Add your first contact</button>
                  </div>
                ) : list.length === 0 ? (
                  <div className="ag-empty">{tag ? 'No one in this segment matches.' : 'No matches.'}</div>
                ) : (
                  <ContactsList items={list} selectable={contactSelMode} selected={contactSel} onToggle={toggleContact} onEdit={openContactForm} />
                )}
                {contactSelMode && contactSel.size > 0 && (
                  <button className="ag-send-btn ag-contacts-action" onClick={emailSelected}>
                    Email {contactSel.size} {contactSel.size === 1 ? 'person' : 'people'} →
                  </button>
                )}
              </>
            );
          })()}

          {cForm && (
            <>
              <div className="ag-confirm-scrim" onClick={() => { tap(); setCForm(null); }} />
              <div className="ag-confirm ag-cform" role="dialog" aria-label="Contact">
                <div className="ag-cf-avatar" aria-hidden="true">
                  {(() => {
                    const nm = cForm.name.trim();
                    const init = nm ? nm.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : '';
                    return init ? <span>{init}</span> : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM5 20a7 7 0 0 1 14 0" /></svg>
                    );
                  })()}
                </div>
                <div className="ag-cf-title">{cForm.id ? 'Edit contact' : 'New contact'}</div>
                <div className="ag-cf-card">
                  <label className="ag-cf-row">
                    <span className="ag-cf-k">Name</span>
                    <input className="ag-cf-v" placeholder="Full name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} />
                  </label>
                  <label className="ag-cf-row">
                    <span className="ag-cf-k">Email <span className="ag-cf-req">*</span></span>
                    <input className="ag-cf-v" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="name@email.com" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} />
                  </label>
                </div>
                <div className="ag-cf-seg">
                  {cForm.tags.split(',').map((s) => s.trim()).filter(Boolean).map((t) => (
                    <button key={t} className="ag-cf-chip" onClick={() => setCForm((f) => f ? { ...f, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => x !== t).join(', ') } : f)}>{t} <span className="ag-cf-chip-x">✕</span></button>
                  ))}
                  <input
                    className="ag-cf-chip-in" placeholder="+ segment" autoCapitalize="none" autoCorrect="off" value={cTag}
                    onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) { setCForm((f) => f ? { ...f, tags: addTagStr(f.tags, v.slice(0, -1)) } : f); setCTag(''); } else setCTag(v); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setCForm((f) => f ? { ...f, tags: addTagStr(f.tags, cTag) } : f); setCTag(''); } }}
                    onBlur={() => { if (cTag.trim()) { setCForm((f) => f ? { ...f, tags: addTagStr(f.tags, cTag) } : f); setCTag(''); } }}
                  />
                </div>
                <div className="ag-cform-hint">Segments let you email a whole group at once.</div>
                {cFormErr && <div className="ag-send-err">{cFormErr}</div>}
                <div className="ag-cform-actions">
                  {cForm.id && <button className="ag-send-btn ghost ag-cform-del" onClick={delCForm}>Delete</button>}
                  <button className="ag-send-btn ghost" onClick={() => { tap(); setCForm(null); }}>Cancel</button>
                  <button className="ag-send-btn" disabled={cFormBusy || !EMAIL_RE.test(cForm.email.trim().toLowerCase())} onClick={saveCForm}>{cFormBusy ? 'Saving…' : 'Save contact'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : emailTab === 'compose' ? (
        <div className="ag-stage ag-compose">
          {!mailConnected ? connectCard('Link this mailbox so the agent can send on your behalf.')
            : (
              <>
                {(replyThreadId || forwarding) ? (
                  // Replies and forwards always go from the mailbox that
                  // received the mail — show the real address, nothing to choose.
                  <div className="ag-from">
                    <span className="ag-from-lbl">From</span>
                    {/* Show the To address only when it's actually one of the user's
                        own mailboxes (they were the direct recipient) — otherwise a
                        Cc'd/list mail would claim the reply comes from a stranger. */}
                    <span className="ag-from-fixed">{(readingTo && Object.values(acctEmails).some((e) => e && e.toLowerCase() === readingTo.toLowerCase()) ? readingTo : acctEmails[sendApp]) || (sendApp === 'outlook' ? 'Outlook' : 'Gmail')}</span>
                  </div>
                ) : mailApiApps.length >= 2 ? (
                  <div className="ag-from">
                    <span className="ag-from-lbl">From</span>
                    <select className="ag-field ag-from-sel" value={sendApp} onChange={(e) => { tap(); setSendApp(e.target.value as 'gmail' | 'outlook'); }}>
                      {mailApiApps.map((a) => <option key={a} value={a}>{acctEmails[a] || (a === 'outlook' ? 'Outlook' : 'Gmail')}</option>)}
                    </select>
                  </div>
                ) : acctEmails[sendApp] ? (
                  <div className="ag-from">
                    <span className="ag-from-lbl">From</span>
                    <span className="ag-from-fixed">{acctEmails[sendApp]}</span>
                  </div>
                ) : null}
                <div className="ag-to-row">
                  <input
                    className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                    placeholder="To" value={to} onChange={(e) => { setTo(e.target.value); if (!toPicker) setToPicker(true); }}
                    onFocus={() => { if (mergedContacts.length) setToPicker(true); }}
                  />
                  {mergedContacts.length > 0 && (
                    <button className="ag-to-pick" onClick={() => { tap(); setToPicker((v) => !v); }} aria-label="Choose from contacts"><IconContacts size={18} /></button>
                  )}
                {toPicker && mergedContacts.length > 0 && (() => {
                  const q = to.trim().toLowerCase();
                  const matches = mergedContacts.filter((c) => c.email && (!q || `${c.name} ${c.email}`.toLowerCase().includes(q))).slice(0, 30);
                  return matches.length ? (
                    <div className="ag-contact-pop">
                      {matches.map((c, i) => (
                        <button className="ag-contact-opt" key={`${c.email}-${i}`} onClick={() => { tap(); setTo(c.email || ''); setToPicker(false); }}>
                          <span className="ag-contact-nm">{c.name || c.email}</span>
                          {c.name && <span className="ag-contact-em">{c.email}</span>}
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
                </div>
                {!showCc ? (
                  <button
                    className="ag-cc-toggle"
                    onClick={() => { tap(); setShowCc(true); }}
                    style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '2px', fontSize: 13, cursor: 'pointer' }}
                  >Add Cc / Bcc</button>
                ) : (
                  <>
                    <input className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                      placeholder="Cc (comma-separated)" value={cc} onChange={(e) => setCc(e.target.value)} onFocus={() => setToPicker(false)} />
                    <input className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                      placeholder="Bcc (comma-separated)" value={bcc} onChange={(e) => setBcc(e.target.value)} onFocus={() => setToPicker(false)} />
                  </>
                )}
                <input className="ag-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => setToPicker(false)} />
                {!forwarding && tplList.length > 0 && (
                  // Dropdown picker: stays on the placeholder (value is pinned
                  // to '') and applies whichever template gets picked. Hidden
                  // on forwards — you forward the original, not a template.
                  <select
                    className="ag-field ag-tpl-select"
                    value=""
                    onChange={(e) => {
                      const t = tplList.find((x) => x.id === e.target.value);
                      if (t) { tap(); applyComposeTemplate(t); }
                    }}
                  >
                    <option value="" disabled>Use a template…</option>
                    {tplList.map((t) => (
                      <option key={t.id} value={t.id}>{t.name || t.subject}</option>
                    ))}
                  </select>
                )}
                {forwarding && composeKind === 'html' && (
                  <input className="ag-field" placeholder="Add a message (optional)" value={fwdNote} onChange={(e) => setFwdNote(e.target.value)} onFocus={() => setToPicker(false)} />
                )}
                {composeKind === 'html' ? (
                  <div className="ag-tpl-preview">
                    <div className="ag-tpl-preview-bar"><span>{forwarding ? 'Forwarded message' : 'Designed template'}</span><button onClick={() => { tap(); setComposeKind('text'); setBodyText(''); }}>✕ Write plain text</button></div>
                    <iframe className="ag-tpl-frame" title="Email preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={buildSrcDoc(forwarding ? bodyText : fillMergeTags(bodyText))} />
                  </div>
                ) : (
                  <textarea className="ag-field ag-body" placeholder="Write your message…" value={bodyText} onChange={(e) => setBodyText(e.target.value)} onFocus={() => setToPicker(false)} />
                )}
                {sendErr && <div className="ag-send-err">{sendErr}</div>}
                {!sendErr && sendState === 'err' && <div className="ag-send-err">Couldn’t send — check the address and try again.</div>}
                <button
                  className="ag-send-btn"
                  onClick={doSend}
                  disabled={!validTo || !bodyText.trim() || (forwarding && fwdLoading)}
                >
                  {forwarding && fwdLoading ? 'Loading original…' : replyThreadId ? 'Send reply' : forwarding ? 'Forward' : 'Send'}
                </button>
              </>
            )}
        </div>
      ) : (
        // mail workspace home (action grid)
        <div className="ag-stage">
          {!mailConnected && connectCard('Link this mailbox so the agent can read, draft and send.')}
          <div className="ag-grid">
            {EMAIL_ACTIONS.map((act) => {
              return (
                <button
                  key={act.id}
                  className="ag-act"
                  onClick={() => {
                    tap();
                    if (act.id === 'inbox') setEmailTab('inbox');
                    else if (act.id === 'new') openCompose();
                    else if (act.id === 'contacts') setEmailTab('contacts');
                    else if (act.id === 'broadcast') { setCommsApp(null); setInboxHome(false); setSendraTab('campaigns'); openCampNew(); }
                    else if (act.id === 'sequence') { setCommsApp(null); setInboxHome(false); setSendraTab('automations'); }
                  }}
                >
                  <span className="ag-act-ic"><act.icon size={20} /></span>
                  <span className="ag-act-label">{act.label}</span>
                  <span className="ag-act-sub">{act.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      </div>
      <div className={`ag-drawer-wrap${drawerOpen ? ' open' : ''}`} role="dialog" aria-label="Sendra menu">
          <div className="ag-drawer-scrim" onClick={() => { tap(); setDrawerOpen(false); }} />
          <nav className="ag-drawer">
            <div className="ag-drawer-head">
              <img className="ag-drawer-logo" src={SENDRA_LOGO} alt="" aria-hidden />
              <span className="ag-drawer-brand">Sendra<span>Email</span></span>
              <button className="ag-drawer-x" onClick={() => { tap(); setDrawerOpen(false); }} aria-label="Close menu"><IconX size={18} /></button>
            </div>
            <div className="ag-drawer-nav">
              {HOME_TOOLS.map((t) => {
                const active = t.id === 'inbox' ? (!!commsApp && commsApp !== 'telegram' && emailTab === 'inbox')
                  : t.id === 'contacts' ? (!!commsApp && commsApp !== 'telegram' && emailTab === 'contacts')
                  : (!commsApp && sendraTab === t.id);
                return (
                  <button key={t.id} className={`ag-drawer-item${active ? ' on' : ''}`} onClick={() => navTo(t.id)}>
                    <span className="ag-drawer-ic"><t.Icon size={19} /></span>
                    <span className="ag-drawer-label">{t.name}</span>
                  </button>
                );
              })}
            </div>
            <button className="ag-drawer-exit" onClick={() => { tap(); onClose(); }}><IconArrowLeft size={16} /> Close Sendra</button>
          </nav>
        </div>
    </div>
  );
}
