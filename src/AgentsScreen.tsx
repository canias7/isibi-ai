import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconBank, IconInbox, IconRefresh, IconCheck,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox, sendEmail } from './api';
import { EmailList, EmailDetail, EmailSkeleton, type EmailItem } from './EmailList';

// Each agent is a *role* that spans apps (not an app). Only the Email agent is
// live today; the rest are shown as "soon" so the roadmap is visible without
// faking capability. Tapping a live agent opens its full-screen workspace.
type AgentId = 'email';
type IconCmp = typeof IconCompose;
type AgentDef = { id: string; name: string; desc: string; icon: IconCmp; live: boolean };

const AGENTS: AgentDef[] = [
  { id: 'email', name: 'Email Agent', desc: 'Drafts, sequences & broadcasts across your inbox', icon: IconCompose, live: true },
  { id: 'books', name: 'Bookkeeper', desc: 'Invoices, payments & reconciliation', icon: IconBank, live: false },
  { id: 'sched', name: 'Scheduler', desc: 'Meetings, reminders & calendar triage', icon: IconClock, live: false },
];

// The Email agent's top cards. "Inbox" and "New email" are live; the rest are stubs.
const EMAIL_ACTIONS: { id: string; label: string; sub: string; icon: IconCmp }[] = [
  { id: 'inbox', label: 'Inbox', sub: 'View mail', icon: IconInbox },
  { id: 'new', label: 'New email', sub: 'Single send', icon: IconCompose },
  { id: 'sequence', label: 'Sequence', sub: 'Multi-step', icon: IconLayers },
  { id: 'broadcast', label: 'Broadcast', sub: 'To a list', icon: IconWaveform },
];

const PAGE_SIZE = 20;       // emails per page (kept small — GMAIL_FETCH_EMAILS is slow at high counts)
const PULL_THRESHOLD = 64;  // px of pull-down that triggers a refresh
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Session cache (page 0) so re-opening the inbox is instant. In-memory only.
let inboxCache: EmailItem[] | null = null;

type EmailTab = 'home' | 'inbox' | 'compose';
type SendState = 'idle' | 'confirm' | 'sending' | 'sent' | 'err';

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [emailTab, setEmailTab] = useState<EmailTab>('home');
  const [inbox, setInbox] = useState<EmailItem[]>(() => inboxCache ?? []);
  const [inboxState, setInboxState] = useState<'idle' | 'loading' | 'ok' | 'err'>(inboxCache ? 'ok' : 'idle');
  const [refreshing, setRefreshing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextTok, setNextTok] = useState<string | null>(null);
  const [reading, setReading] = useState<EmailItem | null>(null);
  const [pull, setPull] = useState(0);
  // Compose / reply state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const tokensRef = useRef<(string | undefined)[]>([undefined]);
  const pullStart = useRef<number | null>(null);
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Back steps one level: reader -> inbox/compose -> the agent's cards -> list -> close.
  const back = () => {
    tap();
    if (reading) setReading(null);
    else if (sendState === 'confirm') setSendState('idle');
    else if (emailTab === 'inbox' || emailTab === 'compose') setEmailTab('home');
    else if (agent) setAgent(null);
    else onClose();
  };
  useFocusTrap(true, trapRef, back);

  const hasMail = connApps.includes('gmail') || connApps.includes('outlook');

  const loadPage = useCallback((idx: number) => {
    setRefreshing(true);
    if (idx === 0 && !inboxCache) setInboxState('loading');
    fetchInbox(PAGE_SIZE, tokensRef.current[idx])
      .then(({ items, nextPageToken }) => {
        if (!mountedRef.current) return;
        setInbox(items); setInboxState('ok'); setPageIdx(idx); setNextTok(nextPageToken);
        if (nextPageToken && tokensRef.current.length === idx + 1) tokensRef.current.push(nextPageToken);
        if (idx === 0) inboxCache = items;
        inboxScrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => { if (mountedRef.current && idx === 0 && !inboxCache) setInboxState('err'); })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, []);

  const refreshInbox = useCallback(() => { tokensRef.current = [undefined]; loadPage(0); }, [loadPage]);

  useEffect(() => {
    if (agent === 'email' && emailTab === 'inbox' && hasMail) refreshInbox();
  }, [agent, emailTab, hasMail, refreshInbox]);

  const onPullStart = (e: React.TouchEvent<HTMLDivElement>) => {
    pullStart.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onPullMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStart.current === null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, 90) : 0);
  };
  const onPullEnd = () => {
    if (pullStart.current !== null && pull >= PULL_THRESHOLD && hasMail && !refreshing) refreshInbox();
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
    sendEmail({ to: to.trim(), subject: subject.trim(), body: bodyText, threadId: replyThreadId || undefined })
      .then(() => { if (mountedRef.current) setSendState('sent'); })
      .catch(() => { if (mountedRef.current) setSendState('err'); });
  };

  const inInbox = agent === 'email' && emailTab === 'inbox' && !reading;
  const goPage = (idx: number) => { if (refreshing) return; tap(); loadPage(idx); };
  const hasPager = pageIdx > 0 || !!nextTok;

  const connectCard = (extra: string) => (
    <div className="ag-connect">
      <span className="ag-connect-ic"><IconConnectors size={20} /></span>
      <div className="ag-connect-text">
        <div className="ag-connect-title">Connect a mailbox</div>
        <div className="ag-connect-sub">{extra}</div>
      </div>
    </div>
  );

  return (
    <div className="memg ag" ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={reading || agent ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">
            {reading ? 'Email'
              : agent === 'email' && emailTab === 'inbox' ? 'Inbox'
              : agent === 'email' && emailTab === 'compose' ? (replyThreadId ? 'Reply' : 'New email')
              : agent === 'email' ? 'Email Agent'
              : 'Agents'}
          </h1>
          <p className="memg-sub">
            {reading ? (reading.from || reading.email || 'Message')
              : agent === 'email' && emailTab === 'inbox' ? 'Newest first'
              : agent === 'email' && emailTab === 'compose' ? (sendState === 'sent' ? 'Sent' : 'Compose')
              : agent === 'email' ? (hasMail ? 'Ready' : 'Connect a mailbox to begin')
              : 'Your AI specialists — each one handles a job'}
          </p>
        </div>
        {inInbox ? (
          <button
            className={`ag-corner${refreshing ? ' spinning' : ''}`}
            onClick={() => { tap(); refreshInbox(); }}
            disabled={refreshing}
            aria-label="Refresh inbox"
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
          {hasMail && reading.threadId ? (
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
                onClick={() => { if (a.live) { tap(); setEmailTab('home'); setAgent(a.id as AgentId); } }}
              >
                <span className="ag-ic"><a.icon size={22} /></span>
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
          {!hasMail ? connectCard('Link Gmail or Outlook so the agent can read your inbox.')
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
      ) : emailTab === 'compose' ? (
        <div className="ag-stage ag-compose">
          {!hasMail ? connectCard('Link Gmail so the agent can send on your behalf.')
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
        <div className="ag-stage">
          {!hasMail && connectCard('Link Gmail or Outlook so the agent can read, draft and send.')}
          <div className="ag-grid">
            {EMAIL_ACTIONS.map((act) => (
              <button
                key={act.id}
                className="ag-act"
                onClick={() => { tap(); if (act.id === 'inbox') setEmailTab('inbox'); else if (act.id === 'new') openCompose(); }}
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
