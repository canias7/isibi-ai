/**
 * ISIBI Ghost Mode — First-Run Onboarding Wizard
 *
 * 5-step setup: Welcome → Profile → Accessibility → Screen Recording → Done
 * No API key needed — bundled with the app.
 */

import { BrowserWindow, ipcMain, shell, systemPreferences, desktopCapturer, session } from 'electron';
import { saveConfig } from './config';

let onboardingWindow: BrowserWindow | null = null;
let onCompleteCallback: (() => void) | null = null;

export function createOnboardingWindow(onComplete: () => void): void {
  onCompleteCallback = onComplete;

  onboardingWindow = new BrowserWindow({
    width: 500,
    height: 520,
    title: 'ISIBI Ghost Mode Setup',
    frame: false,
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: '#0a0015',
  });

  onboardingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  onboardingWindow.on('closed', () => { onboardingWindow = null; });
}

let ipcRegistered = false;
export function registerOnboardingIPC(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('onboarding-check-accessibility', () => {
    if (process.platform === 'darwin') return systemPreferences.isTrustedAccessibilityClient(false);
    return true;
  });

  ipcMain.handle('onboarding-check-screen-recording', async () => {
    if (process.platform === 'darwin') {
      try { const s = await desktopCapturer.getSources({ types: ['screen'] }); return s.length > 0; }
      catch { return false; }
    }
    return true;
  });

  ipcMain.handle('onboarding-open-accessibility', () => {
    if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
  });

  ipcMain.handle('onboarding-open-screen-recording', () => {
    if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });

  ipcMain.handle('onboarding-check-microphone', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      return status === 'granted';
    }
    return true;
  });

  ipcMain.handle('onboarding-request-microphone', async () => {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted;
    }
    return true;
  });

  ipcMain.handle('onboarding-save-profile', (_, name: string) => {
    const wakeWord = 'hey ' + name.toLowerCase().trim();
    saveConfig({ assistantName: name.trim(), assistantWakeWord: wakeWord });
    return { ok: true, wakeWord };
  });

  ipcMain.handle('onboarding-complete', () => {
    saveConfig({ firstRunComplete: true });
    if (onboardingWindow) { onboardingWindow.close(); onboardingWindow = null; }
    if (onCompleteCallback) onCompleteCallback();
  });
}

const HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0015;color:#f0e6ff;height:100vh;overflow:hidden;-webkit-app-region:drag}
.wiz{height:100%;display:flex;flex-direction:column}
.tb{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 0}
.tb .dots{display:flex;gap:6px}
.dot{width:12px;height:12px;border-radius:50%;cursor:pointer;-webkit-app-region:no-drag}
.dot.c{background:#ef4444}.dot.c:hover{background:#dc2626}
.dot.m{background:#eab308}.dot.g{background:#22c55e}
.tb .sl{font-size:11px;color:rgba(240,230,255,.3)}
.s{flex:1;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px 40px;text-align:center;gap:14px;-webkit-app-region:no-drag}
.s.on{display:flex}
.orb{width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 38% 38%,#f472b6,#ec4899 40%,#a855f7 70%,#6366f1);box-shadow:0 0 28px rgba(236,72,153,.5),0 0 56px rgba(236,72,153,.2);animation:fl 3s ease-in-out infinite}
.orb.cel{animation:cel 1s ease-in-out infinite;box-shadow:0 0 44px rgba(236,72,153,.7),0 0 88px rgba(236,72,153,.3)}
@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes cel{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#ec4899,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:17px;font-weight:600;color:#f0e6ff}
p{font-size:13px;color:rgba(240,230,255,.45);line-height:1.5;max-width:380px}
.ico{width:50px;height:50px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:26px}
.ico.ac{background:rgba(236,72,153,.12)}.ico.sc{background:rgba(139,92,246,.12)}.ico.pr{background:rgba(99,102,241,.12)}.ico.mc{background:rgba(239,68,68,.12)}
.badge{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:16px;font-size:11px;font-weight:600}
.badge.ok{background:rgba(34,197,94,.1);color:#86efac}
.badge.wait{background:rgba(234,179,8,.1);color:#fde047}
.btn{padding:10px 24px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;-webkit-app-region:no-drag}
.btn.p{background:linear-gradient(135deg,#ec4899,#8b5cf6);color:#fff;box-shadow:0 0 16px rgba(236,72,153,.25)}
.btn.p:hover{box-shadow:0 0 24px rgba(236,72,153,.45);transform:translateY(-1px)}
.btn.g{background:rgba(255,255,255,.05);color:#c4b5fd;border:1px solid rgba(139,92,246,.18)}
.btn.g:hover{background:rgba(255,255,255,.09)}
.br{display:flex;gap:8px;margin-top:4px}
.hint{font-size:10px;color:rgba(240,230,255,.2);margin-top:2px}
.pips{display:flex;gap:7px;padding:14px;justify-content:center}
.pip{width:7px;height:7px;border-radius:50%;background:rgba(240,230,255,.12);transition:.3s}
.pip.on{background:#ec4899;box-shadow:0 0 6px rgba(236,72,153,.5)}
.pip.dn{background:#22c55e}
.cl{text-align:left;display:flex;flex-direction:column;gap:6px}
.ci{display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(240,230,255,.55)}
.name-input{width:260px;padding:12px 18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;color:#f0e6ff;font-size:18px;font-weight:600;text-align:center;outline:none;font-family:inherit;transition:.2s}
.name-input:focus{border-color:rgba(236,72,153,.4);box-shadow:0 0 16px rgba(236,72,153,.15)}
.name-input::placeholder{color:rgba(240,230,255,.2);font-weight:400}
.preview{padding:8px 16px;border-radius:10px;background:rgba(236,72,153,.06);border:1px solid rgba(236,72,153,.1);font-size:13px;color:#f9a8d4;min-height:36px;transition:.2s}
</style></head><body>
<div class="wiz">
<div class="tb"><div class="dots"><div class="dot c" onclick="window.close()"></div><div class="dot m"></div><div class="dot g"></div></div><span class="sl" id="sl">Step 1 of 6</span></div>

<div class="s on" id="s1"><div class="orb"></div><h1>Ghost Mode</h1><p>Your AI agent that controls your computer. Let's set things up — takes a minute.</p><button class="btn p" onclick="go(2)">Get Started</button></div>

<div class="s" id="s2"><div class="ico pr">\ud83d\udc64</div><h2>Name Your Assistant</h2><p>Choose a name for your AI assistant. You'll summon it by saying "Hey [name]".</p><input class="name-input" id="nameInput" placeholder="e.g. Isibi" maxlength="20" value="Isibi"><div class="preview" id="namePreview">Say <b>"Hey Isibi"</b> to summon me</div><button class="btn p" onclick="saveProfile()">Continue</button></div>

<div class="s" id="s3"><div class="ico mc">\ud83c\udf99\ufe0f</div><h2>Microphone Access</h2><p>Ghost Mode needs your microphone to hear voice commands and your wake word.</p><div id="mb" class="badge wait">\u23f3 Not granted yet</div><div class="br"><button class="btn p" onclick="reqMic()">Allow Microphone</button></div><div class="hint">A system dialog will appear — click "OK" to allow</div></div>

<div class="s" id="s4"><div class="ico ac">\ud83d\uddb1\ufe0f</div><h2>Accessibility Access</h2><p>Ghost Mode needs to control your mouse and keyboard to interact with apps for you.</p><div id="ab" class="badge wait">\u23f3 Not granted yet</div><div class="br"><button class="btn g" onclick="openAcc()">Open Settings</button><button class="btn p" onclick="nextAcc()">I've Enabled It</button></div><div class="hint">System Settings \u2192 Privacy & Security \u2192 Accessibility</div></div>

<div class="s" id="s5"><div class="ico sc">\ud83d\udda5\ufe0f</div><h2>Screen Recording</h2><p>Ghost Mode needs to see your screen to find buttons, read text, and navigate visually.</p><div id="sb" class="badge wait">\u23f3 Not granted yet</div><div class="br"><button class="btn g" onclick="openScr()">Open Settings</button><button class="btn p" onclick="nextScr()">I've Enabled It</button></div><div class="hint">System Settings \u2192 Privacy & Security \u2192 Screen Recording</div></div>

<div class="s" id="s6"><div class="orb cel"></div><h1>You're All Set!</h1><div class="cl"><div class="ci">\u2705 Assistant: <b id="doneNameLabel">Isibi</b></div><div class="ci">\u2705 Microphone access</div><div class="ci">\u2705 Accessibility access</div><div class="ci">\u2705 Screen recording</div></div><p>Say <b>"Hey <span id="doneWakeLabel">Isibi</span>"</b> anytime to summon your assistant.</p><button class="btn p" onclick="finish()">Launch Ghost Mode</button></div>

<div class="pips" id="pips"><div class="pip on"></div><div class="pip"></div><div class="pip"></div><div class="pip"></div><div class="pip"></div><div class="pip"></div></div>
</div>
<script>
const{ipcRenderer}=require('electron');
const TOTAL=6;
let chosenName='Isibi';

function go(n){
  document.querySelectorAll('.s').forEach(s=>s.classList.remove('on'));
  document.getElementById('s'+n).classList.add('on');
  document.getElementById('sl').textContent='Step '+n+' of '+TOTAL;
  document.querySelectorAll('.pip').forEach((p,i)=>{p.className='pip';if(i+1===n)p.classList.add('on');else if(i+1<n)p.classList.add('dn')});
  if(n===2){const ni=document.getElementById('nameInput');ni.focus();ni.select()}
  if(n===3)chkMic();
  if(n===4)chkAcc();if(n===5)chkScr();
  if(n===6){document.getElementById('doneNameLabel').textContent=chosenName;document.getElementById('doneWakeLabel').textContent=chosenName}
}

// Profile name input — live preview
const nameInput=document.getElementById('nameInput');
const namePreview=document.getElementById('namePreview');
nameInput.addEventListener('input',()=>{
  const v=nameInput.value.trim()||'Isibi';
  namePreview.innerHTML='Say <b>"Hey '+v+'"</b> to summon me';
});

async function saveProfile(){
  chosenName=nameInput.value.trim()||'Isibi';
  await ipcRenderer.invoke('onboarding-save-profile',chosenName);
  go(3);
}

// Microphone
async function chkMic(){const g=await ipcRenderer.invoke('onboarding-check-microphone');const b=document.getElementById('mb');b.className='badge '+(g?'ok':'wait');b.textContent=g?'\u2713 Granted':'\u23f3 Not granted yet';if(g)setTimeout(()=>go(4),500)}
async function reqMic(){
  const granted=await ipcRenderer.invoke('onboarding-request-microphone');
  const b=document.getElementById('mb');
  b.className='badge '+(granted?'ok':'wait');
  b.textContent=granted?'\u2713 Granted':'\u23f3 Not granted yet';
  if(granted)setTimeout(()=>go(4),600);
}

async function chkAcc(){const g=await ipcRenderer.invoke('onboarding-check-accessibility');const b=document.getElementById('ab');b.className='badge '+(g?'ok':'wait');b.textContent=g?'\u2713 Granted':'\u23f3 Not granted yet'}
function openAcc(){ipcRenderer.invoke('onboarding-open-accessibility')}
async function nextAcc(){await chkAcc();go(5)}
async function chkScr(){const g=await ipcRenderer.invoke('onboarding-check-screen-recording');const b=document.getElementById('sb');b.className='badge '+(g?'ok':'wait');b.textContent=g?'\u2713 Granted':'\u23f3 Not granted yet'}
function openScr(){ipcRenderer.invoke('onboarding-open-screen-recording')}
async function nextScr(){await chkScr();go(6)}
function finish(){ipcRenderer.invoke('onboarding-complete')}
</script></body></html>`;
