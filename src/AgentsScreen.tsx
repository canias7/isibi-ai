import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconConnectors, IconClock, IconBank, IconInbox, IconRefresh,
} from './icons';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { fetchInbox } from './api';
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

// The Email agent's top cards. "Inbox" opens the inbox view; the rest open their
// own compose flows (stubbed for now).
const EMAIL_ACTIONS: { id: string; label: string; sub: string; icon: IconCmp }[] = [
  { id: 'inbox', label: 'Inbox', sub: 'View mail', icon: IconInbox },
  { id: 'new', label: 'New email', sub: 'Single send', icon: IconCompose },
  { id: 'sequence', label: 'Sequence', sub: 'Multi-step', icon: IconLayers },
  { id: 'broadcast', label: 'Broadcast', sub: 'To a list', icon: IconWaveform },
];

const PAGE_SIZE = 20;       // emails per page (kept small — GMAIL_FETCH_EMAILS is slow at high counts)
const PULL_THRESHOLD = 64;  // px of pull-down that triggers a refresh

// Session cache (page 0) so re-opening the inbox is instant. The overlay
// unmounts on close, so this lives at module scope. In-memory only — email
// snippets are never written to disk.
let inboxCache: EmailItem[] | null = null;

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [emailTab, setEmailTab] = useState<'home' | 'inbox'>('home');
  const [inbox, setInbox] = useState<EmailItem[]>(() => inboxCache ?? []);
  const [inboxState, setInboxState] = useState<'idle' | 'loading' | 'ok' | 'err'>(inboxCache ? 'ok' : 'idle');
  const [refreshing, setRefreshing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextTok, setNextTok] = useState<string | null>(null);
  const [reading, setReading] = useState<EmailItem | null>(null);
  const [pull, setPull] = useState(0); // pull-to-refresh distance (px)
  const tokensRef = useRef<(string | undefined)[]>([undefined]); // page_token per page (index 0 = none)
  const pullStart = useRef<number | null>(null);
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Back steps one level: reader -> inbox -> the agent's cards -> agent list -> close.
  const back = () => {
    tap();
    if (reading) setReading(null);
    else if (emailTab === 'inbox') setEmailTab('home');
    else if (agent) setAgent(null);
    else onClose();
  };
  useFocusTrap(true, trapRef, back);

  const hasMail = connApps.includes('gmail') || connApps.includes('outlook');

  // Fetch one page (20). Page 0 is cached for instant re-open; forward pages use
  // the stored Gmail page tokens. Small pages keep GMAIL_FETCH_EMAILS fast.
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

  // Refresh resets pagination back to the first page.
  const refreshInbox = useCallback(() => { tokensRef.current = [undefined]; loadPage(0); }, [loadPage]);

  // Load when the inbox view opens (instant from cache, then a background refresh).
  useEffect(() => {
    if (agent === 'email' && emailTab === 'inbox' && hasMail) refreshInbox();
  }, [agent, emailTab, hasMail, refreshInbox]);

  // Pull-to-refresh: only arms when the list is scrolled to the very top.
  const onPullStart = (e: React.TouchEvent<HTMLDivElement>) => {
    pullStart.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onPullMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStart.current === null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, 90) : 0); // damped, capped
  };
  const onPullEnd = () => {
    if (pullStart.current !== null && pull >= PULL_THRESHOLD && hasMail && !refreshing) refreshInbox();
    pullStart.current = null;
    setPull(0);
  };

  const inInbox = agent === 'email' && emailTab === 'inbox' && !reading;
  const goPage = (idx: number) => { if (refreshing) return; tap(); loadPage(idx); };
  const hasPager = pageIdx > 0 || !!nextTok;

  return (
    <div className="memg ag" ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={reading || agent ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">
            {reading ? 'Email' : inInbox ? 'Inbox' : agent === 'email' ? 'Email Agent' : 'Agents'}
          </h1>
          <p className="memg-sub">
            {reading ? (reading.from || reading.email || 'Message')
              : inInbox ? 'Newest first'
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
        <div className="ag-stage">
          <EmailDetail msg={{
            id: reading.id, app: reading.app, from: reading.from, email: reading.email,
            subject: reading.subject, time: reading.time, unread: reading.unread,
            draft: reading.draft, body: reading.snippet || '',
          }} />
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
          {!hasMail ? (
            <div className="ag-connect">
              <span className="ag-connect-ic"><IconConnectors size={20} /></span>
              <div className="ag-connect-text">
                <div className="ag-connect-title">Connect a mailbox</div>
                <div className="ag-connect-sub">Link Gmail or Outlook so the agent can read your inbox.</div>
              </div>
            </div>
          ) : inboxState === 'err' ? (
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
      ) : (
        <div className="ag-stage">
          {!hasMail && (
            <div className="ag-connect">
              <span className="ag-connect-ic"><IconConnectors size={20} /></span>
              <div className="ag-connect-text">
                <div className="ag-connect-title">Connect a mailbox</div>
                <div className="ag-connect-sub">Link Gmail or Outlook so the agent can read, draft and send.</div>
              </div>
            </div>
          )}
          <div className="ag-grid">
            {EMAIL_ACTIONS.map((act) => (
              <button
                key={act.id}
                className="ag-act"
                onClick={() => { tap(); if (act.id === 'inbox') setEmailTab('inbox'); /* else TODO: open the compose flow */ }}
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
