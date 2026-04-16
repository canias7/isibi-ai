from __future__ import annotations

"""
Session Management — list and revoke active sessions for app users.

Endpoints:
  GET    /api/apps/{project_id}/sessions  — list active sessions
  DELETE /api/apps/{project_id}/sessions  — revoke all sessions
  DELETE /api/apps/{project_id}/sessions/{session_id}  — revoke a specific session
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_session import AppSession

router = APIRouter(prefix="/apps", tags=["App Sessions"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(s: AppSession) -> dict:
    return {
        "id": str(s.id),
        "project_id": str(s.project_id),
        "user_id": str(s.user_id),
        "ip_address": s.ip_address,
        "user_agent": s.user_agent,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "last_active_at": s.last_active_at.isoformat() if s.last_active_at else None,
        "revoked": s.revoked,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/sessions")
async def list_sessions(
    project_id: str,
    user_id: str | None = None,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all active (non-revoked) sessions for a project, optionally filtered by user."""
    pid = uuid.UUID(project_id)
    query = select(AppSession).where(
        AppSession.project_id == pid,
        AppSession.revoked.is_(False),
    ).order_by(AppSession.last_active_at.desc())

    if user_id:
        query = query.where(AppSession.user_id == uuid.UUID(user_id))

    result = await db.execute(query)
    sessions = result.scalars().all()
    return {"items": [_serialize(s) for s in sessions]}


@router.delete("/{project_id}/sessions")
async def revoke_all_sessions(
    project_id: str,
    user_id: str | None = None,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Revoke all active sessions for a project (or for a specific user)."""
    pid = uuid.UUID(project_id)
    stmt = (
        update(AppSession)
        .where(
            AppSession.project_id == pid,
            AppSession.revoked.is_(False),
        )
        .values(revoked=True)
    )

    if user_id:
        stmt = stmt.where(AppSession.user_id == uuid.UUID(user_id))

    await db.execute(stmt)
    await db.commit()
    return {"detail": "All matching sessions revoked"}


@router.delete("/{project_id}/sessions/{session_id}")
async def revoke_session(
    project_id: str,
    session_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a specific session."""
    result = await db.execute(
        select(AppSession).where(
            AppSession.id == uuid.UUID(session_id),
            AppSession.project_id == uuid.UUID(project_id),
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.revoked = True
    await db.commit()
    return {"detail": "Session revoked"}
