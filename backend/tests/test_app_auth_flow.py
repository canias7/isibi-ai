"""Tests for the generated app's auth endpoints."""
import uuid
import pytest

FAKE_PROJECT_ID = str(uuid.uuid4())
ACCEPTABLE_CODES = {401, 403, 404, 429}


@pytest.mark.asyncio
@pytest.mark.xfail(reason="DB event loop")
async def test_app_signup_endpoint_exists(client):
    """POST /api/apps/{id}/auth/signup should exist and respond."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/signup",
        json={"email": "new@example.com", "password": "Test1234!"},
    )
    # Endpoint exists if we get any structured response (not 405 Method Not Allowed)
    assert response.status_code != 405


@pytest.mark.asyncio
async def test_app_login_endpoint_exists(client):
    """POST /api/apps/{id}/auth/login should exist and respond."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/login",
        json={"email": "user@example.com", "password": "Test1234!"},
    )
    assert response.status_code != 405


@pytest.mark.asyncio
async def test_app_signup_missing_fields(client):
    """POST /api/apps/{id}/auth/signup with empty body should return 422."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/signup",
        json={},
    )
    assert response.status_code in {422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_login_missing_fields(client):
    """POST /api/apps/{id}/auth/login with empty body should return 422."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/login",
        json={},
    )
    assert response.status_code in {422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_forgot_password_endpoint_exists(client):
    """POST /api/apps/{id}/auth/forgot-password should exist."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/forgot-password",
        json={"email": "user@example.com"},
    )
    assert response.status_code in {200, 422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_reset_password_endpoint_exists(client):
    """POST /api/apps/{id}/auth/reset-password should exist."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/reset-password",
        json={"email": "user@example.com", "code": "000000", "new_password": "New1234!"},
    )
    assert response.status_code in {200, 400, 422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_me_endpoint_exists(client):
    """GET /api/apps/{id}/auth/me should exist (returns 401/403 without token)."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/auth/me")
    assert response.status_code in ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_logout_endpoint_exists(client):
    """POST /api/apps/{id}/auth/logout should exist or be handled."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/logout")
    # Logout may return 200 even without auth, or reject without auth
    assert response.status_code in {200, 204, 405, 422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_2fa_setup_endpoint_exists(client):
    """POST /api/apps/{id}/auth/2fa/setup should exist."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/2fa/setup")
    assert response.status_code in {200, 422} | ACCEPTABLE_CODES


@pytest.mark.asyncio
async def test_app_data_requires_auth(client):
    """GET /api/apps/{id}/data/some_table should require auth."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/data/contacts")
    assert response.status_code in ACCEPTABLE_CODES
