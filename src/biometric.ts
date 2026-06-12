import { Capacitor, registerPlugin } from '@capacitor/core';

// Face ID / Touch ID via the native "BiometricAuth" plugin, referenced BY NAME at
// runtime — so this builds with no npm dependency and simply no-ops until a native
// build actually bundles the plugin (see NATIVE_SETUP.md). Install in that build:
//   npm i @aparajita/capacitor-biometric-auth && npx cap sync ios
interface BiometricPlugin {
  checkBiometry(): Promise<{ isAvailable: boolean; code?: string; reason?: string }>;
  authenticate(opts?: {
    reason?: string;
    iosFallbackTitle?: string;
    allowDeviceCredential?: boolean;
  }): Promise<void>;
}
const BiometricAuth = registerPlugin<BiometricPlugin>('BiometricAuth');

// Three honest outcomes, so the UI can show the RIGHT thing instead of a toggle
// that errors:
//   'ready'       – biometrics are usable now → show a working toggle.
//   'unenrolled'  – hardware is there but Face ID/Touch ID isn't set up → tell
//                   the user to enroll it in iOS Settings.
//   'unavailable' – web, no hardware, OR the native plugin isn't in this build
//                   yet → hide the control (don't offer what we can't deliver).
export type BiometryStatus = 'ready' | 'unenrolled' | 'unavailable';
export async function biometryStatus(): Promise<BiometryStatus> {
  if (Capacitor.getPlatform() === 'web') return 'unavailable';
  try {
    const r = await BiometricAuth.checkBiometry();
    if (r.isAvailable) return 'ready';
    // Plugin present + hardware present, but the user hasn't enrolled a face/finger.
    if (String(r.code || '') === 'biometryNotEnrolled') return 'unenrolled';
    // Locked out (too many failed attempts) is NOT "unavailable": authenticate()
    // still works via the device-passcode fallback. Reporting it unavailable
    // made five failed Face ID tries simply DROP the lock (fail-open) — the one
    // case where the person holding the phone is exactly who it must stay
    // locked against.
    if (String(r.code || '') === 'biometryLockout') return 'ready';
    return 'unavailable';
  } catch {
    // Throw = the plugin isn't registered in this native binary → treat as N/A.
    return 'unavailable';
  }
}

// Can this device actually do biometrics right now? FAIL-SAFE: anything but a
// clean 'ready' returns false, so the lock is never engaged when we can't satisfy it.
export async function biometryAvailable(): Promise<boolean> {
  return (await biometryStatus()) === 'ready';
}

// Prompt to unlock. Resolves true only on a real success. On cancel/failure
// returns false (stay locked → user can retry); device-passcode fallback is
// offered so a broken sensor can't hard-lock anyone out.
export async function unlock(reason = 'Unlock Go Farther'): Promise<boolean> {
  if (Capacitor.getPlatform() === 'web') return true;
  try {
    await BiometricAuth.authenticate({ reason, iosFallbackTitle: 'Use passcode', allowDeviceCredential: true });
    return true;
  } catch {
    return false;
  }
}
