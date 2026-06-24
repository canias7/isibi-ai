import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Send a new email (GMAIL_SEND_EMAIL) or reply in a thread (GMAIL_REPLY_TO_THREAD
// when a threadId is given). Identity is verified server-side (the caller's
// Supabase access token), so a client can only ever send as themselves.
// POST { to, subject, body, threadId?, cc?, bcc? } -> { ok } or { ok:false, error }.

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
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
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method_not_allowed" }, 405);
  if (!API_KEY) return json(req, { ok: false, error: "composio_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { ok: false, error: "unauthorized" }, 401);

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const to = String(payload.to ?? "").trim().replace(/[\r\n]/g, "");
  const subject = String(payload.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 2000); // strip CRLF (header injection) + cap
  const body = String(payload.body ?? "").slice(0, 500000);                              // cap body size (abuse/DoS)
  const threadId = String(payload.threadId ?? "").trim();
  const cc = Array.isArray(payload.cc) ? (payload.cc as string[]).filter((s) => EMAIL_RE.test(String(s).trim())) : [];
  const bcc = Array.isArray(payload.bcc) ? (payload.bcc as string[]).filter((s) => EMAIL_RE.test(String(s).trim())) : [];
  // New email needs a valid recipient; a reply gets the recipient from the thread.
  if (!threadId && !EMAIL_RE.test(to)) return json(req, { ok: false, error: "invalid_recipient" }, 400);
  const app = String(payload.app ?? "gmail").toLowerCase();
  const outlook = app === "outlook" || app === "m365";
  const html = payload.html === true; // send the body as HTML (e.g. a designed template)

  try {
    // Outlook execute slugs are double-prefixed; reply keys off the MESSAGE id
    // (passed as threadId), `to` is a plain string, cc/bcc are *_emails arrays.
    let tool: string;
    const args: Record<string, unknown> = {};
    if (outlook) {
      if (threadId) { tool = "OUTLOOK_OUTLOOK_REPLY_EMAIL"; args.message_id = threadId; args.comment = body; args.is_html = html; }
      else { tool = "OUTLOOK_OUTLOOK_SEND_EMAIL"; args.to = to; args.subject = subject; args.body = body; args.is_html = html; }
      if (cc.length) args.cc_emails = cc;
      if (bcc.length) args.bcc_emails = bcc;
    } else {
      if (threadId) { tool = "GMAIL_REPLY_TO_THREAD"; args.thread_id = threadId; args.message_body = body; args.is_html = html; if (EMAIL_RE.test(to)) args.recipient_email = to; }
      else { tool = "GMAIL_SEND_EMAIL"; args.recipient_email = to; args.subject = subject; args.body = body; args.is_html = html; }
      if (cc.length) args.cc = cc;
      if (bcc.length) args.bcc = bcc;
    }
    const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${tool}`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args }),
    });
    const b = await res.json().catch(() => ({})) as Record<string, unknown>;
    const ok = res.ok && b?.error == null && b?.successful !== false;
    if (!ok) {
      console.error("send failed:", tool, res.status, JSON.stringify(b?.error ?? b).slice(0, 300));
      return json(req, { ok: false, error: "send_failed" }, 502);
    }
    return json(req, { ok: true });
  } catch (e) {
    console.error("send error:", e);
    return json(req, { ok: false, error: "send_failed" }, 502);
  }
});
