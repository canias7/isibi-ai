import { supabase } from './supabase';

// Workflows = saved automations. v1 supports scheduled triggers; the runner
// (run-workflows Edge Function) executes them and pushes the result.
export interface Schedule {
  freq: 'daily' | 'weekly' | 'hourly';
  hour: number;          // 0-23 (local)
  minute: number;        // 0-59
  weekday?: number;      // 0=Sun .. 6=Sat (weekly only)
  tz: string;            // IANA timezone
}
export interface Workflow {
  id: string;
  title: string;
  instruction: string;
  trigger_type: string;
  schedule: Schedule | null;
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

export async function listWorkflows(): Promise<Workflow[]> {
  try {
    const { data, error } = await supabase
      .from('workflows')
      .select('id,title,instruction,trigger_type,schedule,enabled,next_run_at,last_run_at,created_at')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as Workflow[];
  } catch {
    return [];
  }
}

export async function createWorkflow(title: string, instruction: string, schedule: Schedule): Promise<Workflow | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from('workflows')
      .insert({ user_id: uid, title: title || instruction.slice(0, 40), instruction, trigger_type: 'schedule', schedule, enabled: true, next_run_at: null })
      .select('id,title,instruction,trigger_type,schedule,enabled,next_run_at,last_run_at,created_at')
      .single();
    if (error || !data) return null;
    return data as Workflow;
  } catch {
    return null;
  }
}

export async function updateWorkflow(id: string, fields: Partial<Pick<Workflow, 'title' | 'instruction' | 'schedule' | 'enabled'>>): Promise<boolean> {
  try {
    // Changing the schedule resets next_run_at so the runner reschedules it.
    const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    if ('schedule' in fields) patch.next_run_at = null;
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
