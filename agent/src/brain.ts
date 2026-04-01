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
    system: `You are a computer control agent. Convert natural language commands into action steps.${agentContext}
Available apps on this computer: ${appNames}
Currently running apps/processes: ${runningApps || 'unknown'}
Open browser tabs: ${openTabs || 'none detected'}
Desktop files: ${desktopItems || 'none'}
Recent files: ${recentFiles}
System: ${sysInfo.hostname || ''}, user: ${sysInfo.username || ''}, macOS ${sysInfo.osVersion || ''}, ${sysInfo.memoryGB || '?'}GB RAM, ${sysInfo.cpuModel || ''}
Platform: ${index.platform} (${index.platform === 'darwin' ? 'macOS' : index.platform === 'win32' ? 'Windows' : 'Linux'})

Return ONLY a JSON array of actions:
[
  {"type": "open_url", "target": "https://youtube.com", "description": "Opening YouTube"},
  {"type": "find_and_click", "target": "search box", "description": "Clicking the search box"},
  {"type": "type", "text": "search term", "description": "Typing search term"},
  {"type": "press_key", "key": "Enter", "description": "Pressing Enter to search"}
]

IMPORTANT: For opening websites, ALWAYS use open_url (not open_app with a browser name). The system will use the default browser.

Action types:
- open_app: launch a desktop application (NOT browsers — use open_url for web)
- open_url: open a URL in the default browser
- click: click at coordinates (x, y) — use find_and_click instead when possible
- find_and_click: describe the element to click (AI will locate it on screen)
- type: type text (types character by character)
- press_key: press a key (Enter, Tab, Escape, Cmd+C, Cmd+V, etc.)
- scroll: scroll up or down
- wait: pause for duration ms
- screenshot: take a screenshot to see what's on screen
- search_spotlight: use Spotlight/Start menu to find and open something

PREFER keyboard shortcuts over find_and_click when possible — they are more reliable:
- YouTube search: click the URL bar (press_key Cmd+L), type the search URL directly: open_url "https://www.youtube.com/results?search_query=TERM"
- Google search: just use open_url "https://www.google.com/search?q=TERM"
- Browser address bar: press_key Cmd+L (macOS) or Ctrl+L (Windows/Linux)
- Browser search on page: press_key Cmd+F
- Copy: press_key Cmd+C, Paste: press_key Cmd+V
- New tab: press_key Cmd+T
- Close tab: press_key Cmd+W

For searching on a website (YouTube, Google, Amazon, etc.), ALWAYS prefer using the URL with query parameters instead of trying to find and click a search box. Example: open_url "https://www.youtube.com/results?search_query=ksi" instead of navigating to youtube then trying to click the search box.

Use find_and_click ONLY for UI elements that cannot be accessed via keyboard shortcuts or URLs (like specific buttons in desktop apps).
Use open_app for launching known applications.
Keep actions minimal — don't add unnecessary waits or screenshots unless needed.
Add a wait of 1500ms after open_url to let the page load before interacting with it.`,
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
