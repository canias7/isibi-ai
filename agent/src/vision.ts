/**
 * Vision Module — takes screenshots and uses Claude Vision to understand the screen.
 * Now works with signed app — no more permission popup.
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
    if (!key) throw new Error('Anthropic API key not set.');
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
    const tmpFile = path.join(os.tmpdir(), `isibi-screenshot-${Date.now()}.jpg`);
    execSync(`screencapture -x -C -t jpg ${tmpFile}`, { timeout: 5000 });
    try { execSync(`sips --resampleWidth 1920 ${tmpFile} --setProperty formatOptions 60`, { timeout: 5000 }); } catch {}
    const buffer = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch {}
    return buffer;
  }
  // Windows/Linux fallback
  const electron = require('electron');
  const sources = await electron.desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: electron.screen.getPrimaryDisplay().workAreaSize.width, height: electron.screen.getPrimaryDisplay().workAreaSize.height },
  });
  if (sources.length === 0) throw new Error('No screen source available');
  return sources[0].thumbnail.toJPEG(60);
}

export async function captureScreenBase64(): Promise<string> {
  const buffer = await captureScreen();
  return buffer.toString('base64');
}

// ── Screen Analysis with Claude Vision ──────────────────────────────────

export async function analyzeScreen(query: string): Promise<ScreenAnalysis> {
  const screenshot = await captureScreenBase64();
  if (!screenshot) return { description: 'Could not capture screen', activeApp: 'unknown', elements: [], suggestions: [] };
  const api = getClient();
  const response = await api.messages.create({
    model: MODEL, max_tokens: 1024,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } },
      { type: 'text', text: `Analyze this screenshot. ${query}\n\nReturn JSON:\n{"description":"brief description","activeApp":"app name","elements":[{"description":"element","x":pixel_x,"y":pixel_y,"type":"button|input|link|text|icon|menu|tab|other"}],"suggestions":["next steps"]}\n\nMax 10 elements. Coordinates = approximate center.` },
    ]}],
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch {}
  return { description: text, activeApp: 'unknown', elements: [], suggestions: [] };
}

// ── Find Specific Element ───────────────────────────────────────────────

export async function findElement(description: string, maxRetries: number = 2): Promise<{ x: number; y: number } | null> {
  const prompts = [
    `Find this element on the screen: "${description}"\nReturn ONLY JSON: {"x":pixel_x,"y":pixel_y,"found":true} or {"found":false}`,
    `Look carefully for: "${description}"\nIt might be hidden or use different wording.\nReturn ONLY JSON: {"x":pixel_x,"y":pixel_y,"found":true} or {"found":false}`,
    `Search every part of the screen for: "${description}"\nReturn ONLY JSON: {"x":pixel_x,"y":pixel_y,"found":true} or {"found":false}`,
  ];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const screenshot = await captureScreenBase64();
      if (!screenshot) continue;
      const api = getClient();
      const response = await api.messages.create({
        model: MODEL, max_tokens: 256,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } },
          { type: 'text', text: prompts[attempt] || prompts[0] },
        ]}],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { const r = JSON.parse(m[0]); if (r.found && r.x && r.y) return { x: r.x, y: r.y }; }
    } catch (err: any) { console.error(`[Vision] Attempt ${attempt + 1} error:`, err.message); }
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ── Describe Current Screen ─────────────────────────────────────────────

export async function describeScreen(): Promise<string> {
  const analysis = await analyzeScreen('Describe what is currently showing on the screen in 1-2 sentences.');
  return analysis.description;
}
