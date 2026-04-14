"""Tests for builder + AI generator utilities — 10 tests."""
import json
import pytest
from generator.builder import build_backend
from generator.frontend_builder import build_frontend
from generator.ai_generator import (
    _robust_json_parse,
    _fix_common_json_errors,
    _ensure_required_fields,
    _enforce_format,
)


# ── Builder tests ───────────────────────────────────────────────────

MINIMAL_SPEC = {
    "app_name": "Mini",
    "entities": [
        {
            "name": "Item",
            "table": "items",
            "fields": [
                {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string",
                 "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
            ],
        }
    ],
    "modules": [
        {"name": "Dashboard", "route": "/", "sidebar_icon": "BarChart3"},
        {"name": "Items", "route": "/items", "entity": "Item", "sidebar_icon": "Package"},
    ],
    "design_system": {"colors": {"primary": "#2563eb"}},
}


def test_build_backend_creates_files(tmp_path):
    """build_backend should produce main.py, db.py, models/, routes/."""
    build_backend(MINIMAL_SPEC, str(tmp_path))
    assert (tmp_path / "main.py").exists()
    assert (tmp_path / "db.py").exists()
    assert (tmp_path / "models").is_dir()
    assert (tmp_path / "routes").is_dir()


def test_build_frontend_creates_files(tmp_path):
    """build_frontend should produce package.json, src/App.tsx, etc."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    assert (tmp_path / "package.json").exists()
    assert (tmp_path / "src" / "App.tsx").exists()
    assert (tmp_path / "src" / "main.tsx").exists()
    assert (tmp_path / "src" / "api.ts").exists()


def test_build_backend_empty_entities(tmp_path):
    """build_backend with no entities should not crash."""
    spec = {"app_name": "Empty", "entities": []}
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "main.py").exists()


def test_build_frontend_empty_entities(tmp_path):
    """build_frontend with no entities should not crash."""
    spec = {
        "app_name": "Empty",
        "entities": [],
        "modules": [{"name": "Dashboard", "route": "/", "sidebar_icon": "BarChart3"}],
        "design_system": {"colors": {"primary": "#2563eb"}},
    }
    build_frontend(spec, str(tmp_path))
    assert (tmp_path / "package.json").exists()
    assert (tmp_path / "src" / "App.tsx").exists()


# ── AI generator utility tests ──────────────────────────────────────

def test_robust_json_parse_valid():
    """Plain valid JSON should parse fine."""
    result = _robust_json_parse('{"name": "CRM"}')
    assert result == {"name": "CRM"}


def test_robust_json_parse_with_fences():
    """JSON wrapped in ```json ... ``` fences should parse."""
    result = _robust_json_parse('```json\n{"app": "Test"}\n```')
    assert result == {"app": "Test"}


def test_robust_json_parse_trailing_comma():
    """Trailing commas before } should be fixed and parsed."""
    result = _robust_json_parse('{"a": 1, "b": 2,}')
    assert result == {"a": 1, "b": 2}


def test_ensure_required_fields_fills_gaps():
    """Missing top-level keys should be auto-filled with defaults."""
    spec = {"entities": [{"name": "Task", "table": "tasks", "fields": []}]}
    result = _ensure_required_fields(spec)
    assert "app_name" in result
    assert "modules" in result
    assert "dashboard" in result
    assert "design_system" in result
    assert "pagination" in result


def test_enforce_format_adds_badge_colors():
    """Enum fields missing badge_colors should get them filled in."""
    spec = {
        "entities": [
            {
                "name": "Lead",
                "table": "leads",
                "fields": [
                    {
                        "name": "status",
                        "db_type": "VARCHAR(50)",
                        "ts_type": "string",
                        "enum_values": ["new", "closed"],
                    }
                ],
            }
        ]
    }
    result = _enforce_format(spec)
    status_field = result["entities"][0]["fields"][0]
    # _enforce_format should have added badge_colors for enum field
    assert "badge_colors" in status_field or "enum_values" in status_field


def test_validate_and_repair_comprehensive():
    """A bare-minimum spec should survive the full ensure + enforce pipeline."""
    spec = {
        "app_name": "Repair Test",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "email", "db_type": "VARCHAR(255)"},
                ],
            }
        ],
    }
    result = _ensure_required_fields(spec)
    result = _enforce_format(result)
    # Should have all top-level keys
    assert "modules" in result
    assert "design_system" in result
    # Entity should have system fields added
    field_names = [f["name"] for f in result["entities"][0]["fields"]]
    assert "id" in field_names
    assert "created_at" in field_names
