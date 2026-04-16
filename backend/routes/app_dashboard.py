from __future__ import annotations
"""
App Dashboard Analytics — usage analytics for generated app owners.

These endpoints let platform users (app owners) see how their generated
app is being used: total users, row counts per table, and recent activity.

Routes:
  GET /api/apps/{project_id}/analytics/summary — overview stats
  GET /api/apps/{project_id}/analytics/growth   — daily row counts (30 days)
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from generator.app_db import (
    get_schema_name,
    list_schema_tables,
    _get_raw_connection,
)
from generator.orchestrator import _get_project
from models.app_user import AppUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Dashboard"])


# ── Response schemas ─────────────────────────────────────────────────

class TableStat(BaseModel):
    name: str
    row_count: int

class ActivityEntry(BaseModel):
    table: str
    action: str
    count: int
    date: str

class AnalyticsSummary(BaseModel):
    total_users: int
    tables: list[TableStat]
    recent_activity: list[ActivityEntry]

class DailyGrowth(BaseModel):
    date: str
    table: str
    row_count: int

class GrowthResponse(BaseModel):
    growth: list[DailyGrowth]


# ── Helpers ──────────────────────────────────────────────────────────

async def _count_table_rows(
    schema: str,
    table_name: str,
    conn,
) -> int:
    """Count non-deleted rows in a table."""
    try:
        row = await conn.fetchrow(
            f'SELECT COUNT(*) AS cnt FROM "{schema}"."{table_name}" '
            f'WHERE "deleted_at" IS NULL'
        )
        return row["cnt"] if row else 0
    except Exception:
        # Table might not have deleted_at, try without filter
        try:
            row = await conn.fetchrow(
                f'SELECT COUNT(*) AS cnt FROM "{schema}"."{table_name}"'
            )
            return row["cnt"] if row else 0
        except Exception as e:
            logger.warning("Failed to count rows in %s.%s: %s", schema, table_name, e)
            return 0


async def _get_recent_inserts(
    schema: str,
    table_name: str,
    conn,
    days: int = 7,
) -> list[dict]:
    """
    Get daily insert counts for a table over the last N days.

    Looks for a created_at column; skips if not present.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        rows = await conn.fetch(
            f'SELECT DATE("created_at") AS d, COUNT(*) AS cnt '
            f'FROM "{schema}"."{table_name}" '
            f'WHERE "created_at" >= $1 AND "deleted_at" IS NULL '
            f"GROUP BY d ORDER BY d DESC",
            cutoff,
        )
        return [{"date": str(r["d"]), "count": r["cnt"]} for r in rows]
    except Exception:
        # Table may not have created_at or deleted_at
        return []


async def _get_daily_row_counts(
    schema: str,
    table_name: str,
    conn,
    days: int = 30,
) -> list[dict]:
    """
    Get daily cumulative row counts by created_at for the last N days.

    Returns one entry per day with the count of rows created on that date.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        rows = await conn.fetch(
            f'SELECT DATE("created_at") AS d, COUNT(*) AS cnt '
            f'FROM "{schema}"."{table_name}" '
            f'WHERE "created_at" >= $1 '
            f"GROUP BY d ORDER BY d ASC",
            cutoff,
        )
        return [
            {"date": str(r["d"]), "table": table_name, "row_count": r["cnt"]}
            for r in rows
        ]
    except Exception:
        # Table may not have created_at
        return []


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/{project_id}/analytics/summary")
async def analytics_summary(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsSummary:
    """
    Get an analytics summary for a generated app.

    Requires platform auth (app owner).
    """
    # Verify project belongs to the requesting org
    await _get_project(db, project_id, org_id)

    pid_str = str(project_id)

    # Count app users for this project
    result = await db.execute(
        select(func.count(AppUser.id)).where(
            AppUser.project_id == project_id,
            AppUser.is_active.is_(True),
        )
    )
    total_users = result.scalar() or 0

    # Get table stats from the app schema
    tables = await list_schema_tables(pid_str, DATABASE_URL)
    schema = get_schema_name(pid_str)

    table_stats: list[TableStat] = []
    recent_activity: list[ActivityEntry] = []

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        for table_name in tables:
            row_count = await _count_table_rows(schema, table_name, conn)
            table_stats.append(TableStat(name=table_name, row_count=row_count))

            # Recent inserts (last 7 days)
            inserts = await _get_recent_inserts(schema, table_name, conn, days=7)
            for entry in inserts:
                recent_activity.append(
                    ActivityEntry(
                        table=table_name,
                        action="insert",
                        count=entry["count"],
                        date=entry["date"],
                    )
                )
    finally:
        await conn.close()

    # Sort recent activity by date descending
    recent_activity.sort(key=lambda a: a.date, reverse=True)

    return AnalyticsSummary(
        total_users=total_users,
        tables=table_stats,
        recent_activity=recent_activity,
    )


@router.get("/{project_id}/analytics/growth")
async def analytics_growth(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
) -> GrowthResponse:
    """
    Get daily row-creation counts for the last 30 days, per table.

    Requires platform auth (app owner).
    """
    # Verify project belongs to the requesting org
    await _get_project(db, project_id, org_id)

    pid_str = str(project_id)
    tables = await list_schema_tables(pid_str, DATABASE_URL)
    schema = get_schema_name(pid_str)

    growth: list[DailyGrowth] = []

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        for table_name in tables:
            daily = await _get_daily_row_counts(schema, table_name, conn, days=30)
            for entry in daily:
                growth.append(
                    DailyGrowth(
                        date=entry["date"],
                        table=entry["table"],
                        row_count=entry["row_count"],
                    )
                )
    finally:
        await conn.close()

    # Sort by date ascending
    growth.sort(key=lambda g: (g.date, g.table))

    return GrowthResponse(growth=growth)
