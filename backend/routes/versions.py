from __future__ import annotations
"""
Version History API routes.

GET  /api/projects/{id}/versions                     — list all versions
GET  /api/projects/{id}/versions/{version_id}        — get full spec snapshot
POST /api/projects/{id}/versions/{version_id}/restore — restore project to a version
"""

import uuid as _uuid
from datetime import datetime
from typing import Optional

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project
from models.project_version import ProjectVersion

router = APIRouter(tags=["Versions"])


# ── Schemas ────────────────────────────────────────────────────────

class VersionListItem(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    version_number: int
    change_description: Optional[str] = None
    created_at: datetime


class VersionDetail(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    project_id: UUID
    version_number: int
    spec_snapshot: dict
    change_description: Optional[str] = None
    created_at: datetime


class RestoreResponse(BaseModel):
    message: str
    restored_version: int


# ── Helpers ────────────────────────────────────────────────────────

async def _get_project_for_org(
    db: AsyncSession, project_id: UUID, org_id: UUID
) -> Project:
    """Fetch a project ensuring it belongs to the org."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def save_version(
    db: AsyncSession,
    project: Project,
    change_description: Optional[str] = None,
) -> ProjectVersion:
    """
    Create a new version snapshot for a project.
    Call this from the generator/orchestrator after spec creation or refinement.
    """
    # Get next version number
    result = await db.execute(
        select(func.coalesce(func.max(ProjectVersion.version_number), 0)).where(
            ProjectVersion.project_id == project.id
        )
    )
    next_version = result.scalar() + 1

    version = ProjectVersion(
        id=_uuid.uuid4(),
        project_id=project.id,
        org_id=project.org_id,
        version_number=next_version,
        spec_snapshot=project.spec,
        change_description=change_description or f"Version {next_version}",
    )
    db.add(version)
    await db.flush()
    return version


# ── Endpoints ──────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/versions",
    response_model=list[VersionListItem],
)
async def list_versions(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """List all version snapshots for a project."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(ProjectVersion)
        .where(ProjectVersion.project_id == project_id, ProjectVersion.org_id == org_id)
        .order_by(ProjectVersion.version_number.desc())
    )
    return result.scalars().all()


@router.get(
    "/projects/{project_id}/versions/{version_id}",
    response_model=VersionDetail,
)
async def get_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get full spec snapshot for a specific version."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(ProjectVersion).where(
            ProjectVersion.id == version_id,
            ProjectVersion.project_id == project_id,
            ProjectVersion.org_id == org_id,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.post(
    "/projects/{project_id}/versions/{version_id}/restore",
    response_model=RestoreResponse,
)
async def restore_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Restore a project's spec to a previous version snapshot."""
    project = await _get_project_for_org(db, project_id, org_id)

    # Get the version to restore
    result = await db.execute(
        select(ProjectVersion).where(
            ProjectVersion.id == version_id,
            ProjectVersion.project_id == project_id,
            ProjectVersion.org_id == org_id,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current state as a new version before restoring
    if project.spec:
        await save_version(
            db,
            project,
            change_description=f"Auto-save before restoring to v{version.version_number}",
        )

    # Restore the spec
    project.spec = version.spec_snapshot
    project.updated_at = datetime.utcnow()
    await db.commit()

    return RestoreResponse(
        message=f"Restored to version {version.version_number}",
        restored_version=version.version_number,
    )


class RollbackResponse(BaseModel):
    message: str
    restored_version: int
    spec: dict


@router.post(
    "/projects/{project_id}/rollback",
    response_model=RollbackResponse,
)
async def rollback_to_previous(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Roll back to the immediately previous version (one-click rollback)."""
    project = await _get_project_for_org(db, project_id, org_id)

    # Find the two most recent versions
    result = await db.execute(
        select(ProjectVersion)
        .where(
            ProjectVersion.project_id == project_id,
            ProjectVersion.org_id == org_id,
        )
        .order_by(ProjectVersion.version_number.desc())
        .limit(2)
    )
    versions = result.scalars().all()

    if len(versions) < 1:
        raise HTTPException(status_code=404, detail="No versions available to roll back to")

    # If there's only one version, restore to that one
    # If there are two or more, restore to the second most recent
    # (the most recent is likely the current state)
    target = versions[-1] if len(versions) > 1 else versions[0]

    # Save current state before restoring
    if project.spec:
        await save_version(
            db,
            project,
            change_description=f"Auto-save before rollback to v{target.version_number}",
        )

    # Restore the spec
    project.spec = target.spec_snapshot
    project.updated_at = datetime.utcnow()
    await db.commit()

    return RollbackResponse(
        message=f"Rolled back to version {target.version_number}",
        restored_version=target.version_number,
        spec=target.spec_snapshot,
    )
