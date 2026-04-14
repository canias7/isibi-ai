from __future__ import annotations
"""
Field Type Configs — configure special field types (date range, color picker, rating, slider).

Routes:
  PUT /api/projects/{project_id}/field-config/{entity}/{field}  — set config
  GET /api/projects/{project_id}/field-config/{entity}/{field}  — get config
"""

import uuid
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["App Field Types"])

VALID_FIELD_TYPES = {"date_range", "color_picker", "rating", "slider"}


# ── Schemas ──────────────────────────────────────────────────────────

class FieldConfigBody(BaseModel):
    type: str  # date_range | color_picker | rating | slider
    # Date range fields
    start_label: Optional[str] = None
    end_label: Optional[str] = None
    # Color picker fields
    format: Optional[str] = None  # hex | rgb
    # Rating fields
    max: Optional[int] = None
    icon: Optional[str] = None  # star | heart | thumb
    # Slider fields
    min: Optional[float] = None
    step: Optional[float] = None
    # Generic extra config
    extra: Optional[dict[str, Any]] = None


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

@router.put("/projects/{project_id}/field-config/{entity}/{field}")
async def update_field_config(
    project_id: str,
    entity: str,
    field: str,
    body: FieldConfigBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Set field-specific configuration (date range, color picker, rating, slider)."""
    if body.type not in VALID_FIELD_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid field type '{body.type}'. Must be one of: {', '.join(sorted(VALID_FIELD_TYPES))}"
        )

    project = await _get_project(project_id, org_id, db)

    spec = dict(project.spec) if project.spec else {}

    # Find the entity in spec pages and add _config to the field
    pages = spec.get("pages", [])
    entity_found = False
    for page in pages:
        if page.get("name") == entity or page.get("table") == entity:
            entity_found = True
            fields = page.get("fields", [])
            for f in fields:
                if f.get("name") == field:
                    f["_config"] = body.model_dump(exclude_none=True)
                    break
            else:
                # Field not found in page fields — store at page level
                field_configs = page.get("_field_configs", {})
                field_configs[field] = body.model_dump(exclude_none=True)
                page["_field_configs"] = field_configs
            break

    if not entity_found:
        # Store in a top-level _field_configs section
        field_configs = spec.get("_field_configs", {})
        entity_configs = field_configs.get(entity, {})
        entity_configs[field] = body.model_dump(exclude_none=True)
        field_configs[entity] = entity_configs
        spec["_field_configs"] = field_configs

    project.spec = spec
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {"entity": entity, "field": field, "config": body.model_dump(exclude_none=True)}


@router.get("/projects/{project_id}/field-config/{entity}/{field}")
async def get_field_config(
    project_id: str,
    entity: str,
    field: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get field-specific configuration."""
    project = await _get_project(project_id, org_id, db)

    spec = project.spec or {}

    # Check in page fields first
    pages = spec.get("pages", [])
    for page in pages:
        if page.get("name") == entity or page.get("table") == entity:
            fields = page.get("fields", [])
            for f in fields:
                if f.get("name") == field and "_config" in f:
                    return {"entity": entity, "field": field, "config": f["_config"]}
            # Check page-level _field_configs
            page_configs = page.get("_field_configs", {})
            if field in page_configs:
                return {"entity": entity, "field": field, "config": page_configs[field]}
            break

    # Check top-level _field_configs
    field_configs = spec.get("_field_configs", {})
    entity_configs = field_configs.get(entity, {})
    config = entity_configs.get(field, {})

    return {"entity": entity, "field": field, "config": config}
