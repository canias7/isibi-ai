from __future__ import annotations

"""
Scheduled Tasks for Apps — CRUD for cron-based tasks on projects.

Endpoints:
  GET    /api/projects/{id}/scheduled-tasks            — list
  POST   /api/projects/{id}/scheduled-tasks            — create
  PATCH  /api/projects/{id}/scheduled-tasks/{task_id}  — update
  DELETE /api/projects/{id}/scheduled-tasks/{task_id}  — delete
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from models.scheduled_task import ScheduledTask

router = APIRouter(prefix="/projects", tags=["scheduled-tasks"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateScheduledTaskBody(BaseModel):
    name: str
    cron_expression: str
    task_type: str  # "webhook", "email_report", "data_cleanup"
    config: Optional[dict] = None
    is_active: bool = True


class UpdateScheduledTaskBody(BaseModel):
    name: Optional[str] = None
    cron_expression: Optional[str] = None
    task_type: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

VALID_TASK_TYPES = {"webhook", "email_report", "data_cleanup"}


def _task_to_dict(t: ScheduledTask) -> dict:
    return {
        "id": str(t.id),
        "project_id": str(t.project_id),
        "name": t.name,
        "cron_expression": t.cron_expression,
        "task_type": t.task_type,
        "config": t.config,
        "is_active": t.is_active,
        "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
        "next_run_at": t.next_run_at.isoformat() if t.next_run_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/scheduled-tasks")
async def list_scheduled_tasks(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List scheduled tasks for a project."""
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    result = await db.execute(
        select(ScheduledTask).where(
            ScheduledTask.project_id == project_id,
            ScheduledTask.org_id == org_id,
        )
    )
    tasks = result.scalars().all()

    return {"data": [_task_to_dict(t) for t in tasks]}


@router.post("/{project_id}/scheduled-tasks")
async def create_scheduled_task(
    project_id: uuid.UUID,
    body: CreateScheduledTaskBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a scheduled task for a project."""
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if body.task_type not in VALID_TASK_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task_type. Choose from: {', '.join(VALID_TASK_TYPES)}",
        )

    task = ScheduledTask(
        project_id=project_id,
        org_id=org_id,
        name=body.name,
        cron_expression=body.cron_expression,
        task_type=body.task_type,
        config=body.config,
        is_active=body.is_active,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    return _task_to_dict(task)


@router.patch("/{project_id}/scheduled-tasks/{task_id}")
async def update_scheduled_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    body: UpdateScheduledTaskBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a scheduled task."""
    result = await db.execute(
        select(ScheduledTask).where(
            ScheduledTask.id == task_id,
            ScheduledTask.project_id == project_id,
            ScheduledTask.org_id == org_id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled task not found")

    if body.name is not None:
        task.name = body.name
    if body.cron_expression is not None:
        task.cron_expression = body.cron_expression
    if body.task_type is not None:
        if body.task_type not in VALID_TASK_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid task_type. Choose from: {', '.join(VALID_TASK_TYPES)}",
            )
        task.task_type = body.task_type
    if body.config is not None:
        task.config = body.config
    if body.is_active is not None:
        task.is_active = body.is_active

    task.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(task)

    return _task_to_dict(task)


@router.delete("/{project_id}/scheduled-tasks/{task_id}")
async def delete_scheduled_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a scheduled task."""
    result = await db.execute(
        select(ScheduledTask).where(
            ScheduledTask.id == task_id,
            ScheduledTask.project_id == project_id,
            ScheduledTask.org_id == org_id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled task not found")

    await db.delete(task)
    await db.commit()

    return {"detail": "Scheduled task deleted"}
