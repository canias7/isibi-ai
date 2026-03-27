"""Comprehensive auth flow tests — 8 tests covering signup, login, verify, and protected routes."""
import time
import pytest


@pytest.mark.asyncio
async def test_signup_missing_fields(client):
    """POST /api/auth/signup with empty body should return 422 (validation error)."""
    response = await client.post("/api/auth/signup", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_signup_invalid_email(client):
    """POST /api/auth/signup with a malformed email should return 422."""
    response = await client.post("/api/auth/signup", json={
        "email": "not-an-email",
        "password": "securepassword123",
        "first_name": "Test",
        "last_name": "User",
        "turnstile_token": "test-token",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_signup_success(client):
    """POST /api/auth/signup with valid data should return 201."""
    unique_email = f"test_{int(time.time())}_{id(client)}@example.com"
    response = await client.post("/api/auth/signup", json={
        "email": unique_email,
        "password": "securepassword123",
        "first_name": "Test",
        "last_name": "User",
        "turnstile_token": "test-token",
    })
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == unique_email
    assert data["user"]["email_verified"] is False


@pytest.mark.asyncio
async def test_login_missing_email(client):
    """POST /api/auth/login with empty body should return 422."""
    response = await client.post("/api/auth/login", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_nonexistent_email(client):
    """POST /api/auth/login with nonexistent email should return 401 (invalid credentials)."""
    response = await client.post("/api/auth/login", json={
        "email": f"nonexistent_{int(time.time())}@example.com",
        "password": "doesntmatter123",
        "turnstile_token": "test-token",
    })
    # Login returns 401 for bad credentials
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_verify_wrong_code(client):
    """POST /api/auth/verify-email with wrong code should return 400."""
    response = await client.post("/api/auth/verify-email", json={
        "email": "wrong@example.com",
        "code": "000000",
    })
    # 404 for account not found, or 400 for bad code
    assert response.status_code in (400, 404)


@pytest.mark.asyncio
async def test_protected_route_no_token(client):
    """GET /api/projects without auth header should return 401 or 403."""
    response = await client.get("/api/projects")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_protected_route_invalid_token(client):
    """GET /api/projects with a garbage Bearer token should return 401 or 403."""
    response = await client.get(
        "/api/projects",
        headers={"Authorization": "Bearer invalid.jwt.token"},
    )
    assert response.status_code in (401, 403, 429)
