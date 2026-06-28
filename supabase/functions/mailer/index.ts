import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// mailer — control plane for the multi-tenant self-hosted email sender.
//
// A user adds their OWN domain; we generate that domain's DKIM keypair, hand back
// the DNS records to publish (DKIM + an SPF include of our infra + DMARC), and
// verify them. Their domain becomes a verified "From" identity; the mail server
// (mail.gofarther.dev) signs each message with that domain's key, so DKIM aligns
// and DMARC passes — the standard ESP model.
//
// Two callers:
//   1. The APP (user JWT): domain_add / domain_records / domain_verify /
//      domain_list / domain_remove / send. These need a logged-in user.
//   2. The BOX (relay token): keysync_export. The production mail server pulls
//      every verified domain's private DKIM key so OpenDKIM can sign for it.
//      Authenticated by MAILER_RELAY_TOKEN — never a user JWT — so this is the
//      ONLY way a private key leaves the database, and only our own infra holds
//      the token. (Function is deployed verify_jwt=false; auth is enforced here.)
//
// `send` relays the message to the box's HTTPS relay (MAILER_RELAY_URL); until
// that's configured it returns a clear 503 so the onboarding half keeps working.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Sending infrastructure identity (the `gofarther.dev` side). Customers point at
// these; we manage our IPs in ONE place (`_spf.gofarther.dev`) so their records
// never change when we add/rotate sending IPs. Overridable via env.
const SPF_INCLUDE = Deno.env.get("MAILER_SPF_INCLUDE") ?? "_spf.gofarther.dev";
const DMARC_RUA = Deno.env.get("MAILER_DMARC_RUA") ?? "mailto:dmarc@gofarther.dev";

// The production mail server's HTTPS relay (e.g. https://relay.gofarther.dev) and
// the shared secret both it and `keysync_export` authenticate with. Unset until
// the box is up — `send` then returns 503 instead of pretending to send.
const RELAY_URL = (Deno.env.get("MAILER_RELAY_URL") ?? "").replace(/\/+$/, "");
const RELAY_TOKEN = Deno.env.get("MAILER_RELAY_TOKEN") ?? "";

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

// Constant-time-ish compare so the relay token can't be probed by timing.
function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

// Parse a From/To value into its parts. Accepts "Name <a@b.com>", "a@b.com", or a
// bare domain "b.com" (→ no-reply@b.com). Returns null if there's no usable domain.
const EMAIL_RE = /^[^\s@]+@([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;
function parseAddr(input: unknown, defaultLocal = "no-reply"): { display: string; email: string; domain: string } | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)<([^>]+)>\s*$/);
  let display = "";
  let email = raw;
  if (m) { display = m[1].trim().replace(/^"|"$/g, ""); email = m[2].trim(); }
  if (!email.includes("@")) {
    const dom = cleanDomain(email);
    if (!dom) return null;
    email = `${defaultLocal}@${dom}`;
  }
  email = email.toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return { display, email, domain: email.slice(email.lastIndexOf("@") + 1) };
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Outbound webhook fanout (sent/failed for transactional sends) ------------
// Same signing as the `webhooks` fn so receivers verify these like any other event.
// Best-effort + backgrounded so a send's response never waits on customer endpoints.
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
    const r = await db(`webhook_endpoints?user_id=eq.${uid}&enabled=eq.true&select=id,url,secret,events`);
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
    try { await db(`webhook_endpoints?id=eq.${ep.id}`, { method: "PATCH", body: JSON.stringify(ok ? { last_status: status, last_event_at: new Date().toISOString(), failure_count: 0 } : { last_status: status, last_event_at: new Date().toISOString() }) }); } catch { /* ignore */ }
  }));
}
function bg(tasks: Promise<unknown>[]): void {
  if (!tasks.length) return;
  const all = Promise.allSettled(tasks);
  const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  if (typeof wu === "function") wu(all); else all.catch(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  // --- Machine path: the box authenticates with the relay token (NOT a user JWT) ---
  const isRelay = !!RELAY_TOKEN && !!token && tokenEq(token, RELAY_TOKEN);
  if (action === "keysync_export") {
    if (!isRelay) return json(req, { error: "unauthorized" }, 401);
    // Every verified domain + its private key + selector, for the server's OpenDKIM.
    const r = await db("sending_domains?verified=eq.true&select=domain,dkim_selector,sending_domain_keys(private_pem)");
    if (!r.ok) return json(req, { error: "export_failed" }, 502);
    const rows = await r.json();
    const keys = (rows as Array<{ domain: string; dkim_selector: string; sending_domain_keys?: { private_pem: string } | { private_pem: string }[] }>)
      .map((row) => {
        const k = Array.isArray(row.sending_domain_keys) ? row.sending_domain_keys[0] : row.sending_domain_keys;
        return k?.private_pem ? { domain: row.domain, selector: row.dkim_selector, private_pem: k.private_pem } : null;
      })
      .filter(Boolean);
    return json(req, { keys });
  }

  // --- User path: everything else needs a logged-in user ---
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

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

      // Send from a verified domain via the box's HTTPS relay (OpenDKIM signs there).
      case "send": {
        const from = parseAddr(body?.from);
        if (!from) return json(req, { error: "invalid from address" }, 400);
        const to = parseAddr(body?.to);
        if (!to) return json(req, { error: "invalid to address" }, 400);
        const subject = String(body?.subject ?? "").trim();
        if (!subject) return json(req, { error: "subject is required" }, 400);
        const html = typeof body?.html === "string" ? body.html : undefined;
        const text = typeof body?.text === "string" ? body.text : undefined;
        if (!html && !text) return json(req, { error: "provide html or text" }, 400);
        const replyTo = body?.reply_to ? parseAddr(body.reply_to)?.email : undefined;
        const idem = body?.idempotency_key ? String(body.idempotency_key).slice(0, 255).trim() : null;

        // The From domain must be one the user owns AND has verified.
        const r = await db(`sending_domains?user_id=eq.${uid}&domain=eq.${from.domain}&select=verified`);
        const rows = r.ok ? await r.json() : [];
        if (!rows.length) return json(req, { error: "you haven't added that From domain" }, 404);
        if (!rows[0].verified) return json(req, { error: "verify the From domain's DNS before sending" }, 400);

        // Respect the per-user suppression list (unsubscribes, bounces, complaints).
        const sup = await db(`email_suppressions?user_id=eq.${uid}&email=eq.${encodeURIComponent(to.email)}&select=reason`);
        const supRows = sup.ok ? await sup.json() : [];
        if (supRows.length) return json(req, { error: `recipient is suppressed (${supRows[0].reason})` }, 409);

        if (!RELAY_URL || !RELAY_TOKEN) {
          return json(req, { error: "sending isn't live yet — the mail server relay isn't configured" }, 503);
        }

        // Idempotency: if this key was already used, return the prior result — don't re-send.
        if (idem) {
          const ex = await db(`messages?user_id=eq.${uid}&idempotency_key=eq.${encodeURIComponent(idem)}&select=provider_msg_id,status,error&limit=1`);
          const exRows = ex.ok ? await ex.json() : [];
          if (exRows.length) {
            const m = exRows[0];
            return m.status === "failed"
              ? json(req, { error: m.error || "previous attempt failed", idempotent: true })
              : json(req, { id: m.provider_msg_id ?? null, idempotent: true });
          }
        }
        // Record each send outcome in the transactional message log (status updated later
        // by mail-events when the box reports delivered/bounced/complained).
        const logMessage = async (status: string, providerMsgId: string | null, errorMsg: string | null) => {
          try {
            await db("messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
              user_id: uid, to_email: to.email, from_email: from.email, subject: subject.slice(0, 300),
              status, provider_msg_id: providerMsgId, error: errorMsg ? errorMsg.slice(0, 300) : null,
              idempotency_key: idem, sent_at: status === "sent" ? new Date().toISOString() : null,
            }) });
          } catch { /* best effort */ }
        };

        const eps = await getEndpoints(uid);   // webhook endpoints (empty unless the user set any up)

        // Relay to the box (builds the MIME, injects into Postfix; OpenDKIM signs).
        // Short retry on a TRANSIENT failure (box blip / 5xx / network); a 4xx is a
        // permanent client error and isn't retried.
        let lastErr = "couldn't reach the mail server";
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12000);
          try {
            const relayRes = await fetch(`${RELAY_URL}/send`, {
              method: "POST",
              signal: ctrl.signal,
              headers: { authorization: `Bearer ${RELAY_TOKEN}`, "content-type": "application/json" },
              body: JSON.stringify({
                from: from.display ? `${from.display} <${from.email}>` : from.email,
                to: to.display ? `${to.display} <${to.email}>` : to.email,
                subject, html, text, reply_to: replyTo,
              }),
            });
            const out = await relayRes.json().catch(() => ({}));
            if (relayRes.ok) {
              const mid = out?.id ? String(out.id).replace(/[<>]/g, "") : null;   // store sans <> so mail-events can map box events
              await logMessage("sent", mid, null);
              bg([deliverEvent(eps, "sent", { email: to.email, from: from.email, subject, ...(mid ? { message_id: mid } : {}) })]);
              return json(req, { id: out?.id ?? null });
            }
            if (relayRes.status >= 400 && relayRes.status < 500) {   // permanent — don't retry
              const errMsg = String(out?.error || `relay_${relayRes.status}`).slice(0, 300);
              await logMessage("failed", null, errMsg);
              bg([deliverEvent(eps, "failed", { email: to.email, from: from.email, subject, error: errMsg })]);
              return json(req, { error: out?.error || "the mail server rejected the message" }, 502);
            }
            lastErr = String(out?.error || `relay_${relayRes.status}`);   // 5xx — retry
          } catch (_e) {
            lastErr = "unreachable";   // network / timeout — retry
          } finally {
            clearTimeout(timer);
          }
        }
        await logMessage("failed", null, lastErr);
        bg([deliverEvent(eps, "failed", { email: to.email, from: from.email, subject, error: lastErr.slice(0, 300) })]);
        return json(req, { error: "couldn't reach the mail server" }, 502);
      }

      // Transactional activity log — the user's recent mailer.send messages + status.
      case "messages": {
        const r = await db(`messages?user_id=eq.${uid}&select=id,to_email,from_email,subject,status,error,provider_msg_id,created_at,sent_at,delivered_at&order=created_at.desc&limit=100`);
        return json(req, { messages: r.ok ? await r.json() : [] });
      }

      default:
        return json(req, { error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("mailer error:", action, e);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});
