import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public webhook for INBOUND email (campaign replies), delivered via SNS from an SES
// receipt rule (wired by the `ses` fn's reply_setup action). Flow:
//   recipient replies -> SES receives at reply.<domain> -> receipt rule SNS action ->
//   this endpoint -> we match the reply+<recipientId> token to the original send and
//   store a row in public.replies (shown in Sendra's Replies tab).
//
// Staged: nothing reaches here until the user enables replies for a domain AND points
// that subdomain's MX at SES. Security mirrors ses-events: unauthenticated (SNS can't
// send a JWT), so we gate on the topic ARN + an amazonaws.com SigningCertURL, and only
// ever write a reply when its token resolves to a real campaign recipient.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
const TOPIC_NAME = "sendra-inbound";

const isAwsHttps = (u: string) => /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(u);

// "Display Name <addr@x>" or "addr@x" -> { name, email }
function parseAddr(s: string): { name: string | null; email: string } {
  const str = String(s || "").trim();
  const m = str.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, "") || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: str.toLowerCase() };
}

function b64ToText(b64: string): string {
  try {
    const clean = b64.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch { return ""; }
}
function quotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeBody(body: string, cte?: string): string {
  const enc = (cte || "").trim().toLowerCase();
  if (enc === "base64") return b64ToText(body);
  if (enc === "quoted-printable") return quotedPrintable(body);
  return body;
}
function headerBlock(part: string): string {
  return part.split(/\r?\n\r?\n/)[0] || "";
}
function headerVal(hdr: string, name: string): string {
  const re = new RegExp(`^${name}\\s*:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, "im");
  const m = hdr.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
}

// Pull a readable plain-text body out of a raw RFC822 message (best-effort). Prefers a
// text/plain MIME part; falls back to a stripped text/html part or the raw body.
function extractText(raw: string): string {
  const topHdr = headerBlock(raw);
  const ctype = headerVal(topHdr, "content-type");
  const boundary = (ctype.match(/boundary="?([^";]+)"?/i) || [])[1];
  if (boundary) {
    const parts = raw.split(`--${boundary}`);
    let htmlFallback = "";
    for (const part of parts) {
      const phdr = headerBlock(part);
      const pbody = part.slice(part.indexOf("\n\n") >= 0 ? part.indexOf("\n\n") + 2 : part.length);
      const cte = (phdr.match(/content-transfer-encoding:\s*([^\r\n;]+)/i) || [])[1];
      if (/content-type:\s*text\/plain/i.test(phdr)) return decodeBody(pbody, cte).trim();
      if (/content-type:\s*text\/html/i.test(phdr) && !htmlFallback) {
        htmlFallback = decodeBody(pbody, cte).replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s{2,}/g, " ").trim();
      }
    }
    if (htmlFallback) return htmlFallback;
  }
  const body = raw.slice(raw.indexOf("\n\n") >= 0 ? raw.indexOf("\n\n") + 2 : 0);
  return decodeBody(body, (headerVal(topHdr, "content-transfer-encoding") || "")).trim();
}

// Drop the quoted original ("On … wrote:" + leading ">" lines) so the snippet shows the
// person's actual reply, not the whole thread.
function topReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const ln of lines) {
    if (/^\s*on .*wrote:\s*$/i.test(ln)) break;
    if (/^\s*-{2,}\s*original message\s*-{2,}/i.test(ln)) break;
    if (/^\s*>/.test(ln)) continue;
    out.push(ln);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() || text.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const raw = await req.text();
  // deno-lint-ignore no-explicit-any
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  // Only accept messages from our inbound topic + an AWS signing host.
  if (!String(msg?.TopicArn || "").endsWith(`:${TOPIC_NAME}`)) return new Response("ignored", { status: 200 });
  const certUrl = String(msg?.SigningCertURL || msg?.SigningCertUrl || "");
  if (certUrl && !isAwsHttps(certUrl)) return new Response("ignored", { status: 200 });

  const type = msg?.Type || req.headers.get("x-amz-sns-message-type") || "";
  if (type === "SubscriptionConfirmation") {
    const u = String(msg?.SubscribeURL || "");
    if (isAwsHttps(u)) { try { await fetch(u); } catch { /* ignore */ } }
    return new Response("confirmed", { status: 200 });
  }
  if (type !== "Notification") return new Response("ok", { status: 200 });

  try {
    const note = JSON.parse(msg.Message);
    if (note?.notificationType !== "Received") return new Response("ok", { status: 200 });
    const mail = note.mail || {};
    const recipients: string[] = note?.receipt?.recipients || mail?.destination || [];

    // Find our reply token: reply+<campaign_recipients.id>@reply.<domain>
    let rid = "";
    for (const r of recipients) {
      const m = String(r || "").match(/reply\+([0-9a-fA-F-]{8,})@/);
      if (m) { rid = m[1]; break; }
    }
    if (!rid) return new Response("ok", { status: 200 });

    // Resolve the token to the original send (this is also the auth gate — an unknown
    // token simply produces no row).
    const rrRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${rid}&select=id,user_id,campaign_id,email,name`, { headers: sbHeaders });
    const rr = (await rrRes.json().catch(() => []))?.[0] as { id: string; user_id: string; campaign_id: string; email: string; name: string | null } | undefined;
    if (!rr?.user_id) return new Response("ok", { status: 200 });

    const ch = mail.commonHeaders || {};
    const from = parseAddr(Array.isArray(ch.from) ? ch.from[0] : (mail.source || ""));
    const subject = String(ch.subject || "").slice(0, 300);
    const messageId = String(ch.messageId || "").slice(0, 200);
    const inReplyTo = String(ch.inReplyTo || "").slice(0, 200);

    let bodyText = "";
    if (note.content) bodyText = extractText(b64ToText(String(note.content)));
    bodyText = bodyText.slice(0, 20000);
    const snippet = topReply(bodyText).slice(0, 400);

    await fetch(`${SB_URL}/rest/v1/replies`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: rr.user_id,
        campaign_id: rr.campaign_id || null,
        recipient_id: rr.id,
        recipient_email: rr.email,
        from_email: from.email || rr.email,
        from_name: from.name,
        subject: subject || "(no subject)",
        snippet: snippet || "(no text)",
        body_text: bodyText,
        message_id: messageId || null,
        in_reply_to: inReplyTo || null,
      }),
    });
  } catch (e) {
    console.error("ses-inbound:", String((e as Error)?.message || e));
  }
  return new Response("ok", { status: 200 });
});
