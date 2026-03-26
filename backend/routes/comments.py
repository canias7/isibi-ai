from __future__ import annotations

"""
Project Comments — threaded comments on projects.

Endpoints:
  GET    /api/projects/{id}/comments              — list comments (threaded)
  POST   /api/projects/{id}/comments              — add comment
  PATCH  /api/projects/{id}/comments/{comment_id} — edit comment
  DELETE /api/projects/{id}/comments/{comment_id} — delete (owner only)
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id, get_current_org_id
from db import get_db
from models.comment import Comment
from models.project import Project

router = APIRouter(prefix="/projects", tags=["comments"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateCommentBody(BaseModel):
    body: str
    parent_id: Optional[str] = None


class UpdateCommentBody(BaseModel):
    body: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _comment_to_dict(c: Comment) -> dict:
    return {
        "id": str(c.id),
        "project_id": str(c.project_id),
        "user_id": str(c.user_id),
        "body": c.body,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "replies": [],
    }


def _build_thread(comments: list[Comment]) -> list[dict]:
    """Build a threaded comment tree from a flat list."""
    by_id: dict[str, dict] = {}
    roots: list[dict] = []

    for c in comments:
        by_id[str(c.id)] = _comment_to_dict(c)

    for c in comments:
        d = by_id[str(c.id)]
        if c.parent_id and str(c.parent_id) in by_id:
            by_id[str(c.parent_id)]["replies"].append(d)
        else:
            roots.append(d)

    return roots


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/comments")
async def list_comments(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List comments for a project in threaded format."""
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    result = await db.execute(
        select(Comment)
        .where(Comment.project_id == project_id, Comment.org_id == org_id)
        .order_by(Comment.created_at)
    )
    comments = result.scalars().all()

    return {"data": _build_thread(list(comments))}


@router.post("/{project_id}/comments")
async def create_comment(
    project_id: uuid.UUID,
    body: CreateCommentBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a comment to a project."""
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    parent_uuid = uuid.UUID(body.parent_id) if body.parent_id else None

    # Validate parent exists if provided
    if parent_uuid:
        parent_result = await db.execute(
            select(Comment).where(Comment.id == parent_uuid, Comment.project_id == project_id)
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent comment not found")

    comment = Comment(
        project_id=project_id,
        user_id=user_id,
        org_id=org_id,
        body=body.body,
        parent_id=parent_uuid,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    return _comment_to_dict(comment)


@router.patch("/{project_id}/comments/{comment_id}")
async def update_comment(
    project_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: UpdateCommentBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Edit a comment (owner only)."""
    result = await db.execute(
        select(Comment).where(
            Comment.id == comment_id,
            Comment.project_id == project_id,
            Comment.org_id == org_id,
        )
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    if comment.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only edit your own comments")

    comment.body = body.body
    from datetime import datetime
    comment.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(comment)

    return _comment_to_dict(comment)


@router.delete("/{project_id}/comments/{comment_id}")
async def delete_comment(
    project_id: uuid.UUID,
    comment_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a comment (owner only)."""
    result = await db.execute(
        select(Comment).where(
            Comment.id == comment_id,
            Comment.project_id == project_id,
            Comment.org_id == org_id,
        )
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    if comment.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only delete your own comments")

    await db.delete(comment)
    await db.commit()

    return {"detail": "Comment deleted"}
