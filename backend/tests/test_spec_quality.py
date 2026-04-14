"""Tests for spec_validator quality functions: entity renaming, relationship detection, dashboard cards, scoring."""
from generator.spec_validator import (
    validate_and_repair,
    get_validation_report,
    ICON_MAP,
    _fix_generic_entity_names,
    _auto_detect_relationships,
    _generate_stat_cards,
    _remove_duplicate_fields,
    _ensure_minimum_custom_fields,
    _ensure_badge_colors,
    RESERVED_TABLE_NAMES,
)
import copy


def test_fix_generic_entity_names():
    """Generic entity name 'Item' should become 'MenuItem' for a restaurant app."""
    spec = {
        "app_name": "Restaurant Manager",
        "entities": [
            {"name": "Item", "table": "items", "fields": []},
        ],
    }
    _fix_generic_entity_names(spec)
    assert spec["entities"][0]["name"] == "MenuItem"
    assert spec["entities"][0]["table"] == "menu_items"


def test_auto_detect_relationships():
    """A field 'customer_name' should trigger auto-detection of customer_id FK."""
    spec = {
        "entities": [
            {
                "name": "Customer",
                "table": "customers",
                "fields": [
                    {"name": "id", "db_type": "UUID"},
                    {"name": "org_id", "db_type": "UUID"},
                    {"name": "name", "db_type": "VARCHAR(255)"},
                ],
            },
            {
                "name": "Order",
                "table": "orders",
                "fields": [
                    {"name": "id", "db_type": "UUID"},
                    {"name": "org_id", "db_type": "UUID"},
                    {"name": "customer_name", "db_type": "VARCHAR(255)"},
                ],
            },
        ],
    }
    _auto_detect_relationships(spec)
    order = next(e for e in spec["entities"] if e["name"] == "Order")
    field_names = [f["name"] for f in order["fields"]]
    assert "customer_id" in field_names
    customer_id_field = next(f for f in order["fields"] if f["name"] == "customer_id")
    assert customer_id_field["fk_entity"] == "Customer"


def test_generate_smart_dashboard_cards():
    """Dashboard card generation should produce at least 4 cards for a spec with entities."""
    entities = [
        {
            "name": "Lead",
            "fields": [
                {"name": "id", "db_type": "UUID"},
                {"name": "name", "db_type": "VARCHAR(255)"},
                {"name": "value", "db_type": "NUMERIC(10,2)"},
                {"name": "status", "db_type": "VARCHAR(50)",
                 "enum_values": ["new", "contacted", "qualified"]},
                {"name": "created_at", "db_type": "TIMESTAMPTZ"},
            ],
        },
        {
            "name": "Deal",
            "fields": [
                {"name": "id", "db_type": "UUID"},
                {"name": "title", "db_type": "VARCHAR(255)"},
                {"name": "amount", "db_type": "NUMERIC(12,2)"},
                {"name": "created_at", "db_type": "TIMESTAMPTZ"},
            ],
        },
    ]
    cards = _generate_stat_cards(entities)
    assert len(cards) >= 4, f"Expected at least 4 cards, got {len(cards)}"
    labels = [c["label"] for c in cards]
    # Should have count cards for both entities
    assert any("Lead" in l for l in labels)
    assert any("Deal" in l for l in labels)


def test_icon_map_has_130_entries():
    """ICON_MAP should have at least 130 entries for comprehensive icon coverage."""
    assert len(ICON_MAP) >= 130, f"ICON_MAP has only {len(ICON_MAP)} entries, expected 130+"


def test_score_spec_quality_high():
    """A well-formed spec should score > 70 via validation report (fewer issues = higher quality)."""
    spec = {
        "app_name": "Sales CRM",
        "entities": [
            {
                "name": "Lead",
                "table": "leads",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255)"},
                    {"name": "email", "db_type": "VARCHAR(255)"},
                ],
            },
        ],
        "modules": [{"name": "Dashboard", "route": "/dashboard"}],
        "dashboard": {"stat_cards": [{"label": "Total Leads"}]},
        "design_system": {"colors": {"primary": "#2563eb"}, "spacing": {}, "typography": {}},
        "pagination": {"page_size": 25},
    }
    # Validate and repair fills in everything needed
    fixed = validate_and_repair(spec)
    issues = get_validation_report(fixed)
    # A repaired spec should have very few remaining issues
    # "High quality" = fewer than 30% of possible issues
    assert len(issues) < 15, f"Repaired spec still has {len(issues)} issues: {issues[:5]}"


def test_score_spec_quality_low():
    """A completely empty spec should have many validation issues (low quality)."""
    spec = {}
    issues = get_validation_report(spec)
    # Empty spec should flag at least 6 missing top-level keys + no entities + no modules
    assert len(issues) >= 6, f"Empty spec only flagged {len(issues)} issues"


def test_validate_removes_duplicate_fields():
    """Duplicate field names in an entity should be deduplicated."""
    ent = {
        "name": "Task",
        "fields": [
            {"name": "id", "db_type": "UUID"},
            {"name": "title", "db_type": "VARCHAR(255)"},
            {"name": "title", "db_type": "TEXT"},  # duplicate
            {"name": "status", "db_type": "VARCHAR(50)"},
        ],
    }
    _remove_duplicate_fields(ent)
    field_names = [f["name"] for f in ent["fields"]]
    assert field_names.count("title") == 1
    assert len(ent["fields"]) == 3


def test_validate_adds_minimum_custom_fields():
    """An entity with only system fields should get a 'name' field added."""
    ent = {
        "name": "Widget",
        "fields": [
            {"name": "id", "db_type": "UUID"},
            {"name": "org_id", "db_type": "UUID"},
            {"name": "created_at", "db_type": "TIMESTAMPTZ"},
            {"name": "updated_at", "db_type": "TIMESTAMPTZ"},
            {"name": "deleted_at", "db_type": "TIMESTAMPTZ"},
            {"name": "version", "db_type": "INTEGER"},
        ],
    }
    _ensure_minimum_custom_fields(ent)
    field_names = [f["name"] for f in ent["fields"]]
    assert "name" in field_names


def test_validate_fixes_reserved_table_names():
    """Entities with reserved table names like 'users' should get prefixed."""
    spec = {"entities": [{"name": "User", "table": "users", "fields": []}]}
    fixed = validate_and_repair(spec)
    table = fixed["entities"][0]["table"]
    assert table != "users", f"Reserved table name 'users' was not fixed (got '{table}')"


def test_validate_adds_enum_badge_colors():
    """Enum fields without badge_colors should get auto-assigned colors."""
    field = {
        "name": "status",
        "db_type": "VARCHAR(50)",
        "enum_values": ["active", "pending", "closed"],
    }
    _ensure_badge_colors(field)
    assert "badge_colors" in field
    assert "active" in field["badge_colors"]
    assert field["badge_colors"]["active"] == "green"
    assert field["badge_colors"]["pending"] == "amber"
