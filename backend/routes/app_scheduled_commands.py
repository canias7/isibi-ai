from __future__ import annotations

"""
Scheduled Commands — let app users schedule recurring AI commands.

Routes:
  POST   /api/apps/{project_id}/scheduled-commands              — create
  GET    /api/apps/{project_id}/scheduled-commands              — list all for user
  PUT    /api/apps/{project_id}/scheduled-commands/{id}         — update
  DELETE /api/apps/{project_id}/scheduled-commands/{id}         — remove
  POST   /api/apps/{project_id}/scheduled-commands/{id}/run-now — execute immediately
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from routes.app_auth import get_current_app_user
from models.app_scheduled_command import AppScheduledCommand

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Scheduled Commands"])

VALID_SCHEDULE_TYPES = {"daily", "weekly", "monthly", "once"}
VALID_DAYS = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
}


# ── Schemas ──────────────────────────────────────────────────────────

class ScheduledCommandCreateBody(BaseModel):
    command: str
    schedule_type: str  # daily, weekly, monthly, once
    schedule_time: str  # "17:00" (24h format)
    schedule_day: Optional[str] = None  # "monday" for weekly, "1"-"31" for monthly
    timezone: str = "UTC"


class ScheduledCommandUpdateBody(BaseModel):
    command: Optional[str] = None
    schedule_type: Optional[str] = None
    schedule_time: Optional[str] = None
    schedule_day: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None


# ── Helpers ──────────────────────────────────────────────────────────

def _serialize(cmd: AppScheduledCommand) -> dict:
    return {
        "id": str(cmd.id),
        "project_id": str(cmd.project_id),
        "user_id": str(cmd.user_id),
        "command": cmd.command,
        "schedule_type": cmd.schedule_type,
        "schedule_time": cmd.schedule_time,
        "schedule_day": cmd.schedule_day,
        "timezone": cmd.timezone,
        "enabled": cmd.enabled,
        "last_run_at": cmd.last_run_at.isoformat() if cmd.last_run_at else None,
        "last_result": cmd.last_result,
        "created_at": cmd.created_at.isoformat() if cmd.created_at else None,
    }


def _validate_time(t: str) -> bool:
    """Validate HH:MM format."""
    parts = t.split(":")
    if len(parts) != 2:
        return False
    try:
        h, m = int(parts[0]), int(parts[1])
        return 0 <= h <= 23 and 0 <= m <= 59
    except ValueError:
        return False


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/{project_id}/scheduled-commands", status_code=status.HTTP_201_CREATED)
async def create_scheduled_command(
    project_id: str,
    body: ScheduledCommandCreateBody,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new scheduled command."""
    # Validate
    if body.schedule_type not in VALID_SCHEDULE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid schedule_type '{body.schedule_type}'. Must be one of: {', '.join(sorted(VALID_SCHEDULE_TYPES))}",
        )
    if not _validate_time(body.schedule_time):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid schedule_time '{body.schedule_time}'. Use HH:MM format (24h).",
        )
    if body.schedule_type == "weekly" and body.schedule_day:
        if body.schedule_day.lower() not in VALID_DAYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid schedule_day '{body.schedule_day}'. Must be a day name (e.g. monday).",
            )
    if body.schedule_type == "monthly" and body.schedule_day:
        try:
            day_num = int(body.schedule_day)
            if day_num < 1 or day_num > 31:
                raise ValueError
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid schedule_day '{body.schedule_day}'. Must be 1-31 for monthly.",
            )
    if not body.command or not body.command.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Command text is required.",
        )

    user_id = claims.get("sub")
    cmd = AppScheduledCommand(
        project_id=uuid.UUID(project_id),
        user_id=uuid.UUID(user_id),
        command=body.command.strip(),
        schedule_type=body.schedule_type,
        schedule_time=body.schedule_time,
        schedule_day=body.schedule_day.lower() if body.schedule_day else None,
        timezone=body.timezone or "UTC",
        enabled=True,
    )
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)
    return _serialize(cmd)


@router.get("/{project_id}/scheduled-commands")
async def list_scheduled_commands(
    project_id: str,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """List all scheduled commands for this app user."""
    user_id = claims.get("sub")
    result = await db.execute(
        select(AppScheduledCommand).where(
            AppScheduledCommand.project_id == uuid.UUID(project_id),
            AppScheduledCommand.user_id == uuid.UUID(user_id),
        ).order_by(AppScheduledCommand.created_at.desc())
    )
    commands = result.scalars().all()
    return {"items": [_serialize(c) for c in commands]}


@router.put("/{project_id}/scheduled-commands/{command_id}")
async def update_scheduled_command(
    project_id: str,
    command_id: str,
    body: ScheduledCommandUpdateBody,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a scheduled command (change time, enable/disable, etc.)."""
    user_id = claims.get("sub")
    result = await db.execute(
        select(AppScheduledCommand).where(
            AppScheduledCommand.id == uuid.UUID(command_id),
            AppScheduledCommand.project_id == uuid.UUID(project_id),
            AppScheduledCommand.user_id == uuid.UUID(user_id),
        )
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled command not found")

    if body.command is not None:
        cmd.command = body.command.strip()
    if body.schedule_type is not None:
        if body.schedule_type not in VALID_SCHEDULE_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid schedule_type: {body.schedule_type}")
        cmd.schedule_type = body.schedule_type
    if body.schedule_time is not None:
        if not _validate_time(body.schedule_time):
            raise HTTPException(status_code=400, detail=f"Invalid schedule_time: {body.schedule_time}")
        cmd.schedule_time = body.schedule_time
    if body.schedule_day is not None:
        cmd.schedule_day = body.schedule_day.lower()
    if body.timezone is not None:
        cmd.timezone = body.timezone
    if body.enabled is not None:
        cmd.enabled = body.enabled

    await db.commit()
    await db.refresh(cmd)
    return _serialize(cmd)


@router.delete("/{project_id}/scheduled-commands/{command_id}")
async def delete_scheduled_command(
    project_id: str,
    command_id: str,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a scheduled command."""
    user_id = claims.get("sub")
    result = await db.execute(
        select(AppScheduledCommand).where(
            AppScheduledCommand.id == uuid.UUID(command_id),
            AppScheduledCommand.project_id == uuid.UUID(project_id),
            AppScheduledCommand.user_id == uuid.UUID(user_id),
        )
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled command not found")

    await db.delete(cmd)
    await db.commit()
    return {"detail": "Scheduled command deleted"}


@router.post("/{project_id}/scheduled-commands/{command_id}/run-now")
async def run_scheduled_command_now(
    project_id: str,
    command_id: str,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a scheduled command immediately (for testing)."""
    user_id = claims.get("sub")
    result = await db.execute(
        select(AppScheduledCommand).where(
            AppScheduledCommand.id == uuid.UUID(command_id),
            AppScheduledCommand.project_id == uuid.UUID(project_id),
            AppScheduledCommand.user_id == uuid.UUID(user_id),
        )
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled command not found")

    # Execute the command
    from worker.command_executor import execute_command
    result_text = await execute_command(str(cmd.project_id), cmd.command, db)

    # Update last run info
    from datetime import datetime, timezone
    cmd.last_run_at = datetime.now(timezone.utc)
    cmd.last_result = result_text
    await db.commit()
    await db.refresh(cmd)

    return {
        "detail": "Command executed",
        "result": result_text,
        "command": _serialize(cmd),
    }
