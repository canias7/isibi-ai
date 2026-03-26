from __future__ import annotations
"""
In-App Messaging — send and receive messages between app users.

Routes:
  POST /api/apps/{project_id}/messages                 — send a message
  GET  /api/apps/{project_id}/messages                 — list messages (inbox + sent)
  GET  /api/apps/{project_id}/messages/unread-count     — unread count
  PUT  /api/apps/{project_id}/messages/{id}/read        — mark as read
  GET  /api/apps/{project_id}/users/list                — list app users for autocomplete
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from routes.app_auth import get_current_app_user
from models.app_message import AppMessage
from models.app_user import AppUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Messaging"])


# ── Schemas ──────────────────────────────────────────────────────────

class RecordRef(BaseModel):
    table: Optional[str] = None
    id: Optional[str] = None


class SendMessageRequest(BaseModel):
    to_user_id: str
    content: str
    record_ref: Optional[RecordRef] = None


# ── Helpers ──────────────────────────────────────────────────────────

def _serialize_message(m: AppMessage) -> dict:
    return {
        "id": str(m.id),
        "project_id": str(m.project_id),
        "from_user_id": str(m.from_user_id),
        "to_user_id": str(m.to_user_id),
        "content": m.content,
        "record_table": m.record_table,
        "record_id": m.record_id,
        "is_read": m.is_read,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/messages", status_code=201)
async def send_message(
    project_id: uuid.UUID,
    body: SendMessageRequest,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message to another app user."""
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    to_uid = uuid.UUID(body.to_user_id)

    # Verify recipient exists in this project
    result = await db.execute(
        select(AppUser).where(AppUser.id == to_uid, AppUser.project_id == project_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Recipient user not found")

    msg = AppMessage(
        project_id=project_id,
        from_user_id=claims["user_id"],
        to_user_id=to_uid,
        content=body.content,
        record_table=body.record_ref.table if body.record_ref else None,
        record_id=body.record_ref.id if body.record_ref else None,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    return _serialize_message(msg)


@router.get("/{project_id}/messages")
async def list_messages(
    project_id: uuid.UUID,
    folder: str = Query("all", regex="^(all|inbox|sent)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """List messages for the current user (inbox, sent, or all)."""
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    user_id = claims["user_id"]
    query = select(AppMessage).where(AppMessage.project_id == project_id)

    if folder == "inbox":
        query = query.where(AppMessage.to_user_id == user_id)
    elif folder == "sent":
        query = query.where(AppMessage.from_user_id == user_id)
    else:
        query = query.where(
            or_(AppMessage.to_user_id == user_id, AppMessage.from_user_id == user_id)
        )

    query = query.order_by(AppMessage.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    messages = result.scalars().all()

    return {"messages": [_serialize_message(m) for m in messages]}


@router.get("/{project_id}/messages/unread-count")
async def unread_count(
    project_id: uuid.UUID,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the number of unread messages for the current user."""
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    result = await db.execute(
        select(func.count(AppMessage.id)).where(
            AppMessage.project_id == project_id,
            AppMessage.to_user_id == claims["user_id"],
            AppMessage.is_read == False,
        )
    )
    count = result.scalar() or 0
    return {"count": count}


@router.put("/{project_id}/messages/{message_id}/read")
async def mark_as_read(
    project_id: uuid.UUID,
    message_id: uuid.UUID,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a message as read."""
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    result = await db.execute(
        select(AppMessage).where(
            AppMessage.id == message_id,
            AppMessage.project_id == project_id,
            AppMessage.to_user_id == claims["user_id"],
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.is_read = True
    await db.commit()
    await db.refresh(msg)

    return _serialize_message(msg)


@router.get("/{project_id}/users/list")
async def list_app_users(
    project_id: uuid.UUID,
    q: str = Query("", description="Search filter for display_name or email"),
    limit: int = Query(50, ge=1, le=200),
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """List all app users for this project (for autocomplete / @mentions)."""
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    query = select(AppUser).where(
        AppUser.project_id == project_id,
        AppUser.is_active == True,
    )

    if q:
        search = f"%{q}%"
        query = query.where(
            or_(
                AppUser.email.ilike(search),
                AppUser.display_name.ilike(search),
            )
        )

    query = query.order_by(AppUser.display_name.asc()).limit(limit)
    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "users": [
            {
                "id": str(u.id),
                "email": u.email,
                "display_name": u.display_name,
                "role": u.role,
            }
            for u in users
        ]
    }
