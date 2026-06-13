import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Workflow builder: turn a natural-language request into a structured workflow
// GRAPH (trigger + nodes + edges) PLUS a compiled `instruction` the runner
// executes. If the request is ambiguous or missing key details, it ASKS short
// clarifying questions first (like a careful assistant) instead of guessing.
// Accepts the running conversation so answers refine the build. Uses Opus.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const COMPOSIO_BASE = "https://backend.composio.dev/api";
const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MODEL = "claude-opus-4-8";
const ML_BASE_URL = (Deno.env.get("WORKFLOW_MODEL_BASE_URL") || "").replace(/\/$/, "");
const ML_MODEL = Deno.env.get("WORKFLOW_MODEL_NAME") || "gf-workflows";
const ML_KEY = Deno.env.get("WORKFLOW_MODEL_KEY") || "ollama";
const ML_TIMEOUT_MS = 30000;


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

// Caller identity from the (platform-validated) JWT.
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

// frontend connector id <-> Composio toolkit slug
const APP_TO_SLUG: Record<string, string> = {
  gmail: "gmail", gcal: "googlecalendar", gdrive: "googledrive", canva: "canva", figma: "figma",
  notion: "notion", atlassian: "jira", m365: "outlook", slack: "slack", hubspot: "hubspot",
  googlesheets: "googlesheets", googledocs: "googledocs", excel: "excel", one_drive: "one_drive",
  dropbox: "dropbox", box: "box", onenote: "onenote", airtable: "airtable", todoist: "todoist",
  googletasks: "googletasks", asana: "asana", trello: "trello", clickup: "clickup", monday: "monday",
  miro: "miro", calendly: "calendly", zoom: "zoom", googlemeet: "googlemeet", microsoft_teams: "microsoft_teams",
  webex: "webex", telegram: "telegram", discord: "discord", linkedin: "linkedin", reddit: "reddit",
  youtube: "youtube", instagram: "instagram", twitter: "twitter", spotify: "spotify", salesforce: "salesforce",
  pipedrive: "pipedrive", zoho: "zoho", zendesk: "zendesk", intercom: "intercom", freshdesk: "freshdesk",
  shopify: "shopify", stripe: "stripe", square: "square", quickbooks: "quickbooks", xero: "xero",
  typeform: "typeform", jotform: "jotform", mailchimp: "mailchimp", sendgrid: "sendgrid", klaviyo: "klaviyo",
};
const SLUG_TO_APP: Record<string, string> = Object.fromEntries(
  Object.entries(APP_TO_SLUG).map(([a, s]) => [s, a]),
);

// Which apps has this user connected (returned as frontend connector ids)?
async function connectedApps(uid: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", uid);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return [];
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const ids = items
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s)
      .map((s) => SLUG_TO_APP[s] || s);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

// The user's saved long-term memories (service role, scoped to their uid), fed to
// the builder so it can resolve a person/preference it already knows — memory is
// the first place to look. Respects the user's memory-pause toggle.
async function fetchMemories(uid: string): Promise<string[]> {
  if (!SB_URL || !SB_KEY || !uid) return [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_memory?user_id=eq.${encodeURIComponent(uid)}&select=content&order=created_at.asc`, {
      headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x: { content?: string }) => (x?.content || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
async function memoryEnabled(uid: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY || !uid) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(uid)}&select=memory_on`, {
      headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? !!rows[0].memory_on : true;
  } catch {
    return true;
  }
}

// Read-only contact lookup: search the user's connected email for a named person
// and return candidate email addresses, so the builder can RESOLVE "from Jhon"
// instead of guessing. Never sends or changes anything; fails safe to no candidates.
async function composioExec(name: string, args: unknown, uid: string): Promise<any> {
  const res = await fetch(`${COMPOSIO_BASE}/v3/tools/execute/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "x-api-key": COMPOSIO_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: args ?? {} }),
  });
  return await res.json().catch(() => ({}));
}
async function findContact(uid: string, query: unknown, apps: string[]): Promise<string> {
  const q = String(query ?? "").trim();
  if (!q || !COMPOSIO_API_KEY) return JSON.stringify({ candidates: [] });
  try {
    let raw: any = null;
    if (apps.includes("gmail")) {
      raw = await composioExec("GMAIL_FETCH_EMAILS", { query: `from:${q}`, max_results: 10 }, uid);
    } else if (apps.includes("m365")) {
      raw = await composioExec("OUTLOOK_OUTLOOK_SEARCH_MESSAGES", { query: q, top: 10 }, uid);
    } else {
      return JSON.stringify({ candidates: [], note: "No email account is connected, so this person can't be looked up — ask the user for their email address." });
    }
    const text = JSON.stringify(raw?.data ?? raw ?? {});
    const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))].slice(0, 8);
    return JSON.stringify({ candidates: emails });
  } catch {
    return JSON.stringify({ candidates: [] });
  }
}

// Two tools: ask clarifying questions, or emit the finished workflow.
const ASK_TOOL = {
  name: "ask",
  description: "Ask the user 1-3 SHORT, MULTIPLE-CHOICE clarifying questions when the request is ambiguous or missing a detail that would change what the workflow does, who it contacts, or which account it uses. Ask EVERYTHING you're unsure about in this single call. Prefer this over guessing on anything that matters.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "1-3 multiple-choice questions, asked together in one round.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "One short, plain-language question." },
            header: { type: "string", description: "1-2 word category label for the question (e.g. \"Account\", \"Scope\", \"Recipient\")." },
            options: {
              type: "array",
              description: "2-4 concrete choices the user can tap. The app adds an \"Other\" choice automatically, so never include one yourself.",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Short choice text (1-4 words)." },
                  description: { type: "string", description: "Optional one-line clarification of this choice." },
                },
                required: ["label"],
              },
            },
          },
          required: ["question", "header", "options"],
        },
      },
    },
    required: ["questions"],
  },
};
const EMIT_TOOL = {
  name: "emit_workflow",
  description: "Return the structured workflow you designed.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name for the workflow (2-5 words)." },
      instruction: {
        type: "string",
        description: "ONE clear paragraph telling the assistant exactly what to do each time this runs, naming the apps to use. This is what actually executes.",
      },
      trigger: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["schedule", "event"] },
          schedule: {
            type: "object",
            properties: {
              freq: { type: "string", enum: ["daily", "weekly", "hourly"] },
              hour: { type: "integer" },
              minute: { type: "integer" },
              weekday: { type: "integer", description: "0=Sun .. 6=Sat (weekly only)" },
            },
          },
          event: {
            type: "object",
            properties: {
              app: { type: "string", description: "connector id of the app to watch" },
              filter: { type: "string", description: "short natural-language condition" },
              window: {
                type: "object",
                description: "OPTIONAL active hours. Set ONLY when the user implied specific times/days (overnight, work hours, weekdays, etc.). Omit to watch all day. Narrowing the window lowers cost. Times are the user's local timezone.",
                properties: {
                  start: { type: "integer", description: "window start, minutes from midnight 0-1439 (e.g. 540 = 9:00 AM)" },
                  end: { type: "integer", description: "window end, minutes from midnight 0-1439 (e.g. 1020 = 5:00 PM); for an overnight window the end may be smaller than start" },
                  days: { type: "array", items: { type: "integer" }, description: "0=Sun..6=Sat; days the window is active. Omit/empty = every day" },
                },
                required: ["start", "end"],
              },
            },
          },
        },
        required: ["type"],
      },
      nodes: {
        type: "array",
        description: "Ordered steps. The FIRST node must be the trigger.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "stable id, e.g. n1, n2" },
            kind: { type: "string", enum: ["trigger", "action", "decision"] },
            app: { type: "string", description: "connector id, or 'schedule'/'event' (trigger), 'ai' (reasoning), 'decision' (branch)" },
            label: { type: "string", description: "2-4 word label" },
            detail: { type: "string", description: "one short sentence" },
          },
          required: ["id", "kind", "app", "label"],
        },
      },
      edges: {
        type: "array",
        description: "Flow connections between node ids. A decision node has two edges with branch 'yes' and 'no'.",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            branch: { type: "string", enum: ["yes", "no"] },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["title", "instruction", "trigger", "nodes", "edges"],
  },
};

// Read-only lookup so the builder can resolve a person it would otherwise guess at.
const FIND_CONTACT_TOOL = {
  name: "find_contact",
  description: "Resolve WHO a named person is by searching the user's connected email, returning candidate email addresses. Call this WHENEVER the user names someone (e.g. \"emails from Jhon\", \"reply to Sarah\") without giving an address, so the workflow targets a real address instead of a guessed name. Read-only — it never sends or changes anything.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The person's name to look up, e.g. \"Jhon\"." },
    },
    required: ["query"],
  },
};

// Terminal "can't build" signal. Use INSTEAD of asking again when there's no path
// to a runnable workflow — so we never loop the same question at the user.
const CANNOT_BUILD_TOOL = {
  name: "cannot_build",
  description: "Use this INSTEAD of asking another question when you cannot produce a workflow that would actually run: the workflow's CORE purpose needs an app the user hasn't connected and no connected app can substitute, OR the request can't be built safely (e.g. emailing many recipients at high frequency — that's spam). Give a short, friendly explanation and the concrete next step (e.g. which app to connect). Never loop on the same question.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "One or two short, friendly sentences: why it can't be built, and what to do next (e.g. \"You haven't connected an email app yet — connect Gmail in the Connectors screen, then describe this again.\")." },
    },
    required: ["reason"],
  },
};

const CATALOG: { builtins: string[]; toolsByFid: Record<string, string[]>; validApps: string[] } = {"builtins": ["GF_SET_REMINDER", "GF_WEATHER", "GF_MAPS", "GF_IMAGE", "GF_SAVE_MEMORY", "GF_SAVE_TABLE", "GF_BANK_BALANCES", "GF_BANK_TRANSACTIONS", "GF_BANK_INSIGHTS"], "toolsByFid": {"gmail": ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_SEND_EMAIL", "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_REPLY_TO_THREAD", "GMAIL_LIST_DRAFTS"], "gcal": ["GOOGLECALENDAR_FIND_EVENT", "GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_LIST_CALENDARS", "GOOGLECALENDAR_FIND_FREE_SLOTS"], "gdrive": ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_DOWNLOAD_FILE", "GOOGLEDRIVE_FIND_FOLDER", "GOOGLEDRIVE_LIST_FILES", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", "GOOGLEDRIVE_UPLOAD_FILE"], "canva": ["CANVA_LIST_USER_DESIGNS", "CANVA_LIST_FOLDER_ITEMS_BY_TYPE_WITH_SORTING", "CANVA_ACCESS_USER_SPECIFIC_BRAND_TEMPLATES_LIST", "CANVA_CREATE_CANVA_DESIGN_EXPORT_JOB", "CANVA_GET_DESIGN_EXPORT_JOB_RESULT"], "figma": ["FIGMA_GET_PROJECTS_IN_A_TEAM", "FIGMA_GET_FILES_IN_A_PROJECT", "FIGMA_GET_FILE_METADATA", "FIGMA_GET_COMMENTS_IN_A_FILE", "FIGMA_GET_FILE_NODES", "FIGMA_DOWNLOAD_FIGMA_IMAGES"], "notion": ["NOTION_SEARCH_NOTION_PAGE", "NOTION_GET_PAGE_MARKDOWN", "NOTION_QUERY_DATABASE", "NOTION_FETCH_DATABASE", "NOTION_CREATE_NOTION_PAGE", "NOTION_APPEND_TEXT_BLOCKS"], "jira": ["JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", "JIRA_GET_ISSUE", "JIRA_CREATE_ISSUE", "JIRA_GET_ALL_PROJECTS", "JIRA_ADD_COMMENT", "JIRA_TRANSITION_ISSUE"], "slack": ["SLACK_LIST_ALL_CHANNELS", "SLACK_SEND_MESSAGE", "SLACK_FETCH_CONVERSATION_HISTORY", "SLACK_SEARCH_MESSAGES", "SLACK_ADD_REACTION_TO_AN_ITEM"], "hubspot": ["HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", "HUBSPOT_LIST_CONTACTS", "HUBSPOT_LIST_DEALS", "HUBSPOT_SEARCH_DEALS", "HUBSPOT_CREATE_CONTACT"], "m365": ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_SEARCH_MESSAGES", "OUTLOOK_GET_MESSAGE", "OUTLOOK_SEND_EMAIL", "OUTLOOK_CREATE_DRAFT", "OUTLOOK_REPLY_EMAIL"], "googlesheets": ["GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_BATCH_GET", "GOOGLESHEETS_GET_SHEET_NAMES", "GOOGLESHEETS_GET_SPREADSHEET_INFO", "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW", "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND"], "googledocs": ["GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", "GOOGLEDOCS_LIST_SPREADSHEET_CHARTS", "GOOGLEDOCS_COPY_DOCUMENT", "GOOGLEDOCS_CREATE_DOCUMENT2", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", "GOOGLEDOCS_CREATE_FOOTER"], "excel": ["EXCEL_LIST_FILES", "EXCEL_LIST_WORKSHEETS", "EXCEL_GET_RANGE", "EXCEL_UPDATE_RANGE", "EXCEL_LIST_TABLES", "EXCEL_GET_WORKBOOK"], "one_drive": ["ONE_DRIVE_GET_DRIVE", "ONE_DRIVE_GET_DRIVE_ITEM_BY_SHARING_URL", "ONE_DRIVE_GET_FOLLOWED_ITEM", "ONE_DRIVE_GET_GROUP_DRIVE", "ONE_DRIVE_GET_ITEM", "ONE_DRIVE_GET_ITEM_PERMISSIONS"], "dropbox": ["DROPBOX_FILES_SEARCH", "DROPBOX_GET_ACCOUNT", "DROPBOX_GET_SHARED_FOLDER_METADATA", "DROPBOX_GET_SPACE_USAGE", "DROPBOX_GET_TEAM_INFO", "DROPBOX_GET_TEAM_LOG_EVENTS"], "box": ["BOX_FIND_FILE_FOR_SHARED_LINK", "BOX_GET_FILE_INFORMATION", "BOX_GET_FOLDER", "BOX_LIST_FILE_COMMENTS", "BOX_LIST_ITEMS_IN_FOLDER", "BOX_SEARCH_FOR_CONTENT"], "onenote": ["ONENOTE_GET_GROUP_SECTIONS", "ONENOTE_GET_NOTEBOOK_FROM_WEB_URL", "ONENOTE_GET_NOTEBOOK_SECTION_GROUP", "ONENOTE_GET_ONENOTE_GROUP_SECTIONS_PAGES", "ONENOTE_GET_SITE_SECTIONS", "ONENOTE_GET_SITE_SECTIONS_PAGES"], "airtable": ["AIRTABLE_GET_BASE_SCHEMA", "AIRTABLE_GET_RECORD", "AIRTABLE_LIST_BASES", "AIRTABLE_CREATE_MULTIPLE_RECORDS", "AIRTABLE_CREATE_RECORD", "AIRTABLE_CREATE_RECORD_FROM_NATURAL_LANGUAGE"], "todoist": ["TODOIST_GET_ALL_TASKS", "TODOIST_CREATE_TASK", "TODOIST_UPDATE_TASK", "TODOIST_CLOSE_TASK", "TODOIST_GET_ALL_PROJECTS", "TODOIST_CREATE_PROJECT"], "googletasks": ["GOOGLETASKS_LIST_ALL_TASKS", "GOOGLETASKS_LIST_TASK_LISTS", "GOOGLETASKS_GET_TASK", "GOOGLETASKS_INSERT_TASK", "GOOGLETASKS_UPDATE_TASK", "GOOGLETASKS_DELETE_TASK"], "asana": ["ASANA_SEARCH_TASKS_IN_WORKSPACE", "ASANA_GET_TASKS_FROM_A_PROJECT", "ASANA_GET_A_TASK", "ASANA_CREATE_A_TASK", "ASANA_UPDATE_A_TASK", "ASANA_GET_MULTIPLE_PROJECTS"], "trello": ["TRELLO_GET_SEARCH", "TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD", "TRELLO_GET_CARDS_BY_ID_CARD", "TRELLO_ADD_CARDS", "TRELLO_UPDATE_CARDS_BY_ID_CARD", "TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD"], "clickup": ["CLICKUP_CREATE_LIST", "CLICKUP_CREATE_THREADED_COMMENT", "CLICKUP_GET_DOC_PAGE_CONTENT", "CLICKUP_GET_TASK", "CLICKUP_MOVE_TASK_TO_HOME_LIST", "CLICKUP_CREATE_DOC"], "monday": ["MONDAY_GET_ITEMS", "MONDAY_LIST_BOARD_ITEMS", "MONDAY_LIST_BOARDS", "MONDAY_LIST_ITEMS_BY_COLUMN_VALUES", "MONDAY_LIST_USERS", "MONDAY_ADD_USERS_TO_BOARD"], "miro": ["MIRO_GET_BOARD", "MIRO_GET_BOARD_MEMBERS", "MIRO_GET_BOARDS", "MIRO_GET_BOARDS2", "MIRO_GET_FRAME_ITEM", "MIRO_GET_TAG"], "calendly": ["CALENDLY_GET_EVENT_TYPE_AVAILABILITY", "CALENDLY_GET_ORGANIZATION", "CALENDLY_GET_USER", "CALENDLY_LIST_EVENT_TYPES", "CALENDLY_LIST_SCHEDULED_EVENTS", "CALENDLY_CANCEL_SCHEDULED_EVENT"], "zoom": ["ZOOM_GET_A_MEETING", "ZOOM_GET_A_MEETING_SUMMARY", "ZOOM_GET_MEETING_RECORDINGS", "ZOOM_GET_USER", "ZOOM_LIST_ALL_RECORDINGS", "ZOOM_LIST_MEETINGS"], "googlemeet": ["GOOGLEMEET_GET_CONFERENCE_RECORD_BY_NAME", "GOOGLEMEET_GET_PARTICIPANT_SESSION", "GOOGLEMEET_LIST_CONFERENCE_RECORDS", "GOOGLEMEET_LIST_PARTICIPANTS", "GOOGLEMEET_LIST_PARTICIPANT_SESSIONS", "GOOGLEMEET_LIST_RECORDINGS"], "microsoft_teams": ["MICROSOFT_TEAMS_GET_CHANNEL", "MICROSOFT_TEAMS_GET_CHAT_MESSAGE", "MICROSOFT_TEAMS_GET_MEETING_TRANSCRIPT_CONTENT", "MICROSOFT_TEAMS_GET_MY_PROFILE", "MICROSOFT_TEAMS_GET_PRIMARY_CHANNEL", "MICROSOFT_TEAMS_GET_SCHEDULE"], "webex": ["WEBEX_GET_TEAM_DETAILS", "WEBEX_LIST_TEAMS", "WEBEX_LIST_WEBHOOKS", "WEBEX_MESSAGING_GET_MEMBERSHIP_DETAILS", "WEBEX_MESSAGING_GET_MESSAGE_DETAILS", "WEBEX_MESSAGING_GET_TEAM_MEMBERSHIP_DETAILS"], "telegram": ["TELEGRAM_GET_CHAT_MEMBER", "TELEGRAM_SEND_MESSAGE"], "discord": ["DISCORD_GET_GATEWAY", "DISCORD_GET_INVITE", "DISCORD_GET_USER", "DISCORD_INVITE_RESOLVE"], "linkedin": ["LINKEDIN_GET_PERSON", "LINKEDIN_GET_POST_CONTENT", "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE", "LINKEDIN_INITIALIZE_IMAGE_UPLOAD", "LINKEDIN_REGISTER_IMAGE_UPLOAD"], "reddit": ["REDDIT_GET", "REDDIT_GET_CONTROVERSIAL_POSTS", "REDDIT_GET_NEW", "REDDIT_GET_REDDIT_USER_ABOUT", "REDDIT_GET_R_TOP", "REDDIT_GET_SUBREDDITS_SEARCH"], "youtube": ["YOUTUBE_ADD_VIDEO_TO_PLAYLIST", "YOUTUBE_CREATE_PLAYLIST", "YOUTUBE_LIST_CAPTION_TRACK", "YOUTUBE_LIST_COMMENTS", "YOUTUBE_LIST_COMMENT_THREADS", "YOUTUBE_UPDATE_PLAYLIST"], "instagram": ["INSTAGRAM_GET_IG_MEDIA", "INSTAGRAM_GET_IG_MEDIA_COMMENTS", "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", "INSTAGRAM_GET_IG_USER_MEDIA", "INSTAGRAM_GET_PAGE_CONVERSATIONS", "INSTAGRAM_CREATE_CAROUSEL_CONTAINER"], "twitter": ["TWITTER_CREATE_LIST", "TWITTER_DELETE_LIST", "TWITTER_GET_BLOCKED_USERS", "TWITTER_GET_POST_ANALYTICS", "TWITTER_RECENT_SEARCH", "TWITTER_CREATION_OF_A_POST"], "spotify": ["SPOTIFY_ADD_ITEMS_TO_PLAYLIST", "SPOTIFY_CREATE_PLAYLIST", "SPOTIFY_GET_ARTIST_S_TOP_TRACKS", "SPOTIFY_GET_PLAYLIST", "SPOTIFY_GET_SHOW", "SPOTIFY_GET_SHOW_EPISODES"], "salesforce": ["SALESFORCE_EXECUTE_SOQL_QUERY", "SALESFORCE_SEARCH_CONTACTS", "SALESFORCE_SEARCH_OPPORTUNITIES", "SALESFORCE_GET_ACCOUNT", "SALESFORCE_CREATE_LEAD", "SALESFORCE_UPDATE_RECORD"], "pipedrive": ["PIPEDRIVE_GET_ACTIVITY_FIELD", "PIPEDRIVE_GET_ALL_LEADS", "PIPEDRIVE_GET_ALL_PRODUCTS", "PIPEDRIVE_GET_DEAL", "PIPEDRIVE_GET_DEAL_FIELD", "PIPEDRIVE_GET_LEAD_CONVERSION_STATUS"], "zoho": ["ZOHO_GET_RELATED_LISTS", "ZOHO_GET_RELATED_RECORDS", "ZOHO_GET_ZOHO_USERS", "ZOHO_LIST_MODULES", "ZOHO_LIST_RECORD_ATTACHMENTS", "ZOHO_SEARCH_ZOHO_RECORDS"], "zendesk": ["ZENDESK_GET_ATTACHMENT", "ZENDESK_GET_USER", "ZENDESK_GET_USERS_ASSIGNED_TICKETS", "ZENDESK_GET_USERS_CCD_TICKETS", "ZENDESK_GET_USERS_FOLLOWED_TICKETS", "ZENDESK_GET_USERS_REQUESTED_TICKETS"], "intercom": ["INTERCOM_GET_CONVERSATION", "INTERCOM_GET_TICKET", "INTERCOM_LIST_ALL_MACROS", "INTERCOM_LIST_CONTACTS", "INTERCOM_LIST_CONVERSATIONS", "INTERCOM_LIST_SEGMENTS"], "freshdesk": ["FRESHDESK_GET_ACCOUNT", "FRESHDESK_GET_AGENT", "FRESHDESK_GET_AGENTS", "FRESHDESK_GET_COMPANIES", "FRESHDESK_GET_COMPANY", "FRESHDESK_GET_COMPANY_FIELDS"], "shopify": ["SHOPIFY_GET_CUSTOMER", "SHOPIFY_GET_CUSTOMERS_SEARCH", "SHOPIFY_GET_ORDER", "SHOPIFY_GET_SHOP_CONFIGURATION", "SHOPIFY_GET_SHOP_DETAILS", "SHOPIFY_LIST_CUSTOMERS"], "stripe": ["STRIPE_LIST_CUSTOMERS", "STRIPE_GET_V1_CUSTOMERS_SEARCH_CUSTOMERS", "STRIPE_LIST_CHARGES", "STRIPE_LIST_INVOICES", "STRIPE_LIST_PAYMENT_INTENTS", "STRIPE_GET_BALANCE_HISTORY"], "square": ["SQUARE_GET_CURRENT_MERCHANT", "SQUARE_GET_MERCHANT", "SQUARE_LIST_CHANNELS", "SQUARE_LIST_CUSTOMER_GROUPS", "SQUARE_LIST_CUSTOMERS", "SQUARE_LIST_CUSTOMER_SEGMENTS"], "quickbooks": ["QUICKBOOKS_GET_AGED_RECEIVABLES_REPORT", "QUICKBOOKS_GET_BALANCE_SHEET_REPORT", "QUICKBOOKS_GET_CHANGED_ENTITIES", "QUICKBOOKS_GET_COMPANY_INFO", "QUICKBOOKS_GET_GENERAL_LEDGER_REPORT", "QUICKBOOKS_GET_PROFIT_AND_LOSS_DETAIL_REPORT"], "xero": ["XERO_GET_ACCOUNT", "XERO_GET_ASSET", "XERO_GET_BALANCE_SHEET_REPORT", "XERO_GET_BUDGET", "XERO_GET_CONNECTIONS", "XERO_GET_CONTACTS"], "typeform": ["TYPEFORM_GET_ABOUT_ME", "TYPEFORM_GET_FORM", "TYPEFORM_GET_FORM_RESPONSES", "TYPEFORM_GET_WORKSPACE", "TYPEFORM_LIST_FORMS", "TYPEFORM_LIST_THEMES"], "jotform": ["JOTFORM_GET_SYSTEM_PLAN", "JOTFORM_GET_USER_DETAILS", "JOTFORM_GET_USER_FOLDERS", "JOTFORM_GET_USER_FORMS", "JOTFORM_GET_USER_HISTORY", "JOTFORM_GET_USER_REPORTS"], "mailchimp": ["MAILCHIMP_GET_AUDIENCES_CONTACTS", "MAILCHIMP_GET_AUDIENCES_CONTACTS_DETAIL", "MAILCHIMP_GET_CAMPAIGN_INFO", "MAILCHIMP_GET_LISTS_INFO", "MAILCHIMP_LIST_CAMPAIGNS", "MAILCHIMP_LIST_RECENT_ACTIVITY"], "sendgrid": ["SENDGRID_ADD_OR_UPDATE_A_CONTACT", "SENDGRID_SEARCH_CONTACTS", "SENDGRID_RETRIEVE_ALL_LISTS", "SENDGRID_CREATE_A_LIST", "SENDGRID_RETRIEVE_ALL_CAMPAIGNS", "SENDGRID_GET_TOTAL_CONTACT_COUNT"], "klaviyo": ["KLAVIYO_ADD_PROFILE_TO_LIST", "KLAVIYO_CREATE_LIST", "KLAVIYO_GET_BULK_DELETE_CATALOG_ITEMS_JOB", "KLAVIYO_GET_BULK_UPDATE_CATEGORIES_JOB", "KLAVIYO_GET_CAMPAIGN", "KLAVIYO_GET_CAMPAIGNS"]}, "validApps": ["ai", "airtable", "asana", "box", "calendly", "canva", "clickup", "decision", "discord", "dropbox", "event", "excel", "figma", "freshdesk", "gcal", "gdrive", "gmail", "googledocs", "googlemeet", "googlesheets", "googletasks", "hubspot", "instagram", "intercom", "jira", "jotform", "klaviyo", "linkedin", "m365", "mailchimp", "microsoft_teams", "miro", "monday", "notion", "one_drive", "onenote", "pipedrive", "quickbooks", "reddit", "salesforce", "schedule", "sendgrid", "shopify", "slack", "spotify", "square", "stripe", "telegram", "todoist", "trello", "twitter", "typeform", "webex", "xero", "youtube", "zendesk", "zoho", "zoom"]};
const VALID_APPS = new Set(CATALOG.validApps);

const SCHEMA_DOC = `A workflow is a JSON object:
{
  "title": string,            // 2-5 words
  "instruction": string,      // ONE clear paragraph; what runs each time, naming the apps
  "trigger": {
    "type": "schedule" | "event",
    "schedule": {             // when type == "schedule"
      "freq": "daily" | "weekly" | "hourly",
      "hour": 0-23, "minute": 0-59,
      "weekday": 0-6          // 0=Sun..6=Sat, weekly only
    },
    "event": {                // when type == "event"
      "app": connector_id,    // app to watch
      "filter": string,       // short natural-language condition
      "window": {             // OPTIONAL active hours; omit to watch all day
        "start": 0-1439, "end": 0-1439,   // minutes from local midnight
        "days": [0-6]
      }
    }
  },
  "nodes": [                  // ordered; FIRST node is the trigger
    { "id": "n1", "kind": "trigger"|"action"|"decision",
      "app": connector_id | "schedule" | "event" | "ai" | "decision",
      "label": string,        // 2-4 words
      "detail": string }      // one short sentence
  ],
  "edges": [                  // node-id flow; a decision has two: branch "yes" and "no"
    { "from": "n1", "to": "n2", "branch": "yes"|"no"|null }
  ]
}
Rules:
- Output ONLY the JSON object — no prose, no code fences.
- The FIRST node must be the trigger.
- Only use apps the user has connected. event.app must be a connected connector
  id (never 'ai', 'decision', or 'schedule').
- Times are 24-hour: hour is an integer 0-23 (4pm = 16, 9am = 9), minute 0-59.
  weekday (weekly only) is exactly: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5,
  Sat=6 — it MUST match the day you name in the title/instruction.
- Every edge's "from" and "to" must reference a node id you defined above.
- A decision node has exactly two outgoing edges — one branch "yes" and one
  branch "no" — going to DIFFERENT nodes. If you don't need a branch, don't use
  a decision node at all.
- Independent steps can run in PARALLEL: give ONE node two or more outgoing
  edges to separate action nodes (no yes/no branch) — use this for "do A and B"
  requests instead of forcing everything into a single chain.
- Built-in abilities (reminders, weather, maps, image, memory, bank) are 'ai'
  nodes whose detail names the action (e.g. GF_MAPS, GF_SET_REMINDER).`;

// Reconstruct the exact training-time system prompt (finetune/gen_data.py
// builder_system): intro + schema + this user's connected apps & tools.
function mlSystemPrompt(connected: string[]): string {
  const lines = [
    "You are the Go Farther workflow builder. The user describes an automation; you output a single workflow as JSON.\n\n" + SCHEMA_DOC,
    "",
    "The user has these apps connected:",
  ];
  for (const fid of connected) {
    const tools = CATALOG.toolsByFid[fid] || [];
    lines.push(`- ${fid}: ${tools.join(", ")}`);
  }
  lines.push("- built-ins (always, via 'ai' nodes): " + CATALOG.builtins.join(", "));
  return lines.join("\n");
}

// Structural validation mirroring finetune/schema.py validate_workflow (strict on
// structure, lenient on prose). `connected` enforces only-connected-apps.
function validateStructural(wf: any, connected: Set<string>): string[] {
  const errors: string[] = [];
  if (typeof wf !== "object" || wf === null || Array.isArray(wf)) return ["not a JSON object"];
  for (const k of ["title", "instruction", "trigger", "nodes", "edges"]) {
    if (!(k in wf)) errors.push(`missing '${k}'`);
  }
  if (errors.length) return errors;

  if (typeof wf.title !== "string" || !wf.title.trim()) errors.push("title must be non-empty");
  if (typeof wf.instruction !== "string" || !wf.instruction.trim()) errors.push("instruction must be non-empty");

  const trig = wf.trigger;
  if (typeof trig !== "object" || !trig || !["schedule", "event"].includes(trig.type)) {
    errors.push("trigger.type must be 'schedule' or 'event'");
  } else if (trig.type === "schedule") {
    const s = trig.schedule;
    if (typeof s !== "object" || !s) errors.push("schedule trigger needs a 'schedule' object");
    else {
      if (!["daily", "weekly", "hourly"].includes(s.freq)) errors.push("schedule.freq invalid");
      if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) errors.push("schedule.hour 0-23");
      if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) errors.push("schedule.minute 0-59");
      if (s.freq === "weekly" && !(Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6)) errors.push("weekly needs weekday 0-6");
    }
  } else {
    const ev = trig.event;
    if (typeof ev !== "object" || !ev) errors.push("event trigger needs an 'event' object");
    else {
      const app = ev.app;
      if (!VALID_APPS.has(app) || ["schedule", "event", "ai", "decision"].includes(app)) errors.push(`event.app '${app}' not connectable`);
      else if (!connected.has(app)) errors.push(`event.app '${app}' not connected`);
      if (typeof ev.filter !== "string" || !ev.filter.trim()) errors.push("event.filter must be non-empty");
    }
  }

  const nodes = wf.nodes;
  const ids = new Set<string>();
  if (!Array.isArray(nodes) || !nodes.length) errors.push("nodes must be a non-empty array");
  else {
    if (nodes[0]?.kind !== "trigger") errors.push("first node must be the trigger");
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (typeof n !== "object" || !n) { errors.push(`node[${i}] not an object`); continue; }
      const nid = n.id;
      if (typeof nid !== "string" || !nid) errors.push(`node[${i}] needs a string id`);
      else if (ids.has(nid)) errors.push(`duplicate node id '${nid}'`);
      else ids.add(nid);
      if (!["trigger", "action", "decision"].includes(n.kind)) errors.push(`node '${nid}' kind invalid`);
      const app = n.app;
      if (!VALID_APPS.has(app)) errors.push(`node '${nid}' app '${app}' invalid`);
      else if (!(connected.has(app) || ["schedule", "event", "ai", "decision"].includes(app))) errors.push(`node '${nid}' app '${app}' not connected`);
      if (typeof n.label !== "string" || !n.label.trim()) errors.push(`node '${nid}' needs a label`);
    }
  }

  const edges = wf.edges;
  if (!Array.isArray(edges)) errors.push("edges must be an array");
  else {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (typeof e !== "object" || !e) { errors.push(`edge[${i}] not an object`); continue; }
      if (!ids.has(e.from)) errors.push(`edge[${i}] 'from' unknown node`);
      if (!ids.has(e.to)) errors.push(`edge[${i}] 'to' unknown node`);
    }
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      if (n && typeof n === "object" && n.kind === "decision") {
        const outs = edges.filter((e: any) => e && e.from === n.id);
        const branches = new Set(outs.map((e: any) => e.branch));
        if (!branches.has("yes") || !branches.has("no")) errors.push(`decision '${n.id}' needs yes and no branches`);
      }
    }
  }
  return errors;
}

// Extract the first JSON object from model output (mirrors parse_and_validate).
function extractJson(text: string): any | null {
  const t = (text || "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// Call the fine-tuned model (OpenAI-compatible). Returns the parsed workflow or
// null on any failure (so the caller falls back to Opus).
async function tryMlBuild(connected: string[], userText: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ML_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ML_KEY}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: ML_MODEL,
        max_tokens: 2048,
        temperature: 0.2,   // override the Modelfile's 1.5 — JSON wants determinism
        messages: [
          { role: "system", content: mlSystemPrompt(connected) },
          { role: "user", content: userText },
        ],
      }),
    });
    if (!res.ok) { console.log(`ml endpoint ${res.status}`); return null; }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return extractJson(text);
  } catch (e) {
    console.log("ml call failed:", String(e).slice(0, 120));
    return null;
  } finally {
    clearTimeout(timer);
  }
}


// Top-down tree layout: BFS depth from the trigger sets the row; siblings spread
// horizontally. Gives the client sensible starting positions (the user can drag).
function layout(nodes: any[], edges: any[]): any[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { children.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) {
      children.get(e.from)!.push(e.to);
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    }
  }
  const depth = new Map<string, number>();
  const q: string[] = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  if (!q.length && nodes.length) q.push(nodes[0].id); // fallback root
  for (const id of q) depth.set(id, 0);
  for (let head = 0; head < q.length; head++) {
    const id = q[head];
    const d = depth.get(id) || 0;
    for (const c of children.get(id) || []) {
      if (!depth.has(c) || depth.get(c)! < d + 1) depth.set(c, d + 1);
      if (!q.includes(c)) q.push(c);
    }
  }
  let maxD = 0;
  for (const d of depth.values()) maxD = Math.max(maxD, d);
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, ++maxD); // orphans last
  const rows = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) || 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n.id);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const SP_Y = 140, SP_X = 160, CX = 0;
  for (const [d, row] of rows) {
    row.forEach((id, i) => {
      const n = byId.get(id)!;
      n.x = Math.round(CX + (i - (row.length - 1) / 2) * SP_X);
      n.y = d * SP_Y;
    });
  }
  return nodes;
}

// Normalize an emitted event window: clamp times, dedupe days, inject the user's
// tz (server-side, so the model can't get it wrong). Returns null if unusable.
function normWindow(w: any, tz: string): any | null {
  if (!w || typeof w !== "object") return null;
  const clamp = (n: number) => Math.min(1439, Math.max(0, Math.floor(Number(n) || 0)));
  const start = clamp(w.start), end = clamp(w.end);
  if (start === end) return null;
  const days = Array.isArray(w.days)
    ? [...new Set(w.days.map(Number).filter((d: number) => d >= 0 && d <= 6))]
    : [];
  return { start, end, days, tz };
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  if (!ANTHROPIC_KEY) return J({ error: "The builder isn't configured yet." }, 500);

  const uid = userFromJwt(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  // Accept either a single `description` or the running `messages` conversation
  // ([{role:'user'|'assistant', text}]). The assistant turns are prior questions.
  let tz = "UTC";
  let messages: { role: "user" | "assistant"; content: string }[] = [];
  try {
    const b = await req.json();
    if (typeof b.tz === "string" && b.tz) tz = b.tz;
    if (Array.isArray(b.messages)) {
      messages = b.messages
        .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.text ?? m?.content ?? "").slice(0, 2000) }))
        .filter((m: { content: string }) => m.content);
    } else if (b.description) {
      messages = [{ role: "user", content: String(b.description).slice(0, 2000) }];
    }
  } catch { /* fallthrough */ }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return J({ error: "Describe what you want the workflow to do." }, 400);
  }

  const apps = await connectedApps(uid);
  const appList = apps.length ? apps.join(", ") : "(none connected yet)";
  const askedCount = messages.filter((m) => m.role === "assistant").length;
  // Memory FIRST: give the builder what the user already told us, so it can resolve
  // a person/recipient/preference from a saved fact before any lookup or question.
  const memOn = await memoryEnabled(uid);
  const mems = memOn ? await fetchMemories(uid) : [];
  const memBlock = mems.length
    ? ` You already KNOW these facts about the user (saved memories — use them to resolve a person, recipient, or preference BEFORE looking anything up or asking):\n${mems.map((m) => `• ${m}`).join("\n")}`
    : "";
  const system = `You design automations for the Go Farther mobile app. Turn the user's request into a workflow as a GRAPH of steps, read top-to-bottom like a flowchart. Be the kind of assistant that asks a quick question when it actually matters instead of guessing wrong — but never asks just to ask.

Use ONLY the user's connected apps for app steps and event triggers — their connector ids are listed at the end of these instructions.

CRITICAL — a workflow you emit must RUN right now. Every app step (and an event trigger) must use an app from that connected list. NEVER emit a step or trigger for an app that isn't connected — it would just fail. If the request needs an app that isn't connected, ASK whether to use a connected app instead or drop that part, and only emit once everything maps to a connected app. If the workflow's CORE purpose needs an app the user hasn't connected and no connected app can substitute, do NOT keep re-asking the same thing — call cannot_build with a short, friendly message naming the app to connect (e.g. an email app like Gmail). Also call cannot_build, rather than looping, when the request can't be built safely (e.g. emailing many people at high frequency — that's spam). Always either ask a question, emit a complete working workflow, or call cannot_build — never return nothing and never repeat a question you've already asked.

## First: build, or ask?
When you're not sure, ASK — one quick question beats building the wrong thing. NEVER silently guess or assume a detail, identity, recipient, or account you aren't certain of. Resolve it in this order: (1) if you already KNOW it from the user's saved memories (listed below), use that; (2) else look it up with a tool (use find_contact to resolve a named person); (3) if you still aren't sure, ASK. A workflow built on a guess is a broken workflow. Call the "ask" tool when ANY of these hold:
- TWO OR MORE connected apps could do a step and the user didn't say which — e.g. Gmail AND Outlook both connected and they said "email me" / "send an email": you MUST ask which account, never silently pick one.
- a key detail is missing with no safe default: who/where (recipient, which Slack channel, which list/board), WHICH items ("my emails" = all? unread? from a sender/label?), or the exact event condition,
- the user names a PERSON/contact without an email or handle (e.g. "from Jhon", "reply to Sarah"): FIRST check the saved memories below — if they already tell you this person's email, use it. If not, call find_contact to resolve them — exactly one clear match → use that exact address in the trigger filter and the instruction; several plausible → ASK which (offer the addresses as options); none found → ASK for their email. NEVER leave a trigger as just "from <name>" — the runner can't reliably tell who that is,
- the trigger is an EVENT (arrival-based) and the user hasn't said WHEN to watch — ALWAYS ask the active hours, because watching 24/7 costs much more than a narrow window. Offer tappable options that fit their case (e.g. work hours, a specific window) plus "All day", then set event.window from their answer,
- the workflow's CORE purpose needs an app the user has NOT connected (ask, and offer the closest connected app as an option),
- it would delete, pay, or message people at scale (confirm scope first),
- the request is too vague to act on.
Do NOT ask when:
- only ONE connected app fits the step — just use it,
- the detail has a sensible default the user can tweak later (a schedule's run time, wording, layout) — pick a reasonable one; the graph is fully editable (but an EVENT trigger's active hours is the exception above — always ask it, since it drives cost),
- a needed app is only peripheral — substitute the closest connected app or "ai" and note it in that step's detail.

## How to ask (this matters)
- Gather EVERYTHING you're unsure about and ask it in ONE round. Don't ask, get an answer, then ask again.
- Make EVERY question MULTIPLE CHOICE: give 2-4 concrete options the user can tap (the app adds an "Other" choice for anything not listed, so never add one yourself). Only a truly open detail (e.g. an exact email address) may have no options.
- Give each option a short label, plus a one-line description when it adds clarity. Give each question a 1-2 word header (e.g. "Account", "Scope").
- Keep questions short and plain — no jargon, don't restate the whole request.
- Never re-ask something already answered earlier in the conversation.
KEEP ASKING until you have everything you need to build a workflow that will actually run (the right account, recipient, scope, and only connected apps) — but never re-ask what's already been answered. Don't emit a half-working workflow just to avoid a question.

## When building, call emit_workflow
- The FIRST node is the trigger: kind "trigger", app "schedule" (time-based) or "event" (fires when something new arrives in an app).
- Pure-reasoning steps (summarize, draft, decide wording) use app "ai". An if/branch is kind "decision", app "decision".
- App steps use the connector id from the connected list.
- Labels: 2-4 words. detail: one short sentence.
- edges connect node ids in execution order; a decision node has exactly two outgoing edges, branch "yes" and "no".
- trigger: if time-based, fill schedule {freq, hour 0-23, minute, weekday 0-6 when weekly} in the user's timezone; default to a daily 8:00 AM run when unspecified. If arrival-based, fill event {app: <connector id>, filter: <short condition>}. Once the user has told you WHEN to watch (in their request or by answering your active-hours question), set event.window {start, end as minutes from midnight; days 0-6, omit for every day} — only omit window when they explicitly chose to watch all day, every day.
- instruction: one clear, self-contained paragraph the assistant follows each run, naming the apps. Make every step handle the empty case gracefully (if there's nothing to act on, do nothing or send a brief "nothing today" — never error). This is the real executable spec.

## Examples (match this shape — note how self-contained and runnable the instruction is)
Request: "Every morning at 8, summarize my unread Gmail from the last day and email me the digest." → emit_workflow({"title":"Morning Inbox Digest","instruction":"Each morning, fetch the user's unread Gmail from the last 24 hours. If there are none, email a short note saying 'No new unread email today' and stop. Otherwise write a concise digest — group messages by sender with a one-line summary of each, and call out anything urgent or time-sensitive — then send it to the user's own Gmail with the subject 'Your morning inbox digest'.","trigger":{"type":"schedule","schedule":{"freq":"daily","hour":8,"minute":0}},"nodes":[{"id":"n1","kind":"trigger","app":"schedule","label":"Daily 8 AM","detail":"Runs every morning"},{"id":"n2","kind":"action","app":"gmail","label":"Get unread","detail":"Unread Gmail from the last 24h"},{"id":"n3","kind":"action","app":"ai","label":"Summarize","detail":"Group by sender, flag urgent"},{"id":"n4","kind":"action","app":"gmail","label":"Email digest","detail":"Send the summary to the user"}],"edges":[{"from":"n1","to":"n2"},{"from":"n2","to":"n3"},{"from":"n3","to":"n4"}]})
Request: "When an email from my boss arrives, Slack me a one-line summary." (Gmail + Slack connected) → first ask active hours: ask({"questions":[{"header":"Watch hours","question":"When should I watch for emails from your boss? Watching all day costs more than a set window.","options":[{"label":"Work hours","description":"Mon–Fri, 9 AM–5 PM"},{"label":"Extended hours","description":"Every day, 7 AM–9 PM"},{"label":"All day","description":"24/7 — most thorough, costs more"}]}]}). After they pick "Work hours" → emit_workflow({"title":"Boss Email Alerts","instruction":"When a new email arrives in Gmail, check whether it's from the user's boss. If it isn't, do nothing. If it is, read it and write a one-line summary covering what it's about and whether it needs a reply, then send that as a Slack direct message to the user. Never send more than one DM per email.","trigger":{"type":"event","event":{"app":"gmail","filter":"a new email from the user's boss","window":{"start":540,"end":1020,"days":[1,2,3,4,5]}}},"nodes":[{"id":"n1","kind":"trigger","app":"event","label":"Boss emails","detail":"New Gmail from the boss, work hours"},{"id":"n2","kind":"action","app":"ai","label":"Summarize","detail":"One line: topic + reply needed?"},{"id":"n3","kind":"action","app":"slack","label":"Slack DM","detail":"Send the summary to the user"}],"edges":[{"from":"n1","to":"n2"},{"from":"n2","to":"n3"}]})`;

  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 3000,
    // Cache the static design instructions + tools (stable within a build
    // conversation); keep the per-turn ask count in a separate uncached block.
    // 1h TTL: build chats are interactive (ask -> the user answers), and the
    // gap between turns regularly outlives the default 5-minute window.
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `The user's connected apps (use ONLY these connector ids for app steps and event triggers): ${appList}. The user's timezone is ${tz}. So far you have asked ${askedCount} clarifying question(s) in this conversation.${memBlock}` },
    ],
    tools: [FIND_CONTACT_TOOL, ASK_TOOL, EMIT_TOOL, CANNOT_BUILD_TOOL],
    // Never FORCE a build — a forced build can produce a workflow that won't run.
    // The model keeps asking (or looks a person up) until it can emit one that
    // actually works, enforced by the system prompt + the connected-apps check.
    tool_choice: { type: "any" },
  };

  // The model may call find_contact (read-only) to resolve a person it would
  // otherwise guess at; execute those server-side and loop until it asks or emits.
  const apiMessages: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let content: any[] = [];
  let engine = "opus";
  // Fast path: the fine-tuned local model emits a workflow in one shot, gated
  // on WORKFLOW_MODEL_BASE_URL and only on a fresh single-turn build. Its graph
  // is structurally validated + connected-apps-checked here; the build path
  // below still re-checks. On any miss this stays empty -> fall through to Opus.
  if (ML_BASE_URL && askedCount === 0 && messages.length === 1) {
    const wf = await tryMlBuild(apps, messages[messages.length - 1].content);
    if (wf && validateStructural(wf, new Set(apps)).length === 0) {
      content = [{ type: "tool_use", name: "emit_workflow", input: wf }];
      engine = "ml";
    }
  }
  for (let turn = 0; !content.length && turn < 4; turn++) {
    reqBody.messages = apiMessages;
    let res: Response;
    try {
      const call = () => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(reqBody),
      });
      res = await call();
      // One retry on transient throttle/overload (429/529).
      if (res.status === 429 || res.status === 529) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await call();
      }
    } catch (e) {
      console.error("builder request failed:", e);
      return J({ error: "The builder is temporarily unavailable. Please try again." }, 502);
    }
    if (!res.ok) {
      console.error(`builder ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return J({ error: "The builder is temporarily unavailable. Please try again." }, 502);
    }
    const data = await res.json();
    content = data.content || [];
    const fc = content.find((b: any) => b?.type === "tool_use" && b?.name === "find_contact");
    if (fc && turn < 3) {
      const found = await findContact(uid, fc.input?.query, apps);
      apiMessages.push({ role: "assistant", content });
      apiMessages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: fc.id, content: found }] });
      continue;
    }
    break;
  }

  // Clarifying questions path. Each question is multiple-choice: a header, the
  // question, and tappable options ({label, description?}). The app adds "Other".
  const ask = content.find((b: any) => b?.type === "tool_use" && b?.name === "ask");
  if (ask?.input?.questions && Array.isArray(ask.input.questions)) {
    const questions = ask.input.questions
      .map((q: any) => {
        const text = String((q && typeof q === "object" ? (q.question ?? q.text) : q) ?? "").trim();
        const header = q && typeof q === "object" ? String(q.header ?? "").trim() : "";
        const options = q && typeof q === "object" && Array.isArray(q.options)
          ? q.options
              .map((o: any) => {
                if (o && typeof o === "object") {
                  const label = String(o.label ?? o.value ?? "").trim();
                  const description = String(o.description ?? "").trim();
                  return label ? (description ? { label, description } : { label }) : null;
                }
                const label = String(o ?? "").trim();
                return label ? { label } : null;
              })
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const out: any = { text };
        if (header) out.header = header;
        if (options.length) out.options = options;
        return out;
      })
      .filter((q: { text: string }) => q.text)
      .slice(0, 3);
    if (questions.length) return J({ questions });
  }

  // Terminal "can't build" — the model decided there's no runnable workflow
  // (needed app not connected, or unsafe request). Return a clear final message
  // instead of looping on questions.
  const cant = content.find((b: any) => b?.type === "tool_use" && b?.name === "cannot_build");
  if (cant?.input?.reason) {
    return J({ blocked: { message: String(cant.input.reason).slice(0, 500) } });
  }

  // Build path.
  const tu = content.find((b: any) => b?.type === "tool_use" && b?.name === "emit_workflow");
  if (!tu || !tu.input) {
    // No emit, no usable question, no explicit block. If we've already asked at
    // least once and STILL can't proceed, stop looping with a terminal message;
    // only on a first dead-end do we gently re-ask.
    if (askedCount >= 1) {
      return J({ blocked: { message: "I couldn't set this up with your connected apps. Connect the app this needs — for example an email app like Gmail — in the Connectors screen, then describe it again." } });
    }
    return J({ questions: [{ header: "Quick check", text: "Tell me a bit more — what should this workflow do, and which of your connected apps should it use?" }] });
  }
  const plan = tu.input as any;

  const nodes = (Array.isArray(plan.nodes) ? plan.nodes : []).map((n: any, i: number) => ({
    id: String(n?.id || `n${i + 1}`),
    kind: ["trigger", "action", "decision"].includes(n?.kind) ? n.kind : "action",
    app: String(n?.app || "ai"),
    label: String(n?.label || "Step").slice(0, 40),
    detail: String(n?.detail || "").slice(0, 200),
  }));
  const edges = (Array.isArray(plan.edges) ? plan.edges : [])
    .map((e: any) => ({ from: String(e?.from || ""), to: String(e?.to || ""), branch: e?.branch === "yes" || e?.branch === "no" ? e.branch : null }))
    .filter((e: any) => e.from && e.to);

  const trigger = (plan.trigger && typeof plan.trigger === "object") ? plan.trigger : { type: "schedule" };
  if (trigger.type === "schedule") {
    trigger.schedule = { freq: "daily", hour: 8, minute: 0, weekday: 1, ...(trigger.schedule || {}), tz };
  } else if (trigger.type === "event") {
    // An event trigger must watch a real, connected app or it would never fire
    // (silently). Fall back to the first connected app, else to a daily schedule.
    const ev = (trigger.event && typeof trigger.event === "object") ? trigger.event : {};
    let app = String(ev.app || "");
    // Keep a valid connector id even if it isn't connected yet (the runner just
    // waits until the user connects it). Only replace an empty/unknown app — never
    // silently switch the trigger to a different app.
    if (!APP_TO_SLUG[app]) app = apps[0] || "";
    if (app) {
      const win = normWindow(ev.window, tz);
      trigger.event = win ? { app, filter: String(ev.filter || ""), window: win } : { app, filter: String(ev.filter || "") };
    }
    else { trigger.type = "schedule"; trigger.schedule = { freq: "daily", hour: 8, minute: 0, weekday: 1, tz }; }
  }

  // Don't create a workflow that can't run: every app step (and an event trigger)
  // must use a connected app. If the model slipped one in, ask instead of emitting.
  const unconnected = [...new Set(
    nodes.filter((n: any) => n.kind !== "trigger" && APP_TO_SLUG[n.app] && !apps.includes(n.app)).map((n: any) => String(n.app)),
  )] as string[];
  if (trigger.type === "event" && trigger.event?.app && APP_TO_SLUG[trigger.event.app]
      && !apps.includes(trigger.event.app) && !unconnected.includes(String(trigger.event.app))) {
    unconnected.push(String(trigger.event.app));
  }
  if (unconnected.length) {
    const names = unconnected.join(", ");
    const plural = unconnected.length > 1;
    return J({ questions: [{
      header: "Not connected",
      text: `This needs ${names}, which ${plural ? "aren't" : "isn't"} connected, so it wouldn't run yet. How should I handle ${plural ? "them" : "it"}?`,
      options: [
        { label: plural ? "I'll connect them" : `I'll connect ${unconnected[0]}`, description: "Connect first, then describe it to me again" },
        { label: "Use only my connected apps", description: "Build it without those steps" },
      ],
    }] });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const out = {
    title: String(plan.title || lastUser.slice(0, 40)),
    instruction: String(plan.instruction || lastUser),
    trigger,
    graph: { nodes: layout(nodes, edges), edges },
    _engine: engine,
  };
  return J(out);
});
