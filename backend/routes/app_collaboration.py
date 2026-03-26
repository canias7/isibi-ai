from __future__ import annotations

"""
Collaboration features — Shared Views, Record Locking, and Read Receipts.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_shared_view import AppSharedView
from models.app_record_lock import AppRecordLock
from models.app_record_view import AppRecordView

router = APIRouter(tags=["app-collaboration"])

LOCK_DURATION_MINUTES = 5


# ── Schemas ──────────────────────────────────────────────────────────────────

class SharedViewCreateBody(BaseModel):
    entity: str
    name: str
    user_id: Optional[str] = None
    filters: Optional[dict] = None
    sort: Optional[dict] = None
    columns: Optional[dict] = None
    is_public: bool = False


class RecordLockBody(BaseModel):
    user_id: str


class RecordViewLogBody(BaseModel):
    user_id: str
    user_name: Optional[str] = None


# ── Shared View helpers ──────────────────────────────────────────────────────

def _serialize_view(v: AppSharedView) -> dict:
    return {
        "id": str(v.id),
        "project_id": str(v.project_id),
        "user_id": v.user_id,
        "entity": v.entity,
        "name": v.name,
        "filters": v.filters,
        "sort": v.sort,
        "columns": v.columns,
        "is_public": v.is_public,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _serialize_lock(lock: AppRecordLock) -> dict:
    return {
        "id": str(lock.id),
        "project_id": str(lock.project_id),
        "table_name": lock.table_name,
        "record_id": lock.record_id,
        "locked_by": lock.locked_by,
        "locked_at": lock.locked_at.isoformat() if lock.locked_at else None,
        "expires_at": lock.expires_at.isoformat() if lock.expires_at else None,
    }


def _serialize_record_view(rv: AppRecordView) -> dict:
    return {
        "id": str(rv.id),
        "project_id": str(rv.project_id),
        "table_name": rv.table_name,
        "record_id": rv.record_id,
        "user_name": rv.user_name,
        "user_id": rv.user_id,
        "viewed_at": rv.viewed_at.isoformat() if rv.viewed_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Shared Views
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/apps/{project_id}/shared-views")
async def list_shared_views(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all shared views for a project."""
    result = await db.execute(
        select(AppSharedView).where(
            AppSharedView.project_id == uuid.UUID(project_id),
        ).order_by(AppSharedView.created_at.desc())
    )
    views = result.scalars().all()
    return {"items": [_serialize_view(v) for v in views]}


@router.post("/apps/{project_id}/shared-views", status_code=status.HTTP_201_CREATED)
async def create_shared_view(
    project_id: str,
    body: SharedViewCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new shared view."""
    view = AppSharedView(
        project_id=uuid.UUID(project_id),
        user_id=body.user_id,
        entity=body.entity,
        name=body.name,
        filters=body.filters or {},
        sort=body.sort or {},
        columns=body.columns or {},
        is_public=body.is_public,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return _serialize_view(view)


@router.delete("/apps/{project_id}/shared-views/{view_id}")
async def delete_shared_view(
    project_id: str,
    view_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a shared view."""
    result = await db.execute(
        select(AppSharedView).where(
            AppSharedView.id == uuid.UUID(view_id),
            AppSharedView.project_id == uuid.UUID(project_id),
        )
    )
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared view not found")

    await db.delete(view)
    await db.commit()
    return {"detail": "Shared view deleted"}


# ══════════════════════════════════════════════════════════════════════════════
# Record Locking
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/apps/{project_id}/locks/{table}/{record_id}")
async def lock_record(
    project_id: str,
    table: str,
    record_id: str,
    body: RecordLockBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Lock a record. Auto-expires after 5 minutes."""
    now = datetime.now(timezone.utc)

    # Clean up expired locks first
    await db.execute(
        delete(AppRecordLock).where(
            AppRecordLock.project_id == uuid.UUID(project_id),
            AppRecordLock.expires_at < now,
        )
    )

    # Check if already locked by someone else
    result = await db.execute(
        select(AppRecordLock).where(
            AppRecordLock.project_id == uuid.UUID(project_id),
            AppRecordLock.table_name == table,
            AppRecordLock.record_id == record_id,
            AppRecordLock.expires_at >= now,
        )
    )
    existing = result.scalar_one_or_none()
    if existing and existing.locked_by != body.user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Record is locked by {existing.locked_by} until {existing.expires_at.isoformat()}",
        )

    if existing:
        # Refresh the lock
        existing.locked_at = now
        existing.expires_at = now + timedelta(minutes=LOCK_DURATION_MINUTES)
        await db.commit()
        await db.refresh(existing)
        return _serialize_lock(existing)

    lock = AppRecordLock(
        project_id=uuid.UUID(project_id),
        table_name=table,
        record_id=record_id,
        locked_by=body.user_id,
        locked_at=now,
        expires_at=now + timedelta(minutes=LOCK_DURATION_MINUTES),
    )
    db.add(lock)
    await db.commit()
    await db.refresh(lock)
    return _serialize_lock(lock)


@router.delete("/apps/{project_id}/locks/{table}/{record_id}")
async def unlock_record(
    project_id: str,
    table: str,
    record_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Unlock a record."""
    result = await db.execute(
        select(AppRecordLock).where(
            AppRecordLock.project_id == uuid.UUID(project_id),
            AppRecordLock.table_name == table,
            AppRecordLock.record_id == record_id,
        )
    )
    lock = result.scalar_one_or_none()
    if not lock:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lock found for this record")

    await db.delete(lock)
    await db.commit()
    return {"detail": "Record unlocked"}


@router.get("/apps/{project_id}/locks/{table}/{record_id}")
async def check_lock(
    project_id: str,
    table: str,
    record_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Check if a record is locked."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(AppRecordLock).where(
            AppRecordLock.project_id == uuid.UUID(project_id),
            AppRecordLock.table_name == table,
            AppRecordLock.record_id == record_id,
            AppRecordLock.expires_at >= now,
        )
    )
    lock = result.scalar_one_or_none()
    if not lock:
        return {"locked": False}

    return {"locked": True, "lock": _serialize_lock(lock)}


# ══════════════════════════════════════════════════════════════════════════════
# Read Receipts (Views Log)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/apps/{project_id}/views-log/{table}/{record_id}", status_code=status.HTTP_201_CREATED)
async def log_record_view(
    project_id: str,
    table: str,
    record_id: str,
    body: RecordViewLogBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Log when a user views a record."""
    rv = AppRecordView(
        project_id=uuid.UUID(project_id),
        table_name=table,
        record_id=record_id,
        user_name=body.user_name,
        user_id=body.user_id,
    )
    db.add(rv)
    await db.commit()
    await db.refresh(rv)
    return _serialize_record_view(rv)


@router.get("/apps/{project_id}/views-log/{table}/{record_id}")
async def get_record_views(
    project_id: str,
    table: str,
    record_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get all view logs for a record — who viewed it and when."""
    result = await db.execute(
        select(AppRecordView).where(
            AppRecordView.project_id == uuid.UUID(project_id),
            AppRecordView.table_name == table,
            AppRecordView.record_id == record_id,
        ).order_by(AppRecordView.viewed_at.desc())
    )
    views = result.scalars().all()
    return {"items": [_serialize_record_view(rv) for rv in views]}
