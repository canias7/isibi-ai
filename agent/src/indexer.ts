/**
 * System Indexer — scans the computer on first install and builds a fast lookup index.
 *
 * Discovers:
 * - Installed applications (name, path, how to launch)
 * - Recent files (Desktop, Documents, Downloads)
 * - Browser bookmarks (Safari, Chrome)
 * - Running processes
 *
 * Stores index at userData/system-index.json for instant access.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const INDEX_PATH = path.join(app.getPath('userData'), 'system-index.json');

export interface AppInfo {
  name: string;
  path: string;
  bundleId?: string;
  category?: string;
  launchCommand: string;
}

export interface FileInfo {
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export interface BookmarkInfo {
  title: string;
  url: string;
  source: 'safari' | 'chrome';
}

export interface RunningProcess {
  name: string;
  pid: number;
}

export interface BrowserTab {
  title: string;
  url: string;
  browser: string;
}

export interface SystemInfo {
  hostname: string;
  username: string;
  osVersion: string;
  shell: string;
  defaultBrowser: string;
  screenResolution: string;
  memoryGB: number;
  cpuModel: string;
}

export interface SystemIndex {
  apps: AppInfo[];
  recentFiles: FileInfo[];
  bookmarks: BookmarkInfo[];
  runningProcesses: RunningProcess[];
  browserTabs: BrowserTab[];
  systemInfo: SystemInfo;
  desktopFiles: string[];
  scannedAt: string;
  platform: string;
}

// ── App Discovery ───────────────────────────────────────────────────────

function discoverApps(): AppInfo[] {
  const apps: AppInfo[] = [];

  if (process.platform === 'darwin') {
    // macOS: scan /Applications and ~/Applications
    const dirs = ['/Applications', path.join(require('os').homedir(), 'Applications')];
    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (!entry.endsWith('.app')) continue;
          const appPath = path.join(dir, entry);
          const name = entry.replace('.app', '');
          apps.push({
            name,
            path: appPath,
            launchCommand: `open -a "${name}"`,
            category: categorizeApp(name),
          });
        }
      } catch { /* skip inaccessible dirs */ }
    }
  } else if (process.platform === 'win32') {
    // Windows: check common program locations
    try {
      const output = execSync('powershell -Command "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json"', { encoding: 'utf-8', timeout: 10000 });
      const startApps = JSON.parse(output);
      for (const a of (Array.isArray(startApps) ? startApps : [startApps])) {
        if (a.Name) {
          apps.push({
            name: a.Name,
            path: a.AppID || '',
            launchCommand: `start "" "${a.AppID}"`,
            category: categorizeApp(a.Name),
          });
        }
      }
    } catch { /* powershell not available */ }
  } else {
    // Linux: check .desktop files
    const desktopDirs = ['/usr/share/applications', path.join(require('os').homedir(), '.local/share/applications')];
    for (const dir of desktopDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.desktop')) continue;
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const nameMatch = content.match(/^Name=(.+)$/m);
          const execMatch = content.match(/^Exec=(.+)$/m);
          if (nameMatch) {
            apps.push({
              name: nameMatch[1],
              path: path.join(dir, file),
              launchCommand: execMatch?.[1]?.replace(/%[a-zA-Z]/g, '') || '',
              category: categorizeApp(nameMatch[1]),
            });
          }
        }
      } catch { /* skip */ }
    }
  }

  return apps;
}

function categorizeApp(name: string): string {
  const lower = name.toLowerCase();
  if (['safari', 'chrome', 'firefox', 'edge', 'brave', 'opera', 'arc'].some(b => lower.includes(b))) return 'browser';
  if (['mail', 'outlook', 'thunderbird', 'gmail'].some(b => lower.includes(b))) return 'email';
  if (['slack', 'discord', 'teams', 'zoom', 'skype', 'whatsapp', 'telegram', 'messages'].some(b => lower.includes(b))) return 'communication';
  if (['code', 'xcode', 'intellij', 'sublime', 'atom', 'vim', 'terminal', 'iterm'].some(b => lower.includes(b))) return 'development';
  if (['excel', 'numbers', 'sheets', 'word', 'pages', 'docs', 'notion', 'obsidian'].some(b => lower.includes(b))) return 'productivity';
  if (['finder', 'explorer', 'files'].some(b => lower.includes(b))) return 'system';
  if (['spotify', 'music', 'youtube', 'netflix', 'vlc'].some(b => lower.includes(b))) return 'media';
  if (['photoshop', 'figma', 'sketch', 'canva', 'illustrator'].some(b => lower.includes(b))) return 'design';
  return 'other';
}

// ── File Discovery ──────────────────────────────────────────────────────

function discoverFiles(): FileInfo[] {
  const files: FileInfo[] = [];
  const home = require('os').homedir();
  const dirs = [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
  ];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() || entry.name.startsWith('.')) continue;
        try {
          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          // Only recent files (last 30 days)
          if (Date.now() - stat.mtimeMs > 30 * 24 * 60 * 60 * 1000) continue;
          files.push({
            name: entry.name,
            path: fullPath,
            extension: path.extname(entry.name).toLowerCase(),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  // Sort by most recent
  files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return files.slice(0, 500); // Cap at 500
}

// ── Bookmark Discovery ──────────────────────────────────────────────────

function discoverBookmarks(): BookmarkInfo[] {
  const bookmarks: BookmarkInfo[] = [];
  const home = require('os').homedir();

  // Safari bookmarks (macOS)
  if (process.platform === 'darwin') {
    try {
      const safariPath = path.join(home, 'Library/Safari/Bookmarks.plist');
      if (fs.existsSync(safariPath)) {
        const output = execSync(`plutil -convert json -o - "${safariPath}"`, { encoding: 'utf-8', timeout: 5000 });
        const data = JSON.parse(output);
        extractSafariBookmarks(data, bookmarks);
      }
    } catch { /* Safari bookmarks not accessible */ }
  }

  // Chrome bookmarks
  const chromePaths = [
    path.join(home, 'Library/Application Support/Google/Chrome/Default/Bookmarks'),
    path.join(home, '.config/google-chrome/Default/Bookmarks'),
    path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Bookmarks'),
  ];
  for (const cp of chromePaths) {
    try {
      if (!fs.existsSync(cp)) continue;
      const data = JSON.parse(fs.readFileSync(cp, 'utf-8'));
      extractChromeBookmarks(data.roots?.bookmark_bar, bookmarks);
      extractChromeBookmarks(data.roots?.other, bookmarks);
      break;
    } catch { /* skip */ }
  }

  return bookmarks.slice(0, 200); // Cap at 200
}

function extractSafariBookmarks(node: any, results: BookmarkInfo[]) {
  if (!node) return;
  if (node.URLString) {
    results.push({ title: node.URIDictionary?.title || node.URLString, url: node.URLString, source: 'safari' });
  }
  if (node.Children) {
    for (const child of node.Children) extractSafariBookmarks(child, results);
  }
}

function extractChromeBookmarks(node: any, results: BookmarkInfo[]) {
  if (!node) return;
  if (node.type === 'url') {
    results.push({ title: node.name || node.url, url: node.url, source: 'chrome' });
  }
  if (node.children) {
    for (const child of node.children) extractChromeBookmarks(child, results);
  }
}

// ── Running Processes ──────────────────────────────────────────────────

function discoverRunningProcesses(): RunningProcess[] {
  const procs: RunningProcess[] = [];
  try {
    if (process.platform === 'darwin') {
      const output = execSync('ps -eo pid,comm | grep -v grep | tail -100', { encoding: 'utf-8', timeout: 5000 });
      output.split('\n').forEach(line => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
          const name = path.basename(match[2]);
          if (!name.startsWith('(') && name.length > 1) {
            procs.push({ name, pid: parseInt(match[1]) });
          }
        }
      });
    } else if (process.platform === 'win32') {
      const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 10000 });
      output.split('\n').forEach(line => {
        const parts = line.split('","');
        if (parts.length >= 2) {
          procs.push({ name: parts[0].replace('"', ''), pid: parseInt(parts[1]) });
        }
      });
    } else {
      const output = execSync('ps -eo pid,comm --no-headers | tail -100', { encoding: 'utf-8', timeout: 5000 });
      output.split('\n').forEach(line => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) procs.push({ name: path.basename(match[2]), pid: parseInt(match[1]) });
      });
    }
  } catch { /* skip */ }
  // Deduplicate by name
  const seen = new Set<string>();
  return procs.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; });
}

// ── Open Browser Tabs ──────────────────────────────────────────────────

function discoverBrowserTabs(): BrowserTab[] {
  const tabs: BrowserTab[] = [];
  if (process.platform !== 'darwin') return tabs; // AppleScript only works on macOS

  // Safari tabs
  try {
    const output = execSync(`osascript -e 'tell application "Safari" to set tabList to ""
tell application "Safari"
  repeat with w in windows
    repeat with t in tabs of w
      set tabList to tabList & name of t & "|" & URL of t & "\\n"
    end repeat
  end repeat
end tell
return tabList'`, { encoding: 'utf-8', timeout: 5000 });
    output.split('\n').forEach(line => {
      const [title, url] = line.split('|');
      if (title && url) tabs.push({ title: title.trim(), url: url.trim(), browser: 'Safari' });
    });
  } catch { /* Safari not running or no permission */ }

  // Chrome tabs
  try {
    const output = execSync(`osascript -e 'tell application "Google Chrome"
  set tabList to ""
  repeat with w in windows
    repeat with t in tabs of w
      set tabList to tabList & title of t & "|" & URL of t & "\\n"
    end repeat
  end repeat
  return tabList
end tell'`, { encoding: 'utf-8', timeout: 5000 });
    output.split('\n').forEach(line => {
      const [title, url] = line.split('|');
      if (title && url) tabs.push({ title: title.trim(), url: url.trim(), browser: 'Chrome' });
    });
  } catch { /* Chrome not running */ }

  return tabs.slice(0, 50);
}

// ── System Info ────────────────────────────────────────────────────────

function discoverSystemInfo(): SystemInfo {
  const os = require('os');
  const info: SystemInfo = {
    hostname: os.hostname(),
    username: os.userInfo().username,
    osVersion: '',
    shell: process.env.SHELL || '',
    defaultBrowser: '',
    screenResolution: '',
    memoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    cpuModel: os.cpus()?.[0]?.model || 'unknown',
  };

  if (process.platform === 'darwin') {
    try { info.osVersion = execSync('sw_vers -productVersion', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch {}
    try {
      const browser = execSync('defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -A2 "https" | grep "LSHandlerRoleAll" | head -1', { encoding: 'utf-8', timeout: 3000 });
      info.defaultBrowser = browser.trim().replace(/[";]/g, '').replace('LSHandlerRoleAll = ', '').trim();
    } catch { info.defaultBrowser = 'com.apple.Safari'; }
    try {
      const res = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep Resolution | head -1', { encoding: 'utf-8', timeout: 5000 });
      info.screenResolution = res.trim().replace('Resolution: ', '');
    } catch {}
  } else if (process.platform === 'win32') {
    try { info.osVersion = execSync('ver', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch {}
  } else {
    try { info.osVersion = execSync('uname -r', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch {}
  }

  return info;
}

// ── Desktop Contents ───────────────────────────────────────────────────

function discoverDesktopFiles(): string[] {
  const home = require('os').homedir();
  const desktopPath = path.join(home, 'Desktop');
  try {
    if (!fs.existsSync(desktopPath)) return [];
    return fs.readdirSync(desktopPath)
      .filter(f => !f.startsWith('.'))
      .slice(0, 100);
  } catch { return []; }
}

// ── Main Index Builder ──────────────────────────────────────────────────

export function buildIndex(): SystemIndex {
  console.log('[Indexer] Scanning system...');
  const start = Date.now();

  const index: SystemIndex = {
    apps: discoverApps(),
    recentFiles: discoverFiles(),
    bookmarks: discoverBookmarks(),
    runningProcesses: discoverRunningProcesses(),
    browserTabs: discoverBrowserTabs(),
    systemInfo: discoverSystemInfo(),
    desktopFiles: discoverDesktopFiles(),
    scannedAt: new Date().toISOString(),
    platform: process.platform,
  };

  const elapsed = Date.now() - start;
  console.log(`[Indexer] Done in ${elapsed}ms: ${index.apps.length} apps, ${index.recentFiles.length} files, ${index.bookmarks.length} bookmarks, ${index.runningProcesses.length} processes, ${index.browserTabs.length} tabs, ${index.desktopFiles.length} desktop items`);

  // Save to disk
  try {
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (e) {
    console.error('[Indexer] Failed to save index:', e);
  }

  return index;
}

export function loadIndex(): SystemIndex | null {
  try {
    if (fs.existsSync(INDEX_PATH)) {
      return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    }
  } catch { /* corrupt index */ }
  return null;
}

export function refreshIndex(): SystemIndex {
  // Quick refresh: update dynamic data (processes, tabs, files, desktop)
  const existing = loadIndex();
  if (existing) {
    existing.recentFiles = discoverFiles();
    existing.runningProcesses = discoverRunningProcesses();
    existing.browserTabs = discoverBrowserTabs();
    existing.desktopFiles = discoverDesktopFiles();
    existing.scannedAt = new Date().toISOString();
    try { fs.writeFileSync(INDEX_PATH, JSON.stringify(existing, null, 2)); } catch {}
    return existing;
  }
  return buildIndex();
}

// ── Search Helpers ──────────────────────────────────────────────────────

export function findApp(index: SystemIndex, query: string): AppInfo | null {
  const q = query.toLowerCase();
  // Exact name match first
  const exact = index.apps.find(a => a.name.toLowerCase() === q);
  if (exact) return exact;
  // Partial match
  const partial = index.apps.find(a => a.name.toLowerCase().includes(q));
  if (partial) return partial;
  // Category match
  const cat = index.apps.find(a => a.category === q);
  return cat || null;
}

export function findFile(index: SystemIndex, query: string): FileInfo | null {
  const q = query.toLowerCase();
  return index.recentFiles.find(f => f.name.toLowerCase().includes(q)) || null;
}

export function findBookmark(index: SystemIndex, query: string): BookmarkInfo | null {
  const q = query.toLowerCase();
  return index.bookmarks.find(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) || null;
}
