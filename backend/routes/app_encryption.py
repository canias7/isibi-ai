from __future__ import annotations

"""
Field Encryption Config — mark fields as encrypted at rest.
Stores config in the project spec under _encryption.

Endpoints:
  PUT /api/projects/{project_id}/encryption  — set encryption config
  GET /api/projects/{project_id}/encryption  — get encryption config
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(prefix="/projects", tags=["App Encryption"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class EncryptionConfigBody(BaseModel):
    enabled: bool = False
    encrypted_fields: dict[str, list[str]] = {}  # entity -> list of field names
    algorithm: str = "AES-256-GCM"


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

@router.put("/{project_id}/encryption")
async def set_encryption_config(
    project_id: str,
    body: EncryptionConfigBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Set the field encryption configuration for a project."""
    project = await _get_project(db, project_id, org_id)

    spec = dict(project.spec or {})
    spec["_encryption"] = {
        "enabled": body.enabled,
        "encrypted_fields": body.encrypted_fields,
        "algorithm": body.algorithm,
    }
    project.spec = spec

    await db.commit()
    await db.refresh(project)
    return spec["_encryption"]


@router.get("/{project_id}/encryption")
async def get_encryption_config(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the field encryption configuration for a project."""
    project = await _get_project(db, project_id, org_id)

    spec = project.spec or {}
    encryption = spec.get("_encryption", {
        "enabled": False,
        "encrypted_fields": {},
        "algorithm": "AES-256-GCM",
    })
    return encryption
