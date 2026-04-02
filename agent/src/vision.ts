/**
 * Vision Module — screen capture DISABLED to avoid macOS permission popup.
 *
 * All vision functions return graceful failures so the app still works
 * but doesn't trigger the Screen Recording permission dialog.
 *
 * To re-enable: grant Screen Recording permission in System Settings,
 * then restore the screencapture code.
 */

import Anthropic from '@anthropic-ai/sdk';
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

// ── Screenshot Capture (DISABLED) ──────────────────────────────────────

export async function captureScreen(): Promise<Buffer> {
  // Disabled — triggers macOS Screen Recording permission popup on unsigned apps
  console.log('[Vision] Screen capture disabled to avoid permission popup');
  return Buffer.alloc(0);
}

export async function captureScreenBase64(): Promise<string> {
  return '';
}

// ── Screen Analysis (returns empty results) ────────────────────────────

export async function analyzeScreen(query: string): Promise<ScreenAnalysis> {
  console.log('[Vision] analyzeScreen disabled:', query);
  return {
    description: 'Vision disabled — use keyboard shortcuts instead',
    activeApp: 'unknown',
    elements: [],
    suggestions: [],
  };
}

// ── Find Element (always returns null) ─────────────────────────────────

export async function findElement(description: string, maxRetries: number = 2): Promise<{ x: number; y: number } | null> {
  console.log('[Vision] findElement disabled for:', description);
  return null;
}

// ── Describe Screen ────────────────────────────────────────────────────

export async function describeScreen(): Promise<string> {
  return 'Vision disabled — use keyboard shortcuts instead';
}
