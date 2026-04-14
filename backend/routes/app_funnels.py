from __future__ import annotations

"""
Funnel Visualization — define and compute conversion funnels on app data.
"""

import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_funnel import AppFunnel
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

router = APIRouter(prefix="/apps", tags=["App Funnels"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


# ── Schemas ──────────────────────────────────────────────────────────────────

class FunnelCreateBody(BaseModel):
    name: str
    entity: str
    status_field: str
    stages: list[str]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_ident(name: str) -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return clean


def _serialize(f: AppFunnel) -> dict:
    return {
        "id": str(f.id),
        "project_id": str(f.project_id),
        "org_id": str(f.org_id),
        "name": f.name,
        "entity": f.entity,
        "status_field": f.status_field,
        "stages": f.stages or [],
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/funnels", status_code=status.HTTP_201_CREATED)
async def create_funnel(
    project_id: str,
    body: FunnelCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a funnel definition."""
    if not body.stages or len(body.stages) < 2:
        raise HTTPException(status_code=400, detail="At least 2 stages are required")

    funnel = AppFunnel(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        entity=body.entity,
        status_field=body.status_field,
        stages=body.stages,
    )
    db.add(funnel)
    await db.commit()
    await db.refresh(funnel)
    return _serialize(funnel)


@router.get("/{project_id}/funnels")
async def list_funnels(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all funnel definitions for a project."""
    result = await db.execute(
        select(AppFunnel).where(
            AppFunnel.project_id == uuid.UUID(project_id),
            AppFunnel.org_id == org_id,
        ).order_by(AppFunnel.created_at.desc())
    )
    funnels = result.scalars().all()
    return {"items": [_serialize(f) for f in funnels]}


@router.post("/{project_id}/funnels/{funnel_id}/data")
async def compute_funnel_data(
    project_id: str,
    funnel_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Compute funnel data — count and conversion percentage per stage."""
    result = await db.execute(
        select(AppFunnel).where(
            AppFunnel.id == uuid.UUID(funnel_id),
            AppFunnel.project_id == uuid.UUID(project_id),
            AppFunnel.org_id == org_id,
        )
    )
    funnel = result.scalar_one_or_none()
    if not funnel:
        raise HTTPException(status_code=404, detail="Funnel not found")

    table = _safe_ident(funnel.entity)
    status_col = _safe_ident(funnel.status_field)
    schema = get_schema_name(project_id)

    tables = await list_schema_tables(project_id, DATABASE_URL)
    if table not in tables:
        raise HTTPException(status_code=400, detail=f"Entity table '{table}' not found in app schema")

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Get total count (non-deleted)
        total_row = await conn.fetchrow(
            f'SELECT COUNT(*) as total FROM "{table}" WHERE "deleted_at" IS NULL'
        )
        total = total_row["total"] if total_row else 0

        # Count per stage
        stages_data = []
        first_count = None
        for stage_name in (funnel.stages or []):
            row = await conn.fetchrow(
                f'SELECT COUNT(*) as cnt FROM "{table}" WHERE "{status_col}" = $1 AND "deleted_at" IS NULL',
                stage_name,
            )
            count = row["cnt"] if row else 0
            if first_count is None:
                first_count = count if count > 0 else total

            conversion = round((count / first_count * 100), 1) if first_count and first_count > 0 else 0

            stages_data.append({
                "stage": stage_name,
                "count": count,
                "conversion_pct": conversion,
            })

        return {
            "funnel": _serialize(funnel),
            "total_records": total,
            "stages": stages_data,
        }
    finally:
        await conn.close()
