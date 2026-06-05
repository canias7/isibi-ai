import { supabase, SUPABASE_ANON_KEY } from './supabase';
import { CONNECT_API } from './connectorData';

export interface MsgAttachment {
  name: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  contentId?: string;
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

// Fetch one email's real HTML + attachment list (for the reader's true-to-life
// view), straight from the connector backend by message id — out-of-band from
// the chat model.
export async function fetchEmailHtml(
  id: string,
): Promise<{ html: string; hasImages: boolean; attachments: MsgAttachment[] }> {
  const token = await authToken();
  const res = await fetch(`${CONNECT_API}/message?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Message fetch failed: ${res.status}`);
  const j = await res.json();
  if (j.error || typeof j.html !== 'string') throw new Error(j.error || 'No HTML');
  return { html: j.html, hasImages: !!j.hasImages, attachments: Array.isArray(j.attachments) ? j.attachments : [] };
}

// Fetch one attachment's bytes (base64) or hosted URL — for inline images,
// preview, and download.
export async function fetchAttachment(mid: string, aid: string, name = 'file'): Promise<{ b64?: string; url?: string }> {
  const token = await authToken();
  const res = await fetch(
    `${CONNECT_API}/attachment?mid=${encodeURIComponent(mid)}&aid=${encodeURIComponent(aid)}&name=${encodeURIComponent(name)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return { b64: j.b64 || undefined, url: j.url || undefined };
}

export type Role = 'user' | 'assistant';

// A user-attached image or PDF. `data` is base64 WITHOUT the data-URL prefix.
// (Stripped from `data` before persisting to localStorage to avoid quota bloat.)
export interface Attach {
  kind: 'image' | 'pdf';
  mediaType: string;
  data: string;
  name: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  attachments?: Attach[];
}

// Go Farther backend: a Supabase Edge Function running Claude (the `chat`
// function in the gofarther-ai project). Override with VITE_CHAT_API if needed.
const CHAT_API =
  (import.meta.env.VITE_CHAT_API as string | undefined) ??
  'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/chat';

/**
 * Stream an assistant reply, delivering text chunks via `onToken`.
 * POSTs { messages } to the backend and reads the streamed text response.
 */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
  apps?: string[],
): Promise<void> {
  // Send the signed-in user's access token so the backend acts as *this* user
  // (their connected apps), not a shared identity. Falls back to anon.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;

  // Device timezone so the assistant shows times in the user's local time.
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* keep UTC */
  }

  const res = await fetch(CHAT_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    // `apps` = connector ids enabled for this session (undefined = use all connected).
    // `cards: true` signals this client can render rich blocks (e.g. inbox cards),
    // so the backend only emits them to bundles that know how to display them.
    body: JSON.stringify({ messages, tz, cards: true, ...(apps ? { apps } : {}) }),
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
