import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Send an email via Composio GMAIL_SEND_EMAIL. Identity is verified server-side
// (the caller's Supabase access token), so a client can only ever send as
// themselves. POST { to, subject, body, cc?, bcc? } -> { ok } or { ok:false, error }.

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
  const to = String(payload.to ?? "").trim();
  const subject = String(payload.subject ?? "");
  const body = String(payload.body ?? "");
  const cc = Array.isArray(payload.cc) ? (payload.cc as string[]).filter((s) => EMAIL_RE.test(String(s).trim())) : [];
  const bcc = Array.isArray(payload.bcc) ? (payload.bcc as string[]).filter((s) => EMAIL_RE.test(String(s).trim())) : [];
  if (!EMAIL_RE.test(to)) return json(req, { ok: false, error: "invalid_recipient" }, 400);

  try {
    const args: Record<string, unknown> = { recipient_email: to, subject, body, is_html: false };
    if (cc.length) args.cc = cc;
    if (bcc.length) args.bcc = bcc;
    const res = await fetch("https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args }),
    });
    const b = await res.json().catch(() => ({})) as Record<string, unknown>;
    const ok = res.ok && b?.error == null && b?.successful !== false;
    if (!ok) {
      console.error("send failed:", res.status, JSON.stringify(b?.error ?? b).slice(0, 300));
      return json(req, { ok: false, error: "send_failed" }, 502);
    }
    return json(req, { ok: true });
  } catch (e) {
    console.error("send error:", e);
    return json(req, { ok: false, error: "send_failed" }, 502);
  }
});
