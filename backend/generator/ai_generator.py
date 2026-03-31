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
from .rag import build_rag_context, get_full_spec_as_schema_reference, get_best_few_shot_example

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")

MAX_JSON_RETRIES = 2

# ── System Prompt ───────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Anias, an expert app architect for isibi.ai. You produce complete JSON specs that a code generator turns into working apps.

Output ONLY valid JSON. No markdown fences, no explanation, no comments.

## SPEC STRUCTURE
{"app_name":"...","entities":[...],"modules":[...],"dashboard":{"stat_cards":[...]},"design_system":{"colors":{"primary":"...","secondary":"...","sidebar_bg":"...","sidebar_text":"..."},"spacing":{"page_padding":"24px","card_padding":"16px","gap":"16px"},"buttons":{"primary_bg":"...","primary_text":"white"},"table":{"striped":false,"hover":true},"typography":{"font":"..."}},"pagination":{"type":"cursor","default_page_size":25}}

## DESIGN SYSTEM — MAKE EACH APP UNIQUE
Choose colors, fonts, and style based on the SPECIFIC business/industry:
- Pick a primary color that matches the vibe (warm reds for food, clean blues for medical, bold dark for fitness, etc.)
- Pick a font that fits: Playfair Display (luxury), Poppins (modern), Oswald (bold), Nunito (friendly), DM Sans (clean), Lora (elegant), Space Grotesk (tech), Montserrat (professional), Quicksand (soft), Outfit (minimal)
- Choose sidebar style: dark (sidebar_bg: dark color, sidebar_text: light) or light (sidebar_bg: white/light, sidebar_text: dark)
- NEVER use the same colors for different types of businesses. A restaurant should look NOTHING like a medical clinic.
{design_context}

## ENTITY STRUCTURE
{"name":"Lead","table":"leads","description":"Sales lead tracking","fields":[...system+business fields...],"ui_config":{...}}

System fields (always include): id (UUID PK), org_id (UUID NOT NULL), created_at, updated_at, deleted_at, version.

## FIELD FORMAT — every business field MUST have ALL 10 attributes:
{"name":"status","db_type":"VARCHAR(50) NOT NULL DEFAULT 'new'","ts_type":"string","nullable":false,"editable":true,"show_in_table":true,"show_in_form":true,"input_component":"Select","display_component":"Badge","enum_values":["new","contacted","qualified","lost"],"badge_colors":{"new":"blue","contacted":"amber","qualified":"green","lost":"red"}}

input_component: TextInput|TextArea|Select|DatePicker|NumberInput|Toggle|EmailInput|PhoneInput|CurrencyInput|FileUpload|none
display_component: Text|Badge|Date|Currency|Email|Phone|Link|Avatar|Progress|none
db_type: VARCHAR(255)|TEXT|INTEGER|BOOLEAN|NUMERIC(12,2)|DATE|TIMESTAMPTZ|UUID|JSONB
ts_type: string|number|boolean|string[]|object

Enum fields MUST have enum_values[] AND badge_colors{} (blue/green/red/amber/purple/indigo/orange/slate/emerald/rose/cyan/violet).
FK fields: name="{entity}_id", db_type="UUID REFERENCES {table}(id)", add "fk_entity":"EntityName", input_component:"relation_select", display_component:"relation_link".

## UI_CONFIG
{"list_view":{"layout":"table","columns":["name","status"],"filters":["status"],"empty_state":{"icon":"Users","heading":"No items","subtext":"Add first","action_label":"Add"}},"create_form":{"type":"SlideOverForm","field_order":["name","status"],"required_fields":["name"]},"edit_form":{"type":"SlideOverForm","field_order":["name","status"],"required_fields":["name"],"prefilled":true},"detail_view":{"route":"/items/:id","layout":"tabbed","header":{"title_fields":["name"],"badge_fields":["status"]},"primary_fields":["name","status"],"tabs":[{"name":"Overview","fields":["name","status"]}]}}

## MODULES
Dashboard always first: {"name":"Dashboard","route":"/","component":"DashboardPage","layout":"sidebar","sidebar_order":1,"sidebar_icon":"BarChart3","entity":null}
Per entity: {"name":"Leads","route":"/leads","component":"ResourcePage","layout":"sidebar","sidebar_order":2,"sidebar_icon":"Users","entity":"Lead"}
Icons (Lucide PascalCase): Users, ShoppingCart, CalendarDays, Briefcase, Package, CreditCard, FileText, CheckCircle, ClipboardList, MessageSquare, Target, Layers, Home, Truck, DollarSign, BarChart3, Settings, Tag, Mail, Globe, Shield, Award, Heart, Star, Flag, Map, Book, Archive, Inbox

## ADVANCED FEATURES (use when appropriate)
visible_when: {"field":"status","operator":"eq","value":"shipped"} — operators: eq|neq|gt|lt|gte|lte|in|not_in|contains|not_empty
computed: "quantity * price" — functions: DAYS_UNTIL|DAYS_SINCE|NOW|UPPER|LOWER|CONCAT — always editable:false
validation: {"rule":"email","message":"Invalid email"} — rules: required|email|min|max|minLength|maxLength|pattern|url

## SPREADSHEET APPS
When the user mentions spreadsheet, excel, sheet, grid, workbook, tracker, ledger, or data table, add "app_type":"spreadsheet" to the root of the spec. For spreadsheet apps: prefer more columns per entity (8-15 fields), include several numeric fields, and use data-entry-friendly field types.

## DOMAIN EXPERTISE — think like a consultant for this specific business
- Understand the SPECIFIC type of business (food truck vs fine dining, CrossFit gym vs yoga studio, family clinic vs hospital)
- Include fields that THIS business actually needs (allergens for restaurant, insurance_provider for medical, membership_tier for gym)
- Add status workflows that match the industry (lead→qualified→converted for sales, pending→confirmed→seated→completed for reservations)
- Dashboard should show KPIs that matter: revenue for ecommerce, occupancy for hotels, no-show rate for appointments
- Think about what reports the business owner needs and include the fields to support them

## SEED DATA — include sample records
Add a "_seed_data" key to each entity with 3-5 realistic sample records. This makes the app feel alive on first load.
Example: {{"_seed_data": [{{"name": "John Smith", "email": "john@example.com", "status": "active"}}, ...]}}

## RULES
1. Generate 4-8 entities with 8-12 fields each. Include domain-specific fields, not just generic ones.
2. Every enum field needs enum_values[] AND badge_colors{}.
3. Create FK relationships between logically connected entities.
4. Dashboard stat_cards: 3-5 key metrics relevant to the industry. Every module needs a Lucide icon.
5. Use RAG reference specs as structural templates — match their field format exactly.
6. Always build immediately. Never ask questions. Make reasonable assumptions.
7. NEVER generate a generic CRM. Tailor every entity, field, and workflow to the specific business described."""


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

    # Get best-matching spec as a few-shot example
    few_shot_example = get_best_few_shot_example(user_prompt)

    # Build messages
    messages: list[dict] = []

    if conversation_history:
        messages.extend(conversation_history)

    # Build few-shot section if available
    few_shot_section = ""
    if few_shot_example:
        few_shot_section = f"""
## Example of a well-structured spec for a similar domain
{few_shot_example}

Now generate a spec for the user's request, following this exact structure.
"""

    user_message = f"""## User Request
{user_prompt}

## Reference Patterns (from existing specs — use as STRUCTURAL TEMPLATES)
{rag_context}
{few_shot_section}
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

    # Inject domain-aware design palette into system prompt
    from generator.design_palettes import get_palette_context
    _design_ctx = get_palette_context(user_prompt)
    _final_prompt = SYSTEM_PROMPT.replace("{design_context}", _design_ctx)

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
                    system=_final_prompt,
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

            # Handle truncation: if response was cut off mid-JSON, ask for continuation
            if truncated:
                logger.warning(
                    "Response truncated at %d chars (stop_reason=max_tokens), attempting recovery",
                    len(raw_text),
                )
                raw_text = _handle_truncated_response(client, messages, raw_text)

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

    # Validate, auto-fill, and enforce format
    spec = _ensure_required_fields(spec)
    spec = _enforce_format(spec)
    _validate_spec(spec)

    # Score spec quality and log it; re-generate if score is too low
    from .spec_validator import score_spec_quality
    quality = score_spec_quality(spec)
    logger.info(
        "Spec quality score: %d/100 | Strengths: %s | Issues: %s",
        quality["score"],
        "; ".join(quality["strengths"][:3]),
        "; ".join(quality["issues"][:3]),
    )

    if quality["score"] < 60:
        logger.warning(
            "Spec quality score %d < 60 — triggering re-generation with more specific prompt",
            quality["score"],
        )
        # Build a more specific prompt with the issues as guidance
        issue_guidance = "\n".join(f"- Fix: {issue}" for issue in quality["issues"])
        retry_messages = messages + [
            {"role": "assistant", "content": raw_text},
            {
                "role": "user",
                "content": (
                    f"The spec you generated has quality issues (score: {quality['score']}/100):\n"
                    f"{issue_guidance}\n\n"
                    "Please regenerate the COMPLETE JSON spec addressing ALL of these issues. "
                    "Ensure every entity has complete fields with all 10 attributes, "
                    "FK relationships between related entities, ui_config, and 4+ dashboard stat cards. "
                    "Output ONLY the JSON object."
                ),
            },
        ]
        try:
            retry_response = client.messages.create(
                model=MODEL,
                max_tokens=64000,
                system=SYSTEM_PROMPT,
                messages=retry_messages,
            )
            retry_text = retry_response.content[0].text.strip()
            retry_spec = _robust_json_parse(retry_text)
            if isinstance(retry_spec, dict):
                retry_spec = _ensure_required_fields(retry_spec)
                retry_spec = _enforce_format(retry_spec)
                _validate_spec(retry_spec)
                retry_quality = score_spec_quality(retry_spec)
                logger.info(
                    "Re-generated spec quality score: %d/100 (was %d)",
                    retry_quality["score"], quality["score"],
                )
                if retry_quality["score"] > quality["score"]:
                    spec = retry_spec
        except Exception as e:
            logger.warning("Quality re-generation failed: %s — using original spec", e)

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

            # Handle truncation with continuation calls
            if truncated:
                logger.warning(
                    "Refine response truncated at %d chars (stop_reason=max_tokens), attempting recovery",
                    len(raw_text),
                )
                raw_text = _handle_truncated_response(client, messages, raw_text)

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
    spec = _enforce_format(spec)
    _validate_spec(spec)
    return spec


# ── Helpers ─────────────────────────────────────────────────────────

def _handle_truncated_response(
    client: "anthropic.Anthropic",
    messages: list[dict],
    raw_text: str,
    max_continuations: int = 2,
) -> str:
    """
    Handle truncated API responses by making follow-up calls to continue generation.

    If the response was cut off mid-JSON, asks Claude to continue from where it
    left off. Concatenates the continuation to the original text and returns the
    combined result. Tries up to max_continuations follow-up calls.
    """
    combined = raw_text

    for i in range(max_continuations):
        # Check if it looks like complete JSON already
        stripped = _strip_code_fences(combined)
        first_brace = stripped.find("{")
        if first_brace >= 0:
            # Count open/close braces outside strings
            try:
                json.loads(stripped[first_brace:])
                # If it parses, no continuation needed
                return combined
            except (json.JSONDecodeError, ValueError):
                pass

        # Get the last 500 chars as context for continuation
        tail_context = combined[-500:]
        logger.info(
            "Response truncated (continuation %d/%d) — requesting continuation",
            i + 1, max_continuations,
        )

        try:
            continuation_messages = messages + [
                {"role": "assistant", "content": combined},
                {
                    "role": "user",
                    "content": (
                        "Your JSON output was truncated. Continue EXACTLY from where "
                        "you left off. Do NOT repeat any previous content. Do NOT add "
                        "any explanation. Just continue the JSON output.\n\n"
                        f"Last 500 characters of your output:\n{tail_context}"
                    ),
                },
            ]
            cont_response = client.messages.create(
                model=MODEL,
                max_tokens=64000,
                system="You are continuing a truncated JSON output. Output ONLY the continuation of the JSON, nothing else. Do NOT repeat content that was already generated.",
                messages=continuation_messages,
            )
            cont_text = cont_response.content[0].text.strip()
            if not cont_text:
                break

            combined += cont_text
            logger.info("Continuation %d added %d chars", i + 1, len(cont_text))

            # If this continuation wasn't truncated, we're done
            if cont_response.stop_reason != "max_tokens":
                break

        except Exception as e:
            logger.warning("Continuation call %d failed: %s", i + 1, e)
            break

    return combined


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


def _enforce_format(spec: dict) -> dict:
    """
    Post-generation format enforcer. Validates and repairs the spec structure,
    logging every fix so we can track AI reliability over time.
    """
    fixes: list[str] = []

    # 1. Ensure every entity has name, table, fields[], ui_config
    for i, ent in enumerate(spec.get("entities", [])):
        if not isinstance(ent, dict):
            continue
        ent_name = ent.get("name", f"Entity_{i}")
        if "name" not in ent:
            ent["name"] = f"Entity_{i}"
            fixes.append(f"Entity {i}: added missing 'name'")
        if "table" not in ent:
            ent["table"] = re.sub(r"(?<!^)(?=[A-Z])", "_", ent["name"]).lower() + "s"
            fixes.append(f"{ent_name}: generated missing 'table'")
        if "fields" not in ent or not isinstance(ent["fields"], list):
            ent["fields"] = []
            fixes.append(f"{ent_name}: added missing 'fields' array")
        if "ui_config" not in ent or not isinstance(ent["ui_config"], dict):
            fixes.append(f"{ent_name}: will generate missing 'ui_config'")
            # _ensure_entity_completeness will handle this

        # 2. Ensure every field has ALL 10 required attributes
        required_attrs = {
            "db_type": "TEXT",
            "ts_type": "string",
            "nullable": True,
            "editable": True,
            "show_in_table": True,
            "show_in_form": True,
            "input_component": "TextInput",
            "display_component": "Text",
        }
        for field in ent.get("fields", []):
            if not isinstance(field, dict) or not field.get("name"):
                continue
            fname = field["name"]
            # Skip system fields
            if fname in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
                continue
            for attr, default in required_attrs.items():
                if attr not in field:
                    field[attr] = default
                    fixes.append(f"{ent_name}.{fname}: added missing '{attr}' = {default}")

            # 3. Ensure every enum field has badge_colors
            if field.get("enum_values") and not field.get("badge_colors"):
                color_cycle = ["blue", "green", "amber", "red", "purple", "indigo", "slate", "emerald", "rose", "cyan"]
                field["badge_colors"] = {
                    val: color_cycle[j % len(color_cycle)]
                    for j, val in enumerate(field["enum_values"])
                }
                fixes.append(f"{ent_name}.{fname}: generated missing 'badge_colors'")

            # Ensure enum fields use Badge display
            if field.get("enum_values") and field.get("display_component") == "Text":
                field["display_component"] = "Badge"
                fixes.append(f"{ent_name}.{fname}: corrected display_component to 'Badge'")

            if field.get("enum_values") and field.get("input_component") == "TextInput":
                field["input_component"] = "Select"
                fixes.append(f"{ent_name}.{fname}: corrected input_component to 'Select'")

    # 4. Ensure modules[] exists with Dashboard + one per entity
    modules = spec.get("modules", [])
    if not isinstance(modules, list):
        modules = []
        spec["modules"] = modules
    has_dashboard = any(
        isinstance(m, dict) and m.get("name", "").lower() == "dashboard"
        for m in modules
    )
    if not has_dashboard:
        modules.insert(0, {
            "name": "Dashboard", "route": "/", "component": "DashboardPage",
            "layout": "sidebar", "sidebar_order": 1, "sidebar_icon": "BarChart3", "entity": None,
        })
        fixes.append("Added missing Dashboard module")

    entity_names = {ent.get("name") for ent in spec.get("entities", []) if isinstance(ent, dict)}
    module_entities = {m.get("entity") for m in modules if isinstance(m, dict)}
    for ent_name in entity_names:
        if ent_name and ent_name not in module_entities:
            ent_dict = next((e for e in spec["entities"] if isinstance(e, dict) and e.get("name") == ent_name), None)
            table = ent_dict.get("table", ent_name.lower() + "s") if ent_dict else ent_name.lower() + "s"
            modules.append({
                "name": f"{ent_name}s" if not ent_name.endswith("s") else ent_name,
                "route": f"/{table}",
                "component": "ResourcePage",
                "layout": "sidebar",
                "sidebar_order": len(modules) + 1,
                "sidebar_icon": "Box",
                "entity": ent_name,
            })
            fixes.append(f"Added missing module for entity '{ent_name}'")

    # 5. Ensure design_system has complete color scheme
    ds = spec.get("design_system", {})
    if not isinstance(ds, dict):
        ds = {}
        spec["design_system"] = ds
    ds_defaults = {
        "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
        "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
        "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
        "table": {"striped": False, "hover": True},
        "typography": {"font": "Inter"},
    }
    for key, default in ds_defaults.items():
        if key not in ds:
            ds[key] = default
            fixes.append(f"design_system: added missing '{key}'")
        elif isinstance(default, dict) and isinstance(ds[key], dict):
            for sub_key, sub_val in default.items():
                if sub_key not in ds[key]:
                    ds[key][sub_key] = sub_val
                    fixes.append(f"design_system.{key}: added missing '{sub_key}'")

    # Log all fixes
    if fixes:
        logger.warning(
            "Format enforcer applied %d fixes:\n  %s",
            len(fixes), "\n  ".join(fixes)
        )
    else:
        logger.info("Format enforcer: spec passed all checks — no fixes needed")

    return spec


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
