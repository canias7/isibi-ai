from __future__ import annotations

"""
Control Center download — generate a downloadable Electron-wrapped desktop app
that serves as a central hub for managing all of a user's isibi.ai apps.

Unlike the per-project desktop_download, this generates a single "ISIBI Control
Center" app that loads the user's dashboard and includes a system tray with app
statuses.
"""

import io
import json
import logging
import os
import struct
import zipfile
import zlib
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["control-center"])


class ControlCenterRequest(BaseModel):
    platform: Literal["mac", "win", "linux"] = "mac"


def _generate_isibi_icon_png() -> bytes:
    """Generate a 64x64 PNG icon with 'I' on a purple-pink gradient background."""
    width, height = 64, 64

    glyph = [0x3E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x3E, 0x00]  # letter I

    pixels = bytearray()
    scale = 4
    glyph_w, glyph_h = 8 * scale, 8 * scale
    ox = (width - glyph_w) // 2
    oy = (height - glyph_h) // 2

    for y in range(height):
        pixels.append(0)  # PNG filter byte
        for x in range(width):
            gy = (y - oy) // scale
            gx = (x - ox) // scale
            if 0 <= gy < 8 and 0 <= gx < 8 and (glyph[gy] >> (7 - gx)) & 1:
                pixels.extend([255, 255, 255, 255])
            else:
                # Gradient: pink to purple
                t = x / width
                r = int(236 * (1 - t) + 99 * t)
                g = int(72 * (1 - t) + 102 * t)
                b = int(153 * (1 - t) + 241 * t)
                pixels.extend([r, g, b, 255])

    def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        chunk = chunk_type + data
        return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png += _png_chunk(b"IHDR", ihdr_data)
    compressed = zlib.compress(bytes(pixels), 9)
    png += _png_chunk(b"IDAT", compressed)
    png += _png_chunk(b"IEND", b"")
    return png


# ── Electron template files (generated in-memory) ─────────────────────────

def _make_package_json() -> str:
    return json.dumps({
        "name": "isibi-control-center",
        "productName": "ISIBI Control Center",
        "version": "1.0.0",
        "description": "Desktop control center for managing your isibi.ai apps",
        "main": "main.js",
        "scripts": {
            "start": "electron .",
            "build-mac": "electron-builder --mac",
            "build-win": "electron-builder --win",
            "build-linux": "electron-builder --linux",
        },
        "dependencies": {
            "electron": "^28.0.0",
        },
        "devDependencies": {
            "electron-builder": "^24.0.0",
        },
    }, indent=2)


def _make_main_js() -> str:
    return r"""const { app, BrowserWindow, Tray, Menu, nativeImage, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');

// Read config
let config = { url: 'https://isibi.ai/app', apiUrl: 'https://isibi-backend.onrender.com/api', name: 'ISIBI Control Center', width: 1200, height: 800 };
try {
  const configPath = path.join(__dirname, 'app-config.json');
  if (fs.existsSync(configPath)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
  }
} catch (e) { console.error('Config error:', e); }

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
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
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

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) return;

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ISIBI Control Center');

  // Initial tray menu
  updateTrayMenu([]);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      if (app.dock) app.dock.show();
    }
  });
}

function updateTrayMenu(apps) {
  const appItems = apps.length > 0
    ? apps.map(a => ({
        label: `${a.status === 'online' ? '●' : '○'} ${a.name}`,
        enabled: true,
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            if (app.dock) app.dock.show();
          }
        }
      }))
    : [{ label: 'No apps yet', enabled: false }];

  const contextMenu = Menu.buildFromTemplate([
    { label: 'ISIBI Control Center', enabled: false },
    { type: 'separator' },
    ...appItems,
    { type: 'separator' },
    { label: 'Open Control Center', click: () => {
      if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); }
    }},
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  if (tray) tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); if (app.dock) app.dock.show(); }
  else createWindow();
});
"""


def _make_preload_js() -> str:
    return """const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('isibiDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
});
"""


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/control-center/download")
async def download_control_center(
    body: ControlCenterRequest,
    _user_id=Depends(get_current_user_id),
):
    """
    Generate and return a ZIP containing the ISIBI Control Center Electron app.
    Supports macOS, Windows, and Linux via platform-specific launcher scripts.
    """
    platform = body.platform

    # Generate files
    package_json = _make_package_json()
    main_js = _make_main_js()
    preload_js = _make_preload_js()
    icon_png = _generate_isibi_icon_png()

    app_host = os.getenv("APP_HOST", "")
    dashboard_url = f"{app_host}/app" if app_host else "https://isibi.ai/app"
    api_url = os.getenv("API_URL", "https://isibi-backend.onrender.com/api")

    app_config = json.dumps({
        "url": dashboard_url,
        "apiUrl": api_url,
        "name": "ISIBI Control Center",
        "width": 1200,
        "height": 800,
    }, indent=2)

    # Launcher scripts
    start_command = (
        '#!/bin/bash\n'
        'cd "$(dirname "$0")"\n'
        'echo "Installing dependencies (first run only)..."\n'
        'npm install --production 2>/dev/null\n'
        'echo "Launching ISIBI Control Center..."\n'
        'npx electron .\n'
    )

    start_bat = (
        '@echo off\r\n'
        'cd /d "%~dp0"\r\n'
        'echo Installing dependencies (first run only)...\r\n'
        'npm install --production 2>nul\r\n'
        'echo Launching ISIBI Control Center...\r\n'
        'npx electron .\r\n'
    )

    start_sh = (
        '#!/bin/bash\n'
        'cd "$(dirname "$0")"\n'
        'echo "Installing dependencies (first run only)..."\n'
        'npm install --production 2>/dev/null\n'
        'echo "Launching ISIBI Control Center..."\n'
        'npx electron .\n'
    )

    readme = (
        "ISIBI Control Center - Desktop App\n"
        "===================================\n\n"
        "Requirements:\n"
        "  - Node.js 18+ (https://nodejs.org)\n\n"
        "How to launch:\n"
        "  Mac:     Double-click start.command (or run it in Terminal)\n"
        "  Windows: Double-click start.bat\n"
        "  Linux:   Run ./start.sh in a terminal\n\n"
        "What happens:\n"
        "  1. Dependencies are installed automatically on first run\n"
        "  2. The ISIBI Control Center opens in its own desktop window\n"
        "  3. Use the system tray icon to see your apps at a glance\n"
        "  4. It connects to your live isibi.ai account\n\n"
        "To build a standalone app (optional):\n"
        "  npm install\n"
        "  npm run build-mac   (creates macOS .dmg)\n"
        "  npm run build-win   (creates Windows installer)\n"
        "  npm run build-linux (creates Linux AppImage)\n\n"
        "Powered by isibi.ai\n"
    )

    # Build ZIP
    folder = "ISIBI-Control-Center"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{folder}/package.json", package_json)
        zf.writestr(f"{folder}/main.js", main_js)
        zf.writestr(f"{folder}/preload.js", preload_js)
        zf.writestr(f"{folder}/app-config.json", app_config)
        zf.writestr(f"{folder}/icon.png", icon_png)
        zf.writestr(f"{folder}/README.txt", readme)

        # Platform-specific launchers
        if platform in ("mac", "linux"):
            sc_info = zipfile.ZipInfo(f"{folder}/start.command")
            sc_info.external_attr = 0o755 << 16
            zf.writestr(sc_info, start_command)

            sh_info = zipfile.ZipInfo(f"{folder}/start.sh")
            sh_info.external_attr = 0o755 << 16
            zf.writestr(sh_info, start_sh)

        if platform == "win":
            zf.writestr(f"{folder}/start.bat", start_bat)

        # Always include all launchers for convenience
        if platform == "mac":
            zf.writestr(f"{folder}/start.bat", start_bat)
        elif platform == "win":
            sc_info = zipfile.ZipInfo(f"{folder}/start.command")
            sc_info.external_attr = 0o755 << 16
            zf.writestr(sc_info, start_command)
        elif platform == "linux":
            zf.writestr(f"{folder}/start.bat", start_bat)

        # macOS .app bundle
        if platform == "mac":
            app_bundle = f"{folder}/ISIBI Control Center.app/"
            app_contents = f"{app_bundle}Contents/"
            app_macos = f"{app_contents}MacOS/"
            app_resources = f"{app_contents}Resources/"

            info_plist = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleName</key>
    <string>ISIBI Control Center</string>
    <key>CFBundleDisplayName</key>
    <string>ISIBI Control Center</string>
    <key>CFBundleIdentifier</key>
    <string>ai.isibi.control-center</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>'''

            launcher_script = '''#!/bin/bash
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$DIR"
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies (first run only)..."
    npm install --production 2>/dev/null
fi
npx electron .
'''
            zf.writestr(f"{app_contents}Info.plist", info_plist)
            zf.writestr(f"{app_resources}icon.png", icon_png)
            zf.writestr(f"{app_resources}app-config.json", app_config)

            launcher_info = zipfile.ZipInfo(f"{app_macos}launcher")
            launcher_info.external_attr = 0o755 << 16
            zf.writestr(launcher_info, launcher_script)

    buf.seek(0)
    zip_bytes = buf.getvalue()

    platform_label = {"mac": "macOS", "win": "Windows", "linux": "Linux"}[platform]
    filename = f"ISIBI-Control-Center-{platform_label}.zip"

    logger.info("Generated Control Center zip (%s): %d bytes", platform_label, len(zip_bytes))

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(zip_bytes)),
        },
    )
