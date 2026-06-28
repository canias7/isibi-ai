import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// SMS — platform-provisioned Twilio (ISV / subaccount model). ONE master Twilio
// account (server secret) provisions a number per user IN-APP: the app creates a
// Twilio subaccount for the user, buys a number into it, and sends from it — users
// never touch the Twilio console. Per-user subaccount creds live in sms_connections
// (RLS on, service-role only). 10DLC registration is a later stage.
//
// Actions (POST { action, ... }, via supabase.functions.invoke):
//   status                                 -> { ready, number? }
//   searchNumbers { areaCode?, country? }  -> { numbers:[{ phoneNumber, locality, region }] }
//   buyNumber { phoneNumber }              -> { ok, number } | { error }
//   release                                -> { ok }
//   send { to, body }                      -> { ok, sid, remaining } | { error }
//
// App-level outcomes return HTTP 200 { error } — supabase-js hides non-2xx bodies.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const MASTER_SID = Deno.env.get("TWILIO_MASTER_SID") || "";
const MASTER_TOKEN = Deno.env.get("TWILIO_MASTER_TOKEN") || "";
const DAILY_LIMIT = Math.max(1, Number(Deno.env.get("SMS_DAILY_LIMIT") || "200"));
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
const TW = "https://api.twilio.com/2010-04-01";
const masterReady = () => !!(MASTER_SID && MASTER_TOKEN);

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "https://gofarther.dev", "https://www.gofarther.dev", "ionic://localhost", "http://localhost", "https://localhost",
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

function toE164(raw: unknown): string | null {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
}

// One Twilio REST call (Basic auth). `form` present => POST/DELETE body; GET otherwise.
async function tw(authSid: string, authToken: string, method: string, path: string, form?: URLSearchParams): Promise<{ ok: boolean; status: number; j: any }> {
  const init: RequestInit = { method, headers: { authorization: `Basic ${btoa(`${authSid}:${authToken}`)}` } };
  if (form) {
    (init.headers as Record<string, string>)["content-type"] = "application/x-www-form-urlencoded";
    init.body = form.toString();
  }
  let r: Response;
  try { r = await fetch(`${TW}${path}`, init); } catch (e) { return { ok: false, status: 0, j: { message: String((e as Error)?.message || e) } }; }
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

type Conn = { account_sid: string; auth_token: string; from_number: string | null; phone_sid: string | null; status: string };
async function getConn(uid: string): Promise<Conn | null> {
  const r = await fetch(
    `${SB_URL}/rest/v1/sms_connections?user_id=eq.${encodeURIComponent(uid)}&select=account_sid,auth_token,from_number,phone_sid,status`,
    { headers: sbHeaders },
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] as Conn : null;
}
const connReady = (c: Conn | null): boolean => !!(c && c.account_sid && c.auth_token && c.from_number && c.status === "active");

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
    method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" },
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
  try { body = await req.json(); } catch { /* status/release take no body */ }
  const action = String(body?.action || "");

  if (action === "status") {
    const c = await getConn(uid);
    return J({ ready: connReady(c), number: c?.from_number || null });
  }

  // ---- everything below provisions/sends through the master account ----
  if (!masterReady()) return J({ error: "sms_unset" });

  if (action === "searchNumbers") {
    const country = (String(body?.country || "US").toUpperCase().match(/^[A-Z]{2}$/) || ["US"])[0];
    const areaCode = String(body?.areaCode || "").replace(/\D/g, "").slice(0, 5);
    const qs = new URLSearchParams({ SmsEnabled: "true", Limit: "12" });
    if (areaCode) qs.set("AreaCode", areaCode);
    const r = await tw(MASTER_SID, MASTER_TOKEN, "GET", `/Accounts/${MASTER_SID}/AvailablePhoneNumbers/${country}/Local.json?${qs}`);
    if (!r.ok) return J({ error: "search_failed", detail: String(r.j?.message || r.status).slice(0, 200) });
    const numbers = (r.j?.available_phone_numbers || []).map((n: any) => ({
      phoneNumber: n.phone_number, locality: n.locality, region: n.region,
    }));
    return J({ numbers });
  }

  if (action === "buyNumber") {
    const phone = toE164(body?.phoneNumber);
    if (!phone) return J({ error: "bad_number" });
    const existing = await getConn(uid);
    if (existing && existing.status === "active") return J({ error: "already_provisioned" });

    // 1. Create a subaccount for this user.
    const sub = await tw(MASTER_SID, MASTER_TOKEN, "POST", `/Accounts.json`, new URLSearchParams({ FriendlyName: `sendra-${uid}` }));
    if (!sub.ok || !sub.j?.sid || !sub.j?.auth_token) return J({ error: "subaccount_failed", detail: String(sub.j?.message || sub.status).slice(0, 200) });
    const subSid = String(sub.j.sid);
    const subToken = String(sub.j.auth_token);

    // 2. Buy the number into the subaccount.
    const buy = await tw(subSid, subToken, "POST", `/Accounts/${subSid}/IncomingPhoneNumbers.json`, new URLSearchParams({ PhoneNumber: phone }));
    if (!buy.ok || !buy.j?.sid) {
      // Roll back the empty subaccount we just created.
      await tw(MASTER_SID, MASTER_TOKEN, "POST", `/Accounts/${subSid}.json`, new URLSearchParams({ Status: "closed" }));
      return J({ error: "buy_failed", detail: String(buy.j?.message || buy.status).slice(0, 200) });
    }

    // 3. Save the connection.
    const r = await fetch(`${SB_URL}/rest/v1/sms_connections?on_conflict=user_id`, {
      method: "POST", headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, account_sid: subSid, auth_token: subToken, from_number: phone, phone_sid: String(buy.j.sid), messaging_service_sid: null, status: "active", updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return J({ error: "save_failed" }, 502);
    return J({ ok: true, number: phone });
  }

  if (action === "release") {
    const c = await getConn(uid);
    if (c?.account_sid) {
      if (c.phone_sid && c.auth_token) {
        await tw(c.account_sid, c.auth_token, "DELETE", `/Accounts/${c.account_sid}/IncomingPhoneNumbers/${c.phone_sid}.json`);
      }
      await tw(MASTER_SID, MASTER_TOKEN, "POST", `/Accounts/${c.account_sid}.json`, new URLSearchParams({ Status: "closed" }));
    }
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

    const form = new URLSearchParams({ To: to, From: c!.from_number!, Body: text });
    const r = await tw(c!.account_sid, c!.auth_token, "POST", `/Accounts/${c!.account_sid}/Messages.json`, form);
    if (!r.ok || !r.j?.sid) {
      await logSms(uid, to, null, "failed");
      return J({ error: "send_failed", detail: String(r.j?.message || `twilio_${r.status}`).slice(0, 200) });
    }
    await logSms(uid, to, String(r.j.sid), "sent");
    return J({ ok: true, sid: String(r.j.sid), remaining: Math.max(0, DAILY_LIMIT - used - 1) });
  }

  return J({ error: "unknown action" }, 400);
});
