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
// A plausible registrable domain (labels of letters/digits/hyphens, a real TLD).
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

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
        `${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&select=id,domain,status,records,verified_at,created_at&order=created_at.desc`,
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

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("ses error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
