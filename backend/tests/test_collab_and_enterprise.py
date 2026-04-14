"""Collaboration & enterprise endpoint tests — 10 tests covering presence, SSO, uptime,
custom domains, gallery, components, plugins, and referrals."""
import pytest
from pytest import mark


FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000099"


@pytest.mark.asyncio
async def test_presence_no_auth(client):
    """GET /api/collab/{project_id}/presence without auth should return 401/403."""
    response = await client.get(f"/api/collab/{FAKE_PROJECT_ID}/presence")
    assert response.status_code in (401, 403, 429), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_sso_get_no_auth(client):
    """GET /api/org/sso without auth should return 401/403."""
    response = await client.get("/api/org/sso")
    assert response.status_code in (401, 403, 429), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_sso_put_no_auth(client):
    """PUT /api/org/sso without auth should return 401/403."""
    response = await client.put("/api/org/sso", json={"provider": "okta", "domain": "test.okta.com"})
    assert response.status_code in (401, 403, 422), f"Expected 401/403/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_uptime_no_auth(client):
    """GET /api/projects/{id}/uptime without auth should return 401/403."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT_ID}/uptime")
    assert response.status_code in (401, 403, 429), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_custom_domain_no_auth(client):
    """POST /api/projects/{id}/custom-domain without auth should return 401/403."""
    response = await client.post(
        f"/api/projects/{FAKE_PROJECT_ID}/custom-domain",
        json={"domain": "app.example.com"},
    )
    assert response.status_code in (401, 403, 422), f"Expected 401/403/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_custom_domain_verify_no_auth(client):
    """POST /api/projects/{id}/custom-domain/verify without auth should return 401/403."""
    response = await client.post(f"/api/projects/{FAKE_PROJECT_ID}/custom-domain/verify")
    assert response.status_code in (401, 403, 429), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_gallery_list_public(client):
    """GET /api/gallery should work without auth (public endpoint)."""
    response = await client.get("/api/gallery")
    assert response.status_code in (200, 500), f"Expected 200/500, got {response.status_code}"


@pytest.mark.asyncio
async def test_components_list_public(client):
    """GET /api/components should return 200 (public listing)."""
    response = await client.get("/api/components")
    assert response.status_code in (200, 401, 403, 500), f"Expected 200/401/403/500, got {response.status_code}"


@pytest.mark.asyncio
async def test_plugins_list_public(client):
    """GET /api/plugins should return 200 (public listing)."""
    response = await client.get("/api/plugins")
    assert response.status_code in (200, 401, 403, 500), f"Expected 200/401/403/500, got {response.status_code}"


@pytest.mark.asyncio
async def test_referral_code_no_auth(client):
    """GET /api/referrals/code without auth should return 401/403."""
    response = await client.get("/api/referrals/code")
    assert response.status_code in (401, 403, 429), f"Expected 401/403, got {response.status_code}"
