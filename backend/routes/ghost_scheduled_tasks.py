from __future__ import annotations

"""
User-scoped scheduled tasks for the mobile app.

Mobile flow:
  GET  /api/ghost/scheduled-tasks         — list mine
  POST /api/ghost/scheduled-tasks/sync    — replace my full list (mobile is source of truth)
  POST /api/ghost/scheduled-tasks/{id}/run-now — manually trigger for testing
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models.ghost_scheduled_task import GhostScheduledTask
from routes.ghost_auth import verify_ghost_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/scheduled-tasks", tags=["ghost-scheduled-tasks"])


def _auth(authorization: str) -> dict:
    return verify_ghost_token(authorization.replace("Bearer ", ""))


# ── Schemas ───────────────────────────────────────────────────────────────

class ScheduledTaskBody(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=128)
    label: str = Field(..., min_length=1, max_length=200)
    command: str = Field(..., min_length=1, max_length=4000)
    schedule: str = Field(..., min_length=1, max_length=200)
    enabled: bool = True
    agent_id: Optional[str] = Field(None, max_length=128)
    agent_name: Optional[str] = Field(None, max_length=200)
    agent_system_prompt: Optional[str] = Field(None, max_length=8000)


class ScheduledTaskSyncBody(BaseModel):
    tasks: List[ScheduledTaskBody]


def _serialize(t: GhostScheduledTask) -> dict:
    return {
        "id": str(t.id),
        "client_id": t.client_id,
        "label": t.label,
        "command": t.command,
        "schedule": t.schedule,
        "enabled": t.enabled,
        "agent_id": t.agent_id,
        "agent_name": t.agent_name,
        "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
        "last_result": t.last_result,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("")
async def list_tasks(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    payload = _auth(authorization)
    email = payload["email"]
    result = await db.execute(
        select(GhostScheduledTask).where(GhostScheduledTask.user_email == email)
    )
    tasks = result.scalars().all()
    return {"items": [_serialize(t) for t in tasks]}


@router.post("/sync")
async def sync_tasks(
    body: ScheduledTaskSyncBody,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace the user's full task list with the given one. The mobile app is source of truth."""
    payload = _auth(authorization)
    email = payload["email"]

    # Hard cap to prevent abuse
    if len(body.tasks) > 100:
        raise HTTPException(status_code=400, detail="Too many tasks (max 100)")

    # Delete existing
    await db.execute(delete(GhostScheduledTask).where(GhostScheduledTask.user_email == email))

    for incoming in body.tasks:
        t = GhostScheduledTask(
            client_id=incoming.client_id,
            user_email=email,
            label=incoming.label,
            command=incoming.command,
            schedule=incoming.schedule,
            enabled=incoming.enabled,
            agent_id=incoming.agent_id,
            agent_name=incoming.agent_name,
            agent_system_prompt=incoming.agent_system_prompt,
        )
        db.add(t)

    await db.commit()
    logger.info("Synced %d scheduled tasks for %s", len(body.tasks), email)
    return {"synced": len(body.tasks)}


@router.post("/{task_id}/run-now")
async def run_task_now(
    task_id: str,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a task immediately for testing (bypasses schedule)."""
    payload = _auth(authorization)
    email = payload["email"]

    result = await db.execute(
        select(GhostScheduledTask).where(
            GhostScheduledTask.user_email == email,
        )
    )
    tasks = result.scalars().all()
    task = next((t for t in tasks if str(t.id) == task_id or t.client_id == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from worker.ghost_task_executor import execute_ghost_task
    result_text = await execute_ghost_task(task, db)
    task.last_run_at = datetime.now(timezone.utc)
    task.last_result = result_text[:2000] if result_text else None
    await db.commit()

    return {"success": True, "result": result_text}
