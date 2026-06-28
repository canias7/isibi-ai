import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public unsubscribe endpoint linked in every campaign email. No login — it's a
// link clicked by recipients. The token is HMAC(service key, "uid:email"), minted
// by the `campaigns` function, so a link can only opt out the exact address it was
// made for (no opting out others). On a valid hit we add the address to that
// user's email_suppressions, so future campaigns skip it.
//   GET /unsubscribe?u=<uid>&e=<email>&t=<token>

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

async function unsubToken(uid: string, email: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${uid}:${email.toLowerCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// Constant-time string compare (don't leak the token via timing).
function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function page(title: string, msg: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#fff;font-family:system-ui,sans-serif">
<div style="text-align:center;max-width:340px;padding:28px">
<div style="width:54px;height:54px;border-radius:16px;margin:0 auto 16px;background:linear-gradient(135deg,#FF9A4D,#F8514E)"></div>
<h1 style="font-size:20px;margin:0 0 8px">${title}</h1>
<p style="color:#a6a6ae;font-size:14px;line-height:1.5;margin:0">${msg}</p>
</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders, ...(init?.headers ?? {}) } });
}

// --- Outbound webhook fanout (unsubscribe) ------------------------------------
// Notify the user's enabled webhook endpoints that a recipient opted out, signed
// exactly like the `webhooks` fn's test event. Best-effort + backgrounded.
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

function esc(s: string): string { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// Confirmation page shown on GET. We act only on POST so that inbox link-scanners and
// prefetchers (which fire GET) can't unsubscribe people by accident; the visible link
// shows this button, and Gmail/Yahoo one-click (RFC 8058) POSTs straight to the URL.
function confirmPage(action: string, email: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#fff;font-family:system-ui,sans-serif">
<div style="text-align:center;max-width:340px;padding:28px">
<div style="width:54px;height:54px;border-radius:16px;margin:0 auto 16px;background:linear-gradient(135deg,#FF9A4D,#F8514E)"></div>
<h1 style="font-size:20px;margin:0 0 8px">Unsubscribe?</h1>
<p style="color:#a6a6ae;font-size:14px;line-height:1.5;margin:0 0 20px">${esc(email)} will stop receiving these emails.</p>
<form method="POST" action="${esc(action)}">
<button type="submit" style="border:0;cursor:pointer;background:linear-gradient(135deg,#FF9A4D,#F8514E);color:#fff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:12px">Unsubscribe</button>
</form>
</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("u") || "";
  const email = (url.searchParams.get("e") || "").trim();
  const t = url.searchParams.get("t") || "";
  if (!uid || !email || !t) return page("Invalid link", "This unsubscribe link is missing information.");

  const expected = await unsubToken(uid, email);
  if (!ctEq(t, expected)) {
    return page("Invalid link", "This unsubscribe link couldn't be verified.");
  }

  // GET = show a confirm button (don't act); POST = actually unsubscribe (the button,
  // or a Gmail/Yahoo one-click request).
  if (req.method !== "POST") return confirmPage(url.pathname + url.search, email);

  try {
    // Idempotent: upsert on (user_id, email).
    await fetch(`${SB_URL}/rest/v1/email_suppressions?on_conflict=user_id,email`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, email: email.toLowerCase(), reason: "unsubscribe" }),
    });
    bg([fanout(uid, "unsubscribed", { email: email.toLowerCase() })]);
  } catch (e) {
    console.error("unsubscribe error:", String((e as Error)?.message || e));
    return page("Something went wrong", "Please try again in a moment.");
  }
  return page("You're unsubscribed", `${email} won't receive any more of these emails.`);
});
