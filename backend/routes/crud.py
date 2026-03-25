from __future__ import annotations
"""Shared CRUD helpers with cursor-based pagination, soft delete, and org_id filtering."""

import base64
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession


async def paginated_list(
    db: AsyncSession,
    model,
    org_id: UUID,
    limit: int = 25,
    cursor: str | None = None,
):
    if limit > 100:
        limit = 100

    base_filter = and_(model.org_id == org_id, model.deleted_at.is_(None))

    # Total count
    count_q = select(func.count()).select_from(model).where(base_filter)
    total = (await db.execute(count_q)).scalar_one()

    # Query with cursor
    q = select(model).where(base_filter).order_by(model.created_at.desc(), model.id)

    if cursor:
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode()).decode()
            cursor_ts, cursor_id = decoded.rsplit("|", 1)
            cursor_dt = datetime.fromisoformat(cursor_ts)
            q = q.where(
                (model.created_at < cursor_dt)
                | (and_(model.created_at == cursor_dt, model.id > UUID(cursor_id)))
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    q = q.limit(limit + 1)
    result = await db.execute(q)
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    data = rows[:limit]

    next_cursor = None
    if has_more and data:
        last = data[-1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()

    return {
        "data": data,
        "meta": {
            "total": total,
            "limit": limit,
            "cursor": next_cursor,
            "has_more": has_more,
        },
    }


async def get_one(db: AsyncSession, model, record_id: UUID, org_id: UUID):
    q = select(model).where(
        and_(model.id == record_id, model.org_id == org_id, model.deleted_at.is_(None))
    )
    result = await db.execute(q)
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


async def create_one(db: AsyncSession, model, org_id: UUID, data: dict):
    obj = model(**data, org_id=org_id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


async def update_one(db: AsyncSession, model, record_id: UUID, org_id: UUID, data: dict):
    obj = await get_one(db, model, record_id, org_id)

    # Optimistic lock check
    incoming_version = data.pop("version", None)
    if incoming_version is not None and obj.version != incoming_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record was modified by another user. Please refresh and try again.",
        )

    for key, value in data.items():
        setattr(obj, key, value)
    obj.version += 1
    obj.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(obj)
    return obj


async def soft_delete(db: AsyncSession, model, record_id: UUID, org_id: UUID):
    obj = await get_one(db, model, record_id, org_id)
    obj.deleted_at = datetime.utcnow()
    obj.updated_at = datetime.utcnow()
    await db.commit()
