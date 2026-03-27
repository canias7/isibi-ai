from __future__ import annotations

"""
Notifications Center — list, read, and manage platform notifications.

Endpoints:
  GET  /api/notifications              — list notifications
  POST /api/notifications/{id}/read    — mark one as read
  POST /api/notifications/read-all     — mark all as read
  GET  /api/notifications/unread-count — unread count
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, desc, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id, get_current_org_id
from db import get_db
from models.notification import PlatformNotification

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/unread-count")
async def unread_count(
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Return the count of unread notifications."""
    result = await db.execute(
        select(func.count(PlatformNotification.id)).where(
            PlatformNotification.user_id == user_id,
            PlatformNotification.org_id == org_id,
            PlatformNotification.is_read == False,
        )
    )
    count = result.scalar() or 0
    return {"count": count}


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List notifications for the current user."""
    base_filter = [
        PlatformNotification.user_id == user_id,
        PlatformNotification.org_id == org_id,
    ]
    if unread_only:
        base_filter.append(PlatformNotification.is_read == False)

    count_result = await db.execute(
        select(func.count(PlatformNotification.id)).where(*base_filter)
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * limit
    query = (
        select(PlatformNotification)
        .where(*base_filter)
        .order_by(desc(PlatformNotification.created_at))
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    notifications = result.scalars().all()

    return {
        "data": [
            {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "is_read": n.is_read,
                "action_url": n.action_url,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifications
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


@router.api_route("/{notification_id}/read", methods=["PUT", "POST"])
async def mark_as_read(
    notification_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single notification as read."""
    result = await db.execute(
        select(PlatformNotification).where(
            PlatformNotification.id == notification_id,
            PlatformNotification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    notification.is_read = True
    await db.commit()
    return {"detail": "Notification marked as read"}


@router.post("/read-all")
async def mark_all_as_read(
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read for the current user."""
    await db.execute(
        update(PlatformNotification)
        .where(
            PlatformNotification.user_id == user_id,
            PlatformNotification.org_id == org_id,
            PlatformNotification.is_read == False,
        )
        .values(is_read=True)
    )
    await db.commit()
    return {"detail": "All notifications marked as read"}
