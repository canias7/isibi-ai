from __future__ import annotations
"""
Structured error responses for the API.

Usage:
    from utils.errors import AppError

    raise AppError(code="INVALID_INPUT", message="Name is required", status_code=400)

Register the global handler in main.py:
    from utils.errors import global_exception_handler
    app.add_exception_handler(Exception, global_exception_handler)
"""

import logging
import traceback

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(HTTPException):
    """Structured application error with machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict | None = None,
    ):
        self.code = code
        self.message = message
        super().__init__(
            status_code=status_code,
            detail={
                "error": code,
                "message": message,
                "details": details or {},
            },
        )


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler that returns structured JSON and never leaks stack traces."""
    # Let HTTPException (including AppError) pass through with their own status/detail
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "HTTP_ERROR", **detail},
        )

    # Unexpected errors: log the traceback but return a generic message
    logger.error(
        "Unhandled exception on %s %s: %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred. Please try again later.",
        },
    )
