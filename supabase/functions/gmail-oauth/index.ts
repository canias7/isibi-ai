import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Generic "connect an app" flow, powered by Composio's managed (verified) OAuth.
// NOTE: the function slug is still `gmail-oauth` for historical reasons, but it
// now handles ANY connector via the ?app= param.
//
// Identity is verified SERVER-SIDE (the caller's Supabase access token), so we
// never trust a client-supplied user id. Routes:
//   /start?app=<id>&t=<access_token>   -> 302 to the provider's hosted consent
//   /callback                          -> success page after Composio finishes
//   /status?app=<id>  (Bearer token)   -> { connected, email }

const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const SELF = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth";
const BASE = "https://backend.composio.dev/api/v3.1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Frontend connector id -> Composio toolkit slug. (atlassian->jira and
// m365->outlook are the best single-toolkit fits Composio offers.)
const TOOLKIT: Record<string, string> = {
  gmail: "gmail",
  gcal: "googlecalendar",
  gdrive: "googledrive",
  canva: "canva",
  figma: "figma",
  notion: "notion",
  atlassian: "jira",
  m365: "outlook",
  slack: "slack",
  hubspot: "hubspot",
  googlesheets: "googlesheets",
  googledocs: "googledocs",
  excel: "excel",
  one_drive: "one_drive",
  dropbox: "dropbox",
  box: "box",
  onenote: "onenote",
  airtable: "airtable",
  todoist: "todoist",
  googletasks: "googletasks",
  asana: "asana",
  trello: "trello",
  clickup: "clickup",
  monday: "monday",
  miro: "miro",
  calendly: "calendly",
  zoom: "zoom",
  googlemeet: "googlemeet",
  microsoft_teams: "microsoft_teams",
  webex: "webex",
  telegram: "telegram",
  discord: "discord",
  linkedin: "linkedin",
  reddit: "reddit",
  youtube: "youtube",
  instagram: "instagram",
  twitter: "twitter",
  spotify: "spotify",
  salesforce: "salesforce",
  pipedrive: "pipedrive",
  zoho: "zoho",
  zendesk: "zendesk",
  intercom: "intercom",
  freshdesk: "freshdesk",
  shopify: "shopify",
  stripe: "stripe",
  square: "square",
  quickbooks: "quickbooks",
  xero: "xero",
  typeform: "typeform",
  jotform: "jotform",
  mailchimp: "mailchimp",
  sendgrid: "sendgrid",
  klaviyo: "klaviyo",
};
// Reverse: Composio toolkit slug -> frontend connector id.
const APP_FOR_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TOOLKIT).map(([app, slug]) => [slug, app]),
);

// CORS allowlist: native app (Capacitor) + local dev. Requests with no Origin
// (native fetch / curl) are allowed; unknown browser origins are blocked.
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Supabase Edge Functions force `text/plain` + a sandbox CSP on responses
// (so *.supabase.co can't host rendered web pages). HTML therefore shows up as
// raw source in the browser — so these consent-return pages are plain text.
function page(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

// Verify the caller's Supabase access token and return their user id (or null).
async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

const api = (path: string, init?: RequestInit) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "x-api-key": API_KEY, "content-type": "application/json", ...(init?.headers ?? {}) } });

// One-time "connect code": a short-lived HMAC token that stands in for the user's
// access token in the OAuth /start URL, so the real session JWT never lands in a
// navigable URL (browser history / referer / access logs). Minted by /connect-init
// (token in the Authorization header), verified by /start. Signed with a
// server-only key; ~5 min TTL; single-use via a jti row in public.oauth_codes
// (see storeCodeJti/consumeCodeJti below).
const CODE_TTL_MS = 5 * 60 * 1000;
function b64url(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode((API_KEY ?? "") + "::gf-connect-code"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function mintCode(uid: string): Promise<string> {
  const payload = `${uid}.${Date.now() + CODE_TTL_MS}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload)));
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}
async function verifyCode(code: string | null): Promise<string | null> {
  if (!code) return null;
  try {
    const [p, s] = code.split(".");
    if (!p || !s) return null;
    const payload = new TextDecoder().decode(unb64url(p));
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64url(s), new TextEncoder().encode(payload));
    if (!ok) return null;
    const [uid, expStr] = payload.split(".");
    if (!uid || !expStr || Date.now() > Number(expStr)) return null;
    return uid;
  } catch {
    return null;
  }
}

// Single-use enforcement for the codes above: each code's sha256 lands in
// public.oauth_codes at mint time and is consumed (deleted) by /start, so a
// code replayed within its TTL finds no row and is rejected. Both sides
// degrade OPEN on infrastructure errors — the HMAC+TTL check still applies,
// and a broken jti store must not break connects.
async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function storeCodeJti(code: string): Promise<void> {
  if (!SR || !SUPABASE_URL) return;
  try {
    const headers = { apikey: SR, authorization: `Bearer ${SR}`, "content-type": "application/json" };
    // Opportunistic self-prune: rows older than 2x the code TTL are long dead.
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/oauth_codes?created_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE", headers }).catch(() => {});
    const r = await fetch(`${SUPABASE_URL}/rest/v1/oauth_codes`, {
      method: "POST",
      headers: { ...headers, prefer: "return=minimal" },
      body: JSON.stringify({ jti: await sha256Hex(code) }),
    });
    if (!r.ok) console.error("oauth_codes insert failed:", r.status);
  } catch (e) {
    console.error("oauth_codes insert error:", e);
  }
}
// True = code is fresh (its jti row existed and was consumed just now) or the
// store was unreachable (fail open, matching the insert side). False = replay.
async function consumeCodeJti(code: string): Promise<boolean> {
  if (!SR || !SUPABASE_URL) return true;
  try {
    const jti = await sha256Hex(code);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/oauth_codes?jti=eq.${encodeURIComponent(jti)}`, {
      method: "DELETE",
      headers: { apikey: SR, authorization: `Bearer ${SR}`, prefer: "return=representation" },
    });
    if (!r.ok) { console.error("oauth_codes consume failed:", r.status); return true; }
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) ? rows.length > 0 : true;
  } catch (e) {
    console.error("oauth_codes consume error:", e);
    return true;
  }
}

function pickId(o: any): string | null {
  return o?.id ?? o?.uuid ?? o?.nanoid ?? o?.auth_config?.id ?? null;
}
function pickSlug(o: any): string | null {
  return o?.toolkit?.slug ?? o?.toolkit_slug ?? (typeof o?.toolkit === "string" ? o.toolkit : null);
}

// Find an existing auth config for a toolkit (no side effects).
async function findAuthConfig(toolkit: string): Promise<string | null> {
  const res = await api(`/auth_configs`);
  if (!res.ok) throw new Error(`auth_configs list ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
  const match = items.find((it) => (pickSlug(it) ?? "").toLowerCase() === toolkit.toLowerCase());
  return match ? pickId(match) : null;
}

// Find or create a Composio-managed auth config for a toolkit.
async function ensureAuthConfig(toolkit: string): Promise<string> {
  const existing = await findAuthConfig(toolkit);
  if (existing) return existing;
  const res = await api(`/auth_configs`, {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug: toolkit },
      auth_config: { type: "use_composio_managed_auth", credentials: {}, restrict_to_following_tools: [] },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`auth_configs create ${res.status}: ${JSON.stringify(body)}`);
  const id = pickId(body) ?? body.auth_config?.id ?? body.id;
  if (!id) throw new Error("Composio did not return an auth config id.");
  return id;
}

// ---- Email HTML (for the in-app reader's real-HTML view) ----
const COMPOSIO_EXEC = "https://backend.composio.dev/api/v3/tools/execute";

function b64urlDecode(s: string): string {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Walk a Gmail payload tree for the first part of a given mime type (base64url).
function findPart(node: any, mime: string): string | null {
  if (!node || typeof node !== "object") return null;
  if ((node.mimeType ?? "") === mime && node.body?.data) return node.body.data as string;
  for (const p of node.parts ?? []) {
    const f = findPart(p, mime);
    if (f) return f;
  }
  return null;
}
// Turn a Composio GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID result into renderable HTML.
function extractHtml(data: any): { html: string; hasImages: boolean } {
  const payload = data?.payload ?? data?.message?.payload ?? data?.data?.payload ?? (data?.mimeType ? data : null);
  let html = "";
  const h = payload ? findPart(payload, "text/html") : null;
  if (h) {
    html = b64urlDecode(h);
  } else {
    const p = payload ? findPart(payload, "text/plain") : null;
    const text = p
      ? b64urlDecode(p)
      : typeof data?.messageText === "string" ? data.messageText
      : typeof data?.text === "string" ? data.text
      : typeof data?.preview?.body === "string" ? data.preview.body
      : "";
    html = text ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>` : "";
  }
  const hasImages = /<img[^>]+src=["']?http/i.test(html) || /url\(["']?http/i.test(html);
  return { html, hasImages };
}
interface MsgAttachment { name: string; mimeType: string; size: number; attachmentId: string; contentId: string }
function headerVal(headers: any[], name: string): string {
  for (const h of headers ?? []) if (((h?.name ?? "") as string).toLowerCase() === name) return h?.value ?? "";
  return "";
}
function collectAttachments(node: any, out: MsgAttachment[]): void {
  if (!node || typeof node !== "object") return;
  const attId = node.body?.attachmentId;
  if (attId && node.filename) {
    const cid = headerVal(node.headers, "content-id").replace(/^<|>$/g, "");
    out.push({ name: node.filename, mimeType: node.mimeType ?? "", size: node.body?.size ?? 0, attachmentId: attId, contentId: cid });
  }
  for (const p of node.parts ?? []) collectAttachments(p, out);
}
function payloadOf(data: any): any {
  return data?.payload ?? data?.message?.payload ?? data?.data?.payload ?? (data?.mimeType ? data : null);
}
// Split a "Name <email>" header into its parts (name may be empty).
function parseAddr(v: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v || "");
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: "", email: (v || "").trim() };
}
interface MsgMeta { from: string; email: string; to: string; subject: string; date: string; unread: boolean }
async function fetchMessageHtml(uid: string, messageId: string): Promise<{ html: string; hasImages: boolean; attachments: MsgAttachment[] } & MsgMeta> {
  const res = await fetch(`${COMPOSIO_EXEC}/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: { message_id: messageId, user_id: "me", format: "full" } }),
  });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? body;
  const { html, hasImages } = extractHtml(data);
  const attachments: MsgAttachment[] = [];
  const pl = payloadOf(data);
  if (pl) collectAttachments(pl, attachments);
  // Header fields, so the app can render a complete email card from just an id.
  const headers = pl?.headers ?? [];
  const fromAddr = parseAddr(headerVal(headers, "from"));
  const labelIds: string[] = data?.labelIds ?? data?.message?.labelIds ?? [];
  return {
    html, hasImages, attachments,
    from: fromAddr.name, email: fromAddr.email,
    to: parseAddr(headerVal(headers, "to")).email,
    subject: headerVal(headers, "subject"),
    date: headerVal(headers, "date"),
    unread: Array.isArray(labelIds) && labelIds.includes("UNREAD"),
  };
}
// Fetch one attachment's bytes (base64) or a hosted URL, for preview/download.
// GMAIL_GET_ATTACHMENT requires file_name and returns a temporary hosted URL
// (data.file.s3url) rather than base64.
async function getAttachment(uid: string, mid: string, aid: string, fileName: string): Promise<{ b64: string | null; url: string | null; mimeType: string | null }> {
  const res = await fetch(`${COMPOSIO_EXEC}/GMAIL_GET_ATTACHMENT`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: { message_id: mid, attachment_id: aid, file_name: fileName, user_id: "me" } }),
  });
  const body = await res.json().catch(() => ({}));
  const d = body?.data ?? {};
  const f = (d && typeof d.file === "object") ? d.file : d;
  const url = f?.s3url ?? f?.url ?? f?.download_url ?? null;
  const mimeType = f?.mimetype ?? f?.mimeType ?? null;
  const rawB64 = typeof f?.data === "string" ? f.data : (typeof d?.data === "string" ? d.data : null);
  const b64 = typeof rawB64 === "string" ? rawB64.replace(/-/g, "+").replace(/_/g, "/") : null;
  return { b64, url, mimeType };
}

// ---- Outlook reader adapter ----
// Composio's Outlook tools return Microsoft Graph JSON (body.content + from.
// emailAddress), a completely different shape from Gmail. Translate it into the
// SAME card shape so the frontend reader renders identically.
async function fetchOutlookMessageHtml(uid: string, messageId: string): Promise<{ html: string; hasImages: boolean; attachments: MsgAttachment[] } & MsgMeta> {
  const res = await fetch(`${COMPOSIO_EXEC}/OUTLOOK_OUTLOOK_GET_MESSAGE`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: { message_id: messageId } }),
  });
  const body = await res.json().catch(() => ({}));
  const m = body?.data?.response_data ?? body?.data ?? {};
  const raw = String(m?.body?.content ?? "");
  const isHtml = String(m?.body?.contentType ?? "").toLowerCase() === "html";
  const html = isHtml ? raw : (raw ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(raw)}</pre>` : "");
  const hasImages = /<img[^>]+src=["']?http/i.test(html) || /url\(["']?http/i.test(html);
  const fromA = m?.from?.emailAddress ?? m?.sender?.emailAddress ?? {};
  const toA = (Array.isArray(m?.toRecipients) ? m.toRecipients[0]?.emailAddress : null) ?? {};
  // Graph needs a separate call for attachments; also fetch them when the body has
  // inline cid: images so the reader can resolve them.
  const attachments: MsgAttachment[] = [];
  if (m?.hasAttachments || /cid:/i.test(html)) {
    try {
      const ar = await fetch(`${COMPOSIO_EXEC}/OUTLOOK_LIST_OUTLOOK_ATTACHMENTS`, {
        method: "POST",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ user_id: uid, arguments: { message_id: messageId } }),
      });
      const ab = await ar.json().catch(() => ({}));
      const list: any[] = ab?.data?.response_data?.value ?? ab?.data?.value ?? [];
      for (const a of list) {
        attachments.push({
          name: a?.name ?? "attachment", mimeType: a?.contentType ?? "", size: a?.size ?? 0,
          attachmentId: a?.id ?? "", contentId: String(a?.contentId ?? "").replace(/^<|>$/g, ""),
        });
      }
    } catch { /* none */ }
  }
  return {
    html, hasImages, attachments,
    from: fromA?.name ?? "", email: fromA?.address ?? "",
    to: toA?.address ?? "", subject: m?.subject ?? "",
    date: m?.receivedDateTime ?? m?.sentDateTime ?? "",
    unread: m?.isRead === false,
  };
}
async function getOutlookAttachment(uid: string, mid: string, aid: string, fileName: string): Promise<{ b64: string | null; url: string | null; mimeType: string | null }> {
  const res = await fetch(`${COMPOSIO_EXEC}/OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: { message_id: mid, attachment_id: aid, file_name: fileName } }),
  });
  const body = await res.json().catch(() => ({}));
  const d = body?.data?.response_data ?? body?.data ?? {};
  const f = (d && typeof d.file === "object") ? d.file : d;
  const b64 = typeof f?.contentBytes === "string" ? f.contentBytes : (typeof f?.data === "string" ? f.data : null);
  const url = f?.s3url ?? f?.url ?? f?.download_url ?? null;
  const mimeType = f?.contentType ?? f?.mimetype ?? f?.mimeType ?? null;
  return { b64, url, mimeType };
}
// Which mailbox an id belongs to: trust an explicit ?app=, else infer from id shape
// (Gmail ids are short hex; Outlook/Graph ids are long).
function mailboxOf(app: string | null, id: string): "gmail" | "outlook" {
  if (app === "gmail" || app === "outlook") return app;
  return /^[0-9a-f]{10,24}$/i.test(id) ? "gmail" : "outlook";
}

// ---- Manage Tools (per-user tool selection) ----
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Classify a tool as read-only vs a write/action. The verb is the first token
// after the toolkit prefix (GMAIL_*GET*_DRAFT) — keying off a small closed set
// of read verbs is far more reliable than enumerating write verbs (which caused
// false positives like GET_DRAFT/LIST_DRAFTS matching the word "DRAFT"). When in
// doubt we treat a tool as a write, so it stays opt-in.
const READ_VERBS = new Set([
  "GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "EXPORT", "DOWNLOAD",
  "RETRIEVE", "CHECK", "COUNT", "VIEW", "LOOKUP", "DESCRIBE", "RESOLVE", "PREVIEW",
]);
function isWrite(slug: string): boolean {
  let rest = slug.toUpperCase().split("_").slice(1); // drop toolkit prefix
  while (rest[0] === "BATCH" || rest[0] === "BULK") rest = rest.slice(1);
  return !READ_VERBS.has(rest[0] ?? "");
}
function prettyName(slug: string): string {
  const parts = slug.split("_");
  const rest = parts.length > 1 ? parts.slice(1) : parts; // drop toolkit prefix
  return rest.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}
// Tools Composio lists in its catalog but rejects at execute time with
// "tool not found" (deprecated/renamed) — verified by direct execution. We hide
// them so the UI never offers a tool that would just error. Extend per toolkit
// as more are tested.
const BROKEN_TOOLS = new Set<string>([
  "GMAIL_LIST_MESSAGES",
  "GMAIL_GET_DRAFT",
  "GMAIL_UPDATE_DRAFT",
  "GMAIL_BATCH_MODIFY_MESSAGES",
  "GMAIL_UNTRASH_MESSAGE",
  "GMAIL_MOVE_THREAD_TO_TRASH",
  "GMAIL_UNTRASH_THREAD",
  "GMAIL_DELETE_THREAD",
  "GMAIL_UPDATE_LABEL",
  "GMAIL_PATCH_SEND_AS",
  // Google Calendar — verified tool-not-found at execute time.
  "GOOGLECALENDAR_GET_CALENDAR_PROFILE",
  "GOOGLECALENDAR_CALENDAR_LIST_GET",
  "GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS",
  "GOOGLECALENDAR_EVENTS_GET",
  "GOOGLECALENDAR_ACL_GET",
  "GOOGLECALENDAR_ACL_INSERT",
  "GOOGLECALENDAR_ACL_DELETE",
  "GOOGLECALENDAR_CALENDAR_LIST_DELETE",
  "GOOGLECALENDAR_CALENDAR_LIST_PATCH",
  "GOOGLECALENDAR_CHANNELS_STOP",
  // Google Drive — verified tool-not-found at execute time.
  "GOOGLEDRIVE_DELETE_FILE",
  "GOOGLEDRIVE_TRASH_FILE",
  "GOOGLEDRIVE_GET_FILE_PROPERTY",
  "GOOGLEDRIVE_UPDATE_FILE_METADATA_PATCH",
  "GOOGLEDRIVE_CREATE_PERMISSION",
  "GOOGLEDRIVE_PATCH_PERMISSION",
  "GOOGLEDRIVE_MODIFY_FILE_LABELS",
  "GOOGLEDRIVE_LIST_REPLIES",
  "GOOGLEDRIVE_LIST_ACCESS_PROPOSALS",
  "GOOGLEDRIVE_LIST_APPROVALS",
  "GOOGLEDRIVE_DOWNLOAD_FILE2",
  "GOOGLEDRIVE_DOWNLOAD_FILE_OPERATION",
  "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
  "GOOGLEDRIVE_RESUMABLE_UPLOAD",
  "GOOGLEDRIVE_UPLOAD_UPDATE_FILE",
  "GOOGLEDRIVE_UPLOAD_FROM_URL",
  "GOOGLEDRIVE_WATCH_FILE",
  // Full-catalog sweep 2026-06-10: everything below is in Composio's catalog but
  // 404s ("tool not found") at execute time — verified by direct execution.
  // Google Calendar
  "GOOGLECALENDAR_ACL_LIST",
  "GOOGLECALENDAR_ACL_PATCH",
  "GOOGLECALENDAR_ACL_UPDATE",
  "GOOGLECALENDAR_ACL_WATCH",
  "GOOGLECALENDAR_BATCH_EVENTS",
  "GOOGLECALENDAR_CALENDAR_LIST_WATCH",
  "GOOGLECALENDAR_COLORS_GET",
  "GOOGLECALENDAR_EVENTS_IMPORT",
  "GOOGLECALENDAR_LIST_BUILDINGS",
  "GOOGLECALENDAR_LIST_CALENDAR_RESOURCES",
  "GOOGLECALENDAR_LIST_SETTINGS",
  "GOOGLECALENDAR_SETTINGS_GET",
  // Google Drive
  "GOOGLEDRIVE_ADD_PARENT",
  "GOOGLEDRIVE_ADD_PROPERTY",
  "GOOGLEDRIVE_COPY_FILE_ADVANCED",
  "GOOGLEDRIVE_CREATE_TEAM_DRIVE",
  "GOOGLEDRIVE_DELETE_CHILD",
  "GOOGLEDRIVE_DELETE_PARENT",
  "GOOGLEDRIVE_DELETE_PROPERTY",
  "GOOGLEDRIVE_DELETE_REVISION",
  "GOOGLEDRIVE_DELETE_TEAM_DRIVE",
  "GOOGLEDRIVE_GET_APP",
  "GOOGLEDRIVE_GET_CHANGE",
  "GOOGLEDRIVE_GET_CHILD",
  "GOOGLEDRIVE_GET_FILE_V2",
  "GOOGLEDRIVE_GET_PARENT",
  "GOOGLEDRIVE_GET_PERMISSION_ID_FOR_EMAIL",
  "GOOGLEDRIVE_GET_TEAM_DRIVE",
  "GOOGLEDRIVE_INSERT_CHILD",
  "GOOGLEDRIVE_LIST_CHILDREN_V2",
  "GOOGLEDRIVE_LIST_FILE_PROPERTIES",
  "GOOGLEDRIVE_LIST_TEAM_DRIVES",
  "GOOGLEDRIVE_PATCH_PROPERTY",
  "GOOGLEDRIVE_UPDATE_FILE_PROPERTY",
  "GOOGLEDRIVE_UPDATE_TEAM_DRIVE",
  // Google Sheets
  "GOOGLESHEETS_AUTO_RESIZE_DIMENSIONS",
  "GOOGLESHEETS_BATCH_CLEAR_VALUES_BY_DATA_FILTER",
  "GOOGLESHEETS_DELETE_CHART",
  "GOOGLESHEETS_FIND_REPLACE",
  "GOOGLESHEETS_GET_BATCH_VALUES",
  "GOOGLESHEETS_GET_CONDITIONAL_FORMAT_RULES",
  "GOOGLESHEETS_GET_DATA_VALIDATION_RULES",
  "GOOGLESHEETS_LIST_CHARTS",
  "GOOGLESHEETS_MOVE_CHART",
  "GOOGLESHEETS_MUTATE_CONDITIONAL_FORMAT_RULES",
  "GOOGLESHEETS_SET_DATA_VALIDATION_RULE",
  "GOOGLESHEETS_UPDATE_CHART",
  "GOOGLESHEETS_UPDATE_DIMENSION_PROPERTIES",
  "GOOGLESHEETS_UPDATE_VALUES_BATCH",
  "GOOGLESHEETS_UPSERT_ROWS",
  "GOOGLESHEETS_VALUES_GET",
  "GOOGLESHEETS_VALUES_UPDATE",
  // Outlook — dead under BOTH the legacy OUTLOOK_OUTLOOK_ name and the new one
  // (also pruned from CURATED.outlook; listed here as belt-and-braces).
  "OUTLOOK_QUERY_EMAILS",
  "OUTLOOK_LIST_MAIL_FOLDER_MESSAGES",
  "OUTLOOK_LIST_SENT_ITEMS_MESSAGES",
  "OUTLOOK_FORWARD_MESSAGE",
  "OUTLOOK_SEND_DRAFT",
  "OUTLOOK_DELETE_MESSAGE",
  "OUTLOOK_LIST_EMAIL_RULES",
  "OUTLOOK_DELETE_CALENDAR_EVENT",
  "OUTLOOK_GET_CALENDAR_VIEW",
  "OUTLOOK_FIND_MEETING_TIMES",
  "OUTLOOK_ACCEPT_EVENT",
  "OUTLOOK_DECLINE_EVENT",
  "OUTLOOK_GET_ME_CONTACTS",
  "OUTLOOK_LIST_TODO_TASKS",
  "OUTLOOK_CREATE_TASK",
]);

// Tested apps surface ONLY this curated, known-working set (kept in order) — in
// Manage Tools, in ?catalog, and (via gmail-mcp's default) to the model. Other
// apps fall through to their full catalog; they're hidden from the UI for now
// but stay backend-usable. Widen these lists as more tools are verified.
const CURATED: Record<string, string[]> = {
  gmail: [
    "GMAIL_FETCH_EMAILS",
    "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
    "GMAIL_LIST_THREADS",
    "GMAIL_SEND_EMAIL",
    "GMAIL_REPLY_TO_THREAD",
    "GMAIL_CREATE_EMAIL_DRAFT",
    "GMAIL_LIST_DRAFTS",
    "GMAIL_SEND_DRAFT",
    "GMAIL_GET_ATTACHMENT",
    "GMAIL_LIST_LABELS",
    "GMAIL_ADD_LABEL_TO_EMAIL",
    "GMAIL_SEARCH_PEOPLE",
  ],
  // Outlook — pruned to the tools that actually execute (full-catalog sweep
  // 2026-06-10: each remaining slug verified via the legacy OUTLOOK_OUTLOOK_
  // name or its new single-prefix name; gofarther-mcp's execTool bridges both).
  outlook: [
    "OUTLOOK_LIST_MESSAGES",
    "OUTLOOK_SEARCH_MESSAGES",
    "OUTLOOK_GET_MESSAGE",
    "OUTLOOK_GET_MAIL_DELTA",
    "OUTLOOK_LIST_MAIL_FOLDERS",
    "OUTLOOK_LIST_OUTLOOK_ATTACHMENTS",
    "OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT",
    "OUTLOOK_SEND_EMAIL",
    "OUTLOOK_REPLY_EMAIL",
    "OUTLOOK_CREATE_DRAFT",
    "OUTLOOK_ADD_MAIL_ATTACHMENT",
    "OUTLOOK_UPDATE_EMAIL",
    "OUTLOOK_MOVE_MESSAGE",
    "OUTLOOK_CREATE_MAIL_FOLDER",
    "OUTLOOK_CREATE_EMAIL_RULE",
    "OUTLOOK_LIST_EVENTS",
    "OUTLOOK_GET_EVENT",
    "OUTLOOK_CALENDAR_CREATE_EVENT",
    "OUTLOOK_UPDATE_CALENDAR_EVENT",
    "OUTLOOK_LIST_CALENDARS",
    "OUTLOOK_LIST_EVENT_ATTACHMENTS",
    "OUTLOOK_LIST_CONTACTS",
    "OUTLOOK_CREATE_CONTACT",
    "OUTLOOK_UPDATE_CONTACT",
    "OUTLOOK_GET_PROFILE",
    "OUTLOOK_GET_MAILBOX_SETTINGS",
  ],
  // Excel — curated to the tools verified working against a live workbook (the
  // rest of the 54 are dead 404s, or the table sub-toolset which is unusable
  // because Composio's ADD_TABLE is broken, or SharePoint-only variants).
  excel: [
    "EXCEL_LIST_FILES",
    "EXCEL_LIST_WORKSHEETS",
    "EXCEL_GET_WORKSHEET",
    "EXCEL_ADD_WORKSHEET",
    "EXCEL_UPDATE_WORKSHEET",
    "EXCEL_DELETE_WORKSHEET",
    "EXCEL_PROTECT_WORKSHEET",
    "EXCEL_GET_RANGE",
    "EXCEL_UPDATE_RANGE",
    "EXCEL_CLEAR_RANGE",
    "EXCEL_INSERT_RANGE",
    "EXCEL_MERGE_CELLS",
    "EXCEL_SORT_RANGE",
    "EXCEL_GET_WORKBOOK",
    "EXCEL_LIST_WORKBOOK_PERMISSIONS",
    "EXCEL_GET_SESSION",
    "EXCEL_LIST_NAMED_ITEMS",
    "EXCEL_LIST_COMMENTS",
    "EXCEL_LIST_TABLES",
    "EXCEL_ADD_CHART",
    "EXCEL_LIST_CHARTS",
    "EXCEL_LIST_CHART_SERIES",
    "EXCEL_GET_CHART_AXIS",
    "EXCEL_GET_CHART_DATA_LABELS",
    "EXCEL_GET_CHART_LEGEND",
    "EXCEL_UPDATE_CHART",
    "EXCEL_UPDATE_CHART_LEGEND",
  ],
};

// The toolkit's selectable tools. Curated apps return only their working set;
// everything else returns the full Composio catalog minus known-dead tools.
// Upstream failure is NOT "no tools": curated apps degrade to their curated
// list as stubs (so the UI never paints a bogus "No tools enabled yet"), and
// non-curated apps THROW so callers surface a retryable 5xx instead.
async function toolkitCatalog(toolkit: string): Promise<{ slug: string; name: string; desc: string }[]> {
  const pick = CURATED[toolkit];
  let items: any[];
  try {
    const u = new URL(`${BASE}/tools`);
    u.searchParams.set("toolkit_slug", toolkit);
    u.searchParams.set("limit", "500");
    const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
    if (!res.ok) throw new Error(`tools list ${res.status}: ${await res.text().catch(() => "")}`);
    const b = await res.json();
    items = b.items ?? b.data ?? [];
  } catch (e) {
    console.error(`toolkitCatalog(${toolkit}) fetch failed:`, e);
    // The curated set is known-good — serve it as stubs rather than "nothing".
    if (pick) return pick.map((s) => ({ slug: s, name: prettyName(s), desc: "" }));
    throw e;
  }
  const all = items
    .filter((t) => !BROKEN_TOOLS.has(t.slug))
    .map((t) => ({ slug: t.slug, name: t.name || prettyName(t.slug), desc: t.description || "" }));
  if (!pick) return all;
  const bySlug = new Map(all.map((t) => [t.slug, t]));
  return pick.map((s) => bySlug.get(s) ?? { slug: s, name: prettyName(s), desc: "" });
}
async function getPrefs(uid: string, toolkit: string): Promise<string[] | null> {
  if (!SR) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tool_prefs?user_id=eq.${encodeURIComponent(uid)}&toolkit=eq.${encodeURIComponent(toolkit)}&select=slugs`, {
      headers: { apikey: SR, authorization: `Bearer ${SR}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? (rows[0].slugs ?? []) : null;
  } catch {
    return null;
  }
}
async function setPrefs(uid: string, toolkit: string, slugs: string[]): Promise<boolean> {
  if (!SR) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tool_prefs`, {
      method: "POST",
      headers: { apikey: SR, authorization: `Bearer ${SR}`, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: uid, toolkit, slugs, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
// POST /tools input gate: only slugs the toolkit can actually serve may be
// saved — otherwise a crafted body could enable non-curated (or known-broken)
// tools that gofarther-mcp would then hand the model live, or balloon the row.
// Returns null when `enabled` isn't an array (caller answers 400). If the
// catalog is unavailable upstream (curated apps degrade to stubs, so for them
// it can't be), fall back to shape-validation only — degrade open, but log it.
async function sanitizeEnabled(raw: unknown, toolkit: string): Promise<string[] | null> {
  if (!Array.isArray(raw)) return null;
  const entries = raw
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, 200);
  let allowed: Set<string> | null = null;
  if (toolkit === "plaid") {
    allowed = new Set(BANK_TOOLS.map((t) => t.slug));
  } else {
    try {
      const catalog = await toolkitCatalog(toolkit);
      if (catalog.length) allowed = new Set(catalog.map((t) => t.slug));
    } catch { /* degraded path below */ }
  }
  if (allowed) return entries.filter((s) => allowed.has(s) && !BROKEN_TOOLS.has(s));
  console.error(`tools save: catalog unavailable for ${toolkit} — degraded to shape-validation`);
  const prefix = `${toolkit.toUpperCase()}_`;
  return entries.filter((s) => /^[A-Z0-9_]{1,80}$/.test(s) && s.startsWith(prefix) && !BROKEN_TOOLS.has(s));
}

// ---- Connected-apps cache (user_connections) --------------------------------
// chat and run-workflows read this row instead of asking Composio on every turn
// / every workflow tick. THIS function is where connections actually change, so
// it owns the writes: `list` rewrites the row from data it already fetched (the
// app calls it on launch and on the Connectors screen), and status/disconnect
// trigger a full refresh — so the cache is fresh the moment the UI knows.
function saveConnections(uid: string, toolkits: string[]): void {
  if (!SR || !SUPABASE_URL) return;
  fetch(`${SUPABASE_URL}/rest/v1/user_connections?on_conflict=user_id`, {
    method: "POST",
    headers: { apikey: SR, authorization: `Bearer ${SR}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, toolkits, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}
// `excludeSlugs`: toolkit slugs to drop even if Composio still lists them
// ACTIVE — its list is eventually consistent, so refreshing right after a
// disconnect can otherwise write the just-removed account straight back into
// the cache (which chat then trusts for the whole CONN_TTL).
async function refreshConnections(uid: string, excludeSlugs?: Set<string>): Promise<void> {
  try {
    const q = new URL(`${BASE}/connected_accounts`);
    q.searchParams.set("user_ids", uid);
    q.searchParams.set("statuses", "ACTIVE");
    q.searchParams.set("limit", "100");
    const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
    if (!res.ok) return; // can't confirm → leave the cache alone (TTL self-heals)
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const slugs = items
      .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
      .map(pickSlug)
      .filter((s): s is string => !!s && !excludeSlugs?.has(s.toLowerCase()));
    saveConnections(uid, [...new Set(slugs)]);
  } catch { /* cache refresh is best effort */ }
}
// Composio unreachable: serve the last-known connection map from the cache so an
// outage doesn't paint every app as disconnected in the Connectors screen.
// Account emails aren't cached, so they come back null (the UI tolerates that).
async function cachedConnectedMap(uid: string): Promise<Record<string, { email: string | null }>> {
  const out: Record<string, { email: string | null }> = {};
  if (!SR || !SUPABASE_URL) return out;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${encodeURIComponent(uid)}&select=toolkits`, {
      headers: { apikey: SR, authorization: `Bearer ${SR}` },
    });
    if (!r.ok) return out;
    const rows = await r.json();
    const slugs: unknown[] = Array.isArray(rows) && rows[0] && Array.isArray(rows[0].toolkits) ? rows[0].toolkits : [];
    for (const s of slugs) {
      const appId = APP_FOR_SLUG[String(s).toLowerCase()];
      if (appId) out[appId] = { email: null };
    }
  } catch { /* serve empty */ }
  return out;
}

// Plaid isn't a Composio toolkit — its tools are the built-in GF_BANK_* set that
// gofarther-mcp serves (read-only, scoped to the user). We list them here so the
// SAME Manage Tools UI can toggle them; the selection persists under the `plaid`
// toolkit key (by tool name) and gofarther-mcp honors it (advertise + execute).
// Keep slugs/order in sync with gofarther-mcp's bank tools.
const BANK_TOOLS: { slug: string; name: string; desc: string }[] = [
  { slug: "GF_BANK_BALANCES", name: "Balances", desc: "See your linked bank account balances in real time." },
  { slug: "GF_BANK_TRANSACTIONS", name: "Transactions", desc: "Read recent transactions — date, merchant, amount, category." },
  { slug: "GF_BANK_RECURRING", name: "Recurring & subscriptions", desc: "Detect subscriptions, recurring bills, and recurring income." },
  { slug: "GF_BANK_LIABILITIES", name: "Cards & loans", desc: "Credit cards, student loans and mortgages — balances, due dates, APR." },
  { slug: "GF_BANK_INVESTMENTS", name: "Investment holdings", desc: "Brokerage holdings — ticker, quantity and value." },
  { slug: "GF_BANK_IDENTITY", name: "Identity on file", desc: "The name, email, phone and address your bank has on file." },
  { slug: "GF_BANK_AUTH", name: "Account & routing numbers", desc: "Account and routing numbers for direct deposit / ACH." },
  { slug: "GF_BANK_INVESTMENT_TRANSACTIONS", name: "Investment activity", desc: "Buys, sells and dividends from brokerage accounts." },
  { slug: "GF_BANK_INSIGHTS", name: "Money insights", desc: "Net worth, spending by category, cash flow and upcoming bills." },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  const app = url.searchParams.get("app") ?? "gmail";
  const toolkit = TOOLKIT[app];

  if (!API_KEY) return path === "status" ? json(req, { connected: false }) : page("⚠️ COMPOSIO_API_KEY is not set on the server.");

  // 0) Public, non-sensitive: how many selectable tools an app exposes. Mirrors
  // gmail-mcp's ?defaults — used by the Manage Tools UI (counts) and diagnostics.
  const catalogParam = url.searchParams.get("catalog");
  if (catalogParam !== null) {
    const tk = TOOLKIT[catalogParam] ?? catalogParam;
    const items = await toolkitCatalog(tk);
    const write = items.filter((t) => isWrite(t.slug));
    return json(req, {
      toolkit: tk,
      total: items.length,
      read: items.length - write.length,
      write: write.length,
      slugs: items.map((t) => t.slug),
    });
  }

  // 1a) Mint a one-time connect code so the client never puts the session token
  // in the /start URL. Token comes in the Authorization header (POST).
  if (path === "connect-init") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid) return json(req, { error: "unauthorized" });
    const code = await mintCode(uid);
    await storeCodeJti(code); // register the jti so /start can enforce single-use
    return json(req, { code });
  }

  // 1) Kick off the provider's hosted consent. Identity from the one-time ?code=
  // (preferred) or the legacy ?t= access token (back-compat for older clients).
  if (path === "start") {
    const code = url.searchParams.get("code");
    const codeUid = await verifyCode(code);
    // Single-use: a code that verifies but whose jti is already consumed is a
    // replay — reject it like any other bad code. (consumeCodeJti fails open
    // if the store is unreachable; the legacy ?t= fallback below is untouched.)
    if (codeUid && code && !(await consumeCodeJti(code))) {
      return page("⚠️ Please sign in to Go Farther, then try connecting again.");
    }
    const uid = codeUid ?? (await verifyUser(url.searchParams.get("t")));
    if (!uid) return page("⚠️ Please sign in to Go Farther, then try connecting again.");
    if (!toolkit) return page(`⚠️ Unknown app: ${app}`);
    try {
      const ac = await ensureAuthConfig(toolkit);
      const native = url.searchParams.get("native") === "1";
      const res = await api(`/connected_accounts/link`, {
        method: "POST",
        body: JSON.stringify({
          auth_config_id: ac,
          user_id: uid,
          callback_url: `${SELF}/${native ? "callback-app" : "callback"}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) { console.error("composio link failed:", res.status, data?.message || data?.error || ""); return page("❌ Couldn't start the connection. Please try again."); }
      const redirect = data.redirect_url || data.redirectUrl;
      if (!redirect) return page("❌ Composio did not return a redirect URL.");
      return Response.redirect(redirect, 302);
    } catch (e) {
      console.error("connect start error:", e);
      return page("❌ Couldn't start the connection. Please try again.");
    }
  }

  // 2) Composio finishes the OAuth and bounces the user back here.
  if (path === "callback") {
    const err = url.searchParams.get("error");
    if (err) return page(`❌ ${err}`);
    return page("✅ Connected!\n\nYou can close this tab and return to Go Farther.");
  }

  // 2b) Native return: bounce back into the app via its custom URL scheme so
  // the in-app browser auto-closes (no manual "back" tap needed).
  if (path === "callback-app") {
    const err = url.searchParams.get("error");
    const target = err ? `gofarther://connected?error=${encodeURIComponent(err)}` : "gofarther://connected";
    return new Response(null, { status: 302, headers: { Location: target } });
  }

  // 3b) Batched: every connected app for this user in ONE call (Bearer token).
  if (path === "list") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid) return json(req, { connected: {} });
    // The app passes ?exclude=<app ids> for ~15s after a disconnect: Composio's
    // list is eventually consistent and can still report the just-removed account
    // as ACTIVE, which would flicker it back on AND re-pollute the connections
    // cache that chat/workflows read. We strip those ids here for that window.
    const excludeIds = (url.searchParams.get("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const excludeSlugs = new Set(excludeIds.map((id) => (TOOLKIT[id] ?? "").toLowerCase()).filter(Boolean));
    try {
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("limit", "100"); // never let real ACTIVE accounts fall off page 1 behind abandoned INITIATED ones
      // No status filter: EXPIRED/FAILED accounts must come back too, so the
      // app can badge "needs reconnecting" instead of silently dropping them.
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: await cachedConnectedMap(uid) });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const connected: Record<string, { email: string | null; emails?: string[]; broken?: boolean }> = {};
      const BROKEN = new Set(["EXPIRED", "FAILED", "INACTIVE", "ERROR", "INVALID"]);
      const acc: Record<string, { actives: (string | null)[]; brokenEmail: string | null; broken: boolean }> = {};
      for (const it of items) {
        const st = (it.status ?? "").toUpperCase();
        const appId = APP_FOR_SLUG[(pickSlug(it) ?? "").toLowerCase()];
        if (!appId) continue;
        const email = it?.data?.email ?? it?.meta?.email ?? it?.params?.email ?? it?.data?.emailAddress ?? null;
        const a = (acc[appId] ??= { actives: [], brokenEmail: null, broken: false });
        if (st === "ACTIVE") a.actives.push(email);
        else if (BROKEN.has(st)) { a.broken = true; a.brokenEmail ??= email; }
        // INITIATED / abandoned OAuth flows stay invisible, as before.
      }
      for (const [appId, a] of Object.entries(acc)) {
        if (excludeIds.includes(appId)) continue; // just disconnected — keep it gone this window
        if (a.actives.length) {
          // Healthy always wins; surface every account email so the app can
          // show that more than one is connected.
          const emails = a.actives.filter((e): e is string => !!e);
          connected[appId] = { email: a.actives[0] ?? null, ...(emails.length > 1 ? { emails } : {}) };
        } else if (a.broken) {
          connected[appId] = { email: a.brokenEmail, broken: true };
        }
      }
      // Rewrite the connected-apps cache from the data already in hand. ALL
      // active toolkit slugs go in (not just APP_FOR_SLUG-known ones), matching
      // what chat used to compute straight from Composio.
      const slugs = items
        .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
        .map(pickSlug)
        .filter((s): s is string => !!s && !excludeSlugs.has(s.toLowerCase())); // don't let a stale ACTIVE re-pollute the cache for a just-disconnected app
      saveConnections(uid, [...new Set(slugs)]);
      return json(req, { connected });
    } catch {
      return json(req, { connected: await cachedConnectedMap(uid) });
    }
  }

  // 3a) Disconnect: revoke this user's Composio connection(s) for an app.
  if (path === "disconnect") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid) return json(req, { error: "unauthorized" }, 401);
    if (!toolkit) return json(req, { error: `Unknown app: ${app}` }, 400);
    try {
      // Delete EVERY connected account whose toolkit matches — a user may have more
      // than one, possibly under different auth configs, so we match by toolkit slug
      // (not auth_config_id) to make the disconnect complete.
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("limit", "100");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      const body = await res.json().catch(() => ({}));
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      let matched = 0, removed = 0, failed = 0;
      for (const it of items) {
        if ((pickSlug(it) ?? "").toLowerCase() !== toolkit.toLowerCase()) continue;
        // For DELETION, only the account's own id counts. pickId's auth_config
        // fallback exists for matching elsewhere, but DELETEing an auth-config
        // id would 404 — and a 404 on a *fallback* id must not be read as "the
        // account is gone" (it never addressed the account at all).
        const directId = it?.id ?? it?.uuid ?? it?.nanoid ?? null;
        const id = directId ?? pickId(it);
        if (!id) continue;
        matched++;
        const dr = await api(`/connected_accounts/${id}`, { method: "DELETE" }).catch(() => null);
        // 404/410 on a DIRECT id = Composio already removed it (double-tap, or
        // its eventually-consistent list still naming a just-deleted account).
        // It's gone — which is what the user asked for — so it counts as
        // removed; calling it a failure made the 502 below revert a disconnect
        // that had actually succeeded.
        if (dr && (dr.ok || (directId && (dr.status === 404 || dr.status === 410)))) removed++; else failed++;
      }
      // If accounts existed but NONE deleted, that's a real failure — tell the
      // client (5xx) instead of a cheerful 200 it ignores and then flickers back.
      if (matched > 0 && removed === 0) return json(req, { error: "Couldn't disconnect — please try again." }, 502);
      // Awaited on purpose: the user expects the app gone NOW — a stale cache
      // here would keep exposing its tools to chat until the TTL expired. The
      // just-removed toolkit is excluded: Composio's eventually-consistent
      // list could still name it ACTIVE and re-pollute the cache.
      await refreshConnections(uid, new Set([toolkit.toLowerCase()]));
      return json(req, { ok: true, matched, removed, failed });
    } catch (e) {
      console.error("disconnect error:", e);
      return json(req, { error: "Couldn't disconnect. Please try again." }, 502);
    }
  }

  // 3c) Raw email HTML for the in-app reader (real-HTML view). Bearer + ?id=.
  if (path === "message") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    const id = url.searchParams.get("id");
    if (!uid || !id) return json(req, { error: "unauthorized" });
    const app = mailboxOf(url.searchParams.get("app"), id);
    try {
      const r = app === "outlook" ? await fetchOutlookMessageHtml(uid, id) : await fetchMessageHtml(uid, id);
      return json(req, { ...r, app });
    } catch (e) {
      console.error("message fetch error:", e);
      return json(req, { error: "Couldn't load this message." });
    }
  }

  // 3d) One attachment's bytes (preview/download). Bearer + ?mid=&aid=.
  if (path === "attachment") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    const mid = url.searchParams.get("mid");
    const aid = url.searchParams.get("aid");
    const name = url.searchParams.get("name") ?? "file";
    if (!uid || !mid || !aid) return json(req, { error: "unauthorized" });
    const app = mailboxOf(url.searchParams.get("app"), mid);
    try {
      return json(req, app === "outlook" ? await getOutlookAttachment(uid, mid, aid, name) : await getAttachment(uid, mid, aid, name));
    } catch (e) {
      console.error("attachment fetch error:", e);
      return json(req, { error: "Couldn't load this attachment." });
    }
  }

  // 3e) Manage Tools: GET = catalog + current selection; POST = save selection.
  if (path === "tools") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid) return json(req, { error: "unauthorized" });
    // Plaid: built-in bank tools (not Composio), same GET/POST contract. Saved
    // under the `plaid` toolkit key; uncustomized = all on (matches gofarther-mcp).
    if (app === "plaid") {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const enabled = await sanitizeEnabled(body.enabled, "plaid");
        if (enabled === null) return json(req, { error: "enabled must be an array" }, 400);
        const ok = await setPrefs(uid, "plaid", enabled);
        return json(req, { ok }, ok ? 200 : 500); // a failed save must not 200
      }
      const saved = await getPrefs(uid, "plaid");
      const tools = BANK_TOOLS.map((t) => ({ slug: t.slug, name: t.name, desc: t.desc, write: false }));
      return json(req, { tools, enabled: saved ?? BANK_TOOLS.map((t) => t.slug), customized: saved !== null });
    }
    if (!toolkit) return json(req, { error: "unauthorized" });
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const enabled = await sanitizeEnabled(body.enabled, toolkit);
      if (enabled === null) return json(req, { error: "enabled must be an array" }, 400);
      const ok = await setPrefs(uid, toolkit, enabled);
      return json(req, { ok }, ok ? 200 : 500); // a failed save must not 200
    }
    const [catalog, saved] = await Promise.all([
      toolkitCatalog(toolkit),
      getPrefs(uid, toolkit),
    ]);
    // A saved selection can predate a tool dying upstream — never resurface a
    // known-dead slug from prefs (the catalog already excludes them).
    const savedLive = saved === null ? null : saved.filter((s) => !BROKEN_TOOLS.has(s));
    // Nothing is enabled by default — only the user's saved selection counts.
    // Surface any saved slug that isn't in the catalog so it stays toggleable.
    const have = new Set(catalog.map((t) => t.slug));
    for (const s of (savedLive ?? [])) if (!have.has(s)) catalog.push({ slug: s, name: prettyName(s), desc: "" });
    const tools = catalog.map((t) => ({ slug: t.slug, name: t.name, desc: t.desc, write: isWrite(t.slug) }));
    // Uncustomized = everything on by default (matches gmail-mcp), so show all
    // toggles enabled; the user trims from there and that saves their selection.
    return json(req, { tools, enabled: savedLive ?? catalog.map((t) => t.slug), customized: saved !== null });
  }

  // 3) The app polls this to show connection state (verified via Bearer token).
  if (path === "status") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid || !toolkit) return json(req, { connected: false });
    try {
      // Match by toolkit slug, like /list and /disconnect — filtering on the
      // first auth config's id missed accounts living under a second/recreated
      // config, so post-OAuth polling never confirmed the connection.
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("statuses", "ACTIVE");
      q.searchParams.set("limit", "100");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: false });
      const body = await res.json();
      const all: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const items = all.filter((it) => (pickSlug(it) ?? "").toLowerCase() === toolkit.toLowerCase());
      const active = items.find((x) => (x.status ?? "").toUpperCase() === "ACTIVE") ?? items[0];
      const email = active?.data?.email ?? active?.meta?.email ?? active?.params?.email ?? active?.data?.emailAddress ?? null;
      // A client polling status learns "connected" right here (e.g. just after
      // OAuth) — make sure chat learns it at the same moment, not a TTL later.
      if (active) await refreshConnections(uid);
      return json(req, { connected: !!active, email });
    } catch {
      return json(req, { connected: false });
    }
  }

  return page("Go Farther — connector (Composio) endpoint.");
});
