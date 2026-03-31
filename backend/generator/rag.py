from __future__ import annotations
"""
RAG layer v2 — Category-aware, composite-matching spec retrieval.

Finds the BEST spec files for a user prompt using a category taxonomy
with synonym matching, composite multi-concept merging, and universal
pattern injection. Returns structural data (entities[], modules[],
design_system) so the AI can copy exact patterns.
"""

import json
import os
import re
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Category Taxonomy with Synonyms ─────────────────────────────────

CATEGORIES = {
    "crm": ["crm", "customer", "lead", "sales", "pipeline", "deal", "contact", "prospect", "opportunity"],
    "restaurant": ["restaurant", "food", "menu", "order", "table", "reservation", "kitchen", "dining", "cafe", "bistro", "bar", "pub", "eatery"],
    "healthcare": ["clinic", "hospital", "patient", "doctor", "medical", "health", "appointment", "prescription", "therapy", "dental", "vet", "veterinary", "pharmacy"],
    "fitness": ["gym", "fitness", "workout", "exercise", "member", "class", "trainer", "yoga", "pilates", "crossfit", "boxing", "martial arts", "swimming", "sport"],
    "education": ["school", "student", "teacher", "course", "class", "grade", "tutoring", "academy", "bootcamp", "training", "lesson", "learning"],
    "real_estate": ["real estate", "property", "listing", "agent", "showing", "rental", "tenant", "landlord", "lease", "mortgage", "house", "apartment", "condo"],
    "ecommerce": ["ecommerce", "store", "shop", "product", "cart", "order", "payment", "inventory", "catalog", "retail", "boutique", "marketplace"],
    "hospitality": ["hotel", "hostel", "inn", "motel", "resort", "booking", "room", "guest", "check-in", "check-out", "reservation", "accommodation"],
    "beauty": ["salon", "spa", "beauty", "hair", "nail", "facial", "massage", "grooming", "stylist", "barber", "cosmetic", "skincare"],
    "automotive": ["car", "auto", "vehicle", "mechanic", "repair", "tire", "oil change", "dealership", "motorcycle", "fleet", "rental car"],
    "construction": ["construction", "builder", "contractor", "roofing", "plumbing", "hvac", "electrical", "painting", "remodel", "renovation"],
    "legal": ["law", "legal", "attorney", "lawyer", "case", "court", "firm", "contract", "litigation", "compliance"],
    "finance": ["accounting", "bookkeeping", "invoice", "payment", "billing", "tax", "payroll", "expense", "budget", "loan", "insurance", "bank"],
    "logistics": ["shipping", "delivery", "warehouse", "inventory", "fleet", "courier", "freight", "supply chain", "tracking", "dispatch"],
    "events": ["event", "wedding", "party", "conference", "venue", "ticket", "booking", "catering", "entertainment", "festival"],
    "nonprofit": ["nonprofit", "charity", "donation", "volunteer", "fundraising", "grant", "church", "community", "shelter"],
    "pet": ["pet", "dog", "cat", "animal", "grooming", "boarding", "walking", "vet", "kennel", "daycare"],
    "tech": ["saas", "api", "bug", "feature", "project", "sprint", "deploy", "monitor", "server", "database", "devops", "ci/cd"],
    "creative": ["design", "photography", "video", "music", "studio", "art", "gallery", "animation", "production"],
    "cleaning": ["cleaning", "maid", "janitorial", "laundry", "carpet", "window", "pressure wash"],
    "food_production": ["bakery", "brewery", "distillery", "catering", "food truck", "juice", "coffee", "ice cream", "chocolate"],
    "agriculture": ["farm", "agriculture", "crop", "livestock", "garden", "nursery", "greenhouse"],
    "government": ["permit", "inspection", "code enforcement", "parks", "library", "municipal"],
    "staffing": ["staffing", "recruiting", "hiring", "temp", "placement", "candidate", "job", "career"],
    "security": ["security", "guard", "surveillance", "alarm", "patrol", "access control"],
    "repair": ["repair", "fix", "service", "maintenance", "troubleshoot"],
    "recreation": ["bowling", "golf", "arcade", "escape room", "trampoline", "laser tag", "mini golf", "skating"],
    "wellness": ["meditation", "wellness", "retreat", "holistic", "acupuncture", "chiropractic", "therapy"],
    "manufacturing": ["machine shop", "welding", "cnc", "3d printing", "laser cutting", "fabrication"],
    "spreadsheet": ["spreadsheet", "sheet", "excel", "csv", "workbook", "grid", "tracker", "ledger", "register", "worksheet", "data entry", "oracle", "data table"],
}

# Build a reverse lookup: synonym -> set of category names
_SYNONYM_TO_CATEGORIES: dict[str, set[str]] = {}
for _cat, _syns in CATEGORIES.items():
    for _syn in _syns:
        _SYNONYM_TO_CATEGORIES.setdefault(_syn, set()).add(_cat)

# ── Universal Patterns ──────────────────────────────────────────────

UNIVERSAL_PATTERNS = """
## Standard field patterns every entity needs:
- id: UUID DEFAULT gen_random_uuid() PRIMARY KEY
- org_id: UUID NOT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- deleted_at: TIMESTAMPTZ (for soft delete)
- version: INTEGER NOT NULL DEFAULT 1

## Common field types:
- Name: VARCHAR(255) NOT NULL, input_component: text_input
- Email: VARCHAR(255), input_component: text_input
- Phone: VARCHAR(20), input_component: text_input
- Price/Amount: NUMERIC(10,2), input_component: number_input
- Date: DATE, input_component: date_input, display_component: date
- Status: VARCHAR(50), input_component: select, display_component: status_badge (needs enum_values + badge_colors)
- Description: TEXT, input_component: textarea
- Boolean: BOOLEAN NOT NULL DEFAULT false, input_component: checkbox, display_component: boolean_badge
- Count: INTEGER NOT NULL DEFAULT 0, input_component: number_input

## Badge color conventions:
- Active/Success/Completed: "green"
- Pending/Warning/In Progress: "amber"
- New/Info/Scheduled: "blue"
- Error/Failed/Cancelled: "red"
- Premium/Special: "pink"
- Advanced/VIP: "purple"
- Default/Inactive: "slate"
""".strip()

# ── Spec discovery ──────────────────────────────────────────────────

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_project_root = os.path.dirname(_backend_dir)

DEFAULT_SPEC_DIRS = [
    os.path.join(_project_root, "spec"),
    os.path.expanduser("~/Desktop"),
    os.path.expanduser("~/Desktop/isibi.ai/specs"),
]

_spec_cache: dict[str, dict] = {}
_spec_index: Optional[list[dict]] = None  # cached list of {path, spec, filename, keywords, categories, entity_count}


def discover_spec_files(extra_dirs: list[str] | None = None) -> list[Path]:
    """Find all *_spec.json files in known directories."""
    dirs = DEFAULT_SPEC_DIRS + (extra_dirs or [])
    found: list[Path] = []
    for d in dirs:
        p = Path(d)
        if not p.is_dir():
            continue
        for f in p.glob("*_spec.json"):
            found.append(f)
        for f in p.glob("specs/*_spec.json"):
            found.append(f)

    seen: set[str] = set()
    unique: list[Path] = []
    for f in found:
        resolved = str(f.resolve())
        if resolved not in seen:
            seen.add(resolved)
            unique.append(f)
    return unique


def _load_spec(path: Path) -> dict:
    """Load and cache a single spec file."""
    key = str(path.resolve())
    if key not in _spec_cache:
        try:
            with open(path, "r") as f:
                _spec_cache[key] = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load spec %s: %s", path, e)
            _spec_cache[key] = {}
    return _spec_cache[key]


# ── Tokenizer ───────────────────────────────────────────────────────

_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "that", "this", "be", "as",
    "are", "was", "were", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "shall", "should", "may", "might",
    "can", "could", "me", "my", "i", "we", "our", "you", "your",
    "build", "make", "create", "app", "application", "system", "tool",
    "want", "need", "like", "please", "just", "also",
})


def _tokenize(text: str) -> list[str]:
    """Lowercase, split on non-alphanumeric, remove stop words."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [w for w in words if w not in _STOP_WORDS and len(w) > 1]


# ── Category detection ──────────────────────────────────────────────

def _detect_categories(prompt: str) -> set[str]:
    """Detect which categories match the user prompt via synonym lookup.

    Checks both single-word and multi-word synonyms (e.g. "real estate",
    "oil change") against the lowercased prompt text.
    """
    prompt_lower = prompt.lower()
    matched: set[str] = set()

    for synonym, cats in _SYNONYM_TO_CATEGORIES.items():
        if " " in synonym:
            # Multi-word synonym: check substring
            if synonym in prompt_lower:
                matched.update(cats)
        else:
            # Single-word: check word boundary
            if re.search(r'\b' + re.escape(synonym) + r'\b', prompt_lower):
                matched.update(cats)

    return matched


def _spec_categories(filename: str, spec: dict) -> set[str]:
    """Determine which categories a spec file belongs to.

    Checks the filename and entity/field names against category synonyms.
    """
    text_parts = [filename.replace("_spec.json", "").replace("_", " ").replace("-", " ")]

    meta = spec.get("_meta", {})
    if isinstance(meta, dict):
        app_name = meta.get("app_name", "") or meta.get("title", "")
        if isinstance(app_name, str):
            text_parts.append(app_name.lower())

    entities = spec.get("entities", [])
    if isinstance(entities, list):
        for ent in entities:
            if isinstance(ent, dict):
                name = ent.get("name", "")
                if isinstance(name, str):
                    text_parts.append(name.lower())

    combined = " ".join(text_parts)
    cats: set[str] = set()
    for synonym, category_set in _SYNONYM_TO_CATEGORIES.items():
        if " " in synonym:
            if synonym in combined:
                cats.update(category_set)
        else:
            if re.search(r'\b' + re.escape(synonym) + r'\b', combined):
                cats.update(category_set)
    return cats


# ── Index building ──────────────────────────────────────────────────

def _extract_keywords(spec: dict, filename: str) -> set[str]:
    """Extract searchable keyword set from a spec file."""
    tokens: list[str] = []

    # Filename tokens
    stem = filename.replace("_spec.json", "").replace("_spec", "")
    tokens.extend(_tokenize(stem.replace("_", " ").replace("-", " ")))

    # App name / meta
    meta = spec.get("_meta", {})
    if isinstance(meta, dict):
        for key in ("app_name", "title", "description"):
            val = meta.get(key, "")
            if isinstance(val, str):
                tokens.extend(_tokenize(val))

    if isinstance(spec.get("app_name"), str):
        tokens.extend(_tokenize(spec["app_name"]))

    # Entity names, descriptions, field names
    entities = spec.get("entities", [])
    if isinstance(entities, list):
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            for key in ("name", "table", "description"):
                val = ent.get(key, "")
                if isinstance(val, str):
                    tokens.extend(_tokenize(val))
            fields = ent.get("fields", [])
            if isinstance(fields, list):
                for f in fields:
                    if isinstance(f, dict) and isinstance(f.get("name"), str):
                        tokens.extend(_tokenize(f["name"]))

    # Module names
    modules = spec.get("modules", [])
    if isinstance(modules, list):
        for mod in modules:
            if isinstance(mod, dict) and isinstance(mod.get("name"), str):
                tokens.extend(_tokenize(mod["name"]))

    return set(tokens)


def _build_spec_index() -> list[dict]:
    """Build the full spec index with keywords and categories. Cached."""
    global _spec_index
    if _spec_index is not None:
        return _spec_index

    spec_files = discover_spec_files()
    index = []
    for path in spec_files:
        spec = _load_spec(path)
        if not spec:
            continue
        filename = path.name
        keywords = _extract_keywords(spec, filename)
        cats = _spec_categories(filename, spec)
        entity_count = 0
        entities = spec.get("entities", [])
        if isinstance(entities, list):
            entity_count = len([e for e in entities if isinstance(e, dict)])

        index.append({
            "path": path,
            "spec": spec,
            "filename": filename,
            "keywords": keywords,
            "categories": cats,
            "entity_count": entity_count,
        })

    _spec_index = index
    logger.info("Built spec index: %d specs indexed", len(index))
    return index


# ── Scoring ─────────────────────────────────────────────────────────

def _extract_phrases(text: str, max_words: int = 3) -> list[str]:
    """Extract 2-word and 3-word phrases from text (lowercased)."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    # Filter out stop words for phrase building
    filtered = [w for w in words if w not in _STOP_WORDS and len(w) > 1]
    phrases = []
    for n in range(2, min(max_words + 1, len(filtered) + 1)):
        for i in range(len(filtered) - n + 1):
            phrases.append(" ".join(filtered[i:i + n]))
    return phrases


def _score_spec(
    entry: dict,
    prompt_tokens: set[str],
    matched_categories: set[str],
    prompt_phrases: list[str] | None = None,
) -> float:
    """Score a single spec entry against the prompt.

    Scoring:
    - Category match bonus: +10 if spec is in a matched category
    - Keyword overlap: +1 for each word match between prompt and spec keywords
    - Quality bonus: +0.5 per entity in the spec
    - Exact filename match: +50 if the filename stem matches prompt tokens closely
    - Partial filename match: +20 if any prompt word appears in the filename stem
    - Phrase match bonus: +15 for each multi-word phrase found in spec keywords
    """
    score = 0.0

    # Category match bonus
    if matched_categories & entry["categories"]:
        score += 10.0

    # Keyword overlap
    overlap = prompt_tokens & entry["keywords"]
    score += len(overlap) * 1.0

    # Quality bonus
    score += entry["entity_count"] * 0.5

    # Filename matching
    stem = entry["filename"].replace("_spec.json", "").replace("_", " ").replace("-", " ")
    stem_tokens = set(_tokenize(stem))

    if stem_tokens and prompt_tokens:
        overlap_ratio = len(prompt_tokens & stem_tokens) / len(stem_tokens)
        if overlap_ratio >= 0.8:
            # Near-exact filename match (e.g., "restaurant management" matches
            # "restaurant_management_spec.json") — strong boost
            score += 50.0
        elif prompt_tokens & stem_tokens:
            # Partial filename match
            score += 20.0

    # Multi-word phrase matching
    if prompt_phrases:
        stem_lower = stem.lower()
        # Also build a searchable text from spec keywords
        keywords_text = " ".join(sorted(entry["keywords"]))
        for phrase in prompt_phrases:
            if phrase in stem_lower or phrase in keywords_text:
                score += 15.0

    return score


# ── Core matching functions ─────────────────────────────────────────

def find_best_specs(user_prompt: str, max_results: int = 3) -> list[tuple[Path, dict, float]]:
    """Find the best matching spec files for a user prompt.

    Uses category taxonomy + keyword overlap + quality scoring.
    Returns list of (path, spec_dict, score) tuples, sorted by score descending.
    """
    index = _build_spec_index()
    if not index:
        return []

    prompt_tokens = set(_tokenize(user_prompt))
    matched_categories = _detect_categories(user_prompt)
    prompt_phrases = _extract_phrases(user_prompt)

    if not prompt_tokens and not matched_categories:
        # No meaningful signal — return first N specs as fallback
        return [(e["path"], e["spec"], 0.0) for e in index[:max_results]]

    scored: list[tuple[dict, float]] = []
    for entry in index:
        s = _score_spec(entry, prompt_tokens, matched_categories, prompt_phrases)
        if s > 0:
            scored.append((entry, s))

    scored.sort(key=lambda x: x[1], reverse=True)

    results = []
    for entry, s in scored[:max_results]:
        logger.info("Matched spec: %s (score=%.1f)", entry["filename"], s)
        results.append((entry["path"], entry["spec"], s))

    # Pad with unmatched specs if needed
    if len(results) < max_results:
        used = {str(r[0]) for r in results}
        for entry in index:
            if str(entry["path"]) not in used:
                results.append((entry["path"], entry["spec"], 0.0))
                if len(results) >= max_results:
                    break

    return results


def _find_composite_specs(user_prompt: str) -> list[tuple[Path, dict, float]]:
    """Composite matching: find the best spec for EACH concept in the prompt.

    If the user says "CRM with invoicing and project tracking", we find:
    - best spec for "CRM"
    - best spec for "invoicing"
    - best spec for "project tracking"

    Then return all unique specs (deduplicated), up to 5 total.
    """
    index = _build_spec_index()
    if not index:
        return []

    # Split prompt into concept fragments at "with", "and", "plus", commas
    prompt_lower = user_prompt.lower()
    # First, split on connectors
    fragments = re.split(r'\b(?:with|and|plus|also|including|that has|that does|as well as)\b|[,;]', prompt_lower)
    fragments = [f.strip() for f in fragments if f.strip()]

    if len(fragments) <= 1:
        # No composite structure detected, use standard matching
        return find_best_specs(user_prompt, max_results=3)

    logger.info("Composite matching: %d concepts detected: %s", len(fragments), fragments)

    seen_paths: set[str] = set()
    results: list[tuple[Path, dict, float]] = []

    for fragment in fragments:
        frag_tokens = set(_tokenize(fragment))
        frag_categories = _detect_categories(fragment)
        frag_phrases = _extract_phrases(fragment)

        if not frag_tokens and not frag_categories:
            continue

        best_entry = None
        best_score = 0.0
        for entry in index:
            s = _score_spec(entry, frag_tokens, frag_categories, frag_phrases)
            if s > best_score:
                best_score = s
                best_entry = entry

        if best_entry and str(best_entry["path"]) not in seen_paths:
            seen_paths.add(str(best_entry["path"]))
            results.append((best_entry["path"], best_entry["spec"], best_score))
            logger.info(
                "Composite match: '%s' -> %s (score=%.1f)",
                fragment.strip(), best_entry["filename"], best_score,
            )

    # If composite found fewer than 2, fall back to standard
    if len(results) < 2:
        return find_best_specs(user_prompt, max_results=3)

    # Cap at 5 composite specs
    return results[:5]


# ── Field Pattern Library ───────────────────────────────────────────

_field_library_cache: Optional[str] = None


def build_field_library() -> str:
    """Extract best field examples from all specs.

    Scans all loaded specs to find the best examples of common field patterns:
    - Status field (most enum values, has badge_colors)
    - Price/amount field
    - Date field
    - Foreign key field
    - Boolean field
    Returns a compact string with these examples.
    """
    global _field_library_cache
    if _field_library_cache is not None:
        return _field_library_cache

    index = _build_spec_index()

    best_status: dict | None = None
    best_status_score = 0
    best_price: dict | None = None
    best_fk: dict | None = None
    best_boolean: dict | None = None

    for entry in index:
        entities = entry["spec"].get("entities", [])
        if not isinstance(entities, list):
            continue
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            fields = ent.get("fields", [])
            if not isinstance(fields, list):
                continue
            for f in fields:
                if not isinstance(f, dict):
                    continue
                name = (f.get("name") or "").lower()
                db_type = (f.get("db_type") or "").upper()

                # Best status field
                if "status" in name and f.get("enum_values") and f.get("badge_colors"):
                    enum_count = len(f["enum_values"]) if isinstance(f["enum_values"], list) else 0
                    if enum_count > best_status_score:
                        best_status_score = enum_count
                        best_status = f

                # Best price field
                if best_price is None and ("NUMERIC" in db_type or "DECIMAL" in db_type):
                    if any(kw in name for kw in ("price", "amount", "cost", "total", "rate", "fee")):
                        best_price = f

                # Best FK field
                if best_fk is None and f.get("fk_entity"):
                    best_fk = f

                # Best boolean field
                if best_boolean is None and "BOOLEAN" in db_type:
                    best_boolean = f

    parts = ["## Field Pattern Examples (extracted from real specs):"]

    def _fmt(field: dict | None, label: str) -> str:
        if not field:
            return ""
        clean = {k: v for k, v in field.items() if k in (
            "name", "db_type", "ts_type", "nullable", "editable",
            "show_in_table", "show_in_form", "input_component",
            "display_component", "enum_values", "badge_colors",
            "fk_entity", "validation",
        )}
        return f"\n### {label}:\n```json\n{json.dumps(clean, indent=2)}\n```"

    parts.append(_fmt(best_status, "Status field (best example)"))
    parts.append(_fmt(best_price, "Price/Amount field"))
    parts.append(_fmt(best_fk, "Foreign key field"))
    parts.append(_fmt(best_boolean, "Boolean field"))

    _field_library_cache = "\n".join(p for p in parts if p)
    return _field_library_cache


# ── Context extraction ──────────────────────────────────────────────

def _extract_structural_context(spec: dict, max_entities: int = 4) -> dict:
    """Extract structural data from a spec: entities[], modules[], design_system.

    Keeps total size manageable by limiting entity count and trimming verbose keys.
    """
    result: dict = {}

    # App name
    meta = spec.get("_meta", {})
    if isinstance(meta, dict):
        result["app_name"] = meta.get("app_name") or meta.get("title", "Unknown")
    elif isinstance(spec.get("app_name"), str):
        result["app_name"] = spec["app_name"]
    else:
        result["app_name"] = "Unknown"

    # Entities with full field definitions
    entities = spec.get("entities", [])
    if isinstance(entities, list):
        clean_entities = []
        for ent in entities[:max_entities]:
            if not isinstance(ent, dict):
                continue
            clean_ent = {
                "name": ent.get("name", ""),
                "table": ent.get("table", ""),
                "description": ent.get("description", ""),
            }
            fields = ent.get("fields", [])
            if isinstance(fields, list):
                clean_fields = []
                for f in fields:
                    if not isinstance(f, dict):
                        continue
                    clean_field = {}
                    for key in (
                        "name", "db_type", "ts_type", "nullable", "editable",
                        "show_in_table", "show_in_form", "input_component",
                        "display_component", "enum_values", "badge_colors",
                        "fk_entity", "validation",
                    ):
                        if key in f:
                            clean_field[key] = f[key]
                    if clean_field.get("name"):
                        clean_fields.append(clean_field)
                clean_ent["fields"] = clean_fields

            ui = ent.get("ui_config", {})
            if isinstance(ui, dict):
                clean_ent["ui_config"] = ui
            clean_entities.append(clean_ent)
        result["entities"] = clean_entities

    # Modules
    modules = spec.get("modules", [])
    if isinstance(modules, list):
        clean_modules = []
        for mod in modules:
            if not isinstance(mod, dict):
                continue
            clean_mod = {}
            for key in ("name", "route", "component", "layout", "sidebar_order", "sidebar_icon", "entity"):
                if key in mod:
                    clean_mod[key] = mod[key]
            clean_modules.append(clean_mod)
        result["modules"] = clean_modules

    # Design system
    ds = spec.get("design_system", {})
    if isinstance(ds, dict):
        result["design_system"] = ds

    # Dashboard
    dash = spec.get("dashboard", {})
    if isinstance(dash, dict):
        result["dashboard"] = dash

    # Pagination
    pag = spec.get("pagination", {})
    if isinstance(pag, dict):
        result["pagination"] = pag

    return result


def get_best_few_shot_example(user_prompt: str) -> str | None:
    """Extract the single best-matching spec as a compact few-shot example.

    Returns a JSON string showing entities[0:2] with their fields from the
    highest-scoring spec, or None if no specs are available.
    This teaches the AI by showing a REAL domain-relevant spec structure.
    """
    matches = _find_composite_specs(user_prompt)
    if not matches:
        return None

    # Take the top-scoring spec
    _path, spec, score = matches[0]
    if score <= 0:
        return None

    # Extract a compact version: first 2 entities with fields
    compact = _extract_structural_context(spec, max_entities=2)
    if not compact or not compact.get("entities"):
        return None

    # Keep only essential keys to stay compact
    example = {
        "app_name": compact.get("app_name", "Example App"),
        "entities": compact.get("entities", [])[:2],
    }

    # Strip ui_config from the example to keep it small
    for ent in example["entities"]:
        ent.pop("ui_config", None)
        # Keep only first 6 business fields (skip system fields)
        fields = ent.get("fields", [])
        business_fields = [
            f for f in fields
            if f.get("name") not in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version")
        ][:6]
        ent["fields"] = business_fields

    try:
        return json.dumps(example, indent=2)
    except (TypeError, ValueError):
        return None


# ── Main public function ────────────────────────────────────────────

def build_rag_context(user_prompt: str, max_specs: int = 5) -> str:
    """Build rich RAG context from user prompt.

    Returns a string under 45000 chars (~15000 tokens) containing:
    1. Universal patterns (always included)
    2. Best matching spec structures (3-5 specs for diverse reference)
    3. Field pattern examples

    Expanded context: Claude can handle 200k tokens, so we send more
    complete specs to give better structural references.
    """
    MAX_CHARS = 45000  # ~15000 tokens — much richer context

    # 1. Universal patterns — always included
    context_parts: list[str] = [
        "=== UNIVERSAL PATTERNS ===",
        UNIVERSAL_PATTERNS,
        "",
    ]
    total_chars = len(UNIVERSAL_PATTERNS) + 50

    # 2. Find matching specs (composite or standard)
    matches = _find_composite_specs(user_prompt)

    # Use top 3-5 specs for richer context (we have the token budget now)
    if matches:
        # Always include top match + 2 diverse alternatives for variety
        matches = matches[:max_specs]
        logger.info(
            "Using %d reference specs (top score=%.1f)",
            len(matches), matches[0][2] if matches else 0,
        )

    if matches:
        context_parts.append("=== REFERENCE SPECS (use as STRUCTURAL TEMPLATES) ===")
        context_parts.append(
            "These are real app specs similar to what the user wants. "
            "Copy the EXACT field format, ui_config structure, and module layout. "
            "Adapt entity names and business fields to match the user's request."
        )
        context_parts.append("")

        for path, spec, score in matches:
            # Dynamically choose entity limit based on remaining budget
            remaining = MAX_CHARS - total_chars
            if remaining < 1500:
                break

            max_ent = 3 if remaining > 6000 else (2 if remaining > 3000 else 1)
            structural = _extract_structural_context(spec, max_entities=max_ent)
            spec_json = json.dumps(structural, indent=2)

            if total_chars + len(spec_json) > MAX_CHARS:
                # Try with fewer entities
                structural = _extract_structural_context(spec, max_entities=1)
                spec_json = json.dumps(structural, indent=2)
                if total_chars + len(spec_json) > MAX_CHARS:
                    break

            score_label = f" (relevance: {score:.1f})" if score > 0 else ""
            context_parts.append(f"--- {path.name}{score_label} ---")
            context_parts.append(spec_json)
            context_parts.append("")
            total_chars += len(spec_json) + len(path.name) + 30
    else:
        context_parts.append("(No existing spec files found for reference.)")

    # 3. Field pattern library — append if there's budget left
    remaining = MAX_CHARS - total_chars
    if remaining > 800:
        field_lib = build_field_library()
        if len(field_lib) <= remaining:
            context_parts.append(field_lib)

    return "\n".join(context_parts)


# ── Legacy / compatibility ──────────────────────────────────────────

FALLBACK_TEMPLATE = {
    "app_name": "My App",
    "entities": [
        {
            "name": "Item",
            "table": "items",
            "description": "Example entity",
            "fields": [
                {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "text"},
                {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "text"},
                {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "nullable": False, "editable": True, "show_in_table": True, "show_in_form": True, "input_component": "TextInput", "display_component": "Text"},
                {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string", "nullable": False, "editable": True, "show_in_table": True, "show_in_form": True, "input_component": "Select", "display_component": "Badge", "enum_values": ["active", "inactive", "archived"], "badge_colors": {"active": "green", "inactive": "slate", "archived": "red"}},
                {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": True, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": True, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"}
            ],
            "ui_config": {
                "list_view": {
                    "layout": "table",
                    "columns": ["name", "status", "created_at"],
                    "filters": ["status"],
                    "empty_state": {"icon": "Box", "heading": "No items yet", "subtext": "Create your first item", "action_label": "Add Item"}
                },
                "create_form": {"type": "SlideOverForm", "field_order": ["name", "status"], "required_fields": ["name"]},
                "edit_form": {"type": "SlideOverForm", "field_order": ["name", "status"], "required_fields": ["name"], "prefilled": True},
                "detail_view": {
                    "route": "/items/:id",
                    "layout": "tabbed",
                    "header": {"title_fields": ["name"], "badge_fields": ["status"]},
                    "primary_fields": ["name", "status"],
                    "tabs": [{"name": "Overview", "fields": ["name", "status", "created_at", "updated_at"]}]
                }
            }
        }
    ],
    "modules": [
        {"name": "Dashboard", "route": "/dashboard", "component": "DashboardPage", "layout": "app", "sidebar_order": 1, "sidebar_icon": "BarChart3"},
        {"name": "Items", "route": "/items", "component": "ResourcePage", "layout": "app", "sidebar_order": 2, "sidebar_icon": "Box", "entity": "Item"}
    ],
    "dashboard": {
        "stat_cards": [
            {"label": "Total Items", "entity": "Item", "aggregate": "count", "icon": "Box", "color": "blue"}
        ]
    },
    "design_system": {
        "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
        "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
        "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
        "table": {"striped": False, "hover": True, "border": "border-gray-200"},
        "typography": {"font": "Inter", "heading": "text-gray-900 font-semibold", "body": "text-gray-700"}
    },
    "pagination": {"type": "cursor", "default_page_size": 25, "max_page_size": 100}
}


def get_full_spec_as_schema_reference(spec_path: Path | None = None) -> str:
    """Return ONE full spec as a JSON schema reference.

    Falls back to the embedded FALLBACK_TEMPLATE if no spec files exist.
    """
    if spec_path is None:
        files = discover_spec_files()
        if not files:
            return json.dumps(FALLBACK_TEMPLATE, indent=2)
        spec_path = files[0]

    spec = _load_spec(spec_path)
    structural = _extract_structural_context(spec, max_entities=2)
    return json.dumps(structural, indent=2)
