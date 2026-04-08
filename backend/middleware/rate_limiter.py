from __future__ import annotations
"""
Rate limiter middleware for FastAPI with Redis support.

Uses Redis when REDIS_URL is configured, falls back to in-memory dict otherwise.

Tracks requests per IP per minute with configurable limits per route prefix.

Default limits:
  - Auth endpoints (/api/auth/*)        : 10 req/min
  - AI chat endpoint (/api/chat/*)      : 5 req/min
  - All other API endpoints (/api/*)    : 60 req/min

Usage — add to main.py:

    from middleware.rate_limiter import RateLimiterMiddleware

    app.add_middleware(RateLimiterMiddleware)
"""

import os
import time
import json
import logging
from typing import Optional

# Disable rate limiting during tests
RATE_LIMIT_DISABLED = os.getenv("TESTING", "").lower() in ("1", "true", "yes")

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────

# (prefix, max_requests_per_minute) — checked in order, first match wins
RATE_LIMITS: list[tuple[str, int]] = [
    ("/api/auth/login", 5),
    ("/api/auth/signup", 5),
    ("/api/auth/forgot-password", 3),
    ("/api/auth/reset-password", 5),
    ("/api/auth/", 10),
    ("/api/chat/", 5),
    # Ghost Mode endpoints
    ("/api/ghost/login", 5),
    ("/api/ghost/signup", 5),
    ("/api/ghost/forgot", 3),
    ("/api/ghost/reset", 5),
    ("/api/ghost/connectors", 20),
    ("/api/ghost/chat/sync", 10),
    ("/api/ghost/", 30),
    ("/api/apps/", 30),       # Generated app data endpoints
    ("/api/projects/", 40),   # Project management
    ("/api/", 60),
]

DEFAULT_LIMIT = 60  # fallback for unmatched paths

WINDOW_SECONDS = 60

# Cleanup old entries every N requests to prevent memory growth
_CLEANUP_INTERVAL = 500


# ── In-memory storage (fallback) ────────────────────────────────────

# key = (ip, route_prefix), value = list of timestamps
_request_log: dict[tuple[str, str], list[float]] = {}
_request_counter = 0


def _get_client_ip(scope: dict) -> str:
    """Extract the client IP from ASGI scope, respecting X-Forwarded-For if present."""
    headers = dict(scope.get("headers", []))
    forwarded = headers.get(b"x-forwarded-for")
    if forwarded:
        return forwarded.decode().split(",")[0].strip()
    client = scope.get("client")
    if client:
        return client[0]
    return "unknown"


def _get_rate_limit(path: str) -> tuple[str, int]:
    """Return (matched_prefix, limit) for the given request path."""
    for prefix, limit in RATE_LIMITS:
        if path.startswith(prefix):
            return prefix, limit
    return "/", DEFAULT_LIMIT


def _cleanup_old_entries(now: float) -> None:
    """Remove timestamp entries older than the window."""
    cutoff = now - WINDOW_SECONDS
    keys_to_delete = []
    for key, timestamps in _request_log.items():
        # Filter out old timestamps
        fresh = [t for t in timestamps if t > cutoff]
        if fresh:
            _request_log[key] = fresh
        else:
            keys_to_delete.append(key)
    for key in keys_to_delete:
        del _request_log[key]


# ── Redis rate limiting ─────────────────────────────────────────────

async def _check_rate_limit_redis(redis_client, ip: str, prefix: str, limit: int) -> bool:
    """Check rate limit using Redis INCR with EXPIRE. Returns True if allowed."""
    key = f"rl:{ip}:{prefix}:{int(time.time()) // 60}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 60)
    return count <= limit


async def _get_redis_count(redis_client, ip: str, prefix: str) -> int:
    """Get current request count from Redis for retry-after calculation."""
    key = f"rl:{ip}:{prefix}:{int(time.time()) // 60}"
    count = await redis_client.get(key)
    return int(count) if count else 0


async def _send_json_response(send, status_code: int, body: dict, extra_headers: list[tuple[bytes, bytes]] | None = None):
    """Send a JSON response via raw ASGI send."""
    body_bytes = json.dumps(body).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body_bytes)).encode()),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": headers,
    })
    await send({
        "type": "http.response.body",
        "body": body_bytes,
    })


class RateLimiterMiddleware:
    """Pure ASGI rate limiter with Redis support, falling back to in-memory."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        global _request_counter

        # Skip rate limiting during tests
        if RATE_LIMIT_DISABLED:
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        ip = _get_client_ip(scope)
        now = time.time()

        prefix, limit = _get_rate_limit(path)

        # Try Redis first
        try:
            from utils.redis_client import get_redis
            redis_client = await get_redis()
        except Exception:
            redis_client = None

        if redis_client:
            try:
                allowed = await _check_rate_limit_redis(redis_client, ip, prefix, limit)
                if not allowed:
                    logger.warning(
                        "Rate limit exceeded (Redis): ip=%s prefix=%s limit=%d",
                        ip, prefix, limit,
                    )
                    await _send_json_response(
                        send, 429,
                        {
                            "detail": "Too many requests. Please try again later.",
                            "retry_after": WINDOW_SECONDS,
                        },
                        extra_headers=[(b"retry-after", str(WINDOW_SECONDS).encode())],
                    )
                    return
                await self.app(scope, receive, send)
                return
            except Exception as e:
                logger.warning("Redis rate limit check failed: %s. Falling back to in-memory.", e)

        # ── In-memory fallback ──
        _request_counter += 1
        if _request_counter % _CLEANUP_INTERVAL == 0:
            _cleanup_old_entries(now)

        key = (ip, prefix)

        # Get current window timestamps
        cutoff = now - WINDOW_SECONDS
        timestamps = _request_log.get(key, [])
        timestamps = [t for t in timestamps if t > cutoff]

        if len(timestamps) >= limit:
            retry_after = int(WINDOW_SECONDS - (now - timestamps[0])) + 1
            logger.warning(
                "Rate limit exceeded: ip=%s prefix=%s count=%d limit=%d",
                ip, prefix, len(timestamps), limit,
            )
            await _send_json_response(
                send, 429,
                {
                    "detail": "Too many requests. Please try again later.",
                    "retry_after": retry_after,
                },
                extra_headers=[(b"retry-after", str(retry_after).encode())],
            )
            return

        # Record this request
        timestamps.append(now)
        _request_log[key] = timestamps

        await self.app(scope, receive, send)
