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
// True if this user already has a contact with this email (emails are stored
// lowercased, so an eq match is case-insensitive). `exceptId` skips the row being
// edited so re-saving a contact unchanged isn't flagged as a duplicate.
async function emailTaken(uid: string, email: string, exceptId?: string): Promise<boolean> {
  let q = `${SB_URL}/rest/v1/contacts?user_id=eq.${uid}&email=eq.${encodeURIComponent(email)}&select=id`;
  if (exceptId) q += `&id=neq.${exceptId}`;
  const r = await fetch(q, { headers: sbHeaders });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// --- Outbound webhook fanout (contact.created / updated / deleted) -------------
// Deliver a signed event to the user's enabled webhook endpoints, signed exactly
// like the `webhooks` / `track` / `mail-events` fns. Best-effort + backgrounded so
// a contact write never waits on (or fails because of) a customer endpoint.
function whBadUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:") return true;
  let h = u.hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.includes(":")) return true; // any IPv6 literal — too many loopback/mapped forms to allowlist
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  if (/^(10|127|0)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}
async function whSign(secret: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function fanout(userId: string, type: string, data: Record<string, unknown>): Promise<void> {
  if (!UUID_RE.test(userId)) return;
  let eps: { id: string; url: string; secret: string; events: string[] | null }[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?user_id=eq.${userId}&enabled=eq.true&select=id,url,secret,events`, { headers: sbHeaders });
    eps = r.ok ? await r.json() : [];
  } catch { return; }
  if (!Array.isArray(eps) || !eps.length) return;
  const event = { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), data };
  const bodyStr = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000).toString();
  await Promise.all(eps.map(async (ep) => {
    if (!ep?.url || whBadUrl(ep.url)) return;
    if (Array.isArray(ep.events) && ep.events.length && !ep.events.includes(type)) return; // empty = all events
    let status = 0;
    try {
      const signature = await whSign(ep.secret, ts, bodyStr);
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Sendra-Webhooks/1.0", "sendra-id": event.id, "sendra-timestamp": ts, "sendra-signature": `v1=${signature}` },
        body: bodyStr, redirect: "manual", signal: AbortSignal.timeout(8000),
      });
      status = res.status;
    } catch { status = 0; }
    const ok = status >= 200 && status < 300;
    try {
      await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${ep.id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify(ok ? { last_status: status, last_event_at: new Date().toISOString(), failure_count: 0 } : { last_status: status, last_event_at: new Date().toISOString() }) });
    } catch { /* ignore */ }
    try {
      await fetch(`${SB_URL}/rest/v1/webhook_deliveries`, { method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ endpoint_id: ep.id, user_id: userId, event_id: event.id, event_type: type, payload: event, status: ok ? "success" : "pending", attempts: 1, last_status: status, last_error: ok ? null : (status ? `HTTP ${status}` : "unreachable"), next_attempt_at: ok ? new Date().toISOString() : new Date(Date.now() + 60000).toISOString() }) });
    } catch { /* ignore */ }
  }));
}
function bg(task: Promise<unknown>): void {
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") wu(task.catch(() => {})); else task.catch(() => {});
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
      if (!email) return json(req, { error: "email_required" });
      if (!EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      if (await emailTaken(uid, email)) return json(req, { error: "duplicate_email" });
      const r = await fetch(`${SB_URL}/rest/v1/contacts`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, name, email, phone: phone || null, tags }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      if (row?.id) {
        bg(fanout(uid, "contact.created", { id: row.id, email: row.email, name: row.name }));
        return json(req, { contact: row });
      }
      // 409 = the unique index caught a race the check above missed.
      return r.status === 409 ? json(req, { error: "duplicate_email" }) : json(req, { error: "add_failed" }, 502);
    }

    if (action === "update") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const { name, email, phone } = clean(body);
      const tags = parseTags(body?.tags);
      if (!email) return json(req, { error: "email_required" });
      if (!EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      if (await emailTaken(uid, email, id)) return json(req, { error: "duplicate_email" });
      const r = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&user_id=eq.${uid}`, {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ name, email, phone: phone || null, tags, updated_at: new Date().toISOString() }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      if (row?.id) {
        bg(fanout(uid, "contact.updated", { id: row.id, email: row.email, name: row.name }));
        return json(req, { contact: row });
      }
      return r.status === 409 ? json(req, { error: "duplicate_email" }) : json(req, { error: "not_found" });
    }

    if (action === "delete") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      // Confirm the row was actually deleted before telling the client (and the
      // user's webhook consumers) it's gone — Prefer:count so we can check.
      const del = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE", headers: { ...sbHeaders, prefer: "count=exact" } });
      if (!del.ok) return json(req, { error: "delete_failed" }, 502);
      const range = del.headers.get("content-range") || "";
      const affected = parseInt(range.split("/")[1] || "0", 10);
      if (!affected) return json(req, { error: "not_found" }, 404);
      bg(fanout(uid, "contact.deleted", { id }));
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("address-book error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
