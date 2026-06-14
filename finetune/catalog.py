"""Grounded tool/connector catalog for Go Farther workflow fine-tuning.

This mirrors production so the training data matches what the app actually
accepts:

- ``ALLOWED`` is copied verbatim from ``supabase/functions/gofarther-mcp``
  (the curated per-app tool list).
- ``ALIASES`` maps a Composio toolkit slug -> the *frontend connector id* the
  workflow graph uses in node ``app`` fields (e.g. googlecalendar -> gcal).
  The confirmed ones come from ``src/suggestions.ts`` (BY_APP keys). Any slug
  not listed defaults to itself — verify against ``src/`` and fix here if a
  connector id differs.
- ``BUILTINS`` are the always-available GF_* tools (no connector needed).

These are invoked from a graph node. A node's ``app`` is one of:
  * a frontend connector id (gmail, gcal, slack, ...)
  * a special id: 'schedule' / 'event' (trigger), 'ai' (reason / built-in
    tools like reminders & weather), 'decision' (branch).
"""

import json
from pathlib import Path

# --- Composio per-app tool lists (verbatim from gofarther-mcp ALLOWED) -------
ALLOWED: dict[str, list[str]] = {
    "gmail": ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_SEND_EMAIL", "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_REPLY_TO_THREAD", "GMAIL_LIST_DRAFTS"],
    "googlecalendar": ["GOOGLECALENDAR_FIND_EVENT", "GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_LIST_CALENDARS", "GOOGLECALENDAR_FIND_FREE_SLOTS"],
    "googledrive": ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_DOWNLOAD_FILE", "GOOGLEDRIVE_FIND_FOLDER", "GOOGLEDRIVE_LIST_FILES", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", "GOOGLEDRIVE_UPLOAD_FILE"],
    "canva": ["CANVA_LIST_USER_DESIGNS", "CANVA_LIST_FOLDER_ITEMS_BY_TYPE_WITH_SORTING", "CANVA_ACCESS_USER_SPECIFIC_BRAND_TEMPLATES_LIST", "CANVA_CREATE_CANVA_DESIGN_EXPORT_JOB", "CANVA_GET_DESIGN_EXPORT_JOB_RESULT"],
    "figma": ["FIGMA_GET_PROJECTS_IN_A_TEAM", "FIGMA_GET_FILES_IN_A_PROJECT", "FIGMA_GET_FILE_METADATA", "FIGMA_GET_COMMENTS_IN_A_FILE", "FIGMA_GET_FILE_NODES", "FIGMA_DOWNLOAD_FIGMA_IMAGES"],
    "notion": ["NOTION_SEARCH_NOTION_PAGE", "NOTION_GET_PAGE_MARKDOWN", "NOTION_QUERY_DATABASE", "NOTION_FETCH_DATABASE", "NOTION_CREATE_NOTION_PAGE", "NOTION_APPEND_TEXT_BLOCKS"],
    "jira": ["JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", "JIRA_GET_ISSUE", "JIRA_CREATE_ISSUE", "JIRA_GET_ALL_PROJECTS", "JIRA_ADD_COMMENT", "JIRA_TRANSITION_ISSUE"],
    "slack": ["SLACK_LIST_ALL_CHANNELS", "SLACK_SEND_MESSAGE", "SLACK_FETCH_CONVERSATION_HISTORY", "SLACK_SEARCH_MESSAGES", "SLACK_ADD_REACTION_TO_AN_ITEM"],
    "hubspot": ["HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", "HUBSPOT_LIST_CONTACTS", "HUBSPOT_LIST_DEALS", "HUBSPOT_SEARCH_DEALS", "HUBSPOT_CREATE_CONTACT"],
    "outlook": ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_SEARCH_MESSAGES", "OUTLOOK_GET_MESSAGE", "OUTLOOK_SEND_EMAIL", "OUTLOOK_CREATE_DRAFT", "OUTLOOK_REPLY_EMAIL"],
    "googlesheets": ["GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_BATCH_GET", "GOOGLESHEETS_GET_SHEET_NAMES", "GOOGLESHEETS_GET_SPREADSHEET_INFO", "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW", "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", "GOOGLESHEETS_ADD_SHEET"],
    "googledocs": ["GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", "GOOGLEDOCS_LIST_SPREADSHEET_CHARTS", "GOOGLEDOCS_COPY_DOCUMENT", "GOOGLEDOCS_CREATE_DOCUMENT2", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", "GOOGLEDOCS_CREATE_FOOTER"],
    "excel": ["EXCEL_LIST_FILES", "EXCEL_LIST_WORKSHEETS", "EXCEL_GET_RANGE", "EXCEL_UPDATE_RANGE", "EXCEL_LIST_TABLES", "EXCEL_GET_WORKBOOK", "EXCEL_ADD_WORKSHEET", "EXCEL_SORT_RANGE"],
    "one_drive": ["ONE_DRIVE_GET_DRIVE", "ONE_DRIVE_GET_DRIVE_ITEM_BY_SHARING_URL", "ONE_DRIVE_GET_FOLLOWED_ITEM", "ONE_DRIVE_GET_GROUP_DRIVE", "ONE_DRIVE_GET_ITEM", "ONE_DRIVE_GET_ITEM_PERMISSIONS"],
    "dropbox": ["DROPBOX_FILES_SEARCH", "DROPBOX_GET_ACCOUNT", "DROPBOX_GET_SHARED_FOLDER_METADATA", "DROPBOX_GET_SPACE_USAGE", "DROPBOX_GET_TEAM_INFO", "DROPBOX_GET_TEAM_LOG_EVENTS"],
    "box": ["BOX_FIND_FILE_FOR_SHARED_LINK", "BOX_GET_FILE_INFORMATION", "BOX_GET_FOLDER", "BOX_LIST_FILE_COMMENTS", "BOX_LIST_ITEMS_IN_FOLDER", "BOX_SEARCH_FOR_CONTENT"],
    "onenote": ["ONENOTE_GET_GROUP_SECTIONS", "ONENOTE_GET_NOTEBOOK_FROM_WEB_URL", "ONENOTE_GET_NOTEBOOK_SECTION_GROUP", "ONENOTE_GET_ONENOTE_GROUP_SECTIONS_PAGES", "ONENOTE_GET_SITE_SECTIONS", "ONENOTE_GET_SITE_SECTIONS_PAGES"],
    "airtable": ["AIRTABLE_GET_BASE_SCHEMA", "AIRTABLE_GET_RECORD", "AIRTABLE_LIST_BASES", "AIRTABLE_CREATE_MULTIPLE_RECORDS", "AIRTABLE_CREATE_RECORD", "AIRTABLE_CREATE_RECORD_FROM_NATURAL_LANGUAGE"],
    "todoist": ["TODOIST_GET_ALL_TASKS", "TODOIST_CREATE_TASK", "TODOIST_UPDATE_TASK", "TODOIST_CLOSE_TASK", "TODOIST_GET_ALL_PROJECTS", "TODOIST_CREATE_PROJECT"],
    "googletasks": ["GOOGLETASKS_LIST_ALL_TASKS", "GOOGLETASKS_LIST_TASK_LISTS", "GOOGLETASKS_GET_TASK", "GOOGLETASKS_INSERT_TASK", "GOOGLETASKS_UPDATE_TASK", "GOOGLETASKS_DELETE_TASK"],
    "asana": ["ASANA_SEARCH_TASKS_IN_WORKSPACE", "ASANA_GET_TASKS_FROM_A_PROJECT", "ASANA_GET_A_TASK", "ASANA_CREATE_A_TASK", "ASANA_UPDATE_A_TASK", "ASANA_GET_MULTIPLE_PROJECTS"],
    "trello": ["TRELLO_GET_SEARCH", "TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD", "TRELLO_GET_CARDS_BY_ID_CARD", "TRELLO_ADD_CARDS", "TRELLO_UPDATE_CARDS_BY_ID_CARD", "TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD"],
    "clickup": ["CLICKUP_CREATE_LIST", "CLICKUP_CREATE_THREADED_COMMENT", "CLICKUP_GET_DOC_PAGE_CONTENT", "CLICKUP_GET_TASK", "CLICKUP_MOVE_TASK_TO_HOME_LIST", "CLICKUP_CREATE_DOC"],
    "monday": ["MONDAY_GET_ITEMS", "MONDAY_LIST_BOARD_ITEMS", "MONDAY_LIST_BOARDS", "MONDAY_LIST_ITEMS_BY_COLUMN_VALUES", "MONDAY_LIST_USERS", "MONDAY_ADD_USERS_TO_BOARD"],
    "miro": ["MIRO_GET_BOARD", "MIRO_GET_BOARD_MEMBERS", "MIRO_GET_BOARDS", "MIRO_GET_BOARDS2", "MIRO_GET_FRAME_ITEM", "MIRO_GET_TAG"],
    "calendly": ["CALENDLY_GET_EVENT_TYPE_AVAILABILITY", "CALENDLY_GET_ORGANIZATION", "CALENDLY_GET_USER", "CALENDLY_LIST_EVENT_TYPES", "CALENDLY_LIST_SCHEDULED_EVENTS", "CALENDLY_CANCEL_SCHEDULED_EVENT"],
    "zoom": ["ZOOM_GET_A_MEETING", "ZOOM_GET_A_MEETING_SUMMARY", "ZOOM_GET_MEETING_RECORDINGS", "ZOOM_GET_USER", "ZOOM_LIST_ALL_RECORDINGS", "ZOOM_LIST_MEETINGS"],
    "googlemeet": ["GOOGLEMEET_GET_CONFERENCE_RECORD_BY_NAME", "GOOGLEMEET_GET_PARTICIPANT_SESSION", "GOOGLEMEET_LIST_CONFERENCE_RECORDS", "GOOGLEMEET_LIST_PARTICIPANTS", "GOOGLEMEET_LIST_PARTICIPANT_SESSIONS", "GOOGLEMEET_LIST_RECORDINGS"],
    "microsoft_teams": ["MICROSOFT_TEAMS_GET_CHANNEL", "MICROSOFT_TEAMS_GET_CHAT_MESSAGE", "MICROSOFT_TEAMS_GET_MEETING_TRANSCRIPT_CONTENT", "MICROSOFT_TEAMS_GET_MY_PROFILE", "MICROSOFT_TEAMS_GET_PRIMARY_CHANNEL", "MICROSOFT_TEAMS_GET_SCHEDULE"],
    "webex": ["WEBEX_GET_TEAM_DETAILS", "WEBEX_LIST_TEAMS", "WEBEX_LIST_WEBHOOKS", "WEBEX_MESSAGING_GET_MEMBERSHIP_DETAILS", "WEBEX_MESSAGING_GET_MESSAGE_DETAILS", "WEBEX_MESSAGING_GET_TEAM_MEMBERSHIP_DETAILS"],
    "telegram": ["TELEGRAM_GET_CHAT_MEMBER", "TELEGRAM_SEND_MESSAGE"],
    "discord": ["DISCORD_GET_GATEWAY", "DISCORD_GET_INVITE", "DISCORD_GET_USER", "DISCORD_INVITE_RESOLVE"],
    "linkedin": ["LINKEDIN_GET_PERSON", "LINKEDIN_GET_POST_CONTENT", "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE", "LINKEDIN_INITIALIZE_IMAGE_UPLOAD", "LINKEDIN_REGISTER_IMAGE_UPLOAD"],
    "reddit": ["REDDIT_GET", "REDDIT_GET_CONTROVERSIAL_POSTS", "REDDIT_GET_NEW", "REDDIT_GET_REDDIT_USER_ABOUT", "REDDIT_GET_R_TOP", "REDDIT_GET_SUBREDDITS_SEARCH"],
    "youtube": ["YOUTUBE_ADD_VIDEO_TO_PLAYLIST", "YOUTUBE_CREATE_PLAYLIST", "YOUTUBE_LIST_CAPTION_TRACK", "YOUTUBE_LIST_COMMENTS", "YOUTUBE_LIST_COMMENT_THREADS", "YOUTUBE_UPDATE_PLAYLIST"],
    "instagram": ["INSTAGRAM_GET_IG_MEDIA", "INSTAGRAM_GET_IG_MEDIA_COMMENTS", "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", "INSTAGRAM_GET_IG_USER_MEDIA", "INSTAGRAM_GET_PAGE_CONVERSATIONS", "INSTAGRAM_CREATE_CAROUSEL_CONTAINER"],
    "twitter": ["TWITTER_CREATE_LIST", "TWITTER_DELETE_LIST", "TWITTER_GET_BLOCKED_USERS", "TWITTER_GET_POST_ANALYTICS", "TWITTER_RECENT_SEARCH", "TWITTER_CREATION_OF_A_POST"],
    "spotify": ["SPOTIFY_ADD_ITEMS_TO_PLAYLIST", "SPOTIFY_CREATE_PLAYLIST", "SPOTIFY_GET_ARTIST_S_TOP_TRACKS", "SPOTIFY_GET_PLAYLIST", "SPOTIFY_GET_SHOW", "SPOTIFY_GET_SHOW_EPISODES"],
    "salesforce": ["SALESFORCE_EXECUTE_SOQL_QUERY", "SALESFORCE_SEARCH_CONTACTS", "SALESFORCE_SEARCH_OPPORTUNITIES", "SALESFORCE_GET_ACCOUNT", "SALESFORCE_CREATE_LEAD", "SALESFORCE_UPDATE_RECORD"],
    "pipedrive": ["PIPEDRIVE_GET_ACTIVITY_FIELD", "PIPEDRIVE_GET_ALL_LEADS", "PIPEDRIVE_GET_ALL_PRODUCTS", "PIPEDRIVE_GET_DEAL", "PIPEDRIVE_GET_DEAL_FIELD", "PIPEDRIVE_GET_LEAD_CONVERSION_STATUS"],
    "zoho": ["ZOHO_GET_RELATED_LISTS", "ZOHO_GET_RELATED_RECORDS", "ZOHO_GET_ZOHO_USERS", "ZOHO_LIST_MODULES", "ZOHO_LIST_RECORD_ATTACHMENTS", "ZOHO_SEARCH_ZOHO_RECORDS"],
    "zendesk": ["ZENDESK_GET_ATTACHMENT", "ZENDESK_GET_USER", "ZENDESK_GET_USERS_ASSIGNED_TICKETS", "ZENDESK_GET_USERS_CCD_TICKETS", "ZENDESK_GET_USERS_FOLLOWED_TICKETS", "ZENDESK_GET_USERS_REQUESTED_TICKETS"],
    "intercom": ["INTERCOM_GET_CONVERSATION", "INTERCOM_GET_TICKET", "INTERCOM_LIST_ALL_MACROS", "INTERCOM_LIST_CONTACTS", "INTERCOM_LIST_CONVERSATIONS", "INTERCOM_LIST_SEGMENTS"],
    "freshdesk": ["FRESHDESK_GET_ACCOUNT", "FRESHDESK_GET_AGENT", "FRESHDESK_GET_AGENTS", "FRESHDESK_GET_COMPANIES", "FRESHDESK_GET_COMPANY", "FRESHDESK_GET_COMPANY_FIELDS"],
    "shopify": ["SHOPIFY_GET_CUSTOMER", "SHOPIFY_GET_CUSTOMERS_SEARCH", "SHOPIFY_GET_ORDER", "SHOPIFY_GET_SHOP_CONFIGURATION", "SHOPIFY_GET_SHOP_DETAILS", "SHOPIFY_LIST_CUSTOMERS"],
    "stripe": ["STRIPE_LIST_CUSTOMERS", "STRIPE_GET_V1_CUSTOMERS_SEARCH_CUSTOMERS", "STRIPE_LIST_CHARGES", "STRIPE_LIST_INVOICES", "STRIPE_LIST_PAYMENT_INTENTS", "STRIPE_GET_BALANCE_HISTORY"],
    "square": ["SQUARE_GET_CURRENT_MERCHANT", "SQUARE_GET_MERCHANT", "SQUARE_LIST_CHANNELS", "SQUARE_LIST_CUSTOMER_GROUPS", "SQUARE_LIST_CUSTOMERS", "SQUARE_LIST_CUSTOMER_SEGMENTS"],
    "quickbooks": ["QUICKBOOKS_GET_AGED_RECEIVABLES_REPORT", "QUICKBOOKS_GET_BALANCE_SHEET_REPORT", "QUICKBOOKS_GET_CHANGED_ENTITIES", "QUICKBOOKS_GET_COMPANY_INFO", "QUICKBOOKS_GET_GENERAL_LEDGER_REPORT", "QUICKBOOKS_GET_PROFIT_AND_LOSS_DETAIL_REPORT"],
    "xero": ["XERO_GET_ACCOUNT", "XERO_GET_ASSET", "XERO_GET_BALANCE_SHEET_REPORT", "XERO_GET_BUDGET", "XERO_GET_CONNECTIONS", "XERO_GET_CONTACTS"],
    "typeform": ["TYPEFORM_GET_ABOUT_ME", "TYPEFORM_GET_FORM", "TYPEFORM_GET_FORM_RESPONSES", "TYPEFORM_GET_WORKSPACE", "TYPEFORM_LIST_FORMS", "TYPEFORM_LIST_THEMES"],
    "jotform": ["JOTFORM_GET_SYSTEM_PLAN", "JOTFORM_GET_USER_DETAILS", "JOTFORM_GET_USER_FOLDERS", "JOTFORM_GET_USER_FORMS", "JOTFORM_GET_USER_HISTORY", "JOTFORM_GET_USER_REPORTS"],
    "mailchimp": ["MAILCHIMP_GET_AUDIENCES_CONTACTS", "MAILCHIMP_GET_AUDIENCES_CONTACTS_DETAIL", "MAILCHIMP_GET_CAMPAIGN_INFO", "MAILCHIMP_GET_LISTS_INFO", "MAILCHIMP_LIST_CAMPAIGNS", "MAILCHIMP_LIST_RECENT_ACTIVITY"],
    "sendgrid": ["SENDGRID_ADD_OR_UPDATE_A_CONTACT", "SENDGRID_SEARCH_CONTACTS", "SENDGRID_RETRIEVE_ALL_LISTS", "SENDGRID_CREATE_A_LIST", "SENDGRID_RETRIEVE_ALL_CAMPAIGNS", "SENDGRID_GET_TOTAL_CONTACT_COUNT"],
    "klaviyo": ["KLAVIYO_ADD_PROFILE_TO_LIST", "KLAVIYO_CREATE_LIST", "KLAVIYO_GET_BULK_DELETE_CATALOG_ITEMS_JOB", "KLAVIYO_GET_BULK_UPDATE_CATEGORIES_JOB", "KLAVIYO_GET_CAMPAIGN", "KLAVIYO_GET_CAMPAIGNS"],
}

# Composio slug -> frontend connector id used in workflow graph nodes.
# Confirmed from src/suggestions.ts BY_APP keys; others default to the slug.
ALIASES: dict[str, str] = {
    "outlook": "m365",
    "googlecalendar": "gcal",
    "googledrive": "gdrive",
}

# --- Universe expansion ------------------------------------------------------
# Merge every Composio connector (catalog_connectors.json, built by
# build_universe_catalog.py + rebalance_tools.py) so the catalog spans the whole
# universe at ~20 balanced tools/app. gmail & outlook are hand-set — preserved
# verbatim; every other connector (incl. the other originals) takes the
# rebalanced set. Safe to ship without the file (then it's just the hardcoded 54).
KEEP_VERBATIM = {"gmail", "outlook"}


def _merge_universe() -> int:
    f = Path(__file__).parent / "catalog_connectors.json"
    if not f.exists():
        return 0
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    taken = {ALIASES.get(s, s) for s in ALLOWED}
    added = 0
    for slug, info in (data.get("connectors") or {}).items():
        if slug in KEEP_VERBATIM:
            continue  # never touch the hand-set gmail/outlook
        tools = info.get("tools") or []
        if not tools:
            continue
        if slug in ALLOWED:
            # an original (not gmail/outlook): KEEP its hand-curated tools, then
            # top up from the rebalanced set to ~20 — never lose the good picks.
            ALLOWED[slug] = (ALLOWED[slug] + [t for t in tools if t not in ALLOWED[slug]])[:20]
        else:                            # new connector — register its id/alias
            fid = info.get("frontend_id", slug)
            if fid != slug and fid in taken:
                fid = slug
            if fid != slug:
                ALIASES[slug] = fid
            taken.add(fid)
            added += 1
            ALLOWED[slug] = tools
    return added


UNIVERSE_ADDED = _merge_universe()


# --- Drop tools that don't actually execute (404 on Composio's execute endpoint),
# validated by finetune/validate_tools.py -> broken_tools.json. gmail/outlook are
# left as hand-set; every other connector loses its dead tools, and one left with
# none is removed entirely (e.g. linkedin/zoho/square turned out fully dead).
def _drop_broken() -> int:
    f = Path(__file__).parent / "broken_tools.json"
    if not f.exists():
        return 0
    try:
        broken = set(json.loads(f.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0
    removed = 0
    for slug in list(ALLOWED):
        if slug in KEEP_VERBATIM:
            continue
        kept = [t for t in ALLOWED[slug] if t not in broken]
        if kept:
            ALLOWED[slug] = kept
        else:
            del ALLOWED[slug]
            ALIASES.pop(slug, None)
            removed += 1
    return removed


BROKEN_REMOVED = _drop_broken()

# Always-available built-in tools (no connector). In a graph these are reached
# through an 'ai' node whose detail names the action; listed here so generated
# requests/instructions can reference them realistically.
BUILTINS: dict[str, str] = {
    "GF_SET_REMINDER": "Set a reminder/alarm at a time (optional daily/weekly repeat).",
    "GF_WEATHER": "Current weather + 7-day forecast for a place.",
    "GF_MAPS": "Find places or get directions.",
    "GF_IMAGE": "Generate an image from a text prompt.",
    "GF_SAVE_MEMORY": "Remember a fact/preference long-term.",
    "GF_SAVE_TABLE": "Export structured data to .xlsx/.csv.",
    "GF_BANK_BALANCES": "Real-time bank balances (Plaid).",
    "GF_BANK_TRANSACTIONS": "Recent bank transactions (Plaid).",
    "GF_BANK_INSIGHTS": "Net worth / spending / cash flow / upcoming bills (Plaid).",
}

# Node ids that aren't connectors.
SPECIAL_APPS = {"schedule", "event", "ai", "decision"}

# Full set of built-in GF_* tool names (superset of BUILTINS, which only lists
# the curated few shown in prompts). The validator's tool-name guard uses this so
# a real built-in is never mistaken for a phantom.
ALL_BUILTIN_TOOLS = {
    "GF_SET_REMINDER", "GF_GET_MEMORY_FILE", "GF_SAVE_MEMORY", "GF_SAVE_TABLE",
    "GF_WEATHER", "GF_MAPS", "GF_IMAGE",
    "GF_BANK_BALANCES", "GF_BANK_TRANSACTIONS", "GF_BANK_RECURRING",
    "GF_BANK_LIABILITIES", "GF_BANK_INVESTMENTS", "GF_BANK_INVESTMENT_TRANSACTIONS",
    "GF_BANK_IDENTITY", "GF_BANK_AUTH", "GF_BANK_INSIGHTS",
}


def known_tools() -> set[str]:
    """Every real tool name: curated Composio tools + all built-ins."""
    s = set(ALL_BUILTIN_TOOLS)
    for tools in ALLOWED.values():
        s.update(tools)
    return s


def tool_prefixes() -> set[str]:
    """Uppercased toolkit namespaces (GMAIL, GOOGLECALENDAR, ONE_DRIVE, …) + GF.
    A TOOLKIT_ACTION token under one of these prefixes must be a real tool."""
    return {slug.upper() for slug in ALLOWED} | {"GF"}


def frontend_id(slug: str) -> str:
    """Composio toolkit slug -> the id the workflow graph uses."""
    return ALIASES.get(slug, slug)


def connector_ids() -> list[str]:
    """Every valid frontend connector id (for graph node ``app`` fields)."""
    return [frontend_id(s) for s in ALLOWED]


def valid_app_ids() -> set[str]:
    """All accepted node ``app`` values: connectors + specials."""
    return set(connector_ids()) | SPECIAL_APPS


def tools_for(app_id: str) -> list[str]:
    """Curated tool names for a connector id (accepts slug or frontend id)."""
    if app_id in ALLOWED:
        return ALLOWED[app_id]
    for slug in ALLOWED:
        if frontend_id(slug) == app_id:
            return ALLOWED[slug]
    return []


if __name__ == "__main__":
    print(f"connectors: {len(ALLOWED)} (54 verbatim + {UNIVERSE_ADDED} universe)  builtins: {len(BUILTINS)}")
    print(f"valid app ids: {len(valid_app_ids())}  known tools: {len(known_tools())}")
    print("sample:", connector_ids()[:8])
