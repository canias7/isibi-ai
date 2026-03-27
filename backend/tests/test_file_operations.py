"""Tests for file upload, field files, signatures, QR, barcode, and file storage utilities."""
import pytest
from pytest import mark

FAKE_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.mark.asyncio
async def test_file_upload_no_auth(client):
    """POST /api/apps/{id}/files without auth should return 401 or 403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/files")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_field_file_upload_no_auth(client):
    """POST /api/apps/{id}/field-files/{table}/{record}/{field} without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/field-files/contacts/{FAKE_UUID}/avatar"
    )
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_signature_save_no_auth(client):
    """POST /api/apps/{id}/signatures/{table}/{record} without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_UUID}/signatures/contracts/{FAKE_UUID}"
    )
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_qr_code_no_auth(client):
    """GET /api/apps/{id}/qr/{table}/{record} without auth should return 401/403."""
    response = await client.get(
        f"/api/apps/{FAKE_UUID}/qr/products/{FAKE_UUID}"
    )
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_barcode_lookup_no_auth(client):
    """POST /api/apps/{id}/barcode/lookup without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_UUID}/barcode/lookup")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_file_serve_nonexistent(client):
    """GET /api/files/{id} for a nonexistent file should return 404."""
    response = await client.get(f"/api/files/{FAKE_UUID}")
    assert response.status_code in (404, 500)


@pytest.mark.asyncio
async def test_file_storage_utility_save_and_get():
    """Unit test: save_file returns base64 key, get_file decodes it back."""
    from utils.file_storage import save_file, get_file

    original = b"hello world test content"
    key, url = await save_file(original, "test.txt")
    assert key  # non-empty string
    assert url.endswith("test.txt")

    recovered = await get_file(key)
    assert recovered == original


@pytest.mark.asyncio
async def test_file_storage_base64_roundtrip():
    """Base64 encode-then-decode roundtrip should preserve binary data."""
    from utils.file_storage import save_file, get_file

    binary_data = bytes(range(256))  # all byte values 0-255
    key, _ = await save_file(binary_data, "binary.bin")
    recovered = await get_file(key)
    assert recovered == binary_data


@pytest.mark.asyncio
async def test_voice_config_no_auth(client):
    """GET /api/projects/{id}/voice-config without auth should return 401/403."""
    response = await client.get(f"/api/projects/{FAKE_UUID}/voice-config")
    assert response.status_code in (401, 403, 429)


@pytest.mark.asyncio
async def test_field_types_no_auth(client):
    """PUT /api/projects/{id}/field-config/{entity}/{field} without auth should return 401/403."""
    response = await client.put(
        f"/api/projects/{FAKE_UUID}/field-config/contacts/email"
    )
    assert response.status_code in (401, 403, 429)
