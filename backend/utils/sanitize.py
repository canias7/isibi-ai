from __future__ import annotations
"""
Input sanitization utilities to prevent XSS and SQL injection.

Usage:
    from utils.sanitize import sanitize_string, sanitize_dict, sanitize_sql_identifier
"""

import re
import html


def sanitize_string(value: str) -> str:
    """Sanitize a string to prevent XSS. Escapes HTML entities."""
    if not isinstance(value, str):
        return value
    # Escape HTML entities
    value = html.escape(value, quote=True)
    # Remove null bytes
    value = value.replace('\x00', '')
    return value


def sanitize_dict(data: dict) -> dict:
    """Recursively sanitize all string values in a dict."""
    if not isinstance(data, dict):
        return data
    result = {}
    for key, value in data.items():
        if isinstance(value, str):
            result[key] = sanitize_string(value)
        elif isinstance(value, dict):
            result[key] = sanitize_dict(value)
        elif isinstance(value, list):
            result[key] = [
                sanitize_dict(v) if isinstance(v, dict)
                else sanitize_string(v) if isinstance(v, str)
                else v
                for v in value
            ]
        else:
            result[key] = value
    return result


_SQL_RESERVED = frozenset({
    "select", "insert", "update", "delete", "drop", "alter", "create",
    "table", "index", "grant", "revoke", "truncate", "exec", "execute",
    "union", "having", "group", "order", "where", "from", "into",
})


def sanitize_sql_identifier(name: str) -> str:
    """Ensure a string is safe to use as a SQL identifier.

    Raises ValueError if the name contains characters outside
    [a-zA-Z0-9_], does not start with a letter or underscore,
    exceeds 128 chars, or is a SQL reserved keyword.
    """
    if not name or len(name) > 128:
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name):
        raise ValueError(f"Invalid SQL identifier: {name}")
    if name.lower() in _SQL_RESERVED:
        raise ValueError(f"SQL reserved keyword cannot be used as identifier: {name}")
    return name
