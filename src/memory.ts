import { supabase } from './supabase';
import type { Attach } from './api';

// App-level (global) memory: facts/preferences the user asks Go Farther to keep.
// Stored per-user in Supabase (RLS-scoped), fed into every chat's system prompt
// so the assistant personalizes across conversations. Manual only — the user
// adds/removes these here (nothing is captured automatically). A memory may also
// carry one attachment: the original file is kept and its contents are extracted
// into `content` (the text the AI uses).
export interface MemAttachment { path: string; type: string; name: string }
export interface Memory {
  id: string;
  content: string;
  created_at: string;
  attachment_path?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
}

const SEL = 'id,content,created_at,attachment_path,attachment_type,attachment_name';

export async function listMemories(): Promise<Memory[]> {
  try {
    const { data, error } = await supabase
      .from('user_memory')
      .select(SEL)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as Memory[];
  } catch {
    return [];
  }
}

export async function addMemory(content: string, attachment?: MemAttachment): Promise<Memory | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const row: Record<string, unknown> = { user_id: uid, content };
    if (attachment) {
      row.attachment_path = attachment.path;
      row.attachment_type = attachment.type;
      row.attachment_name = attachment.name;
    }
    const { data, error } = await supabase.from('user_memory').insert(row).select(SEL).single();
    if (error || !data) return null;
    return data as Memory;
  } catch {
    return null;
  }
}

// Upload an attachment to the user's private memory bucket; returns its path.
export async function uploadMemoryFile(attach: Attach): Promise<string | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const ext = (attach.name?.split('.').pop() || (attach.kind === 'pdf' ? 'pdf' : 'jpg')).toLowerCase().slice(0, 8);
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const bytes = Uint8Array.from(atob(attach.data), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage.from('memory').upload(path, bytes, { contentType: attach.mediaType, upsert: false });
    return error ? null : path;
  } catch {
    return null;
  }
}

// A short-lived signed URL to open/view a memory attachment.
export async function memoryFileUrl(path: string): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from('memory').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// Resolve one memory's attachment (by id) to a viewable URL — used when the
// assistant surfaces a saved photo/file in chat. RLS scopes this to the owner.
export async function memoryAttachment(id: string): Promise<{ type: string; name: string; url: string } | null> {
  try {
    const { data } = await supabase
      .from('user_memory')
      .select('attachment_path,attachment_type,attachment_name')
      .eq('id', id)
      .maybeSingle();
    if (!data?.attachment_path) return null;
    const url = await memoryFileUrl(data.attachment_path);
    if (!url) return null;
    return { type: data.attachment_type || 'file', name: data.attachment_name || 'Attachment', url };
  } catch {
    return null;
  }
}

export async function updateMemory(id: string, content: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_memory')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteMemory(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('user_memory').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// Whole-feature on/off, stored server-side so it applies everywhere — chats AND
// background workflow runs (which the device-only flag couldn't reach).
export async function getMemoryEnabled(): Promise<boolean> {
  try {
    const { data } = await supabase.from('user_settings').select('memory_on').maybeSingle();
    return data ? !!data.memory_on : true; // default on
  } catch {
    return true;
  }
}

export async function setMemoryEnabled(on: boolean): Promise<void> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return;
    await supabase.from('user_settings').upsert({ user_id: uid, memory_on: on, updated_at: new Date().toISOString() });
  } catch {
    /* ignore — localStorage still reflects the choice locally */
  }
}
