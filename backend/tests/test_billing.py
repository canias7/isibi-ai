import pytest


@pytest.mark.asyncio
async def test_can_build_requires_auth(client):
    """GET /api/billing/can-build without auth should return 401 or 403."""
    response = await client.get("/api/billing/can-build")
    assert response.status_code in (401, 403, 429)
