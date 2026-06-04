import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Generic "connect an app" flow, powered by Composio's managed (verified) OAuth.
// NOTE: the function slug is still `gmail-oauth` for historical reasons, but it
// now handles ANY connector via the ?app= param. Composio runs each provider's
// consent screen, stores + refreshes tokens, and owns the verified OAuth apps.
//
// Routes:
//   /start?u=<user>&app=<id>    -> 302 to the provider's hosted consent URL
//   /callback                   -> success page after Composio finishes OAuth
//   /status?u=<user>&app=<id>   -> { connected, email }
//
// Auth configs are auto-provisioned (Composio-managed) the first time an app is
// connected, so no dashboard setup is needed per connector.

const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const SELF = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth";
const BASE = "https://backend.composio.dev/api/v3.1";

// Frontend connector id -> Composio toolkit slug.
const TOOLKIT: Record<string, string> = {
  gmail: "gmail",
  gcal: "googlecalendar",
  gdrive: "googledrive",
};

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function page(body: string): Response {
  return new Response(
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#212121;color:#ececec;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px"><div>${body}</div></body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { headers: { ...cors, "content-type": "application/json" } });
}

const api = (path: string, init?: RequestInit) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "x-api-key": API_KEY, "content-type": "application/json", ...(init?.headers ?? {}) } });

function pickId(o: any): string | null {
  return o?.id ?? o?.uuid ?? o?.nanoid ?? o?.auth_config?.id ?? null;
}
function pickSlug(o: any): string | null {
  return o?.toolkit?.slug ?? o?.toolkit_slug ?? (typeof o?.toolkit === "string" ? o.toolkit : null);
}

// Find an existing auth config for a toolkit (no side effects).
async function findAuthConfig(toolkit: string): Promise<string | null> {
  const res = await api(`/auth_configs`);
  if (!res.ok) throw new Error(`auth_configs list ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
  const match = items.find((it) => (pickSlug(it) ?? "").toLowerCase() === toolkit.toLowerCase());
  return match ? pickId(match) : null;
}

// Find or create a Composio-managed auth config for a toolkit.
async function ensureAuthConfig(toolkit: string): Promise<string> {
  const existing = await findAuthConfig(toolkit);
  if (existing) return existing;
  const res = await api(`/auth_configs`, {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug: toolkit },
      auth_config: { type: "use_composio_managed_auth", credentials: {}, restrict_to_following_tools: [] },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`auth_configs create ${res.status}: ${JSON.stringify(body)}`);
  const id = pickId(body) ?? body.auth_config?.id ?? body.id;
  if (!id) throw new Error("Composio did not return an auth config id.");
  return id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  const app = url.searchParams.get("app") ?? "gmail"; // default keeps old links working
  const toolkit = TOOLKIT[app];

  if (!API_KEY) return path === "status" ? json({ connected: false }) : page("⚠️ COMPOSIO_API_KEY is not set on the server.");

  // 1) Kick off the provider's hosted consent.
  if (path === "start") {
    const u = url.searchParams.get("u");
    if (!u) return page("⚠️ Missing user id (?u=).");
    if (!toolkit) return page(`⚠️ Unknown app: ${app}`);
    try {
      const ac = await ensureAuthConfig(toolkit);
      const res = await api(`/connected_accounts/link`, {
        method: "POST",
        body: JSON.stringify({ auth_config_id: ac, user_id: u, callback_url: `${SELF}/callback` }),
      });
      const data = await res.json();
      if (!res.ok) return page(`❌ Composio link failed: ${data.message || data.error || res.status}`);
      const redirect = data.redirect_url || data.redirectUrl;
      if (!redirect) return page("❌ Composio did not return a redirect URL.");
      return Response.redirect(redirect, 302);
    } catch (e) {
      return page(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2) Composio finishes the OAuth and bounces the user back here.
  if (path === "callback") {
    const err = url.searchParams.get("error");
    if (err) return page(`❌ ${err}`);
    return page("✅ <h2>Connected!</h2><p>You can close this tab and return to Go Farther.</p>");
  }

  // 3) The app polls this to show connection state.
  if (path === "status") {
    const u = url.searchParams.get("u");
    if (!u || !toolkit) return json({ connected: false });
    try {
      const ac = await findAuthConfig(toolkit);
      if (!ac) return json({ connected: false });
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", u);
      q.searchParams.set("auth_config_ids", ac);
      q.searchParams.set("statuses", "ACTIVE");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json({ connected: false });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const active = items.find((x) => (x.status ?? "").toUpperCase() === "ACTIVE") ?? items[0];
      const email = active?.data?.email ?? active?.meta?.email ?? active?.params?.email ?? active?.data?.emailAddress ?? null;
      return json({ connected: !!active, email });
    } catch {
      return json({ connected: false });
    }
  }

  return page("Go Farther — connector (Composio) endpoint.");
});
