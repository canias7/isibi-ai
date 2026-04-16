"""Real-time collaboration and model existence tests — 10 tests."""
import pytest


FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000099"
FAKE_UUID = "00000000-0000-0000-0000-000000000000"


# ── WebSocket route and auth ────────────────────────────────────────────────

def test_websocket_route_exists():
    """The ws_router from collab_editing should have a /ws/projects/{project_id} route."""
    from routes.collab_editing import ws_router
    ws_routes = [r.path for r in ws_router.routes]
    assert "/ws/projects/{project_id}" in ws_routes, (
        f"Expected /ws/projects/{{project_id}} in ws_router routes, got {ws_routes}"
    )


@pytest.mark.asyncio
async def test_presence_endpoint_no_auth(client):
    """GET /api/collab/{project_id}/presence without auth should return 401/403/404/429."""
    response = await client.get(f"/api/collab/{FAKE_PROJECT_ID}/presence")
    assert response.status_code in (401, 403, 404, 429), (
        f"Expected auth error, got {response.status_code}"
    )


def test_collab_module_imports():
    """The collab_editing module should import cleanly with all expected exports."""
    from routes import collab_editing
    assert hasattr(collab_editing, "router")
    assert hasattr(collab_editing, "ws_router")
    assert hasattr(collab_editing, "collab_ws")
    assert hasattr(collab_editing, "_broadcast")
    assert hasattr(collab_editing, "_presence_list")


@pytest.mark.asyncio
async def test_presence_returns_list():
    """_presence_list should always return a list."""
    from routes.collab_editing import _presence_list
    result = _presence_list("some-project-id")
    assert isinstance(result, list)


def test_websocket_requires_token():
    """The collab_ws endpoint should be defined with a token query parameter."""
    import inspect
    from routes.collab_editing import collab_ws
    sig = inspect.signature(collab_ws)
    param_names = list(sig.parameters.keys())
    assert "token" in param_names, (
        f"collab_ws should accept a 'token' parameter, got {param_names}"
    )


# ── Share / workspace members endpoint ───────────────────────────────────────

@pytest.mark.asyncio
async def test_share_modal_endpoint_exists(client):
    """POST /api/workspaces/{id}/members without auth should be rejected (not 404)."""
    response = await client.post(
        f"/api/workspaces/{FAKE_UUID}/members",
        json={"email": "test@example.com", "role": "editor"},
    )
    # Should get auth error, not 404 (proves route exists)
    assert response.status_code in (401, 403, 422, 429), (
        f"Expected auth error for workspace members endpoint, got {response.status_code}"
    )


# ── Model existence tests ───────────────────────────────────────────────────

def test_record_lock_model_exists():
    """The AppRecordLock model should exist and have expected columns."""
    from models.app_record_lock import AppRecordLock
    assert hasattr(AppRecordLock, "__tablename__")
    assert hasattr(AppRecordLock, "id")
    assert hasattr(AppRecordLock, "project_id")
    assert hasattr(AppRecordLock, "record_id")
    assert hasattr(AppRecordLock, "locked_by")


def test_record_view_model_exists():
    """The AppRecordView model should exist and have expected columns."""
    from models.app_record_view import AppRecordView
    assert hasattr(AppRecordView, "__tablename__")
    assert hasattr(AppRecordView, "id")
    assert hasattr(AppRecordView, "project_id")


def test_shared_view_model_exists():
    """The AppSharedView model should exist and have expected columns."""
    from models.app_shared_view import AppSharedView
    assert hasattr(AppSharedView, "__tablename__")
    assert hasattr(AppSharedView, "id")
    assert hasattr(AppSharedView, "project_id")
    assert hasattr(AppSharedView, "entity")
    assert hasattr(AppSharedView, "is_public")


def test_integration_model_exists():
    """The AppIntegration model should exist and have expected columns."""
    from models.app_integration import AppIntegration
    assert hasattr(AppIntegration, "__tablename__")
    assert hasattr(AppIntegration, "id")
    assert hasattr(AppIntegration, "project_id")
    assert hasattr(AppIntegration, "type")
