import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Workflow runner. Woken by pg_cron every few minutes (authenticated with a
// random secret stored in Vault). It finds scheduled workflows that are due,
// runs each one's instruction through Claude + that user's connectors, saves the
// result as a workflow_run, pushes the user a notification, and reschedules.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gofarther-mcp";
const PUSH_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/send-push";
const MODEL = "claude-sonnet-4-6";
// The detector only lists items and copies back their ids — a cheap, mechanical
// task — so it runs on Haiku. The runner (which takes real outward actions) stays
// on MODEL above, where the extra judgment matters.
const DETECTOR_MODEL = "claude-haiku-4-5";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const sbHeaders = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

// Kill switch (feature_flags key "workflows"): lets the owner pause ALL
// background runs instantly without a deploy. Fail-open on any error.
async function flagEnabled(key: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/feature_flags?key=eq.${encodeURIComponent(key)}&select=enabled`, { headers: sbHeaders });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].enabled !== false : true;
  } catch {
    return true;
  }
}

// Cost telemetry: one ai_usage row per model call (the ops monitor sums these
// into a daily spend estimate). Fire-and-forget.
function logAiUsage(uid: string, source: string, model: string, u: any): void {
  if (!u || typeof u !== "object") return;
  fetch(`${SB_URL}/rest/v1/ai_usage`, {
    method: "POST",
    headers: { ...sbHeaders, prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: uid, source, model,
      in_tokens: Number(u.input_tokens) || 0,
      cache_write_tokens: Number(u.cache_creation_input_tokens) || 0,
      cache_read_tokens: Number(u.cache_read_input_tokens) || 0,
      out_tokens: Number(u.output_tokens) || 0,
    }),
  }).catch(() => {});
}

// Per-user MCP auth: a short-lived HMAC-signed token binding the acting user id,
// so gofarther-mcp derives identity from the token, not a forgeable query param.
// Secret is MCP_SHARED_SECRET if set, else derived (never the empty string).
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

// The cron secret the caller must present (read from Vault via the RPC).
async function expectedSecret(): Promise<string> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/wf_cron_secret`, { method: "POST", headers: sbHeaders, body: "{}" });
    if (!r.ok) return "";
    const v = await r.json();
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

// Returns the user's connected toolkit slugs, [] if they genuinely have none, or
// null if Composio couldn't be reached — callers must treat null as "couldn't
// check" (skip/retry), NOT as "nothing connected", or an outage looks like the
// user disconnecting every app.
//
// Served from the user_connections cache first, so a tick over many workflows
// isn't N Composio round trips. The TTL is long on purpose: workflows run for
// users who may not open the app for days (a short TTL would re-ask Composio
// every tick anyway), gmail-oauth rewrites the row the moment connections
// actually change, and the only drift this delays noticing is an out-of-band
// revocation — which a run already surfaces gracefully as a failed tool call.
const CONN_TTL_MS = 6 * 3600 * 1000;
async function cachedConnections(uid: string): Promise<{ toolkits: string[]; fresh: boolean } | null> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_connections?user_id=eq.${encodeURIComponent(uid)}&select=toolkits,updated_at`, { headers: sbHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row || !Array.isArray(row.toolkits)) return null;
    const age = Date.now() - new Date(row.updated_at).getTime();
    return { toolkits: row.toolkits.filter((s: unknown): s is string => typeof s === "string"), fresh: age >= 0 && age < CONN_TTL_MS };
  } catch {
    return null;
  }
}
function saveConnections(uid: string, toolkits: string[]): void {
  fetch(`${SB_URL}/rest/v1/user_connections?on_conflict=user_id`, {
    method: "POST",
    headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, toolkits, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}
async function connectedToolkits(uid: string): Promise<string[] | null> {
  const cached = await cachedConnections(uid);
  if (cached?.fresh) return cached.toolkits;
  if (!COMPOSIO_API_KEY) return cached ? cached.toolkits : [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", uid);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return cached ? cached.toolkits : null;
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const slugs = items
      .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s);
    const out = [...new Set(slugs)];
    saveConnections(uid, out);
    return out;
  } catch {
    return cached ? cached.toolkits : null;
  }
}

async function fetchMemories(uid: string): Promise<string[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_memory?user_id=eq.${encodeURIComponent(uid)}&select=content&order=created_at.asc`, { headers: sbHeaders });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x: { content?: string }) => (x?.content || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Whole-feature memory toggle (server-side); default on if the user has no row.
async function memoryEnabled(uid: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(uid)}&select=memory_on`, { headers: sbHeaders });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? !!rows[0].memory_on : true;
  } catch {
    return true;
  }
}

// ---- timezone-aware scheduling ----
function localParts(date: Date, tz: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = +p.value;
  }
  return m;
}
function tzOffsetMin(tz: string, date: Date): number {
  const m = localParts(date, tz);
  const asLocal = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return (asLocal - date.getTime()) / 60000;
}
// A local wall-clock time in tz -> the matching UTC instant.
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off = tzOffsetMin(tz, new Date(guess));
  return new Date(guess - off * 60000);
}
function localDow(date: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}
// Is `now` inside an event trigger's active window? No window = always on (24/7).
// Window is in the user's local tz; an empty `days` means every day. A window
// whose end is <= start crosses midnight (e.g. 10 PM–6 AM); the after-midnight
// portion belongs to the day the window started on.
function inWindow(now: Date, w: any): boolean {
  if (!w || typeof w !== "object") return true;
  const tz = (typeof w.tz === "string" && w.tz) ? w.tz : "UTC";
  const clamp = (n: number) => Math.min(1439, Math.max(0, Math.floor(Number(n) || 0)));
  const start = clamp(w.start), end = clamp(w.end);
  if (start === end) return false; // zero-length window = never active
  const days: number[] = Array.isArray(w.days) ? w.days.map(Number).filter((d) => d >= 0 && d <= 6) : [];
  const anyDay = days.length === 0;
  const p = localParts(now, tz);
  const mins = p.hour * 60 + p.minute;
  const dow = localDow(now, tz);
  if (start < end) return (anyDay || days.includes(dow)) && mins >= start && mins < end;
  // crosses midnight
  if (mins >= start) return anyDay || days.includes(dow);             // evening portion (today)
  if (mins < end) return anyDay || days.includes((dow + 6) % 7);      // morning portion (prev day's window)
  return false;
}
// Next UTC instant strictly after `from` that matches the schedule.
function computeNext(from: Date, sched: any): Date | null {
  if (!sched || typeof sched !== "object") return null;
  const tz = typeof sched.tz === "string" && sched.tz ? sched.tz : "UTC";
  const hour = Math.min(23, Math.max(0, Number(sched.hour) || 0));
  const minute = Math.min(59, Math.max(0, Number(sched.minute) || 0));
  const freq = sched.freq || "daily";
  const now = localParts(from, tz);
  if (freq === "hourly") {
    let cand = zonedToUtc(now.year, now.month, now.day, now.hour, minute, tz);
    while (cand <= from) cand = new Date(cand.getTime() + 3600000);
    return cand;
  }
  const want = ((Number(sched.weekday) || 0) % 7 + 7) % 7;
  let y = now.year, mo = now.month, d = now.day;
  for (let i = 0; i < 370; i++) {
    const cand = zonedToUtc(y, mo, d, hour, minute, tz);
    if (cand > from && (freq !== "weekly" || localDow(cand, tz) === want)) return cand;
    const norm = new Date(Date.UTC(y, mo - 1, d + 1));
    y = norm.getUTCFullYear(); mo = norm.getUTCMonth() + 1; d = norm.getUTCDate();
  }
  return null;
}

// ---- event triggers (any connected app) ----
// Frontend connector id -> Composio toolkit slug (event.app stores the frontend id).
const APP_TO_SLUG: Record<string, string> = {
  gmail: "gmail", gcal: "googlecalendar", gdrive: "googledrive", canva: "canva", figma: "figma",
  notion: "notion", atlassian: "jira", m365: "outlook", slack: "slack", hubspot: "hubspot",
  googlesheets: "googlesheets", googledocs: "googledocs", excel: "excel", one_drive: "one_drive",
  dropbox: "dropbox", box: "box", onenote: "onenote", airtable: "airtable", todoist: "todoist",
  googletasks: "googletasks", asana: "asana", trello: "trello", clickup: "clickup", monday: "monday",
  miro: "miro", calendly: "calendly", zoom: "zoom", googlemeet: "googlemeet", microsoft_teams: "microsoft_teams",
  webex: "webex", telegram: "telegram", discord: "discord", linkedin: "linkedin", reddit: "reddit",
  youtube: "youtube", instagram: "instagram", twitter: "twitter", spotify: "spotify", salesforce: "salesforce",
  pipedrive: "pipedrive", zoho: "zoho", zendesk: "zendesk", intercom: "intercom", freshdesk: "freshdesk",
  shopify: "shopify", stripe: "stripe", square: "square", quickbooks: "quickbooks", xero: "xero",
  typeform: "typeform", jotform: "jotform", mailchimp: "mailchimp", sendgrid: "sendgrid", klaviyo: "klaviyo",
};

// Real-connector apps a workflow's graph needs (frontend ids, from action nodes).
function neededApps(graph: any): string[] {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  return [...new Set(nodes
    .filter((n: any) => n?.kind !== "trigger" && APP_TO_SLUG[n?.app])
    .map((n: any) => String(n.app)))] as string[];
}

// Atomically claim a due workflow by advancing next_run_at, but ONLY if it's
// still at the value we read (compare-and-swap). Stops two overlapping cron
// invocations from running the same workflow twice. True = we claimed it.
async function claimDue(id: string, currentNextRunAt: string | null, next: Date | null): Promise<boolean> {
  const cond = currentNextRunAt === null ? "next_run_at=is.null" : `next_run_at=eq.${encodeURIComponent(currentNextRunAt)}`;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${id}&${cond}`, {
      method: "PATCH",
      headers: { ...sbHeaders, prefer: "return=representation" },
      body: JSON.stringify({ next_run_at: next ? next.toISOString() : null }),
    });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// App-agnostic poller: ask the model to list, via the app's own tools, the most
// recent items matching the user's condition, each with a STABLE id from the tool
// result. The runner dedupes by id so only genuinely new items fire — this works
// for every connector without per-app code.
interface DetectedItem { id: string; line: string }
async function detectItems(uid: string, ev: any, connectedArg?: string[]): Promise<DetectedItem[] | null> {
  if (!ANTHROPIC_KEY || !COMPOSIO_API_KEY) return null;
  const slug = APP_TO_SLUG[ev?.app] || String(ev?.app || "");
  if (!slug) return null; // no/unknown app -> can't watch
  const connected = connectedArg ?? await connectedToolkits(uid);
  if (!connected) return null;                // couldn't check connections -> skip, don't baseline
  if (!connected.includes(slug)) return null; // can't watch (app not connected) -> skip, don't baseline
  const filter = String(ev?.filter || "").trim() || "any new item";
  const url = `${MCP_URL}?apps=${encodeURIComponent(slug)}&user=${encodeURIComponent(uid)}&mem=0`;
  // 50, not 15: a windowed trigger can wake after a long gap with a big backlog,
  // and anything past the cap is never seen or fired.
  const system = `You check whether a trigger condition is currently met in a connected app. Use ONLY the available tools to look up the most recent items that match the user's condition. Then reply with ONLY a compact JSON array (no prose, no markdown, no code fences) of up to 50 items, newest first, each shaped {"id":"<item id>","line":"<short one-line description>"}.

The "id" MUST be the item's stable, unique identifier exactly as the tool returned it (e.g. a Gmail message id, a calendar event id, a database row id, a Slack message ts) — NOT a subject line, title, date, sender name, or anything you wrote yourself. The SAME item must produce the SAME id every time it's checked, or the trigger will fire repeatedly or miss it. Never invent or reformat an id; if you can't get a real id for an item, leave that item out. If nothing matches, reply exactly [].

Example: [{"id":"199c1f2a7b8e4d10","line":"Invoice #4521 from Acme"},{"id":"199c1f0e5a3b22ff","line":"Reschedule from Sam, Fri 3pm"}]

TOOL DISCOVERY: the app's tools are NOT pre-loaded — only a search index is. FIRST call tool_search_tool_regex with a Python-style regex for the listing/search tool you need (e.g. "(?i)gmail.*(list|fetch|search)"), then call the tool(s) it returns.`;
  const reqBody: Record<string, unknown> = {
    model: DETECTOR_MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: `Condition to watch for: ${filter}\nList the most recent matching items right now.` }],
    mcp_servers: [{ type: "url", url, name: "connectors", authorization_token: await mintUserToken(uid) }],
    // Deferred tool loading (same treatment as chat): only a search index of
    // the app's tool catalog exists until the model discovers what it needs, so
    // a check that runs every few minutes stops re-buying the whole catalog in
    // tokens each time. The 1h cache TTL comfortably outlives the poll
    // interval, keeping the now-tiny prefix (tool search + system) hot between
    // ticks.
    tools: [
      { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" },
      { type: "mcp_toolset", mcp_server_name: "connectors", default_config: { defer_loading: true }, cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
  };
  try {
    const call = () => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "mcp-client-2025-11-20" },
      body: JSON.stringify(reqBody),
    });
    let res = await call();
    // One retry on transient throttle/overload (429/529) — a momentary blip
    // shouldn't cost a whole detector cycle.
    if (res.status === 429 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await call();
    }
    // Safety net (mirrors chat): if the API rejects the deferred-tools shape
    // (400), retry once with the classic eager catalog — a trigger check must
    // never break over a cost optimization.
    if (res.status === 400) {
      console.error(`detector deferred-tools request rejected (400): ${(await res.text().catch(() => "")).slice(0, 300)} — retrying with eager catalog`);
      reqBody.tools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
      res = await call();
    }
    if (!res.ok) return null;
    const data = await res.json();
    logAiUsage(uid, "detector", DETECTOR_MODEL, data?.usage);
    const text = (data.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null; // couldn't parse a result -> "couldn't check", not "nothing"
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    const out: DetectedItem[] = [];
    const ids = new Set<string>();
    for (const x of arr) {
      const id = String(x?.id ?? "").trim();
      if (!id || ids.has(id)) continue; // skip blanks and duplicate ids
      ids.add(id);
      out.push({ id, line: String(x?.line ?? "").trim() });
    }
    return out;
  } catch {
    return null;
  }
}

// Run one workflow's instruction through Claude (with the user's connectors).
async function runInstruction(uid: string, instruction: string, connected?: string[]): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("assistant not configured");
  const apps = connected ?? (await connectedToolkits(uid)) ?? [];
  const memOn = await memoryEnabled(uid);
  const mems = memOn ? await fetchMemories(uid) : []; // respect the user's pause toggle
  const memSys = mems.length
    ? `\n\nWHAT YOU KNOW ABOUT THIS USER (saved memories; honor them):\n${mems.map((m) => `• ${m}`).join("\n")}`
    : "";
  // The connector catalog is deferred (see the mcp_toolset below), so the model
  // can't SEE those tools until it searches — without this instruction it may
  // wrongly report a connected app as unavailable. Built-ins are exempt:
  // they're eagerly loaded and need no search.
  const toolSearchSystem = apps.length
    ? `\n\nTOOL DISCOVERY: the tools for the user's connected apps (${apps.join(", ")}) exist but are NOT pre-loaded — only a search index is. The moment the instruction involves one of those apps, FIRST call tool_search_tool_regex with a Python-style pattern — e.g. "(?i)gmail.*send", "(?i)calendar.*event" — then call the tool(s) it returns. The already-loaded built-ins (GF_WEATHER, GF_MAPS, GF_GET_MEMORY_FILE, GF_SAVE_TABLE) need no search. NEVER report a needed app or tool as unavailable until a search for it came back empty.`
    : "";
  const system = `You are Go Farther, running a saved automation for the user in the background. They won't see it happen — only the result — so get it right the first time. Carry out the instruction using the connected tools.

Stay strictly in scope: read and reason as much as you need, but only take an OUTWARD action — send, post, reply, create, delete, pay — that the instruction EXPLICITLY calls for. Never add an action of your own. If there's nothing to act on, do nothing (or send the brief "nothing today" note only if the instruction asks for one).

Be strictly honest about the outcome: if a needed app or tool isn't available, or a tool call fails, say plainly what didn't happen — never claim you did something you couldn't.

When finished, reply with a clear, concise result (1-3 sentences) the user can read in a phone notification and a saved log. Plain text only — no markdown, code blocks, or cards. Use the user's local timezone for any times.

Example result: "Sent your morning digest — 12 unread emails grouped by sender, 2 flagged urgent (a contract from Acme, a reschedule from Sam)."${toolSearchSystem}${memSys}`;
  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: instruction }],
  };
  const extra: Record<string, string> = {};
  if (apps.length) {
    const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(uid)}&mem=0`;
    reqBody.mcp_servers = [{ type: "url", url, name: "connectors", authorization_token: await mintUserToken(uid) }];
    // Deferred tool loading (ported from chat): the full connected-apps catalog
    // (~200k tokens for a several-app user) stays out of the prompt — only a
    // search index — and the model discovers connector tools on demand. The
    // built-ins stay eager so an instruction like "check the weather and…"
    // works without a search round-trip; unknown names in `configs` are
    // warning-only, so this is safe when one isn't served. GF_SAVE_MEMORY is
    // left out on purpose — runs always send &mem=0, so it's never served.
    reqBody.tools = [
      { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" },
      {
        type: "mcp_toolset",
        mcp_server_name: "connectors",
        default_config: { defer_loading: true },
        configs: {
          GF_GET_MEMORY_FILE: { defer_loading: false },
          GF_SAVE_TABLE: { defer_loading: false },
          GF_WEATHER: { defer_loading: false },
          GF_MAPS: { defer_loading: false },
          GF_IMAGE: { defer_loading: false },
        },
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ];
    extra["anthropic-beta"] = "mcp-client-2025-11-20";
  }
  const call = () => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(reqBody),
  });
  let res = await call();
  // One retry on transient throttle/overload (429/529) — a momentary blip
  // shouldn't lose a scheduled run (the user only sees "failed").
  if (res.status === 429 || res.status === 529) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await call();
  }
  // Safety net (mirrors chat): if the API rejects the deferred-tools shape
  // (400), retry once with the classic eager catalog — a background run must
  // never fail over a cost optimization.
  if (res.status === 400 && apps.length) {
    console.error(`workflow deferred-tools request rejected (400): ${(await res.text().catch(() => "")).slice(0, 300)} — retrying with eager catalog`);
    reqBody.tools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
    res = await call();
  }
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  logAiUsage(uid, "workflow", MODEL, data?.usage);
  const text = (data.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
  return text || "(no output)";
}

async function patchWorkflow(id: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${id}`, { method: "PATCH", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify(fields) });
    if (!r.ok) { console.error(`patchWorkflow ${id} -> ${r.status}`); return false; }
    return true;
  } catch (e) { console.error(`patchWorkflow ${id} failed:`, e); return false; }
}
async function insertRun(workflowId: string, uid: string, result: string, ok: boolean): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/workflow_runs`, { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ workflow_id: workflowId, user_id: uid, result, ok }) });
  } catch { /* best effort */ }
}
async function pushUser(uid: string, title: string, body: string): Promise<void> {
  try {
    await fetch(PUSH_URL, { method: "POST", headers: { authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ user_id: uid, title, body }) });
  } catch { /* push is best effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const bearer = (req.headers.get("authorization") || "").replace(/^bearer\s+/i, "").trim();
  const secret = await expectedSecret();
  if (!secret || bearer !== secret) return new Response("unauthorized", { status: 401 });

  // Kill switch: with "workflows" off, skip the whole tick (both phases).
  if (!(await flagEnabled("workflows"))) return json({ disabled: true });

  const now = new Date();
  const nowIso = now.toISOString();
  // Wall-time budget: stop STARTING new work well before the platform's request
  // kill, so an in-flight run always gets to finish (a workflow claimed and then
  // killed mid-run would be a silently lost run). Whatever is still due just
  // waits for the next 5-minute tick.
  const startedAt = Date.now();
  const BUDGET_MS = 210_000;
  const inBudget = () => Date.now() - startedAt < BUDGET_MS;

  let ran = 0, init = 0, failed = 0, checked = 0;
  async function runScheduled(wf: any): Promise<void> {
    try {
      const next = computeNext(now, wf.schedule);
      // Atomically claim it (CAS on next_run_at) so an overlapping cron tick can't run it twice.
      if (!(await claimDue(wf.id, wf.next_run_at ?? null, next))) return;
      // First time we've seen it: we just scheduled its first run — don't fire now.
      if (!wf.next_run_at) { init++; return; }
      const connected = await connectedToolkits(wf.user_id);
      if (connected === null) { // Composio unreachable — don't mislabel as "not connected"
        await insertRun(wf.id, wf.user_id, "Couldn't check your connected apps just now — will try again next run.", false);
        await patchWorkflow(wf.id, { last_run_at: nowIso });
        failed++; return;
      }
      const missing = neededApps(wf.graph).filter((a) => !connected.includes(APP_TO_SLUG[a]));
      let text: string, ok: boolean, notify = true;
      if (missing.length) {
        ok = false; notify = false; // record it, but don't push every run (would spam an hourly workflow)
        text = `Couldn't run — ${missing.join(", ")} ${missing.length > 1 ? "aren't" : "isn't"} connected. Connect ${missing.length > 1 ? "them" : "it"} and it'll run next time.`;
      } else {
        try { text = await runInstruction(wf.user_id, wf.instruction, connected); ok = true; }
        catch (e) { ok = false; console.error("scheduled workflow error:", e); text = "Couldn't finish this workflow."; }
      }
      await insertRun(wf.id, wf.user_id, text, ok);
      if (notify) {
        const summary = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || (ok ? "Done." : "Failed.");
        await pushUser(wf.user_id, wf.title || "Workflow", summary);
      }
      await patchWorkflow(wf.id, { last_run_at: nowIso });
      ok ? ran++ : failed++;
    } catch {
      failed++;
    }
  }
  // Drain due workflows in pages instead of one fixed batch: run a page, then
  // re-query — claimed rows advanced their next_run_at, so each query returns
  // the NEXT page — until nothing is due or the budget is spent. Oldest due
  // first, so a backlog can't starve the same workflows every tick. MAX_PAGES
  // bounds a pathological row that stays due (e.g. its claim PATCH keeps
  // failing). Bounded concurrency: each workflow claims its own row, so running
  // a few at once is safe.
  const CONC = 3, BATCH = 50, MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES && inBudget(); page++) {
    const q = `${SB_URL}/rest/v1/workflows?enabled=eq.true&trigger_type=eq.schedule&or=(next_run_at.is.null,next_run_at.lte.${encodeURIComponent(nowIso)})&select=*&order=next_run_at.asc.nullsfirst&limit=${BATCH}`;
    const r = await fetch(q, { headers: sbHeaders });
    if (!r.ok) { if (page === 0) return json({ error: `query ${r.status}` }, 500); break; }
    const due: any[] = await r.json();
    if (!due.length) break;
    checked += due.length;
    for (let i = 0; i < due.length && inBudget(); i += CONC) {
      await Promise.all(due.slice(i, i + CONC).map(runScheduled));
    }
    if (due.length < BATCH) break; // drained
  }

  // EVENT workflows: fire when a new matching item appears in the chosen app.
  // Paged like the scheduled phase and gated by the same budget. Event rows
  // aren't claimed/advanced by a check, so pages walk a stable id order; one
  // skipped tick just means the next tick catches the same new items.
  let eventChecked = 0, eventFired = 0;
  try {
    for (let off = 0; inBudget(); off += 50) {
      const er = await fetch(`${SB_URL}/rest/v1/workflows?enabled=eq.true&trigger_type=eq.event&select=*&order=id.asc&offset=${off}&limit=50`, { headers: sbHeaders });
      if (!er.ok) break;
      const evs: any[] = await er.json();
      if (!evs.length) break;
      for (const wf of evs) {
        if (!inBudget()) break;
        eventChecked++;
        try {
          // Active-window gate: outside the user's set hours we don't poll at all
          // (the cost saver). Anything new is caught at the next in-window check.
          if (!inWindow(now, wf.event?.window)) continue;
          const evApp = String(wf.event?.app || "");
          const slug = APP_TO_SLUG[evApp] || "";
          const connected = await connectedToolkits(wf.user_id);
          if (connected === null) continue; // couldn't check connections — try next tick (don't baseline/notify)
          // Trigger's own app is disconnected: tell the user (at most once/day), then skip.
          if (slug && !connected.includes(slug)) {
            const dcAt = wf.cursor?.dcAt ? new Date(wf.cursor.dcAt).getTime() : 0;
            if (Date.now() - dcAt > 86400000) {
              await insertRun(wf.id, wf.user_id, `Trigger paused — ${evApp} isn't connected. Reconnect it to resume.`, false);
              await pushUser(wf.user_id, wf.title || "Workflow", `Trigger paused — connect ${evApp} to resume.`);
              await patchWorkflow(wf.id, { cursor: { ...(wf.cursor || {}), dcAt: new Date().toISOString() } });
            }
            continue;
          }
          const items = await detectItems(wf.user_id, wf.event || {}, connected);
          if (items === null) continue; // couldn't actually check this cycle — don't baseline or fire
          // First check: record what's already there, don't fire on the backlog.
          if (!wf.cursor?.seen) {
            await patchWorkflow(wf.id, { cursor: { seen: items.map((i) => i.id).slice(0, 200) } });
            continue;
          }
          const seen: string[] = Array.isArray(wf.cursor.seen) ? wf.cursor.seen : [];
          const seenSet = new Set(seen);
          const fresh = items.filter((i) => !seenSet.has(i.id));
          if (!fresh.length) {
            if (wf.cursor?.dcAt) await patchWorkflow(wf.id, { cursor: { seen } }); // reconnected, nothing new — clear the notice
            continue;
          }
          const missing = neededApps(wf.graph).filter((a) => !connected.includes(APP_TO_SLUG[a]));
          const ctx = fresh.slice(0, 8).map((i) => `• ${i.line} [id: ${i.id}]`).join("\n");
          const prompt = `Your trigger fired — these new item(s) were just detected in the user's connected app (their tool ids are in brackets, use them to act on the exact item):\n${ctx}\n\nUsing whatever tools across the user's apps you need (e.g. read the item, reply, send an email, create something), do the following about the item(s) above: ${wf.instruction}`;
          let text: string, ok: boolean, notify = true;
          if (missing.length) {
            ok = false; notify = false; // record it, don't push repeatedly while an app stays disconnected
            text = `Triggered, but ${missing.join(", ")} ${missing.length > 1 ? "aren't" : "isn't"} connected — connect ${missing.length > 1 ? "them" : "it"} to run this.`;
          } else {
            try { text = await runInstruction(wf.user_id, prompt, connected); ok = true; }
            catch (e) { ok = false; console.error("event workflow error:", e); text = "Couldn't finish this workflow."; }
          }
          await insertRun(wf.id, wf.user_id, text, ok);
          if (notify) {
            const summary = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || (ok ? "Done." : "Failed.");
            await pushUser(wf.user_id, wf.title || "Workflow", summary);
          }
          // Remember everything currently seen (fresh + prior), capped — even on failure, so it doesn't re-fire endlessly.
          const merged = [...fresh.map((i) => i.id), ...seen].slice(0, 200);
          // The fire already took outward actions; a dropped cursor write would re-fire
          // these same items next cycle, so retry once and log if it still fails.
          if (!(await patchWorkflow(wf.id, { cursor: { seen: merged }, last_run_at: nowIso }))
              && !(await patchWorkflow(wf.id, { cursor: { seen: merged }, last_run_at: nowIso }))) {
            console.error(`cursor write failed twice for ${wf.id} — items may re-fire`);
          }
          eventFired++;
        } catch { /* skip this one */ }
      }
      if (evs.length < 50) break; // no more event workflows
    }
  } catch { /* ignore event phase errors */ }

  return json({ checked, ran, init, failed, eventChecked, eventFired });
});
