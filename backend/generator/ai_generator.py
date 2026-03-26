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


SYSTEM_PROMPT = """You are an expert software architect that generates complete application specifications in JSON format.

You will receive:
1. A user's request describing what application they want
2. Reference specs from existing apps (for format/pattern reference)
3. One full spec as a JSON schema template

Your job: Generate a COMPLETE, VALID JSON spec for the requested application.

## Rules

1. **Output ONLY valid JSON** — no markdown, no explanation, no code fences.
2. **Follow the exact schema** from the reference spec template.
3. **Generate entities** that match what the user described — NOT copies of reference entities.
4. **Every entity must include:**
   - name, table, description
   - fields[] with: name, db_type, ts_type, nullable, input_component, display_component, editable, sortable, filterable, show_in_table, show_in_form, badge_colors (for enums), validation
   - ui_config with: list_view, detail_view, create_form, edit_form
5. **Every module must include:**
   - name, route, component, layout, sidebar_order, sidebar_icon (valid Lucide icon name), entity (explicit entity name)
6. **Always include these standard fields on every entity:**
   - id (UUID, primary key)
   - org_id (UUID, multi-tenant)
   - created_at, updated_at, deleted_at (TIMESTAMPTZ)
   - version (INTEGER, optimistic locking)
7. **Generate realistic enum values** with badge_colors for each value.
8. **UI config must be complete:**
   - list_view: columns, filters, quick_filter_tabs, empty_state (with icon, heading, subtext, action_label), row_actions
   - detail_view: route, tabs, header (title_fields, badge_fields, meta_fields), primary_fields, secondary_fields
   - create_form: type=SlideOverForm, field_order, required_fields
   - edit_form: same as create but with prefilled=true
9. **Always include a Dashboard module** (sidebar_order: 1) with dashboard config.
10. **Include design_system** with dark theme colors, spacing, buttons, table, typography.
11. **sidebar_icon values** must be valid Lucide React icon names (PascalCase): e.g. Users, ShoppingCart, CalendarDays, Building2, UtensilsCrossed, Briefcase, etc.
12. **Generate 3-6 entities** depending on complexity — keep it focused, don't over-generate.
13. **Include a dashboard section** with stat_cards relevant to the domain.
14. **Keep field definitions compact** — only include essential attributes (name, db_type, ts_type, nullable, show_in_table, show_in_form, editable, input_component, display_component). Skip validation unless needed.
15. **Keep UI configs minimal** — list_view needs columns + empty_state. Forms need field_order + required_fields. Detail view needs header + primary_fields.

## Important
- Be thorough. A real frontend renderer will read this spec to build the entire UI.
- Every field needs proper input_component and display_component.
- Every enum needs badge_colors mapping each value to a Tailwind color name (blue, green, red, amber, purple, indigo, orange, slate).
- Relationships between entities should use fk_entity references.
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
