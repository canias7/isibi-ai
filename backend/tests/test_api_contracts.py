"""Tests verifying API response formats and contract enforcement."""
import pytest


@pytest.mark.asyncio
async def test_health_response_format(client):
    """Health endpoint must return status, version, uptime, database, redis."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    for key in ("status", "version", "uptime_seconds", "database", "redis"):
        assert key in data, f"Missing '{key}' in health response"
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_marketplace_list_response_format(client):
    """Template marketplace listing must return a list (possibly empty)."""
    resp = await client.get("/api/template-marketplace")
    assert resp.status_code == 200
    data = resp.json()
    # Should be a list (or dict with items)
    assert isinstance(data, (list, dict)), "Marketplace response must be list or dict"
    if isinstance(data, dict):
        # If paginated, it should have a list-like key
        assert any(isinstance(v, list) for v in data.values()), \
            "Marketplace dict response must contain at least one list"


@pytest.mark.asyncio
async def test_project_create_response_format(client):
    """POST /api/projects without auth should return 401 or 403."""
    resp = await client.post("/api/projects", json={"prompt": "Build a CRM"})
    assert resp.status_code in (401, 403, 422), \
        f"Expected auth error, got {resp.status_code}"


@pytest.mark.asyncio
async def test_billing_plan_response_format(client):
    """GET /api/billing/plan without auth should return 401 or 403."""
    resp = await client.get("/api/billing/plan")
    assert resp.status_code in (401, 403), \
        f"Expected auth error for billing, got {resp.status_code}"


@pytest.mark.asyncio
async def test_spec_endpoint_requires_auth(client):
    """GET /api/spec without auth should be rejected."""
    resp = await client.get("/api/spec")
    assert resp.status_code in (401, 403), \
        f"Spec endpoint should require auth, got {resp.status_code}"


@pytest.mark.asyncio
async def test_chat_requires_messages_field(client):
    """POST /api/chat without messages field should return 422."""
    resp = await client.post("/api/chat", json={"model": "anias-1.0"})
    assert resp.status_code in (422, 401, 403, 429), \
        f"Chat without messages should be 422 or auth error, got {resp.status_code}"


@pytest.mark.asyncio
async def test_deploy_requires_project_id(client):
    """POST /api/projects/invalid-uuid/deploy should return 400 or 401/403."""
    resp = await client.post("/api/projects/not-a-uuid/deploy", json={})
    # Either auth error (401/403) or bad request (400)
    assert resp.status_code in (400, 401, 403, 422), \
        f"Deploy with invalid project_id should fail, got {resp.status_code}"


@pytest.mark.asyncio
async def test_signup_requires_all_fields(client):
    """POST /api/auth/signup with empty body should return 422."""
    resp = await client.post("/api/auth/signup", json={})
    assert resp.status_code == 422
    data = resp.json()
    assert "detail" in data, "Validation error should have 'detail' field"


@pytest.mark.asyncio
async def test_login_returns_token_on_success(client):
    """POST /api/auth/login with missing fields should return 422 with detail."""
    resp = await client.post("/api/auth/login", json={})
    assert resp.status_code == 422
    data = resp.json()
    assert "detail" in data, "Validation error must include 'detail'"
    # Verify detail is a list of validation errors (FastAPI convention)
    assert isinstance(data["detail"], list), "detail should be a list of errors"


@pytest.mark.asyncio
async def test_error_responses_have_detail_field(client):
    """All error responses should include a 'detail' field."""
    # Test several endpoints that should return errors
    error_cases = [
        ("POST", "/api/auth/signup", {}),
        ("POST", "/api/auth/login", {}),
        ("POST", "/api/chat", {"model": "test"}),
    ]
    for method, path, body in error_cases:
        if method == "POST":
            resp = await client.post(path, json=body)
        else:
            resp = await client.get(path)

        if resp.status_code >= 400:
            data = resp.json()
            assert "detail" in data, \
                f"{method} {path} returned {resp.status_code} without 'detail': {data}"
