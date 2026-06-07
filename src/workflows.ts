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

export interface Workflow {
  id: string;
  title: string;
  instruction: string;
  trigger_type: 'schedule' | 'event' | string;
  schedule: Schedule | null;
  event: EventCfg | null;
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

const SEL = 'id,title,instruction,trigger_type,schedule,event,enabled,next_run_at,last_run_at,created_at';

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

export async function createWorkflow(title: string, instruction: string, trigger: Trigger): Promise<Workflow | null> {
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
  fields: { title?: string; instruction?: string; enabled?: boolean; trigger?: Trigger },
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.instruction !== undefined) patch.instruction = fields.instruction;
    if (fields.enabled !== undefined) patch.enabled = fields.enabled;
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
