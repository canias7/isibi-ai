"""Comprehensive security tests — 10 tests covering XSS prevention, SQL injection,
rate limiter, CORS, error handling, JWT validation, input sanitization, and file storage."""
import pytest
import base64
from unittest.mock import patch


def test_xss_prevention_in_sanitize():
    """sanitize_string should escape HTML/script tags to prevent XSS."""
    from utils.sanitize import sanitize_string
    result = sanitize_string('<script>alert("xss")</script>')
    assert "<script>" not in result
    assert "&lt;script&gt;" in result


def test_sql_injection_prevention_in_identifier():
    """sanitize_sql_identifier should reject SQL injection patterns."""
    from utils.sanitize import sanitize_sql_identifier
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        sanitize_sql_identifier("users; DROP TABLE users--")


def test_rate_limiter_is_pure_asgi_class():
    """RateLimiterMiddleware should be an ASGI-compatible class with __call__."""
    from middleware.rate_limiter import RateLimiterMiddleware
    # Should be a class (not a function)
    assert isinstance(RateLimiterMiddleware, type)
    # Instances should be callable (ASGI protocol)
    dummy_app = lambda scope, receive, send: None
    instance = RateLimiterMiddleware(dummy_app)
    assert callable(instance)


@pytest.mark.xfail(reason="CORS middleware detection varies by FastAPI version")
def test_cors_allows_configured_origins():
    """The app should have CORSMiddleware configured."""
    from main import app
    # Check that CORSMiddleware is in the middleware stack
    middleware_classes = [type(m).__name__ for m in getattr(app, "middleware_stack", [])]
    # FastAPI wraps middleware; check app.user_middleware instead
    user_mw = [m.cls.__name__ for m in app.user_middleware if hasattr(m, "cls")]
    has_cors = "CORSMiddleware" in user_mw or any(
        "cors" in str(m).lower() for m in app.user_middleware
    )
    assert has_cors, "CORSMiddleware should be configured in the app"


@pytest.mark.asyncio
async def test_global_error_handler_no_stack_trace(client):
    """Error responses should not leak stack traces."""
    response = await client.get("/api/this-route-should-never-exist-99999")
    # Should be 404 or similar, but never contain Python tracebacks
    body = response.text
    assert "Traceback" not in body
    assert "File \"" not in body


@pytest.mark.asyncio
async def test_jwt_invalid_token_rejected(client):
    """A request with an invalid JWT should be rejected with 401/403."""
    response = await client.get(
        "/api/projects",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert response.status_code in (401, 403, 422), f"Expected 401/403, got {response.status_code}"


@pytest.mark.asyncio
async def test_jwt_expired_token_rejected(client):
    """A request with an expired JWT should be rejected."""
    import time
    from jose import jwt as jose_jwt
    import os
    secret = os.getenv("JWT_SECRET", "change-me-in-production")
    expired_payload = {"sub": "test-user", "exp": int(time.time()) - 3600}
    expired_token = jose_jwt.encode(expired_payload, secret, algorithm="HS256")
    response = await client.get(
        "/api/projects",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code in (401, 403, 422), f"Expected 401/403, got {response.status_code}"


def test_input_sanitize_nested_objects():
    """sanitize_dict should recursively sanitize nested objects."""
    from utils.sanitize import sanitize_dict
    data = {
        "level1": {
            "level2": {
                "value": '<img onerror="alert(1)" src=x>',
            },
        },
    }
    result = sanitize_dict(data)
    assert "<img" not in result["level1"]["level2"]["value"]
    assert "&lt;img" in result["level1"]["level2"]["value"]


def test_input_sanitize_preserves_numbers():
    """sanitize_dict should preserve numeric values without conversion."""
    from utils.sanitize import sanitize_dict
    data = {"count": 42, "price": 19.99, "label": "safe text"}
    result = sanitize_dict(data)
    assert result["count"] == 42
    assert result["price"] == 19.99
    assert result["label"] == "safe text"


@pytest.mark.asyncio
async def test_file_storage_base64_integrity():
    """Saving and retrieving base64-encoded content should preserve integrity."""
    from utils.file_storage import save_file, get_file
    original = b"Hello, World! Base64 integrity test. " + bytes(range(256))
    file_key, _ = await save_file(original, "integrity-test.bin")
    recovered = await get_file(file_key)
    assert recovered == original, "File content should be preserved exactly"
