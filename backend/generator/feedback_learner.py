"""Track user corrections to generated specs and learn from them."""
import json
import logging
import os
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
_feedback_dir = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "feedback"


def record_correction(project_id: str, original_spec: dict, corrected_spec: dict, action: str):
    """Record when a user modifies a generated spec (renames entity, deletes field, etc.)."""
    try:
        _feedback_dir.mkdir(parents=True, exist_ok=True)

        corrections = []

        # Detect entity additions/removals
        orig_entities = {e.get("name") for e in original_spec.get("entities", []) if isinstance(e, dict)}
        new_entities = {e.get("name") for e in corrected_spec.get("entities", []) if isinstance(e, dict)}

        for added in new_entities - orig_entities:
            corrections.append({"type": "entity_added", "name": added})
        for removed in orig_entities - new_entities:
            corrections.append({"type": "entity_removed", "name": removed})

        if not corrections:
            return

        entry = {
            "project_id": project_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "corrections": corrections,
            "app_type": original_spec.get("app_name", "unknown"),
        }

        filepath = _feedback_dir / f"corrections_{datetime.now(timezone.utc).strftime('%Y%m')}.jsonl"
        with open(filepath, "a") as f:
            f.write(json.dumps(entry) + "\n")

        logger.info("Recorded %d corrections for project %s", len(corrections), project_id)
    except Exception as e:
        logger.debug("Failed to record correction: %s", e)


def get_common_corrections() -> str:
    """Analyze correction history and return patterns for the AI prompt."""
    try:
        if not _feedback_dir.exists():
            return ""

        entity_removals = {}  # entity_name -> count of removals
        entity_additions = {}

        for f in _feedback_dir.glob("corrections_*.jsonl"):
            for line in f.read_text().splitlines():
                try:
                    entry = json.loads(line)
                    for c in entry.get("corrections", []):
                        if c["type"] == "entity_removed":
                            entity_removals[c["name"]] = entity_removals.get(c["name"], 0) + 1
                        elif c["type"] == "entity_added":
                            entity_additions[c["name"]] = entity_additions.get(c["name"], 0) + 1
                except Exception:
                    continue

        hints = []
        # Most removed entities = users don't want these
        for name, count in sorted(entity_removals.items(), key=lambda x: -x[1])[:5]:
            if count >= 3:
                hints.append(f"Users often DELETE the '{name}' entity — consider not generating it")
        # Most added entities = users always want these
        for name, count in sorted(entity_additions.items(), key=lambda x: -x[1])[:5]:
            if count >= 3:
                hints.append(f"Users often ADD a '{name}' entity — consider including it")

        return "\n".join(hints) if hints else ""
    except Exception:
        return ""
