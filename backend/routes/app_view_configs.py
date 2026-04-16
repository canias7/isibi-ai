from __future__ import annotations

"""
App View Configs — configure custom display/visualization views for entities.

Supported view types:
  gantt, map, timeline, gallery, tree, comparison, print_template, qr_display

Endpoints:
  POST   /api/projects/{project_id}/views              — create a view config
  GET    /api/projects/{project_id}/views              — list all view configs
  GET    /api/projects/{project_id}/views/{entity}     — get views for an entity
  PUT    /api/projects/{project_id}/views/{view_id}    — update a view config
  DELETE /api/projects/{project_id}/views/{view_id}    — delete a view config
"""

import uuid
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_view_config import AppViewConfig
from models.project import Project

router = APIRouter(prefix="/projects/{project_id}/views", tags=["App Views"])

VALID_VIEW_TYPES = {
    "gantt",
    "map",
    "timeline",
    "gallery",
    "tree",
    "comparison",
    "print_template",
    "qr_display",
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateViewConfigBody(BaseModel):
    entity: str
    view_type: str
    config: Dict[str, Any] = {}
    is_default: bool = False

    @field_validator("view_type")
    @classmethod
    def validate_view_type(cls, v: str) -> str:
        if v not in VALID_VIEW_TYPES:
            raise ValueError(
                f"view_type must be one of: {', '.join(sorted(VALID_VIEW_TYPES))}"
            )
        return v


class UpdateViewConfigBody(BaseModel):
    entity: Optional[str] = None
    view_type: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None

    @field_validator("view_type")
    @classmethod
    def validate_view_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_VIEW_TYPES:
            raise ValueError(
                f"view_type must be one of: {', '.join(sorted(VALID_VIEW_TYPES))}"
            )
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project(
    db: AsyncSession, project_id: str, org_id: uuid.UUID
) -> Project:
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


def _serialize(view: AppViewConfig) -> dict:
    return {
        "id": str(view.id),
        "project_id": str(view.project_id),
        "org_id": str(view.org_id),
        "entity": view.entity,
        "view_type": view.view_type,
        "config": view.config,
        "is_default": view.is_default,
        "created_at": view.created_at.isoformat() if view.created_at else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_view_config(
    project_id: str,
    body: CreateViewConfigBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create a new view configuration for an entity."""
    project = await _get_project(db, project_id, org_id)

    # If setting as default, unset any existing default for same entity+view_type
    if body.is_default:
        result = await db.execute(
            select(AppViewConfig).where(
                AppViewConfig.project_id == project.id,
                AppViewConfig.org_id == org_id,
                AppViewConfig.entity == body.entity,
                AppViewConfig.view_type == body.view_type,
                AppViewConfig.is_default.is_(True),
            )
        )
        for existing in result.scalars().all():
            existing.is_default = False

    view = AppViewConfig(
        project_id=project.id,
        org_id=org_id,
        entity=body.entity,
        view_type=body.view_type,
        config=body.config,
        is_default=body.is_default,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)

    return _serialize(view)


@router.get("")
async def list_view_configs(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all view configurations for a project."""
    project = await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppViewConfig)
        .where(
            AppViewConfig.project_id == project.id,
            AppViewConfig.org_id == org_id,
        )
        .order_by(AppViewConfig.entity, AppViewConfig.view_type)
    )
    views = result.scalars().all()
    return {"views": [_serialize(v) for v in views]}


@router.get("/{entity}")
async def get_views_for_entity(
    project_id: str,
    entity: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get all view configurations for a specific entity."""
    project = await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppViewConfig)
        .where(
            AppViewConfig.project_id == project.id,
            AppViewConfig.org_id == org_id,
            AppViewConfig.entity == entity,
        )
        .order_by(AppViewConfig.view_type)
    )
    views = result.scalars().all()
    return {"views": [_serialize(v) for v in views]}


@router.put("/{view_id}")
async def update_view_config(
    project_id: str,
    view_id: str,
    body: UpdateViewConfigBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Update an existing view configuration."""
    await _get_project(db, project_id, org_id)
    vid = uuid.UUID(view_id)

    result = await db.execute(
        select(AppViewConfig).where(
            AppViewConfig.id == vid,
            AppViewConfig.project_id == uuid.UUID(project_id),
            AppViewConfig.org_id == org_id,
        )
    )
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="View config not found")

    if body.entity is not None:
        view.entity = body.entity
    if body.view_type is not None:
        view.view_type = body.view_type
    if body.config is not None:
        view.config = body.config
    if body.is_default is not None:
        # If setting as default, unset others
        if body.is_default:
            others = await db.execute(
                select(AppViewConfig).where(
                    AppViewConfig.project_id == view.project_id,
                    AppViewConfig.org_id == org_id,
                    AppViewConfig.entity == (body.entity or view.entity),
                    AppViewConfig.view_type == (body.view_type or view.view_type),
                    AppViewConfig.is_default.is_(True),
                    AppViewConfig.id != view.id,
                )
            )
            for existing in others.scalars().all():
                existing.is_default = False
        view.is_default = body.is_default

    await db.commit()
    await db.refresh(view)
    return _serialize(view)


@router.delete("/{view_id}", status_code=204)
async def delete_view_config(
    project_id: str,
    view_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a view configuration."""
    await _get_project(db, project_id, org_id)
    vid = uuid.UUID(view_id)

    result = await db.execute(
        select(AppViewConfig).where(
            AppViewConfig.id == vid,
            AppViewConfig.project_id == uuid.UUID(project_id),
            AppViewConfig.org_id == org_id,
        )
    )
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="View config not found")

    await db.delete(view)
    await db.commit()
