// Lazy loader for the big inline-SVG payload (brandSvgs.ts, ~900KB gzip). The
// dynamic import() makes it its own chunk, so it only downloads when a connector
// logo actually renders — not with the Connectors/Workflows screen JS. Cached
// after the first load, so every later logo resolves synchronously.
let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

export function loadBrandSvgs(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = import('./brandSvgs').then((m) => {
      cache = m.BRAND_SVGS;
      return cache;
    });
  }
  return inflight;
}

// Synchronous peek — non-null once the chunk has loaded once.
export function cachedBrandSvg(app: string): string | undefined {
  return cache ? cache[app] : undefined;
}
