import { supabase } from './supabase';
import { LocalNotifications } from '@capacitor/local-notifications';
import { loadReminderSound, reminderSoundLabel } from './reminderSounds';

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

// Tidy a reminder title for display. People (and the assistant) phrase reminders
// as "remind me to brush my teeth" / "don't forget to call mom" — stored raw,
// that reads awkwardly under a "Reminder" heading. Strip the lead-in and
// capitalize so the notification + list show just the task ("Brush my teeth").
export function cleanReminderTitle(raw: string): string {
  const orig = (raw || '').trim();
  const t = orig
    .replace(
      /^\s*(?:please\s+|hey,?\s+|can you\s+|could you\s+|just\s+)?(?:set (?:a |an )?reminder\s+(?:to|for|about|that)|remind me\s+(?:to|that|about)|reminder\s+(?:to|that|about)|remember\s+(?:to|that)|don'?t forget\s+(?:to|about)|note to self\s*:?|i\s+(?:need|have|want|gotta)\s+to)\s+/i,
      '',
    )
    .trim();
  if (!t) return orig;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
      .insert({ user_id: uid, title: cleanReminderTitle(title), remind_at, repeat })
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

// Lock-screen actions on a reminder nudge: Done / Snooze 10 min. Registered at
// app start (the plugin needs the category before a notification using it fires).
export async function registerReminderActions(): Promise<void> {
  try {
    await LocalNotifications.registerActionTypes({
      types: [{
        id: 'gf-reminder',
        actions: [
          { id: 'done', title: 'Done' },
          { id: 'snooze', title: 'Snooze 10 min' },
        ],
      }],
    });
  } catch { /* web / plugin missing — no-op */ }
}

// One-off re-nudge in 10 minutes (Snooze) — purely local, no DB change.
export async function snoozeNudge(title: string): Promise<void> {
  try {
    const soundId = loadReminderSound();
    const channelId = await ensureReminderChannel(soundId);
    await LocalNotifications.schedule({
      notifications: [{
        id: (Date.now() % 2147483000) + 1,
        title: 'Reminder',
        body: cleanReminderTitle(title),
        schedule: { at: new Date(Date.now() + 10 * 60 * 1000), allowWhileIdle: true },
        actionTypeId: 'gf-reminder',
        channelId,
        ...(soundId === 'default' ? {} : { sound: `${soundId}.wav` }),
      }],
    });
  } catch { /* no-op */ }
}

// Notification interactions: action buttons AND plain taps both land here.
// actionId is 'done' / 'snooze' for the buttons, 'tap' for a plain tap.
export async function onReminderAction(
  cb: (actionId: string, reminderId: string | null) => void,
): Promise<{ remove: () => void } | null> {
  try {
    const h = await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
      const extra = (ev.notification?.extra ?? {}) as Record<string, unknown>;
      const rid = typeof extra.reminderId === 'string' ? extra.reminderId : null;
      cb(ev.actionId ?? 'tap', rid);
    });
    return h;
  } catch {
    return null;
  }
}

// The user's chosen reminder sound (Settings). Android 8+ plays the CHANNEL's
// sound, and a channel's sound is fixed once it exists — so we use one channel
// per sound (the id encodes it) and schedule on it. Most people pick one sound,
// so it's one channel. importance MAX so a reminder actually rings + peeks. iOS
// ignores the channel and uses the notification's own `sound`. The `<id>.wav`
// file is bundled (iOS app bundle / Android res/raw); 'default' = system sound.
async function ensureReminderChannel(soundId: string): Promise<string> {
  const channelId = `gf_${soundId}`;
  try {
    await LocalNotifications.createChannel({
      id: channelId,
      name: soundId === 'default' ? 'Reminders' : `Reminders · ${reminderSoundLabel(soundId)}`,
      description: 'Reminder alerts you set',
      importance: 5,
      visibility: 1,
      ...(soundId === 'default' ? {} : { sound: `${soundId}.wav` }),
    });
  } catch { /* web / older Android without channels */ }
  return channelId;
}

export async function scheduleReminder(r: Reminder): Promise<void> {
  try {
    const at = new Date(r.remind_at);
    // A one-off whose time has already passed can never fire — skip it. A
    // repeating one rolls forward to its next occurrence, so re-arming (e.g. on
    // launch) never triggers an immediate spurious notification.
    if (r.repeat === 'none') {
      if (at.getTime() <= Date.now()) return;
    } else {
      const step = r.repeat === 'daily' ? 86_400_000 : 7 * 86_400_000;
      while (at.getTime() <= Date.now()) at.setTime(at.getTime() + step);
    }
    const soundId = loadReminderSound();
    const channelId = await ensureReminderChannel(soundId);
    await LocalNotifications.schedule({
      notifications: [{
        id: notifId(r.id),
        title: 'Reminder',
        body: cleanReminderTitle(r.title),
        schedule: { at, every: every(r.repeat), allowWhileIdle: true },
        actionTypeId: 'gf-reminder',
        extra: { reminderId: r.id },
        channelId, // Android 8+ sound
        ...(soundId === 'default' ? {} : { sound: `${soundId}.wav` }), // iOS + Android 7
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
