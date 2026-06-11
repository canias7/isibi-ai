import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { supabase } from './supabase';

// PushNotifications plugin referenced BY NAME (no npm dep, build stays clean).
// No-ops on web and on any native build that doesn't yet bundle the plugin +
// APNs entitlement — so it's safe to ship now and activates after a native build.
interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: 'registration', cb: (t: { value: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'registrationError', cb: (e: unknown) => void): Promise<PluginListenerHandle>;
  addListener(event: 'pushNotificationActionPerformed', cb: (ev: { notification: { data?: Record<string, unknown> } }) => void): Promise<PluginListenerHandle>;
}
const Push = registerPlugin<PushPlugin>('PushNotifications');

let wired = false;
let lastStatus = ''; // last registration outcome — surfaced in Settings to diagnose a missing token
export function pushStatus(): string { return lastStatus; }

// Save the APNs token to device_tokens. Captures *why* it didn't stick (no
// session, RLS/constraint error, …) instead of swallowing it.
async function uploadToken(value: string) {
  try {
    if (!value) { lastStatus = 'registration fired but the token was empty'; return; }
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) { lastStatus = 'got a token but no signed-in session'; return; }
    const { error } = await supabase.from('device_tokens').upsert(
      { token: value, user_id: uid, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
    lastStatus = error ? `save failed: ${error.message}` : `registered ✓ (${value.slice(0, 8)}…)`;
  } catch (e) {
    lastStatus = `save threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Request permission, register for APNs, and upload the token to device_tokens.
// Returns true if registration was kicked off (permission granted). Safe to call
// repeatedly. The token itself arrives asynchronously via the 'registration'
// listener; 'registrationError' tells us if APNs refused (entitlement, etc.).
export async function registerPush(): Promise<boolean> {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
    if (!wired) {
      wired = true;
      await Push.addListener('registration', (t) => { void uploadToken(t?.value || ''); });
      await Push.addListener('registrationError', (e) => {
        const msg = e && typeof e === 'object' && 'error' in e ? String((e as { error: unknown }).error) : JSON.stringify(e);
        lastStatus = `APNs registration failed: ${msg}`;
      });
    }
    let perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') { lastStatus = `permission not granted (${perm.receive})`; return false; }
    await Push.register();
    if (!lastStatus || lastStatus.startsWith('permission')) lastStatus = 'registering… waiting for APNs';
    return true;
  } catch (e) {
    lastStatus = `plugin error: ${e instanceof Error ? e.message : String(e)}`;
    return false; // plugin not in this native build yet — no-op
  }
}

// A push was TAPPED (app opened from the notification) — hand its custom data
// (e.g. { convId }) to the app so it can route into the right conversation.
// No-ops on web / builds without the plugin.
export async function onPushTap(
  cb: (data: Record<string, unknown>) => void,
): Promise<{ remove: () => void } | null> {
  if (Capacitor.getPlatform() === 'web') return null;
  try {
    return await Push.addListener('pushNotificationActionPerformed', (ev) => {
      cb(ev?.notification?.data ?? {});
    });
  } catch {
    return null; // plugin not in this native build yet
  }
}
