from __future__ import annotations

"""
Custom subdomain per app — let users claim `mycrm.isibi.ai` for their project.

Endpoints:
  POST /api/projects/{project_id}/subdomain  — set / update custom subdomain
  GET  /api/projects/{project_id}/subdomain  — get current subdomain
"""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(prefix="/projects", tags=["subdomain"])

# ── Validation constants ──────────────────────────────────────────

SUBDOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9\-]{1,28}[a-z0-9])?$")

RESERVED_SUBDOMAINS = frozenset(
    {
        "app",
        "api",
        "www",
        "mail",
        "admin",
        "support",
        "help",
        "docs",
        "blog",
    }
)


# ── Request / Response schemas ────────────────────────────────────

class SetSubdomainRequest(BaseModel):
    subdomain: str


class SubdomainResponse(BaseModel):
    subdomain: str | None
    url: str | None


# ── Helpers ───────────────────────────────────────────────────────

def _validate_subdomain(value: str) -> str:
    """Return a clean, validated subdomain or raise 400."""
    clean = value.strip().lower()

    if not SUBDOMAIN_RE.match(clean):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Subdomain must be 3-30 characters, lowercase alphanumeric and "
                "hyphens only, and cannot start or end with a hyphen."
            ),
        )

    if len(clean) < 3 or len(clean) > 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subdomain must be between 3 and 30 characters.",
        )

    if clean in RESERVED_SUBDOMAINS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The subdomain '{clean}' is reserved and cannot be used.",
        )

    return clean


async def _get_project_for_org(
    db: AsyncSession,
    project_id: uuid.UUID,
    org_id: uuid.UUID,
) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ── Routes ────────────────────────────────────────────────────────

@router.post("/{project_id}/subdomain", response_model=SubdomainResponse)
async def set_subdomain(
    project_id: uuid.UUID,
    body: SetSubdomainRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Set or update the custom subdomain for a project."""
    subdomain = _validate_subdomain(body.subdomain)

    project = await _get_project_for_org(db, project_id, org_id)

    # Check uniqueness — no other project should own this subdomain
    existing = await db.execute(
        select(Project).where(
            Project.subdomain == subdomain,
            Project.id != project_id,
            Project.deleted_at.is_(None),
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The subdomain '{subdomain}' is already taken.",
        )

    project.subdomain = subdomain
    await db.commit()
    await db.refresh(project)

    return SubdomainResponse(
        subdomain=subdomain,
        url=f"https://{subdomain}.isibi.ai",
    )


@router.get("/{project_id}/subdomain", response_model=SubdomainResponse)
async def get_subdomain(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the current custom subdomain for a project."""
    project = await _get_project_for_org(db, project_id, org_id)

    if project.subdomain:
        return SubdomainResponse(
            subdomain=project.subdomain,
            url=f"https://{project.subdomain}.isibi.ai",
        )
    return SubdomainResponse(subdomain=None, url=None)
