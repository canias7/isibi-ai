"""Request logging middleware — logs method, path, status, and duration."""
from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("request_logger")

# Paths to skip logging (health checks, static files)
_SKIP_PREFIXES = ("/health", "/uploads", "/static")


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request with method, path, status code, and duration in ms."""

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Don't log health checks or static file requests
        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = int((time.perf_counter() - start) * 1000)

        logger.info(
            "%s %s %s %dms",
            request.method,
            path,
            response.status_code,
            duration_ms,
        )

        return response
