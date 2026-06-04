import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Generic MCP server Claude connects to (via the chat function's mcp_servers).
// NOTE: the function slug is still `gmail-mcp` for historical reasons, but it
// now proxies MULTIPLE Composio toolkits (Gmail, Calendar, Drive, ...).
//
// It's a THIN PROXY: Claude talks to us over MCP (Bearer SHARED_SECRET, which
// is all Anthropic's native MCP connector supports), and we forward tool calls
// to Composio (which needs x-api-key). Composio owns OAuth, tokens, refresh,
// and the real provider API calls. We just translate the protocol and expose a
// curated, per-toolkit allowlist of tools.
//
// Which toolkits to expose is passed by the chat function as ?apps=slug1,slug2
// (the toolkit slugs of the user's currently-connected apps).

const SHARED_SECRET = "717fa3c352eda109dcda2451e97f1254a62c244e526eccbb";
const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const USER_ID = "primary";
const BASE = "https://backend.composio.dev/api";

// Curated tools per toolkit. Slugs that don't exist are silently dropped.
const ALLOWED: Record<string, string[]> = {
  gmail: ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_SEND_EMAIL"],
  googlecalendar: [
    "GOOGLECALENDAR_FIND_EVENT",
    "GOOGLECALENDAR_CREATE_EVENT",
    "GOOGLECALENDAR_LIST_CALENDARS",
    "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
    "GOOGLECALENDAR_FIND_FREE_SLOTS",
  ],
  googledrive: ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_DOWNLOAD_FILE", "GOOGLEDRIVE_FIND_FOLDER"],
  canva: [
    "CANVA_LIST_USER_DESIGNS",
    "CANVA_LIST_FOLDER_ITEMS_BY_TYPE_WITH_SORTING",
    "CANVA_ACCESS_USER_SPECIFIC_BRAND_TEMPLATES_LIST",
  ],
  figma: [
    "FIGMA_GET_PROJECTS_IN_A_TEAM",
    "FIGMA_GET_FILES_IN_A_PROJECT",
    "FIGMA_GET_FILE_METADATA",
    "FIGMA_GET_COMMENTS_IN_A_FILE",
  ],
  notion: [
    "NOTION_SEARCH_NOTION_PAGE",
    "NOTION_GET_PAGE_MARKDOWN",
    "NOTION_QUERY_DATABASE",
    "NOTION_FETCH_DATABASE",
    "NOTION_APPEND_TEXT_BLOCKS",
  ],
  jira: ["JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", "JIRA_GET_ISSUE", "JIRA_CREATE_ISSUE", "JIRA_GET_ALL_PROJECTS"],
  slack: ["SLACK_LIST_ALL_CHANNELS", "SLACK_SEND_MESSAGE", "SLACK_FETCH_CONVERSATION_HISTORY", "SLACK_SEARCH_MESSAGES"],
  hubspot: [
    "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
    "HUBSPOT_LIST_CONTACTS",
    "HUBSPOT_LIST_DEALS",
    "HUBSPOT_SEARCH_DEALS",
    "HUBSPOT_CREATE_CONTACT",
  ],
  outlook: [
    "OUTLOOK_LIST_MESSAGES",
    "OUTLOOK_SEARCH_MESSAGES",
    "OUTLOOK_SEND_EMAIL",
    "OUTLOOK_GET_MESSAGE",
    "OUTLOOK_LIST_EVENTS",
    "OUTLOOK_CALENDAR_CREATE_EVENT",
  ],
};

type Tool = { name: string; description: string; inputSchema: unknown };
const cache: Record<string, Tool[]> = {}; // per-toolkit, across warm invocations

async function toolsForToolkit(toolkit: string): Promise<Tool[]> {
  if (cache[toolkit]) return cache[toolkit];
  const allow = new Set(ALLOWED[toolkit] ?? []);
  if (allow.size === 0) return [];
  const u = new URL(`${BASE}/v3.1/tools`);
  u.searchParams.set("toolkit_slug", toolkit);
  u.searchParams.set("limit", "500");
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Composio tools ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
  const found = items
    .filter((t) => allow.has(t.slug))
    .map((t) => ({
      name: t.slug,
      description: t.description ?? t.name ?? t.slug,
      inputSchema: t.input_parameters ?? { type: "object", properties: {} },
    }));
  // Preserve our preferred order; only cache once we got results.
  const ordered = (ALLOWED[toolkit] ?? []).map((s) => found.find((t) => t.name === s)).filter(Boolean) as Tool[];
  if (ordered.length) cache[toolkit] = ordered;
  return ordered;
}

// Discover ALL tool slugs for a toolkit (used to verify/curate allowlists).
async function discover(toolkit: string): Promise<{ slug: string; name: string }[]> {
  const u = new URL(`${BASE}/v3.1/tools`);
  u.searchParams.set("toolkit_slug", toolkit);
  u.searchParams.set("limit", "500");
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Composio tools ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
  return items.map((t) => ({ slug: t.slug, name: t.name ?? "" }));
}

async function listTools(apps: string[]): Promise<Tool[]> {
  const slugs = apps.length ? apps : Object.keys(ALLOWED);
  const out: Tool[] = [];
  for (const s of slugs) out.push(...(await toolsForToolkit(s)));
  return out;
}

async function execTool(name: string, args: unknown): Promise<string> {
  const res = await fetch(`${BASE}/v3/tools/execute/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, arguments: args ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio execute ${res.status}: ${JSON.stringify(body)}`);
  if (body.successful === false || body.error) throw new Error(String(body.error || "Tool execution failed"));
  const data = body.data ?? body;
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("Go Farther MCP (Composio-backed)", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  if (auth !== "Bearer " + SHARED_SECRET) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const apps = (new URL(req.url).searchParams.get("apps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  let msg: any;
  try { msg = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const id = msg.id ?? null;
  const method = msg.method;
  const J = (obj: unknown) => new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

  if (method === "initialize") {
    return J({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gofarther", version: "3.0.0" },
      },
    });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (method === "tools/list") {
    try {
      // Discovery escape hatch: {method:"tools/list", params:{discover:"googlecalendar"}}
      const d = msg.params?.discover;
      if (d) return J({ jsonrpc: "2.0", id, result: { tools: [], _discover: await discover(String(d)) } });
      return J({ jsonrpc: "2.0", id, result: { tools: await listTools(apps) } });
    } catch (e) {
      return J({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }
  if (method === "tools/call") {
    const p = msg.params || {};
    try {
      const text = await execTool(p.name, p.arguments || {});
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return J({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true },
      });
    }
  }
  if (method === "ping") return J({ jsonrpc: "2.0", id, result: {} });
  return J({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
});
