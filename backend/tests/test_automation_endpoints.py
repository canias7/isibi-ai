"""Tests for automation / trigger endpoints — 10 tests."""
import pytest

FAKE_PROJECT = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_email_triggers_no_auth(client):
    """GET /api/projects/{project}/email-triggers without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/email-triggers")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_webhook_triggers_no_auth(client):
    """GET /api/projects/{project}/webhook-triggers without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/webhook-triggers")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_auto_assign_no_auth(client):
    """GET /api/projects/{project}/auto-assign/rules without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/auto-assign/rules")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_deadline_reminders_no_auth(client):
    """GET /api/projects/{project}/deadline-reminders without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/deadline-reminders")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_status_rules_no_auth(client):
    """GET /api/projects/{project}/status-rules without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/status-rules")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_duplicate_rules_no_auth(client):
    """GET /api/projects/{project}/duplicate-rules without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/duplicate-rules")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_workflows_no_auth(client):
    """GET /api/projects/{project}/workflows without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/workflows")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_integrations_list_no_auth(client):
    """GET /api/projects/{project}/integrations without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/integrations")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_scheduled_reports_no_auth(client):
    """GET /api/projects/{project}/scheduled-reports without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/scheduled-reports")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_snapshots_no_auth(client):
    """GET /api/apps/{project}/snapshots without auth should be rejected."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/snapshots")
    assert response.status_code in (401, 403, 429)
