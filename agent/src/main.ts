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
import { isFirstRun } from './config';
import { createOnboardingWindow, registerOnboardingIPC } from './onboarding';
import { getAgents, getAgent, createAgent, updateAgent, deleteAgent, toggleAgent, getActiveAgents } from './agents';
import { dispatchCommand, getAllAgentStatuses } from './agent-manager';

let mainWindow: BrowserWindow | null = null;
let hubWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let systemIndex: SystemIndex | null = null;

// ── Main Window (Ghost Mode UI) ─────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 140,
    title: 'ISIBI Ghost Mode',
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
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

// ── Agent Hub Window ───────────────────────────────────────────────────

function createHubWindow() {
  if (hubWindow) {
    hubWindow.show();
    hubWindow.focus();
    return;
  }

  hubWindow = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'ISIBI Ghost Mode — Agents',
    frame: false,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0a0015',
  });

  hubWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(AGENT_HUB_HTML)}`);
  hubWindow.on('closed', () => { hubWindow = null; });
}

// ── System Tray ─────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ISIBI Ghost Mode');

  const menu = Menu.buildFromTemplate([
    { label: 'Ghost Mode (F9)', click: () => {
      mainWindow?.center();
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('bar-opened');
    }},
    { label: 'Agent Hub', click: () => createHubWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { (app as any).isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    mainWindow?.center();
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('ghost-resize', (_, height: number) => {
  if (mainWindow) {
    const [w] = mainWindow.getSize();
    mainWindow.setSize(w, height);
    mainWindow.center();
  }
});

ipcMain.handle('ghost-hide', () => {
  mainWindow?.hide();
});

// ── Agent CRUD IPC ─────────────────────────────────────────────────────

ipcMain.handle('agents-list', () => getAgents());

ipcMain.handle('agents-create', (_, data: { name: string; emoji: string; role: string; instructions: string; color: string }) => {
  const agent = createAgent(data);
  // Notify hub if open
  hubWindow?.webContents.send('agents-updated');
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-update', (_, id: string, data: any) => {
  const agent = updateAgent(id, data);
  hubWindow?.webContents.send('agents-updated');
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-delete', (_, id: string) => {
  const ok = deleteAgent(id);
  hubWindow?.webContents.send('agents-updated');
  mainWindow?.webContents.send('agents-updated');
  return ok;
});

ipcMain.handle('agents-toggle', (_, id: string) => {
  const agent = toggleAgent(id);
  hubWindow?.webContents.send('agents-updated');
  mainWindow?.webContents.send('agents-updated');
  return agent;
});

ipcMain.handle('agents-statuses', () => getAllAgentStatuses());

ipcMain.handle('open-hub', () => createHubWindow());

// ── Command & Status IPC ───────────────────────────────────────────────

ipcMain.handle('ghost-command', async (_, command: string, agentId?: string) => {
  if (!systemIndex) {
    return { error: 'System not indexed yet. Please wait...' };
  }

  try {
    // If agentId provided, dispatch to specific agent; otherwise use first active
    const targetId = agentId || getActiveAgents()[0]?.id;
    if (!targetId) return { error: 'No active agents. Open Agent Hub to create one.' };

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

// ── App Lifecycle ───────────────────────────────────────────────────────

function launchGhostMode() {
  createWindow();
  createTray();

  // Show Agent Hub as the main app window on launch
  createHubWindow();

  // Register global shortcut to toggle Ghost Mode voice bar
  const registered = globalShortcut.register('F9', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.center();
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('bar-opened');
    }
  });
  if (!registered) console.error('[Ghost Mode] Failed to register F9 shortcut');
  else console.log('[Ghost Mode] F9 shortcut registered');

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
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyOverlay();
});

// ── Ghost Mode UI (inline HTML) ─────────────────────────────────────────

const GHOST_MODE_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:transparent;color:#f0e6ff;overflow:hidden}
.bar{background:rgba(10,0,21,.95);backdrop-filter:blur(40px) saturate(1.5);border:1px solid rgba(236,72,153,.2);border-radius:20px;margin:8px;box-shadow:0 8px 40px rgba(0,0,0,.5),0 0 20px rgba(236,72,153,.1);display:flex;flex-direction:column;align-items:center;padding:14px 20px;gap:8px}
.orb{width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 38% 38%,#f472b6,#ec4899 40%,#a855f7 70%,#6366f1);box-shadow:0 0 16px rgba(236,72,153,.5);animation:idle 3s ease-in-out infinite;cursor:pointer;flex-shrink:0}
.orb.mic{animation:listen 1s ease-in-out infinite;background:radial-gradient(circle at 38% 38%,#f472b6,#ef4444 40%,#ec4899 70%,#a855f7);box-shadow:0 0 24px rgba(239,68,68,.6)}
.orb.go{animation:pulse .8s ease-in-out infinite;box-shadow:0 0 20px rgba(236,72,153,.7)}
@keyframes idle{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
@keyframes listen{0%,100%{transform:scale(1);box-shadow:0 0 16px rgba(239,68,68,.5)}50%{transform:scale(1.2);box-shadow:0 0 32px rgba(239,68,68,.7)}}
.label{font-size:12px;color:rgba(240,230,255,.35);text-align:center;min-height:16px;transition:.2s}
.label.active{color:#f9a8d4}
.label.error{color:#fca5a5}
.label.done{color:#86efac}
.transcript{font-size:14px;color:#f0e6ff;text-align:center;min-height:18px;font-weight:500;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{display:none;align-items:center;gap:6px;font-size:12px;color:#c4b5fd;padding:4px 12px;border-radius:8px;background:rgba(139,92,246,.06)}
.status.vis{display:flex}
.spin{width:10px;height:10px;border-radius:50%;border:2px solid rgba(139,92,246,.15);border-top-color:#a855f7;animation:sp .6s linear infinite;flex-shrink:0}
@keyframes sp{to{transform:rotate(360deg)}}
.hint{font-size:9px;color:rgba(240,230,255,.15);margin-top:2px}
</style></head><body>
<div class="bar">
<div class="orb" id="orb"></div>
<div class="transcript" id="transcript"></div>
<div class="label" id="label">Press to speak or say a command</div>
<div class="status" id="status"><div class="spin"></div><span id="statusText"></span></div>
<div class="hint">F9 to toggle</div>
</div>
<script>
const{ipcRenderer}=require('electron');
const orb=document.getElementById('orb'),label=document.getElementById('label'),transcript=document.getElementById('transcript'),status=document.getElementById('status'),statusText=document.getElementById('statusText');
let listening=false,rec=null,agents=[],selAgent=null;

async function loadAgents(){agents=await ipcRenderer.invoke('agents-list');const a=agents.filter(x=>x.isActive);if(a.length)selAgent=a[0].id}
ipcRenderer.on('agents-updated',()=>loadAgents());loadAgents();

// Voice recognition setup
(function(){
  const S=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!S){label.textContent='Voice not supported in this browser';return}
  rec=new S();rec.continuous=false;rec.interimResults=true;rec.lang='en-US';
  rec.onresult=e=>{
    let t='';for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;
    transcript.textContent=t;
    if(e.results[e.results.length-1].isFinal){stopMic();sendCommand(t.trim())}
  };
  rec.onend=()=>{if(listening)stopMic()};
  rec.onerror=e=>{stopMic();label.textContent='Could not hear you. Try again.';label.className='label error'}
})();

function startMic(){
  if(!rec)return;listening=true;orb.classList.add('mic');
  label.textContent='Listening...';label.className='label active';
  transcript.textContent='';
  try{rec.start()}catch(e){}
}
function stopMic(){
  listening=false;orb.classList.remove('mic');
  label.textContent='Press to speak or say a command';label.className='label';
  try{rec&&rec.stop()}catch(e){}
}

// Click orb to toggle mic
orb.onclick=()=>listening?stopMic():startMic();

// Auto-start mic when bar opens
ipcRenderer.on('bar-opened',async()=>{
  transcript.textContent='';status.className='status';
  await loadAgents();
  ipcRenderer.invoke('ghost-resize',140);
  setTimeout(()=>startMic(),300)
});

// Send voice command
async function sendCommand(cmd){
  if(!cmd)return;
  orb.classList.add('go');
  label.textContent='Working on it...';label.className='label active';
  status.className='status vis';statusText.textContent='Processing...';
  ipcRenderer.invoke('ghost-resize',160);

  const r=await ipcRenderer.invoke('ghost-command',cmd,selAgent);
  if(r.error){
    orb.classList.remove('go');status.className='status';
    label.textContent=r.error;label.className='label error';
    setTimeout(()=>{ipcRenderer.invoke('ghost-hide');ipcRenderer.invoke('ghost-resize',140)},3000);
    return
  }
  statusText.textContent=r.tasks.map(t=>t.steps+' steps').join(', ');
  poll()
}

async function poll(){
  const r=await ipcRenderer.invoke('ghost-status');
  if(r.active){
    statusText.textContent='Step '+r.active.step+'/'+r.active.totalSteps+': '+r.active.currentAction;
    setTimeout(poll,500)
  }else{
    orb.classList.remove('go');status.className='status';
    label.textContent='Done!';label.className='label done';
    transcript.textContent='';
    setTimeout(()=>{ipcRenderer.invoke('ghost-hide');ipcRenderer.invoke('ghost-resize',140)},2000)
  }
}

// Escape to hide
document.onkeydown=e=>{if(e.key==='Escape'){stopMic();ipcRenderer.invoke('ghost-hide')}}
</script></body></html>`;

// ── Agent Hub UI (inline HTML) ─────────────────────────────────────────

const AGENT_HUB_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, system-ui, sans-serif;
  background: #0a0015;
  color: #f0e6ff;
  height: 100vh;
  overflow: hidden;
  -webkit-app-region: drag;
}

.hub {
  height: 100%; display: flex; flex-direction: column;
}

/* ── Title bar ── */
.titlebar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
}
.titlebar .dots { display: flex; gap: 6px; }
.dot { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; -webkit-app-region: no-drag; }
.dot.close { background: #ef4444; }
.dot.close:hover { background: #dc2626; }
.dot.min { background: #eab308; }
.dot.max { background: #22c55e; }
.titlebar h1 {
  font-size: 16px; font-weight: 700;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.titlebar .spacer { width: 60px; }

/* ── Agent Grid ── */
.grid-container {
  flex: 1; overflow-y: auto; padding: 8px 20px 20px;
  -webkit-app-region: no-drag;
}
.grid-container::-webkit-scrollbar { width: 4px; }
.grid-container::-webkit-scrollbar-thumb { background: rgba(236,72,153,.2); border-radius: 2px; }

.grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}

.agent-card {
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 16px; padding: 20px; cursor: pointer;
  transition: all 0.2s; position: relative;
}
.agent-card:hover {
  background: rgba(255,255,255,.06);
  border-color: rgba(236,72,153,.2);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,.3);
}
.agent-card .emoji { font-size: 32px; margin-bottom: 8px; }
.agent-card .name { font-size: 14px; font-weight: 600; color: #f0e6ff; margin-bottom: 4px; }
.agent-card .role { font-size: 11px; color: rgba(240,230,255,.35); line-height: 1.4; }
.agent-card .status-dot {
  position: absolute; top: 14px; right: 14px;
  width: 8px; height: 8px; border-radius: 50%;
}
.agent-card .toggle {
  position: absolute; bottom: 12px; right: 14px;
  font-size: 10px; padding: 3px 8px; border-radius: 6px;
  border: none; cursor: pointer; -webkit-app-region: no-drag;
  transition: all 0.15s;
}
.toggle.on { background: rgba(34,197,94,.15); color: #86efac; }
.toggle.off { background: rgba(239,68,68,.1); color: #fca5a5; }
.toggle:hover { filter: brightness(1.2); }

/* ── Create Card ── */
.create-card {
  background: rgba(255,255,255,.02);
  border: 2px dashed rgba(255,255,255,.08);
  border-radius: 16px; padding: 20px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.2s; min-height: 140px;
}
.create-card:hover {
  border-color: rgba(236,72,153,.3);
  background: rgba(236,72,153,.04);
}
.create-card .plus { font-size: 28px; color: rgba(240,230,255,.2); margin-bottom: 6px; }
.create-card .label { font-size: 13px; color: rgba(240,230,255,.3); }

/* ── Modal ── */
.modal-bg {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
  z-index: 100; align-items: center; justify-content: center;
  -webkit-app-region: no-drag;
}
.modal-bg.visible { display: flex; }
.modal {
  background: #120826; border: 1px solid rgba(236,72,153,.15);
  border-radius: 20px; padding: 28px; width: 420px;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
}
.modal h2 {
  font-size: 18px; font-weight: 600; margin-bottom: 20px;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 11px; color: rgba(240,230,255,.4); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.field input, .field textarea {
  width: 100%; padding: 10px 14px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-radius: 10px; color: #f0e6ff; font-size: 13px; outline: none;
  font-family: inherit;
}
.field input:focus, .field textarea:focus {
  border-color: rgba(236,72,153,.3); box-shadow: 0 0 12px rgba(236,72,153,.1);
}
.field textarea { height: 70px; resize: none; }
.field input::placeholder, .field textarea::placeholder { color: rgba(240,230,255,.2); }

.emoji-picker {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.emoji-opt {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer; border: 2px solid transparent;
  background: rgba(255,255,255,.03); transition: all 0.15s;
}
.emoji-opt:hover { background: rgba(255,255,255,.08); }
.emoji-opt.selected { border-color: #ec4899; background: rgba(236,72,153,.1); }

.color-picker { display: flex; gap: 6px; }
.color-opt {
  width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: all 0.15s;
}
.color-opt:hover { transform: scale(1.15); }
.color-opt.selected { border-color: white; }

.modal-btns {
  display: flex; justify-content: space-between; margin-top: 20px;
}
.btn {
  padding: 10px 24px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-primary {
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: white; box-shadow: 0 0 16px rgba(236,72,153,.25);
}
.btn-primary:hover { box-shadow: 0 0 24px rgba(236,72,153,.4); }
.btn-ghost { background: transparent; color: rgba(240,230,255,.4); }
.btn-ghost:hover { color: #f0e6ff; }
.btn-danger { background: rgba(239,68,68,.1); color: #fca5a5; }
.btn-danger:hover { background: rgba(239,68,68,.2); }
</style>
</head>
<body>
<div class="hub">
  <div class="titlebar">
    <div class="dots">
      <div class="dot close" onclick="window.close()"></div>
      <div class="dot min"></div>
      <div class="dot max"></div>
    </div>
    <h1>Your Agents</h1>
    <div class="spacer"></div>
  </div>
  <div class="grid-container">
    <div class="grid" id="grid"></div>
  </div>
</div>

<!-- Create/Edit Modal -->
<div class="modal-bg" id="modalBg">
  <div class="modal">
    <h2 id="modalTitle">Create Agent</h2>
    <div class="field">
      <label>Emoji</label>
      <div class="emoji-picker" id="emojiPicker"></div>
    </div>
    <div class="field">
      <label>Name</label>
      <input id="nameInput" placeholder="e.g. Email Bot">
    </div>
    <div class="field">
      <label>Role (short)</label>
      <input id="roleInput" placeholder="e.g. Handle all email tasks">
    </div>
    <div class="field">
      <label>Instructions (detailed)</label>
      <textarea id="instructionsInput" placeholder="e.g. You manage my Gmail. When I say send an email, open Gmail, compose a new email..."></textarea>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-picker" id="colorPicker"></div>
    </div>
    <div class="modal-btns">
      <div>
        <button class="btn btn-danger" id="deleteBtn" style="display:none" onclick="deleteCurrentAgent()">Delete</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveAgent()">Save</button>
      </div>
    </div>
  </div>
</div>

<script>
const { ipcRenderer } = require('electron');

const EMOJIS = ['\\ud83d\\udc7b','\\ud83d\\udce7','\\ud83d\\udcc5','\\ud83d\\udcca','\\ud83d\\uded2','\\ud83c\\udfaf','\\ud83d\\ude80','\\ud83d\\udd0d','\\ud83d\\udcdd','\\ud83e\\udd16','\\ud83c\\udf10','\\ud83d\\udcac','\\ud83d\\udcc1','\\ud83c\\udfe2','\\u2699\\ufe0f','\\ud83c\\udfa8'];
const COLORS = ['#ec4899','#8b5cf6','#6366f1','#3b82f6','#22c55e','#eab308','#ef4444','#f97316','#14b8a6','#06b6d4'];

let agents = [];
let editingId = null;
let selectedEmoji = EMOJIS[0];
let selectedColor = COLORS[0];

// ── Render ──
async function loadAgents() {
  agents = await ipcRenderer.invoke('agents-list');
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  agents.forEach(a => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.onclick = () => openEdit(a);
    card.innerHTML =
      '<div class="status-dot" style="background:' + (a.isActive ? '#22c55e' : '#6b7280') + '"></div>' +
      '<div class="emoji">' + a.emoji + '</div>' +
      '<div class="name">' + a.name + '</div>' +
      '<div class="role">' + a.role + '</div>' +
      '<button class="toggle ' + (a.isActive ? 'on' : 'off') + '" onclick="event.stopPropagation(); toggleA(\\'' + a.id + '\\')">' +
      (a.isActive ? 'Active' : 'Off') + '</button>';
    grid.appendChild(card);
  });

  // Create card
  const create = document.createElement('div');
  create.className = 'create-card';
  create.onclick = () => openCreate();
  create.innerHTML = '<div class="plus">+</div><div class="label">Create Agent</div>';
  grid.appendChild(create);
}

// ── Modal ──
function openCreate() {
  editingId = null;
  selectedEmoji = EMOJIS[0];
  selectedColor = COLORS[0];
  document.getElementById('modalTitle').textContent = 'Create Agent';
  document.getElementById('nameInput').value = '';
  document.getElementById('roleInput').value = '';
  document.getElementById('instructionsInput').value = '';
  document.getElementById('deleteBtn').style.display = 'none';
  renderPickers();
  document.getElementById('modalBg').classList.add('visible');
}

function openEdit(agent) {
  editingId = agent.id;
  selectedEmoji = agent.emoji;
  selectedColor = agent.color;
  document.getElementById('modalTitle').textContent = 'Edit Agent';
  document.getElementById('nameInput').value = agent.name;
  document.getElementById('roleInput').value = agent.role;
  document.getElementById('instructionsInput').value = agent.instructions;
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
  const name = document.getElementById('nameInput').value.trim();
  const role = document.getElementById('roleInput').value.trim();
  const instructions = document.getElementById('instructionsInput').value.trim();

  if (!name) return;

  if (editingId) {
    await ipcRenderer.invoke('agents-update', editingId, {
      name, emoji: selectedEmoji, role, instructions, color: selectedColor
    });
  } else {
    await ipcRenderer.invoke('agents-create', {
      name, emoji: selectedEmoji, role: role || 'General assistant',
      instructions: instructions || 'You are ' + name + ', a helpful AI agent.',
      color: selectedColor
    });
  }

  closeModal();
  loadAgents();
}

async function deleteCurrentAgent() {
  if (!editingId) return;
  await ipcRenderer.invoke('agents-delete', editingId);
  closeModal();
  loadAgents();
}

async function toggleA(id) {
  await ipcRenderer.invoke('agents-toggle', id);
  loadAgents();
}

ipcRenderer.on('agents-updated', () => loadAgents());
loadAgents();
</script>
</body>
</html>`;
