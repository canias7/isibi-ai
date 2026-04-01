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

// Agent memory — persists across actions within a session
const agentMemory: Record<string, string> = {};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getApiKey() });
  }
  return client;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface Action {
  type: string;          // action type
  target?: string;       // app name, URL, element description, file path, or HTTP URL
  text?: string;         // text to type, file content, HTTP body, or speech text
  key?: string;          // key to press
  x?: number;            // coordinates
  y?: number;
  toX?: number;          // drag/select destination
  toY?: number;
  duration?: number;     // wait/hold duration in ms
  method?: string;       // HTTP method (GET, POST, etc.)
  headers?: Record<string, string>; // HTTP headers
  condition?: string;    // for conditional: what to check on screen
  actions?: Action[];    // for conditional/loop: nested actions
  count?: number;        // for loop: how many times
  value?: number;        // for set_volume: percentage, resize: width/height
  width?: number;        // for resize_window
  height?: number;       // for resize_window
  app1?: string;         // for split_screen
  app2?: string;         // for split_screen
  on?: boolean;          // for toggle_wifi/bluetooth: true=on, false=off
  memoryKey?: string;    // for remember/recall: storage key
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

  // Build agent-specific prompt section
  const agentPrompt = agent && agent.instructions
    ? `\n=== YOUR IDENTITY ===\nYou are "${agent.name}" ${agent.emoji}. Role: ${agent.role}\n\n=== YOUR INSTRUCTIONS (FOLLOW THESE AS YOUR PRIMARY DIRECTIVE) ===\n${agent.instructions}\n`
    : '';

  const api = getClient();

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `You are ISIBI Ghost Mode — an AI agent that controls a computer. Convert natural language commands into action steps.
You understand ALL languages. The user may speak in any language — always understand their intent and respond with the correct action steps. Action JSON keys/values stay in English, but description fields should match the user's language.
${agentPrompt}
=== COMPUTER STATE ===
Apps installed: ${appNames}
Running now: ${runningApps || 'unknown'}
Open tabs: ${openTabs || 'none'}
Desktop: ${desktopItems || 'none'}
Recent files: ${recentFiles}
System: ${sysInfo.username || ''}@${sysInfo.hostname || ''}, macOS ${sysInfo.osVersion || ''}, ${sysInfo.memoryGB || '?'}GB RAM
Platform: ${index.platform === 'darwin' ? 'macOS' : index.platform === 'win32' ? 'Windows' : 'Linux'}

=== OUTPUT ===
Return ONLY a JSON array. No text, no markdown.
Example: [{"type":"open_url","target":"https://youtube.com","description":"Opening YouTube"},{"type":"wait","duration":1500,"description":"Waiting for page load"}]

=== ACTIONS YOU CAN USE ===
BASIC:
- open_app: launch a desktop app (NOT browsers — use open_url for web)
- open_url: open a URL in the default browser
- find_and_click: {"type":"find_and_click","target":"description of element"} — AI vision finds and clicks it
- click: {"type":"click","x":100,"y":200} — click at exact coordinates
- double_click: {"type":"double_click","target":"file icon"} or {"type":"double_click","x":100,"y":200} — double-click (open files, select words)
- right_click: {"type":"right_click","target":"image"} or {"type":"right_click","x":100,"y":200} — right-click for context menu
- move_mouse: {"type":"move_mouse","target":"menu item"} or {"type":"move_mouse","x":100,"y":200} — hover without clicking (tooltips, dropdowns)
- drag: {"type":"drag","x":100,"y":200,"toX":300,"toY":400} — drag from one point to another
- type: type text character by character
- press_key: keyboard key/combo (Enter, Tab, Escape, Cmd+C, Cmd+Shift+N, F1-F12, 0-9, etc.)
- scroll: scroll "up" or "down"
- wait: pause for duration ms
- search_spotlight: open Spotlight to search and launch

SCREEN INTELLIGENCE:
- screenshot: capture screen to see what's happening
- read_screen: {"type":"read_screen","target":"Read all the text on screen"} — takes screenshot, OCR/analyzes it, stores result for next steps
- read_clipboard: {"type":"read_clipboard"} — reads clipboard contents into memory
- write_clipboard: {"type":"write_clipboard","text":"content to copy"} — writes text to clipboard
- conditional: {"type":"conditional","condition":"Is there an error message?","actions":[...]} — checks screen, runs nested actions only if condition is true

FILE OPERATIONS:
- create_file: {"type":"create_file","target":"/Users/X/Desktop/note.txt","text":"file content"}
- read_file: {"type":"read_file","target":"/Users/X/Desktop/note.txt"} — reads file into memory
- move_file: {"type":"move_file","target":"/old/path.txt","text":"/new/path.txt"} — move or rename
- delete_file: {"type":"delete_file","target":"/Users/X/Desktop/old.txt"}

AUTOMATION:
- loop: {"type":"loop","count":3,"actions":[...]} — repeat nested actions N times
- http_request: {"type":"http_request","target":"https://api.example.com/data","method":"GET"} — call any API directly
  For POST: {"type":"http_request","target":"URL","method":"POST","text":"{\\"key\\":\\"value\\"}","headers":{"Authorization":"Bearer token"}}

NOTIFICATIONS & SPEECH:
- notify: {"type":"notify","target":"Title","text":"Message body"} — show macOS notification
- alert: {"type":"alert","target":"Title","text":"Question?"} — show dialog, waits for OK/Cancel
- speak: {"type":"speak","text":"Hello, I finished the task"} — text-to-speech, agent talks out loud

WINDOW MANAGEMENT:
- list_windows: {"type":"list_windows"} — get all open windows into memory
- switch_window: {"type":"switch_window","target":"Safari"} — bring app window to front
- resize_window: {"type":"resize_window","width":800,"height":600} — resize active window
- move_window: {"type":"move_window","x":0,"y":25} — move active window
- split_screen: {"type":"split_screen","app1":"Safari","app2":"Notes"} — put two apps side by side

ADVANCED INPUT:
- hold_key: {"type":"hold_key","key":"Shift","duration":2000} — hold a key for a duration
- select_text: {"type":"select_text","x":100,"y":200,"toX":400,"toY":200} — click+shift-click to select range
- find_and_right_click: {"type":"find_and_right_click","target":"image"} — vision finds element, right-clicks it
- find_and_double_click: {"type":"find_and_double_click","target":"file icon"} — vision finds element, double-clicks it

SYSTEM CONTROL:
- set_volume: {"type":"set_volume","value":75} — set volume to exact percentage (0-100)
- get_volume: {"type":"get_volume"} — check current volume
- toggle_wifi: {"type":"toggle_wifi","on":true} — turn wifi on/off
- toggle_bluetooth: {"type":"toggle_bluetooth","on":false} — turn bluetooth on/off
- toggle_dark_mode: {"type":"toggle_dark_mode"} — switch light/dark mode
- sleep_computer: {"type":"sleep_computer"} — put computer to sleep
- empty_trash: {"type":"empty_trash"} — empty trash directly
- get_battery: {"type":"get_battery"} — check battery percentage, shows notification

DATA & MEMORY:
- remember: {"type":"remember","memoryKey":"email","text":"john@example.com"} — store a value
- recall: {"type":"recall","memoryKey":"email"} — retrieve a stored value into context
- ask_user: {"type":"ask_user","text":"What email should I use?"} — notify user to check chat

MULTI-AGENT:
- call_agent: {"type":"call_agent","target":"Email Bot","text":"send report to john"} — trigger another agent
- pass_data: {"type":"pass_data","memoryKey":"report_data","text":"Q1 revenue: $50k"} — share data between agents

MESSAGING:
- send_imessage: {"type":"send_imessage","target":"+1234567890","text":"Hey, what's up?"} — send iMessage/SMS directly
- read_imessages: {"type":"read_imessages","target":"John","count":5} — read recent messages from contact

CALLS:
- make_call: {"type":"make_call","target":"john@email.com"} — FaceTime video call
- make_audio_call: {"type":"make_audio_call","target":"+1234567890"} — FaceTime audio call
- answer_call: {"type":"answer_call"} — answer incoming call
- decline_call: {"type":"decline_call"} — decline incoming call
- end_call: {"type":"end_call"} — hang up current call

CALENDAR:
- create_event: {"type":"create_event","target":"Meeting with John","text":"April 1, 2026 2:00 PM","key":"April 1, 2026 3:00 PM"}
- list_events: {"type":"list_events","count":3} — get upcoming events (count = days ahead)

REMINDERS:
- create_reminder: {"type":"create_reminder","target":"Buy groceries","text":"April 2, 2026 5:00 PM"}
- list_reminders: {"type":"list_reminders"} — get pending reminders

NOTES:
- create_note: {"type":"create_note","target":"Meeting Notes","text":"Key points from today..."}
- read_notes: {"type":"read_notes","target":"meeting","count":3} — search and read notes

CONTACTS:
- find_contact: {"type":"find_contact","target":"John Smith"} — get phone + email from Contacts

WEATHER & STOCKS:
- get_weather: {"type":"get_weather","target":"New York"} — current weather
- get_stock: {"type":"get_stock","target":"AAPL"} — current stock price

SCREEN RECORDING:
- start_recording: {"type":"start_recording"} — start screen recording
- stop_recording: {"type":"stop_recording"} — stop and save recording

TERMINAL & SHORTCUTS:
- run_terminal: {"type":"run_terminal","text":"ls -la ~/Desktop"} — run shell command, get output
- run_shortcut: {"type":"run_shortcut","target":"My Shortcut Name"} — run Apple Shortcuts automation

EMAIL:
- send_email: {"type":"send_email","target":"john@email.com","key":"Meeting tomorrow","text":"Hi John, just confirming our meeting..."} — send via Apple Mail

TIMERS & ALARMS:
- set_timer: {"type":"set_timer","duration":300,"text":"Break time"} — timer in seconds, notifies when done
- set_alarm: {"type":"set_alarm","target":"April 2, 2026 7:00 AM","text":"Wake up"} — creates calendar alarm

NOW PLAYING:
- get_now_playing: {"type":"get_now_playing"} — what song is playing (Spotify or Apple Music)

CONTACTS:
- add_contact: {"type":"add_contact","target":"John Smith","text":"+1234567890","key":"john@email.com"} — add to Contacts

MAPS & NAVIGATION:
- get_directions: {"type":"get_directions","target":"New York to Boston"} — opens Google Maps directions
- find_nearby: {"type":"find_nearby","target":"restaurants near me"} — search nearby places on Google Maps

CURRENCY:
- convert_currency: {"type":"convert_currency","value":100,"target":"USD to EUR"} — live exchange rate

SCREENSHOT:
- screenshot_area: {"type":"screenshot_area"} — interactive area selection screenshot, saves to Desktop

=== CORE RULES ===
1. Websites → open_url (never open_app with browser name)
2. After every open_url → add wait 1500ms
3. Web searches → use URL params: open_url "https://site.com/search?q=TERM" (never find_and_click a search box)
4. find_and_click → ONLY when no shortcut/URL exists
5. Complete the FULL intent — "open X video" means search AND click the result

=== COMMON PATTERNS ===
URLs: gmail→mail.google.com, calendar→calendar.google.com, drive→drive.google.com, youtube search→youtube.com/results?search_query=X, google search→google.com/search?q=X, amazon→amazon.com/s?k=X, reddit search→reddit.com/search/?q=X, new doc→docs.google.com/document/create, new sheet→sheets.google.com/create, new slides→slides.google.com/create
Keys: close tab→Cmd+W, back→Cmd+[, refresh→Cmd+R, new tab→Cmd+T, bookmark→Cmd+D, incognito→Cmd+Shift+N, zoom in→Cmd+=, zoom out→Cmd+-, find→Cmd+F, copy→Cmd+C, paste→Cmd+V, undo→Cmd+Z, redo→Cmd+Shift+Z, select all→Cmd+A, save→Cmd+S, print→Cmd+P, screenshot→Cmd+Shift+3, screenshot area→Cmd+Shift+4, lock→Cmd+Ctrl+Q, spotlight→Cmd+Space, force quit→Cmd+Option+Escape, minimize→Cmd+M, fullscreen→Cmd+Ctrl+F, show desktop→Cmd+F3, switch app→Cmd+Tab, empty trash→Cmd+Shift+Delete
Media: play/pause→MediaPlayPause, next→MediaNextTrack, prev→MediaPreviousTrack, vol up→VolumeUp(x3), vol down→VolumeDown(x3), mute→Mute, bright up→BrightnessUp(x3), bright down→BrightnessDown(x3)
Spotify play: open_app Spotify→wait→Cmd+K→type X→wait→find_and_click first result→find_and_click play
YouTube play: open_url youtube search→wait→find_and_click first video
Slack DM: open_app Slack→wait→Cmd+K→type name→Enter→wait→type message→Enter
WhatsApp: open_url web.whatsapp.com→wait 3000→find_and_click search→type name→wait→find_and_click contact→type message→Enter
Files: downloads→file:///Users/${sysInfo.username || ''}/Downloads, documents→file:///Users/${sysInfo.username || ''}/Documents, desktop→file:///Users/${sysInfo.username || ''}/Desktop

=== INTENT ===
- "open/play/watch/go to" → navigate AND click the result
- "search/look up/find" → show results page only
- "send message to X saying Y" → open app, find contact, type, send
- "turn up/down" → repeat key 3x or use set_volume with percentage
- "copy text from X" → use read_screen or Cmd+A + Cmd+C + read_clipboard
- "save X to a file" → use create_file to write to Desktop
- "check if X" → use conditional with a screen check
- "do X 5 times" → use loop with count:5
- "call API" / "send request" → use http_request
- "right-click" / "context menu" → use right_click or find_and_right_click
- "drag X to Y" → use drag with coordinates
- "hover over X" → use move_mouse
- "open file X" → use find_and_double_click or open_url with file:// path
- "tell me" / "say" → use speak to talk back to user
- "remind me" / "notify me" → use notify to show macOS notification
- "put X and Y side by side" → use split_screen
- "switch to X" → use switch_window
- "remember X" → use remember to store, recall to retrieve
- "ask another agent to X" → use call_agent
- "what's my battery" → use get_battery
- "turn on/off dark mode" → use toggle_dark_mode
- "turn off wifi" → use toggle_wifi with on:false
- "set volume to 50" → use set_volume with value:50
- "go to sleep" → use sleep_computer
- When unsure, add more steps rather than too few
- "text/message X" → use send_imessage with phone number or email
- "call X" → use find_contact first to get number, then make_call
- "answer" / "pick up" → use answer_call
- "hang up" → use end_call
- "create event" / "schedule meeting" → use create_event
- "what's on my calendar" → use list_events
- "remind me to X" → use create_reminder
- "my reminders" → use list_reminders
- "make a note" → use create_note
- "what's the weather" → use get_weather
- "stock price of X" → use get_stock
- "record my screen" → use start_recording / stop_recording
- "run command X" → use run_terminal
- "run shortcut X" → use run_shortcut
- "email X saying Y" → use send_email
- "set a timer for X minutes" → use set_timer (convert to seconds)
- "set alarm for X" → use set_alarm
- "what song is playing" → use get_now_playing
- "add contact X" → use add_contact
- "directions to X" / "how to get to X" → use get_directions
- "find X near me" → use find_nearby
- "convert X USD to EUR" → use convert_currency
- "screenshot an area" → use screenshot_area
- After completing a task, use speak or notify to confirm to the user`,
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
      const analysis = await vision.analyzeScreen('What is currently on the screen?');
      console.log('[Vision]', analysis.description);
      break;
    }

    case 'double_click': {
      if (action.x != null && action.y != null) {
        overlay.moveOrb(action.x, action.y);
        await controller.sleep(300);
        overlay.clickOrb(action.x, action.y);
        await controller.doubleClick(action.x, action.y);
      } else if (action.target) {
        // Use vision to find element then double-click
        const pos = await vision.findElement(action.target);
        if (pos) {
          overlay.moveOrb(pos.x, pos.y);
          await controller.sleep(300);
          overlay.clickOrb(pos.x, pos.y);
          await controller.doubleClick(pos.x, pos.y);
        } else {
          throw new Error(`Could not find: ${action.target}`);
        }
      }
      break;
    }

    case 'right_click': {
      if (action.x != null && action.y != null) {
        overlay.moveOrb(action.x, action.y);
        await controller.sleep(300);
        await controller.rightClick(action.x, action.y);
      } else if (action.target) {
        const pos = await vision.findElement(action.target);
        if (pos) {
          overlay.moveOrb(pos.x, pos.y);
          await controller.sleep(300);
          await controller.rightClick(pos.x, pos.y);
        } else {
          throw new Error(`Could not find: ${action.target}`);
        }
      }
      break;
    }

    case 'move_mouse': {
      if (action.x != null && action.y != null) {
        overlay.moveOrb(action.x, action.y);
        await controller.moveMouse(action.x, action.y);
      } else if (action.target) {
        const pos = await vision.findElement(action.target);
        if (pos) {
          overlay.moveOrb(pos.x, pos.y);
          await controller.moveMouse(pos.x, pos.y);
        }
      }
      break;
    }

    case 'drag': {
      if (action.x != null && action.y != null && action.toX != null && action.toY != null) {
        overlay.moveOrb(action.x, action.y);
        await controller.sleep(200);
        await controller.drag(action.x, action.y, action.toX, action.toY);
        overlay.moveOrb(action.toX, action.toY);
      }
      break;
    }

    case 'read_screen': {
      const analysis = await vision.analyzeScreen(action.target || 'Describe everything visible on screen in detail. Read all text.');
      console.log('[ReadScreen]', analysis.description);
      // Store in conversation history so subsequent actions can use it
      addToHistory('system', 'Screen contents: ' + analysis.description);
      break;
    }

    case 'read_clipboard': {
      const content = controller.readClipboard();
      console.log('[Clipboard]', content.slice(0, 200));
      addToHistory('system', 'Clipboard contents: ' + content);
      break;
    }

    case 'write_clipboard': {
      controller.writeClipboard(action.text || '');
      break;
    }

    case 'create_file': {
      const filePath = action.target || '';
      const content = action.text || '';
      if (filePath) {
        controller.createFile(filePath, content);
        console.log('[File] Created:', filePath);
      }
      break;
    }

    case 'read_file': {
      const content = controller.readFile(action.target || '');
      console.log('[File] Read:', (action.target || '').slice(-40), '→', content.slice(0, 200));
      addToHistory('system', 'File contents of ' + action.target + ': ' + content.slice(0, 2000));
      break;
    }

    case 'move_file': {
      if (action.target && action.text) {
        controller.moveFile(action.target, action.text);
        console.log('[File] Moved:', action.target, '→', action.text);
      }
      break;
    }

    case 'delete_file': {
      if (action.target) {
        controller.deleteFile(action.target);
        console.log('[File] Deleted:', action.target);
      }
      break;
    }

    case 'http_request': {
      try {
        const result = await controller.httpRequest(
          action.target || '',
          action.method || 'GET',
          action.text,
          action.headers
        );
        console.log('[HTTP]', action.method || 'GET', action.target, '→', result.status);
        addToHistory('system', 'HTTP ' + (action.method || 'GET') + ' ' + action.target + ' → ' + result.status + ': ' + result.body.slice(0, 2000));
      } catch (e: any) {
        console.error('[HTTP] Error:', e.message);
        addToHistory('system', 'HTTP request failed: ' + e.message);
      }
      break;
    }

    case 'conditional': {
      // Take screenshot, analyze, decide if condition is met
      const analysis = await vision.analyzeScreen(action.condition || 'Is the action successful? Answer YES or NO.');
      const isTrue = analysis.description.toLowerCase().includes('yes');
      console.log('[Conditional]', action.condition, '→', isTrue ? 'TRUE' : 'FALSE');
      if (isTrue && action.actions) {
        for (const subAction of action.actions) {
          await executeAction(subAction, index);
          await controller.sleep(300);
        }
      }
      break;
    }

    case 'loop': {
      const count = action.count || 3;
      if (action.actions) {
        for (let i = 0; i < count; i++) {
          console.log('[Loop] Iteration', i + 1, '/', count);
          for (const subAction of action.actions) {
            await executeAction(subAction, index);
            await controller.sleep(300);
          }
        }
      }
      break;
    }

    // ── Notifications & Speech ──
    case 'notify': {
      controller.showNotification(action.target || 'ISIBI Ghost Mode', action.text || action.description);
      break;
    }

    case 'alert': {
      const result = controller.showAlert(action.target || 'ISIBI Ghost Mode', action.text || action.description);
      addToHistory('system', 'User clicked: ' + result);
      break;
    }

    case 'speak': {
      controller.speak(action.text || action.description);
      break;
    }

    // ── Window Management ──
    case 'list_windows': {
      const windows = controller.listWindows();
      const winStr = windows.map(w => `${w.app}: "${w.name}"`).join(', ');
      console.log('[Windows]', winStr);
      addToHistory('system', 'Open windows: ' + winStr);
      break;
    }

    case 'switch_window': {
      controller.switchWindow(action.target || '');
      break;
    }

    case 'resize_window': {
      controller.resizeWindow(action.width || 800, action.height || 600);
      break;
    }

    case 'move_window': {
      controller.moveWindow(action.x || 0, action.y || 0);
      break;
    }

    case 'split_screen': {
      controller.splitScreen(action.app1 || '', action.app2 || '');
      break;
    }

    // ── Advanced Input ──
    case 'hold_key': {
      const hKey = action.key || '';
      const hParts = hKey.split('+').map(k => k.trim().toLowerCase());
      // Use the keyMap from pressKeyCombo
      const mapped = hParts.map(p => {
        const km: Record<string, any> = { 'shift': controller.Key.LeftShift, 'cmd': controller.Key.LeftCmd, 'ctrl': controller.Key.LeftControl, 'alt': controller.Key.LeftAlt, 'option': controller.Key.LeftAlt };
        return km[p];
      }).filter(Boolean);
      if (mapped.length > 0) {
        await controller.holdKey(mapped[0], action.duration || 1000);
      }
      break;
    }

    case 'select_text': {
      if (action.x != null && action.y != null && action.toX != null && action.toY != null) {
        await controller.selectTextRange(action.x, action.y, action.toX, action.toY);
      }
      break;
    }

    case 'find_and_right_click': {
      const pos = await vision.findElement(action.target || '');
      if (pos) {
        overlay.moveOrb(pos.x, pos.y);
        await controller.sleep(300);
        await controller.rightClick(pos.x, pos.y);
      } else {
        throw new Error(`Could not find: ${action.target}`);
      }
      break;
    }

    case 'find_and_double_click': {
      const pos = await vision.findElement(action.target || '');
      if (pos) {
        overlay.moveOrb(pos.x, pos.y);
        await controller.sleep(300);
        overlay.clickOrb(pos.x, pos.y);
        await controller.doubleClick(pos.x, pos.y);
      } else {
        throw new Error(`Could not find: ${action.target}`);
      }
      break;
    }

    // ── System Control ──
    case 'set_volume': {
      controller.setVolume(action.value || 50);
      break;
    }

    case 'get_volume': {
      const vol = controller.getVolume();
      addToHistory('system', 'Current volume: ' + vol + '%');
      break;
    }

    case 'toggle_wifi': {
      controller.toggleWifi(action.on !== false);
      break;
    }

    case 'toggle_bluetooth': {
      controller.toggleBluetooth(action.on !== false);
      break;
    }

    case 'toggle_dark_mode': {
      controller.toggleDarkMode();
      break;
    }

    case 'sleep_computer': {
      controller.sleepComputer();
      break;
    }

    case 'empty_trash': {
      controller.emptyTrash();
      break;
    }

    case 'get_battery': {
      const batt = controller.getBattery();
      const battStr = batt.percent >= 0 ? batt.percent + '% ' + (batt.charging ? '(charging)' : '(on battery)') : 'unknown';
      addToHistory('system', 'Battery: ' + battStr);
      controller.showNotification('Battery', battStr);
      break;
    }

    // ── Data & Memory ──
    case 'remember': {
      if (action.memoryKey && action.text) {
        agentMemory[action.memoryKey] = action.text;
        console.log('[Memory] Stored:', action.memoryKey, '=', action.text.slice(0, 100));
      }
      break;
    }

    case 'recall': {
      if (action.memoryKey) {
        const val = agentMemory[action.memoryKey] || '';
        addToHistory('system', 'Recalled ' + action.memoryKey + ': ' + val);
        console.log('[Memory] Recalled:', action.memoryKey, '=', val.slice(0, 100));
      }
      break;
    }

    case 'ask_user': {
      // Show notification asking the user to check the chat
      controller.showNotification('ISIBI needs your input', action.text || 'Please check the ISIBI chat');
      addToHistory('system', 'Asked user: ' + (action.text || action.description));
      // Pause to give user time to respond
      await controller.sleep(action.duration || 5000);
      break;
    }

    // ── Multi-Agent ──
    case 'call_agent': {
      // Dispatch a command to another agent by name
      const targetAgent = (await import('./agents')).getAgents().find((a: any) =>
        a.name.toLowerCase() === (action.target || '').toLowerCase() && a.isActive
      );
      if (targetAgent) {
        console.log('[MultiAgent] Calling agent:', targetAgent.name, 'with:', action.text);
        const { dispatchCommand } = await import('./agent-manager');
        await dispatchCommand(targetAgent.id, action.text || '', index);
      } else {
        console.log('[MultiAgent] Agent not found:', action.target);
      }
      break;
    }

    case 'pass_data': {
      // Store data that can be picked up by another agent
      if (action.memoryKey && action.text) {
        agentMemory['shared_' + action.memoryKey] = action.text;
        console.log('[MultiAgent] Shared data:', action.memoryKey);
      }
      break;
    }

    // ── Messaging ──
    case 'send_imessage': {
      controller.sendIMessage(action.target || '', action.text || '');
      controller.showNotification('iMessage sent', `To: ${action.target}`);
      break;
    }

    case 'read_imessages': {
      const msgs = controller.readIMessages(action.target || '', action.count || 5);
      addToHistory('system', `Recent messages from ${action.target}: ${msgs.join(' | ')}`);
      break;
    }

    // ── Calls ──
    case 'make_call': {
      controller.makeFaceTimeCall(action.target || '', false);
      break;
    }

    case 'make_audio_call': {
      controller.makeFaceTimeCall(action.target || '', true);
      break;
    }

    case 'answer_call': {
      controller.answerCall();
      break;
    }

    case 'decline_call': {
      controller.declineCall();
      break;
    }

    case 'end_call': {
      controller.endCall();
      break;
    }

    // ── Calendar ──
    case 'create_event': {
      controller.createCalendarEvent(
        action.target || 'New Event',
        action.text || new Date().toString(),
        action.key || new Date(Date.now() + 3600000).toString()
      );
      controller.showNotification('Event created', action.target || 'New Event');
      break;
    }

    case 'list_events': {
      const events = controller.listCalendarEvents(action.count || 1);
      const evtStr = events.length > 0 ? events.join('\n') : 'No upcoming events';
      addToHistory('system', 'Calendar events: ' + evtStr);
      controller.showNotification('Calendar', events.length + ' upcoming events');
      break;
    }

    // ── Reminders ──
    case 'create_reminder': {
      controller.createReminder(action.target || 'Reminder', action.text);
      controller.showNotification('Reminder created', action.target || '');
      break;
    }

    case 'list_reminders': {
      const reminders = controller.listReminders();
      addToHistory('system', 'Reminders: ' + (reminders.length > 0 ? reminders.join(', ') : 'None'));
      break;
    }

    // ── Notes ──
    case 'create_note': {
      controller.createNote(action.target || 'Untitled', action.text || '');
      controller.showNotification('Note created', action.target || '');
      break;
    }

    case 'read_notes': {
      const notes = controller.readNotes(action.target || '', action.count || 5);
      addToHistory('system', 'Notes: ' + (notes.length > 0 ? notes.join('\n---\n') : 'None found'));
      break;
    }

    // ── Contacts ──
    case 'find_contact': {
      const contact = controller.findContact(action.target || '');
      if (contact) {
        addToHistory('system', `Contact: ${contact.name}, Phone: ${contact.phone}, Email: ${contact.email}`);
      } else {
        addToHistory('system', 'Contact not found: ' + action.target);
      }
      break;
    }

    // ── Weather ──
    case 'get_weather': {
      const weather = await controller.getWeather(action.target || 'auto');
      addToHistory('system', 'Weather: ' + weather);
      controller.showNotification('Weather', weather);
      break;
    }

    // ── Stock ──
    case 'get_stock': {
      const price = await controller.getStockPrice(action.target || '');
      addToHistory('system', 'Stock: ' + price);
      controller.showNotification('Stock', price);
      break;
    }

    // ── Screen Recording ──
    case 'start_recording': {
      controller.startScreenRecording(action.target);
      controller.showNotification('Recording', 'Screen recording started');
      break;
    }

    case 'stop_recording': {
      controller.stopScreenRecording();
      controller.showNotification('Recording', 'Screen recording saved');
      break;
    }

    // ── Terminal & Shortcuts ──
    case 'run_terminal': {
      const output = controller.runTerminalCommand(action.text || '');
      addToHistory('system', 'Terminal output: ' + output.slice(0, 2000));
      break;
    }

    case 'run_shortcut': {
      const output = controller.runShortcut(action.target || '', action.text);
      addToHistory('system', 'Shortcut result: ' + output.slice(0, 2000));
      break;
    }

    // ── Email ──
    case 'send_email': {
      const subject = action.key || 'No subject';
      controller.sendEmail(action.target || '', subject, action.text || '');
      controller.showNotification('Email sent', `To: ${action.target}`);
      break;
    }

    // ── Timers & Alarms ──
    case 'set_timer': {
      controller.setTimer(action.duration || 60, action.text || action.target);
      controller.showNotification('Timer set', `${action.duration || 60}s — ${action.text || 'Timer'}`);
      break;
    }

    case 'set_alarm': {
      controller.setAlarm(action.target || '', action.text);
      controller.showNotification('Alarm set', action.target || '');
      break;
    }

    // ── Now Playing ──
    case 'get_now_playing': {
      const np = controller.getNowPlaying();
      const npStr = np.track !== 'Nothing playing' ? `${np.track} by ${np.artist} (${np.app})` : 'Nothing playing';
      addToHistory('system', 'Now playing: ' + npStr);
      controller.showNotification('Now Playing', npStr);
      break;
    }

    // ── Contacts ──
    case 'add_contact': {
      controller.addContact(action.target || '', action.text, action.key);
      controller.showNotification('Contact added', action.target || '');
      break;
    }

    // ── Maps ──
    case 'get_directions': {
      const parts = (action.target || '').split(' to ');
      const from = parts.length > 1 ? parts[0] : 'current location';
      const to = parts.length > 1 ? parts[1] : parts[0];
      controller.getDirections(from, to);
      break;
    }

    case 'find_nearby': {
      controller.findNearby(action.target || '');
      break;
    }

    // ── Currency ──
    case 'convert_currency': {
      const amt = action.value || 1;
      const parts2 = (action.target || 'USD to EUR').split(' to ');
      const fromCur = parts2[0]?.trim().toUpperCase() || 'USD';
      const toCur = parts2[1]?.trim().toUpperCase() || 'EUR';
      const result = await controller.convertCurrency(amt, fromCur, toCur);
      addToHistory('system', 'Currency: ' + result);
      controller.showNotification('Currency', result);
      break;
    }

    // ── Screenshot Area ──
    case 'screenshot_area': {
      controller.screenshotArea(action.target);
      controller.showNotification('Screenshot', 'Area captured');
      break;
    }

    default: {
      console.log('[Action] Unknown action type:', action.type);
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
    'f1': controller.Key.F1, 'f2': controller.Key.F2, 'f3': controller.Key.F3,
    'f4': controller.Key.F4, 'f5': controller.Key.F5, 'f6': controller.Key.F6,
    'f7': controller.Key.F7, 'f8': controller.Key.F8, 'f9': controller.Key.F9,
    'f10': controller.Key.F10, 'f11': controller.Key.F11, 'f12': controller.Key.F12,
    '0': controller.Key.Num0, '1': controller.Key.Num1, '2': controller.Key.Num2,
    '3': controller.Key.Num3, '4': controller.Key.Num4, '5': controller.Key.Num5,
    '6': controller.Key.Num6, '7': controller.Key.Num7, '8': controller.Key.Num8,
    '9': controller.Key.Num9,
    'home': controller.Key.Home, 'end': controller.Key.End,
    'pageup': controller.Key.PageUp, 'pagedown': controller.Key.PageDown,
    '=': controller.Key.Equal, '-': controller.Key.Minus,
    '[': controller.Key.LeftBracket, ']': controller.Key.RightBracket,
    'super': controller.Key.LeftSuper,
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
