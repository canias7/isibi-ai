import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { crypto as stdCrypto } from "jsr:@std/crypto"; // for MD5 (WebCrypto lacks it)
import * as XLSX from "npm:xlsx@0.18.5"; // server-side spreadsheet build (deterministic — the model never retypes the data into code)

// Generic MCP server Claude connects to (via the chat function's mcp_servers).
// Slug: `gofarther-mcp`. It proxies MULTIPLE Composio toolkits (Gmail, Calendar,
// Drive, ...) plus built-in memory and read-only bank (Plaid) tools.
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
const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
const PLAID_ENV = (Deno.env.get("PLAID_ENV") || "sandbox").toLowerCase();
const PLAID_BASE = PLAID_ENV === "production" ? "https://production.plaid.com"
  : PLAID_ENV === "development" ? "https://development.plaid.com" : "https://sandbox.plaid.com";
const CATALOG_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-oauth?catalog=";
// Optional: Google Maps Platform key (Places API New + Directions API). When set,
// the GF_MAPS tool is advertised; until then it stays hidden (dormant).
const MAPS_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
// Optional: OpenAI key for image generation. When set, GF_IMAGE is advertised.
// OPENAI_IMAGE_MODEL is the fallback model when the assistant doesn't pick one
// (set it to "dall-e-3" if your org isn't verified for the gpt-image models).
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_IMAGE_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2";

// Per-user MCP auth: callers sign a short-lived token binding the acting user id;
// we verify it here and DERIVE the uid from it, so identity can't be forged via a
// query param. Secret is MCP_SHARED_SECRET if set, else derived (never empty).
async function mcpSecret(): Promise<string> {
  const s = Deno.env.get("MCP_SHARED_SECRET");
  if (s) return s;
  const base = (Deno.env.get("COMPOSIO_API_KEY") ?? "") + "::gofarther-mcp-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function mcpB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function mcpB64urlToBytes(s: string): Uint8Array {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function mcpHmac(msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await mcpSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
// Verify a per-user token; returns its uid, or null if missing/invalid/expired.
async function verifyUserToken(token: string): Promise<string | null> {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = mcpB64url(await mcpHmac(payload));
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i); // constant-time
  if (diff !== 0) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(mcpB64urlToBytes(payload)));
    if (!o || typeof o.u !== "string" || !o.u || typeof o.exp !== "number") return null;
    if (o.exp < Math.floor(Date.now() / 1000)) return null;
    return o.u;
  } catch {
    return null;
  }
}

// RECOMMENDED tools per toolkit (~6 each) — a suggested starting set, NOT
// auto-enabled. Nothing is served until the user opts in (see listTools); this
// list just powers the optional "recommended" hint exposed at ?defaults and can
// later be re-ranked from REAL usage in tool_usage. Unknown slugs are dropped.
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
    // Composio's real Outlook slugs use a double OUTLOOK_OUTLOOK_ prefix.
    "OUTLOOK_OUTLOOK_LIST_MESSAGES",
    "OUTLOOK_OUTLOOK_SEARCH_MESSAGES",
    "OUTLOOK_OUTLOOK_GET_MESSAGE",
    "OUTLOOK_OUTLOOK_SEND_EMAIL",
    "OUTLOOK_OUTLOOK_CREATE_DRAFT",
    "OUTLOOK_OUTLOOK_REPLY_EMAIL",
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

// Built-in (non-Composio) tool: long-term memory. ALWAYS exposed so the model
// can save a fact the user explicitly asks it to remember, in ANY chat, even
// with no connectors. Handled locally (writes to public.user_memory), not via
// Composio. The chat function feeds these memories back into every system prompt.
const MEMORY_TOOL: Tool = {
  name: "GF_SAVE_MEMORY",
  description:
    "Save a fact or preference the user EXPLICITLY asks you to remember about them long-term — e.g. they say \"remember that…\", \"keep in mind…\", \"note that…\", \"from now on…\", \"don't forget…\". Stored to the user's memory and applied across ALL future chats. Use ONLY when the user clearly wants something remembered; do NOT use it for ordinary conversation or for transient, one-off task details. After saving, briefly confirm in plain text.",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "The single fact/preference to remember, rewritten as a concise, self-contained statement (e.g. \"Prefers concise replies\", \"Lives in New York City\", \"Manager is Sarah Chen\"). Omit filler like \"remember that\".",
      },
    },
    required: ["content"],
  },
};

// Persist one memory for the user (service role; RLS-bypassing but scoped to the
// user id Composio/Anthropic passed us in the URL, so users only write their own).
async function saveMemory(uid: string, content: unknown): Promise<string> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid) throw new Error("memory unavailable");
  const c = String(content ?? "").trim().slice(0, 500);
  if (!c) throw new Error("nothing to remember");
  const r = await fetch(`${url}/rest/v1/user_memory`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}`, prefer: "return=minimal" },
    body: JSON.stringify({ user_id: uid, content: c }),
  });
  if (!r.ok) throw new Error(`save failed ${r.status}: ${await r.text().catch(() => "")}`);
  return `Saved to memory: ${c}`;
}

// Built-in tool: hand the model a temporary download URL for a memory's attached
// file, so it can attach/send it via ANY app (email attachment, Slack upload, …)
// without ever handling the bytes. The model reads the target app's send tool
// schema and passes this url into its file/attachment parameter.
const MEMORY_FILE_TOOL: Tool = {
  name: "GF_GET_MEMORY_FILE",
  description:
    "Stage the file attached to one of the user's memories so you can SEND or ATTACH it via another app's tool (e.g. an email's attachment field, or a file-upload action). Call this RIGHT BEFORE the send/attach tool, passing the memory id PLUS the toolkit_slug and tool_slug of the action you're about to use (e.g. toolkit_slug \"gmail\", tool_slug \"GMAIL_SEND_EMAIL\"). Returns JSON {s3key, mimetype, name} — pass that object straight into that tool's attachment/file parameter. (To just show a file to the user, use the gf-memory block instead, not this.)",
  inputSchema: {
    type: "object",
    properties: {
      memory_id: { type: "string", description: "The id of the memory whose attached file you need (from [attachment: …, id: …])." },
      toolkit_slug: { type: "string", description: "Slug of the app you'll attach it in, e.g. \"gmail\", \"outlook\", \"slack\"." },
      tool_slug: { type: "string", description: "Slug of the action you'll call, e.g. \"GMAIL_SEND_EMAIL\", \"SLACK_UPLOAD_FILE\"." },
    },
    required: ["memory_id", "toolkit_slug", "tool_slug"],
  },
};

// Stage a memory's file with Composio (returns the {s3key, mimetype, name} that
// file/attachment params expect): look up the memory (scoped to this user),
// download the bytes, then run Composio's upload-request -> presigned PUT flow.
async function getMemoryFile(uid: string, memoryId: string, toolkitSlug: string, toolSlug: string): Promise<string> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid) throw new Error("memory unavailable");
  const id = String(memoryId ?? "").trim();
  if (!id) throw new Error("missing memory_id");
  const tk = String(toolkitSlug || "gmail").trim();
  const ts = String(toolSlug || "GMAIL_SEND_EMAIL").trim();

  // 1) Find the memory's stored file (RLS-equivalent scoping via user_id).
  const r = await fetch(`${url}/rest/v1/user_memory?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}&select=attachment_path,attachment_name,attachment_type`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`lookup ${r.status}`);
  const rows = await r.json();
  const m = Array.isArray(rows) && rows[0];
  if (!m || !m.attachment_path) throw new Error("that memory has no attached file");
  const name = String(m.attachment_name || (m.attachment_type === "pdf" ? "file.pdf" : "image.jpg"));
  const mimetype = m.attachment_type === "pdf" ? "application/pdf" : m.attachment_type === "image" ? "image/jpeg" : "application/octet-stream";

  // 2) Download the bytes (service role can read the private bucket).
  const path = String(m.attachment_path).split("/").map(encodeURIComponent).join("/");
  const dl = await fetch(`${url}/storage/v1/object/memory/${path}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());

  // 3) Composio upload: request an upload slot, then PUT the bytes to the presigned URL.
  const md5buf = await stdCrypto.subtle.digest("MD5", bytes);
  const md5 = Array.from(new Uint8Array(md5buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const ur = await fetch(`${BASE}/v3/files/upload/request`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ toolkit_slug: tk, tool_slug: ts, filename: name, mimetype, md5 }),
  });
  if (!ur.ok) throw new Error(`upload/request ${ur.status}: ${(await ur.text().catch(() => "")).slice(0, 200)}`);
  const uj = await ur.json();
  const s3key = uj.key;
  const put = uj.new_presigned_url || uj.newPresignedUrl;
  if (!s3key) throw new Error("no s3key from Composio");
  if (put) {
    let pr = await fetch(put, { method: "PUT", headers: { "content-type": mimetype }, body: bytes });
    if (!pr.ok) pr = await fetch(put, { method: "PUT", body: bytes }); // retry without content-type if the presign didn't sign it
    if (!pr.ok) throw new Error(`upload PUT ${pr.status}`);
  }
  return JSON.stringify({ s3key, mimetype, name });
}

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

// Tool schemas for a toolkit's selected slugs (from Composio, kept in order).
// Fetched in parallel batches of 40 so a large selection can't exceed the URL
// length limit (tool_slugs is a query param) or stall on one giant request.
async function toolsForToolkit(toolkit: string, slugs: string[]): Promise<Tool[]> {
  if (!slugs.length) return [];
  const cacheKey = toolkit + ":" + slugs.join(",");
  if (cache[cacheKey]) return cache[cacheKey];
  const batches: string[][] = [];
  for (let i = 0; i < slugs.length; i += 40) batches.push(slugs.slice(i, i + 40));
  const results = await Promise.all(
    batches.map((b) => fetchTools({ tool_slugs: b.join(","), limit: String(b.length) }).catch(() => [] as any[])),
  );
  const bySlug = new Map<string, any>();
  for (const items of results) for (const t of items) bySlug.set(t.slug, t);
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

// A user's per-toolkit tool selection. Read with the service role; absence of a
// row means the app hasn't been customized yet — listTools then defaults it to
// the whole catalog (everything on until the user trims it in Manage Tools).
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

// Full (broken-filtered) catalog slugs for a toolkit — the same list Manage Tools
// shows (from gmail-oauth ?catalog). Used as the default for a connected app the
// user hasn't customized yet: everything on, then they trim it. Cached warm.
const catalogCache: Record<string, string[]> = {};
async function fullCatalogSlugs(toolkit: string): Promise<string[]> {
  if (catalogCache[toolkit]) return catalogCache[toolkit];
  try {
    const r = await fetch(`${CATALOG_URL}${encodeURIComponent(toolkit)}`);
    if (!r.ok) return [];
    const d = await r.json();
    const slugs: string[] = Array.isArray(d.slugs) ? d.slugs : [];
    if (slugs.length) catalogCache[toolkit] = slugs;
    return slugs;
  } catch {
    return [];
  }
}

async function listTools(apps: string[], prefs: Record<string, string[]>, memOn: boolean, bankOn: boolean): Promise<Tool[]> {
  const out: Tool[] = [];
  // The user's saved selection wins. If they haven't customized an app (no row),
  // default to the WHOLE catalog — everything on until they trim it. Build all
  // apps in parallel so a big catalog doesn't stall the tool list.
  const lists = await Promise.all(apps.map(async (tk) => {
    const slugs = prefs[tk] !== undefined ? prefs[tk] : await fullCatalogSlugs(tk);
    return toolsForToolkit(tk, slugs);
  }));
  for (const l of lists) out.push(...l);
  // Long-term memory is available with or without connectors — unless paused
  // (the chat function passes &mem=0 when the user turned the feature off).
  if (memOn) { out.push(MEMORY_TOOL); out.push(MEMORY_FILE_TOOL); }
  if (bankOn) {
    const allBank = [BANK_BALANCES_TOOL, BANK_TRANSACTIONS_TOOL, BANK_RECURRING_TOOL,
      BANK_LIABILITIES_TOOL, BANK_INVESTMENTS_TOOL, BANK_IDENTITY_TOOL,
      BANK_AUTH_TOOL, BANK_INV_TXNS_TOOL, BANK_INSIGHTS_TOOL];
    // Per-tool bank selection (Manage Tools → Plaid), saved under the `plaid`
    // toolkit key by tool name. No row = uncustomized = everything on, exactly
    // like every Composio app; trimming in Manage Tools removes a tool here.
    const pick = prefs["plaid"];
    for (const t of allBank) if (pick === undefined || pick.includes(t.name)) out.push(t);
  }
  // General-purpose built-ins: weather + save-table (keyless) always; maps &
  // image-gen only when their key is set.
  out.push(WEATHER_TOOL);
  out.push(SAVE_TABLE_TOOL);
  if (MAPS_KEY) out.push(MAPS_TOOL);
  if (OPENAI_KEY) out.push(IMAGE_TOOL);
  return out;
}

// The exact set of Composio slugs a user may EXECUTE = what listTools would serve
// for the connected apps (their saved selection, or the full catalog if uncustomized).
// Enforced on tools/call so the model can't reach an un-advertised/destructive slug.
async function allowedSlugs(apps: string[], prefs: Record<string, string[]>): Promise<Set<string>> {
  const lists = await Promise.all(apps.map((tk) => prefs[tk] !== undefined ? Promise.resolve(prefs[tk]) : fullCatalogSlugs(tk)));
  const set = new Set<string>();
  for (const l of lists) for (const s of l) set.add(s);
  return set;
}

async function execTool(name: string, args: unknown, userId: string): Promise<string> {
  const res = await fetch(`${BASE}/v3/tools/execute/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: userId, arguments: args ?? {} }),
  });
  const body = await res.json().catch(() => ({}));

  // Composio caps the size of the response it returns to us. For a SEND/REPLY/
  // upload/draft, the action already happened upstream (e.g. Gmail accepted the
  // email WITH its attachment) — Composio just can't echo the big result back,
  // so it answers 413 "Upstream_PayloadTooLarge". That is NOT a failure: the
  // message was sent. Treat it as success so we never tell the user a delivered
  // email didn't go through. (Reads that legitimately 413 still surface as errors
  // below, so the model can paginate/filter.)
  const eo = body?.error as { code?: number; slug?: string; status?: number } | undefined;
  // Require the SPECIFIC upstream "response too large" marker — it means the action
  // ran but Composio couldn't echo the big result. A bare 413 can be a pre-execution
  // reject (oversized request) where nothing was sent, so don't claim success on it.
  const ranButTooLarge = !!(eo && (eo.code === 1613 || eo.slug === "Upstream_PayloadTooLarge"));
  const isMutation = /SEND|REPLY|UPLOAD|CREATE_[A-Z_]*DRAFT/.test(name.toUpperCase());
  if (ranButTooLarge && isMutation) {
    return "Done — it completed successfully. (The provider returned more confirmation detail than could be included, but the action went through.)";
  }

  if (!res.ok) throw new Error(`Composio execute ${res.status}: ${JSON.stringify(body)}`);
  if (body.successful === false || body.error) throw new Error(String(body.error || "Tool execution failed"));
  const data = body.data ?? body;
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

// ---- Plaid bank tools (READ-ONLY), scoped to the verified user. Tokens decrypt
// with the same AES-GCM scheme the `plaid` function uses to store them. ----
function pb64ToBytes(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function plaidDecToken(stored: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  const raw = Deno.env.get("PLAID_ENC_KEY");
  if (!raw || raw.length < 64) throw new Error("ENC_KEY_MISSING");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const [, ivb, ctb] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: pb64ToBytes(ivb) }, key, pb64ToBytes(ctb));
  return new TextDecoder().decode(pt);
}
async function plaidCall(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_code || `HTTP_${res.status}`);
  return data;
}
async function plaidItems(uid: string): Promise<any[]> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid) return [];
  try {
    const r = await fetch(`${url}/rest/v1/plaid_items?user_id=eq.${encodeURIComponent(uid)}&select=item_id,access_token,institution_name`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function userHasBanks(uid: string): Promise<boolean> {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) return false;
  return (await plaidItems(uid)).length > 0;
}

// ---- Data handles: route the data AROUND the model -------------------------
// A bank read returns its result as text for the model to reason over, AND the
// same data as structured rows which we stash server-side under a handle id.
// When the user wants the data as a file, the model passes just the handle to
// GF_SAVE_TABLE and the file is built from THIS stash — the values never pass
// back through the model, so a dropped row or wrong total can't happen.
type BankTable = { label: string; source: string; columns: string[]; rows: (string | number)[][]; totalColumns: number[] };
type BankResult = { text: string; tables?: BankTable[] };

async function stashTable(uid: string, t: BankTable): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid || !t.rows.length) return null;
  try {
    const auth = { apikey: key, authorization: `Bearer ${key}` };
    // Opportunistic TTL cleanup (fire-and-forget): drop stashes older than 2h.
    fetch(`${url}/rest/v1/tool_data_stash?created_at=lt.${encodeURIComponent(new Date(Date.now() - 2 * 3600 * 1000).toISOString())}`, { method: "DELETE", headers: auth }).catch(() => {});
    const r = await fetch(`${url}/rest/v1/tool_data_stash`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ user_id: uid, source: t.source, columns: t.columns, rows: t.rows.slice(0, 5000), total_columns: t.totalColumns }),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    return typeof id === "string" ? id : null;
  } catch { return null; }
}
async function loadStash(uid: string, id: string): Promise<{ source: string; columns: string[]; rows: (string | number)[][]; totalColumns: number[]; raw: unknown } | null> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const r = await fetch(`${url}/rest/v1/tool_data_stash?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}&select=source,columns,rows,total_columns,raw`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const m = Array.isArray(rows) && rows[0];
    if (!m || !Array.isArray(m.columns) || !Array.isArray(m.rows)) return null;
    return { source: String(m.source || "Sheet"), columns: m.columns, rows: m.rows, totalColumns: Array.isArray(m.total_columns) ? m.total_columns : [], raw: m.raw ?? null };
  } catch { return null; }
}

// ---- Connector data (Phase 2): stash the RAW Composio result so the model can
// export it by mapping fields->columns, never retyping the values. ------------
// Stash a raw JSON result under a handle (columns/rows empty; `raw` carries it).
async function stashRaw(uid: string, source: string, raw: unknown): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !uid) return null;
  try {
    const auth = { apikey: key, authorization: `Bearer ${key}` };
    fetch(`${url}/rest/v1/tool_data_stash?created_at=lt.${encodeURIComponent(new Date(Date.now() - 2 * 3600 * 1000).toISOString())}`, { method: "DELETE", headers: auth }).catch(() => {});
    const r = await fetch(`${url}/rest/v1/tool_data_stash`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ user_id: uid, source, columns: [], rows: [], total_columns: [], raw }),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    return typeof id === "string" ? id : null;
  } catch { return null; }
}
function tryParseJson(text: string): unknown {
  try { const v = JSON.parse(text); return (v && typeof v === "object") ? v : null; } catch { return null; }
}
// Walk a dot-path (e.g. "customer.email") into a record; returns a primitive or "".
function getPath(rec: unknown, path: string): unknown {
  let cur: any = rec;
  for (const part of String(path || "").split(".")) {
    if (cur == null || typeof cur !== "object") return "";
    cur = cur[part];
  }
  return cur == null || typeof cur === "object" ? "" : cur;
}
// Find the array of record-objects in a Composio result, plus its dot-path: tries
// common keys first, else the largest array-of-objects within a few levels.
function detectRecords(raw: unknown): { path: string; records: any[] } | null {
  if (Array.isArray(raw) && raw.some((x) => x && typeof x === "object")) return { path: "", records: raw };
  if (!raw || typeof raw !== "object") return null;
  const prefer = new Set(["data", "items", "results", "records", "messages", "transactions", "charges", "value", "rows", "list"]);
  let best: { path: string; records: any[] } | null = null;
  let stop = false;
  const visit = (obj: any, base: string, depth: number) => {
    if (stop || !obj || typeof obj !== "object" || depth > 4) return;
    for (const k of Object.keys(obj)) {
      if (stop) return;
      const v = obj[k];
      const path = base ? `${base}.${k}` : k;
      if (Array.isArray(v) && v.some((x) => x && typeof x === "object" && !Array.isArray(x))) {
        if (prefer.has(k)) { best = { path, records: v }; stop = true; return; } // strong match
        if (!best || v.length > best.records.length) best = { path, records: v };
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        visit(v, path, depth + 1);
      }
    }
  };
  visit(raw, "", 0);
  return best;
}
async function bankBalances(uid: string): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const lines: string[] = [];
  const rows: (string | number)[][] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/accounts/balance/get", { access_token: at });
      for (const a of (d.accounts || [])) {
        const c = a.balances?.iso_currency_code || "USD";
        lines.push(`${it.institution_name || "Bank"} — ${a.name}${a.mask ? ` (••${a.mask})` : ""} [${a.subtype || a.type}]: current ${c} ${a.balances?.current ?? "?"}${a.balances?.available != null ? `, available ${c} ${a.balances.available}` : ""}`);
        rows.push([it.institution_name || "Bank", `${a.name}${a.mask ? ` ••${a.mask}` : ""}`, String(a.subtype || a.type || ""), c, Number(a.balances?.current ?? 0), a.balances?.available != null ? Number(a.balances.available) : ""]);
      }
    } catch (e) { lines.push(`${it.institution_name || "Bank"}: couldn't read (${String((e as Error).message)})`); }
  }
  const text = lines.join("\n") || "No accounts found.";
  if (!rows.length) return { text };
  return { text, tables: [{ label: "account balances", source: "Balances", columns: ["Bank", "Account", "Type", "Currency", "Current", "Available"], rows, totalColumns: [4] }] };
}
async function bankTransactions(uid: string, count: number): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const n = Math.min(Math.max(count || 50, 1), 200);
  const recs: { date: string; line: string; row: (string | number)[] | null }[] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/transactions/sync", { access_token: at, count: n });
      for (const t of (d.added || [])) {
        const cat = t.personal_finance_category?.primary || (Array.isArray(t.category) ? t.category.join("/") : "");
        recs.push({
          date: t.date || "",
          line: `${t.date} | ${it.institution_name || "Bank"} | ${t.name} | ${t.iso_currency_code || "USD"} ${t.amount}${cat ? ` | ${cat}` : ""}${t.pending ? " | pending" : ""}`,
          row: [String(t.date || ""), it.institution_name || "Bank", String(t.name ?? ""), Number(t.amount ?? 0), t.iso_currency_code || "USD", cat, t.pending ? "yes" : ""],
        });
      }
    } catch (e) { recs.push({ date: "", line: `${it.institution_name || "Bank"}: couldn't read (${String((e as Error).message)})`, row: null }); }
  }
  if (!recs.length) return { text: "No transactions yet — a freshly linked bank can take a few minutes to import history." };
  recs.sort((a, b) => b.date.localeCompare(a.date));
  const top = recs.slice(0, n);
  const text = "amounts: positive = money out (spending), negative = money in.\ndate | bank | merchant | amount | category\n" + top.map((r) => r.line).join("\n");
  const rows = top.map((r) => r.row).filter((r): r is (string | number)[] => !!r);
  if (!rows.length) return { text };
  return { text, tables: [{ label: "transactions", source: "Transactions", columns: ["Date", "Bank", "Merchant", "Amount", "Currency", "Category", "Pending"], rows, totalColumns: [3] }] };
}
// Friendly mapping for product-scope errors (liabilities/investments/identity not
// granted yet → the user needs to re-link to consent to that data).
function bankErr(e: unknown): string {
  const m = String((e as Error)?.message || "");
  if (/NOT_AUTHORIZED|NOT_SUPPORTED|INVALID_PRODUCT|CONSENT|ADDITIONAL/.test(m)) return "needs a re-link to enable this data (Banks → Unlink → Link again).";
  if (/NOT_READY/.test(m)) return "still importing — try again in a minute.";
  return `couldn't read (${m})`;
}
async function bankRecurring(uid: string): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const out: string[] = [];
  const subRows: (string | number)[][] = [];
  const incRows: (string | number)[][] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/transactions/recurring/get", { access_token: at });
      const fmt = (s: any) => `${s.merchant_name || s.description || "?"}: ${s.average_amount?.iso_currency_code || "USD"} ${s.average_amount?.amount ?? "?"} ${s.frequency || ""}`;
      const subsAll = (d.outflow_streams || []).filter((s: any) => s.is_active !== false);
      const incAll = (d.inflow_streams || []).filter((s: any) => s.is_active !== false);
      const subs = subsAll.map(fmt);
      const inc = incAll.map(fmt);
      for (const s of subsAll) subRows.push([it.institution_name || "Bank", String(s.merchant_name || s.description || "?"), Number(s.average_amount?.amount ?? 0), s.average_amount?.iso_currency_code || "USD", String(s.frequency || "")]);
      for (const s of incAll) incRows.push([it.institution_name || "Bank", String(s.merchant_name || s.description || "?"), Number(s.average_amount?.amount ?? 0), s.average_amount?.iso_currency_code || "USD", String(s.frequency || "")]);
      out.push(`${it.institution_name || "Bank"}\n  Subscriptions/recurring bills:${subs.length ? "\n   - " + subs.join("\n   - ") : " none"}\n  Recurring income:${inc.length ? "\n   - " + inc.join("\n   - ") : " none"}`);
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  const tables: BankTable[] = [];
  const cols = ["Bank", "Name", "Amount", "Currency", "Frequency"];
  if (subRows.length) tables.push({ label: "subscriptions & recurring bills", source: "Subscriptions", columns: cols, rows: subRows, totalColumns: [2] });
  if (incRows.length) tables.push({ label: "recurring income", source: "Recurring Income", columns: cols, rows: incRows, totalColumns: [2] });
  return { text: out.join("\n"), ...(tables.length ? { tables } : {}) };
}
async function bankLiabilities(uid: string): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const out: string[] = [];
  const rows: (string | number)[][] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/liabilities/get", { access_token: at });
      const nm = new Map<string, string>((d.accounts || []).map((a: any) => [a.account_id, `${a.name}${a.mask ? ` ••${a.mask}` : ""}`]));
      const L = d.liabilities || {};
      for (const c of (L.credit || [])) {
        const apr = (c.aprs || []).map((a: any) => `${a.apr_percentage}%`).join("/");
        out.push(`${it.institution_name || "Bank"} credit card ${nm.get(c.account_id) || ""}: statement ${c.last_statement_balance ?? "?"}, min ${c.minimum_payment_amount ?? "?"}, due ${c.next_payment_due_date || "?"}${apr ? `, APR ${apr}` : ""}${c.is_overdue ? " (OVERDUE)" : ""}`);
        rows.push([it.institution_name || "Bank", "Credit card", nm.get(c.account_id) || "", Number(c.last_statement_balance ?? 0), Number(c.minimum_payment_amount ?? 0), String(c.next_payment_due_date || ""), apr, c.is_overdue ? "yes" : ""]);
      }
      for (const s of (L.student || [])) {
        out.push(`${it.institution_name || "Bank"} student loan ${nm.get(s.account_id) || ""}: due ${s.next_payment_due_date || "?"}, min ${s.minimum_payment_amount ?? "?"}`);
        rows.push([it.institution_name || "Bank", "Student loan", nm.get(s.account_id) || "", "", Number(s.minimum_payment_amount ?? 0), String(s.next_payment_due_date || ""), "", ""]);
      }
      for (const mo of (L.mortgage || [])) {
        out.push(`${it.institution_name || "Bank"} mortgage ${nm.get(mo.account_id) || ""}: due ${mo.next_payment_due_date || "?"}, rate ${mo.interest_rate?.percentage ?? "?"}%`);
        rows.push([it.institution_name || "Bank", "Mortgage", nm.get(mo.account_id) || "", "", "", String(mo.next_payment_due_date || ""), mo.interest_rate?.percentage != null ? `${mo.interest_rate.percentage}%` : "", ""]);
      }
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  const text = out.join("\n") || "No credit cards or loans found on the linked accounts.";
  if (!rows.length) return { text };
  return { text, tables: [{ label: "cards & loans", source: "Cards and Loans", columns: ["Bank", "Type", "Account", "Statement Balance", "Min Payment", "Due Date", "APR/Rate", "Overdue"], rows, totalColumns: [] }] };
}
async function bankInvestments(uid: string): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const out: string[] = [];
  const rows: (string | number)[][] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/investments/holdings/get", { access_token: at });
      const sec = new Map<string, any>((d.securities || []).map((s: any) => [s.security_id, s]));
      const nm = new Map<string, string>((d.accounts || []).map((a: any) => [a.account_id, `${a.name}${a.mask ? ` ••${a.mask}` : ""}`]));
      for (const h of (d.holdings || [])) {
        const s = sec.get(h.security_id) || {};
        out.push(`${it.institution_name || "Bank"} ${nm.get(h.account_id) || ""}: ${s.ticker_symbol || s.name || "?"} x${h.quantity} = ${h.iso_currency_code || "USD"} ${h.institution_value ?? "?"}`);
        rows.push([it.institution_name || "Bank", nm.get(h.account_id) || "", String(s.name || ""), String(s.ticker_symbol || ""), Number(h.quantity ?? 0), Number(h.institution_value ?? 0), h.iso_currency_code || "USD"]);
      }
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  const text = out.join("\n") || "No investment holdings found.";
  if (!rows.length) return { text };
  return { text, tables: [{ label: "investment holdings", source: "Holdings", columns: ["Bank", "Account", "Security", "Ticker", "Quantity", "Value", "Currency"], rows, totalColumns: [5] }] };
}
async function bankIdentity(uid: string): Promise<string> {
  const items = await plaidItems(uid);
  if (!items.length) return "No bank accounts are linked.";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/identity/get", { access_token: at });
      for (const a of (d.accounts || [])) for (const o of (a.owners || [])) {
        const name = (o.names || []).join(", ");
        const email = (o.emails || []).map((x: any) => x.data).join(", ");
        const phone = (o.phone_numbers || []).map((x: any) => x.data).join(", ");
        const addr = (o.addresses || []).map((x: any) => [x.data?.street, x.data?.city, x.data?.region, x.data?.postal_code].filter(Boolean).join(" ")).join("; ");
        const line = `${it.institution_name || "Bank"} — ${name}${email ? ` | ${email}` : ""}${phone ? ` | ${phone}` : ""}${addr ? ` | ${addr}` : ""}`;
        if (!seen.has(line)) { seen.add(line); out.push(line); }
      }
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  return out.join("\n") || "No identity info found.";
}
function isoDaysAgo(days: number): string { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
async function getTxnsRange(at: string, days: number): Promise<any[]> {
  const d = await plaidCall("/transactions/get", { access_token: at, start_date: isoDaysAgo(days), end_date: isoToday(), options: { count: 500, offset: 0 } });
  return d.transactions || [];
}
async function bankAuth(uid: string): Promise<string> {
  const items = await plaidItems(uid);
  if (!items.length) return "No bank accounts are linked.";
  const out: string[] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/auth/get", { access_token: at });
      const nm = new Map<string, string>((d.accounts || []).map((a: any) => [a.account_id, `${a.name}${a.mask ? ` ••${a.mask}` : ""}`]));
      for (const n of (d.numbers?.ach || [])) out.push(`${it.institution_name || "Bank"} ${nm.get(n.account_id) || ""}: routing ${n.routing}, account ${n.account}`);
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  return out.join("\n") || "No account/routing numbers available.";
}
async function bankInvestmentTxns(uid: string, days: number): Promise<BankResult> {
  const items = await plaidItems(uid);
  if (!items.length) return { text: "No bank accounts are linked." };
  const out: string[] = [];
  const rows: (string | number)[][] = [];
  for (const it of items) {
    try {
      const at = await plaidDecToken(it.access_token);
      const d = await plaidCall("/investments/transactions/get", { access_token: at, start_date: isoDaysAgo(days || 90), end_date: isoToday() });
      const sec = new Map<string, any>((d.securities || []).map((s: any) => [s.security_id, s]));
      for (const t of (d.investment_transactions || [])) {
        const s = sec.get(t.security_id) || {};
        out.push(`${t.date} | ${it.institution_name || "Bank"} | ${t.type}${t.subtype ? "/" + t.subtype : ""} | ${s.ticker_symbol || s.name || t.name || "?"} | qty ${t.quantity ?? "?"} | ${t.iso_currency_code || "USD"} ${t.amount}`);
        rows.push([String(t.date || ""), it.institution_name || "Bank", `${t.type}${t.subtype ? "/" + t.subtype : ""}`, String(s.ticker_symbol || s.name || t.name || "?"), Number(t.quantity ?? 0), Number(t.amount ?? 0), t.iso_currency_code || "USD"]);
      }
    } catch (e) { out.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
  }
  const text = out.length ? "date | bank | type | security | qty | amount\n" + out.join("\n") : "No investment transactions found.";
  if (!rows.length) return { text };
  return { text, tables: [{ label: "investment activity", source: "Investment Activity", columns: ["Date", "Bank", "Type", "Security", "Quantity", "Amount", "Currency"], rows, totalColumns: [5] }] };
}
async function bankInsights(uid: string, mode: string, days: number): Promise<string> {
  const items = await plaidItems(uid);
  if (!items.length) return "No bank accounts are linked.";
  const win = days && days > 0 ? days : 30;
  if (mode === "net_worth") {
    let assets = 0, debts = 0; const errs: string[] = [];
    for (const it of items) {
      try {
        const at = await plaidDecToken(it.access_token);
        const d = await plaidCall("/accounts/balance/get", { access_token: at });
        for (const a of (d.accounts || [])) {
          const bal = Number(a.balances?.current ?? 0);
          if (a.type === "credit" || a.type === "loan") debts += bal; else assets += bal;
        }
      } catch (e) { errs.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
    }
    return `Net worth ≈ USD ${(assets - debts).toFixed(2)} (assets ${assets.toFixed(2)} − debts ${debts.toFixed(2)})${errs.length ? "\n" + errs.join("\n") : ""}`;
  }
  if (mode === "spending" || mode === "cash_flow") {
    let inflow = 0, outflow = 0; const byCat: Record<string, number> = {}; const errs: string[] = [];
    for (const it of items) {
      try {
        const at = await plaidDecToken(it.access_token);
        for (const t of await getTxnsRange(at, win)) {
          const amt = Number(t.amount) || 0;
          if (amt >= 0) { outflow += amt; const c = t.personal_finance_category?.primary || (Array.isArray(t.category) ? t.category[0] : "Other"); byCat[c] = (byCat[c] || 0) + amt; }
          else inflow += -amt;
        }
      } catch (e) { errs.push(`${it.institution_name || "Bank"}: ${bankErr(e)}`); }
    }
    if (mode === "cash_flow") return `Last ${win} days — in: USD ${inflow.toFixed(2)}, out: USD ${outflow.toFixed(2)}, net: USD ${(inflow - outflow).toFixed(2)}${errs.length ? "\n" + errs.join("\n") : ""}`;
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `  ${c}: USD ${v.toFixed(2)}`);
    return `Spending by category, last ${win} days (total USD ${outflow.toFixed(2)}):\n${cats.join("\n") || "  (none)"}${errs.length ? "\n" + errs.join("\n") : ""}`;
  }
  if (mode === "upcoming_bills") {
    const bills: string[] = [];
    for (const it of items) {
      try {
        const at = await plaidDecToken(it.access_token);
        try {
          const r = await plaidCall("/transactions/recurring/get", { access_token: at });
          for (const s of (r.outflow_streams || [])) if (s.is_active !== false) bills.push(`${s.merchant_name || s.description || "?"}: ~USD ${s.average_amount?.amount ?? "?"} ${s.frequency || ""} (recurring)`);
        } catch { /* recurring optional */ }
        try {
          const l = await plaidCall("/liabilities/get", { access_token: at });
          for (const c of (l.liabilities?.credit || [])) if (c.next_payment_due_date) bills.push(`Credit card due ${c.next_payment_due_date}: min USD ${c.minimum_payment_amount ?? "?"}`);
          for (const m of (l.liabilities?.mortgage || [])) if (m.next_payment_due_date) bills.push(`Mortgage due ${m.next_payment_due_date}`);
          for (const s of (l.liabilities?.student || [])) if (s.next_payment_due_date) bills.push(`Student loan due ${s.next_payment_due_date}: min USD ${s.minimum_payment_amount ?? "?"}`);
        } catch { /* liabilities needs re-link */ }
      } catch { /* skip item */ }
    }
    return bills.length ? "Upcoming bills:\n - " + bills.join("\n - ") : "No upcoming bills detected yet (needs recurring detection or a linked card/loan).";
  }
  return "Unknown insight. Use mode: net_worth, spending, cash_flow, or upcoming_bills.";
}
const BANK_BALANCES_TOOL: Tool = {
  name: "GF_BANK_BALANCES",
  description: "Get the user's linked bank account balances in real time (their REAL bank, via Plaid). Use when the user asks about their balance, how much money they have, or available funds. Read-only — cannot move money.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_TRANSACTIONS_TOOL: Tool = {
  name: "GF_BANK_TRANSACTIONS",
  description: "Get the user's recent REAL bank transactions (date, merchant, amount, category) from their linked bank via Plaid. Use for spending questions, recent activity, or finding recurring charges/subscriptions. Amounts: POSITIVE = money out (spending), NEGATIVE = money in. Read-only.",
  inputSchema: { type: "object", properties: { count: { type: "integer", description: "How many recent transactions to fetch (default 50, max 200)." } } },
};
const BANK_RECURRING_TOOL: Tool = {
  name: "GF_BANK_RECURRING",
  description: "Detect the user's recurring bank activity — subscriptions & recurring bills (outflows) and recurring income like paychecks (inflows), with merchant, amount, and frequency. Use for 'my subscriptions', 'recurring bills', 'when/how much do I get paid'. Read-only.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_LIABILITIES_TOOL: Tool = {
  name: "GF_BANK_LIABILITIES",
  description: "Get the user's credit cards (statement balance, minimum payment, due date, APR, overdue), student loans, and mortgages from their linked bank. Use for 'when is my card due', 'my APR', 'loan/mortgage details'. Read-only.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_INVESTMENTS_TOOL: Tool = {
  name: "GF_BANK_INVESTMENTS",
  description: "Get the user's investment holdings (ticker, quantity, value) from linked brokerage accounts. Use for 'my portfolio', 'what do I hold'. Read-only.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_IDENTITY_TOOL: Tool = {
  name: "GF_BANK_IDENTITY",
  description: "Get the account-holder identity on file at the user's bank (name, email, phone, address). Use when the user asks what contact info their bank has on file. Read-only.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_AUTH_TOOL: Tool = {
  name: "GF_BANK_AUTH",
  description: "Get the user's account and routing numbers for their linked bank accounts (for direct deposit / ACH setup). Read-only.",
  inputSchema: { type: "object", properties: {} },
};
const BANK_INV_TXNS_TOOL: Tool = {
  name: "GF_BANK_INVESTMENT_TRANSACTIONS",
  description: "Get the user's investment activity — buys, sells, dividends — from linked brokerage accounts (date, type, security, quantity, amount). Read-only.",
  inputSchema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (default 90)." } } },
};
const BANK_INSIGHTS_TOOL: Tool = {
  name: "GF_BANK_INSIGHTS",
  description: "Computed money insights from the user's linked accounts (no re-link needed). mode='net_worth' (assets minus debts across accounts), 'spending' (totals by category over a window), 'cash_flow' (money in vs out), 'upcoming_bills' (due dates from recurring + liabilities). Read-only.",
  inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["net_worth", "spending", "cash_flow", "upcoming_bills"] }, days: { type: "integer", description: "Window in days for spending/cash_flow (default 30)." } }, required: ["mode"] },
};

// ---- Weather (Open-Meteo, keyless) -----------------------------------------
// WMO weather codes -> short descriptions (https://open-meteo.com/en/docs).
const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
async function weatherLookup(location: string, units: string): Promise<string> {
  const loc = String(location || "").trim();
  if (!loc) return "Please provide a place name (e.g. a city).";
  const tempUnit = units === "celsius" ? "celsius" : "fahrenheit";
  const windUnit = units === "celsius" ? "kmh" : "mph";
  const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=en&format=json`);
  const gj = await g.json().catch(() => ({}));
  const place = (gj?.results || [])[0];
  if (!place) return `Couldn't find a place called "${loc}".`;
  const where = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(place.latitude));
  u.searchParams.set("longitude", String(place.longitude));
  u.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
  u.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  u.searchParams.set("timezone", "auto");
  u.searchParams.set("forecast_days", "7");
  u.searchParams.set("temperature_unit", tempUnit);
  u.searchParams.set("wind_speed_unit", windUnit);
  const f = await fetch(u.toString());
  const fj = await f.json().catch(() => ({}));
  const c = fj?.current;
  if (!c) return `Couldn't get the weather for ${where} right now.`;
  const tU = fj.current_units?.temperature_2m || "°";
  const wU = fj.current_units?.wind_speed_10m || "";
  const pU = fj.current_units?.precipitation || "mm";
  const lines: string[] = [];
  lines.push(`Weather for ${where} (local time ${c.time}):`);
  lines.push(`Now: ${WMO[c.weather_code] ?? `code ${c.weather_code}`}, ${c.temperature_2m}${tU} (feels ${c.apparent_temperature}${tU}), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} ${wU}, precip ${c.precipitation} ${pU}.`);
  const d = fj.daily;
  if (d?.time?.length) {
    lines.push("Forecast:");
    for (let i = 0; i < d.time.length; i++) {
      lines.push(`  ${d.time[i]}: ${WMO[d.weather_code[i]] ?? `code ${d.weather_code[i]}`}, high ${d.temperature_2m_max[i]}${tU} / low ${d.temperature_2m_min[i]}${tU}, precip chance ${d.precipitation_probability_max?.[i] ?? "?"}%`);
    }
  }
  return lines.join("\n");
}
const WEATHER_TOOL: Tool = {
  name: "GF_WEATHER",
  description: "Get current weather and a 7-day forecast for any place by name (city, town, or 'City, Region'). Use for 'what's the weather', 'will it rain', 'forecast for …'. No setup needed; works worldwide.",
  inputSchema: { type: "object", properties: {
    location: { type: "string", description: "Place name, e.g. 'Paris', 'Austin, TX', 'Tokyo'." },
    units: { type: "string", enum: ["fahrenheit", "celsius"], description: "Temperature units (default fahrenheit)." },
  }, required: ["location"] },
};

// ---- Maps (Google Maps Platform; only when GOOGLE_MAPS_API_KEY is set) ------
async function mapsPlaces(query: string, near: string, openNow: boolean): Promise<string> {
  const q = String(query || "").trim();
  if (!q) return "Please say what to search for (e.g. 'coffee shop').";
  const body: Record<string, unknown> = { textQuery: near ? `${q} near ${near}` : q, maxResultCount: 8 };
  if (openNow) body.openNow = true;
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": MAPS_KEY!,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.priceLevel,places.nationalPhoneNumber,places.websiteUri",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return `Maps error: ${j?.error?.message || `HTTP ${r.status}`}. (Ensure "Places API (New)" is enabled for the key.)`;
  const places = j.places || [];
  if (!places.length) return `No places found for "${q}"${near ? ` near ${near}` : ""}.`;
  return places.map((p: any) => {
    const nm = p.displayName?.text || "?";
    const rt = p.rating ? ` — ${p.rating}★ (${p.userRatingCount || 0})` : "";
    const open = p.currentOpeningHours?.openNow === true ? " — open now" : p.currentOpeningHours?.openNow === false ? " — closed" : "";
    const price = typeof p.priceLevel === "string" ? ` — ${p.priceLevel.replace("PRICE_LEVEL_", "").toLowerCase().replace(/_/g, " ")}` : "";
    const phone = p.nationalPhoneNumber ? ` | ${p.nationalPhoneNumber}` : "";
    const web = p.websiteUri ? ` | ${p.websiteUri}` : "";
    return `${nm}${rt}${open}${price}\n  ${p.formattedAddress || ""}${phone}${web}`;
  }).join("\n");
}
async function mapsDirections(origin: string, destination: string, travelMode: string): Promise<string> {
  const o = String(origin || "").trim(), dst = String(destination || "").trim();
  if (!o || !dst) return "Please give both an origin and a destination.";
  const mode = ["driving", "walking", "bicycling", "transit"].includes(travelMode) ? travelMode : "driving";
  const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
  u.searchParams.set("origin", o);
  u.searchParams.set("destination", dst);
  u.searchParams.set("mode", mode);
  u.searchParams.set("key", MAPS_KEY!);
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (j.status !== "OK") return `Maps error: ${j.error_message || j.status || `HTTP ${r.status}`}. (Ensure the "Directions API" is enabled for the key.)`;
  const leg = j.routes?.[0]?.legs?.[0];
  if (!leg) return "No route found.";
  const steps = (leg.steps || []).map((s: any, i: number) => `  ${i + 1}. ${String(s.html_instructions || "").replace(/<[^>]+>/g, "")} (${s.distance?.text || ""})`).join("\n");
  return `${mode} from ${leg.start_address} to ${leg.end_address}:\nDistance ${leg.distance?.text}, about ${leg.duration?.text}.\n${steps}`;
}
async function mapsTool(args: any): Promise<string> {
  if (!MAPS_KEY) return "Maps isn't configured on the server yet.";
  const mode = String(args?.mode || "");
  if (mode === "places") return await mapsPlaces(args?.query, args?.near, !!args?.open_now);
  if (mode === "directions") return await mapsDirections(args?.origin, args?.destination, String(args?.travel_mode || "driving"));
  return "Unknown maps mode. Use 'places' or 'directions'.";
}
const MAPS_TOOL: Tool = {
  name: "GF_MAPS",
  description: "Find places or get directions with Google Maps. mode='places' searches businesses/points of interest (set query, e.g. 'sushi restaurant', and optional near, e.g. 'Soho, NYC'; open_now to filter to open); mode='directions' returns a route between origin and destination (optional travel_mode driving/walking/bicycling/transit). Use for 'find a … near …', 'directions from … to …', 'how long to drive from … to …'.",
  inputSchema: { type: "object", properties: {
    mode: { type: "string", enum: ["places", "directions"] },
    query: { type: "string", description: "What to search for (places mode), e.g. 'pharmacy'." },
    near: { type: "string", description: "Where to search near (places mode), e.g. 'Austin, TX'." },
    open_now: { type: "boolean", description: "Only return places open now (places mode)." },
    origin: { type: "string", description: "Start address/place (directions mode)." },
    destination: { type: "string", description: "End address/place (directions mode)." },
    travel_mode: { type: "string", enum: ["driving", "walking", "bicycling", "transit"], description: "Travel mode (directions mode, default driving)." },
  }, required: ["mode"] },
};

// ---- Image generation (OpenAI; only when OPENAI_API_KEY is set) -------------
// Store generated PNG bytes in the private chat-files bucket and return a long-
// lived signed URL the chat renders inline.
async function stashImage(uid: string, bytes: Uint8Array): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const objKey = `${uid}/img/${crypto.randomUUID()}.png`;
    const auth = { apikey: key, authorization: `Bearer ${key}` };
    const up = await fetch(`${url}/storage/v1/object/chat-files/${objKey}`, {
      method: "POST", headers: { ...auth, "content-type": "image/png", "x-upsert": "true" }, body: bytes,
    });
    if (!up.ok) { console.error("img stash", up.status, (await up.text().catch(() => "")).slice(0, 120)); return null; }
    const sign = await fetch(`${url}/storage/v1/object/sign/chat-files/${objKey}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 31536000 }),
    });
    if (!sign.ok) return null;
    const sj = await sign.json();
    const signed = String(sj?.signedURL ?? sj?.signedUrl ?? "");
    return signed ? `${url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
  } catch (e) { console.error("stashImage", e); return null; }
}
// Call OpenAI's image API (model chosen by the assistant), host the results.
async function generateImages(uid: string, prompt: string, model: string, size: string, n: number): Promise<string[]> {
  const m = model || OPENAI_IMAGE_MODEL;
  const body: Record<string, unknown> = { model: m, prompt, n: m === "dall-e-3" ? 1 : Math.min(Math.max(n || 1, 1), 4) };
  if (size) body.size = size;
  if (m.startsWith("dall-e")) body.response_format = "b64_json"; // the gpt-image family returns b64 already (and rejects this param)
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${r.status}`);
  const urls: string[] = [];
  for (const d of (j?.data || [])) {
    const b64 = d?.b64_json;
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const u = await stashImage(uid, bytes);
    if (u) urls.push(u);
  }
  return urls;
}
async function imageTool(uid: string, args: any): Promise<string> {
  if (!OPENAI_KEY) return "Image generation isn't configured on the server yet.";
  const prompt = String(args?.prompt || "").trim();
  if (!prompt) return "Please describe the image to generate.";
  try {
    const urls = await generateImages(uid, prompt, String(args?.model || ""), String(args?.size || ""), Number(args?.n) || 1);
    if (!urls.length) return "The image couldn't be generated.";
    const blocks = urls.map((u) => "```gf-image\n" + JSON.stringify({ url: u }) + "\n```").join("\n");
    return `Image ready. Show it to the user by replying with the following block(s) exactly (a short caption before them is fine, but do NOT write the URL as text):\n${blocks}`;
  } catch (e) {
    return `Couldn't generate the image: ${String((e as Error).message)}`;
  }
}
const IMAGE_TOOL: Tool = {
  name: "GF_IMAGE",
  description: "Generate an image from a text description (OpenAI). Choose the model that fits the request: \"gpt-image-2\" (default — latest, highest quality and prompt-fidelity, best for detailed/photorealistic scenes or text in the image), \"gpt-image-1-mini\" (cheaper/faster gpt-image), \"dall-e-3\" (vivid, artistic/stylized), or \"dall-e-2\" (cheapest; fine for simple or draft images and multiple variations). gpt-image-1 and gpt-image-1.5 are also valid model ids. Use ONLY when the user asks to create/generate/draw/make an image or picture. After it runs, show the image to the user exactly as the tool result instructs (a gf-image block) — never write the image URL as plain text.",
  inputSchema: { type: "object", properties: {
    prompt: { type: "string", description: "A vivid, detailed description of the image to create." },
    model: { type: "string", description: "Image model id, chosen for the request: gpt-image-2 (default), gpt-image-1-mini, gpt-image-1, gpt-image-1.5, dall-e-3, or dall-e-2." },
    size: { type: "string", description: "Size: 1024x1024 (square), 1536x1024 / 1024x1536 (gpt-image-1 landscape/portrait), or 1792x1024 / 1024x1792 (dall-e-3)." },
    n: { type: "integer", description: "Number of images, 1-4 (only gpt-image-1 and dall-e-2 support more than 1)." },
  }, required: ["prompt"] },
};

// ---- Spreadsheet/CSV export (server-built, so totals + formatting are exact) ----
// The model hands over the rows; WE build the file in code — columns sized to fit,
// and any TOTAL row computed with real arithmetic — so a hand-typed/miscounted
// total or cramped columns simply can't happen. (The model could still omit a row
// it didn't pass, but it never does the math or the layout.)
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsvBytes(aoa: unknown[][]): Uint8Array {
  const csv = aoa.map((r) => (Array.isArray(r) ? r : [r]).map(csvCell).join(",")).join("\r\n");
  return new TextEncoder().encode("\uFEFF" + csv); // BOM so Excel opens UTF-8 correctly
}
function buildXlsxBytes(aoa: unknown[][], colCount: number, title: string): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Size each column to its widest cell so nothing is cramped or cut off.
  const cols: { wch: number }[] = [];
  for (let ci = 0; ci < colCount; ci++) {
    let w = 8;
    for (const r of aoa) { const len = String((r as unknown[])[ci] ?? "").length; if (len > w) w = len; }
    cols.push({ wch: Math.min(w + 2, 60) });
  }
  ws["!cols"] = cols;
  const wb = XLSX.utils.book_new();
  const sheet = (title || "Sheet").replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet";
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
// Stash arbitrary bytes in the private chat-files bucket; return the gf-file shape
// the chat app renders as a download chip ({name, mime, size, url}).
async function stashFile(uid: string, bytes: Uint8Array, ext: string, mime: string, name: string): Promise<{ name: string; mime: string; size: number; url: string } | null> {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const objKey = `${uid}/file/${crypto.randomUUID()}.${ext}`;
    const auth = { apikey: key, authorization: `Bearer ${key}` };
    const up = await fetch(`${url}/storage/v1/object/chat-files/${objKey}`, {
      method: "POST", headers: { ...auth, "content-type": mime, "x-upsert": "true" }, body: bytes,
    });
    if (!up.ok) { console.error("file stash", up.status, (await up.text().catch(() => "")).slice(0, 120)); return null; }
    const sign = await fetch(`${url}/storage/v1/object/sign/chat-files/${objKey}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 604800 }),
    });
    if (!sign.ok) return null;
    const sj = await sign.json();
    const signed = String(sj?.signedURL ?? sj?.signedUrl ?? "");
    return signed ? { name, mime, size: bytes.length, url: `${url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` } : null;
  } catch (e) { console.error("stashFile", e); return null; }
}
async function saveTable(uid: string, args: any): Promise<string> {
  let columns: string[];
  let rows: unknown[][];
  let totalCols: number[];
  let defaultTitle = "Sheet";
  const handle = String(args?.data_handle || "").trim();
  if (handle) {
    // Deterministic path: build from the EXACT stashed tool result. The model
    // only names the handle (and, for connector data, which fields -> columns);
    // the values never pass back through it, so a dropped row or wrong total
    // is impossible.
    const got = await loadStash(uid, handle);
    if (!got) return "That data_handle wasn't found or has expired — run the data tool again to get a fresh handle, or pass columns and rows explicitly.";
    if (got.rows.length) {
      // Structured stash (e.g. bank) — rows are ready to write.
      columns = got.columns.map((c) => String(c ?? ""));
      rows = got.rows.filter((r): r is (string | number)[] => Array.isArray(r));
      totalCols = got.totalColumns.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < columns.length);
    } else {
      // Raw connector stash — the model maps fields -> columns; we pull the values
      // out of the stored result so it never has to retype them.
      const fields = (Array.isArray(args?.fields) ? args.fields : [])
        .map((f: any) => ({ header: String(f?.header ?? f?.path ?? "").trim(), path: String(f?.path ?? "").trim(), divide: Number(f?.divide) > 0 ? Number(f.divide) : 0 }))
        .filter((f: { path: string }) => f.path);
      if (!fields.length) return "This handle holds raw data — tell me which columns to include by passing `fields`: an array of {header, path} where path is a field name from each record (dot-paths like \"customer.email\" work; add \"divide\":100 for amounts in cents). Optionally pass record_path and total_columns.";
      let records: any[] = detectRecords(got.raw)?.records ?? [];
      const recPath = String(args?.record_path || "").trim();
      if (recPath) {
        let cur: any = got.raw;
        for (const part of recPath.split(".")) cur = (cur && typeof cur === "object") ? cur[part] : undefined;
        if (Array.isArray(cur)) records = cur;
      }
      if (!records.length) return "Couldn't find the list of records to export in that data — pass record_path pointing at the array of items.";
      columns = fields.map((f: { header: string; path: string }) => f.header || f.path);
      rows = records.slice(0, 5000).map((rec) => fields.map((f: { path: string; divide: number }) => {
        const v = getPath(rec, f.path);
        if (f.divide && typeof v !== "object") { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); if (!isNaN(n)) return Math.round((n / f.divide) * 100) / 100; }
        return v as string | number;
      }));
      totalCols = (Array.isArray(args?.total_columns) ? args.total_columns : [])
        .map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < columns.length);
    }
    defaultTitle = got.source;
  } else {
    columns = Array.isArray(args?.columns) ? args.columns.map((c: unknown) => String(c ?? "")) : [];
    rows = (Array.isArray(args?.rows) ? args.rows : []).filter((r: unknown) => Array.isArray(r)) as unknown[][];
    // A TOTAL row, summed IN CODE (never a number the model typed) so it always
    // matches the rows actually included.
    totalCols = (Array.isArray(args?.total_columns) ? args.total_columns : [])
      .map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < columns.length);
  }
  if (!columns.length || !rows.length) return "Nothing to save — pass a data_handle from a tool result, or the columns and at least one row.";
  const title = (String(args?.title || defaultTitle).trim() || "Sheet").slice(0, 60);
  const fmt = args?.format === "csv" ? "csv" : "xlsx";
  let totalRow: (string | number)[] | null = null;
  if (totalCols.length) {
    totalRow = columns.map(() => "" as string | number);
    totalRow[0] = "TOTAL";
    for (const ci of totalCols) {
      let sum = 0;
      for (const r of rows) { const n = parseFloat(String(r[ci] ?? "").replace(/[^0-9.\-]/g, "")); if (!isNaN(n)) sum += n; }
      totalRow[ci] = Math.round(sum * 100) / 100;
    }
  }
  const aoa: unknown[][] = [columns, ...rows, ...(totalRow ? [totalRow] : [])];
  const base = title.replace(/[^\w .\-]+/g, "_").trim().slice(0, 50) || "table";
  let bytes: Uint8Array, ext: string, mime: string;
  if (fmt === "csv") {
    bytes = buildCsvBytes(aoa); ext = "csv"; mime = "text/csv";
  } else {
    try {
      bytes = buildXlsxBytes(aoa, columns.length, title);
      ext = "xlsx"; mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } catch (e) {
      console.error("xlsx build failed, using csv:", e);
      bytes = buildCsvBytes(aoa); ext = "csv"; mime = "text/csv";
    }
  }
  const fileName = `${base}.${ext}`;
  const stashed = await stashFile(uid, bytes, ext, mime, fileName);
  if (!stashed) return "The file couldn't be saved right now — please try again.";
  const block = "```gf-file\n" + JSON.stringify(stashed) + "\n```";
  return `File ready (${fileName}, ${rows.length} rows${totalRow ? " + a computed total" : ""}${handle ? ", built from the exact tool data" : ""}). Show it to the user by replying with the following block EXACTLY (a short caption before it is fine, but do NOT write the URL as text):\n${block}`;
}
const SAVE_TABLE_TOOL: Tool = {
  name: "GF_SAVE_TABLE",
  description: "Save tabular data as a downloadable spreadsheet (Excel .xlsx or .csv) BUILT SERVER-SIDE — columns are auto-sized and any total is computed in real code, so the file's layout and math are always exact. THREE ways to use it (always prefer a data_handle so values never get retyped): (1) BANK data — when a bank tool's [data_handle: …] marker has ready columns, just pass that data_handle. (2) CONNECTOR data (Stripe, Gmail, Notion, etc.) — when a tool's [data_handle: …] marker holds raw records, pass that data_handle PLUS `fields` (which columns to pull) and, if the marker named one, `record_path`. (3) Data you typed yourself — pass columns + rows, listing EVERY row in full. Use whenever the user wants a list/table saved or exported as a spreadsheet, Excel, or CSV. PREFER this over writing spreadsheet code with code execution. After it runs, show the file by replying with the gf-file block exactly as the tool result instructs.",
  inputSchema: {
    type: "object",
    properties: {
      data_handle: { type: "string", description: "The id from a [data_handle: …] marker in a previous tool result. The server builds the file from that exact stored data." },
      fields: {
        type: "array",
        description: "For a CONNECTOR data_handle (raw records): which columns to include, in order. Each is {header, path} where path is a field name in each record (dot-paths like \"customer.email\" work). Add \"divide\":100 when the value is stored in cents (e.g. Stripe amount) to show dollars.",
        items: { type: "object", properties: {
          header: { type: "string", description: "Column header shown in the file." },
          path: { type: "string", description: "Field name / dot-path to read from each record." },
          divide: { type: "number", description: "Optional: divide this numeric field by N (e.g. 100 for cents → dollars)." },
        }, required: ["header", "path"] },
      },
      record_path: { type: "string", description: "For a CONNECTOR data_handle: dot-path to the array of records (e.g. \"data\"). Use the path the [data_handle] marker showed. Omit to auto-detect." },
      title: { type: "string", description: "Short title / file name for the sheet, e.g. \"Subscriptions\"." },
      columns: { type: "array", items: { type: "string" }, description: "Column headers, in order. Required only when passing rows directly (no data_handle)." },
      rows: { type: "array", description: "The data rows, each an array of cell values matching columns. Include EVERY row. Required only when no data_handle is given.", items: { type: "array", items: {} } },
      total_columns: { type: "array", items: { type: "integer" }, description: "OPTIONAL: 0-based index(es) of numeric columns to sum into a TOTAL row (computed in code). Works with fields too." },
      format: { type: "string", enum: ["xlsx", "csv"], description: "File format — \"xlsx\" (default) or \"csv\"." },
    },
    required: [],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    // Non-sensitive: expose the RECOMMENDED tool slugs for a toolkit (optional
    // hint for the Manage Tools UI — these are NOT auto-enabled).
    const dflt = new URL(req.url).searchParams.get("defaults");
    if (dflt) {
      return new Response(JSON.stringify({ slugs: ALLOWED[dflt] ?? [] }), { headers: { "content-type": "application/json" } });
    }
    return new Response("Go Farther MCP (Composio-backed)", { status: 200 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  const tokenUid = await verifyUserToken(auth.replace(/^Bearer\s+/i, "").trim());
  if (!tokenUid) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const reqUrl = new URL(req.url);
  const apps = (reqUrl.searchParams.get("apps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reqUser = tokenUid; // identity comes from the verified token, never a URL param
  const memOn = reqUrl.searchParams.get("mem") !== "0"; // memory tool on unless the chat fn paused it

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
      const bankOn = await userHasBanks(reqUser);
      return J({ jsonrpc: "2.0", id, result: { tools: await listTools(apps, prefs, memOn, bankOn) } });
    } catch (e) {
      console.error("tools/list failed:", e);
      return J({ jsonrpc: "2.0", id, error: { code: -32000, message: "internal error" } });
    }
  }
  if (method === "tools/call") {
    const p = msg.params || {};
    // Built-in memory tools — handled locally, not forwarded to Composio.
    if (p.name === "GF_SAVE_MEMORY") {
      try {
        const text = await saveMemory(reqUser, (p.arguments || {}).content);
        await logUsage(p.name, true, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        console.error("memory tool error:", p.name, e);
        await logUsage(p.name, false, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "That action couldn't be completed — please try again." }], isError: true } });
      }
    }
    if (p.name === "GF_GET_MEMORY_FILE") {
      try {
        const a = p.arguments || {};
        const text = await getMemoryFile(reqUser, a.memory_id, a.toolkit_slug, a.tool_slug);
        await logUsage(p.name, true, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        console.error("memory tool error:", p.name, e);
        await logUsage(p.name, false, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "That action couldn't be completed — please try again." }], isError: true } });
      }
    }
    // Built-in bank (Plaid) tools — handled locally, read-only, scoped to the user.
    if (typeof p.name === "string" && p.name.startsWith("GF_BANK_")) {
      // Honor the user's per-tool Plaid selection (no row = uncustomized = all on),
      // so a tool turned off in Manage Tools can't be reached even if model-requested.
      const bankPick = (await userToolPrefs(reqUser))["plaid"];
      if (bankPick !== undefined && !bankPick.includes(p.name)) {
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "That tool isn't enabled for this account." }], isError: true } });
      }
      try {
        let text = "";
        let tables: BankTable[] = [];
        const take = (r: BankResult) => { text = r.text; tables = r.tables ?? []; };
        if (p.name === "GF_BANK_BALANCES") take(await bankBalances(reqUser));
        else if (p.name === "GF_BANK_TRANSACTIONS") take(await bankTransactions(reqUser, Number((p.arguments || {}).count) || 50));
        else if (p.name === "GF_BANK_RECURRING") take(await bankRecurring(reqUser));
        else if (p.name === "GF_BANK_LIABILITIES") take(await bankLiabilities(reqUser));
        else if (p.name === "GF_BANK_INVESTMENTS") take(await bankInvestments(reqUser));
        else if (p.name === "GF_BANK_IDENTITY") text = await bankIdentity(reqUser);
        else if (p.name === "GF_BANK_AUTH") text = await bankAuth(reqUser);
        else if (p.name === "GF_BANK_INVESTMENT_TRANSACTIONS") take(await bankInvestmentTxns(reqUser, Number((p.arguments || {}).days) || 90));
        else if (p.name === "GF_BANK_INSIGHTS") text = await bankInsights(reqUser, String((p.arguments || {}).mode || ""), Number((p.arguments || {}).days) || 30);
        else text = "Unknown bank tool.";
        // For each table: give the model the EXACT total (summed in code) so it
        // quotes the right figure instead of re-adding rows in its head (and
        // getting it wrong), then stash it + hand over an export handle.
        for (const tb of tables) {
          for (const ci of tb.totalColumns) {
            let sum = 0;
            for (const r of tb.rows) { const n = parseFloat(String(r[ci] ?? "").replace(/[^0-9.\-]/g, "")); if (!isNaN(n)) sum += n; }
            text += `\n\nServer-computed total for ${tb.label} (${tb.columns[ci]}, ${tb.rows.length} items): ${sum.toFixed(2)} — quote THIS exact total to the user; do not re-add the rows yourself.`;
          }
          const hid = await stashTable(reqUser, tb);
          if (hid) text += `\n[data_handle: ${hid} — the ${tb.label} above as structured data. To save/export THIS as a spreadsheet or CSV, call GF_SAVE_TABLE with {"data_handle": "${hid}"} (plus optional title/format) — the file is built server-side from the exact data, so do NOT retype the rows.]`;
        }
        await logUsage(p.name, true, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        console.error("bank tool error:", p.name, e);
        await logUsage(p.name, false, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Couldn't read your bank data right now." }], isError: true } });
      }
    }
    // Built-in general tools — handled locally (no Composio, no connection needed).
    if (p.name === "GF_WEATHER" || p.name === "GF_MAPS" || p.name === "GF_IMAGE" || p.name === "GF_SAVE_TABLE") {
      try {
        const a = p.arguments || {};
        const text = p.name === "GF_WEATHER" ? await weatherLookup(a.location, String(a.units || "fahrenheit"))
          : p.name === "GF_MAPS" ? await mapsTool(a)
          : p.name === "GF_SAVE_TABLE" ? await saveTable(reqUser, a)
          : await imageTool(reqUser, a);
        await logUsage(p.name, true, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        console.error("builtin tool error:", p.name, e);
        await logUsage(p.name, false, reqUser);
        return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "That action couldn't be completed — please try again." }], isError: true } });
      }
    }
    // Only execute a tool actually served for this user's connected apps — never a
    // slug the user didn't enable or that wasn't advertised in tools/list.
    const allowed = await allowedSlugs(apps, await userToolPrefs(reqUser));
    if (!allowed.has(p.name)) {
      console.error("blocked tool not in allowlist:", p.name);
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "That tool isn't enabled for this account." }], isError: true } });
    }
    try {
      let text = await execTool(p.name, p.arguments || {}, reqUser);
      // If this read returned a table-shaped result, stash the RAW data and tell
      // the model a handle, so an export is built from the EXACT result (the model
      // only maps fields->columns, never retypes the values). Best-effort + capped.
      try {
        const parsed = tryParseJson(text);
        if (parsed && text.length < 600000) {
          const det = detectRecords(parsed);
          if (det && det.records.length) {
            const hid = await stashRaw(reqUser, p.name, parsed);
            if (hid) {
              const keys = new Set<string>();
              for (const rec of det.records.slice(0, 5)) if (rec && typeof rec === "object") for (const k of Object.keys(rec)) { if (keys.size < 30) keys.add(k); }
              text += `\n\n[data_handle: ${hid} — the ${det.records.length} record(s) above${det.path ? ` (at "${det.path}")` : ""}. To save/export THIS as a spreadsheet or CSV, call GF_SAVE_TABLE with {"data_handle":"${hid}"${det.path ? `, "record_path":"${det.path}"` : ""}, "fields":[{"header":"…","path":"<field>"}, …]} — choose the columns the user wants (path is a field name, dot-paths like "customer.email" work; add "divide":100 for amounts stored in cents). The file is built server-side from the exact data, so do NOT retype the rows. Available fields: ${[...keys].join(", ")}.]`;
            }
          }
        }
      } catch { /* stashing is best-effort; never block the tool result */ }
      await logUsage(p.name, true, reqUser);
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      console.error("tool exec error:", p.name, e);
      await logUsage(p.name, false, reqUser);
      return J({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "That action couldn't be completed — please try again." }], isError: true },
      });
    }
  }
  if (method === "ping") return J({ jsonrpc: "2.0", id, result: {} });
  return J({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
});
