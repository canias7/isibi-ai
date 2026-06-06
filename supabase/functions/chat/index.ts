import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");

// Bearer shared with gmail-mcp, DERIVED at runtime from a server-only secret —
// never stored in the repo. Both functions compute the same value from
// COMPOSIO_API_KEY, so they stay in sync with no coordination.
async function mcpToken(): Promise<string> {
  const base = (COMPOSIO_API_KEY ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

interface Attach { kind?: string; mediaType?: string; data?: string; name?: string }
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
    } else {
      const mt = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(a.mediaType ?? "") ? a.mediaType : "image/jpeg";
      blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: a.data } });
    }
  }
  if (m.content && m.content.trim()) blocks.push({ type: "text", text: m.content });
  return blocks;
}

// ---- Model routing: pick Haiku / Sonnet / Opus per task ----
const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};
// Clear-cut cases are handled instantly by these rules; only the ambiguous
// middle pays for the tiny Haiku classifier below.
const COMPLEX_RE = /\b(analy[sz]e|analysis|plan|planning|strategy|strategi|compare|comparison|comprehensive|in[- ]?depth|detailed (report|plan|breakdown|analysis)|research|debug|refactor|coding|algorithm|step[- ]by[- ]step|reason through|pros and cons|trade[- ]?offs|evaluate|forecast|optimi[sz]e)\b/i;
const TRIVIAL_RE = /^\s*(hi|hey+|hello|yo|sup|thanks|thank you|ty|ok(ay)?|cool|nice|great|perfect|got it|gotcha|yes|yep|yeah|no|nope|good (morning|night|evening|afternoon)|how are you)\b[\s!.?]*$/i;

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

// Tiny, cheap Haiku call that labels the task SIMPLE / STANDARD / COMPLEX.
async function classifyTask(text: string, hasAtt: boolean, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 6,
        system: "You route requests for an assistant that can use the user's email, calendar and files. Reply with ONE word only: SIMPLE, STANDARD, or COMPLEX. SIMPLE = a quick lookup/list/read, a short factual question, or one easy action. STANDARD = typical work: summarize, draft or reply to an email, multi-step tool use, light reasoning. COMPLEX = deep analysis, multi-step planning, comparing many things, careful long-form writing, coding, or anything needing strong reasoning.",
        messages: [{ role: "user", content: (hasAtt ? "[has image/PDF attachment] " : "") + text.slice(0, 1500) }],
      }),
    });
    if (!res.ok) return MODELS.sonnet;
    const j = await res.json();
    const out = String(j?.content?.[0]?.text ?? "").toUpperCase();
    if (out.includes("COMPLEX")) return MODELS.opus;
    if (out.includes("SIMPLE")) return hasAtt ? MODELS.sonnet : MODELS.haiku; // vision wants Sonnet+
    return MODELS.sonnet;
  } catch {
    return MODELS.sonnet;
  }
}

// Hybrid router: instant rules for the obvious cases, classifier for the rest.
async function pickModel(messages: Msg[], apiKey: string): Promise<string> {
  const { text, hasAtt } = latestUser(messages);
  const len = text.trim().length;
  if (!hasAtt && len < 64 && TRIVIAL_RE.test(text)) return MODELS.haiku;
  if (COMPLEX_RE.test(text) || len > 900) return MODELS.opus;
  return await classifyTask(text, hasAtt, apiKey);
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
  try {
    const body = await req.json();
    messages = body.messages;
    if (Array.isArray(body.apps)) requestedApps = body.apps; // per-session connector ids
    if (typeof body.tz === "string" && body.tz) tz = body.tz; // device timezone
    if (body.cards === true) clientCards = true; // client can render rich blocks (inbox cards)
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
  if (appUser) {
    const connected = await connectedToolkits(appUser);
    // If the client sent a per-session app list, scope tools to it (∩ connected);
    // otherwise expose everything connected.
    let apps = connected;
    if (requestedApps) {
      const wanted = new Set(requestedApps.map((id) => APP_TO_SLUG[id]).filter(Boolean));
      apps = connected.filter((s) => wanted.has(s));
    }
    if (apps.length) {
      emailUI = clientCards && (apps.includes("gmail") || apps.includes("outlook"));
      const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(appUser)}`;
      mcpServers = [{ type: "url", url, name: "connectors", authorization_token: await mcpToken() }];
      // Current MCP connector format (mcp-client-2025-11-20): the toolset lives
      // in `tools`. cache_control caches the proxy-returned tool schemas — the
      // big, stable part of the prompt — so follow-up turns re-read them at ~10%
      // price instead of full. Only the tools prefix is cached on purpose: the
      // system prompt carries a per-minute timestamp, and since the cache order
      // is tools -> system -> messages, the tools cache stays stable regardless.
      mcpTools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
      extraHeaders["anthropic-beta"] = "mcp-client-2025-11-20";
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
  const baseSystem = `You are Go Farther, a helpful, friendly assistant inside a mobile app. It is currently ${nowLocal} in the user's timezone (${tz}); use this for anything time-related (e.g. calendar date ranges) instead of guessing, and ALWAYS show times to the user in their local timezone (${tz}) — never UTC. You're on a narrow phone screen: keep formatting simple. Be clear and concise. When connector tools are available (Gmail, Google Calendar, Google Drive, etc.), use them to act on the user's behalf — search and read email, check and create calendar events, find and read files. Always confirm details before sending an email or creating/changing anything. When more than one connected app could handle the same request and the user didn't say which — for ANY request, whether a read/list/search OR an action (send, create, change, delete, pay) — do NOT guess, do NOT default to one, and do NOT silently combine them: ASK which app or account to use first, in one short line (e.g. "Which mailbox — Gmail or Outlook?"), then wait. Only once the user picks (or if they name one up front, like "in QuickBooks" or "my Outlook") do you act, using just that app.`;
  // When an email app is in scope, render inbox listings as rich cards: the app
  // turns a ```gf-emails JSON block into a styled email list.
  const emailCardsSystem = `\n\nEMAIL DISPLAY — when an email tool is available, follow these rules EXACTLY:\n• Whenever you present multiple emails — the inbox, search results, OR a set of emails for the user to choose from (e.g. "which one?") — render them as a single fenced code block tagged gf-emails containing ONLY a JSON array (one object per email) with keys "from", "email", "subject", "snippet" (≤ 12 words), "time" (short label in the user's timezone, e.g. "9:41 AM", "Yesterday", "May 19"), "unread" (boolean), "id" (the Gmail message id, used to open the email). NEVER list emails as a plain numbered or bulleted list. You may write at most one short line (such as a question) before the block, but the emails themselves must be inside the block.\n• To open, read, show, view, or re-open ONE specific email — including "open it", "read that email", "show me the email", or tapping or hitting "try again" on an email — your ENTIRE reply MUST be a single fenced code block tagged gf-message containing one JSON object whose only required key is "id" (the Gmail message id); the app loads the sender, subject, body and attachments itself. That block is the ONLY acceptable way to show an email: do NOT type out the From/To/Date/Subject or the body as text or markdown, do NOT add any words before or after the block, and do NOT summarize unless explicitly asked. If a user message contains a marker like [[gfid:ID]], they tapped an email — reply with the gf-message block for that exact id.\n• When you show the user's existing drafts, use the SAME cards (gf-emails for the list, gf-message for one), with "draft": true on each item and its "id" set to the draft's message id so it still opens. ANY display of email content — inbox, search, drafts, or a single message — is ALWAYS a card; NEVER write emails out as plain text or a raw JSON dump.\n• To look up people or contacts (find someone's email or phone, check whether a contact exists, "do I have a contact for X", etc.), CALL the contacts/people search tool, then reply with AT MOST one short lead-in line (e.g. "Here's what I found:"). Do NOT write the contacts out yourself and do NOT put them in a code block — the app renders the matching contacts as a card automatically (with each person's photo where they have one).\n• Only when the user EXPLICITLY asks to summarize, draft, reply to, or send an email do you reply in normal text (no code block).`;
  // Route to the right model for this task (Haiku/Sonnet/Opus).
  let model = await pickModel(messages, apiKey);
  // Email card rendering needs a model that reliably emits the gf-message block;
  // the lightweight model often free-types the email as text instead.
  if (emailUI && model === MODELS.haiku) model = MODELS.sonnet;
  console.log(`routed model=${model.replace(/^claude-/, "")}`);
  const reqBody: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    system: baseSystem + (emailUI ? emailCardsSystem : ""),
    messages: messages.map((m) => ({ role: m.role, content: buildContent(m) })),
    stream: true,
  };
  if (mcpServers) reqBody.mcp_servers = mcpServers;
  if (mcpTools) reqBody.tools = mcpTools;

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
    return new Response(`Assistant error ${upstream.status}: ${errText}`, { status: 502, headers: cors });
  }

  // For an explicit "open / read / show / try again" on an email we suppress the
  // model's prose and emit ONLY the card; summarize/draft/reply keep their text.
  const lastUserText = latestUser(messages).text;
  const summarizeIntent = /\b(summar|draft|reply|respond|compose|forward|tl;?dr|brief|gist|digest)\b/i.test(lastUserText);
  const openIntent = !summarizeIntent && (/\b(open|read|show|view|see|pull up|bring up|look at|let me see)\b/i.test(lastUserText) || /^\s*(try\s*again|again)\b/i.test(lastUserText.trim()));
  const bufferEmail = emailUI && openIntent;

  const out = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
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
                controller.enqueue(enc.encode(`[[gfstatus:${statusLabel(toolName[evt.index])}]]`));
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
                if (!bufferEmail) controller.enqueue(enc.encode(evt.delta.text));
              }
            } catch { /* ignore partial json */ }
          }
        }
        // Guarantee an email card. The model usually formats it; this is the
        // server-side safety net so opening an email OR listing the inbox ALWAYS
        // renders as a card, regardless of which model ran (so even Haiku is fine).
        const hasGf = /```gf/.test(fullText);
        if (bufferEmail && hasGf) {
          // Explicit open/show + the model produced a card: emit just that block
          // (card only, drop any surrounding prose).
          controller.enqueue(enc.encode(fullText.match(/```gf[\s\S]*?```/)?.[0] ?? fullText));
        } else if (!hasGf && !summarizeIntent && emailUI && (openedIds.size === 1 || listCalled)) {
          // The model fetched email(s) but produced no card — build & inject one.
          let card = "";
          if (openedIds.size === 1) {
            card = `\`\`\`gf-message\n{"id":"${[...openedIds][0]}"}\n\`\`\``;
          } else {
            const json = await buildInboxCard(appUser ?? "", listArgs, tz);
            if (json) card = `\`\`\`gf-emails\n${json}\n\`\`\``;
          }
          controller.enqueue(enc.encode(bufferEmail ? (card || fullText) : (card ? `\n\n${card}` : "")));
        } else if (!hasGf && !summarizeIntent && emailUI && peopleCalled) {
          // The model searched contacts but produced no card — build & inject one.
          const json = await buildContactsCard(appUser ?? "", peopleSlug, peopleArgs);
          const card = json ? `\`\`\`gf-contacts\n${json}\n\`\`\`` : "";
          controller.enqueue(enc.encode(card ? `\n\n${card}` : ""));
        } else if (bufferEmail) {
          // Buffered but not an email turn after all — emit the held text.
          controller.enqueue(enc.encode(fullText));
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n⚠️ ${e instanceof Error ? e.message : String(e)}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "x-gf-model": String(reqBody.model), "Access-Control-Expose-Headers": "x-gf-model" },
  });
});
