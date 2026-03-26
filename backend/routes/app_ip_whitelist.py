from __future__ import annotations

"""
IP Whitelisting — restrict access to deployed apps by IP address.
Stores allowed IPs in the project spec under _ip_whitelist.

Endpoints:
  PUT /api/projects/{project_id}/ip-whitelist  — set allowed IPs
  GET /api/projects/{project_id}/ip-whitelist  — get allowed IPs
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(prefix="/projects", tags=["App IP Whitelist"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class IPWhitelistBody(BaseModel):
    enabled: bool = False
    allowed_ips: list[str] = []


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_project(db: AsyncSession, project_id: str, org_id: uuid.UUID) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.put("/{project_id}/ip-whitelist")
async def set_ip_whitelist(
    project_id: str,
    body: IPWhitelistBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Set the IP whitelist for a project."""
    project = await _get_project(db, project_id, org_id)

    spec = dict(project.spec or {})
    spec["_ip_whitelist"] = {
        "enabled": body.enabled,
        "allowed_ips": body.allowed_ips,
    }
    project.spec = spec

    await db.commit()
    await db.refresh(project)
    return spec["_ip_whitelist"]


@router.get("/{project_id}/ip-whitelist")
async def get_ip_whitelist(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the IP whitelist for a project."""
    project = await _get_project(db, project_id, org_id)

    spec = project.spec or {}
    whitelist = spec.get("_ip_whitelist", {"enabled": False, "allowed_ips": []})
    return whitelist
