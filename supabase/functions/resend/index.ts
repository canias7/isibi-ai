import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra's BUILT-IN email sender (Resend) — the "invisible" ESP behind campaigns.
// One central RESEND_API_KEY runs server-side and is never exposed to the client;
// users send through it without connecting anything (the Lovable-bundles-Supabase
// model). The caller is server-verified via their Supabase token, so a client can
// only ever send as themselves / under our quota.
//
// POST { action, ... } (invoked via supabase.functions.invoke):
//   status                                      -> { configured, from, test_only }
//   test   { to? }                              -> sends a test email (defaults to the caller's own email)
//   send   { to, subject, html?, text?, from?, replyTo?, headers? } -> { ok, id }
//   batch  { subject, html?, text?, from?, replyTo?, recipients:[{to, html?, text?, headers?}] } -> { ok, sent, ids }
//
// Secrets: RESEND_API_KEY, RESEND_FROM (e.g. "Sendra <hello@mail.gofarther.app>").
// Before a domain is verified in Resend, leave RESEND_FROM unset — it defaults to
// onboarding@resend.dev, which can only send to YOUR Resend account email (great
// for the `test` action). Verify a domain, then set RESEND_FROM to send to anyone.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Sendra <onboarding@resend.dev>";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND_API = "https://api.resend.com/emails";

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
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

// Verify the caller's Supabase token -> { id, email } (email powers the `test` send).
async function verifyUser(token: string | null): Promise<{ id: string; email: string } | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? { id: u.id, email: String(u.email ?? "") } : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One Resend send. Returns { ok, id?, error? } without leaking key/internal detail.
async function resendSend(payload: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await fetch(RESEND_API, {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok || (j?.error)) {
    const msg = typeof j?.error === "object" ? JSON.stringify(j.error) : String(j?.error ?? `http_${r.status}`);
    console.error("resend send failed:", r.status, msg.slice(0, 300));
    // Bubble up a short, safe reason (Resend's messages are user-actionable, e.g.
    // "domain not verified", "you can only send to your own email in test mode").
    return { ok: false, error: msg.slice(0, 200) };
  }
  return { ok: true, id: typeof j?.id === "string" ? j.id : undefined };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const user = await verifyUser(token);
  if (!user) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  // Config check is safe even when unset (used by the UI to show setup state).
  if (action === "status") {
    return json(req, { configured: !!RESEND_API_KEY, from: RESEND_FROM, test_only: RESEND_FROM.includes("onboarding@resend.dev") });
  }

  if (!RESEND_API_KEY) return json(req, { error: "resend_unset" }, 500);

  try {
    if (action === "test") {
      const to = String(body?.to || user.email || "").trim();
      if (!EMAIL_RE.test(to)) return json(req, { error: "no_test_recipient" }, 400);
      const res = await resendSend({
        from: RESEND_FROM,
        to: [to],
        subject: "Sendra is wired up ✅",
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
          <p>Nice — Sendra's built-in email sender is working.</p>
          <p style="color:#666">This was sent through Resend from <b>${RESEND_FROM.replace(/</g, "&lt;")}</b>.</p></div>`,
        text: "Sendra's built-in email sender is working — sent through Resend.",
      });
      return res.ok ? json(req, { ok: true, id: res.id, to }) : json(req, { ok: false, error: res.error }, 502);
    }

    if (action === "send") {
      const to = String(body?.to || "").trim();
      const subject = String(body?.subject || "");
      const html = body?.html != null ? String(body.html) : undefined;
      const text = body?.text != null ? String(body.text) : undefined;
      if (!EMAIL_RE.test(to)) return json(req, { error: "invalid_recipient" }, 400);
      if (!subject || (!html && !text)) return json(req, { error: "missing_content" }, 400);
      const res = await resendSend({
        from: String(body?.from || RESEND_FROM),
        to: [to],
        subject, html, text,
        ...(body?.replyTo ? { reply_to: String(body.replyTo) } : {}),
        ...(body?.headers && typeof body.headers === "object" ? { headers: body.headers } : {}),
      });
      return res.ok ? json(req, { ok: true, id: res.id }) : json(req, { ok: false, error: res.error }, 502);
    }

    // Batch — for campaigns. Resend's /emails/batch takes up to 100 messages.
    if (action === "batch") {
      const subject = String(body?.subject || "");
      const html = body?.html != null ? String(body.html) : undefined;
      const text = body?.text != null ? String(body.text) : undefined;
      const from = String(body?.from || RESEND_FROM);
      const recipients = Array.isArray(body?.recipients) ? body.recipients as Record<string, unknown>[] : [];
      if (!subject || (!html && !text)) return json(req, { error: "missing_content" }, 400);
      const valid = recipients
        .map((r) => ({ to: String(r?.to || "").trim(), html: r?.html != null ? String(r.html) : html, text: r?.text != null ? String(r.text) : text, headers: r?.headers }))
        .filter((r) => EMAIL_RE.test(r.to))
        .slice(0, 100);
      if (!valid.length) return json(req, { error: "no_recipients" }, 400);
      const r = await fetch(`${RESEND_API}/batch`, {
        method: "POST",
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(valid.map((v) => ({ from, to: [v.to], subject, html: v.html, text: v.text, ...(v.headers && typeof v.headers === "object" ? { headers: v.headers } : {}) }))),
      });
      const j = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (!r.ok || j?.error) {
        console.error("resend batch failed:", r.status, JSON.stringify(j?.error ?? j).slice(0, 300));
        return json(req, { ok: false, error: "batch_failed", sent: 0 }, 502);
      }
      const data = (j?.data as Record<string, unknown>[]) ?? [];
      return json(req, { ok: true, sent: valid.length, ids: data.map((d) => d?.id).filter(Boolean) });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("resend error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
