from __future__ import annotations
"""
Record Comments — threaded comments on any record in generated apps.
Now includes @mention support: when a comment contains @username,
a notification message is sent to the mentioned user(s).

Routes:
  POST   /api/apps/{project_id}/comments/{table}/{record_id}              — add comment
  GET    /api/apps/{project_id}/comments/{table}/{record_id}              — list comments
  DELETE /api/apps/{project_id}/comments/{table}/{record_id}/{comment_id} — delete comment
"""

import re
import uuid
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from routes.app_auth import get_current_app_user
from models.app_record_comment import AppRecordComment
from models.app_user import AppUser
from models.app_message import AppMessage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Record Comments"])

# Regex to extract @mentions from comment content
MENTION_PATTERN = re.compile(r"@(\w+)")


# ── Schemas ──────────────────────────────────────────────────────────

class AddCommentRequest(BaseModel):
    content: str
    parent_id: Optional[str] = None
    user_name: Optional[str] = None
    user_id: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────

async def _resolve_mentions(
    db: AsyncSession,
    project_id: uuid.UUID,
    content: str,
) -> List[dict]:
    """Parse @mentions from content and resolve them to app users."""
    matches = MENTION_PATTERN.findall(content)
    if not matches:
        return []

    # Look up users by display_name or email prefix
    mentioned_users = []
    for username in set(matches):
        search = username.lower()
        result = await db.execute(
            select(AppUser).where(
                AppUser.project_id == project_id,
                AppUser.is_active == True,
                or_(
                    AppUser.display_name.ilike(search),
                    AppUser.email.ilike(f"{search}@%"),
                ),
            ).limit(1)
        )
        user = result.scalar_one_or_none()
        if user:
            mentioned_users.append({
                "id": str(user.id),
                "email": user.email,
                "display_name": user.display_name,
            })
    return mentioned_users


async def _notify_mentioned_users(
    db: AsyncSession,
    project_id: uuid.UUID,
    from_user_id: Optional[str],
    mentioned_users: List[dict],
    comment_content: str,
    table: str,
    record_id: str,
):
    """Create an in-app message notification for each mentioned user."""
    if not from_user_id or not mentioned_users:
        return

    sender_id = uuid.UUID(from_user_id)
    truncated = comment_content[:200] + ("..." if len(comment_content) > 200 else "")

    for user in mentioned_users:
        recipient_id = uuid.UUID(user["id"])
        if recipient_id == sender_id:
            continue  # Don't notify yourself

        msg = AppMessage(
            project_id=project_id,
            from_user_id=sender_id,
            to_user_id=recipient_id,
            content=f"You were mentioned in a comment: \"{truncated}\"",
            record_table=table,
            record_id=record_id,
        )
        db.add(msg)


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/comments/{table}/{record_id}", status_code=201)
async def add_comment(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    body: AddCommentRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Add a comment to a record. Parses @mentions and notifies mentioned users."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    parent_uuid = None
    if body.parent_id:
        try:
            parent_uuid = uuid.UUID(body.parent_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid parent_id format")
        # Verify parent comment exists
        parent_result = await db.execute(
            select(AppRecordComment).where(
                AppRecordComment.id == parent_uuid,
                AppRecordComment.project_id == project_id,
            )
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Parent comment not found")

    comment = AppRecordComment(
        project_id=project_id,
        table_name=table,
        record_id=record_id,
        user_name=body.user_name,
        user_id=body.user_id,
        content=body.content,
        parent_id=parent_uuid,
    )
    db.add(comment)

    # Parse @mentions and resolve to users
    mentioned_users = await _resolve_mentions(db, project_id, body.content)

    # Create notification messages for mentioned users
    await _notify_mentioned_users(
        db, project_id, body.user_id, mentioned_users, body.content, table, record_id
    )

    await db.commit()
    await db.refresh(comment)

    return {
        "id": str(comment.id),
        "project_id": str(comment.project_id),
        "table": comment.table_name,
        "record_id": comment.record_id,
        "user_name": comment.user_name,
        "user_id": comment.user_id,
        "content": comment.content,
        "parent_id": str(comment.parent_id) if comment.parent_id else None,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
        "mentioned_users": mentioned_users,
    }


@router.get("/{project_id}/comments/{table}/{record_id}")
async def list_comments(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List comments for a record, sorted by oldest first (thread order)."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRecordComment)
        .where(
            AppRecordComment.project_id == project_id,
            AppRecordComment.table_name == table,
            AppRecordComment.record_id == record_id,
        )
        .order_by(AppRecordComment.created_at.asc())
        .limit(limit)
        .offset(offset)
    )
    comments = result.scalars().all()

    return [
        {
            "id": str(c.id),
            "user_name": c.user_name,
            "user_id": c.user_id,
            "content": c.content,
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in comments
    ]


@router.delete("/{project_id}/comments/{table}/{record_id}/{comment_id}")
async def delete_comment(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a comment."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRecordComment).where(
            AppRecordComment.id == comment_id,
            AppRecordComment.project_id == project_id,
            AppRecordComment.table_name == table,
            AppRecordComment.record_id == record_id,
        )
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Also delete child comments (replies)
    await db.execute(
        sa_delete(AppRecordComment).where(AppRecordComment.parent_id == comment_id)
    )
    await db.execute(
        sa_delete(AppRecordComment).where(AppRecordComment.id == comment_id)
    )
    await db.commit()

    return {"deleted": True}
