import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_can_build_requires_auth(client):
    """GET /api/billing/can-build without auth should return 401 or 403."""
    response = await client.get("/api/billing/can-build")
    assert response.status_code in (401, 403)
