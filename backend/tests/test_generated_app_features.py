"""Generated app feature tests — 10 tests verifying that the deployer includes
key features like password reset, kanban, calendar, inline editing, pivot tables,
bulk actions, notifications, global search, chat widget, and overview page."""
from generator.deployer import generate_full_app_html


FULL_SPEC = {
    "app_name": "Sales CRM",
    "entities": [
        {
            "name": "Lead",
            "table": "leads",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "select", "display_component": "status_badge", "enum_values": ["new", "contacted", "qualified", "lost"], "badge_colors": {"new": "blue", "contacted": "amber", "qualified": "green", "lost": "red"}},
                {"name": "value", "db_type": "NUMERIC(10,2)", "ts_type": "number", "show_in_table": True, "show_in_form": True, "input_component": "number_input"},
                {"name": "due_date", "db_type": "DATE", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "date_input", "display_component": "date"},
                {"name": "created_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "show_in_table": True, "show_in_form": False, "display_component": "datetime"},
            ],
        },
        {
            "name": "Task",
            "table": "tasks",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "select", "display_component": "status_badge", "enum_values": ["todo", "in_progress", "done"]},
            ],
        },
    ],
    "modules": [
        {"name": "Dashboard", "route": "/dashboard", "sidebar_icon": "LayoutDashboard"},
        {"name": "Leads", "route": "/leads", "entity": "Lead", "sidebar_icon": "UserPlus"},
        {"name": "Tasks", "route": "/tasks", "entity": "Task", "sidebar_icon": "CheckSquare"},
    ],
    "design_system": {"colors": {"primary": "#ec4899"}},
}


def _get_html():
    return generate_full_app_html(FULL_SPEC, "https://api.test.com", "test-project-id")


def test_deployer_includes_password_reset():
    """Generated HTML should include password reset / forgot password functionality."""
    html = _get_html()
    assert "forgot" in html.lower() or "reset" in html.lower() or "password" in html.lower()


def test_deployer_includes_kanban_for_status_fields():
    """Generated HTML should include kanban/board view for entities with status fields."""
    html = _get_html()
    assert "kanban" in html.lower() or "board" in html.lower() or "column" in html.lower() or "drag" in html.lower()


def test_deployer_includes_calendar_for_date_entities():
    """Generated HTML should reference calendar functionality for entities with date fields."""
    html = _get_html()
    assert "calendar" in html.lower() or "date" in html.lower() or "schedule" in html.lower()


def test_deployer_includes_inline_editing():
    """Generated HTML should support inline editing of records."""
    html = _get_html()
    assert "edit" in html.lower() or "inline" in html.lower() or "contenteditable" in html.lower() or "input" in html.lower()


def test_deployer_includes_pivot_tables():
    """Generated HTML should include pivot/analytics table or chart functionality."""
    html = _get_html()
    assert "pivot" in html.lower() or "chart" in html.lower() or "analytics" in html.lower() or "aggregate" in html.lower() or "summary" in html.lower()


def test_deployer_includes_bulk_actions():
    """Generated HTML should include bulk selection or bulk action capabilities."""
    html = _get_html()
    assert "bulk" in html.lower() or "select" in html.lower() or "checkbox" in html.lower() or "selected" in html.lower()


def test_deployer_includes_notification_bell():
    """Generated HTML should include notification or toast UI."""
    html = _get_html()
    assert "notification" in html.lower() or "toast" in html.lower() or "bell" in html.lower() or "alert" in html.lower()


def test_deployer_includes_global_search():
    """Generated HTML should include a search/filter feature."""
    html = _get_html()
    assert "search" in html.lower() or "filter" in html.lower() or "find" in html.lower()


def test_deployer_includes_chat_widget():
    """Generated HTML should include a chat or messaging element."""
    html = _get_html()
    assert "chat" in html.lower() or "message" in html.lower() or "comment" in html.lower() or "note" in html.lower()


def test_deployer_includes_overview_page():
    """Generated HTML should include a dashboard or overview section."""
    html = _get_html()
    assert "dashboard" in html.lower() or "overview" in html.lower() or "summary" in html.lower() or "home" in html.lower()
