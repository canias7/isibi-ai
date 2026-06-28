import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public open/click tracker for Sendra campaigns. The `campaigns` fn embeds a 1×1
// pixel (opens) and rewrites links through here (clicks); both carry a short HMAC
// token bound to campaign+recipient so stats can't be trivially forged. No JWT —
// mail clients load these unauthenticated — so we gate logging on the token and only
// ever bump counters. Works for mailbox AND self-hosted domain sends (our own pixel/links).
//
//   GET ?e=open&c=<campaign>&r=<recipient>&k=<token>            -> 1×1 GIF
//   GET ?e=click&c=<campaign>&r=<recipient>&k=<token>&u=<url>   -> 302 to <url>

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

// 1×1 transparent GIF.
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function token(cid: string, rid: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${cid}:${rid}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
// Constant-time string compare (don't leak the token via timing).
function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function valid(cid: string, rid: string, k: string): Promise<boolean> {
  return UUID_RE.test(cid) && UUID_RE.test(rid) && !!k && ctEq(k, await token(cid, rid));
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<void> {
  try { await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders, body: JSON.stringify(args) }); }
  catch { /* best-effort — never block the pixel/redirect */ }
}
function pixel(): Response {
  return new Response(PIXEL, { status: 200, headers: {
    "content-type": "image/gif",
    "cache-control": "no-store, no-cache, must-revalidate, private",
    "pragma": "no-cache", "expires": "0",
  } });
}

async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders, ...(init?.headers ?? {}) } });
}

// --- Outbound webhook fanout (opens/clicks) -----------------------------------
// Deliver a signed event to the user's enabled webhook endpoints, signed exactly
// like the `webhooks` fn's test event. Best-effort + backgrounded so the pixel /
// redirect never waits on customer endpoints.
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
    if (!ep?.url || whBadUrl(ep.url)) return;
    if (Array.isArray(ep.events) && ep.events.length && !ep.events.includes(type)) return;
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
function bg(tasks: Promise<unknown>[]): void {
  if (!tasks.length) return;
  const all = Promise.allSettled(tasks);
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") wu(all); else all.catch(() => {});
}
// Resolve the recipient (user + email + campaign) for a valid open/click, then fan out.
async function fanoutHit(rid: string, cid: string, type: string, extra: Record<string, unknown>): Promise<void> {
  try {
    const r = await db(`campaign_recipients?id=eq.${rid}&select=user_id,email,campaign_id&limit=1`);
    const row = r.ok ? (await r.json())?.[0] as { user_id?: string; email?: string; campaign_id?: string } | undefined : undefined;
    if (!row?.user_id) return;
    await fanout(row.user_id, type, { email: row.email, campaign_id: row.campaign_id ?? cid, recipient_id: rid, ...extra });
  } catch { /* ignore */ }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const e = url.searchParams.get("e") || "";
  const cid = url.searchParams.get("c") || "";
  const rid = url.searchParams.get("r") || "";
  const k = url.searchParams.get("k") || "";

  // Click: always redirect (so the link never breaks), but only log on a valid token.
  if (e === "click") {
    let dest = url.searchParams.get("u") || "";
    try { dest = decodeURIComponent(dest); } catch { /* use as-is */ }
    if (!/^https?:\/\//i.test(dest)) dest = "https://" + dest.replace(/^\/+/, "");
    if (await valid(cid, rid, k)) {
      await rpc("campaign_track_click", { p_recipient: rid, p_campaign: cid });
      bg([fanoutHit(rid, cid, "clicked", { url: dest })]);
    }
    return new Response(null, { status: 302, headers: { location: dest, "cache-control": "no-store" } });
  }

  // Open: always return the pixel; log on a valid token.
  if (e === "open") {
    if (await valid(cid, rid, k)) {
      await rpc("campaign_track_open", { p_recipient: rid, p_campaign: cid });
      bg([fanoutHit(rid, cid, "opened", {})]);
    }
    return pixel();
  }

  return new Response("ok", { status: 200 });
});
