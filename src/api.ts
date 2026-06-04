export type Role = 'user' | 'assistant';
export interface ChatMessage {
  role: Role;
  content: string;
}

// Go Farther backend: a Supabase Edge Function running Claude (the `chat`
// function in the gofarther-ai project). Override with VITE_CHAT_API if needed.
const CHAT_API =
  (import.meta.env.VITE_CHAT_API as string | undefined) ??
  'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/chat';

// Public anon key — safe to ship in the client; required to reach the function.
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcGZlcXJlbHZ6aWx0ZndwdXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1Mjk2NDMsImV4cCI6MjA5NjEwNTY0M30.DZ_mssAlWiGj-6xLG7Z_srt0taV-mXbbRzazQ29P2xw';

/**
 * Stream an assistant reply, delivering text chunks via `onToken`.
 * POSTs { messages } to the backend and reads the streamed text response.
 */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(CHAT_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Chat API error: ${res.status}`);
  }
  if (!res.body) throw new Error('No response stream from the assistant.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onToken(decoder.decode(value, { stream: true }));
  }
}
