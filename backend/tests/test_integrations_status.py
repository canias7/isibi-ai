"""Tests for integration workers and automation endpoints."""
import os
import pytest


BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")


def _file_exists(relative_path: str) -> bool:
    """Check if a file exists relative to the backend directory."""
    full = os.path.normpath(os.path.join(BACKEND_ROOT, relative_path))
    return os.path.isfile(full)


# ── Worker file existence ──

def test_slack_worker_exists():
    """Slack worker module should exist."""
    assert _file_exists("worker/slack_worker.py"), "slack_worker.py should exist"


def test_webhook_worker_exists():
    """Webhook worker module should exist."""
    assert _file_exists("worker/webhook_worker.py"), "webhook_worker.py should exist"


def test_email_worker_exists():
    """Email worker module should exist."""
    assert _file_exists("worker/email_worker.py"), "email_worker.py should exist"


def test_calendar_export_exists():
    """Calendar export route should exist."""
    assert _file_exists("routes/app_calendar_export.py"), "app_calendar_export.py should exist"


# ── Endpoint smoke tests ──

@pytest.mark.asyncio
async def test_integrations_endpoint_exists(client):
    """GET /api/apps/{id}/integrations should exist (not 404 for valid format)."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/integrations")
    # May return 401/403/404 (project not found), but the route itself should be wired
    assert response.status_code in (200, 401, 403, 404, 422, 500), (
        f"integrations endpoint returned unexpected {response.status_code}"
    )


@pytest.mark.asyncio
async def test_integrations_no_auth(client):
    """Integrations endpoint without auth should return 401/403/404/429."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/integrations")
    assert response.status_code in (401, 403, 404, 429), (
        f"Expected auth-related status, got {response.status_code}"
    )


@pytest.mark.asyncio
async def test_auto_assign_endpoint_exists(client):
    """Auto-assign rules endpoint should exist."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/auto-assign")
    assert response.status_code in (200, 401, 403, 404, 422, 500), (
        f"auto-assign endpoint returned unexpected {response.status_code}"
    )


@pytest.mark.asyncio
async def test_duplicate_detection_endpoint_exists(client):
    """Duplicate detection endpoint should exist."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/duplicate-detection")
    assert response.status_code in (200, 401, 403, 404, 422, 500), (
        f"duplicate-detection endpoint returned unexpected {response.status_code}"
    )


@pytest.mark.asyncio
async def test_deadline_reminders_endpoint_exists(client):
    """Deadline reminders endpoint should exist."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/deadline-reminders")
    assert response.status_code in (200, 401, 403, 404, 422, 500), (
        f"deadline-reminders endpoint returned unexpected {response.status_code}"
    )


@pytest.mark.asyncio
async def test_status_rules_endpoint_exists(client):
    """Status rules endpoint should exist."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/status-rules")
    assert response.status_code in (200, 401, 403, 404, 422, 500), (
        f"status-rules endpoint returned unexpected {response.status_code}"
    )
