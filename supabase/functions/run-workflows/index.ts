import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Workflow runner. Woken by pg_cron every few minutes (authenticated with a
// random secret stored in Vault). It finds scheduled workflows that are due,
// runs each one's instruction through Claude + that user's connectors, saves the
// result as a workflow_run, pushes the user a notification, and reschedules.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const PUSH_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/send-push";
const MODEL = "claude-sonnet-4-6";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const sbHeaders = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

// Shared bearer with gmail-mcp (derived from a server-only secret).
async function mcpToken(): Promise<string> {
  const base = (COMPOSIO_API_KEY ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_memory?user_id=eq.${encodeURIComponent(uid)}&select=content&order=created_at.asc`, { headers: sbHeaders });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x: { content?: string }) => (x?.content || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
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

// App-agnostic poller: ask the model to list, via the app's own tools, the most
// recent items matching the user's condition, each with a STABLE id from the tool
// result. The runner dedupes by id so only genuinely new items fire — this works
// for every connector without per-app code.
interface DetectedItem { id: string; line: string }
async function detectItems(uid: string, ev: any): Promise<DetectedItem[]> {
  if (!ANTHROPIC_KEY || !COMPOSIO_API_KEY) return [];
  const slug = APP_TO_SLUG[ev?.app] || String(ev?.app || "");
  if (!slug) return [];
  const connected = await connectedToolkits(uid);
  if (!connected.includes(slug)) return []; // app not connected -> nothing to watch
  const filter = String(ev?.filter || "").trim() || "any new item";
  const url = `${MCP_URL}?apps=${encodeURIComponent(slug)}&user=${encodeURIComponent(uid)}&mem=0`;
  const system = `You check whether a trigger condition is currently met in a connected app. Use ONLY the available tools to look up the most recent items that match the user's condition. Then reply with ONLY a compact JSON array (no prose, no markdown, no code fences) of up to 15 items, newest first, each shaped {"id":"<the item's stable unique id straight from the tool result>","line":"<short one-line description>"}. Use the real ids returned by the tools — never invent them. If nothing matches, reply exactly [].`;
  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: `Condition to watch for: ${filter}\nList the most recent matching items right now.` }],
    mcp_servers: [{ type: "url", url, name: "connectors", authorization_token: await mcpToken() }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "connectors" }],
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "mcp-client-2025-11-20" },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => ({ id: String(x?.id ?? "").trim(), line: String(x?.line ?? "").trim() }))
      .filter((x: DetectedItem) => x.id);
  } catch {
    return [];
  }
}

// Run one workflow's instruction through Claude (with the user's connectors).
async function runInstruction(uid: string, instruction: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("assistant not configured");
  const [apps, mems] = await Promise.all([connectedToolkits(uid), fetchMemories(uid)]);
  const memSys = mems.length
    ? `\n\nWHAT YOU KNOW ABOUT THIS USER (saved memories; honor them):\n${mems.map((m) => `• ${m}`).join("\n")}`
    : "";
  const system = `You are Go Farther, running a saved automation for the user (no one is watching live). Carry out the instruction using the connected tools as needed, then reply with a clear, concise result the user can read in a notification and a saved summary. Reply in PLAIN TEXT only — no code blocks or special card formats. Use the user's local timezone for any times.${memSys}`;
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
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
  return text || "(no output)";
}

async function patchWorkflow(id: string, fields: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/workflows?id=eq.${id}`, { method: "PATCH", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify(fields) });
  } catch { /* best effort */ }
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

  const now = new Date();
  const nowIso = now.toISOString();
  const q = `${SB_URL}/rest/v1/workflows?enabled=eq.true&trigger_type=eq.schedule&or=(next_run_at.is.null,next_run_at.lte.${encodeURIComponent(nowIso)})&select=*&limit=50`;
  const r = await fetch(q, { headers: sbHeaders });
  if (!r.ok) return json({ error: `query ${r.status}` }, 500);
  const due: any[] = await r.json();

  let ran = 0, init = 0, failed = 0;
  for (const wf of due) {
    try {
      // First time we see it: just schedule its first run (don't fire immediately).
      if (!wf.next_run_at) {
        const next = computeNext(now, wf.schedule);
        await patchWorkflow(wf.id, { next_run_at: next ? next.toISOString() : null });
        init++;
        continue;
      }
      let text = "", ok = true;
      try {
        text = await runInstruction(wf.user_id, wf.instruction);
      } catch (e) {
        ok = false;
        text = `Couldn't finish this workflow: ${e instanceof Error ? e.message : String(e)}`;
      }
      await insertRun(wf.id, wf.user_id, text, ok);
      const summary = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || (ok ? "Done." : "Failed.");
      await pushUser(wf.user_id, wf.title || "Workflow", summary);
      const next = computeNext(now, wf.schedule);
      await patchWorkflow(wf.id, { last_run_at: nowIso, next_run_at: next ? next.toISOString() : null });
      ok ? ran++ : failed++;
    } catch {
      failed++;
    }
  }

  // EVENT workflows: fire when a new matching item appears in the chosen app.
  let eventChecked = 0, eventFired = 0;
  try {
    const er = await fetch(`${SB_URL}/rest/v1/workflows?enabled=eq.true&trigger_type=eq.event&select=*&limit=50`, { headers: sbHeaders });
    if (er.ok) {
      const evs: any[] = await er.json();
      eventChecked = evs.length;
      for (const wf of evs) {
        try {
          const items = await detectItems(wf.user_id, wf.event || {});
          // First check: record what's already there, don't fire on the backlog.
          if (!wf.cursor) {
            await patchWorkflow(wf.id, { cursor: { seen: items.map((i) => i.id).slice(0, 200) } });
            continue;
          }
          const seen: string[] = Array.isArray(wf.cursor?.seen) ? wf.cursor.seen : [];
          const seenSet = new Set(seen);
          const fresh = items.filter((i) => !seenSet.has(i.id));
          if (!fresh.length) continue;
          const ctx = fresh.slice(0, 8).map((i) => `• ${i.line}`).join("\n");
          const prompt = `Your trigger fired — new item(s) just detected:\n${ctx}\n\nNow do the following: ${wf.instruction}`;
          let text = "", ok = true;
          try {
            text = await runInstruction(wf.user_id, prompt);
          } catch (e) {
            ok = false;
            text = `Couldn't finish this workflow: ${e instanceof Error ? e.message : String(e)}`;
          }
          await insertRun(wf.id, wf.user_id, text, ok);
          const summary = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || (ok ? "Done." : "Failed.");
          await pushUser(wf.user_id, wf.title || "Workflow", summary);
          // Remember everything currently seen (fresh + prior), capped.
          const merged = [...fresh.map((i) => i.id), ...seen].slice(0, 200);
          await patchWorkflow(wf.id, { cursor: { seen: merged }, last_run_at: nowIso });
          eventFired++;
        } catch { /* skip this one */ }
      }
    }
  } catch { /* ignore event phase errors */ }

  return json({ checked: due.length, ran, init, failed, eventChecked, eventFired });
});
