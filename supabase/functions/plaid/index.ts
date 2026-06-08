import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Plaid bank-linking — SEPARATE from the Composio connectors. Uses Hosted Link
// (Plaid hosts the Link page; the bank's OAuth happens in the browser), so it works
// for real OAuth banks on a phone. Stores each user's access token AES-GCM-encrypted
// at rest (never sent to the client). Sandbox by default (PLAID_ENV).

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
const PLAID_ENV = (Deno.env.get("PLAID_ENV") || "sandbox").toLowerCase();
const PLAID_REDIRECT_URI = Deno.env.get("PLAID_REDIRECT_URI"); // set once an OAuth redirect URI is registered (production)
const PLAID_BASE = PLAID_ENV === "production"
  ? "https://production.plaid.com"
  : PLAID_ENV === "development"
  ? "https://development.plaid.com"
  : "https://sandbox.plaid.com";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sbHeaders = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" };

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
function userFromJwt(req: Request): string | null {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// ---- access-token encryption at rest (AES-GCM). Stored as "enc:<iv>:<ct>" (base64).
function b64(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function b64ToBytes(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function encKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("PLAID_ENC_KEY");
  if (!raw || raw.length < 64) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encToken(plain: string): Promise<string> {
  const key = await encKey();
  if (!key) return plain; // no key configured -> store as-is (fallback)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `enc:${b64(iv)}:${b64(ct)}`;
}
async function decToken(stored: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored; // legacy/plaintext
  const key = await encKey();
  if (!key) throw new Error("ENC_KEY_MISSING");
  const [, ivb, ctb] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivb) }, key, b64ToBytes(ctb));
  return new TextDecoder().decode(pt);
}

// Call a Plaid endpoint with the server credentials. Throws the Plaid error_code.
async function plaid(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_code || `HTTP_${res.status}`);
  return data;
}

async function itemsFor(uid: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/plaid_items?user_id=eq.${encodeURIComponent(uid)}&select=id,item_id,access_token,institution_name,created_at&order=created_at.desc`, { headers: sbHeaders });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

// Exchange a public token, look up the institution name, store the item (token
// encrypted). Returns the institution name.
async function exchangeAndStore(uid: string, publicToken: string): Promise<string> {
  const ex = await plaid("/item/public_token/exchange", { public_token: publicToken });
  const accessToken = ex.access_token, itemId = ex.item_id;
  let inst = "";
  try {
    const item = await plaid("/item/get", { access_token: accessToken });
    const instId = item?.item?.institution_id;
    if (instId) {
      const ig = await plaid("/institutions/get_by_id", { institution_id: instId, country_codes: ["US"] });
      inst = ig?.institution?.name || "";
    }
  } catch { /* institution name is optional */ }
  await fetch(`${SB_URL}/rest/v1/plaid_items?on_conflict=user_id,item_id`, {
    method: "POST",
    headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: uid, item_id: itemId, access_token: await encToken(accessToken), institution_name: inst }),
  });
  return inst;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) return J({ error: "Plaid isn't configured yet." }, 500);

  const uid = userFromJwt(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok for some actions */ }
  const action = String(body?.action || "");

  try {
    // Start a Hosted Link session: Plaid hosts the Link page (handles OAuth banks);
    // we open hosted_link_url in the in-app browser and poll `complete`.
    if (action === "create_link_token") {
      const hosted: Record<string, unknown> = {};
      const tokenBody: Record<string, unknown> = {
        client_name: "Go Farther",
        user: { client_user_id: uid },
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        hosted_link: hosted,
      };
      if (PLAID_REDIRECT_URI) { tokenBody.redirect_uri = PLAID_REDIRECT_URI; hosted.is_mobile_app = true; }
      const d = await plaid("/link/token/create", tokenBody);
      return J({ link_token: d.link_token, hosted_link_url: d.hosted_link_url });
    }

    // Poll a Hosted Link session for completion; when a public token is available,
    // exchange + store it. Returns {pending:true} until the user finishes.
    if (action === "complete") {
      const linkToken = String(body?.link_token || "");
      if (!linkToken) return J({ error: "missing link_token" }, 400);
      const g = await plaid("/link/token/get", { link_token: linkToken });
      let publicToken = "";
      for (const s of (g.link_sessions || [])) {
        for (const r of (s?.results?.item_add_results || [])) if (r?.public_token) { publicToken = r.public_token; break; }
        if (!publicToken && s?.on_success?.public_token) publicToken = s.on_success.public_token;
        if (publicToken) break;
      }
      if (!publicToken) return J({ pending: true });
      const inst = await exchangeAndStore(uid, publicToken);
      return J({ ok: true, institution: inst });
    }

    // Direct exchange (kept for completeness / non-hosted callers).
    if (action === "exchange") {
      const publicToken = String(body?.public_token || "");
      if (!publicToken) return J({ error: "missing public_token" }, 400);
      const inst = await exchangeAndStore(uid, publicToken);
      return J({ ok: true, institution: inst });
    }

    if (action === "list") {
      const items = await itemsFor(uid);
      return J({ banks: items.map((i) => ({ id: i.id, institution: i.institution_name || "Bank", linked_at: i.created_at })) });
    }

    if (action === "balances") {
      const items = await itemsFor(uid);
      const out: any[] = [];
      for (const it of items) {
        try {
          const at = await decToken(it.access_token);
          const d = await plaid("/accounts/balance/get", { access_token: at });
          for (const a of (d.accounts || [])) {
            out.push({
              bank: it.institution_name || "Bank", name: a.name, mask: a.mask,
              type: a.subtype || a.type,
              available: a.balances?.available, current: a.balances?.current,
              currency: a.balances?.iso_currency_code || "USD",
            });
          }
        } catch (e) { out.push({ bank: it.institution_name || "Bank", error: String((e as Error).message) }); }
      }
      return J({ accounts: out });
    }

    if (action === "transactions") {
      const items = await itemsFor(uid);
      const out: any[] = [];
      for (const it of items) {
        let err = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const at = await decToken(it.access_token);
            const d = await plaid("/transactions/sync", { access_token: at, count: 50 });
            for (const t of (d.added || [])) {
              out.push({
                bank: it.institution_name || "Bank", name: t.name, amount: t.amount,
                date: t.date, currency: t.iso_currency_code || "USD", pending: !!t.pending,
              });
            }
            err = ""; break;
          } catch (e) {
            err = String((e as Error).message);
            // Just-linked items are still importing history upstream — retry once.
            if (attempt === 0 && /503|NOT_READY|RATE_LIMIT/.test(err)) { await new Promise((r) => setTimeout(r, 2500)); continue; }
            break;
          }
        }
        if (err) {
          const friendly = /503|NOT_READY/.test(err) ? "Still importing transactions — give it a minute and tap again." : err;
          out.push({ bank: it.institution_name || "Bank", error: friendly });
        }
      }
      out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return J({ transactions: out.slice(0, 50) });
    }

    if (action === "unlink") {
      const id = String(body?.id || "");
      if (id) {
        const items = await itemsFor(uid);
        const it = items.find((x) => x.id === id);
        if (it) { try { await plaid("/item/remove", { access_token: await decToken(it.access_token) }); } catch { /* best effort */ } }
        await fetch(`${SB_URL}/rest/v1/plaid_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}`, { method: "DELETE", headers: sbHeaders });
      }
      return J({ ok: true });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("plaid error:", action, e);
    return J({ error: String((e as Error).message || "Plaid request failed") }, 502);
  }
});
