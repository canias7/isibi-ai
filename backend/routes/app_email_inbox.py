from __future__ import annotations
"""
Email Inbox — store and display emails linked to app records.

Routes:
  POST /api/apps/{project_id}/emails                          — log an email
  GET  /api/apps/{project_id}/emails/{table}/{record_id}      — list emails for a record
  GET  /api/apps/{project_id}/emails                          — list all emails (paginated)
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.app_email import AppEmail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Email Inbox"])


# ── Schemas ──────────────────────────────────────────────────────────

class LogEmailRequest(BaseModel):
    from_email: str
    to_email: str
    subject: str
    body: str
    record_table: Optional[str] = None
    record_id: Optional[str] = None
    direction: str = "inbound"  # inbound / outbound


# ── Helpers ──────────────────────────────────────────────────────────

def _serialize_email(e: AppEmail) -> dict:
    return {
        "id": str(e.id),
        "project_id": str(e.project_id),
        "from_email": e.from_email,
        "to_email": e.to_email,
        "subject": e.subject,
        "body": e.body,
        "record_table": e.record_table,
        "record_id": e.record_id,
        "direction": e.direction,
        "is_read": e.is_read,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/emails", status_code=201)
async def log_email(
    project_id: uuid.UUID,
    body: LogEmailRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Log an email linked to a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    if body.direction not in ("inbound", "outbound"):
        raise HTTPException(status_code=400, detail="direction must be 'inbound' or 'outbound'")

    email = AppEmail(
        project_id=project_id,
        from_email=body.from_email,
        to_email=body.to_email,
        subject=body.subject,
        body=body.body,
        record_table=body.record_table,
        record_id=body.record_id,
        direction=body.direction,
    )
    db.add(email)
    await db.commit()
    await db.refresh(email)

    return _serialize_email(email)


@router.get("/{project_id}/emails/{table}/{record_id}")
async def list_emails_for_record(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all emails linked to a specific record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppEmail)
        .where(
            AppEmail.project_id == project_id,
            AppEmail.record_table == table,
            AppEmail.record_id == record_id,
        )
        .order_by(AppEmail.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    emails = result.scalars().all()

    return {"emails": [_serialize_email(e) for e in emails]}


@router.get("/{project_id}/emails")
async def list_all_emails(
    project_id: uuid.UUID,
    direction: Optional[str] = Query(None, pattern="^(inbound|outbound)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all emails for the project with optional direction filter."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    query = select(AppEmail).where(AppEmail.project_id == project_id)

    if direction:
        query = query.where(AppEmail.direction == direction)

    # Get total count
    count_query = select(func.count(AppEmail.id)).where(AppEmail.project_id == project_id)
    if direction:
        count_query = count_query.where(AppEmail.direction == direction)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(AppEmail.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    emails = result.scalars().all()

    return {
        "emails": [_serialize_email(e) for e in emails],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
