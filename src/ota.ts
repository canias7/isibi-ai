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
  // OPTIONAL hard floor: if the running bundle's version is below `min`, the app
  // must update before it can be used (e.g. a breaking backend contract change).
  // Absent/0 = no floor. The publisher sets this only for breaking releases.
  min?: string;
}

// React can't import OTA logic cleanly (it runs before mount), so a forced update
// is announced via a window event the app listens for. 'clear' takes the gate
// back down (a forced download failed — keep running rather than brick).
export type ForceUpdateMode = 'updating' | 'appstore' | 'clear';
export const FORCE_UPDATE_EVENT = 'gf-force-update';
function announceForce(mode: ForceUpdateMode) {
  try { window.dispatchEvent(new CustomEvent(FORCE_UPDATE_EVENT, { detail: { mode } })); } catch { /* no window */ }
}

// Query BOTH hosts and take the newest version. First-valid-wins would let a
// stale-but-healthy primary (e.g. its upload failed while the fallback's
// succeeded) pin the whole fleet to an old bundle with no error anywhere.
async function fetchManifest(): Promise<Manifest | null> {
  const results = await Promise.allSettled(MANIFEST_URLS.map(async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as Manifest;
  }));
  let best: Manifest | null = null;
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.version || !r.value?.url) continue;
    if (!best || Number(r.value.version) > Number(best.version)) best = r.value;
  }
  return best;
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

    const running = Number(__APP_VERSION__) || 0;
    const available = Number(manifest.version) || 0;
    const min = Number(manifest.min) || 0;

    // Forced update: the running bundle is below the hard floor.
    if (running < min) {
      if (available >= min) {
        // A published OTA bundle CAN satisfy the floor — apply it now and reload,
        // behind a blocking screen, instead of waiting for a manual relaunch.
        // The screen MUST come down if the download/set fails (dead URL, network
        // drop): an old bundle is recoverable, an eternal blocking spinner isn't.
        announceForce('updating');
        try {
          const bundle = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version });
          await CapacitorUpdater.set(bundle); // activates + reloads into the new bundle
        } catch (e) {
          console.warn('[OTA] forced update failed — keeping the running bundle:', e);
          announceForce('clear');
        }
      } else {
        // Even the latest OTA bundle is below the floor → only an App Store
        // (native) update can fix it. Block with a "please update" screen.
        announceForce('appstore');
      }
      return;
    }

    // Only move forward: skip if the published bundle isn't newer than the one
    // running. Prevents redundant re-downloads and accidental downgrades.
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
