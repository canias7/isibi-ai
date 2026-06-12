import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Run a workflow ON DEMAND (the "Test" button). Executes the compiled
// instruction right now, as the calling user, through their connectors — same
// path the scheduled runner uses. Returns { ok, result, steps }, where `steps`
// is a per-node report ([{id, ok, output}]) so the canvas can show a green check
// or pinned error on each node. If a workflow_id is given, the run is also saved
// to history. Real side effects happen, exactly like a live run.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gofarther-mcp";
const MODEL = "claude-sonnet-4-6";
// Per-workflow model choice (workflows.model), sent by the client. An explicit
// pick overrides the Sonnet default; null / unknown falls back to MODEL. Keep
// this in lockstep with the scheduled runner so Test matches a live run.
const WF_MODELS: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};

// frontend connector id -> Composio toolkit slug (a step's `app` is the frontend id)
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
// True when a step needs a real connector that isn't in the user's connected set.
function appMissing(app: string | undefined, connectedSlugs: string[]): boolean {
  const slug = APP_TO_SLUG[app || ""];
  return !!slug && !connectedSlugs.includes(slug);
}

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost",
  "http://localhost:5173", "http://localhost:4173",
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

// ---- Verified caller identity (defense-in-depth) ----------------------------
// Mirrors chat: the gateway (verify_jwt=true) already rejects forged JWTs, but
// the code must not depend on an out-of-repo flag — a Test run takes REAL
// actions as this user, so the signature is verified here too before `sub` is
// trusted. ES256 tokens verify locally against the cached public JWKS; anything
// unverifiable locally is checked with the Auth server; both failing = 401.

function b64urlBytes(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let jwksCache: { keys: Record<string, CryptoKey>; at: number } | null = null;
async function jwksKey(kid: string): Promise<CryptoKey | null> {
  if (jwksCache && (jwksCache.keys[kid] || Date.now() - jwksCache.at < 60_000)) return jwksCache.keys[kid] ?? null;
  if (!SB_URL) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/.well-known/jwks.json`);
    if (!r.ok) {
      jwksCache = { keys: jwksCache?.keys ?? {}, at: Date.now() }; // stamp the attempt — retry ≤1/min
      return jwksCache.keys[kid] ?? null;
    }
    const j = await r.json();
    const keys: Record<string, CryptoKey> = {};
    for (const k of j.keys ?? []) {
      if (k.kty !== "EC" || k.crv !== "P-256" || !k.kid) continue;
      try { keys[String(k.kid)] = await crypto.subtle.importKey("jwk", k, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); } catch { /* skip bad key */ }
    }
    jwksCache = { keys, at: Date.now() };
    return keys[kid] ?? null;
  } catch {
    jwksCache = { keys: jwksCache?.keys ?? {}, at: Date.now() }; // outage — keep stale keys, retry ≤1/min
    return jwksCache.keys[kid] ?? null;
  }
}

async function authServerUser(token: string): Promise<string | null> {
  if (!SB_URL) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey: SB_KEY ?? "" } });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.id === "string" && j.id ? j.id : null;
  } catch {
    return null;
  }
}

async function userFromJwt(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
    if (payload.role !== "authenticated" || typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(h)));
    if (header.alg === "ES256" && typeof header.kid === "string") {
      const key = await jwksKey(header.kid);
      if (key) {
        const ok = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" }, key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`),
        );
        if (ok) return payload.sub;
        return await authServerUser(token); // just-rotated key — the Auth server decides
      }
    }
    return await authServerUser(token);
  } catch {
    return null;
  }
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

const sbHeaders = { apikey: SB_KEY ?? "", authorization: `Bearer ${SB_KEY ?? ""}`, "content-type": "application/json" };

async function connectedToolkits(uid: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", uid);
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

async function fetchMemories(uid: string): Promise<string[]> {
  if (!SB_URL || !SB_KEY) return [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_memory?user_id=eq.${encodeURIComponent(uid)}&select=content&order=created_at.asc`, { headers: sbHeaders });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x: { content?: string }) => (x?.content || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
async function memoryEnabled(uid: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(uid)}&select=memory_on`, { headers: sbHeaders });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? !!rows[0].memory_on : true;
  } catch {
    return true;
  }
}

type Step = { id: string; label: string; app?: string };
type StepResult = { id: string; ok: boolean; output: string };

// Tolerant JSON parse: handles code fences and surrounding prose.
function parseLoose(text: string): any | null {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(t); } catch { /* try a substring */ }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch { /* give up */ } }
  return null;
}

async function runInstruction(uid: string, instruction: string, tz: string, steps: Step[], modelTier?: string | null): Promise<{ summary: string; steps: StepResult[] }> {
  if (!ANTHROPIC_KEY) throw new Error("assistant not configured");
  const [apps, memOn] = await Promise.all([connectedToolkits(uid), memoryEnabled(uid)]);
  const mems = memOn ? await fetchMemories(uid) : [];
  const memSys = mems.length ? `\n\nWHAT YOU KNOW ABOUT THIS USER (saved memories; honor them):\n${mems.map((m) => `• ${m}`).join("\n")}` : "";
  let nowLocal: string;
  try { nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date()); }
  catch { tz = "UTC"; nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full", timeStyle: "short" }).format(new Date()); }

  const wantSteps = steps.length > 0;
  // The connector catalog is deferred (see the mcp_toolset below) — without this
  // instruction the model may wrongly report a connected app as unavailable.
  const toolSearchSystem = apps.length
    ? `\n\nTOOL DISCOVERY: the tools for the user's connected apps (${apps.join(", ")}) exist but are NOT pre-loaded — only a search index is. The moment a step involves one of those apps, FIRST call tool_search_tool_regex with a Python-style pattern — e.g. "(?i)gmail.*send", "(?i)calendar.*event" — then call the tool(s) it returns. The already-loaded built-ins (GF_WEATHER, GF_MAPS, GF_GET_MEMORY_FILE, GF_SAVE_TABLE, GF_SET_REMINDER) need no search. NEVER report a needed app or tool as unavailable until a search for it came back empty.`
    : "";
  const stepList = wantSteps ? `\n\nSTEPS (in order — "id — what it does"):\n${steps.map((s) => `${s.id} — ${s.label}`).join("\n")}` : "";
  const outFmt = wantSteps
    ? `\n\nWhen finished, reply with ONLY a JSON object (no prose, no code fences), shaped EXACTLY:\n{"summary":"2-3 plain sentences on the overall outcome","steps":[{"id":"<step id>","ok":true,"output":"one short line: what this step produced, or why it failed"}]}\nInclude exactly one entry per step id listed above, in the same order. No markdown or emoji inside any value.`
    : ` Then reply with a SHORT summary of what you did and the outcome — at most 2-3 sentences. Plain text only: no markdown, no emoji, no code blocks.`;
  const system = `You are Go Farther, running this saved automation for the user RIGHT NOW. The user tapped "Test" to watch it run, so this is a REAL run — any action you take (sending, posting, creating, deleting) actually happens, exactly like a live run. Do it carefully.

Carry out the steps in order using the connected tools.${stepList} Stay strictly in scope: read and reason as needed, but only take an OUTWARD action (send, post, reply, create, delete, pay) that a step explicitly calls for — never add one on your own. It is currently ${nowLocal} in the user's timezone (${tz}); use it for time reasoning and show times in ${tz}. If a step asks to remind the user at a time, call GF_SET_REMINDER with a short title, an ISO 8601 datetime in ${tz}, an optional repeat, and tz "${tz}".

Be strictly honest about each step's outcome: if a step needs an app/tool you don't have, or a tool call fails, mark that step ok:false and say what's missing — NEVER claim a step succeeded when it didn't.${outFmt}${toolSearchSystem}${memSys}`;

  const reqBody: Record<string, unknown> = {
    model: WF_MODELS[modelTier ?? ""] ?? MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: instruction }],
  };
  const extra: Record<string, string> = {};
  if (apps.length) {
    const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(uid)}&tz=${encodeURIComponent(tz)}&mem=0`;
    reqBody.mcp_servers = [{ type: "url", url, name: "connectors", authorization_token: await mintUserToken(uid) }];
    // Deferred tool loading (same treatment as chat + the runner): only a search
    // index of the connected-apps catalog exists until the model discovers what
    // it needs, so a manual Test stops re-buying the whole catalog in tokens.
    // Built-ins stay eager so a step like "check the weather" needs no search;
    // unknown names in `configs` are warning-only. GF_SAVE_MEMORY is left out on
    // purpose — tests always send &mem=0, so it's never served.
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
          GF_SET_REMINDER: { defer_loading: false },
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
  // One retry on transient throttle/overload (429/529).
  if (res.status === 429 || res.status === 529) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await call();
  }
  // Safety net (mirrors chat + the runner): if the API rejects the deferred-tools
  // shape (400), retry once with the classic eager catalog.
  if (res.status === 400 && apps.length) {
    console.error(`test deferred-tools request rejected (400): ${(await res.text().catch(() => "")).slice(0, 300)} — retrying with eager catalog`);
    reqBody.tools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
    res = await call();
  }
  if (!res.ok) throw new Error(`assistant ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  logAiUsage(uid, "test", String(reqBody.model), data?.usage);
  const text = (data.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();

  if (!wantSteps) return { summary: text || "(no output)", steps: [] };

  // Steps whose app isn't connected can't have run — note it in the summary so it
  // never contradicts the per-step badges.
  const missingApps = [...new Set(steps.filter((s) => appMissing(s.app, apps)).map((s) => s.app))];
  const note = missingApps.length ? `Not connected: ${missingApps.join(", ")} — connect to run those step(s). ` : "";
  const parsed = parseLoose(text);
  if (parsed && Array.isArray(parsed.steps)) {
    const byId = new Map<string, any>(parsed.steps.map((s: any) => [String(s?.id ?? ""), s]));
    const out = steps.map((s) => {
      // A step needing an unconnected app can't have run — override the model.
      if (appMissing(s.app, apps)) return { id: s.id, ok: false, output: `${s.app} isn't connected — connect it to run this step.` };
      const r = byId.get(s.id);
      return { id: s.id, ok: r ? r.ok !== false : false, output: r ? String(r.output ?? "").slice(0, 600) : "no result reported" };
    });
    return { summary: (note + String(parsed.summary ?? text)).slice(0, 600), steps: out };
  }
  // Model didn't return structured output — it still ran; attach the prose to the
  // first step so the user can read what happened.
  return {
    summary: (note + (text || "(no output)")).slice(0, 600),
    steps: steps.map((s, i) => (
      appMissing(s.app, apps)
        ? { id: s.id, ok: false, output: `${s.app} isn't connected — connect it to run this step.` }
        : { id: s.id, ok: true, output: i === 0 ? text.slice(0, 600) : "" }
    )),
  };
}

// Cost telemetry: one ai_usage row per Test run — same models (incl. Opus) and
// tool use as a live run, and the most expensive single request a user can
// trigger on demand; without this the spend monitor silently undercounted.
function logAiUsage(uid: string, source: string, model: string, u: any): void {
  if (!u || typeof u !== "object" || !SB_URL || !SB_KEY) return;
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

async function saveRun(workflowId: string, uid: string, result: string, ok: boolean): Promise<void> {
  if (!SB_URL || !SB_KEY || !workflowId) return;
  // workflow_id comes straight from the request body and these writes run with
  // the service role (RLS bypassed) — verify shape AND ownership, or any
  // signed-in user could attach runs to / bump another user's workflow.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workflowId)) return;
  try {
    const own = await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${workflowId}&user_id=eq.${encodeURIComponent(uid)}&select=id`, { headers: sbHeaders });
    const rows = own.ok ? await own.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) return; // not the caller's workflow
    await fetch(`${SB_URL}/rest/v1/workflow_runs`, { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ workflow_id: workflowId, user_id: uid, result, ok }) });
    await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${workflowId}&user_id=eq.${encodeURIComponent(uid)}`, { method: "PATCH", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ last_run_at: new Date().toISOString() }) });
  } catch { /* best effort */ }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);

  const uid = await userFromJwt(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  let instruction = "", workflowId = "", tz = "UTC", model = "";
  let steps: Step[] = [];
  try {
    const b = await req.json();
    instruction = String(b.instruction || "").trim().slice(0, 6000);
    workflowId = String(b.workflow_id || "");
    if (typeof b.tz === "string" && b.tz) tz = b.tz;
    if (typeof b.model === "string") model = b.model; // workflow's chosen model tier
    if (Array.isArray(b.steps)) {
      steps = b.steps.slice(0, 40)
        .map((s: any) => ({ id: String(s?.id || ""), label: String(s?.label || "").slice(0, 200), app: String(s?.app || "") }))
        .filter((s: Step) => s.id);
    }
  } catch { /* fallthrough */ }
  if (!instruction) return J({ error: "Nothing to run." }, 400);

  let ok = true, result = "", stepsOut: StepResult[] = [];
  try {
    const out = await runInstruction(uid, instruction, tz, steps, model);
    result = out.summary;
    stepsOut = out.steps;
    ok = stepsOut.length ? stepsOut.every((s) => s.ok) : true;
  } catch (e) {
    ok = false;
    result = `Couldn't finish: ${e instanceof Error ? e.message : String(e)}`;
    stepsOut = steps.map((s) => ({ id: s.id, ok: false, output: "did not run" }));
  }
  if (workflowId) await saveRun(workflowId, uid, result, ok);
  return J({ ok, result, steps: stepsOut });
});
