/**
 * ISIBI Ghost Mode — Main Entry Point
 *
 * A futuristic AI agent that controls your computer.
 * Claude-like desktop app with sidebar, chat, and voice.
 */

import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Suppress macOS screen recording permission popup — we use screencapture CLI instead
app.commandLine.appendSwitch('disable-features', 'DesktopCapture,DesktopCaptureMonitor');
app.commandLine.appendSwitch('disable-usb-keyboard-detect');
import { buildIndex, loadIndex, refreshIndex, SystemIndex } from './indexer';
import { processCommand, getTaskQueue, getActiveTask } from './brain';
import { createOverlay, destroyOverlay } from './overlay';
import { isFirstRun, loadConfig, saveConfig, getWakeWord, getAssistantName, getLanguage, getElevenLabsKey, getSelectedVoiceId, getSchedules, saveSchedule, deleteSchedule, ScheduledTask, getCredits, getStripeKey, addCredits, setActiveUser } from './config';
import { loadAnalytics, getAnalytics } from './analytics';
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

  // Auto-grant all permissions (microphone, camera, etc.) in renderer
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => { callback(true); }
  );
  mainWindow.webContents.session.setPermissionCheckHandler(
    () => true
  );

  // Write HTML to temp file — loadFile is more reliable than data: URL in Electron 28
  const appDir = app.getPath('userData');
  if (!require('fs').existsSync(appDir)) require('fs').mkdirSync(appDir, { recursive: true });
  const appHtmlPath = require('path').join(appDir, 'app.html');
  require('fs').writeFileSync(appHtmlPath, APP_HTML, 'utf-8');
  console.log('[Main] HTML written to:', appHtmlPath, '(' + APP_HTML.length + ' chars)');
  mainWindow.loadFile(appHtmlPath);

  // Log renderer console errors to main process
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[Renderer ERROR]', message);
  });
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
  listenerWindow.webContents.session.setPermissionCheckHandler(
    () => true
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
ipcMain.handle('get-language', () => getLanguage());
ipcMain.handle('save-language', (_, lang: string) => {
  saveConfig({ language: lang });
  return true;
});

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
  // Always ensure index is ready
  if (!systemIndex) {
    try { systemIndex = loadIndex(); } catch {}
    if (!systemIndex) { try { systemIndex = buildIndex(); } catch {} }
    if (!systemIndex) {
      // Minimal fallback index so commands don't block
      systemIndex = { apps: [], recentFiles: [], bookmarks: [], runningProcesses: [], browserTabs: [], systemInfo: { hostname: '', username: '', osVersion: '', shell: '', defaultBrowser: '', screenResolution: '', memoryGB: 0, cpuModel: '' }, desktopFiles: [], scannedAt: new Date().toISOString(), platform: process.platform } as any;
    }
  }
  try {
    const targetId = agentId || getActiveAgents()[0]?.id;
    if (!targetId) return { error: 'No active agents. Create one in the sidebar.' };

    const plans = await dispatchCommand(targetId, command, systemIndex!);
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

// ── Live Screenshot IPC ───────────────────────────────────────────────

ipcMain.handle('capture-screen-thumbnail', async () => {
  try {
    const { execSync } = require('child_process');
    const tmpFile = require('path').join(require('os').tmpdir(), `isibi-thumb-${Date.now()}.jpg`);
    execSync(`screencapture -x -C -t jpg ${tmpFile}`, { timeout: 3000 });
    // Resize to small thumbnail (480px wide) for performance
    try { execSync(`sips --resampleWidth 480 ${tmpFile} --setProperty formatOptions 40`, { timeout: 3000 }); } catch {}
    const buffer = require('fs').readFileSync(tmpFile);
    try { require('fs').unlinkSync(tmpFile); } catch {}
    return 'data:image/jpeg;base64,' + buffer.toString('base64');
  } catch { return null; }
});

// ── Schedule IPC ──────────────────────────────────────────────────────

ipcMain.handle('schedules-list', () => getSchedules());

ipcMain.handle('schedules-create', (_, data: { agentId: string; command: string; cron: string; label?: string }) => {
  const schedule: ScheduledTask = {
    id: Math.random().toString(36).slice(2, 8),
    agentId: data.agentId,
    command: data.command,
    cron: data.cron,
    enabled: true,
    label: data.label,
  };
  saveSchedule(schedule);
  return schedule;
});

ipcMain.handle('schedules-update', (_, id: string, data: Partial<ScheduledTask>) => {
  const schedules = getSchedules();
  const existing = schedules.find(s => s.id === id);
  if (existing) {
    Object.assign(existing, data);
    saveSchedule(existing);
    return existing;
  }
  return null;
});

ipcMain.handle('schedules-delete', (_, id: string) => {
  deleteSchedule(id);
  return true;
});

ipcMain.handle('schedules-toggle', (_, id: string) => {
  const schedules = getSchedules();
  const s = schedules.find(sc => sc.id === id);
  if (s) { s.enabled = !s.enabled; saveSchedule(s); return s; }
  return null;
});

// ── History IPC ──────────────────────────────────────────────────────

const historyPath = () => require('path').join(app.getPath('userData'), 'command-history.json');

ipcMain.handle('history-add', (_, entry: { command: string; agentName: string; status: string; steps: number; timestamp: string }) => {
  try {
    const fp = historyPath();
    const history = require('fs').existsSync(fp) ? JSON.parse(require('fs').readFileSync(fp, 'utf-8')) : [];
    history.push(entry);
    if (history.length > 200) history.shift();
    require('fs').writeFileSync(fp, JSON.stringify(history));
  } catch {}
  return true;
});

ipcMain.handle('history-list', () => {
  try {
    const fp = historyPath();
    if (require('fs').existsSync(fp)) return JSON.parse(require('fs').readFileSync(fp, 'utf-8'));
  } catch {}
  return [];
});

ipcMain.handle('history-clear', () => {
  try { require('fs').writeFileSync(historyPath(), '[]'); } catch {}
  return true;
});

// ── Chat Persistence IPC ──────────────────────────────────────────────

const chatDir = () => {
  const { getActiveUser } = require('./config');
  const userDir = getActiveUser() ? getActiveUser().replace(/[^a-zA-Z0-9@.-]/g, '_') : 'default';
  const d = require('path').join(app.getPath('userData'), 'chats', userDir);
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true });
  return d;
};

ipcMain.handle('chat-save', (_, agentId: string, messages: any[]) => {
  try {
    const fp = require('path').join(chatDir(), agentId + '.json');
    require('fs').writeFileSync(fp, JSON.stringify(messages.slice(-50))); // Keep last 50
  } catch {}
  return true;
});

ipcMain.handle('chat-load', (_, agentId: string) => {
  try {
    const fp = require('path').join(chatDir(), agentId + '.json');
    if (require('fs').existsSync(fp)) return JSON.parse(require('fs').readFileSync(fp, 'utf-8'));
  } catch {}
  return [];
});

// ── Ghost Auth IPC ────────────────────────────────────────────────────

const GHOST_API = 'https://isibi-backend.onrender.com/api/ghost';

ipcMain.handle('ghost-signup', async (_, email: string, name: string, password: string) => {
  const https = require('https');
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email, name, password });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/signup', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.token) {
            setActiveUser(json.email); // Switch to this user's config
            saveConfig({ userEmail: json.email, userName: json.name, userLoggedIn: true, userCreatedAt: new Date().toISOString(), credits: json.credits });
            (global as any).__ghostToken = json.token;
          }
          resolve(json);
        } catch { resolve({ detail: 'Server error' }); }
      });
    });
    req.on('error', (e: any) => resolve({ detail: e.message }));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-login', async (_, email: string, password: string, trustDevice: boolean = false) => {
  const https = require('https');
  const os2 = require('os');
  const crypto2 = require('crypto');
  const deviceId = crypto2.createHash('sha256').update(os2.hostname() + ':' + os2.userInfo().username).digest('hex').slice(0, 16);
  const deviceName = os2.hostname();
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email, password, device_id: deviceId, device_name: deviceName, trust_device: trustDevice });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.token) {
            setActiveUser(json.email); // Switch to this user's config
            saveConfig({ userEmail: json.email, userName: json.name, userLoggedIn: true, credits: json.credits });
            (global as any).__ghostToken = json.token;
          }
          resolve(json);
        } catch { resolve({ detail: 'Server error' }); }
      });
    });
    req.on('error', (e: any) => resolve({ detail: e.message }));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-verify', async (_, email: string, code: string) => {
  const https = require('https');
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email, code });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/verify', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.token) {
            setActiveUser(json.email);
            saveConfig({ userEmail: json.email, userName: json.name, userLoggedIn: true, credits: json.credits });
            (global as any).__ghostToken = json.token;
          }
          resolve(json);
        } catch { resolve({ detail: 'Server error' }); }
      });
    });
    req.on('error', (e: any) => resolve({ detail: e.message }));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-resend', async (_, email: string) => {
  const https = require('https');
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/resend', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => { let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
    req.on('error', () => resolve({}));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-forgot', async (_, email: string) => {
  const https = require('https');
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/forgot', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => { let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
    req.on('error', () => resolve({}));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-reset', async (_, email: string, code: string, newPassword: string) => {
  const https = require('https');
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email, code, new_password: newPassword });
    const req = https.request({
      hostname: 'isibi-backend.onrender.com', path: '/api/ghost/reset', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res: any) => { let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
    req.on('error', () => resolve({}));
    req.write(postData); req.end();
  });
});

ipcMain.handle('ghost-logout', () => {
  saveConfig({ userEmail: '', userName: '', userLoggedIn: false });
  (global as any).__ghostToken = null;
  return true;
});

ipcMain.handle('ghost-is-logged-in', () => {
  return loadConfig().userLoggedIn === true;
});

ipcMain.handle('ghost-get-user', () => {
  const c = loadConfig();
  return c.userLoggedIn ? { email: c.userEmail, name: c.userName } : null;
});

// ── Stripe Payment IPC ────────────────────────────────────────────────

const CREDIT_PLANS = [
  { id: 'credits_500', name: '500 Credits', credits: 500, priceInCents: 999, description: 'Good for light use' },
  { id: 'credits_2000', name: '2,000 Credits', credits: 2000, priceInCents: 2999, description: 'Most popular' },
  { id: 'credits_5000', name: '5,000 Credits', credits: 5000, priceInCents: 5999, description: 'Best value' },
  { id: 'credits_20000', name: '20,000 Credits', credits: 20000, priceInCents: 19999, description: 'Power user' },
];

ipcMain.handle('stripe-plans', () => CREDIT_PLANS);

ipcMain.handle('stripe-checkout', async (_, planId: string) => {
  const plan = CREDIT_PLANS.find(p => p.id === planId);
  if (!plan) return { error: 'Plan not found' };

  const https = require('https');
  const stripeKey = getStripeKey();

  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': plan.name + ' — ISIBI Ghost Mode',
      'line_items[0][price_data][unit_amount]': String(plan.priceInCents),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': 'https://isibi.ai/payment-success?credits=' + plan.credits,
      'cancel_url': 'https://isibi.ai/payment-cancel',
      'metadata[credits]': String(plan.credits),
      'metadata[plan_id]': plan.id,
    }).toString();

    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.url) {
            // Open checkout in browser
            require('electron').shell.openExternal(json.url);
            // Optimistically add credits (in production, verify via webhook)
            addCredits(plan.credits);
            saveConfig({ plan: plan.credits >= 5000 ? 'pro' : plan.credits >= 2000 ? 'standard' : 'starter' });
            resolve({ success: true, url: json.url, credits: plan.credits });
          } else {
            resolve({ error: json.error?.message || 'Checkout failed' });
          }
        } catch (e: any) { resolve({ error: e.message }); }
      });
    });
    req.on('error', (e: any) => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
});

// ── Usage & Credits IPC ───────────────────────────────────────────────

ipcMain.handle('get-credits', () => getCredits());
ipcMain.handle('get-agent-usage', () => {
  const config = loadConfig();
  return (config.agents || []).map(a => ({
    id: a.id, name: a.name, emoji: a.emoji, color: a.color,
    creditsUsed: a.creditsUsed || 0, commandCount: a.commandCount || 0, actionCount: a.actionCount || 0,
  }));
});

// ── Analytics & Performance IPC ────────────────────────────────────────

ipcMain.handle('get-analytics', () => getAnalytics());
ipcMain.handle('get-performance', () => {
  const analytics = getAnalytics();
  const agentUsage = loadConfig().agents?.map(a => ({
    name: a.name, emoji: a.emoji,
    commands: a.commandCount || 0,
    actions: a.actionCount || 0,
    credits: a.creditsUsed || 0,
    avgActionsPerCommand: (a.commandCount || 0) > 0 ? ((a.actionCount || 0) / (a.commandCount || 0)).toFixed(1) : '0',
  })) || [];
  return { ...analytics, agentPerformance: agentUsage };
});

// ── ElevenLabs Voice IPC ──────────────────────────────────────────────

import * as ctrl from './controller';

ipcMain.handle('eleven-list-voices', async () => {
  return ctrl.elevenLabsListVoices(getElevenLabsKey());
});

ipcMain.handle('eleven-clone-voice', async (_, name: string, description: string, filePaths: string[]) => {
  return ctrl.elevenLabsCloneVoice(getElevenLabsKey(), name, description, filePaths);
});

ipcMain.handle('eleven-delete-voice', async (_, voiceId: string) => {
  return ctrl.elevenLabsDeleteVoice(getElevenLabsKey(), voiceId);
});

ipcMain.handle('eleven-preview-voice', async (_, voiceId: string, text: string) => {
  const audioPath = await ctrl.elevenLabsTTS(getElevenLabsKey(), voiceId, text);
  if (audioPath) {
    require('child_process').execSync(`afplay "${audioPath}"`, { timeout: 30000 });
    try { require('fs').unlinkSync(audioPath); } catch {}
  }
  return true;
});

ipcMain.handle('eleven-set-voice', (_, voiceId: string) => {
  saveConfig({ selectedVoiceId: voiceId });
  return true;
});

ipcMain.handle('eleven-get-selected', () => getSelectedVoiceId());

ipcMain.handle('eleven-upload-audio', async (event) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'] }]
  });
  return result.filePaths || [];
});

// ── Agent Question Response IPC ────────────────────────────────────────

ipcMain.handle('agent-response', (_, text: string) => {
  (global as any).__userResponse = text;
  return true;
});

// ── Call Transcription IPC ─────────────────────────────────────────────

ipcMain.handle('call-transcription', (_, text: string) => {
  // Store transcription for the AI call handler to read
  (global as any).__lastCallTranscription = text;
  console.log('[Call] Transcription received:', text);
  return true;
});

// ── App Lifecycle ──────────────────────────────────────────────────────

function launchGhostMode() {
  createMainWindow();
  // Store global reference so brain.ts AI call handler can send IPC to renderer
  (global as any).__mainWindow = mainWindow;
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

  // Start scheduler — check every 60 seconds
  setInterval(() => {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName = dayNames[now.getDay()];

    const schedules = getSchedules();
    for (const s of schedules) {
      if (!s.enabled) continue;
      let shouldRun = false;

      if (s.cron.match(/^\d{2}:\d{2}$/)) {
        // Daily at HH:MM
        shouldRun = s.cron === hhmm;
      } else if (s.cron.startsWith('interval:')) {
        // Every N minutes
        const mins = parseInt(s.cron.split(':')[1]);
        if (mins > 0) {
          const lastRun = s.lastRun ? new Date(s.lastRun).getTime() : 0;
          shouldRun = (now.getTime() - lastRun) >= mins * 60000;
        }
      } else {
        // "weekday HH:MM" format
        const parts = s.cron.split(' ');
        if (parts.length === 2 && parts[0].toLowerCase() === dayName && parts[1] === hhmm) {
          shouldRun = true;
        }
        // "weekdays HH:MM" for Mon-Fri
        if (parts[0] === 'weekdays' && parts[1] === hhmm && now.getDay() >= 1 && now.getDay() <= 5) {
          shouldRun = true;
        }
      }

      // Prevent running same schedule twice in same minute
      if (shouldRun && s.lastRun) {
        const lastRunMin = s.lastRun.slice(0, 16); // YYYY-MM-DDTHH:MM
        const nowMin = now.toISOString().slice(0, 16);
        if (lastRunMin === nowMin) shouldRun = false;
      }

      if (shouldRun && systemIndex) {
        console.log('[Scheduler] Running:', s.label || s.command, 'for agent', s.agentId);
        s.lastRun = now.toISOString();
        saveSchedule(s);
        // Dispatch the command
        dispatchCommand(s.agentId, s.command, systemIndex).catch(e => {
          console.error('[Scheduler] Error:', e.message);
        });
        // Notify user
        mainWindow?.webContents.send('schedule-ran', { label: s.label || s.command, agentId: s.agentId });
      }
    }
  }, 60000); // Check every minute
}

function createLoginWindow(onSuccess: () => void) {
  const loginWin = new BrowserWindow({
    width: 420, height: 520, resizable: false, center: true, frame: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: '#0f0f1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
  });

  const LOGIN_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:;"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0f0f1a;color:#e2e8f0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-app-region:drag}
.card{-webkit-app-region:no-drag;width:340px;text-align:center}
.orb{width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 38% 38%,#f472b6,#ec4899 40%,#a855f7 70%,#6366f1);box-shadow:0 0 24px rgba(236,72,153,0.3);margin:0 auto 16px;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#ec4899,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
.sub{font-size:12px;color:rgba(226,232,240,0.5);margin-bottom:24px}
.tabs{display:flex;gap:2px;margin-bottom:16px;background:rgba(255,255,255,0.03);border-radius:10px;padding:3px}
.tab{flex:1;padding:8px;border:none;border-radius:8px;background:transparent;color:rgba(226,232,240,0.5);font-size:12px;font-weight:600;cursor:pointer}
.tab.active{background:rgba(236,72,153,0.1);color:#f9a8d4}
input{width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none;margin-bottom:10px;font-family:inherit}
input:focus{border-color:rgba(236,72,153,0.3)}
input::placeholder{color:rgba(226,232,240,0.3)}
.btn{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:white;font-size:14px;font-weight:600;cursor:pointer;margin-top:6px}
.btn:hover{box-shadow:0 0 20px rgba(236,72,153,0.3)}
.err{color:#ef4444;font-size:11px;margin-top:8px;min-height:16px}
.skip{color:rgba(226,232,240,0.3);font-size:11px;cursor:pointer;margin-top:16px;text-decoration:underline}
.skip:hover{color:rgba(226,232,240,0.5)}
</style></head><body>
<div class="card">
  <div class="orb"></div>
  <h1>ISIBI Ghost Mode</h1>
  <div class="sub">AI agents that control your computer</div>
  <div class="tabs">
    <button class="tab active" id="tabLogin" onclick="switchTab('login')">Log In</button>
    <button class="tab" id="tabSignup" onclick="switchTab('signup')">Sign Up</button>
  </div>
  <div id="loginForm">
    <input id="loginEmail" placeholder="Email" type="email">
    <input id="loginPassword" placeholder="Password" type="password">
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:8px;cursor:pointer">
      <input type="checkbox" id="trustDevice" style="accent-color:#ec4899"> Remember this device
    </label>
    <button class="btn" onclick="doLogin()">Log In</button>
  </div>
  <div id="signupForm" style="display:none">
    <input id="signupName" placeholder="Full name">
    <input id="signupEmail" placeholder="Email" type="email">
    <input id="signupPassword" placeholder="Password (min 6 characters)" type="password">
    <button class="btn" onclick="doSignup()">Create Account</button>
  </div>
  <div id="verifyForm" style="display:none">
    <div style="font-size:13px;color:rgba(226,232,240,0.6);margin-bottom:12px">Enter the 6-digit code sent to your email</div>
    <input id="verifyCode" placeholder="000000" maxlength="6" style="text-align:center;font-size:24px;letter-spacing:8px;font-weight:700">
    <button class="btn" onclick="doVerify()">Verify Email</button>
    <div style="margin-top:10px;font-size:11px;color:rgba(226,232,240,0.3);cursor:pointer" onclick="doResend()">Resend code</div>
  </div>
  <div id="forgotForm" style="display:none">
    <input id="forgotEmail" placeholder="Email" type="email">
    <button class="btn" onclick="doForgot()">Send Reset Code</button>
    <div style="margin-top:10px;font-size:11px;color:rgba(226,232,240,0.3);cursor:pointer" onclick="switchTab('login')">Back to login</div>
  </div>
  <div id="resetForm" style="display:none">
    <input id="resetCode" placeholder="6-digit code" maxlength="6" style="text-align:center;font-size:20px;letter-spacing:6px">
    <input id="resetPassword" placeholder="New password (min 6 characters)" type="password">
    <button class="btn" onclick="doReset()">Reset Password</button>
  </div>
  <div class="err" id="errMsg"></div>
  <div id="forgotLink" style="margin-top:12px;font-size:11px;color:rgba(226,232,240,0.3);cursor:pointer" onclick="switchTab('forgot')">Forgot password?</div>
</div>
<script>
const{ipcRenderer}=require('electron');
let verifyEmail = '';
let resetEmail = '';
function switchTab(t){
  document.getElementById('loginForm').style.display=t==='login'?'block':'none';
  document.getElementById('signupForm').style.display=t==='signup'?'block':'none';
  document.getElementById('verifyForm').style.display=t==='verify'?'block':'none';
  document.getElementById('forgotForm').style.display=t==='forgot'?'block':'none';
  document.getElementById('resetForm').style.display=t==='reset'?'block':'none';
  document.getElementById('forgotLink').style.display=(t==='login')?'block':'none';
  document.querySelector('.tabs').style.display=(t==='login'||t==='signup')?'flex':'none';
  if(t==='login'||t==='signup'){
    document.getElementById('tabLogin').className='tab'+(t==='login'?' active':'');
    document.getElementById('tabSignup').className='tab'+(t==='signup'?' active':'');
  }
  document.getElementById('errMsg').textContent='';
}
async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pw=document.getElementById('loginPassword').value;
  if(!email||!pw){document.getElementById('errMsg').textContent='Please fill in all fields';return}
  document.querySelector('#loginForm .btn').textContent='Logging in...';
  const trust=document.getElementById('trustDevice').checked;
  const r=await ipcRenderer.invoke('ghost-login',email,pw,trust);
  if(r.token==='needs_verification'){
    verifyEmail=email;
    switchTab('verify');
    document.getElementById('errMsg').textContent='Please verify your email first. Check your inbox.';
  } else if(r.token){
    ipcRenderer.invoke('login-success');
  } else {
    document.getElementById('errMsg').textContent=r.detail||'Login failed';
    document.querySelector('#loginForm .btn').textContent='Log In';
  }
}
async function doSignup(){
  const name=document.getElementById('signupName').value.trim();
  const email=document.getElementById('signupEmail').value.trim();
  const pw=document.getElementById('signupPassword').value;
  if(!name||!email||!pw){document.getElementById('errMsg').textContent='Please fill in all fields';return}
  if(pw.length<6){document.getElementById('errMsg').textContent='Password must be at least 6 characters';return}
  document.querySelector('#signupForm .btn').textContent='Creating account...';
  const r=await ipcRenderer.invoke('ghost-signup',email,name,pw);
  if(r.token){
    ipcRenderer.invoke('login-success');
  } else {
    document.getElementById('errMsg').textContent=r.detail||'Signup failed';
    document.querySelector('#signupForm .btn').textContent='Create Account';
  }
}
async function doVerify(){
  const code=document.getElementById('verifyCode').value.trim();
  if(code.length!==6){document.getElementById('errMsg').textContent='Enter 6-digit code';return}
  document.querySelector('#verifyForm .btn').textContent='Verifying...';
  const r=await ipcRenderer.invoke('ghost-verify',verifyEmail,code);
  if(r.token){ipcRenderer.invoke('login-success')}
  else{document.getElementById('errMsg').textContent=r.detail||'Invalid code';document.querySelector('#verifyForm .btn').textContent='Verify Email'}
}
async function doResend(){
  await ipcRenderer.invoke('ghost-resend',verifyEmail);
  document.getElementById('errMsg').textContent='New code sent!';
}
async function doForgot(){
  const email=document.getElementById('forgotEmail').value.trim();
  if(!email){document.getElementById('errMsg').textContent='Enter your email';return}
  resetEmail=email;
  await ipcRenderer.invoke('ghost-forgot',email);
  switchTab('reset');
  document.getElementById('errMsg').textContent='If that email exists, a reset code was sent';
}
async function doReset(){
  const code=document.getElementById('resetCode').value.trim();
  const pw=document.getElementById('resetPassword').value;
  if(code.length!==6||pw.length<6){document.getElementById('errMsg').textContent='Enter code and new password (min 6 chars)';return}
  const r=await ipcRenderer.invoke('ghost-reset',resetEmail,code,pw);
  if(r.message){switchTab('login');document.getElementById('errMsg').textContent='Password reset! Log in with your new password.';}
  else{document.getElementById('errMsg').textContent=r.detail||'Reset failed';}
}
// Auto-fill email for returning users
ipcRenderer.invoke('ghost-get-user').then(user => {
  if (user && user.email) {
    document.getElementById('loginEmail').value = user.email;
    document.getElementById('loginPassword').focus();
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'){
  if(document.getElementById('loginForm').style.display!=='none')doLogin();
  else doSignup();
}});
</script></body></html>`;

  const loginHtmlPath = require('path').join(app.getPath('userData'), 'login.html');
  require('fs').writeFileSync(loginHtmlPath, LOGIN_HTML, 'utf-8');
  loginWin.loadFile(loginHtmlPath);

  ipcMain.handleOnce('login-success', () => {
    loginWin.close();
    onSuccess();
  });
}

app.whenReady().then(async () => {
  loadAnalytics();
  registerOnboardingIPC();

  const startApp = () => {
    // Skip onboarding — login screen is the new entry point
    // Mark first run as complete for this user
    if (isFirstRun()) {
      saveConfig({ firstRunComplete: true });
    }
    launchGhostMode();
  };

  // Skip login for now — go straight to app
  startApp();
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
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; img-src 'self' data: blob: https: http: file:; media-src 'self' data: blob: https: http: file:;">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  background: var(--bg, #0f0f1a);
  color: var(--text, #e2e8f0);
  height: 100vh;
  overflow: hidden;
}
/* ── Accessibility ── */
body.high-contrast { --bg: #000000; --bg2: #0a0a0a; --bg3: #1a1a1a; --text: #ffffff; --text2: rgba(255,255,255,0.8); --border: rgba(255,255,255,0.2); }
body.high-contrast .sidebar-tab.active { background: #ec4899; color: white; }
body.high-contrast .agent-item.selected { background: rgba(236,72,153,0.2); }
body.high-contrast .msg-user .bubble { background: rgba(236,72,153,0.2); border-color: #ec4899; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }

body.light {
  --bg: #f5f5f7; --bg2: #ffffff; --bg3: #e8e8ed; --text: #1d1d1f; --text2: rgba(29,29,31,0.6); --border: rgba(0,0,0,0.08);
}
body:not(.light) {
  --bg: #0f0f1a; --bg2: #0a0a14; --bg3: rgba(255,255,255,0.03); --text: #e2e8f0; --text2: rgba(226,232,240,0.5); --border: rgba(255,255,255,0.04);
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
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-app-region: no-drag;
}
.sidebar::-webkit-scrollbar { width: 3px; }
.sidebar::-webkit-scrollbar-thumb { background: rgba(236,72,153,0.1); border-radius: 2px; }
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
  color: rgba(226,232,240,0.55);
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
.agent-item .role { font-size: 10px; color: rgba(226,232,240,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  cursor: pointer; background: transparent; color: rgba(226,232,240,0.55);
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
  color: rgba(226,232,240,0.55);
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
  color: rgba(226,232,240,0.6);
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
  overflow: hidden;
  min-height: 0;
}

/* ── Chat Area ── */
.chat-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 32px;
  min-height: 0;
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
  color: rgba(226,232,240,0.55);
}
.chat-empty .orb {
  width: 56px; height: 56px; border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1);
  box-shadow: 0 0 24px rgba(236,72,153,0.3);
  animation: orbFloat 3s ease-in-out infinite;
}
@keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
.chat-empty .hint { font-size: 14px; }
.chat-empty .sub { font-size: 12px; color: rgba(226,232,240,0.5); }
.suggestion-chip {
  padding: 6px 14px;
  border-radius: 16px;
  border: 1px solid rgba(236,72,153,0.15);
  background: rgba(236,72,153,0.05);
  color: #f9a8d4;
  font-size: 12px;
  cursor: pointer;
  transition: .15s;
}
.suggestion-chip:hover { background: rgba(236,72,153,0.12); border-color: rgba(236,72,153,0.3); }

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
  color: rgba(226,232,240,0.65);
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
  color: rgba(226,232,240,0.55);
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
.input-wrap textarea::placeholder { color: rgba(226,232,240,0.5); }
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
  color: rgba(226,232,240,0.6);
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
.field label { display: block; font-size: 10px; color: rgba(226,232,240,0.6); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.field input, .field textarea {
  width: 100%; padding: 10px 14px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; color: #e2e8f0; font-size: 13px; outline: none; font-family: inherit;
}
.field input:focus, .field textarea:focus { border-color: rgba(236,72,153,0.3); }
.field textarea { height: 70px; resize: none; }
.field input::placeholder, .field textarea::placeholder { color: rgba(226,232,240,0.5); }

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
.btn-ghost { background: transparent; color: rgba(226,232,240,0.6); }
.btn-ghost:hover { color: #e2e8f0; }
.btn-danger { background: rgba(239,68,68,0.1); color: #fca5a5; }
.btn-danger:hover { background: rgba(239,68,68,0.2); }

/* ── Sidebar Tabs ── */
.sidebar-tabs {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 12px;
  margin-bottom: 8px;
}
.sidebar-tab {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(226,232,240,0.55);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: .15s;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  white-space: nowrap;
  text-align: left;
}
.sidebar-tab:hover { background: rgba(255,255,255,0.03); color: rgba(226,232,240,0.65); }
.sidebar-tab.active { background: rgba(236,72,153,0.08); color: #f9a8d4; }

/* ── Control Center ── */
.view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.view.active { display: flex; }

.control-center {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}
.control-center::-webkit-scrollbar { width: 4px; }
.control-center::-webkit-scrollbar-thumb { background: rgba(236,72,153,0.1); border-radius: 2px; }

.cc-header {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 4px;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.cc-sub {
  font-size: 12px;
  color: rgba(226,232,240,0.5);
  margin-bottom: 24px;
}

.cc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.cc-card {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 16px;
  padding: 20px;
  position: relative;
  transition: .2s;
}
.cc-card:hover {
  border-color: rgba(236,72,153,0.12);
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.cc-card.working {
  border-color: rgba(139,92,246,0.2);
  box-shadow: 0 0 20px rgba(139,92,246,0.05);
}

.cc-agent-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.cc-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  margin-right: 60px;
}
.cc-ctrl {
  width: 28px; height: 28px; border-radius: 7px; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; background: rgba(255,255,255,0.03); color: rgba(226,232,240,0.5);
  font-size: 12px; transition: .15s;
}
.cc-ctrl:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
.cc-ctrl.del:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
/* Toggle switch */
.cc-switch {
  position: relative;
  width: 36px; height: 20px;
  background: rgba(107,114,128,0.3);
  border-radius: 10px;
  cursor: pointer;
  transition: .2s;
  border: none;
  flex-shrink: 0;
}
.cc-switch.on { background: rgba(34,197,94,0.4); }
.cc-switch::after {
  content: '';
  position: absolute;
  top: 3px; left: 3px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #9ca3af;
  transition: .2s;
}
.cc-switch.on::after { left: 19px; background: #22c55e; }
.cc-avatar {
  width: 40px; height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: rgba(255,255,255,0.03);
}
.cc-name { font-size: 15px; font-weight: 600; color: #e2e8f0; }
.cc-role { font-size: 11px; color: rgba(226,232,240,0.6); }
.cc-status-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}
.cc-status-badge.idle { background: rgba(107,114,128,0.1); color: #9ca3af; }
.cc-status-badge.active { background: rgba(34,197,94,0.1); color: #86efac; }
.cc-status-badge.working { background: rgba(139,92,246,0.1); color: #c4b5fd; animation: badgePulse 2s ease-in-out infinite; }
@keyframes badgePulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

/* ── Thought Bubble ── */
.thought-bubble {
  position: relative;
  background: rgba(139,92,246,0.06);
  border: 1px solid rgba(139,92,246,0.1);
  border-radius: 14px;
  padding: 12px 14px;
  margin-top: 8px;
  min-height: 52px;
}
.thought-bubble::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 24px;
  width: 12px;
  height: 12px;
  background: rgba(139,92,246,0.06);
  border: 1px solid rgba(139,92,246,0.1);
  border-radius: 50%;
}
.thought-bubble::after {
  content: '';
  position: absolute;
  top: -16px;
  left: 20px;
  width: 8px;
  height: 8px;
  background: rgba(139,92,246,0.04);
  border: 1px solid rgba(139,92,246,0.08);
  border-radius: 50%;
}
.thought-text {
  font-size: 12px;
  color: #c4b5fd;
  line-height: 1.5;
}
.thought-text .step-label {
  font-weight: 600;
  color: #a78bfa;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.thought-idle {
  font-size: 12px;
  color: rgba(226,232,240,0.55);
  font-style: italic;
}

/* ── Live Preview ── */
.cc-live-preview {
  margin-top: 10px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(139,92,246,0.15);
  position: relative;
  background: #000;
}
.cc-live-preview img {
  width: 100%;
  display: block;
  border-radius: 9px;
}
.cc-live-preview .live-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(239,68,68,0.9);
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 0.5px;
}
.cc-live-preview .live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: white;
  animation: livePulse 1s ease-in-out infinite;
}
@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

.cc-task-log {
  margin-top: 10px;
  max-height: 80px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cc-task-log::-webkit-scrollbar { width: 2px; }
.cc-task-log::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.1); }
.cc-log-item {
  font-size: 10px;
  color: rgba(226,232,240,0.5);
  display: flex;
  align-items: center;
  gap: 5px;
}
.cc-log-item .check { color: #22c55e; }

.cc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: rgba(226,232,240,0.5);
  gap: 12px;
  font-size: 13px;
}

/* ── Voice Bar (full-width bottom overlay) ── */
.voice-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: linear-gradient(135deg, #1a0a1e, #0f0a1a);
  border-top: 1px solid rgba(236,72,153,0.25);
  box-shadow: 0 -4px 24px rgba(236,72,153,0.1);
  z-index: 200;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 0 24px;
}
.voice-bar.active { display: flex; animation: vbarIn 0.2s ease; }
@keyframes vbarIn { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }

.voice-bar .vb-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #ec4899;
  box-shadow: 0 0 8px rgba(236,72,153,0.5);
  animation: vbPulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes vbPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }

.voice-bar .vb-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
}
.voice-bar .vb-wave .bar {
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(to top, #ec4899, #a855f7);
  animation: waveBar 0.6s ease-in-out infinite alternate;
}
@keyframes waveBar { 0%{height:4px} 100%{height:24px} }

.voice-bar .vb-label {
  font-size: 12px;
  color: rgba(226,232,240,0.6);
  flex-shrink: 0;
}
.voice-bar .vb-label kbd {
  display: inline-block;
  background: rgba(236,72,153,0.1);
  border: 1px solid rgba(236,72,153,0.2);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  font-family: inherit;
  color: #f9a8d4;
  margin: 0 2px;
}
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
    <div style="margin-left:auto;-webkit-app-region:no-drag;display:flex;align-items:center;gap:8px">
      <button onclick="toggleNotifs()" style="position:relative;background:none;border:none;cursor:pointer;color:rgba(226,232,240,0.5);padding:4px" title="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span id="notifBadge" style="display:none;position:absolute;top:0;right:0;width:8px;height:8px;border-radius:50%;background:#ef4444"></span>
      </button>
    </div>
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
    <div class="sidebar-tabs">
      <button class="sidebar-tab active" id="tabChat" onclick="switchView('chat')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Chat
      </button>
      <button class="sidebar-tab" id="tabCC" onclick="switchView('cc')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Control Center
      </button>
      <button class="sidebar-tab" id="tabVoices" onclick="switchView('voices')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
        My Voices
      </button>
      <button class="sidebar-tab" id="tabScheduled" onclick="switchView('scheduled')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Scheduled
      </button>
      <button class="sidebar-tab" id="tabUsage" onclick="switchView('usage')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
        Usage
      </button>
      <button class="sidebar-tab" id="tabHistory" onclick="switchView('history')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-2-2-4 4"/></svg>
        History
      </button>
    </div>
    <div class="sidebar-bottom">
      <div class="settings-row" onclick="toggleSettings()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </div>
      <div class="settings-panel" id="settingsPanel">
        <input id="profileNameInput" placeholder="Assistant name..." maxlength="20">
        <div class="wake-hint" id="wakeHint">Say "Hey Isibi" to activate</div>
        <select id="languageSelect" style="width:100%;padding:7px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:#e2e8f0;font-size:12px;outline:none;margin-top:8px;appearance:none;">
          <option value="">Auto-detect language</option>
          <option value="en-US">English</option>
          <option value="es-ES">Espa\\u00f1ol</option>
          <option value="fr-FR">Fran\\u00e7ais</option>
          <option value="pt-BR">Portugu\\u00eas</option>
          <option value="de-DE">Deutsch</option>
          <option value="it-IT">Italiano</option>
          <option value="zh-CN">\\u4e2d\\u6587</option>
          <option value="ja-JP">\\u65e5\\u672c\\u8a9e</option>
          <option value="ko-KR">\\ud55c\\uad6d\\uc5b4</option>
          <option value="ar-SA">\\u0627\\u0644\\u0639\\u0631\\u0628\\u064a\\u0629</option>
          <option value="hi-IN">\\u0939\\u093f\\u0928\\u094d\\u0926\\u0940</option>
          <option value="ru-RU">\\u0420\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439</option>
          <option value="nl-NL">Nederlands</option>
          <option value="pl-PL">Polski</option>
          <option value="tr-TR">T\\u00fcrk\\u00e7e</option>
          <option value="vi-VN">Ti\\u1ebfng Vi\\u1ec7t</option>
          <option value="th-TH">\\u0e44\\u0e17\\u0e22</option>
          <option value="sv-SE">Svenska</option>
          <option value="da-DK">Dansk</option>
          <option value="he-IL">\\u05e2\\u05d1\\u05e8\\u05d9\\u05ea</option>
          <option value="uk-UA">\\u0423\\u043a\\u0440\\u0430\\u0457\\u043d\\u0441\\u044c\\u043a\\u0430</option>
          <option value="ms-MY">Bahasa Melayu</option>
          <option value="fil-PH">Filipino</option>
          <option value="sw-KE">Kiswahili</option>
          <option value="ht-HT">Krey\\u00f2l Ayisyen</option>
        </select>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;margin-bottom:8px">
          <span style="font-size:11px;color:rgba(226,232,240,0.5)">Light theme</span>
          <button class="cc-switch" id="themeToggle" onclick="toggleTheme()" style="width:32px;height:18px"></button>
        </div>
        <button class="save-profile-btn" onclick="saveProfile()">Save</button>
        <div id="userInfoSection" style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04)">
          <div style="font-size:11px;color:rgba(226,232,240,0.4)" id="userEmailDisplay"></div>
          <button onclick="doLogout()" style="margin-top:4px;padding:4px 10px;border-radius:6px;border:none;background:rgba(239,68,68,0.1);color:#fca5a5;font-size:10px;cursor:pointer">Log Out</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="main">
    <!-- Chat View -->
    <div class="view active" id="chatView">
      <div class="chat-area" id="chatArea">
        <div class="chat-empty" id="chatEmpty">
          <div class="orb"></div>
          <div class="hint">What can I help you with?</div>
          <div class="sub">Type a message, use voice, or say your wake word</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;max-width:500px;justify-content:center">
            <div class="suggestion-chip" onclick="trySuggestion('open YouTube')">open YouTube</div>
            <div class="suggestion-chip" onclick="trySuggestion('check my email')">check my email</div>
            <div class="suggestion-chip" onclick="trySuggestion('what is the weather')">weather</div>
            <div class="suggestion-chip" onclick="trySuggestion('take a screenshot')">screenshot</div>
            <div class="suggestion-chip" onclick="trySuggestion('create a new note')">new note</div>
            <div class="suggestion-chip" onclick="trySuggestion('generate an image of a sunset')">generate image</div>
          </div>
          <div style="margin-top:24px;display:flex;flex-direction:column;gap:8px;max-width:400px">
            <div style="font-size:11px;font-weight:600;color:rgba(226,232,240,0.4);text-transform:uppercase;letter-spacing:1px">Quick Tips</div>
            <div style="font-size:12px;color:rgba(226,232,240,0.45);line-height:1.8">
              &#127919; <strong style="color:rgba(226,232,240,0.6)">Create agents</strong> for different tasks — YouTube bot, email manager, etc.<br>
              &#127897; Press <strong style="color:rgba(226,232,240,0.6)">F9</strong> to use voice commands<br>
              &#9200; Use the <strong style="color:rgba(226,232,240,0.6)">Scheduled</strong> tab to run tasks automatically<br>
              &#127912; Say "generate an image of..." for <strong style="color:rgba(226,232,240,0.6)">AI image creation</strong><br>
              &#128222; Set up the <strong style="color:rgba(226,232,240,0.6)">AI Call Handler</strong> to answer phone calls for you
            </div>
          </div>
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

    <!-- Control Center View -->
    <div class="view" id="ccView">
      <div class="control-center" id="controlCenter">
        <div class="cc-header">Control Center</div>
        <div class="cc-sub">Watch your agents work in real-time</div>
        <div class="cc-grid" id="ccGrid"></div>
      </div>
    </div>

    <!-- My Voices View -->
    <div class="view" id="voicesView">
      <div class="control-center">
        <div class="cc-header">My Voices</div>
        <div class="cc-sub">Clone your voice or use AI voices for your agents</div>

        <!-- Clone Voice Section -->
        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(236,72,153,0.1);border-radius:16px;padding:24px;margin-bottom:20px">
          <h3 style="font-size:15px;font-weight:600;color:#f9a8d4;margin-bottom:12px;display:flex;align-items:center;gap:8px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            Clone a Voice
          </h3>
          <p style="font-size:12px;color:rgba(226,232,240,0.5);margin-bottom:16px">Upload audio samples of a voice to clone it. Works best with 1-3 minutes of clear speech.</p>
          <div class="field"><label>Voice Name</label><input id="cloneNameInput" placeholder="e.g. My Voice, Boss, Client..."></div>
          <div class="field"><label>Description</label><input id="cloneDescInput" placeholder="e.g. Professional male voice"></div>
          <div style="margin-bottom:14px">
            <label style="display:block;font-size:10px;color:rgba(226,232,240,0.6);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Audio Samples</label>
            <div id="audioFileList" style="font-size:12px;color:rgba(226,232,240,0.5);margin-bottom:8px">No files selected</div>
            <button class="btn btn-ghost" onclick="selectAudioFiles()" style="font-size:12px;padding:6px 14px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Audio Files
            </button>
          </div>
          <button class="btn btn-primary" onclick="cloneVoice()" id="cloneBtn" style="font-size:13px">Clone Voice</button>
          <div id="cloneStatus" style="font-size:11px;color:rgba(226,232,240,0.5);margin-top:8px"></div>
        </div>

        <!-- Voice List -->
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin-bottom:12px">Available Voices</h3>
        <div id="voiceList" style="display:flex;flex-direction:column;gap:8px">
          <div style="color:rgba(226,232,240,0.5);font-size:13px">Loading voices...</div>
        </div>
      </div>
    </div>
  </div>
</div>

    <!-- Usage View -->
    <div class="view" id="usageView">
      <div class="control-center">
        <div class="cc-header">Usage & Credits</div>
        <div class="cc-sub" style="margin-bottom:20px">Track how your agents use credits</div>

        <!-- Credit Overview -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#e2e8f0" id="creditsRemaining">—</div>
            <div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:4px">Credits Remaining</div>
          </div>
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#f9a8d4" id="creditsUsedTotal">—</div>
            <div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:4px">Credits Used</div>
          </div>
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#c4b5fd" id="creditsPlan">—</div>
            <div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:4px">Plan</div>
          </div>
        </div>

        <!-- Credit Bar -->
        <div style="margin-bottom:24px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:6px">
            <span>Usage</span>
            <span id="creditsPercent">0%</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.04);border-radius:4px;overflow:hidden">
            <div id="creditsBar" style="height:100%;border-radius:4px;background:linear-gradient(90deg,#ec4899,#8b5cf6);transition:width .3s;width:0%"></div>
          </div>
        </div>

        <!-- Per Agent Usage -->
        <h3 style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:12px">Usage by Agent</h3>
        <div id="agentUsageList" style="display:flex;flex-direction:column;gap:8px">
          <div style="color:rgba(226,232,240,0.5);font-size:13px">Loading...</div>
        </div>

        <!-- Buy Credits -->
        <h3 style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:12px;margin-top:24px">Buy Credits</h3>
        <div id="creditPlans" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px"></div>

        <!-- Credit Costs -->
        <div style="margin-top:24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:12px;padding:16px">
          <h4 style="font-size:12px;font-weight:600;color:rgba(226,232,240,0.6);margin-bottom:8px">Credit Costs</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:rgba(226,232,240,0.4)">
            <div>Command (planning)</div><div style="text-align:right;color:#f9a8d4">5 credits</div>
            <div>Action (per step)</div><div style="text-align:right;color:#f9a8d4">1 credit</div>
            <div>Vision (screenshot analysis)</div><div style="text-align:right;color:#f9a8d4">3 credits</div>
            <div>AI text generation</div><div style="text-align:right;color:#f9a8d4">5 credits</div>
            <div>Voice clone</div><div style="text-align:right;color:#f9a8d4">10 credits</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Scheduled View -->
    <div class="view" id="scheduledView">
      <div class="control-center">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div class="cc-header">Scheduled Tasks</div>
          <button class="btn btn-primary" onclick="openScheduleModal()" style="font-size:12px;padding:8px 16px;display:flex;align-items:center;gap:6px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Task
          </button>
        </div>
        <div class="cc-sub" style="margin-bottom:16px">Run tasks on a schedule or whenever you need them.</div>
        <div style="background:rgba(139,92,246,0.04);border:1px solid rgba(139,92,246,0.08);border-radius:10px;padding:10px 14px;margin-bottom:20px;display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(226,232,240,0.55)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Tasks only run while ISIBI Ghost Mode is open and your computer is awake.
        </div>
        <div id="scheduleList" style="display:flex;flex-direction:column;gap:10px">
          <div style="color:rgba(226,232,240,0.5);font-size:13px;text-align:center;padding:40px 0">No scheduled tasks yet. Click "+ New Task" to create one.</div>
        </div>
      </div>
    </div>

    <!-- Schedule Modal -->
    <div class="modal-bg" id="scheduleModalBg">
      <div class="modal">
        <h2 id="scheduleModalTitle" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent">New Scheduled Task</h2>
        <div class="field">
          <label>Agent</label>
          <select id="schedAgentSelect" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none;appearance:none"></select>
        </div>
        <div class="field">
          <label>Command</label>
          <input id="schedCommandInput" placeholder="e.g. check my email and summarize">
        </div>
        <div class="field">
          <label>Label (optional)</label>
          <input id="schedLabelInput" placeholder="e.g. Morning email check">
        </div>
        <div class="field">
          <label>Schedule</label>
          <select id="schedTypeSelect" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none;appearance:none" onchange="updateScheduleFields()">
            <option value="daily">Daily at a specific time</option>
            <option value="weekdays">Weekdays only (Mon-Fri)</option>
            <option value="weekly">Specific day of the week</option>
            <option value="interval">Every X minutes</option>
          </select>
        </div>
        <div id="schedTimeField" class="field">
          <label>Time</label>
          <input id="schedTimeInput" type="time" value="09:00" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none">
        </div>
        <div id="schedDayField" class="field" style="display:none">
          <label>Day</label>
          <select id="schedDaySelect" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none;appearance:none">
            <option value="monday">Monday</option><option value="tuesday">Tuesday</option><option value="wednesday">Wednesday</option>
            <option value="thursday">Thursday</option><option value="friday">Friday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option>
          </select>
        </div>
        <div id="schedIntervalField" class="field" style="display:none">
          <label>Minutes</label>
          <input id="schedIntervalInput" type="number" value="30" min="1" max="1440" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e2e8f0;font-size:13px;outline:none">
        </div>
        <div class="modal-btns">
          <div></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" onclick="closeScheduleModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveScheduledTask()">Create Task</button>
          </div>
        </div>
      </div>
    </div>

    <!-- History View -->
    <div class="view" id="historyView">
      <div class="control-center">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <div class="cc-header">History</div>
            <div class="cc-sub">All past commands and results</div>
          </div>
          <button class="btn btn-ghost" onclick="clearHistory()" style="font-size:11px">Clear All</button>
        </div>
        <div id="historyList" style="display:flex;flex-direction:column;gap:6px">
          <div style="color:rgba(226,232,240,0.5);font-size:13px">Loading...</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Notification Center -->
<div id="notifPanel" style="display:none;position:fixed;top:38px;right:0;width:320px;max-height:400px;overflow-y:auto;background:#12122a;border:1px solid rgba(236,72,153,0.1);border-radius:0 0 0 16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:150;padding:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <span style="font-size:13px;font-weight:600;color:#e2e8f0">Notifications</span>
    <button onclick="clearNotifs()" style="font-size:10px;color:rgba(226,232,240,0.4);background:none;border:none;cursor:pointer">Clear all</button>
  </div>
  <div id="notifList"></div>
</div>

<!-- Voice Bar -->
<div class="voice-bar" id="voiceBar">
  <div class="vb-dot"></div>
  <div class="vb-wave" id="vbWave"></div>
  <div class="vb-label"><kbd>F9</kbd> to stop</div>
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
let chatHistoryByAgent = {}; // per-agent chat history
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
      switchAgent(a.id);
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

async function switchAgent(newId) {
  // Save current chat to disk
  if (selectedAgentId) {
    chatHistoryByAgent[selectedAgentId] = [...chatMessages];
    ipcRenderer.invoke('chat-save', selectedAgentId, chatMessages);
  }
  selectedAgentId = newId;
  renderAgentList();
  // Show loading briefly
  chatMessages = [{ type: 'system', content: 'Loading...' }];
  renderChat();
  // Load from memory or disk
  if (chatHistoryByAgent[newId] && chatHistoryByAgent[newId].length > 0) {
    chatMessages = [...chatHistoryByAgent[newId]];
  } else {
    const loaded = await ipcRenderer.invoke('chat-load', newId);
    chatMessages = loaded.length > 0 ? loaded : [];
    chatHistoryByAgent[newId] = [...chatMessages];
  }
  renderChat();
  updatePlaceholder();
}

ipcRenderer.on('agents-updated', () => loadAgents());

// Agent questions — show question in chat with reply input
ipcRenderer.on('agent-question', (_, data) => {
  chatMessages.push({
    type: 'system',
    content: '\\ud83e\\udd14 <strong>Agent needs your input:</strong> ' + escHtml(data.question) +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<input id="agentReplyInput" placeholder="Type your answer..." style="flex:1;padding:6px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(236,72,153,0.2);border-radius:8px;color:#e2e8f0;font-size:12px;outline:none">' +
        '<button onclick="sendAgentReply()" style="padding:6px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:white;font-size:12px;cursor:pointer">Reply</button>' +
      '</div>'
  });
  renderChat();
  // Focus the reply input
  setTimeout(() => { const el = document.getElementById('agentReplyInput'); if (el) el.focus(); }, 100);
});

function sendAgentReply() {
  const el = document.getElementById('agentReplyInput');
  if (!el) return;
  const text = el.value.trim();
  if (!text) return;
  ipcRenderer.invoke('agent-response', text);
  chatMessages.push({ type: 'user', content: text });
  renderChat();
}

// Error handling — show error cards in chat
ipcRenderer.on('action-error', (_, err) => {
  chatMessages.push({
    type: 'system',
    content: 'Error at step ' + err.step + '/' + err.totalSteps + ': ' + err.action + ' — ' + err.error
  });
  renderChat();
});

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
      html += '<div class="msg msg-system">' + m.content + '</div>'; // System msgs can contain HTML (undo link)
    }
  });

  // Only replace message area, not chatEmpty
  const existing = chatArea.querySelectorAll('.msg');
  existing.forEach(e => e.remove());
  chatArea.insertAdjacentHTML('beforeend', html);
  chatArea.scrollTop = chatArea.scrollHeight;
  // Auto-save chat to disk
  if (selectedAgentId) ipcRenderer.invoke('chat-save', selectedAgentId, chatMessages);
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

  const totalSteps = r.tasks.reduce((sum, t) => sum + t.steps, 0);
  const estSeconds = totalSteps * 3; // ~3 sec per step average
  agentMsg.content = 'Working on it... (' + totalSteps + ' steps, ~' + estSeconds + 's)';
  agentMsg.tasks = r.tasks.map(t => ({ ...t, progress: t.steps + ' steps, ~' + (t.steps * 3) + 's' }));
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
      // Log to history
      const agent2 = agents.find(x => x.id === selectedAgentId);
      const lastUserMsg = [...chatMessages].reverse().find(m => m.type === 'user');
      ipcRenderer.invoke('history-add', {
        command: lastUserMsg?.content || '',
        agentName: agent2?.name || 'Agent',
        status: 'done',
        steps: lastAgent.tasks?.length || 1,
        timestamp: new Date().toISOString(),
      });
      // Add undo option
      chatMessages.push({ type: 'system', content: '\\u2713 Task complete \\u2022 <span style="color:#f9a8d4;cursor:pointer;text-decoration:underline" onclick="undoLast()">Undo</span>' });
      renderChat();
    }
  }
}

// ── Voice Recognition ──
async function initVoice() {
  try {
    const S = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!S) { console.error('[Voice] SpeechRecognition API not available'); return; }

    // Try getUserMedia first (some Electron versions need it), but don't fail if it doesn't work
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[Voice] Mic stream obtained:', stream.active);
      // Stop the stream — we just needed to trigger the permission
      stream.getTracks().forEach(t => t.stop());
    } catch (micErr) {
      console.log('[Voice] getUserMedia skipped:', micErr.message, '— trying SpeechRecognition directly');
    }

    rec = new S();
    rec.continuous = false;
    rec.interimResults = true;
    const savedLang = await ipcRenderer.invoke('get-language');
    if (savedLang) rec.lang = savedLang;
    rec.onresult = e => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
      autoResize();
      if (e.results[e.results.length - 1].isFinal) { stopMic(); }
    };
    rec.onend = () => { if (listening) stopMic(); };
    rec.onerror = e => {
      console.log('[Voice] Error:', e.error);
      stopMic();
      if (e.error === 'not-allowed') {
        console.error('[Voice] Mic not allowed — try restarting the app');
        voiceReady = false;
      }
    };
    voiceReady = true;
    console.log('[Voice] Ready!');
  } catch (err) {
    console.error('[Voice] Voice init failed:', err);
    voiceReady = false;
  }
}

const voiceBar = document.getElementById('voiceBar');
const vbWave = document.getElementById('vbWave');

function buildWaveBars() {
  vbWave.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
    bar.style.animationDuration = (0.3 + Math.random() * 0.5).toFixed(2) + 's';
    vbWave.appendChild(bar);
  }
}

function showVoiceBar() {
  buildWaveBars();
  voiceBar.classList.add('active');
  micBtn.classList.add('on');
  voiceIndicator.classList.add('on');
}

function hideVoiceBar() {
  voiceBar.classList.remove('active');
  micBtn.classList.remove('on');
  voiceIndicator.classList.remove('on');
}

let micErrorShown = false;
function startMic() {
  if (!voiceReady || !rec) {
    if (micErrorShown) return; // Don't spam the error
    console.log('[Voice] Not ready, trying to reinit...');
    initVoice().then(() => {
      if (voiceReady && rec) {
        listening = true;
        showVoiceBar();
        try { rec.start(); } catch (e) { console.error('[Voice] start failed:', e); }
      } else if (!micErrorShown) {
        micErrorShown = true;
        chatMessages.push({ type: 'system', content: 'Microphone not available. Check System Settings > Privacy > Microphone, make sure ISIBI is allowed, then restart the app.' });
        renderChat();
      }
    });
    return;
  }
  listening = true;
  showVoiceBar();
  try { rec.start(); } catch (e) { console.error('[Voice] start failed:', e); }
}

function stopMic() {
  listening = false;
  hideVoiceBar();
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

// Load user info
ipcRenderer.invoke('ghost-get-user').then(user => {
  if (user) {
    const el = document.getElementById('userEmailDisplay');
    if (el) el.textContent = user.email;
  }
});

async function doLogout() {
  await ipcRenderer.invoke('ghost-logout');
  window.location.reload();
}

let lightTheme = localStorage.getItem('theme') === 'light';
function toggleTheme() {
  lightTheme = !lightTheme;
  document.body.classList.toggle('light', lightTheme);
  localStorage.setItem('theme', lightTheme ? 'light' : 'dark');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.classList.toggle('on', lightTheme);
}
// Apply saved theme on load
if (lightTheme) document.body.classList.add('light');

function undoLast() {
  ipcRenderer.invoke('ghost-command', 'undo last action', selectedAgentId);
  chatMessages.push({ type: 'system', content: 'Undoing last action (Cmd+Z)...' });
  renderChat();
}

function trySuggestion(text) {
  input.value = text;
  send();
}

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
  const lang = await ipcRenderer.invoke('get-language');
  document.getElementById('profileNameInput').value = name;
  document.getElementById('wakeHint').textContent = 'Say "Hey ' + name + '" to activate';
  document.getElementById('languageSelect').value = lang || '';
}

document.getElementById('profileNameInput').addEventListener('input', function() {
  const v = this.value.trim() || 'Isibi';
  document.getElementById('wakeHint').textContent = 'Say "Hey ' + v + '" to activate';
});

async function saveProfile() {
  const name = document.getElementById('profileNameInput').value.trim() || 'Isibi';
  const lang = document.getElementById('languageSelect').value;
  await ipcRenderer.invoke('update-assistant-profile', name);
  await ipcRenderer.invoke('save-language', lang);
  // Update voice recognition language
  if (rec) rec.lang = lang || '';
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

// ── View Switching ──
let currentView = 'chat';
let ccPollTimer = null;
let agentLogs = {}; // per-agent log of completed steps

function switchView(view) {
  currentView = view;
  document.getElementById('chatView').classList.toggle('active', view === 'chat');
  document.getElementById('ccView').classList.toggle('active', view === 'cc');
  document.getElementById('voicesView').classList.toggle('active', view === 'voices');
  document.getElementById('usageView').classList.toggle('active', view === 'usage');
  document.getElementById('scheduledView').classList.toggle('active', view === 'scheduled');
  document.getElementById('historyView').classList.toggle('active', view === 'history');
  document.getElementById('tabChat').classList.toggle('active', view === 'chat');
  document.getElementById('tabCC').classList.toggle('active', view === 'cc');
  document.getElementById('tabVoices').classList.toggle('active', view === 'voices');
  document.getElementById('tabUsage').classList.toggle('active', view === 'usage');
  document.getElementById('tabScheduled').classList.toggle('active', view === 'scheduled');
  document.getElementById('tabHistory').classList.toggle('active', view === 'history');

  if (view === 'cc') {
    renderControlCenter();
    startCCPolling();
  } else {
    stopCCPolling();
  }
  if (view === 'voices') {
    loadVoices();
  }
  if (view === 'usage') {
    loadUsage();
    loadCreditPlans();
  }
  if (view === 'scheduled') {
    loadSchedules();
  }
  if (view === 'history') {
    loadHistory();
  }
}

function startCCPolling() {
  stopCCPolling();
  pollCC();
  ccPollTimer = setInterval(pollCC, 800);
}

function stopCCPolling() {
  if (ccPollTimer) { clearInterval(ccPollTimer); ccPollTimer = null; }
}

let ccScreenshot = null;
let ccScreenshotTime = 0;

async function pollCC() {
  const statuses = await ipcRenderer.invoke('agents-statuses');
  const taskStatus = await ipcRenderer.invoke('ghost-status');

  // Capture screenshot if any agent is working (throttle to every 2s)
  const hasWorking = taskStatus && taskStatus.active;
  if (hasWorking && Date.now() - ccScreenshotTime > 2000) {
    ccScreenshot = await ipcRenderer.invoke('capture-screen-thumbnail');
    ccScreenshotTime = Date.now();
  } else if (!hasWorking) {
    ccScreenshot = null;
  }

  renderControlCenter(statuses, taskStatus);
}

function renderControlCenter(statuses, taskStatus) {
  const grid = document.getElementById('ccGrid');
  const activeAgents = agents.filter(a => a.isActive);

  if (activeAgents.length === 0) {
    grid.innerHTML = '<div class="cc-empty"><div>No active agents</div><div style="font-size:11px">Create and activate agents to see them here</div></div>';
    return;
  }

  grid.innerHTML = '';
  activeAgents.forEach(a => {
    const s = statuses ? statuses[a.id] : null;
    const isWorking = s && s.isRunning;
    const card = document.createElement('div');
    card.className = 'cc-card' + (isWorking ? ' working' : '');

    // Status badge
    let badgeCls = 'idle';
    let badgeText = 'Idle';
    if (isWorking) { badgeCls = 'working'; badgeText = 'Working'; }
    else if (s && s.taskCount > 0) { badgeCls = 'active'; badgeText = s.taskCount + ' tasks done'; }

    // Thought bubble content
    let thoughtHtml = '';
    if (isWorking && taskStatus && taskStatus.active) {
      // Track logs per agent
      if (!agentLogs[a.id]) agentLogs[a.id] = [];
      const step = taskStatus.active;
      thoughtHtml =
        '<div class="thought-bubble"><div class="thought-text">' +
        '<div class="step-label"><div class="spin"></div> Step ' + step.step + '/' + step.totalSteps + '</div>' +
        escHtml(step.currentAction) +
        '</div></div>';

      // Log completed steps
      const logKey = step.command + '-' + step.step;
      if (step.step > 1 && !agentLogs[a.id].find(l => l.key === logKey)) {
        agentLogs[a.id].push({ key: logKey, text: 'Step ' + (step.step - 1) + ': Done' });
        if (agentLogs[a.id].length > 8) agentLogs[a.id].shift();
      }
    } else if (s && s.lastCommand) {
      thoughtHtml =
        '<div class="thought-bubble"><div class="thought-idle">Last: "' + escHtml(s.lastCommand) + '"</div></div>';
    } else {
      thoughtHtml =
        '<div class="thought-bubble"><div class="thought-idle">Waiting for commands...</div></div>';
    }

    // Task log
    let logHtml = '';
    if (agentLogs[a.id] && agentLogs[a.id].length > 0) {
      logHtml = '<div class="cc-task-log">';
      agentLogs[a.id].forEach(l => {
        logHtml += '<div class="cc-log-item"><span class="check">\\u2713</span> ' + escHtml(l.text) + '</div>';
      });
      logHtml += '</div>';
    }

    // Live preview for working agents
    let previewHtml = '';
    if (isWorking && ccScreenshot) {
      previewHtml = '<div class="cc-live-preview"><img src="' + ccScreenshot + '" alt="Live"><div class="live-badge"><div class="live-dot"></div>LIVE</div></div>';
    }

    card.innerHTML =
      '<div class="cc-status-badge ' + badgeCls + '">' + badgeText + '</div>' +
      '<div class="cc-agent-header">' +
        '<div class="cc-avatar">' + a.emoji + '</div>' +
        '<div><div class="cc-name">' + a.name + '</div><div class="cc-role">' + a.role + '</div></div>' +
        '<div class="cc-controls">' +
          '<button class="cc-ctrl" title="Edit" data-cc-action="edit" data-cc-id="' + a.id + '">\\u270f</button>' +
          '<button class="cc-switch' + (a.isActive ? ' on' : '') + '" title="' + (a.isActive ? 'Deactivate' : 'Activate') + '" data-cc-action="toggle" data-cc-id="' + a.id + '"></button>' +
          '<button class="cc-ctrl del" title="Delete" data-cc-action="delete" data-cc-id="' + a.id + '">\\ud83d\\uddd1</button>' +
        '</div>' +
      '</div>' +
      previewHtml + thoughtHtml + logHtml;

    // Wire up control center card buttons
    card.querySelectorAll('[data-cc-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.ccAction;
        const id = btn.dataset.ccId;
        if (action === 'edit') {
          const agent = agents.find(x => x.id === id);
          if (agent) openEditAgent(agent);
        } else if (action === 'toggle') {
          toggleAgentById(id);
        } else if (action === 'delete') {
          deleteAgentById(id);
        }
      };
    });

    grid.appendChild(card);
  });
}

// ── Focus management ──
// Auto-focus textarea when window gets focus or view switches
document.addEventListener('click', (e) => {
  // If click is not on a button/input/modal, focus the textarea
  const tag = e.target.tagName;
  if (tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.closest('.modal-bg') && !e.target.closest('.sidebar')) {
    input.focus();
  }
});
window.addEventListener('focus', () => { if (currentView === 'chat') input.focus(); });

// ── Notification Center ──
let notifications = [];
let notifVisible = false;

function addNotif(title, body, type) {
  notifications.unshift({ title, body, type: type || 'info', time: new Date().toLocaleTimeString() });
  if (notifications.length > 30) notifications.pop();
  document.getElementById('notifBadge').style.display = 'block';
  renderNotifs();
}

function renderNotifs() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (notifications.length === 0) {
    list.innerHTML = '<div style="color:rgba(226,232,240,0.4);font-size:12px;text-align:center;padding:20px">No notifications</div>';
    return;
  }
  list.innerHTML = notifications.map(n => {
    const iconColor = n.type === 'error' ? '#ef4444' : n.type === 'success' ? '#22c55e' : '#8b5cf6';
    return '<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;gap:8px;align-items:start">' +
      '<div style="width:6px;height:6px;border-radius:50%;background:' + iconColor + ';margin-top:5px;flex-shrink:0"></div>' +
      '<div style="flex:1"><div style="font-size:12px;color:#e2e8f0;font-weight:500">' + escHtml(n.title) + '</div>' +
      '<div style="font-size:11px;color:rgba(226,232,240,0.4)">' + escHtml(n.body) + '</div>' +
      '<div style="font-size:9px;color:rgba(226,232,240,0.3);margin-top:2px">' + n.time + '</div></div></div>';
  }).join('');
}

function toggleNotifs() {
  notifVisible = !notifVisible;
  document.getElementById('notifPanel').style.display = notifVisible ? 'block' : 'none';
  if (notifVisible) document.getElementById('notifBadge').style.display = 'none';
}

function clearNotifs() {
  notifications = [];
  renderNotifs();
}

// Hook into task completion/error for auto-notifications
ipcRenderer.on('action-error', (_, err) => {
  addNotif('Task Failed', err.action + ': ' + err.error, 'error');
});
ipcRenderer.on('schedule-ran', (_, data) => {
  addNotif('Scheduled Task', data.label + ' completed', 'success');
});

// ── Usage View ──
async function loadCreditPlans() {
  const plans = await ipcRenderer.invoke('stripe-plans');
  const container = document.getElementById('creditPlans');
  if (!container) return;
  container.innerHTML = '';
  plans.forEach((p, i) => {
    const popular = i === 1;
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid ' + (popular ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.06)') + ';border-radius:14px;padding:16px;position:relative;cursor:pointer;transition:.2s';
    if (popular) el.innerHTML = '<div style="position:absolute;top:-8px;right:12px;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:white;font-size:9px;font-weight:700;padding:2px 8px;border-radius:6px">POPULAR</div>';
    el.innerHTML += '<div style="font-size:18px;font-weight:700;color:#e2e8f0">' + (p.priceInCents / 100).toFixed(2) + '</div>' +
      '<div style="font-size:10px;color:rgba(226,232,240,0.4);margin-bottom:6px">USD</div>' +
      '<div style="font-size:13px;font-weight:600;color:#f9a8d4">' + p.name + '</div>' +
      '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:2px">' + p.description + '</div>' +
      '<button data-plan="' + p.id + '" style="margin-top:10px;width:100%;padding:8px;border-radius:8px;border:none;background:' + (popular ? 'linear-gradient(135deg,#ec4899,#8b5cf6)' : 'rgba(255,255,255,0.06)') + ';color:' + (popular ? 'white' : '#e2e8f0') + ';font-size:12px;font-weight:600;cursor:pointer">Buy</button>';
    // Wire up buy button via addEventListener (avoids quote escaping issues)
    el.querySelector('[data-plan]').onclick = () => buyCredits(p.id);
    el.onmouseover = () => { el.style.borderColor = 'rgba(236,72,153,0.3)'; };
    el.onmouseout = () => { if (!popular) el.style.borderColor = 'rgba(255,255,255,0.06)'; };
    container.appendChild(el);
  });
}

async function buyCredits(planId) {
  const result = await ipcRenderer.invoke('stripe-checkout', planId);
  if (result.success) {
    addNotif('Credits Purchased', result.credits + ' credits added to your account', 'success');
    loadUsage(); // Refresh
  } else {
    addNotif('Payment Error', result.error || 'Something went wrong', 'error');
  }
}

async function loadUsage() {
  const credits = await ipcRenderer.invoke('get-credits');
  const agentUsage = await ipcRenderer.invoke('get-agent-usage');

  // Update overview cards
  document.getElementById('creditsRemaining').textContent = credits.remaining.toLocaleString();
  document.getElementById('creditsUsedTotal').textContent = credits.used.toLocaleString();
  document.getElementById('creditsPlan').textContent = credits.plan.charAt(0).toUpperCase() + credits.plan.slice(1);

  // Update bar
  const pct = credits.total > 0 ? Math.min((credits.used / credits.total) * 100, 100) : 0;
  document.getElementById('creditsBar').style.width = pct.toFixed(1) + '%';
  document.getElementById('creditsPercent').textContent = pct.toFixed(1) + '%';
  // Change bar color if running low
  if (pct > 80) document.getElementById('creditsBar').style.background = 'linear-gradient(90deg,#ef4444,#f97316)';

  // Per agent usage
  const container = document.getElementById('agentUsageList');
  if (!container) return;
  const sorted = [...agentUsage].sort((a, b) => (b.creditsUsed || 0) - (a.creditsUsed || 0));
  if (sorted.length === 0 || sorted.every(a => !a.creditsUsed)) {
    container.innerHTML = '<div style="color:rgba(226,232,240,0.5);font-size:13px;text-align:center;padding:20px 0">No usage yet. Start using your agents!</div>';
    return;
  }
  const maxCredits = Math.max(...sorted.map(a => a.creditsUsed || 0), 1);
  container.innerHTML = '';
  sorted.forEach(a => {
    if (!a.creditsUsed && !a.commandCount) return;
    const barWidth = ((a.creditsUsed || 0) / maxCredits * 100).toFixed(1);
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:12px;padding:14px 16px';
    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:16px">' + a.emoji + '</span>' +
          '<span style="font-size:13px;font-weight:500;color:#e2e8f0">' + escHtml(a.name) + '</span>' +
        '</div>' +
        '<span style="font-size:14px;font-weight:600;color:#f9a8d4">' + (a.creditsUsed || 0).toLocaleString() + ' credits</span>' +
      '</div>' +
      '<div style="height:6px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden;margin-bottom:6px">' +
        '<div style="height:100%;border-radius:3px;background:' + (a.color || '#ec4899') + ';width:' + barWidth + '%;transition:width .3s"></div>' +
      '</div>' +
      '<div style="display:flex;gap:16px;font-size:10px;color:rgba(226,232,240,0.4)">' +
        '<span>' + (a.commandCount || 0) + ' commands</span>' +
        '<span>' + (a.actionCount || 0) + ' actions</span>' +
      '</div>';
    container.appendChild(el);
  });
}

// ── Scheduled Tasks View ──
let editingScheduleId = null;

async function loadSchedules() {
  const schedules = await ipcRenderer.invoke('schedules-list');
  const container = document.getElementById('scheduleList');
  if (!container) return;
  if (schedules.length === 0) {
    container.innerHTML = '<div style="color:rgba(226,232,240,0.5);font-size:13px;text-align:center;padding:40px 0">No scheduled tasks yet. Click "+ New Task" to create one.</div>';
    return;
  }
  container.innerHTML = '';
  schedules.forEach(s => {
    const agent3 = agents.find(a => a.id === s.agentId);
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px 18px;transition:.2s';

    // Format schedule description
    let schedDesc = s.cron;
    if (s.cron.match(/^\\d{2}:\\d{2}$/)) schedDesc = 'Daily at ' + s.cron;
    else if (s.cron.startsWith('weekdays')) schedDesc = 'Weekdays at ' + s.cron.split(' ')[1];
    else if (s.cron.startsWith('interval:')) schedDesc = 'Every ' + s.cron.split(':')[1] + ' minutes';
    else if (s.cron.includes(' ')) { const p = s.cron.split(' '); schedDesc = p[0].charAt(0).toUpperCase() + p[0].slice(1) + ' at ' + p[1]; }

    const lastRunText = s.lastRun ? 'Last run: ' + new Date(s.lastRun).toLocaleString() : 'Never run';

    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:16px">' + (agent3?.emoji || '\\ud83d\\udc7b') + '</span>' +
          '<div>' +
            '<div style="font-size:14px;font-weight:600;color:#e2e8f0">' + escHtml(s.label || s.command) + '</div>' +
            '<div style="font-size:11px;color:rgba(226,232,240,0.4)">' + (agent3?.name || 'Agent') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<button class="cc-switch' + (s.enabled ? ' on' : '') + '" data-sid="' + s.id + '" data-saction="toggle" style="width:32px;height:18px"></button>' +
          '<button class="ctrl-btn del" data-sid="' + s.id + '" data-saction="delete" style="font-size:10px">\\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:rgba(226,232,240,0.5);margin-bottom:4px">' + schedDesc + '</div>' +
      '<div style="font-size:11px;color:rgba(226,232,240,0.35)">' + escHtml(s.command) + '</div>' +
      '<div style="font-size:10px;color:rgba(226,232,240,0.3);margin-top:6px">' + lastRunText + (s.enabled ? '' : ' \\u2022 <span style="color:#eab308">Paused</span>') + '</div>';

    // Wire up buttons
    el.querySelectorAll('[data-saction]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (btn.dataset.saction === 'toggle') {
          await ipcRenderer.invoke('schedules-toggle', btn.dataset.sid);
          loadSchedules();
        } else if (btn.dataset.saction === 'delete') {
          await ipcRenderer.invoke('schedules-delete', btn.dataset.sid);
          loadSchedules();
        }
      };
    });

    container.appendChild(el);
  });
}

function openScheduleModal() {
  editingScheduleId = null;
  document.getElementById('scheduleModalTitle').textContent = 'New Scheduled Task';
  document.getElementById('schedCommandInput').value = '';
  document.getElementById('schedLabelInput').value = '';
  document.getElementById('schedTimeInput').value = '09:00';
  // Populate agent select
  const sel = document.getElementById('schedAgentSelect');
  sel.innerHTML = '';
  agents.filter(a => a.isActive).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.emoji + ' ' + a.name;
    sel.appendChild(opt);
  });
  updateScheduleFields();
  document.getElementById('scheduleModalBg').classList.add('visible');
}

function closeScheduleModal() {
  document.getElementById('scheduleModalBg').classList.remove('visible');
}

function updateScheduleFields() {
  const type = document.getElementById('schedTypeSelect').value;
  document.getElementById('schedTimeField').style.display = type !== 'interval' ? 'block' : 'none';
  document.getElementById('schedDayField').style.display = type === 'weekly' ? 'block' : 'none';
  document.getElementById('schedIntervalField').style.display = type === 'interval' ? 'block' : 'none';
}

async function saveScheduledTask() {
  const agentId = document.getElementById('schedAgentSelect').value;
  const command = document.getElementById('schedCommandInput').value.trim();
  const label = document.getElementById('schedLabelInput').value.trim();
  const type = document.getElementById('schedTypeSelect').value;
  if (!command) return;

  let cron = '';
  if (type === 'daily') cron = document.getElementById('schedTimeInput').value;
  else if (type === 'weekdays') cron = 'weekdays ' + document.getElementById('schedTimeInput').value;
  else if (type === 'weekly') cron = document.getElementById('schedDaySelect').value + ' ' + document.getElementById('schedTimeInput').value;
  else if (type === 'interval') cron = 'interval:' + document.getElementById('schedIntervalInput').value;

  await ipcRenderer.invoke('schedules-create', { agentId, command, cron, label });
  closeScheduleModal();
  loadSchedules();
}

// Listen for scheduled task notifications
ipcRenderer.on('schedule-ran', (_, data) => {
  chatMessages.push({ type: 'system', content: '\\u23f0 Scheduled task ran: ' + escHtml(data.label) });
  renderChat();
});

// ── History View ──
async function loadHistory() {
  const history = await ipcRenderer.invoke('history-list');
  const container = document.getElementById('historyList');
  if (!container) return;
  if (history.length === 0) {
    container.innerHTML = '<div style="color:rgba(226,232,240,0.5);font-size:13px;text-align:center;padding:40px 0">No commands yet. Start by messaging an agent.</div>';
    return;
  }
  container.innerHTML = '';
  // Show newest first
  [...history].reverse().forEach(h => {
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px';
    const statusIcon = h.status === 'done' ? '\\u2713' : h.status === 'failed' ? '\\u2717' : '\\u25cf';
    const statusColor = h.status === 'done' ? '#22c55e' : h.status === 'failed' ? '#ef4444' : '#eab308';
    const time = new Date(h.timestamp).toLocaleString();
    el.innerHTML =
      '<span style="color:' + statusColor + ';font-size:14px">' + statusIcon + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(h.command) + '</div>' +
        '<div style="font-size:10px;color:rgba(226,232,240,0.4)">' + escHtml(h.agentName || 'Agent') + ' \\u2022 ' + h.steps + ' steps \\u2022 ' + time + '</div>' +
      '</div>' +
      '<button class="ctrl-btn rerun-btn" data-cmd="' + escHtml(h.command).replace(/"/g, '&quot;') + '" title="Run again" style="font-size:12px">\\u21bb</button>';
    // Wire up rerun button
    const rerunBtn = el.querySelector('.rerun-btn');
    if (rerunBtn) rerunBtn.onclick = () => trySuggestion(h.command);
    container.appendChild(el);
  });
}

async function clearHistory() {
  await ipcRenderer.invoke('history-clear');
  loadHistory();
}

// ── Voices View ──
let voicesList = [];
let selectedVoiceId = '';
let cloneAudioFiles = [];

async function loadVoices() {
  voicesList = await ipcRenderer.invoke('eleven-list-voices');
  selectedVoiceId = await ipcRenderer.invoke('eleven-get-selected');
  renderVoiceList();
}

function renderVoiceList() {
  const container = document.getElementById('voiceList');
  if (!container) return;
  if (voicesList.length === 0) {
    container.innerHTML = '<div style="color:rgba(226,232,240,0.5);font-size:13px">No voices found. Clone one above or check your API key.</div>';
    return;
  }
  container.innerHTML = '';
  voicesList.forEach(v => {
    const isSelected = v.voice_id === selectedVoiceId;
    const isCloned = v.category === 'cloned';
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid ' + (isSelected ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.04)') + ';border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:.15s;cursor:pointer';
    el.innerHTML =
      '<div style="width:36px;height:36px;border-radius:10px;background:' + (isCloned ? 'rgba(236,72,153,0.1)' : 'rgba(139,92,246,0.1)') + ';display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">' + (isCloned ? '\\ud83c\\udfb5' : '\\ud83d\\udde3') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:500;color:#e2e8f0">' + v.name + (isSelected ? ' <span style="color:#22c55e;font-size:10px">\\u2713 Active</span>' : '') + '</div>' +
        '<div style="font-size:10px;color:rgba(226,232,240,0.5)">' + (isCloned ? 'Cloned' : 'ElevenLabs') + (v.labels?.accent ? ' \\u2022 ' + v.labels.accent : '') + '</div>' +
      '</div>' +
      '<button class="ctrl-btn" title="Preview" data-vid="' + v.voice_id + '" data-action="preview" style="font-size:14px">\\u25b6</button>' +
      (isSelected
        ? '<button class="ctrl-btn toggle-on" title="Active" style="font-size:10px">\\u25cf</button>'
        : '<button class="ctrl-btn" title="Set as active" data-vid="' + v.voice_id + '" data-action="select" style="font-size:11px">Use</button>'
      ) +
      (isCloned ? '<button class="ctrl-btn del" title="Delete" data-vid="' + v.voice_id + '" data-action="delete" style="font-size:10px">\\u2715</button>' : '');

    el.querySelectorAll = el.querySelectorAll || (() => []);
    container.appendChild(el);

    // Wire up buttons after append
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const act = btn.dataset.action;
        const vid = btn.dataset.vid;
        if (act === 'preview') {
          btn.textContent = '...';
          await ipcRenderer.invoke('eleven-preview-voice', vid, 'Hello! This is how I sound. I am your AI assistant.');
          btn.textContent = '\\u25b6';
        } else if (act === 'select') {
          await ipcRenderer.invoke('eleven-set-voice', vid);
          selectedVoiceId = vid;
          renderVoiceList();
        } else if (act === 'delete') {
          if (confirm('Delete this voice?')) {
            await ipcRenderer.invoke('eleven-delete-voice', vid);
            await loadVoices();
          }
        }
      };
    });
  });
}

async function selectAudioFiles() {
  cloneAudioFiles = await ipcRenderer.invoke('eleven-upload-audio');
  const listEl = document.getElementById('audioFileList');
  if (cloneAudioFiles.length > 0) {
    listEl.innerHTML = cloneAudioFiles.map(f => '<div style="color:#e2e8f0">\\u2022 ' + f.split('/').pop() + '</div>').join('');
  } else {
    listEl.textContent = 'No files selected';
  }
}

async function cloneVoice() {
  const name = document.getElementById('cloneNameInput').value.trim();
  const desc = document.getElementById('cloneDescInput').value.trim();
  if (!name) { document.getElementById('cloneStatus').textContent = 'Please enter a voice name'; return; }
  if (cloneAudioFiles.length === 0) { document.getElementById('cloneStatus').textContent = 'Please upload audio samples'; return; }

  const btn = document.getElementById('cloneBtn');
  btn.textContent = 'Cloning...';
  btn.disabled = true;
  document.getElementById('cloneStatus').textContent = 'Uploading and cloning voice...';

  const result = await ipcRenderer.invoke('eleven-clone-voice', name, desc || 'Cloned via ISIBI Ghost Mode', cloneAudioFiles);

  btn.textContent = 'Clone Voice';
  btn.disabled = false;

  if (result.voice_id) {
    document.getElementById('cloneStatus').textContent = '\\u2713 Voice cloned successfully!';
    document.getElementById('cloneNameInput').value = '';
    document.getElementById('cloneDescInput').value = '';
    document.getElementById('audioFileList').textContent = 'No files selected';
    cloneAudioFiles = [];
    // Auto-select the new voice
    await ipcRenderer.invoke('eleven-set-voice', result.voice_id);
    selectedVoiceId = result.voice_id;
    await loadVoices();
  } else {
    document.getElementById('cloneStatus').textContent = '\\u2717 Failed: ' + (result.detail?.message || result.error || 'Unknown error');
  }
}

// ── Call Listening Mode ──
let callRec = null;
let callListening = false;

ipcRenderer.on('start-call-listen', () => {
  console.log('[CallListen] Starting...');
  callListening = true;
  const S = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!S) return;
  callRec = new S();
  callRec.continuous = true;
  callRec.interimResults = false;
  callRec.lang = document.getElementById('languageSelect')?.value || '';
  callRec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const text = e.results[i][0].transcript;
        console.log('[CallListen] Heard:', text);
        ipcRenderer.invoke('call-transcription', text);
      }
    }
  };
  callRec.onend = () => { if (callListening) try { callRec.start(); } catch(e) {} };
  callRec.onerror = (e) => { console.log('[CallListen] Error:', e.error); };
  try { callRec.start(); } catch(e) {}
});

ipcRenderer.on('stop-call-listen', () => {
  console.log('[CallListen] Stopping...');
  callListening = false;
  try { if (callRec) callRec.stop(); } catch(e) {}
  callRec = null;
});

// ── Expose ALL functions to window FIRST (before init) ──
window.openCreateAgent = openCreateAgent;
window.switchView = switchView;
window.trySuggestion = trySuggestion;
window.toggleSettings = toggleSettings;
window.saveProfile = saveProfile;
window.closeModal = closeModal;
window.saveAgent = saveAgent;
window.undoLast = undoLast;
window.toggleTheme = toggleTheme;
window.doLogout = doLogout;
window.sendAgentReply = sendAgentReply;
window.toggleNotifs = toggleNotifs;
window.clearNotifs = clearNotifs;
window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.saveScheduledTask = saveScheduledTask;
window.updateScheduleFields = updateScheduleFields;
window.selectAudioFiles = selectAudioFiles;
window.cloneVoice = cloneVoice;
window.buyCredits = buyCredits;
window.clearHistory = clearHistory;
window.deleteCurrentAgent = deleteCurrentAgent;
window.openEditAgent = openEditAgent;
window.renderPickers = renderPickers;
window.loadCreditPlans = loadCreditPlans;
window.loadUsage = loadUsage;
window.loadSchedules = loadSchedules;
window.loadHistory = loadHistory;
window.loadVoices = loadVoices;

// ── Boot ──
init().catch(e => console.error('[Boot] Error:', e));
</script>
</body>
</html>`;
