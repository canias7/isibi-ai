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

// ── Email ───────────────────────────────────────────────────────────────

export function sendEmail(to: string, subject: string, body: string): void {
  const { execSync } = require('child_process');
  const fs2 = require('fs');
  const path2 = require('path');
  if (process.platform === 'darwin') {
    // Write body and subject to temp files to avoid shell escaping issues
    const tmpBody = path2.join(require('os').tmpdir(), 'isibi-email-body.txt');
    const tmpScript = path2.join(require('os').tmpdir(), 'isibi-email-send.scpt');
    fs2.writeFileSync(tmpBody, body, 'utf-8');

    const script = `
set bodyFile to POSIX file "${tmpBody}"
set bodyText to read bodyFile as «class utf8»
tell application "Mail"
  activate
  delay 1
  set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g, '\\"')}", content:bodyText, visible:false}
  tell newMsg
    make new to recipient with properties {address:"${to.replace(/"/g, '\\"')}"}
  end tell
  send newMsg
end tell`;

    fs2.writeFileSync(tmpScript, script, 'utf-8');
    execSync(`osascript "${tmpScript}"`, { timeout: 30000 });
    try { fs2.unlinkSync(tmpBody); fs2.unlinkSync(tmpScript); } catch {}
  }
}

// ── Timers & Alarms ─────────────────────────────────────────────────────

export function setTimer(seconds: number, label?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const name = label || 'ISIBI Timer';
    // Use AppleScript to set a timer via Clock app or fallback to notification after delay
    try {
      execSync(`osascript -e 'tell application "Clock" to activate'`, { timeout: 3000 });
    } catch {
      // Clock app may not exist — use a background process with notification
      require('child_process').exec(`(sleep ${seconds} && osascript -e 'display notification "Timer done: ${name.replace(/"/g, '\\"')}" with title "ISIBI Timer" sound name "Glass"') &`);
    }
  }
}

export function setAlarm(time: string, label?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const name = label || 'ISIBI Alarm';
    // Create a calendar event as an alarm
    execSync(`osascript -e 'tell application "Calendar"
  tell first calendar
    set alarmDate to date "${time}"
    set newEvent to make new event with properties {summary:"${name.replace(/"/g, '\\"')}", start date:alarmDate, end date:alarmDate}
    tell newEvent
      make new display alarm at end with properties {trigger interval:0}
    end tell
  end tell
end tell'`, { timeout: 10000 });
  }
}

// ── Now Playing ─────────────────────────────────────────────────────────

export function getNowPlaying(): { track: string; artist: string; app: string } {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Try Spotify first
    try {
      const track = execSync(`osascript -e 'tell application "Spotify" to name of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      const artist = execSync(`osascript -e 'tell application "Spotify" to artist of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (track) return { track, artist, app: 'Spotify' };
    } catch {}
    // Try Apple Music
    try {
      const track = execSync(`osascript -e 'tell application "Music" to name of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      const artist = execSync(`osascript -e 'tell application "Music" to artist of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (track) return { track, artist, app: 'Apple Music' };
    } catch {}
  }
  return { track: 'Nothing playing', artist: '', app: '' };
}

// ── Contacts (add) ──────────────────────────────────────────────────────

export function addContact(name: string, phone?: string, email?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const nameParts = name.split(' ');
    const first = nameParts[0] || '';
    const last = nameParts.slice(1).join(' ') || '';
    let script = `tell application "Contacts"
  set newPerson to make new person with properties {first name:"${first.replace(/"/g, '\\"')}", last name:"${last.replace(/"/g, '\\"')}"}`;
    if (phone) {
      script += `\n  tell newPerson to make new phone at end of phones with properties {label:"mobile", value:"${phone.replace(/"/g, '\\"')}"}`;
    }
    if (email) {
      script += `\n  tell newPerson to make new email at end of emails with properties {label:"work", value:"${email.replace(/"/g, '\\"')}"}`;
    }
    script += `\n  save\nend tell`;
    execSync(`osascript -e '${script}'`, { timeout: 10000 });
  }
}

// ── Maps & Navigation ───────────────────────────────────────────────────

export function getDirections(from: string, to: string): void {
  const { execSync } = require('child_process');
  const url = `https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
  execSync(`open "${url}"`, { timeout: 5000 });
}

export function findNearby(query: string): void {
  const { execSync } = require('child_process');
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  execSync(`open "${url}"`, { timeout: 5000 });
}

// ── Currency Conversion ─────────────────────────────────────────────────

export async function convertCurrency(amount: number, from: string, to: string): Promise<string> {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      https.get(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const rate = json?.rates?.[to.toUpperCase()];
            if (rate) {
              const converted = (amount * rate).toFixed(2);
              resolve(`${amount} ${from.toUpperCase()} = ${converted} ${to.toUpperCase()}`);
            } else {
              resolve('Currency not found');
            }
          } catch { resolve('Conversion failed'); }
        });
      }).on('error', () => resolve('Conversion failed'));
    });
  } catch { return 'Conversion failed'; }
}

// ── Screenshot Area ─────────────────────────────────────────────────────

export function screenshotArea(outputPath?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `screenshot-${Date.now()}.png`);
    // -i = interactive mode (user selects area), -s = selection only
    execSync(`screencapture -i -s ${out}`, { timeout: 30000 });
  }
}

// ── Social Media ────────────────────────────────────────────────────────

export function postTweet(text: string): void {
  const { execSync } = require('child_process');
  // Open Twitter/X compose with pre-filled text
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  execSync(`open "${url}"`, { timeout: 5000 });
}

export function checkNotifications(): string[] {
  const { execSync } = require('child_process');
  const notifications: string[] = [];
  if (process.platform === 'darwin') {
    try {
      // Read from notification center database
      const db = require('path').join(require('os').homedir(), 'Library/Group Containers/group.com.apple.usernoted/db2/db');
      const output = execSync(`sqlite3 "${db}" "SELECT json_extract(data, '$.req.titl'), json_extract(data, '$.req.body') FROM record ORDER BY delivered_date DESC LIMIT 10" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => notifications.push(l.trim()));
    } catch {
      // Fallback: check via AppleScript
      try {
        const output = execSync(`osascript -e 'tell application "System Events" to get every notification'`, { encoding: 'utf-8', timeout: 5000 });
        if (output.trim()) notifications.push(output.trim());
      } catch {}
    }
  }
  return notifications.length > 0 ? notifications : ['No recent notifications'];
}

// ── Productivity ────────────────────────────────────────────────────────

export async function translateText(text: string, targetLang: string): Promise<string> {
  try {
    const https = require('https');
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${encodeURIComponent(targetLang)}`;
    return new Promise((resolve) => {
      https.get(url, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json?.responseData?.translatedText || 'Translation failed');
          } catch { resolve('Translation failed'); }
        });
      }).on('error', () => resolve('Translation failed'));
    });
  } catch { return 'Translation failed'; }
}

export function createSpreadsheet(filePath: string, headers: string[], rows?: string[][]): void {
  const fs = require('fs');
  const path = require('path');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let csv = headers.join(',') + '\n';
  if (rows) {
    rows.forEach((row: string[]) => {
      csv += row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(',') + '\n';
    });
  }
  fs.writeFileSync(filePath, csv, 'utf-8');
}

export function addToSpreadsheet(filePath: string, row: string[]): void {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return;
  const csvRow = row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(',') + '\n';
  fs.appendFileSync(filePath, csvRow, 'utf-8');
}

// ── Developer Tools ─────────────────────────────────────────────────────

export function gitCommand(command: string, repoPath?: string): string {
  const { execSync } = require('child_process');
  try {
    const cwd = repoPath || process.cwd();
    return execSync(`git ${command}`, { encoding: 'utf-8', cwd, timeout: 15000 });
  } catch (e: any) { return e.stderr || e.message || 'Git command failed'; }
}

export function runPython(code: string): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`python3 -c ${JSON.stringify(code)}`, { encoding: 'utf-8', timeout: 30000 });
  } catch (e: any) { return e.stderr || e.message || 'Python execution failed'; }
}

export function runNode(code: string): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`node -e ${JSON.stringify(code)}`, { encoding: 'utf-8', timeout: 30000 });
  } catch (e: any) { return e.stderr || e.message || 'Node execution failed'; }
}

export function openInVSCode(filePath: string): void {
  const { execSync } = require('child_process');
  try {
    execSync(`code "${filePath}"`, { timeout: 5000 });
  } catch {
    // VS Code CLI not in PATH — try direct
    try {
      execSync(`open -a "Visual Studio Code" "${filePath}"`, { timeout: 5000 });
    } catch {}
  }
}

// ── Smart Home ──────────────────────────────────────────────────────────

export function controlHomeKit(device: string, action: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Use Shortcuts to control HomeKit (most reliable way)
    try {
      execSync(`shortcuts run "ISIBI HomeKit" -i '{"device":"${device}","action":"${action}"}'`, { timeout: 10000 });
    } catch {
      // Fallback: open Home app
      execSync(`open -a "Home"`, { timeout: 5000 });
    }
  }
}

export function playAirPlay(deviceName: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Switch audio output via AppleScript
    try {
      execSync(`osascript -e 'tell application "System Events"
  tell process "ControlCenter"
    click menu bar item "Sound" of menu bar 1
  end tell
end tell'`, { timeout: 5000 });
    } catch {}
  }
}

// ── AI-Powered Actions ──────────────────────────────────────────────────

export function analyzeImageFile(imagePath: string): Buffer | null {
  const fs = require('fs');
  try {
    return fs.readFileSync(imagePath);
  } catch { return null; }
}

export async function fetchWebpage(url: string): Promise<string> {
  const https = require('https');
  const http = require('http');
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve) => {
    lib.get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        // Strip HTML tags for plain text
        const text = data.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        resolve(text);
      });
    }).on('error', () => resolve('Failed to fetch page'));
  });
}

// ── Communication ───────────────────────────────────────────────────────

export function createZoomMeeting(): void {
  const { execSync } = require('child_process');
  // Open Zoom new meeting
  execSync(`open "zoommtg://zoom.us/start?confno=new"`, { timeout: 5000 });
}

export function joinZoomMeeting(meetingId: string): void {
  const { execSync } = require('child_process');
  execSync(`open "zoommtg://zoom.us/join?confno=${meetingId}"`, { timeout: 5000 });
}

// ── PDF & Documents ─────────────────────────────────────────────────────

export function createPdf(content: string, outputPath?: string): string {
  const { execSync } = require('child_process');
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `document-${Date.now()}.pdf`);
  if (process.platform === 'darwin') {
    // Use cupsfilter or textutil to create PDF
    const tmpHtml = require('path').join(require('os').tmpdir(), `isibi-pdf-${Date.now()}.html`);
    require('fs').writeFileSync(tmpHtml, `<html><body style="font-family:system-ui;padding:40px;font-size:14px;line-height:1.6">${content.replace(/\n/g, '<br>')}</body></html>`);
    execSync(`/usr/sbin/cupsfilter ${tmpHtml} > ${out} 2>/dev/null || textutil -convert pdf ${tmpHtml} -output ${out}`, { timeout: 15000 });
    try { require('fs').unlinkSync(tmpHtml); } catch {}
  }
  return out;
}

export function readPdf(filePath: string): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      // mdimport extracts text from PDFs on macOS
      return execSync(`mdimport -d2 "${filePath}" 2>&1 | head -200`, { encoding: 'utf-8', timeout: 10000 });
    } catch {
      try {
        return execSync(`strings "${filePath}" | head -200`, { encoding: 'utf-8', timeout: 10000 });
      } catch { return ''; }
    }
  }
  return '';
}

export function mergePdfs(inputPaths: string[], outputPath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const inputs = inputPaths.map(p => `"${p}"`).join(' ');
    execSync(`"/System/Library/Automator/Combine PDF Pages.action/Contents/MacOS/join" -o "${outputPath}" ${inputs}`, { timeout: 15000 });
  }
}

export function printDocument(filePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`lpr "${filePath}"`, { timeout: 10000 });
  }
}

// ── Image Editing ───────────────────────────────────────────────────────

export function resizeImage(filePath: string, width: number, height?: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    if (height) {
      execSync(`sips --resampleHeightWidth ${height} ${width} "${filePath}"`, { timeout: 10000 });
    } else {
      execSync(`sips --resampleWidth ${width} "${filePath}"`, { timeout: 10000 });
    }
  }
}

export function cropImage(filePath: string, x: number, y: number, w: number, h: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`sips --cropToHeightWidth ${h} ${w} --cropOffset ${y} ${x} "${filePath}"`, { timeout: 10000 });
  }
}

export function convertImage(filePath: string, format: string): string {
  const { execSync } = require('child_process');
  const outPath = filePath.replace(/\.[^.]+$/, `.${format}`);
  if (process.platform === 'darwin') {
    execSync(`sips -s format ${format} "${filePath}" --out "${outPath}"`, { timeout: 10000 });
  }
  return outPath;
}

export function compressImage(filePath: string, quality: number = 50): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`sips -s formatOptions ${quality} "${filePath}"`, { timeout: 10000 });
  }
}

// ── Audio ────────────────────────────────────────────────────────────────

export function recordAudio(outputPath?: string, seconds: number = 10): string {
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `recording-${Date.now()}.m4a`);
  if (process.platform === 'darwin') {
    // Record in background, auto-stop after N seconds
    require('child_process').exec(`afrecord -d ${seconds} -f caff "${out}"`);
  }
  return out;
}

export function playAudio(filePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    require('child_process').exec(`afplay "${filePath}"`);
  }
}

export function textToAudioFile(text: string, outputPath?: string): string {
  const { execSync } = require('child_process');
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `speech-${Date.now()}.aiff`);
  if (process.platform === 'darwin') {
    execSync(`say "${text.replace(/"/g, '\\"')}" -o "${out}"`, { timeout: 30000 });
  }
  return out;
}

// ── Clipboard Intelligence ──────────────────────────────────────────────

export function copyFromApp(appName: string): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "${appName}" to activate'`, { timeout: 5000 });
    execSync(`osascript -e 'tell application "System Events" to keystroke "a" using command down'`, { timeout: 3000 });
    execSync(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`, { timeout: 3000 });
    return execSync('pbpaste', { encoding: 'utf-8', timeout: 3000 });
  }
  return '';
}

export function pasteIntoApp(appName: string, text?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    if (text) execSync(`echo -n ${JSON.stringify(text)} | pbcopy`, { timeout: 3000 });
    execSync(`osascript -e 'tell application "${appName}" to activate'`, { timeout: 5000 });
    execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 3000 });
  }
}

// ── System Deep ─────────────────────────────────────────────────────────

export function listRunningApps(): string[] {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "System Events" to get name of every process whose background only is false'`, { encoding: 'utf-8', timeout: 5000 });
      return output.trim().split(', ');
    } catch { return []; }
  }
  return [];
}

export function killApp(appName: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "${appName}" to quit'`, { timeout: 5000 });
  }
}

export function getDiskSpace(): string {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`df -h / | tail -1`, { encoding: 'utf-8', timeout: 3000 });
    const parts = output.trim().split(/\s+/);
    return `Total: ${parts[1]}, Used: ${parts[2]}, Available: ${parts[3]} free, ${parts[4]} used`;
  } catch { return 'Unknown'; }
}

export function getCpuUsage(): string {
  const { execSync } = require('child_process');
  try {
    const cpu = execSync(`top -l 1 -n 0 | grep "CPU usage"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    const mem = execSync(`top -l 1 -n 0 | grep "PhysMem"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    return `${cpu} | ${mem}`;
  } catch { return 'Unknown'; }
}

export function changeWallpaper(imagePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to tell every desktop to set picture to "${imagePath}"'`, { timeout: 5000 });
  }
}

export function toggleDoNotDisturb(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      execSync(`shortcuts run "Toggle Focus"`, { timeout: 5000 });
    } catch {
      // Fallback: use Control Center
      execSync(`osascript -e 'tell application "System Events"
  tell process "ControlCenter"
    click menu bar item "Focus" of menu bar 1
  end tell
end tell'`, { timeout: 5000 });
    }
  }
}

// ── Network ─────────────────────────────────────────────────────────────

export function getIpAddress(): { local: string; public: string } {
  const { execSync } = require('child_process');
  let local = '', pub = '';
  try { local = execSync(`ipconfig getifaddr en0`, { encoding: 'utf-8', timeout: 3000 }).trim(); } catch {}
  try { pub = execSync(`curl -s ifconfig.me`, { encoding: 'utf-8', timeout: 5000 }).trim(); } catch {}
  return { local: local || 'Unknown', public: pub || 'Unknown' };
}

export function ping(host: string, count: number = 3): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`ping -c ${count} ${host}`, { encoding: 'utf-8', timeout: 15000 });
  } catch (e: any) { return e.stdout || 'Ping failed'; }
}

export function checkInternet(): boolean {
  const { execSync } = require('child_process');
  try {
    execSync(`ping -c 1 -W 3 8.8.8.8`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

export function downloadFile(url: string, outputPath?: string): string {
  const { execSync } = require('child_process');
  const filename = url.split('/').pop() || `download-${Date.now()}`;
  const out = outputPath || require('path').join(require('os').homedir(), 'Downloads', filename);
  execSync(`curl -L -o "${out}" "${url}"`, { timeout: 60000 });
  return out;
}

// ── QR Codes ────────────────────────────────────────────────────────────

export function generateQr(text: string, outputPath?: string): string {
  const { execSync } = require('child_process');
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `qr-${Date.now()}.png`);
  // Use Core Image filter via Python (built into macOS)
  execSync(`python3 -c "
import subprocess, sys
try:
    import qrcode
    img = qrcode.make('${text.replace(/'/g, "\\'")}')
    img.save('${out}')
except ImportError:
    # Fallback: use a simple SVG approach
    import urllib.request
    urllib.request.urlretrieve('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}', '${out}')
"`, { timeout: 15000 });
  return out;
}

// ── Text Processing ─────────────────────────────────────────────────────

export function regexExtract(text: string, pattern: string): string[] {
  try {
    const re = new RegExp(pattern, 'g');
    return text.match(re) || [];
  } catch { return []; }
}

export function jsonParse(text: string, path?: string): string {
  try {
    const obj = JSON.parse(text);
    if (path) {
      const keys = path.split('.');
      let val = obj;
      for (const k of keys) { val = val?.[k]; }
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    }
    return JSON.stringify(obj, null, 2);
  } catch { return 'Invalid JSON'; }
}

export function countWords(text: string): { words: number; characters: number; lines: number } {
  return {
    words: text.split(/\s+/).filter(w => w.length > 0).length,
    characters: text.length,
    lines: text.split('\n').length,
  };
}

export function diffText(text1: string, text2: string): string {
  const lines1 = text1.split('\n');
  const lines2 = text2.split('\n');
  const diffs: string[] = [];
  const maxLen = Math.max(lines1.length, lines2.length);
  for (let i = 0; i < maxLen; i++) {
    if (lines1[i] !== lines2[i]) {
      if (lines1[i]) diffs.push(`- ${lines1[i]}`);
      if (lines2[i]) diffs.push(`+ ${lines2[i]}`);
    }
  }
  return diffs.length > 0 ? diffs.join('\n') : 'No differences';
}

// ── Passwords & Security ────────────────────────────────────────────────

export function generatePassword(length: number = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
  let pw = '';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

export function checkPasswordStrength(password: string): { score: number; feedback: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong', 'Excellent'];
  return { score, feedback: labels[Math.min(score, labels.length - 1)] };
}

export function openKeychain(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') execSync(`open -a "Keychain Access"`, { timeout: 5000 });
}

// ── Math & Calculations ─────────────────────────────────────────────────

export function calculate(expression: string): string {
  try {
    // Safe eval using Function constructor (no access to globals)
    const result = new Function('return ' + expression.replace(/[^0-9+\-*/().%Math,sqrt,pow,abs,round,floor,ceil,PI,E,log,sin,cos,tan]/g, ''))();
    return String(result);
  } catch { return 'Error'; }
}

export function unitConvert(value: number, from: string, to: string): string {
  const conversions: Record<string, Record<string, number>> = {
    km: { mi: 0.621371, m: 1000, ft: 3280.84, yd: 1093.61 },
    mi: { km: 1.60934, m: 1609.34, ft: 5280, yd: 1760 },
    m: { km: 0.001, mi: 0.000621371, ft: 3.28084, cm: 100, in: 39.3701 },
    ft: { m: 0.3048, km: 0.000305, mi: 0.000189, in: 12, cm: 30.48 },
    kg: { lb: 2.20462, oz: 35.274, g: 1000 },
    lb: { kg: 0.453592, oz: 16, g: 453.592 },
    g: { kg: 0.001, lb: 0.00220462, oz: 0.035274 },
    oz: { g: 28.3495, kg: 0.0283495, lb: 0.0625 },
    c: { f: -1, k: -1 }, // special handling
    f: { c: -1, k: -1 },
    l: { gal: 0.264172, ml: 1000, qt: 1.05669 },
    gal: { l: 3.78541, ml: 3785.41, qt: 4 },
    in: { cm: 2.54, m: 0.0254, ft: 0.0833333 },
    cm: { in: 0.393701, m: 0.01, ft: 0.0328084 },
  };
  const f = from.toLowerCase(), t = to.toLowerCase();
  // Temperature special cases
  if (f === 'c' && t === 'f') return `${value}°C = ${(value * 9/5 + 32).toFixed(1)}°F`;
  if (f === 'f' && t === 'c') return `${value}°F = ${((value - 32) * 5/9).toFixed(1)}°C`;
  if (f === 'c' && t === 'k') return `${value}°C = ${(value + 273.15).toFixed(1)}K`;
  if (f === 'f' && t === 'k') return `${value}°F = ${(((value - 32) * 5/9) + 273.15).toFixed(1)}K`;
  if (conversions[f]?.[t]) return `${value} ${from} = ${(value * conversions[f][t]).toFixed(4)} ${to}`;
  return 'Unknown conversion';
}

export function percentage(value: number, percent: number): string {
  const result = value * percent / 100;
  return `${percent}% of ${value} = ${result}`;
}

// ── Date & Time ─────────────────────────────────────────────────────────

export function getTime(timezone?: string): string {
  if (timezone) {
    try {
      return new Date().toLocaleString('en-US', { timeZone: timezone });
    } catch { return 'Invalid timezone'; }
  }
  return new Date().toLocaleString();
}

export function timeUntil(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return 'Already passed';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${days}d ${hours}h ${mins}m`;
}

export function dateDiff(date1: string, date2: string): string {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  const diff = Math.abs(d2 - d1);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${days} days, ${hours} hours`;
}

export function worldClock(cities: string[]): string[] {
  const tzMap: Record<string, string> = {
    'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles', 'chicago': 'America/Chicago',
    'london': 'Europe/London', 'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin', 'madrid': 'Europe/Madrid',
    'tokyo': 'Asia/Tokyo', 'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'seoul': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'mumbai': 'Asia/Kolkata', 'dubai': 'Asia/Dubai', 'moscow': 'Europe/Moscow',
    'toronto': 'America/Toronto', 'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
    'singapore': 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', 'cairo': 'Africa/Cairo',
  };
  return cities.map(city => {
    const tz = tzMap[city.toLowerCase()] || city;
    try {
      const time = new Date().toLocaleString('en-US', { timeZone: tz, timeStyle: 'short', dateStyle: 'short' } as any);
      return `${city}: ${time}`;
    } catch { return `${city}: Unknown timezone`; }
  });
}

// ── Clipboard History ───────────────────────────────────────────────────

const clipboardHistory: string[] = [];

export function addToClipboardHistory(text: string): void {
  clipboardHistory.unshift(text);
  if (clipboardHistory.length > 20) clipboardHistory.pop();
}

export function getClipboardHistory(): string[] {
  return [...clipboardHistory];
}

export function searchClipboardHistory(query: string): string[] {
  return clipboardHistory.filter(item => item.toLowerCase().includes(query.toLowerCase()));
}

// ── System Automation ───────────────────────────────────────────────────

export function watchFolder(folderPath: string, callback?: string): void {
  const fs = require('fs');
  fs.watch(folderPath, (eventType: string, filename: string) => {
    showNotification('Folder changed', `${eventType}: ${filename} in ${folderPath}`);
  });
}

// ── Browser Automation ──────────────────────────────────────────────────

export function getPageTitle(): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Try Chrome first, then Safari
    try {
      return execSync(`osascript -e 'tell application "Google Chrome" to title of active tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}
    try {
      return execSync(`osascript -e 'tell application "Safari" to name of current tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}
  }
  return 'Unknown';
}

export function getPageUrl(): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      return execSync(`osascript -e 'tell application "Google Chrome" to URL of active tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}
    try {
      return execSync(`osascript -e 'tell application "Safari" to URL of current tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}
  }
  return 'Unknown';
}

export function savePageAsPdf(outputPath?: string): void {
  const { execSync } = require('child_process');
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `page-${Date.now()}.pdf`);
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to keystroke "p" using command down'`, { timeout: 3000 });
  }
}

export function getAllTabs(): string[] {
  const { execSync } = require('child_process');
  const tabs: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "Google Chrome"
  set tabList to ""
  repeat with w in windows
    repeat with t in tabs of w
      set tabList to tabList & title of t & " | " & URL of t & "\\n"
    end repeat
  end repeat
  return tabList
end tell'`, { encoding: 'utf-8', timeout: 10000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => tabs.push(l.trim()));
    } catch {}
    if (tabs.length === 0) {
      try {
        const output = execSync(`osascript -e 'tell application "Safari"
  set tabList to ""
  repeat with w in windows
    repeat with t in tabs of w
      set tabList to tabList & name of t & " | " & URL of t & "\\n"
    end repeat
  end repeat
  return tabList
end tell'`, { encoding: 'utf-8', timeout: 10000 });
        output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => tabs.push(l.trim()));
      } catch {}
    }
  }
  return tabs;
}

export function clearBrowserCache(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try { execSync(`osascript -e 'tell application "Google Chrome" to execute front window\\'s active tab javascript "caches.keys().then(n=>n.forEach(k=>caches.delete(k)))"'`, { timeout: 5000 }); } catch {}
  }
}

// ── Compression ─────────────────────────────────────────────────────────

export function zipFiles(inputPaths: string[], outputPath: string): void {
  const { execSync } = require('child_process');
  const inputs = inputPaths.map(p => `"${p}"`).join(' ');
  execSync(`zip -r "${outputPath}" ${inputs}`, { timeout: 30000 });
}

export function unzipFile(zipPath: string, outputDir?: string): void {
  const { execSync } = require('child_process');
  const out = outputDir || require('path').dirname(zipPath);
  execSync(`unzip -o "${zipPath}" -d "${out}"`, { timeout: 30000 });
}

export function tarFiles(inputPaths: string[], outputPath: string): void {
  const { execSync } = require('child_process');
  const inputs = inputPaths.map(p => `"${p}"`).join(' ');
  execSync(`tar -czf "${outputPath}" ${inputs}`, { timeout: 30000 });
}

// ── Database ────────────────────────────────────────────────────────────

export function sqliteQuery(dbPath: string, query: string): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`sqlite3 "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', timeout: 10000 });
  } catch (e: any) { return e.stderr || 'Query failed'; }
}

export function csvQuery(filePath: string, filter?: string, sortCol?: number): string {
  const fs = require('fs');
  try {
    let lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    if (filter) lines = [lines[0], ...lines.slice(1).filter((l: string) => l.toLowerCase().includes(filter.toLowerCase()))];
    if (sortCol !== undefined) {
      const header = lines[0];
      const rows = lines.slice(1).filter((l: string) => l.trim());
      rows.sort((a: string, b: string) => {
        const aVal = a.split(',')[sortCol] || '';
        const bVal = b.split(',')[sortCol] || '';
        return aVal.localeCompare(bVal);
      });
      lines = [header, ...rows];
    }
    return lines.join('\n');
  } catch { return 'Failed to read CSV'; }
}

// ── Encoding ────────────────────────────────────────────────────────────

export function base64Encode(text: string): string {
  return Buffer.from(text).toString('base64');
}

export function base64Decode(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

export function urlEncode(text: string): string {
  return encodeURIComponent(text);
}

export function urlDecode(encoded: string): string {
  return decodeURIComponent(encoded);
}

export function hashText(text: string, algorithm: string = 'sha256'): string {
  const crypto = require('crypto');
  return crypto.createHash(algorithm).update(text).digest('hex');
}

// ── Fun ─────────────────────────────────────────────────────────────────

export function randomNumber(min: number = 1, max: number = 100): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function coinFlip(): string {
  return Math.random() < 0.5 ? 'Heads' : 'Tails';
}

export function diceRoll(sides: number = 6, count: number = 1): string {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
  return `Rolled ${count}d${sides}: ${rolls.join(', ')} (total: ${rolls.reduce((a, b) => a + b, 0)})`;
}

export function loremIpsum(paragraphs: number = 1): string {
  const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
  return Array(paragraphs).fill(lorem).join('\n\n');
}

// ── Data Extraction ─────────────────────────────────────────────────────

export function extractEmails(text: string): string[] {
  return text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
}

export function extractPhoneNumbers(text: string): string[] {
  return text.match(/[\+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,15}/g) || [];
}

export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) || [];
}

export function extractTable(html: string): string[][] {
  const rows: string[][] = [];
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rowMatches) {
    const cells: string[] = [];
    const cellMatches = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
    for (const cell of cellMatches) {
      cells.push(cell.replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ── Document Automation ─────────────────────────────────────────────────

export function batchRename(folderPath: string, pattern: string, replacement: string): string[] {
  const fs = require('fs');
  const path = require('path');
  const renamed: string[] = [];
  try {
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      const re = new RegExp(pattern);
      if (re.test(file)) {
        const newName = file.replace(re, replacement);
        fs.renameSync(path.join(folderPath, file), path.join(folderPath, newName));
        renamed.push(`${file} → ${newName}`);
      }
    }
  } catch {}
  return renamed;
}

export function findAndReplaceInFiles(folderPath: string, search: string, replace: string, glob: string = '*'): number {
  const fs = require('fs');
  const path = require('path');
  let count = 0;
  try {
    const files = fs.readdirSync(folderPath).filter((f: string) => {
      if (glob === '*') return true;
      const ext = glob.replace('*.', '');
      return f.endsWith(ext);
    });
    for (const file of files) {
      const fp = path.join(folderPath, file);
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        if (content.includes(search)) {
          fs.writeFileSync(fp, content.split(search).join(replace), 'utf-8');
          count++;
        }
      } catch {}
    }
  } catch {}
  return count;
}

// ── Workflow ─────────────────────────────────────────────────────────────

export function waitForFile(filePath: string, timeoutMs: number = 30000): Promise<boolean> {
  const fs = require('fs');
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(filePath)) { resolve(true); return; }
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

export function getLatestDownload(): string {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(require('os').homedir(), 'Downloads');
  try {
    const files = fs.readdirSync(dir)
      .filter((f: string) => !f.startsWith('.'))
      .map((f: string) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.time - a.time);
    return files.length > 0 ? path.join(dir, files[0].name) : '';
  } catch { return ''; }
}

export function moveLatestDownload(destFolder: string): string {
  const fs = require('fs');
  const path = require('path');
  const latest = getLatestDownload();
  if (!latest) return '';
  const dest = path.join(destFolder, path.basename(latest));
  fs.renameSync(latest, dest);
  return dest;
}

// ── Data Processing ─────────────────────────────────────────────────────

export function sortData(text: string, column?: number, descending: boolean = false): string {
  const lines = text.split('\n').filter((l: string) => l.trim());
  if (lines.length < 2) return text;
  const header = lines[0];
  const rows = lines.slice(1);
  rows.sort((a: string, b: string) => {
    const aVal = column !== undefined ? (a.split(',')[column] || '').trim() : a;
    const bVal = column !== undefined ? (b.split(',')[column] || '').trim() : b;
    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
    return descending ? -cmp : cmp;
  });
  return [header, ...rows].join('\n');
}

export function filterData(text: string, condition: string): string {
  const lines = text.split('\n').filter((l: string) => l.trim());
  if (lines.length < 2) return text;
  const header = lines[0];
  const rows = lines.slice(1).filter((l: string) => l.toLowerCase().includes(condition.toLowerCase()));
  return [header, ...rows].join('\n');
}

export function deduplicate(text: string): string {
  const lines = text.split('\n');
  const seen = new Set<string>();
  return lines.filter(l => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  }).join('\n');
}

export function mergeCsvs(filePaths: string[]): string {
  const fs = require('fs');
  let header = '';
  const allRows: string[] = [];
  for (const fp of filePaths) {
    try {
      const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter((l: string) => l.trim());
      if (!header && lines.length > 0) header = lines[0];
      allRows.push(...lines.slice(1));
    } catch {}
  }
  return header ? [header, ...allRows].join('\n') : allRows.join('\n');
}

// ── Integration ─────────────────────────────────────────────────────────

export async function webhookSend(url: string, data: any): Promise<string> {
  const https = require('https');
  const http = require('http');
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  const urlObj = new URL(url);
  const lib = urlObj.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = lib.request({
      hostname: urlObj.hostname, port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res: any) => {
      let d = '';
      res.on('data', (c: string) => { d += c; });
      res.on('end', () => resolve(`${res.statusCode}: ${d.slice(0, 500)}`));
    });
    req.on('error', (e: any) => resolve('Error: ' + e.message));
    req.write(body);
    req.end();
  });
}

export async function googleSheetsRead(sheetUrl: string): Promise<string> {
  // Convert Google Sheets URL to CSV export URL
  const match = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return 'Invalid Google Sheets URL';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  return fetchWebpage(csvUrl);
}

// ── File Utilities ──────────────────────────────────────────────────────

export function listFolder(folderPath: string): string[] {
  const fs = require('fs');
  try {
    return fs.readdirSync(folderPath).filter((f: string) => !f.startsWith('.'));
  } catch { return []; }
}

export function searchFiles(query: string): string[] {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`mdfind "${query.replace(/"/g, '\\"')}" | head -20`, { encoding: 'utf-8', timeout: 10000 });
    return output.split('\n').filter((l: string) => l.trim());
  } catch { return []; }
}

export function getFileInfo(filePath: string): { name: string; size: string; modified: string; type: string } {
  const fs = require('fs');
  const path = require('path');
  try {
    const stat = fs.statSync(filePath);
    const sizeKb = (stat.size / 1024).toFixed(1);
    const sizeMb = (stat.size / 1048576).toFixed(1);
    return {
      name: path.basename(filePath),
      size: stat.size > 1048576 ? `${sizeMb} MB` : `${sizeKb} KB`,
      modified: stat.mtime.toLocaleString(),
      type: path.extname(filePath) || 'unknown',
    };
  } catch { return { name: '', size: '', modified: '', type: '' }; }
}

export function duplicateFile(filePath: string): string {
  const fs = require('fs');
  const path = require('path');
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  const newPath = `${base} copy${ext}`;
  fs.copyFileSync(filePath, newPath);
  return newPath;
}

export function renameFile(oldPath: string, newName: string): string {
  const fs = require('fs');
  const path = require('path');
  const newPath = path.join(path.dirname(oldPath), newName);
  fs.renameSync(oldPath, newPath);
  return newPath;
}

export function trashFile(filePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Finder" to delete POSIX file "${filePath}"'`, { timeout: 5000 });
  }
}

export function revealInFinder(filePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -R "${filePath}"`, { timeout: 5000 });
  }
}

export function openWith(filePath: string, appName: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -a "${appName}" "${filePath}"`, { timeout: 5000 });
  }
}

// ── Email Management ────────────────────────────────────────────────────

export function readEmails(count: number = 5): string[] {
  const { execSync } = require('child_process');
  const emails: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "Mail"
  set msgs to ""
  set msgList to messages of inbox
  set maxCount to ${count}
  set i to 0
  repeat with m in msgList
    if i >= maxCount then exit repeat
    set msgs to msgs & subject of m & " | " & sender of m & " | " & date received of m & "\\n"
    set i to i + 1
  end repeat
  return msgs
end tell'`, { encoding: 'utf-8', timeout: 15000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => emails.push(l.trim()));
    } catch {}
  }
  return emails;
}

export function searchEmail(query: string): string[] {
  const { execSync } = require('child_process');
  const results: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`osascript -e 'tell application "Mail"
  set msgs to ""
  set found to (messages of inbox whose subject contains "${query.replace(/"/g, '\\"')}" or sender contains "${query.replace(/"/g, '\\"')}")
  set maxCount to 10
  set i to 0
  repeat with m in found
    if i >= maxCount then exit repeat
    set msgs to msgs & subject of m & " | " & sender of m & "\\n"
    set i to i + 1
  end repeat
  return msgs
end tell'`, { encoding: 'utf-8', timeout: 15000 });
      output.split('\n').filter((l: string) => l.trim()).forEach((l: string) => results.push(l.trim()));
    } catch {}
  }
  return results;
}

export function createEmailDraft(to: string, subject: string, body: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g, '\\"')}", content:"${body.replace(/"/g, '\\"')}", visible:true}
  tell newMsg
    make new to recipient with properties {address:"${to.replace(/"/g, '\\"')}"}
  end tell
end tell'`, { timeout: 10000 });
  }
}

// ── Display & Appearance ────────────────────────────────────────────────

export function setBrightness(percent: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const val = Math.max(0, Math.min(1, percent / 100));
    try {
      execSync(`osascript -e 'tell application "System Events" to set value of slider 1 of group 1 of window "Displays" of application process "System Preferences" to ${val}'`, { timeout: 5000 });
    } catch {
      // Fallback: use brightness keys
      const steps = Math.round(percent / 6.25);
      for (let i = 0; i < 16; i++) execSync(`osascript -e 'tell application "System Events" to key code 145'`, { timeout: 1000 }); // brightness down
      for (let i = 0; i < steps; i++) execSync(`osascript -e 'tell application "System Events" to key code 144'`, { timeout: 1000 }); // brightness up
    }
  }
}

export function toggleNightShift(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      execSync(`osascript -e 'tell application "System Events"
  tell process "ControlCenter"
    click menu bar item "Display" of menu bar 1
  end tell
end tell'`, { timeout: 5000 });
    } catch {}
  }
}

export function getScreenResolution(): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`system_profiler SPDisplaysDataType 2>/dev/null | grep Resolution | head -1`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { return 'Unknown'; }
}

// ── Printing ────────────────────────────────────────────────────────────

export function listPrinters(): string[] {
  const { execSync } = require('child_process');
  try {
    return execSync(`lpstat -a 2>/dev/null | cut -d' ' -f1`, { encoding: 'utf-8', timeout: 5000 }).split('\n').filter((l: string) => l.trim());
  } catch { return []; }
}

export function printText(text: string): void {
  const fs = require('fs');
  const path = require('path');
  const tmpFile = path.join(require('os').tmpdir(), `isibi-print-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, text, 'utf-8');
  const { execSync } = require('child_process');
  execSync(`lpr "${tmpFile}"`, { timeout: 10000 });
  try { fs.unlinkSync(tmpFile); } catch {}
}

export function printImage(imagePath: string): void {
  const { execSync } = require('child_process');
  execSync(`lpr "${imagePath}"`, { timeout: 10000 });
}

// ── User Interaction (dialogs) ──────────────────────────────────────────

export function inputPrompt(title: string, message: string, defaultValue?: string): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const def = defaultValue ? ` default answer "${defaultValue.replace(/"/g, '\\"')}"` : ' default answer ""';
      const output = execSync(`osascript -e 'set response to display dialog "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"${def} buttons {"Cancel","OK"} default button "OK"
return text returned of response'`, { encoding: 'utf-8', timeout: 60000 });
      return output.trim();
    } catch { return ''; }
  }
  return '';
}

export function choicePrompt(title: string, choices: string[]): string {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      const choiceList = choices.map(c => `"${c.replace(/"/g, '\\"')}"`).join(', ');
      const output = execSync(`osascript -e 'choose from list {${choiceList}} with title "${title.replace(/"/g, '\\"')}" with prompt "Select an option:"'`, { encoding: 'utf-8', timeout: 60000 });
      return output.trim() === 'false' ? '' : output.trim();
    } catch { return ''; }
  }
  return '';
}

// ── App-Specific ────────────────────────────────────────────────────────

export function keynoteNew(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Keynote" to activate' -e 'tell application "Keynote" to make new document'`, { timeout: 10000 });
  }
}

export function numbersNew(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Numbers" to activate' -e 'tell application "Numbers" to make new document'`, { timeout: 10000 });
  }
}

export function pagesNew(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "Pages" to activate' -e 'tell application "Pages" to make new document'`, { timeout: 10000 });
  }
}

export function previewOpen(filePath: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -a "Preview" "${filePath}"`, { timeout: 5000 });
  }
}

export function xcodeBuild(projectPath: string): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`cd "${projectPath}" && xcodebuild build 2>&1 | tail -20`, { encoding: 'utf-8', timeout: 120000 });
  } catch (e: any) { return e.stderr || 'Build failed'; }
}

// ── Text Manipulation ───────────────────────────────────────────────────

export function textReplace(text: string, search: string, replace: string): string {
  return text.split(search).join(replace);
}

export function textCase(text: string, mode: string): string {
  switch (mode.toLowerCase()) {
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'title': return text.replace(/\b\w/g, c => c.toUpperCase());
    case 'sentence': return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    case 'camel': return text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
    case 'snake': return text.replace(/\s+/g, '_').toLowerCase();
    case 'kebab': return text.replace(/\s+/g, '-').toLowerCase();
    default: return text;
  }
}

export function textTrim(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function textReverse(text: string): string {
  return text.split('').reverse().join('');
}

export function textSplit(text: string, delimiter: string): string[] {
  return text.split(delimiter);
}

// ── Accessibility ───────────────────────────────────────────────────────

export function readAloud(text: string, voice?: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const voicePart = voice ? ` -v "${voice}"` : '';
    execSync(`say${voicePart} "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 });
  }
}

export function increaseTextSize(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to keystroke "=" using {command down, option down}'`, { timeout: 3000 });
  }
}

export function decreaseTextSize(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`osascript -e 'tell application "System Events" to keystroke "-" using {command down, option down}'`, { timeout: 3000 });
  }
}

// ── Invoice / Business ──────────────────────────────────────────────────

export function createInvoice(from: string, to: string, items: { desc: string; qty: number; price: number }[], outputPath?: string): string {
  const fs = require('fs');
  const path = require('path');
  const out = outputPath || path.join(require('os').homedir(), 'Desktop', `invoice-${Date.now()}.html`);
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const rows = items.map(i => `<tr><td>${i.desc}</td><td>${i.qty}</td><td>$${i.price.toFixed(2)}</td><td>$${(i.qty * i.price).toFixed(2)}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:40px}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}.total{font-weight:bold;font-size:18px}</style></head><body>
<h1>Invoice</h1><p><strong>From:</strong> ${from}</p><p><strong>To:</strong> ${to}</p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
<table><tr><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr>${rows}
<tr><td colspan="3" style="text-align:right"><strong>Total:</strong></td><td class="total">$${total.toFixed(2)}</td></tr></table></body></html>`;
  fs.writeFileSync(out, html, 'utf-8');
  return out;
}

// ── Action History (for undo/rollback) ──────────────────────────────────

const actionHistory: { type: string; description: string; timestamp: number; undoable: boolean }[] = [];

export function logAction(type: string, description: string, undoable: boolean = false): void {
  actionHistory.push({ type, description, timestamp: Date.now(), undoable });
  if (actionHistory.length > 50) actionHistory.shift();
}

export function getActionHistory(): typeof actionHistory {
  return [...actionHistory];
}

export function getLastAction(): typeof actionHistory[0] | null {
  return actionHistory.length > 0 ? actionHistory[actionHistory.length - 1] : null;
}

// ── Screen Comparison ───────────────────────────────────────────────────

export function captureScreenForComparison(): string {
  const { execSync } = require('child_process');
  const outPath = require('path').join(require('os').tmpdir(), `isibi-compare-${Date.now()}.jpg`);
  execSync(`screencapture -x -C -t jpg ${outPath}`, { timeout: 5000 });
  try { execSync(`sips --resampleWidth 1920 ${outPath} --setProperty formatOptions 60`, { timeout: 5000 }); } catch {}
  return outPath;
}

// ── Web Automation Helpers ───────────────────────────────────────────────

export function downloadAllImages(url: string, outputDir?: string): string[] {
  const { execSync } = require('child_process');
  const dir = outputDir || require('path').join(require('os').homedir(), 'Downloads', `images-${Date.now()}`);
  require('fs').mkdirSync(dir, { recursive: true });
  try {
    // Use wget to grab images
    execSync(`cd "${dir}" && curl -s "${url}" | grep -oP 'src="(https?://[^"]+\\.(?:jpg|jpeg|png|gif|webp))"' | cut -d'"' -f2 | head -20 | xargs -I{} curl -sO {}`, { timeout: 30000 });
  } catch {}
  return require('fs').readdirSync(dir);
}

export function saveArticle(url: string, outputPath?: string): string {
  const { execSync } = require('child_process');
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `article-${Date.now()}.txt`);
  try {
    const html = execSync(`curl -sL "${url}"`, { encoding: 'utf-8', timeout: 15000 });
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    require('fs').writeFileSync(out, text, 'utf-8');
  } catch {}
  return out;
}

// ── Communication Helpers ───────────────────────────────────────────────

export function forwardEmail(subject: string, to: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      execSync(`osascript -e 'tell application "Mail"
  set msgs to (messages of inbox whose subject contains "${subject.replace(/"/g, '\\"')}")
  if (count of msgs) > 0 then
    set fwd to forward (item 1 of msgs)
    tell fwd to make new to recipient with properties {address:"${to.replace(/"/g, '\\"')}"}
    send fwd
  end if
end tell'`, { timeout: 15000 });
    } catch {}
  }
}

export function exportChat(appName: string, outputPath?: string): string {
  const out = outputPath || require('path').join(require('os').homedir(), 'Desktop', `chat-export-${Date.now()}.txt`);
  const copied = copyFromApp(appName);
  require('fs').writeFileSync(out, copied, 'utf-8');
  return out;
}

// ── Document Helpers ────────────────────────────────────────────────────

export function convertDocFormat(inputPath: string, outputFormat: string): string {
  const { execSync } = require('child_process');
  const outPath = inputPath.replace(/\.[^.]+$/, `.${outputFormat}`);
  if (process.platform === 'darwin') {
    try {
      execSync(`textutil -convert ${outputFormat} "${inputPath}" -output "${outPath}"`, { timeout: 15000 });
    } catch {}
  }
  return outPath;
}

export function watermarkPdf(pdfPath: string, watermarkText: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      execSync(`python3 -c "
import subprocess
# Use Preview/Automator approach
subprocess.run(['osascript', '-e', 'tell application \"Preview\" to open POSIX file \"${pdfPath}\"'], timeout=5)
"`, { timeout: 10000 });
    } catch {}
  }
}

export function splitPdf(pdfPath: string, outputDir?: string): void {
  const { execSync } = require('child_process');
  const dir = outputDir || require('path').dirname(pdfPath);
  if (process.platform === 'darwin') {
    try {
      execSync(`python3 -c "
import os, subprocess
# Get page count
result = subprocess.run(['mdls', '-name', 'kMDItemNumberOfPages', '${pdfPath}'], capture_output=True, text=True)
"`, { timeout: 15000 });
    } catch {}
  }
}

// ── Data Helpers ────────────────────────────────────────────────────────

export function exportToJson(csvPath: string, outputPath?: string): string {
  const fs = require('fs');
  const path = require('path');
  const out = outputPath || csvPath.replace(/\.csv$/, '.json');
  try {
    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((l: string) => l.trim());
    if (lines.length < 2) return out;
    const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
    const rows = lines.slice(1).map((line: string) => {
      const vals = line.split(',').map((v: string) => v.trim().replace(/"/g, ''));
      const obj: Record<string, string> = {};
      headers.forEach((h: string, i: number) => { obj[h] = vals[i] || ''; });
      return obj;
    });
    fs.writeFileSync(out, JSON.stringify(rows, null, 2), 'utf-8');
  } catch {}
  return out;
}

export function cleanCsvData(csvPath: string): string {
  const fs = require('fs');
  try {
    let content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim() && l.split(',').some((c: string) => c.trim()));
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
    return `Cleaned: ${lines.length} rows`;
  } catch { return 'Failed'; }
}

export function validateEmails(text: string): { valid: string[]; invalid: string[] } {
  const emails = text.match(/[^\s,;]+@[^\s,;]+/g) || [];
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const valid = emails.filter(e => re.test(e));
  const invalid = emails.filter(e => !re.test(e));
  return { valid, invalid };
}

export function chartData(csvPath: string, outputPath?: string): string {
  const fs = require('fs');
  const path = require('path');
  const out = outputPath || path.join(require('os').homedir(), 'Desktop', `chart-${Date.now()}.html`);
  try {
    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((l: string) => l.trim());
    const headers = lines[0].split(',');
    const data = lines.slice(1).map((l: string) => l.split(','));
    const labels = data.map((r: string[]) => r[0]);
    const values = data.map((r: string[]) => parseFloat(r[1]) || 0);
    const max = Math.max(...values, 1);
    const bars = values.map((v: number, i: number) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:120px;text-align:right">${labels[i]}</span><div style="background:#ec4899;height:24px;width:${(v/max*400)}px;border-radius:4px"></div><span>${v}</span></div>`).join('');
    fs.writeFileSync(out, `<!DOCTYPE html><html><body style="font-family:system-ui;padding:20px"><h2>${headers[0]} vs ${headers[1]}</h2>${bars}</body></html>`, 'utf-8');
  } catch {}
  return out;
}

export function generateSampleData(type: string, count: number = 10): string {
  const names = ['John Smith','Jane Doe','Bob Wilson','Alice Brown','Charlie Davis','Eva Martinez','Frank Miller','Grace Lee','Henry Taylor','Iris Johnson'];
  const emails = names.map(n => n.toLowerCase().replace(' ', '.') + '@email.com');
  const phones = Array.from({ length: count }, () => '555-' + String(Math.floor(1000 + Math.random() * 9000)));
  if (type === 'contacts') {
    return 'Name,Email,Phone\n' + Array.from({ length: count }, (_, i) => `${names[i % names.length]},${emails[i % emails.length]},${phones[i]}`).join('\n');
  } else if (type === 'sales') {
    const products = ['Widget A','Widget B','Service X','Service Y','Premium Plan'];
    return 'Date,Product,Quantity,Price\n' + Array.from({ length: count }, () => {
      const d = new Date(Date.now() - Math.random() * 30 * 86400000).toLocaleDateString();
      const p = products[Math.floor(Math.random() * products.length)];
      const q = Math.floor(1 + Math.random() * 10);
      const pr = (10 + Math.random() * 90).toFixed(2);
      return `${d},${p},${q},${pr}`;
    }).join('\n');
  }
  return 'ID,Value\n' + Array.from({ length: count }, (_, i) => `${i + 1},${Math.floor(Math.random() * 100)}`).join('\n');
}

// ── Productivity Helpers ────────────────────────────────────────────────

export function pomodoroTimer(workMins: number = 25, breakMins: number = 5): void {
  showNotification('Pomodoro', `Working for ${workMins} minutes. Focus!`);
  setTimeout(() => {
    showNotification('Break time!', `Take a ${breakMins} minute break.`);
    speak('Break time! Take a ' + breakMins + ' minute break.');
    setTimeout(() => {
      showNotification('Back to work!', 'Break is over.');
      speak('Break is over. Back to work!');
    }, breakMins * 60000);
  }, workMins * 60000);
}

export function organizeDownloads(): string {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(require('os').homedir(), 'Downloads');
  const categories: Record<string, string[]> = {
    Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'],
    Videos: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv'],
    Audio: ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg'],
    Documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv'],
    Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.dmg'],
    Code: ['.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.sh'],
    Apps: ['.app', '.exe', '.pkg', '.deb'],
  };
  let moved = 0;
  try {
    const files = fs.readdirSync(dir).filter((f: string) => !f.startsWith('.'));
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const fp = path.join(dir, file);
      if (!fs.statSync(fp).isFile()) continue;
      for (const [cat, exts] of Object.entries(categories)) {
        if (exts.includes(ext)) {
          const catDir = path.join(dir, cat);
          if (!fs.existsSync(catDir)) fs.mkdirSync(catDir);
          fs.renameSync(fp, path.join(catDir, file));
          moved++;
          break;
        }
      }
    }
  } catch {}
  return `Organized ${moved} files`;
}

export function cleanDesktop(): string {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(require('os').homedir(), 'Desktop');
  let moved = 0;
  try {
    const files = fs.readdirSync(dir).filter((f: string) => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile());
    if (files.length <= 5) return 'Desktop is already clean';
    const archiveDir = path.join(dir, `Desktop-Archive-${new Date().toISOString().slice(0, 10)}`);
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const file of files) {
      fs.renameSync(path.join(dir, file), path.join(archiveDir, file));
      moved++;
    }
  } catch {}
  return `Moved ${moved} files to archive`;
}

export function archiveOldFiles(folderPath: string, daysOld: number = 30): string {
  const fs = require('fs');
  const path = require('path');
  const cutoff = Date.now() - daysOld * 86400000;
  let moved = 0;
  try {
    const archiveDir = path.join(folderPath, 'Archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const files = fs.readdirSync(folderPath).filter((f: string) => !f.startsWith('.') && f !== 'Archive');
    for (const file of files) {
      const fp = path.join(folderPath, file);
      if (!fs.statSync(fp).isFile()) continue;
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.renameSync(fp, path.join(archiveDir, file));
        moved++;
      }
    }
  } catch {}
  return `Archived ${moved} files older than ${daysOld} days`;
}

export function batchProcess(folderPath: string, action: string): string {
  const fs = require('fs');
  const { execSync } = require('child_process');
  const path = require('path');
  let processed = 0;
  try {
    const files = fs.readdirSync(folderPath).filter((f: string) => !f.startsWith('.'));
    for (const file of files) {
      const fp = path.join(folderPath, file);
      if (!fs.statSync(fp).isFile()) continue;
      try { execSync(action.replace('{}', `"${fp}"`), { timeout: 10000 }); processed++; } catch {}
    }
  } catch {}
  return `Processed ${processed} files`;
}

// ── Finance Helpers ─────────────────────────────────────────────────────

export async function trackPortfolio(symbols: string[]): Promise<string> {
  const results: string[] = [];
  for (const sym of symbols) {
    const price = await getStockPrice(sym);
    results.push(price);
  }
  return results.join('\n');
}

export function calculateRoi(investment: number, returnAmount: number): string {
  const roi = ((returnAmount - investment) / investment * 100).toFixed(2);
  return `Investment: $${investment}, Return: $${returnAmount}, ROI: ${roi}%`;
}

export function budgetCheck(csvPath: string): string {
  const fs = require('fs');
  try {
    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((l: string) => l.trim());
    const categories: Record<string, number> = {};
    let total = 0;
    for (const line of lines.slice(1)) {
      const parts = line.split(',');
      const cat = parts[2]?.trim() || 'Other';
      const amt = parseFloat(parts[3]?.trim() || parts[1]?.trim() || '0');
      categories[cat] = (categories[cat] || 0) + amt;
      total += amt;
    }
    const summary = Object.entries(categories).map(([k, v]) => `${k}: $${v.toFixed(2)}`).join(', ');
    return `Total: $${total.toFixed(2)} | ${summary}`;
  } catch { return 'Could not read budget data'; }
}

export async function cryptoPrice(symbol: string): Promise<string> {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      https.get(`https://api.coinbase.com/v2/prices/${symbol.toUpperCase()}-USD/spot`, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(`${symbol.toUpperCase()}: $${json?.data?.amount || 'N/A'}`);
          } catch { resolve('Price unavailable'); }
        });
      }).on('error', () => resolve('Price unavailable'));
    });
  } catch { return 'Price unavailable'; }
}

// ── System Maintenance ──────────────────────────────────────────────────

export function clearSystemCache(): string {
  const { execSync } = require('child_process');
  let freed = '';
  if (process.platform === 'darwin') {
    try {
      const before = execSync(`df -h / | tail -1 | awk '{print $4}'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      execSync(`rm -rf ~/Library/Caches/* 2>/dev/null`, { timeout: 10000 });
      const after = execSync(`df -h / | tail -1 | awk '{print $4}'`, { encoding: 'utf-8', timeout: 3000 }).trim();
      freed = `Before: ${before} free, After: ${after} free`;
    } catch { freed = 'Cache cleared'; }
  }
  return freed;
}

export function backupFolder(folderPath: string, destPath?: string): string {
  const { execSync } = require('child_process');
  const path = require('path');
  const name = path.basename(folderPath);
  const timestamp = new Date().toISOString().slice(0, 10);
  const out = destPath || path.join(require('os').homedir(), 'Desktop', `backup-${name}-${timestamp}.zip`);
  execSync(`zip -r "${out}" "${folderPath}"`, { timeout: 60000 });
  return out;
}

export function systemHealth(): string {
  const { execSync } = require('child_process');
  const parts: string[] = [];
  try { parts.push('CPU: ' + execSync(`top -l 1 -n 0 | grep "CPU usage" | sed 's/CPU usage: //'`, { encoding: 'utf-8', timeout: 5000 }).trim()); } catch {}
  try { parts.push('RAM: ' + execSync(`top -l 1 -n 0 | grep PhysMem | sed 's/PhysMem: //'`, { encoding: 'utf-8', timeout: 5000 }).trim()); } catch {}
  try { parts.push('Disk: ' + execSync(`df -h / | tail -1 | awk '{print $4 " free of " $2}'`, { encoding: 'utf-8', timeout: 3000 }).trim()); } catch {}
  try {
    const batt = getBattery();
    parts.push(`Battery: ${batt.percent}% ${batt.charging ? '(charging)' : ''}`);
  } catch {}
  try { parts.push('Uptime: ' + execSync(`uptime | sed 's/.*up //' | sed 's/,.*//'`, { encoding: 'utf-8', timeout: 3000 }).trim()); } catch {}
  return parts.join(' | ');
}

export async function speedTest(): Promise<string> {
  const start = Date.now();
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get('https://speed.cloudflare.com/__down?bytes=1000000', (res: any) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        res.on('end', () => {
          const elapsed = (Date.now() - start) / 1000;
          const mbps = ((bytes * 8) / elapsed / 1000000).toFixed(1);
          resolve(`Download: ${mbps} Mbps (${(bytes / 1024).toFixed(0)} KB in ${elapsed.toFixed(1)}s)`);
        });
      });
      req.on('error', () => resolve('Speed test failed'));
    });
  } catch { return 'Speed test failed'; }
}

export function findLargeFiles(folderPath?: string, minSizeMb: number = 100): string[] {
  const { execSync } = require('child_process');
  const dir = folderPath || require('os').homedir();
  try {
    return execSync(`find "${dir}" -type f -size +${minSizeMb}M 2>/dev/null | head -20`, { encoding: 'utf-8', timeout: 30000 })
      .split('\n').filter((l: string) => l.trim());
  } catch { return []; }
}

export function findDuplicateFiles(folderPath: string): string[] {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const hashes: Record<string, string[]> = {};
  try {
    const files = fs.readdirSync(folderPath).filter((f: string) => !f.startsWith('.'));
    for (const file of files) {
      const fp = path.join(folderPath, file);
      if (!fs.statSync(fp).isFile()) continue;
      const hash = crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex');
      if (!hashes[hash]) hashes[hash] = [];
      hashes[hash].push(file);
    }
  } catch {}
  return Object.values(hashes).filter(files => files.length > 1).map(files => files.join(' = '));
}

export function getUptime(): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`uptime`, { encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { return 'Unknown'; }
}

// ── AI Call Handler ─────────────────────────────────────────────────────

export function enableSpeaker(): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    // Set output volume up to make sure speaker is audible
    execSync(`osascript -e 'set volume output volume 80'`, { timeout: 3000 });
  }
}

export function isCallActive(): boolean {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    try {
      // Check if FaceTime or Phone process is running with an active call
      const procs = execSync(`ps aux | grep -i "facetime\\|callserviced\\|TelephonyUtilities" | grep -v grep`, { encoding: 'utf-8', timeout: 3000 });
      return procs.trim().length > 0;
    } catch { return false; }
  }
  return false;
}

export function speakDuringCall(text: string, rate?: number): void {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    const rateStr = rate ? ` -r ${rate}` : '';
    // Use system TTS — on speakerphone, the call picks this up
    execSync(`say${rateStr} "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 });
  }
}

// ── DALL-E Image Generation ─────────────────────────────────────────────

export async function generateImage(apiKey: string, prompt: string, size: string = '1024x1024', outputPath?: string): Promise<string> {
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const out = outputPath || path.join(require('os').homedir(), 'Desktop', `isibi-image-${Date.now()}.png`);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: 'standard',
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            resolve('Error: ' + (json.error.message || JSON.stringify(json.error)));
            return;
          }
          const imageUrl = json.data?.[0]?.url;
          if (!imageUrl) { resolve('No image URL returned'); return; }

          // Download the image
          https.get(imageUrl, (imgRes: any) => {
            const chunks: Buffer[] = [];
            imgRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            imgRes.on('end', () => {
              fs.writeFileSync(out, Buffer.concat(chunks));
              resolve(out);
            });
          }).on('error', () => resolve('Failed to download image'));
        } catch (e: any) { resolve('Parse error: ' + e.message); }
      });
    });
    req.on('error', (e: any) => resolve('Request error: ' + e.message));
    req.write(postData);
    req.end();
  });
}

export async function editImage(apiKey: string, imagePath: string, prompt: string, outputPath?: string): Promise<string> {
  // DALL-E edit requires PNG with alpha channel — simplified version
  return generateImage(apiKey, prompt + ' (based on existing image)', '1024x1024', outputPath);
}

// ── ElevenLabs Voice API ────────────────────────────────────────────────

export async function elevenLabsListVoices(apiKey: string): Promise<any[]> {
  const https = require('https');
  return new Promise((resolve) => {
    https.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.voices || []);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

export async function elevenLabsCloneVoice(apiKey: string, name: string, description: string, audioFilePaths: string[]): Promise<any> {
  const https = require('https');
  const fs = require('fs');
  const path = require('path');

  // Build multipart form data
  const boundary = '----ISIBIBoundary' + Date.now();
  let body = '';
  body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`;

  const buffers: Buffer[] = [];
  buffers.push(Buffer.from(body, 'utf-8'));

  for (const filePath of audioFilePaths) {
    const filename = path.basename(filePath);
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`;
    buffers.push(Buffer.from(fileHeader, 'utf-8'));
    buffers.push(fs.readFileSync(filePath));
    buffers.push(Buffer.from('\r\n', 'utf-8'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
  const fullBody = Buffer.concat(buffers);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/voices/add',
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      }
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: data }); }
      });
    });
    req.on('error', (e: any) => resolve({ error: e.message }));
    req.write(fullBody);
    req.end();
  });
}

export async function elevenLabsDeleteVoice(apiKey: string, voiceId: string): Promise<boolean> {
  const https = require('https');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/voices/${voiceId}`,
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey }
    }, (res: any) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function elevenLabsTTS(apiKey: string, voiceId: string, text: string, outputPath?: string): Promise<string> {
  const https = require('https');
  const fs = require('fs');
  const out = outputPath || require('path').join(require('os').tmpdir(), `isibi-tts-${Date.now()}.mp3`);

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(out, buffer);
        resolve(out);
      });
    });
    req.on('error', () => resolve(''));
    req.write(postData);
    req.end();
  });
}

export async function elevenLabsSpeak(apiKey: string, voiceId: string, text: string): Promise<void> {
  const audioPath = await elevenLabsTTS(apiKey, voiceId, text);
  if (audioPath) {
    const { execSync } = require('child_process');
    execSync(`afplay "${audioPath}"`, { timeout: 30000 });
    try { require('fs').unlinkSync(audioPath); } catch {}
  }
}

// ── Math: Basic (1-15) ──────────────────────────────────────────────────

export function mathAdd(...nums: number[]): number { return nums.reduce((a, b) => a + b, 0); }
export function mathSubtract(a: number, b: number): number { return a - b; }
export function mathMultiply(...nums: number[]): number { return nums.reduce((a, b) => a * b, 1); }
export function mathDivide(a: number, b: number): number { return b !== 0 ? a / b : NaN; }
export function mathModulo(a: number, b: number): number { return a % b; }
export function mathPower(base: number, exp: number): number { return Math.pow(base, exp); }
export function mathSqrt(n: number): number { return Math.sqrt(n); }
export function mathCbrt(n: number): number { return Math.cbrt(n); }
export function mathAbs(n: number): number { return Math.abs(n); }
export function mathRound(n: number, decimals: number = 0): number { const f = Math.pow(10, decimals); return Math.round(n * f) / f; }
export function mathFloor(n: number): number { return Math.floor(n); }
export function mathCeil(n: number): number { return Math.ceil(n); }
export function mathMin(...nums: number[]): number { return Math.min(...nums); }
export function mathMax(...nums: number[]): number { return Math.max(...nums); }
export function mathAverage(nums: number[]): number { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }

// ── Math: Financial (16-35) ─────────────────────────────────────────────

export function compoundInterest(principal: number, rate: number, n: number, t: number): string {
  const a = principal * Math.pow(1 + rate / n, n * t);
  return `Principal: $${principal}, Rate: ${(rate * 100).toFixed(1)}%, Periods: ${n}/yr, Years: ${t} → Final: $${a.toFixed(2)}, Interest: $${(a - principal).toFixed(2)}`;
}
export function simpleInterest(principal: number, rate: number, t: number): string {
  const a = principal * (1 + rate * t);
  return `$${principal} at ${(rate * 100).toFixed(1)}% for ${t} years = $${a.toFixed(2)} (interest: $${(a - principal).toFixed(2)})`;
}
export function mortgagePayment(principal: number, annualRate: number, years: number): string {
  const r = annualRate / 12; const n = years * 12;
  const m = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return `Loan: $${principal}, Rate: ${(annualRate * 100).toFixed(2)}%, ${years}yr → Monthly: $${m.toFixed(2)}, Total: $${(m * n).toFixed(2)}, Interest: $${(m * n - principal).toFixed(2)}`;
}
export function tipCalculator(bill: number, tipPercent: number, people: number = 1): string {
  const tip = bill * tipPercent / 100; const total = bill + tip; const perPerson = total / people;
  return `Bill: $${bill}, Tip: $${tip.toFixed(2)} (${tipPercent}%), Total: $${total.toFixed(2)}${people > 1 ? `, Per person: $${perPerson.toFixed(2)} (${people} people)` : ''}`;
}
export function taxCalculator(amount: number, taxRate: number): string {
  const tax = amount * taxRate / 100;
  return `Amount: $${amount}, Tax: $${tax.toFixed(2)} (${taxRate}%), Total: $${(amount + tax).toFixed(2)}`;
}
export function discountCalculator(price: number, discount: number): string {
  const saved = price * discount / 100;
  return `Original: $${price}, Discount: ${discount}% (-$${saved.toFixed(2)}), Final: $${(price - saved).toFixed(2)}`;
}
export function markupCalculator(cost: number, markup: number): string {
  const price = cost * (1 + markup / 100);
  return `Cost: $${cost}, Markup: ${markup}%, Selling price: $${price.toFixed(2)}, Profit: $${(price - cost).toFixed(2)}`;
}
export function profitMargin(revenue: number, cost: number): string {
  const margin = ((revenue - cost) / revenue * 100);
  return `Revenue: $${revenue}, Cost: $${cost}, Profit: $${(revenue - cost).toFixed(2)}, Margin: ${margin.toFixed(1)}%`;
}
export function breakEven(fixedCosts: number, price: number, variableCost: number): string {
  const units = fixedCosts / (price - variableCost);
  return `Fixed: $${fixedCosts}, Price: $${price}, Variable: $${variableCost} → Break-even: ${Math.ceil(units)} units ($${(Math.ceil(units) * price).toFixed(2)})`;
}
export function npvCalc(rate: number, cashFlows: number[]): string {
  let npv = 0;
  cashFlows.forEach((cf, i) => { npv += cf / Math.pow(1 + rate, i); });
  return `NPV at ${(rate * 100).toFixed(1)}%: $${npv.toFixed(2)}`;
}
export function salaryToHourly(annual: number, hoursPerWeek: number = 40): string {
  const hourly = annual / (hoursPerWeek * 52);
  return `$${annual}/yr = $${hourly.toFixed(2)}/hr (${hoursPerWeek}hr/wk)`;
}
export function overtimePay(hourlyRate: number, regularHours: number, overtimeHours: number, otMultiplier: number = 1.5): string {
  const regular = hourlyRate * regularHours;
  const ot = hourlyRate * otMultiplier * overtimeHours;
  return `Regular: $${regular.toFixed(2)} (${regularHours}hr), OT: $${ot.toFixed(2)} (${overtimeHours}hr @ ${otMultiplier}x), Total: $${(regular + ot).toFixed(2)}`;
}
export function commissionCalc(sales: number, rate: number): string {
  const comm = sales * rate / 100;
  return `Sales: $${sales}, Commission: ${rate}% = $${comm.toFixed(2)}`;
}
export function inflationAdjusted(amount: number, years: number, inflationRate: number = 0.03): string {
  const adjusted = amount / Math.pow(1 + inflationRate, years);
  return `$${amount} ${years} years ago = $${(amount * Math.pow(1 + inflationRate, years)).toFixed(2)} today (${(inflationRate * 100).toFixed(1)}% inflation)`;
}

// ── Math: Statistics (36-55) ────────────────────────────────────────────

export function statMean(nums: number[]): number { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }
export function statMedian(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function statMode(nums: number[]): number[] {
  const freq: Record<number, number> = {}; nums.forEach(n => freq[n] = (freq[n] || 0) + 1);
  const maxFreq = Math.max(...Object.values(freq));
  return Object.entries(freq).filter(([_, f]) => f === maxFreq).map(([n]) => parseFloat(n));
}
export function statStdDev(nums: number[]): number {
  const m = statMean(nums);
  return Math.sqrt(nums.reduce((sum, n) => sum + Math.pow(n - m, 2), 0) / nums.length);
}
export function statVariance(nums: number[]): number { const s = statStdDev(nums); return s * s; }
export function statRange(nums: number[]): number { return Math.max(...nums) - Math.min(...nums); }
export function statPercentile(nums: number[], p: number): number {
  const s = [...nums].sort((a, b) => a - b); const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i); const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export function statZScore(x: number, mean: number, stdDev: number): number { return (x - mean) / stdDev; }
export function statCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length); const mx = statMean(x.slice(0, n)); const my = statMean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}
export function statRegression(x: number[], y: number[]): { slope: number; intercept: number; equation: string } {
  const n = Math.min(x.length, y.length); const mx = statMean(x.slice(0, n)); const my = statMean(y.slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den ? num / den : 0; const intercept = my - slope * mx;
  return { slope, intercept, equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}` };
}
export function movingAverage(nums: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < nums.length; i++) {
    result.push(nums.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return result;
}
export function weightedAverage(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, v, i) => sum + v * (weights[i] || 0), 0) / totalWeight;
}
export function probability(favorable: number, total: number): string {
  return `P = ${favorable}/${total} = ${(favorable / total).toFixed(4)} = ${(favorable / total * 100).toFixed(2)}%`;
}
export function combinations(n: number, r: number): number {
  return factorial(n) / (factorial(r) * factorial(n - r));
}
export function permutations(n: number, r: number): number {
  return factorial(n) / factorial(n - r);
}
export function factorial(n: number): number {
  if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}
export function fibonacci(n: number): number {
  if (n <= 1) return n; let a = 0, b = 1;
  for (let i = 2; i <= n; i++) { const t = a + b; a = b; b = t; } return b;
}
export function isPrime(n: number): boolean {
  if (n < 2) return false; for (let i = 2; i <= Math.sqrt(n); i++) { if (n % i === 0) return false; } return true;
}
export function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
export function lcm(a: number, b: number): number { return Math.abs(a * b) / gcd(a, b); }

// ── Math: Geometry (56-70) ──────────────────────────────────────────────

export function areaCircle(r: number): string { return `Area = π×${r}² = ${(Math.PI * r * r).toFixed(4)}`; }
export function areaRectangle(l: number, w: number): string { return `Area = ${l}×${w} = ${(l * w).toFixed(4)}`; }
export function areaTriangle(b: number, h: number): string { return `Area = ½×${b}×${h} = ${(0.5 * b * h).toFixed(4)}`; }
export function areaTrapezoid(a: number, b: number, h: number): string { return `Area = ½×(${a}+${b})×${h} = ${(0.5 * (a + b) * h).toFixed(4)}`; }
export function circumference(r: number): string { return `C = 2π×${r} = ${(2 * Math.PI * r).toFixed(4)}`; }
export function perimeterRectangle(l: number, w: number): string { return `P = 2×(${l}+${w}) = ${(2 * (l + w)).toFixed(4)}`; }
export function volumeSphere(r: number): string { return `V = (4/3)π×${r}³ = ${(4/3 * Math.PI * r * r * r).toFixed(4)}`; }
export function volumeCylinder(r: number, h: number): string { return `V = π×${r}²×${h} = ${(Math.PI * r * r * h).toFixed(4)}`; }
export function volumeCone(r: number, h: number): string { return `V = (1/3)π×${r}²×${h} = ${(Math.PI * r * r * h / 3).toFixed(4)}`; }
export function volumeCube(s: number): string { return `V = ${s}³ = ${(s * s * s).toFixed(4)}`; }
export function surfaceAreaSphere(r: number): string { return `SA = 4π×${r}² = ${(4 * Math.PI * r * r).toFixed(4)}`; }
export function surfaceAreaCylinder(r: number, h: number): string { return `SA = 2π×${r}² + 2π×${r}×${h} = ${(2 * Math.PI * r * r + 2 * Math.PI * r * h).toFixed(4)}`; }
export function pythagorean(a: number, b: number): string { const c = Math.sqrt(a * a + b * b); return `a=${a}, b=${b} → c = √(${a}²+${b}²) = ${c.toFixed(4)}`; }
export function distance2d(x1: number, y1: number, x2: number, y2: number): string {
  const d = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  return `Distance from (${x1},${y1}) to (${x2},${y2}) = ${d.toFixed(4)}`;
}
export function midpoint(x1: number, y1: number, x2: number, y2: number): string {
  return `Midpoint of (${x1},${y1}) and (${x2},${y2}) = (${((x1 + x2) / 2).toFixed(2)}, ${((y1 + y2) / 2).toFixed(2)})`;
}

// ── Math: Business & Analytics (86-100) ─────────────────────────────────

export function growthRate(oldVal: number, newVal: number): string {
  return `Growth: ${(((newVal - oldVal) / oldVal) * 100).toFixed(2)}%`;
}
export function cagr(startVal: number, endVal: number, years: number): string {
  const rate = Math.pow(endVal / startVal, 1 / years) - 1;
  return `CAGR: ${(rate * 100).toFixed(2)}% over ${years} years`;
}
export function customerLifetimeValue(avgPurchase: number, frequency: number, lifespan: number): string {
  const clv = avgPurchase * frequency * lifespan;
  return `CLV = $${avgPurchase} × ${frequency}/yr × ${lifespan}yr = $${clv.toFixed(2)}`;
}
export function churnRate(lost: number, total: number): string {
  return `Churn: ${lost}/${total} = ${(lost / total * 100).toFixed(2)}%`;
}
export function conversionRate(conversions: number, visitors: number): string {
  return `CR: ${conversions}/${visitors} = ${(conversions / visitors * 100).toFixed(2)}%`;
}
export function costPerAcquisition(spend: number, customers: number): string {
  return `CPA: $${spend}/${customers} = $${(spend / customers).toFixed(2)} per customer`;
}
export function averageOrderValue(revenue: number, orders: number): string {
  return `AOV: $${revenue}/${orders} = $${(revenue / orders).toFixed(2)}`;
}
export function burnRate(cash: number, monthlySpend: number): string {
  const months = cash / monthlySpend;
  return `Cash: $${cash}, Burn: $${monthlySpend}/mo, Runway: ${months.toFixed(1)} months`;
}
export function revenueForecast(current: number, growthRate: number, months: number): string {
  const projected = current * Math.pow(1 + growthRate / 100, months / 12);
  return `Current: $${current}, Growth: ${growthRate}%, In ${months}mo: $${projected.toFixed(2)}`;
}
export function splitBill(total: number, people: number, tipPercent: number = 0): string {
  const tip = total * tipPercent / 100;
  const withTip = total + tip;
  const each = withTip / people;
  return `Total: $${total}, Tip: $${tip.toFixed(2)} (${tipPercent}%), Each of ${people}: $${each.toFixed(2)}`;
}
export function loanCalculator(principal: number, annualRate: number, months: number): string {
  const r = annualRate / 12;
  const payment = principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  return `Loan: $${principal}, ${(annualRate * 100).toFixed(1)}% for ${months}mo → $${payment.toFixed(2)}/mo, Total: $${(payment * months).toFixed(2)}`;
}
export function investmentReturn(principal: number, rate: number, years: number): string {
  const final2 = principal * Math.pow(1 + rate / 100, years);
  return `$${principal} at ${rate}% for ${years}yr → $${final2.toFixed(2)} (earned: $${(final2 - principal).toFixed(2)})`;
}
export function pricePerUnit(price: number, quantity: number, unit: string = 'unit'): string {
  return `$${price} / ${quantity} ${unit} = $${(price / quantity).toFixed(4)} per ${unit}`;
}

// ── Math: Trigonometry (1-12) ────────────────────────────────────────────

export function mathSin(x: number): number { return Math.sin(x); }
export function mathCos(x: number): number { return Math.cos(x); }
export function mathTan(x: number): number { return Math.tan(x); }
export function mathAsin(x: number): number { return Math.asin(x); }
export function mathAcos(x: number): number { return Math.acos(x); }
export function mathAtan(x: number): number { return Math.atan(x); }
export function degreesToRadians(deg: number): number { return deg * Math.PI / 180; }
export function radiansToDegrees(rad: number): number { return rad * 180 / Math.PI; }
export function lawOfCosines(a: number, b: number, C: number): string {
  const cRad = degreesToRadians(C);
  const c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(cRad));
  return `a=${a}, b=${b}, C=${C}° → c = ${c.toFixed(4)}`;
}
export function lawOfSines(a: number, A: number, B: number): string {
  const aRad = degreesToRadians(A); const bRad = degreesToRadians(B);
  const b = a * Math.sin(bRad) / Math.sin(aRad);
  return `a=${a}, A=${A}°, B=${B}° → b = ${b.toFixed(4)}`;
}

// ── Math: Algebra (13-22) ───────────────────────────────────────────────

export function solveLinear(a: number, b: number): string {
  if (a === 0) return b === 0 ? 'Infinite solutions' : 'No solution';
  return `${a}x + ${b} = 0 → x = ${(-b / a).toFixed(6)}`;
}
export function solveQuadratic(a: number, b: number, c: number): string {
  const disc = b * b - 4 * a * c;
  if (disc < 0) return `${a}x² + ${b}x + ${c} = 0 → No real solutions (discriminant = ${disc})`;
  const x1 = (-b + Math.sqrt(disc)) / (2 * a);
  const x2 = (-b - Math.sqrt(disc)) / (2 * a);
  return disc === 0 ? `x = ${x1.toFixed(6)}` : `x₁ = ${x1.toFixed(6)}, x₂ = ${x2.toFixed(6)}`;
}
export function solveSystem(a1: number, b1: number, c1: number, a2: number, b2: number, c2: number): string {
  const det = a1 * b2 - a2 * b1;
  if (det === 0) return 'No unique solution';
  const x = (c1 * b2 - c2 * b1) / det;
  const y = (a1 * c2 - a2 * c1) / det;
  return `x = ${x.toFixed(6)}, y = ${y.toFixed(6)}`;
}
export function simplifyFraction(num: number, den: number): string {
  const g = gcd(Math.abs(num), Math.abs(den));
  return `${num}/${den} = ${num / g}/${den / g}`;
}
export function mathLog(x: number, base: number = 10): number { return Math.log(x) / Math.log(base); }
export function mathLn(x: number): number { return Math.log(x); }
export function mathExp(x: number): number { return Math.exp(x); }

// ── Math: Number Theory (23-30) ─────────────────────────────────────────

export function primeFactors(n: number): number[] {
  const factors: number[] = []; let d = 2;
  let num = Math.abs(n);
  while (num > 1) { while (num % d === 0) { factors.push(d); num /= d; } d++; }
  return factors;
}
export function isEven(n: number): boolean { return n % 2 === 0; }
export function isOdd(n: number): boolean { return n % 2 !== 0; }
export function decimalToBinary(n: number): string { return n.toString(2); }
export function binaryToDecimal(b: string): number { return parseInt(b, 2); }
export function decimalToHex(n: number): string { return n.toString(16).toUpperCase(); }
export function hexToDecimal(h: string): number { return parseInt(h, 16); }
export function decimalToOctal(n: number): string { return n.toString(8); }
export function octalToDecimal(o: string): number { return parseInt(o, 8); }
export function toRomanNumeral(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = ''; let num = n;
  for (let i = 0; i < vals.length; i++) { while (num >= vals[i]) { result += syms[i]; num -= vals[i]; } }
  return result;
}
export function fromRomanNumeral(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    if (i + 1 < s.length && map[s[i]] < map[s[i + 1]]) { result -= map[s[i]]; } else { result += map[s[i]]; }
  }
  return result;
}

// ── Math: Advanced Financial (31-40) ────────────────────────────────────

export function depreciationStraight(cost: number, salvage: number, life: number): string {
  const annual = (cost - salvage) / life;
  return `Cost: $${cost}, Salvage: $${salvage}, Life: ${life}yr → Annual depreciation: $${annual.toFixed(2)}`;
}
export function depreciationDeclining(cost: number, rate: number, years: number): string {
  let value = cost; const schedule: string[] = [];
  for (let y = 1; y <= years; y++) {
    const dep = value * rate / 100;
    value -= dep;
    schedule.push(`Year ${y}: -$${dep.toFixed(2)} → $${value.toFixed(2)}`);
  }
  return schedule.join('\n');
}
export function bondPrice(faceValue: number, couponRate: number, yield2: number, years: number): string {
  const c = faceValue * couponRate; let pv = 0;
  for (let t = 1; t <= years; t++) pv += c / Math.pow(1 + yield2, t);
  pv += faceValue / Math.pow(1 + yield2, years);
  return `Face: $${faceValue}, Coupon: ${(couponRate * 100).toFixed(1)}%, Yield: ${(yield2 * 100).toFixed(1)}%, ${years}yr → Price: $${pv.toFixed(2)}`;
}
export function dividendYield(annualDiv: number, stockPrice: number): string {
  return `Yield: $${annualDiv} / $${stockPrice} = ${(annualDiv / stockPrice * 100).toFixed(2)}%`;
}
export function peRatio(price: number, eps: number): string {
  return `P/E: $${price} / $${eps} = ${(price / eps).toFixed(2)}`;
}
export function marketCap(price: number, shares: number): string {
  const cap = price * shares;
  const fmt = cap >= 1e9 ? `$${(cap / 1e9).toFixed(2)}B` : cap >= 1e6 ? `$${(cap / 1e6).toFixed(2)}M` : `$${cap.toFixed(2)}`;
  return `Market Cap: $${price} × ${shares.toLocaleString()} shares = ${fmt}`;
}
export function grossMargin(revenue: number, cogs: number): string {
  return `Gross Margin: ($${revenue} - $${cogs}) / $${revenue} = ${((revenue - cogs) / revenue * 100).toFixed(2)}%`;
}
export function operatingMargin(opIncome: number, revenue: number): string {
  return `Operating Margin: $${opIncome} / $${revenue} = ${(opIncome / revenue * 100).toFixed(2)}%`;
}
export function quickRatio(currentAssets: number, inventory: number, currentLiabilities: number): string {
  const ratio = (currentAssets - inventory) / currentLiabilities;
  return `Quick Ratio: ($${currentAssets} - $${inventory}) / $${currentLiabilities} = ${ratio.toFixed(2)}`;
}
export function workingCapital(currentAssets: number, currentLiabilities: number): string {
  return `Working Capital: $${currentAssets} - $${currentLiabilities} = $${(currentAssets - currentLiabilities).toFixed(2)}`;
}

// ── Math: Date Math (41-50) ─────────────────────────────────────────────

export function daysBetween(date1: string, date2: string): number {
  return Math.round(Math.abs(new Date(date2).getTime() - new Date(date1).getTime()) / 86400000);
}
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + days);
  return d.toLocaleDateString();
}
export function businessDays(date1: string, date2: string): number {
  const start = new Date(date1); const end = new Date(date2);
  let count = 0; const d = new Date(start);
  while (d <= end) { const day = d.getDay(); if (day !== 0 && day !== 6) count++; d.setDate(d.getDate() + 1); }
  return count;
}
export function ageCalculator(birthdate: string): string {
  const birth = new Date(birthdate); const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) { months--; days += 30; }
  if (months < 0) { years--; months += 12; }
  return `${years} years, ${months} months, ${days} days`;
}
export function dayOfWeek(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
}
export function quarterOfYear(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getMonth() + 1) / 3);
}
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ── Math: Physics (51-60) ───────────────────────────────────────────────

export function speedDistanceTime(known: { speed?: number; distance?: number; time?: number }): string {
  if (known.speed && known.time) return `Distance = ${known.speed} × ${known.time} = ${(known.speed * known.time).toFixed(2)}`;
  if (known.distance && known.time) return `Speed = ${known.distance} / ${known.time} = ${(known.distance / known.time).toFixed(2)}`;
  if (known.speed && known.distance) return `Time = ${known.distance} / ${known.speed} = ${(known.distance / known.speed).toFixed(2)}`;
  return 'Need at least 2 of: speed, distance, time';
}
export function force(mass: number, acceleration: number): string { return `F = ${mass} × ${acceleration} = ${(mass * acceleration).toFixed(2)} N`; }
export function kineticEnergy(mass: number, velocity: number): string { return `KE = ½ × ${mass} × ${velocity}² = ${(0.5 * mass * velocity * velocity).toFixed(2)} J`; }
export function potentialEnergy(mass: number, height: number, g: number = 9.81): string { return `PE = ${mass} × ${g} × ${height} = ${(mass * g * height).toFixed(2)} J`; }
export function ohmsLaw(known: { v?: number; i?: number; r?: number }): string {
  if (known.v && known.i) return `R = ${known.v} / ${known.i} = ${(known.v / known.i).toFixed(4)} Ω`;
  if (known.v && known.r) return `I = ${known.v} / ${known.r} = ${(known.v / known.r).toFixed(4)} A`;
  if (known.i && known.r) return `V = ${known.i} × ${known.r} = ${(known.i * known.r).toFixed(4)} V`;
  return 'Need at least 2 of: voltage (v), current (i), resistance (r)';
}
export function bmiCalculator(weightKg: number, heightM: number): string {
  const bmi = weightKg / (heightM * heightM);
  const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  return `BMI = ${weightKg}kg / ${heightM}m² = ${bmi.toFixed(1)} (${cat})`;
}
export function caloriesBurned(activity: string, minutes: number, weightKg: number = 70): string {
  const mets: Record<string, number> = { walking: 3.5, running: 8, cycling: 6, swimming: 7, yoga: 2.5, lifting: 5, hiking: 6, dancing: 5, stretching: 2.3 };
  const met = mets[activity.toLowerCase()] || 4;
  const cal = met * weightKg * minutes / 60;
  return `${activity} for ${minutes}min (${weightKg}kg): ~${Math.round(cal)} calories`;
}
export function wavelengthCalc(speed: number, frequency: number): string {
  return `λ = ${speed} / ${frequency} = ${(speed / frequency).toFixed(6)}`;
}

// ── Math: Calculus ──────────────────────────────────────────────────────

export function numericalDerivative(fn: string, x: number, h: number = 0.0001): number {
  const f = (v: number) => new Function('x', 'return ' + fn)(v);
  return (f(x + h) - f(x - h)) / (2 * h);
}

export function numericalIntegral(fn: string, a: number, b: number, n: number = 1000): number {
  const f = (v: number) => new Function('x', 'return ' + fn)(v);
  const dx = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(a + (i + 0.5) * dx);
  return sum * dx;
}

export function numericalLimit(fn: string, x: number, side: string = 'both'): number {
  const f = (v: number) => new Function('x', 'return ' + fn)(v);
  const h = 0.00001;
  if (side === 'left') return f(x - h);
  if (side === 'right') return f(x + h);
  return (f(x - h) + f(x + h)) / 2;
}

// ── Math: Linear Algebra ────────────────────────────────────────────────

export function matrixAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val + (b[i]?.[j] || 0)));
}

export function matrixMultiply(a: number[][], b: number[][]): number[][] {
  const rows = a.length, cols = b[0]?.length || 0, inner = b.length;
  const result: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < inner; k++)
        result[i][j] += (a[i][k] || 0) * (b[k]?.[j] || 0);
  return result;
}

export function determinant(m: number[][]): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    const sub = m.slice(1).map(row => [...row.slice(0, j), ...row.slice(j + 1)]);
    det += (j % 2 === 0 ? 1 : -1) * m[0][j] * determinant(sub);
  }
  return det;
}

export function transpose(m: number[][]): number[][] {
  return m[0].map((_, j) => m.map(row => row[j]));
}

export function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
}

export function crossProduct(a: number[], b: number[]): number[] {
  return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
}

export function vectorMagnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

// ── Math: Number Sequences ──────────────────────────────────────────────

export function arithmeticSequence(a1: number, d: number, n: number): { nth: number; sum: number } {
  const nth = a1 + (n - 1) * d;
  const sum = n * (a1 + nth) / 2;
  return { nth, sum };
}

export function geometricSequence(a1: number, r: number, n: number): { nth: number; sum: number } {
  const nth = a1 * Math.pow(r, n - 1);
  const sum = r === 1 ? a1 * n : a1 * (1 - Math.pow(r, n)) / (1 - r);
  return { nth, sum };
}

export function sumOfSeries(n: number): number {
  return n * (n + 1) / 2;
}

// ── Math: Logic ─────────────────────────────────────────────────────────

export function booleanAnd(a: boolean, b: boolean): boolean { return a && b; }
export function booleanOr(a: boolean, b: boolean): boolean { return a || b; }
export function booleanXor(a: boolean, b: boolean): boolean { return a !== b; }
export function booleanNot(a: boolean): boolean { return !a; }

export function truthTable(vars: number = 2): string {
  const letters = ['A', 'B', 'C', 'D'].slice(0, vars);
  const rows = Math.pow(2, vars);
  let table = letters.join(' | ') + ' | AND | OR | XOR\n';
  table += '-'.repeat(table.length) + '\n';
  for (let i = 0; i < rows; i++) {
    const bits = letters.map((_, j) => (i >> (vars - 1 - j)) & 1);
    const and = bits.every(b => b === 1) ? 1 : 0;
    const or = bits.some(b => b === 1) ? 1 : 0;
    const xor = bits.reduce((a, b) => a ^ b, 0);
    table += bits.join(' | ') + ` |  ${and}  | ${or}  |  ${xor}\n`;
  }
  return table;
}

// ── Math: Ratios & Proportions ──────────────────────────────────────────

export function ratioSimplify(a: number, b: number): string {
  const g = gcd(Math.abs(a), Math.abs(b));
  return `${a}:${b} = ${a/g}:${b/g}`;
}

export function proportionSolve(a: number, b: number, c: number): string {
  const x = (b * c) / a;
  return `${a}/${b} = ${c}/x → x = ${x.toFixed(4)}`;
}

// ── Math: More Physics ──────────────────────────────────────────────────

export function momentum(mass: number, velocity: number): string { return `p = ${mass} × ${velocity} = ${(mass * velocity).toFixed(2)} kg·m/s`; }
export function work(force2: number, distance: number): string { return `W = ${force2} × ${distance} = ${(force2 * distance).toFixed(2)} J`; }
export function powerPhysics(work2: number, time: number): string { return `P = ${work2} / ${time} = ${(work2 / time).toFixed(2)} W`; }
export function frequency(period: number): string { return `f = 1 / ${period} = ${(1 / period).toFixed(4)} Hz`; }
export function pressure(force2: number, area: number): string { return `P = ${force2} / ${area} = ${(force2 / area).toFixed(2)} Pa`; }
export function density(mass: number, volume: number): string { return `ρ = ${mass} / ${volume} = ${(mass / volume).toFixed(4)} kg/m³`; }
export function acceleration(v: number, u: number, t: number): string { return `a = (${v} - ${u}) / ${t} = ${((v - u) / t).toFixed(4)} m/s²`; }
export function projectileRange(v: number, angle: number, g: number = 9.81): string {
  const rad = angle * Math.PI / 180;
  const r = (v * v * Math.sin(2 * rad)) / g;
  return `R = ${v}²×sin(2×${angle}°) / ${g} = ${r.toFixed(2)} m`;
}

// ── Math: Chemistry ─────────────────────────────────────────────────────

export function molarity(moles: number, liters: number): string { return `M = ${moles} / ${liters} = ${(moles / liters).toFixed(4)} mol/L`; }
export function dilution(m1: number, v1: number, m2: number): string {
  const v2 = (m1 * v1) / m2;
  return `M1V1 = M2V2 → ${m1}×${v1} = ${m2}×V2 → V2 = ${v2.toFixed(4)} L`;
}
export function phCalculator(hConc: number): string {
  const ph = -Math.log10(hConc);
  return `pH = -log(${hConc}) = ${ph.toFixed(2)} (${ph < 7 ? 'acidic' : ph > 7 ? 'basic' : 'neutral'})`;
}
export function idealGas(known: { P?: number; V?: number; n?: number; T?: number }): string {
  const R = 0.0821; // L·atm/(mol·K)
  if (known.P && known.V && known.n) return `T = PV/nR = ${(known.P * known.V / (known.n * R)).toFixed(2)} K`;
  if (known.P && known.V && known.T) return `n = PV/RT = ${(known.P * known.V / (R * known.T)).toFixed(4)} mol`;
  if (known.P && known.n && known.T) return `V = nRT/P = ${(known.n * R * known.T / known.P).toFixed(4)} L`;
  if (known.V && known.n && known.T) return `P = nRT/V = ${(known.n * R * known.T / known.V).toFixed(4)} atm`;
  return 'Need at least 3 of: P, V, n, T';
}

// ── Math: More Financial ────────────────────────────────────────────────

export function ruleOf72(rate: number): string { return `Years to double at ${rate}%: ${(72 / rate).toFixed(1)} years`; }
export function futureValue(pv: number, rate: number, years: number, pmt: number = 0): string {
  const fv = pv * Math.pow(1 + rate, years) + pmt * (Math.pow(1 + rate, years) - 1) / rate;
  return `FV = $${fv.toFixed(2)} (PV=$${pv}, rate=${(rate*100).toFixed(1)}%, ${years}yr, PMT=$${pmt})`;
}
export function presentValue(fv: number, rate: number, years: number): string {
  const pv = fv / Math.pow(1 + rate, years);
  return `PV = $${pv.toFixed(2)} (FV=$${fv} in ${years}yr at ${(rate*100).toFixed(1)}%)`;
}
export function annuityPayment(target: number, rate: number, years: number): string {
  const n = years * 12; const r = rate / 12;
  const pmt = target * r / (Math.pow(1 + r, n) - 1);
  return `Monthly payment: $${pmt.toFixed(2)} to reach $${target} in ${years}yr at ${(rate*100).toFixed(1)}%`;
}
export function debtPayoff(balance: number, rate: number, payment: number): string {
  let bal = balance; let months = 0; const r = rate / 12;
  while (bal > 0 && months < 600) { bal = bal * (1 + r) - payment; months++; }
  return `$${balance} at ${(rate*100).toFixed(1)}% with $${payment}/mo → paid off in ${months} months (${(months/12).toFixed(1)} years)`;
}

// ── Math: Probability & Statistics Advanced ─────────────────────────────

export function normalDistribution(x: number, mean: number, stdDev: number): number {
  const z = (x - mean) / stdDev;
  return Math.exp(-0.5 * z * z) / (stdDev * Math.sqrt(2 * Math.PI));
}

export function binomialProbability(n: number, k: number, p: number): number {
  return combinations(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

export function expectedValue(values: number[], probabilities: number[]): number {
  return values.reduce((sum, v, i) => sum + v * (probabilities[i] || 0), 0);
}

export function standardError(stdDev: number, n: number): number {
  return stdDev / Math.sqrt(n);
}

export function confidenceInterval(mean: number, stdDev: number, n: number, confidence: number = 0.95): string {
  const zScores: Record<number, number> = { 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 };
  const z = zScores[confidence] || 1.96;
  const se = stdDev / Math.sqrt(n);
  const margin = z * se;
  return `${(confidence*100).toFixed(0)}% CI: ${(mean - margin).toFixed(4)} to ${(mean + margin).toFixed(4)} (margin: ±${margin.toFixed(4)})`;
}

// ── Content Extraction Helpers ───────────────────────────────────────────

export function extractAddresses(text: string): string[] {
  return text.match(/\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl)[\s,]*(?:[\w\s]+,\s*)?[A-Z]{2}\s*\d{5}(?:-\d{4})?/gi) || [];
}

export function extractDates(text: string): string[] {
  const patterns = [
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
    /\d{4}-\d{2}-\d{2}/g,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}/gi,
    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/gi,
  ];
  const dates: string[] = [];
  patterns.forEach(p => { const m = text.match(p); if (m) dates.push(...m); });
  return dates;
}

export function extractNumbers(text: string): string[] {
  return text.match(/(?:\$|€|£)?\d[\d,]*\.?\d*/g) || [];
}

export function extractNames(text: string): string[] {
  // Simple heuristic: capitalized word pairs
  return text.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g) || [];
}

// ── Personal Finance Helpers ────────────────────────────────────────────

export function savingsCalculator(goal: number, months: number, currentSavings: number = 0, rate: number = 0): string {
  const remaining = goal - currentSavings;
  const monthly = remaining / months;
  return `Goal: \$${goal}, Current: \$${currentSavings}, Need: \$${monthly.toFixed(2)}/mo for ${months} months`;
}

export function retirementCalculator(currentAge: number, retireAge: number, savings: number, monthlyContrib: number, rate: number = 0.07): string {
  const years = retireAge - currentAge;
  let total = savings;
  for (let y = 0; y < years; y++) total = (total + monthlyContrib * 12) * (1 + rate);
  return `Age ${currentAge}→${retireAge} (${years}yr), Current: \$${savings}, Contributing: \$${monthlyContrib}/mo at ${(rate*100).toFixed(0)}% → \$${total.toFixed(0)} at retirement`;
}

export function taxBracket(income: number): string {
  // 2024 US federal brackets (single filer)
  const brackets = [
    { limit: 11600, rate: 10 }, { limit: 47150, rate: 12 }, { limit: 100525, rate: 22 },
    { limit: 191950, rate: 24 }, { limit: 243725, rate: 32 }, { limit: 609350, rate: 35 }, { limit: Infinity, rate: 37 }
  ];
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (income <= b.limit) { tax += (income - prev) * b.rate / 100; break; }
    tax += (b.limit - prev) * b.rate / 100; prev = b.limit;
  }
  const effective = (tax / income * 100).toFixed(1);
  const marginal = brackets.find(b => income <= b.limit)?.rate || 37;
  return `Income: \$${income}, Tax: \$${tax.toFixed(2)}, Effective: ${effective}%, Marginal: ${marginal}%`;
}

export function paycheckCalculator(gross: number, federalRate: number = 22, stateRate: number = 5, fica: number = 7.65): string {
  const fedTax = gross * federalRate / 100;
  const stateTax = gross * stateRate / 100;
  const ficaTax = gross * fica / 100;
  const net = gross - fedTax - stateTax - ficaTax;
  return `Gross: \$${gross}, Federal: -\$${fedTax.toFixed(2)}, State: -\$${stateTax.toFixed(2)}, FICA: -\$${ficaTax.toFixed(2)}, Net: \$${net.toFixed(2)}`;
}

// ── Data Intelligence Helpers ───────────────────────────────────────────

export function predictTrend(data: number[], futurePoints: number = 3): number[] {
  const n = data.length;
  if (n < 2) return [];
  const x = Array.from({ length: n }, (_, i) => i);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = data.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (data[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const predictions: number[] = [];
  for (let i = n; i < n + futurePoints; i++) predictions.push(parseFloat((slope * i + intercept).toFixed(2)));
  return predictions;
}

export function anomalyDetect(data: number[]): { outliers: number[]; indices: number[] } {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const std = Math.sqrt(data.reduce((sum, v) => sum + (v - mean) ** 2, 0) / data.length);
  const threshold = 2; // 2 standard deviations
  const outliers: number[] = [];
  const indices: number[] = [];
  data.forEach((v, i) => {
    if (Math.abs(v - mean) > threshold * std) { outliers.push(v); indices.push(i); }
  });
  return { outliers, indices };
}

export function abTestCalculator(visitorsA: number, conversionsA: number, visitorsB: number, conversionsB: number): string {
  const rateA = conversionsA / visitorsA;
  const rateB = conversionsB / visitorsB;
  const seA = Math.sqrt(rateA * (1 - rateA) / visitorsA);
  const seB = Math.sqrt(rateB * (1 - rateB) / visitorsB);
  const z = (rateB - rateA) / Math.sqrt(seA * seA + seB * seB);
  const significant = Math.abs(z) > 1.96;
  const winner = rateB > rateA ? 'B' : 'A';
  const lift = ((rateB - rateA) / rateA * 100).toFixed(1);
  return `A: ${(rateA*100).toFixed(2)}% (${conversionsA}/${visitorsA}), B: ${(rateB*100).toFixed(2)}% (${conversionsB}/${visitorsB}), Lift: ${lift}%, Z-score: ${z.toFixed(3)}, ${significant ? 'SIGNIFICANT — ' + winner + ' wins' : 'NOT significant yet'}`;
}

export function decisionMatrix(options: string[], criteria: string[], weights: number[], scores: number[][]): string {
  const results = options.map((opt, i) => {
    const weighted = criteria.map((_, j) => (scores[i]?.[j] || 0) * (weights[j] || 1));
    const total = weighted.reduce((a, b) => a + b, 0);
    return { option: opt, total: parseFloat(total.toFixed(2)) };
  });
  results.sort((a, b) => b.total - a.total);
  return results.map((r, i) => `${i + 1}. ${r.option}: ${r.total}`).join('\n');
}

// ── Everyday Life Helpers ───────────────────────────────────────────────

export function sleepCalculator(wakeUpTime: string): string {
  // Sleep cycles are ~90 min. Ideal: 5-6 cycles (7.5-9 hours)
  const wake = new Date(`2000-01-02T${wakeUpTime}`);
  const cycles = [6, 5, 4]; // preferred order
  return cycles.map(c => {
    const bedtime = new Date(wake.getTime() - c * 90 * 60000 - 15 * 60000); // 15 min to fall asleep
    const h = bedtime.getHours(); const m = bedtime.getMinutes();
    return `${c} cycles (${c * 1.5}hr): sleep at ${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }).join('\n');
}

export function randomMeal(): string {
  const meals = ['Pasta Carbonara','Chicken Stir Fry','Tacos','Sushi Bowl','Caesar Salad','Grilled Salmon','Burger & Fries','Pad Thai','Pizza Margherita','Chicken Tikka Masala','Beef Stew','Fish Tacos','Ramen','Burrito Bowl','Greek Salad','BBQ Ribs','Shrimp Scampi','Veggie Curry','Pulled Pork Sandwich','Poke Bowl'];
  return meals[Math.floor(Math.random() * meals.length)];
}

export function randomWorkout(): string {
  const workouts = [
    '3x12 Push-ups, 3x15 Squats, 3x10 Lunges, 1min Plank x3',
    '5K Run, 3x20 Crunches, 3x15 Jumping Jacks',
    '4x10 Dumbbell Press, 3x12 Rows, 3x15 Bicep Curls, 3x12 Tricep Dips',
    '30min HIIT: 40s on/20s off — Burpees, Mountain Climbers, Jump Squats, High Knees',
    '3x12 Deadlifts, 3x10 Bench Press, 3x15 Pull-ups, 2min Plank',
    'Yoga Flow: 45min — Sun Salutations, Warrior Poses, Balance, Cool Down',
    '20min Jump Rope, 3x15 Sit-ups, 3x20 Russian Twists, 3x15 Leg Raises',
  ];
  return workouts[Math.floor(Math.random() * workouts.length)];
}

export function randomMovie(): string {
  const movies = ['The Shawshank Redemption','Inception','The Dark Knight','Pulp Fiction','Forrest Gump','The Matrix','Interstellar','Fight Club','The Godfather','Goodfellas','Parasite','Whiplash','The Prestige','Django Unchained','Mad Max Fury Road','Arrival','The Grand Budapest Hotel','No Country for Old Men','Blade Runner 2049','Everything Everywhere All at Once'];
  return movies[Math.floor(Math.random() * movies.length)];
}

export function randomBook(): string {
  const books = ['Atomic Habits','Sapiens','The Psychology of Money','Deep Work','Think and Grow Rich','The 48 Laws of Power','Thinking Fast and Slow','The Lean Startup','Zero to One','The 4-Hour Workweek','Cant Hurt Me','Outliers','Start with Why','Rich Dad Poor Dad','The Almanack of Naval Ravikant','The Art of War','Meditations','How to Win Friends','The Power of Now','Shoe Dog'];
  return books[Math.floor(Math.random() * books.length)];
}

export function dailyQuote(): string {
  const quotes = [
    '"The only way to do great work is to love what you do." — Steve Jobs',
    '"Innovation distinguishes between a leader and a follower." — Steve Jobs',
    '"Stay hungry, stay foolish." — Steve Jobs',
    '"The best time to plant a tree was 20 years ago. The second best time is now." — Chinese Proverb',
    '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Churchill',
    '"The future belongs to those who believe in the beauty of their dreams." — Eleanor Roosevelt',
    '"It does not matter how slowly you go as long as you do not stop." — Confucius',
    '"The only impossible journey is the one you never begin." — Tony Robbins',
    '"What you get by achieving your goals is not as important as what you become." — Zig Ziglar',
    '"Believe you can and youre halfway there." — Theodore Roosevelt',
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

// ── Multi-Monitor ───────────────────────────────────────────────────────

export function getDisplays(): { id: number; width: number; height: number; x: number; y: number; primary: boolean }[] {
  const { execSync } = require('child_process');
  const displays: any[] = [];
  if (process.platform === 'darwin') {
    try {
      const output = execSync(`system_profiler SPDisplaysDataType -json`, { encoding: 'utf-8', timeout: 5000 });
      const data = JSON.parse(output);
      let id = 0;
      for (const gpu of data?.SPDisplaysDataType || []) {
        for (const disp of gpu?.spdisplays_ndrvs || []) {
          const res = disp._spdisplays_resolution?.match(/(\d+)\s*x\s*(\d+)/);
          displays.push({
            id: id++,
            width: res ? parseInt(res[1]) : 0,
            height: res ? parseInt(res[2]) : 0,
            x: 0, y: 0,
            primary: disp.spdisplays_main === 'spdisplays_yes',
          });
        }
      }
    } catch {}
  }
  return displays.length > 0 ? displays : [{ id: 0, width: 1920, height: 1080, x: 0, y: 0, primary: true }];
}

// ── Safari (AppleScript) ────────────────────────────────────────────────

export function safariGetTabs(): string[] {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`osascript -e 'tell application "Safari" to set t to ""
repeat with w in windows
  repeat with tb in tabs of w
    set t to t & name of tb & " | " & URL of tb & "\\n"
  end repeat
end repeat
return t'`, { encoding: 'utf-8', timeout: 10000 });
    return output.split('\n').filter((l: string) => l.trim());
  } catch { return []; }
}

export function safariOpenUrl(url: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Safari" to open location "${url}"' -e 'tell application "Safari" to activate'`, { timeout: 5000 });
}

export function safariGetCurrentUrl(): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`osascript -e 'tell application "Safari" to URL of current tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { return ''; }
}

export function safariGetCurrentTitle(): string {
  const { execSync } = require('child_process');
  try {
    return execSync(`osascript -e 'tell application "Safari" to name of current tab of front window'`, { encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { return ''; }
}

// ── Apple Music (AppleScript) ───────────────────────────────────────────

export function musicPlay(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to play'`, { timeout: 5000 });
}

export function musicPause(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to pause'`, { timeout: 5000 });
}

export function musicNext(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to next track'`, { timeout: 5000 });
}

export function musicPrev(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to previous track'`, { timeout: 5000 });
}

export function musicGetNowPlaying(): { track: string; artist: string; album: string } {
  const { execSync } = require('child_process');
  try {
    const track = execSync(`osascript -e 'tell application "Music" to name of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    const artist = execSync(`osascript -e 'tell application "Music" to artist of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    const album = execSync(`osascript -e 'tell application "Music" to album of current track'`, { encoding: 'utf-8', timeout: 3000 }).trim();
    return { track, artist, album };
  } catch { return { track: 'Nothing playing', artist: '', album: '' }; }
}

export function musicSearch(query: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to activate'`, { timeout: 3000 });
  // Use Cmd+F to search
  execSync(`osascript -e 'tell application "System Events" to keystroke "f" using command down'`, { timeout: 2000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "${query.replace(/"/g, '\\"')}"'`, { timeout: 3000 });
}

export function musicSetVolume(percent: number): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Music" to set sound volume to ${Math.max(0, Math.min(100, percent))}'`, { timeout: 3000 });
}

export function musicPlayPlaylist(name: string): void {
  const { execSync } = require('child_process');
  try {
    execSync(`osascript -e 'tell application "Music" to play playlist "${name.replace(/"/g, '\\"')}"'`, { timeout: 5000 });
  } catch {}
}

export function musicGetPlaylists(): string[] {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`osascript -e 'tell application "Music" to get name of every playlist'`, { encoding: 'utf-8', timeout: 5000 });
    return output.split(', ').map((p: string) => p.trim());
  } catch { return []; }
}

// ── Keynote (AppleScript) ───────────────────────────────────────────────

export function keynoteCreate(title?: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Keynote"
  activate
  set newDoc to make new document
  ${title ? 'tell slide 1 of newDoc to set object text of default title item to "' + title.replace(/"/g, '\\"') + '"' : ''}
end tell'`, { timeout: 10000 });
}

export function keynoteAddSlide(title?: string, body?: string): void {
  const { execSync } = require('child_process');
  let script = `tell application "Keynote"
  tell front document
    set newSlide to make new slide`;
  if (title) script += `\n    tell newSlide to set object text of default title item to "${title.replace(/"/g, '\\"')}"`;
  if (body) script += `\n    tell newSlide to set object text of default body item to "${body.replace(/"/g, '\\"')}"`;
  script += `\n  end tell\nend tell`;
  execSync(`osascript -e '${script}'`, { timeout: 10000 });
}

// ── Numbers (AppleScript) ───────────────────────────────────────────────

export function numbersCreate(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Numbers" to activate' -e 'tell application "Numbers" to make new document'`, { timeout: 10000 });
}

export function numbersSetCell(row: number, col: number, value: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Numbers"
  tell table 1 of sheet 1 of front document
    set value of cell ${col} of row ${row} to "${value.replace(/"/g, '\\"')}"
  end tell
end tell'`, { timeout: 5000 });
}

// ── Pages (AppleScript) ─────────────────────────────────────────────────

export function pagesCreate(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Pages" to activate' -e 'tell application "Pages" to make new document'`, { timeout: 10000 });
}

export function pagesTypeText(text: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Pages" to activate'`, { timeout: 3000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"'`, { timeout: 10000 });
}

// ── Photos (AppleScript) ────────────────────────────────────────────────

export function photosSearch(query: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Photos" to activate'`, { timeout: 5000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "f" using command down'`, { timeout: 2000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "${query.replace(/"/g, '\\"')}"'`, { timeout: 3000 });
}

export function photosGetCount(): number {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`osascript -e 'tell application "Photos" to count of media items'`, { encoding: 'utf-8', timeout: 10000 });
    return parseInt(output.trim()) || 0;
  } catch { return 0; }
}

export function photosGetAlbums(): string[] {
  const { execSync } = require('child_process');
  try {
    const output = execSync(`osascript -e 'tell application "Photos" to get name of every album'`, { encoding: 'utf-8', timeout: 10000 });
    return output.split(', ').map((a: string) => a.trim());
  } catch { return []; }
}

// ── Podcasts (AppleScript) ──────────────────────────────────────────────

export function podcastsPlay(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Podcasts" to activate'`, { timeout: 5000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke space'`, { timeout: 2000 });
}

export function podcastsSearch(query: string): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Podcasts" to activate'`, { timeout: 5000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "f" using command down'`, { timeout: 2000 });
  execSync(`osascript -e 'tell application "System Events" to keystroke "${query.replace(/"/g, '\\"')}"'`, { timeout: 3000 });
}

// ── Maps (AppleScript) ──────────────────────────────────────────────────

export function mapsSearch(query: string): void {
  const { execSync } = require('child_process');
  execSync(`open "maps://?q=${encodeURIComponent(query)}"`, { timeout: 5000 });
}

export function mapsDirections(from: string, to: string): void {
  const { execSync } = require('child_process');
  execSync(`open "maps://?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}"`, { timeout: 5000 });
}

// ── Books (AppleScript) ─────────────────────────────────────────────────

export function booksOpen(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Books" to activate'`, { timeout: 5000 });
}

// ── Home/HomeKit (AppleScript) ──────────────────────────────────────────

export function homeOpen(): void {
  const { execSync } = require('child_process');
  execSync(`osascript -e 'tell application "Home" to activate'`, { timeout: 5000 });
}

// ── Utility ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep, Key };
