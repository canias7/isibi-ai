from __future__ import annotations

"""
Custom Report Builder — create, save, and run custom reports against app data.
"""

import re
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_custom_report import AppCustomReport
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

router = APIRouter(prefix="/apps", tags=["App Report Builder"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


# ── Schemas ──────────────────────────────────────────────────────────────────

class ReportCreateBody(BaseModel):
    name: str
    entity: str
    columns: list[str] = []
    filters: dict[str, Any] = {}
    group_by: Optional[str] = None
    sort_by: Optional[str] = None
    chart_type: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_ident(name: str) -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return clean


def _serialize(r: AppCustomReport) -> dict:
    return {
        "id": str(r.id),
        "project_id": str(r.project_id),
        "org_id": str(r.org_id),
        "name": r.name,
        "entity": r.entity,
        "columns": r.columns or [],
        "filters": r.filters or {},
        "group_by": r.group_by,
        "sort_by": r.sort_by,
        "chart_type": r.chart_type,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _row_to_dict(record) -> dict[str, Any]:
    d = dict(record)
    for k, v in d.items():
        if hasattr(v, "hex"):
            d[k] = str(v)
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/reports", status_code=status.HTTP_201_CREATED)
async def create_report(
    project_id: str,
    body: ReportCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a saved report configuration."""
    report = AppCustomReport(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        entity=body.entity,
        columns=body.columns,
        filters=body.filters,
        group_by=body.group_by,
        sort_by=body.sort_by,
        chart_type=body.chart_type,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _serialize(report)


@router.get("/{project_id}/reports")
async def list_reports(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all saved reports for a project."""
    result = await db.execute(
        select(AppCustomReport).where(
            AppCustomReport.project_id == uuid.UUID(project_id),
            AppCustomReport.org_id == org_id,
        ).order_by(AppCustomReport.created_at.desc())
    )
    reports = result.scalars().all()
    return {"items": [_serialize(r) for r in reports]}


@router.post("/{project_id}/reports/{report_id}/run")
async def run_report(
    project_id: str,
    report_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Execute a saved report against the app's data schema."""
    result = await db.execute(
        select(AppCustomReport).where(
            AppCustomReport.id == uuid.UUID(report_id),
            AppCustomReport.project_id == uuid.UUID(project_id),
            AppCustomReport.org_id == org_id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    table = _safe_ident(report.entity)
    schema = get_schema_name(project_id)

    # Verify table exists
    tables = await list_schema_tables(project_id, DATABASE_URL)
    if table not in tables:
        raise HTTPException(status_code=400, detail=f"Entity table '{table}' not found in app schema")

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Build column list
        cols = ", ".join(f'"{_safe_ident(c)}"' for c in report.columns) if report.columns else "*"

        # Build WHERE clause from filters
        where_parts = ['"deleted_at" IS NULL']
        params: list[Any] = []
        idx = 1
        for field, value in (report.filters or {}).items():
            col = _safe_ident(field)
            if isinstance(value, dict):
                op = value.get("op", "=")
                val = value.get("value")
                if op in ("=", "!=", ">", "<", ">=", "<="):
                    where_parts.append(f'"{col}" {op} ${idx}')
                    params.append(val)
                    idx += 1
            else:
                where_parts.append(f'"{col}" = ${idx}')
                params.append(value)
                idx += 1

        where_clause = " AND ".join(where_parts)

        # Build GROUP BY
        group_clause = ""
        if report.group_by:
            group_col = _safe_ident(report.group_by)
            group_clause = f' GROUP BY "{group_col}"'

        # Build ORDER BY
        order_clause = ""
        if report.sort_by:
            sort_col = _safe_ident(report.sort_by)
            order_clause = f' ORDER BY "{sort_col}"'

        query = f'SELECT {cols} FROM "{table}" WHERE {where_clause}{group_clause}{order_clause} LIMIT 1000'
        rows = await conn.fetch(query, *params)

        data = [_row_to_dict(r) for r in rows]

        # Compute simple aggregates
        count_row = await conn.fetchrow(
            f'SELECT COUNT(*) as total FROM "{table}" WHERE {where_clause}', *params
        )
        total = count_row["total"] if count_row else 0

        return {
            "report": _serialize(report),
            "data": data,
            "aggregates": {"total_count": total, "returned_rows": len(data)},
        }
    finally:
        await conn.close()


@router.delete("/{project_id}/reports/{report_id}")
async def delete_report(
    project_id: str,
    report_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved report."""
    result = await db.execute(
        select(AppCustomReport).where(
            AppCustomReport.id == uuid.UUID(report_id),
            AppCustomReport.project_id == uuid.UUID(project_id),
            AppCustomReport.org_id == org_id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(report)
    await db.commit()
    return {"detail": "Report deleted"}
