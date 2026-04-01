/**
 * ISIBI Ghost Mode — Persistent Configuration
 *
 * Stores API key, first-run flag, and permission status
 * in the OS-standard app data directory.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Simple encryption for config — uses machine-unique key
const ENCRYPTION_KEY = crypto.createHash('sha256').update(require('os').hostname() + require('os').userInfo().username + 'isibi-ghost').digest();
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

export interface AgentProfileData {
  id: string;
  name: string;
  emoji: string;
  role: string;
  instructions: string;
  isActive: boolean;
  color: string;
  createdAt: string;
  creditsUsed: number;
  commandCount: number;
  actionCount: number;
}

export interface ScheduledTask {
  id: string;
  agentId: string;
  command: string;
  cron: string; // "HH:MM" for daily, or "weekday HH:MM", or "interval:minutes"
  enabled: boolean;
  lastRun?: string;
  label?: string;
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
  schedules: ScheduledTask[];
  credits: number;
  creditsUsed: number;
  plan: string;
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
  schedules: [],
  credits: 1000,
  creditsUsed: 0,
  plan: 'free',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): GhostModeConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    // Try encrypted first, fall back to plain JSON (migration)
    try {
      return { ...DEFAULTS, ...JSON.parse(decrypt(raw)) };
    } catch {
      // Plain JSON (old format) — will be encrypted on next save
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial: Partial<GhostModeConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...partial };
  const dir = path.dirname(configPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), encrypt(JSON.stringify(merged)));
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

export function getCredits(): { total: number; used: number; remaining: number; plan: string } {
  const c = loadConfig();
  return { total: c.credits || 1000, used: c.creditsUsed || 0, remaining: (c.credits || 1000) - (c.creditsUsed || 0), plan: c.plan || 'free' };
}

export function useCredits(amount: number, agentId?: string): boolean {
  const c = loadConfig();
  const remaining = (c.credits || 1000) - (c.creditsUsed || 0);
  if (remaining < amount) return false; // Not enough credits
  c.creditsUsed = (c.creditsUsed || 0) + amount;
  // Track per agent
  if (agentId && c.agents) {
    const agent = c.agents.find(a => a.id === agentId);
    if (agent) {
      agent.creditsUsed = (agent.creditsUsed || 0) + amount;
    }
  }
  saveConfig({ creditsUsed: c.creditsUsed, agents: c.agents });
  return true;
}

export function trackAgentUsage(agentId: string, commands: number, actions: number): void {
  const c = loadConfig();
  if (c.agents) {
    const agent = c.agents.find(a => a.id === agentId);
    if (agent) {
      agent.commandCount = (agent.commandCount || 0) + commands;
      agent.actionCount = (agent.actionCount || 0) + actions;
      saveConfig({ agents: c.agents });
    }
  }
}

export function getSchedules(): ScheduledTask[] {
  return loadConfig().schedules || [];
}

export function saveSchedule(schedule: ScheduledTask): void {
  const config = loadConfig();
  const schedules = config.schedules || [];
  const idx = schedules.findIndex(s => s.id === schedule.id);
  if (idx >= 0) schedules[idx] = schedule;
  else schedules.push(schedule);
  saveConfig({ schedules });
}

export function deleteSchedule(id: string): void {
  const config = loadConfig();
  saveConfig({ schedules: (config.schedules || []).filter(s => s.id !== id) });
}

export function getApiKey(): string {
  // Config override → env var → bundled key
  const key = loadConfig().anthropicApiKey;
  return key || process.env.ANTHROPIC_API_KEY || BUNDLED_KEY;
}
