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

// The "most-used" tools per toolkit (~6 each). Tight on purpose: a small,
// well-chosen set makes the model pick correctly and keeps every request lean.
// Slugs that don't exist are silently dropped. (Usage is logged to tool_usage,
// so this list can later be re-ranked from REAL data instead of estimates.)
const ALLOWED: Record<string, string[]> = {
  gmail: [
    "GMAIL_FETCH_EMAILS",
    "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    "GMAIL_SEND_EMAIL",
    "GMAIL_CREATE_EMAIL_DRAFT",
    "GMAIL_REPLY_TO_THREAD",
    "GMAIL_LIST_DRAFTS",
  ],
  googlecalendar: [
    "GOOGLECALENDAR_FIND_EVENT",
    "GOOGLECALENDAR_CREATE_EVENT",
    "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
    "GOOGLECALENDAR_LIST_CALENDARS",
    "GOOGLECALENDAR_FIND_FREE_SLOTS",
  ],
  googledrive: [
    "GOOGLEDRIVE_FIND_FILE",
    "GOOGLEDRIVE_DOWNLOAD_FILE",
    "GOOGLEDRIVE_FIND_FOLDER",
    "GOOGLEDRIVE_LIST_FILES",
    "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
    "GOOGLEDRIVE_UPLOAD_FILE",
  ],
  canva: [
    "CANVA_LIST_USER_DESIGNS",
    "CANVA_LIST_FOLDER_ITEMS_BY_TYPE_WITH_SORTING",
    "CANVA_ACCESS_USER_SPECIFIC_BRAND_TEMPLATES_LIST",
    "CANVA_CREATE_CANVA_DESIGN_EXPORT_JOB",
    "CANVA_GET_DESIGN_EXPORT_JOB_RESULT",
  ],
  figma: [
    "FIGMA_GET_PROJECTS_IN_A_TEAM",
    "FIGMA_GET_FILES_IN_A_PROJECT",
    "FIGMA_GET_FILE_METADATA",
    "FIGMA_GET_COMMENTS_IN_A_FILE",
    "FIGMA_GET_FILE_NODES",
    "FIGMA_DOWNLOAD_FIGMA_IMAGES",
  ],
  notion: [
    "NOTION_SEARCH_NOTION_PAGE",
    "NOTION_GET_PAGE_MARKDOWN",
    "NOTION_QUERY_DATABASE",
    "NOTION_FETCH_DATABASE",
    "NOTION_CREATE_NOTION_PAGE",
    "NOTION_APPEND_TEXT_BLOCKS",
  ],
  jira: [
    "JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET",
    "JIRA_GET_ISSUE",
    "JIRA_CREATE_ISSUE",
    "JIRA_GET_ALL_PROJECTS",
    "JIRA_ADD_COMMENT",
    "JIRA_TRANSITION_ISSUE",
  ],
  slack: [
    "SLACK_LIST_ALL_CHANNELS",
    "SLACK_SEND_MESSAGE",
    "SLACK_FETCH_CONVERSATION_HISTORY",
    "SLACK_SEARCH_MESSAGES",
    "SLACK_ADD_REACTION_TO_AN_ITEM",
  ],
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

function toMcp(t: any): Tool {
  return {
    name: t.slug,
    description: t.description ?? t.name ?? t.slug,
    inputSchema: t.input_parameters ?? { type: "object", properties: {} },
  };
}

async function fetchTools(params: Record<string, string>): Promise<any[]> {
  const u = new URL(`${BASE}/v3.1/tools`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Composio tools ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.items ?? body.data ?? (Array.isArray(body) ? body : []);
}

// Expose exactly our most-used allowlist for a toolkit (schemas from Composio,
// kept in our preferred order).
async function toolsForToolkit(toolkit: string): Promise<Tool[]> {
  if (cache[toolkit]) return cache[toolkit];
  const slugs = ALLOWED[toolkit] ?? [];
  if (!slugs.length) return [];
  const items = await fetchTools({ tool_slugs: slugs.join(","), limit: String(slugs.length) });
  const bySlug = new Map<string, any>(items.map((t) => [t.slug, t]));
  const tools = slugs.map((s) => bySlug.get(s)).filter(Boolean).map(toMcp);
  if (tools.length) cache[toolkit] = tools;
  return tools;
}

// Fire-and-forget: record each tool call so we can later rank tools by REAL
// usage. Writes to public.tool_usage via PostgREST with the service role.
async function logUsage(tool: string, ok: boolean): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/tool_usage`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}`, prefer: "return=minimal" },
      body: JSON.stringify({ tool, user_id: USER_ID, success: ok }),
    });
  } catch { /* never let logging break a tool call */ }
}

// Discover tool slugs for a toolkit (verification/curation helper).
// params.discover = toolkit; params.important = "true" to count featured only.
async function discover(toolkit: string, important?: boolean): Promise<{ slug: string; name: string }[]> {
  const p: Record<string, string> = { toolkit_slug: toolkit, limit: "500" };
  if (important) p.important = "true";
  const items = await fetchTools(p);
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
      // Discovery escape hatch: {method:"tools/list", params:{discover:"googlecalendar", important:true}}
      const d = msg.params?.discover;
      if (d) return J({ jsonrpc: "2.0", id, result: { tools: [], _discover: await discover(String(d), !!msg.params?.important) } });
      return J({ jsonrpc: "2.0", id, result: { tools: await listTools(apps) } });
    } catch (e) {
      return J({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }
  if (method === "tools/call") {
    const p = msg.params || {};
    try {
      const text = await execTool(p.name, p.arguments || {});
      await logUsage(p.name, true);
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      await logUsage(p.name, false);
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
