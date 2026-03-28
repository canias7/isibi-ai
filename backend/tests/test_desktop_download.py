"""Tests for the desktop download endpoint and Electron template."""
import os
import uuid
import pytest

from generator.deployer import generate_full_app_html

FAKE_PROJECT_ID = str(uuid.uuid4())
ACCEPTABLE_CODES = {401, 403, 404, 429}

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..")
TEMPLATE_DIR = os.path.join(BACKEND_DIR, "electron_template")


@pytest.mark.asyncio
async def test_download_endpoint_exists(client):
    """POST /api/projects/{id}/download/desktop should exist."""
    response = await client.post(f"/api/projects/{FAKE_PROJECT_ID}/download/desktop")
    # Should not be 405 (Method Not Allowed) — the route is registered
    assert response.status_code != 405


@pytest.mark.asyncio
async def test_download_no_auth(client):
    """POST /api/projects/{id}/download/desktop without auth should be rejected."""
    response = await client.post(f"/api/projects/{FAKE_PROJECT_ID}/download/desktop")
    assert response.status_code in ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_download_nonexistent_project(client):
    """POST /api/projects/{id}/download/desktop for a fake project should fail."""
    response = await client.post(
        f"/api/projects/{FAKE_PROJECT_ID}/download/desktop",
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code in ACCEPTABLE_CODES


def test_electron_template_dir_exists():
    """The backend/electron_template/ directory should exist."""
    assert os.path.isdir(TEMPLATE_DIR), f"electron_template dir missing at {TEMPLATE_DIR}"


def test_electron_main_js_exists():
    """electron_template/main.js should exist."""
    assert os.path.isfile(os.path.join(TEMPLATE_DIR, "main.js"))


def test_electron_package_json_exists():
    """electron_template/package.json should exist."""
    assert os.path.isfile(os.path.join(TEMPLATE_DIR, "package.json"))


def test_electron_app_config_exists():
    """electron_template/app-config.json should exist."""
    assert os.path.isfile(os.path.join(TEMPLATE_DIR, "app-config.json"))


def test_deployer_generates_valid_html():
    """generate_full_app_html should produce valid HTML output."""
    spec = {
        "app_name": "DesktopTest",
        "entities": [{"name": "Task", "table": "tasks", "fields": []}],
        "modules": [{"name": "Tasks", "route": "/tasks", "entity": "Task"}],
        "design_system": {"colors": {"primary": "#3b82f6"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "proj-123")
    assert html.startswith("<!DOCTYPE html>")
    assert "</html>" in html


def test_deployer_includes_sidebar():
    """Generated HTML should include sidebar navigation."""
    spec = {
        "app_name": "SidebarTest",
        "entities": [{"name": "Contact", "table": "contacts", "fields": []}],
        "modules": [{"name": "Contacts", "route": "/contacts", "entity": "Contact"}],
        "design_system": {"colors": {"primary": "#6366f1"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "proj-123")
    assert "sidebar-nav" in html
    assert "buildSidebar" in html


def test_deployer_includes_auth_screen():
    """Generated HTML should include an authentication screen."""
    spec = {
        "app_name": "AuthTest",
        "entities": [],
        "modules": [],
        "design_system": {"colors": {"primary": "#ec4899"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "proj-123")
    # The auth screen uses login/signup forms
    assert "auth" in html.lower()
    assert "password" in html.lower()
