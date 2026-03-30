const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// ── Auto-updater ────────────────────────────────────────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', info.version);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  showNotification('Update Ready', `Version ${info.version} will be installed on restart.`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', info.version);
  }
});

autoUpdater.on('error', (err) => {
  console.error('Auto-update error:', err.message);
});

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  apiUrl: 'https://isibi-backend.onrender.com/api',
  name: 'ISIBI Control Center',
  width: 1100,
  height: 750,
  pollInterval: 60000, // 60s
};

try {
  const configPath = path.join(__dirname, 'app-config.json');
  if (fs.existsSync(configPath)) {
    Object.assign(CONFIG, JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  }
} catch (e) {
  console.error('Config error:', e);
}

// ── Token storage (simple file-based) ───────────────────────────────────────
const TOKEN_PATH = path.join(app.getPath('userData'), 'auth-token.json');

function getStoredToken() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      return data.token || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function storeToken(token) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token }));
  } catch (e) {
    console.error('Failed to store token:', e);
  }
}

function clearStoredToken() {
  try { if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH); } catch (e) { /* ignore */ }
}

// ── Settings storage ────────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
let appSettings = { ghostCursor: true };
try { if (fs.existsSync(SETTINGS_PATH)) appSettings = { ...appSettings, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) }; } catch (e) {}

function saveSetting(key, val) {
  appSettings[key] = val;
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(appSettings)); } catch (e) {}
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
function apiFetch(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const token = getStoredToken();
    const url = new URL(endpoint, CONFIG.apiUrl.endsWith('/') ? CONFIG.apiUrl : CONFIG.apiUrl + '/');
    const fullUrl = CONFIG.apiUrl + endpoint;

    const parsedUrl = new URL(fullUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 401) {
            clearStoredToken();
            resolve({ error: 'unauthorized', statusCode: 401 });
            return;
          }
          if (res.statusCode === 204) { resolve(null); return; }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── App state ───────────────────────────────────────────────────────────────
app.name = CONFIG.name;
if (app.setName) app.setName(CONFIG.name);

let mainWindow;
let tray;
let pollTimer;
let previousStatuses = {};

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
    title: CONFIG.name,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Set dock icon on macOS
  const iconPath = path.join(__dirname, 'icon.png');
  if (app.dock && fs.existsSync(iconPath)) {
    app.dock.setIcon(iconPath);
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hide to tray on close (macOS)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (app.dock) app.dock.hide();
    }
  });

  // App menu
  const template = [
    {
      label: CONFIG.name,
      submenu: [
        { label: 'About ISIBI Control Center', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Tray ────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) return;

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(CONFIG.name);
  updateTrayMenu([]);

  tray.on('click', () => {
    if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); }
  });
}

function updateTrayMenu(apps) {
  const appItems = apps.length > 0
    ? apps.map((a) => ({
        label: `${a.status === 'deployed' ? '\u25CF' : '\u25CB'} ${a.name}`,
        enabled: true,
        click: () => { if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); } },
      }))
    : [{ label: 'No apps yet', enabled: false }];

  const contextMenu = Menu.buildFromTemplate([
    { label: CONFIG.name, enabled: false },
    { type: 'separator' },
    ...appItems,
    { type: 'separator' },
    { label: 'Open Control Center', click: () => { if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); } } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  if (tray) tray.setContextMenu(contextMenu);
}

// ── Background polling ──────────────────────────────────────────────────────
async function pollStatuses() {
  if (!getStoredToken()) return;

  try {
    const projects = await apiFetch('/projects');
    if (Array.isArray(projects)) {
      updateTrayMenu(projects);

      // Check for status changes and send notifications
      for (const proj of projects) {
        const prevStatus = previousStatuses[proj.id];
        if (prevStatus && prevStatus !== proj.status) {
          if (proj.status === 'error') {
            showNotification(`${proj.name} is down`, 'Your app encountered an error and may be offline.');
          } else if (prevStatus === 'error' && proj.status === 'deployed') {
            showNotification(`${proj.name} is back online`, 'Your app has recovered and is running normally.');
          }
        }
        previousStatuses[proj.id] = proj.status;
      }

      // Send to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', projects);
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
  }
}

// ── Ghost cursor animation ──────────────────────────────────────────────
async function pollGhostQueue() {
  if (!getStoredToken()) return;
  if (!appSettings.ghostCursor) return; // Ghost cursor disabled in settings

  // Check each open app window for pending ghost animations
  for (const [projectId, win] of Object.entries(appWindows)) {
    if (!win || win.isDestroyed()) continue;

    try {
      const result = await apiFetch(`/apps/${projectId}/ghost-queue`);
      if (result && result.items && result.items.length > 0) {
        for (const ghost of result.items) {
          await executeGhostAnimation(win, ghost);
        }
      }
    } catch (e) {
      // Silently ignore — ghost queue is best-effort
    }
  }
}

async function executeGhostAnimation(win, ghost) {
  if (!win || win.isDestroyed() || !ghost.fields || Object.keys(ghost.fields).length === 0) return;

  const fields = ghost.fields;
  const entityName = ghost.entity || ghost.table || '';

  // Build the ghost animation script
  const script = `
  (async function() {
    // ── Ghost cursor CSS ──
    if (!document.getElementById('ghost-cursor-style')) {
      const style = document.createElement('style');
      style.id = 'ghost-cursor-style';
      style.textContent = \`
        #ghost-cursor {
          position: fixed; z-index: 99999; pointer-events: none;
          width: 20px; height: 20px;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          filter: drop-shadow(0 0 8px rgba(236,72,153,.8)) drop-shadow(0 0 16px rgba(236,72,153,.4));
        }
        #ghost-cursor svg { width: 20px; height: 20px; }
        #ghost-trail {
          position: fixed; z-index: 99998; pointer-events: none;
          width: 12px; height: 12px; border-radius: 50%;
          background: radial-gradient(circle, rgba(236,72,153,.6) 0%, transparent 70%);
          transition: all 0.5s ease;
          filter: blur(4px);
        }
        .ghost-typing-glow {
          box-shadow: 0 0 12px rgba(236,72,153,.4), 0 0 24px rgba(139,92,246,.2) !important;
          border-color: #ec4899 !important;
        }
        @keyframes ghost-fade-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @keyframes ghost-fade-out { from { opacity: 1; } to { opacity: 0; transform: scale(0.5) translateY(-10px); } }
      \`;
      document.head.appendChild(style);
    }

    // Create cursor element
    const cursor = document.createElement('div');
    cursor.id = 'ghost-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" fill="white" stroke="none"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"/></svg>';
    cursor.style.animation = 'ghost-fade-in 0.3s ease';
    cursor.style.left = '50%'; cursor.style.top = '50%';
    document.body.appendChild(cursor);

    const trail = document.createElement('div');
    trail.id = 'ghost-trail';
    trail.style.left = '50%'; trail.style.top = '50%';
    document.body.appendChild(trail);

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function moveTo(el) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
      trail.style.left = (x + 4) + 'px';
      trail.style.top = (y + 4) + 'px';
    }

    async function typeInto(el, text) {
      el.focus();
      el.classList.add('ghost-typing-glow');
      el.value = '';
      for (let i = 0; i < text.length; i++) {
        el.value += text[i];
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(40 + Math.random() * 30);
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      el.classList.remove('ghost-typing-glow');
    }

    async function selectOption(el, value) {
      el.focus();
      el.classList.add('ghost-typing-glow');
      const opts = Array.from(el.options);
      const match = opts.find(o => o.value.toLowerCase() === value.toLowerCase() || o.text.toLowerCase() === value.toLowerCase());
      if (match) { el.value = match.value; }
      else { el.value = value; }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      el.classList.remove('ghost-typing-glow');
    }

    // Wait for any existing modal to be ready
    await sleep(300);

    // Step 1: Open the create form
    if (typeof openCreate === 'function') {
      // Navigate to the right module first
      const moduleName = ${JSON.stringify(entityName)};
      if (typeof showModule === 'function' && moduleName) {
        showModule(moduleName);
        await sleep(500);
      }
      openCreate();
      await sleep(600);
    }

    // Step 2: Fill each field with ghost cursor animation
    const fields = ${JSON.stringify(fields)};
    const formBody = document.getElementById('modal-body');
    if (!formBody) { cursor.remove(); trail.remove(); return; }

    for (const [fieldName, value] of Object.entries(fields)) {
      if (!value) continue;

      // Find the input by name
      let input = formBody.querySelector('input[name="' + fieldName + '"]');
      if (!input) input = formBody.querySelector('select[name="' + fieldName + '"]');
      if (!input) input = formBody.querySelector('textarea[name="' + fieldName + '"]');

      // Fuzzy match: try partial name matching
      if (!input) {
        const allInputs = formBody.querySelectorAll('input, select, textarea');
        for (const inp of allInputs) {
          const n = (inp.name || '').toLowerCase();
          const fn = fieldName.toLowerCase();
          if (n.includes(fn) || fn.includes(n)) { input = inp; break; }
        }
      }

      if (!input || input.type === 'hidden') continue;

      // Scroll field into view
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);

      // Move cursor to field
      moveTo(input);
      await sleep(400);

      // Type or select
      if (input.tagName === 'SELECT') {
        await selectOption(input, String(value));
      } else {
        await typeInto(input, String(value));
      }

      await sleep(200);
    }

    // Step 3: Move to save button and click
    const saveBtn = document.getElementById('modal-save');
    if (saveBtn) {
      moveTo(saveBtn);
      await sleep(500);
      saveBtn.classList.add('ghost-typing-glow');
      await sleep(200);
      saveBtn.click();
      await sleep(300);
      saveBtn.classList.remove('ghost-typing-glow');
    }

    // Step 4: Fade out cursor
    cursor.style.animation = 'ghost-fade-out 0.5s ease forwards';
    trail.style.animation = 'ghost-fade-out 0.5s ease forwards';
    await sleep(600);
    cursor.remove();
    trail.remove();
  })();
  `;

  try {
    await win.webContents.executeJavaScript(script);
  } catch (e) {
    console.error('Ghost animation error:', e.message);
  }
}

function startPolling() {
  pollStatuses();
  pollTimer = setInterval(() => {
    pollStatuses();
    pollGhostQueue();
  }, 5000); // Poll every 5s for ghost animations (faster than status)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'icon.png') }).show();
  }
}

// ── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.handle('get-token', () => getStoredToken());
ipcMain.handle('set-token', (_, token) => { storeToken(token); startPolling(); });
ipcMain.handle('clear-token', () => { clearStoredToken(); stopPolling(); });

ipcMain.handle('login', async (_, email, password) => {
  try {
    const result = await apiFetch('/auth/login', 'POST', { email, password, turnstile_token: 'desktop' });
    if (result && result.access_token) {
      storeToken(result.access_token);
      startPolling();
    }
    return result;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('get-apps', async () => {
  try { return await apiFetch('/projects'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('get-app-status', async (_, projectId) => {
  try { return await apiFetch(`/projects/${projectId}/deploy/status`); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('get-uptime', async (_, projectId) => {
  try { return await apiFetch(`/projects/${projectId}/uptime`); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('health-check', async (_, projectId) => {
  try { return await apiFetch(`/projects/${projectId}/uptime/check`, 'POST'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('restart-app', async (_, projectId) => {
  try { return await apiFetch(`/projects/${projectId}/restart`, 'POST'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('deploy-app', async (_, projectId) => {
  try { return await apiFetch(`/projects/${projectId}/deploy`, 'POST', { force: true }); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('get-notifications', async () => {
  try { return await apiFetch('/notifications'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('get-unread-count', async () => {
  try { return await apiFetch('/notifications/unread-count'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('mark-read', async (_, notificationId) => {
  try { return await apiFetch(`/notifications/${notificationId}/read`, 'POST'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('mark-all-read', async () => {
  try { return await apiFetch('/notifications/read-all', 'POST'); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('open-external', (_, url) => { shell.openExternal(url); });

ipcMain.handle('set-setting', (_, key, val) => { saveSetting(key, val); });
ipcMain.handle('get-setting', (_, key) => appSettings[key]);

// Open apps inside their own desktop windows
const appWindows = {}; // {projectId: BrowserWindow}

ipcMain.handle('open-app-window', (_, projectId, url) => {
  // If window already exists and isn't destroyed, focus it
  if (appWindows[projectId] && !appWindows[projectId].isDestroyed()) {
    appWindows[projectId].focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'ISIBI App',
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  win.loadURL(url);

  // Update title when page loads
  win.webContents.on('did-finish-load', () => {
    const pageTitle = win.webContents.getTitle();
    if (pageTitle) win.setTitle(pageTitle);
  });

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http')) shell.openExternal(linkUrl);
    return { action: 'deny' };
  });

  win.on('closed', () => { delete appWindows[projectId]; });
  appWindows[projectId] = win;
});

ipcMain.handle('check-for-updates', async () => {
  try { return await autoUpdater.checkForUpdatesAndNotify(); } catch (e) { return { error: e.message }; }
});

ipcMain.handle('install-update', () => { autoUpdater.quitAndInstall(); });

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  if (getStoredToken()) startPolling();

  // Check for updates after launch (silently)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.log('Update check skipped:', err.message);
    });
  }, 5000);
});

app.on('before-quit', () => { app.isQuitting = true; stopPolling(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); }
  else createWindow();
});
