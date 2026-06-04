import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");

// Bearer shared with gmail-mcp, DERIVED at runtime from a server-only secret —
// never stored in the repo. Both functions compute the same value from
// COMPOSIO_API_KEY, so they stay in sync with no coordination.
async function mcpToken(): Promise<string> {
  const base = (COMPOSIO_API_KEY ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface Msg { role: string; content: string }

// Frontend connector id -> Composio toolkit slug (for per-session filtering).
const APP_TO_SLUG: Record<string, string> = {
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

// Identify the caller from their Supabase JWT (the `sub` claim = user id).
// A plain anon key has no `sub`, so anonymous callers get no connected apps —
// they can chat, but can't touch anyone's data.
function userFromJwt(req: Request): string | null {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role === "authenticated" && typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// Which toolkits has this user connected? Ask Composio (the source of truth).
// Returns the toolkit slugs (e.g. ["gmail","googlecalendar"]) of ACTIVE accounts.
async function connectedToolkits(userId: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", userId);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return [];
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const slugs = items
      .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s);
    return [...new Set(slugs)];
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response("The assistant isn't configured yet (ANTHROPIC_API_KEY missing on the server).", { status: 500, headers: cors });
  }

  let messages: Msg[];
  let requestedApps: string[] | undefined;
  let tz = "UTC";
  try {
    const body = await req.json();
    messages = body.messages;
    if (Array.isArray(body.apps)) requestedApps = body.apps; // per-session connector ids
    if (typeof body.tz === "string" && body.tz) tz = body.tz; // device timezone
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("bad body");
  } catch {
    return new Response("Invalid request body — expected { messages: [...] }.", { status: 400, headers: cors });
  }

  // Attach the MCP server, scoped to THIS user's connected apps. The proxy runs
  // tools as this same user id (passed in the URL) so users only touch their own data.
  let mcpServers: unknown[] | undefined;
  let mcpTools: unknown[] | undefined;
  const extraHeaders: Record<string, string> = {};
  const appUser = userFromJwt(req);
  if (appUser) {
    const connected = await connectedToolkits(appUser);
    // If the client sent a per-session app list, scope tools to it (∩ connected);
    // otherwise expose everything connected.
    let apps = connected;
    if (requestedApps) {
      const wanted = new Set(requestedApps.map((id) => APP_TO_SLUG[id]).filter(Boolean));
      apps = connected.filter((s) => wanted.has(s));
    }
    if (apps.length) {
      const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}&user=${encodeURIComponent(appUser)}`;
      mcpServers = [{ type: "url", url, name: "connectors", authorization_token: await mcpToken() }];
      // Current MCP connector format (mcp-client-2025-11-20): the toolset lives
      // in `tools`. cache_control caches the proxy-returned tool schemas — the
      // big, stable part of the prompt — so follow-up turns re-read them at ~10%
      // price instead of full. Only the tools prefix is cached on purpose: the
      // system prompt carries a per-minute timestamp, and since the cache order
      // is tools -> system -> messages, the tools cache stays stable regardless.
      mcpTools = [{ type: "mcp_toolset", mcp_server_name: "connectors", cache_control: { type: "ephemeral" } }];
      extraHeaders["anthropic-beta"] = "mcp-client-2025-11-20";
    }
  }

  // Current time in the user's local timezone (falls back to UTC if tz is bad).
  let nowLocal: string;
  try {
    nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date());
  } catch {
    tz = "UTC";
    nowLocal = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full", timeStyle: "short" }).format(new Date());
  }
  const reqBody: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are Go Farther, a helpful, friendly assistant inside a mobile app. It is currently ${nowLocal} in the user's timezone (${tz}); use this for anything time-related (e.g. calendar date ranges) instead of guessing, and ALWAYS show times to the user in their local timezone (${tz}) — never UTC. You're on a narrow phone screen: keep formatting simple. Be clear and concise. When connector tools are available (Gmail, Google Calendar, Google Drive, etc.), use them to act on the user's behalf — search and read email, check and create calendar events, find and read files. Always confirm details before sending an email or creating/changing anything.`,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (mcpServers) reqBody.mcp_servers = mcpServers;
  if (mcpTools) reqBody.tools = mcpTools;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...extraHeaders,
    },
    body: JSON.stringify(reqBody),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(`Assistant error ${upstream.status}: ${errText}`, { status: 502, headers: cors });
  }

  const out = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]" || data === "") continue;
            try {
              const evt = JSON.parse(data);
              // Lightweight cost telemetry: log token usage (incl. cache hits)
              // so caching can be verified and spend tracked from the logs.
              if (evt.type === "message_start" && evt.message?.usage) {
                const u = evt.message.usage;
                console.log(`usage in=${u.input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
              }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                controller.enqueue(enc.encode(evt.delta.text));
              }
            } catch { /* ignore partial json */ }
          }
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n⚠️ ${e instanceof Error ? e.message : String(e)}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
});
