import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  IconX, IconTrash, IconArrowLeft, IconArrowUp, IconLayers, IconPlay,
  IconClock, IconBolt, IconBranch, IconSpark, IconCheck,
} from './icons';
import { byId } from './connectorData';
import { BrandLogo } from './brandLogos';
import { hasBrand } from './brandData';
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, listRuns, buildWorkflow, testWorkflow,
  triggerLabel, deviceTz, appLabel, compileInstruction, orderedNodes,
  type Workflow, type WorkflowRun, type Schedule, type Trigger, type EventCfg, type EventWindow, type WfGraph, type WfNode, type BuildMsg, type AskQuestion,
} from './workflows';

type NodeResult = { ok: boolean; output: string };
// A turn in the clarify chat; assistant turns carry the structured questions
// (with any tappable options) so we can render chips, not just text.
type ChatMsg = BuildMsg & { questions?: AskQuestion[] };

// Full-screen Workflows: describe an automation in the chatbox -> the AI drafts
// it as a node graph (each node tagged with the app it uses) -> drag/zoom/edit
// the nodes -> "Save & turn on". A top-right Projects button lists saved ones.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAD = 80;   // canvas padding around the graph bounds
const CHIP = 30;  // node chip half-height (where edges attach)
const Z0 = 0.9;   // initial zoom

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A node's visual badge: special kinds get a line icon; real apps get their logo.
function NodeIcon({ app, size = 22 }: { app: string; size?: number }) {
  if (app === 'schedule') return <IconClock size={size} />;
  if (app === 'event') return <IconBolt size={size} />;
  if (app === 'ai') return <IconSpark size={size} />;
  if (app === 'decision') return <IconBranch size={size} />;
  if (hasBrand(app)) return <BrandLogo app={app} size={size} />; // bundled SVG (no CDN)
  const c = byId(app);
  if (c) return <img src={c.logo} alt="" className="wfx-logo" draggable={false} />;
  return <IconSpark size={size} />;
}

interface Work { title: string; instruction: string; trigger: Trigger; graph: WfGraph }

// Each empty-state prompt with the real workflow it would build: trigger app(s)
// on top -> the AI step -> destination app(s) on the bottom. Shown as: the prompt
// types into a chat box, hits send, the workflow "builds", holds, then the next.
type WfPreview = { prompt: string; top: string[]; bottom: string[] };
const WORKFLOWS: WfPreview[] = [
  { prompt: 'Every Friday at 5, email my team the weekly report and post it to Slack.', top: ['schedule'], bottom: ['gmail', 'slack'] },
  { prompt: 'When an invoice hits Gmail, save the PDF to Drive and log it in Sheets.', top: ['gmail'], bottom: ['gdrive', 'googlesheets'] },
  { prompt: 'At noon, summarize my Slack, text me a recap, and add follow-ups to Todoist.', top: ['schedule', 'slack'], bottom: ['sms', 'todoist'] },
  { prompt: 'New Outlook meeting? Add prep notes to Notion and a reminder to my calendar.', top: ['m365'], bottom: ['notion', 'gcal'] },
  { prompt: 'If a Stripe payment fails, text me, log it in Sheets, and email the customer.', top: ['stripe'], bottom: ['sms', 'googlesheets', 'gmail'] },
  { prompt: 'Turn the emails I star into Todoist tasks and jot a note in Notion.', top: ['gmail'], bottom: ['todoist', 'notion'] },
  { prompt: 'New YouTube video? Post it to Discord, LinkedIn, and Slack.', top: ['youtube'], bottom: ['discord', 'linkedin', 'slack'] },
  { prompt: 'Back up new Dropbox files to Google Drive and ping me on Slack.', top: ['dropbox'], bottom: ['gdrive', 'slack'] },
  { prompt: 'Reply to Instagram DMs about our hours and save the leads to a Sheet.', top: ['instagram'], bottom: ['instagram', 'googlesheets'] },
  { prompt: 'When I wake up, text me my calendar, the weather, and any unread email.', top: ['gcal', 'weather', 'gmail'], bottom: ['sms'] },
];
const WP_VB_W = 300, WP_VB_H = 240;
const wpXs = (n: number): number[] => (n <= 1 ? [150] : n === 2 ? [108, 192] : [74, 150, 226]);

// Icon for a preview node. Concept glyphs (trigger/ai/sms/weather) get an explicit
// color so they read on the light tile; real apps use the bundled brand logo.
function wpIcon(app: string, size: number) {
  if (app === 'ai') return <IconSpark size={size} />;
  if (app === 'schedule') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  );
  if (app === 'sms') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>
  );
  if (app === 'weather') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" /></svg>
  );
  return <BrandLogo app={app} size={size} />;
}

// Empty-state showcase: type prompt into a chat box -> send -> "build" -> show the
// matching workflow graph -> hold 5s -> next.
function WorkflowPreview() {
  const [wi, setWi] = useState(0);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'type' | 'send' | 'show' | 'leave'>('type');
  const wf = WORKFLOWS[wi % WORKFLOWS.length];

  useEffect(() => {
    // Read the prompt straight from the source array (keyed by wi, already a dep)
    // so the effect doesn't depend on the derived `wf` object identity.
    const full = WORKFLOWS[wi % WORKFLOWS.length].prompt;
    if (phase === 'type') {
      if (text.length < full.length) {
        const t = setTimeout(() => setText(full.slice(0, text.length + 1)), 42);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase('send'), 500); // beat, then hit send
      return () => clearTimeout(t);
    }
    if (phase === 'send') { const t = setTimeout(() => setPhase('show'), 1000); return () => clearTimeout(t); } // "building…"
    if (phase === 'show') { const t = setTimeout(() => setPhase('leave'), 5000); return () => clearTimeout(t); } // hold 5s
    const t = setTimeout(() => { setWi((p) => (p + 1) % WORKFLOWS.length); setText(''); setPhase('type'); }, 520);
    return () => clearTimeout(t);
  }, [text, phase, wi]);

  const built = phase === 'show' || phase === 'leave';
  const topX = wpXs(wf.top.length), botX = wpXs(wf.bottom.length);
  const nodes = [
    ...wf.top.map((app, i) => ({ id: 't' + i, app, x: topX[i], y: 40, r: 21, ai: false })),
    { id: 'ai', app: 'ai', x: 150, y: 120, r: 29, ai: true },
    ...wf.bottom.map((app, i) => ({ id: 'b' + i, app, x: botX[i], y: 200, r: 21, ai: false })),
  ];
  const aiIdx = wf.top.length;
  const edges: [number, number][] = [
    ...wf.top.map((_, i) => [i, aiIdx] as [number, number]),
    ...wf.bottom.map((_, i) => [aiIdx, aiIdx + 1 + i] as [number, number]),
  ];

  return (
    <div className="wfx-wp-wrap">
      <div className="wfx-wp-chat">
        <span className="wfx-wp-chat-text">{text}{phase === 'type' && <span className="wfx-prompt-caret" />}</span>
        <span className={`wfx-wp-send ${phase === 'send' ? 'sending' : ''}`} aria-hidden="true">
          {phase === 'send' ? <span className="wfx-spin" /> : <IconArrowUp size={16} />}
        </span>
      </div>
      <div className="wfx-wp-stage">
        {phase === 'send' && (
          <div className="wfx-wp-loading"><span className="wfx-spin" /><span>Building workflow…</span></div>
        )}
        {built && (
          <div className={`wfx-wp ${phase === 'leave' ? 'leaving' : ''}`}>
            <svg className="wfx-hf-wires" viewBox={`0 0 ${WP_VB_W} ${WP_VB_H}`}>
              <defs>
                <marker id="wfx-hf-arrow" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0,0 L6,3 L0,6 Z" fill="rgba(224,161,58,0.85)" />
                </marker>
              </defs>
              {edges.map(([a, b], k) => {
                const A = nodes[a], B = nodes[b];
                const x1 = A.x, y1 = A.y + A.r, x2 = B.x, y2 = B.y - B.r, mid = (y1 + y2) / 2;
                return <path key={k} className="wfx-hf-wire" markerEnd="url(#wfx-hf-arrow)" style={{ animationDelay: `${k * 0.12}s` }} d={`M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`} />;
              })}
            </svg>
            {nodes.map((n, idx) => (
              <div key={`${wi}-${n.id}`} className={`wfx-hf-node ${n.ai ? 'b' : ''} wfx-pin`} style={{ left: `${(n.x / WP_VB_W) * 100}%`, top: `${(n.y / WP_VB_H) * 100}%`, animationDelay: `${idx * 0.06}s` }}>
                {wpIcon(n.app, n.ai ? 24 : 22)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkflowsScreen({ connApps, onClose }: { connApps: string[]; onClose: () => void }) {
  const [items, setItems] = useState<Workflow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<'home' | 'projects'>('home');
  const [draft, setDraft] = useState<Work | null>(null);   // AI-drafted, not yet saved
  const [open, setOpen] = useState<Workflow | null>(null); // a saved workflow being viewed/edited
  const [desc, setDesc] = useState('');
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState('');
  const [convo, setConvo] = useState<ChatMsg[]>([]); // back-and-forth while the builder clarifies
  const [picks, setPicks] = useState<Record<number, string>>({});      // selected option label per question (last turn)
  const [otherText, setOtherText] = useState<Record<number, string>>({}); // free-text per question when "Other" is picked
  const [step, setStep] = useState(0);                                  // which clarifying question is on screen (one at a time)
  const chatRef = useRef<HTMLDivElement>(null);
  const OTHER = '__other__';

  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  // Keep the clarify chat pinned to the latest message.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convo, building]);

  async function load() {
    setLoaded(false);
    setItems(await listWorkflows());
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  // Send the user's text (a request, or an answer to a question / a tapped chip)
  // to the builder. It either comes back with short clarifying questions — which
  // we show as a chat and let the user answer — or with a finished draft, which
  // opens the editable canvas.
  async function send(text: string) {
    const d = text.trim();
    if (!d || building) return;
    const next: ChatMsg[] = [...convo, { role: 'user', text: d }];
    setConvo(next);
    setDesc('');
    setBuilding(true);
    setErr('');
    let res = await buildWorkflow(next);
    if (!res) res = await buildWorkflow(next); // one retry — the builder occasionally returns nothing
    setBuilding(false);
    if (!res) { setErr("Couldn't build that — try describing it a little differently."); return; }
    if (res.kind === 'questions') {
      setConvo([...next, { role: 'assistant', text: res.questions.map((q) => q.text).join('\n'), questions: res.questions }]);
      setPicks({}); setOtherText({}); setStep(0); // fresh form, back to question 1
      return;
    }
    setConvo([]);
    setDraft({ title: res.draft.title, instruction: res.draft.instruction, trigger: res.draft.trigger, graph: res.draft.graph });
  }

  function resetConvo() { setConvo([]); setErr(''); setPicks({}); setOtherText({}); setStep(0); }

  // The last turn being a question means the user is mid-clarification.
  const awaiting = convo.length > 0 && convo[convo.length - 1].role === 'assistant';
  // The questions currently being answered (last assistant turn).
  const lastMsg = convo[convo.length - 1];
  const lastQs: AskQuestion[] = awaiting
    ? (lastMsg.questions?.length ? lastMsg.questions : lastMsg.text.split('\n').filter(Boolean).map((t) => ({ text: t })))
    : [];
  const answerOf = (i: number): string => {
    const q = lastQs[i];
    const openEnded = !(q?.options && q.options.length);
    if (openEnded || picks[i] === OTHER) return (otherText[i] ?? '').trim();
    return picks[i] ?? '';
  };
  const isLastStep = step >= lastQs.length - 1;
  const currentAnswered = awaiting && answerOf(step).length > 0;

  // Combine every answer into one message and send it. `override` lets a just-made
  // pick count immediately (setState is async, so the last tap isn't in `picks` yet).
  function submitAnswers(override?: { idx: number; val: string }) {
    if (building) return;
    const ans = (i: number) => (override && override.idx === i ? override.val : answerOf(i));
    if (!lastQs.every((_q, i) => ans(i).length > 0)) return; // need them all
    const text = lastQs
      .map((q, i) => (lastQs.length > 1 ? `${q.header || q.text}: ${ans(i)}` : ans(i)))
      .join(lastQs.length > 1 ? '\n' : ' ');
    void send(text);
  }

  // Tap an option for the question on screen. A concrete pick advances to the next
  // question (or submits on the last); "Other" waits for typed text + Next/Continue.
  function choose(i: number, label: string) {
    setPicks((s) => ({ ...s, [i]: label }));
    if (label === OTHER) return;
    if (i < lastQs.length - 1) setStep(i + 1);
    else submitAnswers({ idx: i, val: label });
  }

  // The Next / Continue button (used for typed "Other" answers and as the explicit
  // control): advance a step, or submit on the last.
  function advanceOrSubmit() {
    if (!currentAnswered || building) return;
    if (isLastStep) submitAnswers();
    else setStep(step + 1);
  }

  async function toggle(w: Workflow) {
    setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: !x.enabled } : x)));
    if (!(await updateWorkflow(w.id, { enabled: !w.enabled }))) void load();
  }

  // A drafted workflow takes over the screen as an editable canvas.
  if (draft) {
    return (
      <PlanView
        key="draft"
        initial={draft}
        mode="draft"
        connApps={connApps}
        onClose={() => { setDraft(null); setView('projects'); void load(); }}
        onDeleted={() => { setDraft(null); setView('projects'); void load(); }}
      />
    );
  }
  // An existing saved workflow opened for view/edit.
  if (open) {
    return (
      <PlanView
        key={open.id}
        initial={{ title: open.title, instruction: open.instruction, trigger: triggerOf(open), graph: open.graph ?? emptyGraph(open) }}
        mode="saved"
        wfId={open.id}
        enabled={open.enabled}
        connApps={connApps}
        onClose={() => { setOpen(null); void load(); }}
        onDeleted={() => { setOpen(null); void load(); }}
      />
    );
  }

  return createPortal(
    <div className="memg" role="dialog" aria-label="Workflows">
      <div className="memg-top">
        {view === 'projects' ? (
          <button className="memg-back" onClick={() => setView('home')} aria-label="Back"><IconArrowLeft size={22} /></button>
        ) : convo.length > 0 ? (
          <button className="memg-back" onClick={resetConvo} aria-label="Start over"><IconArrowLeft size={22} /></button>
        ) : (
          <button className="memg-back" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        )}
        <div className="memg-titles">
          <h1 className="memg-title">{view === 'projects' ? 'Projects' : 'Workflows'}</h1>
          <p className="memg-sub">{view === 'projects' ? `${items.length} saved` : awaiting ? 'A couple of quick questions' : 'Describe an automation and I’ll build it'}</p>
        </div>
        {view === 'home' ? (
          <button className="wfx-corner wfx-projects" onClick={() => setView('projects')} aria-label="Projects">
            <IconLayers size={20} />
            {items.length > 0 && <span className="wfx-projects-count">{items.length}</span>}
          </button>
        ) : <span style={{ width: 40 }} />}
      </div>

      {view === 'projects' ? (
        <div className="wf-stage">
          {loaded && items.length === 0 ? (
            <div className="wf-empty">
              <div className="wf-empty-title">No workflows yet</div>
              <div className="wf-empty-sub">Go back and describe one — it’ll show up here once you save it.</div>
            </div>
          ) : (
            <div className="wf-list">
              {items.map((w) => (
                <div className="wf-card" key={w.id} onClick={() => setOpen(w)} role="button">
                  <div className="wf-card-main">
                    <div className="wf-card-title">{w.title}</div>
                    <div className="wf-card-sub">{triggerLabel(w)}{w.last_run_at ? ` · last ran ${relTime(w.last_run_at)}` : ''}</div>
                  </div>
                  <span className={`tgl ${w.enabled ? 'on' : ''}`} role="switch" aria-checked={w.enabled}
                    onClick={(e) => { e.stopPropagation(); void toggle(w); }}><span className="tgl-knob" /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="wfx-home">
          {convo.length > 0 ? (
            <div className="wfx-chat" ref={chatRef}>
              {convo.map((m, i) => {
                const isLast = i === convo.length - 1;
                if (m.role === 'user') return <div key={i} className="wfx-msg user">{m.text}</div>;
                const qs: AskQuestion[] = m.questions?.length
                  ? m.questions
                  : m.text.split('\n').filter(Boolean).map((t) => ({ text: t }));
                // Older question turns render as plain read-only text.
                if (!isLast) {
                  return (
                    <div key={i} className="wfx-msg assistant">
                      {qs.map((q, j) => <div key={j} className="wfx-msg-q">{q.text}</div>)}
                    </div>
                  );
                }
                // Current questions: one on screen at a time, with "1 of N" progress.
                const qi = Math.min(step, qs.length - 1);
                const q = qs[qi];
                const hasOpts = !!(q.options && q.options.length);
                return (
                  <div key={i} className="wfx-form">
                    {qs.length > 1 && (
                      <div className="wfx-steps">
                        <span className="wfx-steps-count">{qi + 1} of {qs.length}</span>
                        <div className="wfx-steps-dots">
                          {qs.map((_, k) => <span key={k} className={`wfx-step-dot ${k === qi ? 'on' : ''} ${k < qi ? 'done' : ''}`} />)}
                        </div>
                      </div>
                    )}
                    <div key={qi} className="wfx-q wfx-q-step">
                      {q.header && <div className="wfx-q-head">{q.header}</div>}
                      <div className="wfx-q-text">{q.text}</div>
                      {hasOpts && (
                        <div className="wfx-opts">
                          {q.options!.map((opt, k) => (
                            <button key={k} className={`wfx-opt ${picks[qi] === opt.label ? 'sel' : ''}`}
                              onClick={() => choose(qi, opt.label)} disabled={building}>
                              <span className="wfx-opt-label">{opt.label}</span>
                              {opt.description && <span className="wfx-opt-desc">{opt.description}</span>}
                            </button>
                          ))}
                          <button className={`wfx-opt wfx-opt-other ${picks[qi] === OTHER ? 'sel' : ''}`}
                            onClick={() => choose(qi, OTHER)} disabled={building}>
                            <span className="wfx-opt-label">Other…</span>
                          </button>
                        </div>
                      )}
                      {(picks[qi] === OTHER || !hasOpts) && (
                        <input className="wfx-other-input"
                          value={otherText[qi] ?? ''}
                          onChange={(e) => setOtherText((s) => ({ ...s, [qi]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') advanceOrSubmit(); }}
                          placeholder="Type your answer…" maxLength={500} disabled={building}
                          autoFocus={picks[qi] === OTHER} />
                      )}
                    </div>
                  </div>
                );
              })}
              {building && (
                <div className="wfx-msg assistant">
                  <span className="wfx-typing"><i /><i /><i /></span>
                </div>
              )}
              {err && <div className="wfx-err">{err}</div>}
            </div>
          ) : (
            <div className="wfx-hero">
              <WorkflowPreview />
              {err && <div className="wfx-err">{err}</div>}
            </div>
          )}
          <div className="memg-compose-wrap">
            {awaiting ? (
              <div className="wfx-stepper">
                {step > 0 && (
                  <button className="wfx-step-back" onClick={() => setStep(step - 1)} disabled={building}>Back</button>
                )}
                <button className="wfx-continue" onClick={advanceOrSubmit} disabled={!currentAnswered || building}>
                  {building ? <span className="wfx-spin" /> : (isLastStep ? 'Continue' : 'Next')}
                </button>
              </div>
            ) : (
              <div className="memg-compose">
                <input
                  className="memg-cinput"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(desc); }}
                  placeholder="Describe your workflow…"
                  maxLength={2000}
                  disabled={building}
                />
                <button className="memg-send" onClick={() => void send(desc)} disabled={!desc.trim() || building} aria-label="Build">
                  {building ? <span className="wfx-spin" /> : <IconArrowUp size={20} />}
                </button>
              </div>
            )}
            {building && convo.length === 0 && <div className="memg-reading">Designing your workflow…</div>}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function triggerOf(w: Workflow): Trigger {
  return w.trigger_type === 'event'
    ? { type: 'event', event: w.event ?? { app: '', filter: '' } }
    : { type: 'schedule', schedule: w.schedule ?? { freq: 'daily', hour: 8, minute: 0, weekday: 1, tz: deviceTz() } };
}
// Legacy workflows saved before the graph existed: show a minimal 2-node graph.
function emptyGraph(w: Workflow): WfGraph {
  return {
    nodes: [
      { id: 't', kind: 'trigger', app: w.trigger_type === 'event' ? 'event' : 'schedule', label: w.trigger_type === 'event' ? 'When it arrives' : 'On schedule', x: 0, y: 0 },
      { id: 'a', kind: 'action', app: 'ai', label: w.title || 'Do the task', detail: w.instruction.slice(0, 120), x: 0, y: 140 },
    ],
    edges: [{ from: 't', to: 'a' }],
  };
}

// ---- The editable canvas screen (draft or saved) ----------------------------
function PlanView({ initial, mode, wfId, connApps, enabled: enabledInit = false, onClose, onDeleted }: {
  initial: Work; mode: 'draft' | 'saved'; wfId?: string; connApps: string[]; enabled?: boolean;
  onClose: () => void; onDeleted: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger);
  const [graph, setGraph] = useState<WfGraph>(initial.graph);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [testing, setTesting] = useState(false);
  const [edgeState, setEdgeState] = useState<'idle' | 'run' | 'pass' | 'fail'>('idle');
  const [results, setResults] = useState<Record<string, NodeResult>>({}); // per-node test outcomes
  const [enabled, setEnabled] = useState(enabledInit);             // live on/off (top-right toggle)
  const [savedId, setSavedId] = useState<string | undefined>(wfId); // workflow id once persisted
  const savedIdRef = useRef<string | undefined>(wfId);
  savedIdRef.current = savedId;
  const creatingRef = useRef(false); // guards against a double create on first save
  const initedRef = useRef(false);   // skip the very first auto-save effect run
  const savedTriggerRef = useRef(JSON.stringify(initial.trigger)); // last-persisted trigger — only resend when it changes
  const dirtyRef = useRef(false);    // unsaved edits pending (flushed on close)

  // Modal-lock is owned by the parent WorkflowsScreen (this renders inside it).
  useEffect(() => { if (savedId) void listRuns(savedId).then(setRuns); }, [savedId]);

  const selNode = sel ? graph.nodes.find((n) => n.id === sel) ?? null : null;

  // Editing the graph invalidates the last test — drop the colors + node badges.
  function clearTest() {
    if (edgeState !== 'idle') setEdgeState('idle');
    setResults((r) => (Object.keys(r).length ? {} : r));
  }
  function patchNode(id: string, patch: Partial<WfNode>) {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    clearTest();
  }
  function removeNode(id: string) {
    setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }));
    setSel(null);
    clearTest();
  }

  async function test() {
    if (testing) return;
    const inst = compileInstruction(title.trim(), graph);
    if (!inst.trim()) return;
    // Test runs the workflow for REAL (it can send emails / post messages / change
    // things in connected apps), so confirm before doing it.
    if (!window.confirm('Run this workflow now for real? It can send emails, post messages, or change things in your connected apps.')) return;
    const steps = orderedNodes(graph).filter((n) => n.kind !== 'trigger').map((n) => ({ id: n.id, label: n.label, app: n.app }));
    setTesting(true); setEdgeState('run'); setResults({});
    const r = await testWorkflow(inst, savedIdRef.current, steps);
    setTesting(false);
    if (!r) { setEdgeState('fail'); return; }
    const map: Record<string, NodeResult> = {};
    for (const s of r.steps) map[s.id] = { ok: s.ok, output: s.output };
    // Guard against hallucinated success: a step whose app isn't actually
    // connected can't have run (the model has no tool for it, so it may claim a
    // fake "done"). Override those deterministically so they never show green.
    for (const n of orderedNodes(graph)) {
      if (n.kind === 'trigger') continue;
      const c = byId(n.app); // defined only for real connectors (not ai/decision/etc.)
      if (c && !connApps.includes(n.app)) {
        map[n.id] = { ok: false, output: `${c.name} isn't connected — connect it first.` };
      }
    }
    setResults(map);
    // With per-node results we color each cable by its target; otherwise fall
    // back to a single overall pass/fail.
    setEdgeState(r.steps.length ? 'idle' : r.ok ? 'pass' : 'fail');
    if (savedIdRef.current) void listRuns(savedIdRef.current).then(setRuns); // run saved to history
  }
  function applyTrigger(t: Trigger) {
    setTrigger(t);
    // keep the trigger node's badge in sync
    const tn = graph.nodes.find((n) => n.kind === 'trigger');
    if (tn) patchNode(tn.id, { app: t.type });
  }

  // Persist the current state — create the workflow on first save (new drafts
  // start OFF), update it thereafter. Saving is automatic (no button); the
  // top-right toggle controls whether it's live.
  async function persist(extra: { enabled?: boolean } = {}) {
    const instruction = compileInstruction(title.trim(), graph);
    if (savedIdRef.current) {
      // Only resend `trigger` when it actually changed — updateWorkflow resets
      // next_run_at / cursor on a trigger change, so sending it on every edit
      // would reschedule (and skip runs / drop event dedupe) on trivial edits.
      const fields: Parameters<typeof updateWorkflow>[1] = { title: title.trim(), instruction, graph, ...extra };
      const tStr = JSON.stringify(trigger);
      if (tStr !== savedTriggerRef.current) { fields.trigger = trigger; savedTriggerRef.current = tStr; }
      await updateWorkflow(savedIdRef.current, fields);
    } else if (!creatingRef.current) {
      creatingRef.current = true;
      const w = await createWorkflow(title.trim(), instruction, trigger, graph, extra.enabled ?? enabled);
      if (w) { savedIdRef.current = w.id; setSavedId(w.id); savedTriggerRef.current = JSON.stringify(trigger); }
      creatingRef.current = false;
    }
  }

  // Auto-save (debounced) on any edit; skips the initial mount run. A draft is
  // created lazily on the first real edit (or when turned on) — merely opening an
  // AI draft and backing out without touching it leaves nothing saved.
  useEffect(() => {
    if (!initedRef.current) { initedRef.current = true; return; }
    dirtyRef.current = true;
    const t = setTimeout(async () => { await persist(); dirtyRef.current = false; }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, trigger, graph]);

  // Top-right toggle: flip live on/off (persists immediately).
  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    await persist({ enabled: next });
  }

  // Flush a pending (debounced) edit before closing, so a quick edit -> back
  // never loses changes. Only persists when there are actually unsaved edits, so
  // backing out of an untouched draft still saves nothing.
  async function close() {
    if (dirtyRef.current) { dirtyRef.current = false; await persist(); }
    onClose();
  }

  async function remove() {
    const id = savedIdRef.current;
    if (!id || busy) return;
    setBusy(true);
    const ok = await deleteWorkflow(id);
    setBusy(false);
    if (ok) onDeleted();
  }

  return createPortal(
    <div className="memg wfx-plan" role="dialog" aria-label={mode === 'draft' ? 'New workflow' : 'Edit workflow'}>
      <div className="memg-top">
        <button className="memg-back" onClick={() => void close()} aria-label="Back"><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <input className="wfx-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled workflow" maxLength={80} />
          <p className="memg-sub">{mode === 'draft' ? 'Draft · tap a step to edit' : 'Tap a step to edit'}</p>
        </div>
        <div className="wfx-top-actions">
          <span className="wfx-onoff">
            <span className="wfx-onoff-label">{enabled ? 'On' : 'Off'}</span>
            <span className={`tgl ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled}
              aria-label={enabled ? 'Turn workflow off' : 'Turn workflow on'}
              onClick={() => void toggleEnabled()}><span className="tgl-knob" /></span>
          </span>
          <button className="wfx-test" onClick={() => void test()} disabled={testing} aria-label="Test workflow">
            {testing ? <span className="wfx-spin-l" /> : <IconPlay size={14} />}
            <span>{testing ? 'Testing' : 'Test'}</span>
          </button>
        </div>
      </div>

      <Canvas graph={graph} results={results} onChange={(g) => { setGraph(g); clearTest(); }} onSelect={setSel} edgeState={edgeState} />

      {/* Bottom action bar — saving is automatic; the top-right toggle turns it live */}
      <div className="wfx-bar">
        <span className="wfx-bar-status"><IconCheck size={15} /> Changes save automatically</span>
        {savedId && (
          <button className="wfx-bar-hist" onClick={() => setShowRuns(true)} disabled={busy} aria-label="Run history"><IconClock size={18} /></button>
        )}
        {savedId && (
          <button className="wfx-bar-del" onClick={() => void remove()} disabled={busy} aria-label="Delete workflow"><IconTrash size={18} /></button>
        )}
      </div>

      {selNode && (
        <NodeSheet
          node={selNode}
          trigger={trigger}
          connApps={connApps}
          result={results[selNode.id]}
          onPatch={(p) => patchNode(selNode.id, p)}
          onTrigger={applyTrigger}
          onDelete={selNode.kind === 'trigger' ? undefined : () => removeNode(selNode.id)}
          onClose={() => setSel(null)}
        />
      )}

      {showRuns && (
        <div className="wfx-sheet-scrim" onClick={() => setShowRuns(false)}>
          <div className="wfx-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wfx-sheet-head"><span>Recent runs</span><button className="memg-cancel" onClick={() => setShowRuns(false)}>Done</button></div>
            {runs.length === 0
              ? <div className="wf-runs-empty">No runs yet — results show up here after it runs.</div>
              : runs.map((r) => (
                <div className={`wf-run ${r.ok ? '' : 'bad'}`} key={r.id}>
                  <div className="wf-run-time">{relTime(r.created_at)}</div>
                  <div className="wf-run-text">{r.result}</div>
                </div>
              ))}
          </div>
        </div>
      )}

    </div>,
    document.body,
  );
}

// ---- The pan/zoom/drag canvas ----------------------------------------------
function Canvas({ graph, results, onChange, onSelect, edgeState }: { graph: WfGraph; results: Record<string, NodeResult>; onChange: (g: WfGraph) => void; onSelect: (id: string) => void; edgeState: 'idle' | 'run' | 'pass' | 'fail' }) {
  // Lock the coordinate origin ONCE (from the initial layout). Recomputing bounds
  // on every drag move is what made the whole graph jump under your finger.
  const [base] = useState(() => {
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const minX = Math.min(0, ...xs), minY = Math.min(0, ...ys);
    const maxX = Math.max(0, ...xs), maxY = Math.max(0, ...ys);
    return { offX: PAD - minX, offY: PAD - minY, W: (maxX - minX) + PAD * 2, H: (maxY - minY) + PAD * 2 };
  });
  const { offX, offY, W, H } = base;
  const [zoom, setZoom] = useState(Z0);
  const [pan, setPan] = useState(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 380;
    return { x: Math.round(vw / 2 - (W / 2) * Z0), y: 18 };
  });
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gest = useRef<
    | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
    | { mode: 'pinch'; d0: number; z0: number; px: number; py: number; mx: number; my: number }
    | null
  >(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fit the whole graph into the viewport on mount: pick a zoom that shows every
  // node and center it, so opening a draft never lands cropped or shoved to one
  // side (branching graphs are wider/taller than the fixed Z0 assumed).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    if (!cw || !ch) return;
    const M = 24; // breathing room around the graph
    const z = +clamp(Math.min((cw - M * 2) / W, (ch - M * 2) / H), 0.45, 1).toFixed(3);
    const x = Math.round((cw - W * z) / 2);
    const y = H * z <= ch - M * 2 ? Math.round((ch - H * z) / 2) : M; // center if it fits, else top-align
    setZoom(z);
    setPan({ x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodes = graph.nodes;
  const px = (n: WfNode) => n.x + offX;
  const py = (n: WfNode) => n.y + offY;
  const byNode = new Map(nodes.map((n) => [n.id, n]));

  // Keep the workspace anchored: don't let pan slide the graph off the screen.
  function clampPan(x: number, y: number, z: number) {
    const el = wrapRef.current;
    if (!el) return { x, y };
    const cw = el.clientWidth, ch = el.clientHeight, sw = W * z, sh = H * z, SLOP = 24;
    return {
      x: clamp(x, Math.min(0, cw - sw) - SLOP, Math.max(0, cw - sw) + SLOP),
      y: clamp(y, Math.min(0, ch - sh) - SLOP, Math.max(0, ch - sh) + SLOP),
    };
  }

  function nodeDown(e: React.PointerEvent, n: WfNode) {
    e.stopPropagation();
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function nodeMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    onChange({ ...graph, nodes: graph.nodes.map((nn) => (nn.id === d.id ? { ...nn, x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) } : nn)) });
  }
  function nodeUp(e: React.PointerEvent, n: WfNode) {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(n.id);
  }

  // One finger pans; two fingers pinch-zoom (anchored on the pinch midpoint).
  function startGesture() {
    const pts = [...ptrs.current.values()];
    if (pts.length === 1) {
      gest.current = { mode: 'pan', sx: pts[0].x, sy: pts[0].y, px: pan.x, py: pan.y };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gest.current = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoom, px: pan.x, py: pan.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }
  function bgDown(e: React.PointerEvent) {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    startGesture();
  }
  function bgMove(e: React.PointerEvent) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];
    if (g.mode === 'pan' && pts.length === 1) {
      setPan(clampPan(g.px + (pts[0].x - g.sx), g.py + (pts[0].y - g.sy), zoom));
    } else if (g.mode === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const nz = clamp(+(g.z0 * (d / g.d0)).toFixed(3), 0.5, 2);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const sxp = (g.mx - g.px) / g.z0, syp = (g.my - g.py) / g.z0; // content point under the start midpoint
      setZoom(nz);
      setPan(clampPan(mx - sxp * nz, my - syp * nz, nz));
    }
  }
  function bgUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    gest.current = null;
    if (ptrs.current.size > 0) startGesture(); // e.g. two fingers -> one: resume panning
  }

  return (
    <div className="wfx-canvas" ref={wrapRef} onPointerDown={bgDown} onPointerMove={bgMove} onPointerUp={bgUp} onPointerCancel={bgUp}>
      <div className="wfx-surface" style={{ width: W, height: H, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="wfx-edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            {[['idle', 'rgba(255,255,255,0.34)'], ['run', '#e0a13a'], ['pass', '#46d17f'], ['fail', '#ff6b6b']].map(([k, c]) => (
              <marker key={k} id={`wfx-arrow-${k}`} markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L6,3 L0,6 Z" fill={c} />
              </marker>
            ))}
          </defs>
          {graph.edges.map((e, i) => {
            const a = byNode.get(e.from), b = byNode.get(e.to);
            if (!a || !b) return null;
            const x1 = px(a), y1 = py(a) + CHIP, x2 = px(b), y2 = py(b) - CHIP;
            const mid = (y1 + y2) / 2;
            // While testing, every cable flows; afterwards each is colored by its
            // TARGET node's result (n8n-style), else the overall pass/fail.
            const tr = results[e.to];
            const ec = edgeState === 'run' ? 'run'
              : tr ? (tr.ok ? 'pass' : 'fail')
              : (edgeState === 'pass' || edgeState === 'fail' ? edgeState : '');
            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`}
                  className={`wfx-edge ${ec}`}
                  markerEnd={`url(#wfx-arrow-${ec || 'idle'})`}
                  style={ec === 'pass' || ec === 'fail' ? { transitionDelay: `${i * 0.08}s` } : undefined}
                />
                {e.branch && <text x={(x1 + x2) / 2} y={mid - 4} className={`wfx-edge-tag ${e.branch}`}>{e.branch}</text>}
              </g>
            );
          })}
        </svg>

        {nodes.map((n) => {
          const ns = results[n.id];
          return (
            <div
              key={n.id}
              className={`wfx-node ${n.kind} ${ns ? (ns.ok ? 'ran-ok' : 'ran-bad') : ''}`}
              style={{ left: px(n), top: py(n) }}
              onPointerDown={(e) => nodeDown(e, n)}
              onPointerMove={nodeMove}
              onPointerUp={(e) => nodeUp(e, n)}
              onPointerCancel={() => { drag.current = null; }}
            >
              <div className={`wfx-chip ${hasBrand(n.app) ? 'logo' : ''}`}>
                <NodeIcon app={n.app} />
                {ns && (
                  <span className={`wfx-node-status ${ns.ok ? 'ok' : 'bad'}`}>
                    {ns.ok ? <IconCheck size={11} /> : <IconX size={11} />}
                  </span>
                )}
              </div>
              <div className="wfx-node-label">{n.label}</div>
              <div className="wfx-node-app">{appLabel(n.app)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Bottom sheet to edit a tapped node ------------------------------------
// Pretty-print a step's output: JSON gets indented, everything else shown as-is.
function prettyOutput(s: string): string {
  const t = (s || '').trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* not json */ }
  }
  return t;
}

function NodeSheet({ node, trigger, connApps, result, onPatch, onTrigger, onDelete, onClose }: {
  node: WfNode; trigger: Trigger; connApps: string[]; result?: NodeResult;
  onPatch: (p: Partial<WfNode>) => void; onTrigger: (t: Trigger) => void;
  onDelete?: () => void; onClose: () => void;
}) {
  const isTrigger = node.kind === 'trigger';
  // app choices: the user's connected apps + the special step kinds.
  const choices = [...connApps, 'ai', 'decision'];

  return (
    <div className="wfx-sheet-scrim" onClick={onClose}>
      <div className="wfx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wfx-sheet-head">
          <span>{isTrigger ? 'Trigger' : 'Edit step'}</span>
          <button className="memg-cancel" onClick={onClose}>Done</button>
        </div>

        {result && (
          <div className={`wfx-result ${result.ok ? 'ok' : 'bad'}`}>
            <div className="wfx-result-head">
              {result.ok ? <IconCheck size={13} /> : <IconX size={13} />}
              {result.ok ? 'Ran OK' : 'Failed'}
            </div>
            {result.output && <pre className="wfx-result-out">{prettyOutput(result.output)}</pre>}
          </div>
        )}

        <label className="wf-label">Label</label>
        <input className="wf-input" value={node.label} onChange={(e) => onPatch({ label: e.target.value })} maxLength={40} />

        <label className="wf-label">Details</label>
        <textarea className="wf-input wf-area" rows={2} value={node.detail ?? ''} onChange={(e) => onPatch({ detail: e.target.value })} maxLength={200} placeholder="What this step does" />

        {isTrigger ? (
          <TriggerEditor trigger={trigger} connApps={connApps} onChange={onTrigger} />
        ) : (
          <>
            <label className="wf-label">App</label>
            <div className="wfx-apps">
              {choices.map((id) => (
                <button key={id} className={`wfx-app ${node.app === id ? 'on' : ''}`} onClick={() => onPatch({ app: id })}>
                  <span className="wfx-app-ic"><NodeIcon app={id} size={16} /></span>
                  {appLabel(id)}
                </button>
              ))}
            </div>
          </>
        )}

        {onDelete && (
          <button className="wf-delete" onClick={onDelete}><IconTrash size={16} /> Remove step</button>
        )}
      </div>
    </div>
  );
}

function TriggerEditor({ trigger, connApps, onChange }: { trigger: Trigger; connApps: string[]; onChange: (t: Trigger) => void }) {
  const kind = trigger.type;
  const sched: Schedule = trigger.type === 'schedule' ? trigger.schedule : { freq: 'daily', hour: 8, minute: 0, weekday: 1, tz: deviceTz() };
  const evApp = trigger.type === 'event' ? trigger.event.app : (connApps[0] ?? '');
  const evFilter = trigger.type === 'event' ? (trigger.event.filter ?? '') : '';
  const evWindow = trigger.type === 'event' ? (trigger.event.window ?? null) : null;
  const timeVal = `${String(sched.hour).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')}`;
  const setSched = (s: Schedule) => onChange({ type: 'schedule', schedule: s });
  // Merge a patch into the event config, preserving app / filter / window.
  const setEvent = (patch: Partial<EventCfg>) =>
    onChange({ type: 'event', event: { app: evApp, filter: evFilter, ...(evWindow ? { window: evWindow } : {}), ...patch } });
  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const parseTime = (v: string) => { const [h, m] = v.split(':').map((x) => parseInt(x, 10)); return isNaN(h) || isNaN(m) ? null : h * 60 + m; };
  // Never persist a zero-length window (start === end), which the runner reads as "never active".
  const writeWindow = (w: EventWindow) => setEvent({ window: w.start === w.end ? { ...w, end: (w.start + 60) % 1440 } : w });

  return (
    <>
      <label className="wf-label">Trigger</label>
      <div className="wf-seg">
        <button className={`wf-seg-btn ${kind === 'schedule' ? 'on' : ''}`} onClick={() => setSched(sched)}>On a schedule</button>
        <button className={`wf-seg-btn ${kind === 'event' ? 'on' : ''}`} onClick={() => setEvent({})} disabled={connApps.length === 0}>When it arrives</button>
      </div>

      {kind === 'schedule' ? (
        <>
          <div className="wf-seg">
            {(['daily', 'weekly', 'hourly'] as const).map((f) => (
              <button key={f} className={`wf-seg-btn ${sched.freq === f ? 'on' : ''}`} onClick={() => setSched({ ...sched, freq: f })}>{f[0].toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
          {sched.freq === 'weekly' && (
            <div className="wf-dow">
              {DOW.map((d, i) => (
                <button key={d} className={`wf-dow-btn ${(sched.weekday ?? 1) === i ? 'on' : ''}`} onClick={() => setSched({ ...sched, weekday: i })}>{d[0]}</button>
              ))}
            </div>
          )}
          {sched.freq === 'hourly' ? (
            <p className="wf-hint">Runs at the top of every hour.</p>
          ) : (
            <div className="wf-time-row">
              <span className="wf-time-label">At</span>
              <input className="wf-input wf-time" type="time" value={timeVal} onChange={(e) => {
                const [h, m] = e.target.value.split(':').map((x) => parseInt(x, 10));
                if (!isNaN(h) && !isNaN(m)) setSched({ ...sched, hour: h, minute: m });
              }} />
            </div>
          )}
        </>
      ) : connApps.length === 0 ? (
        <p className="wf-hint">Connect an app first to use “when something arrives” triggers.</p>
      ) : (
        <>
          <label className="wf-label">In which app</label>
          <div className="wfx-apps">
            {connApps.map((id) => (
              <button key={id} className={`wfx-app ${evApp === id ? 'on' : ''}`} onClick={() => setEvent({ app: id })}>
                <span className="wfx-app-ic"><NodeIcon app={id} size={16} /></span>{byId(id)?.name ?? id}
              </button>
            ))}
          </div>
          <label className="wf-label">Trigger when…</label>
          <input className="wf-input" value={evFilter} onChange={(e) => setEvent({ filter: e.target.value })} placeholder="e.g. an email from boss@company.com" maxLength={160} />

          <label className="wf-label">Active hours</label>
          <div className="wf-seg">
            <button className={`wf-seg-btn ${!evWindow ? 'on' : ''}`} onClick={() => setEvent({ window: null })}>All day</button>
            <button className={`wf-seg-btn ${evWindow ? 'on' : ''}`} onClick={() => setEvent({ window: evWindow ?? { start: 540, end: 1020, days: [], tz: deviceTz() } })}>Set hours</button>
          </div>
          {evWindow && (
            <>
              <div className="wf-time-row">
                <span className="wf-time-label">From</span>
                <input className="wf-input wf-time" type="time" value={fmtMin(evWindow.start)} onChange={(e) => { const m = parseTime(e.target.value); if (m !== null) writeWindow({ ...evWindow, start: m }); }} />
                <span className="wf-time-label">to</span>
                <input className="wf-input wf-time" type="time" value={fmtMin(evWindow.end)} onChange={(e) => { const m = parseTime(e.target.value); if (m !== null) writeWindow({ ...evWindow, end: m }); }} />
              </div>
              <div className="wf-dow">
                {DOW.map((d, i) => {
                  const days = evWindow.days ?? [];
                  const on = days.includes(i);
                  return <button key={d} className={`wf-dow-btn ${on ? 'on' : ''}`} onClick={() => setEvent({ window: { ...evWindow, days: on ? days.filter((x) => x !== i) : [...days, i] } })}>{d[0]}</button>;
                })}
              </div>
              <p className="wf-hint">Only checks during these hours, so it costs much less. Anything new is caught at the next check. No days selected = every day. Set the start later than the end for an overnight window (e.g. 10 PM–6 AM).</p>
            </>
          )}
        </>
      )}
    </>
  );
}
