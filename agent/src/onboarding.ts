/**
 * ISIBI Ghost Mode — First-Run Onboarding Wizard
 *
 * A beautiful 5-step setup that requests permissions and API key.
 */

import { BrowserWindow, ipcMain, shell, systemPreferences, desktopCapturer } from 'electron';
import { saveConfig } from './config';

let onboardingWindow: BrowserWindow | null = null;

/** Callback invoked when onboarding finishes — main.ts hooks into this. */
let onCompleteCallback: (() => void) | null = null;

export function createOnboardingWindow(onComplete: () => void): void {
  onCompleteCallback = onComplete;

  onboardingWindow = new BrowserWindow({
    width: 560,
    height: 520,
    title: 'ISIBI Ghost Mode Setup',
    frame: false,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0a0015',
  });

  onboardingWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(ONBOARDING_HTML)}`
  );

  onboardingWindow.on('closed', () => { onboardingWindow = null; });
}

// ── IPC Handlers (registered once) ───────────────────────────────────────

let ipcRegistered = false;

export function registerOnboardingIPC(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('onboarding-check-accessibility', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false);
    }
    return true; // Windows/Linux: auto-granted
  });

  ipcMain.handle('onboarding-check-screen-recording', async () => {
    if (process.platform === 'darwin') {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return sources.length > 0;
      } catch {
        return false;
      }
    }
    return true;
  });

  ipcMain.handle('onboarding-open-accessibility', () => {
    if (process.platform === 'darwin') {
      // Prompt the OS dialog
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  });

  ipcMain.handle('onboarding-open-screen-recording', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  });

  ipcMain.handle('onboarding-save-api-key', (_, key: string) => {
    saveConfig({ anthropicApiKey: key });
    return { ok: true };
  });

  ipcMain.handle('onboarding-complete', () => {
    saveConfig({ firstRunComplete: true });
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }
    if (onCompleteCallback) onCompleteCallback();
  });
}

// ── Onboarding HTML ──────────────────────────────────────────────────────

const ONBOARDING_HTML = `<!DOCTYPE html>
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
.wizard {
  height: 100%; display: flex; flex-direction: column;
}

/* ── Title bar ── */
.titlebar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px 0; -webkit-app-region: drag;
}
.titlebar .dots { display: flex; gap: 6px; }
.titlebar .dot {
  width: 12px; height: 12px; border-radius: 50%; cursor: pointer;
  -webkit-app-region: no-drag;
}
.dot.close { background: #ef4444; }
.dot.close:hover { background: #dc2626; }
.dot.min { background: #eab308; }
.dot.max { background: #22c55e; }
.titlebar .step-label {
  font-size: 11px; color: rgba(240,230,255,.3);
}

/* ── Steps container ── */
.step {
  flex: 1; display: none; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 24px 40px; text-align: center; gap: 16px;
  -webkit-app-region: no-drag;
}
.step.active { display: flex; }

/* ── Orb ── */
.orb {
  width: 72px; height: 72px; border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1);
  box-shadow: 0 0 30px rgba(236,72,153,.5), 0 0 60px rgba(236,72,153,.2);
  animation: float 3s ease-in-out infinite;
}
.orb.celebrate {
  animation: celebrate 1s ease-in-out infinite;
  box-shadow: 0 0 50px rgba(236,72,153,.7), 0 0 100px rgba(236,72,153,.3);
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
@keyframes celebrate {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

h1 {
  font-size: 24px; font-weight: 700;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
h2 {
  font-size: 18px; font-weight: 600; color: #f0e6ff;
}
p { font-size: 14px; color: rgba(240,230,255,.5); line-height: 1.6; max-width: 400px; }

/* ── Permission icon ── */
.perm-icon {
  width: 56px; height: 56px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
}
.perm-icon.accessibility { background: rgba(236,72,153,.15); }
.perm-icon.screen { background: rgba(139,92,246,.15); }
.perm-icon.key { background: rgba(99,102,241,.15); }

/* ── Status badge ── */
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.badge.granted { background: rgba(34,197,94,.12); color: #86efac; }
.badge.pending { background: rgba(234,179,8,.12); color: #fde047; }

/* ── Buttons ── */
.btn {
  padding: 12px 28px; border-radius: 12px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s; -webkit-app-region: no-drag;
}
.btn-primary {
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: white; box-shadow: 0 0 20px rgba(236,72,153,.3);
}
.btn-primary:hover { box-shadow: 0 0 30px rgba(236,72,153,.5); transform: translateY(-1px); }
.btn-secondary {
  background: rgba(255,255,255,.06); color: #c4b5fd;
  border: 1px solid rgba(139,92,246,.2);
}
.btn-secondary:hover { background: rgba(255,255,255,.1); }
.btn-row { display: flex; gap: 10px; margin-top: 8px; }

/* ── API key input ── */
.key-input {
  width: 100%; max-width: 380px; padding: 12px 16px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(236,72,153,.2);
  border-radius: 10px; color: #f0e6ff; font-size: 14px;
  font-family: 'SF Mono', monospace; outline: none; text-align: center;
}
.key-input:focus { border-color: #ec4899; box-shadow: 0 0 16px rgba(236,72,153,.15); }
.key-input::placeholder { color: rgba(240,230,255,.2); }
.error-text { color: #fca5a5; font-size: 12px; }
.success-text { color: #86efac; font-size: 12px; }

/* ── Progress dots ── */
.progress {
  display: flex; gap: 8px; padding: 16px; justify-content: center;
}
.progress .pip {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(240,230,255,.15); transition: all 0.3s;
}
.progress .pip.active { background: #ec4899; box-shadow: 0 0 8px rgba(236,72,153,.5); }
.progress .pip.done { background: #22c55e; }

/* ── Checklist ── */
.checklist { text-align: left; display: flex; flex-direction: column; gap: 8px; }
.check-item {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; color: rgba(240,230,255,.6);
}
.check-item .icon { font-size: 16px; }

a { color: #c4b5fd; text-decoration: underline; cursor: pointer; }
a:hover { color: #ec4899; }
</style>
</head>
<body>
<div class="wizard">
  <div class="titlebar">
    <div class="dots">
      <div class="dot close" onclick="window.close()"></div>
      <div class="dot min"></div>
      <div class="dot max"></div>
    </div>
    <span class="step-label" id="stepLabel">Step 1 of 5</span>
  </div>

  <!-- STEP 1: Welcome -->
  <div class="step active" id="step1">
    <div class="orb"></div>
    <h1>Ghost Mode</h1>
    <p>Your AI agent that controls your computer. Let's get you set up in under a minute.</p>
    <button class="btn btn-primary" onclick="goTo(2)">Get Started</button>
  </div>

  <!-- STEP 2: Accessibility -->
  <div class="step" id="step2">
    <div class="perm-icon accessibility">🖱️</div>
    <h2>Accessibility Access</h2>
    <p>Ghost Mode needs permission to control your mouse and keyboard so it can interact with apps for you.</p>
    <div id="accBadge" class="badge pending">⏳ Not granted yet</div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="openAccessibility()">Open Settings</button>
      <button class="btn btn-primary" onclick="checkAccessAndNext()">I've Enabled It</button>
    </div>
    <p style="font-size:11px; color: rgba(240,230,255,.25); margin-top: 4px;">
      System Settings → Privacy & Security → Accessibility
    </p>
  </div>

  <!-- STEP 3: Screen Recording -->
  <div class="step" id="step3">
    <div class="perm-icon screen">🖥️</div>
    <h2>Screen Recording</h2>
    <p>Ghost Mode needs to see your screen so it can find buttons, read text, and navigate apps visually.</p>
    <div id="scrBadge" class="badge pending">⏳ Not granted yet</div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="openScreenRecording()">Open Settings</button>
      <button class="btn btn-primary" onclick="checkScreenAndNext()">I've Enabled It</button>
    </div>
    <p style="font-size:11px; color: rgba(240,230,255,.25); margin-top: 4px;">
      System Settings → Privacy & Security → Screen Recording
    </p>
  </div>

  <!-- STEP 4: API Key -->
  <div class="step" id="step4">
    <div class="perm-icon key">🔑</div>
    <h2>Anthropic API Key</h2>
    <p>Ghost Mode uses Claude to think and plan. Paste your API key below.</p>
    <input class="key-input" id="apiKeyInput" type="password" placeholder="sk-ant-api03-..." spellcheck="false">
    <div id="keyMsg"></div>
    <div class="btn-row">
      <a href="#" onclick="require('electron').shell.openExternal('https://console.anthropic.com/settings/keys'); return false;" style="font-size:13px;">Get a key →</a>
      <button class="btn btn-primary" onclick="saveKey()">Save & Continue</button>
    </div>
  </div>

  <!-- STEP 5: Done -->
  <div class="step" id="step5">
    <div class="orb celebrate"></div>
    <h1>You're All Set!</h1>
    <div class="checklist">
      <div class="check-item"><span class="icon">✅</span> Accessibility access</div>
      <div class="check-item"><span class="icon">✅</span> Screen recording</div>
      <div class="check-item"><span class="icon">✅</span> API key saved</div>
    </div>
    <p>Press <b>F9</b> anytime to summon Ghost Mode.</p>
    <button class="btn btn-primary" onclick="finish()">Launch Ghost Mode</button>
  </div>

  <div class="progress" id="progress">
    <div class="pip active"></div>
    <div class="pip"></div>
    <div class="pip"></div>
    <div class="pip"></div>
    <div class="pip"></div>
  </div>
</div>

<script>
const { ipcRenderer } = require('electron');
let currentStep = 1;

function goTo(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  currentStep = n;

  document.getElementById('stepLabel').textContent = 'Step ' + n + ' of 5';

  // Update progress pips
  const pips = document.querySelectorAll('.progress .pip');
  pips.forEach((p, i) => {
    p.className = 'pip';
    if (i + 1 === n) p.classList.add('active');
    else if (i + 1 < n) p.classList.add('done');
  });

  // Auto-check permissions when arriving at their steps
  if (n === 2) checkAccessibility();
  if (n === 3) checkScreenRecording();
}

// ── Accessibility ──
async function checkAccessibility() {
  const granted = await ipcRenderer.invoke('onboarding-check-accessibility');
  const badge = document.getElementById('accBadge');
  if (granted) {
    badge.className = 'badge granted';
    badge.textContent = '✓ Granted';
  } else {
    badge.className = 'badge pending';
    badge.textContent = '⏳ Not granted yet';
  }
  return granted;
}

function openAccessibility() {
  ipcRenderer.invoke('onboarding-open-accessibility');
}

async function checkAccessAndNext() {
  await checkAccessibility();
  goTo(3); // Always allow proceeding
}

// ── Screen Recording ──
async function checkScreenRecording() {
  const granted = await ipcRenderer.invoke('onboarding-check-screen-recording');
  const badge = document.getElementById('scrBadge');
  if (granted) {
    badge.className = 'badge granted';
    badge.textContent = '✓ Granted';
  } else {
    badge.className = 'badge pending';
    badge.textContent = '⏳ Not granted yet';
  }
  return granted;
}

function openScreenRecording() {
  ipcRenderer.invoke('onboarding-open-screen-recording');
}

async function checkScreenAndNext() {
  await checkScreenRecording();
  goTo(4);
}

// ── API Key ──
async function saveKey() {
  const input = document.getElementById('apiKeyInput');
  const msg = document.getElementById('keyMsg');
  const key = input.value.trim();

  if (!key) {
    msg.className = 'error-text';
    msg.textContent = 'Please enter your API key.';
    return;
  }

  if (!key.startsWith('sk-ant-')) {
    msg.className = 'error-text';
    msg.textContent = 'Key should start with sk-ant-';
    return;
  }

  msg.className = 'success-text';
  msg.textContent = 'Saving...';

  await ipcRenderer.invoke('onboarding-save-api-key', key);

  msg.textContent = '✓ Saved!';
  setTimeout(() => goTo(5), 500);
}

// ── Finish ──
function finish() {
  ipcRenderer.invoke('onboarding-complete');
}
</script>
</body>
</html>`;
