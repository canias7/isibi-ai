from __future__ import annotations
"""
App Roles & Permissions — role-based access control for generated apps.

Routes:
  POST   /api/apps/{project_id}/roles                  — create role
  GET    /api/apps/{project_id}/roles                  — list roles
  PUT    /api/apps/{project_id}/roles/{role_id}        — update role
  DELETE /api/apps/{project_id}/roles/{role_id}        — delete role
  PUT    /api/apps/{project_id}/users/{user_id}/role   — assign role to user
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from routes.app_auth import get_current_app_user
from models.app_role import AppRole
from models.app_user import AppUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Roles"])

VALID_SCOPES = {"all", "team", "own"}


# ── Schemas ──────────────────────────────────────────────────────────

class CreateRoleRequest(BaseModel):
    name: str
    label: str
    permissions: dict = {}
    scope: str = "own"


class UpdateRoleRequest(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None
    permissions: Optional[dict] = None
    scope: Optional[str] = None


class AssignRoleRequest(BaseModel):
    role_name: str


# ── Auth helper: app-user OR platform ────────────────────────────────

async def _get_auth_project_id(
    project_id: uuid.UUID,
    db: AsyncSession,
    org_id: Optional[uuid.UUID] = None,
    app_user: Optional[dict] = None,
) -> uuid.UUID:
    """Validate project access from either auth type."""
    if app_user and app_user.get("project_id") == project_id:
        return project_id
    if org_id:
        from generator.orchestrator import _get_project
        await _get_project(db, project_id, org_id)
        return project_id
    raise HTTPException(status_code=403, detail="Access denied")


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/roles", status_code=201)
async def create_role(
    project_id: uuid.UUID,
    body: CreateRoleRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create a new role for a generated app."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    if body.scope not in VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope. Must be one of: {', '.join(VALID_SCOPES)}")

    # Check for duplicate role name
    existing = await db.execute(
        select(AppRole).where(AppRole.project_id == project_id, AppRole.name == body.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Role '{body.name}' already exists")

    role = AppRole(
        project_id=project_id,
        name=body.name,
        label=body.label,
        permissions=body.permissions,
        scope=body.scope,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)

    return {
        "id": str(role.id),
        "project_id": str(role.project_id),
        "name": role.name,
        "label": role.label,
        "permissions": role.permissions,
        "scope": role.scope,
        "created_at": role.created_at.isoformat() if role.created_at else None,
    }


@router.get("/{project_id}/roles")
async def list_roles(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all roles for a generated app."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRole).where(AppRole.project_id == project_id).order_by(AppRole.created_at)
    )
    roles = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "label": r.label,
            "permissions": r.permissions,
            "scope": r.scope,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in roles
    ]


@router.put("/{project_id}/roles/{role_id}")
async def update_role(
    project_id: uuid.UUID,
    role_id: uuid.UUID,
    body: UpdateRoleRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Update a role."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRole).where(AppRole.id == role_id, AppRole.project_id == project_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if body.scope is not None and body.scope not in VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope. Must be one of: {', '.join(VALID_SCOPES)}")

    if body.name is not None:
        role.name = body.name
    if body.label is not None:
        role.label = body.label
    if body.permissions is not None:
        role.permissions = body.permissions
    if body.scope is not None:
        role.scope = body.scope

    await db.commit()
    await db.refresh(role)

    return {
        "id": str(role.id),
        "name": role.name,
        "label": role.label,
        "permissions": role.permissions,
        "scope": role.scope,
        "created_at": role.created_at.isoformat() if role.created_at else None,
    }


@router.delete("/{project_id}/roles/{role_id}")
async def delete_role(
    project_id: uuid.UUID,
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a role."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRole).where(AppRole.id == role_id, AppRole.project_id == project_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    await db.execute(
        sa_delete(AppRole).where(AppRole.id == role_id)
    )
    await db.commit()
    return {"deleted": True}


@router.put("/{project_id}/users/{user_id}/role")
async def assign_role(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    body: AssignRoleRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Assign a role to an app user."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    # Verify the role exists
    role_result = await db.execute(
        select(AppRole).where(AppRole.project_id == project_id, AppRole.name == body.role_name)
    )
    role = role_result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{body.role_name}' not found")

    # Verify the user exists in this project
    user_result = await db.execute(
        select(AppUser).where(AppUser.id == user_id, AppUser.project_id == project_id)
    )
    app_user = user_result.scalar_one_or_none()
    if not app_user:
        raise HTTPException(status_code=404, detail="App user not found")

    app_user.role = body.role_name
    await db.commit()
    await db.refresh(app_user)

    return {
        "user_id": str(app_user.id),
        "role": app_user.role,
        "updated": True,
    }
