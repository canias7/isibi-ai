import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_signup_requires_fields(client):
    response = await client.post("/api/auth/signup", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_requires_email(client):
    response = await client.post("/api/auth/login", json={})
    assert response.status_code == 422
