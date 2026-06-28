import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra email campaigns. Sends through the user's connected Gmail/Outlook mailbox
// (send_via "mailbox", ~500/day cap). Sending from a self-hosted custom domain is
// added with the mail server (the `mailer` fn).
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
// Self-hosted sender relay (the box) — used when a campaign sends from the user's
// own verified domain (send_via "self"). Same secret as the `mailer` fn.
const RELAY_URL = (Deno.env.get("MAILER_RELAY_URL") ?? "").replace(/[/]+$/, "");
const RELAY_TOKEN = Deno.env.get("MAILER_RELAY_TOKEN") ?? "";

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

// Send one campaign email through the self-hosted mail server's relay (the box;
// OpenDKIM signs by From domain). Returns the relay's Message-ID (sans brackets) so
// the bounce ingest can map events back to this recipient.
async function sendOneSelf(fromEmail: string | null, fromName: string | null, to: string, subject: string, html: string, unsub: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RELAY_URL || !RELAY_TOKEN) return { ok: false, error: "mail_server_unset" };
  try {
    const from = fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : "no-reply@gofarther.dev";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${RELAY_URL}/send`, {
      method: "POST", signal: ctrl.signal,
      headers: { authorization: `Bearer ${RELAY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text: htmlToText(html), list_unsubscribe: unsub }),
    }).finally(() => clearTimeout(t));
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { ok: false, error: `relay_${res.status}:${j?.error ?? ""}`.slice(0, 200) };
    return { ok: true, id: typeof j?.id === "string" ? j.id.replace(/[<>]/g, "") : undefined };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

// --- Reputation guard ---------------------------------------------------------
// A self-hosted shared IP has no provider to police bad senders, so we do it: if a
// customer's RECENT bounce/complaint rate crosses the line we pause them (and alert
// the operator) rather than let them burn the shared IP's reputation for everyone.
const REP_WINDOW_DAYS = 30;      // look back this far
const REP_MIN_SAMPLE = 20;       // ignore tiny volume (rates are noise below this)
const REP_MAX_BOUNCE = 0.10;     // hard-bounce ceiling (matches SES's pause line)
const REP_MAX_COMPLAINT = 0.005; // complaint ceiling
async function reputationBlock(uid: string): Promise<string | null> {
  const since = new Date(Date.now() - REP_WINDOW_DAYS * 86400 * 1000).toISOString();
  const w = `&sent_at=gte.${encodeURIComponent(since)}`;
  const [accepted, bounced, complained] = await Promise.all([
    countUser(uid, `${w}&status=in.(sent,bounced,complained)`),
    countUser(uid, `${w}&status=eq.bounced`),
    countUser(uid, `${w}&status=eq.complained`),
  ]);
  if (accepted < REP_MIN_SAMPLE) return null;
  if (bounced / accepted > REP_MAX_BOUNCE) return `bounce rate ${Math.round((bounced / accepted) * 100)}% (limit ${Math.round(REP_MAX_BOUNCE * 100)}%)`;
  if (complained / accepted > REP_MAX_COMPLAINT) return `complaint rate ${((complained / accepted) * 100).toFixed(1)}% (limit ${(REP_MAX_COMPLAINT * 100).toFixed(1)}%)`;
  return null;
}
// Record an operator alert (deduped 6h per customer); ops-monitor emails recent ones.
async function recordReputationAlert(uid: string, detail: string): Promise<void> {
  const key = `reputation:${uid}`;
  try {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/ops_alerts?key=eq.${encodeURIComponent(key)}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=1`, { headers: sbHeaders });
    if (r.ok && ((await r.json()) as unknown[]).length) return;
    await fetch(`${SB_URL}/rest/v1/ops_alerts`, { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify({ key, message: `Customer ${uid} auto-paused: ${detail}`, emailed: false }) });
  } catch { /* best effort */ }
}

// --- Warm-up throttle ---------------------------------------------------------
// A brand-new sending IP has no reputation; blasting full volume on day one gets it
// throttled or blocked by mailbox providers. So for self-hosted sends (send_via "self"
// — they all share the box's single IP) we cap volume per rolling 24h and ramp the
// ceiling over the first weeks. Mailbox sends (Gmail/Outlook) leave the user's own
// provider, not our IP, so they're never warm-up-limited. Disable with MAILER_WARMUP=off.
const WARMUP_ON = (Deno.env.get("MAILER_WARMUP") ?? "on").toLowerCase() !== "off";
// Rolling-24h ceiling for the shared IP, by days since the first self-hosted send.
function warmupCap(day: number): number | null {
  if (day <= 1) return 50;
  if (day <= 3) return 100;
  if (day <= 5) return 250;
  if (day <= 7) return 500;
  if (day <= 10) return 1000;
  if (day <= 13) return 2500;
  if (day <= 17) return 5000;
  if (day <= 21) return 10000;
  if (day <= 27) return 25000;
  return null; // day 28+: warmed up — no cap
}
// Warm-up "day 0" = the first self-hosted send ever (across all customers; the IP is
// shared). Derived from the data, so there's nothing to seed or reset — null until the
// first send goes out.
async function warmupStartMs(): Promise<number | null> {
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?status=eq.sent&sent_at=not.is.null&campaigns.send_via=eq.self&select=sent_at,campaigns!inner(send_via)&order=sent_at.asc&limit=1`, { headers: sbHeaders });
  const rows = (await r.json().catch(() => [])) as { sent_at?: string }[];
  const t = Array.isArray(rows) && rows[0]?.sent_at ? Date.parse(rows[0].sent_at) : NaN;
  return Number.isFinite(t) ? t : null;
}
// Count self-hosted sends across ALL customers since `sinceIso` (the IP is shared, so
// the warm-up budget is global, not per-user).
async function countSelfSince(sinceIso: string): Promise<number> {
  const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?status=eq.sent&sent_at=gte.${encodeURIComponent(sinceIso)}&campaigns.send_via=eq.self&select=id,campaigns!inner(send_via)`, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = r.headers.get("content-range") || "";
  const n = parseInt(cr.split("/")[1] || "0", 10);
  return Number.isFinite(n) ? n : 0;
}
// Remaining warm-up room for self-hosted sends right now, or null if there's no cap
// (warmed up, or disabled). `room` = how many more may leave the IP this rolling 24h.
async function warmupRoom(): Promise<{ cap: number; used: number; room: number; day: number } | null> {
  if (!WARMUP_ON) return null;
  const start = await warmupStartMs();
  const day = start == null ? 0 : Math.floor((Date.now() - start) / 86400000);
  const cap = warmupCap(day);
  if (cap == null) return null;
  const used = await countSelfSince(new Date(Date.now() - 86400 * 1000).toISOString());
  return { cap, used, room: Math.max(0, cap - used), day };
}

// --- Outbound webhook fanout (sent/failed per send) ---------------------------
// Mirror the `webhooks` fn's signing so receivers verify these the same way as
// bounce/open/unsub events. Endpoints are fetched ONCE per drain batch (not per
// recipient) and delivery runs in the background, so a campaign with no webhooks
// configured pays a single cheap query and zero added send latency.
type WhEndpoint = { id: string; url: string; secret: string; events: string[] | null };
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
async function getEndpoints(uid: string): Promise<WhEndpoint[]> {
  if (!UUID_RE.test(uid)) return [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/webhook_endpoints?user_id=eq.${uid}&enabled=eq.true&select=id,url,secret,events`, { headers: sbHeaders });
    const e = r.ok ? await r.json() : [];
    return Array.isArray(e) ? e : [];
  } catch { return []; }
}
async function deliverEvent(eps: WhEndpoint[], type: string, data: Record<string, unknown>): Promise<void> {
  if (!eps.length) return;
  const event = { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), data };
  const bodyStr = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000).toString();
  await Promise.all(eps.map(async (ep) => {
    if (!ep?.url || whBadUrl(ep.url)) return;
    if (Array.isArray(ep.events) && ep.events.length && !ep.events.includes(type)) return;
    let status = 0;
    try {
      const signature = await whSign(ep.secret, ts, bodyStr);
      const res = await fetch(ep.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Sendra-Webhooks/1.0", "sendra-id": event.id, "sendra-timestamp": ts, "sendra-signature": `v1=${signature}` }, body: bodyStr, redirect: "manual", signal: AbortSignal.timeout(8000) });
      status = res.status;
    } catch { status = 0; }
    const ok = status >= 200 && status < 300;
    try { await fetch(`${SB_URL}/rest/v1/webhook_endpoints?id=eq.${ep.id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify(ok ? { last_status: status, last_event_at: new Date().toISOString(), failure_count: 0 } : { last_status: status, last_event_at: new Date().toISOString() }) }); } catch { /* ignore */ }
  }));
}
function bg(tasks: Promise<unknown>[]): Promise<unknown> | void {
  if (!tasks.length) return;
  const all = Promise.allSettled(tasks);
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") { wu(all); return; }
  return all;
}

// --- Durable retry ------------------------------------------------------------
// For self-hosted sends, a TRANSIENT relay failure (box briefly down, 5xx, network)
// shouldn't burn the recipient as failed — requeue it and let the next drain / cron
// tick retry, up to a cap. Permanent failures (4xx, bad address, config) fail at once.
const MAX_SEND_ATTEMPTS = 8;
function isTransient(err?: string): boolean {
  const e = (err || "").toLowerCase();
  if (!e) return true;
  if (e.includes("mail_server_unset")) return false;   // config, not transient
  if (/relay_5\d\d/.test(e) || e.includes("relay_429")) return true;  // server / rate-limit
  if (/relay_4\d\d/.test(e)) return false;             // client error (bad request/address)
  return true;                                         // network / timeout / abort → transient
}

// Drain one batch of a campaign's queue. Shared by the `send` action (client-driven)
// and the scheduled `run_due` cron. Flips draft/scheduled -> sending, sends up to
// `limit`, updates counts, and marks the campaign sent once the queue is empty.
// deno-lint-ignore no-explicit-any
async function drainCampaign(camp: any, limit: number): Promise<{ sent: number; failed: number; remaining: number; done: boolean; paused?: boolean; warmup?: { day: number; cap: number; used: number }; retry?: boolean }> {
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
  // Reputation guard: pause this customer (don't keep sending) if their recent
  // bounce/complaint rate is too high — protects the shared sending IP.
  const repBlock = await reputationBlock(uid);
  if (repBlock) {
    await recordReputationAlert(uid, repBlock);
    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "paused", locked_until: null, updated_at: new Date().toISOString() }) });
    return { sent: 0, failed: 0, remaining: await countBy(id, "queued"), done: false, paused: true };
  }
  // Warm-up throttle: self-hosted sends share one new IP, so cap volume per rolling 24h
  // and ramp it (warmupCap). Trim this batch to the remaining room; if there's none,
  // leave the campaign 'sending' and stop — the run_due cron resumes it as the window
  // frees up, so neither the user nor the operator has to babysit the ramp.
  let effLimit = limit;
  if (camp.send_via === "self") {
    const wu = await warmupRoom();
    if (wu) {
      if (wu.room <= 0) {
        await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "sending", locked_until: null, updated_at: new Date().toISOString() }) });
        return { sent: 0, failed: 0, remaining: await countBy(id, "queued"), done: false, warmup: { day: wu.day, cap: wu.cap, used: wu.used } };
      }
      effLimit = Math.min(limit, wu.room);
    }
  }
  if (camp.status === "draft" || camp.status === "scheduled") {
    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "sending", updated_at: new Date().toISOString() }) });
  }
  const qRes = await fetch(`${SB_URL}/rest/v1/campaign_recipients?campaign_id=eq.${id}&status=eq.queued&select=id,email,name,attempts&order=id.asc&limit=${effLimit}`, { headers: sbHeaders });
  const batch = (await qRes.json().catch(() => [])) as { id: string; email: string; name: string | null; attempts: number | null }[];
  let sent = 0, failed = 0;
  let transientStop = false;               // a transient relay failure requeued a recipient
  const isSelf = camp.send_via === "self";
  const whEps = await getEndpoints(uid);   // once per batch; empty unless the user set up webhooks
  const whTasks: Promise<unknown>[] = [];
  for (const r of batch) {
    const who = r.name || "there";
    const unsub = await unsubUrl(uid, r.email);
    const tok = await trackToken(id, r.id);
    const personalized = String(camp.body).replace(/\{\{\s*name\s*\}\}/g, esc(who));
    const html = `${withTracking(personalized, id, r.id, tok)}<br><br><hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888;font-family:system-ui,sans-serif">You're receiving this because you're on a list managed in Sendra. <a href="${unsub}" style="color:#888">Unsubscribe</a>.</p>${openPixel(id, r.id, tok)}`;
    const res: { ok: boolean; id?: string; error?: string } = isSelf
      ? await sendOneSelf(camp.from_email, camp.from_name, r.email, camp.subject, html, unsub)
      : await sendOne(uid, camp.app, r.email, camp.subject, html);
    if (res.ok) {
      await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${r.id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), ...(res.id ? { provider_msg_id: res.id } : {}) }) });
      sent++;
      if (whEps.length) whTasks.push(deliverEvent(whEps, "sent", { email: r.email, campaign_id: id, recipient_id: r.id, ...(res.id ? { message_id: res.id } : {}) }));
    } else {
      const nextAttempts = (r.attempts ?? 0) + 1;
      if (isSelf && isTransient(res.error) && nextAttempts < MAX_SEND_ATTEMPTS) {
        // Transient (box down / 5xx / network): keep it queued so the next drain or cron tick retries.
        await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${r.id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "queued", attempts: nextAttempts, error: res.error }) });
        transientStop = true;
      } else {
        await fetch(`${SB_URL}/rest/v1/campaign_recipients?id=eq.${r.id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ status: "failed", attempts: nextAttempts, error: res.error }) });
        failed++;
        if (whEps.length) whTasks.push(deliverEvent(whEps, "failed", { email: r.email, campaign_id: id, recipient_id: r.id, error: res.error }));
      }
    }
    await sleep(isSelf ? 500 : 700); // throttle
  }
  const [totSent, totFailed, remaining] = await Promise.all([countBy(id, "sent"), countBy(id, "failed"), countBy(id, "queued")]);
  const done = remaining === 0;
  await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders,
    body: JSON.stringify({ sent: totSent, failed: totFailed, status: done ? "sent" : "sending", locked_until: null, updated_at: new Date().toISOString() }),
  });
  const flush = bg(whTasks); if (flush) await flush;   // deliver sent/failed webhooks in the background
  // If the whole pass made no progress because the box was unreachable, tell the client
  // to stop looping — the campaign stays 'sending' and the run_due cron keeps retrying.
  return { sent, failed, remaining, done, ...(transientStop && sent === 0 ? { retry: true } : {}) };
}

// Shared secret the scheduled-send cron presents (the value lives in Vault and is
// read back via a security-definer RPC).
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
      // Resume in-flight self-hosted campaigns that the warm-up throttle parked: they
      // have no schedule, so the query above skips them. Drain a little more as the
      // rolling 24h window frees room. The per-campaign lock prevents double-send with
      // a concurrent client drain.
      if (budget > 0) {
        const inflRes = await fetch(`${SB_URL}/rest/v1/campaigns?status=eq.sending&scheduled_at=is.null&send_via=eq.self&select=*&order=updated_at.asc&limit=15`, { headers: sbHeaders });
        const infl = (await inflRes.json().catch(() => [])) as Record<string, unknown>[];
        for (const camp of (Array.isArray(infl) ? infl : [])) {
          if (budget <= 0) break;
          try { const r = await drainCampaign(camp, Math.min(20, budget)); budget -= (r.sent + r.failed); processed++; } catch { /* skip one bad campaign */ }
        }
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

      // Reputation guard: block new campaigns while this customer is over the
      // bounce/complaint limit (protects the shared sending IP).
      const repBlock = await reputationBlock(uid);
      if (repBlock) { await recordReputationAlert(uid, repBlock); return json(req, { error: "reputation_paused", detail: repBlock }); }

      // Sending method: the user's connected mailbox (default) or their own verified
      // self-hosted domain via the mail server relay (send_via "self").
      const sendVia = String(body?.send_via || "mailbox").toLowerCase() === "self" ? "self" : "mailbox";
      let fromEmail: string | null = null;
      let fromName: string | null = null;
      if (sendVia === "self") {
        if (!RELAY_URL || !RELAY_TOKEN) return json(req, { error: "mail_server_unset" });
        fromName = body?.from_name ? String(body.from_name).slice(0, 120) : null;
        const rawFrom = String(body?.from_email || "").trim().toLowerCase();
        if (!rawFrom || !EMAIL_RE.test(rawFrom)) return json(req, { error: "bad_from" });
        const dom = rawFrom.split("@")[1] || "";
        if (!/^[a-z0-9.-]+$/.test(dom)) return json(req, { error: "bad_from" });
        const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${dom}&verified=eq.true&select=domain`, { headers: sbHeaders });
        if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
        fromEmail = rawFrom;
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
