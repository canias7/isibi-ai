import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Plaid bank-linking — SEPARATE from the Composio connectors. Creates Link tokens,
// exchanges public tokens, stores each user's access token server-side (never sent
// to the client), and reads balances/transactions. Sandbox by default (PLAID_ENV).

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
const PLAID_ENV = (Deno.env.get("PLAID_ENV") || "sandbox").toLowerCase();
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

// This user's linked items (service role; access_token stays server-side).
async function itemsFor(uid: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/plaid_items?user_id=eq.${encodeURIComponent(uid)}&select=id,item_id,access_token,institution_name,created_at&order=created_at.desc`, { headers: sbHeaders });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
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
    if (action === "create_link_token") {
      const d = await plaid("/link/token/create", {
        client_name: "Go Farther",
        user: { client_user_id: uid },
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      });
      return J({ link_token: d.link_token });
    }

    if (action === "exchange") {
      const publicToken = String(body?.public_token || "");
      if (!publicToken) return J({ error: "missing public_token" }, 400);
      const ex = await plaid("/item/public_token/exchange", { public_token: publicToken });
      const accessToken = ex.access_token, itemId = ex.item_id;
      // Best-effort institution name (don't fail the link if this lookup hiccups).
      let inst = "";
      try {
        const item = await plaid("/item/get", { access_token: accessToken });
        const instId = item?.item?.institution_id;
        if (instId) {
          const ig = await plaid("/institutions/get_by_id", { institution_id: instId, country_codes: ["US"] });
          inst = ig?.institution?.name || "";
        }
      } catch { /* name is optional */ }
      await fetch(`${SB_URL}/rest/v1/plaid_items?on_conflict=user_id,item_id`, {
        method: "POST",
        headers: { ...sbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: uid, item_id: itemId, access_token: accessToken, institution_name: inst }),
      });
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
          const d = await plaid("/accounts/balance/get", { access_token: it.access_token });
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
        try {
          const d = await plaid("/transactions/sync", { access_token: it.access_token, count: 30 });
          for (const t of (d.added || [])) {
            out.push({
              bank: it.institution_name || "Bank", name: t.name, amount: t.amount,
              date: t.date, currency: t.iso_currency_code || "USD", pending: !!t.pending,
            });
          }
        } catch (e) { out.push({ bank: it.institution_name || "Bank", error: String((e as Error).message) }); }
      }
      out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return J({ transactions: out.slice(0, 50) });
    }

    if (action === "unlink") {
      const id = String(body?.id || "");
      if (id) {
        const items = await itemsFor(uid);
        const it = items.find((x) => x.id === id);
        if (it) { try { await plaid("/item/remove", { access_token: it.access_token }); } catch { /* best effort */ } }
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
