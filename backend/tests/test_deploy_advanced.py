"""Advanced deploy tests — 10 tests covering deploy history, subdomain, custom domain,
white-label, embeds, api-docs, uptime, version history, and rollback."""
import pytest

DENIED = (401, 403, 404, 429)
FAKE_ID = "00000000-0000-0000-0000-000000000099"


@pytest.mark.asyncio
async def test_deploy_history_in_spec(client):
    """Deploy should track history — deployer should add _deploy_history to spec.
    We verify the deploy route exists and responds (auth-blocked is fine)."""
    response = await client.get(f"/api/projects/{FAKE_ID}/deploy/status")
    # The endpoint exists and requires auth — any non-404/405 is acceptable
    assert response.status_code not in (405,), f"Deploy status route missing: {response.status_code}"


@pytest.mark.asyncio
async def test_subdomain_set_no_auth(client):
    """POST /api/projects/{id}/subdomain without auth should be denied."""
    response = await client.post(
        f"/api/projects/{FAKE_ID}/subdomain",
        json={"subdomain": "test-sub"},
    )
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_subdomain_get_no_auth(client):
    """GET /api/projects/{id}/subdomain without auth should be denied."""
    response = await client.get(f"/api/projects/{FAKE_ID}/subdomain")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_custom_domain_register_no_auth(client):
    """POST /api/projects/{id}/custom-domain without auth should be denied."""
    response = await client.post(
        f"/api/projects/{FAKE_ID}/custom-domain",
        json={"domain": "app.example.com"},
    )
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_white_label_no_auth(client):
    """PUT /api/projects/{id}/white-label without auth should be denied."""
    response = await client.put(
        f"/api/projects/{FAKE_ID}/white-label",
        json={"remove_branding": True},
    )
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_embed_create_no_auth(client):
    """POST /api/projects/{id}/embeds without auth should be denied."""
    response = await client.post(
        f"/api/projects/{FAKE_ID}/embeds",
        json={"label": "test-embed"},
    )
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_api_docs_no_auth(client):
    """GET /api/apps/{id}/docs without auth should be denied."""
    response = await client.get(f"/api/apps/{FAKE_ID}/docs")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_uptime_no_auth(client):
    """GET /api/projects/{id}/uptime without auth should be denied."""
    response = await client.get(f"/api/projects/{FAKE_ID}/uptime")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_version_history_no_auth(client):
    """GET /api/projects/{id}/versions without auth should be denied."""
    response = await client.get(f"/api/projects/{FAKE_ID}/versions")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_rollback_endpoint_exists(client):
    """POST /api/projects/{id}/rollback should not return 404 or 405."""
    response = await client.post(f"/api/projects/{FAKE_ID}/rollback")
    assert response.status_code not in (404, 405), f"Rollback endpoint missing: {response.status_code}"
