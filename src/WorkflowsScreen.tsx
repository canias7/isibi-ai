import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconX, IconTrash } from './icons';
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, listRuns, scheduleLabel, deviceTz,
  type Workflow, type WorkflowRun, type Schedule,
} from './workflows';

// Full-screen Workflows manager: list saved automations, create/edit one (an
// instruction + a schedule), toggle, delete, and view each one's run history.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultSchedule(): Schedule {
  return { freq: 'daily', hour: 8, minute: 0, weekday: 1, tz: deviceTz() };
}
function timeValue(s: Schedule): string {
  return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
}
function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function WorkflowsScreen({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Workflow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  async function load() {
    setLoaded(false);
    setItems(await listWorkflows());
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  async function toggle(w: Workflow) {
    setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: !x.enabled } : x))); // optimistic
    const ok = await updateWorkflow(w.id, { enabled: !w.enabled });
    if (!ok) void load();
  }

  const body = editing
    ? <Editor wf={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void load(); }} onBack={() => setEditing(null)} />
    : (
      <div className="wf-stage">
        <button className="wf-new" onClick={() => setEditing('new')}>+ New workflow</button>
        {loaded && items.length === 0 ? (
          <div className="wf-empty">
            <div className="wf-empty-title">No workflows yet</div>
            <div className="wf-empty-sub">Create an automation that runs on a schedule — like a morning brief of your calendar and unread email.</div>
          </div>
        ) : (
          <div className="wf-list">
            {items.map((w) => (
              <div className="wf-card" key={w.id} onClick={() => setEditing(w)} role="button">
                <div className="wf-card-main">
                  <div className="wf-card-title">{w.title}</div>
                  <div className="wf-card-sub">
                    {scheduleLabel(w.schedule)}{w.last_run_at ? ` · last ran ${relTime(w.last_run_at)}` : ''}
                  </div>
                </div>
                <span
                  className={`tgl ${w.enabled ? 'on' : ''}`}
                  role="switch"
                  aria-checked={w.enabled}
                  onClick={(e) => { e.stopPropagation(); void toggle(w); }}
                ><span className="tgl-knob" /></span>
              </div>
            ))}
          </div>
        )}
      </div>
    );

  return createPortal(
    <div className="memg" role="dialog" aria-label="Workflows">
      <div className="memg-top">
        <div className="memg-titles">
          <h1 className="memg-title">{editing ? (editing === 'new' ? 'New workflow' : 'Edit workflow') : 'Workflows'}</h1>
          <p className="memg-sub">{editing ? 'Runs automatically on your schedule' : 'Automations that run on a schedule'}</p>
        </div>
        <button className="memg-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
      </div>
      {body}
    </div>,
    document.body,
  );
}

function Editor({ wf, onDone, onBack }: { wf: Workflow | null; onDone: () => void; onBack: () => void }) {
  const [title, setTitle] = useState(wf?.title ?? '');
  const [instruction, setInstruction] = useState(wf?.instruction ?? '');
  const [sched, setSched] = useState<Schedule>(wf?.schedule ?? defaultSchedule());
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  useEffect(() => { if (wf) void listRuns(wf.id).then(setRuns); }, [wf]);

  function setTime(v: string) {
    const [h, m] = v.split(':').map((x) => parseInt(x, 10));
    if (!isNaN(h) && !isNaN(m)) setSched((s) => ({ ...s, hour: h, minute: m }));
  }

  async function save() {
    const inst = instruction.trim();
    if (!inst || busy) return;
    setBusy(true);
    const ok = wf
      ? await updateWorkflow(wf.id, { title: title.trim() || inst.slice(0, 40), instruction: inst, schedule: sched })
      : !!(await createWorkflow(title.trim(), inst, sched));
    setBusy(false);
    if (ok) onDone();
  }

  async function remove() {
    if (!wf || busy) return;
    setBusy(true);
    const ok = await deleteWorkflow(wf.id);
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <div className="wf-stage wf-editor">
      <button className="wf-back" onClick={onBack}>‹ Back</button>

      <label className="wf-label">What should it do?</label>
      <textarea
        className="wf-input wf-area"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="e.g. Summarize my unread email and what's on my calendar today"
        rows={3}
        maxLength={1000}
      />

      <label className="wf-label">Name (optional)</label>
      <input className="wf-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning brief" maxLength={80} />

      <label className="wf-label">When</label>
      <div className="wf-seg">
        {(['daily', 'weekly', 'hourly'] as const).map((f) => (
          <button key={f} className={`wf-seg-btn ${sched.freq === f ? 'on' : ''}`} onClick={() => setSched((s) => ({ ...s, freq: f }))}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {sched.freq === 'weekly' && (
        <div className="wf-dow">
          {DOW.map((d, i) => (
            <button key={d} className={`wf-dow-btn ${(sched.weekday ?? 1) === i ? 'on' : ''}`} onClick={() => setSched((s) => ({ ...s, weekday: i }))}>
              {d[0]}
            </button>
          ))}
        </div>
      )}

      {sched.freq === 'hourly' ? (
        <p className="wf-hint">Runs at the top of every hour.</p>
      ) : (
        <div className="wf-time-row">
          <span className="wf-time-label">At</span>
          <input className="wf-input wf-time" type="time" value={timeValue(sched)} onChange={(e) => setTime(e.target.value)} />
        </div>
      )}

      <button className="wf-save" onClick={() => void save()} disabled={!instruction.trim() || busy}>
        {wf ? 'Save changes' : 'Create workflow'}
      </button>
      {wf && (
        <button className="wf-delete" onClick={() => void remove()} disabled={busy}>
          <IconTrash size={16} /> Delete workflow
        </button>
      )}

      {wf && (
        <div className="wf-runs">
          <div className="wf-runs-head">Recent runs</div>
          {runs.length === 0 ? (
            <div className="wf-runs-empty">No runs yet — it’ll appear here after the first scheduled run.</div>
          ) : (
            runs.map((r) => (
              <div className={`wf-run ${r.ok ? '' : 'bad'}`} key={r.id}>
                <div className="wf-run-time">{relTime(r.created_at)}</div>
                <div className="wf-run-text">{r.result}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
