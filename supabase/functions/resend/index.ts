import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sendra's BUILT-IN email sender (Resend) — the "invisible" ESP behind campaigns.
// One central RESEND_API_KEY runs server-side and is never exposed to the client;
// users send through it without connecting anything (the Lovable-bundles-Supabase
// model). The caller is server-verified via their Supabase token, so a client can
// only ever send as themselves / under our quota.
//
// POST { action, ... } (invoked via supabase.functions.invoke):
//   status                                      -> { configured, from, test_only }
//   test   { to? }                              -> sends a test email (defaults to the caller's own email)
//   send   { to, subject, html?, text?, from?, replyTo?, headers? } -> { ok, id }
//   batch  { subject, html?, text?, from?, replyTo?, recipients:[{to, html?, text?, headers?}] } -> { ok, sent, ids }
//   domains                       -> { domains:[{domain,status,records,verified_at}] }   (the user's custom domains)
//   domain_add    { domain }      -> { domain, status, records }   (creates it in Resend, returns DNS records)
//   domain_verify { domain }      -> { domain, status, records }   (re-checks DNS, flips to verified)
//   domain_remove { domain }      -> { ok }
//   cf_apply { domain, token }    -> { ok, created, skipped }   (writes the DNS records via the Cloudflare API; token used once, never stored)
//
// Secrets: RESEND_API_KEY, RESEND_FROM (e.g. "Sendra <hello@mail.gofarther.app>").
// Before a domain is verified in Resend, leave RESEND_FROM unset — it defaults to
// onboarding@resend.dev, which can only send to YOUR Resend account email (great
// for the `test` action). Verify a domain, then set RESEND_FROM to send to anyone.

// The project secret is named RESEND-API-KEY (hyphens); fall back to it so a plain
// Deno.env lookup doesn't come back empty (which surfaced as a Resend 401).
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? Deno.env.get("RESEND-API-KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Sendra <onboarding@resend.dev>";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };
const RESEND_API = "https://api.resend.com/emails";
const RESEND_DOMAINS = "https://api.resend.com/domains";
// Strict hostname — only [a-z0-9.-], so a value that matches is safe to interpolate
// into a PostgREST filter (no injection / fragment-truncation).
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

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

// Verify the caller's Supabase token -> { id, email } (email powers the `test` send).
async function verifyUser(token: string | null): Promise<{ id: string; email: string } | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? { id: u.id, email: String(u.email ?? "") } : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One Resend send. Returns { ok, id?, error? } without leaking key/internal detail.
async function resendSend(payload: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await fetch(RESEND_API, {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok || (j?.error)) {
    const msg = typeof j?.error === "object" ? JSON.stringify(j.error) : String(j?.error ?? `http_${r.status}`);
    console.error("resend send failed:", r.status, msg.slice(0, 300));
    // Bubble up a short, safe reason (Resend's messages are user-actionable, e.g.
    // "domain not verified", "you can only send to your own email in test mode").
    return { ok: false, error: msg.slice(0, 200) };
  }
  return { ok: true, id: typeof j?.id === "string" ? j.id : undefined };
}

// ---- Custom sending domains (Resend Domains API). Each user's domain is created in the
// platform's single Resend account; only a *verified* one can be used as a From address. ----
// deno-lint-ignore no-explicit-any
async function resendApi(method: string, path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; j: any }> {
  const r = await fetch(`${RESEND_DOMAINS}${path}`, {
    method,
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
function mapStatus(s: string): string { return s === "verified" ? "verified" : (s === "failed" ? "failed" : "pending"); }
// deno-lint-ignore no-explicit-any
function normalizeRecords(records: any): Record<string, unknown>[] {
  if (!Array.isArray(records)) return [];
  return records.map((r) => ({
    record: r?.record, type: r?.type, name: r?.name, value: r?.value, ttl: r?.ttl, status: r?.status,
    ...(r?.priority != null ? { priority: r.priority } : {}),
  }));
}
async function getDomainRow(uid: string, domain: string): Promise<{ resend_id?: string; status?: string } | undefined> {
  const r = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=resend_id,status&limit=1`, { headers: sbHeaders });
  return (await r.json().catch(() => []))?.[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const user = await verifyUser(token);
  if (!user) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  // Config check is safe even when unset (used by the UI to show setup state).
  if (action === "status") {
    return json(req, { configured: !!RESEND_API_KEY, from: RESEND_FROM, test_only: RESEND_FROM.includes("onboarding@resend.dev") });
  }

  if (!RESEND_API_KEY) return json(req, { error: "resend_unset" }, 500);

  try {
    if (action === "test") {
      const to = String(body?.to || user.email || "").trim();
      if (!EMAIL_RE.test(to)) return json(req, { error: "no_test_recipient" }, 400);
      const res = await resendSend({
        from: RESEND_FROM,
        to: [to],
        subject: "Sendra is wired up ✅",
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
          <p>Nice — Sendra's built-in email sender is working.</p>
          <p style="color:#666">This was sent through Resend from <b>${RESEND_FROM.replace(/</g, "&lt;")}</b>.</p></div>`,
        text: "Sendra's built-in email sender is working — sent through Resend.",
      });
      return res.ok ? json(req, { ok: true, id: res.id, to }) : json(req, { ok: false, error: res.error }, 502);
    }

    if (action === "send") {
      const to = String(body?.to || "").trim();
      const subject = String(body?.subject || "");
      const html = body?.html != null ? String(body.html) : undefined;
      const text = body?.text != null ? String(body.text) : undefined;
      if (!EMAIL_RE.test(to)) return json(req, { error: "invalid_recipient" }, 400);
      if (!subject || (!html && !text)) return json(req, { error: "missing_content" }, 400);
      const res = await resendSend({
        from: String(body?.from || RESEND_FROM),
        to: [to],
        subject, html, text,
        ...(body?.replyTo ? { reply_to: String(body.replyTo) } : {}),
        ...(body?.headers && typeof body.headers === "object" ? { headers: body.headers } : {}),
      });
      return res.ok ? json(req, { ok: true, id: res.id }) : json(req, { ok: false, error: res.error }, 502);
    }

    // Batch — for campaigns. Resend's /emails/batch takes up to 100 messages.
    if (action === "batch") {
      const subject = String(body?.subject || "");
      const html = body?.html != null ? String(body.html) : undefined;
      const text = body?.text != null ? String(body.text) : undefined;
      const from = String(body?.from || RESEND_FROM);
      const recipients = Array.isArray(body?.recipients) ? body.recipients as Record<string, unknown>[] : [];
      if (!subject || (!html && !text)) return json(req, { error: "missing_content" }, 400);
      const valid = recipients
        .map((r) => ({ to: String(r?.to || "").trim(), html: r?.html != null ? String(r.html) : html, text: r?.text != null ? String(r.text) : text, headers: r?.headers }))
        .filter((r) => EMAIL_RE.test(r.to))
        .slice(0, 100);
      if (!valid.length) return json(req, { error: "no_recipients" }, 400);
      const r = await fetch(`${RESEND_API}/batch`, {
        method: "POST",
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(valid.map((v) => ({ from, to: [v.to], subject, html: v.html, text: v.text, ...(v.headers && typeof v.headers === "object" ? { headers: v.headers } : {}) }))),
      });
      const j = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (!r.ok || j?.error) {
        console.error("resend batch failed:", r.status, JSON.stringify(j?.error ?? j).slice(0, 300));
        return json(req, { ok: false, error: "batch_failed", sent: 0 }, 502);
      }
      const data = (j?.data as Record<string, unknown>[]) ?? [];
      return json(req, { ok: true, sent: valid.length, ids: data.map((d) => d?.id).filter(Boolean) });
    }

    // ---- Custom sending domains ----
    if (action === "domains") {
      const r = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${user.id}&select=domain,status,records,verified_at,created_at&order=created_at.desc`, { headers: sbHeaders });
      const domains = await r.json().catch(() => []);
      return json(req, { domains: Array.isArray(domains) ? domains : [] });
    }
    if (action === "domain_add") {
      const domain = String(body?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!HOST_RE.test(domain)) return json(req, { error: "bad_domain" }, 400);
      // Don't let an account claim a domain another account already verified.
      const ex = await fetch(`${SB_URL}/rest/v1/sending_domains?domain=eq.${domain}&status=eq.verified&select=user_id`, { headers: sbHeaders });
      const exRows = (await ex.json().catch(() => [])) as { user_id: string }[];
      if (Array.isArray(exRows) && exRows.some((x) => x.user_id !== user.id)) return json(req, { error: "domain_taken" }, 409);
      // Create it in Resend. If it already exists in our Resend account (e.g. the shared
      // sending domain), look it up and reuse it instead of failing.
      const created = await resendApi("POST", "", { name: domain });
      // deno-lint-ignore no-explicit-any
      let dom: any = created.j;
      if (!dom?.id) {
        const list = await resendApi("GET", "");
        // deno-lint-ignore no-explicit-any
        const found = Array.isArray(list.j?.data) ? list.j.data.find((d: any) => String(d?.name || "").toLowerCase() === domain) : null;
        if (found?.id) { const got = await resendApi("GET", `/${encodeURIComponent(found.id)}`); dom = got.ok ? got.j : found; }
      }
      if (!dom?.id) {
        console.error("domain_add failed:", domain, "status", created.status, JSON.stringify(created.j).slice(0, 400));
        return json(req, { error: "resend_failed", detail: String(created.j?.message ?? created.j?.name ?? "error").slice(0, 200) }, 502);
      }
      const status = mapStatus(String(dom.status || "pending"));
      const records = normalizeRecords(dom.records);
      await fetch(`${SB_URL}/rest/v1/sending_domains?on_conflict=user_id,domain`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: user.id, domain, resend_id: dom.id, status, records, ...(status === "verified" ? { verified_at: new Date().toISOString() } : {}) }),
      });
      return json(req, { domain, status, records });
    }
    if (action === "domain_verify") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!HOST_RE.test(domain)) return json(req, { error: "bad_domain" }, 400);
      const row = await getDomainRow(user.id, domain);
      if (!row?.resend_id) return json(req, { error: "not_found" }, 404);
      const rid = encodeURIComponent(row.resend_id);
      await resendApi("POST", `/${rid}/verify`);            // trigger a re-check
      const { ok, j } = await resendApi("GET", `/${rid}`);  // read fresh status + records
      if (!ok) return json(req, { error: "resend_failed" }, 502);
      const status = mapStatus(String(j.status || "pending"));
      const records = normalizeRecords(j.records);
      await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${user.id}&domain=eq.${domain}`, {
        method: "PATCH", headers: sbHeaders,
        body: JSON.stringify({ status, records, ...(status === "verified" ? { verified_at: new Date().toISOString() } : {}) }),
      });
      return json(req, { domain, status, records });
    }
    if (action === "domain_remove") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      if (!HOST_RE.test(domain)) return json(req, { error: "bad_domain" }, 400);
      const row = await getDomainRow(user.id, domain);
      if (row?.resend_id) { try { await resendApi("DELETE", `/${encodeURIComponent(row.resend_id)}`); } catch { /* ignore */ } }
      await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${user.id}&domain=eq.${domain}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    // One-click auto-configure for Cloudflare: the user supplies a scoped API token
    // (used ONCE here, never stored or logged), and we write the domain's Resend DNS
    // records straight into their Cloudflare zone. { domain, token } -> { ok, created, skipped }.
    if (action === "cf_apply") {
      const domain = String(body?.domain || "").trim().toLowerCase();
      const cfToken = String(body?.token || "").trim();
      if (!HOST_RE.test(domain)) return json(req, { error: "bad_domain" }, 400);
      if (!cfToken) return json(req, { error: "missing_token" }, 400);
      const dRes = await fetch(`${SB_URL}/rest/v1/sending_domains?user_id=eq.${user.id}&domain=eq.${domain}&select=records`, { headers: sbHeaders });
      const row = (await dRes.json().catch(() => []))?.[0] as { records?: Array<{ type: string; name: string; value: string; priority?: number }> } | undefined;
      const records = row?.records || [];
      if (!records.length) return json(req, { error: "not_found" }, 404);
      const cf = (path: string, init?: RequestInit): Promise<Response> =>
        fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${cfToken}`, "content-type": "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(10000) });
      let zoneId = "";
      try {
        const zr = await cf(`/zones?name=${encodeURIComponent(domain)}`);
        // deno-lint-ignore no-explicit-any
        const zj = await zr.json().catch(() => ({})) as any;
        if (!zr.ok || zj?.success !== true) return json(req, { error: "cf_auth" }, 502);
        zoneId = zj?.result?.[0]?.id || "";
      } catch { return json(req, { error: "cf_failed" }, 502); }
      if (!zoneId) return json(req, { error: "zone_not_found" }, 404);
      let created = 0, skipped = 0, failed = 0;
      for (const rec of records) {
        try {
          const cr = await cf(`/zones/${zoneId}/dns_records`, {
            method: "POST",
            body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.value, ttl: 3600, proxied: false, ...(rec.type === "MX" && rec.priority != null ? { priority: rec.priority } : {}) }),
          });
          // deno-lint-ignore no-explicit-any
          const cj = await cr.json().catch(() => ({})) as any;
          if (cr.ok && cj?.success === true) created++;
          else if (/already exists|81053|81057|81058/i.test(JSON.stringify(cj?.errors || ""))) skipped++;
          else failed++;
        } catch { failed++; }
      }
      if (created + skipped === 0) return json(req, { error: "write_failed" }, 502);
      return json(req, { ok: true, created, skipped, failed });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("resend error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
