from __future__ import annotations
"""
Voice Input Config — enable/disable voice input for specific entity fields.

Routes:
  PUT /api/projects/{project_id}/voice-config  — update config
  GET /api/projects/{project_id}/voice-config  — get config
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["App Voice Config"])


# ── Schemas ──────────────────────────────────────────────────────────

class VoiceConfigBody(BaseModel):
    enabled: bool = True
    fields: dict[str, list[str]] = {}  # {"Lead": ["notes", "description"], "Task": ["description"]}


# ── Helpers ──────────────────────────────────────────────────────────

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


# ── Endpoints ────────────────────────────────────────────────────────

@router.put("/projects/{project_id}/voice-config")
async def update_voice_config(
    project_id: str,
    body: VoiceConfigBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Enable/disable voice input for specific entity fields."""
    project = await _get_project(project_id, org_id, db)

    spec = dict(project.spec) if project.spec else {}
    spec["_voice_config"] = body.model_dump()
    project.spec = spec
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {"voice_config": project.spec.get("_voice_config", {})}


@router.get("/projects/{project_id}/voice-config")
async def get_voice_config(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get voice input configuration."""
    project = await _get_project(project_id, org_id, db)
    config = (project.spec or {}).get("_voice_config", {"enabled": False, "fields": {}})
    return {"voice_config": config}
