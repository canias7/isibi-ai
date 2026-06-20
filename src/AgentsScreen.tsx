import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconBank, IconInbox, IconRefresh, IconCheck, IconContacts,
  IconChart, IconCalendar, IconDoc,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox, sendEmail, fetchContacts, tgChats, tgMessages, tgSend, tgStatus, type TgChat, type TgMessage } from './api';
import { EmailList, EmailDetail, EmailSkeleton, ContactsList, type EmailItem, type ContactItem } from './EmailList';
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
type SendraTab = 'home' | 'apps' | 'campaigns' | 'templates' | 'analytics' | 'calendar';
const SENDRA_META: Record<SendraTab, { t: string; s: string }> = {
  home: { t: 'Sendra', s: 'Your communication hub' },
  apps: { t: 'My apps', s: 'Tap an app to open it' },
  campaigns: { t: 'Campaigns', s: 'Email & SMS to your lists' },
  templates: { t: 'Templates', s: 'Reusable messages' },
  analytics: { t: 'Analytics', s: 'Performance across your sends' },
  calendar: { t: 'Calendar', s: 'Scheduled sends & reminders' },
};
// Sendra home menu. 'apps' opens the constellation; the rest are P0 scaffolds.
const HOME_TOOLS: { id: SendraTab; name: string; desc: string; Icon: IconCmp }[] = [
  { id: 'campaigns', name: 'Campaigns', desc: 'Email & SMS — send to a whole list', Icon: IconWaveform },
  { id: 'templates', name: 'Templates', desc: 'Reusable messages for your campaigns', Icon: IconDoc },
  { id: 'analytics', name: 'Analytics', desc: 'Opens, clicks, replies & delivery', Icon: IconChart },
  { id: 'calendar', name: 'Calendar', desc: 'Scheduled sends & reminders', Icon: IconCalendar },
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
  // Telegram workspace
  const [tgConnected, setTgConnected] = useState<boolean>(() => cachedConnected('telegram'));
  const [tgList, setTgList] = useState<TgChat[]>(() => tgChatsCache ?? []);
  const [tgListState, setTgListState] = useState<Loadable>(tgChatsCache ? 'ok' : 'idle');
  const [tgChat, setTgChat] = useState<TgChat | null>(null);
  const [tgMsgs, setTgMsgs] = useState<TgMessage[]>([]);
  const [tgMsgsState, setTgMsgsState] = useState<Loadable>('idle');
  const [tgReply, setTgReply] = useState('');
  const [tgSending, setTgSending] = useState(false);

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
    else if (commsApp && commsApp !== 'telegram' && emailTab !== 'home') setEmailTab('home');
    else if (commsApp) setCommsApp(null);
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
      refreshInbox();
    } else if (emailTab === 'contacts') {
      loadContacts();
    }
  }, [agent, commsApp, emailTab, tgChat, refreshInbox, loadContacts, loadTgChats, loadTgMsgs]);

  const openComms = (id: CommsId) => {
    tap();
    setCommsApp(id);
    if (id === 'telegram') {
      setTgChat(null);
      setTgList(tgChatsCache ?? []);
      setTgListState(tgChatsCache ? 'ok' : 'idle');
    } else {
      const a = id === 'm365' ? 'outlook' : 'gmail';
      setEmailTab('home');
      setInbox(inboxCache[a] ?? []);
      setInboxState(inboxCache[a] ? 'ok' : 'idle');
      setContacts(contactsCache[a] ?? []);
      setContactsState(contactsCache[a] ? 'ok' : 'idle');
      tokensRef.current = [undefined];
      setPageIdx(0);
    }
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
    if (pullStart.current !== null && pull >= PULL_THRESHOLD && mailConnected && !refreshing) refreshInbox();
    pullStart.current = null;
    setPull(0);
  };

  // Compose helpers
  const openCompose = () => { tap(); setReplyThreadId(null); setTo(''); setSubject(''); setBodyText(''); setSendState('idle'); setEmailTab('compose'); };
  const openReply = () => {
    if (!reading) return;
    tap();
    const subj = reading.subject || '';
    setReplyThreadId(reading.threadId || null);
    setTo(reading.email || '');
    setSubject(/^re:/i.test(subj) ? subj : `Re: ${subj}`);
    setBodyText('');
    setSendState('idle');
    setReading(null);
    setEmailTab('compose');
  };
  const validTo = EMAIL_RE.test(to.trim());
  const doSend = () => {
    tap();
    setSendState('sending');
    sendEmail({ to: to.trim(), subject: subject.trim(), body: bodyText, threadId: replyThreadId || undefined, app: mailApp })
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

  const inMailInbox = !!commsApp && commsApp !== 'telegram' && emailTab === 'inbox' && !reading;
  const inTgList = commsApp === 'telegram' && !tgChat;
  const showRefresh = inMailInbox || inTgList;
  const refreshSpin = refreshing || (inTgList && tgListState === 'loading');
  const doRefresh = () => { tap(); if (inMailInbox) refreshInbox(); else if (inTgList) loadTgChats(); };
  const goPage = (idx: number) => { if (refreshing) return; tap(); loadPage(idx); };
  const hasPager = pageIdx > 0 || !!nextTok;

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
            <div className="ag-list">
              {HOME_TOOLS.map((t) => (
                <button key={t.id} className="ag-card" onClick={() => { tap(); setNote(''); setSendraTab(t.id); }}>
                  <span className="ag-ic"><t.Icon size={22} /></span>
                  <span className="ag-meta">
                    <span className="ag-name">{t.name}</span>
                    <span className="ag-desc">{t.id === 'apps' ? (deckApps.length ? deckApps.map((c) => c.name).join(' · ') : 'Connect Gmail, Outlook or Telegram') : t.desc}</span>
                  </span>
                  <span className="ag-chev" aria-hidden="true">›</span>
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
                  <button
                    key={c.id}
                    className="ag-tree-node"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${140 + i * 90}ms` }}
                    onClick={() => openComms(c.id)}
                  >
                    <span className="ag-tree-node-ic"><BrandLogo app={c.id} size={34} /></span>
                    <span className="ag-tree-node-name">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="ag-tree-hint">Tap an app — Sendra runs them all.</p>
        </div>
        ) : (
          // ---- Campaigns / Templates / Analytics / Calendar (P0 scaffolds) ----
          <div className="ag-stage">
            {note && <div className="ag-note">{note}</div>}
            {sendraTab === 'campaigns' ? (
              <>
                <button className="ag-send-btn" onClick={() => { tap(); setNote('Campaign builder is next — pick Email or SMS, choose a list, write once, and Sendra sends to everyone.'); }}>+ New campaign</button>
                <div className="ag-grid" style={{ marginTop: 12 }}>
                  <button className="ag-act" onClick={() => { tap(); setNote('Email campaigns: small sends go through your mailbox now; bulk uses the built-in sender (P2).'); }}>
                    <span className="ag-act-ic"><IconCompose size={20} /></span>
                    <span className="ag-act-label">Email campaign</span>
                    <span className="ag-act-sub">To a list</span>
                  </button>
                  <button className="ag-act" onClick={() => { tap(); setNote('SMS campaigns use the built-in SMS sender (Twilio + 10DLC) — coming in P3.'); }}>
                    <span className="ag-act-ic"><IconWaveform size={20} /></span>
                    <span className="ag-act-label">SMS campaign</span>
                    <span className="ag-act-sub">To a list</span>
                  </button>
                </div>
                <div className="ag-empty" style={{ marginTop: 12 }}>No campaigns yet.</div>
              </>
            ) : sendraTab === 'templates' ? (
              <>
                <button className="ag-send-btn" onClick={() => { tap(); setNote('Templates are next — save a reusable email or SMS, then drop it into any campaign.'); }}>+ New template</button>
                <div className="ag-empty" style={{ marginTop: 12 }}>No templates yet. Save reusable email &amp; SMS messages and reuse them across campaigns.</div>
              </>
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
                <button className="ag-retry" onClick={() => { tap(); refreshInbox(); }}>Try again</button>
              </div>
            ) : inboxState === 'ok' && inbox.length === 0 ? (
              <div className="ag-empty">Inbox is empty.</div>
            ) : inbox.length ? (
              <>
                <div className="ag-inbox" key={pageIdx}>
                  <EmailList items={inbox} onOpen={(it) => { tap(); setReading(it); }} />
                </div>
                {hasPager && (
                  <div className="ag-pager">
                    <button onClick={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || refreshing}>‹ Prev</button>
                    <span className="ag-pager-n">Page {pageIdx + 1}</span>
                    <button onClick={() => goPage(pageIdx + 1)} disabled={!nextTok || refreshing}>Next ›</button>
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
