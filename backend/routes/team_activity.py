from __future__ import annotations

"""
Team Activity Dashboard — aggregated activity feed and org-wide stats.

Endpoints:
  GET /api/team/activity — activity feed for the org
  GET /api/team/stats    — org-wide statistics
"""

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.audit_log import AuditLog
from models.project import Project
from models.user import User

router = APIRouter(prefix="/team", tags=["team"])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/activity")
async def team_activity(
    days: int = Query(7, ge=1, le=90),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Aggregated activity feed for the org from audit logs."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    base_filter = [
        AuditLog.org_id == org_id,
        AuditLog.created_at >= cutoff,
    ]

    count_result = await db.execute(
        select(func.count(AuditLog.id)).where(*base_filter)
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * limit
    query = (
        select(AuditLog)
        .where(*base_filter)
        .order_by(desc(AuditLog.created_at))
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    entries = result.scalars().all()

    return {
        "data": [
            {
                "id": str(e.id),
                "user_id": str(e.user_id),
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id) if e.entity_id else None,
                "details": e.details,
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


@router.get("/stats")
async def team_stats(
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Org-wide statistics: total projects, deploys, active members, builds this month."""
    # Total projects
    proj_result = await db.execute(
        select(func.count(Project.id)).where(
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    total_projects = proj_result.scalar() or 0

    # Total deploys (from audit log)
    deploy_result = await db.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.org_id == org_id,
            AuditLog.action == "deploy",
        )
    )
    total_deploys = deploy_result.scalar() or 0

    # Active members
    member_result = await db.execute(
        select(func.count(User.id)).where(
            User.org_id == org_id,
            User.deleted_at.is_(None),
            User.status == "active",
        )
    )
    active_members = member_result.scalar() or 0

    # Builds this month
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    builds_result = await db.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.org_id == org_id,
            AuditLog.action.in_(["build", "generate"]),
            AuditLog.created_at >= month_start,
        )
    )
    builds_this_month = builds_result.scalar() or 0

    return {
        "total_projects": total_projects,
        "total_deploys": total_deploys,
        "active_members": active_members,
        "builds_this_month": builds_this_month,
    }
