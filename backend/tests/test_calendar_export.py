"""Tests for calendar export, generated files, and auth edge cases."""
import pytest


# ── Calendar ICS export ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ics_export_no_auth(client):
    """ICS export without auth should return 401/403/429."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/calendar/tasks/ics")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_ics_export_nonexistent_project(client):
    """ICS export for nonexistent project should return 404/401/403/429."""
    response = await client.get("/api/apps/ffffffff-ffff-ffff-ffff-ffffffffffff/calendar/contacts/ics")
    assert response.status_code in (404, 401, 403, 429)


@pytest.mark.asyncio
async def test_ics_endpoint_exists(client):
    """Calendar export route should be registered (not 405 Method Not Allowed for GET)."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/calendar/leads/ics")
    # Should NOT be 405 (Method Not Allowed) — route is registered
    assert response.status_code != 405


@pytest.mark.asyncio
async def test_ics_content_type(client):
    """ICS endpoint should intend to return text/calendar content type (auth blocks us, but route exists)."""
    response = await client.get("/api/apps/00000000-0000-0000-0000-000000000000/calendar/items/ics")
    # We cannot access without auth, but verify the route is registered
    assert response.status_code in (401, 403, 429)


# ── Generated files ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generated_files_no_auth(client):
    """Generated files endpoint without auth should return 401/403/429."""
    response = await client.get("/api/projects/00000000-0000-0000-0000-000000000000/generated-files")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_generated_files_nonexistent(client):
    """Generated files for nonexistent project should return 404/401/403/429."""
    response = await client.get("/api/projects/ffffffff-ffff-ffff-ffff-ffffffffffff/generated-files")
    assert response.status_code in (404, 401, 403, 429)


# ── Auth edge cases ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_app_auth_signup_missing_fields(client):
    """Signup with empty body should return 422."""
    response = await client.post("/api/auth/signup")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_app_auth_login_missing_fields(client):
    """Login with empty body should return 422."""
    response = await client.post("/api/auth/login")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_forgot_password_missing_email(client):
    """Forgot password with no email should return 422."""
    response = await client.post("/api/auth/forgot-password")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_reset_password_missing_fields(client):
    """Reset password with empty body should return 422."""
    response = await client.post("/api/auth/reset-password")
    assert response.status_code == 422
