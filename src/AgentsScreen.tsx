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

const PAGE_SIZE = 20;       // emails shown per inbox page
const FETCH_COUNT = 60;     // how many we pull + sort (3 pages worth)
const PULL_THRESHOLD = 64;  // px of pull-down that triggers a refresh

// Session cache so re-opening the inbox is instant. The overlay unmounts on
// close, so this lives at module scope (not component state). In-memory only —
// email snippets are never written to disk.
let inboxCache: EmailItem[] | null = null;

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [emailTab, setEmailTab] = useState<'home' | 'inbox'>('home');
  const [inbox, setInbox] = useState<EmailItem[]>(() => inboxCache ?? []);
  const [inboxState, setInboxState] = useState<'idle' | 'loading' | 'ok' | 'err'>(inboxCache ? 'ok' : 'idle');
  const [refreshing, setRefreshing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [reading, setReading] = useState<EmailItem | null>(null);
  const [pull, setPull] = useState(0); // pull-to-refresh distance (px)
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

  // Fetch the inbox. Shows the cached list instantly and refreshes in the
  // background; only shows the skeleton when there's nothing cached yet.
  const loadInbox = useCallback(() => {
    setRefreshing(true);
    if (!inboxCache) setInboxState('loading');
    fetchInbox(FETCH_COUNT)
      .then((items) => { if (!mountedRef.current) return; inboxCache = items; setInbox(items); setInboxState('ok'); setPageIdx(0); })
      .catch(() => { if (mountedRef.current && !inboxCache) setInboxState('err'); })
      .finally(() => { if (mountedRef.current) setRefreshing(false); });
  }, []);

  // Load when the inbox view opens (instant from cache, then a background refresh).
  useEffect(() => {
    if (agent === 'email' && emailTab === 'inbox' && hasMail) loadInbox();
  }, [agent, emailTab, hasMail, loadInbox]);

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
    if (pullStart.current !== null && pull >= PULL_THRESHOLD && hasMail && !refreshing) loadInbox();
    pullStart.current = null;
    setPull(0);
  };

  const inInbox = agent === 'email' && emailTab === 'inbox' && !reading;
  const totalPages = Math.max(1, Math.ceil(inbox.length / PAGE_SIZE));
  const safeIdx = Math.min(pageIdx, totalPages - 1);
  const pageItems = inbox.slice(safeIdx * PAGE_SIZE, safeIdx * PAGE_SIZE + PAGE_SIZE);
  const goPage = (idx: number) => { tap(); setPageIdx(idx); inboxScrollRef.current?.scrollTo({ top: 0 }); };

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
              : inInbox ? (inbox.length ? `${inbox.length} recent` : 'Your inbox')
              : agent === 'email' ? (hasMail ? 'Ready' : 'Connect a mailbox to begin')
              : 'Your AI specialists — each one handles a job'}
          </p>
        </div>
        {inInbox ? (
          <button
            className={`ag-corner${refreshing ? ' spinning' : ''}`}
            onClick={() => { tap(); loadInbox(); }}
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
              <button className="ag-retry" onClick={() => { tap(); loadInbox(); }}>Try again</button>
            </div>
          ) : inboxState === 'ok' && inbox.length === 0 ? (
            <div className="ag-empty">Inbox is empty.</div>
          ) : inbox.length ? (
            <>
              <div className="ag-inbox" key={safeIdx}>
                <EmailList items={pageItems} onOpen={(it) => { tap(); setReading(it); }} />
              </div>
              {totalPages > 1 && (
                <div className="ag-pager">
                  <button onClick={() => goPage(safeIdx - 1)} disabled={safeIdx === 0}>‹ Prev</button>
                  <span className="ag-pager-n">Page {safeIdx + 1} of {totalPages}</span>
                  <button onClick={() => goPage(safeIdx + 1)} disabled={safeIdx >= totalPages - 1}>Next ›</button>
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
