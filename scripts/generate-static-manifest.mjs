#!/usr/bin/env node
/**
 * Turn `expo export` output (./dist) into static, protocol-shaped Expo Updates
 * manifests — one per platform — that GitHub Pages can serve as plain files:
 *
 *   dist/updates/ios.json
 *   dist/updates/android.json
 *
 * These pair with plugins/withGithubUpdates.js, which points each native build
 * at the matching URL. The whole dist/ folder is published to GitHub Pages, so
 * bundle + asset URLs resolve under the same site.
 *
 * Override the public site with OTA_SITE_URL (CI sets it to the Pages URL).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const SITE = (process.env.OTA_SITE_URL || 'https://canias7.github.io/isibi-ai').replace(/\/+$/, '');

const metaPath = path.join(DIST, 'metadata.json');
if (!existsSync(metaPath)) {
  console.error('dist/metadata.json not found — run `expo export --output-dir dist` first.');
  process.exit(1);
}
const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));

const appJson = JSON.parse(readFileSync(path.resolve('app.json'), 'utf8'));
const runtimeVersion = process.env.OTA_RUNTIME_VERSION || appJson.expo?.version || '1.0.0';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf',
  woff: 'font/woff', woff2: 'font/woff2', json: 'application/json', xml: 'application/xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', hbc: 'application/javascript',
  js: 'application/javascript',
};
const contentType = (ext) => MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
const toUrl = (rel) => `${SITE}/${rel.split(path.sep).join('/').replace(/^\/+/, '')}`;
// Expo names exported assets/bundles by their content hash, so the basename is
// a stable, unique key the runtime can use for caching/dedup.
const keyOf = (rel) => path.basename(rel);

mkdirSync(path.join(DIST, 'updates'), { recursive: true });

const platforms = Object.keys(metadata.fileMetadata || {});
if (platforms.length === 0) {
  console.error('No platforms found in dist/metadata.json fileMetadata.');
  process.exit(1);
}

for (const platform of platforms) {
  const fm = metadata.fileMetadata[platform];
  const assets = (fm.assets || []).map((a) => ({
    key: keyOf(a.path),
    contentType: contentType(a.ext),
    url: toUrl(a.path),
  }));

  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion,
    launchAsset: {
      key: keyOf(fm.bundle),
      contentType: 'application/javascript',
      url: toUrl(fm.bundle),
    },
    assets,
    metadata: {},
    extra: {},
  };

  const out = path.join(DIST, 'updates', `${platform}.json`);
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), out)} (runtime ${runtimeVersion}, ${assets.length} assets)`);
}
