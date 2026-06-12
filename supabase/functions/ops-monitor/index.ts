import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Ops monitor. Woken by pg_cron every 15 minutes (authenticated with the same
// Vault secret as the workflow runner). Runs cheap health probes and money/
// failure trip-wires, records anything wrong in ops_alerts, and emails the
// owner via Resend — at most once per 6 hours per distinct alert key, so an
// ongoing incident sends one email, not one every tick.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Go Farther <onboarding@resend.dev>";
// Where alerts go. Override with the ALERT_EMAIL secret; defaults to the
// account owner so alerts work without any setup.
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "aniascapital@gmail.com";
// Estimated AI spend for the current UTC day that trips an alert, in USD.
const SPEND_ALERT_USD = Number(Deno.env.get("DAILY_SPEND_ALERT_USD")) || 25;
const ALERT_COOLDOWN_MS = 6 * 3600 * 1000;

const sbHeaders = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// The chat probe needs the project's PUBLIC anon JWT (the same one shipped in
// the app — chat sits behind verify_jwt, which wants a user-style JWT; the
// env-injected SUPABASE_ANON_KEY is a newer key format the gateway rejects).
// It lives in app_config (key `probe_anon_key`) instead of being hardcoded in
// source: the value is public by design, so a world-readable config row adds
// zero exposure, and rotating the key is a one-row UPDATE — not a redeploy.
let anonCache = "";
async function probeAnonKey(): Promise<string> {
  if (anonCache) return anonCache;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.probe_anon_key&select=text_value&limit=1`, { headers: sbHeaders });
    if (r.ok) {
      const rows = await r.json();
      anonCache = typeof rows?.[0]?.text_value === "string" ? rows[0].text_value : "";
    }
  } catch { /* the chat probe is skipped this tick */ }
  return anonCache;
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

// Raise an alert: log it, store it, and email it — unless the same key already
// alerted within the cooldown window (then stay silent; the incident is known).
async function alert(key: string, message: string): Promise<void> {
  console.error(`[ops-alert] ${key}: ${message}`);
  try {
    const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/ops_alerts?key=eq.${encodeURIComponent(key)}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=1`, { headers: sbHeaders });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return; // already alerted within the cooldown
    }
  } catch { /* if the check fails, alert anyway — better twice than never */ }
  let emailed = false;
  if (RESEND_API_KEY && ALERT_EMAIL) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [ALERT_EMAIL],
          subject: `[Go Farther alert] ${key}`,
          text: `${message}\n\nRaised by ops-monitor at ${new Date().toISOString()}.\nThis alert is muted for 6 hours; check the Supabase logs/ops_alerts table for detail.`,
        }),
      });
      emailed = res.ok;
    } catch { /* email is best effort */ }
  }
  try {
    await fetch(`${SB_URL}/rest/v1/ops_alerts`, {
      method: "POST",
      headers: { ...sbHeaders, prefer: "return=minimal" },
      body: JSON.stringify({ key, message, emailed }),
    });
  } catch { /* the console.error above is the fallback record */ }
}

// ---- probes ------------------------------------------------------------------
// Each returns a problem string, or null when healthy.

// chat: POST an empty body. A healthy function answers 400 ("invalid body")
// instantly without touching the model — a free end-to-end liveness probe.
// Uses the ANON key: chat sits behind verify_jwt, which wants the same kind of
// user-facing JWT the app sends (the service-role key gets 401 at the gateway).
async function probeChat(): Promise<string | null> {
  const anon = await probeAnonKey();
  // Missing config is NOT "can't probe ≠ broken": with no key the chat probe
  // would be silently off forever (every tick ok:true). Alert it — the 6h
  // cooldown keeps it to one email — so a lost app_config row gets noticed.
  if (!anon) return "chat probe disabled — app_config row 'probe_anon_key' is missing or unreadable";
  try {
    const r = await fetch(`${SB_URL}/functions/v1/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${anon}`, apikey: anon, "content-type": "application/json" },
      body: "{}",
    });
    if (r.status === 400 || r.status === 503) return null; // 503 = the kill switch, which is intentional
    return `chat answered ${r.status} to the health probe (expected 400)`;
  } catch (e) {
    return `chat is unreachable: ${String((e as Error).message)}`;
  }
}
async function probeGet(name: string, path: string): Promise<string | null> {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/${path}`);
    return r.ok ? null : `${name} answered ${r.status} to the health probe`;
  } catch (e) {
    return `${name} is unreachable: ${String((e as Error).message)}`;
  }
}

// Workflows stuck: enabled scheduled workflows whose next_run_at is >20 min in
// the past mean the runner hasn't claimed them — it's down or failing.
async function probeWorkflows(): Promise<string | null> {
  try {
    const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/workflows?enabled=eq.true&trigger_type=eq.schedule&next_run_at=lt.${encodeURIComponent(cutoff)}&select=id`, {
      headers: { ...sbHeaders, prefer: "count=exact", "range-unit": "items", range: "0-0" },
    });
    if (!r.ok) return null; // can't check ≠ broken
    const total = Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
    return total > 0 ? `${total} scheduled workflow(s) are overdue by >20 min — the runner looks stuck` : null;
  } catch {
    return null;
  }
}

// Tool failure spike: >=10 calls in the last hour with >=50% failing.
async function probeToolFailures(): Promise<string | null> {
  try {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/tool_usage?created_at=gt.${encodeURIComponent(since)}&select=success&limit=1000`, { headers: sbHeaders });
    if (!r.ok) return null;
    const rows: { success: boolean }[] = await r.json();
    if (!Array.isArray(rows) || rows.length < 10) return null;
    const fails = rows.filter((x) => x.success === false).length;
    return fails / rows.length >= 0.5
      ? `tool calls are failing: ${fails}/${rows.length} failed in the last hour`
      : null;
  } catch {
    return null;
  }
}

// Spend trip-wire: rough USD estimate of today's AI usage from ai_usage.
// Prices per MTok: Opus 5/25, Sonnet 3/15, Haiku 1/5; cache reads ~10% of the
// input price, cache writes ~125%. Whisper ≈ $0.006/min (16kHz mono WAV ≈ 32KB/s).
function priceFor(model: string): { inP: number; outP: number } {
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return { inP: 5, outP: 25 };
  if (m.includes("haiku")) return { inP: 1, outP: 5 };
  return { inP: 3, outP: 15 }; // sonnet + default
}
async function probeSpend(): Promise<string | null> {
  try {
    const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/ai_usage?created_at=gte.${encodeURIComponent(dayStart)}&select=source,model,in_tokens,cache_write_tokens,cache_read_tokens,out_tokens,bytes&limit=10000`, { headers: sbHeaders });
    if (!r.ok) return null;
    const rows: { source: string; model: string; in_tokens: number; cache_write_tokens: number; cache_read_tokens: number; out_tokens: number; bytes: number }[] = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    let usd = 0;
    for (const x of rows) {
      if (x.source === "whisper") { usd += (Number(x.bytes) / (32000 * 60)) * 0.006; continue; }
      const { inP, outP } = priceFor(x.model);
      usd += (Number(x.in_tokens) * inP + Number(x.cache_write_tokens) * inP * 1.25 + Number(x.cache_read_tokens) * inP * 0.1 + Number(x.out_tokens) * outP) / 1_000_000;
    }
    return usd > SPEND_ALERT_USD
      ? `estimated AI spend today is $${usd.toFixed(2)} (alert threshold $${SPEND_ALERT_USD}) across ${rows.length} calls`
      : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const bearer = (req.headers.get("authorization") || "").replace(/^bearer\s+/i, "").trim();
  const secret = await expectedSecret();
  if (!secret || bearer !== secret) return new Response("unauthorized", { status: 401 });

  const checks: Record<string, string | null> = {
    chat: await probeChat(),
    mcp: await probeGet("gofarther-mcp", "gofarther-mcp"),
    connectors: await probeGet("gmail-oauth", "gmail-oauth/x"),
    workflows: await probeWorkflows(),
    tool_failures: await probeToolFailures(),
    spend: await probeSpend(),
  };
  let alerts = 0;
  for (const [key, problem] of Object.entries(checks)) {
    if (problem) { alerts++; await alert(key, problem); }
  }
  return json({ ok: alerts === 0, alerts, checks });
});
