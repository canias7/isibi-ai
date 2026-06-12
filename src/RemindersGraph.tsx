import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './a11y';
import { tap } from './haptics';
import { cleanReminderTitle, type Reminder, type RepeatKind } from './reminders';
import { IconTrash, IconArrowUp, IconArrowLeft, IconClock } from './icons';

// The user's reminders as a time-ordered AGENDA — grouped Today / Tomorrow /
// This week / Later / Repeating, each a card with its time, the task, a repeat
// badge, and an on/off toggle. Add / edit from the bottom composer; tap a card
// to edit it. (Reminders are chronological, so a list beats the old scatter.)

const pad = (n: number) => String(n).padStart(2, '0');

// ISO -> value for <input type="datetime-local"> (local wall-clock).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Default the picker to (almost) now — a few minutes ahead so saving without
// touching it is still in the future.
function defaultWhen(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d.toISOString());
}

// Which agenda section a reminder belongs to.
function bucketOf(r: Reminder): string {
  if (r.repeat !== 'none') return 'Repeating';
  const d = new Date(r.remind_at);
  const now = new Date();
  if (d.getTime() < now.getTime()) return 'Earlier';
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startTom = new Date(startToday); startTom.setDate(startToday.getDate() + 1);
  const startAfter = new Date(startToday); startAfter.setDate(startToday.getDate() + 2);
  const weekEnd = new Date(startToday); weekEnd.setDate(startToday.getDate() + 7);
  if (d < startTom) return 'Today';
  if (d < startAfter) return 'Tomorrow';
  if (d < weekEnd) return 'This week';
  return 'Later';
}
const SECTION_ORDER = ['Today', 'Tomorrow', 'This week', 'Later', 'Repeating', 'Earlier'];

// The time shown on a card (the section already gives the day, so only add the
// weekday/date where the section is vague).
function rowTime(r: Reminder): string {
  const d = new Date(r.remind_at);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (r.repeat === 'daily') return time;
  if (r.repeat === 'weekly') return `${d.toLocaleDateString([], { weekday: 'short' })} · ${time}`;
  const b = bucketOf(r);
  if (b === 'Today' || b === 'Tomorrow') return time;
  if (b === 'This week') return `${d.toLocaleDateString([], { weekday: 'short' })} · ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

interface Props {
  reminders: Reminder[];
  loaded: boolean;
  loadErr: boolean; // the load FAILED — show retry, never "no reminders yet"
  onRetry: () => void;
  onAdd: (title: string, remind_at: string, repeat: RepeatKind) => Promise<boolean>;
  onUpdate: (id: string, fields: { title: string; remind_at: string; repeat: RepeatKind }) => Promise<boolean>;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onClose: () => void;
}

export default function RemindersGraph({ reminders, loaded, loadErr, onRetry, onAdd, onUpdate, onDelete, onToggle, onClose }: Props) {
  // Full-screen dialog: keep keyboard focus inside; Esc goes back.
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, trapRef, onClose);
  const [input, setInput] = useState('');
  const [when, setWhen] = useState(defaultWhen);
  const [repeat, setRepeat] = useState<RepeatKind>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  const n = reminders.length;
  const active = reminders.filter((r) => r.enabled).length;

  // Bucket into sections, each sorted by time.
  const byBucket = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const b = bucketOf(r);
    const arr = byBucket.get(b);
    if (arr) arr.push(r); else byBucket.set(b, [r]);
  }
  const groups = SECTION_ORDER
    .filter((k) => byBucket.has(k))
    .map((k) => [k, byBucket.get(k)!.slice().sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime())] as const);

  function deselect() {
    setSelectedId(null);
    setInput('');
    setWhen(defaultWhen());
    setRepeat('none');
  }
  function select(r: Reminder) {
    void tap();
    if (selectedId === r.id) { deselect(); return; } // tap the selected card again to stop editing
    setSelectedId(r.id);
    setInput(cleanReminderTitle(r.title));
    setWhen(toLocalInput(r.remind_at));
    setRepeat(r.repeat);
  }

  async function submit() {
    if (saving) return;
    setErr('');
    const title = input.trim();
    if (!title) return;
    if (!when) { setErr('Pick a time'); setTimeout(() => setErr(''), 3000); return; }
    const remind_at = new Date(when).toISOString();
    if (repeat === 'none' && new Date(remind_at).getTime() <= Date.now()) {
      setErr('Pick a time in the future'); setTimeout(() => setErr(''), 3000); return;
    }
    setSaving(true);
    const ok = selectedId
      ? await onUpdate(selectedId, { title, remind_at, repeat })
      : await onAdd(title, remind_at, repeat);
    setSaving(false);
    if (ok) deselect();
    else setErr('Couldn’t save — check your connection and try again.');
  }

  const selected = selectedId ? reminders.find((r) => r.id === selectedId) : null;
  function remove() {
    if (!selectedId) return;
    onDelete(selectedId);
    deselect();
  }

  const sub = n === 0 ? 'Get a nudge at the right time' : `${active} active`;
  const reps: RepeatKind[] = ['none', 'daily', 'weekly'];
  const repLabel: Record<RepeatKind, string> = { none: 'Once', daily: 'Daily', weekly: 'Weekly' };

  return createPortal(
    <div className="memg rem-page" role="dialog" aria-label="Reminders" ref={trapRef} tabIndex={-1}>
      <div className="memg-top">
        <button className="memg-back" onClick={onClose} aria-label="Back">
          <IconArrowLeft size={22} />
        </button>
        <div className="memg-titles">
          <h1 className="memg-title">Reminders</h1>
          <p className="memg-sub">{sub}</p>
        </div>
        <span style={{ width: 40 }} />
      </div>

      <div className="rem-list">
        {!loaded && n === 0 && (
          <div className="memg-empty" aria-live="polite">
            <div className="memg-empty-sub">Loading your reminders…</div>
          </div>
        )}
        {loaded && loadErr && n === 0 && (
          <div className="memg-empty">
            <div className="memg-empty-title">Couldn’t load your reminders</div>
            <div className="memg-empty-sub">Check your connection — they’re safe on the server.</div>
            <button className="msg-retry" onClick={onRetry}>Try again</button>
          </div>
        )}
        {loaded && !loadErr && n === 0 && (
          <div className="memg-empty">
            <div className="memg-empty-title">No reminders yet</div>
            <div className="memg-empty-sub">Add one below — a title and a time, and your phone will nudge you.</div>
          </div>
        )}

        {groups.map(([label, items]) => (
          <div className="rem-sec" key={label}>
            <div className="rem-sec-label">{label}</div>
            {items.map((r) => (
              <div key={r.id} className={`rem-card${selectedId === r.id ? ' sel' : ''}${r.enabled ? '' : ' off'}`}>
                <button className="rem-card-main" onClick={() => select(r)}>
                  <span className="rem-card-row1">
                    <span className="rem-card-time">{rowTime(r)}</span>
                    {r.repeat !== 'none' && <span className="rem-card-badge">{repLabel[r.repeat]}</span>}
                  </span>
                  <span className="rem-card-title">{cleanReminderTitle(r.title)}</span>
                </button>
                <button
                  className="rem-card-toggle"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={`${cleanReminderTitle(r.title)} — ${r.enabled ? 'on' : 'off'}`}
                  onClick={() => { void tap(); onToggle(r.id, !r.enabled); }}
                >
                  <span className={`tgl ${r.enabled ? 'on' : ''}`}><span className="tgl-knob" /></span>
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="memg-compose-wrap">
        {selected && (
          <div className="memg-editing">
            <span>Editing reminder</span>
            <button className="rem-cancel-edit" onClick={deselect}>Cancel</button>
          </div>
        )}
        {err && <div className="memg-reading memg-att-err">{err}</div>}
        <div className="rem-fields">
          <input
            className="rem-time"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="Reminder time"
          />
          <div className="rem-reps">
            {reps.map((rp) => (
              <button
                key={rp}
                className={`rem-rep ${repeat === rp ? 'on' : ''}`}
                onClick={() => setRepeat(rp)}
              >
                {repLabel[rp]}
              </button>
            ))}
          </div>
        </div>
        <div className="memg-compose">
          {selectedId ? (
            <button className="memg-trash" onClick={remove} aria-label="Delete reminder">
              <IconTrash size={18} />
            </button>
          ) : (
            <span className="memg-clip" aria-hidden="true"><IconClock size={18} /></span>
          )}
          <input
            className="memg-cinput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={selectedId ? 'Edit this reminder' : 'Remind me to…'}
            aria-label={selectedId ? 'Edit this reminder' : 'Add a reminder'}
            maxLength={200}
          />
          <button className="memg-send" onClick={() => void submit()} disabled={!input.trim() || saving} aria-label={selectedId ? 'Update' : 'Add'}>
            {saving ? <span className="btn-spin" /> : <IconArrowUp size={20} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
