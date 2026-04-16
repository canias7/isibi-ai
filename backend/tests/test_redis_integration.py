"""Redis integration and pure-ASGI middleware tests — 10 tests."""
import os
import pytest


# ── Module import tests ──────────────────────────────────────────────────────

def test_redis_client_module_imports():
    """The utils.redis_client module should import without error."""
    from utils import redis_client
    assert hasattr(redis_client, "get_redis")
    assert hasattr(redis_client, "close_redis")
    assert hasattr(redis_client, "REDIS_URL")


@pytest.mark.asyncio
async def test_get_redis_returns_none_without_url(monkeypatch):
    """get_redis() should return None when REDIS_URL is not set."""
    # Reset module-level state so we get a fresh check
    import utils.redis_client as rc
    monkeypatch.setattr(rc, "REDIS_URL", None)
    monkeypatch.setattr(rc, "_redis_client", None)
    result = await rc.get_redis()
    assert result is None


@pytest.mark.asyncio
async def test_redis_client_close_no_error():
    """close_redis() should not raise even when no connection exists."""
    from utils.redis_client import close_redis
    import utils.redis_client as rc
    # Ensure no client is set
    original = rc._redis_client
    rc._redis_client = None
    await close_redis()
    # Restore
    rc._redis_client = original


# ── Pure ASGI middleware validation ──────────────────────────────────────────

def test_rate_limiter_is_pure_asgi():
    """RateLimiterMiddleware must be a pure ASGI class, not BaseHTTPMiddleware."""
    from middleware.rate_limiter import RateLimiterMiddleware
    from starlette.middleware.base import BaseHTTPMiddleware
    assert not issubclass(RateLimiterMiddleware, BaseHTTPMiddleware), \
        "RateLimiterMiddleware should NOT inherit from BaseHTTPMiddleware"
    # Verify it has the ASGI interface
    mw = RateLimiterMiddleware(app=None)
    assert callable(mw)
    assert hasattr(mw, "__call__")


def test_cache_middleware_is_pure_asgi():
    """ResponseCacheMiddleware must be a pure ASGI class, not BaseHTTPMiddleware."""
    from middleware.cache import ResponseCacheMiddleware
    from starlette.middleware.base import BaseHTTPMiddleware
    assert not issubclass(ResponseCacheMiddleware, BaseHTTPMiddleware), \
        "ResponseCacheMiddleware should NOT inherit from BaseHTTPMiddleware"
    mw = ResponseCacheMiddleware(app=None)
    assert callable(mw)


def test_request_logger_is_pure_asgi():
    """RequestLoggerMiddleware must be a pure ASGI class, not BaseHTTPMiddleware."""
    from middleware.request_logger import RequestLoggerMiddleware
    from starlette.middleware.base import BaseHTTPMiddleware
    assert not issubclass(RequestLoggerMiddleware, BaseHTTPMiddleware), \
        "RequestLoggerMiddleware should NOT inherit from BaseHTTPMiddleware"
    mw = RequestLoggerMiddleware(app=None)
    assert callable(mw)


# ── Health endpoint Redis status ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_shows_redis_status(client):
    """GET /health should include a redis field in the response."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "redis" in data, "Health endpoint should report redis status"
    assert data["redis"] in ("connected", "disconnected", "not configured")


# ── Fallback behaviour when Redis is unavailable ────────────────────────────

def test_session_store_no_redis_fallback():
    """The app_sessions module should import cleanly even without Redis."""
    from routes import app_sessions  # noqa
    # Just verifying import succeeds — sessions module should not crash without Redis


def test_presence_no_redis_fallback():
    """Presence helpers should return empty list when Redis is unavailable."""
    from routes.collab_editing import _presence_list
    # With no connections in the room, presence_list should return []
    result = _presence_list("nonexistent-project-id")
    assert result == []


# ── Environment variable ────────────────────────────────────────────────────

def test_redis_url_env_var_read():
    """The redis_client module should read REDIS_URL from the environment."""
    import utils.redis_client as rc
    # In test env, REDIS_URL is typically not set — the module should handle that
    if os.getenv("REDIS_URL"):
        assert rc.REDIS_URL is not None
    else:
        # Module reads env at import time; with no REDIS_URL it should be None/empty
        assert rc.REDIS_URL is None or rc.REDIS_URL == ""
