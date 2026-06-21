import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// SMS — per-user Twilio. Each user connects their OWN Twilio account + number
// (like verifying their own email domain); credentials live in sms_connections
// (RLS on, service-role only — the auth token never goes to the client). Identity
// is server-verified (Supabase token). Every send is logged + lightly rate-limited.
//
// Actions (POST { action, ... }, via supabase.functions.invoke):
//   status                                            -> { ready, from? }
//   connect { account_sid, auth_token, from?, messaging_service_sid? } -> { ok } | { error }
//   disconnect                                        -> { ok }
//   send  { to, body }                                -> { ok, sid, remaining } | { error }
//
// App-level outcomes return HTTP 200 { error } — supabase-js hides the body of
// non-2xx responses.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const DAILY_LIMIT = Math.max(1, Number(Deno.env.get("SMS_DAILY_LIMIT") || "200"));
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

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

type Conn = { account_sid: string; auth_token: string; from_number?: string | null; messaging_service_sid?: string | null };
async function getConn(uid: string): Promise<Conn | null> {
  const r = await fetch(
    `${SB_URL}/rest/v1/sms_connections?user_id=eq.${encodeURIComponent(uid)}&select=account_sid,auth_token,from_number,messaging_service_sid`,
    { headers: sbHeaders },
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] as Conn : null;
}
const connReady = (c: Conn | null): boolean => !!(c && c.account_sid && c.auth_token && (c.from_number || c.messaging_service_sid));

// Confirm the credentials work before saving (fetch the account resource).
async function twilioValidate(sid: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { authorization: `Basic ${btoa(`${sid}:${token}`)}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function twilioSend(c: Conn, to: string, body: string): Promise<{ sid?: string; error?: string }> {
  const form = new URLSearchParams();
  form.set("To", to);
  if (c.messaging_service_sid) form.set("MessagingServiceSid", c.messaging_service_sid);
  else form.set("From", c.from_number || "");
  form.set("Body", body);
  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${c.account_sid}:${c.auth_token}`)}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.sid == null) return { error: String(j?.message || `twilio_${r.status}`) };
  return { sid: String(j.sid) };
}

async function sentToday(uid: string): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const r = await fetch(
    `${SB_URL}/rest/v1/sms_log?user_id=eq.${encodeURIComponent(uid)}&created_at=gte.${since.toISOString()}&select=id`,
    { headers: { ...sbHeaders, prefer: "count=exact", range: "0-0" } },
  );
  const cr = r.headers.get("content-range") || "";
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
  try { body = await req.json(); } catch { /* status/disconnect take no body */ }
  const action = String(body?.action || "");

  if (action === "status") {
    const c = await getConn(uid);
    return J({ ready: connReady(c), from: c?.from_number || (c?.messaging_service_sid ? "Messaging Service" : null) });
  }

  if (action === "connect") {
    const sid = String(body?.account_sid ?? "").trim();
    const tok = String(body?.auth_token ?? "").trim();
    const from = body?.from ? toE164(body.from) : null;
    const msgsvc = String(body?.messaging_service_sid ?? "").trim() || null;
    if (!/^AC[0-9a-zA-Z]{32}$/.test(sid)) return J({ error: "bad_sid" });
    if (!tok) return J({ error: "missing_token" });
    if (!from && !msgsvc) return J({ error: "missing_sender" });
    if (msgsvc && !/^MG[0-9a-zA-Z]{32}$/.test(msgsvc)) return J({ error: "bad_msgsvc" });
    if (!(await twilioValidate(sid, tok))) return J({ error: "bad_creds" });
    const r = await fetch(`${SB_URL}/rest/v1/sms_connections?on_conflict=user_id`, {
      method: "POST",
      headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, account_sid: sid, auth_token: tok, from_number: from, messaging_service_sid: msgsvc, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return J({ error: "save_failed" }, 502);
    return J({ ok: true });
  }

  if (action === "disconnect") {
    await fetch(`${SB_URL}/rest/v1/sms_connections?user_id=eq.${encodeURIComponent(uid)}`, { method: "DELETE", headers: sbHeaders });
    return J({ ok: true });
  }

  if (action === "send") {
    const c = await getConn(uid);
    if (!connReady(c)) return J({ error: "sms_unset" });
    const to = toE164(body?.to);
    if (!to) return J({ error: "bad_number" });
    const text = String(body?.body ?? "").trim();
    if (!text) return J({ error: "missing_body" });
    if (text.length > 1600) return J({ error: "too_long" });

    const used = await sentToday(uid);
    if (used >= DAILY_LIMIT) return J({ error: "rate_limited", limit: DAILY_LIMIT });

    const res = await twilioSend(c!, to, text);
    if (res.error) {
      await logSms(uid, to, null, "failed");
      return J({ error: "send_failed", detail: res.error });
    }
    await logSms(uid, to, res.sid ?? null, "sent");
    return J({ ok: true, sid: res.sid, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
  }

  return J({ error: "unknown action" }, 400);
});
