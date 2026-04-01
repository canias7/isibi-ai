/**
 * ISIBI Ghost Mode — Persistent Configuration
 *
 * Stores API key, first-run flag, and permission status
 * in the OS-standard app data directory.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentProfileData {
  id: string;
  name: string;
  emoji: string;
  role: string;
  instructions: string;
  isActive: boolean;
  color: string;
  createdAt: string;
}

export interface GhostModeConfig {
  firstRunComplete: boolean;
  anthropicApiKey: string;
  accessibilityGranted: boolean;
  screenRecordingGranted: boolean;
  assistantName: string;
  assistantWakeWord: string;
  language: string;
  elevenLabsApiKey: string;
  selectedVoiceId: string;
  agents: AgentProfileData[];
}

const DEFAULTS: GhostModeConfig = {
  firstRunComplete: false,
  anthropicApiKey: '',
  accessibilityGranted: false,
  screenRecordingGranted: false,
  assistantName: 'Isibi',
  assistantWakeWord: 'hey isibi',
  language: '',
  elevenLabsApiKey: '',
  selectedVoiceId: '',
  agents: [],
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): GhostModeConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial: Partial<GhostModeConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...partial };
  const dir = path.dirname(configPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
}

export function isFirstRun(): boolean {
  return !loadConfig().firstRunComplete;
}

// Bundled keys — customers don't need to provide their own
const BUNDLED_KEY = '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';
const BUNDLED_ELEVEN_KEY = 'sk_66d8a0471797c1ab6cae2db1913df95f08749e1c9bef2489';

export function getAssistantName(): string {
  return loadConfig().assistantName || 'Isibi';
}

export function getWakeWord(): string {
  return loadConfig().assistantWakeWord || 'hey isibi';
}

export function getLanguage(): string {
  return loadConfig().language || '';
}

export function getElevenLabsKey(): string {
  const key = loadConfig().elevenLabsApiKey;
  return key || BUNDLED_ELEVEN_KEY;
}

export function getSelectedVoiceId(): string {
  return loadConfig().selectedVoiceId || '';
}

export function getApiKey(): string {
  // Config override → env var → bundled key
  const key = loadConfig().anthropicApiKey;
  return key || process.env.ANTHROPIC_API_KEY || BUNDLED_KEY;
}
