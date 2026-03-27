"""
Response Cache Middleware — in-memory cache for GET responses.

Caches GET responses by (path, query_string, org_id) with short TTLs.
Automatically invalidated when POST/PATCH/DELETE hits the same path prefix.
Adds Cache-Control and X-Cache headers.
"""

from __future__ import annotations

import time
import hashlib
import logging
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# ── Skip patterns — never cache these ────────────────────────────────
_SKIP_PREFIXES = ("/api/chat", "/api/auth", "/health", "/live/")

# ── TTL configuration ────────────────────────────────────────────────
_TTL_SPEC_CONFIG = 30  # seconds for spec/config endpoints
_TTL_LIST = 10         # seconds for list/data endpoints

_SPEC_CONFIG_PATTERNS = ("/schema", "/spec", "/config", "/settings", "/preferences")

# ── In-memory cache store ────────────────────────────────────────────
# key → (response_body, status_code, headers_list, expires_at)
_cache: dict[str, tuple[bytes, int, list[tuple[str, str]], float]] = {}

# path_prefix → set of cache keys (for invalidation)
_prefix_index: dict[str, set[str]] = {}

_MAX_CACHE_ENTRIES = 2000


def _should_skip(path: str) -> bool:
    """Check if this path should skip caching."""
    for prefix in _SKIP_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def _get_ttl(path: str) -> int:
    """Determine TTL based on path pattern."""
    for pattern in _SPEC_CONFIG_PATTERNS:
        if pattern in path:
            return _TTL_SPEC_CONFIG
    return _TTL_LIST


def _make_cache_key(path: str, query_string: str, org_id: str) -> str:
    """Create a cache key from request components."""
    raw = f"{path}|{query_string}|{org_id}"
    return hashlib.md5(raw.encode()).hexdigest()


def _get_path_prefix(path: str) -> str:
    """
    Extract the meaningful path prefix for invalidation.
    e.g. /api/apps/uuid/data/contacts → /api/apps/uuid/data/contacts
    """
    # For /api/apps/{id}/data/{table}/{row_id}, use up to table level
    parts = path.rstrip("/").split("/")
    # Keep up to 6 parts: /api/apps/{id}/data/{table}
    if len(parts) > 6:
        return "/".join(parts[:6])
    return path.rstrip("/")


def _evict_expired() -> None:
    """Remove expired entries from cache."""
    now = time.monotonic()
    expired_keys = [k for k, v in _cache.items() if v[3] < now]
    for key in expired_keys:
        _cache.pop(key, None)
        # Clean up prefix index
        for prefix_keys in _prefix_index.values():
            prefix_keys.discard(key)


def _invalidate_prefix(path: str) -> None:
    """Invalidate all cache entries matching the path prefix."""
    prefix = _get_path_prefix(path)
    keys_to_remove = _prefix_index.pop(prefix, set())
    for key in keys_to_remove:
        _cache.pop(key, None)
    if keys_to_remove:
        logger.debug("Cache invalidated %d entries for prefix %s", len(keys_to_remove), prefix)


class ResponseCacheMiddleware(BaseHTTPMiddleware):
    """
    Middleware that caches GET responses in memory with short TTLs.

    - GET requests: check cache first, store response if miss
    - POST/PATCH/DELETE: invalidate cached entries for the same path prefix
    - Adds X-Cache: HIT/MISS and Cache-Control headers
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        method = request.method.upper()

        # Skip non-cacheable paths
        if _should_skip(path):
            return await call_next(request)

        # On write operations, invalidate cache for this path prefix
        if method in ("POST", "PATCH", "PUT", "DELETE"):
            _invalidate_prefix(path)
            return await call_next(request)

        # Only cache GET requests
        if method != "GET":
            return await call_next(request)

        # Extract org_id from auth header for cache key isolation
        org_id = ""
        auth_header = request.headers.get("authorization", "")
        if auth_header:
            # Use a hash of the auth token as org identifier
            org_id = hashlib.md5(auth_header.encode()).hexdigest()[:12]

        query_string = str(request.url.query) if request.url.query else ""
        cache_key = _make_cache_key(path, query_string, org_id)

        # Check cache
        now = time.monotonic()
        cached = _cache.get(cache_key)
        if cached is not None:
            body, status_code, headers_list, expires_at = cached
            if expires_at > now:
                # Cache HIT
                response = Response(
                    content=body,
                    status_code=status_code,
                    media_type="application/json",
                )
                for header_name, header_value in headers_list:
                    response.headers[header_name] = header_value
                response.headers["X-Cache"] = "HIT"
                response.headers["Cache-Control"] = f"private, max-age={_get_ttl(path)}"
                return response
            else:
                # Expired — remove
                _cache.pop(cache_key, None)

        # Cache MISS — call downstream
        response = await call_next(request)

        # Only cache successful JSON responses
        if response.status_code == 200:
            # Read response body
            body_parts: list[bytes] = []
            async for chunk in response.body_iterator:
                if isinstance(chunk, str):
                    body_parts.append(chunk.encode())
                else:
                    body_parts.append(chunk)
            body = b"".join(body_parts)

            # Collect response headers to preserve
            preserve_headers = []
            for name, value in response.headers.items():
                if name.lower() in ("content-type", "content-length"):
                    continue
                preserve_headers.append((name, value))

            # Store in cache
            ttl = _get_ttl(path)
            expires_at = now + ttl

            # Evict if at capacity
            if len(_cache) >= _MAX_CACHE_ENTRIES:
                _evict_expired()
                # If still full, remove oldest 10%
                if len(_cache) >= _MAX_CACHE_ENTRIES:
                    oldest_keys = sorted(_cache.keys(), key=lambda k: _cache[k][3])[:_MAX_CACHE_ENTRIES // 10]
                    for k in oldest_keys:
                        _cache.pop(k, None)

            _cache[cache_key] = (body, response.status_code, preserve_headers, expires_at)

            # Index by path prefix for invalidation
            prefix = _get_path_prefix(path)
            if prefix not in _prefix_index:
                _prefix_index[prefix] = set()
            _prefix_index[prefix].add(cache_key)

            # Return new response with cache headers
            new_response = Response(
                content=body,
                status_code=response.status_code,
                media_type="application/json",
            )
            for name, value in preserve_headers:
                new_response.headers[name] = value
            new_response.headers["X-Cache"] = "MISS"
            new_response.headers["Cache-Control"] = f"private, max-age={ttl}"
            return new_response

        # Non-200 responses pass through
        response.headers["X-Cache"] = "SKIP"
        return response
