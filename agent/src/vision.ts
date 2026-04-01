/**
 * Vision Module — takes screenshots and uses Claude Vision to understand the screen.
 *
 * Captures the screen, sends to Claude Vision API, gets back:
 * - What's on screen (description)
 * - Coordinates of UI elements (buttons, inputs, links)
 * - Current state (which app is focused, what page is showing)
 */

import { desktopCapturer, screen, systemPreferences } from 'electron';
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
  // Use macOS screencapture CLI — doesn't trigger the Electron screen recording popup
  if (process.platform === 'darwin') {
    try {
      const tmpFile = path.join(os.tmpdir(), `isibi-screenshot-${Date.now()}.png`);
      execSync(`screencapture -x -C ${tmpFile}`, { timeout: 5000 });
      const buffer = fs.readFileSync(tmpFile);
      try { fs.unlinkSync(tmpFile); } catch {}
      return buffer;
    } catch (e) {
      console.log('[Vision] screencapture failed, falling back to desktopCapturer');
    }
  }

  // Fallback: Electron desktopCapturer (may trigger popup on unsigned apps)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: screen.getPrimaryDisplay().workAreaSize.width,
      height: screen.getPrimaryDisplay().workAreaSize.height,
    },
  });

  if (sources.length === 0) throw new Error('No screen source available');
  const source = sources[0];
  return source.thumbnail.toPNG();
}

export async function captureScreenBase64(): Promise<string> {
  const buffer = await captureScreen();
  return buffer.toString('base64');
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
            media_type: 'image/png',
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

export async function findElement(description: string): Promise<{ x: number; y: number } | null> {
  const screenshot = await captureScreenBase64();
  const api = getClient();

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshot,
          },
        },
        {
          type: 'text',
          text: `Find this element on the screen: "${description}"

Return ONLY JSON: {"x": pixel_x, "y": pixel_y, "found": true}
Or if not found: {"found": false}

Coordinates should be the approximate center of the element.`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.found) return { x: result.x, y: result.y };
    }
  } catch { /* parse error */ }

  return null;
}

// ── Describe Current Screen ─────────────────────────────────────────────

export async function describeScreen(): Promise<string> {
  const analysis = await analyzeScreen('Describe what is currently showing on the screen in 1-2 sentences.');
  return analysis.description;
}
