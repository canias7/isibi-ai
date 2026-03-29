const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Read config
let config = {
  url: 'https://isibi.ai/app',
  apiUrl: 'https://isibi-backend.onrender.com/api',
  name: 'ISIBI Control Center',
  width: 1200,
  height: 800,
};
try {
  const configPath = path.join(__dirname, 'app-config.json');
  if (fs.existsSync(configPath)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
  }
} catch (e) {
  console.error('Config error:', e);
}

app.name = config.name;
if (app.setName) app.setName(config.name);

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.width || 1200,
    height: config.height || 800,
    title: config.name,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, 'icon.png'),
  });

  mainWindow.loadURL(config.url);

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

  // Hide to tray instead of quitting on close (macOS)
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
      label: config.name,
      submenu: [
        { label: 'About ISIBI Control Center', role: 'about' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) return;

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ISIBI Control Center');

  updateTrayMenu([]);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      if (app.dock) app.dock.show();
    }
  });
}

function updateTrayMenu(apps) {
  const appItems =
    apps.length > 0
      ? apps.map((a) => ({
          label: `${a.status === 'online' ? '\u25CF' : '\u25CB'} ${a.name}`,
          enabled: true,
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              if (app.dock) app.dock.show();
            }
          },
        }))
      : [{ label: 'No apps yet', enabled: false }];

  const contextMenu = Menu.buildFromTemplate([
    { label: 'ISIBI Control Center', enabled: false },
    { type: 'separator' },
    ...appItems,
    { type: 'separator' },
    {
      label: 'Open Control Center',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (app.dock) app.dock.show();
        }
      },
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  if (tray) tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    if (app.dock) app.dock.show();
  } else {
    createWindow();
  }
});
