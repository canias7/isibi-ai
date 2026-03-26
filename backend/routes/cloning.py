from __future__ import annotations

"""
App Cloning — clone a public gallery app into user's projects.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id, get_current_user_id
from db import get_db
from models.gallery_entry import GalleryEntry
from models.project import Project

router = APIRouter(prefix="/gallery", tags=["cloning"])


@router.post("/{entry_id}/clone", status_code=201)
async def clone_gallery_app(
    entry_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Clone a public gallery app into user's projects."""
    eid = uuid.UUID(entry_id)

    # Fetch the gallery entry
    result = await db.execute(
        select(GalleryEntry).where(
            GalleryEntry.id == eid,
            GalleryEntry.is_published.is_(True),
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gallery entry not found or not published",
        )

    # Fetch the source project to get the spec
    source_result = await db.execute(
        select(Project).where(Project.id == entry.project_id)
    )
    source_project = source_result.scalar_one_or_none()
    if not source_project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source project not found",
        )

    # Increment likes/use count on the gallery entry
    entry.likes = (entry.likes or 0) + 1

    # Create a new project with cloned spec
    new_project = Project(
        org_id=org_id,
        user_id=user_id,
        name=f"{entry.title} (Clone)",
        description=f"Cloned from gallery: {entry.title}",
        prompt=source_project.prompt or f"Cloned from: {entry.title}",
        spec=source_project.spec,
        status="ready",
    )
    db.add(new_project)
    await db.commit()
    await db.refresh(new_project)

    return {
        "project_id": str(new_project.id),
        "name": new_project.name,
        "description": new_project.description,
        "source_gallery_entry_id": str(entry.id),
        "source_gallery_title": entry.title,
        "status": new_project.status,
        "created_at": new_project.created_at.isoformat() if new_project.created_at else None,
    }
