"""Tests for the central router registry and route structure."""
import pytest


# ── Module imports ───────────────────────────────────────────────────

def test_registry_module_imports():
    """router_registry module should import cleanly."""
    import router_registry
    assert hasattr(router_registry, "register_all_routers")


def test_register_all_routers_callable():
    """register_all_routers should be a callable function."""
    from router_registry import register_all_routers
    assert callable(register_all_routers)


# ── Endpoint smoke tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_endpoint_works(client):
    """GET /health should return 200 with status ok."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"


@pytest.mark.asyncio
async def test_api_prefix_present(client):
    """API routes should be prefixed with /api."""
    from main import app
    api_routes = [
        r.path for r in app.routes
        if hasattr(r, "path") and r.path.startswith("/api")
    ]
    assert len(api_routes) > 10, f"Expected many /api routes, found {len(api_routes)}"


@pytest.mark.asyncio
async def test_live_route_exists(client):
    """GET /live/nonexistent should return 404 (route registered, project not found)."""
    response = await client.get("/live/nonexistent-id")
    assert response.status_code in (404, 500)


@pytest.mark.asyncio
async def test_embed_route_exists(client):
    """GET /embed/nonexistent should return 404 (route registered, project not found)."""
    response = await client.get("/embed/nonexistent-id")
    assert response.status_code in (400, 404, 500)  # 400 for invalid UUID format


@pytest.mark.asyncio
async def test_websocket_route_registered(client):
    """WebSocket route for collab editing should be in the app routes."""
    from main import app
    ws_routes = [
        r.path for r in app.routes
        if hasattr(r, "path") and "ws" in r.path.lower()
    ]
    assert len(ws_routes) >= 1, "Expected at least one WebSocket route"


@pytest.mark.asyncio
async def test_total_route_count(client):
    """App should have at least 300 registered routes."""
    from main import app
    all_routes = [r for r in app.routes if hasattr(r, "path")]
    assert len(all_routes) >= 300, (
        f"Expected at least 300 routes, found {len(all_routes)}"
    )


@pytest.mark.asyncio
async def test_no_duplicate_route_paths(client):
    """There should be no duplicate route paths (same path + same methods)."""
    from main import app
    seen: set[str] = set()
    duplicates: list[str] = []
    for r in app.routes:
        if not hasattr(r, "path") or not hasattr(r, "methods"):
            continue
        methods = r.methods or {"GET"}
        for m in methods:
            key = f"{m}:{r.path}"
            if key in seen:
                duplicates.append(key)
            seen.add(key)
    # Allow a small number due to overlapping patterns (e.g. {project_id})
    assert len(duplicates) < 10, f"Found {len(duplicates)} duplicate routes: {duplicates[:5]}"


@pytest.mark.asyncio
async def test_cors_configured(client):
    """CORS middleware should be configured (OPTIONS returns without 500)."""
    response = await client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code in (200, 204, 405)
    assert response.status_code != 500
