from __future__ import annotations
"""
Spec Validator & Auto-Repair — validates AI-generated specs and fixes issues.

Runs after the AI generates a spec but before the builder consumes it.
Catches common problems: missing fields, wrong input components, missing
system fields, empty modules/dashboard, etc.
"""

import copy
import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────

REQUIRED_TOP_LEVEL_KEYS = {
    "app_name",
    "entities",
    "modules",
    "dashboard",
    "design_system",
    "pagination",
}

REQUIRED_FIELD_ATTRIBUTES = [
    "name",
    "db_type",
    "ts_type",
    "nullable",
    "editable",
    "show_in_table",
    "show_in_form",
    "input_component",
    "display_component",
]

VALID_VISIBLE_WHEN_OPERATORS = {
    "eq", "neq", "gt", "lt", "gte", "lte", "in", "not_in", "contains", "not_empty",
}

VALID_VALIDATION_RULES = {
    "required", "email", "min", "max", "minLength", "maxLength", "pattern", "url",
}

SYSTEM_FIELDS = {
    "id": {
        "name": "id",
        "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY",
        "ts_type": "string",
        "nullable": False,
        "editable": False,
        "show_in_table": False,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Text",
    },
    "org_id": {
        "name": "org_id",
        "db_type": "UUID NOT NULL",
        "ts_type": "string",
        "nullable": False,
        "editable": False,
        "show_in_table": False,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Text",
    },
    "created_at": {
        "name": "created_at",
        "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "ts_type": "string",
        "nullable": False,
        "editable": False,
        "show_in_table": True,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Date",
    },
    "updated_at": {
        "name": "updated_at",
        "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "ts_type": "string",
        "nullable": False,
        "editable": False,
        "show_in_table": False,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Date",
    },
    "deleted_at": {
        "name": "deleted_at",
        "db_type": "TIMESTAMPTZ",
        "ts_type": "string",
        "nullable": True,
        "editable": False,
        "show_in_table": False,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Date",
    },
    "version": {
        "name": "version",
        "db_type": "INTEGER NOT NULL DEFAULT 1",
        "ts_type": "number",
        "nullable": False,
        "editable": False,
        "show_in_table": False,
        "show_in_form": False,
        "input_component": "none",
        "display_component": "Text",
    },
}

# Maps db_type patterns to the correct input_component
DB_TYPE_TO_INPUT: list[tuple[str, str]] = [
    ("BOOLEAN", "Toggle"),
    ("DATE", "DatePicker"),
    ("TIMESTAMPTZ", "none"),      # timestamps are system-managed
    ("TEXT", "TextArea"),
    ("JSONB", "TextArea"),
    ("NUMERIC", "CurrencyInput"),
    ("INTEGER", "NumberInput"),
    ("BIGINT", "NumberInput"),
    ("SMALLINT", "NumberInput"),
    ("DECIMAL", "CurrencyInput"),
    ("FLOAT", "NumberInput"),
    ("DOUBLE", "NumberInput"),
]

# Maps db_type patterns to ts_type
DB_TYPE_TO_TS: dict[str, str] = {
    "BOOLEAN": "boolean",
    "INTEGER": "number",
    "BIGINT": "number",
    "SMALLINT": "number",
    "NUMERIC": "number",
    "DECIMAL": "number",
    "FLOAT": "number",
    "DOUBLE": "number",
    "JSONB": "object",
    "JSON": "object",
}

# Smart input component inference from field name patterns
NAME_TO_INPUT: list[tuple[str, str, str]] = [
    # (pattern, input_component, display_component)
    ("email", "EmailInput", "Email"),
    ("phone", "PhoneInput", "Phone"),
    ("url", "TextInput", "Link"),
    ("website", "TextInput", "Link"),
    ("avatar", "FileUpload", "Avatar"),
    ("image", "FileUpload", "Avatar"),
    ("photo", "FileUpload", "Avatar"),
    ("price", "CurrencyInput", "Currency"),
    ("cost", "CurrencyInput", "Currency"),
    ("amount", "CurrencyInput", "Currency"),
    ("total", "CurrencyInput", "Currency"),
    ("revenue", "CurrencyInput", "Currency"),
    ("salary", "CurrencyInput", "Currency"),
    ("fee", "CurrencyInput", "Currency"),
]

# Standard badge color conventions
STANDARD_BADGE_COLORS: dict[str, str] = {
    "active": "green",
    "enabled": "green",
    "completed": "green",
    "approved": "green",
    "done": "green",
    "success": "green",
    "paid": "green",
    "resolved": "green",
    "closed_won": "green",
    "verified": "green",
    "published": "green",
    "pending": "amber",
    "in_progress": "blue",
    "processing": "blue",
    "in_review": "blue",
    "open": "blue",
    "new": "blue",
    "draft": "slate",
    "inactive": "slate",
    "disabled": "slate",
    "archived": "slate",
    "cancelled": "red",
    "canceled": "red",
    "rejected": "red",
    "failed": "red",
    "overdue": "red",
    "lost": "red",
    "closed_lost": "red",
    "expired": "red",
    "blocked": "red",
    "suspended": "red",
    "deleted": "red",
    "high": "amber",
    "urgent": "red",
    "critical": "red",
    "medium": "blue",
    "low": "slate",
    "normal": "blue",
    "todo": "slate",
    "scheduled": "purple",
    "on_hold": "amber",
    "waiting": "amber",
}

# Fallback badge colors cycled for unknown enum values
FALLBACK_BADGE_COLORS = [
    "blue", "green", "amber", "purple", "indigo",
    "rose", "cyan", "orange", "violet", "slate",
]

# Icon map for module generation
ICON_MAP: dict[str, str] = {
    "user": "Users", "contact": "Users", "customer": "Users",
    "person": "Users", "people": "Users", "client": "Users",
    "employee": "Users", "staff": "Users", "member": "Users",
    "deal": "Briefcase", "opportunity": "Briefcase",
    "order": "ShoppingCart", "purchase": "ShoppingCart",
    "product": "Package", "item": "Package", "inventory": "Package",
    "task": "CheckCircle", "todo": "CheckCircle",
    "project": "Layers", "workspace": "Layers",
    "invoice": "FileText", "bill": "FileText", "receipt": "FileText",
    "payment": "CreditCard", "transaction": "CreditCard",
    "message": "MessageSquare", "chat": "MessageSquare",
    "conversation": "MessageSquare", "comment": "MessageSquare",
    "notification": "Bell", "alert": "Bell",
    "setting": "Settings", "config": "Settings",
    "lead": "Target",
    "ticket": "ClipboardList", "issue": "ClipboardList",
    "event": "CalendarDays", "appointment": "CalendarDays",
    "meeting": "CalendarDays", "schedule": "CalendarDays",
    "report": "BarChart3", "analytics": "BarChart3",
    "document": "FileText", "file": "FileText",
    "category": "Tag", "tag": "Tag", "label": "Tag",
    "campaign": "Zap", "email": "Mail",
    "property": "Building2", "listing": "Building2",
    "vehicle": "Truck", "shipment": "Truck", "delivery": "Truck",
}

DEFAULT_DESIGN_SYSTEM: dict[str, Any] = {
    "colors": {
        "primary": "#2563eb",
        "secondary": "#64748b",
        "sidebar_bg": "#0f172a",
        "sidebar_text": "#e2e8f0",
    },
    "spacing": {
        "page_padding": "24px",
        "card_padding": "16px",
        "gap": "16px",
    },
    "buttons": {
        "primary_bg": "blue-600",
        "primary_text": "white",
    },
    "table": {
        "striped": False,
        "hover": True,
    },
    "typography": {
        "font": "Inter",
    },
}

STAT_CARD_COLORS = ["blue", "green", "purple", "amber", "indigo", "rose"]


# ── Public API ───────────────────────────────────────────────────────

def get_validation_report(spec: dict) -> list[str]:
    """Return list of issues found (before repair)."""
    issues: list[str] = []

    # Top-level keys
    for key in REQUIRED_TOP_LEVEL_KEYS:
        if key not in spec:
            issues.append(f"Missing top-level key: '{key}'")

    if not isinstance(spec.get("entities"), list) or len(spec.get("entities", [])) == 0:
        issues.append("No entities defined")

    if not isinstance(spec.get("modules"), list) or len(spec.get("modules", [])) == 0:
        issues.append("No modules defined")

    # Check for duplicate entity names
    entity_names = [
        e.get("name") for e in spec.get("entities", [])
        if isinstance(e, dict) and e.get("name")
    ]
    seen: set[str] = set()
    for n in entity_names:
        if n in seen:
            issues.append(f"Duplicate entity name: '{n}'")
        seen.add(n)

    # Entity-level checks
    for ent in spec.get("entities", []):
        if not isinstance(ent, dict):
            issues.append("Entity is not a dict")
            continue

        ent_name = ent.get("name", "<unnamed>")

        if "name" not in ent:
            issues.append(f"Entity missing 'name'")
        if "table" not in ent:
            issues.append(f"Entity '{ent_name}' missing 'table'")
        if "fields" not in ent or not isinstance(ent.get("fields"), list):
            issues.append(f"Entity '{ent_name}' missing 'fields' array")
            continue
        if "ui_config" not in ent or not isinstance(ent.get("ui_config"), dict):
            issues.append(f"Entity '{ent_name}' missing 'ui_config'")

        # Check system fields
        field_names = {f.get("name") for f in ent["fields"] if isinstance(f, dict)}
        for sf_name in SYSTEM_FIELDS:
            if sf_name not in field_names:
                issues.append(f"Entity '{ent_name}' missing system field: '{sf_name}'")

        # Check field attributes
        for field in ent["fields"]:
            if not isinstance(field, dict):
                issues.append(f"Entity '{ent_name}' has a non-dict field")
                continue
            fname = field.get("name", "<unnamed>")
            for attr in REQUIRED_FIELD_ATTRIBUTES:
                if attr not in field:
                    issues.append(f"Entity '{ent_name}', field '{fname}' missing attribute: '{attr}'")

            # Check enum fields have badge_colors
            if field.get("enum_values") and not field.get("badge_colors"):
                issues.append(
                    f"Entity '{ent_name}', field '{fname}' has enum_values but no badge_colors"
                )

            # Check input_component matches db_type
            db_type_upper = (field.get("db_type") or "").upper()
            input_comp = field.get("input_component", "")
            if input_comp and input_comp != "none" and field.get("editable"):
                expected = _infer_input_component(fname, db_type_upper, field)
                if expected and expected != input_comp and input_comp not in ("Select",):
                    issues.append(
                        f"Entity '{ent_name}', field '{fname}': "
                        f"input_component '{input_comp}' may be wrong for db_type "
                        f"'{field.get('db_type')}' (expected '{expected}')"
                    )

            # Check visible_when references
            vw = field.get("visible_when")
            if vw and isinstance(vw, dict):
                ref_field = vw.get("field", "")
                if ref_field and ref_field not in field_names:
                    issues.append(
                        f"Entity '{ent_name}', field '{fname}': "
                        f"visible_when references unknown field '{ref_field}'"
                    )
                op = vw.get("operator", "")
                if op and op not in VALID_VISIBLE_WHEN_OPERATORS:
                    issues.append(
                        f"Entity '{ent_name}', field '{fname}': "
                        f"visible_when has invalid operator '{op}'"
                    )

            # Check validation rule
            val_rule = field.get("validation")
            if val_rule and isinstance(val_rule, dict):
                rule = val_rule.get("rule", "")
                if rule and rule not in VALID_VALIDATION_RULES:
                    issues.append(
                        f"Entity '{ent_name}', field '{fname}': "
                        f"validation has unknown rule '{rule}'"
                    )

    # Dashboard checks
    dashboard = spec.get("dashboard", {})
    if isinstance(dashboard, dict):
        if not dashboard.get("stat_cards"):
            issues.append("Dashboard has no stat_cards")

    # Design system checks
    ds = spec.get("design_system", {})
    if isinstance(ds, dict):
        for sub_key in ("colors", "spacing", "typography"):
            if sub_key not in ds:
                issues.append(f"Design system missing '{sub_key}'")

    return issues


def validate_and_repair(spec: dict) -> dict:
    """Validate a spec and auto-repair any issues. Returns the fixed spec."""
    spec = copy.deepcopy(spec)

    issues = get_validation_report(spec)
    if issues:
        logger.info(
            "Spec validator found %d issues — auto-repairing: %s",
            len(issues),
            "; ".join(issues[:10]),
        )

    # 1. Required top-level keys with defaults
    spec.setdefault("app_name", spec.get("_meta", {}).get("app_name", "My App"))
    if not isinstance(spec.get("entities"), list):
        spec["entities"] = []
    if not isinstance(spec.get("modules"), list):
        spec["modules"] = []
    if not isinstance(spec.get("dashboard"), dict):
        spec["dashboard"] = {}
    if not isinstance(spec.get("design_system"), dict):
        spec["design_system"] = {}
    if not isinstance(spec.get("pagination"), dict):
        spec["pagination"] = {"type": "cursor", "default_page_size": 25}

    # 12. Duplicate entity names — rename by appending number
    spec["entities"] = _fix_duplicate_entity_names(spec["entities"])

    # Build entity lookup table (for FK detection)
    entity_tables: dict[str, str] = {}  # table_name -> entity_name
    for ent in spec["entities"]:
        if isinstance(ent, dict) and ent.get("table") and ent.get("name"):
            entity_tables[ent["table"]] = ent["name"]

    # Process each entity
    for ent in spec["entities"]:
        if not isinstance(ent, dict):
            continue

        # 2. Entity validation — ensure name, table, fields, ui_config
        ent.setdefault("name", "UnnamedEntity")
        ent.setdefault("description", f"{ent['name']} management")

        # 5. Table name auto-generation
        if "table" not in ent or not ent["table"]:
            ent["table"] = _generate_table_name(ent["name"])

        if not isinstance(ent.get("fields"), list):
            ent["fields"] = []

        # 4. System fields — add missing ones
        _ensure_system_fields(ent)

        # 3. Field validation — ensure all 10 attributes
        for field in ent["fields"]:
            if not isinstance(field, dict):
                continue
            _ensure_field_attributes(field)

            # 8. Enum badge_colors
            _ensure_badge_colors(field)

            # 9. Input component inference
            _fix_input_component(field)

            # 10. Foreign key detection
            _detect_foreign_key(field, entity_tables)

            # 14. Validate visible_when references
            _validate_visible_when(field, ent)

            # 15. Auto-add validation rules to common fields
            _ensure_validation_rules(field)

            # 16. Ensure computed fields are not editable
            if field.get("computed"):
                field["editable"] = False

        # 7. UI config auto-generation
        if "ui_config" not in ent or not isinstance(ent.get("ui_config"), dict):
            ent["ui_config"] = _generate_ui_config(ent)
        else:
            # Ensure all four views exist
            ui = ent["ui_config"]
            if "list_view" not in ui or not isinstance(ui.get("list_view"), dict):
                ui["list_view"] = _generate_list_view(ent)
            if "create_form" not in ui or not isinstance(ui.get("create_form"), dict):
                ui["create_form"] = _generate_form(ent, prefilled=False)
            if "edit_form" not in ui or not isinstance(ui.get("edit_form"), dict):
                ui["edit_form"] = _generate_form(ent, prefilled=True)
            if "detail_view" not in ui or not isinstance(ui.get("detail_view"), dict):
                ui["detail_view"] = _generate_detail_view(ent)

    # 6. Module generation
    if not spec["modules"]:
        spec["modules"] = _generate_modules(spec["entities"])
    else:
        # Ensure Dashboard module exists
        has_dashboard = any(
            isinstance(m, dict) and m.get("name", "").lower() == "dashboard"
            for m in spec["modules"]
        )
        if not has_dashboard:
            spec["modules"].insert(0, {
                "name": "Dashboard",
                "route": "/",
                "component": "DashboardPage",
                "layout": "sidebar",
                "sidebar_order": 1,
                "sidebar_icon": "BarChart3",
                "entity": None,
            })

    # 11. Dashboard stat cards
    dashboard = spec["dashboard"]
    if not dashboard.get("stat_cards"):
        dashboard["stat_cards"] = _generate_stat_cards(spec["entities"])

    # 13. Design system defaults
    _ensure_design_system(spec)

    return spec


# ── Internal helpers ─────────────────────────────────────────────────

def _generate_table_name(entity_name: str) -> str:
    """Auto-generate table name from entity name: PascalCase -> snake_case_plural."""
    # Convert PascalCase/camelCase to snake_case
    name = re.sub(r"(?<!^)(?=[A-Z])", "_", entity_name).lower()
    # Replace spaces with underscores
    name = name.replace(" ", "_")
    # Remove non-alphanumeric (except underscores)
    name = re.sub(r"[^a-z0-9_]", "", name)
    # Simple pluralization
    if name.endswith("s") or name.endswith("x") or name.endswith("z"):
        name += "es"
    elif name.endswith("y") and len(name) > 1 and name[-2] not in "aeiou":
        name = name[:-1] + "ies"
    else:
        name += "s"
    return name


def _fix_duplicate_entity_names(entities: list) -> list:
    """Rename duplicate entity names by appending a number."""
    seen: dict[str, int] = {}
    result = []
    for ent in entities:
        if not isinstance(ent, dict):
            result.append(ent)
            continue
        name = ent.get("name", "UnnamedEntity")
        if name in seen:
            seen[name] += 1
            new_name = f"{name}{seen[name]}"
            logger.warning("Duplicate entity name '%s' renamed to '%s'", name, new_name)
            ent["name"] = new_name
            # Also fix table name if it was based on the old name
            if ent.get("table"):
                ent["table"] = _generate_table_name(new_name)
        else:
            seen[name] = 1
        result.append(ent)
    return result


def _ensure_system_fields(ent: dict) -> None:
    """Ensure entity has all required system fields."""
    field_names = {f.get("name") for f in ent["fields"] if isinstance(f, dict)}
    for sf_name, sf_def in SYSTEM_FIELDS.items():
        if sf_name not in field_names:
            sf_copy = dict(sf_def)
            if sf_name in ("id", "org_id"):
                ent["fields"].insert(0, sf_copy)
            else:
                ent["fields"].append(sf_copy)


def _ensure_field_attributes(field: dict) -> None:
    """Ensure a field has all 10 required attributes with smart defaults."""
    fname = field.get("name", "")
    db_type = field.get("db_type", "")
    db_upper = db_type.upper() if db_type else ""

    # name — should already exist
    field.setdefault("name", "unnamed_field")

    # db_type
    if not field.get("db_type"):
        # Infer from field name
        if fname in ("id", "org_id") or fname.endswith("_id"):
            field["db_type"] = "UUID"
        elif fname in ("created_at", "updated_at", "deleted_at"):
            field["db_type"] = "TIMESTAMPTZ"
        elif fname == "version":
            field["db_type"] = "INTEGER NOT NULL DEFAULT 1"
        elif any(kw in fname for kw in ("price", "cost", "amount", "total", "fee", "salary", "revenue")):
            field["db_type"] = "NUMERIC(12,2)"
        elif any(kw in fname for kw in ("count", "quantity", "age", "number")):
            field["db_type"] = "INTEGER"
        elif fname in ("is_active", "is_verified", "is_published", "enabled", "archived"):
            field["db_type"] = "BOOLEAN DEFAULT false"
        elif "date" in fname:
            field["db_type"] = "DATE"
        elif fname in ("description", "notes", "body", "content", "bio", "summary"):
            field["db_type"] = "TEXT"
        elif fname == "email":
            field["db_type"] = "VARCHAR(320)"
        elif fname == "phone":
            field["db_type"] = "VARCHAR(50)"
        else:
            field["db_type"] = "VARCHAR(255)"
        db_upper = field["db_type"].upper()

    # ts_type
    if "ts_type" not in field:
        field["ts_type"] = _infer_ts_type(db_upper)

    # nullable
    if "nullable" not in field:
        field["nullable"] = fname not in ("id", "org_id", "name", "title", "version")

    # editable
    if "editable" not in field:
        field["editable"] = fname not in (
            "id", "org_id", "created_at", "updated_at", "deleted_at", "version"
        )

    # show_in_table
    if "show_in_table" not in field:
        field["show_in_table"] = fname not in (
            "id", "org_id", "updated_at", "deleted_at", "version",
            "description", "notes", "body", "content", "bio",
        )

    # show_in_form
    if "show_in_form" not in field:
        field["show_in_form"] = fname not in (
            "id", "org_id", "created_at", "updated_at", "deleted_at", "version"
        )

    # input_component
    if "input_component" not in field:
        inferred = _infer_input_component(fname, db_upper, field)
        field["input_component"] = inferred or "TextInput"

    # display_component
    if "display_component" not in field:
        field["display_component"] = _infer_display_component(fname, db_upper, field)


def _infer_ts_type(db_upper: str) -> str:
    """Infer TypeScript type from db_type."""
    for pattern, ts in DB_TYPE_TO_TS.items():
        if pattern in db_upper:
            return ts
    return "string"


def _infer_input_component(name: str, db_upper: str, field: dict) -> str | None:
    """Infer the correct input component from field name and db_type."""
    # System fields
    if name in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
        return "none"

    # Enum fields
    if field.get("enum_values"):
        return "Select"

    # FK fields
    if name.endswith("_id") and name not in ("id", "org_id"):
        return "relation_select"

    # Name-based inference
    name_lower = name.lower()
    for pattern, inp, _ in NAME_TO_INPUT:
        if pattern in name_lower:
            return inp

    # db_type-based inference
    for pattern, inp in DB_TYPE_TO_INPUT:
        if pattern in db_upper:
            return inp

    return None


def _infer_display_component(name: str, db_upper: str, field: dict) -> str:
    """Infer the display component from field name and db_type."""
    if name in ("id", "org_id", "version"):
        return "Text"
    if field.get("enum_values"):
        return "Badge"
    if name.endswith("_id") and name not in ("id", "org_id"):
        return "relation_link"

    name_lower = name.lower()
    for pattern, _, disp in NAME_TO_INPUT:
        if pattern in name_lower:
            return disp

    if "TIMESTAMPTZ" in db_upper or "DATE" in db_upper:
        return "Date"
    if "NUMERIC" in db_upper or "DECIMAL" in db_upper:
        return "Currency"
    if "BOOLEAN" in db_upper:
        return "Text"

    return "Text"


def _ensure_badge_colors(field: dict) -> None:
    """If a field has enum_values but no badge_colors, auto-generate them."""
    enum_values = field.get("enum_values")
    if not enum_values or not isinstance(enum_values, list):
        return
    if field.get("badge_colors") and isinstance(field["badge_colors"], dict):
        # Check if all enum values have a color
        missing = [v for v in enum_values if v not in field["badge_colors"]]
        if not missing:
            return
        # Fill in missing ones
        fb_idx = 0
        for v in missing:
            v_lower = v.lower()
            if v_lower in STANDARD_BADGE_COLORS:
                field["badge_colors"][v] = STANDARD_BADGE_COLORS[v_lower]
            else:
                field["badge_colors"][v] = FALLBACK_BADGE_COLORS[fb_idx % len(FALLBACK_BADGE_COLORS)]
                fb_idx += 1
        return

    # Generate from scratch
    colors: dict[str, str] = {}
    fb_idx = 0
    for v in enum_values:
        v_lower = v.lower()
        if v_lower in STANDARD_BADGE_COLORS:
            colors[v] = STANDARD_BADGE_COLORS[v_lower]
        else:
            colors[v] = FALLBACK_BADGE_COLORS[fb_idx % len(FALLBACK_BADGE_COLORS)]
            fb_idx += 1
    field["badge_colors"] = colors


def _fix_input_component(field: dict) -> None:
    """Fix input_component if it's wrong for the db_type."""
    if not field.get("editable"):
        return
    name = field.get("name", "")
    if name in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
        return
    # Don't override Select for enum fields
    if field.get("enum_values"):
        if field.get("input_component") not in ("Select", "relation_select"):
            field["input_component"] = "Select"
        return

    db_upper = (field.get("db_type") or "").upper()
    current = field.get("input_component", "")

    # Check for obvious mismatches
    if "BOOLEAN" in db_upper and current not in ("Toggle", "checkbox"):
        field["input_component"] = "Toggle"
    elif "DATE" in db_upper and "TIMESTAMP" not in db_upper and current not in ("DatePicker", "date_input"):
        field["input_component"] = "DatePicker"
    elif db_upper.startswith("TEXT") and current not in ("TextArea", "textarea"):
        # Only fix if it's a plain TEXT type (not if it happens to contain TEXT in VARCHAR etc.)
        field["input_component"] = "TextArea"


def _detect_foreign_key(field: dict, entity_tables: dict[str, str]) -> None:
    """If a field name ends in '_id' and matches an entity table, add fk_entity."""
    name = field.get("name", "")
    if not name.endswith("_id") or name in ("id", "org_id"):
        return
    if field.get("fk_entity"):
        return  # Already set

    # Extract the potential table name: "customer_id" -> "customers"
    base = name[:-3]  # Remove "_id"
    potential_tables = [
        base + "s",           # customer -> customers
        base + "es",          # address -> addresses
        base,                 # (exact match)
    ]
    # Handle "_ies" pluralization: category -> categories
    if base.endswith("y"):
        potential_tables.append(base[:-1] + "ies")

    for table_name in potential_tables:
        if table_name in entity_tables:
            field["fk_entity"] = entity_tables[table_name]
            # Fix input/display components for FK fields
            if field.get("input_component") in ("TextInput", "none"):
                field["input_component"] = "relation_select"
            if field.get("display_component") in ("Text", "none"):
                field["display_component"] = "relation_link"
            # Ensure db_type references the table
            db_type = field.get("db_type", "")
            if "REFERENCES" not in db_type.upper():
                field["db_type"] = f"UUID REFERENCES {table_name}(id)"
            break


def _generate_ui_config(ent: dict) -> dict:
    """Generate complete ui_config from entity fields."""
    return {
        "list_view": _generate_list_view(ent),
        "create_form": _generate_form(ent, prefilled=False),
        "edit_form": _generate_form(ent, prefilled=True),
        "detail_view": _generate_detail_view(ent),
    }


def _generate_list_view(ent: dict) -> dict:
    """Generate list_view config."""
    fields = ent.get("fields", [])
    table_cols = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("show_in_table")
    ][:6]
    filter_fields = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("enum_values")
    ]
    name = ent.get("name", "Item")
    table = ent.get("table", "items")

    return {
        "layout": "table",
        "columns": table_cols,
        "filters": filter_fields,
        "empty_state": {
            "icon": "Box",
            "heading": f"No {table.replace('_', ' ')} yet",
            "subtext": f"Create your first {name.lower()}",
            "action_label": f"Add {name}",
        },
    }


def _generate_form(ent: dict, prefilled: bool = False) -> dict:
    """Generate create_form or edit_form config."""
    fields = ent.get("fields", [])
    form_fields = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("show_in_form")
    ]
    required = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("show_in_form") and not f.get("nullable")
        and f.get("name") not in ("id", "org_id", "version")
    ]
    config: dict[str, Any] = {
        "type": "SlideOverForm",
        "field_order": form_fields,
        "required_fields": required or form_fields[:1],
    }
    if prefilled:
        config["prefilled"] = True
    return config


def _generate_detail_view(ent: dict) -> dict:
    """Generate detail_view config."""
    fields = ent.get("fields", [])
    table = ent.get("table", "items")
    table_cols = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("show_in_table")
    ]
    badge_fields = [
        f["name"] for f in fields
        if isinstance(f, dict) and f.get("enum_values")
    ][:2]
    all_business = [
        f["name"] for f in fields
        if isinstance(f, dict)
        and f.get("name") not in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version")
    ]

    return {
        "route": f"/{table}/:id",
        "layout": "tabbed",
        "header": {
            "title_fields": table_cols[:1],
            "badge_fields": badge_fields,
            "meta_fields": ["created_at"],
        },
        "primary_fields": table_cols[:5],
        "tabs": [
            {"name": "Overview", "fields": all_business},
        ],
    }


def _generate_modules(entities: list) -> list[dict]:
    """Generate modules from entities (Dashboard + one per entity)."""
    modules = [{
        "name": "Dashboard",
        "route": "/",
        "component": "DashboardPage",
        "layout": "sidebar",
        "sidebar_order": 1,
        "sidebar_icon": "BarChart3",
        "entity": None,
    }]

    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Module")
        table = ent.get("table", name.lower() + "s")
        icon = ICON_MAP.get(name.lower(), "Box")
        module_name = f"{name}s" if not name.endswith("s") else name
        modules.append({
            "name": module_name,
            "route": f"/{table}",
            "component": "ResourcePage",
            "layout": "sidebar",
            "sidebar_order": i + 2,
            "sidebar_icon": icon,
            "entity": name,
        })

    return modules


def _generate_stat_cards(entities: list) -> list[dict]:
    """Generate one stat card per entity."""
    cards = []
    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Item")
        label = f"Total {name}s" if not name.endswith("s") else f"Total {name}"
        cards.append({
            "label": label,
            "entity": name,
            "aggregate": "count",
            "icon": ICON_MAP.get(name.lower(), "Box"),
            "color": STAT_CARD_COLORS[i % len(STAT_CARD_COLORS)],
        })
    return cards[:6]


def _ensure_design_system(spec: dict) -> None:
    """Fill in design system defaults for missing sub-keys."""
    ds = spec["design_system"]
    for key, default_val in DEFAULT_DESIGN_SYSTEM.items():
        if key not in ds or not isinstance(ds[key], dict):
            ds[key] = dict(default_val)
        else:
            # Fill in missing sub-keys within each section
            for sub_key, sub_val in default_val.items():
                ds[key].setdefault(sub_key, sub_val)


def _validate_visible_when(field: dict, entity: dict) -> None:
    """Validate visible_when references — fix invalid operator, remove if field doesn't exist."""
    vw = field.get("visible_when")
    if not vw or not isinstance(vw, dict):
        return

    field_names = {f.get("name") for f in entity.get("fields", []) if isinstance(f, dict)}
    ref_field = vw.get("field", "")

    # If the referenced field doesn't exist in this entity, remove the rule
    if ref_field and ref_field not in field_names:
        logger.warning(
            "visible_when on '%s' references unknown field '%s' — removing rule",
            field.get("name", ""), ref_field,
        )
        del field["visible_when"]
        return

    # Fix invalid operator
    op = vw.get("operator", "")
    if op and op not in VALID_VISIBLE_WHEN_OPERATORS:
        logger.warning(
            "visible_when on '%s' has invalid operator '%s' — defaulting to 'eq'",
            field.get("name", ""), op,
        )
        vw["operator"] = "eq"


def _ensure_validation_rules(field: dict) -> None:
    """Auto-add validation rules to common fields if not already present."""
    if field.get("validation"):
        return  # Already has a validation rule

    fname = field.get("name", "")
    db_type = (field.get("db_type") or "").upper()

    # Don't add validation to system fields
    if fname in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
        return

    # Fields named "email" get email validation
    if fname == "email" or fname.endswith("_email"):
        field["validation"] = {
            "rule": "email",
            "message": "Please enter a valid email address",
        }
        return

    # Fields named "phone" get pattern validation
    if fname == "phone" or fname.endswith("_phone"):
        field["validation"] = {
            "rule": "pattern",
            "value": "^[+]?[0-9\\s\\-().]{7,20}$",
            "message": "Please enter a valid phone number",
        }
        return

    # Fields with NOT NULL in db_type that are editable get required validation
    if "NOT NULL" in db_type and field.get("editable") and not field.get("nullable"):
        # Don't add required if there's already a DEFAULT
        if "DEFAULT" not in db_type:
            field["validation"] = {
                "rule": "required",
                "message": f"{fname.replace('_', ' ').title()} is required",
            }
            return

    # Numeric price/amount fields get min: 0 validation
    if ("NUMERIC" in db_type or "DECIMAL" in db_type or "INTEGER" in db_type):
        if any(kw in fname for kw in ("price", "amount", "cost", "fee", "total", "revenue", "salary")):
            field["validation"] = {
                "rule": "min",
                "value": 0,
                "message": f"{fname.replace('_', ' ').title()} must be a positive value",
            }
            return
