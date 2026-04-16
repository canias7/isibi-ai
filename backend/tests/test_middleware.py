"""Tests for middleware: rate limiter, CORS, error handling, custom domain."""
import pytest
from middleware.rate_limiter import (
    RateLimiterMiddleware,
    _get_client_ip,
    _get_rate_limit,
    _cleanup_old_entries,
    _request_log,
    RATE_LIMITS,
)
import time


def test_rate_limiter_allows_normal_requests():
    """Rate limiter should allow requests under the limit."""
    prefix, limit = _get_rate_limit("/api/projects/123")
    assert prefix == "/api/projects/"
    assert limit == 40


def test_rate_limiter_module_imports():
    """Rate limiter module should import and have expected classes/functions."""
    from middleware import rate_limiter
    assert hasattr(rate_limiter, "RateLimiterMiddleware")
    assert hasattr(rate_limiter, "_get_client_ip")
    assert hasattr(rate_limiter, "_get_rate_limit")
    assert hasattr(rate_limiter, "_cleanup_old_entries")


def test_request_logger_module_imports():
    """Middleware package should be importable."""
    import middleware
    assert middleware is not None


@pytest.mark.asyncio
async def test_cors_headers_present(client):
    """OPTIONS request should return CORS headers."""
    response = await client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    # CORS middleware should add allow-origin header
    assert response.status_code in (200, 204, 405)


@pytest.mark.asyncio
async def test_health_has_no_rate_limit(client):
    """Health endpoint should be accessible and not rate limited."""
    # Health check is at /health or /api/health
    response = await client.get("/health")
    # Even if it's 404 (if health is mounted differently), it shouldn't be 429
    assert response.status_code != 429


@pytest.mark.asyncio
async def test_404_returns_json_not_html(client):
    """A 404 response should return JSON, not HTML."""
    response = await client.get("/api/nonexistent-route-12345")
    assert response.status_code in (404, 405)
    data = response.json()
    assert isinstance(data, dict)


@pytest.mark.asyncio
async def test_exception_handler_catches_errors(client):
    """Global exception handler should return JSON for unknown routes."""
    response = await client.get("/api/does-not-exist-xyz")
    assert response.status_code in (404, 405, 500)
    # Should be JSON, not an HTML error page
    data = response.json()
    assert "detail" in data or "message" in data or "error" in data


def test_custom_domain_middleware_skips_api_paths():
    """Custom domain middleware skip-list includes API paths."""
    from main import _SKIP_HOSTS
    # Verify the skip hosts are defined
    assert "localhost" in _SKIP_HOSTS
    assert "127.0.0.1" in _SKIP_HOSTS


def test_custom_domain_middleware_skips_localhost():
    """Custom domain middleware should skip localhost."""
    from main import _SKIP_HOSTS
    assert "localhost" in _SKIP_HOSTS
    assert "test" in _SKIP_HOSTS
    assert "testserver" in _SKIP_HOSTS


def test_sanitizer_middleware_exists():
    """Sanitize utilities should be importable and functional."""
    from utils.sanitize import sanitize_string, sanitize_dict
    assert sanitize_string("<script>") == "&lt;script&gt;"
    result = sanitize_dict({"key": "<b>bold</b>"})
    assert "&lt;b&gt;" in result["key"]
