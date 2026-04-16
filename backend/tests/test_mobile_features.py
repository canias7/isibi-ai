"""Tests that the generated HTML app includes mobile-specific features."""
import pytest
from generator.deployer import generate_full_app_html


SPEC = {
    "app_name": "MobileTest",
    "entities": [
        {"name": "Task", "table": "tasks", "fields": [
            {"name": "title", "type": "string"},
            {"name": "status", "type": "string", "enum_values": ["open", "done"]},
        ]},
    ],
    "modules": [
        {"name": "Dashboard", "entity": "", "layout": "dashboard"},
        {"name": "Tasks", "entity": "Task", "layout": "table"},
    ],
    "design_system": {"colors": {"primary": "#ec4899"}},
}


@pytest.fixture
def html():
    return generate_full_app_html(SPEC, "https://api.test.com", "mobile-test")


def test_deployer_includes_mobile_nav(html):
    """Generated app should include bottom mobile navigation."""
    assert "mobile-nav" in html
    assert "mobile-nav-inner" in html


def test_deployer_includes_dark_mode_toggle(html):
    """Generated app should include dark mode toggle."""
    assert "toggleDarkMode" in html or "theme-toggle" in html


def test_deployer_includes_fab_button(html):
    """Generated app should include a floating action button for mobile."""
    assert "fab" in html
    assert "fab-btn" in html


def test_deployer_includes_responsive_css(html):
    """Generated app should include responsive media queries."""
    assert "@media (max-width:768px)" in html
    assert "@media (max-width:480px)" in html or "@media (max-width:600px)" in html


def test_deployer_includes_touch_handlers(html):
    """Generated app should include touch event handlers for swipe."""
    assert "touchstart" in html
    assert "touchend" in html


def test_deployer_includes_pull_to_refresh(html):
    """Generated app should include pull-to-refresh functionality."""
    assert "pull-to-refresh" in html
    assert "pull-spinner" in html


def test_deployer_includes_card_layout_mobile(html):
    """Generated app should include mobile card layout alternative to tables."""
    assert "mobile-card-list" in html
    assert "mobile-record-card" in html


def test_deployer_includes_bottom_sheet_modal(html):
    """Generated app should include slide-over modal (bottom sheet on mobile)."""
    assert "modal-overlay" in html
    assert "slide-over" in html or "modal-panel" in html


def test_deployer_tablet_icon_sidebar(html):
    """Generated app should include tablet-specific icon-only sidebar."""
    assert "min-width:769px" in html
    assert "max-width:1024px" in html


def test_deployer_includes_safe_area_inset(html):
    """Generated app should respect safe area insets for notched devices."""
    assert "safe-area-inset" in html
