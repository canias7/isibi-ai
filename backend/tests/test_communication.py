"""Communication & security endpoint tests — 10 tests covering messaging, comments,
record files, activity log, email inbox, AI query, 2FA, sessions, and GDPR."""
import pytest


FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000099"


@pytest.mark.asyncio
async def test_messaging_no_auth(client):
    """POST /api/apps/{id}/messages without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/messages",
        json={"to": "user@example.com", "body": "Hello"},
    )
    assert response.status_code in (401, 403, 422), f"Expected 401/403/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_messaging_unread_no_auth(client):
    """GET /api/apps/{id}/messages without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/messages")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_comments_no_auth(client):
    """GET /api/projects/{id}/comments without auth should return 401/403."""
    response = await client.get(f"/api/projects/{FAKE_PROJECT_ID}/comments")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_record_files_no_auth(client):
    """GET /api/apps/{id}/files/tasks/1 without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/files/tasks/1")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_activity_log_no_auth(client):
    """GET /api/apps/{id}/activity/tasks/1 without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/activity/tasks/1")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_email_inbox_no_auth(client):
    """GET /api/apps/{id}/emails without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/emails")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_ai_query_no_auth(client):
    """POST /api/apps/{id}/ai/query without auth should return 401/403."""
    response = await client.post(
        f"/api/apps/{FAKE_PROJECT_ID}/ai/query",
        json={"query": "How many users?"},
    )
    assert response.status_code in (401, 403, 422), f"Expected 401/403/422, got {response.status_code}"


@pytest.mark.asyncio
async def test_app_2fa_no_auth(client):
    """POST /api/apps/{id}/auth/2fa/setup without auth should return 401/403."""
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/auth/2fa/setup")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_sessions_no_auth(client):
    """GET /api/apps/{id}/sessions without auth should return 401/403."""
    response = await client.get(f"/api/apps/{FAKE_PROJECT_ID}/sessions")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_gdpr_no_auth(client):
    """POST /api/apps/{id}/gdpr/export/{user_id} without auth should return 401/403."""
    fake_user_id = "00000000-0000-0000-0000-000000000001"
    response = await client.post(f"/api/apps/{FAKE_PROJECT_ID}/gdpr/export/{fake_user_id}")
    assert response.status_code in (401, 403), f"Expected 401/403, got {response.status_code}"
