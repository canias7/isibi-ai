import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

// Sendra email campaigns — sent through the user's connected Gmail/Outlook (no
// ESP). Small lists only: GMAIL caps ~500/day, so we throttle and the client
// calls `send` repeatedly to drain the queue in batches. Every send is
// personalized ({{name}}), gets an unsubscribe footer, and skips anyone on the
// per-user suppression list. Identity is server-verified (Supabase token).
//
// POST { action, ... } (via supabase.functions.invoke):
//   create { app, name?, subject, body, recipients:[{email,name?}] }
//        -> { id, queued, skipped, invalid }
//   send   { id, limit? }   -> { sent, failed, remaining, done }   (call until done)
//   get    { id }           -> { campaign }
//   list                    -> { campaigns }

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const AWS_ID = Deno.env.get("AWS_SES_ACCESS_KEY_ID") ?? "";
const AWS_SECRET = Deno.env.get("AWS_SES_SECRET_ACCESS_KEY") ?? "";
const AWS_REGION = Deno.env.get("AWS_SES_REGION") ?? "us-east-1";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
const aws = new AwsClient({ accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET, region: AWS_REGION, service: "ses" });
const SES_BASE = `https://email.${AWS_REGION}.amazonaws.com`;

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost",
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Unsubscribe token — HMAC(service key, "uid:email"). The /unsubscribe endpoint
// recomputes + checks it, so a link can only opt out the address it was minted for.
async function unsubToken(uid: string, email: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${uid}:${email.toLowerCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
async function unsubUrl(uid: string, email: string): Promise<string> {
  const t = await unsubToken(uid, email);
  return `${SB_URL}/functions/v1/unsubscribe?u=${encodeURIComponent(uid)}&e=${encodeURIComponent(email)}&t=${t}`;
}

// PostgREST exact count via the Content-Range header (cheap — returns one row).
async function countBy(campaignId: string, status: string): Promise<number> {
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?campaign_id=eq.${campaignId}&status=eq.${status}&select=id`, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = r.headers.get("content-range") || "";
  const n = parseInt(cr.split("/")[1] || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

// Send one email through the user's connected mailbox (Composio).
async function sendOne(uid: string, app: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const outlook = app === "outlook" || app === "m365";
  const tool = outlook ? "OUTLOOK_OUTLOOK_SEND_EMAIL" : "GMAIL_SEND_EMAIL";
  const args: Record<string, unknown> = outlook
    ? { to, subject, body: html, is_html: true }
    : { recipient_email: to, subject, body: html, is_html: true };
  try {
    const r = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${tool}`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args }),
    });
    const b = await r.json().catch(() => ({})) as Record<string, unknown>;
    const ok = r.ok && b?.error == null && b?.successful !== false;
    return ok ? { ok: true } : { ok: false, error: String(b?.error ?? `http_${r.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

// Send one email from a verified SES domain (custom-domain campaigns).
async function sendOneSes(fromEmail: string, fromName: string | null, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const From = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const res = await aws.fetch(`${SES_BASE}/v2/email/outbound-emails`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: From,
        Destination: { ToAddresses: [to] },
        Content: { Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" } },
        } },
      }),
    });
    if (res.ok) return { ok: true };
    const t = await res.text();
    return { ok: false, error: `ses_${res.status}:${t}`.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  if (!API_KEY) return json(req, { error: "composio_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  try {
    if (action === "create") {
      const app = String(body?.app || "gmail").toLowerCase();
      const subject = String(body?.subject || "").trim();
      const html = String(body?.body || "");
      const name = String(body?.name || subject || "Untitled campaign").slice(0, 120);
      const raw = Array.isArray(body?.recipients) ? body.recipients as Record<string, unknown>[] : [];
      if (!subject || !html) return json(req, { error: "missing_content" });

      // Sending method: through the user's mailbox (default) or a verified SES domain.
      const sendVia = String(body?.send_via || "mailbox").toLowerCase() === "ses" ? "ses" : "mailbox";
      let fromEmail: string | null = null;
      let fromName: string | null = null;
      if (sendVia === "ses") {
        fromEmail = String(body?.from_email || "").trim().toLowerCase();
        fromName = body?.from_name ? String(body.from_name).slice(0, 120) : null;
        if (!EMAIL_RE.test(fromEmail)) return json(req, { error: "bad_from" });
        const dom = fromEmail.split("@")[1];
        const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${dom}&status=eq.verified&select=domain`, { headers: sbHeaders });
        if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
      }

      // Dedupe + validate, then drop anyone suppressed for this user.
      const seen = new Set<string>();
      let invalid = 0;
      const clean: { email: string; name: string | null }[] = [];
      for (const r of raw) {
        const email = String(r?.email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email)) { invalid++; continue; }
        if (seen.has(email)) continue;
        seen.add(email);
        clean.push({ email, name: r?.name ? String(r.name).slice(0, 120) : null });
      }
      const supRes = await fetch(`${SB_URL}/rest/v1/email_suppressions?user_id=eq.${uid}&select=email`, { headers: sbHeaders });
      const sup = new Set<string>(((await supRes.json().catch(() => [])) as { email: string }[]).map((s) => s.email.toLowerCase()));
      const recips = clean.filter((c) => !sup.has(c.email));
      const skipped = clean.length - recips.length;
      if (!recips.length) return json(req, { error: "no_recipients", invalid, skipped });

      const cRes = await fetch(`${SB_URL}/rest/v1/campaigns`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, app, name, subject, body: html, status: "draft", total: recips.length, send_via: sendVia, from_email: fromEmail, from_name: fromName }),
      });
      const camp = (await cRes.json().catch(() => []))?.[0];
      if (!cRes.ok || !camp?.id) return json(req, { error: "create_failed" }, 502);

      const rows = recips.map((c) => ({ campaign_id: camp.id, user_id: uid, email: c.email, name: c.name, status: "queued" }));
      const rRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients`, {
        method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(rows),
      });
      if (!rRes.ok) return json(req, { error: "recipients_failed" }, 502);
      return json(req, { id: camp.id, queued: recips.length, skipped, invalid });
    }

    if (action === "send") {
      const id = String(body?.id || "");
      const limit = Math.min(Math.max(Number(body?.limit || 20), 1), 30);
      if (!id) return json(req, { error: "missing_id" }, 400);

      const cRes = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&select=*`, { headers: sbHeaders });
      const camp = (await cRes.json().catch(() => []))?.[0];
      if (!camp) return json(req, { error: "not_found" });
      if (camp.status === "draft") {
        await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "sending", updated_at: new Date().toISOString() }) });
      }

      const qRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients?campaign_id=eq.${id}&status=eq.queued&select=id,email,name&order=id.asc&limit=${limit}`, { headers: sbHeaders });
      const batch = (await qRes.json().catch(() => [])) as { id: string; email: string; name: string | null }[];

      let sent = 0, failed = 0;
      for (const r of batch) {
        const who = r.name || "there";
        const unsub = await unsubUrl(uid, r.email);
        const personalized = String(camp.body).replace(/\{\{\s*name\s*\}\}/g, esc(who));
        const html = `${personalized}<br><br><hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888;font-family:system-ui,sans-serif">You're receiving this because you're on a list managed in Sendra. <a href="${unsub}" style="color:#888">Unsubscribe</a>.</p>`;
        const res = camp.send_via === "ses" && camp.from_email
          ? await sendOneSes(camp.from_email, camp.from_name, r.email, camp.subject, html)
          : await sendOne(uid, camp.app, r.email, camp.subject, html);
        await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${r.id}`, {
          method: "PATCH", headers: sbHeaders,
          body: JSON.stringify(res.ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: res.error }),
        });
        if (res.ok) sent++; else failed++;
        await sleep(camp.send_via === "ses" ? 1100 : 700); // throttle — SES sandbox is 1/sec; Gmail likes it slow too
      }

      const [totSent, totFailed, remaining] = await Promise.all([countBy(id, "sent"), countBy(id, "failed"), countBy(id, "queued")]);
      const done = remaining === 0;
      await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, {
        method: "PATCH", headers: sbHeaders,
        body: JSON.stringify({ sent: totSent, failed: totFailed, status: done ? "sent" : "sending", updated_at: new Date().toISOString() }),
      });
      return json(req, { sent, failed, remaining, done });
    }

    if (action === "get") {
      const id = String(body?.id || "");
      const r = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&select=*`, { headers: sbHeaders });
      const camp = (await r.json().catch(() => []))?.[0];
      return camp ? json(req, { campaign: camp }) : json(req, { error: "not_found" });
    }

    if (action === "list") {
      const r = await fetch(`${SB_URL}/rest/v1/campaigns?user_id=eq.${uid}&select=id,name,subject,app,status,total,sent,failed,created_at&order=created_at.desc&limit=50`, { headers: sbHeaders });
      const campaigns = await r.json().catch(() => []);
      return json(req, { campaigns: Array.isArray(campaigns) ? campaigns : [] });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("campaigns error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
