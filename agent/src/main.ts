/**
 * ISIBI Ghost Mode — Main Entry Point
 *
 * A futuristic AI agent that controls your computer.
 * You speak or type a command, and the ghost orb does it for you.
 */

import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { buildIndex, loadIndex, refreshIndex, SystemIndex } from './indexer';
import { processCommand, getTaskQueue, getActiveTask } from './brain';
import { createOverlay, destroyOverlay } from './overlay';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let systemIndex: SystemIndex | null = null;

// ── Main Window (Ghost Mode UI) ─────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    title: 'ISIBI Ghost Mode',
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
  });

  // Load the Ghost Mode UI
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GHOST_MODE_HTML)}`);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('blur', () => { /* Don't hide — keep accessible */ });
}

// ── System Tray ─────────────────────────────────────────────────────────

function createTray() {
  // Simple icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ISIBI Ghost Mode');

  const menu = Menu.buildFromTemplate([
    { label: 'Show Ghost Mode', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => mainWindow?.show());
}

// ── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('ghost-command', async (_, command: string) => {
  if (!systemIndex) {
    return { error: 'System not indexed yet. Please wait...' };
  }

  try {
    const plans = await processCommand(command, systemIndex);
    return {
      tasks: plans.map(p => ({
        id: p.taskId,
        command: p.command,
        steps: p.actions.length,
        status: p.status,
      })),
    };
  } catch (e: any) {
    return { error: e.message };
  }
});

ipcMain.handle('ghost-status', () => {
  const active = getActiveTask();
  const queue = getTaskQueue();
  return {
    active: active ? {
      id: active.taskId,
      command: active.command,
      step: active.currentStep + 1,
      totalSteps: active.actions.length,
      currentAction: active.actions[active.currentStep]?.description || '',
      status: active.status,
    } : null,
    queueLength: queue.filter(t => t.status === 'pending').length,
    completed: queue.filter(t => t.status === 'done').length,
  };
});

ipcMain.handle('ghost-index-status', () => {
  if (!systemIndex) return { status: 'indexing' };
  return {
    status: 'ready',
    apps: systemIndex.apps.length,
    files: systemIndex.recentFiles.length,
    bookmarks: systemIndex.bookmarks.length,
    scannedAt: systemIndex.scannedAt,
  };
});

ipcMain.handle('ghost-reindex', async () => {
  systemIndex = buildIndex();
  return { status: 'done', apps: systemIndex.apps.length };
});

// ── App Lifecycle ───────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Register global shortcut to toggle Ghost Mode
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  // Index the system on first launch
  console.log('[Ghost Mode] Starting system index...');
  systemIndex = loadIndex();
  if (!systemIndex) {
    // First time — full scan
    systemIndex = buildIndex();
  } else {
    // Quick refresh
    systemIndex = refreshIndex();
  }
  console.log(`[Ghost Mode] Index ready: ${systemIndex.apps.length} apps, ${systemIndex.recentFiles.length} files`);

  // Notify the UI
  if (mainWindow) {
    mainWindow.webContents.send('index-ready', {
      apps: systemIndex.apps.length,
      files: systemIndex.recentFiles.length,
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyOverlay();
});

// ── Ghost Mode UI (inline HTML) ─────────────────────────────────────────

const GHOST_MODE_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, system-ui, sans-serif;
  background: transparent;
  color: #f0e6ff;
  height: 100vh;
  overflow: hidden;
  -webkit-app-region: drag;
}

.container {
  background: rgba(10, 0, 21, 0.92);
  backdrop-filter: blur(40px) saturate(1.5);
  border: 1px solid rgba(236, 72, 153, 0.15);
  border-radius: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(236,72,153,.1);
}
.header h1 {
  font-size: 15px; font-weight: 700;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.header .shortcut {
  font-size: 10px; color: rgba(240,230,255,.3);
  background: rgba(255,255,255,.05); padding: 3px 8px; border-radius: 4px;
}

.orb-container {
  display: flex; align-items: center; justify-content: center;
  padding: 30px 0;
}
.orb {
  width: 80px; height: 80px; border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1);
  box-shadow: 0 0 30px rgba(236,72,153,.5), 0 0 60px rgba(236,72,153,.2);
  animation: orb-float 3s ease-in-out infinite;
}
.orb.active {
  animation: orb-active 0.8s ease-in-out infinite;
  box-shadow: 0 0 40px rgba(236,72,153,.7), 0 0 80px rgba(236,72,153,.3);
}
@keyframes orb-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
@keyframes orb-active {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.status-text {
  text-align: center; padding: 8px 20px;
  font-size: 12px; color: rgba(240,230,255,.4);
  min-height: 32px;
}
.status-text.active { color: #ec4899; }

.chat {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.chat::-webkit-scrollbar { width: 3px; }
.chat::-webkit-scrollbar-thumb { background: rgba(236,72,153,.2); border-radius: 2px; }

.msg {
  padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.4;
  max-width: 90%; animation: msg-in 0.2s ease;
}
.msg.user {
  background: rgba(236,72,153,.15); border: 1px solid rgba(236,72,153,.2);
  align-self: flex-end; color: #f9a8d4;
}
.msg.agent {
  background: rgba(139,92,246,.1); border: 1px solid rgba(139,92,246,.15);
  align-self: flex-start; color: #c4b5fd;
}
.msg.system {
  background: rgba(255,255,255,.03); text-align: center; align-self: center;
  font-size: 11px; color: rgba(240,230,255,.3);
}
@keyframes msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.input-area {
  padding: 12px 16px; border-top: 1px solid rgba(236,72,153,.1);
  -webkit-app-region: no-drag;
}
.input-row {
  display: flex; gap: 8px;
}
.input-row input {
  flex: 1; padding: 10px 14px;
  background: rgba(255,255,255,.03); border: 1px solid rgba(236,72,153,.15);
  border-radius: 10px; color: #f0e6ff; font-size: 13px; outline: none;
}
.input-row input:focus { border-color: #ec4899; box-shadow: 0 0 12px rgba(236,72,153,.15); }
.input-row input::placeholder { color: rgba(240,230,255,.25); }
.input-row button {
  padding: 10px 16px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: white; font-weight: 600; font-size: 13px; cursor: pointer;
  box-shadow: 0 0 12px rgba(236,72,153,.2);
}
.input-row button:hover { box-shadow: 0 0 20px rgba(236,72,153,.4); }

.index-status {
  padding: 8px 16px; text-align: center;
  font-size: 10px; color: rgba(240,230,255,.2);
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Ghost Mode</h1>
    <span class="shortcut">Cmd+Shift+G</span>
  </div>

  <div class="orb-container">
    <div class="orb" id="orb"></div>
  </div>

  <div class="status-text" id="status">Ready — tell me what to do</div>

  <div class="chat" id="chat"></div>

  <div class="input-area">
    <div class="input-row">
      <input type="text" id="input" placeholder="Type a command..." autofocus>
      <button id="send" onclick="sendCommand()">Go</button>
    </div>
  </div>

  <div class="index-status" id="index-status">Scanning your computer...</div>
</div>

<script>
const { ipcRenderer } = require('electron');
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const orb = document.getElementById('orb');
const status = document.getElementById('status');
const indexStatus = document.getElementById('index-status');

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCommand();
});

ipcRenderer.on('index-ready', (_, data) => {
  indexStatus.textContent = data.apps + ' apps · ' + data.files + ' recent files indexed';
});

async function sendCommand() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addMessage('user', text);
  orb.classList.add('active');
  status.textContent = 'Thinking...';
  status.classList.add('active');

  const result = await ipcRenderer.invoke('ghost-command', text);

  if (result.error) {
    addMessage('agent', 'Error: ' + result.error);
    orb.classList.remove('active');
    status.textContent = 'Ready';
    status.classList.remove('active');
    return;
  }

  for (const task of result.tasks) {
    addMessage('agent', 'Running: ' + task.command + ' (' + task.steps + ' steps)');
  }

  // Poll for status updates
  pollStatus();
}

async function pollStatus() {
  const result = await ipcRenderer.invoke('ghost-status');

  if (result.active) {
    status.textContent = 'Step ' + result.active.step + '/' + result.active.totalSteps + ': ' + result.active.currentAction;
  } else {
    orb.classList.remove('active');
    status.textContent = 'Done!';
    status.classList.remove('active');
    setTimeout(() => { status.textContent = 'Ready — tell me what to do'; }, 2000);
    return;
  }

  setTimeout(pollStatus, 500);
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

addMessage('system', 'Ghost Mode active. Type a command or press Cmd+Shift+G to toggle.');
</script>
</body>
</html>`;
