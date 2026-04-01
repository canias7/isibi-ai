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

import { getApiKey, useCredits, trackAgentUsage, getCredits } from './config';
import { AgentProfile } from './agents';
import { trackAction, trackCommand } from './analytics';
import * as path from 'path';
import * as os from 'os';

const MODEL = 'claude-sonnet-4-20250514';

// Agent memory — persists to disk across sessions
const agentMemory: Record<string, string> = {};

function getMemoryPath(): string {
  const { app } = require('electron');
  const memDir = require('path').join(app.getPath('userData'), 'memory');
  if (!require('fs').existsSync(memDir)) require('fs').mkdirSync(memDir, { recursive: true });
  return memDir;
}

function loadAgentMemory(agentId?: string): void {
  try {
    const memFile = require('path').join(getMemoryPath(), (agentId || 'global') + '.json');
    if (require('fs').existsSync(memFile)) {
      const data = JSON.parse(require('fs').readFileSync(memFile, 'utf-8'));
      Object.assign(agentMemory, data);
      console.log('[Memory] Loaded', Object.keys(data).length, 'keys for', agentId || 'global');
    }
  } catch {}
}

function saveAgentMemory(agentId?: string): void {
  try {
    const memFile = require('path').join(getMemoryPath(), (agentId || 'global') + '.json');
    require('fs').writeFileSync(memFile, JSON.stringify(agentMemory, null, 2));
  } catch {}
}

// App knowledge packs — only injected when relevant to the agent's task
const APP_KNOWLEDGE: Record<string, string> = {
  excel: 'SPREADSHEET (Excel/Sheets/Numbers): Nav:Tab=next cell,Enter=next row,Cmd+Arrow=jump. Edit:F2=edit,Cmd+;=date,Cmd+D=fill down. Format:Cmd+B=bold,Cmd+1=format dialog. Rows:Cmd+Shift+=insert,Cmd+-=delete. Tables:Cmd+T=create. Formulas:=SUM(),=AVERAGE(),=VLOOKUP(),=IF(),=INDEX(MATCH()),=COUNTIF(),=SUMIF(). Build:open app→type headers in row 1→Tab between cols→Enter for rows→add formulas→Cmd+B headers→Cmd+S save.',
  word: 'WORD (Word/Pages/Docs): Nav:Cmd+Home/End,Cmd+F=find,Cmd+H=replace. Format:Cmd+B/I/U,Cmd+Shift+>/<,Cmd+E=center,Cmd+L/R/J. Headings:Cmd+Alt+1/2/3. Insert:Cmd+K=link,Cmd+Shift+Enter=page break. Track:Cmd+Shift+E. Save:Cmd+S,File→Export PDF.',
  powerpoint: 'PRESENTATION (PowerPoint/Keynote): Nav:arrows between slides,Enter=edit. New:Cmd+M. Objects:Cmd+D=dup,Cmd+G=group. Show:F5(PPT)/Cmd+Shift+Return(Keynote),N/P=next/prev,B=black,Esc=exit.',
  photoshop: 'PHOTOSHOP: Tools:V=move,M=marquee,L=lasso,W=wand,C=crop,B=brush,E=eraser,T=text,P=pen,Z=zoom. Layers:Cmd+Shift+N=new,Cmd+J=dup,Cmd+E=merge. Select:Cmd+A=all,Cmd+D=deselect. Transform:Cmd+T. Save:Cmd+S,Cmd+Alt+Shift+S=web.',
  figma: 'FIGMA: Tools:V=select,F=frame,R=rect,O=ellipse,T=text,I=picker. Layout:Shift+A=auto. Components:Cmd+Alt+K=create. Layers:Cmd+G=group,Cmd+]/[=order. Zoom:Cmd+0=fit,Cmd+1=100%. Export:right panel.',
  canva: 'CANVA: T=text,Cmd+D=dup,Cmd+G=group. Templates in sidebar. Elements in sidebar. Export:Share→Download.',
  imovie: 'IMOVIE/FINALCUT: Space=play/pause,Cmd+B=split,+=add to timeline. Effects:clip toolbar. Export:Share→File.',
  vscode: 'VS CODE: Cmd+Shift+P=command palette,Cmd+P=open file,Cmd+backtick=terminal,Cmd+D=select next,Cmd+Shift+K=delete line,Cmd+Shift+F=search all,F5=debug,Cmd+Shift+G=git,Cmd+Shift+X=extensions.',
  terminal: 'TERMINAL: cd,ls,pwd,cp,mv,rm,mkdir,touch,cat,grep,find,|=pipe,>=redirect,chmod,curl,ssh. Brew:brew install. Node:npm install/start/build. Python:pip install,python3.',
  xcode: 'XCODE: Cmd+B=build,Cmd+R=run,Cmd+.=stop,Cmd+U=test,Cmd+Shift+O=open,Cmd+Y=breakpoints. Simulator:Cmd+Shift+H=home.',
  slack: 'SLACK: Cmd+K=switch channel/DM,Cmd+Shift+K=DM,Cmd+Shift+A=unreads,Cmd+U=upload. Format:*bold*,_italic_. Huddle:phone icon.',
  discord: 'DISCORD: Cmd+K=switch,Alt+Up/Down=channels. Voice:click channel,M=mute,D=deafen.',
  zoom: 'ZOOM: Cmd+Shift+A=mute,Cmd+Shift+V=video,Cmd+Shift+S=share screen,Cmd+Shift+H=chat,Cmd+Shift+W=view.',
  teams: 'TEAMS: Cmd+1-5=sections,Cmd+N=new chat,Cmd+Shift+M=mic,Cmd+Shift+O=camera,Cmd+Shift+B=blur.',
  chrome: 'CHROME: Cmd+T=new tab,Cmd+W=close,Cmd+Shift+T=reopen,Cmd+L=url,Cmd+R=reload. DevTools:Cmd+Option+I. Cmd+F=find. Cmd+D=bookmark.',
  safari: 'SAFARI: Cmd+T/W=tabs,Cmd+L=url,Cmd+R=reload,Cmd+[/]=back/fwd,Cmd+Shift+R=reader,Cmd+Shift+N=private.',
  arc: 'ARC: Cmd+T=command bar,Cmd+Option+Left/Right=spaces,Cmd+Shift+D=pin tab.',
  notion: 'NOTION: /=command menu,Cmd+B/I,Cmd+E=code,Cmd+K=link,Cmd+P=search. DB:/database. Pages:Cmd+N=new.',
  obsidian: 'OBSIDIAN: Cmd+O=open,Cmd+P=palette,Cmd+B/I/K. Links:[[page]],![[embed]]. Graph:sidebar.',
  trello: 'TRELLO: N=new card,Q=my cards,F=filter,/=search,Space=assign,L=labels,D=due date.',
  spotify: 'SPOTIFY: Cmd+K=search,Space=play/pause,Cmd+Right/Left=next/prev,Cmd+N=playlist.',
  logic: 'LOGIC/GARAGEBAND: R=record,Space=play/stop,Cmd+T=split,X=mixer,Cmd+6=piano roll. Export:File→Bounce.',
  quickbooks: 'QUICKBOOKS: Click-based. Dashboard overview. +New→Invoice/Expense. Reports tab. Banking tab.',
  stripe: 'STRIPE: open dashboard.stripe.com. Payments/Customers/Billing/Developers tabs.',
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getApiKey() });
  }
  return client;
}

// Rate limiter — max 10 API calls per minute
const apiCallTimes: number[] = [];
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(): boolean {
  const now = Date.now();
  // Remove calls older than window
  while (apiCallTimes.length > 0 && apiCallTimes[0] < now - RATE_WINDOW) apiCallTimes.shift();
  if (apiCallTimes.length >= RATE_LIMIT) {
    console.log('[RateLimit] Too many API calls. Wait before trying again.');
    return false;
  }
  apiCallTimes.push(now);
  return true;
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
  // Track command and load persistent memory
  trackCommand();
  loadAgentMemory(agent?.id);

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

  // Rate limit check
  if (!checkRateLimit()) {
    return { taskId, command, actions: [{ type: 'notify', target: 'Rate Limited', text: 'Too many requests. Please wait a moment.', description: 'Rate limited' }], status: 'pending', currentStep: 0 };
  }

  // Credit check — 5 credits per command (planning API call)
  const creditCheck = getCredits();
  if (creditCheck.remaining < 5) {
    return { taskId, command, actions: [{ type: 'notify', target: 'Out of Credits', text: 'You have ' + creditCheck.remaining + ' credits remaining. Upgrade your plan for more.', description: 'No credits' }], status: 'pending', currentStep: 0 };
  }
  useCredits(5, agent?.id); // 5 credits for planning
  if (agent) trackAgentUsage(agent.id, 1, 0);

  // Build context from system index
  const appNames = index.apps.slice(0, 30).map(a => a.name).join(', ');
  const recentFiles = index.recentFiles.slice(0, 10).map(f => f.name).join(', ');
  const runningApps = (index.runningProcesses || []).slice(0, 20).map(p => p.name).join(', ');
  const openTabs = (index.browserTabs || []).slice(0, 10).map(t => `"${t.title}" (${t.url})`).join(', ');
  const desktopItems = (index.desktopFiles || []).slice(0, 20).join(', ');
  const sysInfo = index.systemInfo || {} as any;

  // Smart knowledge pack injection — only include relevant app knowledge
  function getRelevantKnowledge(command: string, agentInstructions: string): string {
    const context = (command + ' ' + agentInstructions).toLowerCase();
    const packs: string[] = [];
    for (const [key, value] of Object.entries(APP_KNOWLEDGE)) {
      const triggers: Record<string, string[]> = {
        excel: ['excel', 'spreadsheet', 'sheets', 'numbers', 'csv', 'formula', 'vlookup', 'pivot'],
        word: ['word', 'document', 'pages', 'docs', 'writing', 'report', 'letter'],
        powerpoint: ['powerpoint', 'keynote', 'slides', 'presentation', 'deck'],
        photoshop: ['photoshop', 'photo edit', 'image edit', 'layers', 'retouching'],
        figma: ['figma', 'design', 'ui design', 'prototype', 'wireframe'],
        canva: ['canva', 'graphic', 'poster', 'flyer', 'social media design'],
        vscode: ['vscode', 'vs code', 'code editor', 'coding', 'programming'],
        terminal: ['terminal', 'command line', 'shell', 'bash', 'cli'],
        xcode: ['xcode', 'ios', 'swift', 'iphone app'],
        slack: ['slack', 'slack message', 'slack channel'],
        discord: ['discord', 'discord server'],
        zoom: ['zoom', 'zoom meeting', 'zoom call'],
        teams: ['teams', 'microsoft teams'],
        chrome: ['chrome', 'devtools', 'browser debug'],
        safari: ['safari'],
        notion: ['notion', 'notion page', 'notion database'],
        obsidian: ['obsidian', 'knowledge base', 'zettelkasten'],
        spotify: ['spotify', 'music', 'playlist', 'song'],
        logic: ['logic pro', 'garageband', 'music production', 'recording studio'],
      };
      const keys = triggers[key] || [key];
      if (keys.some(k => context.includes(k))) packs.push(value);
    }
    return packs.length > 0 ? '\n\nAPP KNOWLEDGE:\n' + packs.join('\n') : '';
  }

  const appKnowledge = getRelevantKnowledge(command, agent?.instructions || '');

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

SOCIAL MEDIA:
- post_tweet: {"type":"post_tweet","text":"Just shipped a new feature!"} — opens Twitter/X compose
- check_notifications: {"type":"check_notifications"} — read macOS notification center

PRODUCTIVITY:
- translate_text: {"type":"translate_text","text":"Hello world","target":"es"} — translate to any language (es, fr, de, ja, etc.)
- create_spreadsheet: {"type":"create_spreadsheet","target":"/Users/X/Desktop/data.csv","text":"Name,Email,Phone"} — create CSV
- add_to_spreadsheet: {"type":"add_to_spreadsheet","target":"/Users/X/Desktop/data.csv","text":"John,john@email.com,555-1234"} — add row

DEVELOPER:
- git_command: {"type":"git_command","text":"status","target":"/path/to/repo"} — run any git command
- run_python: {"type":"run_python","text":"print(2+2)"} — execute Python code
- run_node: {"type":"run_node","text":"console.log(2+2)"} — execute Node.js code
- open_vscode: {"type":"open_vscode","target":"/path/to/project"} — open in VS Code

SMART HOME:
- control_homekit: {"type":"control_homekit","target":"Living Room Light","text":"toggle"} — control HomeKit devices
- play_airplay: {"type":"play_airplay","target":"Living Room Speaker"} — AirPlay audio

AI-POWERED:
- analyze_image: {"type":"analyze_image","target":"/path/to/image.jpg","text":"What's in this image?"} — Claude Vision analysis
- generate_text: {"type":"generate_text","text":"Write a haiku about coding"} — ask Claude to generate text
- summarize_page: {"type":"summarize_page","target":"https://example.com"} — fetch and summarize a webpage

ZOOM:
- create_zoom: {"type":"create_zoom"} — start a new Zoom meeting
- join_zoom: {"type":"join_zoom","target":"123456789"} — join by ID

PDF & DOCUMENTS:
- create_pdf: {"type":"create_pdf","text":"Report content here","target":"/path/out.pdf"}
- read_pdf: {"type":"read_pdf","target":"/path/file.pdf"} — extract text
- merge_pdfs: {"type":"merge_pdfs","text":"/path/a.pdf,/path/b.pdf","target":"/path/merged.pdf"}
- print_document: {"type":"print_document","target":"/path/file.pdf"} — send to printer

IMAGE EDITING:
- resize_image: {"type":"resize_image","target":"/path/img.jpg","width":800,"height":600}
- crop_image: {"type":"crop_image","target":"/path/img.jpg","x":0,"y":0,"width":500,"height":500}
- convert_image: {"type":"convert_image","target":"/path/img.png","text":"jpeg"} — change format
- compress_image: {"type":"compress_image","target":"/path/img.jpg","value":50} — quality 0-100

AUDIO:
- record_audio: {"type":"record_audio","duration":10} — record mic for N seconds
- play_audio: {"type":"play_audio","target":"/path/audio.mp3"} — play audio file
- text_to_audio: {"type":"text_to_audio","text":"Hello world","target":"/path/out.aiff"} — save speech to file

CLIPBOARD INTELLIGENCE:
- copy_from_app: {"type":"copy_from_app","target":"Safari"} — switch to app, select all, copy, return text
- paste_into_app: {"type":"paste_into_app","target":"Notes","text":"content to paste"}

SYSTEM DEEP:
- list_running_apps: {"type":"list_running_apps"} — all running apps
- kill_app: {"type":"kill_app","target":"Safari"} — force quit app
- get_disk_space: {"type":"get_disk_space"} — check storage
- get_cpu_usage: {"type":"get_cpu_usage"} — CPU and memory usage
- change_wallpaper: {"type":"change_wallpaper","target":"/path/to/image.jpg"}
- toggle_dnd: {"type":"toggle_dnd"} — toggle Do Not Disturb / Focus

NETWORK:
- get_ip: {"type":"get_ip"} — local + public IP
- ping: {"type":"ping","target":"google.com","count":3}
- check_internet: {"type":"check_internet"} — test connectivity
- download_file: {"type":"download_file","target":"https://example.com/file.zip","text":"/path/save.zip"}

QR CODES:
- generate_qr: {"type":"generate_qr","text":"https://isibi.ai","target":"/path/qr.png"}

TEXT PROCESSING:
- regex_extract: {"type":"regex_extract","text":"Call 555-1234 or 555-5678","target":"\\\\d{3}-\\\\d{4}"}
- json_parse: {"type":"json_parse","text":"{\\\"name\\\":\\\"John\\\"}","target":"name"} — extract field
- count_words: {"type":"count_words","text":"Hello world"} — word/char/line count
- diff_text: {"type":"diff_text","text":"old text","target":"new text"} — compare two texts

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
- "text/message X saying Y" → ALWAYS use find_contact FIRST to get their phone number, then send_imessage with that number. Example: [{"type":"find_contact","target":"Chris"},{"type":"send_imessage","target":"PHONE_FROM_CONTACT","text":"hello"}]. If user gives a phone number directly, skip find_contact.
- "call X" → ALWAYS use find_contact first to get number, then make_call. Example: [{"type":"find_contact","target":"Chris"},{"type":"make_call","target":"PHONE_FROM_CONTACT"}]
- "answer" / "pick up" → use answer_call (just answers) or ai_answer_call (AI has the conversation)
- "answer and talk for me" / "handle this call" → use ai_answer_call with the agent's custom prompt
- "monitor calls" / "answer all calls" → use ai_monitor_calls
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
- "tweet X" / "post on twitter" → use post_tweet
- "translate X to Spanish" → use translate_text with target "es"
- "create a spreadsheet" → use create_spreadsheet
- "run git status" → use git_command
- "run python code" → use run_python
- "open in VS Code" → use open_vscode
- "analyze this image" → use analyze_image
- "write me X" / "generate X" → use generate_text
- "summarize this website" → use summarize_page
- "start a Zoom call" → use create_zoom
- "join Zoom X" → use join_zoom
- "check my notifications" → use check_notifications
- "turn on the lights" → use control_homekit
- "create a PDF" → use create_pdf
- "read this PDF" → use read_pdf
- "print this" → use print_document
- "resize/crop/convert image" → use resize_image/crop_image/convert_image
- "record audio" → use record_audio
- "copy text from Safari" → use copy_from_app
- "paste into Notes" → use paste_into_app
- "what apps are running" → use list_running_apps
- "quit/close Safari" → use kill_app
- "how much storage" → use get_disk_space
- "CPU usage" → use get_cpu_usage
- "change wallpaper" → use change_wallpaper
- "do not disturb" → use toggle_dnd
- "what's my IP" → use get_ip
- "ping google" → use ping
- "am I online" → use check_internet
- "download this file" → use download_file
- "generate QR code" → use generate_qr
- "extract emails from text" → use regex_extract
- "count words" → use count_words
- "compare these texts" → use diff_text
- "generate password" → use generate_password
- "calculate X" → use calculate
- "convert X to Y" → use unit_convert
- "what time in Tokyo" → use get_time or world_clock
- "how long until X" → use time_until
- "what tab am I on" → use get_page_title / get_page_url
- "list all tabs" → use get_all_tabs
- "zip these files" → use zip_files
- "unzip this" → use unzip_file
- "query database" → use sqlite_query
- "encode/decode" → use base64_encode/decode or url_encode/decode
- "hash this" → use hash_text
- "random number" → use random_number
- "flip a coin" → use coin_flip
- "roll dice" → use dice_roll
- After completing a task, use speak or notify to confirm to the user
${appKnowledge}

EXTRA ACTIONS:
Passwords: generate_password (value=length), check_password_strength, open_keychain
Math: calculate (text=expression), unit_convert (value=amount, target="km to mi"), percentage (value=amount, text=percent)
DateTime: get_time (target=timezone), time_until (target=date), date_diff (text=date1, target=date2), world_clock (text="NYC,London,Tokyo")
ClipboardHistory: clipboard_history, clipboard_search (text=query)
Automation: watch_folder (target=path)
Browser: get_page_title, get_page_url, save_page, get_all_tabs, clear_browser_cache
Compression: zip_files (text=paths comma-separated, target=output.zip), unzip_file (target=zip, text=outdir), tar_files
Database: sqlite_query (target=db, text=SQL), csv_query (target=file, text=filter)
Encoding: base64_encode/decode (text), url_encode/decode (text), hash_text (text, target=sha256|md5)
Fun: random_number (x=min, y=max), coin_flip, dice_roll (value=sides, count=N), lorem_ipsum (count=paragraphs)

DATA EXTRACTION:
- extract_emails/extract_phone_numbers/extract_urls: {"type":"extract_emails","text":"contact john@email.com or 555-1234"}
- extract_table: {"type":"extract_table","target":"https://example.com"} — extract HTML table to CSV
- scrape_webpage: {"type":"scrape_webpage","target":"https://example.com","text":"extract all product names and prices"}

DOCUMENT AUTOMATION:
- batch_rename: {"type":"batch_rename","target":"/folder","text":"pattern","key":"replacement"}
- find_replace_in_files: {"type":"find_replace_in_files","target":"/folder","text":"search","key":"replace"}

WORKFLOW:
- wait_for_download: {"type":"wait_for_download","target":"/path/file","duration":30000}
- get_latest_download / move_latest_download: {"type":"move_latest_download","target":"/dest/folder"}
- wait_for_element: {"type":"wait_for_element","target":"Submit button","duration":10000} — wait until UI element appears

DATA PROCESSING:
- sort_data: {"type":"sort_data","text":"csv data","value":0} — sort by column
- filter_data: {"type":"filter_data","text":"csv data","target":"keyword"}
- deduplicate: {"type":"deduplicate","text":"line1\\nline2\\nline1"} — remove duplicates
- merge_csvs: {"type":"merge_csvs","text":"/path/a.csv,/path/b.csv","target":"/out.csv"}

INTEGRATION:
- webhook_send: {"type":"webhook_send","target":"https://hook.url","text":"{\\"key\\":\\"value\\"}"}
- google_sheets_read: {"type":"google_sheets_read","target":"https://docs.google.com/spreadsheets/d/..."}

FILE UTILITIES:
- list_folder/search_files/get_file_info/rename_file/duplicate_file/trash_file/reveal_in_finder/open_with

AI SMART ACTIONS (most powerful — uses screen vision):
- ai_decide: {"type":"ai_decide","text":"what should I do to complete the checkout?"} — AI looks at screen, decides next action
- ai_extract: {"type":"ai_extract","text":"extract all prices from screen"} — AI reads screen, extracts data
- ai_fill: {"type":"ai_fill"} — AI identifies form fields and fills them
- ai_navigate: {"type":"ai_navigate","target":"Settings > Privacy > Microphone"} — AI figures out how to get there

AUTOMATION CHAINS:
- if_else: {"type":"if_else","condition":"Is there an error?","actions":[retry],"text":"[fallback actions]"}
- try_catch: {"type":"try_catch","actions":[main],"text":"[fallback actions if main fails]"}
- while_loop: {"type":"while_loop","condition":"Is download complete?","actions":[wait],"count":10}
- parallel: {"type":"parallel","actions":[action1, action2]} — run simultaneously
- pipe: {"type":"pipe","actions":[step1, step2, step3]} — sequential with shared context

EMAIL MANAGEMENT:
- read_email: {"type":"read_email","count":5} — read recent inbox
- search_email: {"type":"search_email","target":"invoice"} — search by subject/sender
- create_email_draft: {"type":"create_email_draft","target":"john@email.com","key":"Subject","text":"Body"}

DISPLAY:
- set_brightness: {"type":"set_brightness","value":75} — set brightness 0-100
- toggle_night_shift: {"type":"toggle_night_shift"}
- get_screen_resolution: {"type":"get_screen_resolution"}

PRINTING:
- list_printers: {"type":"list_printers"}
- print_text: {"type":"print_text","text":"content to print"}
- print_image: {"type":"print_image","target":"/path/image.jpg"}

USER INTERACTION:
- input_prompt: {"type":"input_prompt","target":"Title","text":"What's your name?"} — shows dialog, gets text response
- choice_prompt: {"type":"choice_prompt","target":"Pick one","text":"Option A,Option B,Option C"} — shows choices

APP-SPECIFIC:
- keynote_new/numbers_new/pages_new — create new iWork documents
- preview_open: {"type":"preview_open","target":"/path/file"} — open in Preview
- xcode_build: {"type":"xcode_build","target":"/path/to/project"} — build Xcode project

TEXT MANIPULATION:
- text_replace: {"type":"text_replace","text":"hello world","target":"hello","key":"hi"}
- text_case: {"type":"text_case","text":"hello","target":"upper|lower|title|camel|snake|kebab"}
- text_trim/text_reverse/text_split

ACCESSIBILITY:
- read_aloud: {"type":"read_aloud","text":"Hello","target":"Samantha"} — read with system voice
- increase_text_size/decrease_text_size — zoom text system-wide

MULTI-STEP WORKFLOWS (most powerful):
- complete_task: {"type":"complete_task","text":"book a flight to NYC next Friday"} — AI breaks down complex goal into steps and executes them ALL
- research_topic: {"type":"research_topic","target":"quantum computing"} — searches, reads results, compiles summary
- monitor_and_alert: {"type":"monitor_and_alert","text":"price drops below $50","duration":5000,"count":60} — watches screen periodically, alerts when condition met
- fill_application: {"type":"fill_application","text":"Name: John Smith, Email: john@email.com, Phone: 555-1234"} — AI reads form and fills it

CROSS-APP DATA FLOW:
- copy_between_apps: {"type":"copy_between_apps","target":"Safari to Notes"} — copy data between apps
- screen_to_spreadsheet: {"type":"screen_to_spreadsheet","target":"/path/out.csv"} — read screen data into CSV
- screen_to_email: {"type":"screen_to_email"} — read screen, prepare email content
- screen_to_note: {"type":"screen_to_note"} — capture screen content as Apple Note
- compare_screens: {"type":"compare_screens","duration":5000} — take two screenshots, report what changed

CONTEXT-AWARE:
- understand_context: {"type":"understand_context"} — AI analyzes what you're doing and suggests next steps
- auto_complete_task: {"type":"auto_complete_task"} — AI sees your unfinished work and completes it
- smart_reply: {"type":"smart_reply","text":"professional tone"} — reads message on screen, types a reply

BUSINESS:
- invoice_create: {"type":"invoice_create","target":"My Company to Client","text":"Web Design,1,500;Hosting,12,10"}
- expense_track: {"type":"expense_track","target":"/path/receipt.jpg"} — read receipt, log to expenses.csv
- report_generate: {"type":"report_generate","text":"Q1 sales performance"} — generate full HTML report

ERROR RECOVERY:
- retry_with_fix: {"type":"retry_with_fix","actions":[...]} — try actions, if fail AI fixes and retries
- verify_result: {"type":"verify_result","text":"was the email sent?"} — AI checks if task worked
- undo_last: {"type":"undo_last"} — Cmd+Z
- rollback: {"type":"rollback","count":5} — multiple undos

AI CALL HANDLER:
- ai_answer_call: {"type":"ai_answer_call","text":"You are my assistant. Take messages. Tell callers I'm busy.","key":"Hello, this is an AI assistant. How can I help?","count":20} — answer call, AI has full conversation, saves transcript
- ai_monitor_calls: {"type":"ai_monitor_calls","text":"Take messages politely","duration":3000} — monitor screen for incoming calls, auto-answer with AI`,
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

        const actionStart = Date.now();
        try {
          useCredits(1); // 1 credit per action
          await executeAction(action, index);
          trackAction(action.type, true, Date.now() - actionStart);
        } catch (actionErr: any) {
          trackAction(action.type, false, Date.now() - actionStart);
          throw actionErr;
        }

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
      // Send error to UI chat
      if ((global as any).__mainWindow) {
        (global as any).__mainWindow.webContents.send('action-error', {
          command: task.command,
          step: task.currentStep + 1,
          totalSteps: task.actions.length,
          action: task.actions[task.currentStep]?.description || '',
          error: e.message,
        });
      }
      // Log error to file
      try {
        const errorLog = require('path').join(require('electron').app.getPath('userData'), 'error-log.json');
        const fs2 = require('fs');
        const errors = fs2.existsSync(errorLog) ? JSON.parse(fs2.readFileSync(errorLog, 'utf-8')) : [];
        errors.push({ timestamp: new Date().toISOString(), command: task.command, error: e.message, step: task.currentStep });
        if (errors.length > 100) errors.shift();
        fs2.writeFileSync(errorLog, JSON.stringify(errors, null, 2));
      } catch {}
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
      // Use ElevenLabs voice if one is selected, otherwise system TTS
      const { getElevenLabsKey, getSelectedVoiceId } = await import('./config');
      const voiceId = getSelectedVoiceId();
      if (voiceId) {
        await controller.elevenLabsSpeak(getElevenLabsKey(), voiceId, action.text || action.description);
      } else {
        controller.speak(action.text || action.description);
      }
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
        saveAgentMemory(); // Persist to disk
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
      let recipient = action.target || '';
      // If target doesn't look like a phone number or email, look up in contacts
      if (recipient && !/[\d+@]/.test(recipient)) {
        const contact = controller.findContact(recipient);
        if (contact && contact.phone) {
          recipient = contact.phone;
          console.log('[iMessage] Looked up', action.target, '→', recipient);
        } else if (contact && contact.email) {
          recipient = contact.email;
        } else {
          addToHistory('system', 'Contact not found: ' + action.target);
          controller.showNotification('Contact not found', action.target || '');
          break;
        }
      }
      controller.sendIMessage(recipient, action.text || '');
      controller.showNotification('iMessage sent', `To: ${action.target} (${recipient})`);
      break;
    }

    case 'read_imessages': {
      const msgs = controller.readIMessages(action.target || '', action.count || 5);
      addToHistory('system', `Recent messages from ${action.target}: ${msgs.join(' | ')}`);
      break;
    }

    // ── Calls ──
    case 'make_call': {
      let callTarget = action.target || '';
      if (callTarget && !/[\d+@]/.test(callTarget)) {
        const c = controller.findContact(callTarget);
        if (c && c.phone) callTarget = c.phone;
        else if (c && c.email) callTarget = c.email;
      }
      controller.makeFaceTimeCall(callTarget, false);
      break;
    }

    case 'make_audio_call': {
      let audioTarget = action.target || '';
      if (audioTarget && !/[\d+@]/.test(audioTarget)) {
        const c = controller.findContact(audioTarget);
        if (c && c.phone) audioTarget = c.phone;
        else if (c && c.email) audioTarget = c.email;
      }
      controller.makeFaceTimeCall(audioTarget, true);
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

    // ── Social Media ──
    case 'post_tweet': {
      controller.postTweet(action.text || '');
      break;
    }

    case 'check_notifications': {
      const notifs = controller.checkNotifications();
      addToHistory('system', 'Notifications: ' + notifs.join(' | '));
      break;
    }

    // ── Productivity ──
    case 'translate_text': {
      const translated = await controller.translateText(action.text || '', action.target || 'en');
      addToHistory('system', 'Translation: ' + translated);
      controller.showNotification('Translation', translated);
      break;
    }

    case 'create_spreadsheet': {
      const headers = (action.text || 'Column1,Column2').split(',').map((h: string) => h.trim());
      controller.createSpreadsheet(action.target || path.join(os.homedir(), 'Desktop', `sheet-${Date.now()}.csv`), headers);
      controller.showNotification('Spreadsheet created', action.target || '');
      break;
    }

    case 'add_to_spreadsheet': {
      const row = (action.text || '').split(',').map((c: string) => c.trim());
      controller.addToSpreadsheet(action.target || '', row);
      break;
    }

    // ── Developer ──
    case 'git_command': {
      const gitOut = controller.gitCommand(action.text || 'status', action.target);
      addToHistory('system', 'Git: ' + gitOut.slice(0, 2000));
      break;
    }

    case 'run_python': {
      const pyOut = controller.runPython(action.text || '');
      addToHistory('system', 'Python: ' + pyOut.slice(0, 2000));
      break;
    }

    case 'run_node': {
      const nodeOut = controller.runNode(action.text || '');
      addToHistory('system', 'Node: ' + nodeOut.slice(0, 2000));
      break;
    }

    case 'open_vscode': {
      controller.openInVSCode(action.target || '.');
      break;
    }

    // ── Smart Home ──
    case 'control_homekit': {
      controller.controlHomeKit(action.target || '', action.text || 'toggle');
      break;
    }

    case 'play_airplay': {
      controller.playAirPlay(action.target || '');
      break;
    }

    // ── AI-Powered ──
    case 'analyze_image': {
      const imgBuffer = controller.analyzeImageFile(action.target || '');
      if (imgBuffer) {
        const imgBase64 = imgBuffer.toString('base64');
        const api = (await import('./config')).getApiKey();
        const client = new (await import('@anthropic-ai/sdk')).default({ apiKey: api });
        const ext = (action.target || '').toLowerCase();
        const mediaType = ext.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const resp = await client.messages.create({
          model: 'claude-sonnet-4-20250514', max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as any, data: imgBase64 } },
            { type: 'text', text: action.text || 'Describe this image in detail.' }
          ]}]
        });
        const desc = resp.content[0].type === 'text' ? resp.content[0].text : '';
        addToHistory('system', 'Image analysis: ' + desc);
      }
      break;
    }

    case 'generate_text': {
      const api2 = (await import('./config')).getApiKey();
      const client2 = new (await import('@anthropic-ai/sdk')).default({ apiKey: api2 });
      const resp2 = await client2.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: action.text || 'Hello' }]
      });
      const generated = resp2.content[0].type === 'text' ? resp2.content[0].text : '';
      addToHistory('system', 'Generated: ' + generated);
      break;
    }

    case 'summarize_page': {
      const pageText = await controller.fetchWebpage(action.target || '');
      const api3 = (await import('./config')).getApiKey();
      const client3 = new (await import('@anthropic-ai/sdk')).default({ apiKey: api3 });
      const resp3 = await client3.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Summarize this webpage content in 3-5 bullet points:\n\n${pageText}` }]
      });
      const summary = resp3.content[0].type === 'text' ? resp3.content[0].text : '';
      addToHistory('system', 'Page summary: ' + summary);
      break;
    }

    // ── Communication ──
    case 'create_zoom': {
      controller.createZoomMeeting();
      break;
    }

    case 'join_zoom': {
      controller.joinZoomMeeting(action.target || '');
      break;
    }

    // ── PDF & Documents ──
    case 'create_pdf': {
      const pdfPath = controller.createPdf(action.text || '', action.target);
      addToHistory('system', 'PDF created: ' + pdfPath);
      controller.showNotification('PDF created', pdfPath);
      break;
    }
    case 'read_pdf': {
      const pdfText = controller.readPdf(action.target || '');
      addToHistory('system', 'PDF contents: ' + pdfText.slice(0, 2000));
      break;
    }
    case 'merge_pdfs': {
      const inputs = (action.text || '').split(',').map((p: string) => p.trim());
      controller.mergePdfs(inputs, action.target || path.join(os.homedir(), 'Desktop', 'merged.pdf'));
      controller.showNotification('PDFs merged', action.target || '');
      break;
    }
    case 'print_document': {
      controller.printDocument(action.target || '');
      controller.showNotification('Printing', action.target || '');
      break;
    }

    // ── Image Editing ──
    case 'resize_image': {
      controller.resizeImage(action.target || '', action.width || 800, action.height);
      break;
    }
    case 'crop_image': {
      controller.cropImage(action.target || '', action.x || 0, action.y || 0, action.width || 100, action.height || 100);
      break;
    }
    case 'convert_image': {
      const newPath = controller.convertImage(action.target || '', action.text || 'jpeg');
      addToHistory('system', 'Converted: ' + newPath);
      break;
    }
    case 'compress_image': {
      controller.compressImage(action.target || '', action.value || 50);
      break;
    }

    // ── Audio ──
    case 'record_audio': {
      const audioPath = controller.recordAudio(action.target, action.duration || 10);
      addToHistory('system', 'Recording to: ' + audioPath);
      controller.showNotification('Recording', `${action.duration || 10}s audio`);
      break;
    }
    case 'play_audio': {
      controller.playAudio(action.target || '');
      break;
    }
    case 'text_to_audio': {
      const audioFile = controller.textToAudioFile(action.text || '', action.target);
      addToHistory('system', 'Audio saved: ' + audioFile);
      break;
    }

    // ── Clipboard Intelligence ──
    case 'copy_from_app': {
      const copied = controller.copyFromApp(action.target || '');
      addToHistory('system', 'Copied from ' + action.target + ': ' + copied.slice(0, 1000));
      break;
    }
    case 'paste_into_app': {
      controller.pasteIntoApp(action.target || '', action.text);
      break;
    }

    // ── System Deep ──
    case 'list_running_apps': {
      const apps = controller.listRunningApps();
      addToHistory('system', 'Running apps: ' + apps.join(', '));
      break;
    }
    case 'kill_app': {
      controller.killApp(action.target || '');
      controller.showNotification('Quit', action.target || '');
      break;
    }
    case 'get_disk_space': {
      const disk = controller.getDiskSpace();
      addToHistory('system', 'Disk: ' + disk);
      controller.showNotification('Disk Space', disk);
      break;
    }
    case 'get_cpu_usage': {
      const cpu = controller.getCpuUsage();
      addToHistory('system', 'System: ' + cpu);
      break;
    }
    case 'change_wallpaper': {
      controller.changeWallpaper(action.target || '');
      break;
    }
    case 'toggle_dnd': {
      controller.toggleDoNotDisturb();
      controller.showNotification('Focus', 'Toggled Do Not Disturb');
      break;
    }

    // ── Network ──
    case 'get_ip': {
      const ip = controller.getIpAddress();
      addToHistory('system', `IP — Local: ${ip.local}, Public: ${ip.public}`);
      controller.showNotification('IP Address', `Local: ${ip.local}\nPublic: ${ip.public}`);
      break;
    }
    case 'ping': {
      const pingResult = controller.ping(action.target || '8.8.8.8', action.count || 3);
      addToHistory('system', 'Ping: ' + pingResult.slice(0, 500));
      break;
    }
    case 'check_internet': {
      const online = controller.checkInternet();
      addToHistory('system', 'Internet: ' + (online ? 'Connected' : 'No connection'));
      controller.showNotification('Internet', online ? '✓ Connected' : '✗ No connection');
      break;
    }
    case 'download_file': {
      const dlPath = controller.downloadFile(action.target || '', action.text);
      addToHistory('system', 'Downloaded to: ' + dlPath);
      controller.showNotification('Download complete', dlPath);
      break;
    }

    // ── QR Codes ──
    case 'generate_qr': {
      const qrPath = controller.generateQr(action.text || '', action.target);
      addToHistory('system', 'QR code saved: ' + qrPath);
      controller.showNotification('QR Code', 'Saved to ' + qrPath);
      break;
    }

    // ── Text Processing ──
    case 'regex_extract': {
      const matches = controller.regexExtract(action.text || '', action.target || '');
      addToHistory('system', 'Regex matches: ' + matches.join(', '));
      break;
    }
    case 'json_parse': {
      const parsed = controller.jsonParse(action.text || '', action.target);
      addToHistory('system', 'JSON: ' + parsed);
      break;
    }
    case 'count_words': {
      const wc = controller.countWords(action.text || '');
      addToHistory('system', `Words: ${wc.words}, Characters: ${wc.characters}, Lines: ${wc.lines}`);
      break;
    }
    case 'diff_text': {
      const diff = controller.diffText(action.text || '', action.target || '');
      addToHistory('system', 'Diff:\n' + diff);
      break;
    }

    // ── Passwords ──
    case 'generate_password': {
      const pw = controller.generatePassword(action.value || 16);
      addToHistory('system', 'Password: ' + pw);
      controller.writeClipboard(pw);
      controller.showNotification('Password generated', 'Copied to clipboard');
      break;
    }
    case 'check_password_strength': {
      const strength = controller.checkPasswordStrength(action.text || '');
      addToHistory('system', `Password strength: ${strength.score}/6 — ${strength.feedback}`);
      break;
    }
    case 'open_keychain': { controller.openKeychain(); break; }

    // ── Math ──
    case 'calculate': {
      const calcResult = controller.calculate(action.text || '');
      addToHistory('system', `${action.text} = ${calcResult}`);
      controller.showNotification('Calculator', `${action.text} = ${calcResult}`);
      break;
    }
    case 'unit_convert': {
      const parts3 = (action.target || 'km to mi').split(' to ');
      const ucResult = controller.unitConvert(action.value || 1, parts3[0]?.trim() || '', parts3[1]?.trim() || '');
      addToHistory('system', ucResult);
      controller.showNotification('Conversion', ucResult);
      break;
    }
    case 'percentage': {
      const pctResult = controller.percentage(action.value || 0, parseFloat(action.text || '0'));
      addToHistory('system', pctResult);
      break;
    }

    // ── Date & Time ──
    case 'get_time': {
      const t = controller.getTime(action.target);
      addToHistory('system', 'Time: ' + t);
      controller.showNotification('Time', t);
      break;
    }
    case 'time_until': {
      const tu = controller.timeUntil(action.target || '');
      addToHistory('system', 'Time until: ' + tu);
      break;
    }
    case 'date_diff': {
      const dd = controller.dateDiff(action.text || '', action.target || '');
      addToHistory('system', 'Date difference: ' + dd);
      break;
    }
    case 'world_clock': {
      const cities = (action.text || 'New York,London,Tokyo').split(',').map((c: string) => c.trim());
      const times = controller.worldClock(cities);
      addToHistory('system', 'World clock: ' + times.join(' | '));
      break;
    }

    // ── Clipboard History ──
    case 'clipboard_history': {
      const hist = controller.getClipboardHistory();
      addToHistory('system', 'Clipboard history: ' + (hist.length > 0 ? hist.map((h, i) => `${i+1}. ${h.slice(0,50)}`).join(' | ') : 'Empty'));
      break;
    }
    case 'clipboard_search': {
      const found = controller.searchClipboardHistory(action.text || '');
      addToHistory('system', 'Clipboard search: ' + (found.length > 0 ? found.join(' | ') : 'No matches'));
      break;
    }

    // ── System Automation ──
    case 'watch_folder': {
      controller.watchFolder(action.target || '');
      controller.showNotification('Watching', action.target || '');
      break;
    }

    // ── Browser ──
    case 'get_page_title': {
      const title = controller.getPageTitle();
      addToHistory('system', 'Page title: ' + title);
      break;
    }
    case 'get_page_url': {
      const url = controller.getPageUrl();
      addToHistory('system', 'Page URL: ' + url);
      break;
    }
    case 'save_page': { controller.savePageAsPdf(action.target); break; }
    case 'get_all_tabs': {
      const tabs = controller.getAllTabs();
      addToHistory('system', 'Tabs: ' + tabs.join(' | '));
      break;
    }
    case 'clear_browser_cache': { controller.clearBrowserCache(); break; }

    // ── Compression ──
    case 'zip_files': {
      const files = (action.text || '').split(',').map((f: string) => f.trim());
      controller.zipFiles(files, action.target || path.join(os.homedir(), 'Desktop', `archive-${Date.now()}.zip`));
      controller.showNotification('Zipped', action.target || '');
      break;
    }
    case 'unzip_file': {
      controller.unzipFile(action.target || '', action.text);
      controller.showNotification('Unzipped', action.target || '');
      break;
    }
    case 'tar_files': {
      const tFiles = (action.text || '').split(',').map((f: string) => f.trim());
      controller.tarFiles(tFiles, action.target || path.join(os.homedir(), 'Desktop', `archive-${Date.now()}.tar.gz`));
      break;
    }

    // ── Database ──
    case 'sqlite_query': {
      const sqlResult = controller.sqliteQuery(action.target || '', action.text || '');
      addToHistory('system', 'SQL result: ' + sqlResult.slice(0, 2000));
      break;
    }
    case 'csv_query': {
      const csvResult = controller.csvQuery(action.target || '', action.text);
      addToHistory('system', 'CSV result: ' + csvResult.slice(0, 2000));
      break;
    }

    // ── Encoding ──
    case 'base64_encode': {
      const enc = controller.base64Encode(action.text || '');
      addToHistory('system', 'Base64: ' + enc);
      controller.writeClipboard(enc);
      break;
    }
    case 'base64_decode': {
      const dec = controller.base64Decode(action.text || '');
      addToHistory('system', 'Decoded: ' + dec);
      break;
    }
    case 'url_encode': {
      const ue = controller.urlEncode(action.text || '');
      addToHistory('system', 'URL encoded: ' + ue);
      controller.writeClipboard(ue);
      break;
    }
    case 'url_decode': {
      const ud = controller.urlDecode(action.text || '');
      addToHistory('system', 'URL decoded: ' + ud);
      break;
    }
    case 'hash_text': {
      const hash = controller.hashText(action.text || '', action.target || 'sha256');
      addToHistory('system', `Hash (${action.target || 'sha256'}): ${hash}`);
      break;
    }

    // ── Fun ──
    case 'random_number': {
      const rn = controller.randomNumber(action.x || 1, action.y || 100);
      addToHistory('system', 'Random number: ' + rn);
      controller.showNotification('Random', String(rn));
      break;
    }
    case 'coin_flip': {
      const cf = controller.coinFlip();
      addToHistory('system', 'Coin flip: ' + cf);
      controller.showNotification('Coin Flip', cf);
      break;
    }
    case 'dice_roll': {
      const dr = controller.diceRoll(action.value || 6, action.count || 1);
      addToHistory('system', dr);
      controller.showNotification('Dice', dr);
      break;
    }
    case 'lorem_ipsum': {
      const li = controller.loremIpsum(action.count || 1);
      addToHistory('system', li);
      controller.writeClipboard(li);
      break;
    }

    // ── Data Extraction ──
    case 'extract_emails': {
      const emails = controller.extractEmails(action.text || '');
      addToHistory('system', 'Emails found: ' + (emails.length > 0 ? emails.join(', ') : 'None'));
      break;
    }
    case 'extract_phone_numbers': {
      const phones = controller.extractPhoneNumbers(action.text || '');
      addToHistory('system', 'Phones found: ' + (phones.length > 0 ? phones.join(', ') : 'None'));
      break;
    }
    case 'extract_urls': {
      const urls = controller.extractUrls(action.text || '');
      addToHistory('system', 'URLs found: ' + (urls.length > 0 ? urls.join(', ') : 'None'));
      break;
    }
    case 'extract_table': {
      const pageHtml = await controller.fetchWebpage(action.target || '');
      const table = controller.extractTable(pageHtml);
      const csv = table.map(r => r.join(',')).join('\n');
      addToHistory('system', 'Table:\n' + csv.slice(0, 2000));
      break;
    }
    case 'scrape_webpage': {
      const html = await controller.fetchWebpage(action.target || '');
      // Use Claude to extract what user wants
      const api4 = (await import('./config')).getApiKey();
      const client4 = new (await import('@anthropic-ai/sdk')).default({ apiKey: api4 });
      const resp4 = await client4.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Extract the following from this webpage text: ${action.text || 'all important data'}\n\nWebpage:\n${html.slice(0, 4000)}` }]
      });
      const scraped = resp4.content[0].type === 'text' ? resp4.content[0].text : '';
      addToHistory('system', 'Scraped: ' + scraped);
      break;
    }

    // ── Document Automation ──
    case 'batch_rename': {
      const renamed = controller.batchRename(action.target || '', action.text || '', action.key || '');
      addToHistory('system', 'Renamed: ' + renamed.join(', '));
      break;
    }
    case 'find_replace_in_files': {
      const frCount = controller.findAndReplaceInFiles(action.target || '', action.text || '', action.key || '');
      addToHistory('system', `Replaced in ${frCount} files`);
      break;
    }

    // ── Workflow ──
    case 'wait_for_download': {
      const dlFile = await controller.waitForFile(action.target || '', action.duration || 30000);
      addToHistory('system', dlFile ? 'File found' : 'Timed out waiting');
      break;
    }
    case 'move_latest_download': {
      const moved = controller.moveLatestDownload(action.target || path.join(os.homedir(), 'Desktop'));
      addToHistory('system', moved ? 'Moved to: ' + moved : 'No recent download found');
      break;
    }
    case 'get_latest_download': {
      const latest = controller.getLatestDownload();
      addToHistory('system', 'Latest download: ' + (latest || 'None'));
      break;
    }

    // ── Data Processing ──
    case 'sort_data': {
      const sorted = controller.sortData(action.text || '', action.value);
      addToHistory('system', 'Sorted:\n' + sorted.slice(0, 2000));
      break;
    }
    case 'filter_data': {
      const filtered = controller.filterData(action.text || '', action.target || '');
      addToHistory('system', 'Filtered:\n' + filtered.slice(0, 2000));
      break;
    }
    case 'deduplicate': {
      const deduped = controller.deduplicate(action.text || '');
      addToHistory('system', 'Deduplicated:\n' + deduped.slice(0, 2000));
      break;
    }
    case 'merge_csvs': {
      const csvPaths = (action.text || '').split(',').map((p: string) => p.trim());
      const merged = controller.mergeCsvs(csvPaths);
      if (action.target) controller.createFile(action.target, merged);
      addToHistory('system', 'Merged CSV:\n' + merged.slice(0, 2000));
      break;
    }

    // ── Integration ──
    case 'webhook_send': {
      const whResult = await controller.webhookSend(action.target || '', action.text || '{}');
      addToHistory('system', 'Webhook: ' + whResult);
      break;
    }
    case 'google_sheets_read': {
      const gsData = await controller.googleSheetsRead(action.target || '');
      addToHistory('system', 'Sheets data:\n' + gsData.slice(0, 2000));
      break;
    }

    // ── File Utilities ──
    case 'list_folder': {
      const contents = controller.listFolder(action.target || '.');
      addToHistory('system', 'Contents: ' + contents.join(', '));
      break;
    }
    case 'search_files': {
      const found2 = controller.searchFiles(action.target || '');
      addToHistory('system', 'Files found: ' + found2.join('\n'));
      break;
    }
    case 'get_file_info': {
      const info = controller.getFileInfo(action.target || '');
      addToHistory('system', `File: ${info.name}, Size: ${info.size}, Modified: ${info.modified}, Type: ${info.type}`);
      break;
    }
    case 'rename_file': {
      const np = controller.renameFile(action.target || '', action.text || '');
      addToHistory('system', 'Renamed to: ' + np);
      break;
    }
    case 'duplicate_file': {
      const dp = controller.duplicateFile(action.target || '');
      addToHistory('system', 'Duplicated to: ' + dp);
      break;
    }
    case 'trash_file': {
      controller.trashFile(action.target || '');
      break;
    }
    case 'reveal_in_finder': {
      controller.revealInFinder(action.target || '');
      break;
    }
    case 'open_with': {
      controller.openWith(action.target || '', action.text || '');
      break;
    }

    // ── AI Smart Actions ──
    case 'ai_decide': {
      // Take screenshot, let Claude decide what to do next
      const screenAnalysis = await vision.analyzeScreen(action.text || 'What should I do next to complete the task? Return a JSON action.');
      addToHistory('system', 'AI decision: ' + screenAnalysis.description);
      // Try to parse and execute the suggested action
      try {
        const jsonMatch2 = screenAnalysis.description.match(/\{[\s\S]*\}/);
        if (jsonMatch2) {
          const nextAction = JSON.parse(jsonMatch2[0]);
          if (nextAction.type) await executeAction(nextAction, index);
        }
      } catch {}
      break;
    }
    case 'ai_extract': {
      // Take screenshot and extract specific info
      const extracted = await vision.analyzeScreen(action.text || 'Extract all important information from the screen.');
      addToHistory('system', 'Extracted: ' + extracted.description);
      break;
    }
    case 'ai_fill': {
      // Take screenshot, figure out form fields, fill them
      const formAnalysis = await vision.analyzeScreen('Identify all form fields on screen. Return JSON array: [{"field":"name","x":100,"y":200,"value":"suggested value"}]');
      try {
        const fields = JSON.parse(formAnalysis.description.match(/\[[\s\S]*\]/)?.[0] || '[]');
        for (const field of fields) {
          if (field.x && field.y) {
            await controller.click(field.x, field.y);
            await controller.sleep(200);
            if (field.value) await controller.typeText(field.value, 30);
            await controller.sleep(200);
          }
        }
      } catch {}
      break;
    }
    case 'ai_navigate': {
      // Take screenshot, figure out how to get to the target
      const navAnalysis = await vision.analyzeScreen(`How do I navigate to: "${action.target}"? Return a JSON action to get there.`);
      try {
        const jsonMatch3 = navAnalysis.description.match(/\{[\s\S]*\}/);
        if (jsonMatch3) {
          const navAction = JSON.parse(jsonMatch3[0]);
          if (navAction.type) await executeAction(navAction, index);
        }
      } catch {}
      break;
    }

    // ── Automation Chains ──
    case 'if_else': {
      const checkResult = await vision.analyzeScreen(action.condition || 'Is the current state successful?');
      const isTrue2 = checkResult.description.toLowerCase().includes('yes');
      if (isTrue2 && action.actions) {
        for (const a of action.actions) { await executeAction(a, index); await controller.sleep(300); }
      } else if (!isTrue2 && action.text) {
        // Parse else actions from text field
        try {
          const elseActions = JSON.parse(action.text);
          if (Array.isArray(elseActions)) {
            for (const a of elseActions) { await executeAction(a, index); await controller.sleep(300); }
          }
        } catch {}
      }
      break;
    }
    case 'try_catch': {
      if (action.actions && action.actions.length > 0) {
        try {
          for (const a of action.actions) { await executeAction(a, index); await controller.sleep(300); }
        } catch (e: any) {
          console.log('[TryCatch] Failed:', e.message, '— running fallback');
          if (action.text) {
            try {
              const fallback = JSON.parse(action.text);
              if (Array.isArray(fallback)) {
                for (const a of fallback) { await executeAction(a, index); await controller.sleep(300); }
              }
            } catch {}
          }
        }
      }
      break;
    }
    case 'while_loop': {
      let maxIter = action.count || 10;
      let iter = 0;
      while (iter < maxIter) {
        const check = await vision.analyzeScreen(action.condition || 'Is the task complete? Answer YES or NO.');
        if (check.description.toLowerCase().includes('yes')) break;
        if (action.actions) {
          for (const a of action.actions) { await executeAction(a, index); await controller.sleep(300); }
        }
        iter++;
      }
      break;
    }
    case 'parallel': {
      if (action.actions) {
        await Promise.all(action.actions.map(a => executeAction(a, index)));
      }
      break;
    }
    case 'pipe': {
      // Execute actions sequentially, passing output forward via history
      if (action.actions) {
        for (const a of action.actions) { await executeAction(a, index); await controller.sleep(300); }
      }
      break;
    }
    case 'wait_for_element': {
      let found3 = false;
      const maxWait = action.duration || 10000;
      const start = Date.now();
      while (!found3 && Date.now() - start < maxWait) {
        const pos = await vision.findElement(action.target || '');
        if (pos) { found3 = true; addToHistory('system', `Element found at ${pos.x},${pos.y}`); }
        else await controller.sleep(1000);
      }
      if (!found3) addToHistory('system', 'Element not found: ' + action.target);
      break;
    }

    // ── Email Management ──
    case 'read_email': {
      const emails2 = controller.readEmails(action.count || 5);
      addToHistory('system', 'Emails: ' + emails2.join('\n'));
      break;
    }
    case 'search_email': {
      const emailResults = controller.searchEmail(action.target || '');
      addToHistory('system', 'Email search: ' + emailResults.join('\n'));
      break;
    }
    case 'create_email_draft': {
      controller.createEmailDraft(action.target || '', action.key || 'No subject', action.text || '');
      controller.showNotification('Draft created', action.target || '');
      break;
    }

    // ── Display ──
    case 'set_brightness': {
      controller.setBrightness(action.value || 50);
      break;
    }
    case 'toggle_night_shift': {
      controller.toggleNightShift();
      break;
    }
    case 'get_screen_resolution': {
      const res = controller.getScreenResolution();
      addToHistory('system', 'Resolution: ' + res);
      break;
    }

    // ── Printing ──
    case 'list_printers': {
      const printers = controller.listPrinters();
      addToHistory('system', 'Printers: ' + (printers.length > 0 ? printers.join(', ') : 'None found'));
      break;
    }
    case 'print_text': {
      controller.printText(action.text || '');
      controller.showNotification('Printing', 'Sent to printer');
      break;
    }
    case 'print_image': {
      controller.printImage(action.target || '');
      controller.showNotification('Printing', action.target || '');
      break;
    }

    // ── User Interaction ──
    case 'input_prompt': {
      const userInput = controller.inputPrompt(action.target || 'ISIBI', action.text || 'Enter a value:', action.key);
      addToHistory('system', 'User input: ' + userInput);
      break;
    }
    case 'choice_prompt': {
      const choices = (action.text || 'Option A,Option B').split(',').map((c: string) => c.trim());
      const chosen = controller.choicePrompt(action.target || 'Choose', choices);
      addToHistory('system', 'User chose: ' + chosen);
      break;
    }

    // ── App-Specific ──
    case 'keynote_new': { controller.keynoteNew(); break; }
    case 'numbers_new': { controller.numbersNew(); break; }
    case 'pages_new': { controller.pagesNew(); break; }
    case 'preview_open': { controller.previewOpen(action.target || ''); break; }
    case 'xcode_build': {
      const buildOut = controller.xcodeBuild(action.target || '.');
      addToHistory('system', 'Xcode: ' + buildOut.slice(0, 2000));
      break;
    }

    // ── Text Manipulation ──
    case 'text_replace': {
      const replaced = controller.textReplace(action.text || '', action.target || '', action.key || '');
      addToHistory('system', 'Replaced: ' + replaced.slice(0, 2000));
      break;
    }
    case 'text_case': {
      const cased = controller.textCase(action.text || '', action.target || 'upper');
      addToHistory('system', 'Result: ' + cased);
      controller.writeClipboard(cased);
      break;
    }
    case 'text_trim': {
      const trimmed = controller.textTrim(action.text || '');
      addToHistory('system', 'Trimmed: ' + trimmed);
      break;
    }
    case 'text_reverse': {
      const reversed = controller.textReverse(action.text || '');
      addToHistory('system', 'Reversed: ' + reversed);
      break;
    }
    case 'text_split': {
      const parts4 = controller.textSplit(action.text || '', action.target || ',');
      addToHistory('system', 'Split: ' + parts4.join(' | '));
      break;
    }

    // ── Accessibility ──
    case 'read_aloud': {
      controller.readAloud(action.text || '', action.target);
      break;
    }
    case 'increase_text_size': { controller.increaseTextSize(); break; }
    case 'decrease_text_size': { controller.decreaseTextSize(); break; }

    // ── Multi-Step Workflows ──
    case 'complete_task': {
      // AI breaks down a complex goal into steps and executes them all
      const goalApi = (await import('./config')).getApiKey();
      const goalClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: goalApi });
      const screenState = await vision.analyzeScreen('Describe what is currently on screen.');
      const goalResp = await goalClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `You are an AI agent controlling a computer. Current screen: ${screenState.description}

The user wants to: "${action.text || action.target}"

Break this into a JSON array of action steps I can execute. Use action types like open_url, find_and_click, type, press_key, wait, read_screen, ai_decide, etc.
Return ONLY the JSON array.` }]
      });
      const goalText = goalResp.content[0].type === 'text' ? goalResp.content[0].text : '[]';
      try {
        const steps = JSON.parse(goalText.match(/\[[\s\S]*\]/)?.[0] || '[]');
        for (const step of steps) {
          overlay.showStatus(step.description || step.type, 0);
          await executeAction(step, index);
          await controller.sleep(500);
        }
      } catch (e: any) { console.log('[CompleteTask] Parse error:', e.message); }
      break;
    }

    case 'research_topic': {
      // Open multiple sources, read them, compile summary
      const topic = action.target || action.text || '';
      // Search Google
      await executeAction({ type: 'open_url', target: `https://www.google.com/search?q=${encodeURIComponent(topic)}`, description: 'Searching' }, index);
      await controller.sleep(2000);
      // Read the page
      const searchResults = await vision.analyzeScreen(`Read the search results for "${topic}". List the top 5 results with titles and brief descriptions.`);
      addToHistory('system', 'Research results: ' + searchResults.description);
      // Summarize
      const resApi = (await import('./config')).getApiKey();
      const resClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: resApi });
      const resResp = await resClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Compile a brief research summary about "${topic}" based on these search results:\n${searchResults.description}` }]
      });
      const resSummary = resResp.content[0].type === 'text' ? resResp.content[0].text : '';
      addToHistory('system', 'Research summary: ' + resSummary);
      controller.showNotification('Research done', topic);
      break;
    }

    case 'monitor_and_alert': {
      // Watch screen periodically and alert when condition is met
      const monitorCondition = action.text || 'something changed';
      const monitorInterval = action.duration || 5000;
      const monitorMax = action.count || 60; // max checks
      let monitorCount = 0;
      const monitorFn = async () => {
        if (monitorCount >= monitorMax) return;
        monitorCount++;
        const check = await vision.analyzeScreen(`Check: ${monitorCondition}. Answer YES if the condition is met, NO if not.`);
        if (check.description.toLowerCase().includes('yes')) {
          controller.showNotification('Alert!', monitorCondition);
          controller.speak('Alert: ' + monitorCondition);
          addToHistory('system', 'Monitor triggered: ' + monitorCondition);
        } else {
          setTimeout(monitorFn, monitorInterval);
        }
      };
      setTimeout(monitorFn, monitorInterval);
      addToHistory('system', `Monitoring: "${monitorCondition}" every ${monitorInterval/1000}s`);
      break;
    }

    // ── Cross-App Data Flow ──
    case 'screen_to_spreadsheet': {
      const screenData = await vision.analyzeScreen('Read ALL text and data visible on screen. Format as CSV rows.');
      const csvPath = action.target || path.join(os.homedir(), 'Desktop', `screen-data-${Date.now()}.csv`);
      controller.createFile(csvPath, screenData.description);
      addToHistory('system', 'Screen data saved to: ' + csvPath);
      controller.showNotification('Saved', csvPath);
      break;
    }

    case 'screen_to_email': {
      const screenForEmail = await vision.analyzeScreen('Read all important content on screen. Summarize it for an email.');
      addToHistory('system', 'Screen summary for email: ' + screenForEmail.description);
      // Can chain with send_email
      break;
    }

    case 'screen_to_note': {
      const screenForNote = await vision.analyzeScreen('Read all content on screen.');
      controller.createNote('Screen Capture ' + new Date().toLocaleString(), screenForNote.description);
      controller.showNotification('Note created', 'From screen content');
      break;
    }

    case 'compare_screens': {
      // Take first screenshot
      const before = controller.captureScreenForComparison();
      addToHistory('system', 'First screenshot captured. Waiting for changes...');
      await controller.sleep(action.duration || 5000);
      // Take second screenshot
      const after = controller.captureScreenForComparison();
      // Compare using Claude Vision
      const fs2 = require('fs');
      const beforeB64 = fs2.readFileSync(before).toString('base64');
      const afterB64 = fs2.readFileSync(after).toString('base64');
      const compApi = (await import('./config')).getApiKey();
      const compClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: compApi });
      const compResp = await compClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' as any, data: beforeB64 } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' as any, data: afterB64 } },
          { type: 'text', text: 'Compare these two screenshots. What changed between them? Be specific.' }
        ]}]
      });
      const changes = compResp.content[0].type === 'text' ? compResp.content[0].text : '';
      addToHistory('system', 'Screen changes: ' + changes);
      try { fs2.unlinkSync(before); fs2.unlinkSync(after); } catch {}
      break;
    }

    case 'copy_between_apps': {
      // Copy from source app, paste into target app
      const [srcApp, destApp] = (action.target || 'Safari to Notes').split(' to ').map(s => s.trim());
      const copiedData = controller.copyFromApp(srcApp);
      controller.pasteIntoApp(destApp, copiedData);
      addToHistory('system', `Copied from ${srcApp} to ${destApp}: ${copiedData.slice(0, 200)}`);
      break;
    }

    // ── Context-Aware ──
    case 'understand_context': {
      const ctx = await vision.analyzeScreen('Analyze what the user is currently doing. What app are they in? What task are they working on? What would be helpful next?');
      addToHistory('system', 'Context: ' + ctx.description);
      if (ctx.suggestions && ctx.suggestions.length > 0) {
        addToHistory('system', 'Suggestions: ' + ctx.suggestions.join(', '));
      }
      break;
    }

    case 'auto_complete_task': {
      // Look at screen, understand partial work, finish it
      const taskCtx = await vision.analyzeScreen('What task has the user started but not finished? Describe what needs to be done to complete it.');
      const acApi = (await import('./config')).getApiKey();
      const acClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: acApi });
      const acResp = await acClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `The user started a task on their computer. Current screen analysis: ${taskCtx.description}

Generate a JSON array of actions to complete this task. Use types like find_and_click, type, press_key, open_url, etc.
Return ONLY the JSON array.` }]
      });
      const acText = acResp.content[0].type === 'text' ? acResp.content[0].text : '[]';
      try {
        const acSteps = JSON.parse(acText.match(/\[[\s\S]*\]/)?.[0] || '[]');
        for (const step of acSteps) {
          await executeAction(step, index);
          await controller.sleep(500);
        }
      } catch {}
      break;
    }

    case 'smart_reply': {
      // Read message on screen, generate and type a reply
      const msgCtx = await vision.analyzeScreen('Read the most recent message or email on screen. What does it say? Who sent it?');
      const srApi = (await import('./config')).getApiKey();
      const srClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: srApi });
      const srResp = await srClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 512,
        messages: [{ role: 'user', content: `Generate a professional, friendly reply to this message:\n${msgCtx.description}\n\n${action.text ? 'Tone/style: ' + action.text : ''}\nReturn ONLY the reply text, nothing else.` }]
      });
      const reply = srResp.content[0].type === 'text' ? srResp.content[0].text : '';
      addToHistory('system', 'Smart reply: ' + reply);
      // Type the reply
      await controller.typeText(reply, 20);
      break;
    }

    // ── Business Automation ──
    case 'invoice_create': {
      // Parse items from text
      const invoiceItems = (action.text || 'Service,1,100').split(';').map(line => {
        const [desc, qty, price] = line.split(',').map(s => s.trim());
        return { desc: desc || 'Item', qty: parseInt(qty) || 1, price: parseFloat(price) || 0 };
      });
      const [invFrom, invTo] = (action.target || 'Me to Client').split(' to ').map(s => s.trim());
      const invPath = controller.createInvoice(invFrom, invTo, invoiceItems, action.key);
      addToHistory('system', 'Invoice created: ' + invPath);
      controller.showNotification('Invoice created', invPath);
      // Open it
      controller.openWith(invPath, 'Safari');
      break;
    }

    case 'expense_track': {
      // Read receipt from screen or image
      let expenseData = '';
      if (action.target) {
        // From image file
        const imgBuf = controller.analyzeImageFile(action.target);
        if (imgBuf) {
          const expApi = (await import('./config')).getApiKey();
          const expClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: expApi });
          const expResp = await expClient.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 512,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' as any, data: imgBuf.toString('base64') } },
              { type: 'text', text: 'Read this receipt. Return: store name, date, items with prices, total. Format as CSV.' }
            ]}]
          });
          expenseData = expResp.content[0].type === 'text' ? expResp.content[0].text : '';
        }
      } else {
        // From screen
        const expScreen = await vision.analyzeScreen('Read the receipt or expense on screen. Extract: store, date, items, total.');
        expenseData = expScreen.description;
      }
      addToHistory('system', 'Expense: ' + expenseData);
      // Append to expenses CSV
      const expFile = path.join(os.homedir(), 'Desktop', 'expenses.csv');
      if (!require('fs').existsSync(expFile)) {
        controller.createFile(expFile, 'Date,Store,Item,Amount\n');
      }
      controller.addToSpreadsheet(expFile, [new Date().toLocaleDateString(), expenseData]);
      controller.showNotification('Expense tracked', 'Saved to expenses.csv');
      break;
    }

    case 'report_generate': {
      // Gather data and generate a report
      const reportApi = (await import('./config')).getApiKey();
      const reportClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: reportApi });
      const reportResp = await reportClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 4096,
        messages: [{ role: 'user', content: `Generate a professional report about: ${action.text || action.target || 'general summary'}

Include: Executive Summary, Key Findings, Data, Recommendations, Conclusion.
Format in clean HTML with tables if needed.` }]
      });
      const reportHtml = reportResp.content[0].type === 'text' ? reportResp.content[0].text : '';
      const reportPath = action.target || path.join(os.homedir(), 'Desktop', `report-${Date.now()}.html`);
      controller.createFile(reportPath, reportHtml);
      controller.openWith(reportPath, 'Safari');
      addToHistory('system', 'Report generated: ' + reportPath);
      break;
    }

    // ── Error Recovery ──
    case 'retry_with_fix': {
      // Try the actions, if they fail, AI analyzes and tries different approach
      if (action.actions && action.actions.length > 0) {
        try {
          for (const a of action.actions) { await executeAction(a, index); await controller.sleep(300); }
        } catch (retryErr: any) {
          console.log('[RetryWithFix] Failed:', retryErr.message);
          const fixScreen = await vision.analyzeScreen(`The previous action failed with error: "${retryErr.message}". What went wrong? How should I fix it? Return a JSON array of corrected actions.`);
          try {
            const fixSteps = JSON.parse(fixScreen.description.match(/\[[\s\S]*\]/)?.[0] || '[]');
            for (const step of fixSteps) { await executeAction(step, index); await controller.sleep(300); }
          } catch {}
        }
      }
      break;
    }

    case 'verify_result': {
      // Check if the task actually worked
      const verifyCheck = await vision.analyzeScreen(action.text || 'Did the previous action complete successfully? Answer YES with details or NO with what went wrong.');
      const verified = verifyCheck.description.toLowerCase().includes('yes');
      addToHistory('system', `Verification: ${verified ? 'SUCCESS' : 'FAILED'} — ${verifyCheck.description}`);
      if (!verified) controller.showNotification('Task may have failed', verifyCheck.description.slice(0, 100));
      break;
    }

    case 'undo_last': {
      // Undo using Cmd+Z
      await controller.pressKey(controller.Key.LeftCmd, controller.Key.Z);
      addToHistory('system', 'Undo performed');
      break;
    }

    case 'rollback': {
      // Multiple undos
      const undoCount = action.count || 5;
      for (let i = 0; i < undoCount; i++) {
        await controller.pressKey(controller.Key.LeftCmd, controller.Key.Z);
        await controller.sleep(200);
      }
      addToHistory('system', `Rolled back ${undoCount} actions`);
      break;
    }

    // ── Fill Application/Form ──
    case 'fill_application': {
      // AI reads the form, fills it with provided data
      const formData = action.text || '';
      const formScreen = await vision.analyzeScreen(`There is a form on screen. I need to fill it with this data: ${formData}. Identify each field and its location. Return a JSON array of actions: [{"type":"find_and_click","target":"field name"},{"type":"type","text":"value"}]`);
      try {
        const formSteps = JSON.parse(formScreen.description.match(/\[[\s\S]*\]/)?.[0] || '[]');
        for (const step of formSteps) { await executeAction(step, index); await controller.sleep(300); }
      } catch {}
      break;
    }

    // ── Web Automation (1-15) ──
    case 'login_to_website': case 'fill_checkout': case 'add_to_cart':
    case 'book_appointment': case 'submit_form': case 'click_through_pages':
    case 'accept_cookies': case 'close_popups': case 'auto_scroll_and_read': {
      // These are all AI-vision powered — read screen, figure out what to click
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }
    case 'compare_prices': {
      const product = action.target || '';
      const sites = ['amazon.com', 'walmart.com', 'target.com'];
      const priceResults: string[] = [];
      for (const site of sites) {
        const pageText = await controller.fetchWebpage(`https://www.google.com/search?q=${encodeURIComponent(product + ' site:' + site)}`);
        priceResults.push(`${site}: ${pageText.slice(0, 200)}`);
      }
      addToHistory('system', 'Price comparison:\n' + priceResults.join('\n'));
      break;
    }
    case 'track_package': {
      await executeAction({ type: 'open_url', target: `https://www.google.com/search?q=track+package+${encodeURIComponent(action.target || '')}`, description: 'Tracking package' }, index);
      break;
    }
    case 'unsubscribe_email': {
      await executeAction({ type: 'complete_task', text: 'Find the unsubscribe link in this email and click it', description: 'Unsubscribing' }, index);
      break;
    }
    case 'download_all_images': {
      const imgs = controller.downloadAllImages(action.target || '');
      addToHistory('system', `Downloaded ${imgs.length} images`);
      break;
    }
    case 'save_article': {
      const artPath = controller.saveArticle(action.target || '');
      addToHistory('system', 'Article saved: ' + artPath);
      break;
    }
    case 'extract_product_info': {
      const prodPage = await controller.fetchWebpage(action.target || '');
      const prodApi = (await import('./config')).getApiKey();
      const prodClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: prodApi });
      const prodResp = await prodClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 512,
        messages: [{ role: 'user', content: `Extract product info from this page: name, price, rating, availability.\n\n${prodPage.slice(0, 3000)}` }]
      });
      addToHistory('system', 'Product: ' + (prodResp.content[0].type === 'text' ? prodResp.content[0].text : ''));
      break;
    }

    // ── Communication (16-30) ──
    case 'compose_email': {
      const ceApi = (await import('./config')).getApiKey();
      const ceClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: ceApi });
      const ceResp = await ceClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Write a professional email. Brief: ${action.text || ''}. Return ONLY the email body.` }]
      });
      const emailBody = ceResp.content[0].type === 'text' ? ceResp.content[0].text : '';
      addToHistory('system', 'Composed email: ' + emailBody.slice(0, 500));
      controller.writeClipboard(emailBody);
      controller.showNotification('Email composed', 'Copied to clipboard');
      break;
    }
    case 'forward_email': {
      controller.forwardEmail(action.text || '', action.target || '');
      break;
    }
    case 'translate_and_send': {
      const translated = await controller.translateText(action.text || '', action.key || 'es');
      controller.sendIMessage(action.target || '', translated);
      break;
    }
    case 'summarize_conversation': {
      const chatText = controller.copyFromApp(action.target || 'Messages');
      const scApi = (await import('./config')).getApiKey();
      const scClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: scApi });
      const scResp = await scClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 512,
        messages: [{ role: 'user', content: `Summarize this conversation in 3-5 bullet points:\n${chatText.slice(0, 3000)}` }]
      });
      addToHistory('system', 'Summary: ' + (scResp.content[0].type === 'text' ? scResp.content[0].text : ''));
      break;
    }
    case 'find_and_call': {
      const contact = controller.findContact(action.target || '');
      if (contact && contact.phone) {
        controller.makeFaceTimeCall(contact.phone, action.text === 'audio');
      } else { addToHistory('system', 'Contact not found: ' + action.target); }
      break;
    }
    case 'export_chat': {
      const chatPath = controller.exportChat(action.target || 'Messages', action.text);
      addToHistory('system', 'Chat exported: ' + chatPath);
      break;
    }
    case 'send_bulk_sms': case 'read_whatsapp': case 'send_voice_note':
    case 'conference_call': case 'check_voicemail': case 'auto_respond': case 'archive_conversation': case 'reply_all_emails': case 'schedule_email': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── Document Work (31-45) ──
    case 'proofread_text': case 'rewrite_text': case 'expand_text': case 'shorten_text': {
      const dtApi = (await import('./config')).getApiKey();
      const dtClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: dtApi });
      const prompts: Record<string, string> = {
        proofread_text: 'Proofread and fix grammar/spelling. Return corrected text only:',
        rewrite_text: `Rewrite in a ${action.target || 'professional'} tone. Return rewritten text only:`,
        expand_text: 'Expand this into full detailed paragraphs:',
        shorten_text: 'Condense this to be shorter while keeping key points:',
      };
      const dtResp = await dtClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `${prompts[action.type]}\n\n${action.text || ''}` }]
      });
      const dtResult = dtResp.content[0].type === 'text' ? dtResp.content[0].text : '';
      addToHistory('system', action.type + ': ' + dtResult.slice(0, 1000));
      controller.writeClipboard(dtResult);
      break;
    }
    case 'convert_doc_format': {
      const converted = controller.convertDocFormat(action.target || '', action.text || 'pdf');
      addToHistory('system', 'Converted: ' + converted);
      break;
    }
    case 'extract_text_from_image': {
      await executeAction({ type: 'analyze_image', target: action.target, text: 'Extract ALL text from this image. Return only the text.', description: 'OCR' }, index);
      break;
    }
    case 'sign_pdf': case 'annotate_pdf': case 'format_document':
    case 'add_table_of_contents': case 'merge_documents': case 'create_template': case 'fill_template': case 'watermark_pdf': case 'split_pdf': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── Data & Research (46-60) ──
    case 'scrape_list': case 'scrape_contacts': case 'scrape_reviews': {
      const slPage = await controller.fetchWebpage(action.target || '');
      const slApi = (await import('./config')).getApiKey();
      const slClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: slApi });
      const extractType = action.type.replace('scrape_', '');
      const slResp = await slClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `Extract all ${extractType} from this webpage. Format as CSV:\n\n${slPage.slice(0, 4000)}` }]
      });
      const slData = slResp.content[0].type === 'text' ? slResp.content[0].text : '';
      addToHistory('system', `Scraped ${extractType}: ` + slData.slice(0, 1000));
      if (action.key) controller.createFile(action.key, slData); // save to file if path given
      break;
    }
    case 'compare_documents': {
      const doc1 = controller.readFile(action.target || '');
      const doc2 = controller.readFile(action.text || '');
      const diff2 = controller.diffText(doc1, doc2);
      addToHistory('system', 'Document diff:\n' + diff2.slice(0, 2000));
      break;
    }
    case 'export_to_json': {
      const jsonPath = controller.exportToJson(action.target || '');
      addToHistory('system', 'Exported to: ' + jsonPath);
      break;
    }
    case 'clean_data': {
      const cleanResult = controller.cleanCsvData(action.target || '');
      addToHistory('system', cleanResult);
      break;
    }
    case 'validate_data': {
      const valData = controller.readFile(action.target || '');
      const valEmails = controller.validateEmails(valData);
      addToHistory('system', `Valid: ${valEmails.valid.length}, Invalid: ${valEmails.invalid.length}${valEmails.invalid.length > 0 ? ' — ' + valEmails.invalid.join(', ') : ''}`);
      break;
    }
    case 'chart_data': {
      const chartPath = controller.chartData(action.target || '', action.text);
      addToHistory('system', 'Chart created: ' + chartPath);
      controller.openWith(chartPath, 'Safari');
      break;
    }
    case 'generate_sample_data': {
      const sample = controller.generateSampleData(action.text || 'contacts', action.count || 10);
      if (action.target) controller.createFile(action.target, sample);
      addToHistory('system', 'Sample data:\n' + sample.slice(0, 500));
      break;
    }
    case 'build_database': case 'export_to_xml': case 'pivot_table':
    case 'cross_reference': case 'find_duplicates_in_file': case 'lookup_value': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── Productivity (61-75) ──
    case 'daily_briefing': {
      const events = controller.listCalendarEvents(1);
      const reminders = controller.listReminders();
      const emails = controller.readEmails(3);
      const briefing = `Calendar: ${events.join('; ')}\nReminders: ${reminders.join('; ')}\nEmails: ${emails.join('; ')}`;
      addToHistory('system', 'Daily briefing:\n' + briefing);
      controller.showNotification('Daily Briefing', `${events.length} events, ${reminders.length} reminders, ${emails.length} emails`);
      controller.speak(`Good morning. You have ${events.length} events today, ${reminders.length} reminders, and ${emails.length} new emails.`);
      break;
    }
    case 'end_of_day_report': {
      const eodApi = (await import('./config')).getApiKey();
      const eodClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: eodApi });
      const history = getHistory();
      const eodResp = await eodClient.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Based on today's activity, write a brief end-of-day summary:\n${history.map(h => h.content).join('\n').slice(0, 3000)}` }]
      });
      const eodReport = eodResp.content[0].type === 'text' ? eodResp.content[0].text : '';
      addToHistory('system', 'EOD Report: ' + eodReport);
      controller.showNotification('End of Day', 'Report generated');
      break;
    }
    case 'pomodoro_timer': {
      controller.pomodoroTimer(action.value || 25, action.count || 5);
      break;
    }
    case 'focus_mode': {
      controller.toggleDoNotDisturb();
      const distractingApps = ['Discord', 'Slack', 'Messages', 'Twitter', 'Facebook'];
      for (const app of distractingApps) { try { controller.killApp(app); } catch {} }
      if (action.duration) controller.setTimer(action.duration, 'Focus mode ending');
      controller.showNotification('Focus Mode', 'Distracting apps closed, DND enabled');
      break;
    }
    case 'open_workspace': {
      const wsApps = (action.text || '').split(',').map((a: string) => a.trim());
      for (const app of wsApps) {
        if (app.startsWith('http')) await controller.openUrl(app);
        else await controller.openApp(app);
        await controller.sleep(500);
      }
      break;
    }
    case 'close_workspace': {
      const cwApps = (action.text || '').split(',').map((a: string) => a.trim());
      for (const app of cwApps) { try { controller.killApp(app); } catch {} }
      break;
    }
    case 'organize_downloads': {
      const orgResult = controller.organizeDownloads();
      addToHistory('system', orgResult);
      controller.showNotification('Downloads organized', orgResult);
      break;
    }
    case 'clean_desktop': {
      const cleanResult2 = controller.cleanDesktop();
      addToHistory('system', cleanResult2);
      controller.showNotification('Desktop cleaned', cleanResult2);
      break;
    }
    case 'archive_old_files': {
      const archResult = controller.archiveOldFiles(action.target || path.join(os.homedir(), 'Downloads'), action.value || 30);
      addToHistory('system', archResult);
      break;
    }
    case 'batch_process_files': {
      const bpResult = controller.batchProcess(action.target || '', action.text || '');
      addToHistory('system', bpResult);
      break;
    }
    case 'create_todo_list': case 'prioritize_tasks': case 'time_tracker_start':
    case 'time_tracker_stop': case 'rename_photos': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── Social Media (76-85) ──
    case 'post_linkedin': {
      await controller.openUrl('https://www.linkedin.com/feed/');
      await controller.sleep(2000);
      await executeAction({ type: 'find_and_click', target: 'Start a post button', description: 'Starting post' }, index);
      await controller.sleep(1000);
      await controller.typeText(action.text || '', 20);
      break;
    }
    case 'post_facebook': {
      await controller.openUrl('https://www.facebook.com/');
      await controller.sleep(2000);
      await executeAction({ type: 'find_and_click', target: "What's on your mind input", description: 'Starting post' }, index);
      await controller.sleep(1000);
      await controller.typeText(action.text || '', 20);
      break;
    }
    case 'download_video': {
      // Use yt-dlp if available, otherwise open a downloader site
      try {
        const { execSync: exec2 } = require('child_process');
        const out = path.join(os.homedir(), 'Downloads');
        exec2(`yt-dlp -o "${out}/%(title)s.%(ext)s" "${action.target}"`, { timeout: 120000 });
        addToHistory('system', 'Video downloaded to Downloads folder');
      } catch {
        await controller.openUrl(`https://www.y2mate.com/youtube/${action.target}`);
      }
      break;
    }
    case 'schedule_post': case 'check_social_stats': case 'upload_to_youtube':
    case 'create_thumbnail': case 'social_reply': case 'hashtag_research': case 'content_calendar': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── Finance (86-92) ──
    case 'track_portfolio': {
      const symbols = (action.text || 'AAPL,GOOGL,MSFT').split(',').map((s: string) => s.trim());
      const portfolio = await controller.trackPortfolio(symbols);
      addToHistory('system', 'Portfolio:\n' + portfolio);
      controller.showNotification('Portfolio', portfolio.slice(0, 100));
      break;
    }
    case 'calculate_roi': {
      const roiResult = controller.calculateRoi(action.value || 0, parseFloat(action.text || '0'));
      addToHistory('system', roiResult);
      break;
    }
    case 'budget_check': {
      const budgetResult = controller.budgetCheck(action.target || '');
      addToHistory('system', 'Budget: ' + budgetResult);
      break;
    }
    case 'crypto_price': {
      const cp2 = await controller.cryptoPrice(action.target || 'BTC');
      addToHistory('system', cp2);
      controller.showNotification('Crypto', cp2);
      break;
    }
    case 'tax_estimate': case 'invoice_reminder': case 'compare_banks': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}: ${action.text || action.target || ''}`, description: action.description }, index);
      break;
    }

    // ── System Maintenance (93-100) ──
    case 'clear_cache': {
      const cacheResult = controller.clearSystemCache();
      addToHistory('system', 'Cache: ' + cacheResult);
      controller.showNotification('Cache cleared', cacheResult);
      break;
    }
    case 'backup_folder': {
      const backupPath = controller.backupFolder(action.target || '', action.text);
      addToHistory('system', 'Backup: ' + backupPath);
      controller.showNotification('Backup complete', backupPath);
      break;
    }
    case 'system_health': {
      const health = controller.systemHealth();
      addToHistory('system', 'System: ' + health);
      controller.showNotification('System Health', health);
      break;
    }
    case 'speed_test': {
      const speed = await controller.speedTest();
      addToHistory('system', speed);
      controller.showNotification('Speed Test', speed);
      break;
    }
    case 'find_large_files': {
      const large = controller.findLargeFiles(action.target, action.value || 100);
      addToHistory('system', 'Large files:\n' + large.join('\n'));
      break;
    }
    case 'clean_duplicates': {
      const dupes = controller.findDuplicateFiles(action.target || path.join(os.homedir(), 'Downloads'));
      addToHistory('system', 'Duplicates:\n' + dupes.join('\n'));
      break;
    }
    case 'get_uptime': {
      const up = controller.getUptime();
      addToHistory('system', 'Uptime: ' + up);
      break;
    }
    case 'update_apps': case 'startup_optimize': case 'force_restart': case 'shutdown_computer': case 'log_out': {
      await executeAction({ type: 'complete_task', text: `${action.type.replace(/_/g, ' ')}`, description: action.description }, index);
      break;
    }

    // ── AI Call Handler ──
    case 'ai_answer_call': {
      // Answer incoming call and have AI conversation
      controller.answerCall();
      await controller.sleep(1500);
      controller.enableSpeaker();
      await controller.sleep(500);

      // Get the agent's personality/prompt for the call
      const callPrompt = action.text || 'You are a helpful AI assistant answering a phone call. Be conversational, friendly, and concise. Take messages if needed.';
      const callGreeting = action.key || "Hello, this is an AI assistant. How can I help you?";

      // Greet the caller (use ElevenLabs if voice selected)
      const { getElevenLabsKey: getELKey, getSelectedVoiceId: getSelVoice } = await import('./config');
      const callVoiceId = getSelVoice();
      const callELKey = getELKey();
      if (callVoiceId) {
        await controller.elevenLabsSpeak(callELKey, callVoiceId, callGreeting);
      } else {
        controller.speakDuringCall(callGreeting);
      }
      await controller.sleep(500);

      // Conversation loop — uses the main window's SpeechRecognition via IPC
      const callHistory: { role: string; content: string }[] = [
        { role: 'system', content: callPrompt },
        { role: 'assistant', content: callGreeting },
      ];

      const callApi = (await import('./config')).getApiKey();
      const callClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: callApi });
      const maxTurns = action.count || 20;

      // Tell the main window to start listening and send transcriptions
      if (typeof (global as any).__mainWindow !== 'undefined' && (global as any).__mainWindow) {
        (global as any).__mainWindow.webContents.send('start-call-listen');
      }

      for (let turn = 0; turn < maxTurns; turn++) {
        // Wait for caller to speak (listen via main window speech recognition)
        // The main window will store the transcription in a global
        await controller.sleep(5000); // Give caller time to speak

        // Check if call is still active
        if (!controller.isCallActive()) {
          console.log('[AICall] Call ended');
          addToHistory('system', 'Call ended after ' + turn + ' turns');
          break;
        }

        // Get what the caller said (from the global transcription buffer)
        const callerSaid = (global as any).__lastCallTranscription || '';
        (global as any).__lastCallTranscription = '';

        if (!callerSaid || callerSaid.trim().length === 0) {
          // Caller hasn't said anything yet, wait more
          await controller.sleep(3000);
          continue;
        }

        console.log('[AICall] Caller said:', callerSaid);
        callHistory.push({ role: 'user', content: callerSaid });

        // Generate AI response
        try {
          const callResp = await callClient.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            system: callPrompt,
            messages: callHistory.filter(m => m.role !== 'system').map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          });

          const aiResponse = callResp.content[0].type === 'text' ? callResp.content[0].text : '';
          console.log('[AICall] AI says:', aiResponse);
          callHistory.push({ role: 'assistant', content: aiResponse });

          // Speak the response (ElevenLabs if voice selected)
          if (callVoiceId) {
            await controller.elevenLabsSpeak(callELKey, callVoiceId, aiResponse);
          } else {
            controller.speakDuringCall(aiResponse, 180);
          }

          // Check for goodbye/end signals
          const lower = (callerSaid + ' ' + aiResponse).toLowerCase();
          if (lower.includes('goodbye') || lower.includes('bye bye') || lower.includes('hang up') || lower.includes('that\'s all')) {
            controller.speakDuringCall('Goodbye! Have a great day.');
            await controller.sleep(2000);
            controller.endCall();
            break;
          }
        } catch (callErr: any) {
          console.error('[AICall] Error:', callErr.message);
          controller.speakDuringCall('Sorry, I had a brief issue. Could you repeat that?');
        }

        await controller.sleep(1000);
      }

      // Save call transcript
      const transcript = callHistory.map(m => `${m.role}: ${m.content}`).join('\n');
      addToHistory('system', 'Call transcript:\n' + transcript);
      const transcriptPath = path.join(os.homedir(), 'Desktop', `call-transcript-${Date.now()}.txt`);
      controller.createFile(transcriptPath, transcript);
      controller.showNotification('Call ended', 'Transcript saved to Desktop');

      // Stop listening
      if (typeof (global as any).__mainWindow !== 'undefined' && (global as any).__mainWindow) {
        (global as any).__mainWindow.webContents.send('stop-call-listen');
      }
      break;
    }

    case 'ai_monitor_calls': {
      // Monitor for incoming calls and auto-answer with AI
      const monCallPrompt = action.text || 'You are a helpful AI assistant. Take messages and be polite.';
      const monGreeting = action.key || "Hello, this is an AI assistant. The person you're calling is unavailable. How can I help?";
      const checkInterval = action.duration || 3000;

      addToHistory('system', 'Monitoring for incoming calls...');
      controller.showNotification('Call Monitor', 'AI will answer incoming calls');

      const checkForCall = async () => {
        // Check screen for incoming call notification
        try {
          const analysis = await vision.analyzeScreen('Is there an incoming phone call or FaceTime notification on screen? Answer YES or NO only.');
          if (analysis.description.toLowerCase().includes('yes')) {
            console.log('[CallMonitor] Incoming call detected!');
            // Answer with AI
            await executeAction({
              type: 'ai_answer_call',
              text: monCallPrompt,
              key: monGreeting,
              count: 20,
              description: 'AI answering call',
            }, index);
          }
        } catch {}
        // Keep monitoring
        setTimeout(checkForCall, checkInterval);
      };

      setTimeout(checkForCall, checkInterval);
      break;
    }

    // ── Math Actions (100 functions) ──
    case 'add': case 'subtract': case 'multiply': case 'divide': case 'modulo':
    case 'power': case 'square_root': case 'cube_root': case 'absolute':
    case 'round': case 'floor': case 'ceil': case 'min': case 'max': case 'average': {
      const nums = (action.text || '').split(',').map(Number).filter(n => !isNaN(n));
      let mathResult = '';
      switch (action.type) {
        case 'add': mathResult = String(controller.mathAdd(...nums)); break;
        case 'subtract': mathResult = String(controller.mathSubtract(nums[0]||0, nums[1]||0)); break;
        case 'multiply': mathResult = String(controller.mathMultiply(...nums)); break;
        case 'divide': mathResult = String(controller.mathDivide(nums[0]||0, nums[1]||1)); break;
        case 'modulo': mathResult = String(controller.mathModulo(nums[0]||0, nums[1]||1)); break;
        case 'power': mathResult = String(controller.mathPower(nums[0]||0, nums[1]||2)); break;
        case 'square_root': mathResult = String(controller.mathSqrt(nums[0]||0)); break;
        case 'cube_root': mathResult = String(controller.mathCbrt(nums[0]||0)); break;
        case 'absolute': mathResult = String(controller.mathAbs(nums[0]||0)); break;
        case 'round': mathResult = String(controller.mathRound(nums[0]||0, nums[1]||0)); break;
        case 'floor': mathResult = String(controller.mathFloor(nums[0]||0)); break;
        case 'ceil': mathResult = String(controller.mathCeil(nums[0]||0)); break;
        case 'min': mathResult = String(controller.mathMin(...nums)); break;
        case 'max': mathResult = String(controller.mathMax(...nums)); break;
        case 'average': mathResult = String(controller.mathAverage(nums)); break;
      }
      addToHistory('system', `${action.type}(${action.text}) = ${mathResult}`);
      controller.showNotification('Math', mathResult);
      break;
    }

    // Financial calculations
    case 'compound_interest': {
      const r = controller.compoundInterest(action.value||1000, parseFloat(action.text||'0.05'), action.count||12, action.duration||1);
      addToHistory('system', r); break;
    }
    case 'simple_interest': {
      const r = controller.simpleInterest(action.value||1000, parseFloat(action.text||'0.05'), action.duration||1);
      addToHistory('system', r); break;
    }
    case 'mortgage_payment': {
      const r = controller.mortgagePayment(action.value||300000, parseFloat(action.text||'0.06'), action.count||30);
      addToHistory('system', r); controller.showNotification('Mortgage', r.slice(0, 100)); break;
    }
    case 'tip_calculator': {
      const r = controller.tipCalculator(action.value||0, parseFloat(action.text||'18'), action.count||1);
      addToHistory('system', r); controller.showNotification('Tip', r); break;
    }
    case 'tax_calculator': {
      const r = controller.taxCalculator(action.value||0, parseFloat(action.text||'8.25'));
      addToHistory('system', r); break;
    }
    case 'discount_calculator': {
      const r = controller.discountCalculator(action.value||0, parseFloat(action.text||'10'));
      addToHistory('system', r); break;
    }
    case 'markup_calculator': {
      const r = controller.markupCalculator(action.value||0, parseFloat(action.text||'50'));
      addToHistory('system', r); break;
    }
    case 'profit_margin': {
      const nums2 = (action.text||'').split(',').map(Number);
      const r = controller.profitMargin(nums2[0]||action.value||0, nums2[1]||0);
      addToHistory('system', r); break;
    }
    case 'break_even': {
      const nums2 = (action.text||'').split(',').map(Number);
      const r = controller.breakEven(nums2[0]||0, nums2[1]||0, nums2[2]||0);
      addToHistory('system', r); break;
    }
    case 'npv': {
      const cfs = (action.text||'').split(',').map(Number);
      const r = controller.npvCalc(action.value||0.1, cfs);
      addToHistory('system', r); break;
    }
    case 'salary_to_hourly': {
      const r = controller.salaryToHourly(action.value||50000, action.count||40);
      addToHistory('system', r); break;
    }
    case 'overtime_pay': {
      const nums2 = (action.text||'').split(',').map(Number);
      const r = controller.overtimePay(nums2[0]||25, nums2[1]||40, nums2[2]||10, nums2[3]||1.5);
      addToHistory('system', r); break;
    }
    case 'commission_calculator': {
      const r = controller.commissionCalc(action.value||0, parseFloat(action.text||'10'));
      addToHistory('system', r); break;
    }
    case 'inflation_adjusted': {
      const r = controller.inflationAdjusted(action.value||0, action.count||10, parseFloat(action.text||'0.03'));
      addToHistory('system', r); break;
    }
    case 'split_bill': {
      const r = controller.splitBill(action.value||0, action.count||2, parseFloat(action.text||'18'));
      addToHistory('system', r); controller.showNotification('Bill Split', r); break;
    }
    case 'loan_calculator': {
      const r = controller.loanCalculator(action.value||0, parseFloat(action.text||'0.05'), action.count||60);
      addToHistory('system', r); break;
    }
    case 'investment_return': {
      const r = controller.investmentReturn(action.value||0, parseFloat(action.text||'7'), action.count||10);
      addToHistory('system', r); break;
    }
    case 'price_per_unit': {
      const r = controller.pricePerUnit(action.value||0, action.count||1, action.target||'unit');
      addToHistory('system', r); break;
    }

    // Statistics
    case 'mean': case 'median': case 'mode': case 'standard_deviation':
    case 'variance': case 'range_stat': case 'percentile': {
      const nums3 = (action.text||'').split(',').map(Number).filter(n => !isNaN(n));
      let statR = '';
      switch (action.type) {
        case 'mean': statR = String(controller.statMean(nums3)); break;
        case 'median': statR = String(controller.statMedian(nums3)); break;
        case 'mode': statR = controller.statMode(nums3).join(', '); break;
        case 'standard_deviation': statR = controller.statStdDev(nums3).toFixed(4); break;
        case 'variance': statR = controller.statVariance(nums3).toFixed(4); break;
        case 'range_stat': statR = String(controller.statRange(nums3)); break;
        case 'percentile': statR = String(controller.statPercentile(nums3, action.value||50)); break;
      }
      addToHistory('system', `${action.type}(${action.text}) = ${statR}`); break;
    }
    case 'z_score': {
      const nums3 = (action.text||'').split(',').map(Number);
      const r = controller.statZScore(nums3[0]||0, nums3[1]||0, nums3[2]||1);
      addToHistory('system', `Z-score: ${r.toFixed(4)}`); break;
    }
    case 'correlation': {
      const parts5 = (action.text||'').split('|');
      const x2 = (parts5[0]||'').split(',').map(Number);
      const y2 = (parts5[1]||'').split(',').map(Number);
      const r = controller.statCorrelation(x2, y2);
      addToHistory('system', `Correlation: ${r.toFixed(4)}`); break;
    }
    case 'regression': {
      const parts5 = (action.text||'').split('|');
      const x2 = (parts5[0]||'').split(',').map(Number);
      const y2 = (parts5[1]||'').split(',').map(Number);
      const r = controller.statRegression(x2, y2);
      addToHistory('system', `Regression: ${r.equation}`); break;
    }
    case 'moving_average': {
      const nums3 = (action.text||'').split(',').map(Number);
      const r = controller.movingAverage(nums3, action.value||3);
      addToHistory('system', `Moving avg (${action.value||3}): ${r.map(n => n.toFixed(2)).join(', ')}`); break;
    }
    case 'weighted_average': {
      const parts5 = (action.text||'').split('|');
      const vals = (parts5[0]||'').split(',').map(Number);
      const wts = (parts5[1]||'').split(',').map(Number);
      const r = controller.weightedAverage(vals, wts);
      addToHistory('system', `Weighted avg: ${r.toFixed(4)}`); break;
    }
    case 'probability': {
      const r = controller.probability(action.value||1, action.count||6);
      addToHistory('system', r); break;
    }
    case 'combinations_calc': {
      const r = controller.combinations(action.value||10, action.count||3);
      addToHistory('system', `C(${action.value},${action.count}) = ${r}`); break;
    }
    case 'permutations_calc': {
      const r = controller.permutations(action.value||10, action.count||3);
      addToHistory('system', `P(${action.value},${action.count}) = ${r}`); break;
    }
    case 'factorial_calc': {
      const r = controller.factorial(action.value||5);
      addToHistory('system', `${action.value}! = ${r}`); break;
    }
    case 'fibonacci_calc': {
      const r = controller.fibonacci(action.value||10);
      addToHistory('system', `Fibonacci(${action.value}) = ${r}`); break;
    }
    case 'prime_check': {
      const r = controller.isPrime(action.value||0);
      addToHistory('system', `${action.value} is ${r ? 'prime' : 'not prime'}`); break;
    }
    case 'gcd_calc': {
      const nums3 = (action.text||'').split(',').map(Number);
      const r = controller.gcd(nums3[0]||0, nums3[1]||0);
      addToHistory('system', `GCD(${nums3[0]},${nums3[1]}) = ${r}`); break;
    }
    case 'lcm_calc': {
      const nums3 = (action.text||'').split(',').map(Number);
      const r = controller.lcm(nums3[0]||0, nums3[1]||0);
      addToHistory('system', `LCM(${nums3[0]},${nums3[1]}) = ${r}`); break;
    }

    // Geometry
    case 'area_circle': { addToHistory('system', controller.areaCircle(action.value||1)); break; }
    case 'area_rectangle': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.areaRectangle(n[0]||0,n[1]||0)); break; }
    case 'area_triangle': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.areaTriangle(n[0]||0,n[1]||0)); break; }
    case 'area_trapezoid': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.areaTrapezoid(n[0]||0,n[1]||0,n[2]||0)); break; }
    case 'circumference_calc': { addToHistory('system', controller.circumference(action.value||1)); break; }
    case 'perimeter_rectangle': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.perimeterRectangle(n[0]||0,n[1]||0)); break; }
    case 'volume_sphere': { addToHistory('system', controller.volumeSphere(action.value||1)); break; }
    case 'volume_cylinder': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.volumeCylinder(n[0]||0,n[1]||0)); break; }
    case 'volume_cone': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.volumeCone(n[0]||0,n[1]||0)); break; }
    case 'volume_cube': { addToHistory('system', controller.volumeCube(action.value||1)); break; }
    case 'surface_area_sphere': { addToHistory('system', controller.surfaceAreaSphere(action.value||1)); break; }
    case 'surface_area_cylinder': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.surfaceAreaCylinder(n[0]||0,n[1]||0)); break; }
    case 'pythagorean_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.pythagorean(n[0]||3,n[1]||4)); break; }
    case 'distance_2d': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.distance2d(n[0]||0,n[1]||0,n[2]||0,n[3]||0)); break; }
    case 'midpoint_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.midpoint(n[0]||0,n[1]||0,n[2]||0,n[3]||0)); break; }

    // Business analytics
    case 'growth_rate': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.growthRate(n[0]||0,n[1]||0)); break; }
    case 'cagr_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.cagr(n[0]||0,n[1]||0,n[2]||1)); break; }
    case 'customer_lifetime_value': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.customerLifetimeValue(n[0]||0,n[1]||0,n[2]||0)); break; }
    case 'churn_rate': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.churnRate(n[0]||0,n[1]||1)); break; }
    case 'conversion_rate': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.conversionRate(n[0]||0,n[1]||1)); break; }
    case 'cost_per_acquisition': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.costPerAcquisition(n[0]||0,n[1]||1)); break; }
    case 'average_order_value': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.averageOrderValue(n[0]||0,n[1]||1)); break; }
    case 'burn_rate_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.burnRate(n[0]||0,n[1]||1)); break; }
    case 'revenue_forecast': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.revenueForecast(n[0]||0,n[1]||10,n[2]||12)); break; }

    // ── Trigonometry ──
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': {
      const v = action.value || 0;
      const fns: Record<string, (n: number) => number> = { sin: controller.mathSin, cos: controller.mathCos, tan: controller.mathTan, asin: controller.mathAsin, acos: controller.mathAcos, atan: controller.mathAtan };
      const r = fns[action.type](v);
      addToHistory('system', `${action.type}(${v}) = ${r.toFixed(6)}`); break;
    }
    case 'degrees_to_radians': { addToHistory('system', `${action.value}° = ${controller.degreesToRadians(action.value||0).toFixed(6)} rad`); break; }
    case 'radians_to_degrees': { addToHistory('system', `${action.value} rad = ${controller.radiansToDegrees(action.value||0).toFixed(4)}°`); break; }
    case 'law_of_cosines': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.lawOfCosines(n[0]||0,n[1]||0,n[2]||0)); break; }
    case 'law_of_sines': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.lawOfSines(n[0]||0,n[1]||0,n[2]||0)); break; }

    // ── Algebra ──
    case 'solve_linear': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.solveLinear(n[0]||0,n[1]||0)); break; }
    case 'solve_quadratic': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.solveQuadratic(n[0]||1,n[1]||0,n[2]||0)); break; }
    case 'solve_system': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.solveSystem(n[0]||0,n[1]||0,n[2]||0,n[3]||0,n[4]||0,n[5]||0)); break; }
    case 'simplify_fraction': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.simplifyFraction(n[0]||0,n[1]||1)); break; }
    case 'logarithm': { addToHistory('system', `log_${action.count||10}(${action.value}) = ${controller.mathLog(action.value||1, action.count||10).toFixed(6)}`); break; }
    case 'natural_log': { addToHistory('system', `ln(${action.value}) = ${controller.mathLn(action.value||1).toFixed(6)}`); break; }
    case 'exponential': { addToHistory('system', `e^${action.value} = ${controller.mathExp(action.value||0).toFixed(6)}`); break; }

    // ── Number Theory ──
    case 'prime_factors': { addToHistory('system', `Prime factors of ${action.value}: ${controller.primeFactors(action.value||0).join(' × ')}`); break; }
    case 'is_even': { addToHistory('system', `${action.value} is ${controller.isEven(action.value||0) ? 'even' : 'odd'}`); break; }
    case 'is_odd': { addToHistory('system', `${action.value} is ${controller.isOdd(action.value||0) ? 'odd' : 'even'}`); break; }
    case 'binary_convert': { addToHistory('system', action.text ? `Binary ${action.text} = ${controller.binaryToDecimal(action.text)}` : `${action.value} = ${controller.decimalToBinary(action.value||0)} binary`); break; }
    case 'hex_convert': { addToHistory('system', action.text ? `Hex ${action.text} = ${controller.hexToDecimal(action.text)}` : `${action.value} = 0x${controller.decimalToHex(action.value||0)}`); break; }
    case 'octal_convert': { addToHistory('system', action.text ? `Octal ${action.text} = ${controller.octalToDecimal(action.text)}` : `${action.value} = ${controller.decimalToOctal(action.value||0)} octal`); break; }
    case 'roman_numeral': { addToHistory('system', action.text ? `${action.text} = ${controller.fromRomanNumeral(action.text)}` : `${action.value} = ${controller.toRomanNumeral(action.value||0)}`); break; }

    // ── Advanced Financial ──
    case 'depreciation_straight': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.depreciationStraight(n[0]||0,n[1]||0,n[2]||1)); break; }
    case 'depreciation_declining': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.depreciationDeclining(n[0]||0,n[1]||20,n[2]||5)); break; }
    case 'bond_price': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.bondPrice(n[0]||1000,n[1]||0.05,n[2]||0.06,n[3]||10)); break; }
    case 'dividend_yield': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.dividendYield(n[0]||0,n[1]||1)); break; }
    case 'pe_ratio': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.peRatio(n[0]||0,n[1]||1)); break; }
    case 'market_cap': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.marketCap(n[0]||0,n[1]||0)); break; }
    case 'gross_margin': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.grossMargin(n[0]||0,n[1]||0)); break; }
    case 'operating_margin': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.operatingMargin(n[0]||0,n[1]||1)); break; }
    case 'quick_ratio_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.quickRatio(n[0]||0,n[1]||0,n[2]||1)); break; }
    case 'working_capital': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.workingCapital(n[0]||0,n[1]||0)); break; }

    // ── Date Math ──
    case 'days_between': { addToHistory('system', `${controller.daysBetween(action.text||'', action.target||'')} days`); break; }
    case 'add_days': { addToHistory('system', controller.addDays(action.text||new Date().toISOString(), action.value||0)); break; }
    case 'business_days': { addToHistory('system', `${controller.businessDays(action.text||'', action.target||'')} business days`); break; }
    case 'age_calculator': { addToHistory('system', controller.ageCalculator(action.target||'')); break; }
    case 'day_of_week': { addToHistory('system', controller.dayOfWeek(action.target||'')); break; }
    case 'quarter_of_year': { addToHistory('system', `Q${controller.quarterOfYear(action.target||new Date().toISOString())}`); break; }
    case 'leap_year_check': { addToHistory('system', `${action.value} is ${controller.isLeapYear(action.value||2024) ? '' : 'not '}a leap year`); break; }

    // ── Physics ──
    case 'speed_distance_time': {
      const n=(action.text||'').split(',').map(Number);
      addToHistory('system', controller.speedDistanceTime({ speed: n[0]||undefined, distance: n[1]||undefined, time: n[2]||undefined })); break;
    }
    case 'force_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.force(n[0]||0,n[1]||0)); break; }
    case 'kinetic_energy': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.kineticEnergy(n[0]||0,n[1]||0)); break; }
    case 'potential_energy': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.potentialEnergy(n[0]||0,n[1]||0)); break; }
    case 'ohms_law': {
      const n=(action.text||'').split(',').map(Number);
      addToHistory('system', controller.ohmsLaw({ v: n[0]||undefined, i: n[1]||undefined, r: n[2]||undefined })); break;
    }
    case 'bmi_calculator': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.bmiCalculator(n[0]||70,n[1]||1.75)); break; }
    case 'calories_burned': { addToHistory('system', controller.caloriesBurned(action.target||'walking', action.value||30, action.count||70)); break; }
    case 'wavelength_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.wavelengthCalc(n[0]||0,n[1]||1)); break; }

    // ── Calculus ──
    case 'derivative': {
      const r = controller.numericalDerivative(action.text||'x*x', action.value||0);
      addToHistory('system', `d/dx(${action.text}) at x=${action.value} = ${r.toFixed(6)}`); break;
    }
    case 'integral': {
      const n=(action.target||'').split(',').map(Number);
      const r = controller.numericalIntegral(action.text||'x*x', n[0]||0, n[1]||1);
      addToHistory('system', `∫(${action.text}) from ${n[0]||0} to ${n[1]||1} = ${r.toFixed(6)}`); break;
    }
    case 'limit_calc': {
      const r = controller.numericalLimit(action.text||'x', action.value||0);
      addToHistory('system', `lim(${action.text}) as x→${action.value} = ${r.toFixed(6)}`); break;
    }

    // ── Linear Algebra ──
    case 'matrix_add': {
      const parts6 = (action.text||'').split('|');
      const a2 = JSON.parse(parts6[0]||'[[]]'); const b2 = JSON.parse(parts6[1]||'[[]]');
      addToHistory('system', 'Matrix sum: ' + JSON.stringify(controller.matrixAdd(a2, b2))); break;
    }
    case 'matrix_multiply': {
      const parts6 = (action.text||'').split('|');
      const a2 = JSON.parse(parts6[0]||'[[]]'); const b2 = JSON.parse(parts6[1]||'[[]]');
      addToHistory('system', 'Matrix product: ' + JSON.stringify(controller.matrixMultiply(a2, b2))); break;
    }
    case 'determinant_calc': {
      const m = JSON.parse(action.text||'[[1]]');
      addToHistory('system', 'Determinant: ' + controller.determinant(m)); break;
    }
    case 'transpose_calc': {
      const m = JSON.parse(action.text||'[[1]]');
      addToHistory('system', 'Transpose: ' + JSON.stringify(controller.transpose(m))); break;
    }
    case 'dot_product': {
      const parts6 = (action.text||'').split('|');
      const a2 = JSON.parse(parts6[0]||'[0]'); const b2 = JSON.parse(parts6[1]||'[0]');
      addToHistory('system', 'Dot product: ' + controller.dotProduct(a2, b2)); break;
    }
    case 'cross_product': {
      const parts6 = (action.text||'').split('|');
      const a2 = JSON.parse(parts6[0]||'[0,0,0]'); const b2 = JSON.parse(parts6[1]||'[0,0,0]');
      addToHistory('system', 'Cross product: ' + JSON.stringify(controller.crossProduct(a2, b2))); break;
    }
    case 'vector_magnitude': {
      const v = JSON.parse(action.text||'[0]');
      addToHistory('system', 'Magnitude: ' + controller.vectorMagnitude(v).toFixed(6)); break;
    }

    // ── Sequences ──
    case 'arithmetic_sequence': { const n=(action.text||'').split(',').map(Number); const r=controller.arithmeticSequence(n[0]||1,n[1]||1,n[2]||10); addToHistory('system', `a1=${n[0]}, d=${n[1]}, n=${n[2]} → nth=${r.nth}, sum=${r.sum}`); break; }
    case 'geometric_sequence': { const n=(action.text||'').split(',').map(Number); const r=controller.geometricSequence(n[0]||1,n[1]||2,n[2]||10); addToHistory('system', `a1=${n[0]}, r=${n[1]}, n=${n[2]} → nth=${r.nth.toFixed(2)}, sum=${r.sum.toFixed(2)}`); break; }
    case 'sum_of_series': { addToHistory('system', `1+2+...+${action.value} = ${controller.sumOfSeries(action.value||10)}`); break; }

    // ── Logic ──
    case 'boolean_and': case 'boolean_or': case 'boolean_xor': case 'boolean_not': {
      const bVals = (action.text||'').split(',').map(v => v.trim().toLowerCase() === 'true');
      let bResult = false;
      if (action.type === 'boolean_and') bResult = controller.booleanAnd(bVals[0]||false, bVals[1]||false);
      else if (action.type === 'boolean_or') bResult = controller.booleanOr(bVals[0]||false, bVals[1]||false);
      else if (action.type === 'boolean_xor') bResult = controller.booleanXor(bVals[0]||false, bVals[1]||false);
      else bResult = controller.booleanNot(bVals[0]||false);
      addToHistory('system', `${action.type}(${action.text}) = ${bResult}`); break;
    }
    case 'truth_table': { addToHistory('system', controller.truthTable(action.value||2)); break; }

    // ── Ratios ──
    case 'ratio_simplify': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.ratioSimplify(n[0]||1,n[1]||1)); break; }
    case 'proportion_solve': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.proportionSolve(n[0]||1,n[1]||1,n[2]||1)); break; }

    // ── More Physics ──
    case 'momentum_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.momentum(n[0]||0,n[1]||0)); break; }
    case 'work_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.work(n[0]||0,n[1]||0)); break; }
    case 'power_physics': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.powerPhysics(n[0]||0,n[1]||1)); break; }
    case 'frequency_calc': { addToHistory('system', controller.frequency(action.value||1)); break; }
    case 'pressure_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.pressure(n[0]||0,n[1]||1)); break; }
    case 'density_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.density(n[0]||0,n[1]||1)); break; }
    case 'acceleration_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.acceleration(n[0]||0,n[1]||0,n[2]||1)); break; }
    case 'projectile_range': { addToHistory('system', controller.projectileRange(action.value||10, parseFloat(action.text||'45'))); break; }

    // ── Chemistry ──
    case 'molarity_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.molarity(n[0]||0,n[1]||1)); break; }
    case 'dilution_calc': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.dilution(n[0]||0,n[1]||0,n[2]||1)); break; }
    case 'ph_calculator': { addToHistory('system', controller.phCalculator(action.value||0.001)); break; }
    case 'ideal_gas': {
      const n=(action.text||'').split(',').map(Number);
      addToHistory('system', controller.idealGas({ P:n[0]||undefined, V:n[1]||undefined, n:n[2]||undefined, T:n[3]||undefined })); break;
    }

    // ── More Financial ──
    case 'rule_of_72': { addToHistory('system', controller.ruleOf72(action.value||7)); break; }
    case 'future_value': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.futureValue(n[0]||0,n[1]||0.07,n[2]||10,n[3]||0)); break; }
    case 'present_value': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.presentValue(n[0]||0,n[1]||0.07,n[2]||10)); break; }
    case 'annuity_payment': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.annuityPayment(n[0]||0,n[1]||0.07,n[2]||10)); break; }
    case 'debt_payoff': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.debtPayoff(n[0]||0,n[1]||0.2,n[2]||100)); break; }

    // ── Advanced Probability ──
    case 'normal_distribution': { const n=(action.text||'').split(',').map(Number); addToHistory('system', `P(x=${n[0]}) = ${controller.normalDistribution(n[0]||0,n[1]||0,n[2]||1).toFixed(6)}`); break; }
    case 'binomial_probability': { const n=(action.text||'').split(',').map(Number); addToHistory('system', `P(X=${n[1]}) = ${controller.binomialProbability(n[0]||10,n[1]||5,n[2]||0.5).toFixed(6)}`); break; }
    case 'expected_value_calc': {
      const parts7 = (action.text||'').split('|');
      const vals = (parts7[0]||'').split(',').map(Number);
      const probs = (parts7[1]||'').split(',').map(Number);
      addToHistory('system', `E(X) = ${controller.expectedValue(vals, probs).toFixed(4)}`); break;
    }
    case 'standard_error': { const n=(action.text||'').split(',').map(Number); addToHistory('system', `SE = ${controller.standardError(n[0]||1,n[1]||30).toFixed(4)}`); break; }
    case 'confidence_interval': { const n=(action.text||'').split(',').map(Number); addToHistory('system', controller.confidenceInterval(n[0]||0,n[1]||1,n[2]||30,n[3]||0.95)); break; }

    // ── Smart Workflows (1-20) — AI-driven, use complete_task ──
    case 'apply_to_job': case 'book_restaurant': case 'order_food':
    case 'pay_bill': case 'check_bank_balance': case 'transfer_money':
    case 'file_expense_report': case 'auto_format_resume':
    case 'linkedin_connect': case 'linkedin_apply':
    case 'update_all_passwords': case 'check_for_updates': {
      await executeAction({ type: 'complete_task', text: action.type.replace(/_/g, ' ') + ': ' + (action.text || action.target || ''), description: action.description }, index);
      break;
    }
    case 'compare_products': {
      if (action.text) {
        const [url1, url2] = action.text.split(',').map((u: string) => u.trim());
        const page1 = await controller.fetchWebpage(url1);
        const page2 = await controller.fetchWebpage(url2);
        const cApi = (await import('./config')).getApiKey();
        const cClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: cApi });
        const cResp = await cClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
          messages: [{ role: 'user', content: `Compare these two products:\n\nProduct 1:\n${page1.slice(0,2000)}\n\nProduct 2:\n${page2.slice(0,2000)}\n\nSummarize key differences: price, features, ratings.` }] });
        addToHistory('system', 'Comparison: ' + (cResp.content[0].type === 'text' ? cResp.content[0].text : ''));
      }
      break;
    }
    case 'create_presentation_from_doc': {
      const docContent = controller.readFile(action.target || '');
      const cApi2 = (await import('./config')).getApiKey();
      const cClient2 = new (await import('@anthropic-ai/sdk')).default({ apiKey: cApi2 });
      const cResp2 = await cClient2.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `Convert this document into presentation slides. For each slide, give a title and 3-5 bullet points:\n\n${docContent.slice(0,4000)}` }] });
      addToHistory('system', 'Slides: ' + (cResp2.content[0].type === 'text' ? cResp2.content[0].text : ''));
      break;
    }
    case 'clear_all_notifications': {
      if (process.platform === 'darwin') {
        try { require('child_process').execSync(`osascript -e 'tell application "System Events" to tell process "NotificationCenter" to click button 1 of every window'`, { timeout: 5000 }); } catch {}
      }
      break;
    }
    case 'close_all_apps': {
      const running = controller.listRunningApps().filter(a => a !== 'Finder' && a !== 'ISIBI Ghost Mode');
      for (const app of running) { try { controller.killApp(app); } catch {} }
      controller.showNotification('Done', `Closed ${running.length} apps`);
      break;
    }
    case 'restart_wifi': {
      controller.toggleWifi(false);
      await controller.sleep(2000);
      controller.toggleWifi(true);
      controller.showNotification('WiFi', 'Restarted');
      break;
    }
    case 'clear_ram': {
      try { require('child_process').execSync('sudo purge 2>/dev/null || purge', { timeout: 10000 }); } catch {}
      controller.showNotification('RAM', 'Memory purged');
      break;
    }
    case 'optimize_storage': {
      const large = controller.findLargeFiles(undefined, 50);
      const disk = controller.getDiskSpace();
      addToHistory('system', `Storage: ${disk}\nLarge files:\n${large.slice(0, 10).join('\n')}`);
      break;
    }

    // ── Content Extraction (21-35) ──
    case 'read_webpage_aloud': {
      const pageText2 = await controller.fetchWebpage(action.target || '');
      const sumApi = (await import('./config')).getApiKey();
      const sumClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: sumApi });
      const sumResp = await sumClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 512,
        messages: [{ role: 'user', content: `Summarize this in 2-3 sentences for reading aloud:\n${pageText2.slice(0,3000)}` }] });
      const summary2 = sumResp.content[0].type === 'text' ? sumResp.content[0].text : '';
      const { getElevenLabsKey: gEL, getSelectedVoiceId: gSV } = await import('./config');
      if (gSV()) await controller.elevenLabsSpeak(gEL(), gSV(), summary2);
      else controller.speak(summary2);
      break;
    }
    case 'screen_to_text': {
      const scrAnalysis = await vision.analyzeScreen('Read ALL text visible on screen. Return only the text, nothing else.');
      controller.writeClipboard(scrAnalysis.description);
      addToHistory('system', 'Screen text copied to clipboard');
      break;
    }
    case 'pdf_to_spreadsheet': {
      const pdfText2 = controller.readPdf(action.target || '');
      const csvOut = action.text || (action.target || '').replace(/\.pdf$/i, '.csv');
      controller.createFile(csvOut, pdfText2);
      addToHistory('system', 'PDF extracted to: ' + csvOut);
      break;
    }
    case 'image_to_text': {
      await executeAction({ type: 'analyze_image', target: action.target, text: 'Extract ALL text from this image. Return only the text.', description: 'OCR' }, index);
      break;
    }
    case 'receipt_to_csv': case 'business_card_scan': case 'extract_invoice_data': {
      const imgBuf2 = controller.analyzeImageFile(action.target || '');
      if (imgBuf2) {
        const ocrApi = (await import('./config')).getApiKey();
        const ocrClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: ocrApi });
        const prompts2: Record<string, string> = {
          receipt_to_csv: 'Read this receipt. Extract items, quantities, prices. Return as CSV: Item,Qty,Price',
          business_card_scan: 'Read this business card. Extract: Name, Title, Company, Phone, Email, Address',
          extract_invoice_data: 'Read this invoice. Extract: Vendor, Invoice#, Date, Items, Total. Return as CSV',
        };
        const ocrResp = await ocrClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' as any, data: imgBuf2.toString('base64') } },
            { type: 'text', text: prompts2[action.type] || 'Extract all data' }
          ]}] });
        const extracted2 = ocrResp.content[0].type === 'text' ? ocrResp.content[0].text : '';
        addToHistory('system', extracted2);
        if (action.text) controller.createFile(action.text, extracted2);
      }
      break;
    }
    case 'screenshot_to_pdf': {
      const ssPath = path.join(os.tmpdir(), `ss-${Date.now()}.png`);
      require('child_process').execSync(`screencapture -x ${ssPath}`, { timeout: 5000 });
      const pdfOut = action.target || path.join(os.homedir(), 'Desktop', `screenshot-${Date.now()}.pdf`);
      controller.createPdf(`<img src="file://${ssPath}" style="max-width:100%">`, pdfOut);
      break;
    }
    case 'webpage_to_pdf': {
      const htmlContent = await controller.fetchWebpage(action.target || '');
      const wpPdfOut = action.text || path.join(os.homedir(), 'Desktop', `page-${Date.now()}.pdf`);
      controller.createPdf(htmlContent.slice(0, 10000), wpPdfOut);
      break;
    }
    case 'summarize_pdf': {
      const pdfContent = controller.readPdf(action.target || '');
      const spApi = (await import('./config')).getApiKey();
      const spClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: spApi });
      const spResp = await spClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Summarize this PDF in bullet points:\n${pdfContent.slice(0,4000)}` }] });
      addToHistory('system', 'PDF Summary: ' + (spResp.content[0].type === 'text' ? spResp.content[0].text : ''));
      break;
    }
    case 'transcribe_audio': {
      // Use macOS speech recognition on audio file
      addToHistory('system', 'Audio transcription requires playing the file while SpeechRecognition listens. Use ai_answer_call pattern for this.');
      break;
    }
    case 'extract_addresses': { addToHistory('system', 'Addresses: ' + controller.extractAddresses(action.text || '').join(' | ')); break; }
    case 'extract_dates_text': { addToHistory('system', 'Dates: ' + controller.extractDates(action.text || '').join(' | ')); break; }
    case 'extract_numbers_text': { addToHistory('system', 'Numbers: ' + controller.extractNumbers(action.text || '').join(' | ')); break; }
    case 'extract_names_text': { addToHistory('system', 'Names: ' + controller.extractNames(action.text || '').join(' | ')); break; }

    // ── Communication Automation (36-50) ──
    case 'cold_email': case 'thank_you_email': case 'newsletter_draft':
    case 'complaint_email': case 'recommendation_letter': {
      const ceApi2 = (await import('./config')).getApiKey();
      const ceClient2 = new (await import('@anthropic-ai/sdk')).default({ apiKey: ceApi2 });
      const emailPrompts: Record<string, string> = {
        cold_email: 'Write a professional cold outreach email',
        thank_you_email: 'Write a thank you email after a meeting',
        newsletter_draft: 'Write a newsletter',
        complaint_email: 'Write a professional complaint/dispute email',
        recommendation_letter: 'Write a recommendation letter',
      };
      const ceResp2 = await ceClient2.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `${emailPrompts[action.type]}. Context: ${action.text || ''}. Return ONLY the email body.` }] });
      const emailBody2 = ceResp2.content[0].type === 'text' ? ceResp2.content[0].text : '';
      addToHistory('system', action.type + ': ' + emailBody2.slice(0, 500));
      controller.writeClipboard(emailBody2);
      controller.showNotification('Email drafted', 'Copied to clipboard');
      break;
    }
    case 'meeting_recap_email': {
      const recapScreen = await vision.analyzeScreen('Read any meeting notes or content visible on screen.');
      const mrApi = (await import('./config')).getApiKey();
      const mrClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: mrApi });
      const mrResp = await mrClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Write a professional meeting recap email from these notes:\n${recapScreen.description}\n\nAttendees: ${action.text || 'team'}` }] });
      addToHistory('system', 'Recap: ' + (mrResp.content[0].type === 'text' ? mrResp.content[0].text : ''));
      break;
    }
    case 'birthday_message': {
      const contact2 = controller.findContact(action.target || '');
      if (contact2) {
        const msg = `Happy Birthday ${contact2.name}! Wishing you an amazing day! 🎂🎉`;
        if (contact2.phone) controller.sendIMessage(contact2.phone, action.text || msg);
        controller.showNotification('Birthday wish sent', contact2.name);
      }
      break;
    }
    case 'out_of_office': {
      await executeAction({ type: 'complete_task', text: 'Set up out of office auto-reply in Mail: ' + (action.text || 'I am currently out of office'), description: 'Setting OOO' }, index);
      break;
    }
    case 'follow_up_sequence': case 'email_signature': case 'social_dm':
    case 'respond_to_review': case 'invitation_create': case 'rsvp_respond': case 'contact_merge': {
      await executeAction({ type: 'complete_task', text: action.type.replace(/_/g, ' ') + ': ' + (action.text || action.target || ''), description: action.description }, index);
      break;
    }

    // ── Data Intelligence (51-65) ──
    case 'analyze_csv': {
      const csvData = controller.readFile(action.target || '');
      const acApi = (await import('./config')).getApiKey();
      const acClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: acApi });
      const acResp = await acClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `Analyze this CSV data. Provide key insights, patterns, and recommendations:\n${csvData.slice(0,4000)}` }] });
      addToHistory('system', 'Analysis: ' + (acResp.content[0].type === 'text' ? acResp.content[0].text : ''));
      break;
    }
    case 'predict_trend': {
      const data2 = (action.text || '').split(',').map(Number).filter(n => !isNaN(n));
      const predictions = controller.predictTrend(data2, action.count || 3);
      addToHistory('system', `Data: ${data2.join(',')} → Predicted: ${predictions.join(',')}`);
      break;
    }
    case 'anomaly_detect': {
      const data3 = (action.text || '').split(',').map(Number).filter(n => !isNaN(n));
      const anomalies = controller.anomalyDetect(data3);
      addToHistory('system', `Outliers: ${anomalies.outliers.join(',')} at indices ${anomalies.indices.join(',')}`);
      break;
    }
    case 'sentiment_analysis': case 'keyword_extract': case 'categorize_data':
    case 'swot_analysis': case 'risk_assessment': case 'market_research':
    case 'competitor_check': case 'score_leads': case 'survey_analyze': {
      const saApi = (await import('./config')).getApiKey();
      const saClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: saApi });
      const saPrompts: Record<string, string> = {
        sentiment_analysis: 'Analyze the sentiment (positive/negative/neutral) and give a score:',
        keyword_extract: 'Extract the most important keywords and phrases:',
        categorize_data: 'Categorize each item in this list:',
        swot_analysis: 'Generate a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats):',
        risk_assessment: 'Evaluate the risks of this decision/plan:',
        market_research: 'Compile market research and insights about:',
        competitor_check: 'Analyze this competitor and summarize their offerings:',
        score_leads: 'Score these leads from 1-10 based on quality:',
        survey_analyze: 'Analyze these survey responses and summarize findings:',
      };
      const saResp = await saClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        messages: [{ role: 'user', content: `${saPrompts[action.type]}\n\n${action.text || action.target || ''}` }] });
      addToHistory('system', action.type + ': ' + (saResp.content[0].type === 'text' ? saResp.content[0].text : ''));
      break;
    }
    case 'ab_test_calculator': {
      const n2 = (action.text || '').split(',').map(Number);
      addToHistory('system', controller.abTestCalculator(n2[0]||1000, n2[1]||50, n2[2]||1000, n2[3]||65));
      break;
    }
    case 'decision_matrix': {
      const opts = (action.target || 'A,B,C').split(',');
      const crit = (action.key || 'Cost,Quality').split(',');
      const wts = (action.text || '').split('|')[0]?.split(',').map(Number) || [1, 1];
      const scores2 = (action.text || '').split('|').slice(1).map((r: string) => r.split(',').map(Number));
      addToHistory('system', 'Decision Matrix:\n' + controller.decisionMatrix(opts, crit, wts, scores2));
      break;
    }
    case 'forecast_model': {
      const data4 = (action.text || '').split(',').map(Number).filter(n => !isNaN(n));
      const preds = controller.predictTrend(data4, action.count || 6);
      addToHistory('system', `Historical: ${data4.join(',')} → Forecast: ${preds.join(',')}`);
      break;
    }

    // ── Developer Power (66-80) ──
    case 'create_api': case 'create_component': case 'write_test':
    case 'debug_error': case 'explain_code': case 'refactor_code':
    case 'generate_sql': case 'generate_regex': case 'api_documentation':
    case 'database_schema': {
      const devApi = (await import('./config')).getApiKey();
      const devClient = new (await import('@anthropic-ai/sdk')).default({ apiKey: devApi });
      const devPrompts: Record<string, string> = {
        create_api: 'Generate boilerplate API code (Express.js or FastAPI) for:',
        create_component: 'Generate a React component for:',
        write_test: 'Write test cases for this function/code:',
        debug_error: 'Explain this error and suggest a fix:',
        explain_code: 'Explain what this code does in simple terms:',
        refactor_code: 'Refactor this code for better readability and performance:',
        generate_sql: 'Convert this to a SQL query:',
        generate_regex: 'Generate a regex pattern for:',
        api_documentation: 'Generate API documentation for:',
        database_schema: 'Generate a database schema for:',
      };
      const devResp = await devClient.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 2048,
        messages: [{ role: 'user', content: `${devPrompts[action.type]}\n\n${action.text || action.target || ''}` }] });
      const devResult = devResp.content[0].type === 'text' ? devResp.content[0].text : '';
      addToHistory('system', action.type + ':\n' + devResult);
      controller.writeClipboard(devResult);
      break;
    }
    case 'deploy_to_vercel': { const r = controller.runTerminalCommand('cd ' + (action.target || '.') + ' && vercel --yes'); addToHistory('system', r); break; }
    case 'deploy_to_netlify': { const r = controller.runTerminalCommand('cd ' + (action.target || '.') + ' && netlify deploy --prod'); addToHistory('system', r); break; }
    case 'check_build_status': case 'rollback_deploy': case 'monitor_logs': {
      await executeAction({ type: 'complete_task', text: action.type.replace(/_/g, ' ') + ': ' + (action.text || action.target || ''), description: action.description }, index);
      break;
    }

    // ── Personal Finance (81-90) ──
    case 'savings_calculator': { const n2=(action.text||'').split(',').map(Number); addToHistory('system', controller.savingsCalculator(n2[0]||10000, n2[1]||12, n2[2]||0)); break; }
    case 'retirement_calculator': { const n2=(action.text||'').split(',').map(Number); addToHistory('system', controller.retirementCalculator(n2[0]||30, n2[1]||65, n2[2]||10000, n2[3]||500)); break; }
    case 'tax_bracket': { addToHistory('system', controller.taxBracket(action.value||50000)); break; }
    case 'paycheck_calculator': { const n2=(action.text||'').split(',').map(Number); addToHistory('system', controller.paycheckCalculator(n2[0]||5000, n2[1]||22, n2[2]||5, n2[3]||7.65)); break; }
    case 'net_worth_tracker': case 'subscription_audit': case 'mortgage_comparison':
    case 'side_hustle_tracker': case 'investment_diversification': case 'credit_score_factors': {
      await executeAction({ type: 'complete_task', text: action.type.replace(/_/g, ' ') + ': ' + (action.text || action.target || ''), description: action.description }, index);
      break;
    }

    // ── Everyday Life (91-100) ──
    case 'random_meal': { const m2 = controller.randomMeal(); addToHistory('system', 'Meal suggestion: ' + m2); controller.showNotification('Meal', m2); break; }
    case 'random_workout': { const w2 = controller.randomWorkout(); addToHistory('system', 'Workout: ' + w2); controller.showNotification('Workout', w2); break; }
    case 'random_movie': { const m3 = controller.randomMovie(); addToHistory('system', 'Movie: ' + m3); controller.showNotification('Movie', m3); break; }
    case 'random_book': { const b2 = controller.randomBook(); addToHistory('system', 'Book: ' + b2); controller.showNotification('Book', b2); break; }
    case 'daily_quote_action': { const q2 = controller.dailyQuote(); addToHistory('system', q2); controller.showNotification('Quote', q2); break; }
    case 'sleep_calculator_action': { addToHistory('system', 'Sleep schedule for waking at ' + (action.target || '7:00') + ':\n' + controller.sleepCalculator(action.target || '7:00')); break; }
    case 'count_down': {
      const targetDate = new Date(action.target || '').getTime();
      const diff2 = targetDate - Date.now();
      if (diff2 > 0) {
        const d = Math.floor(diff2/86400000); const h = Math.floor((diff2%86400000)/3600000); const m4 = Math.floor((diff2%3600000)/60000);
        addToHistory('system', `Countdown: ${d}d ${h}h ${m4}m until ${action.target}`);
      } else { addToHistory('system', 'Date already passed'); }
      break;
    }
    case 'commute_time': {
      controller.getDirections('current location', action.target || '');
      break;
    }
    case 'habit_streak': case 'water_intake': {
      // Log to a CSV tracker
      const trackerFile = path.join(os.homedir(), 'Desktop', action.type + '-tracker.csv');
      if (!require('fs').existsSync(trackerFile)) controller.createFile(trackerFile, 'Date,Value\n');
      controller.addToSpreadsheet(trackerFile, [new Date().toLocaleDateString(), action.text || '1']);
      addToHistory('system', `Logged to ${action.type} tracker`);
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
