import pytest


@pytest.mark.asyncio
async def test_list_projects_requires_auth(client):
    """GET /api/projects without auth should return 401 or 403."""
    response = await client.get("/api/projects")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_project_requires_auth(client):
    """POST /api/projects without auth should return 401 or 403."""
    response = await client.post("/api/projects", json={
        "prompt": "Build me a CRM",
    })
    assert response.status_code in (401, 403)
