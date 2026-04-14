const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Read config
let config = { url: 'https://api.isibi.ai', name: 'My App', width: 1280, height: 800 };
try {
  const configPath = path.join(__dirname, 'app-config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (e) { console.error('Config error:', e); }

// Set app name early so it shows in menu bar and dock
app.name = config.name || 'My App';
if (app.setName) app.setName(config.name || 'My App');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.width || 1280,
    height: config.height || 800,
    title: config.name || 'My App',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset', // Clean Mac title bar
    backgroundColor: '#ffffff',
  });

  mainWindow.loadURL(config.url);

  // Set app name in dock/taskbar
  if (app.dock) app.dock.setIcon(path.join(__dirname, 'icon.png'));

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Simple menu
  const template = [
    {
      label: config.name,
      submenu: [
        { label: 'About', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' },
      { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ]},
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
