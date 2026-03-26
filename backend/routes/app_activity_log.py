from __future__ import annotations
"""
Activity Log — track changes on individual records in generated apps.

Routes:
  POST /api/apps/{project_id}/activity                        — log an activity
  GET  /api/apps/{project_id}/activity/{table}/{record_id}    — get activities for a record
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from routes.app_auth import get_current_app_user
from models.app_activity_entry import AppActivityEntry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Activity Log"])


# ── Schemas ──────────────────────────────────────────────────────────

class LogActivityRequest(BaseModel):
    table: str
    record_id: str
    action: str
    field: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    user_name: Optional[str] = None


# ── Auth helper ──────────────────────────────────────────────────────

async def _require_access(
    project_id: uuid.UUID,
    db: AsyncSession,
    org_id: Optional[uuid.UUID] = None,
    app_user: Optional[dict] = None,
):
    if app_user and app_user.get("project_id") == project_id:
        return
    if org_id:
        from generator.orchestrator import _get_project
        await _get_project(db, project_id, org_id)
        return
    raise HTTPException(status_code=403, detail="Access denied")


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/activity", status_code=201)
async def log_activity(
    project_id: uuid.UUID,
    body: LogActivityRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Log an activity entry for a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    entry = AppActivityEntry(
        project_id=project_id,
        table_name=body.table,
        record_id=body.record_id,
        action=body.action,
        field_name=body.field,
        old_value=body.old_value,
        new_value=body.new_value,
        user_name=body.user_name,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
        "table": entry.table_name,
        "record_id": entry.record_id,
        "action": entry.action,
        "field": entry.field_name,
        "old_value": entry.old_value,
        "new_value": entry.new_value,
        "user_name": entry.user_name,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@router.get("/{project_id}/activity/{table}/{record_id}")
async def get_record_activity(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get activity log for a specific record, sorted by newest first."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppActivityEntry)
        .where(
            AppActivityEntry.project_id == project_id,
            AppActivityEntry.table_name == table,
            AppActivityEntry.record_id == record_id,
        )
        .order_by(AppActivityEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    entries = result.scalars().all()

    return [
        {
            "id": str(e.id),
            "table": e.table_name,
            "record_id": e.record_id,
            "action": e.action,
            "field": e.field_name,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "user_name": e.user_name,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]
