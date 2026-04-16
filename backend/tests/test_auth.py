import pytest


@pytest.mark.asyncio
async def test_signup_requires_fields(client):
    response = await client.post("/api/auth/signup", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_requires_email(client):
    response = await client.post("/api/auth/login", json={})
    assert response.status_code == 422
