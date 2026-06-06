import { Capacitor, registerPlugin } from '@capacitor/core';

// Face ID / Touch ID via the native "BiometricAuth" plugin, referenced BY NAME at
// runtime — so this builds with no npm dependency and simply no-ops until a native
// build actually bundles the plugin (see NATIVE_SETUP.md). Install in that build:
//   npm i @aparajita/capacitor-biometric-auth && npx cap sync ios
interface BiometricPlugin {
  checkBiometry(): Promise<{ isAvailable: boolean }>;
  authenticate(opts?: {
    reason?: string;
    iosFallbackTitle?: string;
    allowDeviceCredential?: boolean;
  }): Promise<void>;
}
const BiometricAuth = registerPlugin<BiometricPlugin>('BiometricAuth');

// Can this device actually do biometrics right now? FAIL-SAFE: any error — plugin
// not in this binary, no hardware, web — returns false, so the lock is simply
// never engaged (we never trap the user behind a lock we can't satisfy).
export async function biometryAvailable(): Promise<boolean> {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
    return !!(await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
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
