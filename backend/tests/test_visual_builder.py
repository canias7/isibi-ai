"""Tests that visual builder frontend components and pages exist."""
import os
import pytest


FRONTEND_ROOT = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "src"
)


def _file_exists(relative_path: str) -> bool:
    """Check if a file exists relative to the frontend/src directory."""
    full = os.path.normpath(os.path.join(FRONTEND_ROOT, relative_path))
    return os.path.isfile(full)


def test_spec_editor_component_exists():
    """SpecEditor component should exist in frontend/src/components."""
    assert _file_exists("components/SpecEditor.tsx"), "SpecEditor.tsx should exist"


def test_field_editor_component_exists():
    """FieldEditor component should exist in frontend/src/components."""
    assert _file_exists("components/FieldEditor.tsx"), "FieldEditor.tsx should exist"


def test_erd_viewer_component_exists():
    """ERDViewer component should exist in frontend/src/components."""
    assert _file_exists("components/ERDViewer.tsx"), "ERDViewer.tsx should exist"


def test_cloud_ide_component_exists():
    """CloudIDE component should exist in frontend/src/components."""
    assert _file_exists("components/CloudIDE.tsx"), "CloudIDE.tsx should exist"


def test_qr_code_component_exists():
    """QRCodeSVG component should exist in frontend/src/components."""
    assert _file_exists("components/QRCodeSVG.tsx"), "QRCodeSVG.tsx should exist"


def test_project_settings_page_exists():
    """ProjectSettingsPage should exist in frontend/src/pages."""
    assert _file_exists("pages/ProjectSettingsPage.tsx"), "ProjectSettingsPage.tsx should exist"


def test_marketplace_page_exists():
    """MarketplacePage should exist in frontend/src/pages."""
    assert _file_exists("pages/MarketplacePage.tsx"), "MarketplacePage.tsx should exist"


def test_landing_page_exists():
    """LandingPage should exist in frontend/src/pages."""
    assert _file_exists("pages/LandingPage.tsx"), "LandingPage.tsx should exist"


def test_login_page_exists():
    """LoginPage should exist in frontend/src/pages."""
    assert _file_exists("pages/LoginPage.tsx"), "LoginPage.tsx should exist"


def test_signup_page_exists():
    """SignupPage should exist in frontend/src/pages."""
    assert _file_exists("pages/SignupPage.tsx"), "SignupPage.tsx should exist"
