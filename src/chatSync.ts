import { supabase } from './supabase';
import { slimMessages, withoutPlaceholders } from './chatUtils';
import type { ChatMessage } from './api';

// Chat persistence — the local cache (instant on launch) and the cloud mirror.
// Pure module: no React, no component state. Extracted from App.tsx.

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export const MAX_CHATS = 50;
const chatsKey = (uid: string) => `gf_chats_${uid}`;

export function loadChats(uid: string): Conversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(chatsKey(uid)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveChats(uid: string, chats: Conversation[]) {
  try {
    const slim = chats.slice(0, MAX_CHATS).map((c) => ({ ...c, messages: slimMessages(c.messages) }));
    localStorage.setItem(chatsKey(uid), JSON.stringify(slim));
  } catch {
    /* storage full / unavailable */
  }
}

// Pinned chat ids (device-local — kept separate from the synced chat list so a
// cloud merge can't wipe them).
const pinsKey = (uid: string) => `gf_pins_${uid}`;
export function loadPins(uid: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(pinsKey(uid)) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}
export function wipeStoredChats(uid: string) {
  try { localStorage.removeItem(chatsKey(uid)); localStorage.removeItem(pinsKey(uid)); } catch { /* ignore */ }
}

export function savePins(uid: string, pins: Set<string>) {
  try { localStorage.setItem(pinsKey(uid), JSON.stringify([...pins])); } catch { /* ignore */ }
}

export async function syncLoad(uid: string): Promise<Conversation[] | null> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,messages,updated_at')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false })
      .limit(MAX_CHATS);
    if (error || !data) return null;
    return data.map((r: { id: string; title: string; messages: unknown; updated_at: string }) => ({
      id: r.id,
      title: r.title || 'New chat',
      messages: Array.isArray(r.messages) ? (r.messages as ChatMessage[]) : [],
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  } catch {
    return null;
  }
}
export async function syncSave(uid: string, c: Conversation) {
  try {
    await supabase.from('conversations').upsert({
      user_id: uid,
      id: c.id,
      title: c.title,
      // Placeholders never go to the cloud: a failed/empty bubble synced over a
      // reply the server saved makes that reply unadoptable (and unrecoverable).
      messages: slimMessages(withoutPlaceholders(c.messages)),
      updated_at: new Date(c.updatedAt || Date.now()).toISOString(),
    });
  } catch {
    /* offline — local copy still saved */
  }
}
export async function syncDelete(uid: string, id: string) {
  try {
    await supabase.from('conversations').delete().eq('user_id', uid).eq('id', id);
  } catch {
    /* offline */
  }
}
