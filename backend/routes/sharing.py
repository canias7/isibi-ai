from __future__ import annotations

"""
Project Sharing Links — generate public share tokens for read-only previews.

Endpoints:
  POST   /api/projects/{id}/share  — generate a share token
  DELETE /api/projects/{id}/share  — revoke share link
  GET    /api/shared/{token}       — public endpoint (no auth), read-only preview
"""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["sharing"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _generate_share_token() -> str:
    return secrets.token_urlsafe(32)


# ── Authenticated endpoints ──────────────────────────────────────────────────

@router.post("/projects/{project_id}/share")
async def create_share_link(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Generate a public share token for a project."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Store share token in spec
    spec = dict(project.spec) if project.spec else {}
    if spec.get("_share_token"):
        # Already has a share token, return it
        return {
            "share_token": spec["_share_token"],
            "share_url": f"/api/shared/{spec['_share_token']}",
        }

    token = _generate_share_token()
    spec["_share_token"] = token
    project.spec = spec
    await db.commit()
    await db.refresh(project)

    return {
        "share_token": token,
        "share_url": f"/api/shared/{token}",
    }


@router.delete("/projects/{project_id}/share")
async def revoke_share_link(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Revoke the share link for a project."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    spec = dict(project.spec) if project.spec else {}
    if "_share_token" in spec:
        del spec["_share_token"]
        project.spec = spec
        await db.commit()

    return {"detail": "Share link revoked"}


# ── Public endpoint (no auth) ────────────────────────────────────────────────

@router.get("/shared/{token}")
async def get_shared_project(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint — returns project name + spec for read-only preview."""
    # Search for the project with this share token in the spec
    result = await db.execute(select(Project))
    projects = result.scalars().all()

    for project in projects:
        spec = project.spec or {}
        if spec.get("_share_token") == token:
            # Return a sanitized version (remove the share token from the response)
            safe_spec = {k: v for k, v in spec.items() if not k.startswith("_")}
            return {
                "name": project.name,
                "description": project.description,
                "spec": safe_spec,
                "status": project.status,
            }

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared project not found or link expired")
