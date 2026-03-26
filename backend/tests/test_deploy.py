import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_deploy_requires_auth(client):
    """POST /api/projects/{id}/deploy without auth should return 401 or 403."""
    fake_id = "00000000-0000-0000-0000-000000000001"
    response = await client.post(f"/api/projects/{fake_id}/deploy")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_deploy_nonexistent_project(client):
    """POST /api/projects/{fake_uuid}/deploy should return 401/403 (no auth) or 404."""
    fake_id = "00000000-0000-0000-0000-ffffffffffff"
    response = await client.post(f"/api/projects/{fake_id}/deploy")
    assert response.status_code in (401, 403, 404)
