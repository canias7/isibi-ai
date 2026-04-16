from __future__ import annotations

"""
Embed Widget — allow projects to be embedded in external sites via iframes.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["embed"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class EmbedSettingsBody(BaseModel):
    enabled: bool = True
    allowed_origins: list[str] = []
    width: Optional[str] = "100%"
    height: Optional[str] = "600px"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_embed_config(project: Project) -> dict:
    """Extract embed config from project spec or return defaults."""
    spec = project.spec or {}
    embed = spec.get("embed", {})
    return {
        "enabled": embed.get("enabled", False),
        "allowed_origins": embed.get("allowed_origins", []),
        "width": embed.get("width", "100%"),
        "height": embed.get("height", "600px"),
    }


# ── API Endpoints (under /api) ───────────────────────────────────────────────

@router.get("/projects/{project_id}/embed")
async def get_embed_config(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get embed configuration for a project."""
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

    config = _get_embed_config(project)
    return {"project_id": str(project.id), **config}


@router.put("/projects/{project_id}/embed")
async def update_embed_config(
    project_id: str,
    body: EmbedSettingsBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update embed settings for a project."""
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

    spec = dict(project.spec or {})
    spec["embed"] = {
        "enabled": body.enabled,
        "allowed_origins": body.allowed_origins,
        "width": body.width,
        "height": body.height,
    }
    project.spec = spec
    await db.commit()
    await db.refresh(project)

    return {"project_id": str(project.id), **spec["embed"]}
