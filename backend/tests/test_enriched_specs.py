"""Tests for spec enrichment quality — verify that validate_and_repair
produces specs with correct structure for different domains."""
import copy
import pytest
from generator.spec_validator import validate_and_repair


def _make_entity(name, table, fields=None):
    """Helper to create a minimal entity dict."""
    return {
        "name": name,
        "table": table,
        "description": f"{name} management",
        "fields": fields or [
            {"name": "title", "db_type": "VARCHAR(255)", "ts_type": "string",
             "nullable": False, "editable": True, "show_in_table": True,
             "show_in_form": True, "input_component": "TextInput",
             "display_component": "Text"},
        ],
    }


def _make_spec(app_name, entities, modules=None):
    """Helper to create a minimal spec dict."""
    return {
        "app_name": app_name,
        "entities": entities,
        "modules": modules or [],
        "dashboard": {},
        "design_system": {},
        "pagination": {"type": "cursor", "default_page_size": 25},
    }


# ── CRM Spec Tests ──────────────────────────────────────────────────

CRM_SPEC = _make_spec("Sales CRM", [
    _make_entity("Lead", "leads", [
        {"name": "name", "db_type": "VARCHAR(255)", "ts_type": "string",
         "nullable": False, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "TextInput",
         "display_component": "Text"},
        {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string",
         "nullable": False, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "Select",
         "display_component": "Badge",
         "enum_values": ["new", "contacted", "qualified", "lost"],
         "badge_colors": {"new": "blue", "contacted": "amber",
                         "qualified": "green", "lost": "red"}},
    ]),
    _make_entity("Contact", "contacts"),
    _make_entity("Deal", "deals"),
])


def test_crm_spec_has_views():
    """CRM spec enrichment should produce ui_config with all 4 views."""
    repaired = validate_and_repair(copy.deepcopy(CRM_SPEC))
    for ent in repaired["entities"]:
        ui = ent.get("ui_config", {})
        assert "list_view" in ui, f"Entity '{ent['name']}' missing list_view"
        assert "create_form" in ui, f"Entity '{ent['name']}' missing create_form"
        assert "edit_form" in ui, f"Entity '{ent['name']}' missing edit_form"
        assert "detail_view" in ui, f"Entity '{ent['name']}' missing detail_view"


def test_crm_spec_has_quick_filters():
    """CRM spec should get list_view with filters for enum fields."""
    repaired = validate_and_repair(copy.deepcopy(CRM_SPEC))
    lead = next(e for e in repaired["entities"] if e["name"] == "Lead")
    list_view = lead["ui_config"]["list_view"]
    # list_view should have a filters array
    assert "filters" in list_view, "Lead list_view should have filters"


def test_crm_spec_has_searchable_fields():
    """CRM spec should have columns defined in list_view."""
    repaired = validate_and_repair(copy.deepcopy(CRM_SPEC))
    lead = next(e for e in repaired["entities"] if e["name"] == "Lead")
    list_view = lead["ui_config"]["list_view"]
    assert "columns" in list_view, "Lead list_view should have columns"
    assert len(list_view["columns"]) > 0, "Lead list_view should have at least one column"


def test_crm_spec_has_row_actions():
    """CRM spec create_form should have field_order."""
    repaired = validate_and_repair(copy.deepcopy(CRM_SPEC))
    lead = next(e for e in repaired["entities"] if e["name"] == "Lead")
    create_form = lead["ui_config"]["create_form"]
    assert "field_order" in create_form, "Lead create_form should have field_order"


# ── Restaurant Spec Tests ───────────────────────────────────────────

RESTAURANT_SPEC = _make_spec("Restaurant Manager", [
    _make_entity("MenuItem", "menu_items"),
    _make_entity("Order", "app_orders"),
    _make_entity("Reservation", "reservations"),
])


def test_restaurant_spec_has_dashboard_cards():
    """Restaurant spec should get auto-generated dashboard stat_cards."""
    repaired = validate_and_repair(copy.deepcopy(RESTAURANT_SPEC))
    stat_cards = repaired.get("dashboard", {}).get("stat_cards", [])
    assert len(stat_cards) >= 1, \
        f"Expected at least 1 dashboard stat card, got {len(stat_cards)}"


# ── Gym Spec Tests ──────────────────────────────────────────────────

GYM_SPEC = _make_spec("Fitness Tracker", [
    _make_entity("Member", "members", [
        {"name": "name", "db_type": "VARCHAR(255)", "ts_type": "string",
         "nullable": False, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "TextInput",
         "display_component": "Text"},
        {"name": "tier", "db_type": "VARCHAR(50)", "ts_type": "string",
         "nullable": False, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "Select",
         "display_component": "Badge",
         "enum_values": ["basic", "premium", "vip"]},
    ]),
    _make_entity("Workout", "workouts"),
])


def test_gym_spec_has_badge_colors():
    """Gym spec should auto-generate badge_colors for enum fields."""
    repaired = validate_and_repair(copy.deepcopy(GYM_SPEC))
    member = next(e for e in repaired["entities"] if e["name"] == "Member")
    tier_field = next(f for f in member["fields"] if f.get("name") == "tier")
    assert "badge_colors" in tier_field, "Tier field should have badge_colors"
    assert isinstance(tier_field["badge_colors"], dict), "badge_colors should be a dict"
    assert len(tier_field["badge_colors"]) == 3, \
        f"Expected 3 badge colors, got {len(tier_field['badge_colors'])}"


# ── Ecommerce Spec Tests ────────────────────────────────────────────

ECOMMERCE_SPEC = _make_spec("Online Store", [
    _make_entity("Product", "products"),
    _make_entity("Category", "categories"),
    _make_entity("OrderItem", "order_items", [
        {"name": "product_id", "db_type": "UUID REFERENCES products(id)",
         "ts_type": "string", "nullable": False, "editable": True,
         "show_in_table": True, "show_in_form": True,
         "input_component": "relation_select", "display_component": "relation_link",
         "fk_entity": "Product"},
        {"name": "quantity", "db_type": "INTEGER NOT NULL DEFAULT 1",
         "ts_type": "number", "nullable": False, "editable": True,
         "show_in_table": True, "show_in_form": True,
         "input_component": "NumberInput", "display_component": "Text"},
    ]),
])


def test_ecommerce_spec_has_fk_relationships():
    """Ecommerce spec should preserve FK relationships between entities."""
    repaired = validate_and_repair(copy.deepcopy(ECOMMERCE_SPEC))
    order_item = next(e for e in repaired["entities"] if e["name"] == "OrderItem")
    fk_fields = [f for f in order_item["fields"]
                 if isinstance(f, dict) and f.get("fk_entity")]
    assert len(fk_fields) >= 1, "OrderItem should have at least one FK field"
    assert fk_fields[0]["fk_entity"] == "Product", \
        f"FK should reference Product, got {fk_fields[0]['fk_entity']}"


# ── Healthcare Spec Tests ───────────────────────────────────────────

HEALTHCARE_SPEC = _make_spec("Clinic Manager", [
    _make_entity("Patient", "patients", [
        {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string",
         "nullable": False, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "TextInput",
         "display_component": "Text"},
        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string",
         "nullable": True, "editable": True, "show_in_table": True,
         "show_in_form": True, "input_component": "EmailInput",
         "display_component": "Email",
         "validation": {"rule": "email", "message": "Invalid email"}},
    ]),
])


def test_healthcare_spec_has_validation():
    """Healthcare spec should preserve validation rules on fields."""
    repaired = validate_and_repair(copy.deepcopy(HEALTHCARE_SPEC))
    patient = next(e for e in repaired["entities"] if e["name"] == "Patient")
    email_field = next(f for f in patient["fields"] if f.get("name") == "email")
    assert "validation" in email_field, "Email field should have validation rule"
    assert email_field["validation"]["rule"] == "email", \
        f"Expected 'email' validation rule, got {email_field['validation']['rule']}"


# ── Cross-domain structure tests ────────────────────────────────────

def test_all_specs_have_entities_array():
    """All enriched specs must have an 'entities' array."""
    for spec_input in [CRM_SPEC, RESTAURANT_SPEC, GYM_SPEC, ECOMMERCE_SPEC, HEALTHCARE_SPEC]:
        repaired = validate_and_repair(copy.deepcopy(spec_input))
        assert "entities" in repaired, "Spec missing 'entities' key"
        assert isinstance(repaired["entities"], list), "'entities' should be a list"
        assert len(repaired["entities"]) > 0, "'entities' should not be empty"


def test_all_specs_have_modules_array():
    """All enriched specs must have a 'modules' array with Dashboard."""
    for spec_input in [CRM_SPEC, RESTAURANT_SPEC, GYM_SPEC, ECOMMERCE_SPEC, HEALTHCARE_SPEC]:
        repaired = validate_and_repair(copy.deepcopy(spec_input))
        assert "modules" in repaired, "Spec missing 'modules' key"
        assert isinstance(repaired["modules"], list), "'modules' should be a list"
        assert len(repaired["modules"]) > 0, "'modules' should not be empty"
        # Dashboard module should always exist
        module_names = [m.get("name", "").lower() for m in repaired["modules"]]
        assert "dashboard" in module_names, "Dashboard module should always be present"
