import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Memory, memoryFileUrl } from './memory';
import type { Attach } from './api';
import { fileToAttachment } from './attach';
import { IconTrash, IconArrowUp, IconSpark, IconArrowLeft, IconFiles, IconX, IconPhotos, IconDoc } from './icons';

// Full-screen "constellation" view of the user's memories: a glowing core with
// each saved memory as a node on a connector line around it. Manual add/edit/
// delete from the bottom composer; a top-right toggle pauses the whole feature.
// Nodes can be dragged to rearrange a crowded constellation (positions persist).

interface Props {
  memories: Memory[];
  loaded: boolean;
  enabled: boolean;
  onAdd: (content: string) => Promise<boolean>;
  onAddFile: (note: string, attach: Attach) => Promise<boolean>;
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

export default function MemoryGraph({ memories, loaded, enabled, onAdd, onAddFile, onUpdate, onDelete, onToggle, onClose }: Props) {
  const [input, setInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Attach | null>(null); // attachment waiting to be saved
  const [attErr, setAttErr] = useState('');
  const [positions, setPositions] = useState<Record<string, XY>>(loadPositions);
  const [dragId, setDragId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1); // pinch-zoom of the whole constellation
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; w: number; h: number; moved: boolean } | null>(null);
  // Background gesture state: track every active pointer so two fingers pinch.
  const ptrs = useRef<Map<number, XY>>(new Map());
  const gest = useRef<
    | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
    | { mode: 'pinch'; d0: number; z0: number; px: number; py: number; mx: number; my: number }
    | null
  >(null);
  const bgMoved = useRef(false); // distinguishes a pan/pinch from a tap-to-deselect

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
    e.stopPropagation(); // don't let the node's touch also start a background pan/pinch
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
    // Divide by zoom: a finger moving N screen px shifts the node N/zoom in stage space.
    const nx = clamp(d.ox + (dx / d.w / zoom) * 100, 10, 90);
    const ny = clamp(d.oy + (dy / d.h / zoom) * 100, 8, 92);
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

  // Keep the constellation anchored: don't let pan slide it off the stage. At
  // zoom 1 the scaled size equals the stage, so the range collapses to 0 (no drift).
  function clampPan(x: number, y: number, z: number): XY {
    const el = stageRef.current;
    if (!el) return { x, y };
    const cw = el.clientWidth, ch = el.clientHeight, sw = cw * z, sh = ch * z;
    return { x: clamp(x, Math.min(0, cw - sw), 0), y: clamp(y, Math.min(0, ch - sh), 0) };
  }

  // One finger pans (only travels once zoomed in); two fingers pinch-zoom,
  // anchored on the midpoint between them — same feel as the Workflows canvas.
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
    if (!ptrs.current.has(e.pointerId)) return; // a node's pointer — ignore here
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
      const sxp = (g.mx - g.px) / g.z0, syp = (g.my - g.py) / g.z0; // content point under the start midpoint
      setZoom(nz);
      setPan(clampPan(m.x - sxp * nz, m.y - syp * nz, nz));
    }
  }
  function bgUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    gest.current = null;
    if (ptrs.current.size > 0) { startGesture(); return; } // 2 fingers -> 1: resume panning
    if (!bgMoved.current) deselect(); // a clean tap on the background closes the editor
  }

  function deselect() {
    setSelectedId(null);
    setInput('');
    setPending(null);
  }

  function select(m: Memory) {
    setSelectedId(m.id);
    setInput(m.content);
    setPending(null);
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { attach, error } = await fileToAttachment(file);
    if (attach) { setSelectedId(null); setPending(attach); setAttErr(''); }
    else if (error) { setAttErr(error); setTimeout(() => setAttErr(''), 4000); }
  }

  async function submit() {
    if (saving) return;
    if (pending) {
      setSaving(true);
      const ok = await onAddFile(input.trim(), pending);
      setSaving(false);
      if (ok) deselect();
      return;
    }
    const c = input.trim();
    if (!c) return;
    setSaving(true);
    const ok = selectedId ? await onUpdate(selectedId, c) : await onAdd(c);
    setSaving(false);
    if (ok) deselect();
  }

  async function openAttachment(path: string) {
    const url = await memoryFileUrl(path);
    if (url) window.open(url, '_blank');
  }

  const selected = selectedId ? memories.find((m) => m.id === selectedId) : null;

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
        onPointerDown={bgDown}
        onPointerMove={bgMove}
        onPointerUp={bgUp}
        onPointerCancel={bgUp}
      >
       <div className="memg-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
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
                {m.attachment_type === 'image' ? <IconPhotos size={13} /> : m.attachment_path ? <IconDoc size={13} /> : <IconSpark size={13} />}
              </span>
              <span className="memg-pill">{preview(m.content)}</span>
            </button>
          );
        })}
       </div>

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
          </div>
        )}
        {/* Existing memory's attachment: open the original file. */}
        {selected?.attachment_path && (
          <button className="memg-attach-chip" onClick={() => void openAttachment(selected.attachment_path!)}>
            {selected.attachment_type === 'image' ? <IconPhotos size={15} /> : <IconDoc size={15} />}
            <span className="memg-attach-name">{selected.attachment_name || 'Attachment'}</span>
            <span className="memg-attach-open">Open</span>
          </button>
        )}
        {/* New attachment waiting to be saved. */}
        {pending && (
          <div className="memg-attach-chip">
            {pending.kind === 'image' ? <IconPhotos size={15} /> : <IconDoc size={15} />}
            <span className="memg-attach-name">{pending.name || (pending.kind === 'image' ? 'Photo' : 'File')}</span>
            <button className="memg-attach-x" onClick={() => setPending(null)} aria-label="Remove attachment"><IconX size={13} /></button>
          </div>
        )}
        {saving && pending && <div className="memg-reading">Reading attachment…</div>}
        {attErr && <div className="memg-reading memg-att-err">{attErr}</div>}
        <div className="memg-compose">
          {selectedId ? (
            <button className="memg-trash" onClick={remove} aria-label="Delete memory">
              <IconTrash size={18} />
            </button>
          ) : (
            <button className="memg-clip" onClick={() => fileRef.current?.click()} aria-label="Attach photo or file" disabled={saving}>
              <IconFiles size={18} />
            </button>
          )}
          <input
            className="memg-cinput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={pending ? 'Add a note (optional)' : selectedId ? 'Edit this memory' : 'Add a memory'}
            maxLength={500}
          />
          <button className="memg-send" onClick={() => void submit()} disabled={(!input.trim() && !pending) || saving} aria-label={selectedId ? 'Update' : 'Add'}>
            <IconArrowUp size={20} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pickFile} />
      </div>
    </div>,
    document.body,
  );
}
