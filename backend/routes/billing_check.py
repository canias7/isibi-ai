from __future__ import annotations

"""
Billing paywall check — determines whether an org can trigger a build.

Endpoint:
  GET /api/billing/can-build  — returns build eligibility for the current org
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from routes.pricing import _get_or_create_subscription

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

    # Pro / Teams plans have unlimited builds (builds_limit == -1)
    if sub.builds_limit == -1:
        return {
            "can_build": True,
            "plan": sub.plan,
            "builds_used": sub.builds_used,
            "builds_limit": sub.builds_limit,
        }

    # Free plan — enforce the cap
    allowed = sub.builds_used < sub.builds_limit
    return {
        "can_build": allowed,
        "plan": sub.plan,
        "builds_used": sub.builds_used,
        "builds_limit": sub.builds_limit,
    }


@router.get("/can-build")
async def api_can_build(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Return whether this org can trigger a new build."""
    return await can_build(org_id, db)
