from __future__ import annotations

"""
Cohort Analysis — compute retention cohort matrices on app data.
No model needed; all data is computed on the fly.
"""

import re
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

router = APIRouter(prefix="/apps", tags=["App Cohorts"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

VALID_PERIODS = {"weekly", "monthly"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class CohortAnalyzeBody(BaseModel):
    entity: str
    date_field: str = "created_at"
    activity_entity: str
    activity_date_field: str = "created_at"
    period: str = "monthly"
    periods_count: int = 6


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_ident(name: str) -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return clean


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/cohorts/analyze")
async def analyze_cohorts(
    project_id: str,
    body: CohortAnalyzeBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute a cohort retention matrix.
    Groups users by signup period, then measures how many had activity in subsequent periods.
    """
    if body.period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"Period must be one of: {', '.join(VALID_PERIODS)}")

    entity_table = _safe_ident(body.entity)
    activity_table = _safe_ident(body.activity_entity)
    date_field = _safe_ident(body.date_field)
    activity_date_field = _safe_ident(body.activity_date_field)
    schema = get_schema_name(project_id)

    tables = await list_schema_tables(project_id, DATABASE_URL)
    if entity_table not in tables:
        raise HTTPException(status_code=400, detail=f"Entity table '{entity_table}' not found")
    if activity_table not in tables:
        raise HTTPException(status_code=400, detail=f"Activity table '{activity_table}' not found")

    trunc = "month" if body.period == "monthly" else "week"

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Get cohort signup periods
        cohort_query = f"""
            SELECT
                date_trunc('{trunc}', "{date_field}") AS cohort_period,
                "id" AS user_id
            FROM "{entity_table}"
            WHERE "deleted_at" IS NULL
            ORDER BY cohort_period
        """
        cohort_rows = await conn.fetch(cohort_query)

        if not cohort_rows:
            return {"cohorts": [], "periods": [], "period_type": body.period}

        # Build user -> cohort mapping
        user_cohorts: dict[str, datetime] = {}
        cohort_sizes: dict[str, int] = {}
        for row in cohort_rows:
            uid = str(row["user_id"])
            cp = row["cohort_period"]
            user_cohorts[uid] = cp
            key = cp.isoformat()
            cohort_sizes[key] = cohort_sizes.get(key, 0) + 1

        # Get activity data — look for a user_id or entity foreign key
        # Try common FK patterns: user_id, customer_id, {entity}_id
        possible_fks = ["user_id", "customer_id", f"{entity_table.rstrip('s')}_id", "created_by"]

        # Check which columns exist
        cols_rows = await conn.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = $1 AND table_name = $2",
            schema, activity_table,
        )
        existing_cols = {r["column_name"] for r in cols_rows}

        fk_col = None
        for candidate in possible_fks:
            if candidate in existing_cols:
                fk_col = candidate
                break

        if not fk_col:
            return {
                "cohorts": [],
                "periods": [],
                "period_type": body.period,
                "error": f"Could not find a foreign key linking '{activity_table}' to '{entity_table}'. "
                         f"Tried: {', '.join(possible_fks)}",
            }

        activity_query = f"""
            SELECT
                "{fk_col}" AS user_id,
                date_trunc('{trunc}', "{activity_date_field}") AS activity_period
            FROM "{activity_table}"
            WHERE "deleted_at" IS NULL
            GROUP BY "{fk_col}", date_trunc('{trunc}', "{activity_date_field}")
        """
        activity_rows = await conn.fetch(activity_query)

        # Build the cohort matrix
        sorted_cohorts = sorted(cohort_sizes.keys())
        # Limit to most recent N cohorts
        sorted_cohorts = sorted_cohorts[-body.periods_count:]

        cohort_matrix = []
        for cohort_key in sorted_cohorts:
            cohort_dt = datetime.fromisoformat(cohort_key)
            size = cohort_sizes[cohort_key]

            # Find users in this cohort
            cohort_users = {uid for uid, cp in user_cohorts.items() if cp.isoformat() == cohort_key}

            # For each subsequent period, count active users
            retention = [{"period": 0, "count": size, "pct": 100.0}]
            for offset in range(1, body.periods_count):
                if body.period == "monthly":
                    month = cohort_dt.month + offset
                    year = cohort_dt.year + (month - 1) // 12
                    month = ((month - 1) % 12) + 1
                    target = datetime(year, month, 1)
                else:
                    from datetime import timedelta
                    target = cohort_dt + timedelta(weeks=offset)

                target_key = target.isoformat()
                active = 0
                for row in activity_rows:
                    uid = str(row["user_id"])
                    if uid in cohort_users and row["activity_period"] and row["activity_period"].isoformat() == target_key:
                        active += 1

                pct = round(active / size * 100, 1) if size > 0 else 0
                retention.append({"period": offset, "count": active, "pct": pct})

            cohort_matrix.append({
                "cohort": cohort_key,
                "size": size,
                "retention": retention,
            })

        return {
            "cohorts": cohort_matrix,
            "period_type": body.period,
            "periods_count": body.periods_count,
        }
    finally:
        await conn.close()
