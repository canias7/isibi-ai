import { supabase } from './supabase';
import { LocalNotifications } from '@capacitor/local-notifications';

// User reminders: a title + a time, optionally repeating. Stored per-user in
// Supabase (RLS-scoped, like Memory) so the list shows on every device, and
// scheduled as on-device local notifications so the phone alerts at the time —
// even with the app closed. Manual only here; the assistant could set them too
// later via the same table.
export type RepeatKind = 'none' | 'daily' | 'weekly';
export interface Reminder {
  id: string;
  title: string;
  remind_at: string; // ISO timestamp
  repeat: RepeatKind;
  enabled: boolean;
  created_at: string;
}

const SEL = 'id,title,remind_at,repeat,enabled,created_at';

export async function listReminders(): Promise<Reminder[]> {
  try {
    const { data, error } = await supabase
      .from('user_reminders')
      .select(SEL)
      .order('remind_at', { ascending: true });
    if (error || !data) return [];
    return data as Reminder[];
  } catch {
    return [];
  }
}

export async function addReminder(title: string, remind_at: string, repeat: RepeatKind): Promise<Reminder | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from('user_reminders')
      .insert({ user_id: uid, title, remind_at, repeat })
      .select(SEL)
      .single();
    if (error || !data) return null;
    return data as Reminder;
  } catch {
    return null;
  }
}

export async function updateReminder(
  id: string,
  fields: Partial<Pick<Reminder, 'title' | 'remind_at' | 'repeat' | 'enabled'>>,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_reminders')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteReminder(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('user_reminders').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ---- On-device scheduling (local notifications) ----

// LocalNotifications needs integer ids; derive a stable positive one from the
// reminder's uuid so schedule/cancel always target the same slot.
function notifId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

// Ask for notification permission in context (first time the user saves one).
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    return p.display === 'granted';
  } catch {
    return false;
  }
}

function every(repeat: RepeatKind): 'day' | 'week' | undefined {
  return repeat === 'daily' ? 'day' : repeat === 'weekly' ? 'week' : undefined;
}

export async function scheduleReminder(r: Reminder): Promise<void> {
  try {
    const at = new Date(r.remind_at);
    // A one-off whose time has already passed can never fire — skip it.
    if (r.repeat === 'none' && at.getTime() <= Date.now()) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: notifId(r.id),
        title: 'Reminder',
        body: r.title,
        schedule: { at, every: every(r.repeat), allowWhileIdle: true },
        extra: { reminderId: r.id },
      }],
    });
  } catch {
    /* native only — no-op on web */
  }
}

export async function cancelReminder(id: string): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: notifId(id) }] });
  } catch {
    /* no-op */
  }
}

// Make the device's scheduled notifications match the table: cancel each then
// re-schedule the enabled ones. Idempotent (stable ids), so safe to run on
// launch to re-arm after edits on another device or an OS purge.
export async function syncReminders(list: Reminder[]): Promise<void> {
  for (const r of list) {
    await cancelReminder(r.id);
    if (r.enabled) await scheduleReminder(r);
  }
}
