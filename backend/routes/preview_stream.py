from __future__ import annotations
"""
Real-time Preview via Server-Sent Events (SSE).

Routes:
  GET /api/projects/{project_id}/preview/stream — SSE endpoint for live generation updates

Event types sent to the client:
  - status        : { phase: "generating", progress: 30 }
  - partial_spec  : { entities: [...] }
  - complete      : { spec: {...} }
  - error         : { message: "..." }
"""

import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from auth import get_current_org_id
from generator.preview_events import get_queue, cleanup_queue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Preview Stream"])

# Timeout for waiting on queue events (seconds)
QUEUE_TIMEOUT = 300  # 5 minutes


async def _event_generator(project_id: str) -> AsyncGenerator[dict, None]:
    """Yield SSE-formatted events from the project's queue."""
    queue = get_queue(project_id)

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=QUEUE_TIMEOUT)
            except asyncio.TimeoutError:
                # Send a keepalive comment to prevent connection drop
                yield {"event": "ping", "data": "{}"}
                continue

            event_type = event.get("event", "message")
            data = event.get("data", {})

            yield {
                "event": event_type,
                "data": json.dumps(data),
            }

            # If this is a terminal event, stop streaming
            if event_type in ("complete", "error"):
                break
    finally:
        cleanup_queue(project_id)


@router.get("/{project_id}/preview/stream")
async def preview_stream(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """SSE endpoint for real-time preview updates during AI generation.

    The client connects to this endpoint and receives events as the spec
    is being generated. Events include progress updates, partial specs,
    and the final complete spec or an error.
    """
    return EventSourceResponse(
        _event_generator(str(project_id)),
        media_type="text/event-stream",
    )
