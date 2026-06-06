import { supabase } from './supabase';

// App-level (global) memory: facts/preferences the user asks Go Farther to keep.
// Stored per-user in Supabase (RLS-scoped), fed into every chat's system prompt
// so the assistant personalizes across conversations. Manual only — the user
// adds/removes these here (nothing is captured automatically).
export interface Memory {
  id: string;
  content: string;
  created_at: string;
}

export async function listMemories(): Promise<Memory[]> {
  try {
    const { data, error } = await supabase
      .from('user_memory')
      .select('id,content,created_at')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as Memory[];
  } catch {
    return [];
  }
}

export async function addMemory(content: string): Promise<Memory | null> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from('user_memory')
      .insert({ user_id: uid, content })
      .select('id,content,created_at')
      .single();
    if (error || !data) return null;
    return data as Memory;
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
