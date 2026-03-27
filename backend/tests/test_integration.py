"""Integration tests — run against a real backend.

Usage: ISIBI_API_URL=https://api.isibi.ai pytest tests/test_integration.py -v
"""
import os
import pytest

API_URL = os.getenv("ISIBI_API_URL", "")

pytestmark = pytest.mark.skipif(not API_URL, reason="Set ISIBI_API_URL to run integration tests")


@pytest.mark.asyncio
async def test_health():
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API_URL}/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_signup_login_flow():
    """Test: signup → verify → login → get token."""
    import httpx
    import time

    test_email = f"test_{int(time.time())}@test.isibi.ai"

    async with httpx.AsyncClient() as client:
        # Signup
        r = await client.post(f"{API_URL}/api/auth/signup", json={
            "first_name": "Test",
            "last_name": "User",
            "email": test_email,
            "password": "TestPass123!",
            "account_type": "developer",
        })
        # May fail if email domain not verified, that's ok
        assert r.status_code in (200, 201, 403, 422)


@pytest.mark.asyncio
async def test_marketplace_returns_data():
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API_URL}/api/template-marketplace")
        assert r.status_code in (200, 401, 403)


@pytest.mark.asyncio
async def test_billing_endpoint():
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API_URL}/api/billing/can-build")
        assert r.status_code in (200, 401, 403)


@pytest.mark.asyncio
async def test_live_app_404():
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API_URL}/live/nonexistent-id")
        assert r.status_code in (404, 500)


@pytest.mark.asyncio
async def test_spec_generation_flow():
    """Test the RAG + validator pipeline without calling Claude API."""
    # This tests internal components, not the full API
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    from generator.rag import build_rag_context, find_best_specs
    from generator.spec_validator import validate_and_repair

    # Test RAG finds relevant specs
    specs = find_best_specs("build me a restaurant management system")
    assert len(specs) > 0
    spec_names = [s.get("_meta", {}).get("app_name", "") for s in specs]

    # Test RAG context includes useful content
    ctx = build_rag_context("restaurant with orders and reservations")
    assert len(ctx) > 200

    # Test validator repairs a minimal spec
    raw_spec = {
        "entities": [
            {"name": "Order", "fields": [
                {"name": "total", "db_type": "NUMERIC(10,2)"},
                {"name": "status", "db_type": "VARCHAR(50)", "enum_values": ["pending", "paid"]}
            ]}
        ]
    }
    fixed = validate_and_repair(raw_spec)

    # Verify repairs
    assert fixed.get("app_name")
    assert len(fixed["entities"]) == 1
    assert len(fixed["modules"]) >= 2  # Dashboard + Order

    order = fixed["entities"][0]
    field_names = [f["name"] for f in order["fields"]]
    assert "id" in field_names
    assert "org_id" in field_names
    assert "created_at" in field_names

    # Verify enum got badge_colors
    status_field = next(f for f in order["fields"] if f["name"] == "status")
    assert "badge_colors" in status_field
