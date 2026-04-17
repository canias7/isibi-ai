"""Request logging middleware — logs method, path, status, and duration."""
from __future__ import annotations

import logging
import sys
import time

logger = logging.getLogger("request_logger")

# Paths to skip logging (health checks, static files)
_SKIP_PREFIXES = ("/health", "/uploads", "/static")


class RequestLoggerMiddleware:
    """Pure ASGI middleware: log every HTTP request with method, path, status code, and duration in ms."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")

        # Don't log health checks or static file requests
        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_code = 0

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
            await send(message)

        await self.app(scope, receive, send_wrapper)

        duration_ms = int((time.perf_counter() - start) * 1000)
        method = scope.get("method", "?")

        # Log via standard logger AND raw stdout — belt-and-braces so Render
        # always surfaces the line regardless of logging config.
        line = f"[req] {method} {path} {status_code} {duration_ms}ms"
        logger.info(line)
        print(line, file=sys.stdout, flush=True)
