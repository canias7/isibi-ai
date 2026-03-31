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
  agents: AgentProfileData[];
}

const DEFAULTS: GhostModeConfig = {
  firstRunComplete: false,
  anthropicApiKey: '',
  accessibilityGranted: false,
  screenRecordingGranted: false,
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

export function getApiKey(): string {
  // Config takes priority, fall back to env var
  const key = loadConfig().anthropicApiKey;
  return key || process.env.ANTHROPIC_API_KEY || '';
}
