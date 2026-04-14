from __future__ import annotations

"""
Status Auto-Progression — automatically change record status
when it stays in a given state for too long.
"""

import uuid
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_status_rule import AppStatusRule
from generator.app_db import get_schema_name, _get_raw_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["app-status-rules"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class StatusRuleCreateBody(BaseModel):
    entity: str
    field: str
    from_value: str
    to_value: str
    after_days: int = 7
    enabled: bool = True


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(rule: AppStatusRule) -> dict:
    return {
        "id": str(rule.id),
        "project_id": str(rule.project_id),
        "org_id": str(rule.org_id),
        "entity": rule.entity,
        "field": rule.field,
        "from_value": rule.from_value,
        "to_value": rule.to_value,
        "after_days": rule.after_days,
        "enabled": rule.enabled,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/status-rules")
async def list_status_rules(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all status auto-progression rules for a project."""
    result = await db.execute(
        select(AppStatusRule).where(
            AppStatusRule.project_id == uuid.UUID(project_id),
            AppStatusRule.org_id == org_id,
        ).order_by(AppStatusRule.created_at.desc())
    )
    rules = result.scalars().all()
    return {"items": [_serialize(r) for r in rules]}


@router.post("/projects/{project_id}/status-rules", status_code=status.HTTP_201_CREATED)
async def create_status_rule(
    project_id: str,
    body: StatusRuleCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new status auto-progression rule."""
    if body.after_days < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="after_days must be at least 1",
        )
    if body.from_value == body.to_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_value and to_value must be different",
        )

    rule = AppStatusRule(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        entity=body.entity,
        field=body.field,
        from_value=body.from_value,
        to_value=body.to_value,
        after_days=body.after_days,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete("/projects/{project_id}/status-rules/{rule_id}")
async def delete_status_rule(
    project_id: str,
    rule_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a status auto-progression rule."""
    result = await db.execute(
        select(AppStatusRule).where(
            AppStatusRule.id == uuid.UUID(rule_id),
            AppStatusRule.project_id == uuid.UUID(project_id),
            AppStatusRule.org_id == org_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status rule not found")

    await db.delete(rule)
    await db.commit()
    return {"detail": "Status rule deleted"}


@router.post("/projects/{project_id}/status-rules/execute")
async def execute_status_rules(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan records and apply status auto-progression rules.
    Updates records whose status has stayed at from_value for longer than after_days.
    """
    result = await db.execute(
        select(AppStatusRule).where(
            AppStatusRule.project_id == uuid.UUID(project_id),
            AppStatusRule.org_id == org_id,
            AppStatusRule.enabled.is_(True),
        )
    )
    rules = result.scalars().all()

    if not rules:
        return {"updated": 0, "detail": "No enabled status rules found"}

    schema = get_schema_name(project_id)
    now = datetime.now(timezone.utc)
    total_updated = 0
    results = []

    for rule in rules:
        table = rule.entity.lower()
        cutoff = now - timedelta(days=rule.after_days)

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                # Find records with the from_value that haven't been updated
                # within after_days
                updated = await conn.fetch(
                    f'UPDATE "{schema}"."{table}" '
                    f'SET "{rule.field}" = $1, "updated_at" = $2 '
                    f'WHERE "{rule.field}" = $3 '
                    f'AND "updated_at" <= $4 '
                    f'AND "deleted_at" IS NULL '
                    f'RETURNING "id"',
                    rule.to_value,
                    now,
                    rule.from_value,
                    cutoff,
                )
                count = len(updated)
                total_updated += count
                results.append({
                    "rule_id": str(rule.id),
                    "entity": rule.entity,
                    "field": rule.field,
                    "from_value": rule.from_value,
                    "to_value": rule.to_value,
                    "records_updated": count,
                    "updated_ids": [str(r["id"]) for r in updated],
                })
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Status rule execution failed for rule %s: %s", rule.id, e)
            results.append({
                "rule_id": str(rule.id),
                "entity": rule.entity,
                "error": str(e),
            })

    return {"updated": total_updated, "results": results}
