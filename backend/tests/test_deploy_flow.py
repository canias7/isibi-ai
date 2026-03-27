"""Deploy flow tests — 10 tests covering deploy, live app, manifest, sw, icon, subdomain, embed, health."""
import pytest


@pytest.mark.asyncio
async def test_deploy_no_auth(client):
    """POST /api/projects/{id}/deploy without auth should return 401 or 403."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.post(f"/api/projects/{fake_id}/deploy")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_deploy_nonexistent_project(client):
    """POST /api/projects/{fake}/deploy with no auth should return 401/403 (blocked before 404)."""
    fake_id = "00000000-0000-0000-0000-aaaaaaaaaaaa"
    response = await client.post(f"/api/projects/{fake_id}/deploy")
    assert response.status_code in (401, 403, 404), f"Expected 401/403/404, got {response.status_code}"


@pytest.mark.asyncio
async def test_deploy_status_no_auth(client):
    """GET /api/projects/{id}/deploy/status without auth should return 401 or 403."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/api/projects/{fake_id}/deploy/status")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_live_app_nonexistent_returns_404(client):
    """GET /live/{nonexistent_id} should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/live/{fake_id}")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_live_app_manifest_404(client):
    """GET /live/{nonexistent}/manifest.json should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/live/{fake_id}/manifest.json")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_live_app_sw_404(client):
    """GET /live/{nonexistent}/sw.js should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/live/{fake_id}/sw.js")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_live_app_icon_404(client):
    """GET /live/{nonexistent}/icon.svg should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/live/{fake_id}/icon.svg")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_subdomain_nonexistent_404(client):
    """GET /live/s/{nonexistent_subdomain} should return 404."""
    response = await client.get("/live/s/this-subdomain-does-not-exist-xyz")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_embed_nonexistent_404(client):
    """GET /embed/{nonexistent_id} should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/embed/{fake_id}")
    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.mark.asyncio
async def test_health_returns_ok(client):
    """GET /health should return 200 with status ok."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"
