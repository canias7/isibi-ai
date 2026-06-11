# Go Farther — Desktop (Electron)

The desktop app wraps the existing web build (`dist/`) in an Electron window.
It runs in "web mode" — Capacitor reports platform `web`, so haptics no-op,
voice uses Web Audio, and biometric/push fall back gracefully. No separate UI.

## Run it

```bash
# Build the bundle and launch the packaged-style app (quickest look):
npm run electron:preview

# Or live-reload against the Vite dev server (two terminals):
npm run dev            # terminal 1 — starts Vite on :5173
npm run electron:dev   # terminal 2 — opens Electron against the dev server
```

## Package installers

Builds go to `release/`. Build each installer on its own OS (cross-signing
isn't possible from another platform).

```bash
npm run electron:build:mac     # .dmg (Apple Silicon / arm64) — run on a Mac
npm run electron:build:win     # .exe (NSIS installer)        — run on Windows
npm run electron:build:linux   # AppImage
npm run electron:build         # current OS, all configured targets
```

- **macOS**: signing/notarization needs your Apple Developer ID cert
  (`CSC_LINK` / `CSC_KEY_PASSWORD` + notarization creds). Unsigned builds run
  locally but Gatekeeper warns other users.
- **Windows**: unsigned `.exe` works; a code-signing cert removes the
  SmartScreen warning.

## How it's wired

- `electron/main.cjs` — creates the window, loads `dist/index.html` over
  `file://` (packaged) or the dev server (dev). External links / OAuth pop-ups
  open in the system browser; mic + notification permissions are granted.
- `electron/preload.cjs` — empty seam (contextIsolation on) for any future
  renderer↔main bridge.
- `electron-builder.json` — packaging config (appId `com.gofarther.app`,
  icon `build/icon.png`, mac arm64 dmg + win nsis + linux AppImage).
- `vite.config.ts` — `base: './'` when `ELECTRON=1` so assets resolve under
  `file://`; the web/Capacitor builds keep the absolute base.

Desktop builds bundle `dist/` directly (no OTA). Ship a new version by building
a new installer — the `@capgo` OTA path is native-only.
