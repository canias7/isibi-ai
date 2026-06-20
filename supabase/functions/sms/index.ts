import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// SMS sender — the platform's BUILT-IN SMS via Twilio. Unlike the per-user
// IMAP/Telegram connectors, this uses ONE platform Twilio account (server
// secrets) so users text without any setup ("already there"). Every send is
// logged + rate-limited per user because the platform pays for each message.
//
// Actions (POST { action, ... }, via supabase.functions.invoke):
//   status               -> { ready }                  (is the server configured?)
//   send  { to, body }   -> { ok, sid } | { error }    (send one SMS)
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and ONE sender —
//   TWILIO_MESSAGING_SERVICE_SID (preferred: 10DLC + number pool) OR TWILIO_FROM
//   (a single E.164 number, e.g. +18885551234). Optional: SMS_DAILY_LIMIT (def 50).

const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_FROM") || "";
const TW_MSGSVC = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "";
const DAILY_LIMIT = Math.max(1, Number(Deno.env.get("SMS_DAILY_LIMIT") || "50"));
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const ready = () => !!(TW_SID && TW_TOKEN && (TW_FROM || TW_MSGSVC));

// ---- CORS ----
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

// ---- auth: verify the caller's Supabase token server-side, return their uid ----
async function verifyUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// E.164: a leading + and 8–15 digits. We strip spaces/dashes/parens first.
function toE164(raw: unknown): string | null {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
}

// How many SMS this user has sent since UTC midnight (PostgREST exact count).
async function sentToday(uid: string): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const r = await fetch(
    `${SB_URL}/rest/v1/sms_log?user_id=eq.${encodeURIComponent(uid)}&created_at=gte.${since.toISOString()}&select=id`,
    { headers: { ...sbHeaders, prefer: "count=exact", range: "0-0" } },
  );
  const cr = r.headers.get("content-range") || ""; // e.g. "0-0/12" or "*/0"
  const total = Number(cr.split("/")[1] || "0");
  return Number.isFinite(total) ? total : 0;
}
async function logSms(uid: string, to: string, sid: string | null, status: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/sms_log`, {
    method: "POST",
    headers: { ...sbHeaders, prefer: "return=minimal" },
    body: JSON.stringify({ user_id: uid, to_number: to, sid, status }),
  });
}

// Twilio Messages API. Prefer a Messaging Service (handles 10DLC + number pool);
// otherwise send from the single configured number.
async function twilioSend(to: string, body: string): Promise<{ sid?: string; error?: string }> {
  const form = new URLSearchParams();
  form.set("To", to);
  if (TW_MSGSVC) form.set("MessagingServiceSid", TW_MSGSVC);
  else form.set("From", TW_FROM);
  form.set("Body", body);
  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${TW_SID}:${TW_TOKEN}`)}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
  const j = await r.json().catch(() => ({}));
  // Twilio returns { code, message } on error; { sid, status } on success.
  if (!r.ok || j?.sid == null) return { error: String(j?.message || `twilio_${r.status}`) };
  return { sid: String(j.sid) };
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);

  const uid = await verifyUser(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* status takes no body */ }
  const action = String(body?.action || "");

  if (action === "status") return J({ ready: ready() });

  // App-level outcomes are returned as HTTP 200 with { error } so the client can
  // read the specific code — supabase-js hides the body of non-2xx responses.
  if (!ready()) return J({ error: "sms_unset" });

  if (action === "send") {
    const to = toE164(body?.to);
    if (!to) return J({ error: "bad_number" });
    const text = String(body?.body ?? "").trim();
    if (!text) return J({ error: "missing_body" });
    if (text.length > 1600) return J({ error: "too_long" });

    const used = await sentToday(uid);
    if (used >= DAILY_LIMIT) return J({ error: "rate_limited", limit: DAILY_LIMIT });

    const res = await twilioSend(to, text);
    if (res.error) {
      await logSms(uid, to, null, "failed");
      return J({ error: "send_failed", detail: res.error });
    }
    await logSms(uid, to, res.sid ?? null, "sent");
    return J({ ok: true, sid: res.sid, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
  }

  return J({ error: "unknown action" }, 400);
});
