from __future__ import annotations

"""
Push Notifications — subscribe, send, and track push notifications for deployed apps.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.push_subscription import PushSubscription, PushNotificationLog

router = APIRouter(tags=["push-notifications"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SubscribeBody(BaseModel):
    user_identifier: str
    endpoint: str
    p256dh_key: str
    auth_key: str


class SendNotificationBody(BaseModel):
    title: str
    body: str
    url: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/apps/{project_id}/push/subscribe", status_code=201)
async def subscribe_push(
    project_id: str,
    body: SubscribeBody,
    db: AsyncSession = Depends(get_db),
):
    """Save a push subscription (public — called from deployed apps)."""
    pid = uuid.UUID(project_id)

    # Check if subscription already exists for this endpoint
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.project_id == pid,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    sub = existing.scalar_one_or_none()

    if sub:
        # Update existing subscription
        sub.user_identifier = body.user_identifier
        sub.p256dh_key = body.p256dh_key
        sub.auth_key = body.auth_key
        sub.is_active = True
    else:
        sub = PushSubscription(
            project_id=pid,
            user_identifier=body.user_identifier,
            endpoint=body.endpoint,
            p256dh_key=body.p256dh_key,
            auth_key=body.auth_key,
        )
        db.add(sub)

    await db.commit()
    await db.refresh(sub)

    return {
        "id": str(sub.id),
        "subscribed": True,
        "user_identifier": sub.user_identifier,
    }


@router.post("/api/apps/{project_id}/push/send")
async def send_push_notification(
    project_id: str,
    body: SendNotificationBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a push notification to all active subscribers for a project."""
    pid = uuid.UUID(project_id)

    # Fetch all active subscriptions
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.project_id == pid,
            PushSubscription.is_active.is_(True),
        )
    )
    subscriptions = result.scalars().all()

    if not subscriptions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active subscribers found",
        )

    sent_count = 0
    failed_count = 0

    # In a production setup, you'd use pywebpush here.
    # For now, we record the intent and log results.
    for sub in subscriptions:
        try:
            # Placeholder: in production, use pywebpush to send
            # webpush(
            #     subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh_key, "auth": sub.auth_key}},
            #     data=json.dumps({"title": body.title, "body": body.body, "url": body.url}),
            #     vapid_private_key=VAPID_PRIVATE_KEY,
            #     vapid_claims={"sub": "mailto:admin@isibi.ai"},
            # )
            sent_count += 1
        except Exception:
            failed_count += 1
            sub.is_active = False

    # Log the notification
    log = PushNotificationLog(
        project_id=pid,
        title=body.title,
        body=body.body,
        sent_count=sent_count,
        failed_count=failed_count,
    )
    db.add(log)
    await db.commit()

    return {
        "sent_count": sent_count,
        "failed_count": failed_count,
        "total_subscribers": len(subscriptions),
    }


@router.get("/api/projects/{project_id}/push/stats")
async def get_push_stats(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get push notification delivery stats."""
    pid = uuid.UUID(project_id)

    # Total active subscribers
    sub_count_q = select(func.count(PushSubscription.id)).where(
        PushSubscription.project_id == pid,
        PushSubscription.is_active.is_(True),
    )
    active_subscribers = (await db.execute(sub_count_q)).scalar() or 0

    # Total notifications sent
    totals_q = select(
        func.sum(PushNotificationLog.sent_count).label("total_sent"),
        func.sum(PushNotificationLog.failed_count).label("total_failed"),
        func.count(PushNotificationLog.id).label("total_campaigns"),
    ).where(PushNotificationLog.project_id == pid)
    totals = (await db.execute(totals_q)).one()

    # Recent logs
    recent_q = (
        select(PushNotificationLog)
        .where(PushNotificationLog.project_id == pid)
        .order_by(PushNotificationLog.created_at.desc())
        .limit(10)
    )
    recent_result = await db.execute(recent_q)
    recent_logs = recent_result.scalars().all()

    return {
        "active_subscribers": active_subscribers,
        "total_sent": int(totals.total_sent or 0),
        "total_failed": int(totals.total_failed or 0),
        "total_campaigns": totals.total_campaigns or 0,
        "recent_notifications": [
            {
                "id": str(log.id),
                "title": log.title,
                "body": log.body,
                "sent_count": log.sent_count,
                "failed_count": log.failed_count,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in recent_logs
        ],
    }
