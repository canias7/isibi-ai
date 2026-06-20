import { supabase, SUPABASE_ANON_KEY } from './supabase';
import { CONNECT_API } from './connectorData';
import type { GeoLoc } from './geo';
import type { EmailItem, ContactItem } from './EmailList';

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
export interface EmailMeta {
  from?: string; email?: string; to?: string; subject?: string; date?: string; unread?: boolean; app?: string;
}
export async function fetchEmailHtml(
  id: string,
  app?: string,
): Promise<{ html: string; hasImages: boolean; attachments: MsgAttachment[]; meta: EmailMeta }> {
  const token = await authToken();
  const q = `id=${encodeURIComponent(id)}${app ? `&app=${encodeURIComponent(app)}` : ''}`;
  const res = await fetch(`${CONNECT_API}/message?${q}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Message fetch failed: ${res.status}`);
  const j = await res.json();
  if (j.error || typeof j.html !== 'string') throw new Error(j.error || 'No HTML');
  return {
    html: j.html,
    hasImages: !!j.hasImages,
    attachments: Array.isArray(j.attachments) ? j.attachments : [],
    meta: { from: j.from, email: j.email, to: j.to, subject: j.subject, date: j.date, unread: j.unread, app: j.app },
  };
}

// Fetch a page of recent inbox emails directly (no chat turn) — the Email Agent
// renders these with <EmailList>; same card shape the chat pipeline produces.
// Page through with the returned nextPageToken (Gmail page tokens).
const INBOX_API = CONNECT_API.replace(/\/gmail-oauth$/, '/inbox');
export async function fetchInbox(max = 20, pageToken?: string): Promise<{ items: EmailItem[]; nextPageToken: string | null }> {
  const token = await authToken();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const q = `max=${max}&tz=${encodeURIComponent(tz)}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
  const res = await fetch(`${INBOX_API}?${q}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Inbox fetch failed: ${res.status}`);
  const j = await res.json();
  return { items: Array.isArray(j.items) ? j.items : [], nextPageToken: j.nextPageToken ?? null };
}

// Fetch the user's contacts directly (no chat turn) — rendered with <ContactsList>.
const CONTACTS_API = CONNECT_API.replace(/\/gmail-oauth$/, '/contacts');
export async function fetchContacts(): Promise<ContactItem[]> {
  const token = await authToken();
  const res = await fetch(CONTACTS_API, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Contacts fetch failed: ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.items) ? j.items : [];
}

// Send an email (Composio GMAIL_SEND_EMAIL, server-verified). Returns on success,
// throws on failure so the composer can show an error.
const SEND_API = CONNECT_API.replace(/\/gmail-oauth$/, '/gmail-send');
export async function sendEmail(msg: { to: string; subject: string; body: string; threadId?: string; cc?: string[]; bcc?: string[] }): Promise<void> {
  const token = await authToken();
  const res = await fetch(SEND_API, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(msg),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || `Send failed: ${res.status}`);
}

// Fetch one attachment's bytes (base64) or hosted URL — for inline images,
// preview, and download. `app` routes to the right mailbox provider.
export async function fetchAttachment(mid: string, aid: string, name = 'file', app?: string): Promise<{ b64?: string; url?: string }> {
  const token = await authToken();
  const res = await fetch(
    `${CONNECT_API}/attachment?mid=${encodeURIComponent(mid)}&aid=${encodeURIComponent(aid)}&name=${encodeURIComponent(name)}${app ? `&app=${encodeURIComponent(app)}` : ''}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return { b64: j.b64 || undefined, url: j.url || undefined };
}

export type Role = 'user' | 'assistant';

// A user-attached image, PDF, or document (Word/Excel/CSV/text -> kind 'file').
// `data` is base64 WITHOUT the data-URL prefix. (Stripped from `data` before
// persisting to localStorage to avoid quota bloat.) For 'file' kinds the backend
// uploads the bytes to the Files API and stamps `fileId` so the code execution
// tool can read the document.
export interface Attach {
  kind: 'image' | 'pdf' | 'file';
  mediaType: string;
  data: string;
  name: string;
  fileId?: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  id?: string; // stable client-side id, used as the React list key
  attachments?: Attach[];
  failed?: boolean;  // a turn whose connection dropped — shows a retry/refresh affordance
  offline?: boolean; // the drop happened while genuinely offline (vs. backgrounded mid-reply)
  sent?: boolean;    // the request reached the server before the drop — it finishes the turn; never auto re-send
  stalled?: boolean; // recovery (auto-retry / polling) gave up — show a terminal state instead of a spinner
  model?: string;    // which model answered, from the x-gf-model response header
  fb?: 'up' | 'down'; // the user's thumbs feedback on this reply (also tracked in analytics)
  ts?: number;       // when the reply finished (ms) — shown faintly, freshness for data answers
}

// Marks an error thrown *after* the request reached the server (response headers
// arrived) — the backend will finish and save the turn, so a retry must adopt
// the server's copy rather than re-send (re-running could duplicate an action).
export function reachedServer(e: unknown): boolean {
  return e instanceof Error && (e as Error & { gfSent?: boolean }).gfSent === true;
}
function tagSent(e: unknown): never {
  if (e instanceof Error) (e as Error & { gfSent?: boolean }).gfSent = true;
  throw e;
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
  conversationId?: string,
  onModel?: (model: string) => void,
  memoryOn?: boolean,
  location?: GeoLoc,
  model?: string, // user's model choice ('auto'|'haiku'|'sonnet'|'opus'); omitted/auto -> backend routes
  util?: boolean, // tiny utility call (title, extraction): bare fast model, no tools — far cheaper
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
    // `memory: false` pauses the whole memory feature for this turn (no injection,
    // and the save-memory tool is dropped). Omitted when on (server defaults to on).
    body: JSON.stringify({ messages, tz, cards: true, ...(apps ? { apps } : {}), ...(conversationId ? { conversationId } : {}), ...(memoryOn === false ? { memory: false } : {}), ...(location ? { location } : {}), ...(model && model !== 'auto' ? { model } : {}), ...(util ? { util: true } : {}) }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Chat API error: ${res.status}`);
  }
  if (!res.body) throw new Error('No response stream from the assistant.');

  // From here the server HAS the request and will finish the turn even if the
  // stream breaks (backgrounded, flaky radio) — tag any failure so the caller
  // knows to wait for the server's copy instead of re-sending.
  try {
    // Which model answered (server stamps it on the response; CORS-exposed).
    if (onModel) {
      const m = res.headers.get('x-gf-model');
      if (m) onModel(m);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onToken(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode(); // flush any bytes buffered across the final chunk (e.g. a split emoji)
    if (tail) onToken(tail);
  } catch (e) {
    tagSent(e);
  }
}

// One-shot title for a new conversation (3-5 words, sidebar-sized). Memory and
// connectors are scoped off — this is a cheap utility call, not a user turn.
export async function titleFor(userText: string, replyText: string): Promise<string> {
  let out = '';
  try {
    await streamChat(
      [{
        role: 'user',
        content: `Write a 3-5 word title for this conversation. Reply with ONLY the title - no quotes, no trailing period.\n\nUser: ${userText.slice(0, 280)}\nAssistant: ${replyText.slice(0, 280)}`,
      }],
      (t) => { out += t; },
      undefined, [], undefined, undefined,
      false, // memory off for this utility call
      undefined, // location
      undefined, // model (util ignores it)
      true, // util mode: bare fast model, no tools
    );
  } catch {
    return '';
  }
  return out.replace(/\[\[gfstatus:[^\]]*\]\]/g, '').replace(/["\u201c\u201d.]/g, '').trim().slice(0, 60);
}

// Read an attachment (image/PDF) into a concise memory line, via the chat model's
// vision. Memory is off for this call so it doesn't pull in other memories or the
// save tool — we just want the extracted text.
export async function extractMemory(attach: Attach, note: string): Promise<string> {
  const prompt = note.trim()
    ? `The user wants to remember this attachment. Their note: "${note.trim()}". Read the attachment and write ONE concise memory line capturing the key facts (merge in their note). Reply with ONLY that line — no preamble, no markdown.`
    : `Read this attachment and write ONE concise memory line capturing the key facts to remember (e.g. a contact's name/email/phone, or the gist of a document). Reply with ONLY that line — no preamble, no markdown.`;
  let out = '';
  await streamChat(
    [{ role: 'user', content: prompt, attachments: [attach] }],
    (t) => { out += t; },
    undefined, undefined, undefined, undefined,
    false, // memory off for this utility call
    undefined, // location
    undefined, // model (util ignores it)
    true, // util mode: bare fast model (vision-capable), no tools
  );
  return out
    .replace(/\[\[gfstatus:[^\]]*\]\]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ask the backend to send THIS user a push, using their own session — a one-tap
// way to verify notifications work end-to-end. The function pushes only to the
// caller's own registered devices.
const FUNCTIONS_BASE = CHAT_API.replace(/\/chat$/, '');
export interface PushResult { token: string; status: number; reason: string; host?: string }
export async function sendTestPush(): Promise<{ ok: boolean; error?: string; sent?: PushResult[] }> {
  const token = await authToken();
  const res = await fetch(`${FUNCTIONS_BASE}/send-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ title: 'Go Farther', body: 'Test notification ✅' }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: !!j.ok, error: j.error, sent: Array.isArray(j.sent) ? j.sent : undefined };
}
