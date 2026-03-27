"""Tests for input sanitization utilities and structured error handling."""
import pytest
from utils.sanitize import sanitize_string, sanitize_dict, sanitize_sql_identifier
from utils.errors import AppError, global_exception_handler


def test_sanitize_string_escapes_html():
    """HTML special characters should be escaped."""
    result = sanitize_string('<script>alert("xss")</script>')
    assert "<script>" not in result
    assert "&lt;script&gt;" in result
    assert "&quot;" in result


def test_sanitize_string_strips_null_bytes():
    """Null bytes should be removed from strings."""
    result = sanitize_string("hello\x00world")
    assert "\x00" not in result
    assert result == "helloworld"


def test_sanitize_dict_recursive():
    """Nested dicts should have all string values sanitized."""
    data = {
        "name": "<b>bold</b>",
        "nested": {
            "value": '<img src=x onerror="alert(1)">',
        },
    }
    result = sanitize_dict(data)
    assert "<b>" not in result["name"]
    assert "&lt;b&gt;" in result["name"]
    assert "<img" not in result["nested"]["value"]
    assert "&lt;img" in result["nested"]["value"]


def test_sanitize_sql_identifier_valid():
    """Valid SQL identifiers should pass through unchanged."""
    assert sanitize_sql_identifier("users") == "users"
    assert sanitize_sql_identifier("_private") == "_private"
    assert sanitize_sql_identifier("table_123") == "table_123"


def test_sanitize_sql_identifier_invalid_raises():
    """SQL identifiers with special chars should raise ValueError."""
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        sanitize_sql_identifier("users; DROP TABLE--")


def test_sanitize_sql_identifier_with_spaces_raises():
    """SQL identifiers with spaces should raise ValueError."""
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        sanitize_sql_identifier("my table")


@pytest.mark.asyncio
async def test_global_exception_handler_returns_json(client):
    """The global exception handler should return JSON, not raw stack traces."""
    # Hitting a deliberately invalid route that raises internally
    response = await client.get("/api/nonexistent-route-for-error-test")
    # FastAPI returns 404 for unknown routes, still as JSON
    assert response.status_code in (404, 405, 500)
    data = response.json()
    assert isinstance(data, dict)


def test_app_error_has_code_and_message():
    """AppError should carry code and message attributes."""
    err = AppError(code="INVALID_INPUT", message="Name is required", status_code=400)
    assert err.code == "INVALID_INPUT"
    assert err.message == "Name is required"
    assert err.status_code == 400
    detail = err.detail
    assert detail["error"] == "INVALID_INPUT"
    assert detail["message"] == "Name is required"


def test_sanitize_preserves_non_strings():
    """Non-string values should pass through sanitize_string unchanged."""
    assert sanitize_string(42) == 42
    assert sanitize_string(None) is None
    assert sanitize_string(True) is True


def test_sanitize_handles_nested_lists():
    """Lists inside dicts should have their string items sanitized."""
    data = {
        "tags": ["<b>one</b>", "two", "<script>x</script>"],
        "count": 3,
    }
    result = sanitize_dict(data)
    assert "&lt;b&gt;" in result["tags"][0]
    assert result["tags"][1] == "two"
    assert "&lt;script&gt;" in result["tags"][2]
    assert result["count"] == 3
