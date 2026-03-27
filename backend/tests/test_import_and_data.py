"""Tests for import wizard, CSV export, Google Sheets, DB GUI, snapshots, and schema endpoints."""
import pytest

FAKE_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_import_preview_no_auth(client):
    """POST /api/apps/{id}/import/preview without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/import/preview")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_import_execute_no_auth(client):
    """POST /api/apps/{id}/import/execute without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/import/execute")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_csv_export_no_auth(client):
    """GET /api/apps/{id}/data/contacts/export without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/data/contacts/export")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_google_sheets_no_auth(client):
    """POST /api/apps/{id}/import/google-sheets without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/import/google-sheets",
        json={"sheet_url": "https://docs.google.com/spreadsheets/d/fake/edit"},
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_db_gui_tables_no_auth(client):
    """GET /api/apps/{id}/db/tables without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/db/tables")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_db_gui_rows_no_auth(client):
    """GET /api/apps/{id}/db/tables/{table}/rows without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_UUID}/db/tables/contacts/rows")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_snapshot_create_no_auth(client):
    """POST /api/apps/{id}/snapshots without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/snapshots")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_snapshot_restore_no_auth(client):
    """POST /api/apps/{id}/snapshots/{sid}/restore without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/snapshots/{FAKE_UUID}/restore"
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_app_schema_no_auth(client):
    """GET /api/apps/{id}/db/tables/{table}/schema without auth should return 401/403."""
    response = await client.get(
        f"/api/apps/{FAKE_UUID}/db/tables/contacts/schema"
    )
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_duplicate_check_no_auth(client):
    """POST /api/projects/{id}/duplicate-check without auth should return 401/403."""
    response = await client.post(
        f"/api/projects/{FAKE_UUID}/duplicate-check",
        json={"table": "contacts", "field": "email", "value": "test@example.com"},
    )
    assert response.status_code in (401, 403)
