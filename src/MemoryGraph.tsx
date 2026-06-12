import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Memory, memoryFileUrl } from './memory';
import { useFocusTrap } from './a11y';
import { useDismiss } from './motion';
import { tap } from './haptics';
import type { Attach } from './api';
import { fileToAttachment } from './attach';
import SunOrb from './SunOrb';
import { IconTrash, IconArrowUp, IconSpark, IconArrowLeft, IconFiles, IconX, IconPhotos, IconDoc } from './icons';

// Memory as a "sun that holds what it knows about you": a glowing sun in the
// centre, a composer at the bottom. Saving a memory launches a shooting star
// that flies into the sun and is absorbed. The full list of memories lives
// behind a toggle in the top-left. Add / edit / delete from the composer; a
// top-right toggle pauses the whole feature.

interface Props {
  memories: Memory[];
  loaded: boolean;
  loadErr: boolean; // the load FAILED — show retry, never "no memories yet"
  onRetry: () => void;
  enabled: boolean;
  onAdd: (content: string) => Promise<boolean>;
  onAddFile: (note: string, attach: Attach) => Promise<boolean>;
  onUpdate: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onToggle: (next: boolean) => void;
  onClose: () => void;
}

function MemoryIcon({ m, size = 13 }: { m: Memory; size?: number }) {
  if (m.attachment_type === 'image') return <IconPhotos size={size} />;
  if (m.attachment_path) return <IconDoc size={size} />;
  return <IconSpark size={size} />;
}

export default function MemoryGraph({ memories, loaded, loadErr, onRetry, enabled, onAdd, onAddFile, onUpdate, onDelete, onToggle, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, trapRef, onClose);
  const [input, setInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Attach | null>(null); // attachment waiting to be saved
  const [attErr, setAttErr] = useState('');
  const [saveErr, setSaveErr] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [stars, setStars] = useState<number[]>([]);  // in-flight shooting stars
  const [flares, setFlares] = useState<number[]>([]); // the sun's bloom as a star lands
  const fileRef = useRef<HTMLInputElement>(null);
  const listUi = useDismiss(listOpen);

  useEffect(() => {
    document.documentElement.classList.add('gf-modal-open');
    return () => document.documentElement.classList.remove('gf-modal-open');
  }, []);

  const n = memories.length;
  const fq = filter.trim().toLowerCase();
  const shown = fq ? memories.filter((m) => m.content.toLowerCase().includes(fq)) : memories;

  function deselect() { setSelectedId(null); setInput(''); setPending(null); }
  function select(m: Memory) {
    setSelectedId(m.id);
    setInput(m.content);
    setPending(null);
    setListOpen(false); // editing happens in the composer; close the list to reveal it
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { attach, error } = await fileToAttachment(file);
    if (attach) { setSelectedId(null); setPending(attach); setAttErr(''); }
    else if (error) { setAttErr(error); setTimeout(() => setAttErr(''), 4000); }
  }

  // Launch a shooting star (and the sun's answering bloom) — only on a NEW
  // memory, so adding feels like feeding the sun.
  function fireStar() {
    const id = Date.now() + Math.random();
    setStars((s) => [...s, id]);
    setFlares((f) => [...f, id]);
  }

  async function submit() {
    if (saving) return;
    setSaveErr(false);
    const isAdd = !selectedId;
    if (pending) {
      setSaving(true);
      const ok = await onAddFile(input.trim(), pending);
      setSaving(false);
      if (ok) { fireStar(); deselect(); } else setSaveErr(true);
      return;
    }
    const c = input.trim();
    if (!c) return;
    setSaving(true);
    const ok = selectedId ? await onUpdate(selectedId, c) : await onAdd(c);
    setSaving(false);
    if (ok) { if (isAdd) fireStar(); deselect(); } else setSaveErr(true);
  }

  async function openAttachment(path: string) {
    const url = await memoryFileUrl(path);
    if (url) window.open(url, '_blank');
  }

  const selected = selectedId ? memories.find((m) => m.id === selectedId) : null;
  function remove() { if (selectedId) { onDelete(selectedId); deselect(); } }

  const sub = n === 0
    ? (enabled ? 'Applied on every chat' : 'Paused')
    : `${n} ${n === 1 ? 'memory' : 'memories'} · ${enabled ? 'applied on every chat' : 'paused'}`;

  return createPortal(
    <div className="memg" role="dialog" aria-label="Memory" ref={trapRef} tabIndex={-1}>
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
          onClick={() => { void tap(); onToggle(!enabled); }}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Memory on' : 'Memory off'}
        >
          <span className={`tgl ${enabled ? 'on' : ''}`}><span className="tgl-knob" /></span>
        </button>
      </div>

      <div className={`memg-stage memg-sky ${enabled ? '' : 'paused'}`}>
        {/* top-left toggle → the full list of memories */}
        {n > 0 && (
          <button className="memg-list-btn" onClick={() => { void tap(); setListOpen(true); }} aria-label="Show all memories" aria-expanded={listOpen}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            <span className="memg-list-count">{n}</span>
          </button>
        )}

        <div className="memg-sunwrap">
          <SunOrb size={132} className="memg-sun" />
        </div>
        {flares.map((id) => (
          <span key={id} className="memg-sun-flare" onAnimationEnd={() => setFlares((f) => f.filter((x) => x !== id))} />
        ))}
        {stars.map((id) => (
          <span key={id} className="memg-star" onAnimationEnd={() => setStars((s) => s.filter((x) => x !== id))} />
        ))}

        {/* states (below the sun) */}
        {!loaded && n === 0 && <div className="memg-hint" aria-live="polite">Loading your memories…</div>}
        {loaded && loadErr && n === 0 && (
          <div className="memg-hint">
            <div className="memg-hint-title">Couldn’t load your memories</div>
            <div>Check your connection — they’re safe on the server.</div>
            <button className="msg-retry" onClick={onRetry}>Try again</button>
          </div>
        )}
        {loaded && !loadErr && n === 0 && (
          <div className="memg-hint">
            <div className="memg-hint-title">Nothing remembered yet</div>
            <div>Add one below and watch it fly into the sun — or just say “remember that…” in any chat.</div>
          </div>
        )}
      </div>

      <div className="memg-compose-wrap">
        {selectedId && <div className="memg-editing"><span>Editing memory</span><button className="rem-cancel-edit" onClick={deselect}>Cancel</button></div>}
        {selected?.attachment_path && (
          <button className="memg-attach-chip" onClick={() => void openAttachment(selected.attachment_path!)}>
            {selected.attachment_type === 'image' ? <IconPhotos size={15} /> : <IconDoc size={15} />}
            <span className="memg-attach-name">{selected.attachment_name || 'Attachment'}</span>
            <span className="memg-attach-open">Open</span>
          </button>
        )}
        {pending && (
          <div className="memg-attach-chip">
            {pending.kind === 'image' ? <IconPhotos size={15} /> : <IconDoc size={15} />}
            <span className="memg-attach-name">{pending.name || (pending.kind === 'image' ? 'Photo' : 'File')}</span>
            <button className="memg-attach-x" onClick={() => setPending(null)} aria-label="Remove attachment"><IconX size={13} /></button>
          </div>
        )}
        {saving && pending && <div className="memg-reading">Reading attachment…</div>}
        {attErr && <div className="memg-reading memg-att-err">{attErr}</div>}
        {saveErr && <div className="memg-reading memg-att-err" role="alert">Couldn’t save — check your connection and try again.</div>}
        <div className="memg-compose">
          {selectedId ? (
            <button className="memg-trash" onClick={remove} aria-label="Delete memory"><IconTrash size={18} /></button>
          ) : (
            <button className="memg-clip" onClick={() => fileRef.current?.click()} aria-label="Attach photo or file" disabled={saving}><IconFiles size={18} /></button>
          )}
          <input
            className="memg-cinput"
            value={input}
            onChange={(e) => { setInput(e.target.value); if (saveErr) setSaveErr(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={pending ? 'Add a note (optional)' : selectedId ? 'Edit this memory' : 'Add a memory'}
            aria-label={selectedId ? 'Edit this memory' : 'Add a memory'}
            maxLength={500}
          />
          <button className="memg-send" onClick={() => void submit()} disabled={(!input.trim() && !pending) || saving} aria-label={selectedId ? 'Update' : 'Add'}>
            {saving ? <span className="btn-spin" /> : <IconArrowUp size={20} />}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pickFile} />
      </div>

      {/* The full list, behind the top-left toggle */}
      {listUi.mounted && (
        <div className={`memg-listpanel${listUi.closing ? ' closing' : ''}`} role="dialog" aria-label="All memories">
          <div className="memg-listpanel-head">
            <button className="memg-back" onClick={() => setListOpen(false)} aria-label="Back"><IconArrowLeft size={22} /></button>
            <h2>Memories</h2>
            <span className="memg-list-n">{n}</span>
          </div>
          {n > 8 && (
            <input className="memg-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter memories" aria-label="Filter memories" />
          )}
          <div className="memg-mlist">
            {shown.map((m) => (
              <div className="memg-mrow" key={m.id}>
                <button className="memg-mrow-main" onClick={() => select(m)}>
                  <span className="memg-mrow-ico"><MemoryIcon m={m} /></span>
                  <span className="memg-mrow-text">{m.content}</span>
                </button>
                <button className="memg-mrow-del" onClick={() => onDelete(m.id)} aria-label="Delete memory"><IconTrash size={16} /></button>
              </div>
            ))}
            {shown.length === 0 && <div className="memg-hint" style={{ position: 'static', marginTop: 24 }}>No memories match.</div>}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
