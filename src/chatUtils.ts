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

// Drop failed/empty assistant placeholders (the "couldn't send / finishing in
// the background" bubbles). They're UI state, not conversation content: sent to
// the model they make it answer the wrong message, and synced to the cloud they
// can overwrite a real reply the server saved — which permanently breaks
// adoption (the server copy then "has no real reply"). Used on every outgoing
// turn history and on every cloud save; the local copy keeps them so Retry
// still works after a relaunch.
export function withoutPlaceholders(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !(m.role === 'assistant' && (m.failed || !m.content.trim())));
}

// Is the server's copy of a conversation a *more complete* version of what we
// hold locally? True when it has more messages, or the same turns but a finished
// assistant reply where ours is still empty/failed. This lets resume + retry
// adopt a turn the backend completed while we were disconnected — instead of
// re-running it, which would duplicate any action it performed (a second send, a
// second delete). A shorter or empty server copy is never "more complete".
// The local side is compared without its placeholder bubbles (the server never
// stores those), so stacked pending turns can't make the local copy look
// "longer" than a server copy that actually has more real content.
export function serverIsMoreComplete(localRaw: ChatMessage[], remote: ChatMessage[]): boolean {
  const local = withoutPlaceholders(localRaw);
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

// What to do with a pending (failed/disconnected) turn when we get a chance to
// recover it. This is the heart of the recovery state machine — getting it wrong
// re-runs a turn that already happened, duplicating its action (a second send, a
// second payment). Inputs:
//   serverMoreComplete — the server's saved copy already has this turn's reply
//                        (adopt it; NEVER re-run).
//   hasRemote          — we actually reached the server to check. If false we
//                        can't tell what it holds, so we never re-send on a guess
//                        unless the user explicitly forces it.
//   sent               — the request reached the server before the failure, so the
//                        server will finish it on its own; adopt-only unless forced.
//   force              — the user tapped "Send again" from the stalled state.
export type RetryAction = 'adopt' | 'resend' | 'wait';
export function decideRetry(o: { sent: boolean; hasRemote: boolean; serverMoreComplete: boolean; force: boolean }): RetryAction {
  if (o.serverMoreComplete) return 'adopt';   // server already has the reply — take it, don't re-run
  if (!o.hasRemote && !o.force) return 'wait'; // couldn't check; don't re-send on a guess
  if (o.sent && !o.force) return 'wait';       // it reached the server; let the server finish it
  return 'resend';
}

// Merge a newly-typed message into one already queued behind an in-flight reply
// (stack the text, keep the attachments capped). Pure so the queue behaviour is
// testable without the component.
export function mergeQueued<A>(existing: { text: string; atts: A[] } | null, text: string, atts: A[], cap = 6): { text: string; atts: A[] } {
  return existing
    ? { text: `${existing.text}\n${text}`.trim(), atts: [...existing.atts, ...atts].slice(-cap) }
    : { text, atts };
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
  return s.replace(/```gf[\s\S]*?```/g, '').replace(/\[\[gf(id|status|sync):[^\]]*\]\]/g, '').trim();
}
