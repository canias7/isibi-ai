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
export async function fetchInbox(max = 20, pageToken?: string, app = 'gmail'): Promise<{ items: EmailItem[]; nextPageToken: string | null }> {
  const token = await authToken();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const q = `max=${max}&tz=${encodeURIComponent(tz)}&app=${encodeURIComponent(app)}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
  const res = await fetch(`${INBOX_API}?${q}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Inbox fetch failed: ${res.status}`);
  const j = await res.json();
  return { items: Array.isArray(j.items) ? j.items : [], nextPageToken: j.nextPageToken ?? null };
}

// Combined inbox with paging: fetch one page from each requested mailbox (using
// its OWN page token), merge newest-first across providers (by the `ts` epoch the
// backend stamps), and hand back each provider's NEXT token so "Load older" can
// pull the next page per mailbox and append. One provider failing doesn't sink it.
export interface MergedPage { items: EmailItem[]; next: Record<string, string | null> }
export async function fetchInboxMergedPaged(reqs: { app: string; token?: string }[], per = 30): Promise<MergedPage> {
  const results = await Promise.all(
    reqs.map((r) =>
      fetchInbox(per, r.token, r.app)
        .then((res) => ({ app: r.app, items: res.items, next: res.nextPageToken }))
        .catch(() => ({ app: r.app, items: [] as EmailItem[], next: null as string | null })),
    ),
  );
  const items = results.flatMap((r) => r.items).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const next: Record<string, string | null> = {};
  for (const r of results) next[r.app] = r.next;
  return { items, next };
}

// Fetch the user's contacts directly (no chat turn) — rendered with <ContactsList>.
const CONTACTS_API = CONNECT_API.replace(/\/gmail-oauth$/, '/contacts');
export async function fetchContacts(app = 'gmail'): Promise<ContactItem[]> {
  const token = await authToken();
  const res = await fetch(`${CONTACTS_API}?app=${encodeURIComponent(app)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Contacts fetch failed: ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.items) ? j.items : [];
}

// Send an email (Composio GMAIL_SEND_EMAIL, server-verified). Returns on success,
// throws on failure so the composer can show an error.
const SEND_API = CONNECT_API.replace(/\/gmail-oauth$/, '/gmail-send');
export async function sendEmail(msg: { to: string; subject: string; body: string; threadId?: string; cc?: string[]; bcc?: string[]; app?: string }): Promise<void> {
  const token = await authToken();
  const res = await fetch(SEND_API, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(msg),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || `Send failed: ${res.status}`);
}

// ---- Telegram (our OWN MTProto backend, via the `telegram` Edge Function) ----
// Mirrors the connectors-page tgCall: the MTProto library is heavy to cold-start
// (can 546 on the first hit after idle), so retry ONCE on an infra-level invoke
// error — but never on an app-level {error}, which surfaces immediately.
export interface TgChat { id: number | string; title: string; username?: string | null; kind?: string | null }
export interface TgMessage { id: number; text: string; date: number | null; outgoing: boolean; from?: string | null }

async function tgInvoke(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('telegram', { body: { action, ...extra } });
    if (error) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw new Error(error.message || 'Request failed');
    }
    const d = (data || {}) as Record<string, unknown>;
    if (d.error) throw new Error(String(d.error));
    return d;
  }
  throw new Error('Request failed');
}
export async function tgStatus(): Promise<{ connected: boolean; phone?: string | null }> {
  const d = await tgInvoke('status');
  return { connected: !!d.connected, phone: (d.phone as string) ?? null };
}
export async function tgChats(limit = 30): Promise<TgChat[]> {
  const d = await tgInvoke('chats', { limit });
  return Array.isArray(d.chats) ? (d.chats as TgChat[]) : [];
}
export async function tgMessages(chatId: number | string, limit = 40): Promise<TgMessage[]> {
  const d = await tgInvoke('messages', { chatId, limit });
  return Array.isArray(d.messages) ? (d.messages as TgMessage[]) : [];
}
export async function tgSend(chatId: number | string, text: string): Promise<void> {
  await tgInvoke('send', { chatId, text });
}

// ---- SMS (the platform's built-in Twilio sender, via the `sms` Edge Function) ----
// App-level outcomes come back as 200 { error: code }; only infra errors are
// non-2xx (retried once). `sendSms` throws Error(code) so callers can map a
// friendly message (sms_unset / bad_number / rate_limited / send_failed / …).
async function smsInvoke(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('sms', { body: { action, ...extra } });
    if (error) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      throw new Error(error.message || 'Request failed');
    }
    const d = (data || {}) as Record<string, unknown>;
    if (d.error) throw new Error(String(d.error));
    return d;
  }
  throw new Error('Request failed');
}
export async function smsStatus(): Promise<boolean> {
  try { const d = await smsInvoke('status'); return !!d.ready; } catch { return false; }
}
export async function sendSms(to: string, body: string): Promise<{ sid?: string; remaining?: number }> {
  const d = await smsInvoke('send', { to, body });
  return { sid: d.sid as string | undefined, remaining: typeof d.remaining === 'number' ? d.remaining : undefined };
}

// ---- Email campaigns (sent through the user's mailbox, via the `campaigns` fn) ----
// create -> then call sendCampaignBatch(id) repeatedly until { done:true }. App
// outcomes (no_recipients / missing_content) come back as 200 { error }.
export interface Campaign { id: string; name: string; subject: string; app: string; status: string; total: number; sent: number; failed: number; created_at: string }
export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.functions.invoke('campaigns', { body: { action: 'list' } });
  if (error) return [];
  const c = (data as { campaigns?: Campaign[] } | null)?.campaigns;
  return Array.isArray(c) ? c : [];
}
export async function createCampaign(p: { app: string; name?: string; subject: string; body: string; recipients: { email: string; name?: string }[] }): Promise<{ id?: string; queued?: number; skipped?: number; invalid?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke('campaigns', { body: { action: 'create', ...p } });
  if (error) throw new Error(error.message || 'Request failed');
  return (data || {}) as { id?: string; queued?: number; skipped?: number; invalid?: number; error?: string };
}
export async function sendCampaignBatch(id: string): Promise<{ sent: number; failed: number; remaining: number; done: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('campaigns', { body: { action: 'send', id } });
  if (error) throw new Error(error.message || 'Request failed');
  return (data || {}) as { sent: number; failed: number; remaining: number; done: boolean; error?: string };
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
