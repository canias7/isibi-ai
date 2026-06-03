/**
 * withGithubUpdates — point expo-updates at our self-hosted manifests on
 * GitHub Pages instead of EAS Update (u.expo.dev).
 *
 * The Expo Updates client fetches the manifest from a single fixed URL and
 * distinguishes platforms only via the `Expo-Platform` request header — which
 * a static host (GitHub Pages) cannot branch on. So we give each platform its
 * own manifest file and write the per-platform URL into the native projects
 * during `expo prebuild`:
 *   iOS     -> ios/<app>/Supporting/Expo.plist   (EXUpdatesURL)
 *   Android -> AndroidManifest.xml               (expo.modules.updates.EXPO_UPDATE_URL)
 *
 * Override the base with the OTA_SITE_URL env var (CI sets this to the Pages
 * site). Keep it in sync with scripts/generate-static-manifest.mjs.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SITE = (process.env.OTA_SITE_URL || 'https://canias7.github.io/isibi-ai').replace(/\/+$/, '');
const urlFor = (platform) => `${SITE}/updates/${platform}.json`;

function findExpoPlist(iosRoot) {
  if (!fs.existsSync(iosRoot)) return null;
  for (const entry of fs.readdirSync(iosRoot)) {
    const candidate = path.join(iosRoot, entry, 'Supporting', 'Expo.plist');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function setPlistString(plist, key, value) {
  const keyRe = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (keyRe.test(plist)) {
    return plist.replace(keyRe, `$1${value}$2`);
  }
  // Key not present yet — insert before the closing </dict>.
  return plist.replace(
    /<\/dict>\s*<\/plist>\s*$/,
    `  <key>${key}</key>\n  <string>${value}</string>\n</dict>\n</plist>\n`
  );
}

const withIosUpdatesUrl = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const plistPath = findExpoPlist(cfg.modRequest.platformProjectRoot);
      if (plistPath) {
        const updated = setPlistString(fs.readFileSync(plistPath, 'utf8'), 'EXUpdatesURL', urlFor('ios'));
        fs.writeFileSync(plistPath, updated);
        console.log(`[withGithubUpdates] iOS EXUpdatesURL -> ${urlFor('ios')}`);
      } else {
        console.warn('[withGithubUpdates] Expo.plist not found; iOS updates URL left unchanged');
      }
      return cfg;
    },
  ]);

const withAndroidUpdatesUrl = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const manifestPath = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
      if (fs.existsSync(manifestPath)) {
        const xml = fs.readFileSync(manifestPath, 'utf8');
        const replaced = xml.replace(
          /(android:name="expo\.modules\.updates\.EXPO_UPDATE_URL"\s+android:value=")[^"]*(")/,
          `$1${urlFor('android')}$2`
        );
        fs.writeFileSync(manifestPath, replaced);
        console.log(`[withGithubUpdates] Android EXPO_UPDATE_URL -> ${urlFor('android')}`);
      } else {
        console.warn('[withGithubUpdates] AndroidManifest.xml not found; Android updates URL left unchanged');
      }
      return cfg;
    },
  ]);

module.exports = (config) => withAndroidUpdatesUrl(withIosUpdatesUrl(config));
