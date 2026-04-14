from __future__ import annotations

"""
Auto-Assign Rules — round-robin, random, or least-loaded auto-assignment
for records created in generated apps.
"""

import uuid
import random
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_auto_assign_rule import AppAutoAssignRule
from generator.app_db import get_schema_name, _get_raw_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["app-auto-assign"])

VALID_STRATEGIES = {"round_robin", "random", "least_loaded"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class AutoAssignRuleCreateBody(BaseModel):
    entity: str
    assign_field: str
    team_members: List[str]
    strategy: str = "round_robin"
    enabled: bool = True


class AutoAssignExecuteBody(BaseModel):
    entity: str
    record_id: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(rule: AppAutoAssignRule) -> dict:
    return {
        "id": str(rule.id),
        "project_id": str(rule.project_id),
        "org_id": str(rule.org_id),
        "entity": rule.entity,
        "assign_field": rule.assign_field,
        "team_members": rule.team_members,
        "strategy": rule.strategy,
        "counter": rule.counter,
        "enabled": rule.enabled,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/auto-assign/rules")
async def list_auto_assign_rules(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all auto-assign rules for a project."""
    result = await db.execute(
        select(AppAutoAssignRule).where(
            AppAutoAssignRule.project_id == uuid.UUID(project_id),
            AppAutoAssignRule.org_id == org_id,
        ).order_by(AppAutoAssignRule.created_at.desc())
    )
    rules = result.scalars().all()
    return {"items": [_serialize(r) for r in rules]}


@router.post("/projects/{project_id}/auto-assign/rules", status_code=status.HTTP_201_CREATED)
async def create_auto_assign_rule(
    project_id: str,
    body: AutoAssignRuleCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new auto-assign rule."""
    if body.strategy not in VALID_STRATEGIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid strategy '{body.strategy}'. Must be one of: {', '.join(sorted(VALID_STRATEGIES))}",
        )
    if not body.team_members:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="team_members must contain at least one member",
        )

    rule = AppAutoAssignRule(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        entity=body.entity,
        assign_field=body.assign_field,
        team_members=body.team_members,
        strategy=body.strategy,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete("/projects/{project_id}/auto-assign/rules/{rule_id}")
async def delete_auto_assign_rule(
    project_id: str,
    rule_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete an auto-assign rule."""
    result = await db.execute(
        select(AppAutoAssignRule).where(
            AppAutoAssignRule.id == uuid.UUID(rule_id),
            AppAutoAssignRule.project_id == uuid.UUID(project_id),
            AppAutoAssignRule.org_id == org_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Auto-assign rule not found")

    await db.delete(rule)
    await db.commit()
    return {"detail": "Auto-assign rule deleted"}


@router.post("/projects/{project_id}/auto-assign/execute")
async def execute_auto_assign(
    project_id: str,
    body: AutoAssignExecuteBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Execute auto-assign after a record is created.
    Checks all enabled rules for the entity and assigns based on strategy.
    """
    result = await db.execute(
        select(AppAutoAssignRule).where(
            AppAutoAssignRule.project_id == uuid.UUID(project_id),
            AppAutoAssignRule.org_id == org_id,
            AppAutoAssignRule.entity == body.entity,
            AppAutoAssignRule.enabled.is_(True),
        )
    )
    rules = result.scalars().all()

    if not rules:
        return {"assigned": False, "detail": "No matching auto-assign rules found"}

    assignments = []
    schema = get_schema_name(project_id)
    table = body.entity.lower()

    for rule in rules:
        members = rule.team_members
        if not members:
            continue

        # Determine assignee based on strategy
        if rule.strategy == "round_robin":
            assignee = members[rule.counter % len(members)]
            rule.counter = rule.counter + 1
        elif rule.strategy == "random":
            assignee = random.choice(members)
        elif rule.strategy == "least_loaded":
            # Count assignments per member in the table
            try:
                conn = await _get_raw_connection(DATABASE_URL)
                try:
                    counts = {}
                    for member in members:
                        row = await conn.fetchrow(
                            f'SELECT COUNT(*) as cnt FROM "{schema}"."{table}" '
                            f'WHERE "{rule.assign_field}" = $1 AND "deleted_at" IS NULL',
                            member,
                        )
                        counts[member] = row["cnt"] if row else 0
                    assignee = min(counts, key=counts.get)
                finally:
                    await conn.close()
            except Exception as e:
                logger.warning("least_loaded fallback to round_robin: %s", e)
                assignee = members[rule.counter % len(members)]
                rule.counter = rule.counter + 1
        else:
            assignee = members[0]

        # Update the record in the app's schema
        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                await conn.execute(
                    f'UPDATE "{schema}"."{table}" SET "{rule.assign_field}" = $1 WHERE "id" = $2',
                    assignee,
                    uuid.UUID(body.record_id),
                )
            finally:
                await conn.close()

            assignments.append({
                "rule_id": str(rule.id),
                "assign_field": rule.assign_field,
                "assigned_to": assignee,
                "strategy": rule.strategy,
            })
        except Exception as e:
            logger.error("Auto-assign failed for rule %s: %s", rule.id, e)
            assignments.append({
                "rule_id": str(rule.id),
                "assign_field": rule.assign_field,
                "error": str(e),
            })

    await db.commit()
    return {"assigned": True, "assignments": assignments}
