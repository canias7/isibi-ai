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
}
const Push = registerPlugin<PushPlugin>('PushNotifications');

let wired = false;

// Request permission, register for APNs, and upload the token to device_tokens.
// Returns true if registration was kicked off. Safe to call repeatedly.
export async function registerPush(): Promise<boolean> {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
    if (!wired) {
      wired = true;
      await Push.addListener('registration', async (t) => {
        try {
          const { data } = await supabase.auth.getSession();
          const uid = data.session?.user.id;
          if (uid && t?.value) {
            await supabase.from('device_tokens').upsert(
              { token: t.value, user_id: uid, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
              { onConflict: 'token' },
            );
          }
        } catch { /* ignore */ }
      });
    }
    let perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') return false;
    await Push.register();
    return true;
  } catch {
    return false; // plugin not in this native build yet — no-op
  }
}
