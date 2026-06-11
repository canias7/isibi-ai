import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// The app's haptic vocabulary (see the motion system):
//   tap (light)  — toggles, chips, send
//   bump (medium) — menus opening, a workflow run starting
//   thud (heavy)  — destructive confirms, errors
//   chime (success) — a run finishing, a call connecting
// All of these no-op on web, and on any native build that doesn't yet bundle
// @capacitor/haptics — so they're safe to ship via OTA today and "light up"
// the next time the app is built natively (npx cap sync + Xcode).
export async function tap(style: ImpactStyle = ImpactStyle.Light): Promise<void> {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await Haptics.impact({ style });
  } catch {
    /* plugin not in this native binary yet — silently no-op */
  }
}

export const bump = (): Promise<void> => tap(ImpactStyle.Medium);
export const thud = (): Promise<void> => tap(ImpactStyle.Heavy);

export async function chime(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* plugin not in this native binary yet — silently no-op */
  }
}
