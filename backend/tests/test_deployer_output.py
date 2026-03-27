"""Comprehensive deployer output tests — 8 tests covering HTML generation, sidebar, auth, search, and more."""
from generator.deployer import generate_full_app_html


BASIC_SPEC = {
    "app_name": "Test App",
    "entities": [
        {
            "name": "Lead",
            "table": "leads",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "name", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "text_input"},
                {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string", "show_in_table": True, "show_in_form": True, "input_component": "select", "display_component": "status_badge", "enum_values": ["new", "contacted", "qualified"], "badge_colors": {"new": "blue", "contacted": "amber", "qualified": "green"}},
            ],
        },
        {
            "name": "Deal",
            "table": "deals",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string", "show_in_table": False, "show_in_form": False},
                {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string", "show_in_table": True, "show_in_form": True},
            ],
        },
    ],
    "modules": [
        {"name": "Dashboard", "route": "/dashboard", "sidebar_icon": "LayoutDashboard"},
        {"name": "Leads", "route": "/leads", "entity": "Lead", "sidebar_icon": "UserPlus"},
        {"name": "Deals", "route": "/deals", "entity": "Deal", "sidebar_icon": "DollarSign"},
    ],
    "design_system": {"colors": {"primary": "#ec4899"}},
}


def test_generates_html_string():
    """generate_full_app_html should return a non-empty HTML string."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    assert isinstance(html, str)
    assert "<!DOCTYPE html>" in html
    assert len(html) > 500


def test_includes_sidebar_items():
    """Generated HTML should include sidebar navigation items for each module."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    assert "Leads" in html
    assert "Deals" in html
    assert "Dashboard" in html


def test_includes_auth_screen():
    """Generated HTML should include a login/signup auth screen."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    assert "auth" in html.lower()
    # Should have login form elements
    assert "password" in html.lower()
    assert "email" in html.lower()


def test_includes_search_functionality():
    """Generated HTML should include search/filter functionality."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    assert "search" in html.lower() or "filter" in html.lower()


def test_includes_notification_bell():
    """Generated HTML should include notification/toast UI."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    # The deployer includes toast notifications
    assert "toast" in html.lower() or "notification" in html.lower() or "bell" in html.lower()


def test_includes_analytics_page():
    """Generated HTML should include dashboard/analytics content."""
    html = generate_full_app_html(BASIC_SPEC, "https://api.test.com", "test-id")
    assert "dashboard" in html.lower()


def test_handles_empty_spec_gracefully():
    """Generating HTML from an empty/minimal spec should not crash."""
    empty_spec = {"entities": []}
    html = generate_full_app_html(empty_spec, "https://api.test.com", "test-id")
    assert isinstance(html, str)
    assert len(html) > 100


def test_respects_custom_primary_color():
    """The generated HTML should include the custom primary color from design_system."""
    spec = {
        "app_name": "Custom Color App",
        "entities": [],
        "modules": [],
        "design_system": {"colors": {"primary": "#22c55e"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "#22c55e" in html
