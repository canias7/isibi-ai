// Electron main process — wraps the existing web build (dist/) in a desktop
// window. The app runs in "web mode" (Capacitor reports platform 'web'), which
// it already fully supports: haptics no-op, voice via Web Audio, biometric/push
// fall back gracefully. Plain CommonJS so it runs without a build step.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session } = require('electron');
const path = require('path');

// In dev we point at the running Vite server; packaged, we load the bundled file.
const START_URL = process.env.ELECTRON_START_URL || '';
const isDev = !app.isPackaged && !!START_URL;

// One instance only — focus the existing window if a second launch happens.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let tray = null;

  function showWindow() {
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

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

  // Tray / menu-bar presence: quick access to the window + a one-tap new chat.
  // Best-effort — a desktop without a tray (some Linux setups) just skips it.
  function createTray() {
    try {
      const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'tray.png'));
      if (img.isEmpty()) return;
      tray = new Tray(img.resize({ width: 18, height: 18 }));
      tray.setToolTip('Go Farther');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Go Farther', click: showWindow },
        {
          label: 'New chat',
          click: () => {
            showWindow();
            // The renderer listens via the preload bridge (gfDesktop.onNewChat).
            win?.webContents.send('gf-new-chat');
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]));
      // Windows/Linux: a plain click opens the window (macOS opens the menu).
      tray.on('click', () => { if (process.platform !== 'darwin') showWindow(); });
    } catch { /* no tray support — fine, the app works without it */ }
  }

  // Self-update from the repo's GitHub Releases (electron-updater): silent
  // download in the background, installed on quit — the desktop twin of the
  // mobile OTA's "apply on next launch". Packaged builds only; never interrupts.
  // macOS requires the app to be code-signed for updates to install.
  function initAutoUpdate() {
    if (!app.isPackaged) return;
    let autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', () => { /* offline / no release yet — try again later */ });
    const check = () => { autoUpdater.checkForUpdates().catch(() => {}); };
    check();
    setInterval(check, 4 * 60 * 60 * 1000); // re-check every 4h while running
  }

  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // Grant the things the app actually uses (mic for voice/dictation,
    // notifications, clipboard). Everything else is denied by default.
    const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));

    createWindow();
    createTray();
    initAutoUpdate();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // macOS keeps the app alive after the last window closes; everywhere else quits.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
