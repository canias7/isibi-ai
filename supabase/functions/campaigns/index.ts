import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email campaigns. Two send methods (per campaign, via send_via):
//   "resend"  — Sendra's built-in ESP (zero setup, central verified domain)
//   "mailbox" — the user's connected Gmail/Outlook (default; ~500/day cap)
// The client calls `send` repeatedly to drain the queue in throttled batches. Every
// send is personalized ({{name}}), gets an unsubscribe footer + open/click tracking,
// and skips anyone on the per-user suppression list. Identity is server-verified.
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
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
// Built-in ESP (Resend) — the zero-setup sender behind `send_via: "resend"`. One central
// key + verified domain (RESEND_FROM); users send through it without connecting anything.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? Deno.env.get("RESEND-API-KEY") ?? ""; // secret is named with hyphens
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Sendra <onboarding@resend.dev>";
const RESEND_API = "https://api.resend.com/emails";

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
// Guards for any value interpolated into a PostgREST URL (prevents filter injection /
// fragment-truncation of the trailing ownership filter). UUIDs and hostnames only.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }
function vHost(v: string): string { return /^[a-z0-9.-]{1,253}$/i.test(v) ? v : ""; } // safe to interpolate into a PostgREST filter
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

// ---- Open/click tracking (our own pixel + link redirect via the `track` fn). Works
// for mailbox sends too, since it's our infrastructure — not SES open/click tracking. ----
const TRACK_BASE = `${SB_URL}/functions/v1/track`;
async function trackToken(cid: string, rid: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${cid}:${rid}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
// Route http(s) links in the body through the click tracker (the unsub link is added
// after this call, so it's never rewritten). Returns the body with tracked links.
function withTracking(html: string, cid: string, rid: string, tok: string): string {
  return html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (m, link: string) =>
    link.startsWith(TRACK_BASE) ? m : `href="${TRACK_BASE}?e=click&c=${cid}&r=${rid}&k=${tok}&u=${encodeURIComponent(link)}"`);
}
function openPixel(cid: string, rid: string, tok: string): string {
  return `<img src="${TRACK_BASE}?e=open&c=${cid}&r=${rid}&k=${tok}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden" />`;
}

// PostgREST exact count with an extra filter (opened_at=not.is.null, status=eq.bounced, …).
async function countFilter(campaignId: string, extra: string): Promise<number> {
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?campaign_id=eq.${campaignId}&${extra}&select=id`, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = r.headers.get("content-range") || "";
  const n = parseInt(cr.split("/")[1] || "0", 10);
  return Number.isFinite(n) ? n : 0;
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

// User-wide recipient count with an extra filter (moved here from the deleted `ses` fn).
async function countUser(uid: string, extra: string): Promise<number> {
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?user_id=eq.${uid}${extra}&select=id`, {
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

// Plain-text fallback from the HTML body — better deliverability (HTML-only mail
// scores worse on spam) and a readable version for text-only clients.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `${String(inner).replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<\/(p|div|tr|h[1-6]|li|ul|ol|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// From address for built-in (Resend) sends: the central verified RESEND_FROM, with an
// optional per-campaign display name swapped in (the address must stay on the verified domain).
function resendFrom(name: string | null): string {
  if (!name) return RESEND_FROM;
  const m = RESEND_FROM.match(/<([^>]+)>/);
  return `${name} <${m ? m[1] : RESEND_FROM}>`;
}
// Send one email through Sendra's built-in ESP (Resend). Adds the one-click
// List-Unsubscribe headers and returns Resend's message id, which the
// resend-events webhook maps back to this recipient (delivered/bounce/complaint).
async function sendOneResend(p: { fromEmail?: string | null; fromName: string | null; to: string; subject: string; html: string; unsub: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    // A verified custom domain From (validated at create time) wins; else the central RESEND_FROM.
    const from = p.fromEmail ? (p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail) : resendFrom(p.fromName);
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [p.to],
        subject: p.subject,
        html: p.html,
        text: htmlToText(p.html),
        headers: { "List-Unsubscribe": `<${p.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok || j?.error) {
      // Resend puts the human reason in `message` (e.g. "domain is not verified"); surface it.
      const msg = j?.message ?? (typeof j?.error === "object" ? JSON.stringify(j.error) : j?.error) ?? `http_${res.status}`;
      return { ok: false, error: `resend_${res.status}:${String(msg)}`.slice(0, 200) };
    }
    return { ok: true, id: typeof j?.id === "string" ? j.id : undefined };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

// Drain one batch of a campaign's queue. Shared by the `send` action (client-driven)
// and the scheduled `run_due` cron. Flips draft/scheduled -> sending, sends up to
// `limit`, updates counts, and marks the campaign sent once the queue is empty.
// deno-lint-ignore no-explicit-any
async function drainCampaign(camp: any, limit: number): Promise<{ sent: number; failed: number; remaining: number; done: boolean }> {
  const id = camp.id as string;
  const uid = camp.user_id as string;
  // Single-flight: atomically claim this campaign before draining so two overlapping
  // ticks (cron can run >60s) or a client+cron race never send the same batch twice.
  // The lock auto-expires (2 min) so a crashed worker can't wedge the campaign.
  const nowIso = new Date().toISOString();
  const lockRes = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&or=(locked_until.is.null,locked_until.lt.${nowIso})`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ locked_until: new Date(Date.now() + 120000).toISOString() }),
  });
  const lockRows = await lockRes.json().catch(() => []);
  if (!Array.isArray(lockRows) || lockRows.length === 0) {
    const remaining = await countBy(id, "queued");   // another worker holds it — don't double-send
    return { sent: 0, failed: 0, remaining, done: remaining === 0 };
  }
  if (camp.status === "draft" || camp.status === "scheduled") {
    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "sending", updated_at: new Date().toISOString() }) });
  }
  const qRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients?campaign_id=eq.${id}&status=eq.queued&select=id,email,name&order=id.asc&limit=${limit}`, { headers: sbHeaders });
  const batch = (await qRes.json().catch(() => [])) as { id: string; email: string; name: string | null }[];
  const isResend = camp.send_via === "resend";
  let sent = 0, failed = 0;
  for (const r of batch) {
    const who = r.name || "there";
    const unsub = await unsubUrl(uid, r.email);
    const tok = await trackToken(id, r.id);
    const personalized = String(camp.body).replace(/\{\{\s*name\s*\}\}/g, esc(who));
    const html = `${withTracking(personalized, id, r.id, tok)}<br><br><hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888;font-family:system-ui,sans-serif">You're receiving this because you're on a list managed in Sendra. <a href="${unsub}" style="color:#888">Unsubscribe</a>.</p>${openPixel(id, r.id, tok)}`;
    const res: { ok: boolean; id?: string; error?: string } = isResend
      ? await sendOneResend({ fromEmail: camp.from_email, fromName: camp.from_name, to: r.email, subject: camp.subject, html, unsub })
      : await sendOne(uid, camp.app, r.email, camp.subject, html);
    await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${r.id}`, {
      method: "PATCH", headers: sbHeaders,
      body: JSON.stringify(res.ok ? { status: "sent", sent_at: new Date().toISOString(), ...(res.id ? { provider_msg_id: res.id } : {}) } : { status: "failed", error: res.error }),
    });
    if (res.ok) sent++; else failed++;
    await sleep(isResend ? 600 : 700); // throttle — Resend default 2/sec; Gmail likes it slow too
  }
  const [totSent, totFailed, remaining] = await Promise.all([countBy(id, "sent"), countBy(id, "failed"), countBy(id, "queued")]);
  const done = remaining === 0;
  await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders,
    body: JSON.stringify({ sent: totSent, failed: totFailed, status: done ? "sent" : "sending", locked_until: null, updated_at: new Date().toISOString() }),
  });
  return { sent, failed, remaining, done };
}

// Shared secret the scheduled-send cron presents (mirrors the run-workflows pattern;
// the value lives in Vault and is read back via a security-definer RPC).
async function cronSecret(): Promise<string> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/campaigns_cron_secret`, { method: "POST", headers: sbHeaders, body: "{}" });
    if (!r.ok) return "";
    const v = await r.json().catch(() => "");
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  if (!API_KEY) return json(req, { error: "composio_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  // Scheduled sends: the pg_cron job posts { action: "run_due" } with the cron secret.
  // Drain every campaign whose scheduled time has arrived (bounded ~40 sends per tick).
  if (action === "run_due") {
    const secret = await cronSecret();
    if (!secret || !token || token !== secret) return json(req, { error: "unauthorized" }, 401);
    try {
      const nowIso = new Date().toISOString();
      const dueRes = await fetch(`${SB_URL}/rest/v1/campaigns?scheduled_at=lte.${encodeURIComponent(nowIso)}&status=in.(scheduled,sending)&select=*&order=scheduled_at.asc&limit=15`, { headers: sbHeaders });
      const due = (await dueRes.json().catch(() => [])) as Record<string, unknown>[];
      let budget = 40, processed = 0;
      for (const camp of (Array.isArray(due) ? due : [])) {
        if (budget <= 0) break;
        try { const r = await drainCampaign(camp, Math.min(20, budget)); budget -= (r.sent + r.failed); processed++; } catch { /* skip one bad campaign */ }
      }
      return json(req, { ok: true, processed });
    } catch (e) {
      console.error("campaigns run_due:", String((e as Error)?.message || e));
      return json(req, { error: "request_failed" }, 502);
    }
  }

  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  try {
    if (action === "create") {
      const app = String(body?.app || "gmail").toLowerCase();
      const subject = String(body?.subject || "").trim();
      const html = String(body?.body || "");
      const name = String(body?.name || subject || "Untitled campaign").slice(0, 120);
      const raw = Array.isArray(body?.recipients) ? body.recipients as Record<string, unknown>[] : [];
      if (!subject || !html) return json(req, { error: "missing_content" });

      // Sending method: built-in Resend (zero setup) or the user's mailbox (default).
      const sendVia = String(body?.send_via || "mailbox").toLowerCase() === "resend" ? "resend" : "mailbox";
      let fromEmail: string | null = null;
      let fromName: string | null = null;
      if (sendVia === "resend") {
        if (!RESEND_API_KEY) return json(req, { error: "resend_unset" });
        fromName = body?.from_name ? String(body.from_name).slice(0, 120) : null;
        // Optional custom From on one of the user's OWN verified domains; else the central RESEND_FROM.
        const rawFrom = String(body?.from_email || "").trim().toLowerCase();
        if (rawFrom) {
          if (!EMAIL_RE.test(rawFrom)) return json(req, { error: "bad_from" });
          const dom = vHost(rawFrom.split("@")[1] || "");  // re-validate before interpolating
          if (!dom) return json(req, { error: "bad_from" });
          const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${dom}&status=eq.verified&select=domain`, { headers: sbHeaders });
          if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
          fromEmail = rawFrom;
        }
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

      // Optional scheduled send: a future ISO timestamp parks the campaign as "scheduled"
      // and the run_due cron drains it when the time arrives. Otherwise it's a draft.
      let scheduledAt: string | null = null;
      const rawSched = body?.scheduled_at ? String(body.scheduled_at) : "";
      if (rawSched) {
        const t = Date.parse(rawSched);
        if (Number.isFinite(t) && t > Date.now() + 30000) scheduledAt = new Date(t).toISOString();
      }

      const cRes = await fetch(`${SB_URL}/rest/v1/campaigns`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: uid, app, name, subject, body: html, status: scheduledAt ? "scheduled" : "draft", total: recips.length, send_via: sendVia, from_email: fromEmail, from_name: fromName, scheduled_at: scheduledAt }),
      });
      const camp = (await cRes.json().catch(() => []))?.[0];
      if (!cRes.ok || !camp?.id) return json(req, { error: "create_failed" }, 502);

      const rows = recips.map((c) => ({ campaign_id: camp.id, user_id: uid, email: c.email, name: c.name, status: "queued" }));
      const rRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients`, {
        method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(rows),
      });
      if (!rRes.ok) return json(req, { error: "recipients_failed" }, 502);
      return json(req, { id: camp.id, queued: recips.length, skipped, invalid, scheduled: !!scheduledAt, scheduled_at: scheduledAt });
    }

    if (action === "send") {
      const id = vId(body?.id);
      const limit = Math.min(Math.max(Number(body?.limit || 20), 1), 30);
      if (!id) return json(req, { error: "missing_id" }, 400);

      const cRes = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&select=*`, { headers: sbHeaders });
      const camp = (await cRes.json().catch(() => []))?.[0];
      if (!camp) return json(req, { error: "not_found" });
      const r = await drainCampaign(camp, limit);
      return json(req, r);
    }

    if (action === "get") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "not_found" });
      const r = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&select=*`, { headers: sbHeaders });
      const camp = (await r.json().catch(() => []))?.[0];
      return camp ? json(req, { campaign: camp }) : json(req, { error: "not_found" });
    }

    if (action === "list") {
      const r = await fetch(`${SB_URL}/rest/v1/campaigns?user_id=eq.${uid}&select=id,name,subject,app,status,total,sent,failed,scheduled_at,created_at&order=created_at.desc&limit=50`, { headers: sbHeaders });
      const campaigns = await r.json().catch(() => []);
      return json(req, { campaigns: Array.isArray(campaigns) ? campaigns : [] });
    }

    // Cancel a scheduled send (only while still pending) — back to a draft.
    if (action === "unschedule") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&status=eq.scheduled`, {
        method: "PATCH", headers: sbHeaders,
        body: JSON.stringify({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() }),
      });
      return json(req, { ok: true });
    }

    // Sender-agnostic deliverability: 30-day volume + delivered/bounce/complaint rates,
    // computed from the user's campaign_recipients (delivered counted by delivered_at,
    // since status stays "sent"). Powers the Deliverability tab now that SES is gone.
    if (action === "deliverability") {
      const since30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const [accepted, delivered, bounced, complained, sent30] = await Promise.all([
        countUser(uid, "&status=in.(sent,bounced,complained)"),
        countUser(uid, "&delivered_at=not.is.null"),
        countUser(uid, "&status=eq.bounced"),
        countUser(uid, "&status=eq.complained"),
        countUser(uid, `&sent_at=gte.${encodeURIComponent(since30)}`),
      ]);
      return json(req, { reputation: {
        accepted, delivered, bounced, complained, sent30,
        bounceRate: accepted ? bounced / accepted : 0,
        complaintRate: delivered ? complained / delivered : 0,
      } });
    }

    // Engagement stats for one campaign (unique opens/clicks via the `track` fn +
    // delivered/bounced/complained from provider webhooks). Rates are computed client-side.
    if (action === "stats") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      const cRes = await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${uid}&select=id,name,subject,app,status,total,sent,failed,send_via,created_at`, { headers: sbHeaders });
      const camp = (await cRes.json().catch(() => []))?.[0];
      if (!camp) return json(req, { error: "not_found" });
      const [delivered, opened, clicked, bounced, complained] = await Promise.all([
        countFilter(id, "delivered_at=not.is.null"),
        countFilter(id, "opened_at=not.is.null"),
        countFilter(id, "clicked_at=not.is.null"),
        countFilter(id, "status=eq.bounced"),
        countFilter(id, "status=eq.complained"),
      ]);
      return json(req, { campaign: camp, stats: { total: camp.total, sent: camp.sent, failed: camp.failed, delivered, opened, clicked, bounced, complained } });
    }

    // Per-email activity log — every send across the user's campaigns + its status.
    if (action === "logs") {
      const q = String(body?.q || "").trim().slice(0, 120);
      const emailFilter = q ? `&email=ilike.*${encodeURIComponent(q)}*` : "";
      const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?user_id=eq.${uid}&status=neq.queued${emailFilter}&select=email,name,status,sent_at,delivered_at,opened_at,clicked_at,error,campaign:campaigns(name,subject)&order=sent_at.desc.nullslast&limit=100`, { headers: sbHeaders });
      const logs = await r.json().catch(() => []);
      return json(req, { logs: Array.isArray(logs) ? logs : [] });
    }

    if (action === "suppressions") {
      const r = await fetch(`${SB_URL}/rest/v1/email_suppressions?user_id=eq.${uid}&select=email,reason,created_at&order=created_at.desc&limit=500`, { headers: sbHeaders });
      const s = await r.json().catch(() => []);
      return json(req, { suppressions: Array.isArray(s) ? s : [] });
    }

    if (action === "unsuppress") {
      const email = String(body?.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      await fetch(`${SB_URL}/rest/v1/email_suppressions?user_id=eq.${uid}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("campaigns error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
