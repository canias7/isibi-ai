import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public webhook for SES bounce/complaint events, delivered via SNS (the `ses`
// function wires the topic + subscription + config-set event destination). On a
// permanent bounce or a complaint we add the recipient to that user's
// email_suppressions (so future campaigns skip them) and, when we know the
// campaign, mark the recipient bounced/complained.
//
// Security: this endpoint is unauthenticated (SNS can't send a JWT), so we gate on
// the topic ARN (which embeds the AWS account id) + an amazonaws.com SigningCertURL,
// and only ever ADD suppressions (fail-safe). Cryptographic SNS signature
// verification is a planned hardening follow-up.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

const isAwsHttps = (u: string) => /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(u);

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

// Parse one SES event (config-set event publishing uses `eventType`; legacy
// identity notifications use `notificationType`). Tags carry the uid + campaign.
async function handleEvent(p: any) {
  const kind = p?.eventType || p?.notificationType;
  const tags = p?.mail?.tags || {};
  const uid = Array.isArray(tags.uid) ? tags.uid[0] : undefined;
  const campaignId = Array.isArray(tags.campaign_id) ? tags.campaign_id[0] : undefined;
  if (!uid) return;
  if (kind === "Bounce") {
    if (p?.bounce?.bounceType && p.bounce.bounceType !== "Permanent") return; // skip transient bounces
    for (const r of (p?.bounce?.bouncedRecipients || [])) if (r?.emailAddress) await suppress(uid, r.emailAddress, "bounce", campaignId);
  } else if (kind === "Complaint") {
    for (const r of (p?.complaint?.complainedRecipients || [])) if (r?.emailAddress) await suppress(uid, r.emailAddress, "complaint", campaignId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const raw = await req.text();
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  // Only accept messages from our topic + an AWS signing host.
  if (!String(msg?.TopicArn || "").endsWith(`:${"sendra-ses-events"}`)) return new Response("ignored", { status: 200 });
  const certUrl = String(msg?.SigningCertURL || msg?.SigningCertUrl || "");
  if (certUrl && !isAwsHttps(certUrl)) return new Response("ignored", { status: 200 });

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
