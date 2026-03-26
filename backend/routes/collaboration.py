from __future__ import annotations

"""
Collaboration / Workspaces routes.

Endpoints:
  POST   /api/workspaces                            — create workspace
  GET    /api/workspaces                            — list my workspaces
  POST   /api/workspaces/{id}/members               — invite member (by email)
  DELETE /api/workspaces/{id}/members/{user_id}      — remove member
  PATCH  /api/workspaces/{id}/members/{user_id}      — change role
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id, get_current_user_id
from db import get_db
from models.workspace import Workspace, WorkspaceMember
from models.user import User

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

VALID_ROLES = {"admin", "editor", "viewer"}


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class CreateWorkspaceRequest(BaseModel):
    name: str


class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: str = "editor"  # admin / editor / viewer


class ChangeRoleRequest(BaseModel):
    role: str  # admin / editor / viewer


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("")
async def create_workspace(
    body: CreateWorkspaceRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new workspace and add the creator as admin member."""
    workspace = Workspace(
        name=body.name,
        org_id=org_id,
        owner_id=user_id,
    )
    db.add(workspace)
    await db.flush()

    # Add owner as admin member
    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user_id,
        role="admin",
        invited_by=user_id,
    )
    db.add(member)
    await db.commit()
    await db.refresh(workspace)

    return {
        "id": str(workspace.id),
        "name": workspace.name,
        "org_id": str(workspace.org_id),
        "owner_id": str(workspace.owner_id),
        "created_at": workspace.created_at.isoformat(),
    }


@router.get("")
async def list_workspaces(
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List workspaces the current user is a member of (within their org)."""
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.org_id == org_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    workspaces = result.scalars().all()

    return [
        {
            "id": str(ws.id),
            "name": ws.name,
            "org_id": str(ws.org_id),
            "owner_id": str(ws.owner_id),
            "created_at": ws.created_at.isoformat(),
            "updated_at": ws.updated_at.isoformat(),
        }
        for ws in workspaces
    ]


@router.post("/{workspace_id}/members")
async def invite_member(
    workspace_id: str,
    body: InviteMemberRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Invite a user to a workspace by email. Caller must be admin of the workspace."""
    wid = uuid.UUID(workspace_id)

    if body.role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}",
        )

    # Verify caller is admin
    await _require_admin(db, wid, org_id, user_id)

    # Find the user to invite
    result = await db.execute(
        select(User).where(User.email == body.email, User.deleted_at.is_(None))
    )
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found with that email",
        )

    # Check if already a member
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == wid,
            WorkspaceMember.user_id == target_user.id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this workspace",
        )

    member = WorkspaceMember(
        workspace_id=wid,
        user_id=target_user.id,
        role=body.role,
        invited_by=user_id,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)

    return {
        "id": str(member.id),
        "workspace_id": str(member.workspace_id),
        "user_id": str(member.user_id),
        "role": member.role,
        "invited_by": str(member.invited_by),
        "joined_at": member.joined_at.isoformat(),
    }


@router.delete("/{workspace_id}/members/{target_user_id}")
async def remove_member(
    workspace_id: str,
    target_user_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from a workspace. Caller must be admin."""
    wid = uuid.UUID(workspace_id)
    tid = uuid.UUID(target_user_id)

    await _require_admin(db, wid, org_id, user_id)

    # Cannot remove the workspace owner
    result = await db.execute(select(Workspace).where(Workspace.id == wid))
    workspace = result.scalar_one_or_none()
    if workspace and workspace.owner_id == tid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the workspace owner",
        )

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == wid,
            WorkspaceMember.user_id == tid,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    await db.delete(member)
    await db.commit()

    return {"detail": "Member removed"}


@router.patch("/{workspace_id}/members/{target_user_id}")
async def change_member_role(
    workspace_id: str,
    target_user_id: str,
    body: ChangeRoleRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Change a member's role. Caller must be admin."""
    wid = uuid.UUID(workspace_id)
    tid = uuid.UUID(target_user_id)

    if body.role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}",
        )

    await _require_admin(db, wid, org_id, user_id)

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == wid,
            WorkspaceMember.user_id == tid,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    member.role = body.role
    await db.commit()
    await db.refresh(member)

    return {
        "id": str(member.id),
        "workspace_id": str(member.workspace_id),
        "user_id": str(member.user_id),
        "role": member.role,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _require_admin(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WorkspaceMember:
    """Verify the workspace exists in the org and the caller is an admin member."""
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.org_id == org_id,
        )
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found",
        )

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role == "admin",
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a workspace admin to perform this action",
        )
    return member
