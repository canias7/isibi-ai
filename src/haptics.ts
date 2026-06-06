import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// A light haptic tap (e.g. on send). No-ops on web, and on any native build that
// doesn't yet bundle @capacitor/haptics — so it's safe to ship via OTA today and
// "lights up" the next time the app is built natively (npx cap sync + Xcode).
export async function tap(style: ImpactStyle = ImpactStyle.Light): Promise<void> {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await Haptics.impact({ style });
  } catch {
    /* plugin not in this native binary yet — silently no-op */
  }
}
