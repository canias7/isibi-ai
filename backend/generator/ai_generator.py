from __future__ import annotations
"""
AI Spec Generator — takes a user prompt and produces a complete AppSpec JSON.

Uses Claude API with RAG context from existing spec files.
"""

import json
import os
import anthropic
from .rag import build_rag_context, get_full_spec_as_schema_reference

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")


SYSTEM_PROMPT = """You generate application specs as a single JSON object. Output ONLY valid JSON — no markdown, no code fences, no explanation.

## Spec Structure

{
  "app_name": "My App",
  "entities": [...],
  "modules": [...],
  "dashboard": { "stat_cards": [...] },
  "design_system": { "colors": {...}, "spacing": {...}, "buttons": {...}, "table": {...}, "typography": {...} },
  "pagination": { "default_page_size": 25 }
}

## Entity Format

Each entity has: name, table, description, fields[], ui_config.

Every entity MUST include these system fields (don't skip them):
- id: UUID primary key
- org_id: UUID (multi-tenant)
- created_at, updated_at, deleted_at: TIMESTAMPTZ
- version: INTEGER (optimistic locking)

Field format:
{ "name": "status", "db_type": "VARCHAR(50)", "ts_type": "string", "nullable": false, "show_in_table": true, "show_in_form": true, "editable": true, "input_component": "Select", "display_component": "Badge", "enum_values": ["active","inactive"], "badge_colors": {"active":"green","inactive":"slate"} }

Input components: TextInput, TextArea, Select, DatePicker, NumberInput, Toggle, EmailInput, PhoneInput, CurrencyInput, FileUpload
Display components: Text, Badge, Date, Currency, Email, Phone, Link, Avatar, Progress

## ui_config Format

{
  "list_view": { "columns": ["name","status"], "empty_state": {"icon":"Users","heading":"No records","subtext":"Get started","action_label":"Add"} },
  "detail_view": { "header": {"title_fields":["name"],"badge_fields":["status"],"meta_fields":["created_at"]}, "primary_fields": ["name","email","status"] },
  "create_form": { "type": "SlideOverForm", "field_order": ["name","email","status"], "required_fields": ["name"] },
  "edit_form": { "type": "SlideOverForm", "field_order": ["name","email","status"], "required_fields": ["name"], "prefilled": true }
}

## Module Format

{ "name": "Contacts", "route": "/contacts", "component": "ResourcePage", "layout": "sidebar", "sidebar_order": 2, "sidebar_icon": "Users", "entity": "Contact" }

sidebar_icon must be a valid Lucide React icon name (PascalCase): Users, ShoppingCart, CalendarDays, Building2, Briefcase, Package, CreditCard, FileText, Settings, BarChart3, etc.

Always include a Dashboard module at sidebar_order: 1 with stat_cards counting key entities.

## Example (minimal)

{
  "app_name": "Contact Manager",
  "entities": [
    {
      "name": "Contact", "table": "contacts", "description": "People you work with",
      "fields": [
        {"name":"id","db_type":"UUID","ts_type":"string","nullable":false,"show_in_table":false,"show_in_form":false,"editable":false,"input_component":"TextInput","display_component":"Text"},
        {"name":"org_id","db_type":"UUID","ts_type":"string","nullable":false,"show_in_table":false,"show_in_form":false,"editable":false,"input_component":"TextInput","display_component":"Text"},
        {"name":"name","db_type":"VARCHAR(255)","ts_type":"string","nullable":false,"show_in_table":true,"show_in_form":true,"editable":true,"input_component":"TextInput","display_component":"Text"},
        {"name":"email","db_type":"VARCHAR(255)","ts_type":"string","nullable":true,"show_in_table":true,"show_in_form":true,"editable":true,"input_component":"EmailInput","display_component":"Email"},
        {"name":"status","db_type":"VARCHAR(50)","ts_type":"string","nullable":false,"show_in_table":true,"show_in_form":true,"editable":true,"input_component":"Select","display_component":"Badge","enum_values":["active","inactive"],"badge_colors":{"active":"green","inactive":"slate"}},
        {"name":"created_at","db_type":"TIMESTAMPTZ","ts_type":"string","nullable":false,"show_in_table":true,"show_in_form":false,"editable":false,"input_component":"DatePicker","display_component":"Date"},
        {"name":"updated_at","db_type":"TIMESTAMPTZ","ts_type":"string","nullable":false,"show_in_table":false,"show_in_form":false,"editable":false,"input_component":"DatePicker","display_component":"Date"},
        {"name":"deleted_at","db_type":"TIMESTAMPTZ","ts_type":"string","nullable":true,"show_in_table":false,"show_in_form":false,"editable":false,"input_component":"DatePicker","display_component":"Date"},
        {"name":"version","db_type":"INTEGER","ts_type":"number","nullable":false,"show_in_table":false,"show_in_form":false,"editable":false,"input_component":"NumberInput","display_component":"Text"}
      ],
      "ui_config": {
        "list_view": {"columns":["name","email","status","created_at"],"empty_state":{"icon":"Users","heading":"No contacts yet","subtext":"Add your first contact","action_label":"Add Contact"}},
        "detail_view": {"header":{"title_fields":["name"],"badge_fields":["status"],"meta_fields":["created_at"]},"primary_fields":["name","email","status"]},
        "create_form": {"type":"SlideOverForm","field_order":["name","email","status"],"required_fields":["name"]},
        "edit_form": {"type":"SlideOverForm","field_order":["name","email","status"],"required_fields":["name"],"prefilled":true}
      }
    }
  ],
  "modules": [
    {"name":"Dashboard","route":"/","component":"DashboardPage","layout":"sidebar","sidebar_order":1,"sidebar_icon":"BarChart3","entity":null},
    {"name":"Contacts","route":"/contacts","component":"ResourcePage","layout":"sidebar","sidebar_order":2,"sidebar_icon":"Users","entity":"Contact"}
  ],
  "dashboard": {"stat_cards":[{"label":"Total Contacts","entity":"Contact","aggregate":"count","icon":"Users"}]},
  "design_system": {"colors":{"primary":"blue","sidebar_bg":"#0f172a","sidebar_text":"#e2e8f0"},"spacing":{"page_padding":"24px"},"buttons":{"primary_bg":"blue-600"},"table":{"striped":false,"hover":true},"typography":{"font":"Inter"}},
  "pagination": {"default_page_size":25}
}

## Rules
1. Output ONLY the JSON object. No text before or after.
2. Generate 3-6 entities based on complexity. Fill in smart defaults for anything unspecified.
3. Every enum/status field needs enum_values[] and badge_colors{} mapping values to Tailwind colors (blue, green, red, amber, purple, indigo, orange, slate).
4. Use fk_entity on fields that reference other entities.
5. Keep it compact. Do not add unnecessary fields or overly detailed configs.
"""


async def generate_spec(user_prompt: str, conversation_history: list[dict] | None = None) -> dict:
    """
    Generate a complete app spec from a user's description.

    Args:
        user_prompt: What the user wants to build (e.g. "Build me a CRM for real estate")
        conversation_history: Optional prior messages for multi-turn refinement

    Returns:
        Parsed JSON spec dict
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build RAG context
    rag_context = build_rag_context(user_prompt)
    schema_reference = get_full_spec_as_schema_reference()

    # Build messages
    messages: list[dict] = []

    # Include conversation history if this is a refinement
    if conversation_history:
        messages.extend(conversation_history)

    # Main generation prompt
    user_message = f"""## User Request
{user_prompt}

## Reference Patterns (from existing specs — use for FORMAT only, not content)
{rag_context}

## JSON Schema Template (follow this exact structure)
{schema_reference}

Now generate the COMPLETE JSON spec for what the user requested. Output ONLY the JSON object."""

    messages.append({"role": "user", "content": user_message})

    response = client.messages.create(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    # Extract JSON from response
    raw_text = response.content[0].text.strip()

    # Handle potential markdown code fences
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3].strip()

    # If output was truncated (stop_reason == "max_tokens"), try to repair
    if response.stop_reason == "max_tokens":
        raw_text = _attempt_json_repair(raw_text)

    try:
        spec = json.loads(raw_text)
    except json.JSONDecodeError as e:
        # Try harder: find the first { and parse from there
        brace_idx = raw_text.find("{")
        if brace_idx >= 0:
            try:
                spec = json.loads(_attempt_json_repair(raw_text[brace_idx:]))
            except json.JSONDecodeError:
                raise ValueError(f"AI returned invalid JSON: {str(e)}. First 200 chars: {raw_text[:200]}")
        else:
            raise ValueError(f"AI returned no JSON object: {raw_text[:200]}")

    # Ensure we got a dict, not a string or list
    if isinstance(spec, str):
        spec = json.loads(spec)
    if not isinstance(spec, dict):
        raise ValueError(f"AI returned {type(spec).__name__} instead of a JSON object")

    # Validate basic structure
    _validate_spec(spec)

    return spec


async def refine_spec(
    current_spec: dict,
    user_feedback: str,
) -> dict:
    """
    Refine an existing spec based on user feedback.

    e.g. "Add a Payments entity" or "Change the status options for Orders"
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
                "Output ONLY the JSON object, no explanation."
            ),
        }
    ]

    response = client.messages.create(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    raw_text = response.content[0].text.strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3].strip()

    if response.stop_reason == "max_tokens":
        raw_text = _attempt_json_repair(raw_text)

    spec = json.loads(raw_text)
    _validate_spec(spec)
    return spec


def _attempt_json_repair(text: str) -> str:
    """Try to close truncated JSON so it parses."""
    # Count open braces/brackets
    opens = 0
    in_string = False
    escape = False
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
        if ch in ('{', '['):
            opens += 1
        elif ch in ('}', ']'):
            opens -= 1

    # If we're inside a string, close it
    if in_string:
        text += '"'

    # Close any remaining open structures
    # Walk backwards through the text to determine bracket/brace order
    closers = []
    stack = []
    in_str = False
    esc = False
    for ch in text:
        if esc:
            esc = False
            continue
        if ch == '\\':
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == '{':
            stack.append('}')
        elif ch == '[':
            stack.append(']')
        elif ch in ('}', ']') and stack:
            stack.pop()

    # Close remaining open structures
    while stack:
        text += stack.pop()

    return text


def _validate_spec(spec: dict) -> None:
    """Basic structural validation of a generated spec."""
    if "entities" not in spec or not isinstance(spec["entities"], list):
        raise ValueError("Spec must contain 'entities' array")

    if len(spec["entities"]) == 0:
        raise ValueError("Spec must have at least one entity")

    for ent in spec["entities"]:
        if "name" not in ent:
            raise ValueError(f"Entity missing 'name': {ent}")
        if "table" not in ent:
            raise ValueError(f"Entity '{ent.get('name')}' missing 'table'")
        if "fields" not in ent or not isinstance(ent["fields"], list):
            raise ValueError(f"Entity '{ent['name']}' missing 'fields' array")
        if "ui_config" not in ent:
            raise ValueError(f"Entity '{ent['name']}' missing 'ui_config'")

    if "modules" not in spec or not isinstance(spec["modules"], list):
        raise ValueError("Spec must contain 'modules' array")
