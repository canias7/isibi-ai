import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ImapFlow } from "npm:imapflow@1.0.171";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Self-hosted IMAP/SMTP mailboxes — the "other email providers" beyond Gmail/
// Outlook (iCloud, Yahoo, Fastmail, Zoho, AOL, GMX, or any custom server). The
// user connects with their email + an app-specific password; we verify it, store
// it AES-GCM-encrypted (never sent back to the client), read via IMAP (ImapFlow)
// and send via SMTP (denomailer). Caller is server-verified (Supabase token).
//
// POST { action, ... } (via supabase.functions.invoke):
//   connect   { email, password, imapHost?, imapPort?, smtpHost?, smtpPort? } -> { ok, email, provider }
//   status                                  -> { accounts: [{ email, provider }] }
//   inbox     { email?, max? }              -> { items }
//   send      { email?, to, subject, text?, html? } -> { ok }
//   disconnect { email }                    -> { ok }
//
// Secrets: IMAP_ENC_KEY (64 hex chars = 32 bytes, AES-GCM).

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

// Known providers: domain -> server config. "Other" passes hosts explicitly.
type Srv = { provider: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number };
const ICLOUD: Srv = { provider: "icloud", imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587 };
const YAHOO: Srv = { provider: "yahoo", imap_host: "imap.mail.yahoo.com", imap_port: 993, smtp_host: "smtp.mail.yahoo.com", smtp_port: 465 };
const PRESETS: Record<string, Srv> = {
  "icloud.com": ICLOUD, "me.com": ICLOUD, "mac.com": ICLOUD,
  "yahoo.com": YAHOO, "yahoo.co.uk": YAHOO, "ymail.com": YAHOO, "rocketmail.com": YAHOO,
  "aol.com": { provider: "aol", imap_host: "imap.aol.com", imap_port: 993, smtp_host: "smtp.aol.com", smtp_port: 465 },
  "fastmail.com": { provider: "fastmail", imap_host: "imap.fastmail.com", imap_port: 993, smtp_host: "smtp.fastmail.com", smtp_port: 465 },
  "zoho.com": { provider: "zoho", imap_host: "imap.zoho.com", imap_port: 993, smtp_host: "smtp.zoho.com", smtp_port: 465 },
  "zohomail.com": { provider: "zoho", imap_host: "imap.zoho.com", imap_port: 993, smtp_host: "smtp.zoho.com", smtp_port: 465 },
  "gmx.com": { provider: "gmx", imap_host: "imap.gmx.com", imap_port: 993, smtp_host: "mail.gmx.com", smtp_port: 465 },
  "gmx.net": { provider: "gmx", imap_host: "imap.gmx.net", imap_port: 993, smtp_host: "mail.gmx.net", smtp_port: 587 },
  "web.de": { provider: "web", imap_host: "imap.web.de", imap_port: 993, smtp_host: "smtp.web.de", smtp_port: 587 },
};

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

// ---- app-password encryption at rest (AES-GCM), stored "enc:<iv>:<ct>" ----
function b64(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function b64ToBytes(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function encKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("IMAP_ENC_KEY");
  if (!raw || raw.length < 64) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function enc(plain: string): Promise<string> {
  const key = await encKey();
  if (!key) throw new Error("ENC_KEY_MISSING");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `enc:${b64(iv)}:${b64(ct)}`;
}
async function dec(stored: string): Promise<string> {
  const key = await encKey();
  if (!key) throw new Error("ENC_KEY_MISSING");
  const [, ivb, ctb] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivb) }, key, b64ToBytes(ctb));
  return new TextDecoder().decode(pt);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function domainOf(email: string): string { const i = email.lastIndexOf("@"); return i === -1 ? "" : email.slice(i + 1).toLowerCase(); }

interface Acct { email: string; provider: string | null; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number; enc_password: string }
async function getAcct(uid: string, email?: string): Promise<Acct | null> {
  const q = email ? `&email=eq.${encodeURIComponent(email)}` : "&order=created_at.asc&limit=1";
  const r = await fetch(`${SB_URL}/rest/v1/imap_accounts?user_id=eq.${uid}${q}&select=email,provider,imap_host,imap_port,smtp_host,smtp_port,enc_password`, { headers: sbHeaders });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// deno-lint-ignore no-explicit-any
async function newImap(a: { imap_host: string; imap_port: number; email: string; pass: string }): Promise<any> {
  const client = new ImapFlow({ host: a.imap_host, port: a.imap_port, secure: true, auth: { user: a.email, pass: a.pass }, logger: false });
  await client.connect();
  return client;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action || "");

  if (action === "status") {
    const r = await fetch(`${SB_URL}/rest/v1/imap_accounts?user_id=eq.${uid}&select=email,provider&order=created_at.asc`, { headers: sbHeaders });
    const accounts = await r.json().catch(() => []);
    return json(req, { accounts: Array.isArray(accounts) ? accounts : [] });
  }

  if (!(await encKey())) return json(req, { error: "imap_unset" }, 500);

  try {
    if (action === "connect") {
      const email = String(body?.email || "").trim().toLowerCase();
      const password = String(body?.password || "");
      if (!EMAIL_RE.test(email) || !password) return json(req, { error: "missing_params" }, 400);
      // Resolve servers: explicit overrides win, else a known preset, else require manual.
      const preset = PRESETS[domainOf(email)];
      const imap_host = String(body?.imapHost || preset?.imap_host || "");
      const smtp_host = String(body?.smtpHost || preset?.smtp_host || "");
      if (!imap_host || !smtp_host) return json(req, { error: "need_servers" }, 400);
      const imap_port = Number(body?.imapPort || preset?.imap_port || 993);
      const smtp_port = Number(body?.smtpPort || preset?.smtp_port || 465);
      const provider = String(body?.provider || preset?.provider || "other"); // tile id, so per-tile status matches

      // Verify the credentials by actually logging in over IMAP.
      try {
        const client = await newImap({ imap_host, imap_port, email, pass: password });
        await client.logout();
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (/auth|login|credential|invalid|AUTHENTICATIONFAILED/i.test(msg)) return json(req, { error: "bad_credentials" }, 400);
        return json(req, { error: "connect_failed", detail: msg.slice(0, 160) }, 502);
      }

      const ok = await fetch(`${SB_URL}/rest/v1/imap_accounts?on_conflict=user_id,email`, {
        method: "POST",
        headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: uid, email, provider, imap_host, imap_port, smtp_host, smtp_port, enc_password: await enc(password), updated_at: new Date().toISOString() }),
      });
      if (!ok.ok) return json(req, { error: "save_failed" }, 502);
      return json(req, { ok: true, email, provider });
    }

    if (action === "inbox") {
      const acct = await getAcct(uid, body?.email ? String(body.email) : undefined);
      if (!acct) return json(req, { error: "not_connected" }, 409);
      const max = Math.min(Math.max(Number(body?.max || 25), 1), 50);
      const pass = await dec(acct.enc_password);
      const client = await newImap({ imap_host: acct.imap_host, imap_port: acct.imap_port, email: acct.email, pass });
      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      try {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const total = client.mailbox?.exists ?? 0;
          if (total > 0) {
            const start = Math.max(1, total - max + 1);
            for await (const msg of client.fetch(`${start}:${total}`, { envelope: true, flags: true })) {
              const env = msg.envelope ?? {};
              const fromObj = (env.from && env.from[0]) || {};
              const date: Date | undefined = env.date;
              const ms = date instanceof Date ? date.getTime() : Date.parse(String(date ?? ""));
              const seen = msg.flags instanceof Set ? msg.flags.has("\\Seen") : false;
              items.push({
                from: String(fromObj.name || fromObj.address || "Unknown"),
                email: String(fromObj.address || ""),
                subject: String(env.subject || "(no subject)"),
                snippet: "",
                unread: !seen,
                id: String(msg.uid ?? ""),
                threadId: "",
                ts: Number.isFinite(ms) ? ms : 0,
                app: "imap",
              });
            }
          }
        } finally { lock.release(); }
      } finally { try { await client.logout(); } catch { /* ignore */ } }
      items.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first
      // Format a short time label now (client tz unknown server-side; ISO-ish).
      for (const it of items) {
        const d = new Date(it.ts);
        it.time = it.ts && !isNaN(d.getTime())
          ? (d.toDateString() === new Date().toDateString()
            ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }))
          : "";
      }
      return json(req, { items });
    }

    if (action === "send") {
      const acct = await getAcct(uid, body?.email ? String(body.email) : undefined);
      if (!acct) return json(req, { error: "not_connected" }, 409);
      const to = String(body?.to || "").trim();
      const subject = String(body?.subject || "");
      const text = body?.text != null ? String(body.text) : undefined;
      const html = body?.html != null ? String(body.html) : undefined;
      if (!EMAIL_RE.test(to)) return json(req, { error: "invalid_recipient" }, 400);
      if (!subject || (!text && !html)) return json(req, { error: "missing_content" }, 400);
      const pass = await dec(acct.enc_password);
      const smtp = new SMTPClient({
        connection: { hostname: acct.smtp_host, port: acct.smtp_port, tls: acct.smtp_port === 465, auth: { username: acct.email, password: pass } },
      });
      try {
        await smtp.send({ from: acct.email, to, subject, content: text ?? " ", ...(html ? { html } : {}) });
      } finally { try { await smtp.close(); } catch { /* ignore */ } }
      return json(req, { ok: true });
    }

    if (action === "disconnect") {
      const email = String(body?.email || "").trim().toLowerCase();
      if (email) await fetch(`${SB_URL}/rest/v1/imap_accounts?user_id=eq.${uid}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: sbHeaders });
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("imap error:", action, String((e as Error)?.message || e));
    return json(req, { error: "request_failed" }, 502);
  }
});
