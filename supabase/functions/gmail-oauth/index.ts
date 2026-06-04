import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Generic "connect an app" flow, powered by Composio's managed (verified) OAuth.
// NOTE: the function slug is still `gmail-oauth` for historical reasons, but it
// now handles ANY connector via the ?app= param.
//
// Identity is verified SERVER-SIDE (the caller's Supabase access token), so we
// never trust a client-supplied user id. Routes:
//   /start?app=<id>&t=<access_token>   -> 302 to the provider's hosted consent
//   /callback                          -> success page after Composio finishes
//   /status?app=<id>  (Bearer token)   -> { connected, email }

const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const SELF = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth";
const BASE = "https://backend.composio.dev/api/v3.1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Frontend connector id -> Composio toolkit slug. (atlassian->jira and
// m365->outlook are the best single-toolkit fits Composio offers.)
const TOOLKIT: Record<string, string> = {
  gmail: "gmail",
  gcal: "googlecalendar",
  gdrive: "googledrive",
  canva: "canva",
  figma: "figma",
  notion: "notion",
  atlassian: "jira",
  m365: "outlook",
  slack: "slack",
  hubspot: "hubspot",
  googlesheets: "googlesheets",
  googledocs: "googledocs",
  excel: "excel",
  one_drive: "one_drive",
  dropbox: "dropbox",
  box: "box",
  onenote: "onenote",
  airtable: "airtable",
  todoist: "todoist",
  googletasks: "googletasks",
  asana: "asana",
  trello: "trello",
  clickup: "clickup",
  monday: "monday",
  miro: "miro",
  calendly: "calendly",
  zoom: "zoom",
  googlemeet: "googlemeet",
  microsoft_teams: "microsoft_teams",
  webex: "webex",
  telegram: "telegram",
  discord: "discord",
  linkedin: "linkedin",
  reddit: "reddit",
  youtube: "youtube",
  instagram: "instagram",
  twitter: "twitter",
  spotify: "spotify",
  salesforce: "salesforce",
  pipedrive: "pipedrive",
  zoho: "zoho",
  zendesk: "zendesk",
  intercom: "intercom",
  freshdesk: "freshdesk",
  shopify: "shopify",
  stripe: "stripe",
  square: "square",
  quickbooks: "quickbooks",
  xero: "xero",
  typeform: "typeform",
  jotform: "jotform",
  mailchimp: "mailchimp",
  sendgrid: "sendgrid",
  klaviyo: "klaviyo",
};
// Reverse: Composio toolkit slug -> frontend connector id.
const APP_FOR_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TOOLKIT).map(([app, slug]) => [slug, app]),
);

// CORS allowlist: native app (Capacitor) + local dev. Requests with no Origin
// (native fetch / curl) are allowed; unknown browser origins are blocked.
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
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

// Supabase Edge Functions force `text/plain` + a sandbox CSP on responses
// (so *.supabase.co can't host rendered web pages). HTML therefore shows up as
// raw source in the browser — so these consent-return pages are plain text.
function page(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

function json(req: Request, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { headers: { ...corsFor(req), "content-type": "application/json" } });
}

// Verify the caller's Supabase access token and return their user id (or null).
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  const app = url.searchParams.get("app") ?? "gmail";
  const toolkit = TOOLKIT[app];

  if (!API_KEY) return path === "status" ? json(req, { connected: false }) : page("⚠️ COMPOSIO_API_KEY is not set on the server.");

  // 1) Kick off the provider's hosted consent (verified via the ?t= token).
  if (path === "start") {
    const uid = await verifyUser(url.searchParams.get("t"));
    if (!uid) return page("⚠️ Please sign in to Go Farther, then try connecting again.");
    if (!toolkit) return page(`⚠️ Unknown app: ${app}`);
    try {
      const ac = await ensureAuthConfig(toolkit);
      const native = url.searchParams.get("native") === "1";
      const res = await api(`/connected_accounts/link`, {
        method: "POST",
        body: JSON.stringify({
          auth_config_id: ac,
          user_id: uid,
          callback_url: `${SELF}/${native ? "callback-app" : "callback"}`,
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
    return page("✅ Connected!\n\nYou can close this tab and return to Go Farther.");
  }

  // 2b) Native return: bounce back into the app via its custom URL scheme so
  // the in-app browser auto-closes (no manual "back" tap needed).
  if (path === "callback-app") {
    const err = url.searchParams.get("error");
    const target = err ? `gofarther://connected?error=${encodeURIComponent(err)}` : "gofarther://connected";
    return new Response(null, { status: 302, headers: { Location: target } });
  }

  // 3b) Batched: every connected app for this user in ONE call (Bearer token).
  if (path === "list") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid) return json(req, { connected: {} });
    try {
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("statuses", "ACTIVE");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: {} });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const connected: Record<string, { email: string | null }> = {};
      for (const it of items) {
        if ((it.status ?? "").toUpperCase() !== "ACTIVE") continue;
        const appId = APP_FOR_SLUG[(pickSlug(it) ?? "").toLowerCase()];
        if (!appId) continue;
        const email = it?.data?.email ?? it?.meta?.email ?? it?.params?.email ?? it?.data?.emailAddress ?? null;
        connected[appId] = { email };
      }
      return json(req, { connected });
    } catch {
      return json(req, { connected: {} });
    }
  }

  // 3) The app polls this to show connection state (verified via Bearer token).
  if (path === "status") {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    const uid = await verifyUser(token);
    if (!uid || !toolkit) return json(req, { connected: false });
    try {
      const ac = await findAuthConfig(toolkit);
      if (!ac) return json(req, { connected: false });
      const q = new URL(`${BASE}/connected_accounts`);
      q.searchParams.set("user_ids", uid);
      q.searchParams.set("auth_config_ids", ac);
      q.searchParams.set("statuses", "ACTIVE");
      const res = await fetch(q.toString(), { headers: { "x-api-key": API_KEY } });
      if (!res.ok) return json(req, { connected: false });
      const body = await res.json();
      const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
      const active = items.find((x) => (x.status ?? "").toUpperCase() === "ACTIVE") ?? items[0];
      const email = active?.data?.email ?? active?.meta?.email ?? active?.params?.email ?? active?.data?.emailAddress ?? null;
      return json(req, { connected: !!active, email });
    } catch {
      return json(req, { connected: false });
    }
  }

  return page("Go Farther — connector (Composio) endpoint.");
});
