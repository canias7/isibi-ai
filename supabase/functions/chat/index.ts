import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gofarther-mcp";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Per-user MCP auth: each call to gofarther-mcp carries a short-lived HMAC-signed
// token binding the acting user id, so the user identity is derived from a value
// the caller can't forge (not a query param). Secret is MCP_SHARED_SECRET if set,
// else derived from a server-only secret (never the empty string).
async function mcpSecret(): Promise<string> {
  const s = Deno.env.get("MCP_SHARED_SECRET");
  if (s) return s;
  const base = (COMPOSIO_API_KEY ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function mcpB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function mcpHmac(msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await mcpSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
async function mintUserToken(uid: string): Promise<string> {
  const payload = mcpB64url(new TextEncoder().encode(JSON.stringify({ u: uid, exp: Math.floor(Date.now() / 1000) + 3600 })));
  return `${payload}.${mcpB64url(await mcpHmac(payload))}`;
}

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface Attach { kind?: string; mediaType?: string; data?: string; name?: string; fileId?: string }
interface Msg { role: string; content: string; attachments?: Attach[] }

// Build a Claude message `content` from text + optional image/PDF attachments.
// Media goes first (Anthropic's recommended ordering for vision), then the text.
// Attachments with empty data (e.g. stripped on the client when persisted) are
// skipped, so reopened chats don't send blank blocks.
function buildContent(m: Msg): unknown {
  const atts = (m.attachments ?? []).filter((a) => a && typeof a.data === "string" && a.data.length > 0);
  if (!atts.length) return m.content;
  const blocks: unknown[] = [];
  for (const a of atts) {
    if (a.kind === "pdf" || a.mediaType === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else if (a.kind === "file") {
      if (a.fileId) blocks.push({ type: "container_upload", file_id: a.fileId }); // Office/CSV — read via code execution
    } else {
      const mt = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(a.mediaType ?? "") ? a.mediaType : "image/jpeg";
      blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: a.data } });
    }
  }
  if (m.content && m.content.trim()) blocks.push({ type: "text", text: m.content });
  return blocks;
}

// Upload a base64 Office/CSV/other file to the Anthropic Files API so the code
// execution tool can read it from its container. Returns the file id, or null.
async function uploadToFiles(dataB64: string, mediaType: string, name: string, apiKey: string): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mediaType }), name);
    const r = await fetch("https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" },
      body: fd,
    });
    if (!r.ok) { console.error("files upload", r.status, (await r.text().catch(() => "")).slice(0, 150)); return null; }
    const d = await r.json();
    return typeof d?.id === "string" ? d.id : null;
  } catch (e) { console.error("files upload err", e); return null; }
}

// A file the code execution sandbox generated: fetch its metadata + bytes from
// the Files API, stash it in the private chat-files Storage bucket, and return a
// signed URL the client opens as a download. Null if unavailable/oversized.
async function deliverGeneratedFile(uid: string, fileId: string, apiKey: string): Promise<{ name: string; mime: string; size: number; url: string } | null> {
  if (!SB_URL || !SB_SERVICE_KEY || !uid) return null;
  const fh = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" };
  try {
    const metaRes = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}`, { headers: fh });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    const name = String(meta?.filename || "file");
    const mime = String(meta?.mime_type || "application/octet-stream");
    const size = Number(meta?.size_bytes || 0);
    if (size > 45 * 1024 * 1024) return null; // under the bucket's 50 MB cap
    const binRes = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}/content`, { headers: fh });
    if (!binRes.ok) return null;
    const bytes = new Uint8Array(await binRes.arrayBuffer());
    const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || "";
    const key = `${uid}/${crypto.randomUUID()}${ext ? "." + ext : ""}`;
    const auth = { apikey: SB_SERVICE_KEY!, authorization: `Bearer ${SB_SERVICE_KEY}` };
    const up = await fetch(`${SB_URL}/storage/v1/object/chat-files/${key}`, {
      method: "POST", headers: { ...auth, "content-type": mime, "x-upsert": "true" }, body: bytes,
    });
    if (!up.ok) { console.error("stash upload", up.status, (await up.text().catch(() => "")).slice(0, 120)); return null; }
    const sign = await fetch(`${SB_URL}/storage/v1/object/sign/chat-files/${key}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 604800 }),
    });
    if (!sign.ok) return null;
    const sj = await sign.json();
    const signed = String(sj?.signedURL ?? sj?.signedUrl ?? "");
    if (!signed) return null;
    return { name, mime, size, url: `${SB_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` };
  } catch (e) { console.error("deliverGeneratedFile", e); return null; }
}

// ---- Model routing: Sonnet by default, Opus for complex/long tasks ----
const MODELS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};
// Escalate to Opus only for clearly hard/long work; Sonnet handles the rest.
// Keeping a single default model (Sonnet) also lets the cached tool-schema prefix
// read turn-to-turn instead of fragmenting across models.
const COMPLEX_RE = /\b(analy[sz]e|analysis|plan|planning|strategy|strategi|compare|comparison|comprehensive|in[- ]?depth|detailed (report|plan|breakdown|analysis)|research|debug|refactor|coding|algorithm|step[- ]by[- ]step|reason through|pros and cons|trade[- ]?offs|evaluate|forecast|optimi[sz]e)\b/i;

function latestUser(messages: Msg[]): { text: string; hasAtt: boolean } {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const m = messages[i];
      const hasAtt = (m.attachments ?? []).some((a) => a && typeof a.data === "string" && a.data.length > 0);
      return { text: typeof m.content === "string" ? m.content : "", hasAtt };
    }
  }
  return { text: "", hasAtt: false };
}

// Pick the model for this turn: Opus for genuinely complex/long asks, Sonnet for
// everything else (the default). No classifier round-trip — the keyword rule is
// instant, and Sonnet handles the vast majority including all email/tool work.
function pickModel(messages: Msg[]): string {
  const { text } = latestUser(messages);
  if (COMPLEX_RE.test(text) || text.trim().length > 900) return MODELS.opus;
  return MODELS.sonnet;
}

function callAnthropic(reqBody: Record<string, unknown>, apiKey: string, extra: Record<string, string>): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(reqBody),
  });
}

// Frontend connector id -> Composio toolkit slug (for per-session filtering).
const APP_TO_SLUG: Record<string, string> = {
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

// Identify the caller from their Supabase JWT (the `sub` claim = user id).
// A plain anon key has no `sub`, so anonymous callers get no connected apps —
// they can chat, but can't touch anyone's data.
function userFromJwt(req: Request): string | null {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role === "authenticated" && typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// Which toolkits has this user connected? Ask Composio (the source of truth).
// Returns the toolkit slugs (e.g. ["gmail","googlecalendar"]) of ACTIVE accounts.
async function connectedToolkits(userId: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", userId);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return [];
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const slugs = items
      .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s);
    return [...new Set(slugs)];
  } catch {
    return [];
  }
}

// Server-side backstop: re-run the inbox fetch with the model's own arguments and
// build a gf-emails card, so an inbox list ALWAYS renders as a card even if the
// model wrote it out as plain text. Mirrors the single-email guarantee.
async function buildInboxCard(uid: string, args: unknown, tz: string): Promise<string> {
  if (!COMPOSIO_API_KEY || !uid) return "";
  try {
    const res = await fetch("https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS", {
      method: "POST",
      headers: { "x-api-key": COMPOSIO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args ?? {} }),
    });
    const body = await res.json().catch(() => ({}));
    const data = body?.data ?? body;
    const msgs: any[] = data?.messages ?? data?.data?.messages ?? [];
    if (!msgs.length) return "";
    const isDrafts = /draft/i.test(JSON.stringify(args ?? {})); // an in:drafts query -> flag items as drafts
    const dstr = (d: Date, o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d); } catch { return ""; } };
    const today = dstr(new Date(), { dateStyle: "short" });
    const items = msgs.slice(0, 12).map((m) => {
      const sender = String(m.sender ?? "");
      const mt = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
      const from = mt ? mt[1].trim() : sender;
      const email = mt ? mt[2].trim() : "";
      const labels: string[] = m.labelIds ?? [];
      let time = "";
      const d = new Date(m.messageTimestamp ?? m.internalDate ?? "");
      if (!isNaN(d.getTime())) time = dstr(d, { dateStyle: "short" }) === today ? dstr(d, { hour: "numeric", minute: "2-digit" }) : dstr(d, { month: "short", day: "numeric" });
      const snippet = String(m.messageText ?? m.preview?.body ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");
      return { from: from || email || "Unknown", email, subject: String(m.subject ?? "(no subject)"), snippet, time, unread: Array.isArray(labels) && labels.includes("UNREAD"), draft: isDrafts || (Array.isArray(labels) && labels.includes("DRAFT")), id: String(m.messageId ?? m.id ?? "") };
    });
    return JSON.stringify(items);
  } catch {
    return "";
  }
}

// Guarantee a contacts card. The server is the source of truth so it can attach
// real profile photos (the model never has the photo URLs). For Gmail it runs two
// searches and merges them: a broad one (other_contacts=true — saved + auto-saved
// "other" contacts, no photos) for breadth, plus a saved-contacts one
// (other_contacts=false) which is the ONLY mode Google allows photos in. Each
// person is flattened to {name,email,phone,photo?}; photo is set only when the
// contact has a REAL photo (default placeholders are skipped -> initials in UI).
async function buildContactsCard(uid: string, slug: string, args: unknown): Promise<string> {
  if (!COMPOSIO_API_KEY || !uid || !slug) return "";
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const isGmail = slug.toUpperCase().includes("GMAIL");
  const exec = async (extra: Record<string, unknown>): Promise<any> => {
    try {
      const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "x-api-key": COMPOSIO_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({ user_id: uid, arguments: { ...a, ...extra } }),
      });
      return await res.json();
    } catch { return {}; }
  };
  const rowsOf = (b: any): any[] => {
    const d = b?.data ?? b; const rd = d?.response_data ?? d;
    return rd?.results ?? rd?.people ?? rd?.contacts ?? rd?.connections ?? [];
  };
  try {
    let rows: any[];
    const photoBy = new Map<string, string>(); // resourceName / email -> real photo url
    if (isGmail) {
      const [broad, saved] = await Promise.all([
        exec({ other_contacts: true, person_fields: "names,emailAddresses,phoneNumbers" }),
        exec({ other_contacts: false, person_fields: "names,emailAddresses,phoneNumbers,photos" }),
      ]);
      for (const r of rowsOf(saved)) {
        const p = r?.person ?? r;
        const url = (p?.photos ?? []).find((ph: any) => ph && ph.url && !ph.default)?.url;
        if (!url) continue;
        if (p?.resourceName) photoBy.set(String(p.resourceName), url);
        const em = p?.emailAddresses?.[0]?.value;
        if (em) photoBy.set(String(em).toLowerCase(), url);
      }
      rows = [...rowsOf(broad), ...rowsOf(saved)];
    } else {
      rows = rowsOf(await exec({}));
    }
    if (!rows.length) return "";
    const seen = new Set<string>();
    const items: Record<string, string>[] = [];
    for (const r of rows) {
      const p = r?.person ?? r;
      const name = p?.names?.[0]?.displayName ?? p?.displayName ?? p?.name ?? "";
      const email = p?.emailAddresses?.[0]?.value ?? p?.email ?? p?.emailAddress?.address ?? "";
      const phone = p?.phoneNumbers?.[0]?.value ?? p?.phone ?? "";
      const rn = p?.resourceName ?? "";
      const key = String(rn || email || name || phone).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const item: Record<string, string> = { name: String(name || "").trim(), email: String(email || "").trim(), phone: String(phone || "").trim() };
      const photo = (rn && photoBy.get(String(rn))) || (email && photoBy.get(String(email).toLowerCase())) || "";
      if (photo) item.photo = photo;
      if (item.name || item.email || item.phone) items.push(item);
      if (items.length >= 20) break;
    }
    return items.length ? JSON.stringify(items) : "";
  } catch {
    return "";
  }
}

// Friendly one-liner for the live "working…" pill, by tool name. Streamed to the
// client as a [[gfstatus:…]] marker while a tool runs, then stripped from the text.
function statusLabel(name: string): string {
  const n = (name || "").toUpperCase();
  if (n.includes("SAVE_MEMORY")) return "Saving to memory…";
  if (n.includes("FETCH_EMAILS") || n.includes("LIST_MESSAGES") || n.includes("SEARCH_MESSAGES")) return "Searching your inbox…";
  if (n.includes("LIST_DRAFTS")) return "Finding your drafts…";
  if (n.includes("FETCH_MESSAGE") || n.includes("GET_MESSAGE")) return "Reading an email…";
  if (n.includes("SEARCH_PEOPLE") || n.includes("LIST_CONTACTS") || n.includes("GET_CONTACT")) return "Looking up contacts…";
  if (n.includes("REPLY")) return "Drafting a reply…";
  if (n.includes("CREATE_DRAFT") || n.includes("CREATE_EMAIL_DRAFT")) return "Saving a draft…";
  if (n.includes("SEND")) return "Sending…";
  if (n.includes("DELETE") || n.includes("TRASH") || n.includes("MOVE")) return "Updating your mailbox…";
  if (n.includes("LABEL") || n.includes("PATCH")) return "Updating labels…";
  if (n.includes("ATTACHMENT")) return "Fetching an attachment…";
  if (n.includes("CALENDAR") || n.includes("EVENT")) return "Checking your calendar…";
  if (n.includes("DRIVE") || n.includes("FILE")) return "Searching your files…";
  return "Working…";
}

// Action tools that warrant a "done" receipt, mapped to a receipt kind. Reads
// (fetch/search/list) return "" — they show a card, not a receipt.
function actionKind(name: string): string {
  const n = (name || "").toUpperCase();
  if (n.includes("SAVE_MEMORY")) return "memory";
  if (n.includes("REPLY")) return "reply";
  if (n.includes("SEND_EMAIL") || n.includes("SEND_DRAFT") || (n.includes("SEND") && n.includes("MAIL"))) return "sent";
  if (n.includes("CREATE_DRAFT") || n.includes("CREATE_EMAIL_DRAFT")) return "draft";
  if (n.includes("MOVE_TO_TRASH")) return "trash";
  if (n.includes("DELETE")) return "deleted";
  if (n.includes("PATCH_LABEL") || n.includes("MOVE_MESSAGE") || (n.includes("UPDATE") && n.includes("EMAIL"))) return "updated";
  return "";
}
function receiptFor(kind: string): { kind: string; title: string } {
  switch (kind) {
    case "sent": return { kind, title: "Email sent" };
    case "reply": return { kind, title: "Reply sent" };
    case "draft": return { kind, title: "Draft saved" };
    case "deleted": return { kind, title: "Deleted" };
    case "trash": return { kind, title: "Moved to Trash" };
    case "updated": return { kind, title: "Updated" };
    case "memory": return { kind, title: "Saved to memory" };
    default: return { kind: "done", title: "Done" };
  }
}

// ---- Server-side turn completion -------------------------------------------
// So a task that started while the app was open still COMPLETES and is SAVED if
// the user leaves the app (the model read is finished via EdgeRuntime.waitUntil,
// not tied to the client connection), then we push them that it's ready.
function titleOf(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user");
  const t = (first?.content ?? "").trim().replace(/\s+/g, " ");
  return t ? (t.length > 42 ? t.slice(0, 42) + "…" : t) : "New chat";
}
async function persistTurn(uid: string, convId: string, history: Msg[], reply: string): Promise<void> {
  if (!SB_URL || !SB_SERVICE_KEY || !uid || !convId || !reply.trim()) return;
  try {
    const slim = history.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ ...a, data: "" })) } : {}),
    }));
    const messages = [...slim, { role: "assistant", content: reply }];
    await fetch(`${SB_URL}/rest/v1/conversations`, {
      method: "POST",
      headers: {
        apikey: SB_SERVICE_KEY,
        authorization: `Bearer ${SB_SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: convId, user_id: uid, title: titleOf(history), messages, updated_at: new Date().toISOString() }),
    });
  } catch { /* best effort — the client also persists when it's connected */ }
}
async function firePush(authHeader: string, body: string): Promise<void> {
  if (!authHeader) return;
  try {
    await fetch(MCP_URL.replace("/gofarther-mcp", "/send-push"), {
      method: "POST",
      headers: { authorization: authHeader, "content-type": "application/json" },
      body: JSON.stringify({ title: "Go Farther", body }),
    });
  } catch { /* inert until APNs is configured */ }
}
// App-level memory: facts/preferences the user manually saved. Fed into the
// system prompt so the assistant personalizes across every chat. A memory may
// also carry an attachment (image/file) the assistant can surface in chat.
interface Mem { id: string; content: string; attType: string | null }
async function fetchMemories(uid: string): Promise<Mem[]> {
  if (!SB_URL || !SB_SERVICE_KEY || !uid) return [];
  try {
    const url = `${SB_URL}/rest/v1/user_memory?user_id=eq.${encodeURIComponent(uid)}&select=id,content,attachment_type&order=created_at.asc`;
    const r = await fetch(url, {
      headers: { apikey: SB_SERVICE_KEY, authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!r.ok) return [];
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    return rows
      .map((x: { id?: string; content?: string; attachment_type?: string | null }) => ({ id: String(x?.id ?? ""), content: (x?.content || "").trim(), attType: x?.attachment_type || null }))
      .filter((m: Mem) => m.content);
  } catch {
    return [];
  }
}

// Keep the injected-memory cost flat regardless of how many the user has saved:
// when the list is small, send all; when it's large, send the ones relevant to
// this message (keyword overlap) plus the most-recent few (always-on prefs).
const MAX_MEMS = 30;
const MEM_STOP = new Set("the a an of to and or in on at is are was were be been do does did how what who when where why can could would should will just about your you his her our their this that with from for".split(" "));
function selectMemories(mems: Mem[], query: string): Mem[] {
  if (mems.length <= MAX_MEMS) return mems;
  const words = new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !MEM_STOP.has(w)));
  const keep = new Set<number>();
  if (words.size) {
    const scored = mems
      .map((m, i) => {
        const t = m.content.toLowerCase();
        let s = 0;
        for (const w of words) if (t.includes(w)) s++;
        if (m.attType) s += 0.5; // nudge attachment memories so "show me X" can resolve
        return { i, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    for (const x of scored) { if (keep.size >= MAX_MEMS) break; keep.add(x.i); }
  }
  // Fill the rest with the most-recent memories (recent prefs stay always-on).
  for (let i = mems.length - 1; i >= 0 && keep.size < MAX_MEMS; i--) keep.add(i);
  return mems.filter((_, i) => keep.has(i)); // preserves created_at asc order
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response("The assistant isn't configured yet (ANTHROPIC_API_KEY missing on the server).", { status: 500, headers: cors });
  }

  let messages: Msg[];
  let requestedApps: string[] | undefined;
  let tz = "UTC";
  let clientCards = false;
  let conversationId = ""; // for server-side persistence of the finished turn
  let memoryOn = true;     // false = user paused the whole memory feature (no inject, no tool)
  let location: { lat: number; lon: number; label?: string } | null = null; // device location for "here/near me"
  try {
    const body = await req.json();
    messages = body.messages;
    if (Array.isArray(body.apps)) requestedApps = body.apps; // per-session connector ids
    if (typeof body.tz === "string" && body.tz) tz = body.tz; // device timezone
    if (body.cards === true) clientCards = true; // client can render rich blocks (inbox cards)
    if (typeof body.conversationId === "string") conversationId = body.conversationId;
    if (body.memory === false) memoryOn = false; // memory paused for this turn
    const L = body.location;
    if (L && typeof L.lat === "number" && typeof L.lon === "number") location = { lat: L.lat, lon: L.lon, ...(typeof L.label === "string" && L.label ? { label: L.label } : {}) };
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("bad body");
  } catch {
    return new Response("Invalid request body — expected { messages: [...] }.", { status: 400, headers: cors });
  }

  // Fast path: tapping an email row sends "Open this email: … [[gfid:ID]]". That's
  // an unambiguous request to open ONE specific email — there's nothing for the
  // model to decide, and the reader card fetches that message (sender, subject,
  // body, attachments) by id itself. So return the card directly. This makes a
  // tap-to-open card-only EVERY time — no prose can leak, no dependence on the
  // model emitting the right block or on the email app being in scope — and it
  // still works even when the model is unavailable (e.g. no API credits).
  const tappedId = latestUser(messages).text.match(/\[\[gfid:([^\]\s]+)\]\]/)?.[1];
  if (tappedId) {
    const card = `\`\`\`gf-message\n{"id":${JSON.stringify(tappedId)}}\n\`\`\``;
    return new Response(card, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
  }

  // Attach the MCP server, scoped to THIS user's connected apps. The proxy runs
  // tools as this same user id (passed in the URL) so users only touch their own data.
  let mcpServers: unknown[] | undefined;
  let mcpTools: unknown[] | undefined;
  let emailUI = false; // expose the rich inbox-card format only when an email app is in scope
  const extraHeaders: Record<string, string> = {};
  const appUser = userFromJwt(req);
  // Kick off the memory read in parallel with the connector lookup below (skip it
  // entirely when the feature is paused).
  const memPromise = (appUser && memoryOn) ? fetchMemories(appUser) : Promise.resolve([] as Mem[]);
  if (appUser) {
    const connected = await connectedToolkits(appUser);
    // If the client sent a per-session app list, scope tools to it (∩ connected);
    // otherwise expose everything connected.
    let apps = connected;
    if (requestedApps) {
      const wanted = new Set(requestedApps.map((id) => APP_TO_SLUG[id]).filter(Boolean));
      apps = connected.filter((s) => wanted.has(s));
    }
    // Attach the MCP toolset when there are connector tools OR memory is on (it
    // serves the built-in GF_SAVE_MEMORY tool, so "remember that…" works in any
    // chat). Paused memory adds &mem=0 so the proxy drops that tool. emailUI (rich
    // inbox cards) still only turns on for an email app.
    if (apps.length || memoryOn) {
      emailUI = clientCards && (apps.includes("gmail") || apps.includes("outlook"));
      const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(appUser)}${memoryOn ? "" : "&mem=0"}`;
      mcpServers = [{ type: "url", url, name: "connectors", authorization_token: await mintUserToken(appUser) }];
      // Current MCP connector format (mcp-client-2025-11-20): the toolset lives
      // in `tools`. cache_control caches the proxy-returned tool schemas — the
      // big, stable part of the prompt — so follow-up turns re-read them at ~10%
      // price instead of full. Only the tools prefix is cached on purpose: the
      // system prompt carries a per-minute timestamp, and since the cache order
      // is tools -> system -> messages, the tools cache stays stable regardless.
      mcpTools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
    }
  }

  // Current time in the user's local timezone (falls back to UTC if tz is bad).
  let nowLocal: string;
  try {
    nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date());
  } catch {
    tz = "UTC";
    nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full", timeStyle: "short" }).format(new Date());
  }
  const baseSystem = `You are Go Farther, a helpful, friendly assistant inside a mobile app. It is currently ${nowLocal} in the user's timezone (${tz}); use this for anything time-related (e.g. calendar date ranges) instead of guessing, and ALWAYS show times to the user in their local timezone (${tz}) — never UTC. You're on a narrow phone screen: keep formatting simple. Be clear and concise. When connector tools are available (Gmail, Google Calendar, Google Drive, etc.), use them to act on the user's behalf — search and read email, check and create calendar events, find and read files. Always confirm details before sending an email or creating/changing anything. When more than one connected app could handle the same request and the user didn't say which — for ANY request, whether a read/list/search OR an action (send, create, change, delete, pay) — do NOT guess, do NOT default to one, and do NOT silently combine them: ASK which app or account to use first, in one short line (e.g. "Which mailbox — Gmail or Outlook?"), then wait. Only once the user picks (or if they name one up front, like "in QuickBooks" or "my Outlook") do you act, using just that app. When the user EXPLICITLY asks you to remember something about them for the future (e.g. "remember that…", "keep in mind…", "from now on…", "don't forget…"), call the GF_SAVE_MEMORY tool with a concise, self-contained statement, then briefly confirm in plain text — do NOT use it for ordinary chatter or one-off task details. You can also search the web for current information (web search), open and read a web page or link the user shares (web fetch), and run code to do precise math or analyze numbers like their bank transactions (code execution) — use these whenever they help. You also have built-in tools (when available) for the weather/forecast anywhere (GF_WEATHER) and, where configured, finding places and directions via Google Maps (GF_MAPS). Images and PDFs the user attaches are visible to you directly; a Word, Excel, CSV, or other non-PDF document is placed in your code sandbox, so read it with the code execution tool (e.g. python-docx, openpyxl, or pandas) before answering about it. When the user wants a file as the OUTPUT — a spreadsheet, PDF, chart/image, or document — create it with the code execution tool and save it to a file; the app delivers any file you generate as a download, so produce a real file instead of pasting a big table as text.`;
  // When an email app is in scope, render inbox listings as rich cards: the app
  // turns a ```gf-emails JSON block into a styled email list.
  const emailCardsSystem = `\n\nEMAIL DISPLAY — when an email tool is available, follow these rules EXACTLY:\n• Whenever you present multiple emails — the inbox, search results, OR a set of emails for the user to choose from (e.g. "which one?") — render them as a single fenced code block tagged gf-emails containing ONLY a JSON array (one object per email) with keys "from", "email", "subject", "snippet" (≤ 12 words), "time" (short label in the user's timezone, e.g. "9:41 AM", "Yesterday", "May 19"), "unread" (boolean), "id" (the Gmail message id, used to open the email). NEVER list emails as a plain numbered or bulleted list. You may write at most one short line (such as a question) before the block, but the emails themselves must be inside the block.\n• To open, read, show, view, or re-open ONE specific email — including "open it", "read that email", "show me the email", or tapping or hitting "try again" on an email — your ENTIRE reply MUST be a single fenced code block tagged gf-message containing one JSON object whose only required key is "id" (the Gmail message id); the app loads the sender, subject, body and attachments itself. That block is the ONLY acceptable way to show an email: do NOT type out the From/To/Date/Subject or the body as text or markdown, do NOT add any words before or after the block, and do NOT summarize unless explicitly asked. If a user message contains a marker like [[gfid:ID]], they tapped an email — reply with the gf-message block for that exact id.\n• When you show the user's existing drafts, use the SAME cards (gf-emails for the list, gf-message for one), with "draft": true on each item and its "id" set to the draft's message id so it still opens. ANY display of email content — inbox, search, drafts, or a single message — is ALWAYS a card; NEVER write emails out as plain text or a raw JSON dump.\n• To look up people or contacts (find someone's email or phone, check whether a contact exists, "do I have a contact for X", etc.), CALL the contacts/people search tool, then reply with AT MOST one short lead-in line (e.g. "Here's what I found:"). Do NOT write the contacts out yourself and do NOT put them in a code block — the app renders the matching contacts as a card automatically (with each person's photo where they have one).\n• Only when the user EXPLICITLY asks to summarize, draft, reply to, or send an email do you reply in normal text (no code block).`;
  // User's saved memories (manual, app-level) -> personalize every chat. Placed
  // after the timestamped baseSystem so it doesn't disturb the cached tools prefix.
  const allMems = await memPromise;
  const mems = selectMemories(allMems, latestUser(messages).text);
  let memorySystem = "";
  if (mems.length) {
    const lines = mems.map((m) => `• ${m.content}${m.attType ? ` [attachment: ${m.attType}, id: ${m.id}]` : ""}`).join("\n");
    memorySystem = `\n\nWHAT YOU KNOW ABOUT THIS USER (they saved these for you to remember; honor them unless a message clearly overrides one):\n${lines}`;
    if (mems.some((m) => m.attType)) {
      memorySystem += `\n\nSome of those memories have an attached image or file (shown as [attachment: …, id: …]). Two ways to use one: (1) to SHOW it to the user in chat, reply with a fenced code block tagged gf-memory containing ONLY {"id":"<that memory's id>"} (the app displays the image inline, or a file to open; you may put one short line before the block); (2) to SEND or ATTACH it through another app (attach to an email, upload to Slack, etc.), FIRST call the GF_GET_MEMORY_FILE tool with that memory id AND the toolkit_slug + tool_slug of the action you're about to use (e.g. "gmail" / "GMAIL_SEND_EMAIL"); it returns {s3key, mimetype, name} — pass that object straight into that same tool's attachment/file parameter. The staging tool handles large files for you, so NEVER claim a saved file is too large to attach, and NEVER tell the user to attach or send it themselves/manually when you have a send tool — just use the tool. If a send that includes an attachment errors or times out, do NOT invent a size limit and do NOT silently resend it (it may already have gone out): tell the user it may not have completed and ask them to check or confirm before retrying. When the user only asks ABOUT it, just answer from the saved description.`;
    }
  }
  // Route this turn: Opus for genuinely complex/long asks, Sonnet for everything
  // else. A single default model keeps the cached tool-schema prefix warm.
  const model = pickModel(messages);
  console.log(`routed model=${model.replace(/^claude-/, "")}`);

  // Office/CSV/text attachments can't be sent inline (only images + PDFs can), so
  // upload them to the Files API and reference them with a container_upload block
  // that the code execution tool reads (python-docx / openpyxl / pandas). Only the
  // current turn carries data — older turns are stripped on persist — so this is
  // at most a couple of small uploads per message.
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.attachments)) continue;
    for (const a of m.attachments) {
      if (a.kind !== "file" || a.fileId || !a.data) continue;
      const id = await uploadToFiles(a.data, a.mediaType || "application/octet-stream", a.name || "file", apiKey);
      if (id) a.fileId = id;
    }
  }

  // The user's device location (only sent for location-relevant turns) — let the
  // assistant resolve "here / near me / weather / directions" without asking.
  let locationSystem = "";
  if (location) {
    const where = location.label || `${location.lat}, ${location.lon}`;
    const coords = `${location.lat},${location.lon}`;
    locationSystem = `\n\nUSER'S CURRENT LOCATION: ${where} (coordinates ${coords}). When the user says "here", "near me", "nearby", "my area", or asks about weather, places, or directions without naming a place, use THIS location instead of asking where they are: pass "${where}" to GF_WEATHER, use "${coords}" as the GF_MAPS directions origin for "from here", and search GF_MAPS places near "${where}". Refer to the place by name, not raw coordinates, unless asked.`;
  }

  const reqBody: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    system: baseSystem + locationSystem + memorySystem + (emailUI ? emailCardsSystem : ""),
    messages: messages.map((m) => ({ role: m.role, content: buildContent(m) })),
    stream: true,
  };
  if (mcpServers) reqBody.mcp_servers = mcpServers;
  // Anthropic server tools: web fetch (read a URL the user shared) + code execution
  // (precise math / data crunching). Always available; appended after the MCP
  // toolset so the cached tools prefix stays intact.
  reqBody.tools = [
    ...(mcpTools || []),
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 },
    { type: "code_execution_20250825", name: "code_execution" },
  ];
  const betas = ["code-execution-2025-08-25", "files-api-2025-04-14"]; // files-api: read uploaded Office/CSV + retrieve files the sandbox generates
  if (mcpServers) betas.push("mcp-client-2025-11-20");
  extraHeaders["anthropic-beta"] = betas.join(",");

  let upstream = await callAnthropic(reqBody, apiKey, extraHeaders);
  // If the routed model isn't available/usable, fall back to Sonnet so chat never breaks.
  if (!upstream.ok && reqBody.model !== MODELS.sonnet) {
    const e = await upstream.text().catch(() => "");
    console.log(`model ${reqBody.model} failed ${upstream.status}; falling back to sonnet: ${e.slice(0, 100)}`);
    reqBody.model = MODELS.sonnet;
    upstream = await callAnthropic(reqBody, apiKey, extraHeaders);
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    console.error(`anthropic upstream ${upstream.status}: ${errText.slice(0, 500)}`);
    return new Response(`Assistant error (${upstream.status})`, { status: 502, headers: cors });
  }

  // For an explicit "open / read / show / try again" on an email we suppress the
  // model's prose and emit ONLY the card; summarize/draft/reply keep their text.
  const lastUserText = latestUser(messages).text;
  const summarizeIntent = /\b(summar|draft|reply|respond|compose|forward|tl;?dr|brief|gist|digest)\b/i.test(lastUserText);
  const openIntent = !summarizeIntent && (/\b(open|read|show|view|see|pull up|bring up|look at|let me see)\b/i.test(lastUserText) || /^\s*(try\s*again|again)\b/i.test(lastUserText.trim()));
  const bufferEmail = emailUI && openIntent;

  const authHeader = req.headers.get("authorization") || "";
  let clientOpen = true; // flips false if the app disconnects (e.g. backgrounds mid-turn)
  const out = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      let persistOut = ""; // final assistant content to persist (status markers excluded)
      const emit = (s: string, persist = true) => {
        if (persist) persistOut += s;
        if (clientOpen) { try { controller.enqueue(enc.encode(s)); } catch { clientOpen = false; } }
      };
      // Finish the whole turn even if the client disconnects mid-stream.
      const run = async () => {
      const reader = upstream.body!.getReader();
      let buf = "";
      let fullText = "";                             // text streamed to the client this turn
      const toolName: Record<number, string> = {};   // tool name per content-block index
      const toolJson: Record<number, string> = {};   // accumulated input JSON per index
      const openedIds = new Set<string>();            // single emails the model fetched by id
      let listArgs: unknown = {};                     // args of a FETCH_EMAILS (inbox) call
      let listCalled = false;
      let peopleCalled = false;                       // the model searched contacts/people
      let peopleSlug = "";                            // exact people-search slug to re-run
      let peopleArgs: unknown = {};                   // args of that people-search call
      const actionById: Record<string, string> = {}; // tool_use id -> receipt kind (action tools only)
      let receipt: { kind: string; title: string } | null = null; // a confirmed successful action
      const generatedFileIds = new Set<string>(); // files the code-execution sandbox created
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]" || data === "") continue;
            try {
              const evt = JSON.parse(data);
              // Lightweight cost telemetry: log token usage (incl. cache hits)
              // so caching can be verified and spend tracked from the logs.
              if (evt.type === "message_start" && evt.message?.usage) {
                const u = evt.message.usage;
                console.log(`usage in=${u.input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
              }
              // Watch tool calls so we can tell when the model opened ONE email.
              if (evt.type === "content_block_start" && evt.content_block &&
                  (evt.content_block.type === "mcp_tool_use" || evt.content_block.type === "tool_use")) {
                toolName[evt.index] = String(evt.content_block.name ?? "");
                toolJson[evt.index] = "";
                // Stream a transient "working…" status to the client (out-of-band
                // from fullText, so the card/post-processor logic is unaffected).
                emit(`[[gfstatus:${statusLabel(toolName[evt.index])}]]`, false);
                const ak = actionKind(toolName[evt.index]);
                if (ak && evt.content_block.id) actionById[String(evt.content_block.id)] = ak;
              }
              // An MCP tool result — mark the action's outcome for the receipt card
              // (only on real success, so we never show a false "Sent ✓").
              if (evt.type === "content_block_start" && evt.content_block && evt.content_block.type === "mcp_tool_result") {
                const tid = String(evt.content_block.tool_use_id ?? "");
                const ak = tid && actionById[tid];
                if (ak && evt.content_block.is_error !== true) receipt = receiptFor(ak);
              }
              // Files the code execution sandbox created — collect their ids to
              // deliver as downloads after the stream. (Block types vary by tool
              // version: code_execution_tool_result / bash_code_execution_tool_result.)
              if (evt.type === "content_block_start" && evt.content_block) {
                const cbt = String(evt.content_block.type ?? "");
                if (cbt.includes("code_execution") && cbt.endsWith("_result")) {
                  const inner = (evt.content_block as { content?: unknown }).content as { content?: unknown[] } | unknown[] | undefined;
                  const arr = Array.isArray(inner) ? inner : (inner && Array.isArray(inner.content) ? inner.content : []);
                  for (const it of arr) { const fid = (it as { file_id?: unknown })?.file_id; if (typeof fid === "string" && fid) generatedFileIds.add(fid); }
                }
              }
              if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta" && evt.index in toolJson) {
                toolJson[evt.index] += evt.delta.partial_json ?? "";
              }
              if (evt.type === "content_block_stop" && evt.index in toolName) {
                const nm = toolName[evt.index].toUpperCase();
                if (nm.includes("FETCH_MESSAGE")) {
                  try {
                    const a = JSON.parse(toolJson[evt.index] || "{}");
                    const id = a.message_id ?? a.messageId ?? a.id;
                    if (typeof id === "string" && id) openedIds.add(id);
                  } catch { /* ignore */ }
                } else if (nm.includes("FETCH_EMAILS")) {
                  listCalled = true;
                  try { listArgs = JSON.parse(toolJson[evt.index] || "{}"); } catch { /* keep {} */ }
                } else if (nm.includes("LIST_DRAFTS")) {
                  // Drafts: guarantee a card by re-listing them via FETCH_EMAILS(in:drafts),
                  // which (unlike LIST_DRAFTS) returns full metadata. buildInboxCard flags them.
                  listCalled = true; listArgs = { query: "in:drafts", max_results: 12 };
                } else if (nm.includes("SEARCH_PEOPLE")) {
                  // Contacts: guarantee a card by re-running the SAME people search.
                  peopleCalled = true; peopleSlug = toolName[evt.index];
                  try { peopleArgs = JSON.parse(toolJson[evt.index] || "{}"); } catch { /* keep {} */ }
                }
                delete toolName[evt.index]; delete toolJson[evt.index];
              }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                fullText += evt.delta.text;
                if (!bufferEmail) emit(evt.delta.text);
              }
            } catch { /* ignore partial json */ }
          }
        }
        // Guarantee an email card. The model usually formats it; this is the
        // server-side safety net so opening an email OR listing the inbox ALWAYS
        // renders as a card, regardless of which model ran or how it formatted it.
        const hasGf = /```gf/.test(fullText);
        if (bufferEmail && hasGf) {
          // Explicit open/show + the model produced a card: emit just that block
          // (card only, drop any surrounding prose).
          emit(fullText.match(/```gf[\s\S]*?```/)?.[0] ?? fullText);
        } else if (!hasGf && !summarizeIntent && emailUI && !receipt && (openedIds.size === 1 || listCalled)) {
          // The model fetched email(s) but produced no card — build & inject one.
          let card = "";
          if (openedIds.size === 1) {
            card = `\`\`\`gf-message\n{"id":"${[...openedIds][0]}"}\n\`\`\``;
          } else {
            const json = await buildInboxCard(appUser ?? "", listArgs, tz);
            if (json) card = `\`\`\`gf-emails\n${json}\n\`\`\``;
          }
          emit(bufferEmail ? (card || fullText) : (card ? `\n\n${card}` : ""));
        } else if (!hasGf && !summarizeIntent && emailUI && !receipt && peopleCalled) {
          // The model searched contacts but produced no card — build & inject one.
          const json = await buildContactsCard(appUser ?? "", peopleSlug, peopleArgs);
          const card = json ? `\`\`\`gf-contacts\n${json}\n\`\`\`` : "";
          emit(card ? `\n\n${card}` : "");
        } else if (bufferEmail) {
          // Buffered but not an email turn after all — emit the held text.
          emit(fullText);
        }
        // A confirmed successful action — append a guaranteed receipt card.
        if (receipt) emit(`\n\n\`\`\`gf-receipt\n${JSON.stringify(receipt)}\n\`\`\``);
        // Hand back any files the sandbox generated, as downloadable chips.
        let nf = 0;
        for (const fid of generatedFileIds) {
          if (nf >= 5) break;
          const gfile = await deliverGeneratedFile(appUser ?? "", fid, apiKey);
          if (gfile) { emit(`\n\n\`\`\`gf-file\n${JSON.stringify(gfile)}\n\`\`\``); nf++; }
        }
      } catch (e) {
        console.error("chat stream error:", e);
        emit(`\n⚠️ Something went wrong on our end. Please try again.`);
      } finally {
        try { controller.close(); } catch { /* already closed (client gone) */ }
      }
      // Turn finished — persist it (so it survives the app being closed) and, if
      // the user had left mid-turn, push them that it's ready.
      await persistTurn(appUser ?? "", conversationId, messages, persistOut);
      if (!clientOpen) await firePush(authHeader, "Your reply is ready.");
      };
      const p = run();
      try { if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p); } catch { /* not supported here */ }
    },
    cancel() { clientOpen = false; }, // app went away — keep finishing via waitUntil, then push
  });

  return new Response(out, {
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "x-gf-model": String(reqBody.model), "Access-Control-Expose-Headers": "x-gf-model" },
  });
});
