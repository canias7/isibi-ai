import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Reminder, type RepeatKind } from './reminders';
import { IconTrash, IconArrowUp, IconArrowLeft, IconClock } from './icons';

// Full-screen "constellation" of the user's reminders — same floating-node feel
// as Memory: a glowing clock core with each reminder as a node around it. Add /
// edit / delete from the bottom composer (text + time + repeat); each node shows
// its time. Nodes drag to rearrange (positions persist); pinch to zoom, pan.

interface Props {
  reminders: Reminder[];
  loaded: boolean;
  onAdd: (title: string, remind_at: string, repeat: RepeatKind) => Promise<boolean>;
  onUpdate: (id: string, fields: { title: string; remind_at: string; repeat: RepeatKind }) => Promise<boolean>;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onClose: () => void;
}

type XY = { x: number; y: number };

const POS_KEY = 'gf_rempos';
function loadPositions(): Record<string, XY> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const preview = (s: string) => (s.length > 20 ? s.slice(0, 20).trimEnd() + '…' : s);
const pad = (n: number) => String(n).padStart(2, '0');

// ISO -> value for <input type="datetime-local"> (local wall-clock).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d.toISOString());
}
// Friendly node label, e.g. "Today · 5:00 PM", "Tomorrow · 9:00 AM", "Daily · 8:00 AM".
function formatWhen(iso: string, repeat: RepeatKind): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  let day: string;
  if (repeat === 'daily') day = 'Daily';
  else if (repeat === 'weekly') day = d.toLocaleDateString([], { weekday: 'short' }) + ' wkly';
  else if (same(d, now)) day = 'Today';
  else if (same(d, tomorrow)) day = 'Tomorrow';
  else day = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

function layout(n: number): XY[] {
  if (n === 1) return [{ x: 50, y: 27 }];
  return Array.from({ length: n }, (_, i) => {
    let y = 22 + (60 * i) / (n - 1);
    if (y > 41 && y < 59) y = i / (n - 1) < 0.5 ? 41 : 59;
    return { x: i % 2 === 0 ? 29 : 71, y };
  });
}

export default function RemindersGraph({ reminders, loaded, onAdd, onUpdate, onDelete, onToggle, onClose }: Props) {
  const [input, setInput] = useState('');
  const [when, setWhen] = useState(defaultWhen);
  const [repeat, setRepeat] = useState<RepeatKind>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [positions, setPositions] = useState<Record<string, XY>>(loadPositions);
  const [dragId, setDragId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; w: number; h: number; moved: boolean } | null>(null);
  const ptrs = useRef<Map<number, XY>>(new Map());
  const gest = useRef<
    | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
    | { mode: 'pinch'; d0: number; z0: number; px: number; py: number; mx: number; my: number }
    | null
  >(null);
  const bgMoved = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  const n = reminders.length;
  const coords = layout(n);
  const slot = new Map<string, number>();
  [...reminders]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .forEach((r, i) => slot.set(r.id, i));
  const posOf = (r: Reminder): XY => positions[r.id] ?? coords[slot.get(r.id) ?? 0] ?? { x: 50, y: 30 };

  function onDown(e: React.PointerEvent, r: Reminder) {
    e.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = posOf(r);
    dragRef.current = { id: r.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, w: rect.width, h: rect.height, moved: false };
    setDragId(r.id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    d.moved = true;
    const nx = clamp(d.ox + (dx / d.w / zoom) * 100, 10, 90);
    const ny = clamp(d.oy + (dy / d.h / zoom) * 100, 8, 92);
    setPositions((prev) => ({ ...prev, [d.id]: { x: nx, y: ny } }));
  }
  function onUp(r: Reminder) {
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    if (!d) return;
    if (!d.moved) { select(r); return; }
    setPositions((prev) => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
      return prev;
    });
  }

  function clampPan(x: number, y: number, z: number): XY {
    const el = stageRef.current;
    if (!el) return { x, y };
    const cw = el.clientWidth, ch = el.clientHeight, sw = cw * z, sh = ch * z;
    return { x: clamp(x, Math.min(0, cw - sw), 0), y: clamp(y, Math.min(0, ch - sh), 0) };
  }
  function localMid(pts: XY[]): XY {
    const r = stageRef.current?.getBoundingClientRect();
    const ox = r?.left ?? 0, oy = r?.top ?? 0;
    if (pts.length >= 2) return { x: (pts[0].x + pts[1].x) / 2 - ox, y: (pts[0].y + pts[1].y) / 2 - oy };
    return { x: (pts[0]?.x ?? 0) - ox, y: (pts[0]?.y ?? 0) - oy };
  }
  function startGesture() {
    const pts = [...ptrs.current.values()];
    if (pts.length === 1) {
      gest.current = { mode: 'pan', sx: pts[0].x, sy: pts[0].y, px: pan.x, py: pan.y };
    } else if (pts.length >= 2) {
      const m = localMid(pts);
      gest.current = { mode: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, z0: zoom, px: pan.x, py: pan.y, mx: m.x, my: m.y };
    }
  }
  function bgDown(e: React.PointerEvent) {
    if (ptrs.current.size === 0) bgMoved.current = false;
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
      const dx = pts[0].x - g.sx, dy = pts[0].y - g.sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) bgMoved.current = true;
      setPan(clampPan(g.px + dx, g.py + dy, zoom));
    } else if (g.mode === 'pinch' && pts.length >= 2) {
      bgMoved.current = true;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const nz = clamp(+(g.z0 * (d / g.d0)).toFixed(3), 1, 3);
      const m = localMid(pts);
      const sxp = (g.mx - g.px) / g.z0, syp = (g.my - g.py) / g.z0;
      setZoom(nz);
      setPan(clampPan(m.x - sxp * nz, m.y - syp * nz, nz));
    }
  }
  function bgUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    gest.current = null;
    if (ptrs.current.size > 0) { startGesture(); return; }
    if (!bgMoved.current) deselect();
  }

  function deselect() {
    setSelectedId(null);
    setInput('');
    setWhen(defaultWhen());
    setRepeat('none');
  }
  function select(r: Reminder) {
    setSelectedId(r.id);
    setInput(r.title);
    setWhen(toLocalInput(r.remind_at));
    setRepeat(r.repeat);
  }

  async function submit() {
    if (saving) return;
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
  }

  const selected = selectedId ? reminders.find((r) => r.id === selectedId) : null;

  function remove() {
    if (!selectedId) return;
    onDelete(selectedId);
    deselect();
  }

  const sub = n === 0 ? 'Get a nudge at the right time' : `${n} ${n === 1 ? 'reminder' : 'reminders'}`;
  const reps: RepeatKind[] = ['none', 'daily', 'weekly'];
  const repLabel: Record<RepeatKind, string> = { none: 'Once', daily: 'Daily', weekly: 'Weekly' };

  return createPortal(
    <div className="memg" role="dialog" aria-label="Reminders">
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

      <div
        ref={stageRef}
        className="memg-stage"
        onPointerDown={bgDown}
        onPointerMove={bgMove}
        onPointerUp={bgUp}
        onPointerCancel={bgUp}
      >
       <div className="memg-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="memg-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {reminders.map((r) => {
            const p = posOf(r);
            return (
              <line
                key={r.id}
                x1={50} y1={50} x2={p.x} y2={p.y}
                className={`memg-line ${selectedId === r.id ? 'on' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div className="memg-core" aria-hidden="true">
          <IconClock size={26} />
        </div>

        {reminders.map((r, i) => {
          const p = posOf(r);
          return (
            <button
              key={r.id}
              className={`memg-node rem-node ${selectedId === r.id ? 'sel' : ''} ${dragId === r.id ? 'dragging' : ''} ${r.enabled ? '' : 'off'}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${60 + i * 45}ms` }}
              onPointerDown={(e) => onDown(e, r)}
              onPointerMove={onMove}
              onPointerUp={(e) => { e.stopPropagation(); onUp(r); }}
              onPointerCancel={() => { dragRef.current = null; setDragId(null); }}
            >
              <span className="memg-ico"><IconClock size={13} /></span>
              <span className="memg-pill">
                {preview(r.title)}
                <span className="rem-when">{formatWhen(r.remind_at, r.repeat)}</span>
              </span>
            </button>
          );
        })}
       </div>

        {loaded && n === 0 && (
          <div className="memg-empty">
            <div className="memg-empty-title">No reminders yet</div>
            <div className="memg-empty-sub">Add one below — a title and a time, and your phone will nudge you.</div>
          </div>
        )}
      </div>

      <div className="memg-compose-wrap">
        {selected && (
          <div className="memg-editing">
            <span>Editing reminder</span>
            <button
              className="rem-onoff"
              onClick={() => onToggle(selected.id, !selected.enabled)}
              role="switch"
              aria-checked={selected.enabled}
              aria-label={selected.enabled ? 'Reminder on' : 'Reminder off'}
            >
              <span className={`tgl ${selected.enabled ? 'on' : ''}`}><span className="tgl-knob" /></span>
            </button>
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
            maxLength={200}
          />
          <button className="memg-send" onClick={() => void submit()} disabled={!input.trim() || saving} aria-label={selectedId ? 'Update' : 'Add'}>
            <IconArrowUp size={20} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
