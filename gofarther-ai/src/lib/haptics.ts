/** Haptic feedback helpers */
import * as Haptics from 'expo-haptics';

export function tapHaptic() {
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
}

export function successHaptic() {
  try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
}

export function errorHaptic() {
  try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
}

export function selectionHaptic() {
  try { Haptics.selectionAsync(); } catch {}
}
