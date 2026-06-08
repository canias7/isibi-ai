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
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const MODEL = "claude-sonnet-4-6";

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

function userFromJwt(req: Request): string | null {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// Per-user MCP auth: a short-lived HMAC-signed token binding the acting user id,
// so gmail-mcp derives identity from the token, not a forgeable query param.
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

async function runInstruction(uid: string, instruction: string, tz: string, steps: Step[]): Promise<{ summary: string; steps: StepResult[] }> {
  if (!ANTHROPIC_KEY) throw new Error("assistant not configured");
  const [apps, memOn] = await Promise.all([connectedToolkits(uid), memoryEnabled(uid)]);
  const mems = memOn ? await fetchMemories(uid) : [];
  const memSys = mems.length ? `\n\nWHAT YOU KNOW ABOUT THIS USER (saved memories; honor them):\n${mems.map((m) => `• ${m}`).join("\n")}` : "";

  const wantSteps = steps.length > 0;
  const stepList = wantSteps ? `\n\nSTEPS (in order — "id — what it does"):\n${steps.map((s) => `${s.id} — ${s.label}`).join("\n")}` : "";
  const outFmt = wantSteps
    ? `\n\nWhen finished, reply with ONLY a JSON object (no prose, no code fences), shaped EXACTLY:\n{"summary":"2-3 plain sentences on the overall outcome","steps":[{"id":"<step id>","ok":true,"output":"one short line: what this step produced, or why it failed"}]}\nInclude exactly one entry per step id listed above, in the same order. No markdown or emoji inside any value.`
    : ` Then reply with a SHORT summary of what you did and the outcome — at most 2-3 sentences. Plain text only: no markdown, no emoji, no code blocks.`;
  const system = `You are Go Farther, running this saved automation for the user RIGHT NOW. The user tapped "Test" to watch it run, so this is a REAL run — any action you take (sending, posting, creating, deleting) actually happens, exactly like a live run. Do it carefully.

Carry out the steps in order using the connected tools.${stepList} Stay strictly in scope: read and reason as needed, but only take an OUTWARD action (send, post, reply, create, delete, pay) that a step explicitly calls for — never add one on your own. Use the user's local timezone (${tz}).

Be strictly honest about each step's outcome: if a step needs an app/tool you don't have, or a tool call fails, mark that step ok:false and say what's missing — NEVER claim a step succeeded when it didn't.${outFmt}${memSys}`;

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
    // cache_control caches the (large) MCP tool schemas across the model's tool-use turns.
    reqBody.tools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
    extra["anthropic-beta"] = "mcp-client-2025-11-20";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) throw new Error(`assistant ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
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

async function saveRun(workflowId: string, uid: string, result: string, ok: boolean): Promise<void> {
  if (!SB_URL || !SB_KEY || !workflowId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/workflow_runs`, { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ workflow_id: workflowId, user_id: uid, result, ok }) });
    await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${workflowId}`, { method: "PATCH", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ last_run_at: new Date().toISOString() }) });
  } catch { /* best effort */ }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);

  const uid = userFromJwt(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  let instruction = "", workflowId = "", tz = "UTC";
  let steps: Step[] = [];
  try {
    const b = await req.json();
    instruction = String(b.instruction || "").trim().slice(0, 6000);
    workflowId = String(b.workflow_id || "");
    if (typeof b.tz === "string" && b.tz) tz = b.tz;
    if (Array.isArray(b.steps)) {
      steps = b.steps.slice(0, 40)
        .map((s: any) => ({ id: String(s?.id || ""), label: String(s?.label || "").slice(0, 200), app: String(s?.app || "") }))
        .filter((s: Step) => s.id);
    }
  } catch { /* fallthrough */ }
  if (!instruction) return J({ error: "Nothing to run." }, 400);

  let ok = true, result = "", stepsOut: StepResult[] = [];
  try {
    const out = await runInstruction(uid, instruction, tz, steps);
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
