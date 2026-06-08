import type { ChatMessage } from './api';

// Pure helpers for chat state — extracted from App so they can be unit-tested
// (and to slim the main component). No React, no I/O.

// Drop heavy base64 from attachments (keep the meta so a chip still renders) —
// used before persisting locally and syncing, to avoid bloating storage/DB.
export function slimMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.attachments?.length ? { ...m, attachments: m.attachments.map((a) => ({ ...a, data: '' })) } : m,
  );
}

// A fetch/connectivity failure (vs. a real API/HTTP error) — used to queue a
// send for retry instead of showing a hard error.
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch network failures are TypeErrors
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /network|failed to fetch|load failed|connection|offline|err_internet/.test(m);
}

// Is the server's copy of a conversation a *more complete* version of what we
// hold locally? True when it has more messages, or the same turns but a finished
// assistant reply where ours is still empty/failed. This lets resume + retry
// adopt a turn the backend completed while we were disconnected — instead of
// re-running it, which would duplicate any action it performed (a second send, a
// second delete). A shorter or empty server copy is never "more complete".
export function serverIsMoreComplete(local: ChatMessage[], remote: ChatMessage[]): boolean {
  if (remote.length === 0) return false;
  if (remote.length > local.length) return true;
  if (remote.length < local.length) return false;
  const ours = local[local.length - 1];
  const theirs = remote[remote.length - 1];
  if (!theirs || theirs.role !== 'assistant' || theirs.content.trim() === '') return false; // server has no real reply yet
  if (!ours || ours.role !== 'assistant' || ours.failed) return true; // ours is missing/failed
  // Same turn, both assistant: adopt if the server's reply is more complete than
  // ours — ours was empty, or only partially streamed before we disconnected.
  return theirs.content.trim().length > ours.content.trim().length;
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const t = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  return t ? (t.length > 42 ? t.slice(0, 42) + '…' : t) : 'New chat';
}

// Hide the internal "open email" marker from the user's chat bubble.
export function cleanForDisplay(s: string): string {
  return s.replace(/\s*\[\[gfid:[^\]]*\]\]/g, '');
}

// Short label for the model that answered (from the x-gf-model header).
export function modelShort(m: string): string {
  if (/haiku/i.test(m)) return 'haiku';
  if (/sonnet/i.test(m)) return 'sonnet';
  if (/opus/i.test(m)) return 'opus';
  return m.replace(/^claude-/, '');
}

// The copyable plain text of an assistant reply — strips rich card blocks and
// the internal marker, so "Copy" yields readable text (and is hidden for a
// card-only reply where there's nothing to copy).
export function plainText(s: string): string {
  return s.replace(/```gf[\s\S]*?```/g, '').replace(/\[\[gf(id|status):[^\]]*\]\]/g, '').trim();
}
