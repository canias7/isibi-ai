from __future__ import annotations
"""
Multi-Step Forms — configure form steps for entities in generated apps.

Routes:
  PUT  /api/projects/{project_id}/entities/{entity}/form-steps  — configure steps
  GET  /api/projects/{project_id}/entities/{entity}/form-steps  — get config
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["Multi-Step Forms"])


# ── Schemas ──────────────────────────────────────────────────────────

class FormStep(BaseModel):
    title: str
    fields: list[str] = []


class FormStepsBody(BaseModel):
    steps: list[FormStep]


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

@router.put("/projects/{project_id}/entities/{entity}/form-steps")
async def update_form_steps(
    project_id: str,
    entity: str,
    body: FormStepsBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Configure multi-step form layout for an entity."""
    project = await _get_project(project_id, org_id, db)

    spec = dict(project.spec) if project.spec else {}
    form_steps = spec.get("_form_steps", {})
    form_steps[entity] = [step.model_dump() for step in body.steps]
    spec["_form_steps"] = form_steps
    project.spec = spec
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {"entity": entity, "steps": project.spec.get("_form_steps", {}).get(entity, [])}


@router.get("/projects/{project_id}/entities/{entity}/form-steps")
async def get_form_steps(
    project_id: str,
    entity: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get multi-step form configuration for an entity."""
    project = await _get_project(project_id, org_id, db)

    steps = (project.spec or {}).get("_form_steps", {}).get(entity, [])
    return {"entity": entity, "steps": steps}
