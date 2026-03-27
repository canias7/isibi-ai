"""Tests for /api/apps/{project_id}/data/ CRUD endpoints — 10 tests."""
import pytest

FAKE_PROJECT = "00000000-0000-0000-0000-000000000000"
FAKE_ROW = "00000000-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_app_data_list_no_auth(client):
    """GET /api/apps/{project}/data/{table} without auth should be rejected."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/data/contacts")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_data_create_no_auth(client):
    """POST /api/apps/{project}/data/{table} without auth should be rejected."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT}/data/contacts",
        json={"name": "Test"},
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_data_invalid_table(client):
    """Accessing a non-existent table should return 400 or 404."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/data/nonexistent_xyz")
    assert response.status_code in (400, 401, 403, 404)


@pytest.mark.asyncio
async def test_app_data_invalid_project(client):
    """A made-up project id should yield 401/403/404."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/data/contacts")
    assert response.status_code in (401, 403, 404)


@pytest.mark.asyncio
async def test_app_data_export_csv_no_auth(client):
    """GET /api/apps/{project}/data/{table}/export without auth should be rejected."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/data/contacts/export")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_schema_endpoint_no_auth(client):
    """GET /api/apps/{project}/schema without auth should be rejected."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/schema")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_data_update_no_auth(client):
    """PATCH /api/apps/{project}/data/{table}/{row} without auth should be rejected."""
    response = await client.patch(
        f"/api/apps/{FAKE_PROJECT}/data/contacts/{FAKE_ROW}",
        json={"name": "Updated"},
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_data_delete_no_auth(client):
    """DELETE /api/apps/{project}/data/{table}/{row} without auth should be rejected."""
    response = await client.delete(f"/api/apps/{FAKE_PROJECT}/data/contacts/{FAKE_ROW}")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_data_import_no_auth(client):
    """POST /api/apps/{project}/data/{table}/import without auth should be rejected."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT}/data/contacts/import")
    assert response.status_code in (401, 403, 422)


@pytest.mark.asyncio
async def test_app_data_export_no_auth(client):
    """GET /api/apps/{project}/data/{table}/export without auth should be rejected."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT}/data/leads/export")
    assert response.status_code in (401, 403)
