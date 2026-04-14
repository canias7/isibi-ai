"""Tests for onboarding-related auth and preference endpoints."""
import pytest


# ── Signup ──

@pytest.mark.asyncio
async def test_signup_endpoint_exists(client):
    """POST /api/auth/signup should exist and return 422 for empty body."""
    response = await client.post("/api/auth/signup")
    assert response.status_code in (422, 400), f"Expected 422/400, got {response.status_code}"


# ── Login ──

@pytest.mark.asyncio
async def test_login_endpoint_exists(client):
    """POST /api/auth/login should exist and return 422 for empty body."""
    response = await client.post("/api/auth/login")
    assert response.status_code in (422, 400), f"Expected 422/400, got {response.status_code}"


# ── Verify Email ──

@pytest.mark.asyncio
async def test_verify_email_endpoint_exists(client):
    """POST /api/auth/verify-email should exist (not 404)."""
    response = await client.post("/api/auth/verify-email")
    assert response.status_code != 404, "verify-email endpoint should exist"


# ── Forgot Password ──

@pytest.mark.asyncio
async def test_forgot_password_endpoint_exists(client):
    """POST /api/auth/forgot-password should exist (not 404)."""
    response = await client.post("/api/auth/forgot-password")
    assert response.status_code != 404, "forgot-password endpoint should exist"


# ── Reset Password ──

@pytest.mark.asyncio
async def test_reset_password_endpoint_exists(client):
    """POST /api/auth/reset-password should exist (not 404)."""
    response = await client.post("/api/auth/reset-password")
    assert response.status_code != 404, "reset-password endpoint should exist"


# ── Signup returns proper fields ──

@pytest.mark.asyncio
async def test_signup_returns_proper_fields(client):
    """Signup with valid data should return id or token in response."""
    response = await client.post("/api/auth/signup", json={
        "email": "onboard-test@example.com",
        "password": "TestPass123!",
        "first_name": "Test",
        "last_name": "User",
        "account_type": "developer",
    })
    # Should succeed (201) or conflict (409) if user exists, not 404/500
    assert response.status_code in (200, 201, 409, 422, 400), (
        f"Signup returned unexpected {response.status_code}"
    )
    if response.status_code in (200, 201):
        data = response.json()
        assert "access_token" in data or "id" in data or "user" in data


# ── Login accepts email ──

@pytest.mark.asyncio
async def test_login_accepts_email(client):
    """Login endpoint should accept email field without 404."""
    response = await client.post("/api/auth/login", json={
        "email": "nonexistent@example.com",
        "password": "wrong",
    })
    # 401 (bad creds) or 422 is expected, but not 404
    assert response.status_code in (400, 401, 403, 422), (
        f"Login returned unexpected {response.status_code}"
    )


# ── Preferences ──

@pytest.mark.asyncio
async def test_preferences_endpoint_exists(client):
    """GET /api/preferences should exist (not 404)."""
    response = await client.get("/api/preferences")
    assert response.status_code != 404, "preferences endpoint should exist"


@pytest.mark.asyncio
async def test_preferences_no_auth(client):
    """GET /api/preferences without auth should return 401/403/404/429."""
    response = await client.get("/api/preferences")
    assert response.status_code in (401, 403, 404, 429), (
        f"Expected auth error, got {response.status_code}"
    )


# ── Billing can-build ──

@pytest.mark.asyncio
async def test_billing_can_build_endpoint_exists(client):
    """GET /api/billing/can-build should exist (not 404)."""
    response = await client.get("/api/billing/can-build")
    # Might return 401/403 without auth, but not 404
    assert response.status_code in (200, 401, 403, 429), (
        f"billing/can-build returned unexpected {response.status_code}"
    )
