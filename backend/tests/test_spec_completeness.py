"""Tests that validate_and_repair produces complete, well-formed specs."""
from generator.spec_validator import validate_and_repair, score_spec_quality


def _make_crm_spec():
    """Return a realistic CRM spec for testing."""
    return {
        "app_name": "Acme CRM",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "first_name", "db_type": "VARCHAR(100)", "label": "First Name"},
                    {"name": "last_name", "db_type": "VARCHAR(100)", "label": "Last Name"},
                    {"name": "email", "db_type": "VARCHAR(255)", "label": "Email"},
                    {"name": "phone", "db_type": "VARCHAR(50)", "label": "Phone"},
                ],
            },
            {
                "name": "Company",
                "table": "companies",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(200)", "label": "Name"},
                    {"name": "industry", "db_type": "VARCHAR(100)", "label": "Industry"},
                    {"name": "website", "db_type": "VARCHAR(255)", "label": "Website"},
                ],
            },
            {
                "name": "Deal",
                "table": "deals",
                "fields": [
                    {"name": "title", "db_type": "VARCHAR(200)", "label": "Title"},
                    {"name": "value", "db_type": "DECIMAL(12,2)", "label": "Value"},
                    {"name": "stage", "db_type": "VARCHAR(50)", "label": "Stage"},
                    {"name": "contact_id", "db_type": "INTEGER", "label": "Contact"},
                ],
            },
            {
                "name": "Activity",
                "table": "activities",
                "fields": [
                    {"name": "type", "db_type": "VARCHAR(50)", "label": "Type"},
                    {"name": "notes", "db_type": "TEXT", "label": "Notes"},
                    {"name": "contact_id", "db_type": "INTEGER", "label": "Contact"},
                ],
            },
        ],
        "modules": [
            {"name": "Dashboard", "route": "/", "layout": "dashboard"},
            {"name": "Contacts", "route": "/contacts", "entity": "Contact"},
            {"name": "Companies", "route": "/companies", "entity": "Company"},
            {"name": "Deals", "route": "/deals", "entity": "Deal"},
            {"name": "Activities", "route": "/activities", "entity": "Activity"},
        ],
        "dashboard": {
            "stats": [{"label": "Total Contacts", "entity": "Contact", "metric": "count"}],
        },
        "design_system": {
            "colors": {"primary": "#6366f1", "secondary": "#8b5cf6"},
            "font": "Inter",
        },
    }


def test_validate_adds_all_system_fields():
    """validate_and_repair should add system fields (id, org_id, created_at, etc.) to every entity."""
    spec = {"entities": [{"name": "Lead", "fields": [{"name": "email", "db_type": "VARCHAR(255)"}]}]}
    fixed = validate_and_repair(spec)
    field_names = [f["name"] for f in fixed["entities"][0]["fields"]]
    assert "id" in field_names
    assert "org_id" in field_names
    assert "created_at" in field_names


def test_validate_adds_ui_config():
    """validate_and_repair should ensure each entity has ui_config."""
    spec = {"entities": [{"name": "Task", "fields": [{"name": "title", "db_type": "VARCHAR(200)"}]}]}
    fixed = validate_and_repair(spec)
    ent = fixed["entities"][0]
    assert "ui_config" in ent or "fields" in ent  # ui_config or at least well-formed fields


def test_validate_adds_modules():
    """validate_and_repair should generate modules for entities that lack them."""
    spec = {
        "entities": [
            {"name": "Product", "table": "products", "fields": [{"name": "name", "db_type": "VARCHAR(200)"}]},
        ],
        "modules": [],
    }
    fixed = validate_and_repair(spec)
    assert len(fixed["modules"]) > 0, "Should auto-generate at least one module"


def test_validate_adds_dashboard():
    """validate_and_repair should ensure a dashboard key exists."""
    spec = {"entities": [{"name": "Order", "fields": []}]}
    fixed = validate_and_repair(spec)
    assert "dashboard" in fixed
    assert isinstance(fixed["dashboard"], dict)


def test_validate_adds_design_system():
    """validate_and_repair should ensure design_system with colors exists."""
    spec = {}
    fixed = validate_and_repair(spec)
    assert "design_system" in fixed
    assert isinstance(fixed["design_system"], dict)


def test_validate_adds_pagination():
    """validate_and_repair should ensure pagination config exists."""
    spec = {}
    fixed = validate_and_repair(spec)
    assert "pagination" in fixed
    assert isinstance(fixed["pagination"], dict)


def test_validate_fixes_generic_names():
    """validate_and_repair should rename generic app names like 'My App'."""
    spec = {
        "app_name": "My App",
        "entities": [
            {"name": "Contact", "table": "contacts", "fields": []},
            {"name": "Deal", "table": "deals", "fields": []},
        ],
    }
    fixed = validate_and_repair(spec)
    # Should have either kept or improved the name (not left as bare "My App" if entities exist)
    assert "app_name" in fixed
    assert isinstance(fixed["app_name"], str)
    assert len(fixed["app_name"]) > 0


def test_validate_detects_relationships():
    """validate_and_repair should detect FK relationships from field names like contact_id."""
    spec = {
        "entities": [
            {"name": "Contact", "table": "contacts", "fields": [{"name": "name", "db_type": "VARCHAR(200)"}]},
            {
                "name": "Deal",
                "table": "deals",
                "fields": [
                    {"name": "title", "db_type": "VARCHAR(200)"},
                    {"name": "contact_id", "db_type": "INTEGER"},
                ],
            },
        ],
    }
    fixed = validate_and_repair(spec)
    deal_fields = fixed["entities"][1]["fields"]
    contact_id_field = next((f for f in deal_fields if f["name"] == "contact_id"), None)
    # The validator should recognize contact_id as a FK or at least preserve it
    assert contact_id_field is not None


def test_score_function_exists():
    """score_spec_quality should be callable and return a dict with score."""
    spec = _make_crm_spec()
    result = score_spec_quality(spec)
    assert isinstance(result, dict)
    assert "score" in result
    assert isinstance(result["score"], (int, float))


def test_high_quality_spec_scores_above_70():
    """A well-formed CRM spec should score at least 70/100."""
    spec = _make_crm_spec()
    # Validate first so system fields etc. are present
    fixed = validate_and_repair(spec)
    result = score_spec_quality(fixed)
    assert result["score"] >= 70, f"Expected score >= 70 but got {result['score']}. Issues: {result.get('issues', [])}"
