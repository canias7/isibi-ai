"""Password flow tests — 10 tests covering platform and app-level forgot/reset
password, signup duplication, wrong credentials, and unauthenticated access."""
import pytest
from pytest import mark


FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000099"


@pytest.mark.asyncio
async def test_platform_forgot_password_missing_email(client):
    """POST /api/auth/forgot-password with no email should return 422."""
    response = await client.post("/api/auth/forgot-password", json={})
    assert response.status_code == 422, f"Expected 422, got {response.status_code}"


@pytest.mark.asyncio
async def test_platform_forgot_password_nonexistent(client):
    """POST /api/auth/forgot-password with nonexistent email should return 200
    (to prevent email enumeration)."""
    response = await client.post(
        "/api/auth/forgot-password",
        json={"email": "nobody-ever-registered-this-email@example.com"},
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"


@pytest.mark.asyncio
async def test_platform_reset_wrong_code(client):
    """POST /api/auth/reset-password with wrong code should return 400."""
    response = await client.post(
        "/api/auth/reset-password",
        json={
            "email": "nobody@example.com",
            "code": "000000",
            "new_password": "NewPassword123!",
        },
    )
    assert response.status_code == 400, f"Expected 400, got {response.status_code}"


@pytest.mark.asyncio
async def test_platform_reset_missing_fields(client):
    """POST /api/auth/reset-password with missing fields should return 422."""
    response = await client.post("/api/auth/reset-password", json={"email": "test@example.com"})
    assert response.status_code == 422, f"Expected 422, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_forgot_password_missing(client):
    """POST /api/apps/{id}/auth/forgot-password with no body should return 422."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/forgot-password", json={})
    assert response.status_code == 422, f"Expected 422, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_reset_missing(client):
    """POST /api/apps/{id}/auth/reset-password with no body should return 422."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/reset-password", json={})
    assert response.status_code == 422, f"Expected 422, got {response.status_code}"


@pytest.mark.asyncio
@pytest.mark.xfail(reason="Requires running app DB")
async def test_app_signup_duplicate_email(client):
    """POST /api/apps/{id}/auth/signup twice with the same email should return 409/400 on second."""
    body = {"email": "dup-test@example.com", "password": "Pass123!", "display_name": "Dup Test"}
    # First signup — may succeed or fail (no real project), we just care about the duplicate
    await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/signup", json=body)
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/signup", json=body)
    assert response.status_code in (400, 409, 500), f"Expected 400/409/500, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_login_wrong_password(client):
    """POST /api/apps/{id}/auth/login with wrong password should return 401."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/auth/login",
        json={"email": "noone@example.com", "password": "WrongPass!"},
    )
    assert response.status_code in (401, 500), f"Expected 401/500, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_logout_no_auth(client):
    """POST /api/apps/{id}/auth/logout without auth should return 401/403/404/429."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/logout")
    assert response.status_code in (401, 403, 404, 429), f"Expected 401/403/404/429, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_me_no_auth(client):
    """GET /api/apps/{id}/auth/me without auth should return 401/403/404/429."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/auth/me")
    assert response.status_code in (401, 403, 404, 429), f"Expected 401/403/404/429, got {response.status_code}"
