from __future__ import annotations

"""
Billing paywall check — determines whether an org can trigger a build.

Endpoint:
  GET /api/billing/can-build  — returns build eligibility for the current org
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from routes.pricing import _get_or_create_subscription, PLANS

router = APIRouter(prefix="/billing", tags=["billing"])


async def can_build(org_id: uuid.UUID, db: AsyncSession) -> dict:
    """
    Check whether the org is allowed to trigger another build.

    Returns a dict:
      {
        "can_build": True/False,
        "plan": "free" | "pro" | "teams",
        "builds_used": int,
        "builds_limit": int          # -1 means unlimited
      }
    """
    sub = await _get_or_create_subscription(db, org_id)
    plan_config = PLANS.get(sub.plan, PLANS["free"])
    projects_limit = plan_config.get("projects_limit", 1)

    # Count existing projects for this org
    project_count = 0
    try:
        result = await db.execute(
            select(func.count(Project.id)).where(
                Project.org_id == org_id,
                Project.deleted_at.is_(None),
            )
        )
        project_count = result.scalar() or 0
    except Exception:
        pass  # If count fails, allow the build

    # Pro / Teams plans have unlimited builds (builds_limit == -1)
    if sub.builds_limit == -1:
        return {
            "can_build": True,
            "plan": sub.plan,
            "builds_used": sub.builds_used,
            "builds_limit": sub.builds_limit,
            "projects_count": project_count,
            "projects_limit": projects_limit,
        }

    # Free plan — enforce the builds cap
    builds_allowed = sub.builds_used < sub.builds_limit

    # Also enforce projects limit (free = 1 project max)
    projects_allowed = projects_limit == -1 or project_count < projects_limit

    return {
        "can_build": builds_allowed and projects_allowed,
        "plan": sub.plan,
        "builds_used": sub.builds_used,
        "builds_limit": sub.builds_limit,
        "projects_count": project_count,
        "projects_limit": projects_limit,
    }


@router.get("/can-build")
async def api_can_build(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Return whether this org can trigger a new build."""
    return await can_build(org_id, db)
