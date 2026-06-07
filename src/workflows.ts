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
// Event trigger: a new item appears in a connected app matching a condition.
export interface EventCfg {
  app: string;        // frontend connector id (e.g. 'gmail', 'slack', 'gcal')
  filter?: string;    // natural-language condition, e.g. "from boss@co.com" / "in #general"
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
// One-line trigger description for the list card.
export function triggerLabel(w: Workflow): string {
  if (w.trigger_type === 'event') {
    const app = byId(w.event?.app ?? '')?.name ?? 'an app';
    const f = w.event?.filter?.trim();
    return f ? `${app}: ${f}` : `New in ${app}`;
  }
  return scheduleLabel(w.schedule);
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
export function compileInstruction(title: string, graph: WfGraph): string {
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
  const steps = order
    .filter((n) => n.kind !== 'trigger')
    .map((n, i) => `${i + 1}. [${appLabel(n.app)}] ${n.label}${n.detail ? ` — ${n.detail}` : ''}`);
  const head = title ? `${title}.` : 'Run this workflow.';
  if (!steps.length) return head;
  return `${head}\n\nCarry out these steps in order, using the named app for each:\n${steps.join('\n')}`;
}

const SEL = 'id,title,instruction,trigger_type,schedule,event,graph,enabled,next_run_at,last_run_at,created_at';

// Ask the AI builder (Opus) to turn a natural-language description into a draft
// workflow: a title, a trigger, the visual graph, and the compiled instruction.
export async function buildWorkflow(description: string): Promise<WorkflowDraft | null> {
  try {
    const { data, error } = await supabase.functions.invoke('build-workflow', {
      body: { description: description.trim(), tz: deviceTz() },
    });
    if (error || !data) return null;
    const d = data as Record<string, unknown> & { error?: string };
    if (d.error) return null;
    const graph = d.graph as WfGraph | undefined;
    if (!graph || !Array.isArray(graph.nodes)) return null;
    return {
      title: String(d.title || ''),
      instruction: String(d.instruction || description),
      trigger: d.trigger as Trigger,
      graph: { nodes: graph.nodes, edges: Array.isArray(graph.edges) ? graph.edges : [] },
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

export async function createWorkflow(title: string, instruction: string, trigger: Trigger, graph?: WfGraph | null): Promise<Workflow | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const row = {
      user_id: uid,
      title: title || instruction.slice(0, 40),
      instruction,
      enabled: true,
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
  fields: { title?: string; instruction?: string; enabled?: boolean; trigger?: Trigger; graph?: WfGraph | null },
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.instruction !== undefined) patch.instruction = fields.instruction;
    if (fields.enabled !== undefined) patch.enabled = fields.enabled;
    if (fields.graph !== undefined) patch.graph = fields.graph;
    if (fields.trigger) {
      patch.trigger_type = fields.trigger.type;
      if (fields.trigger.type === 'schedule') {
        patch.schedule = fields.trigger.schedule;
        patch.event = null;
        patch.next_run_at = null; // reschedule from scratch
      } else {
        patch.event = fields.trigger.event;
        patch.schedule = null;
        patch.cursor = null;      // re-baseline so it won't fire on the backlog
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
