from __future__ import annotations

"""
White-Label Support — let developers remove isibi.ai branding per project.

Endpoints:
  PUT  /api/projects/{project_id}/white-label  — configure white-label settings
  GET  /api/projects/{project_id}/white-label  — get current config
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from models.subscription import Subscription

router = APIRouter(tags=["white-label"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class WhiteLabelBody(BaseModel):
    enabled: bool = True
    company_name: Optional[str] = None
    support_email: Optional[str] = None
    terms_url: Optional[str] = None
    privacy_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project(db: AsyncSession, project_id: str, org_id: uuid.UUID) -> Project:
    pid = uuid.UUID(project_id)
    result = await db.execute(
        select(Project).where(
            Project.id == pid,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _require_pro_or_teams(db: AsyncSession, org_id: uuid.UUID):
    """Ensure the org has a Pro or Teams subscription."""
    result = await db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    )
    sub = result.scalar_one_or_none()
    if not sub or sub.plan not in ("pro", "teams"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="White-label requires a Pro or Teams subscription",
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.put("/projects/{project_id}/white-label")
async def configure_white_label(
    project_id: str,
    body: WhiteLabelBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Configure white-label settings for a project. Requires Pro or Teams plan."""
    await _require_pro_or_teams(db, org_id)
    project = await _get_project(db, project_id, org_id)

    spec = dict(project.spec or {})
    spec["_white_label"] = {
        "enabled": body.enabled,
        "company_name": body.company_name,
        "support_email": body.support_email,
        "terms_url": body.terms_url,
        "privacy_url": body.privacy_url,
    }
    project.spec = spec
    await db.commit()
    await db.refresh(project)

    return {
        "project_id": str(project.id),
        "white_label": spec["_white_label"],
    }


@router.get("/projects/{project_id}/white-label")
async def get_white_label(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get current white-label config for a project."""
    project = await _get_project(db, project_id, org_id)

    spec = project.spec or {}
    wl = spec.get("_white_label", None)

    if not wl:
        return {
            "project_id": str(project.id),
            "configured": False,
            "white_label": None,
        }

    return {
        "project_id": str(project.id),
        "configured": True,
        "white_label": wl,
    }
