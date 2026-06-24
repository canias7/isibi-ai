import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

// Sendra custom sending domains — Amazon SES. Each user verifies their own domain
// (Easy DKIM CNAMEs) under the platform SES account; once verified, campaigns can
// be sent From news@theirdomain.com (see the `campaigns` function). Identity is
// server-verified (Supabase token); domain rows are service-role only.
//
// POST { action, ... } (via supabase.functions.invoke):
//   list                 -> { domains:[{domain,status,records,verified_at,created_at}] }
//   add    { domain }    -> { domain, status, records }   (creates SES identity)
//   status { domain }    -> { domain, status, verified, records }  (poll for DNS)
//   remove { domain }    -> { ok }
//   test   { domain, to }-> { ok }   (send a verification test email; sandbox: `to` must be verified)
//
// App-level failures return HTTP 200 { error: code } — supabase-js drops the body
// of non-2xx responses, so only true infra errors stay 5xx.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const AWS_ID = Deno.env.get("AWS_SES_ACCESS_KEY_ID") ?? "";
const AWS_SECRET = Deno.env.get("AWS_SES_SECRET_ACCESS_KEY") ?? "";
const AWS_REGION = Deno.env.get("AWS_SES_REGION") ?? "us-east-1";

const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
const aws = new AwsClient({ accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET, region: AWS_REGION, service: "ses" });
const awsSns = new AwsClient({ accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET, region: AWS_REGION, service: "sns" });
const SES_BASE = `https://email.${AWS_REGION}.amazonaws.com`;
const CONFIG_SET = "sendra";                 // SES configuration set campaigns send through
const TOPIC_NAME = "sendra-ses-events";      // SNS topic SES publishes events to
const EVENTS_URL = `${SB_URL}/functions/v1/ses-events`;
const INBOUND_TOPIC = "sendra-inbound";      // SNS topic for inbound replies (SES receipt rule -> here)
const INBOUND_URL = `${SB_URL}/functions/v1/ses-inbound`;
// Event types routed to the topic (and on to user webhooks). No OPEN/CLICK — those
// require SES open/click tracking, which rewrites links + injects a pixel into the email.
const EVENT_TYPES = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "DELIVERY_DELAY", "REJECT", "RENDERING_FAILURE"];

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
// A plausible registrable domain (labels of letters/digits/hyphens, a real TLD).
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
// Validate a body-supplied id before interpolating it into a PostgREST URL (a `#` would
// otherwise truncate the trailing &user_id ownership filter; `&` could add filters).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function vId(v: unknown): string { const s = String(v ?? "").trim(); return UUID_RE.test(s) ? s : ""; }
function vHost(v: string): string { return /^[a-z0-9.-]{1,253}$/i.test(v) ? v : ""; }

type Rec = { type: string; name: string; value: string; note?: string };
function buildRecords(domain: string, tokens: string[]): Rec[] {
  const recs: Rec[] = tokens.map((t) => ({
    type: "CNAME",
    name: `${t}._domainkey.${domain}`,
    value: `${t}.dkim.amazonses.com`,
    note: "DKIM (required)",
  }));
  // DMARC passes via aligned DKIM above; this record just publishes a policy + is
  // increasingly expected by Gmail/Yahoo for bulk senders.
  recs.push({ type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;", note: "DMARC (recommended)" });
  return recs;
}

async function ses(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await aws.fetch(`${SES_BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j: any;
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { ok: res.ok, status: res.status, body: j };
}

// ---- Domain Connect (one-click DNS). Discover the domain's DNS host and, only if our
// template is actually published there, hand back the "apply" URL. Until our template is
// synced by a provider this returns supported:false, so the app shows manual records. ----
const DC_PROVIDER = "gofarther.dev";       // our Domain Connect provider id (template namespace)
const DC_SERVICE = "email";
const DC_REDIRECT = "https://gofarther.dev/"; // must be in the template's syncRedirectDomains
async function dohTxt(name: string): Promise<string> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return "";
    const j = await r.json().catch(() => ({})) as any;
    const ans = (j?.Answer || []).find((a: any) => a?.type === 16);
    return ans ? String(ans.data || "").replace(/^"|"$/g, "").trim() : "";
  } catch { return ""; }
}
// All TXT records at a name (apex SPF, _dmarc, etc.). Long records arrive as
// 255-char chunks joined by `" "`; we collapse those boundaries back together.
async function dohTxtAll(name: string): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({})) as any;
    return (j?.Answer || []).filter((a: any) => a?.type === 16).map((a: any) => String(a.data || "").replace(/^"|"$/g, "").replace(/"\s+"/g, "").trim());
  } catch { return []; }
}
function dkimTokens(records: Rec[]): string[] {
  return records.filter((r) => r.type === "CNAME" && /\.dkim\.amazonses\.com$/i.test(r.value)).map((r) => r.value.replace(/\.dkim\.amazonses\.com$/i, ""));
}
async function domainConnectUrl(domain: string, records: Rec[]): Promise<{ supported: boolean; applyUrl?: string; provider?: string; reason?: string }> {
  const tokens = dkimTokens(records);
  if (tokens.length < 3) return { supported: false };
  // The _domainconnect TXT is the API *base* (host + optional path), e.g.
  // "api.cloudflare.com/client/v4/dns/domainconnect" — not just a hostname.
  const base = (await dohTxt(`_domainconnect.${domain}`)).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!base || /\s/.test(base)) return { supported: false };
  let settingsUrl: string;
  try { settingsUrl = new URL(`https://${base}/v2/${encodeURIComponent(domain)}/settings`).toString(); } catch { return { supported: false }; }
  let s: any;
  try {
    const set = await fetch(settingsUrl, { signal: AbortSignal.timeout(8000) });
    if (!set.ok) return { supported: false };
    s = await set.json().catch(() => ({}));
  } catch { return { supported: false }; }
  const urlSyncUX = String(s?.urlSyncUX || "");
  const urlAPI = String(s?.urlAPI || "");
  const provider = String(s?.providerDisplayName || s?.providerName || "your DNS host");
  if (!urlSyncUX) return { supported: false };
  // Only offer one-click if our template is actually published at this provider.
  if (urlAPI) {
    try {
      const tpl = await fetch(`${urlAPI}/v2/domainTemplates/providers/${DC_PROVIDER}/services/${DC_SERVICE}`, { signal: AbortSignal.timeout(8000) });
      if (!tpl.ok) return { supported: false, reason: "template_pending", provider };
    } catch { return { supported: false, reason: "template_pending", provider }; }
  }
  const vars = `dkim1=${encodeURIComponent(tokens[0])}&dkim2=${encodeURIComponent(tokens[1])}&dkim3=${encodeURIComponent(tokens[2])}`;
  const applyUrl = `${urlSyncUX}/v2/domainTemplates/providers/${DC_PROVIDER}/services/${DC_SERVICE}/apply?domain=${encodeURIComponent(domain)}&${vars}&redirect_uri=${encodeURIComponent(DC_REDIRECT)}`;
  return { supported: true, applyUrl, provider };
}

// --- Email-event tracking: SES configuration set -> SNS topic -> ses-events
// webhook (suppressions + user webhook fan-out). Best-effort + idempotent. The config
// set needs only SES perms; the SNS wiring needs the SNS perms on the IAM key. Cached
// per instance once fully wired.
let trackingDone = false;
async function snsCall(action: string, params: Record<string, string>): Promise<{ ok: boolean; text: string }> {
  const body = new URLSearchParams({ Action: action, Version: "2010-03-31", ...params });
  const res = await awsSns.fetch(`https://sns.${AWS_REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return { ok: res.ok, text: await res.text() };
}
async function ensureTracking(): Promise<void> {
  if (trackingDone) return;
  // 1. Configuration set (SES-only — always safe to attempt).
  const mk = await ses("POST", "/v2/email/configuration-sets", { ConfigurationSetName: CONFIG_SET });
  if (!mk.ok && !/AlreadyExists|already exists/i.test(JSON.stringify(mk.body))) return;
  // 2. SNS topic (idempotent; returns the existing ARN). Needs SNS perms.
  const t = await snsCall("CreateTopic", { Name: TOPIC_NAME });
  const arn = (t.text.match(/<TopicArn>([^<]+)<\/TopicArn>/) || [])[1];
  if (!arn) return; // SNS perms not added yet — try again next time
  const accountId = arn.split(":")[4] || "";
  // 3. Allow SES to publish to the topic.
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ses.amazonaws.com" }, Action: "sns:Publish", Resource: arn, Condition: { StringEquals: { "aws:SourceAccount": accountId } } }],
  });
  await snsCall("SetTopicAttributes", { TopicArn: arn, AttributeName: "Policy", AttributeValue: policy });
  // 4. Subscribe our webhook (idempotent; SNS sends a confirmation the webhook auto-accepts).
  await snsCall("Subscribe", { TopicArn: arn, Protocol: "https", Endpoint: EVENTS_URL, ReturnSubscriptionArn: "true" });
  // 5. Route email events from the config set to the topic. Single destination
  //    (kept under its original name); if it already exists, update its event set so
  //    older setups (BOUNCE+COMPLAINT only) get upgraded to the full list.
  const NAME = "sendra-bounces";
  const dest = { Enabled: true, MatchingEventTypes: EVENT_TYPES, SnsDestination: { TopicArn: arn } };
  const ed = await ses("POST", `/v2/email/configuration-sets/${CONFIG_SET}/event-destinations`, {
    EventDestinationName: NAME,
    EventDestination: dest,
  });
  if (ed.ok) { trackingDone = true; return; }
  if (/AlreadyExists|already exists/i.test(JSON.stringify(ed.body))) {
    const up = await ses("PUT", `/v2/email/configuration-sets/${CONFIG_SET}/event-destinations/${NAME}`, { EventDestination: dest });
    if (up.ok) trackingDone = true;
  }
}

// Persist a domain row (upsert on user_id+domain).
async function upsertDomain(uid: string, domain: string, status: string, records: Rec[], verified: boolean) {
  const row: Record<string, unknown> = {
    user_id: uid, domain, status, records,
    verified_at: verified ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  await fetch(`${SB_URL}/rest/v1/sending_domains?on_conflict=user_id,domain`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

// Count this user's campaign recipients matching a PostgREST filter, via the
// Content-Range header (count=exact) so we never pull the rows themselves.
async function countRecipients(uid: string, extra: string): Promise<number> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/campaign_recipients?user_id=eq.${uid}${extra}&select=id`, {
      headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
    });
    const n = (r.headers.get("content-range") || "").split("/")[1];
    return n && n !== "*" ? (parseInt(n, 10) || 0) : 0;
  } catch { return 0; }
}

// ---- Reply handling (inbound). SES receipt rule for reply.<domain> -> SNS -> the
// ses-inbound webhook. All idempotent + best-effort; gated behind the reply_setup
// action so nothing activates until the user opts in and points the subdomain's MX. ----
const MX_TARGET = `inbound-smtp.${AWS_REGION}.amazonaws.com`;
async function dohMx(name: string): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=MX`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({})) as any;
    return (j?.Answer || []).filter((a: any) => a?.type === 15).map((a: any) => String(a.data || "").trim().toLowerCase());
  } catch { return []; }
}
// SES v1 query API (receipt rules live here, not the v2 REST API used elsewhere).
async function sesV1(params: Record<string, string>): Promise<{ ok: boolean; text: string }> {
  const body = new URLSearchParams({ Version: "2010-12-01", ...params });
  const res = await aws.fetch(`https://email.${AWS_REGION}.amazonaws.com/`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  return { ok: res.ok, text: await res.text() };
}
// SNS topic SES publishes inbound mail to, with a policy allowing the SES service to
// publish and our ses-inbound webhook subscribed. Returns the topic ARN (or "").
async function ensureInboundTopic(): Promise<string> {
  const t = await snsCall("CreateTopic", { Name: INBOUND_TOPIC });
  const arn = (t.text.match(/<TopicArn>([^<]+)<\/TopicArn>/) || [])[1];
  if (!arn) return "";
  const accountId = arn.split(":")[4] || "";
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ses.amazonaws.com" }, Action: "sns:Publish", Resource: arn, Condition: { StringEquals: { "aws:SourceAccount": accountId } } }],
  });
  await snsCall("SetTopicAttributes", { TopicArn: arn, AttributeName: "Policy", AttributeValue: policy });
  await snsCall("Subscribe", { TopicArn: arn, Protocol: "https", Endpoint: INBOUND_URL, ReturnSubscriptionArn: "true" });
  return arn;
}
// Receipt rule routing reply.<domain> to the inbound topic. Adds our rule to whatever
// rule set is active (creating + activating "sendra-inbound" only if none is). Idempotent.
async function ensureInboundRule(domain: string, arn: string): Promise<boolean> {
  const ruleName = `reply-${domain.replace(/[^a-z0-9]+/gi, "-")}`.slice(0, 64);
  const desc = await sesV1({ Action: "DescribeActiveReceiptRuleSet" });
  let setName = (desc.text.match(/<Name>([^<]+)<\/Name>/) || [])[1] || "";
  if (!setName) {
    setName = INBOUND_TOPIC;
    await sesV1({ Action: "CreateReceiptRuleSet", RuleSetName: setName });
    await sesV1({ Action: "SetActiveReceiptRuleSet", RuleSetName: setName });
  }
  const r = await sesV1({
    Action: "CreateReceiptRule",
    RuleSetName: setName,
    "Rule.Name": ruleName,
    "Rule.Enabled": "true",
    "Rule.TlsPolicy": "Optional",
    "Rule.ScanEnabled": "true",
    "Rule.Recipients.member.1": `reply.${domain}`,
    "Rule.Actions.member.1.SNSAction.TopicArn": arn,
    "Rule.Actions.member.1.SNSAction.Encoding": "UTF-8",
  });
  return r.ok || /AlreadyExists|already exists/i.test(r.text);
}
async function setReplyEnabled(uid: string, domain: string, enabled: boolean): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}`, {
    method: "PATCH", headers: sbHeaders, body: JSON.stringify({ reply_enabled: enabled, updated_at: new Date().toISOString() }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  if (!AWS_ID || !AWS_SECRET) return json(req, { error: "ses_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  try {
    if (action === "list") {
      const r = await fetch(
        `${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&select=id,domain,status,records,verified_at,created_at,reply_enabled&order=created_at.desc`,
        { headers: sbHeaders },
      );
      const domains = await r.json().catch(() => []);
      return json(req, { domains: Array.isArray(domains) ? domains : [] });
    }

    if (action === "add") {
      const domain = String(body?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });

      // Create the SES identity (Easy DKIM). If it already exists, just read it back.
      let tokens: string[] = [];
      let verified = false;
      const create = await ses("POST", "/v2/email/identities", { EmailIdentity: domain });
      if (create.ok) {
        tokens = create.body?.DkimAttributes?.Tokens || [];
        verified = create.body?.VerifiedForSendingStatus === true;
      } else {
        const get = await ses("GET", `/v2/email/identities/${encodeURIComponent(domain)}`);
        if (!get.ok) return json(req, { error: "ses_create_failed", detail: String(create.body?.message || create.status).slice(0, 200) });
        tokens = get.body?.DkimAttributes?.Tokens || [];
        verified = get.body?.VerifiedForSendingStatus === true;
      }

      const records = buildRecords(domain, tokens);
      const status = verified ? "verified" : "pending";
      await upsertDomain(uid, domain, status, records, verified);
      await ensureTracking().catch(() => {});  // wire bounce/complaint events (best-effort)
      return json(req, { domain, status, records });
    }

    if (action === "status") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      const get = await ses("GET", `/v2/email/identities/${encodeURIComponent(domain)}`);
      if (!get.ok) return json(req, { error: "not_found" });
      const tokens: string[] = get.body?.DkimAttributes?.Tokens || [];
      const verified = get.body?.VerifiedForSendingStatus === true || get.body?.VerificationStatus === "SUCCESS";
      const records = buildRecords(domain, tokens);
      const status = verified ? "verified" : (get.body?.VerificationStatus === "FAILED" ? "failed" : "pending");
      await upsertDomain(uid, domain, status, records, verified);
      await ensureTracking().catch(() => {});  // wire bounce/complaint events once perms exist (best-effort)
      return json(req, { domain, status, verified, records });
    }

    if (action === "remove") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      await ses("DELETE", `/v2/email/identities/${encodeURIComponent(domain)}`);
      await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    if (action === "test") {
      const to = String(body?.to || "").trim().toLowerCase();
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return json(req, { error: "bad_to" });
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      // Confirm the domain is verified and owned by this user.
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&status=eq.verified&select=domain`, { headers: sbHeaders });
      if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
      const from = `Sendra <noreply@${domain}>`;
      const r = await ses("POST", "/v2/email/outbound-emails", {
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: {
          Subject: { Data: "Sendra test email", Charset: "UTF-8" },
          Body: { Html: { Data: `<p>This is a test email sent from <b>${domain}</b> via Sendra. Your domain is working. 🎉</p>`, Charset: "UTF-8" } },
        } },
      });
      if (!r.ok) return json(req, { error: "send_failed", detail: String(r.body?.message || r.status).slice(0, 200) });
      return json(req, { ok: true });
    }

    if (action === "setup") {
      await ensureTracking().catch(() => {});
      return json(req, { ok: trackingDone });
    }

    // Deliverability insights: per-domain auth (DKIM/SPF/DMARC, live from DNS) plus
    // account reputation (bounce/complaint rates) — the "are my emails landing?" view.
    if (action === "deliverability") {
      const r = await fetch(
        `${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&select=domain,status&order=created_at.desc`,
        { headers: sbHeaders },
      );
      const rows = (await r.json().catch(() => [])) as Array<{ domain: string; status: string }>;
      const domains = await Promise.all((Array.isArray(rows) ? rows : []).map(async (d) => {
        const dkim = d.status === "verified";  // Easy DKIM verified == signed + aligned
        const [apex, dmarcTxt] = await Promise.all([dohTxtAll(d.domain), dohTxtAll(`_dmarc.${d.domain}`)]);
        const spfVal = apex.find((t) => /^v=spf1/i.test(t)) || "";
        const spf = { found: !!spfVal, ses: /amazonses\.com/i.test(spfVal) };
        const dmarcVal = dmarcTxt.find((t) => /^v=DMARC1/i.test(t)) || "";
        const policy = (dmarcVal.match(/p\s*=\s*(none|quarantine|reject)/i) || [])[1]?.toLowerCase() || null;
        const dmarc = { found: !!dmarcVal, policy };
        let score = 0;
        if (dkim) score += 55;
        if (dmarc.found) score += 30;
        if (spf.found) score += 15;
        const grade = score >= 90 ? "great" : score >= 70 ? "good" : score >= 40 ? "fair" : "poor";
        const tips: string[] = [];
        if (!dkim) tips.push("Finish domain verification — add the DKIM records so your mail is signed.");
        if (!dmarc.found) tips.push(`Add a DMARC record: a TXT at _dmarc.${d.domain} set to "v=DMARC1; p=none;". Gmail and Yahoo expect it from bulk senders.`);
        else if (dmarc.policy === "none") tips.push("DMARC is in monitor mode (p=none). Once your sends look clean, tighten it to p=quarantine.");
        if (!spf.found) tips.push("Add an SPF record at your domain. With DKIM it's optional, but it's good hygiene many inboxes look for.");
        else if (!spf.ses) tips.push('Your SPF doesn’t list Amazon SES. Add "include:amazonses.com" if you want SPF to align too.');
        return { domain: d.domain, status: d.status, dkim, spf, dmarc, score, grade, tips };
      }));

      // delivered/opened/clicked live in timestamps, not status (status stays "sent"),
      // so count delivered by delivered_at — works for SES and Resend (and is what the
      // per-campaign stats already do). Counting by status here always read ~0 before.
      const [accepted, delivered, bounced, complained] = await Promise.all([
        countRecipients(uid, "&status=in.(sent,bounced,complained)"),
        countRecipients(uid, "&delivered_at=not.is.null"),
        countRecipients(uid, "&status=eq.bounced"),
        countRecipients(uid, "&status=eq.complained"),
      ]);
      const reputation = {
        accepted, delivered, bounced, complained,
        bounceRate: accepted ? bounced / accepted : 0,
        complaintRate: delivered ? complained / delivered : 0,
      };
      return json(req, { domains, reputation });
    }

    // ---- Reply handling (inbound) ----
    // Turn on replies for a verified domain: wire the SES receipt rule (best-effort) and
    // hand back the one MX record the user adds to start receiving. { domain } ->
    // { ok, wired, mx }. `wired:false` just means the AWS rule needs perms/retry — the
    // MX is still correct, and reply_setup is safe to call again.
    if (action === "reply_setup") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&status=eq.verified&select=domain`, { headers: sbHeaders });
      if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
      let wired = false;
      try {
        const arn = await ensureInboundTopic();
        if (arn) wired = await ensureInboundRule(domain, arn);
      } catch { wired = false; }
      await setReplyEnabled(uid, domain, true);
      return json(req, { ok: true, wired, mx: { host: `reply.${domain}`, type: "MX", priority: 10, value: MX_TARGET } });
    }

    if (action === "reply_disable") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      await setReplyEnabled(uid, domain, false);
      return json(req, { ok: true });
    }

    // Is reply.<domain>'s MX live and pointing at SES yet? { domain } -> { enabled, mxLive, mx }.
    if (action === "reply_status") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=reply_enabled`, { headers: sbHeaders });
      const row = (await dRes.json().catch(() => []))?.[0] as { reply_enabled?: boolean } | undefined;
      const mx = await dohMx(`reply.${domain}`);
      const mxLive = mx.some((m) => m.includes("inbound-smtp") && m.includes("amazonaws.com"));
      return json(req, { enabled: !!row?.reply_enabled, mxLive, mx: { host: `reply.${domain}`, type: "MX", priority: 10, value: MX_TARGET } });
    }

    // List inbound replies (newest first), with the campaign they belong to.
    if (action === "replies") {
      const r = await fetch(`${SB_URL}/rest/v1/replies?user_id=eq.${uid}&select=id,from_email,from_name,recipient_email,subject,snippet,body_text,read,created_at,campaign:campaigns(name,subject)&order=created_at.desc&limit=100`, { headers: sbHeaders });
      const replies = await r.json().catch(() => []);
      return json(req, { replies: Array.isArray(replies) ? replies : [] });
    }

    if (action === "reply_read") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/replies?id=eq.${id}&user_id=eq.${uid}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ read: true }) });
      return json(req, { ok: true });
    }

    // One-click (Domain Connect): is this domain's DNS host supported (and our template
    // live there)? If so, return the apply URL the app opens; else { supported:false }.
    if (action === "dcurl") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=records`, { headers: sbHeaders });
      const row = (await dRes.json().catch(() => []))?.[0];
      if (!row) return json(req, { supported: false });
      const result = await domainConnectUrl(domain, (row.records || []) as Rec[]);
      return json(req, result);
    }

    // One-click for Cloudflare without the public template: the user supplies a scoped
    // API token (used once, never stored), and we write the DKIM/DMARC records via the
    // Cloudflare API. { domain, token } -> { ok, created, skipped } | { error }.
    if (action === "cf_apply") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      const cfToken = String(body?.token || "").trim();
      if (!DOMAIN_RE.test(domain)) return json(req, { error: "bad_domain" });
      if (!cfToken) return json(req, { error: "missing_token" });
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=records`, { headers: sbHeaders });
      const row = (await dRes.json().catch(() => []))?.[0];
      const records = (row?.records || []) as Rec[];
      if (!records.length) return json(req, { error: "not_found" });
      // deno-lint-ignore no-explicit-any
      const cf = (path: string, init?: RequestInit): Promise<Response> =>
        fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${cfToken}`, "content-type": "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(10000) });
      let zoneId = "";
      try {
        const zr = await cf(`/zones?name=${encodeURIComponent(domain)}`);
        const zj = await zr.json().catch(() => ({})) as any;
        if (!zr.ok || zj?.success !== true) return json(req, { error: "cf_auth" });
        zoneId = zj?.result?.[0]?.id || "";
      } catch { return json(req, { error: "cf_failed" }); }
      if (!zoneId) return json(req, { error: "zone_not_found" });
      let created = 0, skipped = 0, failed = 0;
      for (const rec of records) {
        try {
          const cr = await cf(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.value, ttl: 3600, proxied: false }) });
          const cj = await cr.json().catch(() => ({})) as any;
          if (cr.ok && cj?.success === true) created++;
          else if (/already exists|81053|81057/i.test(JSON.stringify(cj?.errors || ""))) skipped++;
          else failed++;
        } catch { failed++; }
      }
      if (created + skipped === 0) return json(req, { error: "write_failed" });
      return json(req, { ok: true, created, skipped, failed });
    }

    // ---- Saved senders (reusable From identities at a verified domain) ----
    if (action === "senders") {
      const r = await fetch(`${SB_URL}/rest/v1/senders?user_id=eq.${uid}&select=id,from_name,from_email&order=created_at.desc`, { headers: sbHeaders });
      const senders = await r.json().catch(() => []);
      return json(req, { senders: Array.isArray(senders) ? senders : [] });
    }
    if (action === "sender_add") {
      const name = String(body?.name || "").slice(0, 120);
      const email = String(body?.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json(req, { error: "bad_email" });
      const dom = vHost(email.split("@")[1] || "");  // EMAIL_RE allows PostgREST metachars in the domain
      if (!dom) return json(req, { error: "bad_email" });
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${dom}&status=eq.verified&select=domain`, { headers: sbHeaders });
      if (!((await dRes.json().catch(() => [])) as unknown[]).length) return json(req, { error: "domain_not_verified" });
      const r = await fetch(`${SB_URL}/rest/v1/senders?on_conflict=user_id,from_email`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: uid, from_name: name, from_email: email }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      return row?.id ? json(req, { sender: row }) : json(req, { error: "add_failed" }, 502);
    }
    if (action === "sender_remove") {
      const id = vId(body?.id);
      if (!id) return json(req, { error: "missing_id" });
      await fetch(`${SB_URL}/rest/v1/senders?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("ses error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
