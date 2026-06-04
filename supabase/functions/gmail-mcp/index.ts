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

const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const BASE = "https://backend.composio.dev/api";

// Bearer that gates this server, DERIVED at runtime from a server-only secret
// (not stored in the repo). Must match the same derivation in the chat function.
async function mcpToken(): Promise<string> {
  const base = (Deno.env.get("COMPOSIO_API_KEY") ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  googlesheets: ["GOOGLESHEETS_BATCH_GET", "GOOGLESHEETS_FIND_REPLACE", "GOOGLESHEETS_GET_BATCH_VALUES", "GOOGLESHEETS_GET_SHEET_NAMES", "GOOGLESHEETS_GET_SPREADSHEET_BY_DATA_FILTER", "GOOGLESHEETS_GET_SPREADSHEET_INFO"],
  googledocs: ["GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", "GOOGLEDOCS_LIST_SPREADSHEET_CHARTS", "GOOGLEDOCS_COPY_DOCUMENT", "GOOGLEDOCS_CREATE_DOCUMENT2", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", "GOOGLEDOCS_CREATE_FOOTER"],
  excel: ["EXCEL_GET_SESSION", "EXCEL_LIST_TABLE_COLUMNS", "EXCEL_SEARCH_FILES", "EXCEL_ADD_TABLE", "EXCEL_ADD_WORKBOOK_PERMISSION", "EXCEL_INSERT_RANGE"],
  one_drive: ["ONE_DRIVE_GET_DRIVE", "ONE_DRIVE_GET_DRIVE_ITEM_BY_SHARING_URL", "ONE_DRIVE_GET_FOLLOWED_ITEM", "ONE_DRIVE_GET_GROUP_DRIVE", "ONE_DRIVE_GET_ITEM", "ONE_DRIVE_GET_ITEM_PERMISSIONS"],
  dropbox: ["DROPBOX_FILES_SEARCH", "DROPBOX_GET_ACCOUNT", "DROPBOX_GET_SHARED_FOLDER_METADATA", "DROPBOX_GET_SPACE_USAGE", "DROPBOX_GET_TEAM_INFO", "DROPBOX_GET_TEAM_LOG_EVENTS"],
  box: ["BOX_FIND_FILE_FOR_SHARED_LINK", "BOX_GET_FILE_INFORMATION", "BOX_GET_FOLDER", "BOX_LIST_FILE_COMMENTS", "BOX_LIST_ITEMS_IN_FOLDER", "BOX_SEARCH_FOR_CONTENT"],
  onenote: ["ONENOTE_GET_GROUP_SECTIONS", "ONENOTE_GET_NOTEBOOK_FROM_WEB_URL", "ONENOTE_GET_NOTEBOOK_SECTION_GROUP", "ONENOTE_GET_ONENOTE_GROUP_SECTIONS_PAGES", "ONENOTE_GET_SITE_SECTIONS", "ONENOTE_GET_SITE_SECTIONS_PAGES"],
  airtable: ["AIRTABLE_GET_BASE_SCHEMA", "AIRTABLE_GET_RECORD", "AIRTABLE_LIST_BASES", "AIRTABLE_CREATE_MULTIPLE_RECORDS", "AIRTABLE_CREATE_RECORD", "AIRTABLE_CREATE_RECORD_FROM_NATURAL_LANGUAGE"],
  todoist: ["TODOIST_GET_ALL_TASKS", "TODOIST_CREATE_TASK", "TODOIST_UPDATE_TASK", "TODOIST_CLOSE_TASK", "TODOIST_GET_ALL_PROJECTS", "TODOIST_CREATE_PROJECT"],
  googletasks: ["GOOGLETASKS_LIST_ALL_TASKS", "GOOGLETASKS_LIST_TASK_LISTS", "GOOGLETASKS_GET_TASK", "GOOGLETASKS_INSERT_TASK", "GOOGLETASKS_UPDATE_TASK", "GOOGLETASKS_DELETE_TASK"],
  asana: ["ASANA_SEARCH_TASKS_IN_WORKSPACE", "ASANA_GET_TASKS_FROM_A_PROJECT", "ASANA_GET_A_TASK", "ASANA_CREATE_A_TASK", "ASANA_UPDATE_A_TASK", "ASANA_GET_MULTIPLE_PROJECTS"],
  trello: ["TRELLO_GET_SEARCH", "TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD", "TRELLO_GET_CARDS_BY_ID_CARD", "TRELLO_ADD_CARDS", "TRELLO_UPDATE_CARDS_BY_ID_CARD", "TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD"],
  clickup: ["CLICKUP_CREATE_LIST", "CLICKUP_CREATE_THREADED_COMMENT", "CLICKUP_GET_DOC_PAGE_CONTENT", "CLICKUP_GET_TASK", "CLICKUP_MOVE_TASK_TO_HOME_LIST", "CLICKUP_CREATE_DOC"],
  monday: ["MONDAY_GET_ITEMS", "MONDAY_LIST_BOARD_ITEMS", "MONDAY_LIST_BOARDS", "MONDAY_LIST_ITEMS_BY_COLUMN_VALUES", "MONDAY_LIST_USERS", "MONDAY_ADD_USERS_TO_BOARD"],
  miro: ["MIRO_GET_BOARD", "MIRO_GET_BOARD_MEMBERS", "MIRO_GET_BOARDS", "MIRO_GET_BOARDS2", "MIRO_GET_FRAME_ITEM", "MIRO_GET_TAG"],
  calendly: ["CALENDLY_GET_EVENT_TYPE_AVAILABILITY", "CALENDLY_GET_ORGANIZATION", "CALENDLY_GET_USER", "CALENDLY_LIST_EVENT_TYPES", "CALENDLY_LIST_SCHEDULED_EVENTS", "CALENDLY_CANCEL_SCHEDULED_EVENT"],
  zoom: ["ZOOM_GET_A_MEETING", "ZOOM_GET_A_MEETING_SUMMARY", "ZOOM_GET_MEETING_RECORDINGS", "ZOOM_GET_USER", "ZOOM_LIST_ALL_RECORDINGS", "ZOOM_LIST_MEETINGS"],
  googlemeet: ["GOOGLEMEET_GET_CONFERENCE_RECORD_BY_NAME", "GOOGLEMEET_GET_PARTICIPANT_SESSION", "GOOGLEMEET_LIST_CONFERENCE_RECORDS", "GOOGLEMEET_LIST_PARTICIPANTS", "GOOGLEMEET_LIST_PARTICIPANT_SESSIONS", "GOOGLEMEET_LIST_RECORDINGS"],
  microsoft_teams: ["MICROSOFT_TEAMS_GET_CHANNEL", "MICROSOFT_TEAMS_GET_CHAT_MESSAGE", "MICROSOFT_TEAMS_GET_MEETING_TRANSCRIPT_CONTENT", "MICROSOFT_TEAMS_GET_MY_PROFILE", "MICROSOFT_TEAMS_GET_PRIMARY_CHANNEL", "MICROSOFT_TEAMS_GET_SCHEDULE"],
  webex: ["WEBEX_GET_TEAM_DETAILS", "WEBEX_LIST_TEAMS", "WEBEX_LIST_WEBHOOKS", "WEBEX_MESSAGING_GET_MEMBERSHIP_DETAILS", "WEBEX_MESSAGING_GET_MESSAGE_DETAILS", "WEBEX_MESSAGING_GET_TEAM_MEMBERSHIP_DETAILS"],
  telegram: ["TELEGRAM_GET_CHAT_MEMBER", "TELEGRAM_SEND_MESSAGE"],
  discord: ["DISCORD_GET_GATEWAY", "DISCORD_GET_INVITE", "DISCORD_GET_USER", "DISCORD_INVITE_RESOLVE"],
  linkedin: ["LINKEDIN_GET_PERSON", "LINKEDIN_GET_POST_CONTENT", "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE", "LINKEDIN_INITIALIZE_IMAGE_UPLOAD", "LINKEDIN_REGISTER_IMAGE_UPLOAD"],
  reddit: ["REDDIT_GET", "REDDIT_GET_CONTROVERSIAL_POSTS", "REDDIT_GET_NEW", "REDDIT_GET_REDDIT_USER_ABOUT", "REDDIT_GET_R_TOP", "REDDIT_GET_SUBREDDITS_SEARCH"],
  youtube: ["YOUTUBE_ADD_VIDEO_TO_PLAYLIST", "YOUTUBE_CREATE_PLAYLIST", "YOUTUBE_LIST_CAPTION_TRACK", "YOUTUBE_LIST_COMMENTS", "YOUTUBE_LIST_COMMENT_THREADS", "YOUTUBE_UPDATE_PLAYLIST"],
  instagram: ["INSTAGRAM_GET_IG_MEDIA", "INSTAGRAM_GET_IG_MEDIA_COMMENTS", "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", "INSTAGRAM_GET_IG_USER_MEDIA", "INSTAGRAM_GET_PAGE_CONVERSATIONS", "INSTAGRAM_CREATE_CAROUSEL_CONTAINER"],
  twitter: ["TWITTER_CREATE_LIST", "TWITTER_DELETE_LIST", "TWITTER_GET_BLOCKED_USERS", "TWITTER_GET_POST_ANALYTICS", "TWITTER_RECENT_SEARCH", "TWITTER_CREATION_OF_A_POST"],
  spotify: ["SPOTIFY_ADD_ITEMS_TO_PLAYLIST", "SPOTIFY_CREATE_PLAYLIST", "SPOTIFY_GET_ARTIST_S_TOP_TRACKS", "SPOTIFY_GET_PLAYLIST", "SPOTIFY_GET_SHOW", "SPOTIFY_GET_SHOW_EPISODES"],
  salesforce: ["SALESFORCE_EXECUTE_SOQL_QUERY", "SALESFORCE_SEARCH_CONTACTS", "SALESFORCE_SEARCH_OPPORTUNITIES", "SALESFORCE_GET_ACCOUNT", "SALESFORCE_CREATE_LEAD", "SALESFORCE_UPDATE_RECORD"],
  pipedrive: ["PIPEDRIVE_GET_ACTIVITY_FIELD", "PIPEDRIVE_GET_ALL_LEADS", "PIPEDRIVE_GET_ALL_PRODUCTS", "PIPEDRIVE_GET_DEAL", "PIPEDRIVE_GET_DEAL_FIELD", "PIPEDRIVE_GET_LEAD_CONVERSION_STATUS"],
  zoho: ["ZOHO_GET_RELATED_LISTS", "ZOHO_GET_RELATED_RECORDS", "ZOHO_GET_ZOHO_USERS", "ZOHO_LIST_MODULES", "ZOHO_LIST_RECORD_ATTACHMENTS", "ZOHO_SEARCH_ZOHO_RECORDS"],
  zendesk: ["ZENDESK_GET_ATTACHMENT", "ZENDESK_GET_USER", "ZENDESK_GET_USERS_ASSIGNED_TICKETS", "ZENDESK_GET_USERS_CCD_TICKETS", "ZENDESK_GET_USERS_FOLLOWED_TICKETS", "ZENDESK_GET_USERS_REQUESTED_TICKETS"],
  intercom: ["INTERCOM_GET_CONVERSATION", "INTERCOM_GET_TICKET", "INTERCOM_LIST_ALL_MACROS", "INTERCOM_LIST_CONTACTS", "INTERCOM_LIST_CONVERSATIONS", "INTERCOM_LIST_SEGMENTS"],
  freshdesk: ["FRESHDESK_GET_ACCOUNT", "FRESHDESK_GET_AGENT", "FRESHDESK_GET_AGENTS", "FRESHDESK_GET_COMPANIES", "FRESHDESK_GET_COMPANY", "FRESHDESK_GET_COMPANY_FIELDS"],
  shopify: ["SHOPIFY_GET_CUSTOMER", "SHOPIFY_GET_CUSTOMERS_SEARCH", "SHOPIFY_GET_ORDER", "SHOPIFY_GET_SHOP_CONFIGURATION", "SHOPIFY_GET_SHOP_DETAILS", "SHOPIFY_LIST_CUSTOMERS"],
  stripe: ["STRIPE_LIST_CUSTOMERS", "STRIPE_GET_V1_CUSTOMERS_SEARCH_CUSTOMERS", "STRIPE_LIST_CHARGES", "STRIPE_LIST_INVOICES", "STRIPE_LIST_PAYMENT_INTENTS", "STRIPE_GET_BALANCE_HISTORY"],
  square: ["SQUARE_GET_CURRENT_MERCHANT", "SQUARE_GET_MERCHANT", "SQUARE_LIST_CHANNELS", "SQUARE_LIST_CUSTOMER_GROUPS", "SQUARE_LIST_CUSTOMERS", "SQUARE_LIST_CUSTOMER_SEGMENTS"],
  quickbooks: ["QUICKBOOKS_GET_AGED_RECEIVABLES_REPORT", "QUICKBOOKS_GET_BALANCE_SHEET_REPORT", "QUICKBOOKS_GET_CHANGED_ENTITIES", "QUICKBOOKS_GET_COMPANY_INFO", "QUICKBOOKS_GET_GENERAL_LEDGER_REPORT", "QUICKBOOKS_GET_PROFIT_AND_LOSS_DETAIL_REPORT"],
  xero: ["XERO_GET_ACCOUNT", "XERO_GET_ASSET", "XERO_GET_BALANCE_SHEET_REPORT", "XERO_GET_BUDGET", "XERO_GET_CONNECTIONS", "XERO_GET_CONTACTS"],
  typeform: ["TYPEFORM_GET_ABOUT_ME", "TYPEFORM_GET_FORM", "TYPEFORM_GET_FORM_RESPONSES", "TYPEFORM_GET_WORKSPACE", "TYPEFORM_LIST_FORMS", "TYPEFORM_LIST_THEMES"],
  jotform: ["JOTFORM_GET_SYSTEM_PLAN", "JOTFORM_GET_USER_DETAILS", "JOTFORM_GET_USER_FOLDERS", "JOTFORM_GET_USER_FORMS", "JOTFORM_GET_USER_HISTORY", "JOTFORM_GET_USER_REPORTS"],
  mailchimp: ["MAILCHIMP_GET_AUDIENCES_CONTACTS", "MAILCHIMP_GET_AUDIENCES_CONTACTS_DETAIL", "MAILCHIMP_GET_CAMPAIGN_INFO", "MAILCHIMP_GET_LISTS_INFO", "MAILCHIMP_LIST_CAMPAIGNS", "MAILCHIMP_LIST_RECENT_ACTIVITY"],
  sendgrid: ["SENDGRID_ADD_OR_UPDATE_A_CONTACT", "SENDGRID_SEARCH_CONTACTS", "SENDGRID_RETRIEVE_ALL_LISTS", "SENDGRID_CREATE_A_LIST", "SENDGRID_RETRIEVE_ALL_CAMPAIGNS", "SENDGRID_GET_TOTAL_CONTACT_COUNT"],
  klaviyo: ["KLAVIYO_ADD_PROFILE_TO_LIST", "KLAVIYO_CREATE_LIST", "KLAVIYO_GET_BULK_DELETE_CATALOG_ITEMS_JOB", "KLAVIYO_GET_BULK_UPDATE_CATEGORIES_JOB", "KLAVIYO_GET_CAMPAIGN", "KLAVIYO_GET_CAMPAIGNS"],
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
async function toolsForToolkit(toolkit: string, slugs: string[]): Promise<Tool[]> {
  if (!slugs.length) return [];
  const cacheKey = toolkit + ":" + slugs.join(",");
  if (cache[cacheKey]) return cache[cacheKey];
  const items = await fetchTools({ tool_slugs: slugs.join(","), limit: String(slugs.length) });
  const bySlug = new Map<string, any>(items.map((t) => [t.slug, t]));
  const tools = slugs.map((s) => bySlug.get(s)).filter(Boolean).map(toMcp);
  if (tools.length) cache[cacheKey] = tools;
  return tools;
}

// Fire-and-forget: record each tool call so we can later rank tools by REAL
// usage. Writes to public.tool_usage via PostgREST with the service role.
async function logUsage(tool: string, ok: boolean, userId: string): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/tool_usage`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}`, prefer: "return=minimal" },
      body: JSON.stringify({ tool, user_id: userId, success: ok }),
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

// A user's per-toolkit tool selection (overrides the curated defaults). Read with
// the service role; absence of a row means "use the curated defaults".
async function userToolPrefs(uid: string): Promise<Record<string, string[]>> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid) return {};
  try {
    const r = await fetch(`${url}/rest/v1/tool_prefs?user_id=eq.${encodeURIComponent(uid)}&select=toolkit,slugs`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!r.ok) return {};
    const rows = await r.json();
    const map: Record<string, string[]> = {};
    for (const row of rows ?? []) if (row?.toolkit && Array.isArray(row.slugs)) map[row.toolkit] = row.slugs;
    return map;
  } catch {
    return {};
  }
}

async function listTools(apps: string[], prefs: Record<string, string[]>): Promise<Tool[]> {
  const toolkits = apps.length ? apps : Object.keys(ALLOWED);
  const out: Tool[] = [];
  for (const tk of toolkits) {
    const enabled = prefs[tk] ?? ALLOWED[tk] ?? []; // user selection or curated default
    out.push(...(await toolsForToolkit(tk, enabled)));
  }
  return out;
}

async function execTool(name: string, args: unknown, userId: string): Promise<string> {
  const res = await fetch(`${BASE}/v3/tools/execute/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: userId, arguments: args ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio execute ${res.status}: ${JSON.stringify(body)}`);
  if (body.successful === false || body.error) throw new Error(String(body.error || "Tool execution failed"));
  const data = body.data ?? body;
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    // Non-sensitive: expose the curated default tool slugs for a toolkit so the
    // connector function can pre-check them in the Manage Tools UI.
    const dflt = new URL(req.url).searchParams.get("defaults");
    if (dflt) {
      return new Response(JSON.stringify({ slugs: ALLOWED[dflt] ?? [] }), { headers: { "content-type": "application/json" } });
    }
    return new Response("Go Farther MCP (Composio-backed)", { status: 200 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  if (auth !== "Bearer " + (await mcpToken())) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const reqUrl = new URL(req.url);
  const apps = (reqUrl.searchParams.get("apps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reqUser = reqUrl.searchParams.get("user") || "";

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
      const prefs = await userToolPrefs(reqUser);
      return J({ jsonrpc: "2.0", id, result: { tools: await listTools(apps, prefs) } });
    } catch (e) {
      return J({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }
  if (method === "tools/call") {
    const p = msg.params || {};
    if (!reqUser) {
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: no user context" }], isError: true } });
    }
    try {
      const text = await execTool(p.name, p.arguments || {}, reqUser);
      await logUsage(p.name, true, reqUser);
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      await logUsage(p.name, false, reqUser);
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
