from __future__ import annotations
"""
AI Spec Generator — takes a user prompt and produces a complete AppSpec JSON.

Uses Claude API with RAG context from existing spec files.
Includes retry logic for malformed JSON and auto-fills missing required fields.
"""

import json
import logging
import os
import re
import traceback
import anthropic
from .rag import build_rag_context, get_full_spec_as_schema_reference

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")

MAX_JSON_RETRIES = 2

# ── System Prompt ───────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Anias, a senior software architect that designs production-quality application specs for isibi.ai.

You take user requests and produce complete, detailed JSON specifications that a code generator can turn into working applications.

## IMPORTANT RULES

1. Be DECISIVE — fill in smart defaults for anything the user doesn't specify.
2. Generate 4-8 entities per app, each with full CRUD operations.
3. Every entity MUST have complete fields with ALL required attributes (see format below).
4. Output ONLY valid JSON — no markdown code fences, no explanation text, no comments.
5. Use the RAG reference examples as STRUCTURAL TEMPLATES — copy the exact field format and ui_config patterns, but adapt entity names and business fields to what the user asked for.

## SPEC FORMAT

{
  "app_name": "My App",
  "entities": [...],
  "modules": [...],
  "dashboard": { "stat_cards": [...] },
  "design_system": {
    "colors": { "primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0" },
    "spacing": { "page_padding": "24px", "card_padding": "16px", "gap": "16px" },
    "buttons": { "primary_bg": "blue-600", "primary_text": "white" },
    "table": { "striped": false, "hover": true },
    "typography": { "font": "Inter" }
  },
  "pagination": { "type": "cursor", "default_page_size": 25 }
}

## ENTITY FORMAT

Every entity MUST follow this exact structure:
{
  "name": "Lead",
  "table": "leads",
  "description": "Sales lead tracking",
  "fields": [
    // ALWAYS include these system fields first:
    {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
    {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
    // Then business fields — EVERY field needs ALL these attributes:
    {
      "name": "status",
      "db_type": "VARCHAR(50) NOT NULL DEFAULT 'new'",
      "ts_type": "string",
      "nullable": false,
      "editable": true,
      "show_in_table": true,
      "show_in_form": true,
      "input_component": "Select",
      "display_component": "Badge",
      "enum_values": ["new", "contacted", "qualified", "lost"],
      "badge_colors": {"new": "blue", "contacted": "amber", "qualified": "green", "lost": "red"}
    },
    // ALWAYS include these system fields at the end:
    {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": true, "show_in_form": false, "input_component": "none", "display_component": "Date"},
    {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
    {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": true, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
    {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"}
  ],
  "ui_config": {
    "list_view": {
      "layout": "table",
      "columns": ["name", "email", "status", "created_at"],
      "filters": ["status"],
      "empty_state": {"icon": "Users", "heading": "No leads yet", "subtext": "Add your first lead", "action_label": "Add Lead"}
    },
    "create_form": {"type": "SlideOverForm", "field_order": ["name", "email", "phone", "status", "source"], "required_fields": ["name"]},
    "edit_form": {"type": "SlideOverForm", "field_order": ["name", "email", "phone", "status", "source"], "required_fields": ["name"], "prefilled": true},
    "detail_view": {
      "route": "/leads/:id",
      "layout": "tabbed",
      "header": {"title_fields": ["name"], "badge_fields": ["status"], "meta_fields": ["created_at"]},
      "primary_fields": ["name", "email", "phone", "status"],
      "tabs": [
        {"name": "Overview", "fields": ["name", "email", "phone", "status", "source", "created_at"]},
        {"name": "Activity", "fields": ["notes"]}
      ]
    }
  }
}

## FIELD ATTRIBUTE REFERENCE

Every business field MUST include ALL of these attributes:
- name: snake_case field name
- db_type: PostgreSQL type (VARCHAR(255), TEXT, INTEGER, BOOLEAN, NUMERIC(12,2), DATE, TIMESTAMPTZ, UUID, JSONB)
- ts_type: TypeScript type (string, number, boolean, string[], object)
- nullable: boolean
- editable: boolean
- show_in_table: boolean
- show_in_form: boolean
- input_component: TextInput, TextArea, Select, DatePicker, NumberInput, Toggle, EmailInput, PhoneInput, CurrencyInput, FileUpload, none
- display_component: Text, Badge, Date, Currency, Email, Phone, Link, Avatar, Progress, none

For enum/status fields, also include:
- enum_values: string[] of possible values
- badge_colors: object mapping values to Tailwind colors (blue, green, red, amber, purple, indigo, orange, slate, emerald, rose, cyan, violet)

For foreign key fields, also include:
- fk_entity: name of the referenced entity (PascalCase)

## Entity Relationships
When entities are related, use foreign key fields:
- Field name: "{other_entity_table_singular}_id" (e.g., "customer_id")
- db_type: "UUID REFERENCES {other_entity_table}(id)"
- Add "fk_entity": "{OtherEntityName}" to the field
- input_component: "relation_select" (renders as a dropdown of the related entity)
- display_component: "relation_link" (renders as a clickable link)

Example — Order belongs to Customer:
{
  "name": "customer_id",
  "db_type": "UUID REFERENCES customers(id)",
  "ts_type": "string",
  "nullable": false,
  "editable": true,
  "show_in_table": true,
  "show_in_form": true,
  "input_component": "relation_select",
  "display_component": "relation_link",
  "fk_entity": "Customer"
}

Always create relationships when entities are logically connected:
- Orders -> Customers
- Tasks -> Projects
- Appointments -> Clients
- Invoices -> Customers
- Messages -> Conversations

## MODULE FORMAT

{"name": "Leads", "route": "/leads", "component": "ResourcePage", "layout": "sidebar", "sidebar_order": 2, "sidebar_icon": "Users", "entity": "Lead"}

sidebar_icon: valid Lucide React icon (PascalCase): Users, ShoppingCart, CalendarDays, Building2, Briefcase, Package, CreditCard, FileText, Settings, BarChart3, ClipboardList, MessageSquare, Bell, Tag, Layers, Mail, Globe, Shield, Wrench, Zap, Heart, Star, Flag, Map, Camera, Mic, Video, Music, Book, Bookmark, Archive, Inbox, Send, Download, Upload, Search, Filter, Grid, List, Layout, Home, Truck, DollarSign, PieChart, TrendingUp, Award, Target, CheckCircle, AlertCircle, Info, HelpCircle

ALWAYS include a Dashboard module at sidebar_order: 1:
{"name": "Dashboard", "route": "/", "component": "DashboardPage", "layout": "sidebar", "sidebar_order": 1, "sidebar_icon": "BarChart3", "entity": null}

## COMPLETE EXAMPLE (3-entity app)

{
  "app_name": "Sales CRM",
  "entities": [
    {
      "name": "Contact",
      "table": "contacts",
      "description": "People and companies you interact with",
      "fields": [
        {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "TextInput", "display_component": "Text"},
        {"name": "email", "db_type": "VARCHAR(320)", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "EmailInput", "display_component": "Email"},
        {"name": "phone", "db_type": "VARCHAR(50)", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "PhoneInput", "display_component": "Phone"},
        {"name": "company", "db_type": "VARCHAR(255)", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "TextInput", "display_component": "Text"},
        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "Select", "display_component": "Badge", "enum_values": ["active", "inactive", "lead"], "badge_colors": {"active": "green", "inactive": "slate", "lead": "blue"}},
        {"name": "notes", "db_type": "TEXT", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": false, "show_in_form": true, "input_component": "TextArea", "display_component": "Text"},
        {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": true, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": true, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"}
      ],
      "ui_config": {
        "list_view": {"layout": "table", "columns": ["name", "email", "phone", "company", "status"], "filters": ["status"], "empty_state": {"icon": "Users", "heading": "No contacts yet", "subtext": "Add your first contact", "action_label": "Add Contact"}},
        "create_form": {"type": "SlideOverForm", "field_order": ["name", "email", "phone", "company", "status", "notes"], "required_fields": ["name"]},
        "edit_form": {"type": "SlideOverForm", "field_order": ["name", "email", "phone", "company", "status", "notes"], "required_fields": ["name"], "prefilled": true},
        "detail_view": {"route": "/contacts/:id", "layout": "tabbed", "header": {"title_fields": ["name"], "badge_fields": ["status"], "meta_fields": ["created_at"]}, "primary_fields": ["name", "email", "phone", "company", "status"], "tabs": [{"name": "Overview", "fields": ["name", "email", "phone", "company", "status"]}, {"name": "Notes", "fields": ["notes"]}]}
      }
    },
    {
      "name": "Deal",
      "table": "deals",
      "description": "Sales opportunities and pipeline",
      "fields": [
        {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "TextInput", "display_component": "Text"},
        {"name": "value", "db_type": "NUMERIC(12,2)", "ts_type": "number", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "CurrencyInput", "display_component": "Currency"},
        {"name": "stage", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'discovery'", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "Select", "display_component": "Badge", "enum_values": ["discovery", "proposal", "negotiation", "closed_won", "closed_lost"], "badge_colors": {"discovery": "blue", "proposal": "amber", "negotiation": "purple", "closed_won": "green", "closed_lost": "red"}},
        {"name": "contact_id", "db_type": "UUID", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "Select", "display_component": "Text", "fk_entity": "Contact"},
        {"name": "expected_close", "db_type": "DATE", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "DatePicker", "display_component": "Date"},
        {"name": "notes", "db_type": "TEXT", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": false, "show_in_form": true, "input_component": "TextArea", "display_component": "Text"},
        {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": true, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": true, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"}
      ],
      "ui_config": {
        "list_view": {"layout": "table", "columns": ["title", "value", "stage", "expected_close"], "filters": ["stage"], "empty_state": {"icon": "Briefcase", "heading": "No deals yet", "subtext": "Create your first deal", "action_label": "Add Deal"}},
        "create_form": {"type": "SlideOverForm", "field_order": ["title", "value", "stage", "contact_id", "expected_close", "notes"], "required_fields": ["title"]},
        "edit_form": {"type": "SlideOverForm", "field_order": ["title", "value", "stage", "contact_id", "expected_close", "notes"], "required_fields": ["title"], "prefilled": true},
        "detail_view": {"route": "/deals/:id", "layout": "tabbed", "header": {"title_fields": ["title"], "badge_fields": ["stage"], "meta_fields": ["created_at"]}, "primary_fields": ["title", "value", "stage", "contact_id", "expected_close"], "tabs": [{"name": "Overview", "fields": ["title", "value", "stage", "contact_id", "expected_close"]}, {"name": "Notes", "fields": ["notes"]}]}
      }
    },
    {
      "name": "Task",
      "table": "tasks",
      "description": "Follow-up tasks and reminders",
      "fields": [
        {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"},
        {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "TextInput", "display_component": "Text"},
        {"name": "description", "db_type": "TEXT", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": false, "show_in_form": true, "input_component": "TextArea", "display_component": "Text"},
        {"name": "priority", "db_type": "VARCHAR(20) NOT NULL DEFAULT 'medium'", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "Select", "display_component": "Badge", "enum_values": ["low", "medium", "high", "urgent"], "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'todo'", "ts_type": "string", "nullable": false, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "Select", "display_component": "Badge", "enum_values": ["todo", "in_progress", "done"], "badge_colors": {"todo": "slate", "in_progress": "blue", "done": "green"}},
        {"name": "due_date", "db_type": "DATE", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": true, "show_in_form": true, "input_component": "DatePicker", "display_component": "Date"},
        {"name": "contact_id", "db_type": "UUID", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": false, "show_in_form": true, "input_component": "Select", "display_component": "Text", "fk_entity": "Contact"},
        {"name": "deal_id", "db_type": "UUID", "ts_type": "string", "nullable": true, "editable": true, "show_in_table": false, "show_in_form": true, "input_component": "Select", "display_component": "Text", "fk_entity": "Deal"},
        {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": true, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": true, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Date"},
        {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": false, "editable": false, "show_in_table": false, "show_in_form": false, "input_component": "none", "display_component": "Text"}
      ],
      "ui_config": {
        "list_view": {"layout": "table", "columns": ["title", "priority", "status", "due_date"], "filters": ["status", "priority"], "empty_state": {"icon": "CheckCircle", "heading": "No tasks yet", "subtext": "Create your first task", "action_label": "Add Task"}},
        "create_form": {"type": "SlideOverForm", "field_order": ["title", "description", "priority", "status", "due_date", "contact_id", "deal_id"], "required_fields": ["title"]},
        "edit_form": {"type": "SlideOverForm", "field_order": ["title", "description", "priority", "status", "due_date", "contact_id", "deal_id"], "required_fields": ["title"], "prefilled": true},
        "detail_view": {"route": "/tasks/:id", "layout": "tabbed", "header": {"title_fields": ["title"], "badge_fields": ["status", "priority"], "meta_fields": ["due_date"]}, "primary_fields": ["title", "priority", "status", "due_date"], "tabs": [{"name": "Overview", "fields": ["title", "description", "priority", "status", "due_date", "contact_id", "deal_id"]}]}
      }
    }
  ],
  "modules": [
    {"name": "Dashboard", "route": "/", "component": "DashboardPage", "layout": "sidebar", "sidebar_order": 1, "sidebar_icon": "BarChart3", "entity": null},
    {"name": "Contacts", "route": "/contacts", "component": "ResourcePage", "layout": "sidebar", "sidebar_order": 2, "sidebar_icon": "Users", "entity": "Contact"},
    {"name": "Deals", "route": "/deals", "component": "ResourcePage", "layout": "sidebar", "sidebar_order": 3, "sidebar_icon": "Briefcase", "entity": "Deal"},
    {"name": "Tasks", "route": "/tasks", "component": "ResourcePage", "layout": "sidebar", "sidebar_order": 4, "sidebar_icon": "CheckCircle", "entity": "Task"}
  ],
  "dashboard": {
    "stat_cards": [
      {"label": "Total Contacts", "entity": "Contact", "aggregate": "count", "icon": "Users", "color": "blue"},
      {"label": "Open Deals", "entity": "Deal", "aggregate": "count", "filter": {"stage": ["discovery", "proposal", "negotiation"]}, "icon": "Briefcase", "color": "green"},
      {"label": "Pipeline Value", "entity": "Deal", "aggregate": "sum", "field": "value", "icon": "DollarSign", "color": "purple"},
      {"label": "Pending Tasks", "entity": "Task", "aggregate": "count", "filter": {"status": ["todo", "in_progress"]}, "icon": "CheckCircle", "color": "amber"}
    ]
  },
  "design_system": {
    "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
    "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
    "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
    "table": {"striped": false, "hover": true},
    "typography": {"font": "Inter"}
  },
  "pagination": {"type": "cursor", "default_page_size": 25}
}

## Conditional Field Visibility
Fields can have a "visible_when" rule to show/hide based on other field values:

{
  "name": "tracking_number",
  "visible_when": {"field": "status", "operator": "eq", "value": "shipped"},
  ...other attributes...
}

{
  "name": "discount_reason",
  "visible_when": {"field": "discount", "operator": "gt", "value": 0},
  ...other attributes...
}

Operators: eq, neq, gt, lt, gte, lte, in, not_in, contains, not_empty
Use visible_when when it makes logical sense (tracking numbers only when shipped, etc.)

## Computed Fields
Fields can have a "computed" formula that auto-calculates from other fields:

{
  "name": "total",
  "computed": "quantity * price",
  "editable": false,
  "show_in_form": true,
  ...
}

{
  "name": "full_name",
  "computed": "first_name + ' ' + last_name",
  "editable": false,
  ...
}

{
  "name": "days_until_due",
  "computed": "DAYS_UNTIL(due_date)",
  "editable": false,
  ...
}

Supported functions: DAYS_UNTIL(date), DAYS_SINCE(date), NOW(), UPPER(text), LOWER(text), CONCAT(a, b)
Computed fields are always editable: false and auto-update when dependencies change.

## Validation Rules
Fields can have a "validation" object for client-side validation:

{
  "name": "email",
  "validation": {"rule": "email", "message": "Please enter a valid email"},
  ...
}

{
  "name": "price",
  "validation": {"rule": "min", "value": 0, "message": "Price must be positive"},
  ...
}

{
  "name": "phone",
  "validation": {"rule": "pattern", "value": "^[0-9]{10}$", "message": "Phone must be 10 digits"},
  ...
}

Rules: required, email, min, max, minLength, maxLength, pattern, url
Use validation on fields where it makes sense (emails, prices, phones, dates).

## RULES

1. Output ONLY the JSON object. No text before or after. No markdown code fences.
2. Generate 4-8 entities based on app complexity. Fill in smart defaults for anything unspecified.
3. Every enum/status field needs enum_values[] and badge_colors{} mapping values to Tailwind color names.
4. Use fk_entity on fields that reference other entities.
5. Every entity MUST have id, org_id, created_at, updated_at, deleted_at, and version system fields.
6. Every module needs a valid Lucide icon name (PascalCase).
7. Dashboard stat_cards should cover 3-5 key metrics from the entities.
8. Use the RAG reference examples as structural templates — match their field format exactly.
9. Use visible_when on fields that should only appear based on another field's value.
10. Use computed fields for auto-calculated values (totals, full names, date differences).
11. Use validation rules on fields where input validation makes sense (emails, phones, prices, URLs).

CRITICAL: After receiving ANY response from the user, you MUST output the JSON spec. Do NOT ask follow-up questions. If the user's response is ambiguous, make reasonable assumptions and build.

If the user says "yes", "all of it", "sure", "ok", "sounds good", "go ahead", "build it", "do it", or similar short confirmations, immediately generate the JSON spec with all suggested features.

Ask AT MOST 1-2 clarifying questions total. After the first question, you MUST generate the spec regardless of the answer."""


async def generate_spec(user_prompt: str, conversation_history: list[dict] | None = None) -> dict:
    """
    Generate a complete app spec from a user's description.

    Includes retry logic: if the AI returns malformed JSON, we ask it to fix it
    (up to MAX_JSON_RETRIES times).
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build RAG context
    rag_context = build_rag_context(user_prompt)
    schema_reference = get_full_spec_as_schema_reference()

    # Build messages
    messages: list[dict] = []

    if conversation_history:
        messages.extend(conversation_history)

    user_message = f"""## User Request
{user_prompt}

## Reference Patterns (from existing specs — use as STRUCTURAL TEMPLATES)
{rag_context}

## JSON Schema Template (follow this exact structure)
{schema_reference}

Now generate the COMPLETE JSON spec for what the user requested.
- Generate 4-8 entities with full field definitions
- Include ALL field attributes (db_type, ts_type, nullable, editable, show_in_table, show_in_form, input_component, display_component)
- Include ui_config for every entity
- Include dashboard stat_cards
- Include design_system
- Output ONLY the JSON object, nothing else."""

    messages.append({"role": "user", "content": user_message})

    # First attempt
    spec = None
    last_error = None
    raw_text = ""

    for attempt in range(1 + MAX_JSON_RETRIES):
        try:
            if attempt == 0:
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                )
            else:
                # Retry: ask Claude to fix the JSON
                logger.warning(
                    "JSON parse attempt %d failed: %s — asking AI to fix",
                    attempt, last_error
                )
                fix_messages = messages + [
                    {"role": "assistant", "content": raw_text},
                    {
                        "role": "user",
                        "content": (
                            f"Your JSON output had an error: {last_error}\n\n"
                            "Please output the COMPLETE corrected JSON spec. "
                            "Output ONLY valid JSON — no markdown, no explanation."
                        ),
                    },
                ]
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=fix_messages,
                )

            raw_text = response.content[0].text.strip()

            # If output was truncated, try to repair after stripping fences
            truncated = response.stop_reason == "max_tokens"

            # Use robust JSON parsing with all recovery steps
            spec = _robust_json_parse(raw_text, truncated=truncated)

            if not isinstance(spec, dict):
                raise ValueError(f"AI returned {type(spec).__name__} instead of a JSON object")

            # Success — break out of retry loop
            break

        except (json.JSONDecodeError, ValueError) as e:
            last_error = str(e)

            if attempt >= MAX_JSON_RETRIES:
                # Last resort: make one more API call asking for just JSON
                logger.warning("All retries exhausted. Trying one final recovery API call.")
                try:
                    recovery_response = client.messages.create(
                        model=MODEL,
                        max_tokens=64000,
                        system="You are a JSON repair assistant. Output ONLY valid JSON, nothing else.",
                        messages=[{
                            "role": "user",
                            "content": (
                                "Your previous response was not valid JSON. "
                                f"Here's what you returned:\n\n{raw_text[:2000]}\n\n"
                                "Please return ONLY the valid JSON spec, nothing else."
                            ),
                        }],
                    )
                    recovery_text = recovery_response.content[0].text.strip()
                    spec = _robust_json_parse(recovery_text)
                    if isinstance(spec, dict):
                        logger.info("Recovery API call succeeded — got valid JSON")
                        break
                except Exception as recovery_err:
                    logger.error("Recovery API call also failed: %s", recovery_err)

                logger.error(
                    "All %d JSON parse attempts failed. Last error: %s. First 300 chars: %s",
                    MAX_JSON_RETRIES + 1, last_error, raw_text[:300]
                )
                raise ValueError(
                    f"AI returned invalid JSON after {MAX_JSON_RETRIES + 1} attempts: {last_error}"
                )

    if spec is None:
        raise ValueError("Failed to generate spec — no valid JSON returned")

    # Validate and auto-fill missing required fields
    spec = _ensure_required_fields(spec)
    _validate_spec(spec)

    return spec


async def refine_spec(
    current_spec: dict,
    user_feedback: str,
) -> dict:
    """
    Refine an existing spec based on user feedback.
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    messages = [
        {
            "role": "user",
            "content": (
                "Here is the current spec:\n\n"
                f"```json\n{json.dumps(current_spec, indent=2)}\n```\n\n"
                f"User wants to change/add: {user_feedback}\n\n"
                "Output the COMPLETE updated JSON spec with the changes applied. "
                "Keep ALL existing entities and their full field definitions. "
                "Output ONLY the JSON object, no explanation."
            ),
        }
    ]

    last_error = None
    spec = None
    raw_text = ""

    for attempt in range(1 + MAX_JSON_RETRIES):
        try:
            if attempt == 0:
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                )
            else:
                fix_messages = messages + [
                    {"role": "assistant", "content": raw_text},
                    {
                        "role": "user",
                        "content": (
                            f"Your JSON output had an error: {last_error}\n\n"
                            "Please output the COMPLETE corrected JSON spec. "
                            "Output ONLY valid JSON — no markdown, no explanation."
                        ),
                    },
                ]
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=fix_messages,
                )

            raw_text = response.content[0].text.strip()
            truncated = response.stop_reason == "max_tokens"

            spec = _robust_json_parse(raw_text, truncated=truncated)
            if not isinstance(spec, dict):
                raise ValueError(f"Expected dict, got {type(spec).__name__}")
            break

        except (json.JSONDecodeError, ValueError) as e:
            last_error = str(e)
            if attempt >= MAX_JSON_RETRIES:
                # Last resort recovery call
                try:
                    recovery_response = client.messages.create(
                        model=MODEL,
                        max_tokens=64000,
                        system="You are a JSON repair assistant. Output ONLY valid JSON, nothing else.",
                        messages=[{
                            "role": "user",
                            "content": (
                                "Your previous response was not valid JSON. "
                                f"Here's what you returned:\n\n{raw_text[:2000]}\n\n"
                                "Please return ONLY the valid JSON spec, nothing else."
                            ),
                        }],
                    )
                    recovery_text = recovery_response.content[0].text.strip()
                    spec = _robust_json_parse(recovery_text)
                    if isinstance(spec, dict):
                        break
                except Exception:
                    pass
                raise ValueError(f"Refinement returned invalid JSON after retries: {last_error}")

    if spec is None:
        raise ValueError("Failed to refine spec — no valid JSON returned")

    spec = _ensure_required_fields(spec)
    _validate_spec(spec)
    return spec


# ── Helpers ─────────────────────────────────────────────────────────

def _robust_json_parse(text: str, truncated: bool = False) -> dict:
    """
    Bulletproof JSON parsing with multiple recovery strategies.

    Steps:
      1. Try parsing as-is
      2. Strip markdown code fences and retry
      3. Find first '{' and last '}' and parse that substring
      4. Fix common JSON errors (trailing commas, single quotes, unquoted keys)
      5. If truncated, attempt structural repair (close open braces/brackets)

    Returns a parsed dict or raises ValueError/JSONDecodeError.
    """
    # Step 1: Try parsing as-is
    try:
        result = json.loads(text)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Step 2: Strip markdown code fences
    stripped = _strip_code_fences(text)
    try:
        result = json.loads(stripped)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Step 3: Find the first '{' and last '}' and parse that substring
    first_brace = stripped.find("{")
    last_brace = stripped.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        substr = stripped[first_brace:last_brace + 1]
        try:
            result = json.loads(substr)
            if isinstance(result, str):
                result = json.loads(result)
            return result
        except (json.JSONDecodeError, ValueError):
            pass

        # Step 4: Fix common JSON errors on the substring
        fixed = _fix_common_json_errors(substr)
        try:
            result = json.loads(fixed)
            if isinstance(result, str):
                result = json.loads(result)
            return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Step 5: If truncated or all above failed, try structural repair
    candidate = stripped if first_brace < 0 else stripped[first_brace:]
    repaired = _attempt_json_repair(candidate)
    repaired = _fix_common_json_errors(repaired)
    try:
        result = json.loads(repaired)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # All recovery steps failed — raise with context
    raise json.JSONDecodeError(
        f"All JSON recovery steps failed. First 200 chars: {text[:200]}",
        text, 0
    )


def _fix_common_json_errors(text: str) -> str:
    """
    Fix common JSON errors that the AI might produce:
    - Trailing commas before } or ]
    - Single quotes instead of double quotes (outside of values)
    - Unquoted keys
    - JavaScript-style comments (// ...)
    """
    # Remove single-line comments (// ...)
    text = re.sub(r'//[^\n]*', '', text)

    # Remove trailing commas before } or ]
    text = re.sub(r',\s*([}\]])', r'\1', text)

    # Replace single quotes with double quotes (careful with apostrophes in values)
    # Only do this if there are no double quotes at all (AI used all single quotes)
    if "'" in text and text.count('"') < text.count("'") // 2:
        # Heuristic: if single quotes outnumber double quotes by a lot,
        # the AI probably used single quotes for JSON strings
        text = text.replace("'", '"')

    # Fix unquoted keys: word: -> "word":
    # Match start-of-line or after { or , followed by whitespace then a bare word then :
    text = re.sub(r'(?<=[\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r' "\1":', text)

    return text


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences from AI output."""
    text = text.strip()

    # Handle ```json ... ``` or ``` ... ```
    if text.startswith("```"):
        # Remove opening fence (possibly with language tag)
        first_newline = text.find("\n")
        if first_newline >= 0:
            text = text[first_newline + 1:]
        else:
            text = text[3:]

    if text.endswith("```"):
        text = text[:-3]

    return text.strip()


def _attempt_json_repair(text: str) -> str:
    """Try to close truncated JSON so it parses."""
    # Count open braces/brackets
    in_string = False
    escape = False
    stack = []
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            stack.append('}')
        elif ch == '[':
            stack.append(']')
        elif ch in ('}', ']') and stack:
            stack.pop()

    # If we're inside a string, close it
    if in_string:
        text += '"'

    # Close remaining open structures
    while stack:
        text += stack.pop()

    return text


def _ensure_required_fields(spec: dict) -> dict:
    """
    Auto-fill missing required top-level fields with smart defaults
    instead of crashing.
    """
    # Ensure app_name
    if "app_name" not in spec:
        meta = spec.get("_meta", {})
        if isinstance(meta, dict) and meta.get("app_name"):
            spec["app_name"] = meta["app_name"]
        else:
            spec["app_name"] = "My App"

    # Ensure entities is a list
    if "entities" not in spec or not isinstance(spec["entities"], list):
        spec["entities"] = []

    # Ensure modules exist
    if "modules" not in spec or not isinstance(spec["modules"], list):
        spec["modules"] = _generate_default_modules(spec.get("entities", []))

    # Ensure dashboard
    if "dashboard" not in spec or not isinstance(spec["dashboard"], dict):
        spec["dashboard"] = _generate_default_dashboard(spec.get("entities", []))
    elif "stat_cards" not in spec["dashboard"]:
        spec["dashboard"]["stat_cards"] = _generate_default_stat_cards(spec.get("entities", []))

    # Ensure design_system
    if "design_system" not in spec or not isinstance(spec["design_system"], dict):
        spec["design_system"] = {
            "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
            "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
            "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
            "table": {"striped": False, "hover": True},
            "typography": {"font": "Inter"},
        }
    else:
        ds = spec["design_system"]
        ds.setdefault("colors", {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"})
        ds.setdefault("spacing", {"page_padding": "24px"})
        ds.setdefault("buttons", {"primary_bg": "blue-600"})
        ds.setdefault("table", {"hover": True})
        ds.setdefault("typography", {"font": "Inter"})

    # Ensure pagination
    if "pagination" not in spec or not isinstance(spec["pagination"], dict):
        spec["pagination"] = {"type": "cursor", "default_page_size": 25}

    # Ensure each entity has ui_config and system fields
    for ent in spec.get("entities", []):
        if not isinstance(ent, dict):
            continue
        _ensure_entity_completeness(ent)

    # Ensure Dashboard module exists
    modules = spec.get("modules", [])
    has_dashboard = any(
        isinstance(m, dict) and m.get("name", "").lower() == "dashboard"
        for m in modules
    )
    if not has_dashboard:
        modules.insert(0, {
            "name": "Dashboard",
            "route": "/",
            "component": "DashboardPage",
            "layout": "sidebar",
            "sidebar_order": 1,
            "sidebar_icon": "BarChart3",
            "entity": None,
        })

    return spec


def _ensure_entity_completeness(ent: dict) -> None:
    """Ensure an entity has all required structural elements."""
    if "fields" not in ent or not isinstance(ent["fields"], list):
        ent["fields"] = []

    # Ensure system fields exist
    field_names = {f.get("name") for f in ent["fields"] if isinstance(f, dict)}
    system_fields = [
        {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
        {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
        {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": True, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": True, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
    ]

    for sf in system_fields:
        if sf["name"] not in field_names:
            if sf["name"] in ("id", "org_id"):
                ent["fields"].insert(0, sf)
            else:
                ent["fields"].append(sf)

    # Ensure every field has required attributes
    for f in ent["fields"]:
        if not isinstance(f, dict):
            continue
        f.setdefault("db_type", "TEXT")
        f.setdefault("ts_type", "string")
        f.setdefault("nullable", True)
        f.setdefault("editable", True)
        f.setdefault("show_in_table", True)
        f.setdefault("show_in_form", True)
        f.setdefault("input_component", "TextInput")
        f.setdefault("display_component", "Text")

    # Ensure ui_config
    if "ui_config" not in ent or not isinstance(ent["ui_config"], dict):
        form_fields = [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("show_in_form")]
        table_fields = [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("show_in_table")]
        name = ent.get("name", "Item")
        table = ent.get("table", "items")

        ent["ui_config"] = {
            "list_view": {
                "layout": "table",
                "columns": table_fields[:6],
                "empty_state": {
                    "icon": "Box",
                    "heading": f"No {table.replace('_', ' ')} yet",
                    "subtext": f"Create your first {name.lower()}",
                    "action_label": f"Add {name}",
                },
            },
            "create_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": form_fields[:1],
            },
            "edit_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": form_fields[:1],
                "prefilled": True,
            },
            "detail_view": {
                "route": f"/{table}/:id",
                "layout": "tabbed",
                "header": {
                    "title_fields": table_fields[:1],
                    "badge_fields": [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("enum_values")][:1],
                },
                "primary_fields": table_fields[:5],
            },
        }

    # Ensure table name
    if "table" not in ent and "name" in ent:
        ent["table"] = re.sub(r"(?<!^)(?=[A-Z])", "_", ent["name"]).lower() + "s"

    # Ensure description
    ent.setdefault("description", f"{ent.get('name', 'Entity')} management")


def _generate_default_modules(entities: list) -> list[dict]:
    """Generate default modules from entities."""
    modules = [{
        "name": "Dashboard",
        "route": "/",
        "component": "DashboardPage",
        "layout": "sidebar",
        "sidebar_order": 1,
        "sidebar_icon": "BarChart3",
        "entity": None,
    }]

    icon_map = {
        "user": "Users", "contact": "Users", "customer": "Users", "person": "Users", "people": "Users",
        "deal": "Briefcase", "order": "ShoppingCart", "product": "Package", "item": "Package",
        "task": "CheckCircle", "project": "Layers", "invoice": "FileText", "payment": "CreditCard",
        "message": "MessageSquare", "notification": "Bell", "setting": "Settings",
        "lead": "Target", "ticket": "ClipboardList", "event": "CalendarDays",
    }

    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Module")
        table = ent.get("table", name.lower() + "s")
        icon = icon_map.get(name.lower(), "Box")
        modules.append({
            "name": f"{name}s" if not name.endswith("s") else name,
            "route": f"/{table}",
            "component": "ResourcePage",
            "layout": "sidebar",
            "sidebar_order": i + 2,
            "sidebar_icon": icon,
            "entity": name,
        })

    return modules


def _generate_default_dashboard(entities: list) -> dict:
    """Generate default dashboard from entities."""
    return {"stat_cards": _generate_default_stat_cards(entities)}


def _generate_default_stat_cards(entities: list) -> list[dict]:
    """Generate stat cards for each entity."""
    cards = []
    colors = ["blue", "green", "purple", "amber", "indigo", "rose"]
    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Item")
        cards.append({
            "label": f"Total {name}s" if not name.endswith("s") else f"Total {name}",
            "entity": name,
            "aggregate": "count",
            "icon": "Box",
            "color": colors[i % len(colors)],
        })
    return cards[:6]


def _validate_spec(spec: dict) -> None:
    """Basic structural validation of a generated spec."""
    if "entities" not in spec or not isinstance(spec["entities"], list):
        raise ValueError("Spec must contain 'entities' array")

    if len(spec["entities"]) == 0:
        raise ValueError("Spec must have at least one entity")

    for ent in spec["entities"]:
        if not isinstance(ent, dict):
            continue
        if "name" not in ent:
            raise ValueError(f"Entity missing 'name': {ent}")
        if "table" not in ent:
            raise ValueError(f"Entity '{ent.get('name')}' missing 'table'")
        if "fields" not in ent or not isinstance(ent["fields"], list):
            raise ValueError(f"Entity '{ent['name']}' missing 'fields' array")

    if "modules" not in spec or not isinstance(spec["modules"], list):
        raise ValueError("Spec must contain 'modules' array")
