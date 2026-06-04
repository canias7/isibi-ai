import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Gmail "connect" flow, powered by Composio's managed (verified) OAuth.
// Composio runs the Google consent screen, stores + refreshes tokens, and
// owns the verified Google app — so users connect with no "unverified app"
// warnings and no 7-day test-user expiry.
//
// Same routes the app already calls, so the frontend is unchanged:
//   /start?u=<user>   -> 302 to Composio's hosted consent URL
//   /callback         -> success page after Composio finishes the OAuth
//   /status?u=<user>  -> { connected, email }

const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const AUTH_CONFIG_ID = "ac_LFQFgSsYOYA5"; // Gmail auth config (Composio dashboard)
const SELF = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth";

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

// List the user's Composio connections for this auth config.
async function listConnections(userId: string, statuses?: string): Promise<any[]> {
  const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
  u.searchParams.set("user_ids", userId);
  u.searchParams.set("auth_config_ids", AUTH_CONFIG_ID);
  if (statuses) u.searchParams.set("statuses", statuses);
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Composio list ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.items ?? body.data ?? (Array.isArray(body) ? body : []);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  if (!API_KEY) return path === "status" ? json({ connected: false }) : page("⚠️ COMPOSIO_API_KEY is not set on the server.");

  // 1) Kick off Composio's hosted Google consent.
  if (path === "start") {
    const u = url.searchParams.get("u");
    if (!u) return page("⚠️ Missing user id (?u=).");
    try {
      const res = await fetch("https://backend.composio.dev/api/v3.1/connected_accounts/link", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          auth_config_id: AUTH_CONFIG_ID,
          user_id: u,
          callback_url: `${SELF}/callback`,
        }),
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
    return page("✅ <h2>Gmail connected!</h2><p>You can close this tab and return to Go Farther.</p>");
  }

  // 3) The app polls this to show connection state.
  if (path === "status") {
    const u = url.searchParams.get("u");
    if (!u) return json({ connected: false });
    try {
      const items = await listConnections(u, "ACTIVE");
      const active = items.find((x) => (x.status ?? "").toUpperCase() === "ACTIVE") ?? items[0];
      const email =
        active?.data?.email ?? active?.meta?.email ?? active?.params?.email ?? active?.data?.emailAddress ?? null;
      return json({ connected: !!active, email });
    } catch {
      return json({ connected: false });
    }
  }

  return page("Go Farther — Gmail (Composio) endpoint.");
});
