export type Role = 'user' | 'assistant';
export interface ChatMessage {
  role: Role;
  content: string;
}

const CHAT_API = import.meta.env.VITE_CHAT_API as string | undefined;

/**
 * Stream an assistant reply, delivering text chunks via `onToken`.
 *
 * If VITE_CHAT_API is set, it POSTs { messages } to that endpoint and reads a
 * streamed text/plain (or SSE-ish) response. Otherwise it falls back to a local
 * mock so the UI works out of the box — swap in a real model (e.g. Claude via a
 * Supabase Edge Function) by setting VITE_CHAT_API.
 */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (CHAT_API) {
    const res = await fetch(CHAT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Chat API error: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onToken(decoder.decode(value, { stream: true }));
    }
    return;
  }
  await mockStream(messages, onToken, signal);
}

/** Local placeholder that streams a canned reply word-by-word. */
async function mockStream(
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const reply =
    `You said: “${lastUser}”.\n\n` +
    `This is a demo reply from the local mock. Set VITE_CHAT_API to a chat ` +
    `endpoint (e.g. a Supabase Edge Function proxying Claude) and I'll stream ` +
    `real answers here.`;
  for (const tok of reply.split(/(\s+)/)) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 22));
    onToken(tok);
  }
}
