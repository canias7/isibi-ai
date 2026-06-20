import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconBank, IconInbox, IconRefresh, IconCheck, IconContacts,
  IconChart, IconDoc, IconChat,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox, fetchInboxMergedPaged, sendEmail, fetchContacts, sendSms, listCampaigns, createCampaign, sendCampaignBatch, listTemplates, saveTemplate, deleteTemplate, generateTemplate, chatTemplate, uploadEmailImage, getBrand, saveBrand, tgChats, tgMessages, tgSend, tgStatus, type TgChat, type TgMessage, type Campaign, type Template, type ChatMsg } from './api';
import { EmailList, EmailDetail, EmailSkeleton, ContactsList, buildSrcDoc, type EmailItem, type ContactItem } from './EmailList';
import { BrandLogo } from './brandLogos';
import { SENDRA_LOGO } from './sendraLogo';

// Each agent is a *role* that spans apps (not an app). Only Sendra is live today;
// the rest are shown as "soon" so the roadmap is visible without faking capability.
// Tapping Sendra opens a swipeable deck of the user's connected communication apps
// (Gmail, Outlook, Telegram); picking one opens its workspace.
type AgentId = 'email';
type IconCmp = typeof IconCompose;
type AgentDef = { id: string; name: string; desc: string; icon: IconCmp; live: boolean };

const AGENTS: AgentDef[] = [
  { id: 'email', name: 'Sendra', desc: 'Your comms agent — Gmail, Outlook & Telegram in one place', icon: IconCompose, live: true },
  { id: 'books', name: 'Bookkeeper', desc: 'Invoices, payments & reconciliation', icon: IconBank, live: false },
  { id: 'sched', name: 'Scheduler', desc: 'Meetings, reminders & calendar triage', icon: IconClock, live: false },
];

// The communication apps Sendra can manage. Only the CONNECTED ones appear in the
// deck. `mail` apps share the email workspace (inbox/compose/contacts); telegram
// has its own chat workspace.
type CommsId = 'gmail' | 'm365' | 'telegram';
const COMMS: { id: CommsId; name: string; tagline: string; mail: boolean }[] = [
  { id: 'gmail', name: 'Gmail', tagline: 'Inbox, replies & contacts', mail: true },
  { id: 'm365', name: 'Outlook', tagline: 'Mail, replies & contacts', mail: true },
  { id: 'telegram', name: 'Telegram', tagline: 'Chats & quick replies', mail: false },
];

// Sendra home tabs + their header copy.
type SendraTab = 'home' | 'apps' | 'texts' | 'campaigns' | 'templates' | 'analytics' | 'calendar';
const SENDRA_META: Record<SendraTab, { t: string; s: string }> = {
  home: { t: 'Sendra', s: 'Your communication hub' },
  apps: { t: 'My apps', s: 'The apps Sendra runs' },
  texts: { t: 'Text', s: 'Send an SMS' },
  campaigns: { t: 'Campaigns', s: 'Email & SMS to your lists' },
  templates: { t: 'Templates', s: 'Reusable messages' },
  analytics: { t: 'Analytics', s: 'Performance across your sends' },
  calendar: { t: 'Calendar', s: 'Scheduled sends & reminders' },
};
// Sendra home menu. 'apps' opens the constellation; the rest are P0 scaffolds.
const HOME_TOOLS: { id: SendraTab | 'inbox'; name: string; desc: string; Icon: IconCmp }[] = [
  { id: 'inbox', name: 'Inbox', desc: 'All your mail', Icon: IconInbox },
  { id: 'texts', name: 'Text', desc: 'Send an SMS', Icon: IconChat },
  { id: 'campaigns', name: 'Campaigns', desc: 'Email & SMS', Icon: IconWaveform },
  { id: 'templates', name: 'Templates', desc: 'Reusable messages', Icon: IconDoc },
  { id: 'analytics', name: 'Analytics', desc: 'Opens & clicks', Icon: IconChart },
  { id: 'apps', name: 'My apps', desc: '', Icon: IconConnectors },
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

// Is an app connected? Mail apps come from the chat backend's connected list
// (passed as connApps); Telegram has its own backend, seeded here from the
// connectors-screen status cache and refreshed live.
function cachedConnected(id: string): boolean {
  try {
    const a = JSON.parse(localStorage.getItem('gf_connstatus') || '[]');
    return Array.isArray(a) && a.some((x) => x?.id === id);
  } catch { return false; }
}

const fmtTime = (ms: number | null): string => {
  if (!ms) return '';
  try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};

// Sendra constellation: a central hub with the connected comms apps as nodes
// around it. Positions are % within the stage (polar around the hub). Small-N
// angles are hand-picked so 1-3 apps sit nicely; 4+ spread evenly on the circle.
const HUB = { x: 50, y: 42 };
const TREE_RX = 32, TREE_RY = 26;
const NODE_ANGLES: Record<number, number[]> = { 1: [90], 2: [145, 35], 3: [90, 205, 335] };
function nodePos(i: number, n: number): { x: number; y: number } {
  const arr = NODE_ANGLES[n] ?? Array.from({ length: n }, (_, k) => -90 + (k * 360) / n);
  const a = ((arr[i] ?? 0) * Math.PI) / 180;
  return { x: HUB.x + TREE_RX * Math.cos(a), y: HUB.y + TREE_RY * Math.sin(a) };
}

type EmailTab = 'home' | 'inbox' | 'compose' | 'contacts';
type SendState = 'idle' | 'confirm' | 'sending' | 'sent' | 'err';
type Loadable = 'idle' | 'loading' | 'ok' | 'err';

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentId | null>(null);
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
  // Compose / reply state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendApp, setSendApp] = useState<'gmail' | 'outlook'>('gmail'); // which mailbox a send/reply goes through
  const [inboxHome, setInboxHome] = useState(false); // Inbox opened from the Sendra home -> Back returns there, not the app grid
  // Telegram workspace
  const [tgConnected, setTgConnected] = useState<boolean>(() => cachedConnected('telegram'));
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
  // Email campaign builder
  const [campNew, setCampNew] = useState(false);
  const [campApp, setCampApp] = useState<'gmail' | 'outlook'>('gmail');
  const [campSubject, setCampSubject] = useState('');
  const [campBody, setCampBody] = useState('');
  const [campRecips, setCampRecips] = useState('');
  const [campState, setCampState] = useState<'idle' | 'sending' | 'done' | 'err'>('idle');
  const [campErr, setCampErr] = useState('');
  const [campProg, setCampProg] = useState({ sent: 0, total: 0, failed: 0 });
  const [campList, setCampList] = useState<Campaign[]>([]);
  const [campBodyKind, setCampBodyKind] = useState<'text' | 'html'>('text'); // 'html' when a designed template is applied
  // Templates (reusable, AI-writable, or bring-your-own)
  const [tplList, setTplList] = useState<Template[]>([]);
  const [tplEdit, setTplEdit] = useState<null | { id?: string }>(null);
  const [tplMode, setTplMode] = useState<'text' | 'flyer' | 'html'>('text');
  const [tplName, setTplName] = useState('');
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');      // text mode: plain text; html mode: raw HTML
  const [tplFlyerUrl, setTplFlyerUrl] = useState(''); // flyer mode: uploaded image URL
  const [tplFlyerLink, setTplFlyerLink] = useState('');
  const [tplImgBusy, setTplImgBusy] = useState(false);
  const [tplPrompt, setTplPrompt] = useState('');
  const [tplGen, setTplGen] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplErr, setTplErr] = useState('');
  const [tplGenDesign, setTplGenDesign] = useState(true); // AI generates a designed HTML layout (vs plain text)
  const [tplImages, setTplImages] = useState<string[]>([]); // photos the AI designer lays into the email
  // New-template flow: choose AI vs manual; AI = Lovable-style chat builder.
  const [tplChoose, setTplChoose] = useState(false);
  const [tplBuild, setTplBuild] = useState<'chat' | 'manual'>('chat');
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatView, setChatView] = useState<'chat' | 'preview'>('chat');
  const [chatErr, setChatErr] = useState('');
  const [chatHistory, setChatHistory] = useState<{ subject: string; body: string }[]>([]); // email state before each turn (Undo)
  // Brand profile (feeds the AI designer)
  const [brandEdit, setBrandEdit] = useState(false);
  const [bName, setBName] = useState('');
  const [bLogo, setBLogo] = useState('');
  const [bColor, setBColor] = useState('#FF7A45');
  const [bVoice, setBVoice] = useState('');
  const [bSignoff, setBSignoff] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bBusy, setBBusy] = useState(false);
  const [bHas, setBHas] = useState(false); // a brand profile exists

  const tokensRef = useRef<(string | undefined)[]>([undefined]);
  const pullStart = useRef<number | null>(null);
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const tgMsgsRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Which provider the mail workspace is talking to (Composio app id -> our param).
  const mailApp = commsApp === 'm365' ? 'outlook' : 'gmail';
  const mailConnected = commsApp === 'm365'
    ? connApps.includes('m365') || connApps.includes('outlook')
    : connApps.includes('gmail');
  // Connected mailboxes (api app names). With 2+, the Inbox is one merged,
  // newest-first feed with per-row badges; with 1, the existing paged inbox.
  const mailApiApps = ['gmail', 'outlook'].filter((a) => (a === 'gmail' ? connApps.includes('gmail') : connApps.includes('m365') || connApps.includes('outlook')));
  const combinedInbox = mailApiApps.length >= 2;

  // The connected comms apps, in COMMS order — the deck.
  const isCommConnected = useCallback((id: CommsId): boolean => {
    if (id === 'telegram') return tgConnected;
    if (id === 'm365') return connApps.includes('m365') || connApps.includes('outlook');
    return connApps.includes(id);
  }, [connApps, tgConnected]);
  const deckApps = COMMS.filter((c) => isCommConnected(c.id));

  // Back steps one level: reader -> sub-view -> workspace -> deck -> list -> close.
  const back = () => {
    tap();
    if (reading) setReading(null);
    else if (tgChat) setTgChat(null);
    else if (sendState === 'confirm') setSendState('idle');
    else if (commsApp && commsApp !== 'telegram' && emailTab === 'compose') setEmailTab(inboxHome ? 'inbox' : 'home');
    else if (commsApp && commsApp !== 'telegram' && emailTab !== 'home' && !inboxHome) setEmailTab('home');
    else if (commsApp) { setCommsApp(null); setInboxHome(false); }
    else if (sendraTab !== 'home') setSendraTab('home');
    else if (agent) setAgent(null);
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

  // Live-check Telegram's connection when Sendra opens (seeded instantly from cache).
  useEffect(() => {
    if (agent !== 'email') return;
    tgStatus().then((s) => { if (mountedRef.current) setTgConnected(s.connected); }).catch(() => {});
  }, [agent]);

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
    if (sendraTab === 'campaigns' && !campNew) listCampaigns().then((c) => { if (mountedRef.current) setCampList(c); });
    if (sendraTab === 'campaigns' || sendraTab === 'templates') listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    if (sendraTab === 'templates') getBrand().then((br) => {
      if (!mountedRef.current) return;
      setBName(br.name || ''); setBLogo(br.logo_url || ''); setBColor(br.color || '#FF7A45'); setBVoice(br.voice || ''); setBSignoff(br.signoff || ''); setBAddress(br.address || '');
      setBHas(!!(br.name || br.logo_url || br.voice || br.signoff || br.address));
    });
  }, [agent, commsApp, sendraTab, campNew]);

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
  const openCompose = () => { tap(); setReplyThreadId(null); setTo(''); setSubject(''); setBodyText(''); setSendState('idle'); setSendApp(mailApp); setEmailTab('compose'); };
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
    sendEmail({ to: to.trim(), subject: subject.trim(), body: bodyText, threadId: replyThreadId || undefined, app: sendApp })
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
    setCampApp(connApps.includes('gmail') ? 'gmail' : 'outlook');
  };
  const applyTemplate = (t: Template) => { tap(); setCampSubject(t.subject); setCampBody(t.body); setCampBodyKind(t.kind === 'html' ? 'html' : 'text'); if (campState === 'err') setCampState('idle'); };
  const runCampaign = async () => {
    const recipients = parseRecips(campRecips);
    if (!campSubject.trim() || !campBody.trim() || !recipients.length || campState === 'sending') return;
    tap(); setCampState('sending'); setCampErr(''); setCampProg({ sent: 0, total: recipients.length, failed: 0 });
    try {
      const c = await createCampaign({ app: campApp, subject: campSubject.trim(), body: campBodyKind === 'html' ? campBody : campToHtml(campBody.trim()), recipients });
      if (!mountedRef.current) return;
      if (c.error || !c.id) {
        setCampState('err');
        setCampErr(
          c.error === 'no_recipients' ? `No one to send to${c.invalid ? ` — ${c.invalid} invalid` : ''}${c.skipped ? `, ${c.skipped} unsubscribed` : ''}.`
            : c.error === 'missing_content' ? 'Add a subject and a message.'
              : 'Couldn’t create the campaign — try again.');
        return;
      }
      setCampProg({ sent: 0, total: c.queued ?? recipients.length, failed: 0 });
      let done = false;
      while (!done) {
        const r = await sendCampaignBatch(c.id);
        if (!mountedRef.current) return;
        setCampProg((p) => ({ total: p.total, sent: p.sent + r.sent, failed: p.failed + r.failed }));
        done = r.done;
      }
      setCampState('done');
      listCampaigns().then((cl) => { if (mountedRef.current) setCampList(cl); });
    } catch {
      if (mountedRef.current) { setCampState('err'); setCampErr('Something went wrong while sending — check your connection and try again.'); }
    }
  };

  // ---- Templates ----
  const flyerHtml = (url: string, link: string) =>
    (link.trim()
      ? `<a href="${link.trim()}" style="text-decoration:none"><img src="${url}" alt="" style="display:block;width:100%;max-width:100%;height:auto;border:0"></a>`
      : `<img src="${url}" alt="" style="display:block;width:100%;max-width:100%;height:auto;border:0">`);
  // The stored body + kind for the active editor mode.
  const tplComputed = (): { body: string; kind: 'text' | 'html' } =>
    tplMode === 'flyer' ? { body: tplFlyerUrl ? flyerHtml(tplFlyerUrl, tplFlyerLink) : '', kind: 'html' }
      : tplMode === 'html' ? { body: tplBody.trim(), kind: 'html' }
        : { body: tplBody.trim(), kind: 'text' };
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
  const uploadFlyer = () => pickImage(async (b64, ct) => {
    if (!b64) return;
    setTplImgBusy(true); setTplErr('');
    try { const url = await uploadEmailImage(b64, ct); if (mountedRef.current) setTplFlyerUrl(url); }
    catch { if (mountedRef.current) setTplErr('Upload failed — try a smaller image.'); }
    finally { if (mountedRef.current) setTplImgBusy(false); }
  });
  const openChoice = () => { tap(); setTplChoose(true); };
  const startAI = () => { tap(); setTplChoose(false); setTplBuild('chat'); setTplEdit({}); setTplName(''); setTplSubject(''); setTplBody(''); setTplImages([]); setChatMsgs([]); setChatInput(''); setChatErr(''); setChatHistory([]); setChatView('chat'); };
  const startManual = () => { tap(); setTplChoose(false); setTplBuild('manual'); setTplEdit({}); setTplMode('text'); setTplName(''); setTplSubject(''); setTplBody(''); setTplFlyerUrl(''); setTplFlyerLink(''); setTplPrompt(''); setTplImages([]); setTplErr(''); };
  const openTplEdit = (t: Template) => {
    tap();
    if (t.chat && t.chat.length) {
      setTplBuild('chat'); setTplEdit({ id: t.id }); setTplName(t.name); setTplSubject(t.subject); setTplBody(t.body); setTplImages([]); setChatMsgs(t.chat); setChatInput(''); setChatErr(''); setChatHistory([]); setChatView('preview');
    } else {
      setTplBuild('manual'); setTplEdit({ id: t.id }); setTplMode(t.kind === 'html' ? 'html' : 'text'); setTplName(t.name); setTplSubject(t.subject); setTplBody(t.body); setTplFlyerUrl(''); setTplFlyerLink(''); setTplPrompt(''); setTplImages([]); setTplErr('');
    }
  };
  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    tap();
    const next: ChatMsg[] = [...chatMsgs, { role: 'user', content: text }];
    const prev = { subject: tplSubject, body: tplBody }; // snapshot for Undo
    setChatMsgs(next); setChatInput(''); setChatBusy(true); setChatErr('');
    try {
      const r = await chatTemplate(next, tplBody, tplImages);
      if (!mountedRef.current) return;
      if (r.error || !r.body) { setChatErr(r.error === 'ai_unset' ? 'AI builder isn’t set up on the server yet.' : 'Couldn’t build that — try rephrasing.'); return; }
      setTplBody(r.body); if (r.subject) setTplSubject(r.subject);
      if (!tplName.trim() && r.subject) setTplName(r.subject.slice(0, 60));
      setChatMsgs((m) => [...m, { role: 'assistant', content: r.reply || 'Done.' }]);
      setChatHistory((h) => [...h, prev].slice(-20));
      setTplImages([]);
    } catch { if (mountedRef.current) setChatErr('Something went wrong — try again.'); }
    finally { if (mountedRef.current) setChatBusy(false); }
  };
  const undoChat = () => {
    if (!chatHistory.length || chatBusy) return;
    tap();
    const last = chatHistory[chatHistory.length - 1];
    setTplSubject(last.subject); setTplBody(last.body);
    setChatMsgs((m) => m.slice(0, Math.max(0, m.length - 2)));
    setChatHistory((h) => h.slice(0, -1));
  };
  // Add a photo for the AI designer to lay into the email.
  const addDesignImage = () => pickImage(async (b64, ct) => {
    if (!b64) return;
    setTplImgBusy(true); setTplErr('');
    try { const url = await uploadEmailImage(b64, ct); if (mountedRef.current) setTplImages((xs) => [...xs, url]); }
    catch { if (mountedRef.current) setTplErr('Upload failed — try a smaller image.'); }
    finally { if (mountedRef.current) setTplImgBusy(false); }
  });
  const genTpl = async () => {
    if (!tplPrompt.trim() || tplGen) return;
    tap(); setTplGen(true); setTplErr('');
    try {
      const r = await generateTemplate(tplPrompt.trim(), tplGenDesign ? 'design' : 'text', tplGenDesign ? tplImages : []);
      if (!mountedRef.current) return;
      if (r.error || !r.subject) { setTplErr(r.error === 'ai_unset' ? 'AI writing isn’t set up on the server yet.' : 'Couldn’t generate — try rephrasing your description.'); return; }
      setTplSubject(r.subject || '');
      setTplBody(r.body || '');
      setTplMode(r.kind === 'html' ? 'html' : 'text'); // designed output -> HTML mode (shows preview)
      if (!tplName.trim()) setTplName((r.subject || 'Template').slice(0, 60));
    } catch { if (mountedRef.current) setTplErr('Couldn’t generate — try again.'); }
    finally { if (mountedRef.current) setTplGen(false); }
  };
  const saveTpl = async () => {
    const built: { body: string; kind: 'text' | 'html' } = tplBuild === 'chat' ? { body: tplBody.trim(), kind: 'html' } : tplComputed();
    if (!tplSubject.trim() || !built.body || tplSaving) return;
    tap(); setTplSaving(true); setTplErr(''); setChatErr('');
    try {
      await saveTemplate({ id: tplEdit?.id, name: tplName.trim() || tplSubject.trim().slice(0, 60), subject: tplSubject.trim(), body: built.body, kind: built.kind, chat: tplBuild === 'chat' ? chatMsgs : undefined });
      if (!mountedRef.current) return;
      setTplEdit(null);
      listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
    } catch { if (mountedRef.current) { setTplErr('Couldn’t save — try again.'); setChatErr('Couldn’t save — try again.'); } }
    finally { if (mountedRef.current) setTplSaving(false); }
  };
  const delTpl = async () => {
    if (!tplEdit?.id) { setTplEdit(null); return; }
    tap();
    await deleteTemplate(tplEdit.id).catch(() => {});
    if (!mountedRef.current) return;
    setTplEdit(null);
    listTemplates().then((t) => { if (mountedRef.current) setTplList(t); });
  };

  // ---- Brand profile ----
  const uploadLogo = () => pickImage(async (b64, ct) => {
    if (!b64) return;
    setBBusy(true);
    try { const url = await uploadEmailImage(b64, ct); if (mountedRef.current) setBLogo(url); }
    catch { /* ignore */ }
    finally { if (mountedRef.current) setBBusy(false); }
  });
  const saveBrandProfile = async () => {
    if (bBusy) return;
    tap(); setBBusy(true);
    try {
      await saveBrand({ name: bName.trim(), logo_url: bLogo, color: bColor, voice: bVoice.trim(), signoff: bSignoff.trim(), address: bAddress.trim() });
      if (!mountedRef.current) return;
      setBHas(!!(bName.trim() || bLogo || bVoice.trim() || bSignoff.trim() || bAddress.trim()));
      setBrandEdit(false);
    } catch { /* ignore */ }
    finally { if (mountedRef.current) setBBusy(false); }
  };

  const inMailInbox = !!commsApp && commsApp !== 'telegram' && emailTab === 'inbox' && !reading;
  const inTgList = commsApp === 'telegram' && !tgChat;
  const showRefresh = inMailInbox || inTgList;
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
    : agent === null ? 'Agents'
    : commsApp === null ? SENDRA_META[sendraTab].t
    : commsApp === 'telegram' ? (tgChat ? tgChat.title : 'Telegram')
    : emailTab === 'inbox' ? 'Inbox'
    : emailTab === 'contacts' ? 'Contacts'
    : emailTab === 'compose' ? (replyThreadId ? 'Reply' : 'New email')
    : (commsApp === 'm365' ? 'Outlook' : 'Gmail');
  const subtitle = reading ? (reading.from || reading.email || 'Message')
    : agent === null ? 'Your AI specialists — each one handles a job'
    : commsApp === null ? SENDRA_META[sendraTab].s
    : commsApp === 'telegram' ? (tgChat ? (tgChat.username ? `@${tgChat.username}` : 'Chat') : `${tgList.length || ''} chats`.trim() || 'Your chats')
    : emailTab === 'inbox' ? 'Newest first'
    : emailTab === 'contacts' ? (contacts.length ? `${contacts.length} people` : 'Your contacts')
    : emailTab === 'compose' ? (sendState === 'sent' ? 'Sent' : 'Compose')
    : (mailConnected ? 'Ready' : 'Connect to begin');

  const sortedMsgs = [...tgMsgs].sort((a, b) => (a.date || 0) - (b.date || 0));

  return (
    <div className="memg ag" ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={reading || agent ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">{title}</h1>
          <p className="memg-sub">{subtitle}</p>
        </div>
        {showRefresh ? (
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
          {mailConnected && reading.threadId ? (
            <button className="ag-send-btn ag-reply-btn" onClick={openReply}>Reply</button>
          ) : null}
        </div>
      ) : agent === null ? (
        <div className="ag-stage">
          <div className="ag-list">
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className={`ag-card${a.live ? '' : ' soon'}`}
                disabled={!a.live}
                onClick={() => { if (a.live) { tap(); setCommsApp(null); setSendraTab('home'); setAgent(a.id as AgentId); } }}
              >
                {a.id === 'email'
                  ? <span className="ag-ic ag-ic-logo"><img src={SENDRA_LOGO} alt="" /></span>
                  : <span className="ag-ic"><a.icon size={22} /></span>}
                <span className="ag-meta">
                  <span className="ag-name">{a.name}</span>
                  <span className="ag-desc">{a.desc}</span>
                </span>
                {a.live ? <span className="ag-chev" aria-hidden="true">›</span> : <span className="ag-soon">Soon</span>}
              </button>
            ))}
          </div>
          <p className="ag-foot">More agents on the way — each a specialist that works across your connected apps.</p>
        </div>

      ) : commsApp === null ? (
        sendraTab === 'home' ? (
          // ---- Sendra home: the tool menu (Campaigns, Templates, Analytics, Calendar, My apps) ----
          <div className="ag-stage">
            <div className="ag-grid">
              {HOME_TOOLS.map((t) => (
                <button key={t.id} className="ag-act" onClick={() => { if (t.id === 'inbox') openInbox(); else { tap(); setNote(''); if (t.id === 'texts') { setSmsState('idle'); setSmsErr(''); } setSendraTab(t.id as SendraTab); } }}>
                  <span className="ag-act-ic"><t.Icon size={20} /></span>
                  <span className="ag-act-label">{t.name}</span>
                  <span className="ag-act-sub">{t.id === 'apps' ? (deckApps.length ? deckApps.map((c) => c.name).join(' · ') : 'Connect an app') : t.desc}</span>
                </button>
              ))}
            </div>
            <p className="ag-foot">Sendra runs your communication — campaigns, templates and triage across every connected app.</p>
          </div>
        ) : sendraTab === 'apps' ? (
          // ---- Sendra constellation: hub + connected comms apps as nodes ----
          <div className="ag-stage ag-tree-stage">
          {deckApps.length === 0 ? (
            connectCard('Link Gmail, Outlook or Telegram so Sendra has something to manage.')
          ) : (
            <div className="ag-tree">
              <svg className="ag-tree-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {deckApps.map((c, i) => {
                  const p = nodePos(i, deckApps.length);
                  return <line key={c.id} x1={HUB.x} y1={HUB.y} x2={p.x} y2={p.y} pathLength={1} className="ag-tree-line" style={{ animationDelay: `${i * 90}ms` }} />;
                })}
              </svg>
              <div className="ag-tree-hub" style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}>
                <span className="ag-tree-hub-ic"><img src={SENDRA_LOGO} alt="Sendra" /></span>
                <span className="ag-tree-hub-name">Sendra</span>
              </div>
              {deckApps.map((c, i) => {
                const p = nodePos(i, deckApps.length);
                return (
                  <div
                    key={c.id}
                    className="ag-tree-node"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${140 + i * 90}ms` }}
                  >
                    <span className="ag-tree-node-ic"><BrandLogo app={c.id} size={34} /></span>
                    <span className="ag-tree-node-name">{c.name}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="ag-tree-hint">Sendra runs them all.</p>
        </div>
        ) : (
          // ---- Campaigns / Templates / Analytics / Calendar (P0 scaffolds) ----
          <div className="ag-stage">
            {note && <div className="ag-note">{note}</div>}
            {sendraTab === 'campaigns' ? (
              campNew ? (
                campState === 'done' ? (
                  <div className="ag-sent">
                    <span className="ag-sent-ic"><IconCheck size={26} /></span>
                    <div className="ag-sent-title">Campaign sent</div>
                    <div className="ag-sent-sub">{campProg.sent} sent{campProg.failed ? `, ${campProg.failed} failed` : ''}.</div>
                    <div className="ag-sent-actions">
                      <button className="ag-send-btn ghost" onClick={openCampNew}>New campaign</button>
                      <button className="ag-send-btn" onClick={() => { tap(); setCampNew(false); setCampState('idle'); }}>Done</button>
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
                    {mailApiApps.length >= 2 && (
                      <div className="ag-seg">
                        <button className={campApp === 'gmail' ? 'on' : ''} onClick={() => { tap(); setCampApp('gmail'); }}>Gmail</button>
                        <button className={campApp === 'outlook' ? 'on' : ''} onClick={() => { tap(); setCampApp('outlook'); }}>Outlook</button>
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
                    <textarea className="ag-field ag-camp-recips" placeholder={'Recipients — one per line:\njane@example.com\nJohn Smith <john@example.com>'} value={campRecips}
                      onChange={(e) => { setCampRecips(e.target.value); if (campState === 'err') setCampState('idle'); }} />
                    {campState === 'err' && <div className="ag-send-err">{campErr}</div>}
                    <button className="ag-send-btn" disabled={campState === 'sending' || !campSubject.trim() || !campBody.trim() || !campRecips.trim()} onClick={runCampaign}>
                      {campState === 'sending' ? `Sending… ${campProg.sent}/${campProg.total}` : 'Send campaign'}
                    </button>
                    <button className="ag-send-btn ghost" disabled={campState === 'sending'} onClick={() => { tap(); setCampNew(false); }}>Cancel</button>
                    <p className="ag-foot">Sends from your {campApp === 'outlook' ? 'Outlook' : 'Gmail'}, about one per second, each with a one-tap unsubscribe. Unsubscribed addresses are skipped automatically.</p>
                  </div>
                )
              ) : (
                <>
                  <button className="ag-send-btn" onClick={openCampNew}>+ New email campaign</button>
                  {campList.length === 0 ? (
                    <div className="ag-empty" style={{ marginTop: 12 }}>No campaigns yet. Write once and send to your whole list — straight from your mailbox.</div>
                  ) : (
                    <div className="ag-camp-list">
                      {campList.map((c) => (
                        <div className="ag-camp" key={c.id}>
                          <div className="ag-camp-main">
                            <div className="ag-camp-name">{c.name || c.subject || 'Campaign'}</div>
                            <div className="ag-camp-sub">{c.subject}</div>
                          </div>
                          <div className="ag-camp-meta">
                            <span className={`ag-camp-pill is-${c.status}`}>{c.status}</span>
                            <span className="ag-camp-count">{c.sent}/{c.total}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="ag-foot">SMS campaigns (Twilio) are coming next.</p>
                </>
              )
            ) : sendraTab === 'templates' ? (
              brandEdit ? (
                <div className="ag-compose">
                  <div className="ag-brand-logo">
                    {bLogo ? <img src={bLogo} alt="Logo" /> : <div className="ag-brand-logo-ph">No logo yet</div>}
                    <button className="ag-send-btn ghost" disabled={bBusy} onClick={uploadLogo}>{bBusy ? 'Uploading…' : bLogo ? 'Replace logo' : 'Upload logo'}</button>
                  </div>
                  <input className="ag-field" placeholder="Business name" value={bName} onChange={(e) => setBName(e.target.value)} />
                  <label className="ag-brand-color">Brand color<input type="color" value={bColor} onChange={(e) => setBColor(e.target.value)} /><span>{bColor}</span></label>
                  <input className="ag-field" placeholder="Voice — e.g. warm & casual, polished & pro" value={bVoice} onChange={(e) => setBVoice(e.target.value)} />
                  <input className="ag-field" placeholder="Sign-off — e.g. — Cristian, Ania’s Capital" value={bSignoff} onChange={(e) => setBSignoff(e.target.value)} />
                  <input className="ag-field" placeholder="Footer address — e.g. 1124 Robinwood Rd, Gastonia NC" value={bAddress} onChange={(e) => setBAddress(e.target.value)} />
                  <button className="ag-send-btn" disabled={bBusy} onClick={saveBrandProfile}>{bBusy ? 'Saving…' : 'Save brand'}</button>
                  <button className="ag-send-btn ghost" disabled={bBusy} onClick={() => { tap(); setBrandEdit(false); }}>Cancel</button>
                  <p className="ag-foot">The AI designer uses this on every generated email — logo, color, voice and sign-off.</p>
                </div>
              ) : tplChoose ? (
                <div className="ag-choose">
                  <button className="ag-choice" onClick={startAI}>
                    <span className="ag-choice-ic">✨</span>
                    <span className="ag-choice-t">Generate with AI</span>
                    <span className="ag-choice-s">Describe it in chat — Sendra designs it, you refine by chatting.</span>
                  </button>
                  <button className="ag-choice" onClick={startManual}>
                    <span className="ag-choice-ic">🔧</span>
                    <span className="ag-choice-t">Build manually</span>
                    <span className="ag-choice-s">Write, paste your HTML, or upload a flyer yourself.</span>
                  </button>
                  <button className="ag-send-btn ghost" onClick={() => { tap(); setTplChoose(false); }}>Cancel</button>
                </div>
              ) : (tplEdit && tplBuild === 'chat') ? (
                chatView === 'preview' ? (
                  <div className="ag-compose">
                    <div className="ag-tpl-preview-bar" style={{ borderRadius: '10px 10px 0 0' }}>
                      <button onClick={() => { tap(); setChatView('chat'); }}>‹ Chat</button><span>Preview</span>
                    </div>
                    <iframe className="ag-tpl-frame" title="Email preview" sandbox="allow-same-origin allow-popups" srcDoc={buildSrcDoc(tplBody || '<div style="padding:40px;text-align:center;color:#888;font-family:sans-serif">Nothing yet — chat to build it.</div>')} />
                    <input className="ag-field" placeholder="Subject" value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} />
                    <input className="ag-field" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
                    {chatErr && <div className="ag-send-err">{chatErr}</div>}
                    <button className="ag-send-btn" disabled={tplSaving || !tplBody.trim() || !tplSubject.trim()} onClick={saveTpl}>{tplSaving ? 'Saving…' : 'Save template'}</button>
                    <div className="ag-sent-actions">
                      <button className="ag-send-btn ghost" disabled={tplSaving} onClick={() => { tap(); setTplEdit(null); }}>Close</button>
                      {tplEdit.id && <button className="ag-send-btn ghost" disabled={tplSaving} onClick={delTpl}>Delete</button>}
                    </div>
                  </div>
                ) : (
                  <div className="ag-chatb">
                    {chatHistory.length > 0 && (
                      <div className="ag-chatb-tools"><button className="ag-chatb-undo" onClick={undoChat} disabled={chatBusy}>↩ Undo last change</button></div>
                    )}
                    <div className="ag-chatb-thread">
                      <div className="ag-cb-a">Hey! Describe the email you want and I’ll design it on your brand. ✨</div>
                      {chatMsgs.map((m, i) => (
                        <div key={i} className={m.role === 'user' ? 'ag-cb-u' : 'ag-cb-a'}>{m.content}</div>
                      ))}
                      {chatBusy && <div className="ag-cb-a ag-cb-typing">Designing…</div>}
                      {chatErr && <div className="ag-cb-err">{chatErr}</div>}
                    </div>
                    {tplBody.trim() && <button className="ag-chatb-peek" onClick={() => { tap(); setChatView('preview'); }}><span className="ar">→</span><span className="tx">VIEW</span></button>}
                    {tplImages.length > 0 && (
                      <div className="ag-chatb-atts">
                        {tplImages.map((u, i) => (<div className="ag-imgs-thumb" key={i}><img src={u} alt="" /><button onClick={() => { tap(); setTplImages((xs) => xs.filter((_, j) => j !== i)); }}>×</button></div>))}
                      </div>
                    )}
                    <div className="ag-chatb-bar">
                      <button className="ag-chatb-attach" disabled={tplImgBusy} onClick={addDesignImage} aria-label="Attach photo">{tplImgBusy ? '…' : '📎'}</button>
                      <input className="ag-chatb-input" placeholder="Message Sendra…" value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && chatInput.trim() && !chatBusy) sendChat(); }} />
                      <button className="ag-chatb-send" disabled={!chatInput.trim() || chatBusy} onClick={sendChat}>↑</button>
                    </div>
                  </div>
                )
              ) : tplEdit ? (
                <div className="ag-compose">
                  <div className="ag-seg">
                    <button className={tplMode === 'text' ? 'on' : ''} onClick={() => { tap(); setTplMode('text'); }}>Write</button>
                    <button className={tplMode === 'flyer' ? 'on' : ''} onClick={() => { tap(); setTplMode('flyer'); }}>Flyer</button>
                    <button className={tplMode === 'html' ? 'on' : ''} onClick={() => { tap(); setTplMode('html'); }}>Paste HTML</button>
                  </div>
                  <input className="ag-field" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
                  <input className="ag-field" placeholder="Subject" value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} />
                  {tplMode === 'text' && (
                    <>
                      <div className="ag-ai">
                        <textarea className="ag-ai-input" placeholder="Describe the email — e.g. “a warm note announcing 20% off summer styles, ends Sunday”" value={tplPrompt}
                          onChange={(e) => setTplPrompt(e.target.value)} />
                        <div className="ag-ai-controls">
                          <div className="ag-ai-toggle">
                            <button className={tplGenDesign ? 'on' : ''} onClick={() => { tap(); setTplGenDesign(true); }}>Designed</button>
                            <button className={!tplGenDesign ? 'on' : ''} onClick={() => { tap(); setTplGenDesign(false); }}>Plain</button>
                          </div>
                          <button className="ag-ai-btn" disabled={tplGen || !tplPrompt.trim()} onClick={genTpl}>{tplGen ? 'Writing…' : '✨ Generate'}</button>
                        </div>
                      </div>
                      {tplGenDesign ? (
                        <div className="ag-imgs">
                          <div className="ag-imgs-head"><span>Photos for the design</span><button disabled={tplImgBusy} onClick={addDesignImage}>{tplImgBusy ? 'Uploading…' : '+ Add photo'}</button></div>
                          {tplImages.length > 0 && (
                            <div className="ag-imgs-row">
                              {tplImages.map((u, i) => (
                                <div className="ag-imgs-thumb" key={i}><img src={u} alt="" /><button onClick={() => { tap(); setTplImages((xs) => xs.filter((_, j) => j !== i)); }}>×</button></div>
                              ))}
                            </div>
                          )}
                          <div className="ag-imgs-hint">First photo becomes the hero. No photos? The design uses placeholder boxes.</div>
                        </div>
                      ) : (
                        <textarea className="ag-field ag-body" placeholder="Body — use {{name}} to personalize" value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
                      )}
                    </>
                  )}
                  {tplMode === 'flyer' && (
                    <>
                      {tplFlyerUrl ? <img className="ag-flyer-img" src={tplFlyerUrl} alt="Flyer" /> : <div className="ag-flyer-drop">Upload a flyer or poster — it becomes the whole email.</div>}
                      <button className="ag-send-btn ghost" disabled={tplImgBusy} onClick={uploadFlyer}>{tplImgBusy ? 'Uploading…' : tplFlyerUrl ? 'Replace image' : 'Upload image'}</button>
                      <input className="ag-field" placeholder="Link when tapped (optional) — https://…" value={tplFlyerLink} onChange={(e) => setTplFlyerLink(e.target.value)} />
                    </>
                  )}
                  {tplMode === 'html' && (
                    <textarea className="ag-field ag-body ag-html-input" placeholder="Paste your email HTML here…" value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
                  )}
                  {tplMode !== 'text' && tplComputed().body && (
                    <div className="ag-tpl-preview">
                      <div className="ag-tpl-preview-bar"><span>Preview</span></div>
                      <iframe className="ag-tpl-frame" title="Template preview" sandbox="allow-same-origin allow-popups" srcDoc={buildSrcDoc(tplComputed().body)} />
                    </div>
                  )}
                  {tplErr && <div className="ag-send-err">{tplErr}</div>}
                  <button className="ag-send-btn" disabled={tplSaving || !tplSubject.trim() || !tplComputed().body} onClick={saveTpl}>{tplSaving ? 'Saving…' : 'Save template'}</button>
                  <div className="ag-sent-actions">
                    <button className="ag-send-btn ghost" disabled={tplSaving} onClick={() => { tap(); setTplEdit(null); }}>Cancel</button>
                    {tplEdit.id && <button className="ag-send-btn ghost" disabled={tplSaving} onClick={delTpl}>Delete</button>}
                  </div>
                </div>
              ) : (
                <>
                  <button className="ag-brand-row" onClick={() => { tap(); setBrandEdit(true); }}>
                    <span className="ag-brand-row-ic" aria-hidden="true">🎨</span>
                    <span className="ag-brand-row-main">
                      <span className="ag-brand-row-t">Brand voice</span>
                      <span className="ag-brand-row-s">{bHas ? (bName || 'Logo, color & tone set') : 'Set your logo, color, voice & sign-off'}</span>
                    </span>
                    <span className="ag-chev" aria-hidden="true">›</span>
                  </button>
                  <button className="ag-send-btn" onClick={openChoice}>+ New template</button>
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
            ) : sendraTab === 'analytics' ? (
              <>
                <div className="ag-stats">
                  <div className="ag-stat"><div className="ag-stat-v">—</div><div className="ag-stat-k">Sent</div></div>
                  <div className="ag-stat"><div className="ag-stat-v">—</div><div className="ag-stat-k">Delivered</div></div>
                  <div className="ag-stat"><div className="ag-stat-v">—</div><div className="ag-stat-k">Opened</div></div>
                  <div className="ag-stat"><div className="ag-stat-v">—</div><div className="ag-stat-k">Clicked</div></div>
                </div>
                <div className="ag-empty" style={{ marginTop: 12 }}>Analytics appear once you send a campaign — opens, clicks, replies and deliveries per send.</div>
              </>
            ) : sendraTab === 'texts' ? (
              smsState === 'sent' ? (
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
                  <p className="ag-foot">Texts send from your workspace number. Standard SMS rates apply.</p>
                </div>
              )
            ) : (
              <div className="ag-empty">Nothing scheduled. Schedule a campaign and it shows up here, alongside reminders.</div>
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
          {!mailConnected ? connectCard('Link this mailbox so the agent can pull your contacts.')
            : contactsState === 'err' ? (
              <div className="ag-empty">
                Couldn’t load contacts.{' '}
                <button className="ag-retry" onClick={() => { tap(); loadContacts(); }}>Try again</button>
              </div>
            ) : contactsState === 'ok' && contacts.length === 0 ? (
              <div className="ag-empty">No contacts found.</div>
            ) : contacts.length ? (
              <ContactsList items={contacts} />
            ) : (
              <EmailSkeleton />
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
                  <button className="ag-send-btn" onClick={() => { tap(); setEmailTab('home'); }}>Done</button>
                </div>
              </div>
            ) : (
              <>
                <input
                  className="ag-field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
                  placeholder="To" value={to} onChange={(e) => setTo(e.target.value)}
                />
                <input className="ag-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <textarea className="ag-field ag-body" placeholder="Write your message…" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
                {sendState === 'err' && <div className="ag-send-err">Couldn’t send — check the address and try again.</div>}
                <button
                  className="ag-send-btn"
                  onClick={() => { tap(); setSendState('confirm'); }}
                  disabled={!validTo || sendState === 'sending'}
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
            {EMAIL_ACTIONS.map((act) => (
              <button
                key={act.id}
                className="ag-act"
                onClick={() => {
                  tap();
                  if (act.id === 'inbox') setEmailTab('inbox');
                  else if (act.id === 'new') openCompose();
                  else if (act.id === 'contacts') setEmailTab('contacts');
                }}
              >
                <span className="ag-act-ic"><act.icon size={20} /></span>
                <span className="ag-act-label">{act.label}</span>
                <span className="ag-act-sub">{act.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
