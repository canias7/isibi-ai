import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// mailer — control plane for the multi-tenant self-hosted email sender.
//
// A user adds their OWN domain; we generate that domain's DKIM keypair, hand back
// the DNS records to publish (DKIM + an SPF include of our infra + DMARC), and
// verify them. Their domain becomes a verified "From" identity; the mail server
// (mail.gofarther.dev) signs each message with that domain's key, so DKIM aligns
// and DMARC passes — the standard ESP model.
//
// Server-independent today: domain_add / domain_records / domain_verify /
// domain_list / domain_remove all work with NO mail server running. `send` is a
// stub until the production server (mail.gofarther.dev) exposes a submission path
// + the per-domain keys are synced into its OpenDKIM (see TODO in `send`).
//
// Called via supabase.functions.invoke('mailer', { body: { action, ... } }).

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Sending infrastructure identity (the `gofarther.dev` side). Customers point at
// these; we manage our IPs in ONE place (`_spf.gofarther.dev`) so their records
// never change when we add/rotate sending IPs. Overridable via env.
const SPF_INCLUDE = Deno.env.get("MAILER_SPF_INCLUDE") ?? "_spf.gofarther.dev";
const DMARC_RUA = Deno.env.get("MAILER_DMARC_RUA") ?? "mailto:dmarc@gofarther.dev";

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost",
  "http://localhost", "https://localhost",
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
  } catch { return null; }
}

// --- tiny PostgREST helper (service role; bypasses RLS) ---
async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;
function cleanDomain(d: unknown): string | null {
  const s = String(d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}

// --- DKIM keypair (RSA-2048) via WebCrypto; returns the public "p=" + private PEM ---
function b64(u: Uint8Array): string { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); }
async function generateDkim(): Promise<{ publicValue: string; privatePem: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${(b64(pkcs8).match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----`;
  return { publicValue: b64(spki), privatePem: pem };
}

// The DNS records a customer must publish for `domain`.
function recordsFor(domain: string, selector: string, dkimPublic: string) {
  return [
    { type: "TXT", name: `${selector}._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=${dkimPublic}`, purpose: "DKIM" },
    { type: "TXT", name: domain, value: `v=spf1 include:${SPF_INCLUDE} -all`, purpose: "SPF" },
    { type: "TXT", name: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=${DMARC_RUA}`, purpose: "DMARC" },
  ];
}

// Resolve TXT records via DNS-over-HTTPS (so verification works from the edge).
async function dnsTxt(name: string): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" } });
    const j = await r.json();
    return (j.Answer ?? []).map((a: { data?: string }) => String(a.data ?? "").replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
  } catch { return []; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  try {
    switch (action) {
      // Add a domain: generate DKIM, store it, return the DNS records to publish.
      case "domain_add": {
        const domain = cleanDomain(body?.domain);
        if (!domain) return json(req, { error: "enter a valid domain (e.g. acme.com)" }, 400);
        const selector = "s1";
        const { publicValue, privatePem } = await generateDkim();
        const ins = await db("sending_domains", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ user_id: uid, domain, dkim_selector: selector, dkim_public: publicValue }),
        });
        if (ins.status === 409) return json(req, { error: "you've already added that domain" }, 409);
        if (!ins.ok) return json(req, { error: "couldn't save the domain" }, 502);
        const row = (await ins.json())[0];
        const keyRes = await db("sending_domain_keys", { method: "POST", body: JSON.stringify({ domain_id: row.id, private_pem: privatePem }) });
        if (!keyRes.ok) { await db(`sending_domains?id=eq.${row.id}`, { method: "DELETE" }); return json(req, { error: "couldn't store the signing key" }, 502); }
        return json(req, { domain, verified: false, records: recordsFor(domain, selector, publicValue) });
      }

      // Re-fetch the records for a domain the user already added.
      case "domain_records": {
        const domain = cleanDomain(body?.domain);
        if (!domain) return json(req, { error: "invalid domain" }, 400);
        const r = await db(`sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=dkim_selector,dkim_public,verified`);
        const rows = r.ok ? await r.json() : [];
        if (!rows.length) return json(req, { error: "domain not found" }, 404);
        return json(req, { domain, verified: rows[0].verified, records: recordsFor(domain, rows[0].dkim_selector, rows[0].dkim_public) });
      }

      // Check DNS: is the DKIM key + SPF include actually published?
      case "domain_verify": {
        const domain = cleanDomain(body?.domain);
        if (!domain) return json(req, { error: "invalid domain" }, 400);
        const r = await db(`sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=id,dkim_selector,dkim_public`);
        const rows = r.ok ? await r.json() : [];
        if (!rows.length) return json(req, { error: "domain not found" }, 404);
        const { id, dkim_selector, dkim_public } = rows[0];
        const [dkimTxt, spfTxt] = await Promise.all([dnsTxt(`${dkim_selector}._domainkey.${domain}`), dnsTxt(domain)]);
        const dkimOk = dkimTxt.some((t) => t.replace(/\s+/g, "").includes(`p=${dkim_public}`.replace(/\s+/g, "")));
        const spfOk = spfTxt.some((t) => /v=spf1/i.test(t) && t.toLowerCase().includes(`include:${SPF_INCLUDE}`));
        const verified = dkimOk && spfOk;
        await db(`sending_domains?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ verified, verified_at: verified ? new Date().toISOString() : null }) });
        return json(req, { domain, verified, checks: { dkim: dkimOk, spf: spfOk } });
      }

      case "domain_list": {
        const r = await db(`sending_domains?user_id=eq.${uid}&select=domain,verified,verified_at,created_at&order=created_at.desc`);
        return json(req, { domains: r.ok ? await r.json() : [] });
      }

      case "domain_remove": {
        const domain = cleanDomain(body?.domain);
        if (!domain) return json(req, { error: "invalid domain" }, 400);
        await db(`sending_domains?user_id=eq.${uid}&domain=eq.${domain}`, { method: "DELETE" });
        return json(req, { ok: true });
      }

      // Send from a verified domain. STUB until the production mail server is wired.
      // TODO: once mail.gofarther.dev is up — (1) sync each verified domain's
      // private key into the server's OpenDKIM, (2) relay the message here via the
      // server's submission path (authenticated SMTP 587, or an HTTP send API),
      // (3) check the suppression list before sending.
      case "send": {
        const domain = cleanDomain(body?.from_domain);
        if (!domain) return json(req, { error: "invalid from_domain" }, 400);
        const r = await db(`sending_domains?user_id=eq.${uid}&domain=eq.${domain}&select=verified`);
        const rows = r.ok ? await r.json() : [];
        if (!rows.length) return json(req, { error: "domain not found" }, 404);
        if (!rows[0].verified) return json(req, { error: "verify the domain's DNS before sending" }, 400);
        return json(req, { error: "sending engine not connected yet — wire mail.gofarther.dev (TODO)" }, 501);
      }

      default:
        return json(req, { error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("mailer error:", action, e);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});
