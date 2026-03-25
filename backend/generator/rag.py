from __future__ import annotations
"""
RAG layer — loads existing spec files as reference context for the AI.

The specs are JSON files on disk. They serve as examples/patterns the AI
can learn from when generating a new spec for a customer.
"""

import json
import os
from pathlib import Path

# Default directories to scan for spec files
DEFAULT_SPEC_DIRS = [
    os.path.expanduser("~/Desktop"),  # where crm_spec.json lives
    os.path.expanduser("~/Desktop/isibi.ai/specs"),  # dedicated specs dir
]

_spec_cache: dict[str, dict] = {}


def discover_spec_files(extra_dirs: list[str] | None = None) -> list[Path]:
    """Find all *_spec.json files in known directories."""
    dirs = DEFAULT_SPEC_DIRS + (extra_dirs or [])
    found: list[Path] = []

    for d in dirs:
        p = Path(d)
        if not p.is_dir():
            continue
        # Top-level spec files
        for f in p.glob("*_spec.json"):
            found.append(f)
        # Also check a specs/ subfolder
        for f in p.glob("specs/*_spec.json"):
            found.append(f)

    # Deduplicate by resolved path
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
        with open(path, "r") as f:
            _spec_cache[key] = json.load(f)
    return _spec_cache[key]


def get_spec_summary(spec: dict) -> str:
    """
    Extract a compact summary of a spec for RAG context.
    We don't dump the entire 44K-token spec — we extract the structural patterns:
    - Entity names + their fields (name, type only)
    - Module names + routes
    - UI config patterns (list_view layout, form fields, detail tabs)
    """
    lines: list[str] = []

    meta = spec.get("_meta", {})
    lines.append(f"# Spec: {meta.get('app_name', 'Unknown App')}")
    lines.append(f"Description: {meta.get('description', 'N/A')}")
    lines.append("")

    # Entities
    entities = spec.get("entities", [])
    for ent in entities:
        name = ent.get("name", "?")
        table = ent.get("table", "?")
        fields = ent.get("fields", [])
        field_summary = ", ".join(
            f"{f['name']}:{f.get('db_type', '?')}" for f in fields[:20]
        )
        lines.append(f"## Entity: {name} (table: {table})")
        lines.append(f"   Fields: {field_summary}")

        # UI config summary
        ui = ent.get("ui_config", {})

        lv = ui.get("list_view")
        if lv:
            lines.append(f"   List: layout={lv.get('layout')}, columns={lv.get('columns', [])[:8]}")
            lines.append(f"         filters={lv.get('filters', [])}")
            es = lv.get("empty_state", {})
            lines.append(f"         empty_state: icon={es.get('icon')}, heading={es.get('heading')}")

        cf = ui.get("create_form")
        if cf:
            lines.append(f"   Create Form: type={cf.get('type')}, fields={cf.get('field_order', [])}")
            lines.append(f"                required={cf.get('required_fields', [])}")

        dv = ui.get("detail_view")
        if dv:
            tab_names = [t.get("name") for t in dv.get("tabs", [])]
            lines.append(f"   Detail: layout={dv.get('layout')}, tabs={tab_names}")
            lines.append(f"           primary_fields={dv.get('primary_fields', [])}")

        lines.append("")

    # Modules
    modules = spec.get("modules", [])
    if modules:
        lines.append("## Modules:")
        for mod in modules:
            lines.append(
                f"   - {mod.get('name')} → {mod.get('route')} "
                f"(layout: {mod.get('layout')}, order: {mod.get('sidebar_order')})"
            )
        lines.append("")

    # Design system (just key info)
    ds = spec.get("design_system", {})
    if ds:
        theme = ds.get("theme", "unknown")
        lines.append(f"## Design: theme={theme}")

    return "\n".join(lines)


def build_rag_context(user_prompt: str, max_specs: int = 3) -> str:
    """
    Build RAG context string from the most relevant spec files.

    For now, we include all discovered specs (up to max_specs).
    A future version could use embeddings to pick the most relevant ones
    based on the user's prompt.
    """
    spec_files = discover_spec_files()

    if not spec_files:
        return "(No existing spec files found for reference.)"

    context_parts: list[str] = []
    context_parts.append(
        "=== REFERENCE SPECS ===\n"
        "Below are existing app specs. Use these as PATTERNS for structure, "
        "field naming conventions, UI config format, and module layout. "
        "Do NOT copy entities — generate new ones that match what the user asked for.\n"
    )

    for spec_path in spec_files[:max_specs]:
        spec = load_spec(spec_path)
        summary = get_spec_summary(spec)
        context_parts.append(f"--- {spec_path.name} ---")
        context_parts.append(summary)
        context_parts.append("")

    return "\n".join(context_parts)


def get_full_spec_as_schema_reference(spec_path: Path | None = None) -> str:
    """
    Return ONE full spec as a JSON schema reference.
    The AI needs to see at least one complete spec to know the exact format.
    """
    if spec_path is None:
        files = discover_spec_files()
        if not files:
            return "{}"
        spec_path = files[0]

    spec = load_spec(spec_path)

    # We include the first entity in full detail as a template,
    # plus the modules, design_system structure
    template: dict = {
        "_meta": spec.get("_meta", {}),
        "entities": spec.get("entities", [])[:1],  # Just first entity as template
        "modules": spec.get("modules", [])[:2],     # First 2 modules as template
        "design_system": spec.get("design_system", {}),
        "pagination": spec.get("pagination", {}),
    }

    return json.dumps(template, indent=2)
