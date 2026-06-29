import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// webhook-retry — scheduled worker that re-delivers failed outbound webhook
// events with exponential backoff. Invoked every minute by pg_cron (via pg_net),
// authenticated by a shared key stored in public.app_secrets (read with the
// service role) — NOT a user JWT. Deployed verify_jwt=false; auth enforced here.
//
// Senders (mail-events / track / campaigns / mailer / address-book) insert a
// public.webhook_deliveries row per event; the first attempt happens inline at
// send time. Anything still 'pending' and due is retried here until it succeeds
// or hits MAX_ATTEMPTS (→ 'dead').

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const MAX_ATTEMPTS = 8;
// Backoff per attempt number (minutes). Index by the attempt we just made.
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720];
const BATCH = 50;

async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders, ...(init?.headers ?? {}) } });
}
function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function whBadUrl(raw: string): boolean {
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
async function whSign(secret: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Row = {
  id: string; endpoint_id: string; event_id: string; event_type: string;
  payload: Record<string, unknown>; attempts: number;
  webhook_endpoints: { url: string; secret: string; enabled: boolean } | null;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  // Auth: the cron passes x-cron-key; compare to the stored secret (service role read).
  const provided = req.headers.get("x-cron-key") || "";
  let expected = "";
  try {
    const r = await db(`app_secrets?key=eq.webhook_cron_key&select=value`);
    expected = (await r.json().catch(() => []))?.[0]?.value || "";
  } catch { /* fallthrough → unauthorized */ }
  if (!expected || !tokenEq(provided, expected)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const nowIso = new Date().toISOString();
  let due: Row[] = [];
  try {
    const r = await db(`webhook_deliveries?status=eq.pending&next_attempt_at=lte.${nowIso}&attempts=lt.${MAX_ATTEMPTS}&select=id,endpoint_id,event_id,event_type,payload,attempts,webhook_endpoints(url,secret,enabled)&order=next_attempt_at.asc&limit=${BATCH}`);
    due = r.ok ? await r.json() : [];
  } catch { due = []; }
  if (!Array.isArray(due) || !due.length) return new Response(JSON.stringify({ processed: 0 }), { headers: { "content-type": "application/json" } });

  let delivered = 0, dead = 0, requeued = 0;
  await Promise.all(due.map(async (d) => {
    const ep = d.webhook_endpoints;
    const attempt = (d.attempts || 0) + 1;
    // Endpoint gone, paused, or unsafe → stop retrying.
    if (!ep || ep.enabled === false || !ep.url || whBadUrl(ep.url)) {
      await db(`webhook_deliveries?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ status: "dead", attempts: attempt, last_error: "endpoint paused or removed", updated_at: new Date().toISOString() }) }).catch(() => {});
      dead++;
      return;
    }
    const event = { id: d.event_id, type: d.event_type, created_at: (d.payload?.created_at as string) || new Date().toISOString(), data: (d.payload?.data as unknown) ?? d.payload };
    const bodyStr = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000).toString();
    let status = 0;
    try {
      const sig = await whSign(ep.secret, ts, bodyStr);
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Sendra-Webhooks/1.0", "sendra-id": event.id, "sendra-timestamp": ts, "sendra-signature": `v1=${sig}`, "sendra-attempt": String(attempt) },
        body: bodyStr, redirect: "manual", signal: AbortSignal.timeout(8000),
      });
      status = res.status;
    } catch { status = 0; }
    const ok = status >= 200 && status < 300;
    if (ok) {
      await db(`webhook_deliveries?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ status: "success", attempts: attempt, last_status: status, last_error: null, updated_at: new Date().toISOString() }) }).catch(() => {});
      await db(`webhook_endpoints?id=eq.${d.endpoint_id}`, { method: "PATCH", body: JSON.stringify({ last_status: status, last_event_at: new Date().toISOString(), failure_count: 0 }) }).catch(() => {});
      delivered++;
    } else if (attempt >= MAX_ATTEMPTS) {
      await db(`webhook_deliveries?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ status: "dead", attempts: attempt, last_status: status, last_error: `gave up after ${attempt} attempts`, updated_at: new Date().toISOString() }) }).catch(() => {});
      dead++;
    } else {
      const next = new Date(Date.now() + (BACKOFF_MIN[attempt - 1] ?? 720) * 60000).toISOString();
      await db(`webhook_deliveries?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ attempts: attempt, last_status: status, last_error: status ? `HTTP ${status}` : "unreachable", next_attempt_at: next, updated_at: new Date().toISOString() }) }).catch(() => {});
      requeued++;
    }
  }));

  return new Response(JSON.stringify({ processed: due.length, delivered, requeued, dead }), { headers: { "content-type": "application/json" } });
});
