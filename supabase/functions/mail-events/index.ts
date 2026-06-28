import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// mail-events — ingest delivery events from the self-hosted mail server (the box).
//
// The box's bounce-watch (mailserver/bounce-watch.ts) tails Postfix and POSTs
// bounce/complaint/delivered events here. We map each event's Message-ID back to the
// campaign recipient (provider_msg_id), mark it, and — for bounces/complaints — add
// the address to that user's suppression list so future sends skip it.
//
// Machine-authenticated by the relay token (MAILER_RELAY_TOKEN) — never a user JWT —
// same shared secret as the relay / keysync. Deploy with verify_jwt=false.
//
//   POST { events: [{ message_id, email, type, reason? }] }   // type: bounce|complaint|delivered
//     -> { ok, processed, suppressed }

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RELAY_TOKEN = Deno.env.get("MAILER_RELAY_TOKEN") ?? "";

function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Outbound webhook fanout --------------------------------------------------
// Deliver this event to the user's enabled webhook endpoints, signed exactly like
// the `webhooks` fn's test event (so real + test look identical to receivers).
// Best-effort: never throws; callers run it in the background so ingest stays fast.
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
async function fanout(userId: string, type: string, data: Record<string, unknown>): Promise<void> {
  if (!UUID_RE.test(userId)) return;
  let eps: { id: string; url: string; secret: string; events: string[] | null }[] = [];
  try {
    const r = await db(`webhook_endpoints?user_id=eq.${userId}&enabled=eq.true&select=id,url,secret,events`);
    eps = r.ok ? await r.json() : [];
  } catch { return; }
  if (!Array.isArray(eps) || !eps.length) return;
  const event = { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), data };
  const bodyStr = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000).toString();
  await Promise.all(eps.map(async (ep) => {
    if (!ep?.url || whBadUrl(ep.url)) return;                                  // re-check at send time (SSRF)
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
      await db(`webhook_endpoints?id=eq.${ep.id}`, { method: "PATCH", body: JSON.stringify(ok ? { last_status: status, last_event_at: new Date().toISOString(), failure_count: 0 } : { last_status: status, last_event_at: new Date().toISOString() }) });
    } catch { /* ignore */ }
  }));
}
// Run background work (webhook delivery) without delaying the response. Uses the edge
// runtime's waitUntil when present; falls back to a promise the caller awaits.
function bg(tasks: Promise<unknown>[]): Promise<unknown> | void {
  if (!tasks.length) return;
  const all = Promise.allSettled(tasks);
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") { wu(all); return; }
  return all;
}

interface Evt { message_id?: string; email?: string; type?: string; reason?: string }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!RELAY_TOKEN || !tokenEq(token, RELAY_TOKEN)) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const events: Evt[] = Array.isArray(body?.events) ? body.events : (body?.message_id ? [body as Evt] : []);
  let processed = 0, suppressed = 0;
  const bgTasks: Promise<unknown>[] = [];   // webhook deliveries, flushed in the background

  for (const e of events) {
    const mid = String(e?.message_id ?? "").replace(/[<>]/g, "").trim();
    const type = String(e?.type ?? "").toLowerCase();
    if (!mid || !type) continue;

    // Map the Message-ID back to the recipient (and thus the sending user).
    const r = await db(`campaign_recipients?provider_msg_id=eq.${encodeURIComponent(mid)}&select=id,user_id,email,campaign_id&limit=1`);
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) continue;
    const { id, user_id, email, campaign_id } = rows[0] as { id: string; user_id: string; email: string; campaign_id: string };
    processed++;

    if (type === "delivered") {
      await db(`campaign_recipients?id=eq.${id}&delivered_at=is.null`, { method: "PATCH", body: JSON.stringify({ delivered_at: new Date().toISOString() }) });
      bgTasks.push(fanout(user_id, "delivered", { email, campaign_id, recipient_id: id, message_id: mid }));
      continue;
    }

    const isComplaint = type === "complaint" || type === "complained" || type === "abuse";
    const status = isComplaint ? "complained" : "bounced";
    const reason = isComplaint ? "complaint" : "bounce";
    const detail = String(e?.reason ?? reason).slice(0, 300);
    await db(`campaign_recipients?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status, error: detail }) });
    // Suppress for this user so future sends skip the address (PK = user_id,email).
    const s = await db("email_suppressions", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id, email, reason }),
    });
    if (s.ok) suppressed++;
    bgTasks.push(fanout(user_id, status, { email, campaign_id, recipient_id: id, message_id: mid, reason: detail }));
  }

  // Fan out to webhooks in the background so the box's POST returns promptly.
  const flush = bg(bgTasks);
  if (flush) await flush;
  return json({ ok: true, processed, suppressed });
});
