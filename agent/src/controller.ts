/**
 * Screen Controller — moves mouse, clicks, types, presses keys.
 *
 * Uses @nut-tree-fork/nut-js for cross-platform mouse/keyboard control.
 * All movements are smooth and animated for the ghost orb effect.
 */

import { mouse, keyboard, Point, Button, Key, straightTo, centerOf, screen } from '@nut-tree-fork/nut-js';

// Configure smooth mouse movement
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 600; // pixels per second

export interface ScreenSize {
  width: number;
  height: number;
}

// ── Mouse Control ───────────────────────────────────────────────────────

export async function moveMouse(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
}

export async function click(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.click(Button.LEFT);
}

export async function doubleClick(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.doubleClick(Button.LEFT);
}

export async function rightClick(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.click(Button.RIGHT);
}

export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const pos = await mouse.getPosition();
  return { x: pos.x, y: pos.y };
}

// ── Keyboard Control ────────────────────────────────────────────────────

export async function typeText(text: string, delayMs = 50): Promise<void> {
  for (const char of text) {
    await keyboard.type(char);
    await sleep(delayMs + Math.random() * 20); // Natural typing speed
  }
}

export async function pressKey(...keys: Key[]): Promise<void> {
  await keyboard.pressKey(...keys);
  await sleep(50);
  await keyboard.releaseKey(...keys);
}

export async function pressEnter(): Promise<void> {
  await pressKey(Key.Enter);
}

export async function pressTab(): Promise<void> {
  await pressKey(Key.Tab);
}

export async function pressEscape(): Promise<void> {
  await pressKey(Key.Escape);
}

export async function selectAll(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.A);
  } else {
    await pressKey(Key.LeftControl, Key.A);
  }
}

export async function copy(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.C);
  } else {
    await pressKey(Key.LeftControl, Key.C);
  }
}

export async function paste(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.V);
  } else {
    await pressKey(Key.LeftControl, Key.V);
  }
}

// ── Drag ────────────────────────────────────────────────────────────────

export async function drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await mouse.move(straightTo(new Point(fromX, fromY)));
  await sleep(200);
  await mouse.pressButton(Button.LEFT);
  await sleep(100);
  await mouse.move(straightTo(new Point(toX, toY)));
  await sleep(100);
  await mouse.releaseButton(Button.LEFT);
}

// ── Clipboard ───────────────────────────────────────────────────────────

export function readClipboard(): string {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf-8', timeout: 3000 });
    } else if (process.platform === 'win32') {
      return execSync('powershell -Command "Get-Clipboard"', { encoding: 'utf-8', timeout: 3000 });
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 3000 });
    }
  } catch { return ''; }
}

export function writeClipboard(text: string): void {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'darwin') {
      execSync(`echo ${JSON.stringify(text)} | pbcopy`, { timeout: 3000 });
    } else if (process.platform === 'win32') {
      execSync(`echo ${JSON.stringify(text)} | clip`, { timeout: 3000 });
    } else {
      execSync(`echo ${JSON.stringify(text)} | xclip -selection clipboard`, { timeout: 3000 });
    }
  } catch { /* skip */ }
}

// ── File Operations ─────────────────────────────────────────────────────

export function createFile(filePath: string, content: string): void {
  const fs = require('fs');
  const path = require('path');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function readFile(filePath: string): string {
  const fs = require('fs');
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return ''; }
}

export function moveFile(from: string, to: string): void {
  const fs = require('fs');
  fs.renameSync(from, to);
}

export function deleteFile(filePath: string): void {
  const fs = require('fs');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── HTTP Request ────────────────────────────────────────────────────────

export async function httpRequest(url: string, method: string = 'GET', body?: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  const https = require('https');
  const http = require('http');
  const urlObj = new URL(url);
  const lib = urlObj.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const opts: any = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);

    const req = lib.request(opts, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Scroll ──────────────────────────────────────────────────────────────

export async function scrollDown(amount = 3): Promise<void> {
  await mouse.scrollDown(amount);
}

export async function scrollUp(amount = 3): Promise<void> {
  await mouse.scrollUp(amount);
}

// ── App Launching ───────────────────────────────────────────────────────

export async function openApp(appName: string): Promise<void> {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -a "${appName}"`);
  } else if (process.platform === 'win32') {
    execSync(`start "" "${appName}"`);
  } else {
    execSync(`xdg-open "${appName}" &`);
  }
  await sleep(1000); // Wait for app to open
}

export async function openUrl(url: string): Promise<void> {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open "${url}"`);
  } else if (process.platform === 'win32') {
    execSync(`start "" "${url}"`);
  } else {
    execSync(`xdg-open "${url}"`);
  }
  await sleep(1500);
}

// ── Spotlight / System Search ───────────────────────────────────────────

export async function openSpotlight(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.Space);
    await sleep(500);
  } else if (process.platform === 'win32') {
    await pressKey(Key.LeftSuper);
    await sleep(500);
  }
}

export async function searchAndOpen(query: string): Promise<void> {
  await openSpotlight();
  await typeText(query, 30);
  await sleep(500);
  await pressEnter();
  await sleep(1000);
}

// ── Screen Info ─────────────────────────────────────────────────────────

export async function getScreenSize(): Promise<ScreenSize> {
  const s = await screen.width();
  const h = await screen.height();
  return { width: s, height: h };
}

// ── Notifications & Speech ──────────────────────────────────────────────

export function showNotification(title: string, body: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`, { timeout: 5000 });
  } else if (process.platform === 'win32') {
    execSync(`powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(5000,'${title}','${body}',[System.Windows.Forms.ToolTipIcon]::None)"`, { timeout: 5000 });
  }
}

export function showAlert(title: string, message: string): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const result = execSync(`osascript -e 'display dialog "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" buttons {"Cancel","OK"} default button "OK"'`, { encoding: 'utf-8', timeout: 30000 });
      return result.includes('OK') ? 'ok' : 'cancel';
    } catch { return 'cancel'; }
  }
  return 'ok';
}

export function speak(text: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`say "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 });
  } else if (process.platform === 'win32') {
    execSync(`powershell -Command "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${text}')"`, { timeout: 30000 });
  }
}

// ── Window Management ───────────────────────────────────────────────────

export function listWindows(): { name: string; id: number; app: string }[] {
  const { execSync } = require('child_process');
  const windows: { name: string; id: number; app: string }[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "System Events"
  set winList to ""
  repeat with proc in (every process whose background only is false)
    set appName to name of proc
    repeat with w in windows of proc
      set winList to winList & appName & "|" & name of w & "|" & id of w & "\\n"
    end repeat
  end repeat
  return winList
end tell'`, { encoding: 'utf-8', timeout: 10000 });
      output.split('\n').forEach((line: string, i: number) => {
        const [app, name, id] = line.split('|');
        if (app && name) windows.push({ app: app.trim(), name: name.trim(), id: parseInt(id) || i });
      });
    } catch { /* skip */ }
  }
  return windows;
}

export function switchWindow(appName: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "${appName}" to activate'`, { timeout: 5000 });
  }
}

export function resizeWindow(width: number, height: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to set size of first window of first process whose frontmost is true to {${width}, ${height}}'`, { timeout: 5000 });
  }
}

export function moveWindow(x: number, y: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to set position of first window of first process whose frontmost is true to {${x}, ${y}}'`, { timeout: 5000 });
  }
}

export function splitScreen(app1: string, app2: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Get screen size, put app1 on left half, app2 on right half
    try {
      execSync(`osascript -e '
tell application "System Events"
  set scr to (get size of scroll area 1 of process "Finder")
end tell
set screenW to item 1 of scr
set screenH to item 2 of scr
set halfW to screenW / 2
tell application "${app1}" to activate
tell application "System Events"
  set position of first window of process "${app1}" to {0, 25}
  set size of first window of process "${app1}" to {halfW, screenH - 25}
end tell
tell application "${app2}" to activate
tell application "System Events"
  set position of first window of process "${app2}" to {halfW, 25}
  set size of first window of process "${app2}" to {halfW, screenH - 25}
end tell'`, { timeout: 10000 });
    } catch {
      // Fallback: just activate both apps
      execSync(`osascript -e 'tell application "${app1}" to activate'`);
      execSync(`osascript -e 'tell application "${app2}" to activate'`);
    }
  }
}

// ── System Control ──────────────────────────────────────────────────────

export function setVolume(percent: number): void {
  const { execSync } = require('child_process');
  const vol = Math.max(0, Math.min(100, percent));
  if (process.platform === 'darwin') {
    // macOS volume is 0-100
    execSync(`osascript -e 'set volume output volume ${vol}'`, { timeout: 3000 });
  }
}

export function getVolume(): number {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'output volume of (get volume settings)'`, { encoding: 'utf-8', timeout: 3000 });
      return parseInt(output.trim()) || 50;
    } catch { return 50; }
  }
  return 50;
}

export function toggleWifi(on: boolean): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`networksetup -setairportpower en0 ${on ? 'on' : 'off'}`, { timeout: 5000 });
  }
}

export function toggleBluetooth(on: boolean): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      execSync(`blueutil --power ${on ? '1' : '0'}`, { timeout: 5000 });
    } catch { /* blueutil not installed */ }
  }
}

export function toggleDarkMode(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'`, { timeout: 5000 });
  }
}

export function isDarkMode(): boolean {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`defaults read -g AppleInterfaceStyle 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 });
      return output.trim().toLowerCase() === 'dark';
    } catch { return false; }
  }
  return false;
}

export function sleepComputer(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`pmset sleepnow`, { timeout: 3000 });
  } else if (process.platform === 'win32') {
    execSync(`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`, { timeout: 3000 });
  }
}

export function emptyTrash(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Finder" to empty the trash'`, { timeout: 10000 });
  }
}

export function getBattery(): { percent: number; charging: boolean } {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`pmset -g batt`, { encoding: 'utf-8', timeout: 3000 });
      const pMatch = output.match(/(\d+)%/);
      const charging = output.includes('charging') || output.includes('AC Power');
      return { percent: pMatch ? parseInt(pMatch[1]) : -1, charging };
    } catch { return { percent: -1, charging: false }; }
  }
  return { percent: -1, charging: false };
}

// ── Advanced Input ──────────────────────────────────────────────────────

export async function holdKey(key: Key, durationMs: number = 1000): Promise<void> {
  await keyboard.pressKey(key);
  await sleep(durationMs);
  await keyboard.releaseKey(key);
}

export async function selectTextRange(startX: number, startY: number, endX: number, endY: number): Promise<void> {
  await mouse.move(straightTo(new Point(startX, startY)));
  await sleep(100);
  await mouse.click(Button.LEFT);
  await sleep(100);
  await keyboard.pressKey(Key.LeftShift);
  await mouse.move(straightTo(new Point(endX, endY)));
  await sleep(100);
  await mouse.click(Button.LEFT);
  await keyboard.releaseKey(Key.LeftShift);
}

// ── Messaging (macOS AppleScript) ───────────────────────────────────────

export function sendIMessage(to: string, message: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${to.replace(/"/g, '\\"')}" of targetService
  send "${message.replace(/"/g, '\\"')}" to targetBuddy
end tell'`, { timeout: 10000 });
  }
}

export function readIMessages(from: string, count: number = 5): string[] {
  const { execSync } = require('child_process');
  const messages: string[] = [];
  if (process.platform === 'darwin') {
    try {
      // Read from Messages SQLite database
      const db = require('path').join(require('os').homedir(), 'Library/Messages/chat.db');
      const output = execSync(`sqlite3 "${db}" "SELECT text FROM message WHERE handle_id IN (SELECT ROWID FROM handle WHERE id LIKE '%${from.replace(/'/g, "''")}%') ORDER BY date DESC LIMIT ${count}"`, { encoding: 'utf-8', timeout: 5000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => messages.push(l.trim()));
    } catch { /* db locked or not accessible */ }
  }
  return messages;
}

// ── Calls (macOS) ───────────────────────────────────────────────────────

export function makeFaceTimeCall(contact: string, audioOnly: boolean = false): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const scheme = audioOnly ? 'facetime-audio' : 'facetime';
    execSync(`open "${scheme}://${contact}"`, { timeout: 5000 });
  }
}

export function answerCall(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Click the answer button via AppleScript
    execSync(`osascript -e 'tell application "System Events" to tell process "NotificationCenter" to click button 1 of first window'`, { timeout: 5000 });
  }
}

export function declineCall(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to tell process "NotificationCenter" to click button 2 of first window'`, { timeout: 5000 });
  }
}

export function endCall(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "FaceTime" to activate' -e 'tell application "System Events" to tell process "FaceTime" to click button "End" of window 1'`, { timeout: 5000 });
  }
}

// ── Calendar (macOS AppleScript) ────────────────────────────────────────

export function createCalendarEvent(title: string, startDate: string, endDate: string, calendar: string = ''): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const calPart = calendar ? `of calendar "${calendar}"` : '';
    execSync(`osascript -e 'tell application "Calendar"
  tell (first calendar ${calPart.replace(/"/g, '\\"')})
    make new event with properties {summary:"${title.replace(/"/g, '\\"')}", start date:date "${startDate}", end date:date "${endDate}"}
  end tell
end tell'`, { timeout: 10000 });
  }
}

export function listCalendarEvents(daysAhead: number = 1): string[] {
  const { execSync } = require('child_process');
  const events: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'set output to ""
tell application "Calendar"
  set today to current date
  set endDay to today + ${daysAhead} * days
  repeat with cal in calendars
    repeat with evt in (every event of cal whose start date >= today and start date <= endDay)
      set output to output & summary of evt & " | " & start date of evt & "\\n"
    end repeat
  end repeat
end tell
return output'`, { encoding: 'utf-8', timeout: 15000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => events.push(l.trim()));
    } catch { /* Calendar not accessible */ }
  }
  return events;
}

// ── Reminders (macOS AppleScript) ───────────────────────────────────────

export function createReminder(title: string, dueDate?: string, list?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const listPart = list ? `of list "${list}"` : '';
    const duePart = dueDate ? `, due date:date "${dueDate}"` : '';
    execSync(`osascript -e 'tell application "Reminders"
  make new reminder ${listPart} with properties {name:"${title.replace(/"/g, '\\"')}"${duePart}}
end tell'`, { timeout: 10000 });
  }
}

export function listReminders(): string[] {
  const { execSync } = require('child_process');
  const reminders: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'set output to ""
tell application "Reminders"
  repeat with r in (reminders whose completed is false)
    set output to output & name of r & "\\n"
  end repeat
end tell
return output'`, { encoding: 'utf-8', timeout: 10000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => reminders.push(l.trim()));
    } catch { /* Reminders not accessible */ }
  }
  return reminders;
}

// ── Notes (macOS AppleScript) ───────────────────────────────────────────

export function createNote(title: string, body: string, folder?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const folderPart = folder ? `in folder "${folder}"` : '';
    execSync(`osascript -e 'tell application "Notes"
  make new note ${folderPart} with properties {name:"${title.replace(/"/g, '\\"')}", body:"${body.replace(/"/g, '\\"')}"}
end tell'`, { timeout: 10000 });
  }
}

export function readNotes(search: string, count: number = 5): string[] {
  const { execSync } = require('child_process');
  const notes: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'set output to ""
tell application "Notes"
  set matchingNotes to every note whose name contains "${search.replace(/"/g, '\\"')}"
  set maxCount to ${count}
  set i to 0
  repeat with n in matchingNotes
    if i >= maxCount then exit repeat
    set output to output & name of n & ": " & plaintext of n & "\\n---\\n"
    set i to i + 1
  end repeat
end tell
return output'`, { encoding: 'utf-8', timeout: 15000 });
      output.split('\n---\n').filter((l: string) => l.trim()).forEach((l: string) => notes.push(l.trim()));
    } catch { /* Notes not accessible */ }
  }
  return notes;
}

// ── Contacts (macOS) ────────────────────────────────────────────────────

export function findContact(name: string): { name: string; phone: string; email: string } | null {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "Contacts"
  set p to first person whose name contains "${name.replace(/"/g, '\\"')}"
  set pName to name of p
  set pPhone to ""
  set pEmail to ""
  if (count of phones of p) > 0 then set pPhone to value of first phone of p
  if (count of emails of p) > 0 then set pEmail to value of first email of p
  return pName & "|" & pPhone & "|" & pEmail
end tell'`, { encoding: 'utf-8', timeout: 10000 });
      const [n, phone, email] = output.trim().split('|');
      return { name: n || name, phone: phone || '', email: email || '' };
    } catch { return null; }
  }
  return null;
}

// ── Weather (free API) ──────────────────────────────────────────────────

export async function getWeather(location: string): Promise<string> {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      https.get(`https://wttr.in/${encodeURIComponent(location)}?format=3`, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve(data.trim()));
      }).on('error', () => resolve('Weather unavailable'));
    });
  } catch { return 'Weather unavailable'; }
}

// ── Screen Recording ────────────────────────────────────────────────────

export function startScreenRecording(outputPath?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `recording-${Date.now()}.mov`);
    // Start recording in background
    require('child_process').exec(`screencapture -V 10 -v ${out}`);
  }
}

export function stopScreenRecording(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try { execSync('killall screencapture', { timeout: 3000 }); } catch {}
  }
}

// ── Terminal Command ────────────────────────────────────────────────────

export function runTerminalCommand(command: string): string {
  const { execSync } = require('child_process');
  try {
    return execSync(command, { encoding: 'utf-8', timeout: 30000 });
  } catch (e: any) {
    return e.stderr || e.message || 'Command failed';
  }
}

// ── Apple Shortcuts ─────────────────────────────────────────────────────

export function runShortcut(name: string, input?: string): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const inputPart = input ? ` -i "${input.replace(/"/g, '\\"')}"` : '';
      return execSync(`shortcuts run "${name.replace(/"/g, '\\"')}"${inputPart}`, { encoding: 'utf-8', timeout: 30000 });
    } catch (e: any) { return e.message || 'Shortcut failed'; }
  }
  return 'Shortcuts only available on macOS';
}

// ── Stock Price (free API) ──────────────────────────────────────────────

export async function getStockPrice(symbol: string): Promise<string> {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      https.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1d&range=1d`, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
            const currency = json?.chart?.result?.[0]?.meta?.currency || 'USD';
            resolve(price ? `${symbol.toUpperCase()}: $${price} ${currency}` : 'Price unavailable');
          } catch { resolve('Price unavailable'); }
        });
      }).on('error', () => resolve('Price unavailable'));
    });
  } catch { return 'Price unavailable'; }
}

// ── Utility ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep, Key };
