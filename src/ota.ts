import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Capacitor } from '@capacitor/core';

// Version baked into this bundle at build time (commit timestamp). Compared
// against the manifest so we only ever apply a *newer* bundle.
declare const __APP_VERSION__: string;

// The CI "Web OTA bundle" workflow publishes the latest web build + a manifest.
// Supabase Storage is the primary host (direct URLs, reliable); the GitHub
// Release is a fallback (and what older builds used). We try them in order.
const MANIFEST_URLS = [
  'https://lkpfeqrelvziltfwpuxi.supabase.co/storage/v1/object/public/ota/manifest.json',
  'https://github.com/canias7/isibi-ai/releases/download/web-latest/manifest.json',
];

interface Manifest {
  version?: string;
  url?: string;
}

async function fetchManifest(): Promise<Manifest | null> {
  for (const url of MANIFEST_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const m = (await res.json()) as Manifest;
      if (m.version && m.url) return m;
    } catch {
      /* try the next source */
    }
  }
  return null;
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

    const manifest = await fetchManifest();
    if (!manifest || !manifest.version || !manifest.url) return;

    // Only move forward: skip if the published bundle isn't newer than the one
    // running (which includes the version baked into this native build). This
    // prevents both redundant re-downloads and accidental downgrades.
    const running = Number(__APP_VERSION__) || 0;
    const available = Number(manifest.version) || 0;
    if (available <= running) return;

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
