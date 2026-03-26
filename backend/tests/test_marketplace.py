import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
@pytest.mark.skipif(True, reason="Requires running database - integration test")
async def test_list_marketplace(client):
    """GET /api/template-marketplace should return 200 or auth error."""
    response = await client.get("/api/template-marketplace")
    assert response.status_code in (200, 401, 403)


@pytest.mark.asyncio
@pytest.mark.skipif(True, reason="Requires running database - integration test")
async def test_marketplace_search(client):
    """GET /api/template-marketplace?search=crm should return 200 or auth error."""
    response = await client.get("/api/template-marketplace", params={"search": "crm"})
    assert response.status_code in (200, 401, 403)
