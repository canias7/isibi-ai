from __future__ import annotations
"""
Preview Event Manager — manages per-project asyncio queues for SSE streaming.

Usage:
    from generator.preview_events import emit_event, get_queue, cleanup_queue

    # Producer side (in generator/orchestrator):
    await emit_event(project_id, "status", {"phase": "generating", "progress": 30})

    # Consumer side (in routes/preview_stream):
    queue = get_queue(project_id)
    event = await queue.get()
"""

import asyncio
from typing import Dict, Optional

_queues: Dict[str, asyncio.Queue] = {}


def get_queue(project_id: str) -> asyncio.Queue:
    """Get or create the event queue for a project."""
    if project_id not in _queues:
        _queues[project_id] = asyncio.Queue()
    return _queues[project_id]


async def emit_event(project_id: str, event_type: str, data: dict) -> None:
    """Push an event onto the project's queue."""
    q = get_queue(project_id)
    await q.put({"event": event_type, "data": data})


def cleanup_queue(project_id: str) -> None:
    """Remove a project's queue when streaming is done."""
    _queues.pop(project_id, None)
