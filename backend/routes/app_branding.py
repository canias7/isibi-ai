from __future__ import annotations

"""
Custom Branding Settings — let developers customize their generated app's branding.
"""

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from models.subscription import Subscription

router = APIRouter(tags=["app-branding"])

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

VALID_EVENTS = {"record_created", "record_updated", "field_changed", "record_deleted"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class BrandingBody(BaseModel):
    logo_url: Optional[str] = None
    app_name: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    favicon_emoji: Optional[str] = None
    hide_powered_by: Optional[bool] = None
    custom_css: Optional[str] = None

    @field_validator("primary_color", "secondary_color", mode="before")
    @classmethod
    def validate_hex_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not HEX_COLOR_RE.match(v):
            raise ValueError(f"Invalid hex color: {v}. Must be in #rrggbb format.")
        return v


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_project(project_id: str, org_id: uuid.UUID, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _is_paid_plan(org_id: uuid.UUID, db: AsyncSession) -> bool:
    """Check whether the org is on a paid plan (pro or teams)."""
    result = await db.execute(
        select(Subscription).where(
            Subscription.org_id == org_id,
            Subscription.status == "active",
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return False
    return sub.plan in ("pro", "teams")


def _resolve_branding(branding: dict, is_paid: bool) -> dict:
    """Resolve branding settings, enforcing plan restrictions."""
    resolved = dict(branding)
    # Only paid plans can hide the "Powered by isibi.ai" footer
    if not is_paid:
        resolved["hide_powered_by"] = False
    return resolved


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.put("/projects/{project_id}/branding")
async def update_branding(
    project_id: str,
    body: BrandingBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update branding settings for a project."""
    project = await _get_project(project_id, org_id, db)

    spec = dict(project.spec) if project.spec else {}
    branding = spec.get("_branding", {})

    updates = body.model_dump(exclude_unset=True)
    branding.update(updates)

    # Enforce: only paid plans can hide_powered_by
    is_paid = await _is_paid_plan(org_id, db)
    if branding.get("hide_powered_by") and not is_paid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hiding 'Powered by isibi.ai' is only available on paid plans (Pro or Teams).",
        )

    spec["_branding"] = branding
    project.spec = spec

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {"branding": _resolve_branding(project.spec.get("_branding", {}), is_paid)}


@router.get("/projects/{project_id}/branding")
async def get_branding(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get current branding settings for a project."""
    project = await _get_project(project_id, org_id, db)

    branding = (project.spec or {}).get("_branding", {})
    is_paid = await _is_paid_plan(org_id, db)

    return {"branding": _resolve_branding(branding, is_paid)}
