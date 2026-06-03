# GoFarther AI

GoFarther AI is a cross-platform (iOS + Android) AI assistant built with
**Expo / React Native**. The app is fully client-side and talks to the hosted
backend at `https://isibi-backend.onrender.com/api/ghost` for all AI features
(chat, vision, image generation, TTS, tools, connectors).

Builds, releases, and over-the-air (OTA) updates all run on **GitHub** —
GitHub Actions compiles the native apps, and GitHub Pages serves OTA updates.
There is **no dependency on Expo's EAS cloud** for building or updating.

## Local development

```bash
npm install
npx expo start        # press i / a, or scan the QR with a dev build
```

Native folders (`ios/`, `android/`) are **not** committed — they're generated
from `app.json` by `expo prebuild`. To run a native build locally:

```bash
npx expo prebuild --clean    # regenerates ios/ and android/
npx expo run:android         # or: npx expo run:ios
```

## Build & release (GitHub Actions)

| Workflow | Runner | Output | Trigger |
|---|---|---|---|
| `.github/workflows/android-build.yml` | Ubuntu | signed **APK + AAB** | tag `v*` → Release; manual → artifact |
| `.github/workflows/ios-build.yml` | macOS | signed **IPA** | tag `v*` → Release; manual → artifact |
| `.github/workflows/ota.yml` | Ubuntu | **OTA update** on GitHub Pages | push to `main` (code/assets) or manual |

Each build runs `expo prebuild --clean` to generate the native project, then
compiles with Gradle / Xcode. Cut a release by pushing a tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Both build workflows attach their binaries to the GitHub Release for that tag.

## OTA updates (replaces EAS Update)

`ota.yml` runs `expo export`, then `scripts/generate-static-manifest.mjs`
converts the output into static, per-platform Expo Updates manifests:

```
https://canias7.github.io/isibi-ai/updates/ios.json
https://canias7.github.io/isibi-ai/updates/android.json
```

`plugins/withGithubUpdates.js` bakes the matching URL into each native build at
prebuild time, and `App.tsx` checks for an update on launch. Push JS/asset
changes to `main` and the running apps pick them up — no rebuild needed (native
code changes still require a new build + release).

> **One-time setup:** repo **Settings → Pages → Source = "GitHub Actions"**.
>
> **Verify on a device:** GitHub Pages is a static host and can't set the
> `expo-protocol-version` response header or do per-request manifest logic, so
> confirm OTA actually applies on a real build. If the static manifest isn't
> accepted by the `expo-updates` client, the fallback is a tiny manifest
> endpoint (e.g. a Cloudflare Worker) serving the same `dist/` files with the
> right headers — `updates.url` would then point there instead of Pages.

If you change the GitHub owner/repo, update the Pages URL in three places:
`app.json` (`updates.url`), `plugins/withGithubUpdates.js`, and
`scripts/generate-static-manifest.mjs` (or set the `OTA_SITE_URL` env var).

## Required GitHub Secrets

Set under **Settings → Secrets and variables → Actions**.

### Android (`secrets`)
| Name | Description |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Release keystore, base64-encoded (`base64 -w0 release.jks`). If absent, the workflow builds a debug APK. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

### iOS (`secrets`)
| Name | Description |
|---|---|
| `APPLE_CERTIFICATE_BASE64` | Apple distribution certificate (`.p12`), base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Provisioning profile (`.mobileprovision`), base64-encoded |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

### iOS (`variables`, optional)
| Name | Description |
|---|---|
| `IOS_EXPORT_METHOD` | `app-store` (default), `ad-hoc`, `development`, or `enterprise` |

## Notes

- **Push notifications** still use Expo's push service (`expo-notifications` +
  the `projectId` in `app.json` → `extra.eas.projectId`). GitHub can't relay
  APNs/FCM, so this remains on Expo. Migrating off it means wiring FCM/APNs
  directly — out of scope for the build/OTA move.
- **Sentry** auto source-map upload is disabled in CI by default. To enable it,
  add a `SENTRY_AUTH_TOKEN` secret and remove `SENTRY_DISABLE_AUTO_UPLOAD`.
- `eas.json` has been removed; the app no longer uses `eas build`/`submit`/`update`.
