import { useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft, IconCompose, IconLayers, IconWaveform,
  IconDoc, IconConnectors, IconClock, IconBank,
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

// The Email agent's quick actions — each opens its own flow (stubbed for now).
const EMAIL_ACTIONS: { id: string; label: string; sub: string; icon: IconCmp }[] = [
  { id: 'new', label: 'New email', sub: 'Single send', icon: IconCompose },
  { id: 'sequence', label: 'Sequence', sub: 'Multi-step', icon: IconLayers },
  { id: 'broadcast', label: 'Broadcast', sub: 'To a list', icon: IconWaveform },
  { id: 'template', label: 'Template', sub: 'Reusable', icon: IconDoc },
];

export default function AgentsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [inbox, setInbox] = useState<EmailItem[]>([]);
  const [inboxState, setInboxState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const [reading, setReading] = useState<EmailItem | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  // Back steps one level: reader -> agent workspace -> the list -> close.
  const back = () => { tap(); if (reading) setReading(null); else if (agent) setAgent(null); else onClose(); };
  useFocusTrap(true, trapRef, back);

  const hasMail = connApps.includes('gmail') || connApps.includes('outlook');

  // Load the real inbox when the Email agent opens (and a mailbox is connected).
  useEffect(() => {
    if (agent !== 'email' || !hasMail) return;
    let alive = true;
    setInboxState('loading');
    fetchInbox(12)
      .then((items) => { if (alive) { setInbox(items); setInboxState('ok'); } })
      .catch(() => { if (alive) setInboxState('err'); });
    return () => { alive = false; };
  }, [agent, hasMail, reloadKey]);

  return (
    <div className="memg ag" ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={back} aria-label={reading || agent ? 'Back' : 'Close'}><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <h1 className="memg-title">{reading ? 'Email' : agent === 'email' ? 'Email Agent' : 'Agents'}</h1>
          <p className="memg-sub">
            {reading ? (reading.from || reading.email || 'Message')
              : agent === 'email' ? (hasMail ? 'Ready' : 'Connect a mailbox to begin')
              : 'Your AI specialists — each one handles a job'}
          </p>
        </div>
        <span style={{ width: 40 }} />
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
                onClick={() => { if (a.live) { tap(); setAgent(a.id as AgentId); } }}
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

          <div className="ag-sec">Start something</div>
          <div className="ag-grid">
            {EMAIL_ACTIONS.map((act) => (
              <button key={act.id} className="ag-act" onClick={() => { tap(); /* TODO: open the action flow */ }}>
                <span className="ag-act-ic"><act.icon size={20} /></span>
                <span className="ag-act-label">{act.label}</span>
                <span className="ag-act-sub">{act.sub}</span>
              </button>
            ))}
          </div>

          {hasMail && (
            <>
              <div className="ag-sec">Inbox</div>
              {inboxState === 'loading' ? (
                <EmailSkeleton />
              ) : inboxState === 'err' ? (
                <div className="ag-empty">
                  Couldn’t load your inbox.{' '}
                  <button className="ag-retry" onClick={() => { tap(); setReloadKey((k) => k + 1); }}>Try again</button>
                </div>
              ) : inbox.length ? (
                <EmailList items={inbox} onOpen={(it) => { tap(); setReading(it); }} />
              ) : (
                <div className="ag-empty">Inbox is empty.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
