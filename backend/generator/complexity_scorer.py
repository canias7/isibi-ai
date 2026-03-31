"""Score spec complexity and completeness for user-facing display."""
import logging

logger = logging.getLogger(__name__)


def score_complexity(spec: dict) -> dict:
    """Rate a spec on multiple dimensions. Returns scores and a letter grade."""
    entities = spec.get("entities", [])

    scores = {
        "entity_count": min(len(entities) / 8 * 100, 100),
        "field_richness": 0,
        "relationship_depth": 0,
        "validation_coverage": 0,
        "design_customization": 0,
        "dashboard_quality": 0,
        "automation_level": 0,
    }

    # Field richness: avg business fields per entity
    total_biz_fields = 0
    total_validated = 0
    total_fields = 0
    fk_count = 0
    system_fields = {"id", "org_id", "created_at", "updated_at", "deleted_at", "version"}

    for entity in entities:
        if not isinstance(entity, dict):
            continue
        fields = entity.get("fields", [])
        biz_fields = [f for f in fields if isinstance(f, dict) and f.get("name") not in system_fields]
        total_biz_fields += len(biz_fields)
        total_fields += len(biz_fields)

        for f in biz_fields:
            if f.get("validation"):
                total_validated += 1
            if f.get("fk_entity"):
                fk_count += 1

    if entities:
        avg_fields = total_biz_fields / len(entities)
        scores["field_richness"] = min(avg_fields / 10 * 100, 100)

    # Relationship depth
    if total_fields > 0:
        scores["relationship_depth"] = min(fk_count / max(len(entities), 1) * 50, 100)

    # Validation coverage
    if total_fields > 0:
        scores["validation_coverage"] = min(total_validated / total_fields * 100, 100)

    # Design customization
    ds = spec.get("design_system", {})
    colors = ds.get("colors", {})
    if colors.get("primary") and colors["primary"] != "#2563eb":
        scores["design_customization"] += 30
    if ds.get("typography", {}).get("font") and ds["typography"]["font"] != "Inter":
        scores["design_customization"] += 30
    if colors.get("sidebar_bg"):
        scores["design_customization"] += 40
    scores["design_customization"] = min(scores["design_customization"], 100)

    # Dashboard quality
    stat_cards = spec.get("dashboard", {}).get("stat_cards", [])
    scores["dashboard_quality"] = min(len(stat_cards) / 5 * 100, 100)

    # Automation level
    auto_count = 0
    auto_count += len(spec.get("_automations", []))
    auto_count += len(spec.get("_reports", []))
    auto_count += len(spec.get("_notifications", []))
    auto_count += len(spec.get("_email_templates", []))
    auto_count += len(spec.get("_roles", []))
    scores["automation_level"] = min(auto_count / 10 * 100, 100)

    # Overall score
    weights = {
        "entity_count": 0.15,
        "field_richness": 0.20,
        "relationship_depth": 0.15,
        "validation_coverage": 0.15,
        "design_customization": 0.10,
        "dashboard_quality": 0.10,
        "automation_level": 0.15,
    }

    overall = sum(scores[k] * weights[k] for k in weights)

    # Letter grade
    if overall >= 90:
        grade = "A+"
    elif overall >= 80:
        grade = "A"
    elif overall >= 70:
        grade = "B"
    elif overall >= 60:
        grade = "C"
    elif overall >= 50:
        grade = "D"
    else:
        grade = "F"

    return {
        "overall": round(overall),
        "grade": grade,
        "scores": {k: round(v) for k, v in scores.items()},
        "entity_count": len(entities),
        "total_fields": total_fields,
        "fk_relationships": fk_count,
        "validated_fields": total_validated,
    }
