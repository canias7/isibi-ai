import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Memory } from './memory';
import { IconX, IconTrash, IconArrowUp, IconChat, IconDollar, IconQuestion, IconCube, IconDoc, IconSpark } from './icons';

// Full-screen "constellation" view of the user's memories: a glowing core with
// each saved memory as a node on a connector line around it. Manual add/edit/
// delete from the bottom composer; a top-right toggle pauses the whole feature.

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

// Decorative icon + color per node, cycled by index (purely cosmetic).
const PALETTE = [
  { Icon: IconCube, color: '#4a90d9' },
  { Icon: IconDollar, color: '#e0a13a' },
  { Icon: IconChat, color: '#9aa0aa' },
  { Icon: IconQuestion, color: '#9b87f5' },
  { Icon: IconSpark, color: '#cdd1d8' },
  { Icon: IconDoc, color: '#e0518c' },
];

// Position each node to "float" around the core: alternate left/right columns,
// spread down the stage, and keep clear of the core's mid band so nothing sits
// right next to the central logo.
function layout(n: number): { x: number; y: number }[] {
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

  // Lock the page behind the modal so iOS rubber-band scroll can't drag it.
  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  const n = memories.length;
  const coords = layout(n);
  const pos = new Map<string, { x: number; y: number }>();
  memories.forEach((m, i) => pos.set(m.id, coords[i]));

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
        <button className="memg-close" onClick={onClose} aria-label="Close">
          <IconX size={20} />
        </button>
      </div>

      <div
        className={`memg-stage ${enabled ? '' : 'paused'}`}
        onClick={(e) => { if (e.target === e.currentTarget) deselect(); }}
      >
        <svg className="memg-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {memories.map((m) => {
            const p = pos.get(m.id)!;
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
          const p = pos.get(m.id)!;
          const { Icon, color } = PALETTE[i % PALETTE.length];
          return (
            <button
              key={m.id}
              className={`memg-node ${selectedId === m.id ? 'sel' : ''}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${60 + i * 45}ms` }}
              onClick={(e) => { e.stopPropagation(); select(m); }}
            >
              <span className="memg-ico" style={{ borderColor: color, color }}>
                <Icon size={14} />
              </span>
              <span className="memg-pill">{m.content}</span>
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
