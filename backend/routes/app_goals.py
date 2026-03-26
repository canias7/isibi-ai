from __future__ import annotations

"""
Goal Tracking — set and track measurable goals against app data.
"""

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_goal import AppGoal
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

router = APIRouter(prefix="/apps", tags=["App Goals"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

VALID_METRICS = {"count", "sum"}
VALID_PERIODS = {"daily", "weekly", "monthly", "quarterly"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class GoalCreateBody(BaseModel):
    name: str
    entity: str
    metric: str = "count"
    field: Optional[str] = None
    target_value: float
    period: str = "monthly"
    start_date: Optional[date] = None
    end_date: Optional[date] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_ident(name: str) -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return clean


def _get_period_range(period: str, start: Optional[date] = None, end: Optional[date] = None) -> tuple[date, date]:
    """Return (start, end) dates for a goal period."""
    if start and end:
        return start, end
    today = date.today()
    if period == "daily":
        return today, today
    elif period == "weekly":
        start_of_week = today - timedelta(days=today.weekday())
        return start_of_week, start_of_week + timedelta(days=6)
    elif period == "monthly":
        first = today.replace(day=1)
        if today.month == 12:
            last = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            last = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        return first, last
    elif period == "quarterly":
        q = (today.month - 1) // 3
        first = date(today.year, q * 3 + 1, 1)
        if q == 3:
            last = date(today.year + 1, 1, 1) - timedelta(days=1)
        else:
            last = date(today.year, (q + 1) * 3 + 1, 1) - timedelta(days=1)
        return first, last
    return today, today


def _serialize(g: AppGoal) -> dict:
    return {
        "id": str(g.id),
        "project_id": str(g.project_id),
        "org_id": str(g.org_id),
        "name": g.name,
        "entity": g.entity,
        "metric": g.metric,
        "field": g.field,
        "target_value": g.target_value,
        "current_value": g.current_value,
        "period": g.period,
        "start_date": g.start_date.isoformat() if g.start_date else None,
        "end_date": g.end_date.isoformat() if g.end_date else None,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/goals", status_code=status.HTTP_201_CREATED)
async def create_goal(
    project_id: str,
    body: GoalCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new goal."""
    if body.metric not in VALID_METRICS:
        raise HTTPException(status_code=400, detail=f"Invalid metric. Must be one of: {', '.join(VALID_METRICS)}")
    if body.period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"Invalid period. Must be one of: {', '.join(VALID_PERIODS)}")
    if body.metric == "sum" and not body.field:
        raise HTTPException(status_code=400, detail="Field is required when metric is 'sum'")

    goal = AppGoal(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        entity=body.entity,
        metric=body.metric,
        field=body.field,
        target_value=body.target_value,
        current_value=0,
        period=body.period,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


@router.get("/{project_id}/goals")
async def list_goals(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all goals with current progress computed from real data."""
    result = await db.execute(
        select(AppGoal).where(
            AppGoal.project_id == uuid.UUID(project_id),
            AppGoal.org_id == org_id,
        ).order_by(AppGoal.created_at.desc())
    )
    goals = result.scalars().all()

    schema = get_schema_name(project_id)
    tables = await list_schema_tables(project_id, DATABASE_URL)

    items = []
    for g in goals:
        data = _serialize(g)
        table = g.entity.strip().lower()
        if table in tables:
            try:
                conn = await _get_raw_connection(DATABASE_URL)
                try:
                    await conn.execute(f'SET search_path TO "{schema}"')
                    start, end = _get_period_range(g.period, g.start_date, g.end_date)

                    if g.metric == "count":
                        row = await conn.fetchrow(
                            f'SELECT COUNT(*) as val FROM "{table}" '
                            f'WHERE "deleted_at" IS NULL AND "created_at" >= $1 AND "created_at" <= $2',
                            datetime.combine(start, datetime.min.time()),
                            datetime.combine(end, datetime.max.time()),
                        )
                    else:
                        field = _safe_ident(g.field) if g.field else "id"
                        row = await conn.fetchrow(
                            f'SELECT COALESCE(SUM("{field}"::numeric), 0) as val FROM "{table}" '
                            f'WHERE "deleted_at" IS NULL AND "created_at" >= $1 AND "created_at" <= $2',
                            datetime.combine(start, datetime.min.time()),
                            datetime.combine(end, datetime.max.time()),
                        )
                    current = float(row["val"]) if row else 0
                    data["current_value"] = current
                    data["progress_pct"] = round((current / g.target_value * 100), 1) if g.target_value else 0
                finally:
                    await conn.close()
            except Exception:
                data["progress_pct"] = 0
        else:
            data["progress_pct"] = 0
        items.append(data)

    return {"items": items}


@router.delete("/{project_id}/goals/{goal_id}")
async def delete_goal(
    project_id: str,
    goal_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a goal."""
    result = await db.execute(
        select(AppGoal).where(
            AppGoal.id == uuid.UUID(goal_id),
            AppGoal.project_id == uuid.UUID(project_id),
            AppGoal.org_id == org_id,
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    await db.delete(goal)
    await db.commit()
    return {"detail": "Goal deleted"}
