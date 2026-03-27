"""Tests for project settings endpoints — 10 tests."""
import pytest

FAKE_PROJECT = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_branding_get_no_auth(client):
    """GET /api/projects/{project}/branding without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/branding")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_branding_put_no_auth(client):
    """PUT /api/projects/{project}/branding without auth should be rejected."""
    response = await client.put(
        f"/api/projects/{FAKE_PROJECT}/branding",
        json={"logo_url": "https://example.com/logo.png"},
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_roles_list_no_auth(client):
    """GET /api/{project}/roles without auth should be rejected."""
    response = await client.get(f"/api/{FAKE_PROJECT}/roles")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_views_list_no_auth(client):
    """GET /api/projects/{project}/views without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/views")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_subdomain_get_no_auth(client):
    """GET /api/projects/{project}/subdomain without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/subdomain")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_white_label_get_no_auth(client):
    """GET /api/whitelabel without auth should be rejected."""
    response = await client.get("/api/whitelabel")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_embeds_list_no_auth(client):
    """GET /api/projects/{project}/embed without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/embed")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_ip_whitelist_get_no_auth(client):
    """GET /api/projects/{project}/ip-whitelist without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/ip-whitelist")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_encryption_get_no_auth(client):
    """GET /api/projects/{project}/encryption without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/encryption")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_ui_language_get_no_auth(client):
    """GET /api/projects/{project}/ui-language without auth should be rejected."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT}/ui-language")
    assert response.status_code in (401, 403)
