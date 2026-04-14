"""Comprehensive spec validator tests — 8 tests covering defaults, auto-repair, FK detection, and validation reports."""
from generator.spec_validator import validate_and_repair, get_validation_report


def test_empty_spec_gets_defaults():
    """An empty spec should get all required top-level keys populated."""
    spec = {}
    fixed = validate_and_repair(spec)
    assert "app_name" in fixed
    assert "entities" in fixed
    assert "modules" in fixed
    assert "design_system" in fixed
    assert "dashboard" in fixed
    assert "pagination" in fixed


def test_entity_without_fields_gets_system_fields():
    """An entity with no fields should still get id, org_id, created_at, etc."""
    spec = {"entities": [{"name": "Widget", "fields": []}]}
    fixed = validate_and_repair(spec)
    field_names = [f["name"] for f in fixed["entities"][0]["fields"]]
    assert "id" in field_names
    assert "org_id" in field_names
    assert "created_at" in field_names
    assert "updated_at" in field_names
    assert "deleted_at" in field_names
    assert "version" in field_names


def test_missing_ui_config_auto_generated():
    """A spec with entities but no design_system should get default design_system."""
    spec = {
        "entities": [{"name": "Task", "fields": [{"name": "title", "db_type": "VARCHAR(255)"}]}],
    }
    fixed = validate_and_repair(spec)
    assert "design_system" in fixed
    ds = fixed["design_system"]
    assert "colors" in ds
    assert "primary" in ds["colors"]


def test_missing_modules_auto_generated():
    """A spec with entities but no modules should auto-generate modules (Dashboard + one per entity)."""
    spec = {
        "entities": [
            {"name": "Invoice", "fields": [{"name": "amount", "db_type": "NUMERIC(10,2)"}]},
            {"name": "Client", "fields": [{"name": "name", "db_type": "VARCHAR(255)"}]},
        ],
    }
    fixed = validate_and_repair(spec)
    assert "modules" in fixed
    module_names = [m["name"] for m in fixed["modules"]]
    assert "Dashboard" in module_names
    # Should have modules for each entity
    assert len(fixed["modules"]) >= 3  # Dashboard + Invoice + Client


def test_enum_without_badges_gets_colors():
    """A field with enum_values but no badge_colors should get auto-assigned colors."""
    spec = {"entities": [{"name": "Order", "fields": [
        {"name": "status", "db_type": "VARCHAR(50)", "enum_values": ["pending", "shipped", "delivered"]}
    ]}]}
    fixed = validate_and_repair(spec)
    status = next(f for f in fixed["entities"][0]["fields"] if f["name"] == "status")
    assert "badge_colors" in status
    assert "pending" in status["badge_colors"]
    assert "shipped" in status["badge_colors"]
    assert "delivered" in status["badge_colors"]


def test_fk_detection_between_entities():
    """A field named 'customer_id' should auto-detect FK relationship to Customer entity."""
    spec = {"entities": [
        {"name": "Customer", "table": "customers", "fields": [
            {"name": "name", "db_type": "VARCHAR(255)"},
        ]},
        {"name": "Order", "table": "orders", "fields": [
            {"name": "customer_id", "db_type": "UUID"},
        ]},
    ]}
    fixed = validate_and_repair(spec)
    order_entity = next(e for e in fixed["entities"] if e["name"] == "Order")
    customer_id_field = next(f for f in order_entity["fields"] if f["name"] == "customer_id")
    assert customer_id_field.get("fk_entity") == "Customer"


def test_reserved_table_names_prefixed():
    """Entities with PostgreSQL reserved table names should get prefixed."""
    spec = {"entities": [{"name": "User", "table": "users", "fields": []}]}
    fixed = validate_and_repair(spec)
    table_name = fixed["entities"][0]["table"]
    assert table_name != "users"  # Should be prefixed (e.g., app_users)


def test_validation_report_lists_issues():
    """get_validation_report should list specific issues for an incomplete spec."""
    spec = {"entities": [{"name": "Test"}]}
    issues = get_validation_report(spec)
    assert len(issues) > 0
    # Should flag missing top-level keys
    issue_text = " ".join(issues)
    assert "modules" in issue_text.lower() or "missing" in issue_text.lower()
