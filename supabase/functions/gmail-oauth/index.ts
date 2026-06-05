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

function json(req: Request, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { headers: { ...corsFor(req), "content-type": "application/json" } });
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
async function fetchMessageHtml(uid: string, messageId: string): Promise<{ html: string; hasImages: boolean; attachments: MsgAttachment[] }> {
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
  return { html, hasImages, attachments };
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
]);

// The toolkit's selectable tools (Composio's "important" set, minus dead ones).
async function toolkitCatalog(toolkit: string): Promise<{ slug: string; name: string; desc: string }[]> {
  const u = new URL(`${BASE}/tools`);
  u.searchParams.set("toolkit_slug", toolkit);
  u.searchParams.set("important", "true");
  u.searchParams.set("limit", "120");
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) return [];
  const b = await res.json();
  const items: any[] = b.items ?? b.data ?? [];
  return items
    .filter((t) => !BROKEN_TOOLS.has(t.slug))
    .map((t) => ({ slug: t.slug, name: t.name || prettyName(t.slug), desc: t.description || "" }));
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

  // 1) Kick off the provider's hosted consent (verified via the ?t= token).
  if (path === "start") {
    const uid = await verifyUser(url.searchParams.get("t"));
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
      if (!res.ok) return page(`❌ Composio link failed: ${data.message || data.error || res.status}`);
      const redirect = data.redirect_url || data.redirectUrl;
      if (!redirect) return page("❌ Composio did not return a redirect URL.");
      return Response.redirect(redirect, 302);
    } catch (e) {
      return page(`❌ ${e instanceof Error ? e.message : String(e)}`);
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
    try {
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("statuses", "ACTIVE");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: {} });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const connected: Record<string, { email: string | null }> = {};
      for (const it of items) {
        if ((it.status ?? "").toUpperCase() !== "ACTIVE") continue;
        const appId = APP_FOR_SLUG[(pickSlug(it) ?? "").toLowerCase()];
        if (!appId) continue;
        const email = it?.data?.email ?? it?.meta?.email ?? it?.params?.email ?? it?.data?.emailAddress ?? null;
        connected[appId] = { email };
      }
      return json(req, { connected });
    } catch {
      return json(req, { connected: {} });
    }
  }

  // 3c) Raw email HTML for the in-app reader (real-HTML view). Bearer + ?id=.
  if (path === "message") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    const id = url.searchParams.get("id");
    if (!uid || !id) return json(req, { error: "unauthorized" });
    try {
      return json(req, await fetchMessageHtml(uid, id));
    } catch (e) {
      return json(req, { error: e instanceof Error ? e.message : String(e) });
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
    try {
      return json(req, await getAttachment(uid, mid, aid, name));
    } catch (e) {
      return json(req, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 3e) Manage Tools: GET = catalog + current selection; POST = save selection.
  if (path === "tools") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid || !toolkit) return json(req, { error: "unauthorized" });
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const enabled = Array.isArray(body.enabled) ? body.enabled.filter((s: unknown) => typeof s === "string") : [];
      return json(req, { ok: await setPrefs(uid, toolkit, enabled) });
    }
    const [catalog, saved] = await Promise.all([
      toolkitCatalog(toolkit),
      getPrefs(uid, toolkit),
    ]);
    // Nothing is enabled by default — only the user's saved selection counts.
    // Surface any saved slug that isn't in the catalog so it stays toggleable.
    const have = new Set(catalog.map((t) => t.slug));
    for (const s of (saved ?? [])) if (!have.has(s)) catalog.push({ slug: s, name: prettyName(s), desc: "" });
    const tools = catalog.map((t) => ({ slug: t.slug, name: t.name, desc: t.desc, write: isWrite(t.slug) }));
    return json(req, { tools, enabled: saved ?? [], customized: saved !== null });
  }

  // 3) The app polls this to show connection state (verified via Bearer token).
  if (path === "status") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid || !toolkit) return json(req, { connected: false });
    try {
      const ac = await findAuthConfig(toolkit);
      if (!ac) return json(req, { connected: false });
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("auth_config_ids", ac);
      q.searchParams.set("statuses", "ACTIVE");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: false });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const active = items.find((x) => (x.status ?? "").toUpperCase() === "ACTIVE") ?? items[0];
      const email = active?.data?.email ?? active?.meta?.email ?? active?.params?.email ?? active?.data?.emailAddress ?? null;
      return json(req, { connected: !!active, email });
    } catch {
      return json(req, { connected: false });
    }
  }

  return page("Go Farther — connector (Composio) endpoint.");
});
