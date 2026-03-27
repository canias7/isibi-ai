"""Billing flow tests — 10 tests covering plan, usage, checkout, portal, webhook, can-build."""
import pytest

DENIED = (401, 403, 404, 429)


@pytest.mark.asyncio
async def test_billing_plan_no_auth(client):
    """GET /api/billing/plan without auth should be denied."""
    response = await client.get("/api/billing/plan")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_usage_no_auth(client):
    """GET /api/billing/usage without auth should be denied."""
    response = await client.get("/api/billing/usage")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_checkout_no_auth(client):
    """POST /api/billing/checkout without auth should be denied."""
    response = await client.post("/api/billing/checkout", json={"plan": "pro"})
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_can_build_no_auth(client):
    """GET /api/billing/can-build without auth should be denied."""
    response = await client.get("/api/billing/can-build")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_webhook_no_body(client):
    """POST /api/billing/webhook with no body should return 400 or 422."""
    response = await client.post("/api/billing/webhook")
    assert response.status_code in (400, 422), f"Expected 400/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_plan_endpoint_exists(client):
    """GET /api/billing/plan should not return 404 or 405."""
    response = await client.get("/api/billing/plan")
    assert response.status_code not in (404, 405), f"Endpoint missing: {response.status_code}"


@pytest.mark.asyncio
async def test_billing_usage_endpoint_exists(client):
    """GET /api/billing/usage should not return 404 or 405."""
    response = await client.get("/api/billing/usage")
    assert response.status_code not in (404, 405), f"Endpoint missing: {response.status_code}"


@pytest.mark.asyncio
async def test_billing_checkout_requires_plan(client):
    """POST /api/billing/checkout without auth or plan should be denied or fail validation."""
    response = await client.post("/api/billing/checkout", json={})
    assert response.status_code in (*DENIED, 422), f"Expected denied/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_portal_no_auth(client):
    """POST /api/billing/portal without auth should be denied."""
    response = await client.post("/api/billing/portal")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_billing_webhook_endpoint_exists(client):
    """POST /api/billing/webhook should not return 404 or 405."""
    response = await client.post("/api/billing/webhook")
    assert response.status_code not in (404, 405), f"Endpoint missing: {response.status_code}"
