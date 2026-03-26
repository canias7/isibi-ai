from __future__ import annotations
"""
RAG layer — loads existing spec files and finds the BEST matches for a user prompt
using TF-IDF-style keyword scoring.

The specs are JSON files on disk (1000+ of them). Instead of dumping summaries,
we find the top 3 most relevant specs and return their structural data
(entities[], modules[], design_system) so the AI can copy exact patterns.
"""

import json
import math
import os
import re
import logging
from collections import Counter
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Spec discovery ──────────────────────────────────────────────────

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_project_root = os.path.dirname(_backend_dir)

DEFAULT_SPEC_DIRS = [
    os.path.join(_project_root, "spec"),
    os.path.expanduser("~/Desktop"),
    os.path.expanduser("~/Desktop/isibi.ai/specs"),
]

_spec_cache: dict[str, dict] = {}
_index_cache: dict[str, list[str]] | None = None  # filename -> keywords
_idf_cache: dict[str, float] | None = None


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


def load_spec(path: Path) -> dict:
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


# ── Index building ──────────────────────────────────────────────────

def _extract_keywords_from_spec(spec: dict, filename: str) -> list[str]:
    """
    Extract searchable keywords from a spec: file name parts, app name,
    entity names, entity descriptions, and field names with enum values.
    """
    tokens: list[str] = []

    # File name (e.g. "real_estate_crm_spec.json" -> ["real", "estate", "crm"])
    stem = filename.replace("_spec.json", "").replace("_spec", "")
    tokens.extend(_tokenize(stem.replace("_", " ").replace("-", " ")))

    # App name from _meta
    meta = spec.get("_meta", {})
    if isinstance(meta, dict):
        app_name = meta.get("app_name", "") or meta.get("title", "")
        if isinstance(app_name, str):
            tokens.extend(_tokenize(app_name))
        desc = meta.get("description", "")
        if isinstance(desc, str):
            tokens.extend(_tokenize(desc))

    # Top-level app_name
    if isinstance(spec.get("app_name"), str):
        tokens.extend(_tokenize(spec["app_name"]))

    # Entity names and descriptions
    entities = spec.get("entities", [])
    if isinstance(entities, list):
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            name = ent.get("name", "")
            if isinstance(name, str):
                tokens.extend(_tokenize(name))
                # Also add the plural form hint from table name
                table = ent.get("table", "")
                if isinstance(table, str):
                    tokens.extend(_tokenize(table.replace("_", " ")))
            desc = ent.get("description", "")
            if isinstance(desc, str):
                tokens.extend(_tokenize(desc))

    # Module names
    modules = spec.get("modules", [])
    if isinstance(modules, list):
        for mod in modules:
            if isinstance(mod, dict) and isinstance(mod.get("name"), str):
                tokens.extend(_tokenize(mod["name"]))

    return tokens


def _build_index(spec_files: list[Path]) -> tuple[dict[str, list[str]], dict[str, float]]:
    """
    Build a TF-IDF-style index over all spec files.
    Returns (doc_tokens, idf_scores).
    """
    doc_tokens: dict[str, list[str]] = {}
    doc_freq: Counter = Counter()

    for path in spec_files:
        spec = load_spec(path)
        tokens = _extract_keywords_from_spec(spec, path.name)
        doc_tokens[str(path)] = tokens
        # Count unique terms per document for IDF
        unique_terms = set(tokens)
        for term in unique_terms:
            doc_freq[term] += 1

    n_docs = len(spec_files) or 1
    idf: dict[str, float] = {}
    for term, freq in doc_freq.items():
        idf[term] = math.log(n_docs / (1 + freq)) + 1.0

    return doc_tokens, idf


def _get_index(spec_files: list[Path]) -> tuple[dict[str, list[str]], dict[str, float]]:
    """Get or build the cached index."""
    global _index_cache, _idf_cache
    if _index_cache is None or _idf_cache is None:
        _index_cache, _idf_cache = _build_index(spec_files)
    return _index_cache, _idf_cache


# ── Scoring & ranking ──────────────────────────────────────────────

def _score_spec(
    query_tokens: list[str],
    doc_tokens: list[str],
    idf: dict[str, float],
) -> float:
    """
    TF-IDF score: for each query token that appears in the document,
    add TF(doc) * IDF(term). Also boost exact multi-word matches.
    """
    if not doc_tokens or not query_tokens:
        return 0.0

    doc_counter = Counter(doc_tokens)
    doc_len = len(doc_tokens) or 1
    score = 0.0

    for qt in query_tokens:
        tf = doc_counter.get(qt, 0) / doc_len
        term_idf = idf.get(qt, 1.0)
        score += tf * term_idf

    # Boost: if multiple consecutive query tokens appear together in doc
    doc_text = " ".join(doc_tokens)
    query_text = " ".join(query_tokens)
    if len(query_tokens) > 1 and query_text in doc_text:
        score *= 2.0

    return score


def find_best_specs(user_prompt: str, max_results: int = 3) -> list[tuple[Path, dict, float]]:
    """
    Find the best matching spec files for a user prompt using TF-IDF scoring.

    Returns list of (path, spec_dict, score) tuples, sorted by score descending.
    """
    spec_files = discover_spec_files()
    if not spec_files:
        return []

    doc_tokens, idf = _get_index(spec_files)
    query_tokens = _tokenize(user_prompt)

    if not query_tokens:
        # No meaningful tokens — return first 3 specs as fallback
        results = []
        for path in spec_files[:max_results]:
            results.append((path, load_spec(path), 0.0))
        return results

    scored: list[tuple[Path, float]] = []
    for path in spec_files:
        tokens = doc_tokens.get(str(path), [])
        score = _score_spec(query_tokens, tokens, idf)
        if score > 0:
            scored.append((path, score))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    results = []
    for path, score in scored[:max_results]:
        results.append((path, load_spec(path), score))

    # If we got fewer than max_results, pad with random specs
    if len(results) < max_results:
        used_paths = {str(r[0]) for r in results}
        for path in spec_files:
            if str(path) not in used_paths:
                results.append((path, load_spec(path), 0.0))
                if len(results) >= max_results:
                    break

    return results


# ── Context extraction ──────────────────────────────────────────────

def _extract_structural_context(spec: dict, max_entities: int = 4) -> dict:
    """
    Extract only the structural data we need from a spec:
    entities[] (with full field definitions), modules[], and design_system.

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

    # Entities — full field definitions so AI can copy the exact pattern
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

            # Include full field definitions
            fields = ent.get("fields", [])
            if isinstance(fields, list):
                clean_fields = []
                for f in fields:
                    if not isinstance(f, dict):
                        continue
                    # Include the essential field attributes
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

            # Include ui_config
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


def build_rag_context(user_prompt: str, max_specs: int = 3) -> str:
    """
    Build RAG context string from the most relevant spec files.

    Uses TF-IDF scoring to find the best matches, then extracts
    structural data (entities, modules, design_system) from each.
    Keeps total context under ~4000 tokens.
    """
    matches = find_best_specs(user_prompt, max_results=max_specs)

    if not matches:
        return "(No existing spec files found for reference.)"

    context_parts: list[str] = []
    context_parts.append(
        "=== REFERENCE SPECS (use as STRUCTURAL TEMPLATES) ===\n"
        "These are real app specs similar to what the user wants. "
        "Copy the EXACT field format, ui_config structure, and module layout. "
        "Adapt entity names and business fields to match the user's request.\n"
    )

    total_chars = 0
    MAX_CHARS = 12000  # ~4000 tokens at 3 chars/token

    for path, spec, score in matches:
        structural = _extract_structural_context(spec, max_entities=3)
        spec_json = json.dumps(structural, indent=2)

        # Check if adding this would exceed our budget
        if total_chars + len(spec_json) > MAX_CHARS:
            # Reduce to fewer entities
            structural = _extract_structural_context(spec, max_entities=1)
            spec_json = json.dumps(structural, indent=2)
            if total_chars + len(spec_json) > MAX_CHARS:
                break

        score_label = f" (relevance: {score:.2f})" if score > 0 else ""
        context_parts.append(f"--- {path.name}{score_label} ---")
        context_parts.append(spec_json)
        context_parts.append("")
        total_chars += len(spec_json)

    return "\n".join(context_parts)


# ── Fallback template ──────────────────────────────────────────────

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
    """
    Return ONE full spec as a JSON schema reference.
    Falls back to the embedded FALLBACK_TEMPLATE if no spec files exist.
    """
    if spec_path is None:
        files = discover_spec_files()
        if not files:
            return json.dumps(FALLBACK_TEMPLATE, indent=2)
        spec_path = files[0]

    spec = load_spec(spec_path)
    structural = _extract_structural_context(spec, max_entities=2)
    return json.dumps(structural, indent=2)
