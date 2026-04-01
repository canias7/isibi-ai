/**
 * Vision Module — takes screenshots and uses Claude Vision to understand the screen.
 *
 * Captures the screen, sends to Claude Vision API, gets back:
 * - What's on screen (description)
 * - Coordinates of UI elements (buttons, inputs, links)
 * - Current state (which app is focused, what page is showing)
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { getApiKey } from './config';

const MODEL = 'claude-sonnet-4-20250514';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const key = getApiKey();
    if (!key) throw new Error('Anthropic API key not set. Run onboarding or set ANTHROPIC_API_KEY.');
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

export interface ScreenElement {
  description: string;
  x: number;
  y: number;
  type: 'button' | 'input' | 'link' | 'text' | 'icon' | 'menu' | 'tab' | 'other';
}

export interface ScreenAnalysis {
  description: string;
  activeApp: string;
  elements: ScreenElement[];
  suggestions: string[];
}

// ── Screenshot Capture ──────────────────────────────────────────────────

export async function captureScreen(): Promise<Buffer> {
  if (process.platform === 'darwin') {
    // Use screencapture CLI with JPEG compression — no Electron popup, stays under 5MB
    const tmpFile = path.join(os.tmpdir(), `isibi-screenshot-${Date.now()}.jpg`);
    // -t jpg = JPEG format, -x = no sound, -C = capture cursor
    // Then use sips to resize to max 1920px wide (keeps it under 5MB)
    execSync(`screencapture -x -C -t jpg ${tmpFile}`, { timeout: 5000 });
    // Resize to max 1920px wide to keep under API limit
    try {
      execSync(`sips --resampleWidth 1920 ${tmpFile} --setProperty formatOptions 60`, { timeout: 5000 });
    } catch { /* sips may fail, that's ok */ }
    const buffer = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch {}
    return buffer;
  }

  // Windows/Linux: dynamic import to avoid triggering macOS popup
  const electron = require('electron');
  const sources = await electron.desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: electron.screen.getPrimaryDisplay().workAreaSize.width,
      height: electron.screen.getPrimaryDisplay().workAreaSize.height,
    },
  });
  if (sources.length === 0) throw new Error('No screen source available');
  return sources[0].thumbnail.toJPEG(60); // JPEG at 60% quality to stay under 5MB
}

export async function captureScreenBase64(): Promise<string> {
  const buffer = await captureScreen();
  return buffer.toString('base64');
}

function getImageMediaType(): 'image/jpeg' | 'image/png' {
  return process.platform === 'darwin' ? 'image/jpeg' : 'image/jpeg';
}

// ── Screen Analysis with Claude Vision ──────────────────────────────────

export async function analyzeScreen(query: string): Promise<ScreenAnalysis> {
  const screenshot = await captureScreenBase64();
  const api = getClient();

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: screenshot,
          },
        },
        {
          type: 'text',
          text: `Analyze this screenshot. ${query}

Return JSON:
{
  "description": "brief description of what's on screen",
  "activeApp": "name of the focused application",
  "elements": [
    {"description": "element description", "x": pixel_x, "y": pixel_y, "type": "button|input|link|text|icon|menu|tab|other"}
  ],
  "suggestions": ["what the user could do next"]
}

Only include the most relevant UI elements (max 10). Coordinates should be approximate center of each element.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* parse error */ }

  return {
    description: text,
    activeApp: 'unknown',
    elements: [],
    suggestions: [],
  };
}

// ── Find Specific Element ───────────────────────────────────────────────

export async function findElement(description: string, maxRetries: number = 2): Promise<{ x: number; y: number } | null> {
  const prompts = [
    `Find this element on the screen: "${description}"\n\nReturn ONLY JSON: {"x": pixel_x, "y": pixel_y, "found": true}\nOr if not found: {"found": false}\n\nCoordinates should be the approximate center of the element.`,
    `Look more carefully at the entire screen. Find: "${description}"\nIt might be partially hidden, in a menu, or use different wording.\n\nReturn ONLY JSON: {"x": pixel_x, "y": pixel_y, "found": true}\nOr if not found: {"found": false}`,
    `Search every part of the screen for anything matching: "${description}"\nCheck buttons, links, text, icons, tabs, menus — anything clickable.\n\nReturn ONLY JSON: {"x": pixel_x, "y": pixel_y, "found": true}\nOr if not found: {"found": false}`,
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Take a fresh screenshot each attempt
      const screenshot = await captureScreenBase64();
      const api = getClient();

      const response = await api.messages.create({
        model: MODEL,
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } },
            { type: 'text', text: prompts[attempt] || prompts[0] },
          ],
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log(`[Vision] Attempt ${attempt + 1}: ${text.slice(0, 100)}`);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        if (result.found && result.x && result.y) {
          console.log(`[Vision] Found "${description}" at (${result.x}, ${result.y}) on attempt ${attempt + 1}`);
          return { x: result.x, y: result.y };
        }
      }
    } catch (err: any) {
      console.error(`[Vision] Attempt ${attempt + 1} error:`, err.message);
    }

    // Wait before retrying
    if (attempt < maxRetries) {
      console.log(`[Vision] "${description}" not found, retrying in 1.5s...`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`[Vision] Could not find "${description}" after ${maxRetries + 1} attempts`);
  return null;
}

// ── Describe Current Screen ─────────────────────────────────────────────

export async function describeScreen(): Promise<string> {
  const analysis = await analyzeScreen('Describe what is currently showing on the screen in 1-2 sentences.');
  return analysis.description;
}
