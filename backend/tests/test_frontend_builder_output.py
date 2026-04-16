"""Tests for the React frontend builder output quality."""
import json
from generator.frontend_builder import build_frontend

MINIMAL_SPEC = {
    "app_name": "Test App",
    "entities": [
        {
            "name": "Contact",
            "table": "contacts",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input", "display_component": "text"},
                {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input", "display_component": "text"},
                {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "select", "display_component": "status_badge", "enum_values": ["active", "inactive", "lead"]},
            ],
        },
        {
            "name": "Order",
            "table": "orders",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "contact_id", "db_type": "UUID", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "relation_select", "fk_entity": "Contact"},
                {"name": "amount", "db_type": "NUMERIC(10,2)", "ts_type": "number", "show_in_table": True, "show_in_form": True, "input_component": "number_input"},
            ],
        },
    ],
    "modules": [
        {"name": "Dashboard", "route": "/dashboard", "sidebar_icon": "LayoutDashboard"},
        {"name": "Contacts", "route": "/contacts", "entity": "Contact", "sidebar_icon": "Users"},
        {"name": "Orders", "route": "/orders", "entity": "Order", "sidebar_icon": "ShoppingCart"},
    ],
    "design_system": {"colors": {"primary": "#3b82f6"}},
}


def test_generates_package_json(tmp_path):
    """package.json should contain react, vite, and tailwind dependencies."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    pkg = json.loads((tmp_path / "package.json").read_text())
    all_deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    assert "react" in all_deps
    assert "vite" in all_deps
    assert "tailwindcss" in all_deps


def test_generates_app_tsx(tmp_path):
    """App.tsx should have Router and routes for each entity."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    app_code = (tmp_path / "src" / "App.tsx").read_text()
    assert "Route" in app_code
    assert "ContactPage" in app_code
    assert "OrderPage" in app_code
    assert "Dashboard" in app_code


def test_generates_api_client(tmp_path):
    """api.ts should have get, post, patch/put, and del/delete functions."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    api_code = (tmp_path / "src" / "api.ts").read_text()
    assert "get" in api_code
    assert "post" in api_code
    assert "patch" in api_code or "put" in api_code
    assert "delete" in api_code.lower() or "del" in api_code


def test_generates_layout(tmp_path):
    """Layout.tsx should have a sidebar with nav items for each module."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    layout = (tmp_path / "src" / "components" / "Layout.tsx").read_text()
    assert "Contacts" in layout or "contacts" in layout
    assert "Orders" in layout or "orders" in layout
    assert "Dashboard" in layout or "dashboard" in layout


def test_generates_entity_page_per_entity(tmp_path):
    """Each entity should get its own Page component."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    assert (tmp_path / "src" / "pages" / "ContactPage.tsx").exists()
    assert (tmp_path / "src" / "pages" / "OrderPage.tsx").exists()


def test_generates_entity_table_component(tmp_path):
    """Each entity should get a Table component with column headers."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    contact_table = (tmp_path / "src" / "components" / "ContactTable.tsx").read_text()
    assert "name" in contact_table
    assert "email" in contact_table
    assert "status" in contact_table


def test_generates_entity_form_component(tmp_path):
    """Each entity should get a Form component with input fields."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    contact_form = (tmp_path / "src" / "components" / "ContactForm.tsx").read_text()
    assert "name" in contact_form
    assert "email" in contact_form
    assert "input" in contact_form.lower() or "Input" in contact_form


def test_generates_dashboard(tmp_path):
    """Dashboard.tsx should exist and reference entity data."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    dashboard = (tmp_path / "src" / "pages" / "Dashboard.tsx").read_text()
    assert "contacts" in dashboard or "Contact" in dashboard
    assert "orders" in dashboard or "Order" in dashboard


def test_handles_entities_with_enums(tmp_path):
    """Form for entities with enum fields should generate select inputs with options."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    contact_form = (tmp_path / "src" / "components" / "ContactForm.tsx").read_text()
    # Should have a select element with the enum values
    assert "select" in contact_form.lower()
    assert "active" in contact_form
    assert "inactive" in contact_form or "lead" in contact_form


def test_handles_fk_fields(tmp_path):
    """Form for entities with FK fields should generate a relation select."""
    build_frontend(MINIMAL_SPEC, str(tmp_path))
    order_form = (tmp_path / "src" / "components" / "OrderForm.tsx").read_text()
    # Should reference Contact for the FK dropdown
    assert "contact" in order_form.lower() or "Contact" in order_form
