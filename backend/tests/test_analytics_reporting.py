"""Tests for analytics, reporting, goals, funnels, cohorts, and dashboard endpoints."""
import pytest

FAKE_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_report_builder_no_auth(client):
    """GET /api/apps/{id}/reports without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/reports")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_goals_no_auth(client):
    """GET /api/apps/{id}/goals without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/goals")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_funnels_no_auth(client):
    """GET /api/apps/{id}/funnels without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/funnels")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_cohorts_no_auth(client):
    """POST /api/apps/{id}/cohorts/analyze without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/cohorts/analyze")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_excel_export_no_auth(client):
    """GET /api/apps/{id}/data/contacts/export-xlsx without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/data/contacts/export-xlsx")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_dashboard_widgets_no_auth(client):
    """GET /api/apps/{id}/dashboard-widgets without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/dashboard-widgets")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_dashboard_summary_no_auth(client):
    """GET /api/apps/{id}/analytics/summary without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/analytics/summary")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_dashboard_growth_no_auth(client):
    """GET /api/apps/{id}/analytics/growth without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/analytics/growth")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_analytics_track_public(client):
    """POST /api/apps/{id}/analytics/track should accept public requests (no auth needed)."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/analytics/track",
        json={"event": "page_view", "properties": {"page": "/home"}},
    )
    # Should not be 401/403 — tracking is public; may be 404 if project doesn't exist
    assert response.status_code not in (401, 403)


@pytest.mark.asyncio
async def test_uptime_check_no_auth(client):
    """GET /api/projects/{id}/uptime without auth should return 401/403."""
    response = await client.get(f"/api/projects/{FAKE_UUID}/uptime")
    assert response.status_code in (401, 403)
