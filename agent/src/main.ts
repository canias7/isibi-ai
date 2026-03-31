/**
 * ISIBI Ghost Mode — Main Entry Point
 *
 * A futuristic AI agent that controls your computer.
 * Claude-like desktop app with sidebar, chat, and voice.
 */

import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { buildIndex, loadIndex, refreshIndex, SystemIndex } from './indexer';
import { processCommand, getTaskQueue, getActiveTask } from './brain';
import { createOverlay, destroyOverlay } from './overlay';
import { isFirstRun, loadConfig, saveConfig, getWakeWord, getAssistantName } from './config';
import { createOnboardingWindow, registerOnboardingIPC } from './onboarding';
import { getAgents, getAgent, createAgent, updateAgent, deleteAgent, toggleAgent, getActiveAgents } from './agents';
import { dispatchCommand, getAllAgentStatuses } from './agent-manager';

let mainWindow: BrowserWindow | null = null;
let listenerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let systemIndex: SystemIndex | null = null;

// ── Main App Window ────────────────────────────────────────────────────

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'ISIBI Ghost Mode',
    frame: false,
    resizable: true,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0f0f1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
  });

  // Auto-grant microphone permission in renderer
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => { callback(true); }
  );

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(APP_HTML)}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Wake Word Listener (always-on, hidden window) ─────────────────────

function createListenerWindow() {
  if (listenerWindow) return;

  listenerWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  listenerWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => { callback(true); }
  );

  listenerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(WAKE_LISTENER_HTML)}`);
  listenerWindow.on('closed', () => { listenerWindow = null; });
}

// ── System Tray ────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ISIBI Ghost Mode');

  const menu = Menu.buildFromTemplate([
    { label: 'Show ISIBI', click: () => {
      mainWindow?.show();
      mainWindow?.focus();
    }},
    { label: 'Voice (F9)', click: () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('toggle-voice');
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { (app as any).isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────────

// Wake Word & Settings
ipcMain.handle('get-wake-word', () => getWakeWord());
ipcMain.handle('get-assistant-name', () => getAssistantName());

ipcMain.handle('wake-word-detected', () => {
  mainWindow?.show();
  mainWindow?.focus();
  mainWindow?.webContents.send('start-voice');
});

ipcMain.handle('update-assistant-profile', (_, name: string) => {
  const wakeWord = 'hey ' + name.toLowerCase().trim();
  saveConfig({ assistantName: name.trim(), assistantWakeWord: wakeWord });
  listenerWindow?.webContents.send('wake-word-changed', wakeWord);
  mainWindow?.webContents.send('profile-updated', { name: name.trim(), wakeWord });
  return { name: name.trim(), wakeWord };
});

// Agent CRUD
ipcMain.handle('agents-list', () => getAgents());

ipcMain.handle('agents-create', (_, data: { name: string; emoji: string; role: string; instructions: string; color: string }) => {
  const agent = createAgent(data);
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-update', (_, id: string, data: any) => {
  const agent = updateAgent(id, data);
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-delete', (_, id: string) => {
  const ok = deleteAgent(id);
  mainWindow?.webContents.send('agents-updated');
  return ok;
});

ipcMain.handle('agents-toggle', (_, id: string) => {
  const agent = toggleAgent(id);
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-statuses', () => getAllAgentStatuses());

// Command & Status
ipcMain.handle('ghost-command', async (_, command: string, agentId?: string) => {
  if (!systemIndex) {
    return { error: 'System not indexed yet. Please wait...' };
  }
  try {
    const targetId = agentId || getActiveAgents()[0]?.id;
    if (!targetId) return { error: 'No active agents. Create one in the sidebar.' };

    const plans = await dispatchCommand(targetId, command, systemIndex);
    const agent = getAgent(targetId);
    return {
      agentName: agent?.name,
      agentEmoji: agent?.emoji,
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

// ── App Lifecycle ──────────────────────────────────────────────────────

function launchGhostMode() {
  createMainWindow();
  createTray();

  // Microphone + wake word listener
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then((granted) => {
      console.log('[Ghost Mode] Microphone:', granted ? 'granted' : 'denied');
      if (granted) {
        createListenerWindow();
        console.log('[Ghost Mode] Wake word listener started — say "' + getWakeWord() + '"');
      }
    });
  } else {
    createListenerWindow();
    console.log('[Ghost Mode] Wake word listener started — say "' + getWakeWord() + '"');
  }

  // Keyboard shortcuts
  const toggleVoice = () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send('toggle-voice');
  };

  const f9 = globalShortcut.register('F9', toggleVoice);
  console.log('[Ghost Mode] F9:', f9 ? 'registered' : 'FAILED');
  const cmdG = globalShortcut.register('CommandOrControl+Shift+G', toggleVoice);
  console.log('[Ghost Mode] Cmd+Shift+G:', cmdG ? 'registered' : 'FAILED');

  // Index the system
  console.log('[Ghost Mode] Starting system index...');
  systemIndex = loadIndex();
  if (!systemIndex) {
    systemIndex = buildIndex();
  } else {
    systemIndex = refreshIndex();
  }
  console.log(`[Ghost Mode] Index ready: ${systemIndex.apps.length} apps, ${systemIndex.recentFiles.length} files`);

  mainWindow?.webContents.send('index-ready', {
    apps: systemIndex.apps.length,
    files: systemIndex.recentFiles.length,
  });
}

app.whenReady().then(async () => {
  registerOnboardingIPC();

  if (isFirstRun()) {
    createOnboardingWindow(() => {
      launchGhostMode();
    });
  } else {
    launchGhostMode();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
  else mainWindow.show();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyOverlay();
});

// ── Wake Word Listener HTML ───────────────────────────────────────────

const WAKE_LISTENER_HTML = `<!DOCTYPE html><html><head></head><body>
<script>
const{ipcRenderer}=require('electron');
let wakeWord='';
let rec=null;
let active=true;

async function init(){
  wakeWord=await ipcRenderer.invoke('get-wake-word');
  console.log('[Listener] Wake word:',wakeWord);
  try{await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){console.error('[Listener] Mic denied');active=false;return}
  setupRec();
  startListening();
}

function setupRec(){
  const S=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!S){console.error('[Listener] SpeechRecognition not available');return}
  rec=new S();
  rec.continuous=true;
  rec.interimResults=true;
  rec.lang='en-US';
  rec.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript.toLowerCase().trim();
      if(t.includes(wakeWord)){
        console.log('[Listener] Wake word detected!');
        rec.stop();
        ipcRenderer.invoke('wake-word-detected');
        setTimeout(()=>startListening(),5000);
        return;
      }
    }
  };
  rec.onend=()=>{if(active)setTimeout(()=>startListening(),500)};
  rec.onerror=e=>{
    console.log('[Listener] Error:',e.error);
    if(e.error==='not-allowed'){active=false;return}
    setTimeout(()=>startListening(),2000);
  };
}

function startListening(){
  if(!rec||!active)return;
  try{rec.start();console.log('[Listener] Listening...')}catch(e){}
}

ipcRenderer.on('wake-word-changed',(_,newWord)=>{
  wakeWord=newWord;
  console.log('[Listener] Wake word updated to:',wakeWord);
});

init();
</script></body></html>`;

// ── Main App HTML (Claude-like UI) ────────────────────────────────────

const APP_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  background: #0f0f1a;
  color: #e2e8f0;
  height: 100vh;
  overflow: hidden;
}

/* ── Layout Grid ── */
.app {
  display: grid;
  grid-template-rows: 38px 1fr;
  grid-template-columns: 260px 1fr;
  height: 100vh;
}

/* ── Titlebar ── */
.titlebar {
  grid-column: 1 / -1;
  background: #0a0a14;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  display: flex;
  align-items: center;
  padding: 0 16px;
  -webkit-app-region: drag;
  gap: 12px;
}
.titlebar .dots { display: flex; gap: 7px; -webkit-app-region: no-drag; }
.dot { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; }
.dot.close { background: #ef4444; }
.dot.close:hover { background: #dc2626; }
.dot.min { background: #eab308; }
.dot.max { background: #22c55e; }
.titlebar .title {
  font-size: 13px; font-weight: 600; color: rgba(226,232,240,0.5);
  margin-left: 60px;
}

/* ── Sidebar ── */
.sidebar {
  grid-row: 2;
  background: #0a0a14;
  border-right: 1px solid rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-app-region: no-drag;
}
.sidebar-top {
  padding: 16px;
}
.new-chat-btn {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.03);
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: .15s;
}
.new-chat-btn:hover { background: rgba(255,255,255,0.06); }
.new-chat-btn svg { opacity: 0.5; }

.sidebar-section {
  padding: 0 12px;
  margin-top: 8px;
}
.sidebar-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(226,232,240,0.25);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 8px 6px;
}

/* ── Agent List ── */
.agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}
.agent-list::-webkit-scrollbar { width: 3px; }
.agent-list::-webkit-scrollbar-thumb { background: rgba(236,72,153,0.15); border-radius: 2px; }

.agent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: .15s;
  margin-bottom: 2px;
}
.agent-item:hover { background: rgba(255,255,255,0.04); }
.agent-item.selected { background: rgba(236,72,153,0.08); }
.agent-item .emoji { font-size: 18px; flex-shrink: 0; }
.agent-item .info { flex: 1; min-width: 0; }
.agent-item .name { font-size: 13px; font-weight: 500; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agent-item .role { font-size: 10px; color: rgba(226,232,240,0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agent-item .dot-status { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.agent-item .controls {
  display: none;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.agent-item:hover .controls { display: flex; }
.agent-item:hover .dot-status { display: none; }
.ctrl-btn {
  width: 22px; height: 22px; border-radius: 5px; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; background: transparent; color: rgba(226,232,240,0.25);
  font-size: 10px; transition: .1s;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.06); color: rgba(226,232,240,0.6); }
.ctrl-btn.toggle-on { color: #22c55e; }
.ctrl-btn.toggle-off { color: #6b7280; }
.ctrl-btn.del:hover { color: #ef4444; }

.add-agent-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: rgba(226,232,240,0.25);
  font-size: 12px;
  transition: .15s;
  margin: 4px 12px;
}
.add-agent-btn:hover { background: rgba(255,255,255,0.04); color: rgba(226,232,240,0.5); }

/* ── Sidebar Bottom ── */
.sidebar-bottom {
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.04);
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: .15s;
  font-size: 12px;
  color: rgba(226,232,240,0.3);
}
.settings-row:hover { background: rgba(255,255,255,0.04); color: rgba(226,232,240,0.5); }
.settings-panel {
  display: none;
  margin-top: 8px;
  padding: 10px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
}
.settings-panel.visible { display: block; }
.settings-panel input {
  width: 100%;
  padding: 7px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 12px;
  outline: none;
  margin-bottom: 6px;
}
.settings-panel input:focus { border-color: rgba(236,72,153,0.3); }
.settings-panel .wake-hint { font-size: 10px; color: rgba(236,72,153,0.5); }
.settings-panel .save-profile-btn {
  margin-top: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  background: rgba(236,72,153,0.15);
  color: #f9a8d4;
  font-size: 11px;
  cursor: pointer;
}

/* ── Main Content ── */
.main {
  grid-row: 2;
  display: flex;
  flex-direction: column;
  background: #0f0f1a;
  min-width: 0;
}

/* ── Chat Area ── */
.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}
.chat-area::-webkit-scrollbar { width: 4px; }
.chat-area::-webkit-scrollbar-thumb { background: rgba(236,72,153,0.1); border-radius: 2px; }

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: rgba(226,232,240,0.15);
}
.chat-empty .orb {
  width: 56px; height: 56px; border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1);
  box-shadow: 0 0 24px rgba(236,72,153,0.3);
  animation: orbFloat 3s ease-in-out infinite;
}
@keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
.chat-empty .hint { font-size: 14px; }
.chat-empty .sub { font-size: 12px; color: rgba(226,232,240,0.1); }

/* ── Messages ── */
.msg {
  margin-bottom: 16px;
  animation: msgIn 0.2s ease;
}
@keyframes msgIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

.msg-user {
  display: flex;
  justify-content: flex-end;
}
.msg-user .bubble {
  max-width: 70%;
  padding: 10px 16px;
  border-radius: 16px 16px 4px 16px;
  background: rgba(236,72,153,0.1);
  border: 1px solid rgba(236,72,153,0.08);
  color: #f0e6ff;
  font-size: 14px;
  line-height: 1.5;
}

.msg-agent {
  display: flex;
  gap: 10px;
}
.msg-agent .avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.03);
}
.msg-agent .body {
  flex: 1;
  min-width: 0;
}
.msg-agent .agent-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(226,232,240,0.4);
  margin-bottom: 4px;
}
.msg-agent .content {
  padding: 12px 16px;
  border-radius: 4px 16px 16px 16px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  font-size: 14px;
  line-height: 1.5;
  color: #e2e8f0;
}

/* ── Task Progress ── */
.task-card {
  margin-top: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(139,92,246,0.04);
  border: 1px solid rgba(139,92,246,0.08);
  font-size: 12px;
}
.task-card .task-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c4b5fd;
  margin-bottom: 4px;
  font-weight: 500;
}
.task-card .task-step {
  color: rgba(196,181,253,0.5);
  font-size: 11px;
}
.task-card.done { background: rgba(34,197,94,0.04); border-color: rgba(34,197,94,0.08); }
.task-card.done .task-header { color: #86efac; }
.task-card.error { background: rgba(239,68,68,0.04); border-color: rgba(239,68,68,0.08); }
.task-card.error .task-header { color: #fca5a5; }

.spin {
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid rgba(139,92,246,0.15); border-top-color: #a855f7;
  animation: sp 0.6s linear infinite; flex-shrink: 0;
}
@keyframes sp { to{transform:rotate(360deg)} }

.msg-system {
  text-align: center;
  padding: 8px;
  font-size: 11px;
  color: rgba(226,232,240,0.15);
}

/* ── Input Bar ── */
.input-bar {
  padding: 16px 32px 20px;
  border-top: 1px solid rgba(255,255,255,0.04);
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.input-wrap {
  flex: 1;
  position: relative;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  transition: .2s;
}
.input-wrap:focus-within {
  border-color: rgba(236,72,153,0.2);
  box-shadow: 0 0 12px rgba(236,72,153,0.05);
}
.input-wrap textarea {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: none;
  color: #e2e8f0;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 44px;
  max-height: 160px;
  line-height: 1.5;
}
.input-wrap textarea::placeholder { color: rgba(226,232,240,0.2); }
.input-wrap .voice-indicator {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 8px;
  font-size: 11px;
  color: #ef4444;
}
.input-wrap .voice-indicator.on { display: flex; }
.voice-dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; animation: vPulse 1s ease-in-out infinite; }
@keyframes vPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

.ib {
  width: 40px; height: 40px; border-radius: 12px; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: .15s;
}
.ib.mic-btn {
  background: rgba(255,255,255,0.04);
  color: rgba(226,232,240,0.35);
}
.ib.mic-btn:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
.ib.mic-btn.on { background: rgba(239,68,68,0.12); color: #ef4444; }
.ib.send-btn {
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: white;
}
.ib.send-btn:hover { box-shadow: 0 0 16px rgba(236,72,153,0.3); }
.ib.send-btn:disabled { opacity: 0.3; cursor: default; box-shadow: none; }

svg { display: block; }

/* ── Modal ── */
.modal-bg {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  z-index: 100; align-items: center; justify-content: center;
}
.modal-bg.visible { display: flex; }
.modal {
  background: #12122a; border: 1px solid rgba(236,72,153,0.1);
  border-radius: 20px; padding: 28px; width: 440px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
}
.modal h2 {
  font-size: 18px; font-weight: 600; margin-bottom: 20px;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 10px; color: rgba(226,232,240,0.35); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.field input, .field textarea {
  width: 100%; padding: 10px 14px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; color: #e2e8f0; font-size: 13px; outline: none; font-family: inherit;
}
.field input:focus, .field textarea:focus { border-color: rgba(236,72,153,0.3); }
.field textarea { height: 70px; resize: none; }
.field input::placeholder, .field textarea::placeholder { color: rgba(226,232,240,0.2); }

.emoji-picker { display: flex; gap: 5px; flex-wrap: wrap; }
.emoji-opt {
  width: 34px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; cursor: pointer; border: 2px solid transparent;
  background: rgba(255,255,255,0.03); transition: .15s;
}
.emoji-opt:hover { background: rgba(255,255,255,0.08); }
.emoji-opt.selected { border-color: #ec4899; background: rgba(236,72,153,0.1); }

.color-picker { display: flex; gap: 5px; }
.color-opt {
  width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: .15s;
}
.color-opt:hover { transform: scale(1.15); }
.color-opt.selected { border-color: white; }

.modal-btns { display: flex; justify-content: space-between; margin-top: 20px; }
.btn {
  padding: 10px 22px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: .15s;
}
.btn-primary { background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white; }
.btn-primary:hover { box-shadow: 0 0 20px rgba(236,72,153,0.3); }
.btn-ghost { background: transparent; color: rgba(226,232,240,0.35); }
.btn-ghost:hover { color: #e2e8f0; }
.btn-danger { background: rgba(239,68,68,0.1); color: #fca5a5; }
.btn-danger:hover { background: rgba(239,68,68,0.2); }
</style>
</head>
<body>
<div class="app">
  <!-- Titlebar -->
  <div class="titlebar">
    <div class="dots">
      <div class="dot close" onclick="window.close()"></div>
      <div class="dot min"></div>
      <div class="dot max"></div>
    </div>
    <span class="title">ISIBI Ghost Mode</span>
  </div>

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-top">
      <button class="new-chat-btn" onclick="openCreateAgent()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Agent
      </button>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">Agents</div>
    </div>
    <div class="agent-list" id="agentList"></div>
    <div class="add-agent-btn" onclick="openCreateAgent()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Agent
    </div>
    <div class="sidebar-bottom">
      <div class="settings-row" onclick="toggleSettings()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </div>
      <div class="settings-panel" id="settingsPanel">
        <input id="profileNameInput" placeholder="Assistant name..." maxlength="20">
        <div class="wake-hint" id="wakeHint">Say "Hey Isibi" to activate</div>
        <button class="save-profile-btn" onclick="saveProfile()">Save</button>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="main">
    <div class="chat-area" id="chatArea">
      <div class="chat-empty" id="chatEmpty">
        <div class="orb"></div>
        <div class="hint">What can I help you with?</div>
        <div class="sub">Type a message, use voice, or say your wake word</div>
      </div>
    </div>
    <div class="input-bar">
      <div class="input-wrap">
        <textarea id="input" placeholder="Message your agent..." rows="1"></textarea>
        <div class="voice-indicator" id="voiceIndicator"><div class="voice-dot"></div>Listening...</div>
      </div>
      <button class="ib mic-btn" id="micBtn" title="Voice (F9)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
      <button class="ib send-btn" id="sendBtn" title="Send">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</div>

<!-- Agent Create/Edit Modal -->
<div class="modal-bg" id="modalBg">
  <div class="modal">
    <h2 id="modalTitle">Create Agent</h2>
    <div class="field">
      <label>Emoji</label>
      <div class="emoji-picker" id="emojiPicker"></div>
    </div>
    <div class="field">
      <label>Name</label>
      <input id="agentNameInput" placeholder="e.g. Email Bot">
    </div>
    <div class="field">
      <label>Role</label>
      <input id="agentRoleInput" placeholder="e.g. Handle all email tasks">
    </div>
    <div class="field">
      <label>System Prompt</label>
      <textarea id="agentInstructionsInput" placeholder="e.g. You are an email assistant. When I say send an email, open Gmail, compose, and send it..."></textarea>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-picker" id="colorPicker"></div>
    </div>
    <div class="modal-btns">
      <div><button class="btn btn-danger" id="deleteBtn" style="display:none" onclick="deleteCurrentAgent()">Delete</button></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveAgent()">Save</button>
      </div>
    </div>
  </div>
</div>

<script>
const { ipcRenderer } = require('electron');

// ── State ──
let agents = [];
let selectedAgentId = null;
let chatMessages = [];
let listening = false;
let rec = null;
let voiceReady = false;
let editingAgentId = null;
let selectedEmoji = '';
let selectedColor = '';

const EMOJIS = ['\\ud83d\\udc7b','\\ud83d\\udce7','\\ud83d\\udcc5','\\ud83d\\udcca','\\ud83d\\uded2','\\ud83c\\udfaf','\\ud83d\\ude80','\\ud83d\\udd0d','\\ud83d\\udcdd','\\ud83e\\udd16','\\ud83c\\udf10','\\ud83d\\udcac','\\ud83d\\udcc1','\\ud83c\\udfe2','\\u2699\\ufe0f','\\ud83c\\udfa8'];
const COLORS = ['#ec4899','#8b5cf6','#6366f1','#3b82f6','#22c55e','#eab308','#ef4444','#f97316','#14b8a6','#06b6d4'];

// ── DOM refs ──
const chatArea = document.getElementById('chatArea');
const chatEmpty = document.getElementById('chatEmpty');
const input = document.getElementById('input');
const micBtn = document.getElementById('micBtn');
const sendBtn = document.getElementById('sendBtn');
const voiceIndicator = document.getElementById('voiceIndicator');
const agentListEl = document.getElementById('agentList');

// ── Init ──
async function init() {
  await loadAgents();
  await loadProfile();
  await initVoice();
}

// ── Agents ──
async function loadAgents() {
  agents = await ipcRenderer.invoke('agents-list');
  const active = agents.filter(a => a.isActive);
  if (!selectedAgentId && active.length) selectedAgentId = active[0].id;
  renderAgentList();
}

function renderAgentList() {
  agentListEl.innerHTML = '';
  agents.forEach(a => {
    const el = document.createElement('div');
    el.className = 'agent-item' + (a.id === selectedAgentId ? ' selected' : '');
    el.innerHTML =
      '<span class="emoji">' + a.emoji + '</span>' +
      '<div class="info"><div class="name">' + a.name + '</div><div class="role">' + a.role + '</div></div>' +
      '<div class="dot-status" style="background:' + (a.isActive ? '#22c55e' : '#6b7280') + '"></div>' +
      '<div class="controls">' +
        '<button class="ctrl-btn" title="Edit" data-action="edit">\\u270f</button>' +
        '<button class="ctrl-btn ' + (a.isActive ? 'toggle-on' : 'toggle-off') + '" title="' + (a.isActive ? 'Deactivate' : 'Activate') + '" data-action="toggle">' + (a.isActive ? '\\u25cf' : '\\u25cb') + '</button>' +
        (agents.length > 1 ? '<button class="ctrl-btn del" title="Delete" data-action="delete">\\u2715</button>' : '') +
      '</div>';
    el.onclick = (e) => {
      const action = e.target.closest('[data-action]');
      if (action) {
        e.stopPropagation();
        const act = action.dataset.action;
        if (act === 'edit') openEditAgent(a);
        else if (act === 'toggle') toggleAgentById(a.id);
        else if (act === 'delete') deleteAgentById(a.id);
        return;
      }
      selectedAgentId = a.id; renderAgentList(); updatePlaceholder();
    };
    agentListEl.appendChild(el);
  });
}

async function toggleAgentById(id) {
  await ipcRenderer.invoke('agents-toggle', id);
  loadAgents();
}

async function deleteAgentById(id) {
  if (agents.length <= 1) return;
  await ipcRenderer.invoke('agents-delete', id);
  if (selectedAgentId === id) selectedAgentId = null;
  loadAgents();
}

function updatePlaceholder() {
  const a = agents.find(x => x.id === selectedAgentId);
  input.placeholder = a ? 'Message ' + a.name + '...' : 'Message your agent...';
}

ipcRenderer.on('agents-updated', () => loadAgents());

// ── Chat ──
function clearChat() {
  chatMessages = [];
  renderChat();
}

function renderChat() {
  if (chatMessages.length === 0) {
    chatEmpty.style.display = 'flex';
    // Remove all messages but keep empty
    const msgs = chatArea.querySelectorAll('.msg');
    msgs.forEach(m => m.remove());
    return;
  }
  chatEmpty.style.display = 'none';

  // Build messages
  let html = '';
  chatMessages.forEach((m, i) => {
    if (m.type === 'user') {
      html += '<div class="msg msg-user"><div class="bubble">' + escHtml(m.content) + '</div></div>';
    } else if (m.type === 'agent') {
      const a = agents.find(x => x.id === m.agentId) || { emoji: '\\ud83d\\udc7b', name: 'Ghost' };
      let taskHtml = '';
      if (m.tasks) {
        m.tasks.forEach(t => {
          const cls = t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : '';
          const icon = t.status === 'done' ? '\\u2713' : t.status === 'error' ? '\\u2717' : '<div class="spin"></div>';
          taskHtml += '<div class="task-card ' + cls + '" data-task-id="' + t.id + '">' +
            '<div class="task-header">' + icon + ' ' + escHtml(t.command) + '</div>' +
            '<div class="task-step">' + (t.progress || t.steps + ' steps') + '</div></div>';
        });
      }
      html += '<div class="msg msg-agent"><div class="avatar">' + a.emoji + '</div><div class="body">' +
        '<div class="agent-name">' + a.name + '</div>' +
        '<div class="content">' + escHtml(m.content) + '</div>' +
        taskHtml + '</div></div>';
    } else if (m.type === 'system') {
      html += '<div class="msg msg-system">' + escHtml(m.content) + '</div>';
    }
  });

  // Only replace message area, not chatEmpty
  const existing = chatArea.querySelectorAll('.msg');
  existing.forEach(e => e.remove());
  chatArea.insertAdjacentHTML('beforeend', html);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Send Command ──
async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResize();

  chatMessages.push({ type: 'user', content: text });
  const a = agents.find(x => x.id === selectedAgentId);
  const agentMsg = { type: 'agent', agentId: selectedAgentId, content: 'Thinking...', tasks: null };
  chatMessages.push(agentMsg);
  renderChat();

  const r = await ipcRenderer.invoke('ghost-command', text, selectedAgentId);
  if (r.error) {
    agentMsg.content = r.error;
    renderChat();
    return;
  }

  agentMsg.content = 'Working on it...';
  agentMsg.tasks = r.tasks.map(t => ({ ...t, progress: t.steps + ' steps' }));
  renderChat();
  poll();
}

async function poll() {
  const r = await ipcRenderer.invoke('ghost-status');
  if (r.active) {
    // Update last agent message task progress
    const lastAgent = [...chatMessages].reverse().find(m => m.type === 'agent');
    if (lastAgent && lastAgent.tasks) {
      const t = lastAgent.tasks[0];
      if (t) t.progress = 'Step ' + r.active.step + '/' + r.active.totalSteps + ': ' + r.active.currentAction;
      renderChat();
    }
    setTimeout(poll, 500);
  } else {
    const lastAgent = [...chatMessages].reverse().find(m => m.type === 'agent');
    if (lastAgent) {
      lastAgent.content = 'Done!';
      if (lastAgent.tasks) lastAgent.tasks.forEach(t => t.status = 'done');
      renderChat();
    }
  }
}

// ── Voice Recognition ──
async function initVoice() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const S = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!S) return;
    rec = new S();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = e => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
      autoResize();
      if (e.results[e.results.length - 1].isFinal) { stopMic(); }
    };
    rec.onend = () => { if (listening) stopMic(); };
    rec.onerror = e => {
      stopMic();
      if (e.error === 'no-speech') { /* silent, no big deal */ }
      else if (e.error === 'not-allowed') { console.error('Mic not allowed'); }
    };
    voiceReady = true;
  } catch (err) {
    console.error('Voice init failed:', err);
    voiceReady = false;
  }
}

function startMic() {
  if (!rec || !voiceReady) return;
  listening = true;
  micBtn.classList.add('on');
  voiceIndicator.classList.add('on');
  try { rec.start(); } catch (e) {}
}

function stopMic() {
  listening = false;
  micBtn.classList.remove('on');
  voiceIndicator.classList.remove('on');
  try { rec && rec.stop(); } catch (e) {}
}

micBtn.onclick = () => listening ? stopMic() : startMic();

// IPC voice triggers
ipcRenderer.on('toggle-voice', () => { listening ? stopMic() : startMic(); });
ipcRenderer.on('start-voice', () => { if (!listening) startMic(); });

// ── Input handling ──
input.onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === 'Escape') { if (listening) stopMic(); closeModal(); }
};
sendBtn.onclick = () => send();

function autoResize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoResize);

// ── Settings ──
let settingsVisible = false;
function toggleSettings() {
  settingsVisible = !settingsVisible;
  document.getElementById('settingsPanel').classList.toggle('visible', settingsVisible);
}

async function loadProfile() {
  const name = await ipcRenderer.invoke('get-assistant-name');
  document.getElementById('profileNameInput').value = name;
  document.getElementById('wakeHint').textContent = 'Say "Hey ' + name + '" to activate';
}

document.getElementById('profileNameInput').addEventListener('input', function() {
  const v = this.value.trim() || 'Isibi';
  document.getElementById('wakeHint').textContent = 'Say "Hey ' + v + '" to activate';
});

async function saveProfile() {
  const name = document.getElementById('profileNameInput').value.trim() || 'Isibi';
  await ipcRenderer.invoke('update-assistant-profile', name);
  toggleSettings();
}

ipcRenderer.on('profile-updated', (_, data) => {
  document.getElementById('profileNameInput').value = data.name;
  document.getElementById('wakeHint').textContent = 'Say "Hey ' + data.name + '" to activate';
});

// ── Agent Modal ──
function openCreateAgent() {
  editingAgentId = null;
  selectedEmoji = EMOJIS[0];
  selectedColor = COLORS[0];
  document.getElementById('modalTitle').textContent = 'Create Agent';
  document.getElementById('agentNameInput').value = '';
  document.getElementById('agentRoleInput').value = '';
  document.getElementById('agentInstructionsInput').value = '';
  document.getElementById('deleteBtn').style.display = 'none';
  renderPickers();
  document.getElementById('modalBg').classList.add('visible');
}

function openEditAgent(agent) {
  editingAgentId = agent.id;
  selectedEmoji = agent.emoji;
  selectedColor = agent.color;
  document.getElementById('modalTitle').textContent = 'Edit Agent';
  document.getElementById('agentNameInput').value = agent.name;
  document.getElementById('agentRoleInput').value = agent.role;
  document.getElementById('agentInstructionsInput').value = agent.instructions;
  document.getElementById('deleteBtn').style.display = agents.length > 1 ? 'inline-block' : 'none';
  renderPickers();
  document.getElementById('modalBg').classList.add('visible');
}

function closeModal() {
  document.getElementById('modalBg').classList.remove('visible');
}

function renderPickers() {
  const ep = document.getElementById('emojiPicker');
  ep.innerHTML = '';
  EMOJIS.forEach(e => {
    const opt = document.createElement('div');
    opt.className = 'emoji-opt' + (e === selectedEmoji ? ' selected' : '');
    opt.textContent = e;
    opt.onclick = () => { selectedEmoji = e; renderPickers(); };
    ep.appendChild(opt);
  });

  const cp = document.getElementById('colorPicker');
  cp.innerHTML = '';
  COLORS.forEach(c => {
    const opt = document.createElement('div');
    opt.className = 'color-opt' + (c === selectedColor ? ' selected' : '');
    opt.style.background = c;
    opt.onclick = () => { selectedColor = c; renderPickers(); };
    cp.appendChild(opt);
  });
}

async function saveAgent() {
  const name = document.getElementById('agentNameInput').value.trim();
  const role = document.getElementById('agentRoleInput').value.trim();
  const instructions = document.getElementById('agentInstructionsInput').value.trim();
  if (!name) return;

  if (editingAgentId) {
    await ipcRenderer.invoke('agents-update', editingAgentId, {
      name, emoji: selectedEmoji, role, instructions, color: selectedColor
    });
  } else {
    await ipcRenderer.invoke('agents-create', {
      name, emoji: selectedEmoji,
      role: role || 'General assistant',
      instructions: instructions || 'You are ' + name + ', a helpful AI agent.',
      color: selectedColor
    });
  }
  closeModal();
  loadAgents();
}

async function deleteCurrentAgent() {
  if (!editingAgentId) return;
  await ipcRenderer.invoke('agents-delete', editingAgentId);
  closeModal();
  loadAgents();
}

// ── Boot ──
init();
</script>
</body>
</html>`;
