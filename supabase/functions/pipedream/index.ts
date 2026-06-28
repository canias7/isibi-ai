import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// POC: Pipedream Connect as a Composio alternative. Managed end-user auth +
// running actions on the user's behalf. Server-verifies the caller's Supabase
// token and scopes Pipedream's external_user_id to the Supabase uid, so a client
// can only ever act as themselves. Routes (last path segment):
//   GET  /pipedream/connect?app=gmail   -> { url } hosted connect link for that app
//   GET  /pipedream/accounts            -> { accounts } the user's connected accounts
//   POST /pipedream/proxy { accountId, url, method?, body? } -> run an API call
// Needs PIPEDREAM_CLIENT_ID / _SECRET / _PROJECT_ID / _ENVIRONMENT secrets.

const CLIENT_ID = Deno.env.get("PIPEDREAM_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("PIPEDREAM_CLIENT_SECRET") ?? "";
const PROJECT_ID = Deno.env.get("PIPEDREAM_PROJECT_ID") ?? "";
const PD_ENV = Deno.env.get("PIPEDREAM_ENVIRONMENT") || "development";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const API = "https://api.pipedream.com/v1";

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "https://gofarther.dev", "https://www.gofarther.dev",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// Cached server OAuth access token (Pipedream tokens last ~1h).
let cached = { value: "", exp: 0 };
async function accessToken(): Promise<string> {
  if (cached.value && Date.now() < cached.exp - 60_000) return cached.value;
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.access_token) throw new Error("pd_oauth_failed");
  cached = { value: j.access_token as string, exp: Date.now() + (Number(j.expires_in ?? 3600) * 1000) };
  return cached.value;
}
function pdHeaders(at: string): Record<string, string> {
  return { authorization: `Bearer ${at}`, "x-pd-environment": PD_ENV, "content-type": "application/json" };
}
// URL-safe base64 of the proxy target URL (Deno: btoa on ASCII URL, then make it url-safe).
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!CLIENT_ID || !CLIENT_SECRET || !PROJECT_ID) return json(req, { error: "pipedream_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    const at = await accessToken();

    if (path === "connect") {
      const app = url.searchParams.get("app") || "";
      const r = await fetch(`${API}/connect/${PROJECT_ID}/tokens`, {
        method: "POST", headers: pdHeaders(at), body: JSON.stringify({ external_user_id: uid }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.connect_link_url) return json(req, { error: "token_failed", status: r.status, detail: j }, 502);
      const link = String(j.connect_link_url) + (app ? `&app=${encodeURIComponent(app)}` : "");
      return json(req, { url: link, expiresAt: j.expires_at ?? null });
    }

    if (path === "accounts") {
      const r = await fetch(`${API}/connect/${PROJECT_ID}/users/${encodeURIComponent(uid)}/accounts`, { headers: pdHeaders(at) });
      const j = await r.json().catch(() => ({}));
      const accounts = j?.data ?? j?.accounts ?? (Array.isArray(j) ? j : []);
      return json(req, { accounts });
    }

    if (path === "proxy") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const target = String(body.url ?? "");
      const accountId = String(body.accountId ?? "");
      const method = String(body.method ?? "GET").toUpperCase();
      if (!target || !accountId) return json(req, { error: "missing_params" }, 400);
      const q = `external_user_id=${encodeURIComponent(uid)}&account_id=${encodeURIComponent(accountId)}`;
      const r = await fetch(`${API}/connect/${PROJECT_ID}/proxy/${b64url(target)}?${q}`, {
        method,
        headers: pdHeaders(at),
        ...(body.body !== undefined && method !== "GET" ? { body: JSON.stringify(body.body) } : {}),
      });
      const text = await r.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text; }
      return json(req, { ok: r.ok, status: r.status, data });
    }

    return json(req, { error: "unknown_route" }, 404);
  } catch (e) {
    console.error("pipedream error:", e);
    return json(req, { error: (e as Error)?.message || "error" }, 502);
  }
});
