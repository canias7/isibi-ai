import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Memory } from './memory';
import { IconTrash, IconArrowUp, IconSpark, IconArrowLeft } from './icons';

// Full-screen "constellation" view of the user's memories: a glowing core with
// each saved memory as a node on a connector line around it. Manual add/edit/
// delete from the bottom composer; a top-right toggle pauses the whole feature.
// Nodes can be dragged to rearrange a crowded constellation (positions persist).

interface Props {
  memories: Memory[];
  loaded: boolean;
  enabled: boolean;
  onAdd: (content: string) => Promise<boolean>;
  onUpdate: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onToggle: (next: boolean) => void;
  onClose: () => void;
}

type XY = { x: number; y: number };

// Drag positions persist per-device, keyed by memory id (UUIDs are unique).
const POS_KEY = 'gf_mempos';
function loadPositions(): Record<string, XY> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Node label is a short preview; the full text is kept and shown when tapped to edit.
const preview = (s: string) => (s.length > 20 ? s.slice(0, 20).trimEnd() + '…' : s);

// Default slot for each node: float around the core — alternate left/right,
// spread down the stage, and keep clear of the core's mid band so nothing sits
// right next to the central logo. Used until the user drags a node.
function layout(n: number): XY[] {
  if (n === 1) return [{ x: 50, y: 27 }]; // a lone node floats above the core
  return Array.from({ length: n }, (_, i) => {
    let y = 22 + (60 * i) / (n - 1);                       // top -> bottom
    if (y > 41 && y < 59) y = i / (n - 1) < 0.5 ? 41 : 59; // skip the core band
    return { x: i % 2 === 0 ? 29 : 71, y };
  });
}

export default function MemoryGraph({ memories, loaded, enabled, onAdd, onUpdate, onDelete, onToggle, onClose }: Props) {
  const [input, setInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [positions, setPositions] = useState<Record<string, XY>>(loadPositions);
  const [dragId, setDragId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; w: number; h: number; moved: boolean } | null>(null);

  // Lock the page behind the modal so iOS rubber-band scroll can't drag it.
  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  const n = memories.length;
  const coords = layout(n);
  // Stable default slots: order by creation (oldest first) so adding a memory
  // appends a new slot instead of reshuffling the ones already placed.
  const slot = new Map<string, number>();
  [...memories]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .forEach((m, i) => slot.set(m.id, i));
  const posOf = (m: Memory): XY => positions[m.id] ?? coords[slot.get(m.id) ?? 0] ?? { x: 50, y: 30 };

  function onDown(e: React.PointerEvent, m: Memory) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = posOf(m);
    dragRef.current = { id: m.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, w: rect.width, h: rect.height, moved: false };
    setDragId(m.id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // still a tap
    d.moved = true;
    const nx = clamp(d.ox + (dx / d.w) * 100, 10, 90);
    const ny = clamp(d.oy + (dy / d.h) * 100, 8, 92);
    setPositions((prev) => ({ ...prev, [d.id]: { x: nx, y: ny } }));
  }

  function onUp(m: Memory) {
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    if (!d) return;
    if (!d.moved) { select(m); return; } // it was a tap, not a drag
    setPositions((prev) => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
      return prev;
    });
  }

  function deselect() {
    setSelectedId(null);
    setInput('');
  }

  function select(m: Memory) {
    setSelectedId(m.id);
    setInput(m.content);
  }

  async function submit() {
    const c = input.trim();
    if (!c || saving) return;
    setSaving(true);
    const ok = selectedId ? await onUpdate(selectedId, c) : await onAdd(c);
    setSaving(false);
    if (ok) deselect();
  }

  function remove() {
    if (!selectedId) return;
    onDelete(selectedId);
    deselect();
  }

  const sub = n === 0
    ? (enabled ? 'Applied on every chat' : 'Paused')
    : `${n} ${n === 1 ? 'memory' : 'memories'} · ${enabled ? 'applied on every chat' : 'paused'}`;

  return createPortal(
    <div className="memg" role="dialog" aria-label="Memory">
      <div className="memg-top">
        <button className="memg-back" onClick={onClose} aria-label="Back">
          <IconArrowLeft size={22} />
        </button>
        <div className="memg-titles">
          <h1 className="memg-title">Memory</h1>
          <p className="memg-sub">{sub}</p>
        </div>
        <button
          className="memg-toggle"
          onClick={() => onToggle(!enabled)}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Memory on' : 'Memory off'}
        >
          <span className={`tgl ${enabled ? 'on' : ''}`}><span className="tgl-knob" /></span>
        </button>
      </div>

      <div
        ref={stageRef}
        className={`memg-stage ${enabled ? '' : 'paused'}`}
        onClick={(e) => { if (e.target === e.currentTarget) deselect(); }}
      >
        <svg className="memg-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {memories.map((m) => {
            const p = posOf(m);
            return (
              <line
                key={m.id}
                x1={50} y1={50} x2={p.x} y2={p.y}
                className={`memg-line ${selectedId === m.id ? 'on' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div className="memg-core" aria-hidden="true">
          <IconSpark size={26} />
        </div>

        {memories.map((m, i) => {
          const p = posOf(m);
          return (
            <button
              key={m.id}
              className={`memg-node ${selectedId === m.id ? 'sel' : ''} ${dragId === m.id ? 'dragging' : ''}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${60 + i * 45}ms` }}
              onPointerDown={(e) => onDown(e, m)}
              onPointerMove={onMove}
              onPointerUp={(e) => { e.stopPropagation(); onUp(m); }}
              onPointerCancel={() => { dragRef.current = null; setDragId(null); }}
            >
              <span className="memg-ico">
                <IconSpark size={13} />
              </span>
              <span className="memg-pill">{preview(m.content)}</span>
            </button>
          );
        })}

        {loaded && n === 0 && (
          <div className="memg-empty">
            <div className="memg-empty-title">No memories yet</div>
            <div className="memg-empty-sub">Add one below — or just tell me “remember that…” in any chat.</div>
          </div>
        )}
      </div>

      <div className="memg-compose-wrap">
        {selectedId && (
          <div className="memg-editing">
            <span>Editing memory</span>
            <button className="memg-cancel" onClick={deselect}>Cancel</button>
          </div>
        )}
        <div className="memg-compose">
          {selectedId && (
            <button className="memg-trash" onClick={remove} aria-label="Delete memory">
              <IconTrash size={18} />
            </button>
          )}
          <input
            className="memg-cinput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={selectedId ? 'Edit this memory' : 'Add a memory'}
            maxLength={500}
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
