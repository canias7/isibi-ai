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
  let t = orig
    .replace(
      /^\s*(?:please\s+|hey,?\s+|can you\s+|could you\s+|just\s+)?(?:set (?:a |an )?reminder\s+(?:to|for|about|that)|remind me\s+(?:to|that|about)|reminder\s*[-:]|reminder\s+(?:to|that|about|for)|remember\s+(?:to|that)|don'?t forget\s+(?:to|about)|note to self\s*:?|i\s+(?:need|have|want|gotta)\s+to)\s+/i,
      '',
    )
    .trim();
  if (!t) return orig;
  // Only normalize case on text we actually transformed (a stripped lead-in
  // means dictation/assistant phrasing). A deliberately typed "HOA AGM" or
  // "CALL MOM" is the user's own casing — leave it exactly as written.
  const stripped = t !== orig;
  if (stripped && t === t.toUpperCase() && t !== t.toLowerCase()) t = t.toLowerCase();
  // Capitalize only an all-lowercase first word — never mangle "iPhone"/"eBay".
  const first = t.split(/\s+/)[0] ?? '';
  if (/^[a-z]/.test(t) && first === first.toLowerCase()) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// null = the FETCH failed (offline/server) — callers show a retry, never an
// empty state, and the re-arm paths skip rather than wiping armed notifications.
export async function listReminders(): Promise<Reminder[] | null> {
  try {
    const { data, error } = await supabase
      .from('user_reminders')
      .select(SEL)
      .order('remind_at', { ascending: true });
    if (error || !data) return null;
    return data as Reminder[];
  } catch {
    return null;
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
    // Clean an edited title the same way add does, so created and edited
    // reminders store consistently (not raw "remind me to …").
    const patch = fields.title !== undefined ? { ...fields, title: cleanReminderTitle(fields.title) } : fields;
    const { error } = await supabase
      .from('user_reminders')
      .update({ ...patch, updated_at: new Date().toISOString() })
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

// LocalNotifications needs integer ids. Derive a stable positive one from the
// reminder's uuid (so schedule/cancel always hit the same slot), kept in a band
// BELOW 1e9 so it can never collide with a snooze id (snoozes live high, see
// snoozeNudge) — a colliding snooze used to silently overwrite a reminder's slot.
function notifId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1_000_000_000) || 1;
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

// Capacitor Weekday is 1=Sunday..7=Saturday; JS getDay() is 0=Sunday..6.
function capWeekday(d: Date): number {
  return d.getDay() + 1;
}
// The next time a reminder will fire, in epoch ms — used to order which ones to
// arm under the iOS 64-pending cap. Fixed-step roll is fine for ORDERING (exact
// DST correctness is handled by the calendar schedule in scheduleReminder).
function nextFireMs(r: Reminder): number {
  const t = new Date(r.remind_at).getTime();
  if (Number.isNaN(t)) return Infinity;
  if (r.repeat === 'none') return t;
  const step = r.repeat === 'daily' ? 86_400_000 : 7 * 86_400_000;
  let n = t;
  const now = Date.now();
  while (n <= now) n += step;
  return n;
}
// iOS silently keeps only the 64 soonest-firing pending notifications and drops
// the rest. Arm the soonest, leaving headroom for snoozes + workflow pushes.
const MAX_ARMED = 60;

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
// Carries the reminder id so Snooze works AGAIN on the snoozed nudge itself.
export async function snoozeNudge(title: string, reminderId?: string): Promise<void> {
  try {
    const soundId = loadReminderSound();
    const channelId = await ensureReminderChannel(soundId);
    const body = cleanReminderTitle(title);
    await LocalNotifications.schedule({
      notifications: [{
        // High band [1.2e9, 2.1e9): disjoint from notifId's <1e9, so a snooze can
        // never numerically collide with (and overwrite) a real reminder's slot.
        id: 1_200_000_000 + (Date.now() % 900_000_000),
        title: 'Reminder',
        body,
        schedule: { at: new Date(Date.now() + 10 * 60 * 1000), allowWhileIdle: true },
        actionTypeId: 'gf-reminder',
        // Carry the title too, so a Snooze tapped on a COLD-started app can re-nudge
        // with the real task instead of falling back to the generic "Reminder".
        extra: { ...(reminderId ? { reminderId } : {}), title: body },
        channelId,
        ...(soundId === 'default' ? {} : { sound: `${soundId}.wav` }),
      }],
    });
  } catch { /* no-op */ }
}

// Cancel EVERY pending local notification — used on sign-out so a previous
// user's reminders can't keep firing (with their titles) on a shared device.
export async function cancelAllReminderNotifications(): Promise<void> {
  try {
    const p = await LocalNotifications.getPending();
    if (p.notifications.length) {
      await LocalNotifications.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) });
    }
  } catch { /* native only — no-op on web */ }
}

// Notification interactions: action buttons AND plain taps both land here.
// actionId is 'done' / 'snooze' for the buttons, 'tap' for a plain tap.
export async function onReminderAction(
  cb: (actionId: string, reminderId: string | null, title: string | null) => void,
): Promise<{ remove: () => void } | null> {
  try {
    const h = await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
      const extra = (ev.notification?.extra ?? {}) as Record<string, unknown>;
      const rid = typeof extra.reminderId === 'string' ? extra.reminderId : null;
      // The title rides in `extra` so Snooze works on a cold start, before the
      // reminders list has loaded from the server.
      const title = typeof extra.title === 'string' ? extra.title : null;
      cb(ev.actionId ?? 'tap', rid, title);
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
    if (Number.isNaN(at.getTime())) return; // a malformed remind_at must not arm an "Invalid Date" notification
    // Recurring reminders schedule by CALENDAR components (hour/minute, + weekday
    // for weekly), not a fixed-millisecond `every` from a rolled-forward instant.
    // The old way drifted an hour across DST and detached "every Monday" from its
    // weekday; the OS calendar trigger fires at the right wall-clock every time.
    let schedule: { at?: Date; on?: { weekday?: number; hour?: number; minute?: number }; allowWhileIdle: boolean };
    if (r.repeat === 'none') {
      if (at.getTime() <= Date.now()) return; // a passed one-off can never fire
      schedule = { at, allowWhileIdle: true };
    } else if (r.repeat === 'daily') {
      schedule = { on: { hour: at.getHours(), minute: at.getMinutes() }, allowWhileIdle: true };
    } else {
      schedule = { on: { weekday: capWeekday(at), hour: at.getHours(), minute: at.getMinutes() }, allowWhileIdle: true };
    }
    const soundId = loadReminderSound();
    const channelId = await ensureReminderChannel(soundId);
    const body = cleanReminderTitle(r.title); // defensive: legacy rows may store an un-stripped title
    await LocalNotifications.schedule({
      notifications: [{
        id: notifId(r.id),
        title: 'Reminder',
        body,
        schedule,
        actionTypeId: 'gf-reminder',
        extra: { reminderId: r.id, title: body }, // title for cold-start snooze
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

// Make the device's scheduled notifications match the table. Idempotent (stable
// ids), so safe to run on launch / resume to re-arm after edits elsewhere.
export async function syncReminders(list: Reminder[]): Promise<void> {
  // 1) Cancel ORPHANS — anything armed whose reminder was deleted or disabled on
  // another device. Keyed by extra.reminderId (not the list), so a deleted
  // reminder's slot is actually cancelled (the old loop only touched reminders
  // STILL in the list, so a deletion fired forever on a second device). Live
  // snoozes survive: their reminder is present and enabled.
  try {
    const pending = (await LocalNotifications.getPending()).notifications ?? [];
    const live = new Map(list.map((r) => [r.id, r]));
    const orphans = pending
      .filter((n) => {
        const rid = (n.extra as Record<string, unknown> | undefined)?.reminderId;
        return typeof rid === 'string' && !live.get(rid)?.enabled;
      })
      .map((n) => ({ id: n.id }));
    if (orphans.length) await LocalNotifications.cancel({ notifications: orphans });
  } catch { /* native only — no-op on web */ }

  // 2) Arm the enabled ones, soonest-firing first, capped under the iOS 64 limit
  // (past that, iOS drops the latest arbitrarily — better we keep the soonest).
  const armed = list.filter((r) => r.enabled).sort((a, b) => nextFireMs(a) - nextFireMs(b));
  if (armed.length > MAX_ARMED) console.warn(`[reminders] ${armed.length} enabled — arming the ${MAX_ARMED} soonest (OS pending cap)`);
  for (const r of armed.slice(0, MAX_ARMED)) {
    await cancelReminder(r.id);
    await scheduleReminder(r);
  }
}
