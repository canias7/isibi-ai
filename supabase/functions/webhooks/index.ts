import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra outbound webhooks — management API. Users register an HTTPS endpoint and
// Sendra POSTs signed email events (delivered, bounced, complained, ...) to it in
// real time. The actual event delivery happens in the `resend-events` function (which
// receives Resend webhook events and forwards them to here-registered endpoints); this
// function only manages the endpoints (list/add/remove/toggle/rotate/test).
//
// Identity is server-verified (Supabase token); rows are service-role only and every
// query is scoped by the verified uid. App-level failures return HTTP 200 { error }.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

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
async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// Validate a body-supplied id before interpolating into a PostgREST URL (a `#` would
// truncate the trailing &user_id ownership filter; `&` could inject filters).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }

// Reject non-HTTPS and obvious internal/private targets (basic SSRF guard at save time).
function badUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:") return true;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  if (/^(10|127|0)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function newSecret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  const s = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `whsec_${s}`;
}

// Signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`). The receiver
// recomputes it from the raw body + the `sendra-timestamp` header and compares.
async function sign(secret: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function deliver(url: string, secret: string, event: { id: string }): Promise<number> {
  const bodyStr = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await sign(secret, ts, bodyStr);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Sendra-Webhooks/1.0",
        "sendra-id": event.id,
        "sendra-timestamp": ts,
        "sendra-signature": `v1=${signature}`,
      },
      body: bodyStr,
      redirect: "manual",   // don't follow a 3xx to an internal host (SSRF)
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  try {
    if (action === "list") {
      const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?user_id=eq.${uid}&select=id,url,secret,events,enabled,description,last_status,last_event_at,created_at&order=created_at.desc`, { headers: sbHeaders });
      const endpoints = await r.json().catch(() => []);
      return json(req, { endpoints: Array.isArray(endpoints) ? endpoints : [] });
    }

    if (action === "add") {
      const url = String(body?.url || "").trim();
      const description = body?.description ? String(body.description).slice(0, 120) : null;
      if (badUrl(url)) return json(req, { error: "bad_url" });
      const row = { user_id: uid, url, secret: newSecret(), description };
      const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints`, {
        method: "POST", headers: { ...sbHeaders, Prefer: "return=representation" }, body: JSON.stringify(row),
      });
      const created = (await r.json().catch(() => []))?.[0];
      return created?.id ? json(req, { endpoint: created }) : json(req, { error: "add_failed" }, 502);
    }

    if (action === "remove") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    if (action === "toggle") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${id}&user_id=eq.${uid}`, {
        method: "PATCH", headers: sbHeaders, body: JSON.stringify({ enabled: body?.enabled === true }),
      });
      return json(req, { ok: true });
    }

    if (action === "rotate") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const secret = newSecret();
      const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${id}&user_id=eq.${uid}`, {
        method: "PATCH", headers: { ...sbHeaders, Prefer: "return=representation" }, body: JSON.stringify({ secret }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      return row?.id ? json(req, { secret }) : json(req, { error: "not_found" });
    }

    if (action === "test") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${id}&user_id=eq.${uid}&select=url,secret`, { headers: sbHeaders });
      const ep = (await r.json().catch(() => []))?.[0];
      if (!ep?.url) return json(req, { error: "not_found" });
      const event = {
        id: crypto.randomUUID(),
        type: "test",
        created_at: new Date().toISOString(),
        data: { message: "This is a test event from Sendra. Your endpoint is reachable." },
      };
      const status = await deliver(ep.url, ep.secret, event);
      await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${id}&user_id=eq.${uid}`, {   // scope the write-back to the owner
        method: "PATCH", headers: sbHeaders, body: JSON.stringify({ last_status: status, last_event_at: new Date().toISOString() }),
      });
      return json(req, { ok: status >= 200 && status < 300, status });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("webhooks error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
