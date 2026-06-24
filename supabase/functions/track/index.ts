import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public open/click tracker for Sendra campaigns. The `campaigns` fn embeds a 1×1
// pixel (opens) and rewrites links through here (clicks); both carry a short HMAC
// token bound to campaign+recipient so stats can't be trivially forged. No JWT —
// mail clients load these unauthenticated — so we gate logging on the token and only
// ever bump counters. Works for mailbox AND SES sends (it's our own pixel/links).
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
    if (await valid(cid, rid, k)) await rpc("campaign_track_click", { p_recipient: rid, p_campaign: cid });
    return new Response(null, { status: 302, headers: { location: dest, "cache-control": "no-store" } });
  }

  // Open: always return the pixel; log on a valid token.
  if (e === "open") {
    if (await valid(cid, rid, k)) await rpc("campaign_track_open", { p_recipient: rid, p_campaign: cid });
    return pixel();
  }

  return new Response("ok", { status: 200 });
});
