import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Capacitor } from '@capacitor/core';

// The CI "Web OTA bundle" workflow publishes the latest web build + this
// manifest to the `web-latest` GitHub Release on every push.
const MANIFEST_URL =
  'https://github.com/canias7/isibi-ai/releases/download/web-latest/manifest.json';

interface Manifest {
  version?: string;
  url?: string;
}

/**
 * Check for an over-the-air web update on launch (native only). UI/web changes
 * ship this way without a new App Store / TestFlight build.
 */
export async function initOta(): Promise<void> {
  // No OTA in the browser dev build — only inside the native app.
  if (Capacitor.getPlatform() === 'web') return;

  try {
    // Mark the running bundle as good so the updater never auto-rolls-back.
    await CapacitorUpdater.notifyAppReady();

    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = (await res.json()) as Manifest;
    if (!manifest.version || !manifest.url) return;

    const current = await CapacitorUpdater.current();
    if (current.bundle.version === manifest.version) return; // already current

    const bundle = await CapacitorUpdater.download({
      url: manifest.url,
      version: manifest.version,
    });
    // Apply on next app start so we don't reload mid-session.
    await CapacitorUpdater.next(bundle);
  } catch (err) {
    // Offline or bad manifest: just keep running the current bundle.
    console.warn('[OTA] update check skipped:', err);
  }
}
