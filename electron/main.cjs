// Electron main process — wraps the existing web build (dist/) in a desktop
// window. The app runs in "web mode" (Capacitor reports platform 'web'), which
// it already fully supports: haptics no-op, voice via Web Audio, biometric/push
// fall back gracefully. Plain CommonJS so it runs without a build step.
const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

// In dev we point at the running Vite server; packaged, we load the bundled file.
const START_URL = process.env.ELECTRON_START_URL || '';
const isDev = !app.isPackaged && !!START_URL;

// One instance only — focus the existing window if a second launch happens.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 380,
      minHeight: 600,
      backgroundColor: '#000000', // matches the app bg — no white flash on load
      title: 'Go Farther',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });

    // OAuth pop-ups and any external link open in the system browser, never as a
    // bare new app window. The connector flow polls for completion, so the
    // system-browser round-trip works exactly like it does on the web.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // In-page navigations to an external origin also bounce to the system browser
    // (keeps the app shell on its own page).
    win.webContents.on('will-navigate', (e, url) => {
      const internal = isDev ? url.startsWith(START_URL) : url.startsWith('file://');
      if (!internal && /^https?:/i.test(url)) {
        e.preventDefault();
        void shell.openExternal(url);
      }
    });

    if (isDev) {
      void win.loadURL(START_URL);
      win.webContents.openDevTools({ mode: 'detach' });
    } else {
      void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    win.on('closed', () => { win = null; });
  }

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    // Grant the things the app actually uses (mic for voice/dictation,
    // notifications, clipboard). Everything else is denied by default.
    const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));

    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // macOS keeps the app alive after the last window closes; everywhere else quits.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
