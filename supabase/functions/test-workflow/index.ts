import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Run a workflow ON DEMAND (the "Test" button). Executes the compiled
// instruction right now, as the calling user, through their connectors — same
// path the scheduled runner uses — and returns { ok, result }. If a workflow_id
// is given, the run is also saved to its history. Real side effects happen
// (it actually sends/creates things), exactly like a live run.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const MODEL = "claude-sonnet-4-6";

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

async function mcpToken(): Promise<string> {
  const base = (COMPOSIO_API_KEY ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

async function runInstruction(uid: string, instruction: string, tz: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("assistant not configured");
  const [apps, memOn] = await Promise.all([connectedToolkits(uid), memoryEnabled(uid)]);
  const mems = memOn ? await fetchMemories(uid) : [];
  const memSys = mems.length ? `\n\nWHAT YOU KNOW ABOUT THIS USER (saved memories; honor them):\n${mems.map((m) => `• ${m}`).join("\n")}` : "";
  const system = `You are Go Farther, running a saved automation for the user as a TEST. Carry out the instruction using the connected tools as needed. Then reply with a SHORT summary of what you did and the outcome — at most 2-3 sentences. Plain text only: no markdown (no **bold**, #headings, or bullet lists), no emoji, no code blocks. Use the user's local timezone (${tz}).${memSys}`;
  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: instruction }],
  };
  const extra: Record<string, string> = {};
  if (apps.length) {
    const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(uid)}&mem=0`;
    reqBody.mcp_servers = [{ type: "url", url, name: "connectors", authorization_token: await mcpToken() }];
    reqBody.tools = [{ type: "mcp_toolset", mcp_server_name: "connectors" }];
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
  return text || "(no output)";
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
  try {
    const b = await req.json();
    instruction = String(b.instruction || "").trim().slice(0, 6000);
    workflowId = String(b.workflow_id || "");
    if (typeof b.tz === "string" && b.tz) tz = b.tz;
  } catch { /* fallthrough */ }
  if (!instruction) return J({ error: "Nothing to run." }, 400);

  let ok = true, result = "";
  try {
    result = await runInstruction(uid, instruction, tz);
  } catch (e) {
    ok = false;
    result = `Couldn't finish: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (workflowId) await saveRun(workflowId, uid, result, ok);
  return J({ ok, result });
});
