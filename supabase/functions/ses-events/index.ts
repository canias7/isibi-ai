import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPublicKey, createVerify } from "node:crypto";

// Public webhook for SES events, delivered via SNS (the `ses` function wires the
// topic + subscription + config-set event destination). Two jobs:
//   1. List hygiene — on a permanent bounce or complaint, add the recipient to that
//      user's email_suppressions (future campaigns skip them) and mark the recipient.
//   2. Fan-out — forward the event (delivered/bounced/complained/...) to any webhook
//      endpoints the user registered (see the `webhooks` function), signed so the
//      receiver can verify it came from Sendra.
//
// Security: this endpoint is unauthenticated (SNS can't send a JWT), so we gate on
// the topic ARN (which embeds the AWS account id) and then cryptographically verify the
// SNS signature (see verifySns) — fail-closed, so forged bounce/complaint posts can't
// suppress arbitrary addresses. We also only ever ADD suppressions (fail-safe).

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const isAwsHttps = (u: string) => /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(u);

// Cryptographically verify an SNS message: rebuild the documented canonical string,
// fetch the (AWS-hosted) signing cert, and RSA-verify the Signature. Fail-closed — an
// attacker can't forge a valid signature, so this blocks spoofed bounce/complaint/reply
// posts. Certs are cached per URL.
const certCache = new Map<string, string>();
// deno-lint-ignore no-explicit-any
async function verifySns(msg: any): Promise<boolean> {
  try {
    const certUrl = String(msg?.SigningCertURL || msg?.SigningCertUrl || "");
    if (!isAwsHttps(certUrl)) return false;
    const sig = String(msg?.Signature || "");
    if (!sig) return false;
    const type = String(msg?.Type || "");
    const keys = type === "SubscriptionConfirmation" || type === "UnsubscribeConfirmation"
      ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
      : (msg?.Subject !== undefined && msg?.Subject !== null
          ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
          : ["Message", "MessageId", "Timestamp", "TopicArn", "Type"]);
    let canonical = "";
    for (const k of keys) { if (msg[k] === undefined || msg[k] === null) continue; canonical += `${k}\n${msg[k]}\n`; }
    let pem = certCache.get(certUrl);
    if (!pem) {
      const r = await fetch(certUrl, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return false;
      pem = await r.text();
      if (certCache.size > 8) certCache.clear();
      certCache.set(certUrl, pem);
    }
    const algo = String(msg?.SignatureVersion || "1") === "2" ? "RSA-SHA256" : "RSA-SHA1";
    const v = createVerify(algo);
    v.update(canonical, "utf8");
    v.end();
    return v.verify(createPublicKey(pem), sig, "base64");
  } catch {
    return false;
  }
}

async function suppress(uid: string, email: string, reason: string, campaignId?: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  await fetch(`${SB_URL}/rest/v1/email_suppressions?on_conflict=user_id,email`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, email: e, reason }),
  });
  if (campaignId) {
    await fetch(`${SB_URL}/rest/v1/campaign_recipients?user_id=eq.${uid}&campaign_id=eq.${campaignId}&email=eq.${encodeURIComponent(e)}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ status: reason === "bounce" ? "bounced" : "complained" }),
    });
  }
}

// ---- Outbound webhook delivery (signed, best-effort) ----
// deno-lint-ignore no-explicit-any
function recips(arr: any[]): string[] {
  return (arr || []).map((r) => r?.emailAddress).filter(Boolean);
}
// Map an SES event onto a stable, Resend-style payload. Returns null for event types
// we don't forward.
// deno-lint-ignore no-explicit-any
function normalize(kind: string, p: any, campaignId?: string): { id: string; type: string; created_at: string; data: Record<string, unknown> } | null {
  const mail = p?.mail || {};
  const data: Record<string, unknown> = {
    email_id: mail.messageId,
    campaign_id: campaignId,
    from: mail.source,
    to: mail.destination || [],
    subject: mail?.commonHeaders?.subject,
  };
  const base = { id: crypto.randomUUID(), created_at: mail.timestamp || new Date().toISOString() };
  switch (kind) {
    case "Send": return { ...base, type: "email.sent", data };
    case "Delivery": return { ...base, type: "email.delivered", data: { ...data, smtp_response: p?.delivery?.smtpResponse } };
    case "Bounce": return { ...base, type: "email.bounced", data: { ...data, bounce_type: p?.bounce?.bounceType, bounce_subtype: p?.bounce?.bounceSubType, recipients: recips(p?.bounce?.bouncedRecipients) } };
    case "Complaint": return { ...base, type: "email.complained", data: { ...data, recipients: recips(p?.complaint?.complainedRecipients) } };
    case "DeliveryDelay": return { ...base, type: "email.delivery_delayed", data };
    case "Reject": return { ...base, type: "email.failed", data: { ...data, reason: p?.reject?.reason } };
    case "Open": return { ...base, type: "email.opened", data };
    case "Click": return { ...base, type: "email.clicked", data: { ...data, link: p?.click?.link } };
    default: return null;
  }
}
// Signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`) — matches the
// `webhooks` function's test sender and what the docs tell receivers to verify.
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
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ last_status: status, last_event_at: new Date().toISOString() }),
      });
    }));
  } catch (e) {
    console.error("forward:", String((e as Error)?.message || e));
  }
}

// Parse one SES event (config-set event publishing uses `eventType`; legacy identity
// notifications use `notificationType`). Tags carry the uid + campaign.
// deno-lint-ignore no-explicit-any
async function handleEvent(p: any) {
  const kind = p?.eventType || p?.notificationType;
  const tags = p?.mail?.tags || {};
  const uid = Array.isArray(tags.uid) ? tags.uid[0] : undefined;
  const campaignId = Array.isArray(tags.campaign_id) ? tags.campaign_id[0] : undefined;
  if (!uid) return;

  // 1. List hygiene: permanent bounces + complaints are suppressed on future sends.
  if (kind === "Bounce") {
    if (!p?.bounce?.bounceType || p.bounce.bounceType === "Permanent") {
      for (const r of (p?.bounce?.bouncedRecipients || [])) if (r?.emailAddress) await suppress(uid, r.emailAddress, "bounce", campaignId);
    }
  } else if (kind === "Complaint") {
    for (const r of (p?.complaint?.complainedRecipients || [])) if (r?.emailAddress) await suppress(uid, r.emailAddress, "complaint", campaignId);
  } else if (kind === "Delivery" && campaignId) {
    // Stamp delivery on the campaign recipient — powers the "delivered" stat.
    for (const to of (p?.mail?.destination || [])) {
      const e = String(to || "").trim().toLowerCase();
      if (e) await fetch(`${SB_URL}/rest/v1/campaign_recipients?user_id=eq.${uid}&campaign_id=eq.${campaignId}&email=eq.${encodeURIComponent(e)}`, {
        method: "PATCH", headers: sbHeaders, body: JSON.stringify({ delivered_at: new Date().toISOString() }),
      });
    }
  }

  // 2. Fan-out to the user's registered webhook endpoints.
  const event = normalize(kind, p, campaignId);
  if (event) await forward(uid, event);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const raw = await req.text();
  // deno-lint-ignore no-explicit-any
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  // Only accept messages from our topic, then cryptographically verify the SNS signature
  // (blocks forged bounce/complaint events that could suppress arbitrary addresses).
  if (!String(msg?.TopicArn || "").endsWith(`:${"sendra-ses-events"}`)) return new Response("ignored", { status: 200 });
  if (!(await verifySns(msg))) return new Response("ignored", { status: 200 });

  const type = msg?.Type || req.headers.get("x-amz-sns-message-type") || "";
  if (type === "SubscriptionConfirmation") {
    const u = String(msg?.SubscribeURL || "");
    if (isAwsHttps(u)) { try { await fetch(u); } catch { /* ignore */ } }
    return new Response("confirmed", { status: 200 });
  }
  if (type === "Notification") {
    try { await handleEvent(JSON.parse(msg.Message)); } catch (e) { console.error("ses-events:", String((e as Error)?.message || e)); }
    return new Response("ok", { status: 200 });
  }
  return new Response("ok", { status: 200 });
});
