"""Tests for workspace, sharing, record locks, versioning, credits, affiliates, and notifications."""
import pytest

FAKE_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_workspace_create_no_auth(client):
    """POST /api/workspaces without auth should return 401/403."""
    response = await client.post("/api/workspaces", json={"name": "Test WS"})
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_workspace_list_no_auth(client):
    """GET /api/workspaces without auth should return 401/403."""
    response = await client.get("/api/workspaces")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_shared_views_no_auth(client):
    """GET /api/apps/{id}/shared-views without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/shared-views")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_record_lock_no_auth(client):
    """POST /api/apps/{id}/locks/{table}/{record} without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/locks/contacts/{FAKE_UUID}"
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_record_view_log_no_auth(client):
    """POST /api/apps/{id}/views-log/{table}/{record} without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/views-log/contacts/{FAKE_UUID}"
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_version_list_no_auth(client):
    """GET /api/projects/{id}/versions without auth should return 401/403."""
    response = await client.get(f"/api/projects/{FAKE_UUID}/versions")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_rollback_no_auth(client):
    """POST /api/projects/{id}/versions/{vid}/rollback without auth should return 401/403."""
    response = await client.post(
        f"/api/projects/{FAKE_UUID}/versions/{FAKE_UUID}/rollback"
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_credits_balance_no_auth(client):
    """GET /api/credits/balance without auth should return 401/403."""
    response = await client.get("/api/credits/balance")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_affiliates_no_auth(client):
    """GET /api/affiliates/dashboard without auth should return 401/403."""
    response = await client.get("/api/affiliates/dashboard")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_notifications_no_auth(client):
    """GET /api/notifications without auth should return 401/403."""
    response = await client.get("/api/notifications")
    assert response.status_code in (401, 403)
