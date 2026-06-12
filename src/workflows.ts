import { supabase } from './supabase';
import { byId } from './connectorData';

// Workflows = saved automations. v1 supports scheduled triggers; the runner
// (run-workflows Edge Function) executes them and pushes the result.
export interface Schedule {
  freq: 'daily' | 'weekly' | 'hourly';
  hour: number;          // 0-23 (local)
  minute: number;        // 0-59
  weekday?: number;      // 0=Sun .. 6=Sat (weekly only)
  tz: string;            // IANA timezone
}
// Optional active window for an event trigger. When set, the runner only polls
// the app during these local hours/days — outside the window it's asleep (no
// cost). Anything that arrived since the last check is caught at the next one.
export interface EventWindow {
  start: number;      // minutes from local midnight, 0-1439 (e.g. 540 = 9:00 AM)
  end: number;        // minutes from local midnight, 0-1439 (e.g. 1020 = 5:00 PM)
  days: number[];     // 0=Sun..6=Sat; which days the window is active. empty = every day
  tz: string;         // IANA timezone (user local)
}
// Event trigger: a new item appears in a connected app matching a condition.
export interface EventCfg {
  app: string;        // frontend connector id (e.g. 'gmail', 'slack', 'gcal')
  filter?: string;    // natural-language condition, e.g. "from boss@co.com" / "in #general"
  window?: EventWindow | null; // active hours; absent/null = watches all day, every day
  tz?: string;        // user's IANA timezone — the runner uses it for time context (older rows lack it)
}
export type Trigger =
  | { type: 'schedule'; schedule: Schedule }
  | { type: 'event'; event: EventCfg };

// Visual graph (from build-workflow): the trigger + steps the user sees, drags,
// and edits. This is display/editing state only — the runner executes the
// compiled `instruction`, so the graph never has to be "executable" itself.
export interface WfNode {
  id: string;
  kind: 'trigger' | 'action' | 'decision';
  app: string;        // connector id, or 'schedule' / 'event' / 'ai' / 'decision'
  label: string;
  detail?: string;
  x: number;          // canvas position (draggable; persisted in the graph)
  y: number;
}
export interface WfEdge { from: string; to: string; branch?: 'yes' | 'no' | null }
export interface WfGraph { nodes: WfNode[]; edges: WfEdge[] }
// What the AI builder returns for a described workflow (before it's saved).
export interface WorkflowDraft { title: string; instruction: string; trigger: Trigger; graph: WfGraph }

export interface Workflow {
  id: string;
  title: string;
  instruction: string;
  trigger_type: 'schedule' | 'event' | string;
  schedule: Schedule | null;
  event: EventCfg | null;
  graph: WfGraph | null;
  enabled: boolean;
  model: string | null; // chosen tier: 'haiku' | 'sonnet' | 'opus'; null = default (Sonnet)
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}
export interface WorkflowRun {
  id: string;
  result: string | null;
  ok: boolean;
  created_at: string;
}
// Per-node outcome from a Test run (so the canvas can badge each node).
export interface StepResult { id: string; ok: boolean; output: string }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
export function scheduleLabel(s: Schedule | null): string {
  if (!s) return '';
  const h12 = (s.hour % 12) || 12;
  const t = `${h12}:${String(s.minute).padStart(2, '0')} ${s.hour < 12 ? 'AM' : 'PM'}`;
  if (s.freq === 'hourly') return 'Hourly';
  if (s.freq === 'weekly') return `${DOW[s.weekday ?? 0]} · ${t}`;
  return `Daily · ${t}`;
}
// "9:00 AM" from minutes-since-midnight.
function minLabel(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const h12 = (h % 12) || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
// Short summary of an event's active window, e.g. "9:00 AM–5:00 PM" or
// "Mon–Fri 9:00 AM–5:00 PM". Empty string when it watches all day.
export function windowLabel(win?: EventWindow | null): string {
  if (!win || typeof win.start !== 'number' || typeof win.end !== 'number') return '';
  const time = `${minLabel(win.start)}–${minLabel(win.end)}`;
  const days = Array.isArray(win.days) ? win.days : [];
  if (!days.length || days.length === 7) return time;
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  const dayStr = contiguous && sorted.length > 1
    ? `${DOW[sorted[0]]}–${DOW[sorted[sorted.length - 1]]}`
    : sorted.map((d) => DOW[d]).join(', ');
  return `${dayStr} ${time}`;
}
// One-line trigger description for the list card.
export function triggerLabel(w: Workflow): string {
  if (w.trigger_type === 'event') {
    const app = byId(w.event?.app ?? '')?.name ?? 'an app';
    const f = w.event?.filter?.trim();
    const win = windowLabel(w.event?.window);
    const base = f ? `${app}: ${f}` : `New in ${app}`;
    return win ? `${base} · ${win}` : base;
  }
  return scheduleLabel(w.schedule);
}

// Run a workflow right now (the "Test" button). Executes the compiled
// instruction as the current user through their connectors; returns ok + result.
export async function testWorkflow(
  instruction: string,
  workflowId?: string,
  steps?: { id: string; label: string; app?: string }[],
  model?: string | null,
): Promise<{ ok: boolean; result: string; steps: StepResult[] } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('test-workflow', {
      body: { instruction, workflow_id: workflowId, tz: deviceTz(), steps: steps ?? [], ...(model ? { model } : {}) },
    });
    if (error || !data) return null;
    const d = data as { ok?: boolean; result?: string; error?: string; steps?: StepResult[] };
    const stepsOut = Array.isArray(d.steps)
      ? d.steps.map((s) => ({ id: String(s.id), ok: !!s.ok, output: String(s.output ?? '') }))
      : [];
    if (d.error && d.ok === undefined) return { ok: false, result: d.error, steps: stepsOut };
    return { ok: !!d.ok, result: String(d.result ?? ''), steps: stepsOut };
  } catch {
    return null;
  }
}

// Human label for a node's app field (real apps -> brand name; special kinds).
export function appLabel(app: string): string {
  if (app === 'ai') return 'AI';
  if (app === 'decision') return 'Decision';
  if (app === 'schedule') return 'Schedule';
  if (app === 'event') return 'Trigger';
  if (!app || app === 'none') return 'Manual';
  return byId(app)?.name ?? app;
}

// Compile the runnable instruction FROM the (possibly edited) graph, so what the
// user sees on the canvas and what actually executes never drift apart. Steps are
// emitted in flow order (BFS from the trigger); the runner executes each with the
// named app. Called on every save.
// Nodes in flow order (BFS from the trigger). Shared by compileInstruction and
// the Test button so the step numbering and the per-node results line up.
export function orderedNodes(graph: WfGraph): WfNode[] {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0] as [string, number]));
  const nextOf = new Map<string, string[]>(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    if (byNode.has(e.from) && byNode.has(e.to)) {
      nextOf.get(e.from)!.push(e.to);
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    }
  }
  const order: WfNode[] = [];
  const seen = new Set<string>();
  const q = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  if (!q.length && nodes.length) q.push(nodes[0].id);
  for (let h = 0; h < q.length; h++) {
    const id = q[h];
    if (seen.has(id)) continue;
    seen.add(id);
    const nn = byNode.get(id);
    if (nn) order.push(nn);
    for (const c of nextOf.get(id) || []) if (!seen.has(c)) q.push(c);
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n); // orphans last
  return order;
}

export function compileInstruction(title: string, graph: WfGraph): string {
  const steps = orderedNodes(graph)
    .filter((n) => n.kind !== 'trigger')
    .map((n, i) => `${i + 1}. [${appLabel(n.app)}] ${n.label}${n.detail ? ` — ${n.detail}` : ''}`);
  const head = title ? `${title}.` : 'Run this workflow.';
  if (!steps.length) return head;
  return `${head}\n\nCarry out these steps in order, using the named app for each:\n${steps.join('\n')}`;
}

const SEL = 'id,title,instruction,trigger_type,schedule,event,graph,enabled,model,next_run_at,last_run_at,created_at';

// One turn in the build conversation. assistant turns are the clarifying
// questions the builder asked; user turns are the request and the answers.
export interface BuildMsg { role: 'user' | 'assistant'; text: string }
// A tappable choice for a clarifying question.
export interface AskOption { label: string; description?: string }
// A clarifying question; multiple-choice when it has options (the UI also adds
// an "Other" choice). `header` is a short category label (e.g. "Account").
export interface AskQuestion { text: string; header?: string; options?: AskOption[] }
// The builder either needs more info (questions), has a finished draft, or is
// blocked (can't build a runnable workflow — e.g. a needed app isn't connected).
export type BuildResult =
  | { kind: 'questions'; questions: AskQuestion[] }
  | { kind: 'blocked'; message: string }
  | { kind: 'draft'; draft: WorkflowDraft };

// Ask the AI builder (Opus) to turn the conversation into a draft workflow. If
// it isn't sure (ambiguous request, missing recipient/account/scope, an app the
// user hasn't connected…) it asks 1-3 short questions first instead of guessing,
// the way a careful assistant would. Pass the running conversation each time;
// returns either the questions to show or the finished draft.
export async function buildWorkflow(messages: BuildMsg[]): Promise<BuildResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('build-workflow', {
      body: { messages: messages.map((m) => ({ role: m.role, text: m.text })), tz: deviceTz() },
    });
    if (error || !data) return null;
    const d = data as Record<string, unknown> & { error?: string };
    if (d.error) return null;
    // Terminal "can't build" message (e.g. a needed app isn't connected) — shown
    // as a final note, not another answerable question, so the flow can't loop.
    const blk = d.blocked as { message?: unknown } | undefined;
    if (blk && typeof blk === 'object') {
      const message = String(blk.message ?? '').trim();
      if (message) return { kind: 'blocked', message };
    }
    if (Array.isArray(d.questions)) {
      const qs: AskQuestion[] = (d.questions as unknown[])
        .map((q) => {
          const o = q as { text?: unknown; question?: unknown; header?: unknown; options?: unknown } | string;
          const text = String((typeof o === 'object' && o ? (o.text ?? o.question) : o) ?? '').trim();
          const header = typeof o === 'object' && o ? String(o.header ?? '').trim() : '';
          const options: AskOption[] = typeof o === 'object' && o && Array.isArray(o.options)
            ? o.options
                .map((x): AskOption | null => {
                  if (x && typeof x === 'object') {
                    const opt = x as { label?: unknown; value?: unknown; description?: unknown };
                    const label = String(opt.label ?? opt.value ?? '').trim();
                    const description = String(opt.description ?? '').trim();
                    return label ? (description ? { label, description } : { label }) : null;
                  }
                  const label = String(x ?? '').trim();
                  return label ? { label } : null;
                })
                .filter((x): x is AskOption => !!x)
            : [];
          const out: AskQuestion = { text };
          if (header) out.header = header;
          if (options.length) out.options = options;
          return out;
        })
        .filter((q) => q.text)
        .slice(0, 3);
      if (qs.length) return { kind: 'questions', questions: qs };
    }
    const graph = d.graph as WfGraph | undefined;
    if (!graph || !Array.isArray(graph.nodes)) return null;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
    // Don't trust the builder's trigger shape blindly: a malformed one crashes
    // the trigger editor and makes every auto-save silently fail. Fall back to
    // a sane daily schedule instead.
    const t = d.trigger as Trigger | undefined;
    const trigger: Trigger =
      t?.type === 'event' && t.event && typeof t.event.app === 'string'
        ? { type: 'event', event: { ...t.event, tz: t.event.tz || deviceTz() } }
        : t?.type === 'schedule' && t.schedule && typeof t.schedule.hour === 'number'
          ? t
          : { type: 'schedule', schedule: { freq: 'daily', hour: 8, minute: 0, weekday: 1, tz: deviceTz() } };
    return {
      kind: 'draft',
      draft: {
        title: String(d.title || ''),
        instruction: String(d.instruction || lastUser),
        trigger,
        graph: { nodes: graph.nodes, edges: Array.isArray(graph.edges) ? graph.edges : [] },
      },
    };
  } catch {
    return null;
  }
}

export async function listWorkflows(): Promise<Workflow[]> {
  try {
    const { data, error } = await supabase
      .from('workflows')
      .select(SEL)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as Workflow[];
  } catch {
    return [];
  }
}

export async function createWorkflow(title: string, instruction: string, trigger: Trigger, graph?: WfGraph | null, enabled = false, model?: string | null): Promise<Workflow | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const row = {
      user_id: uid,
      title: title || instruction.slice(0, 40),
      instruction,
      enabled,
      model: model ?? null,
      trigger_type: trigger.type,
      schedule: trigger.type === 'schedule' ? trigger.schedule : null,
      event: trigger.type === 'event' ? trigger.event : null,
      graph: graph ?? null,
      next_run_at: null,   // runner initializes the first scheduled run
      cursor: null,        // runner records the event baseline on first check
    };
    const { data, error } = await supabase.from('workflows').insert(row).select(SEL).single();
    if (error || !data) return null;
    return data as Workflow;
  } catch {
    return null;
  }
}

export async function updateWorkflow(
  id: string,
  fields: { title?: string; instruction?: string; enabled?: boolean; trigger?: Trigger; graph?: WfGraph | null; model?: string | null },
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.instruction !== undefined) patch.instruction = fields.instruction;
    if (fields.enabled !== undefined) patch.enabled = fields.enabled;
    if (fields.graph !== undefined) patch.graph = fields.graph;
    if (fields.model !== undefined) patch.model = fields.model;
    if (fields.trigger) {
      patch.trigger_type = fields.trigger.type;
      if (fields.trigger.type === 'schedule') {
        patch.schedule = fields.trigger.schedule;
        patch.event = null;
        patch.next_run_at = null; // reschedule from scratch
      } else {
        patch.event = fields.trigger.event;
        patch.schedule = null;
        // Only re-baseline (drop the dedup cursor) when WHAT counts as a match
        // changes — the app or filter. A pure active-hours/window edit must NOT
        // reset the baseline, or editing hours would drop or replay notifications.
        try {
          const { data: cur } = await supabase.from('workflows').select('trigger_type,event').eq('id', id).single();
          const prev = (cur && cur.trigger_type === 'event' ? (cur.event as EventCfg | null) : null);
          const matchChanged = !prev
            || (prev.app ?? '') !== (fields.trigger.event.app ?? '')
            || (prev.filter ?? '') !== (fields.trigger.event.filter ?? '');
          if (matchChanged) patch.cursor = null;
        } catch {
          patch.cursor = null; // couldn't compare — safest is to re-baseline
        }
      }
    }
    const { error } = await supabase.from('workflows').update(patch).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('workflows').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function listRuns(workflowId: string): Promise<WorkflowRun[]> {
  try {
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('id,result,ok,created_at')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data as WorkflowRun[];
  } catch {
    return [];
  }
}
