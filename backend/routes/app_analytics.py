from __future__ import annotations

"""
Analytics Dashboard — track and query app usage events.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select, func, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_analytics import AppEvent

router = APIRouter(tags=["app-analytics"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class TrackEventBody(BaseModel):
    event_type: str  # max length validated below
    page: Optional[str] = None
    metadata: Optional[dict] = None

    def model_post_init(self, __context) -> None:
        if len(self.event_type) > 100:
            raise ValueError("event_type must be 100 characters or fewer")
        if self.page and len(self.page) > 500:
            raise ValueError("page must be 500 characters or fewer")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_event(e: AppEvent) -> dict:
    return {
        "id": str(e.id),
        "project_id": str(e.project_id),
        "event_type": e.event_type,
        "page": e.page,
        "user_agent": e.user_agent,
        "ip_address": e.ip_address,
        "metadata": e.event_metadata,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/apps/{project_id}/analytics/track", status_code=201)
async def track_event(
    project_id: str,
    body: TrackEventBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Track an analytics event (public, no auth — called from deployed apps)."""
    pid = uuid.UUID(project_id)

    event = AppEvent(
        project_id=pid,
        event_type=body.event_type,
        page=body.page,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        event_metadata=body.metadata,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return {"id": str(event.id), "tracked": True}


@router.get("/api/projects/{project_id}/analytics")
async def get_analytics_summary(
    project_id: str,
    days: int = Query(7, pattern="^(7|30|90)$"),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get analytics summary for a project."""
    pid = uuid.UUID(project_id)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    base_filter = [AppEvent.project_id == pid, AppEvent.created_at >= since]

    # Total views
    total_views_q = select(func.count(AppEvent.id)).where(
        *base_filter, AppEvent.event_type == "page_view"
    )
    total_views = (await db.execute(total_views_q)).scalar() or 0

    # Unique visitors (by IP)
    unique_q = select(func.count(func.distinct(AppEvent.ip_address))).where(
        *base_filter, AppEvent.event_type == "page_view"
    )
    unique_visitors = (await db.execute(unique_q)).scalar() or 0

    # Top pages
    top_pages_q = (
        select(AppEvent.page, func.count(AppEvent.id).label("views"))
        .where(*base_filter, AppEvent.event_type == "page_view", AppEvent.page.isnot(None))
        .group_by(AppEvent.page)
        .order_by(func.count(AppEvent.id).desc())
        .limit(10)
    )
    top_pages_result = await db.execute(top_pages_q)
    top_pages = [{"page": row.page, "views": row.views} for row in top_pages_result.all()]

    # Events by day
    events_by_day_q = (
        select(
            cast(AppEvent.created_at, Date).label("day"),
            func.count(AppEvent.id).label("count"),
        )
        .where(*base_filter)
        .group_by(cast(AppEvent.created_at, Date))
        .order_by(cast(AppEvent.created_at, Date))
    )
    ebd_result = await db.execute(events_by_day_q)
    events_by_day = [
        {"date": row.day.isoformat(), "count": row.count}
        for row in ebd_result.all()
    ]

    # Signups
    signups_q = select(func.count(AppEvent.id)).where(
        *base_filter, AppEvent.event_type == "signup"
    )
    signups = (await db.execute(signups_q)).scalar() or 0

    return {
        "total_views": total_views,
        "unique_visitors": unique_visitors,
        "top_pages": top_pages,
        "events_by_day": events_by_day,
        "signups": signups,
        "days": days,
    }


@router.get("/api/projects/{project_id}/analytics/events")
async def list_analytics_events(
    project_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List raw analytics events."""
    pid = uuid.UUID(project_id)

    query = (
        select(AppEvent)
        .where(AppEvent.project_id == pid)
        .order_by(AppEvent.created_at.desc())
    )

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    events = result.scalars().all()

    return {
        "items": [_serialize_event(e) for e in events],
        "total": total,
        "page": page,
        "limit": limit,
    }
