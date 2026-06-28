import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Ops monitor. Woken by pg_cron every 15 minutes (authenticated with the same
// Vault secret the cron presents). Runs cheap health probes (connectors
// liveness) and a daily-spend trip-wire, records anything wrong in ops_alerts,
// and emails the owner via Resend — at most once per 6 hours per distinct alert
// key, so an ongoing incident sends one email, not one every tick.

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

async function probeGet(name: string, path: string): Promise<string | null> {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/${path}`);
    return r.ok ? null : `${name} answered ${r.status} to the health probe`;
  } catch (e) {
    return `${name} is unreachable: ${String((e as Error).message)}`;
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

// Email reputation auto-pauses recorded by the campaigns guard (it writes ops_alerts
// rows but has no mailer). One summary per tick; mark them emailed so we don't repeat.
async function flushReputationAlerts(): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/ops_alerts?key=like.reputation:*&emailed=eq.false&created_at=gt.${encodeURIComponent(since)}&select=id,message&limit=25`, { headers: sbHeaders });
    if (!r.ok) return 0;
    const rows = (await r.json()) as { id: string; message: string }[];
    if (!Array.isArray(rows) || !rows.length) return 0;
    if (RESEND_API_KEY && ALERT_EMAIL) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [ALERT_EMAIL],
            subject: `[Go Farther alert] ${rows.length} sender(s) auto-paused (reputation)`,
            text: `${rows.map((x) => "• " + x.message).join("\n")}\n\nThese customers were auto-paused to protect the shared sending IP. Review them in the app.`,
          }),
        });
      } catch { /* email is best effort */ }
    }
    await fetch(`${SB_URL}/rest/v1/ops_alerts?id=in.(${rows.map((x) => x.id).join(",")})`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ emailed: true }) });
    return rows.length;
  } catch { return 0; }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const bearer = (req.headers.get("authorization") || "").replace(/^bearer\s+/i, "").trim();
  const secret = await expectedSecret();
  if (!secret || bearer !== secret) return new Response("unauthorized", { status: 401 });

  const checks: Record<string, string | null> = {
    connectors: await probeGet("gmail-oauth", "gmail-oauth/x"),
    spend: await probeSpend(),
  };
  let alerts = 0;
  for (const [key, problem] of Object.entries(checks)) {
    if (problem) { alerts++; await alert(key, problem); }
  }
  const reputationEmailed = await flushReputationAlerts();
  return json({ ok: alerts === 0, alerts, checks, reputationEmailed });
});
