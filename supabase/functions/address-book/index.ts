import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra's own address book (the public.contacts table). CRUD over the signed-in
// user's saved contacts; surfaced in the Contacts screen and the composer "To"
// picker. Identity is server-verified; every query is scoped by the verified uid.
// App-level failures return HTTP 200 { error }.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Validate a body-supplied id before interpolating into a PostgREST URL (a `#` would
// truncate the trailing &user_id ownership filter; `&` could inject filters).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }
function clean(body: Record<string, unknown>) {
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 200);
  const phone = String(body?.phone ?? "").trim().slice(0, 40);
  return { name, email, phone };
}
// Segment labels on a contact — lowercased, trimmed, deduped, capped.
function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean))].slice(0, 20);
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
      const r = await fetch(`${SB_URL}/rest/v1/contacts?user_id=eq.${uid}&select=id,name,email,phone,tags&order=name.asc`, { headers: sbHeaders });
      const contacts = await r.json().catch(() => []);
      return json(req, { contacts: Array.isArray(contacts) ? contacts : [] });
    }

    if (action === "add") {
      const { name, email, phone } = clean(body);
      const tags = parseTags(body?.tags);
      if (!name && !email) return json(req, { error: "missing_fields" });
      if (email && !EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      const r = await fetch(`${SB_URL}/rest/v1/contacts`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, name, email: email || null, phone: phone || null, tags }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      return row?.id ? json(req, { contact: row }) : json(req, { error: "add_failed" }, 502);
    }

    if (action === "update") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const { name, email, phone } = clean(body);
      const tags = parseTags(body?.tags);
      if (!name && !email) return json(req, { error: "missing_fields" });
      if (email && !EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      const r = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&user_id=eq.${uid}`, {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ name, email: email || null, phone: phone || null, tags, updated_at: new Date().toISOString() }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      return row?.id ? json(req, { contact: row }) : json(req, { error: "not_found" });
    }

    if (action === "delete") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("address-book error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
