from __future__ import annotations
"""
Audit Log API — track and query user/org activity.

Routes:
  GET /api/audit-log — list audit entries for the current org

Internal helper:
  log_action() — record an audit event (call from other routes)
"""

import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.audit_log import AuditLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit-log", tags=["Audit Log"])


# ── Internal helper ──────────────────────────────────────────────────

async def log_action(
    db: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[UUID] = None,
    details: Optional[dict] = None,
    ip: Optional[str] = None,
) -> AuditLog:
    """Record an audit log entry. Call from any route handler."""
    entry = AuditLog(
        org_id=org_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        ip_address=ip,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


# ── LIST audit entries ───────────────────────────────────────────────

@router.get("")
async def list_audit_logs(
    action: Optional[str] = Query(None, description="Filter by action type"),
    user_id: Optional[UUID] = Query(None, description="Filter by user ID"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """List audit log entries for the current org with optional filters."""
    # Build base query
    query = select(AuditLog).where(AuditLog.org_id == org_id)
    count_query = select(func.count(AuditLog.id)).where(AuditLog.org_id == org_id)

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    if user_id:
        query = query.where(AuditLog.user_id == user_id)
        count_query = count_query.where(AuditLog.user_id == user_id)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * limit
    query = query.order_by(desc(AuditLog.created_at)).offset(offset).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    return {
        "data": [
            {
                "id": str(e.id),
                "org_id": str(e.org_id),
                "user_id": str(e.user_id),
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id) if e.entity_id else None,
                "details": e.details,
                "ip_address": e.ip_address,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }
