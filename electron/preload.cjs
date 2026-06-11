// Preload runs before the page with contextIsolation on. Nothing is exposed to
// the page yet — the app needs no desktop-only bridge today (it runs as the web
// build). Kept as the seam for any future renderer↔main API (e.g. a native
// "open file" or tray integration), which would go through contextBridge here.
