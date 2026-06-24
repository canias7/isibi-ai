import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public webhook for Resend events (the built-in ESP behind `send_via: "resend"`
// campaigns). Mirrors ses-events, two jobs:
//   1. List hygiene — on a bounce or complaint, add the recipient to that user's
//      email_suppressions (future campaigns skip them) and mark the recipient;
//      stamp delivered_at on delivery (powers the "delivered" stat).
//   2. Fan-out — forward the event to any webhook endpoints the user registered
//      (see the `webhooks` function), signed so the receiver can verify it.
//
// Security: this endpoint is unauthenticated (Resend can't send a JWT), so we verify
// Resend's Svix signature (svix-id/svix-timestamp/svix-signature) against the
// RESEND_WEBHOOK_SECRET — fail-closed, so forged bounce/complaint posts can't suppress
// arbitrary addresses. We also only ever ADD suppressions (fail-safe).
//
// Correlation: Resend's event carries the message id (data.email_id) we stored as
// campaign_recipients.provider_msg_id at send time, so each event maps to exactly one
// recipient (and through it, the owning user + campaign). Opens/clicks come from our own
// `track` function (pixel + link redirect), not Resend, so they're not handled here.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? ""; // Svix "whsec_..." from the Resend webhook settings
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

// ---- Svix signature verification (Resend signs webhooks with Svix) ----
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Verify per the Svix spec: HMAC-SHA256(secret, `${id}.${ts}.${body}`), base64, matched
// (constant-time) against any "v1,<sig>" entry in svix-signature. Fail-closed.
async function verifySvix(headers: Headers, body: string): Promise<boolean> {
  try {
    if (!WEBHOOK_SECRET) return false;
    const id = headers.get("svix-id");
    const ts = headers.get("svix-timestamp");
    const sigHeader = headers.get("svix-signature");
    if (!id || !ts || !sigHeader) return false;
    const t = parseInt(ts, 10);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false; // replay guard (5 min)
    const secret = WEBHOOK_SECRET.startsWith("whsec_") ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
    const key = await crypto.subtle.importKey("raw", b64ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    const expected = bytesToB64(new Uint8Array(mac));
    for (const part of sigHeader.split(" ")) {
      const sig = part.split(",")[1];
      if (sig && ctEq(sig, expected)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---- List hygiene ----
async function suppress(uid: string, email: string, reason: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  await fetch(`${SB_URL}/rest/v1/email_suppressions?on_conflict=user_id,email`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, email: e, reason }),
  });
}
async function patchRecipient(id: string, patch: Record<string, unknown>) {
  await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders, body: JSON.stringify(patch),
  });
}

// ---- Outbound webhook delivery (signed, best-effort) — identical contract to ses-events ----
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
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch {
    return 0;
  }
}
async function forward(uid: string, event: { id: string }) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?user_id=eq.${uid}&enabled=is.true&select=id,url,secret`, { headers: sbHeaders });
    const eps = await r.json().catch(() => []);
    if (!Array.isArray(eps) || !eps.length) return;
    await Promise.all(eps.map(async (ep: { id: string; url: string; secret: string }) => {
      const status = await deliver(ep.url, ep.secret, event);
      await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${ep.id}`, {
        method: "PATCH", headers: sbHeaders,
        body: JSON.stringify({ last_status: status, last_event_at: new Date().toISOString() }),
      });
    }));
  } catch (e) {
    console.error("forward:", String((e as Error)?.message || e));
  }
}

// Map a Resend event onto the same stable payload ses-events emits (so registered
// webhooks see one consistent shape regardless of which ESP sent the mail).
// deno-lint-ignore no-explicit-any
function normalize(type: string, data: any, campaignId: string, email: string): { id: string; type: string; created_at: string; data: Record<string, unknown> } | null {
  const allowed = new Set([
    "email.sent", "email.delivered", "email.bounced", "email.complained",
    "email.delivery_delayed", "email.opened", "email.clicked",
  ]);
  if (!allowed.has(type)) return null;
  const out: Record<string, unknown> = {
    email_id: data?.email_id,
    campaign_id: campaignId,
    from: data?.from,
    to: Array.isArray(data?.to) ? data.to : [email],
    subject: data?.subject,
  };
  if (type === "email.bounced") out.bounce_type = data?.bounce?.type ?? data?.bounce?.subType;
  if (type === "email.clicked") out.link = data?.click?.link ?? data?.link;
  return { id: crypto.randomUUID(), type, created_at: data?.created_at || new Date().toISOString(), data: out };
}

// Short human reason from a Resend event so the user sees WHY, not just "bounced".
// Resend's nested shape varies, so pull defensively and fall back to a label.
// deno-lint-ignore no-explicit-any
function bounceReason(data: any): string {
  const b = data?.bounce || {};
  return ([b.type, b.subType, b.message || b.reason].filter(Boolean).join(" — ") || "Bounced").slice(0, 300);
}
// deno-lint-ignore no-explicit-any
function complaintReason(data: any): string {
  const c = data?.complaint || {};
  return String(c.type || c.feedbackType || "Marked as spam").slice(0, 300);
}
// deno-lint-ignore no-explicit-any
function delayReason(data: any): string {
  const d = data?.delivery_delayed || data?.delivery || {};
  return String(d.message || d.reason || d.type || "temporary delivery delay").slice(0, 250);
}

// deno-lint-ignore no-explicit-any
async function handleEvent(evt: any) {
  const type = String(evt?.type || "");
  const data = evt?.data || {};
  const emailId = String(data?.email_id || data?.id || "");
  if (!emailId) return;

  // Map the provider message id back to the recipient row (and its owner + campaign).
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?provider_msg_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,campaign_id,email&limit=1`, { headers: sbHeaders });
  const row = (await r.json().catch(() => []))?.[0] as { id: string; user_id: string; campaign_id: string; email: string } | undefined;
  if (!row) return;

  // 1. List hygiene + a human reason on the recipient row.
  if (type === "email.delivered") {
    await patchRecipient(row.id, { delivered_at: new Date().toISOString(), error: null }); // clear any earlier delay note
  } else if (type === "email.bounced") {
    await suppress(row.user_id, row.email, "bounce");
    await patchRecipient(row.id, { status: "bounced", error: bounceReason(data) });
  } else if (type === "email.complained") {
    await suppress(row.user_id, row.email, "complaint");
    await patchRecipient(row.id, { status: "complained", error: complaintReason(data) });
  } else if (type === "email.delivery_delayed") {
    // Transient — the message may still arrive, so don't change status; just note why.
    await patchRecipient(row.id, { error: `Delayed — ${delayReason(data)}`.slice(0, 300) });
  }

  // 2. Fan-out to the user's registered webhook endpoints.
  const event = normalize(type, data, row.campaign_id, row.email);
  if (event) await forward(row.user_id, event);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const raw = await req.text();
  // Verify the Svix signature before trusting anything in the body (blocks forged
  // bounce/complaint posts that could suppress arbitrary addresses).
  if (!(await verifySvix(req.headers, raw))) return new Response("unauthorized", { status: 401 });
  // deno-lint-ignore no-explicit-any
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  try { await handleEvent(evt); } catch (e) { console.error("resend-events:", String((e as Error)?.message || e)); }
  return new Response("ok", { status: 200 });
});
