import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// MTKruto MUST be a STATIC top-level import. Supabase bundles an edge function's
// dependency graph into an eszip at deploy time by statically analyzing imports;
// a dynamic `import(variableUrl)` is NOT followed, so the module is missing at
// runtime ("Module not found") and every MTProto call 502s. Pinned to a current
// release — the 0.1.x line's transitive deps no longer resolve on the runtime.
import * as MTK from "https://deno.land/x/mtkruto@0.161.0/mod.ts";

// Telegram connector — our OWN auth via Telegram's MTProto Client API (NOT
// Composio). Mirrors how `plaid` is a standalone connector special-cased in the
// connectors page. The user signs in with phone -> login code -> optional 2FA
// password; we hold the resulting session string AES-GCM-encrypted at rest
// (never sent to the client), scoped to the Supabase uid so a client can only
// ever act as themselves. MTProto runs in-process via MTKruto.
//
// MTKruto 0.161 TL API: invoke takes a plain object discriminated by `_`, e.g.
// client.invoke({ _: "auth.sendCode", ... }) — there is no functions.*/types.*
// constructor namespace anymore. checkPassword(password, accountPassword) is a
// top-level export that returns the InputCheckPasswordSRP for auth.checkPassword.
//
// Actions (POST { action, ... }, invoked via supabase.functions.invoke):
//   start          { phone }                -> { loginToken }           (sends the code)
//   verify         { loginToken, code }     -> { ok } | { needPassword, loginToken }
//   verifyPassword { loginToken, password } -> { ok }
//   status                                  -> { connected, phone? }
//   chats          { limit? }               -> { chats }
//   messages       { chatId, limit? }       -> { messages }
//   send           { chatId, text }         -> { ok }
//   disconnect                              -> { ok }
//
// Secrets: TELEGRAM_API_ID, TELEGRAM_API_HASH (from my.telegram.org),
//          TELEGRAM_SESSION_KEY (64 hex chars = 32 bytes, AES-GCM).

const API_ID = Number(Deno.env.get("TELEGRAM_API_ID") || "0");
const API_HASH = Deno.env.get("TELEGRAM_API_HASH") || "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

// MTKruto's surface is typed; we drive it dynamically, so alias to `any` once.
// deno-lint-ignore no-explicit-any
const M: any = MTK;

// ---- CORS ----
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

// ---- auth: verify the caller's Supabase token server-side, return their uid ----
async function verifyUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// ---- session-string encryption at rest (AES-GCM), stored as "enc:<iv>:<ct>" ----
function b64(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function b64ToBytes(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function encKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("TELEGRAM_SESSION_KEY");
  if (!raw || raw.length < 64) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function enc(plain: string): Promise<string> {
  const key = await encKey();
  if (!key) throw new Error("ENC_KEY_MISSING"); // a Telegram session is full account access — never store it in cleartext
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

// ---- stored session rows (service role; RLS has no client policies, so the row
// is never reachable from the client — only this function can touch it) ----
async function getSession(uid: string): Promise<{ enc_session: string; phone: string | null } | null> {
  const r = await fetch(`${SB_URL}/rest/v1/telegram_sessions?user_id=eq.${encodeURIComponent(uid)}&select=enc_session,phone`, { headers: sbHeaders });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function saveSession(uid: string, encSession: string, phone: string, tgUserId: string | null): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/telegram_sessions?on_conflict=user_id`, {
    method: "POST",
    headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, enc_session: encSession, phone, tg_user_id: tgUserId, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}
async function deleteSession(uid: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/telegram_sessions?user_id=eq.${encodeURIComponent(uid)}`, { method: "DELETE", headers: sbHeaders });
}

// ---- MTKruto client ----
// Build a connected client. With an authString it RESUMES the existing auth key
// (no re-handshake); without one it does a fresh MTProto handshake.
// deno-lint-ignore no-explicit-any
async function newClient(authString?: string): Promise<any> {
  const client = new M.Client({ storage: new M.StorageMemory(), apiId: API_ID, apiHash: API_HASH });
  if (authString) await client.importAuthString(authString);
  await client.connect();
  return client;
}
// MTKruto TelegramError stringifies as "<code>: <ERROR_MESSAGE> (<call>)" and
// also exposes the bare code on .errorMessage — match against both.
// deno-lint-ignore no-explicit-any
function errOf(e: any): string { return String(e?.errorMessage || e?.message || e); }
// JSON-safe: Telegram ids can be bigint.
function safe<T>(o: T): T { return JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? Number(v) : v))); }
// Coerce a numeric-string chatId back to a number (MTKruto chat ids); leave
// usernames as-is.
function asChatId(v: unknown): number | string {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  if (!API_ID || !API_HASH) return J({ error: "telegram_unset" }, 500);

  const uid = await verifyUser(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* some actions take no body */ }
  const action = String(body?.action || "");

  // status is hot (the connectors page polls it) and needs no MTProto — answer
  // without touching the client.
  if (action === "status") {
    const s = await getSession(uid);
    return J({ connected: !!s, phone: s?.phone ?? null });
  }

  try {
    // ---- sign-in flow (no stored session yet) ----
    if (action === "start") {
      const phone = String(body?.phone || "").trim();
      if (!phone) return J({ error: "missing phone" }, 400);
      const client = await newClient();
      try {
        const sent = await client.invoke({
          _: "auth.sendCode",
          phone_number: phone, api_id: API_ID, api_hash: API_HASH,
          settings: { _: "codeSettings" },
        });
        const phoneCodeHash = sent?.phone_code_hash;
        if (!phoneCodeHash) return J({ error: "send_code_failed" }, 502);
        // Carry the half-finished session (auth key + DC) + the code hash to the
        // verify step, encrypted, so the client only ever holds an opaque blob.
        const loginToken = await enc(JSON.stringify({ authString: await client.exportAuthString(), phoneCodeHash, phone }));
        return J({ loginToken });
      } catch (e) {
        const msg = errOf(e);
        // App-level outcomes -> HTTP 200 { error }: supabase-js hides non-2xx
        // bodies, so a 4xx would reach the client as a generic failure.
        if (/PHONE_NUMBER_INVALID/i.test(msg)) return J({ error: "bad_phone" });
        if (/PHONE_NUMBER_BANNED/i.test(msg)) return J({ error: "phone_banned" });
        throw e;
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    if (action === "verify") {
      const loginToken = String(body?.loginToken || "");
      const code = String(body?.code || "").trim();
      if (!loginToken || !code) return J({ error: "missing params" }, 400);
      const { authString, phoneCodeHash, phone } = JSON.parse(await dec(loginToken));
      const client = await newClient(authString);
      try {
        try {
          await client.invoke({ _: "auth.signIn", phone_number: phone, phone_code_hash: phoneCodeHash, phone_code: code });
        } catch (e) {
          const msg = errOf(e);
          if (/SESSION_PASSWORD_NEEDED/i.test(msg)) {
            // 2FA on — hand back a resumable token for verifyPassword.
            const again = await enc(JSON.stringify({ authString: await client.exportAuthString(), phone }));
            return J({ needPassword: true, loginToken: again });
          }
          if (/PHONE_CODE_(INVALID|EMPTY)/i.test(msg)) return J({ error: "bad_code" });
          if (/PHONE_CODE_EXPIRED/i.test(msg)) return J({ error: "code_expired" });
          throw e;
        }
        const me = await client.getMe().catch(() => null);
        const ok = await saveSession(uid, await enc(await client.exportAuthString()), phone, me?.id != null ? String(me.id) : null);
        if (!ok) return J({ error: "save_failed" }, 502);
        return J({ ok: true });
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    if (action === "verifyPassword") {
      const loginToken = String(body?.loginToken || "");
      const password = String(body?.password || "");
      if (!loginToken || !password) return J({ error: "missing params" }, 400);
      const { authString, phone } = JSON.parse(await dec(loginToken));
      const client = await newClient(authString);
      try {
        const pwd = await client.invoke({ _: "account.getPassword" });
        const srp = await M.checkPassword(password, pwd); // builds the SRP InputCheckPasswordSRP
        await client.invoke({ _: "auth.checkPassword", password: srp });
        const me = await client.getMe().catch(() => null);
        const ok = await saveSession(uid, await enc(await client.exportAuthString()), phone, me?.id != null ? String(me.id) : null);
        if (!ok) return J({ error: "save_failed" }, 502);
        return J({ ok: true });
      } catch (e) {
        const msg = errOf(e);
        if (/PASSWORD_HASH_INVALID/i.test(msg)) return J({ error: "bad_password" });
        throw e;
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    // ---- everything below needs a stored session ----
    const s = await getSession(uid);
    if (!s) return J({ error: "not_connected" }, 409);
    const sessionStr = await dec(s.enc_session);

    if (action === "chats") {
      const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 100);
      const client = await newClient(sessionStr);
      try {
        const chats = await client.getChats({ limit });
        // 0.161 getChats -> ChatListItem[], the chat sits under .chat (a ChatP).
        // deno-lint-ignore no-explicit-any
        const out = (Array.isArray(chats) ? chats : []).map((it: any) => {
          const c = it?.chat ?? it;
          return {
            id: typeof c?.id === "bigint" ? Number(c.id) : c?.id,
            title: c?.title || [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.username || "Chat",
            username: c?.username ?? null,
            kind: c?.type ?? null,
          };
        });
        return J({ chats: safe(out) });
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    if (action === "messages") {
      if (body?.chatId === undefined || body?.chatId === null) return J({ error: "missing chatId" }, 400);
      const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 100);
      const client = await newClient(sessionStr);
      try {
        const msgs = await client.getHistory(asChatId(body.chatId), { limit });
        // deno-lint-ignore no-explicit-any
        const out = (Array.isArray(msgs) ? msgs : []).map((m: any) => ({
          id: m?.id,
          text: m?.text ?? m?.caption ?? "",
          date: m?.date instanceof Date ? m.date.getTime() : (typeof m?.date === "number" ? m.date * 1000 : null),
          outgoing: !!(m?.isOutgoing ?? m?.out),
          from: m?.from?.firstName || m?.from?.title || m?.from?.username || null,
        }));
        return J({ messages: safe(out) });
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    if (action === "send") {
      const text = String(body?.text || "");
      if (body?.chatId === undefined || body?.chatId === null || !text) return J({ error: "missing params" }, 400);
      const client = await newClient(sessionStr);
      try {
        await client.sendMessage(asChatId(body.chatId), text);
        return J({ ok: true });
      } finally { try { await client.disconnect(); } catch { /* ignore */ } }
    }

    if (action === "disconnect") {
      const client = await newClient(sessionStr).catch(() => null);
      if (client) {
        try { await client.invoke({ _: "auth.logOut" }); } catch { /* best effort — still drop our copy */ }
        try { await client.disconnect(); } catch { /* ignore */ }
      }
      await deleteSession(uid);
      return J({ ok: true });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = errOf(e);
    // Telegram rate-limits repeated auth.sendCode for a number/app: FLOOD_WAIT_<n>
    // (seconds). Surface it so the UI can show a real "try again in N" countdown
    // instead of a generic failure — covers start/verify (rethrown here).
    const flood = msg.match(/FLOOD.*?(\d+)/i);
    if (flood) return J({ error: `flood_wait:${flood[1]}` }); // 200 so the client can read it (see above)
    console.error("telegram error:", action, msg);
    return J({ error: "request_failed" }, 502);
  }
});
