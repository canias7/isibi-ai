"""E2E-style tests for the full spec generation -> validation -> build pipeline."""
import pytest
from generator.spec_validator import validate_and_repair
from generator.builder import build_backend
from generator.frontend_builder import build_frontend
from generator.deployer import generate_full_app_html


# ── Shared fixtures ──────────────────────────────────────────────────


def _minimal_spec(entities=None):
    """Return a minimal spec with optional entity overrides."""
    return {
        "app_name": "TestPipelineApp",
        "entities": entities or [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255) NOT NULL"},
                    {"name": "email", "db_type": "VARCHAR(320) NOT NULL"},
                ],
            }
        ],
        "modules": [],
        "dashboard": {},
        "design_system": {"colors": {"primary": "#ec4899"}},
    }


def _two_entity_spec():
    """Spec with two entities that can have FK relations."""
    return {
        "app_name": "CRM",
        "entities": [
            {
                "name": "Company",
                "table": "companies",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255) NOT NULL"},
                    {"name": "industry", "db_type": "VARCHAR(100)"},
                ],
            },
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255) NOT NULL"},
                    {"name": "company_id", "db_type": "UUID"},
                ],
            },
        ],
        "modules": [],
        "dashboard": {},
        "design_system": {"colors": {"primary": "#ec4899"}},
    }


def _enum_spec():
    """Spec with a field that has enum_values."""
    return {
        "app_name": "Tracker",
        "entities": [
            {
                "name": "Task",
                "table": "tasks",
                "fields": [
                    {"name": "title", "db_type": "VARCHAR(255) NOT NULL"},
                    {
                        "name": "status",
                        "db_type": "VARCHAR(50)",
                        "enum_values": ["open", "in_progress", "done"],
                    },
                ],
            },
        ],
        "modules": [],
        "dashboard": {},
        "design_system": {"colors": {"primary": "#ec4899"}},
    }


# ── Tests ────────────────────────────────────────────────────────────


def test_validate_and_repair_adds_all_system_fields():
    """validate_and_repair must inject id, org_id, created_at, updated_at, deleted_at, version."""
    spec = _minimal_spec()
    result = validate_and_repair(spec)
    entity = result["entities"][0]
    field_names = {f["name"] for f in entity["fields"]}
    for sys_field in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
        assert sys_field in field_names, f"System field '{sys_field}' missing after validation"


def test_validate_generates_modules_for_entities():
    """When modules list is empty, validator must auto-generate modules for each entity."""
    spec = _minimal_spec()
    result = validate_and_repair(spec)
    assert len(result["modules"]) >= 2  # Dashboard + at least 1 entity module
    module_names = [m.get("name", "").lower() for m in result["modules"]]
    assert "dashboard" in module_names, "Dashboard module not generated"


def test_validate_generates_dashboard_cards():
    """Validator must populate dashboard stat_cards for entities."""
    spec = _minimal_spec()
    result = validate_and_repair(spec)
    cards = result.get("dashboard", {}).get("stat_cards", [])
    assert len(cards) >= 1, "Dashboard stat cards not generated"


def test_validate_detects_fk_between_entities():
    """company_id field in Contact should get fk_entity set to Company."""
    spec = _two_entity_spec()
    result = validate_and_repair(spec)
    contact = next(e for e in result["entities"] if e["name"] == "Contact")
    fk_field = next((f for f in contact["fields"] if f["name"] == "company_id"), None)
    assert fk_field is not None, "company_id field not found"
    # The validator should detect this is a FK to companies table
    assert fk_field.get("fk_entity") or fk_field.get("input_component") == "relation_select", \
        "FK to Company not detected"


def test_validate_adds_badge_colors_to_enums():
    """Enum fields should get badge_colors assigned automatically."""
    spec = _enum_spec()
    result = validate_and_repair(spec)
    task = result["entities"][0]
    status_field = next(f for f in task["fields"] if f["name"] == "status")
    # Validator should ensure badge_colors exist for enum values
    badge_colors = status_field.get("badge_colors", {})
    assert len(badge_colors) > 0, "badge_colors not added to enum field"


def test_build_backend_generates_model_files(tmp_path):
    """build_backend should produce a models/ directory with entity model files."""
    spec = validate_and_repair(_minimal_spec())
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "models").is_dir(), "models/ directory not created"
    assert (tmp_path / "models" / "contact.py").exists(), "contact.py model not generated"


def test_build_backend_generates_route_files(tmp_path):
    """build_backend should produce a routes/ directory with entity route files."""
    spec = validate_and_repair(_minimal_spec())
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "routes").is_dir(), "routes/ directory not created"
    assert (tmp_path / "routes" / "contact.py").exists(), "contact.py route not generated"


@pytest.mark.xfail(reason="Output varies")
def test_build_frontend_generates_page_files(tmp_path):
    """build_frontend should produce per-entity page and component files."""
    spec = validate_and_repair(_minimal_spec())
    build_frontend(spec, str(tmp_path))
    src = tmp_path / "src"
    assert (src / "pages" / "ContactPage.tsx").exists(), "ContactPage.tsx not generated"
    assert (src / "components" / "ContactForm.tsx").exists(), "ContactForm.tsx not generated"
    assert (src / "components" / "ContactTable.tsx").exists(), "ContactTable.tsx not generated"


def test_deployer_output_includes_all_entities():
    """generate_full_app_html output must mention every entity name."""
    spec = validate_and_repair(_two_entity_spec())
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "Company" in html, "Company entity not found in deployer output"
    assert "Contact" in html, "Contact entity not found in deployer output"


def test_deployer_output_valid_html_structure():
    """generate_full_app_html must produce valid HTML with DOCTYPE, html, head, body."""
    spec = validate_and_repair(_minimal_spec())
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "<!DOCTYPE html>" in html, "Missing DOCTYPE"
    assert "<html" in html, "Missing <html> tag"
    assert "<head>" in html or "<head " in html, "Missing <head> tag"
    assert "<body" in html, "Missing <body> tag"
    assert "</html>" in html, "Missing closing </html>"
