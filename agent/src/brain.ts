/**
 * Agent Brain — processes natural language commands into screen actions.
 *
 * Supports:
 * - Single commands: "open Safari and go to YouTube"
 * - Multi-task: "send a Slack message AND check my email AND create a lead in CRM"
 * - Scheduled: "every morning at 9am, check inventory"
 * - Chained: "find the latest invoice, download it, and email it to John"
 */

import Anthropic from '@anthropic-ai/sdk';
import { SystemIndex, findApp, findFile, findBookmark } from './indexer';
import * as controller from './controller';
import * as overlay from './overlay';
import * as vision from './vision';

import { getApiKey } from './config';
import { AgentProfile } from './agents';

const MODEL = 'claude-sonnet-4-20250514';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getApiKey() });
  }
  return client;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface Action {
  type: 'open_app' | 'open_url' | 'click' | 'type' | 'press_key' | 'scroll' | 'wait' | 'screenshot' | 'find_and_click' | 'search_spotlight';
  target?: string;       // app name, URL, or element description
  text?: string;         // text to type
  key?: string;          // key to press
  x?: number;            // click coordinates
  y?: number;
  duration?: number;     // wait duration in ms
  description: string;   // human-readable step description
}

export interface TaskPlan {
  taskId: string;
  command: string;
  actions: Action[];
  status: 'pending' | 'running' | 'done' | 'failed';
  currentStep: number;
  error?: string;
}

// ── Multi-Task Queue ────────────────────────────────────────────────────
// Supports running multiple tasks — sequential on screen, parallel for non-screen tasks

const taskQueue: TaskPlan[] = [];
let isExecuting = false;

export function getTaskQueue(): TaskPlan[] {
  return [...taskQueue];
}

export function getActiveTask(): TaskPlan | null {
  return taskQueue.find(t => t.status === 'running') || null;
}

// ── Command Processing ──────────────────────────────────────────────────

export async function processCommand(
  command: string,
  systemIndex: SystemIndex,
  agent?: AgentProfile,
): Promise<TaskPlan[]> {
  // Split multi-task commands: "do X AND do Y AND do Z"
  const tasks = splitIntoTasks(command);
  const plans: TaskPlan[] = [];

  for (const task of tasks) {
    const plan = await planTask(task, systemIndex, agent);
    plans.push(plan);
    taskQueue.push(plan);
  }

  // Start executing if not already
  if (!isExecuting) {
    executeQueue(systemIndex).catch(console.error);
  }

  return plans;
}

function splitIntoTasks(command: string): string[] {
  // Split on "and also", "and then", "also", "then", standalone "and" between clauses
  const parts = command.split(/\b(?:and also|and then|also|then)\b/i);

  // Also split on "AND" when between two action-like phrases
  const refined: string[] = [];
  for (const part of parts) {
    const subParts = part.split(/\bAND\b/);
    for (const sub of subParts) {
      const trimmed = sub.trim();
      if (trimmed.length > 3) refined.push(trimmed);
    }
  }

  return refined.length > 0 ? refined : [command];
}

// ── Action Planning with Claude ─────────────────────────────────────────

async function planTask(command: string, index: SystemIndex, agent?: AgentProfile): Promise<TaskPlan> {
  const taskId = Math.random().toString(36).slice(2, 8);

  // Build context from system index
  const appNames = index.apps.slice(0, 30).map(a => a.name).join(', ');
  const recentFiles = index.recentFiles.slice(0, 10).map(f => f.name).join(', ');
  const runningApps = (index.runningProcesses || []).slice(0, 20).map(p => p.name).join(', ');
  const openTabs = (index.browserTabs || []).slice(0, 10).map(t => `"${t.title}" (${t.url})`).join(', ');
  const desktopItems = (index.desktopFiles || []).slice(0, 20).join(', ');
  const sysInfo = index.systemInfo || {} as any;

  // Agent personality/role injection
  const agentContext = agent
    ? `\nYour name is "${agent.name}" ${agent.emoji}. Your role: ${agent.role}\nCustom instructions: ${agent.instructions}\n`
    : '';

  const api = getClient();

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `You are ISIBI Ghost Mode — an AI agent that controls a computer. Convert natural language commands into action steps.${agentContext}

=== SYSTEM CONTEXT ===
Available apps: ${appNames}
Running processes: ${runningApps || 'unknown'}
Open browser tabs: ${openTabs || 'none detected'}
Desktop files: ${desktopItems || 'none'}
Recent files: ${recentFiles}
System: ${sysInfo.hostname || ''}, user: ${sysInfo.username || ''}, macOS ${sysInfo.osVersion || ''}, ${sysInfo.memoryGB || '?'}GB RAM, ${sysInfo.cpuModel || ''}
Platform: ${index.platform} (${index.platform === 'darwin' ? 'macOS' : index.platform === 'win32' ? 'Windows' : 'Linux'})

=== OUTPUT FORMAT ===
Return ONLY a JSON array of actions. No explanation, no markdown, just the JSON array.
Example: [{"type":"open_url","target":"https://youtube.com","description":"Opening YouTube"},{"type":"wait","duration":1500,"description":"Waiting for page to load"}]

=== ACTION TYPES ===
- open_app: launch a desktop app (NOT browsers)
- open_url: open URL in default browser
- find_and_click: describe a UI element — AI vision locates and clicks it
- click: click at exact x,y coordinates
- type: type text character by character
- press_key: press key or combo (Enter, Tab, Escape, Cmd+C, Cmd+Shift+N, etc.)
- scroll: scroll "up" or "down"
- wait: pause for duration ms (default 1000)
- screenshot: capture and analyze the screen
- search_spotlight: open Spotlight/Start menu to search

=== RULES ===
1. For websites, ALWAYS use open_url (never open_app with a browser name).
2. ALWAYS add {"type":"wait","duration":1500,"description":"Waiting for page to load"} after every open_url.
3. For web searches, use URL query params: open_url "https://site.com/search?q=TERM" — never try to find_and_click a search box.
4. Use find_and_click ONLY for UI elements with no keyboard shortcut or URL alternative.
5. ALWAYS complete the FULL user intent — don't stop halfway.

=== SMART SHORTCUTS (use these exact patterns) ===

BROWSER:
- "open gmail" → open_url "https://mail.google.com"
- "open google calendar" → open_url "https://calendar.google.com"
- "open google drive" → open_url "https://drive.google.com"
- "search google for X" → open_url "https://www.google.com/search?q=X"
- "search youtube for X" → open_url "https://www.youtube.com/results?search_query=X"
- "search amazon for X" → open_url "https://www.amazon.com/s?k=X"
- "search reddit for X" → open_url "https://www.reddit.com/search/?q=X"
- "open netflix" → open_url "https://www.netflix.com"
- "open twitter/X" → open_url "https://x.com"
- "open instagram" → open_url "https://www.instagram.com"
- "open linkedin" → open_url "https://www.linkedin.com"
- "open reddit" → open_url "https://www.reddit.com"
- "open whatsapp" → open_url "https://web.whatsapp.com" (or open_app if installed)
- "open telegram" → open_url "https://web.telegram.org"
- "close tab" → press_key "Cmd+W"
- "close all tabs" → press_key "Cmd+Shift+W"
- "go back" → press_key "Cmd+["
- "refresh page" → press_key "Cmd+R"
- "new tab" → press_key "Cmd+T"
- "bookmark this" → press_key "Cmd+D"
- "incognito/private window" → press_key "Cmd+Shift+N"
- "zoom in" → press_key "Cmd+="
- "zoom out" → press_key "Cmd+-"
- "find text on page" → press_key "Cmd+F", then type the text
- "open new google doc" → open_url "https://docs.google.com/document/create"
- "open new google sheet" → open_url "https://sheets.google.com/create"
- "open new google slides" → open_url "https://slides.google.com/create"

SYSTEM:
- "volume up" → press_key "VolumeUp" (repeat 3x for noticeable change)
- "volume down" → press_key "VolumeDown" (repeat 3x)
- "mute" → press_key "Mute"
- "brightness up" → press_key "BrightnessUp" (repeat 3x)
- "brightness down" → press_key "BrightnessDown" (repeat 3x)
- "take screenshot" → press_key "Cmd+Shift+3"
- "screenshot selection" → press_key "Cmd+Shift+4"
- "lock screen" → press_key "Cmd+Ctrl+Q"
- "open settings" → open_app "System Settings" (or "System Preferences")
- "open finder" → open_app "Finder"
- "open terminal" → open_app "Terminal"
- "show desktop" → press_key "Cmd+F3"
- "open spotlight" → press_key "Cmd+Space"
- "force quit" → press_key "Cmd+Option+Escape"
- "switch app" → press_key "Cmd+Tab"
- "minimize window" → press_key "Cmd+M"
- "full screen" → press_key "Cmd+Ctrl+F"
- "empty trash" → open_app "Finder", then press_key "Cmd+Shift+Delete"

PRODUCTIVITY:
- "copy" → press_key "Cmd+C"
- "paste" → press_key "Cmd+V"
- "undo" → press_key "Cmd+Z"
- "redo" → press_key "Cmd+Shift+Z"
- "select all" → press_key "Cmd+A"
- "save" → press_key "Cmd+S"
- "print" → press_key "Cmd+P"
- "open notes" → open_app "Notes"
- "new note" → open_app "Notes", then press_key "Cmd+N"
- "open reminders" → open_app "Reminders"
- "open calculator" → open_app "Calculator"

MEDIA:
- "play/pause" → press_key "MediaPlayPause"
- "next song/track" → press_key "MediaNextTrack"
- "previous song/track" → press_key "MediaPreviousTrack"
- "open spotify" → open_app "Spotify"
- "play X on spotify" → open_app "Spotify", wait 1000, press_key "Cmd+K", wait 500, type X, wait 1000, find_and_click "first search result", wait 500, find_and_click "play button"
- "play X on youtube" → open_url "https://www.youtube.com/results?search_query=X", wait 1500, find_and_click "first video thumbnail or title"
- "open apple music" → open_app "Music"
- "open podcasts" → open_app "Podcasts"

COMMUNICATION:
- "open slack" → open_app "Slack"
- "send slack message to X" → open_app "Slack", wait 1000, press_key "Cmd+K", wait 500, type X, wait 500, press_key "Enter", wait 500, type the message, press_key "Enter"
- "open discord" → open_app "Discord"
- "open zoom" → open_app "zoom.us"
- "open facetime" → open_app "FaceTime"
- "open messages" → open_app "Messages"
- "send message on whatsapp to X" → open_url "https://web.whatsapp.com", wait 3000, find_and_click "search box", type X, wait 1000, find_and_click "contact result", wait 500, find_and_click "message input", type the message, press_key "Enter"

FILES:
- "open downloads" → open_url "file:///Users/${sysInfo.username || ''}/Downloads" or press_key "Cmd+Option+L" in Finder
- "open documents" → open_url "file:///Users/${sysInfo.username || ''}/Documents"
- "open desktop folder" → open_url "file:///Users/${sysInfo.username || ''}/Desktop"
- "open X file" → find it in recent files list, open it with: open_url "file://PATH"

=== INTENT RULES ===
- "open/play/watch/go to X" → MUST navigate AND click/select the result. Don't stop at a search page.
- "search/look up/find X" → navigate to search results. Stopping there is fine.
- "send message to X saying Y" → open the app, find the contact, type the message, AND press send.
- "turn up/down" → repeat the key press 3 times for a noticeable effect.
- Always generate enough steps to FULLY complete the task. If unsure, add a find_and_click for the most logical next step rather than stopping too early.
- After opening a URL, ALWAYS add a wait step before any find_and_click.`,
    messages: [{
      role: 'user',
      content: command,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';

  let actions: Action[] = [];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      actions = JSON.parse(jsonMatch[0]);
    }
  } catch {
    actions = [{ type: 'open_app', target: 'Finder', description: `Could not plan: ${command}` }];
  }

  return {
    taskId,
    command,
    actions,
    status: 'pending',
    currentStep: 0,
  };
}

// ── Task Execution ──────────────────────────────────────────────────────

async function executeQueue(index: SystemIndex): Promise<void> {
  isExecuting = true;

  while (taskQueue.some(t => t.status === 'pending')) {
    const task = taskQueue.find(t => t.status === 'pending');
    if (!task) break;

    task.status = 'running';

    try {
      // Create ghost overlay
      overlay.createOverlay();

      for (let i = 0; i < task.actions.length; i++) {
        task.currentStep = i;
        const action = task.actions[i];

        // Show status
        overlay.showStatus(action.description, i + 1);

        await executeAction(action, index);

        // Brief pause between actions
        await controller.sleep(300);
      }

      task.status = 'done';
      overlay.showStatus('Done!');
      await controller.sleep(1000);

    } catch (e: any) {
      task.status = 'failed';
      task.error = e.message;
      overlay.showStatus(`Failed: ${e.message}`);
      await controller.sleep(2000);
    }

    overlay.hideOrb();
    overlay.hideStatus();
  }

  isExecuting = false;

  // Clean up overlay after all tasks done
  setTimeout(() => overlay.destroyOverlay(), 500);
}

async function executeAction(action: Action, index: SystemIndex): Promise<void> {
  switch (action.type) {
    case 'open_app': {
      const app = findApp(index, action.target || '');
      if (app) {
        overlay.showStatus(`Opening ${app.name}...`);
        await controller.openApp(app.name);
      } else {
        // Try spotlight as fallback
        await controller.searchAndOpen(action.target || '');
      }
      break;
    }

    case 'open_url': {
      await controller.openUrl(action.target || '');
      break;
    }

    case 'search_spotlight': {
      await controller.searchAndOpen(action.target || action.text || '');
      break;
    }

    case 'find_and_click': {
      // Use Claude Vision to find the element on screen
      const pos = await vision.findElement(action.target || '');
      if (pos) {
        overlay.moveOrb(pos.x, pos.y);
        await controller.sleep(400);
        overlay.clickOrb(pos.x, pos.y);
        await controller.click(pos.x, pos.y);
      } else {
        throw new Error(`Could not find: ${action.target}`);
      }
      break;
    }

    case 'click': {
      if (action.x != null && action.y != null) {
        overlay.moveOrb(action.x, action.y);
        await controller.sleep(300);
        overlay.clickOrb(action.x, action.y);
        await controller.click(action.x, action.y);
      }
      break;
    }

    case 'type': {
      overlay.startTyping();
      await controller.typeText(action.text || '', 40);
      overlay.stopTyping();
      break;
    }

    case 'press_key': {
      const keyStr = action.key || '';
      // Parse key combinations like "Cmd+C", "Enter", "Tab"
      await pressKeyCombo(keyStr);
      break;
    }

    case 'scroll': {
      const dir = (action.text || 'down').toLowerCase();
      if (dir === 'up') await controller.scrollUp();
      else await controller.scrollDown();
      break;
    }

    case 'wait': {
      await controller.sleep(action.duration || 1000);
      break;
    }

    case 'screenshot': {
      // Take screenshot and analyze — useful for conditional actions
      const analysis = await vision.analyzeScreen('What is currently on the screen?');
      console.log('[Vision]', analysis.description);
      break;
    }
  }
}

async function pressKeyCombo(keyStr: string): Promise<void> {
  const parts = keyStr.split('+').map(k => k.trim().toLowerCase());
  const keyMap: Record<string, any> = {
    'enter': controller.Key.Enter,
    'return': controller.Key.Enter,
    'tab': controller.Key.Tab,
    'escape': controller.Key.Escape,
    'esc': controller.Key.Escape,
    'space': controller.Key.Space,
    'backspace': controller.Key.Backspace,
    'delete': controller.Key.Delete,
    'up': controller.Key.Up,
    'down': controller.Key.Down,
    'left': controller.Key.Left,
    'right': controller.Key.Right,
    'cmd': controller.Key.LeftCmd,
    'command': controller.Key.LeftCmd,
    'ctrl': controller.Key.LeftControl,
    'control': controller.Key.LeftControl,
    'alt': controller.Key.LeftAlt,
    'option': controller.Key.LeftAlt,
    'shift': controller.Key.LeftShift,
    'a': controller.Key.A, 'b': controller.Key.B, 'c': controller.Key.C,
    'd': controller.Key.D, 'e': controller.Key.E, 'f': controller.Key.F,
    'g': controller.Key.G, 'h': controller.Key.H, 'i': controller.Key.I,
    'j': controller.Key.J, 'k': controller.Key.K, 'l': controller.Key.L,
    'm': controller.Key.M, 'n': controller.Key.N, 'o': controller.Key.O,
    'p': controller.Key.P, 'q': controller.Key.Q, 'r': controller.Key.R,
    's': controller.Key.S, 't': controller.Key.T, 'u': controller.Key.U,
    'v': controller.Key.V, 'w': controller.Key.W, 'x': controller.Key.X,
    'y': controller.Key.Y, 'z': controller.Key.Z,
  };

  const keys = parts.map(p => keyMap[p]).filter(Boolean);
  if (keys.length > 0) {
    await controller.pressKey(...keys);
  }
}

// ── Conversation Memory ─────────────────────────────────────────────────

const conversationHistory: { role: string; content: string }[] = [];

export function addToHistory(role: string, content: string): void {
  conversationHistory.push({ role, content });
  // Keep last 20 messages
  if (conversationHistory.length > 20) conversationHistory.shift();
}

export function getHistory(): { role: string; content: string }[] {
  return [...conversationHistory];
}

export function clearHistory(): void {
  conversationHistory.length = 0;
}
