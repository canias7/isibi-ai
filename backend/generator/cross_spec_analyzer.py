"""Analyze patterns across all specs to identify common entity/field patterns.

Scans the 1,005+ spec files and finds:
- Most common entities per domain
- Most common fields per entity type
- Common relationship patterns
"""

import json
import logging
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_analysis_cache: Optional[dict] = None
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_project_root = os.path.dirname(_backend_dir)
_SPEC_DIR = os.path.join(_project_root, "spec")


def _load_all_specs() -> list[dict]:
    """Load all spec files from the spec directory."""
    specs = []
    spec_dir = Path(_SPEC_DIR)
    if not spec_dir.exists():
        return specs
    for f in spec_dir.glob("*_spec.json"):
        try:
            data = json.loads(f.read_text())
            if isinstance(data, dict) and data.get("entities"):
                specs.append(data)
        except Exception:
            continue
    logger.info("Loaded %d specs for cross-spec analysis", len(specs))
    return specs


def analyze_patterns() -> dict:
    """Analyze entity and field patterns across all specs."""
    global _analysis_cache
    if _analysis_cache:
        return _analysis_cache

    specs = _load_all_specs()
    if not specs:
        return {}

    entity_counter = Counter()  # entity name -> count
    field_counter = defaultdict(Counter)  # entity name -> field name -> count
    relationship_counter = Counter()  # "EntityA->EntityB" -> count
    field_type_counter = defaultdict(Counter)  # field name -> db_type -> count

    system_fields = {"id", "org_id", "created_at", "updated_at", "deleted_at", "version"}

    for spec in specs:
        entities = spec.get("entities", [])
        entity_names = set()

        for entity in entities:
            if not isinstance(entity, dict):
                continue
            name = entity.get("name", "")
            if not name:
                continue
            entity_counter[name] += 1
            entity_names.add(name)

            for field in entity.get("fields", []):
                if not isinstance(field, dict):
                    continue
                fname = field.get("name", "")
                if fname in system_fields:
                    continue
                field_counter[name][fname] += 1
                field_type_counter[fname][field.get("db_type", "TEXT")] += 1

                # Track relationships
                fk = field.get("fk_entity", "")
                if fk:
                    relationship_counter[f"{name}->{fk}"] += 1

    # Find most common entities (appear in >5% of specs)
    threshold = len(specs) * 0.05
    common_entities = {name: count for name, count in entity_counter.items() if count >= threshold}

    # For each common entity, find must-have fields (appear in >50% of that entity's instances)
    must_have_fields = {}
    for entity_name, entity_count in common_entities.items():
        field_threshold = entity_count * 0.5
        must_fields = [fname for fname, fcount in field_counter[entity_name].items() if fcount >= field_threshold]
        if must_fields:
            must_have_fields[entity_name] = must_fields[:15]  # Cap at 15

    # Common relationships
    common_rels = {rel: count for rel, count in relationship_counter.items() if count >= threshold}

    _analysis_cache = {
        "total_specs": len(specs),
        "common_entities": dict(sorted(common_entities.items(), key=lambda x: -x[1])[:30]),
        "must_have_fields": must_have_fields,
        "common_relationships": dict(sorted(common_rels.items(), key=lambda x: -x[1])[:20]),
    }

    logger.info("Cross-spec analysis: %d common entities, %d with must-have fields",
                len(common_entities), len(must_have_fields))

    return _analysis_cache


def get_cross_spec_context(user_prompt: str) -> str:
    """Get pattern hints from cross-spec analysis for the AI prompt."""
    analysis = analyze_patterns()
    if not analysis:
        return ""

    lower = user_prompt.lower()
    hints = []

    # Find relevant common entities
    for entity_name, count in analysis.get("common_entities", {}).items():
        entity_lower = entity_name.lower()
        if entity_lower in lower or entity_lower.rstrip("s") in lower:
            fields = analysis.get("must_have_fields", {}).get(entity_name, [])
            if fields:
                hints.append(f"- {entity_name} commonly has: {', '.join(fields[:10])}")

    if not hints:
        return ""

    return "## Common patterns from 1000+ existing apps\n" + "\n".join(hints[:10])
