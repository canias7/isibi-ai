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
import logging
from typing import Optional

# Disable rate limiting during tests
RATE_LIMIT_DISABLED = os.getenv("TESTING", "").lower() in ("1", "true", "yes")

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────

# (prefix, max_requests_per_minute) — checked in order, first match wins
RATE_LIMITS: list[tuple[str, int]] = [
    ("/api/auth/", 10),
    ("/api/chat/", 5),
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


def _get_client_ip(request: Request) -> str:
    """Extract the client IP, respecting X-Forwarded-For if present."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
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


class RateLimiterMiddleware(BaseHTTPMiddleware):
    """Rate limiter with Redis support, falling back to in-memory."""

    async def dispatch(self, request: Request, call_next):
        global _request_counter

        # Skip rate limiting during tests
        if RATE_LIMIT_DISABLED:
            return await call_next(request)

        path = request.url.path
        ip = _get_client_ip(request)
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
                    return JSONResponse(
                        status_code=429,
                        content={
                            "detail": "Too many requests. Please try again later.",
                            "retry_after": WINDOW_SECONDS,
                        },
                        headers={"Retry-After": str(WINDOW_SECONDS)},
                    )
                return await call_next(request)
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
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please try again later.",
                    "retry_after": retry_after,
                },
                headers={"Retry-After": str(retry_after)},
            )

        # Record this request
        timestamps.append(now)
        _request_log[key] = timestamps

        response = await call_next(request)
        return response
