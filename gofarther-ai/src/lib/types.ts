/** GoFarther AI — Shared Types */

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

/** Generate a unique ID */
export function genId(): string {
  return uuidv4();
}

/** Chat message used across ChatScreen and AgentsScreen */
export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  action?: ActionPayload;
  actionStatus?: 'confirm' | 'running' | 'done' | 'failed' | 'cancelled';
  imageUrl?: string;
  fileUrl?: string;
  fileMimeType?: string;
  isCreatingFile?: boolean;
  timestamp?: number;
  stats?: { tokens: number; durationMs: number };
  reaction?: 'up' | 'down';
  queued?: boolean;
}

/** Action payload from AI response */
export interface ActionPayload {
  type: string;
  target?: string;
  text?: string;
  key?: string;
  file_ids?: string[];
  chain_ops?: { operation: string; instructions?: string; target_format?: string }[];
  save_contact?: { label: string; name?: string; email?: string; phone?: string };
  [extra: string]: any; // Allow additional fields from AI without dropping them
}

/** Parse action JSON from AI response text */
export function parseAction(response: string): { cleanText: string; action: ActionPayload | null } {
  // Try simple single-line JSON first
  try {
    const match = response.match(/\{[^{}]*"type"\s*:\s*"[^"]+\"[^{}]*\}/);
    if (match) {
      const action = JSON.parse(match[0]) as ActionPayload;
      const cleanText = response.replace(match[0], '').trim();
      return { cleanText, action };
    }
  } catch {}

  // Try multi-line JSON (AI sometimes puts content with newlines)
  try {
    const start = response.indexOf('{"type"');
    if (start !== -1) {
      // Find the matching closing brace
      let depth = 0;
      let end = -1;
      for (let i = start; i < response.length; i++) {
        if (response[i] === '{') depth++;
        if (response[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end > start) {
        const jsonStr = response.substring(start, end);
        const action = JSON.parse(jsonStr) as ActionPayload;
        const cleanText = (response.substring(0, start) + response.substring(end)).trim();
        return { cleanText, action };
      }
    }
  } catch {}

  return { cleanText: response, action: null };
}

/** Friendly label for an action */
export function actionLabel(a: ActionPayload): string {
  const target = a.target || '';
  const text = a.text ? ` saying "${a.text}"` : '';
  switch (a.type) {
    case 'call': return `I'll call ${target}.`;
    case 'sms': return `I'll send a text to ${target}${text}.`;
    case 'email': return `I'll email ${target}${text}.`;
    case 'open_url': return `I'll open that link.`;
    case 'maps': return `I'll search maps for ${target}.`;
    case 'directions': return `I'll get directions to ${target}.`;
    case 'search': return `I'll search for ${target}.`;
    default: return `I'll ${a.type} ${target}.`;
  }
}
