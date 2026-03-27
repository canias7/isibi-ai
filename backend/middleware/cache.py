"""
Response Cache Middleware — Redis-backed with in-memory fallback.

Caches GET responses by (path, query_string, org_id) with short TTLs.
Automatically invalidated when POST/PATCH/DELETE hits the same path prefix.
Adds Cache-Control and X-Cache headers.

When Redis is available:
  - Uses SETEX with auto-expiry (no manual cleanup needed)
  - Key format: cache:{md5_hash}
  - Stores JSON-serialized response data

Falls back to in-memory dict when Redis is unavailable.
"""

from __future__ import annotations

import time
import json
import hashlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Skip patterns — never cache these ────────────────────────────────
_SKIP_PREFIXES = ("/api/chat", "/api/auth", "/health", "/live/")

# ── TTL configuration ────────────────────────────────────────────────
_TTL_SPEC_CONFIG = 30  # seconds for spec/config endpoints
_TTL_LIST = 10         # seconds for list/data endpoints

_SPEC_CONFIG_PATTERNS = ("/schema", "/spec", "/config", "/settings", "/preferences")

# ── In-memory cache store (fallback) ────────────────────────────────
# key -> (response_body, status_code, headers_list, expires_at)
_cache: dict[str, tuple[bytes, int, list[tuple[bytes, bytes]], float]] = {}

# path_prefix -> set of cache keys (for invalidation)
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
    e.g. /api/apps/uuid/data/contacts -> /api/apps/uuid/data/contacts
    """
    # For /api/apps/{id}/data/{table}/{row_id}, use up to table level
    parts = path.rstrip("/").split("/")
    # Keep up to 6 parts: /api/apps/{id}/data/{table}
    if len(parts) > 6:
        return "/".join(parts[:6])
    return path.rstrip("/")


def _evict_expired() -> None:
    """Remove expired entries from in-memory cache."""
    now = time.monotonic()
    expired_keys = [k for k, v in _cache.items() if v[3] < now]
    for key in expired_keys:
        _cache.pop(key, None)
        # Clean up prefix index
        for prefix_keys in _prefix_index.values():
            prefix_keys.discard(key)


def _invalidate_prefix(path: str) -> None:
    """Invalidate all in-memory cache entries matching the path prefix."""
    prefix = _get_path_prefix(path)
    keys_to_remove = _prefix_index.pop(prefix, set())
    for key in keys_to_remove:
        _cache.pop(key, None)
    if keys_to_remove:
        logger.debug("Cache invalidated %d entries for prefix %s", len(keys_to_remove), prefix)


# ── Redis helpers ────────────────────────────────────────────────────

async def _redis_cache_get(redis_client, cache_key: str):
    """Try to get cached response from Redis. Returns (body, status_code, headers) or None."""
    try:
        raw = await redis_client.get(f"cache:{cache_key}")
        if raw is None:
            return None
        data = json.loads(raw)
        return (
            data["body"].encode("latin-1"),
            data["status_code"],
            [(h[0].encode(), h[1].encode()) for h in data["headers"]],
        )
    except Exception as e:
        logger.debug("Redis cache GET failed: %s", e)
        return None


async def _redis_cache_set(redis_client, cache_key: str, body: bytes, status_code: int,
                            headers: list[tuple[bytes, bytes]], ttl: int):
    """Store response in Redis with TTL."""
    try:
        data = json.dumps({
            "body": body.decode("latin-1"),
            "status_code": status_code,
            "headers": [[h[0].decode(), h[1].decode()] for h in headers],
        })
        await redis_client.setex(f"cache:{cache_key}", ttl, data)
    except Exception as e:
        logger.debug("Redis cache SET failed: %s", e)


async def _redis_invalidate_prefix(redis_client, path: str):
    """Invalidate Redis cache keys matching a path prefix pattern."""
    prefix = _get_path_prefix(path)
    idx_key = f"cache_idx:{hashlib.md5(prefix.encode()).hexdigest()}"
    try:
        members = await redis_client.smembers(idx_key)
        if members:
            pipe = redis_client.pipeline()
            for cache_key in members:
                pipe.delete(f"cache:{cache_key}")
            pipe.delete(idx_key)
            await pipe.execute()
            logger.debug("Redis cache invalidated %d entries for prefix %s", len(members), prefix)
    except Exception as e:
        logger.debug("Redis cache invalidation failed: %s", e)


async def _redis_index_add(redis_client, cache_key: str, path: str, ttl: int):
    """Add cache key to the prefix index set in Redis."""
    prefix = _get_path_prefix(path)
    idx_key = f"cache_idx:{hashlib.md5(prefix.encode()).hexdigest()}"
    try:
        await redis_client.sadd(idx_key, cache_key)
        await redis_client.expire(idx_key, ttl + 10)  # slightly longer than cache TTL
    except Exception as e:
        logger.debug("Redis index add failed: %s", e)


def _get_header(headers_list: list, name: bytes) -> bytes | None:
    """Get a header value from ASGI headers list."""
    for h_name, h_value in headers_list:
        if h_name.lower() == name.lower():
            return h_value
    return None


async def _send_cached_response(send, body: bytes, status_code: int,
                                 headers: list[tuple[bytes, bytes]], ttl: int, hit: bool):
    """Send a cached response via raw ASGI."""
    resp_headers = list(headers)
    resp_headers.append((b"x-cache", b"HIT" if hit else b"MISS"))
    resp_headers.append((b"cache-control", f"private, max-age={ttl}".encode()))
    resp_headers.append((b"content-type", b"application/json"))
    resp_headers.append((b"content-length", str(len(body)).encode()))

    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": resp_headers,
    })
    await send({
        "type": "http.response.body",
        "body": body,
    })


class ResponseCacheMiddleware:
    """
    Pure ASGI middleware that caches GET responses with Redis support.

    - GET requests: check cache first, store response if miss
    - POST/PATCH/DELETE: invalidate cached entries for the same path prefix
    - Adds X-Cache: HIT/MISS and Cache-Control headers
    - Falls back to in-memory when Redis is unavailable
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        method = scope.get("method", "GET").upper()

        # Skip non-cacheable paths
        if _should_skip(path):
            await self.app(scope, receive, send)
            return

        # Get Redis client (may be None)
        try:
            from utils.redis_client import get_redis
            redis_client = await get_redis()
        except Exception:
            redis_client = None

        # On write operations, invalidate cache for this path prefix
        if method in ("POST", "PATCH", "PUT", "DELETE"):
            _invalidate_prefix(path)
            if redis_client:
                try:
                    await _redis_invalidate_prefix(redis_client, path)
                except Exception:
                    pass
            await self.app(scope, receive, send)
            return

        # Only cache GET requests
        if method != "GET":
            await self.app(scope, receive, send)
            return

        # Extract org_id from auth header for cache key isolation
        org_id = ""
        headers_raw = dict(scope.get("headers", []))
        auth_header = headers_raw.get(b"authorization", b"")
        if auth_header:
            org_id = hashlib.md5(auth_header).hexdigest()[:12]

        query_string = scope.get("query_string", b"").decode()
        cache_key = _make_cache_key(path, query_string, org_id)
        ttl = _get_ttl(path)

        # ── Check Redis cache first ──
        if redis_client:
            try:
                cached = await _redis_cache_get(redis_client, cache_key)
                if cached is not None:
                    body, status_code, headers_list = cached
                    await _send_cached_response(send, body, status_code, headers_list, ttl, hit=True)
                    return
            except Exception as e:
                logger.debug("Redis cache check failed: %s", e)

        # ── Check in-memory cache ──
        now = time.monotonic()
        cached = _cache.get(cache_key)
        if cached is not None:
            body, status_code, headers_list, expires_at = cached
            if expires_at > now:
                # Cache HIT
                await _send_cached_response(send, body, status_code, headers_list, ttl, hit=True)
                return
            else:
                # Expired — remove
                _cache.pop(cache_key, None)

        # Cache MISS — call downstream, capture response
        response_started = False
        response_status = 0
        response_headers: list[tuple[bytes, bytes]] = []
        body_parts: list[bytes] = []

        async def send_wrapper(message):
            nonlocal response_started, response_status, response_headers

            if message["type"] == "http.response.start":
                response_started = True
                response_status = message.get("status", 200)
                response_headers = list(message.get("headers", []))
                # Add cache headers and forward
                out_headers = list(response_headers)
                out_headers.append((b"x-cache", b"MISS"))
                out_headers.append((b"cache-control", f"private, max-age={ttl}".encode()))
                await send({
                    "type": "http.response.start",
                    "status": response_status,
                    "headers": out_headers,
                })
            elif message["type"] == "http.response.body":
                body_chunk = message.get("body", b"")
                if body_chunk:
                    body_parts.append(body_chunk)
                await send(message)

        await self.app(scope, receive, send_wrapper)

        # Only cache successful JSON responses
        if response_status == 200 and body_parts:
            body = b"".join(body_parts)

            # Collect response headers to preserve (skip content-type/content-length)
            preserve_headers = []
            for name, value in response_headers:
                if name.lower() in (b"content-type", b"content-length"):
                    continue
                preserve_headers.append((name, value))

            # Store in Redis if available
            if redis_client:
                try:
                    await _redis_cache_set(redis_client, cache_key, body,
                                           response_status, preserve_headers, ttl)
                    await _redis_index_add(redis_client, cache_key, path, ttl)
                except Exception as e:
                    logger.debug("Redis cache store failed: %s", e)

            # Also store in in-memory cache
            expires_at = now + ttl

            # Evict if at capacity
            if len(_cache) >= _MAX_CACHE_ENTRIES:
                _evict_expired()
                # If still full, remove oldest 10%
                if len(_cache) >= _MAX_CACHE_ENTRIES:
                    oldest_keys = sorted(_cache.keys(), key=lambda k: _cache[k][3])[:_MAX_CACHE_ENTRIES // 10]
                    for k in oldest_keys:
                        _cache.pop(k, None)

            _cache[cache_key] = (body, response_status, preserve_headers, expires_at)

            # Index by path prefix for invalidation
            prefix = _get_path_prefix(path)
            if prefix not in _prefix_index:
                _prefix_index[prefix] = set()
            _prefix_index[prefix].add(cache_key)
