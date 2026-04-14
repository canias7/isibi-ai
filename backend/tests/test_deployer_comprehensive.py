"""Comprehensive tests for generated HTML output features from deployer."""
import pytest
from generator.deployer import generate_full_app_html


# Shared spec with entities to exercise all code paths
FULL_SPEC = {
    "app_name": "TestCRM",
    "entities": [
        {
            "name": "Lead",
            "table": "leads",
            "fields": [
                {"name": "id", "db_type": "UUID", "ts_type": "string"},
                {"name": "name", "db_type": "VARCHAR(255)", "ts_type": "string",
                 "nullable": False, "editable": True, "show_in_table": True,
                 "show_in_form": True, "input_component": "TextInput",
                 "display_component": "Text"},
                {"name": "status", "db_type": "VARCHAR(50)", "ts_type": "string",
                 "nullable": False, "editable": True, "show_in_table": True,
                 "show_in_form": True, "input_component": "Select",
                 "display_component": "Badge",
                 "enum_values": ["new", "contacted", "qualified"],
                 "badge_colors": {"new": "blue", "contacted": "amber", "qualified": "green"}},
                {"name": "value", "db_type": "NUMERIC(12,2)", "ts_type": "number",
                 "nullable": True, "editable": True, "show_in_table": True,
                 "show_in_form": True, "input_component": "CurrencyInput",
                 "display_component": "Currency"},
                {"name": "created_at", "db_type": "TIMESTAMPTZ", "ts_type": "string",
                 "nullable": False, "editable": False, "show_in_table": True,
                 "show_in_form": False, "input_component": "none",
                 "display_component": "Date"},
            ],
            "ui_config": {
                "list_view": {"layout": "table", "columns": ["name", "status", "value"]},
                "create_form": {"type": "SlideOverForm"},
                "edit_form": {"type": "SlideOverForm"},
                "detail_view": {"layout": "tabbed"},
            },
        },
    ],
    "modules": [
        {"name": "Dashboard", "route": "/", "component": "DashboardPage",
         "layout": "sidebar", "sidebar_order": 1, "sidebar_icon": "BarChart3",
         "entity": None},
        {"name": "Leads", "route": "/leads", "component": "ResourcePage",
         "layout": "sidebar", "sidebar_order": 2, "sidebar_icon": "Users",
         "entity": "Lead"},
    ],
    "dashboard": {
        "stat_cards": [
            {"label": "Total Leads", "entity": "Lead", "metric": "count", "color": "blue"},
        ],
    },
    "design_system": {
        "colors": {"primary": "#6366f1", "secondary": "#8b5cf6"},
    },
}

API_BASE = "https://api.test.com"
PROJECT_ID = "test-project-123"


@pytest.fixture
def html():
    """Generate HTML once for all tests in this module."""
    return generate_full_app_html(FULL_SPEC, API_BASE, PROJECT_ID)


def test_deployer_includes_auto_refresh(html):
    """Verify the generated HTML includes a cache TTL / polling mechanism (30s)."""
    # The deployer uses API_CACHE_TTL = 30000 (30 seconds) for polling / refresh
    assert "30000" in html or "API_CACHE_TTL" in html or "setInterval" in html, \
        "Expected auto-refresh / cache TTL polling code in generated HTML"


def test_deployer_includes_keyboard_shortcuts(html):
    """Verify Cmd+K (global search) and Escape shortcuts are present."""
    # Cmd+K / Ctrl+K for global search
    assert "metaKey" in html or "ctrlKey" in html, \
        "Expected Cmd/Ctrl keyboard modifier in generated HTML"
    assert "Escape" in html, "Expected Escape key handler in generated HTML"


def test_deployer_includes_date_formatting(html):
    """Verify date formatting with month names and relative time."""
    assert "toLocaleDateString" in html, \
        "Expected toLocaleDateString for date formatting"
    assert "timeAgo" in html or "relative" in html, \
        "Expected relative time (timeAgo) function in generated HTML"


def test_deployer_includes_number_formatting(html):
    """Verify currency and percentage number formatting."""
    assert "toLocaleString" in html, \
        "Expected toLocaleString for number formatting"
    # Currency formatting with minimumFractionDigits
    assert "minimumFractionDigits" in html, \
        "Expected currency fraction digits formatting"


def test_deployer_includes_dark_mode_css_vars(html):
    """Verify dark mode toggle and CSS variable setup."""
    assert "dark" in html.lower(), "Expected dark mode references"
    assert "toggleDarkMode" in html or "theme-toggle" in html, \
        "Expected dark mode toggle button/function"
    assert "--primary" in html, "Expected CSS custom properties (variables)"


def test_deployer_includes_optimistic_ui(html):
    """Verify optimistic UI pattern with snapshot and revert."""
    assert "optimistic" in html.lower() or "snapshot" in html.lower(), \
        "Expected optimistic UI / snapshot pattern in generated HTML"
    assert "revert" in html.lower() or "rollback" in html.lower(), \
        "Expected revert/rollback on failure in generated HTML"


def test_deployer_includes_conflict_resolution_comments(html):
    """Verify version tracking is present (used for conflict resolution)."""
    # The spec system fields include 'version' for optimistic locking
    assert "version" in html.lower(), \
        "Expected version tracking in generated HTML (used for conflict resolution)"


def test_deployer_includes_loading_skeleton_shimmer(html):
    """Verify skeleton loading states with shimmer animation."""
    assert "skeleton" in html, "Expected skeleton loader class in generated HTML"
    assert "shimmer" in html, "Expected shimmer animation in generated HTML"


def test_deployer_includes_toast_notification_system(html):
    """Verify toast notification system for success/error feedback."""
    assert "toast" in html.lower(), "Expected toast notification system"
    assert "showToast" in html, "Expected showToast function"
    assert "toast-success" in html or "toast-error" in html, \
        "Expected toast type classes (success/error)"


def test_deployer_output_under_500kb(html):
    """Performance: generated HTML should be under 500KB."""
    size_kb = len(html.encode("utf-8")) / 1024
    assert size_kb < 500, f"Generated HTML is {size_kb:.1f}KB — should be under 500KB"
