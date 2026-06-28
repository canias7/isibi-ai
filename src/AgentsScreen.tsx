import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconInbox, IconRefresh, IconCheck, IconContacts,
  IconDoc, IconChat, IconPlus, IconArrowUp, IconX, IconCopy,
  IconCalendar, IconWebhook, IconSettings, IconChart, IconGlobe,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox, fetchInboxMergedPaged, sendEmail, fetchContacts, listSavedContacts, addSavedContact, updateSavedContact, deleteSavedContact, sendSms, smsStatus, searchSmsNumbers, buySmsNumber, releaseSmsNumber, listCampaigns, createCampaign, sendCampaignBatch, unscheduleCampaign, campaignStats, type CampaignStats, listLogs, type EmailLog, getDeliverability, type Reputation, listWebhooks, addWebhook, removeWebhook, toggleWebhook, testWebhook, listAutomations, saveAutomation, toggleAutomation, removeAutomation, listSuppressions, removeSuppression, listTemplates, saveTemplate, deleteTemplate, chatTemplateStart, getTemplateJob, type TemplateJob, uploadEmailImage, tgChats, tgMessages, tgSend, type TgChat, type TgMessage, type Campaign, type SmsNumber, type WebhookEndpoint, type Automation, type AutomationStep, type SavedContact, type Suppression, type Template, type ChatMsg } from './api';
import { EmailList, EmailDetail, EmailSkeleton, ContactsList, buildSrcDoc, type EmailItem, type ContactItem } from './EmailList';
import { mailerListDomains, mailerAddDomain, mailerDomainRecords, mailerVerifyDomain, mailerRemoveDomain, mailerSend, type SendingDomain, type DnsRecord } from './mailer';
import { discoverDomainConnect, type DcSupport } from './domainConnect';

// Sendra is the comms agent (Gmail, Outlook & Telegram in one place). The app's
// home screen picks the agent, so this screen opens straight into Sendra's workspace.
type AgentId = 'email';
type IconCmp = typeof IconCompose;

// The communication apps Sendra can manage. `mail` apps (Gmail/Outlook) share the
// email workspace (inbox/compose/contacts); telegram has its own chat workspace.
type CommsId = 'gmail' | 'm365' | 'telegram';

// Sendra home tabs + their header copy.
type SendraTab = 'home' | 'texts' | 'campaigns' | 'templates' | 'domains' | 'schedule' | 'webhook' | 'logs' | 'deliver' | 'automations' | 'settings';
const SENDRA_META: Record<SendraTab, { t: string; s: string }> = {
  home: { t: 'Sendra', s: 'Your communication hub' },
  texts: { t: 'Text', s: 'Send an SMS' },
  campaigns: { t: 'Campaigns', s: 'Email & SMS to your lists' },
  templates: { t: 'Templates', s: 'Reusable messages' },
  domains: { t: 'Domains', s: 'Send from your own address' },
  schedule: { t: 'Schedule', s: 'Scheduled sends & reminders' },
  webhook: { t: 'Webhooks', s: 'Post events to your systems' },
  logs: { t: 'Logs', s: 'Every email sent & what happened' },
  deliver: { t: 'Deliverability', s: 'Are your emails landing?' },
  automations: { t: 'Automations', s: 'Drip sequences on autopilot' },
  settings: { t: 'Settings', s: 'Sender, reply-to & preferences' },
};
// Sendra home menu. 'inbox'/'contacts' open the mail workspace; the rest are tabs/scaffolds.
const HOME_TOOLS: { id: SendraTab | 'inbox' | 'contacts'; name: string; desc: string; Icon: IconCmp }[] = [
  { id: 'inbox', name: 'Inbox', desc: 'All your mail', Icon: IconInbox },
  { id: 'contacts', name: 'Contacts', desc: 'Your people', Icon: IconContacts },
  { id: 'texts', name: 'Text', desc: 'Send an SMS', Icon: IconChat },
  { id: 'campaigns', name: 'Campaigns', desc: 'Email & SMS', Icon: IconWaveform },
  { id: 'logs', name: 'Logs', desc: 'Every email sent', Icon: IconClock },
  { id: 'deliver', name: 'Deliverability', desc: 'Are emails landing?', Icon: IconChart },
  { id: 'domains', name: 'Domains', desc: 'Send from your address', Icon: IconGlobe },
  { id: 'templates', name: 'Templates', desc: 'Reusable messages', Icon: IconDoc },
  { id: 'webhook', name: 'Webhooks', desc: 'Post events out', Icon: IconWebhook },
  { id: 'automations', name: 'Automations', desc: 'Drip sequences', Icon: IconWaveform },
  { id: 'schedule', name: 'Schedule', desc: 'Plan sends ahead', Icon: IconCalendar },
  { id: 'settings', name: 'Settings', desc: 'Sender & preferences', Icon: IconSettings },
];

// The mail workspace's top cards. Inbox / New email / Contacts are live; rest are stubs.
const EMAIL_ACTIONS: { id: string; label: string; sub: string; icon: IconCmp }[] = [
  { id: 'inbox', label: 'Inbox', sub: 'View mail', icon: IconInbox },
  { id: 'new', label: 'New email', sub: 'Single send', icon: IconCompose },
  { id: 'sequence', label: 'Sequence', sub: 'Multi-step', icon: IconLayers },
  { id: 'broadcast', label: 'Broadcast', sub: 'To a list', icon: IconWaveform },
  { id: 'contacts', label: 'Contacts', sub: 'People', icon: IconContacts },
];

const PAGE_SIZE = 20;       // emails per page (kept small — GMAIL_FETCH_EMAILS is slow at high counts)
const PULL_THRESHOLD = 64;  // px of pull-down that triggers a refresh
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent] = useState<AgentId | null>('email'); // home already chose the agent; open straight into Sendra
  const [commsApp, setCommsApp] = useState<CommsId | null>(null); // null while Sendra shows its home / the app constellation
  const [sendraTab, setSendraTab] = useState<SendraTab>('home'); // Sendra landing: 'home' menu -> 'apps' / scaffolds
  const [note, setNote] = useState(''); // transient explainer shown in the P0 scaffolds
  // Mail workspace
  const [emailTab, setEmailTab] = useState<EmailTab>('home');
  const [inbox, setInbox] = useState<EmailItem[]>([]);
  const [inboxState, setInboxState] = useState<Loadable>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextTok, setNextTok] = useState<string | null>(null);
  const [mergedTok, setMergedTok] = useState<Record<string, string | null>>({}); // combined inbox: each mailbox's next-page token
  const [reading, setReading] = useState<EmailItem | null>(null);
  const [pull, setPull] = useState(0);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactsState, setContactsState] = useState<Loadable>('idle');
  const [contactSearch, setContactSearch] = useState('');           // filter the contacts list
  const [contactSelMode, setContactSelMode] = useState(false);      // multi-select mode
  const [contactSel, setContactSel] = useState<Set<string>>(new Set()); // selected emails
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>([]); // Sendra's own address book
  const [cForm, setCForm] = useState<{ id?: string; name: string; email: string; phone: string; tags: string } | null>(null); // add/edit overlay
  const [contactTag, setContactTag] = useState('');                 // active segment filter ('' = all)
  const [cFormBusy, setCFormBusy] = useState(false);
  const [cFormErr, setCFormErr] = useState('');
  // Compose / reply state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [composeKind, setComposeKind] = useState<'text' | 'html'>('text'); // 'html' once a designed template is applied
  const [toPicker, setToPicker] = useState(false); // contacts dropdown under the To field
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
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
  // SMS composer (the platform's built-in Twilio sender)
  const [smsTo, setSmsTo] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [smsState, setSmsState] = useState<SendState>('idle');
  const [smsErr, setSmsErr] = useState('');
  // SMS: platform-provisioned Twilio number (per user, bought in-app)
  const [smsReady, setSmsReady] = useState<boolean | null>(null); // null = loading
  const [smsNumber, setSmsNumber] = useState<string | null>(null);
  const [numArea, setNumArea] = useState('');
  const [numResults, setNumResults] = useState<SmsNumber[]>([]);
  const [numBusy, setNumBusy] = useState(false);   // searching
  const [numErr, setNumErr] = useState('');
  const [buyingNum, setBuyingNum] = useState('');  // phoneNumber being purchased
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
  const [logsList, setLogsList] = useState<EmailLog[]>([]);
  const [logsQ, setLogsQ] = useState('');
  const [logsBusy, setLogsBusy] = useState(false);
  // Deliverability insights (Deliverability tab)
  const [deliv, setDeliv] = useState<{ reputation: Reputation } | null>(null);
  const [delivBusy, setDelivBusy] = useState(false);
  // Campaign views + the campaign "From" picker
  const [campView, setCampView] = useState<'list' | 'suppressions' | 'stats'>('list');
  const [campStats, setCampStats] = useState<{ campaign: Campaign; stats: CampaignStats; ab?: { a: { sent: number; opened: number; clicked: number }; b: { sent: number; opened: number; clicked: number } } | null } | null>(null);
  const [campStatsBusy, setCampStatsBusy] = useState(false);
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
  const [campDomain, setCampDomain] = useState(''); // '' = mailbox; else a verified self-hosted domain
  const [campFromName, setCampFromName] = useState(''); // display name when sending built-in or from a domain
  const [campFromLocal, setCampFromLocal] = useState('news'); // local-part of the From address when sending from a domain
  // Custom sending domains (self-hosted, via the `mailer` fn) — the Domains tab +
  // the composer's verified-domain options (sent once the mail server is connected).
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [domNew, setDomNew] = useState('');     // the "add a domain" input
  const [domBusy, setDomBusy] = useState(false); // add in flight
  const [domErr, setDomErr] = useState('');      // add error message
  const [domOpen, setDomOpen] = useState<string | null>(null); // which domain's records are expanded
  const [domVerifying, setDomVerifying] = useState('');  // domain currently being re-verified
  const [domRecords, setDomRecords] = useState<Record<string, DnsRecord[]>>({}); // per-domain DNS records
  const [domChecks, setDomChecks] = useState<Record<string, { dkim: boolean; spf: boolean }>>({}); // last verify detail
  const [dcInfo, setDcInfo] = useState<Record<string, DcSupport>>({}); // Domain Connect discovery per domain
  const [dcBusy, setDcBusy] = useState('');     // domain whose auto-configure is running
  const [testTo, setTestTo] = useState<Record<string, string>>({});   // per-domain test recipient
  const [testBusy, setTestBusy] = useState('');  // domain whose test send is in flight
  const [testMsg, setTestMsg] = useState<Record<string, string>>({}); // per-domain test result
  const domPollRef = useRef(0); // background re-verify ticks while a domain is pending (capped)
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
  useEffect(() => () => { mountedRef.current = false; }, []);
  const builderGenRef = useRef(0); // bumped on every AI-builder session change; an in-flight job whose gen no longer matches is dropped (never applied/saved to the wrong template)

  // Restore an unsaved builder draft on open (survives app close, Lovable-style).
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(TPL_DRAFT_KEY) || 'null');
      if (d && (d.body || (Array.isArray(d.chat) && d.chat.length))) {
        builderGenRef.current++; // a fresh builder session, like every other entry point
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
    try { localStorage.setItem(TPL_DRAFT_KEY, JSON.stringify({ id: tplEdit.id, name: tplName, subject: tplSubject, body: tplBody, chat: chatMsgs, view: chatView === 'history' ? 'chat' : chatView, versions: tplVersions, pending: pendingImg })); } catch { /* ignore */ }
  }, [tplEdit, tplName, tplSubject, tplBody, chatMsgs, chatView, tplVersions, pendingImg]);
  const clearDraft = () => { try { localStorage.removeItem(TPL_DRAFT_KEY); } catch { /* ignore */ } };

  // Which provider the mail workspace is talking to (Composio app id -> our param).
  const mailApp = commsApp === 'm365' ? 'outlook' : 'gmail';
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
    const own: ContactItem[] = savedContacts.map((c) => ({ id: c.id, name: c.name, email: c.email || undefined, phone: c.phone || undefined, tags: c.tags?.length ? c.tags : undefined }));
    const seen = new Set(own.map((c) => (c.email || '').toLowerCase()).filter(Boolean));
    return [...own, ...contacts.filter((c) => !c.email || !seen.has(c.email.toLowerCase()))];
  })();

  // Back steps one level: reader -> sub-view -> workspace -> deck -> list -> close.
  const back = () => {
    tap();
    if (reading) setReading(null);
    else if (tgChat) setTgChat(null);
    else if (sendState === 'confirm') setSendState('idle');
    else if (commsApp && commsApp !== 'telegram' && emailTab === 'compose') setEmailTab(inboxHome ? 'inbox' : 'home');
    else if (commsApp && commsApp !== 'telegram' && emailTab !== 'home' && !inboxHome) setEmailTab('home');
    else if (commsApp) { setCommsApp(null); setInboxHome(false); }
    else if (tplEdit && chatView === 'history') setChatView('preview');
    else if (tplEdit && chatView === 'preview') setChatView('chat');
    else if (tplEdit) { builderGenRef.current++; if (tplBody.trim() && !tplSaving) saveTpl(); else { clearDraft(); setTplEdit(null); } } // leaving the builder saves a built email + invalidates any in-flight job

    else if (sendraTab !== 'home') setSendraTab('home');
    else onClose();
  };
  useFocusTrap(true, trapRef, back);

  // ---- mail workspace loaders (provider-aware) ----
  const loadPage = useCallback((idx: number) => {
    setRefreshing(true);
    if (idx === 0 && !inboxCache[mailApp]) setInboxState('loading');
    fetchInbox(PAGE_SIZE, tokensRef.current[idx], mailApp)
      .then(({ items, nextPageToken }) => {
        if (!mountedRef.current) return;
        setInbox(items); setInboxState('ok'); setPageIdx(idx); setNextTok(nextPageToken);
        if (nextPageToken && tokensRef.current.length === idx + 1) tokensRef.current.push(nextPageToken);
        if (idx === 0) inboxCache[mailApp] = items;
        inboxScrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => { if (mountedRef.current && idx === 0 && !inboxCache[mailApp]) setInboxState('err'); })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, [mailApp]);
  const refreshInbox = useCallback(() => { tokensRef.current = [undefined]; loadPage(0); }, [loadPage]);
  // Combined inbox (2+ mailboxes): one merged, newest-first feed. Each mailbox
  // pages independently, so we keep a per-provider next-page token and append.
  const combinedApps = useCallback(() => ['gmail', 'outlook'].filter((a) => (a === 'gmail' ? connApps.includes('gmail') : connApps.includes('m365') || connApps.includes('outlook'))), [connApps]);
  const loadMerged = useCallback(() => {
    setRefreshing(true);
    if (!inboxCache['all']) setInboxState('loading');
    fetchInboxMergedPaged(combinedApps().map((a) => ({ app: a })))
      .then(({ items, next }) => {
        if (!mountedRef.current) return;
        setInbox(items); setInboxState('ok'); inboxCache['all'] = items; setMergedTok(next);
        inboxScrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => { if (mountedRef.current && !inboxCache['all']) setInboxState('err'); })
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
      })
      .catch(() => { /* keep what we have */ })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  };

  const loadContacts = useCallback(() => {
    if (!contactsCache[mailApp]) setContactsState('loading');
    fetchContacts(mailApp)
      .then((items) => { if (mountedRef.current) { contactsCache[mailApp] = items; setContacts(items); setContactsState('ok'); } })
      .catch(() => { if (mountedRef.current && !contactsCache[mailApp]) setContactsState('err'); });
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

  // Load campaigns (Campaigns tab) and templates (Campaigns builder picker + the
  // Templates tab) when those tabs open.
  useEffect(() => {
    if (agent !== 'email' || commsApp !== null) return;
    if ((sendraTab === 'campaigns' && !campNew) || sendraTab === 'schedule') listCampaigns().then((c) => { if (mountedRef.current) setCampList(c); });
    if (sendraTab === 'texts') smsStatus().then((s) => { if (mountedRef.current) { setSmsReady(s.ready); setSmsNumber(s.number); } });
    if (sendraTab === 'campaigns' || sendraTab === 'templates') listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    if (sendraTab === 'logs') { setLogsBusy(true); listLogs('').then((l) => { if (mountedRef.current) { setLogsList(l); setLogsBusy(false); } }).catch(() => { if (mountedRef.current) setLogsBusy(false); }); }
    if (sendraTab === 'deliver') { setDelivBusy(true); getDeliverability().then((d) => { if (mountedRef.current) { setDeliv(d); setDelivBusy(false); } }).catch(() => { if (mountedRef.current) setDelivBusy(false); }); }
    // Verified domains feed the composer's "Send from" picker; the Domains tab needs the full list.
    if (sendraTab === 'campaigns' || sendraTab === 'domains' || sendraTab === 'automations') mailerListDomains().then((d) => { if (mountedRef.current) setDomains(d); });
    if (sendraTab === 'automations') loadAutomations();
  }, [agent, commsApp, sendraTab, campNew]);

  // While the Domains tab is open and a domain is still pending, re-check DNS in the
  // background every 20s (capped) so a freshly-added domain flips to verified on its own.
  useEffect(() => {
    if (agent !== 'email' || commsApp !== null || sendraTab !== 'domains') { domPollRef.current = 0; return; }
    const pending = domains.some((d) => !d.verified);
    if (!pending || domPollRef.current > 15) return;
    const id = setTimeout(async () => {
      domPollRef.current += 1;
      const fresh = await mailerListDomains().catch(() => null);
      if (mountedRef.current && fresh) setDomains(fresh);
    }, 20000);
    return () => clearTimeout(id);
  }, [agent, commsApp, sendraTab, domains]);

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
  const toggleContact = (email: string) => setContactSel((s) => {
    const n = new Set(s);
    if (n.has(email)) n.delete(email); else n.add(email);
    return n;
  });
  // Selected contacts -> prefill a new campaign (the bulk-send engine handles the rest).
  const emailSelected = () => {
    const picked = mergedContacts.filter((c) => c.email && contactSel.has(c.email));
    if (!picked.length) return;
    tap();
    const recips = picked.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)).join('\n');
    setReading(null); setCommsApp(null); setInboxHome(false);
    setSendraTab('campaigns');
    openCampNew();
    setCampRecips(recips);
    setContactSelMode(false); setContactSel(new Set());
  };
  // Whole segment (tag) -> prefill a new campaign with everyone carrying that label.
  const emailSegment = (tag: string) => {
    const picked = mergedContacts.filter((c) => c.email && c.tags?.includes(tag));
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
  const openContactForm = (c?: ContactItem) => { tap(); setCFormErr(''); setCForm({ id: c?.id, name: c?.name || '', email: c?.email || '', phone: c?.phone || '', tags: c?.tags?.join(', ') || '' }); };
  const saveCForm = async () => {
    if (!cForm || cFormBusy) return;
    const name = cForm.name.trim(), email = cForm.email.trim(), phone = cForm.phone.trim();
    const tags = cForm.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (!name && !email) return;
    setCFormBusy(true); setCFormErr('');
    try {
      const r = cForm.id ? await updateSavedContact(cForm.id, { name, email, phone, tags }) : await addSavedContact({ name, email, phone, tags });
      if (!mountedRef.current) return;
      if (r.error) setCFormErr(r.error === 'bad_email' ? 'Enter a valid email address.' : 'Couldn’t save — try again.');
      else { setCForm(null); await loadSaved(); }
    } catch { if (mountedRef.current) setCFormErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setCFormBusy(false); }
  };
  const delCForm = async () => {
    if (!cForm?.id) { setCForm(null); return; }
    tap();
    await deleteSavedContact(cForm.id).catch(() => {});
    if (mountedRef.current) { setCForm(null); await loadSaved(); }
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
    setReplyThreadId(null); setTo(''); setSubject(''); setBodyText(''); setComposeKind('text'); setToPicker(false);
    setSendState('idle'); setSendApp(mailApp); setEmailTab('compose');
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
    tap();
    const subj = reading.subject || '';
    setReplyThreadId(reading.threadId || null);
    setTo(reading.email || '');
    setSubject(/^re:/i.test(subj) ? subj : `Re: ${subj}`);
    setBodyText('');
    setSendState('idle');
    setSendApp(reading.app === 'outlook' ? 'outlook' : 'gmail'); // reply through the email's own mailbox
    setReading(null);
    setEmailTab('compose');
  };
  const validTo = EMAIL_RE.test(to.trim());
  const doSend = () => {
    tap();
    setSendState('sending');
    sendEmail({ to: to.trim(), subject: subject.trim(), body: bodyText, threadId: replyThreadId || undefined, app: sendApp, html: composeKind === 'html' })
      .then(() => { if (mountedRef.current) setSendState('sent'); })
      .catch(() => { if (mountedRef.current) setSendState('err'); });
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

  // SMS send (platform Twilio). Errors come back as codes -> friendly copy.
  const smsFriendly = (code: string): string => {
    if (/sms_unset/i.test(code)) return 'Texting isn’t switched on yet — add the Twilio keys on the server.';
    if (/bad_number/i.test(code)) return 'That number doesn’t look right — include the country code, e.g. +1 555 123 4567.';
    if (/missing_body/i.test(code)) return 'Type a message first.';
    if (/too_long/i.test(code)) return 'That message is too long.';
    if (/rate_limited/i.test(code)) return 'Daily text limit reached — try again tomorrow.';
    if (/send_failed/i.test(code)) return 'Couldn’t send — check the number and try again.';
    return 'Couldn’t send — please try again.';
  };
  const doSearchNumbers = async () => {
    if (numBusy) return;
    tap(); setNumBusy(true); setNumErr(''); setNumResults([]);
    try {
      const r = await searchSmsNumbers(numArea.trim() || undefined);
      if (!mountedRef.current) return;
      if (r.error) setNumErr(r.error === 'sms_unset' ? 'SMS isn’t set up on this workspace yet.' : 'Couldn’t search numbers — try again.');
      else if (!r.numbers.length) setNumErr('No numbers found — try a different area code, or leave it blank.');
      else setNumResults(r.numbers);
    } catch { if (mountedRef.current) setNumErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setNumBusy(false); }
  };
  const doBuyNumber = async (phone: string) => {
    if (buyingNum) return;
    tap(); setBuyingNum(phone); setNumErr('');
    try {
      const r = await buySmsNumber(phone);
      if (!mountedRef.current) return;
      if (r.error) {
        setNumErr(
          r.error === 'already_provisioned' ? 'You already have a number — release it first to get a new one.'
            : r.error === 'sms_unset' ? 'SMS isn’t set up on this workspace yet.'
              : 'Couldn’t get that number — it may have just been taken. Try another.');
      } else { setSmsReady(true); setSmsNumber(r.number || phone); setNumResults([]); setNumArea(''); }
    } catch { if (mountedRef.current) setNumErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setBuyingNum(''); }
  };
  const doReleaseNumber = async () => {
    tap();
    try { await releaseSmsNumber(); } catch { /* ignore */ }
    if (mountedRef.current) { setSmsReady(false); setSmsNumber(null); }
  };
  const validSmsTo = /^\+?[\d\s().-]{7,}$/.test(smsTo.trim());
  const doSendSms = () => {
    if (!validSmsTo || !smsBody.trim() || smsState === 'sending') return;
    tap();
    setSmsState('sending'); setSmsErr('');
    sendSms(smsTo.trim(), smsBody.trim())
      .then(() => { if (mountedRef.current) { setSmsState('sent'); setSmsBody(''); } })
      .catch((e) => { if (mountedRef.current) { setSmsState('err'); setSmsErr(smsFriendly(String((e as Error)?.message || ''))); } });
  };

  // ---- Email campaign builder ----
  // Plain text -> simple HTML (escape + line breaks); {{name}} survives for the
  // backend to personalize. Recipients: one per line/comma, "email" or "Name <email>".
  const campToHtml = (t: string) => t.split('\n').map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>');
  const parseRecips = (t: string) => t.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((tok) => {
    const m = tok.match(/^(.*?)\s*<([^>]+)>$/);
    return m ? { email: m[2].trim(), name: m[1].trim() || undefined } : { email: tok };
  });
  const openCampNew = () => {
    tap(); setCampNew(true); setCampState('idle'); setCampErr('');
    setCampSubject(''); setCampBody(''); setCampBodyKind('text'); setCampRecips(''); setCampProg({ sent: 0, total: 0, failed: 0 });
    setCampAb(false); setCampSubjectB(''); setCampBodyB('');
    setCampApp(connApps.includes('gmail') ? 'gmail' : 'outlook');
    setCampDomain(''); setCampFromName(''); setCampFromLocal('news');
    setCampWhen('now'); setCampSchedAt('');
  };
  const cancelScheduled = async (id: string) => {
    tap();
    try { await unscheduleCampaign(id); const cl = await listCampaigns(); if (mountedRef.current) setCampList(cl); } catch { /* ignore */ }
  };
  const openCampStats = async (c: Campaign) => {
    tap(); setCampView('stats'); setCampStatsBusy(true);
    setCampStats({ campaign: c, stats: { total: c.total, sent: c.sent, failed: c.failed, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 } });
    try {
      const r = await campaignStats(c.id);
      if (!mountedRef.current) return;
      if (r.campaign && r.stats) setCampStats({ campaign: r.campaign, stats: r.stats, ab: r.ab ?? null });
    } catch { /* keep the optimistic values */ }
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
      if (!mountedRef.current) return;
      if (c.scheduled) { setCampState('scheduled'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
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
      let done = false;
      while (!done) {
        const r = await sendCampaignBatch(c.id);
        if (!mountedRef.current) return;
        if (r.paused) { setCampState('err'); setCampErr('Sending paused — your recent bounce or complaint rate is too high. Clean your list, then try again.'); return; }
        setCampProg((p) => ({ total: p.total, sent: p.sent + r.sent, failed: p.failed + r.failed }));
        // Warm-up cap hit for now: a new sending domain ramps volume gradually to protect
        // deliverability. The rest keeps sending automatically (server cron) — stop the
        // client loop and show a reassuring panel rather than spinning.
        if (r.warmup) { setCampState('warmup'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
        // Mail server briefly unreachable: the server keeps retrying (durable queue),
        // so stop the client loop and reassure rather than spin.
        if (r.retry) { setCampState('retry'); listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); }); return; }
        done = r.done;
      }
      setCampState('done');
      listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); });
    } catch {
      if (mountedRef.current) { setCampState('err'); setCampErr('Something went wrong while sending — check your connection and try again.'); }
    }
  };

  // Copy a value to the clipboard with a brief "Copied" flash (webhook secret + DNS records).
  const copyText = (s: string) => { try { navigator.clipboard?.writeText(s); tap(); setCopied(s); setTimeout(() => { if (mountedRef.current) setCopied(''); }, 1500); } catch { /* ignore */ } };

  // ---- Custom sending domains (self-hosted, via the `mailer` fn) ----
  // Add the domain (we generate its DKIM + return the records to publish), then
  // Verify re-checks DNS. Once verified it shows up under the composer's "Send from"
  // and can send a test. Private keys never leave the server.
  const loadDomains = () => mailerListDomains().then((d) => { if (mountedRef.current) setDomains(d); });
  // Silent Domain Connect discovery — populates dcInfo so the UI can show whether
  // the domain's DNS host supports one-click setup (doesn't open anything).
  const runDiscovery = async (domain: string, records: DnsRecord[]) => {
    try { const info = await discoverDomainConnect(domain, records); if (mountedRef.current) setDcInfo((m) => ({ ...m, [domain]: info })); } catch { /* ignore */ }
  };
  const addDomain = async () => {
    const d = domNew.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d || domBusy) return;
    tap(); setDomBusy(true); setDomErr('');
    try {
      const r = await mailerAddDomain(d);
      if (!mountedRef.current) return;
      setDomRecords((m) => ({ ...m, [r.domain]: r.records }));
      setDomNew(''); setDomOpen(r.domain); domPollRef.current = 0;
      await loadDomains();
      runDiscovery(r.domain, r.records);
    } catch (e) { if (mountedRef.current) setDomErr(e instanceof Error ? e.message : 'Couldn’t add the domain — try again.'); }
    finally { if (mountedRef.current) setDomBusy(false); }
  };
  // Lazy-load a domain's records (and discover Domain Connect) when its row expands.
  const openDom = async (domain: string) => {
    tap();
    const next = domOpen === domain ? null : domain;
    setDomOpen(next);
    if (!next) return;
    if (domRecords[domain]) { if (!dcInfo[domain]) runDiscovery(domain, domRecords[domain]); return; }
    try {
      const r = await mailerDomainRecords(domain);
      if (!mountedRef.current) return;
      setDomRecords((m) => ({ ...m, [domain]: r.records }));
      runDiscovery(domain, r.records);
    } catch { /* ignore */ }
  };
  const verifyDom = async (domain: string) => {
    tap(); setDomVerifying(domain);
    try {
      const r = await mailerVerifyDomain(domain);
      if (!mountedRef.current) return;
      setDomChecks((m) => ({ ...m, [domain]: r.checks }));
      setDomains((ds) => ds.map((d) => d.domain === domain ? { ...d, verified: r.verified } : d));
      await loadDomains();
    } catch { /* ignore */ }
    finally { if (mountedRef.current) setDomVerifying(''); }
  };
  const removeDom = async (domain: string) => {
    tap();
    try { await mailerRemoveDomain(domain); if (campDomain === domain) setCampDomain(''); await loadDomains(); } catch { /* ignore */ }
  };
  // Auto-configure: discover the host and, once our template is live, open the
  // one-click apply URL. Until then it just reports whether one-click is available.
  const autoConfigure = async (domain: string) => {
    const recs = domRecords[domain];
    if (!recs || dcBusy) return;
    tap(); setDcBusy(domain);
    try {
      const info = await discoverDomainConnect(domain, recs);
      if (!mountedRef.current) return;
      setDcInfo((m) => ({ ...m, [domain]: info }));
      if (info.applyUrl) window.open(info.applyUrl, '_blank', 'noopener');
    } catch { /* ignore */ }
    finally { if (mountedRef.current) setDcBusy(''); }
  };
  // Send a quick test from a verified domain to confirm delivery end-to-end.
  const sendTest = async (domain: string) => {
    const to = (testTo[domain] || '').trim();
    if (!to || testBusy) return;
    tap(); setTestBusy(domain); setTestMsg((m) => ({ ...m, [domain]: '' }));
    try {
      const r = await mailerSend({ from: `no-reply@${domain}`, to, subject: `Test from ${domain}`, text: `This is a test email sent from ${domain} via Go Farther.`, html: `<p>This is a test email sent from <b>${domain}</b> via Go Farther.</p>` });
      if (!mountedRef.current) return;
      setTestMsg((m) => ({ ...m, [domain]: r.id ? `Sent ✓ (id ${r.id})` : 'Sent ✓' }));
    } catch (e) { if (mountedRef.current) setTestMsg((m) => ({ ...m, [domain]: e instanceof Error ? e.message : 'Couldn’t send — try again.' })); }
    finally { if (mountedRef.current) setTestBusy(''); }
  };

  const loadSuppressions = () => listSuppressions().then((s) => { if (mountedRef.current) setSupList(s); });
  // ---- Logs (per-email activity) ----
  const loadLogs = (q = logsQ) => {
    setLogsBusy(true);
    listLogs(q).then((l) => { if (mountedRef.current) { setLogsList(l); setLogsBusy(false); } }).catch(() => { if (mountedRef.current) setLogsBusy(false); });
  };
  // ---- Deliverability (auth + reputation) ----
  const loadDeliver = () => {
    setDelivBusy(true);
    getDeliverability().then((d) => { if (mountedRef.current) { setDeliv(d); setDelivBusy(false); } }).catch(() => { if (mountedRef.current) setDelivBusy(false); });
  };
  // Derive a display status from a recipient row (engagement is in the timestamps).
  const logStatus = (l: EmailLog): { label: string; cls: string } => {
    if (l.status === 'bounced') return { label: 'Bounced', cls: 'failed' };
    if (l.status === 'complained') return { label: 'Complaint', cls: 'failed' };
    if (l.status === 'failed') return { label: 'Failed', cls: 'failed' };
    if (l.clicked_at) return { label: 'Clicked', cls: 'sent' };
    if (l.opened_at) return { label: 'Opened', cls: 'sent' };
    if (l.delivered_at) return { label: 'Delivered', cls: 'sent' };
    if (l.error) return { label: 'Delayed', cls: 'sending' }; // delivery_delayed note, not yet delivered/bounced
    return { label: 'Sent', cls: 'sending' };
  };
  const removeSup = async (email: string) => {
    tap();
    try { await removeSuppression(email); await loadSuppressions(); } catch { /* ignore */ }
  };

  // ---- Webhooks ----
  const loadAutomations = () => listAutomations().then((a) => { if (mountedRef.current) setAutoList(a); });
  const openAutoNew = () => {
    tap(); setAutoNew(true); setAutoEditId(null); setAutoErr('');
    setAutoName(''); setAutoTag(''); setAutoDomain(''); setAutoApp(connApps.includes('gmail') ? 'gmail' : 'outlook');
    setAutoFromLocal('news'); setAutoFromName(''); setAutoSteps([{ delay_days: 0, subject: '', body: '' }]);
  };
  const openAutoEdit = (a: Automation) => {
    tap(); setAutoNew(true); setAutoEditId(a.id); setAutoErr('');
    setAutoName(a.name); setAutoTag(a.trigger_tag);
    setAutoDomain(a.send_via === 'self' && a.from_email ? a.from_email.split('@')[1] : '');
    setAutoApp(a.app === 'outlook' ? 'outlook' : 'gmail');
    setAutoFromLocal(a.send_via === 'self' && a.from_email ? a.from_email.split('@')[0] : 'news');
    setAutoFromName(a.from_name || '');
    setAutoSteps(a.steps?.length ? a.steps.map((s) => ({ delay_days: s.delay_days, subject: s.subject, body: s.body })) : [{ delay_days: 0, subject: '', body: '' }]);
  };
  const setStep = (i: number, patch: Partial<AutomationStep>) => setAutoSteps((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () => { tap(); setAutoSteps((arr) => [...arr, { delay_days: 3, subject: '', body: '' }]); };
  const removeStep = (i: number) => { tap(); setAutoSteps((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr)); };
  const saveAuto = async () => {
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
  const toggleAuto = async (a: Automation) => { tap(); await toggleAutomation(a.id, !a.enabled).catch(() => {}); if (mountedRef.current) await loadAutomations(); };
  const removeAuto = async (id: string) => { tap(); await removeAutomation(id).catch(() => {}); if (mountedRef.current) await loadAutomations(); };
  const loadWebhooks = () => listWebhooks().then((w) => { if (mountedRef.current) setWebhooks(w); });
  const addWh = async () => {
    const url = whNew.trim();
    if (!url || whBusy) return;
    tap(); setWhBusy(true); setWhErr('');
    try {
      const r = await addWebhook(url);
      if (!mountedRef.current) return;
      if (r.error) setWhErr(r.error === 'bad_url' ? 'Enter a valid HTTPS URL (not localhost or a private address).' : 'Couldn’t add the endpoint — try again.');
      else { setWhNew(''); if (r.endpoint) setWhOpen(r.endpoint.id); await loadWebhooks(); }
    } catch { if (mountedRef.current) setWhErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setWhBusy(false); }
  };
  const removeWh = async (id: string) => {
    tap();
    await removeWebhook(id).catch(() => {});
    if (mountedRef.current) await loadWebhooks();
  };
  const toggleWh = async (w: WebhookEndpoint) => {
    tap();
    await toggleWebhook(w.id, !w.enabled).catch(() => {});
    if (mountedRef.current) await loadWebhooks();
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
    tap(); builderGenRef.current++; setTplEdit({}); setTplName(''); setTplSubject(''); setTplBody(''); setChatMsgs([]); setChatInput(''); setChatErr(''); setChatHistory([]); setTplVersions([]); setPendingImg(null); setChatBusy(false); setTplImgBusy(false); setCopiedIdx(null); setTypeIdx(null); setChatView('chat');
    const pj = loadJob(); // a generation that was still running when the app last closed
    if (pj && pj.editId === 'new') { setChatMsgs([{ role: 'user', content: pj.label }]); resumeJob(pj, 1); }
  };
  const openTplEdit = (t: Template) => {
    tap(); builderGenRef.current++;
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
  const persistTemplate = async (body: string, subject: string, chat: ChatMsg[]) => {
    const b = (body || '').trim();
    if (!b) return;
    const subj = (subject || '').trim() || 'Untitled email';
    const name = (tplName || '').trim() || subj;
    try {
      const r = await saveTemplate({ id: tplEdit?.id, name, subject: subj, body: b, kind: 'html', chat: chat.slice(-40) });
      if (!mountedRef.current) return;
      if (r?.id && !tplEdit?.id) setTplEdit({ id: r.id });
      listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    } catch { /* non-fatal — explicit Save / save-on-exit still cover it */ }
  };
  const pollJob = async (jobId: string): Promise<TemplateJob | null> => {
    const deadline = Date.now() + 240000; // give up after ~4 min
    while (Date.now() < deadline) {
      if (!mountedRef.current) return null; // editor closed — the persisted job resumes later
      try { const res = await getTemplateJob(jobId); const job = res.job; if (job && (job.status === 'done' || job.status === 'error')) return job; } catch { /* network blip — keep polling */ }
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
      const job = await pollJob(pj.jobId);
      if (!mountedRef.current) return;
      if (builderGenRef.current !== myGen) { clearJob(); return; } // builder switched/closed — drop it
      applyJobResult(job, pj.prev, pj.label, assistantIdx);
      setChatBusy(false); setChatJobId(''); clearJob();
      if (job && job.status !== 'error' && job.body) {
        const chat: ChatMsg[] = [{ role: 'user', content: pj.label }, { role: 'assistant', content: job.reply || 'Done.' }];
        persistTemplate(job.body, job.subject || pj.prev.subject, chat);
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
    } catch { if (mountedRef.current) { setChatErr('Couldn’t start — check your connection and try again.'); setChatBusy(false); } clearJob(); return; }
    if (!mountedRef.current || builderGenRef.current !== myGen) return;
    if (start.error || !start.job_id) { setChatErr(start.error === 'ai_unset' ? 'AI builder isn’t set up on the server yet.' : 'Couldn’t start — try again.'); setChatBusy(false); clearJob(); return; }
    setChatJobId(start.job_id);
    saveJob({ jobId: start.job_id, editId: tplEdit?.id || 'new', prev, label, at: Date.now() });
    const job = await pollJob(start.job_id);
    if (!mountedRef.current) return; // editor left — leave the persisted job to resume on return
    if (builderGenRef.current !== myGen) { clearJob(); return; } // switched/closed builder — don't apply to the wrong template
    applyJobResult(job, prev, label, next.length);
    setChatBusy(false); setChatJobId(''); clearJob();
    if (job && job.status !== 'error' && job.body) {
      const chat: ChatMsg[] = [...next, { role: 'assistant', content: job.reply || 'Done.' }];
      persistTemplate(job.body, job.subject || tplSubject, chat);
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

  const inMailInbox = !!commsApp && commsApp !== 'telegram' && emailTab === 'inbox' && !reading;
  const inTgList = commsApp === 'telegram' && !tgChat;
  const refreshSpin = refreshing || (inTgList && tgListState === 'loading');
  const doRefresh = () => { tap(); if (inMailInbox) { if (combinedInbox) loadMerged(); else refreshInbox(); } else if (inTgList) loadTgChats(); };
  const goPage = (idx: number) => { if (refreshing) return; tap(); loadPage(idx); };
  const hasPager = pageIdx > 0 || !!nextTok;
  const mergedMore = combinedInbox && Object.values(mergedTok).some(Boolean);

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
  const title = reading ? 'Email'
    : commsApp === null ? SENDRA_META[sendraTab].t
    : commsApp === 'telegram' ? (tgChat ? tgChat.title : 'Telegram')
    : emailTab === 'inbox' ? 'Inbox'
    : emailTab === 'contacts' ? 'Contacts'
    : emailTab === 'compose' ? (replyThreadId ? 'Reply' : 'New email')
    : (commsApp === 'm365' ? 'Outlook' : 'Gmail');
  const subtitle = reading ? (reading.from || reading.email || 'Message')
    : commsApp === null ? SENDRA_META[sendraTab].s
    : commsApp === 'telegram' ? (tgChat ? (tgChat.username ? `@${tgChat.username}` : 'Chat') : `${tgList.length || ''} chats`.trim() || 'Your chats')
    : emailTab === 'inbox' ? 'Newest first'
    : emailTab === 'contacts' ? (mergedContacts.length ? `${mergedContacts.length} people` : 'Your address book')
    : emailTab === 'compose' ? (sendState === 'sent' ? 'Sent' : 'Compose')
    : (mailConnected ? 'Ready' : 'Connect to begin');

  const sortedMsgs = [...tgMsgs].sort((a, b) => (a.date || 0) - (b.date || 0));

  // The AI template builder gets a Sendra-orange ambient instead of the default amber glow.
  const builderMode = !reading && agent !== null && commsApp === null && sendraTab === 'templates' && !!tplEdit;

  return (
    <div className={`memg ag${builderMode ? ' ag-builder' : ''}`} ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={(reading || commsApp || sendraTab !== 'home') ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
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

      {reading ? (
        <div className="ag-stage ag-reader">
          <EmailDetail msg={{
            id: reading.id, app: reading.app, from: reading.from, email: reading.email,
            subject: reading.subject, time: reading.time, unread: reading.unread,
            draft: reading.draft, body: reading.snippet || '',
          }} />
          {mailConnected && (reading.threadId || reading.email) ? (
            <button className="ag-send-btn ag-reply-btn" onClick={openReply}>Reply</button>
          ) : null}
        </div>
      ) : commsApp === null ? (
        sendraTab === 'home' ? (
          // ---- Sendra home: the tool menu (Campaigns, Templates, Analytics, Calendar, My apps) ----
          <div className="ag-stage">
            <div className="ag-grid">
              {HOME_TOOLS.map((t) => (
                <button key={t.id} className="ag-act" onClick={() => { if (t.id === 'inbox') openInbox(); else if (t.id === 'contacts') openContacts(); else { tap(); setNote(''); if (t.id === 'texts') { setSmsState('idle'); setSmsErr(''); } if (t.id === 'webhook') loadWebhooks(); if (t.id === 'logs') { setLogsQ(''); loadLogs(''); } if (t.id === 'deliver') loadDeliver(); if (t.id === 'domains') { setDomNew(''); setDomErr(''); domPollRef.current = 0; loadDomains(); } setSendraTab(t.id as SendraTab); } }}>
                  <span className="ag-act-ic"><t.Icon size={20} /></span>
                  <span className="ag-act-label">{t.name}</span>
                  <span className="ag-act-sub">{t.desc}</span>
                </button>
              ))}
            </div>
            <p className="ag-foot">Sendra runs your communication — campaigns, templates and triage across every connected app.</p>
          </div>
        ) : (
          // ---- Campaigns / Templates / Schedule / Webhooks / Settings ----
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
                        <iframe className="ag-tpl-frame" title="Template preview" sandbox="allow-same-origin allow-popups" srcDoc={buildSrcDoc(campBody)} />
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
                  <button className="ag-send-btn ghost" disabled={campStatsBusy} onClick={() => openCampStats(campStats.campaign)}>{campStatsBusy ? 'Refreshing…' : 'Refresh'}</button>
                  <p className="ag-foot">Opens are approximate — some mail apps (Apple Mail, Gmail's image proxy) pre-load or block the tracking pixel, so treat opens as a trend. Clicks are exact. Delivered/bounced fill in for sends through Sendra’s built-in email or a verified domain.</p>
                </div>
              ) : (
                <>
                  <button className="ag-send-btn" onClick={openCampNew}>+ New email campaign</button>
                  <button className="ag-send-btn ghost ag-dom-link" onClick={() => { tap(); setCampView('suppressions'); loadSuppressions(); }}>Suppressed contacts{supList.length ? ` · ${supList.length}` : ''}</button>
                  {campList.length === 0 ? (
                    <div className="ag-empty" style={{ marginTop: 12 }}>No campaigns yet. Write once and send to your whole list — straight from your mailbox.</div>
                  ) : (
                    <div className="ag-camp-list">
                      {campList.map((c) => (
                        <button className="ag-camp" key={c.id} onClick={() => openCampStats(c)}>
                          <div className="ag-camp-main">
                            <div className="ag-camp-name">{c.name || c.subject || 'Campaign'}</div>
                            <div className="ag-camp-sub">{c.subject}</div>
                          </div>
                          <div className="ag-camp-meta">
                            <span className={`ag-camp-pill is-${c.status}`}>{c.status}</span>
                            <span className="ag-camp-count">{c.sent}/{c.total}</span>
                          </div>
                          <span className="ag-camp-chev">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="ag-foot">SMS campaigns (Twilio) are coming next.</p>
                </>
              )
            ) : sendraTab === 'templates' ? (
              tplEdit ? (
                chatView === 'preview' ? (
                  <div className="ag-tpl-view">
                    <div className="ag-prev-top">
                      {tplVersions.length > 0
                        ? <button className="ag-prev-hist" onClick={() => { tap(); setChatView('history'); }} aria-label="Version history"><IconClock size={19} /></button>
                        : <span className="ag-prev-hist-spacer" aria-hidden="true" />}
                      <button className="ag-prev-save" disabled={tplSaving || !tplBody.trim()} onClick={saveTpl}>{tplSaving ? 'Saving…' : 'Save'}</button>
                    </div>
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
                      <iframe className="ag-tpl-frame" title="Email preview" sandbox="allow-same-origin allow-popups" srcDoc={buildSrcDoc(fillMergeTags(tplBody) || '<div style="padding:40px;text-align:center;color:#888;font-family:sans-serif">Nothing yet — chat to build it.</div>')} />
                    </div>
                    {chatErr && <div className="ag-send-err">{chatErr}</div>}
                    {tplEdit.id && <button className="ag-tpl-del" disabled={tplSaving} onClick={delTpl}>Delete template</button>}
                  </div>
                ) : chatView === 'history' ? (
                  <div className="ag-compose ag-tpl-preview ag-tpl-history">
                    <div className="ag-tpl-preview-bar">
                      <span className="ag-prev-title">History</span>
                      <span className="ag-prev-count">{tplVersions.length} {tplVersions.length === 1 ? 'version' : 'versions'}</span>
                    </div>
                    {tplVersions.length === 0 ? (
                      <div className="ag-empty" style={{ margin: '16px 4px' }}>No versions yet. Each time Sendra builds or edits this email, it’s saved here so you can roll back.</div>
                    ) : (
                      <div className="ag-hist-list">
                        {[...tplVersions].reverse().map((v, i) => (
                          <button className="ag-hist" key={`${v.at}-${i}`} onClick={() => restoreVersion(v)}>
                            <span className="ag-hist-rail" aria-hidden="true"><span className="ag-hist-dot" /></span>
                            <span className="ag-hist-main">
                              <span className="ag-hist-label">{v.label}</span>
                              <span className="ag-hist-time">{relTime(v.at)}</span>
                            </span>
                            {i === 0 ? <span className="ag-hist-badge">Current</span> : <span className="ag-hist-restore">Restore</span>}
                          </button>
                        ))}
                      </div>
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
                  <button className="ag-send-btn" onClick={startAI}>+ New template</button>
                  {tplList.length === 0 ? (
                    <div className="ag-empty" style={{ marginTop: 12 }}>No templates yet. Describe the email you want and let Sendra write it — then reuse it in any campaign.</div>
                  ) : (
                    <div className="ag-camp-list">
                      {tplList.map((t) => (
                        <button className="ag-camp" key={t.id} onClick={() => openTplEdit(t)}>
                          <div className="ag-camp-main">
                            <div className="ag-camp-name">{t.name || t.subject || 'Template'}</div>
                            <div className="ag-camp-sub">{t.subject}</div>
                          </div>
                          <span className="ag-chev" aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )
            ) : sendraTab === 'texts' ? (
              smsReady === null ? (
                <div className="ag-empty" style={{ marginTop: 12 }}>Loading…</div>
              ) : !smsReady ? (
                <div className="ag-compose">
                  <p className="ag-foot" style={{ textAlign: 'left', margin: '0 0 2px' }}>Get a phone number to send texts from. Pick an area code (optional) and search.</p>
                  <div className="ag-num-search">
                    <input className="ag-field" type="tel" inputMode="numeric" maxLength={5} placeholder="Area code (e.g. 415)" value={numArea} onChange={(e) => { setNumArea(e.target.value.replace(/\D/g, '')); if (numErr) setNumErr(''); }} />
                    <button className="ag-send-btn" disabled={numBusy} onClick={doSearchNumbers}>{numBusy ? 'Searching…' : 'Search'}</button>
                  </div>
                  {numErr && <div className="ag-send-err">{numErr}</div>}
                  {numResults.length > 0 && (
                    <div className="ag-num-list">
                      {numResults.map((n) => (
                        <div className="ag-num" key={n.phoneNumber}>
                          <div className="ag-num-info">
                            <span className="ag-num-tel">{n.phoneNumber}</span>
                            <span className="ag-num-loc">{[n.locality, n.region].filter(Boolean).join(', ')}</span>
                          </div>
                          <button className="ag-num-get" disabled={!!buyingNum} onClick={() => doBuyNumber(n.phoneNumber)}>{buyingNum === n.phoneNumber ? 'Getting…' : 'Get'}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="ag-foot">Your number is provisioned instantly. Sending to any US number needs carrier registration (10DLC) — coming next.</p>
                </div>
              ) : smsState === 'sent' ? (
                <div className="ag-sent">
                  <span className="ag-sent-ic"><IconCheck size={26} /></span>
                  <div className="ag-sent-title">Sent</div>
                  <div className="ag-sent-sub">Your text is on its way.</div>
                  <div className="ag-sent-actions">
                    <button className="ag-send-btn ghost" onClick={() => { tap(); setSmsState('idle'); }}>New text</button>
                    <button className="ag-send-btn" onClick={() => { tap(); setSendraTab('home'); }}>Done</button>
                  </div>
                </div>
              ) : (
                <div className="ag-compose">
                  <div className="ag-sms-conn"><span>✓ {smsNumber}</span><button onClick={doReleaseNumber}>Release</button></div>
                  <input
                    className="ag-field" type="tel" inputMode="tel" autoCapitalize="none" autoCorrect="off"
                    placeholder="To (+1 555 123 4567)" value={smsTo}
                    onChange={(e) => { setSmsTo(e.target.value); if (smsState === 'err') setSmsState('idle'); }}
                  />
                  <textarea
                    className="ag-field ag-body" placeholder="Type your message…" maxLength={1600} value={smsBody}
                    onChange={(e) => { setSmsBody(e.target.value); if (smsState === 'err') setSmsState('idle'); }}
                  />
                  {smsState === 'err' && <div className="ag-send-err">{smsErr}</div>}
                  <button className="ag-send-btn" onClick={doSendSms} disabled={!validSmsTo || !smsBody.trim() || smsState === 'sending'}>
                    {smsState === 'sending' ? 'Sending…' : 'Send text'}
                  </button>
                  <p className="ag-foot">Texts send from {smsNumber}. Standard SMS rates apply.</p>
                </div>
              )
            ) : sendraTab === 'domains' ? (
              <div className="ag-compose">
                <p className="ag-foot">Add a domain you own to send from your own address (e.g. news@yourbrand.com). Set it up in one click where your DNS host supports it, or paste the records anywhere else, then Verify.</p>
                <div className="ag-dom-add">
                  <input className="ag-field" placeholder="yourbrand.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={domNew} onChange={(e) => { setDomNew(e.target.value); if (domErr) setDomErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') addDomain(); }} />
                  <button className="ag-send-btn" disabled={domBusy || !domNew.trim()} onClick={addDomain}>{domBusy ? 'Adding…' : 'Add domain'}</button>
                </div>
                {domErr && <div className="ag-send-err">{domErr}</div>}
                {domains.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Add your own domain to send from your address (e.g. news@yourbrand.com).</div>
                ) : (
                  <div className="ag-dom-list">
                    {domains.map((d) => {
                      const open = domOpen === d.domain;
                      const verified = d.verified;
                      const recs = domRecords[d.domain] || [];
                      const dc = dcInfo[d.domain];
                      const checks = domChecks[d.domain];
                      return (
                        <div className={`ag-dom${open ? ' open' : ''}`} key={d.domain}>
                          <button className="ag-dom-row" onClick={() => openDom(d.domain)}>
                            <span className="ag-dom-ic"><IconGlobe size={18} /></span>
                            <span className="ag-dom-info">
                              <span className="ag-dom-name">{d.domain}</span>
                              <span className="ag-dom-sub">{verified ? 'Sending enabled' : 'Awaiting DNS records'}</span>
                            </span>
                            <span className={`ag-badge is-${verified ? 'ok' : 'wait'}`}><i className="ag-dot" />{verified ? 'Verified' : 'Pending'}</span>
                            <span className="ag-dom-chev">{open ? '▾' : '▸'}</span>
                          </button>
                          {open && (
                            <div className="ag-dom-body">
                              {verified ? (
                                <>
                                  <div className="ag-dom-ok">✓ Verified — send from this domain, and pick it under “Send from” when sending.</div>
                                  <div className="ag-dom-test">
                                    <input className="ag-field" placeholder="you@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={testTo[d.domain] || ''} onChange={(e) => setTestTo((m) => ({ ...m, [d.domain]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') sendTest(d.domain); }} />
                                    <button className="ag-send-btn" disabled={testBusy === d.domain || !(testTo[d.domain] || '').trim()} onClick={() => sendTest(d.domain)}>{testBusy === d.domain ? 'Sending…' : 'Send test'}</button>
                                  </div>
                                  {testMsg[d.domain] && <div className={`ag-dom-testmsg${testMsg[d.domain].includes('✓') ? ' ok' : ''}`}>{testMsg[d.domain]}</div>}
                                </>
                              ) : (
                                <>
                                  <button className="ag-send-btn ag-dom-auto" disabled={dcBusy === d.domain || !recs.length} onClick={() => autoConfigure(d.domain)}>
                                    {dcBusy === d.domain ? 'Checking…' : '⚡ Auto-configure (one-click)'}
                                  </button>
                                  {dc && (
                                    <div className={`ag-dom-testmsg${dc.supported ? ' ok' : ''}`}>
                                      {dc.applyUrl
                                        ? `Opening ${dc.host} to authorize…`
                                        : dc.supported
                                          ? `✓ ${dc.host} supports one-click — turning on soon. For now add the records below.`
                                          : 'Your DNS host needs manual setup — add the records below.'}
                                    </div>
                                  )}
                                  <p className="ag-foot ag-dom-hint">Add these TXT records at your DNS host, then tap Verify.</p>
                                  <div className="ag-dom-recs">
                                    {recs.map((r) => (
                                      <div className="ag-dom-rec" key={r.purpose}>
                                        <div className="ag-dom-rec-head"><span className="ag-dom-rec-purpose">{r.purpose}</span><span className="ag-dom-rec-type">{r.type}</span></div>
                                        <button className="ag-dom-rec-line" onClick={() => copyText(r.name)}><span className="ag-dom-rec-k">Name</span><code>{r.name}</code><span className="ag-dom-rec-copy">{copied === r.name ? 'Copied' : <IconCopy size={13} />}</span></button>
                                        <button className="ag-dom-rec-line" onClick={() => copyText(r.value)}><span className="ag-dom-rec-k">Value</span><code>{r.value}</code><span className="ag-dom-rec-copy">{copied === r.value ? 'Copied' : <IconCopy size={13} />}</span></button>
                                      </div>
                                    ))}
                                  </div>
                                  {checks && <p className="ag-foot ag-dom-checks">Last check — DKIM {checks.dkim ? '✓' : '✕'} · SPF {checks.spf ? '✓' : '✕'}</p>}
                                </>
                              )}
                              <div className="ag-dom-actions">
                                {!verified && <button className="ag-send-btn" disabled={domVerifying === d.domain} onClick={() => verifyDom(d.domain)}>{domVerifying === d.domain ? 'Verifying…' : 'Verify'}</button>}
                                <button className="ag-send-btn ghost" onClick={() => removeDom(d.domain)}>Remove</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : sendraTab === 'logs' ? (
              <div className="ag-compose">
                <input className="ag-field" placeholder="Search by email…" autoCapitalize="none" autoCorrect="off" value={logsQ}
                  onChange={(e) => setLogsQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadLogs(logsQ); }} />
                {logsBusy && logsList.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Loading…</div>
                ) : logsList.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>{logsQ ? 'No emails match that search.' : 'No sends yet. Once you send a campaign, every email shows up here — delivered, opened, clicked or bounced.'}</div>
                ) : (
                  <div className="ag-log-list">
                    {logsList.map((l, i) => {
                      const st = logStatus(l);
                      const when = l.opened_at || l.clicked_at || l.delivered_at || l.sent_at;
                      return (
                        <div className="ag-log" key={`${l.email}-${i}`}>
                          <div className="ag-camp-main">
                            <div className="ag-camp-name">{l.email}</div>
                            <div className="ag-camp-sub">{l.campaign?.name || l.campaign?.subject || 'Campaign'}{when ? ` · ${new Date(when).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</div>
                            {l.error && <div className="ag-camp-sub ag-log-reason">{l.error}</div>}
                          </div>
                          <span className={`ag-camp-pill is-${st.cls}`}>{st.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="ag-foot">Every email Sendra sent and what happened to it. Opens are approximate; clicks are exact. Delivered/bounced fill in for sends through Sendra’s built-in email or a verified domain.</p>
              </div>
            ) : sendraTab === 'deliver' ? (
              <div className="ag-compose">
                {delivBusy && !deliv ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>Checking your delivery…</div>
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
                    <button className="ag-send-btn ghost" disabled={delivBusy} onClick={loadDeliver}>{delivBusy ? 'Refreshing…' : 'Refresh'}</button>
                    <p className="ag-foot">Your delivery, opens, clicks and bounce rates across every campaign email you’ve sent. Opens are approximate; clicks are exact.</p>
                  </>
                ) : (
                  <div className="ag-empty" style={{ marginTop: 12 }}>No sends yet. Send a campaign and your delivery, opens, clicks and bounce rates show up here.</div>
                )}
              </div>
            ) : sendraTab === 'webhook' ? (
              <div className="ag-compose">
                <p className="ag-foot">Get email events (delivered, bounced, complained) POSTed to your own HTTPS endpoint in real time — each request signed so you can verify it came from Sendra.</p>
                <div className="ag-dom-add">
                  <input className="ag-field" placeholder="https://yourapp.com/webhooks/sendra" autoCapitalize="none" autoCorrect="off" value={whNew} onChange={(e) => { setWhNew(e.target.value); if (whErr) setWhErr(''); }} />
                  <button className="ag-send-btn" disabled={whBusy || !whNew.trim()} onClick={addWh}>{whBusy ? 'Adding…' : 'Add endpoint'}</button>
                </div>
                {whErr && <div className="ag-send-err">{whErr}</div>}
                {webhooks.length === 0 ? (
                  <div className="ag-empty" style={{ marginTop: 12 }}>No endpoints yet. Add an HTTPS URL above to start receiving events.</div>
                ) : (
                  <div className="ag-dom-list">
                    {webhooks.map((w) => {
                      const open = whOpen === w.id;
                      const ok = w.last_status != null && w.last_status >= 200 && w.last_status < 300;
                      const badge = !w.enabled ? 'wait' : w.last_status == null ? 'ok' : ok ? 'ok' : 'bad';
                      return (
                        <div className={`ag-dom${open ? ' open' : ''}`} key={w.id}>
                          <button className="ag-dom-row" onClick={() => { tap(); setWhOpen(open ? null : w.id); }}>
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
                              <p className="ag-foot ag-dom-hint">Verify each POST: <code>sendra-signature: v1=&lt;hex&gt;</code> is the HMAC-SHA256 of <code>{'{sendra-timestamp}.{raw body}'}</code> keyed with this secret.</p>
                              {whTest[w.id] && <div className={`ag-dom-testmsg${whTest[w.id].includes('✓') ? ' ok' : ''}`}>{whTest[w.id]}</div>}
                              <div className="ag-dom-actions">
                                <button className="ag-send-btn" onClick={() => sendWhTest(w.id)}>Send test</button>
                                <button className="ag-send-btn ghost" onClick={() => toggleWh(w)}>{w.enabled ? 'Pause' : 'Resume'}</button>
                                <button className="ag-send-btn ghost" onClick={() => removeWh(w.id)}>Remove</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
                  <p className="ag-foot">Drip sequences: tag a contact and they automatically receive a series of emails over time. Suppressed and unsubscribed contacts stop automatically.</p>
                  <button className="ag-send-btn" onClick={openAutoNew}>+ New automation</button>
                  {autoList.length === 0 ? (
                    <div className="ag-empty" style={{ marginTop: 12 }}>No automations yet. Create a welcome or follow-up series that runs itself.</div>
                  ) : (
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
                              <button className="ag-send-btn ghost" onClick={() => removeAuto(a.id)}>Delete</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : sendraTab === 'settings' ? (
              <div className="ag-empty" style={{ marginTop: 12 }}>Settings are coming soon — set your default sender name, reply-to address, signature and notification preferences here.</div>
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
        )

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
                <div className="ag-inbox" key={pageIdx}>
                  <EmailList items={inbox} onOpen={(it) => { tap(); setReading(it); }} badges={combinedInbox} />
                </div>
                {!combinedInbox && hasPager && (
                  <div className="ag-pager">
                    <button onClick={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || refreshing}>‹ Prev</button>
                    <span className="ag-pager-n">Page {pageIdx + 1}</span>
                    <button onClick={() => goPage(pageIdx + 1)} disabled={!nextTok || refreshing}>Next ›</button>
                  </div>
                )}
                {mergedMore && (
                  <div className="ag-pager">
                    <button onClick={loadMoreMerged} disabled={refreshing}>{refreshing ? 'Loading…' : 'Load older'}</button>
                  </div>
                )}
              </>
            ) : (
              <EmailSkeleton />
            )}
        </div>
      ) : emailTab === 'contacts' ? (
        <div className="ag-stage">
          {(() => {
            const q = contactSearch.trim().toLowerCase();
            const allTags = [...new Set(mergedContacts.flatMap((c) => c.tags || []))].sort();
            const tag = contactTag && allTags.includes(contactTag) ? contactTag : '';
            const base = tag ? mergedContacts.filter((c) => c.tags?.includes(tag)) : mergedContacts;
            const list = q ? base.filter((c) => `${c.name || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(q)) : base;
            const segCount = tag ? base.filter((c) => c.email).length : 0;
            const loading = contactsState === 'loading' && mergedContacts.length === 0;
            return (
              <>
                <div className="ag-contacts-bar">
                  <input className="ag-field ag-contacts-search" placeholder="Search contacts" autoCapitalize="none" autoCorrect="off" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
                  <button className="ag-contacts-sel" onClick={() => openContactForm()}>+ Add</button>
                  {mergedContacts.length > 0 && (
                    <button className={`ag-contacts-sel${contactSelMode ? ' on' : ''}`} onClick={() => { tap(); setContactSelMode((v) => !v); setContactSel(new Set()); }}>{contactSelMode ? 'Cancel' : 'Select'}</button>
                  )}
                </div>
                {allTags.length > 0 && (
                  <div className="ag-seg-row">
                    <button className={`ag-seg${tag ? '' : ' on'}`} onClick={() => { tap(); setContactTag(''); }}>All</button>
                    {allTags.map((t) => (
                      <button key={t} className={`ag-seg${tag === t ? ' on' : ''}`} onClick={() => { tap(); setContactTag(tag === t ? '' : t); }}>{t}</button>
                    ))}
                  </div>
                )}
                {loading ? (
                  <EmailSkeleton />
                ) : mergedContacts.length === 0 ? (
                  <div className="ag-empty">No contacts yet. Tap “+ Add” to create your first one.</div>
                ) : list.length === 0 ? (
                  <div className="ag-empty">{tag ? 'No one in this segment matches.' : 'No matches.'}</div>
                ) : (
                  <ContactsList items={list} selectable={contactSelMode} selected={contactSel} onToggle={toggleContact} onEdit={openContactForm} />
                )}
                {contactSelMode && contactSel.size > 0 ? (
                  <button className="ag-send-btn ag-contacts-action" onClick={emailSelected}>
                    Email {contactSel.size} {contactSel.size === 1 ? 'person' : 'people'} →
                  </button>
                ) : !contactSelMode && tag && segCount > 0 ? (
                  <button className="ag-send-btn ag-contacts-action" onClick={() => emailSegment(tag)}>
                    Email “{tag}” — {segCount} {segCount === 1 ? 'person' : 'people'} →
                  </button>
                ) : null}
              </>
            );
          })()}

          {cForm && (
            <>
              <div className="ag-confirm-scrim" onClick={() => { tap(); setCForm(null); }} />
              <div className="ag-confirm ag-cform" role="dialog" aria-label="Contact">
                <div className="ag-confirm-title">{cForm.id ? 'Edit contact' : 'New contact'}</div>
                <input className="ag-field" placeholder="Name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} />
                <input className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="Email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} />
                <input className="ag-field" type="tel" inputMode="tel" placeholder="Phone (optional)" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} />
                <input className="ag-field" autoCapitalize="none" placeholder="Segments (e.g. vip, newsletter)" value={cForm.tags} onChange={(e) => setCForm({ ...cForm, tags: e.target.value })} />
                <div className="ag-cform-hint">Comma-separated labels. Use them to email a whole group at once.</div>
                {cFormErr && <div className="ag-send-err">{cFormErr}</div>}
                <div className="ag-cform-actions">
                  {cForm.id && <button className="ag-send-btn ghost ag-cform-del" onClick={delCForm}>Delete</button>}
                  <button className="ag-send-btn ghost" onClick={() => { tap(); setCForm(null); }}>Cancel</button>
                  <button className="ag-send-btn" disabled={cFormBusy || (!cForm.name.trim() && !cForm.email.trim())} onClick={saveCForm}>{cFormBusy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : emailTab === 'compose' ? (
        <div className="ag-stage ag-compose">
          {!mailConnected ? connectCard('Link this mailbox so the agent can send on your behalf.')
            : sendState === 'sent' ? (
              <div className="ag-sent">
                <span className="ag-sent-ic"><IconCheck size={26} /></span>
                <div className="ag-sent-title">{replyThreadId ? 'Replied' : 'Sent'}</div>
                <div className="ag-sent-sub">Your email is on its way.</div>
                <div className="ag-sent-actions">
                  <button className="ag-send-btn ghost" onClick={openCompose}>New email</button>
                  <button className="ag-send-btn" onClick={() => { tap(); setReplyThreadId(null); setEmailTab('inbox'); }}>Done</button>
                </div>
              </div>
            ) : (
              <>
                {mailApiApps.length >= 2 && (
                  <div className="ag-from">
                    <span className="ag-from-lbl">From</span>
                    <select className="ag-field ag-from-sel" value={sendApp} onChange={(e) => { tap(); setSendApp(e.target.value as 'gmail' | 'outlook'); }}>
                      {mailApiApps.map((a) => <option key={a} value={a}>{a === 'outlook' ? 'Outlook' : 'Gmail'}</option>)}
                    </select>
                  </div>
                )}
                <div className="ag-to-row">
                  <input
                    className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                    placeholder="To" value={to} onChange={(e) => { setTo(e.target.value); if (!toPicker) setToPicker(true); }}
                    onFocus={() => { if (mergedContacts.length) setToPicker(true); }}
                  />
                  {mergedContacts.length > 0 && (
                    <button className="ag-to-pick" onClick={() => { tap(); setToPicker((v) => !v); }} aria-label="Choose from contacts"><IconContacts size={18} /></button>
                  )}
                </div>
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
                <input className="ag-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => setToPicker(false)} />
                {tplList.length > 0 && (
                  <div className="ag-tpl-row">
                    <span className="ag-tpl-lbl">Template:</span>
                    {tplList.slice(0, 8).map((t) => (
                      <button key={t.id} className="ag-tpl-chip" onClick={() => applyComposeTemplate(t)}>{t.name || t.subject}</button>
                    ))}
                  </div>
                )}
                {composeKind === 'html' ? (
                  <div className="ag-tpl-preview">
                    <div className="ag-tpl-preview-bar"><span>Designed template</span><button onClick={() => { tap(); setComposeKind('text'); setBodyText(''); }}>✕ Write plain text</button></div>
                    <iframe className="ag-tpl-frame" title="Email preview" sandbox="allow-same-origin allow-popups" srcDoc={buildSrcDoc(fillMergeTags(bodyText))} />
                  </div>
                ) : (
                  <textarea className="ag-field ag-body" placeholder="Write your message…" value={bodyText} onChange={(e) => setBodyText(e.target.value)} onFocus={() => setToPicker(false)} />
                )}
                {sendState === 'err' && <div className="ag-send-err">Couldn’t send — check the address and try again.</div>}
                <button
                  className="ag-send-btn"
                  onClick={() => { tap(); setSendState('confirm'); }}
                  disabled={!validTo || sendState === 'sending' || !bodyText.trim()}
                >
                  {sendState === 'sending' ? 'Sending…' : replyThreadId ? 'Send reply' : 'Send'}
                </button>
              </>
            )}

          {sendState === 'confirm' && (
            <>
              <div className="ag-confirm-scrim" onClick={() => { tap(); setSendState('idle'); }} />
              <div className="ag-confirm" role="dialog" aria-label="Confirm send">
                <div className="ag-confirm-title">{replyThreadId ? 'Send this reply?' : 'Send this email?'}</div>
                <div className="ag-confirm-sub">To {to.trim()}{subject.trim() ? ` · ${subject.trim()}` : ''}</div>
                <div className="ag-confirm-actions">
                  <button className="ag-confirm-cancel" onClick={() => { tap(); setSendState('idle'); }}>Cancel</button>
                  <button className="ag-confirm-send" onClick={doSend}>Send</button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        // mail workspace home (action grid)
        <div className="ag-stage">
          {!mailConnected && connectCard('Link this mailbox so the agent can read, draft and send.')}
          <div className="ag-grid">
            {EMAIL_ACTIONS.map((act) => {
              const soon = act.id === 'sequence';   // drip sequences aren't built yet
              return (
                <button
                  key={act.id}
                  className="ag-act"
                  disabled={soon}
                  onClick={() => {
                    if (soon) return;
                    tap();
                    if (act.id === 'inbox') setEmailTab('inbox');
                    else if (act.id === 'new') openCompose();
                    else if (act.id === 'contacts') setEmailTab('contacts');
                    else if (act.id === 'broadcast') { setCommsApp(null); setInboxHome(false); setSendraTab('campaigns'); openCampNew(); }
                  }}
                >
                  <span className="ag-act-ic"><act.icon size={20} /></span>
                  <span className="ag-act-label">{act.label}</span>
                  <span className="ag-act-sub">{soon ? 'Soon' : act.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
