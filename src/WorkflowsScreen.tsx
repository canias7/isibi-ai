import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  IconX, IconTrash, IconArrowLeft, IconArrowUp, IconLayers, IconPlay,
  IconClock, IconBolt, IconBranch, IconSpark, IconCheck,
} from './icons';
import { byId } from './connectorData';
import { BrandLogo, hasBrand, BRAND_IDS } from './brandLogos';
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, listRuns, buildWorkflow, testWorkflow,
  triggerLabel, deviceTz, appLabel, compileInstruction, orderedNodes,
  type Workflow, type WorkflowRun, type Schedule, type Trigger, type WfGraph, type WfNode,
} from './workflows';

type NodeResult = { ok: boolean; output: string };

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

// Decorative mini node-graph for the empty state — top-down like the real canvas.
// Nodes are draggable (clamped so they can't reach the composer), and the five
// app nodes cycle through our bundled-logo apps every 5s (no repeats in a round;
// once all are shown it loops) with a pop animation. Wires follow the nodes.
const HF_VB_W = 240, HF_VB_H = 250, HF_CLAMP = 20; // viewBox + max drag (vb units)
// base center [x,y], radius, and (for app nodes) the cycling slot 0..4.
const HF_NODES: { base: [number, number]; r: number; slot?: number; ai?: boolean }[] = [
  { base: [80, 36], r: 21, slot: 0 },
  { base: [160, 36], r: 21, slot: 1 },
  { base: [120, 125], r: 29, ai: true },
  { base: [60, 214], r: 21, slot: 2 },
  { base: [120, 214], r: 21, slot: 3 },
  { base: [180, 214], r: 21, slot: 4 },
];
const HF_EDGES: [number, number][] = [[0, 2], [1, 2], [2, 3], [2, 4], [2, 5]];
// App pool, trimmed to a multiple of 5 so each round shows 5 distinct apps and
// the rounds tile through the whole list before repeating.
const HF_POOL = BRAND_IDS.slice(0, Math.max(5, Math.floor(BRAND_IDS.length / 5) * 5));

function HeroFlow() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [slotRound, setSlotRound] = useState<number[]>(() => [0, 0, 0, 0, 0]);
  const cur = useRef(0); // which slot swaps next (round-robin 0..4)
  const [off, setOff] = useState(() => HF_NODES.map(() => ({ dx: 0, dy: 0 })));
  const drag = useRef<{ i: number; sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    // Swap ONE node per second, round-robin (0..4 then loop) — first, then the
    // next a second later, and so on. Each slot stays on its own residue mod 5,
    // so the five visible apps are never duplicated. Paused while dragging.
    const t = setInterval(() => {
      if (drag.current) return;
      const s = cur.current;
      setSlotRound((prev) => prev.map((r, idx) => (idx === s ? r + 1 : r)));
      cur.current = (s + 1) % 5;
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const appForSlot = (slot: number) => HF_POOL[(slotRound[slot] * 5 + slot) % HF_POOL.length];
  const center = (i: number) => ({ x: HF_NODES[i].base[0] + off[i].dx, y: HF_NODES[i].base[1] + off[i].dy });

  function down(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    drag.current = { i, sx: e.clientX, sy: e.clientY, ox: off[i].dx, oy: off[i].dy };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const r = wrapRef.current?.getBoundingClientRect(); if (!r) return;
    const dx = clamp(d.ox + ((e.clientX - d.sx) / r.width) * HF_VB_W, -HF_CLAMP, HF_CLAMP);
    const dy = clamp(d.oy + ((e.clientY - d.sy) / r.height) * HF_VB_H, -HF_CLAMP, HF_CLAMP);
    setOff((p) => p.map((o, idx) => (idx === d.i ? { dx, dy } : o)));
  }
  function up() { drag.current = null; }

  return (
    <div className="wfx-hf" ref={wrapRef} aria-hidden="true">
      <svg className="wfx-hf-wires" viewBox={`0 0 ${HF_VB_W} ${HF_VB_H}`}>
        <defs>
          <marker id="wfx-hf-arrow" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(224,161,58,0.85)" />
          </marker>
        </defs>
        {HF_EDGES.map(([a, b], k) => {
          const A = center(a), B = center(b);
          const x1 = A.x, y1 = A.y + HF_NODES[a].r, x2 = B.x, y2 = B.y - HF_NODES[b].r;
          const mid = (y1 + y2) / 2;
          return (
            <path key={k} className="wfx-hf-wire" markerEnd="url(#wfx-hf-arrow)"
              style={{ animationDelay: `${k * 0.12}s` }}
              d={`M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`} />
          );
        })}
      </svg>
      {HF_NODES.map((nd, i) => {
        const c = center(i);
        const app = nd.ai ? 'ai' : appForSlot(nd.slot!);
        return (
          <div
            key={i}
            className={`wfx-hf-node ${nd.ai ? 'b' : ''}`}
            style={{ left: `${(c.x / HF_VB_W) * 100}%`, top: `${(c.y / HF_VB_H) * 100}%` }}
            onPointerDown={(e) => down(e, i)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {nd.ai
              ? <NodeIcon app="ai" size={24} />
              : <span key={app} className="wfx-hf-ic"><BrandLogo app={app} size={24} /></span>}
          </div>
        );
      })}
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

  async function build() {
    const d = desc.trim();
    if (!d || building) return;
    setBuilding(true);
    setErr('');
    const draftWf = await buildWorkflow(d);
    setBuilding(false);
    if (!draftWf) { setErr("Couldn't build that — try describing it a little differently."); return; }
    setDraft({ title: draftWf.title, instruction: draftWf.instruction, trigger: draftWf.trigger, graph: draftWf.graph });
    setDesc('');
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
        onClose={() => setDraft(null)}
        onSaved={() => { setDraft(null); setView('projects'); void load(); }}
        onDeleted={() => setDraft(null)}
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
        connApps={connApps}
        onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); void load(); }}
        onDeleted={() => { setOpen(null); void load(); }}
      />
    );
  }

  return createPortal(
    <div className="memg" role="dialog" aria-label="Workflows">
      <div className="memg-top">
        {view === 'projects' ? (
          <button className="memg-back" onClick={() => setView('home')} aria-label="Back"><IconArrowLeft size={22} /></button>
        ) : (
          <button className="memg-back" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        )}
        <div className="memg-titles">
          <h1 className="memg-title">{view === 'projects' ? 'Projects' : 'Workflows'}</h1>
          <p className="memg-sub">{view === 'projects' ? `${items.length} saved` : 'Describe an automation and I’ll build it'}</p>
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
          <div className="wfx-hero">
            <HeroFlow />
            <div className="wfx-hero-title">What should run on autopilot?</div>
            <div className="wfx-hero-sub">e.g. “Every weekday at 8am, email me a summary of my unread mail and today’s calendar.”</div>
            {err && <div className="wfx-err">{err}</div>}
          </div>
          <div className="memg-compose-wrap">
            <div className="memg-compose">
              <input
                className="memg-cinput"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void build(); }}
                placeholder="Describe your workflow…"
                maxLength={2000}
                disabled={building}
              />
              <button className="memg-send" onClick={() => void build()} disabled={!desc.trim() || building} aria-label="Build">
                {building ? <span className="wfx-spin" /> : <IconArrowUp size={20} />}
              </button>
            </div>
            {building && <div className="memg-reading">Designing your workflow…</div>}
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
function PlanView({ initial, mode, wfId, connApps, onClose, onSaved, onDeleted }: {
  initial: Work; mode: 'draft' | 'saved'; wfId?: string; connApps: string[];
  onClose: () => void; onSaved: () => void; onDeleted: () => void;
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

  // Modal-lock is owned by the parent WorkflowsScreen (this renders inside it).
  useEffect(() => { if (wfId) void listRuns(wfId).then(setRuns); }, [wfId]);

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
    const steps = orderedNodes(graph).filter((n) => n.kind !== 'trigger').map((n) => ({ id: n.id, label: n.label }));
    setTesting(true); setEdgeState('run'); setResults({});
    const r = await testWorkflow(inst, mode === 'saved' ? wfId : undefined, steps);
    setTesting(false);
    if (!r) { setEdgeState('fail'); return; }
    const map: Record<string, NodeResult> = {};
    for (const s of r.steps) map[s.id] = { ok: s.ok, output: s.output };
    setResults(map);
    // With per-node results we color each cable by its target; otherwise fall
    // back to a single overall pass/fail.
    setEdgeState(r.steps.length ? 'idle' : r.ok ? 'pass' : 'fail');
    if (wfId) void listRuns(wfId).then(setRuns); // run is saved to history (future Logs)
  }
  function applyTrigger(t: Trigger) {
    setTrigger(t);
    // keep the trigger node's badge in sync
    const tn = graph.nodes.find((n) => n.kind === 'trigger');
    if (tn) patchNode(tn.id, { app: t.type });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    const instruction = compileInstruction(title.trim(), graph);
    const ok = mode === 'draft'
      ? !!(await createWorkflow(title.trim(), instruction, trigger, graph))
      : wfId ? await updateWorkflow(wfId, { title: title.trim(), instruction, trigger, graph }) : false;
    setBusy(false);
    if (ok) onSaved();
  }
  async function remove() {
    if (!wfId || busy) return;
    setBusy(true);
    const ok = await deleteWorkflow(wfId);
    setBusy(false);
    if (ok) onDeleted();
  }

  return createPortal(
    <div className="memg wfx-plan" role="dialog" aria-label={mode === 'draft' ? 'New workflow' : 'Edit workflow'}>
      <div className="memg-top">
        <button className="memg-back" onClick={onClose} aria-label="Back"><IconArrowLeft size={22} /></button>
        <div className="memg-titles">
          <input className="wfx-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled workflow" maxLength={80} />
          <p className="memg-sub">{mode === 'draft' ? 'Draft · tap a step to edit' : 'Tap a step to edit'}</p>
        </div>
        <button className="wfx-test" onClick={() => void test()} disabled={testing} aria-label="Test workflow">
          {testing ? <span className="wfx-spin-l" /> : <IconPlay size={14} />}
          <span>{testing ? 'Testing' : 'Test'}</span>
        </button>
      </div>

      <Canvas graph={graph} results={results} onChange={(g) => { setGraph(g); clearTest(); }} onSelect={setSel} edgeState={edgeState} />

      {/* Bottom action bar */}
      <div className="wfx-bar">
        {mode === 'saved' && (
          <button className="wfx-bar-hist" onClick={() => setShowRuns(true)} disabled={busy} aria-label="Run history"><IconClock size={18} /></button>
        )}
        {mode === 'saved' && (
          <button className="wfx-bar-del" onClick={() => void remove()} disabled={busy} aria-label="Delete workflow"><IconTrash size={18} /></button>
        )}
        <button className="wfx-bar-save" onClick={() => void save()} disabled={busy}>
          <IconCheck size={18} />
          {mode === 'draft' ? 'Looks good — Save & turn on' : 'Save changes'}
        </button>
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
  const timeVal = `${String(sched.hour).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')}`;
  const setSched = (s: Schedule) => onChange({ type: 'schedule', schedule: s });

  return (
    <>
      <label className="wf-label">Trigger</label>
      <div className="wf-seg">
        <button className={`wf-seg-btn ${kind === 'schedule' ? 'on' : ''}`} onClick={() => setSched(sched)}>On a schedule</button>
        <button className={`wf-seg-btn ${kind === 'event' ? 'on' : ''}`} onClick={() => onChange({ type: 'event', event: { app: evApp, filter: evFilter } })} disabled={connApps.length === 0}>When it arrives</button>
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
              <button key={id} className={`wfx-app ${evApp === id ? 'on' : ''}`} onClick={() => onChange({ type: 'event', event: { app: id, filter: evFilter } })}>
                <span className="wfx-app-ic"><NodeIcon app={id} size={16} /></span>{byId(id)?.name ?? id}
              </button>
            ))}
          </div>
          <label className="wf-label">Trigger when…</label>
          <input className="wf-input" value={evFilter} onChange={(e) => onChange({ type: 'event', event: { app: evApp, filter: e.target.value } })} placeholder="e.g. an email from boss@company.com" maxLength={160} />
        </>
      )}
    </>
  );
}
