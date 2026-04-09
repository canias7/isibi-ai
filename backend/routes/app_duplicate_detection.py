from __future__ import annotations

"""
Duplicate Detection — define rules to detect duplicate records
in generated apps based on matching fields.
"""

import uuid
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_duplicate_rule import AppDuplicateRule
from generator.app_db import get_schema_name, _get_raw_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["app-duplicate-detection"])

VALID_ACTIONS = {"warn", "block", "merge"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class DuplicateRuleCreateBody(BaseModel):
    entity: str
    match_fields: List[str]
    action: str = "warn"
    enabled: bool = True


class DuplicateCheckBody(BaseModel):
    entity: str
    data: Dict[str, Any]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(rule: AppDuplicateRule) -> dict:
    return {
        "id": str(rule.id),
        "project_id": str(rule.project_id),
        "org_id": str(rule.org_id),
        "entity": rule.entity,
        "match_fields": rule.match_fields,
        "action": rule.action,
        "enabled": rule.enabled,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/duplicate-rules")
async def list_duplicate_rules(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all duplicate detection rules for a project."""
    result = await db.execute(
        select(AppDuplicateRule).where(
            AppDuplicateRule.project_id == uuid.UUID(project_id),
            AppDuplicateRule.org_id == org_id,
        ).order_by(AppDuplicateRule.created_at.desc())
    )
    rules = result.scalars().all()
    return {"items": [_serialize(r) for r in rules]}


@router.post("/projects/{project_id}/duplicate-rules", status_code=status.HTTP_201_CREATED)
async def create_duplicate_rule(
    project_id: str,
    body: DuplicateRuleCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new duplicate detection rule."""
    if body.action not in VALID_ACTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action '{body.action}'. Must be one of: {', '.join(sorted(VALID_ACTIONS))}",
        )
    if not body.match_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="match_fields must contain at least one field",
        )

    rule = AppDuplicateRule(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        entity=body.entity,
        match_fields=body.match_fields,
        action=body.action,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete("/projects/{project_id}/duplicate-rules/{rule_id}")
async def delete_duplicate_rule(
    project_id: str,
    rule_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a duplicate detection rule."""
    result = await db.execute(
        select(AppDuplicateRule).where(
            AppDuplicateRule.id == uuid.UUID(rule_id),
            AppDuplicateRule.project_id == uuid.UUID(project_id),
            AppDuplicateRule.org_id == org_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Duplicate rule not found")

    await db.delete(rule)
    await db.commit()
    return {"detail": "Duplicate rule deleted"}


@router.post("/projects/{project_id}/duplicate-check")
async def check_duplicates(
    project_id: str,
    body: DuplicateCheckBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Check for duplicate records before creating a new one.
    Returns matching records based on enabled duplicate rules for the entity.
    """
    # Find all enabled rules for this entity
    result = await db.execute(
        select(AppDuplicateRule).where(
            AppDuplicateRule.project_id == uuid.UUID(project_id),
            AppDuplicateRule.org_id == org_id,
            AppDuplicateRule.entity == body.entity,
            AppDuplicateRule.enabled.is_(True),
        )
    )
    rules = result.scalars().all()

    if not rules:
        return {"duplicates_found": False, "matches": [], "action": None}

    import re
    schema = get_schema_name(project_id)
    table = body.entity.lower()
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$", table):
        raise HTTPException(status_code=400, detail="Invalid entity name")
    all_matches = []
    strongest_action = "warn"  # escalate to block if any rule says block

    for rule in rules:
        # Build WHERE conditions for matching fields
        conditions = []
        params = []
        param_idx = 1

        for field in rule.match_fields:
            value = body.data.get(field)
            if value is None:
                continue
            conditions.append(f'LOWER(CAST("{field}" AS TEXT)) = LOWER(${param_idx})')
            params.append(str(value))
            param_idx += 1

        if not conditions:
            continue

        where_clause = " AND ".join(conditions)

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                rows = await conn.fetch(
                    f'SELECT * FROM "{schema}"."{table}" '
                    f'WHERE {where_clause} AND "deleted_at" IS NULL '
                    f'LIMIT 10',
                    *params,
                )

                for row in rows:
                    record = dict(row)
                    # Serialize values for JSON
                    serialized = {}
                    for key, val in record.items():
                        if isinstance(val, uuid.UUID):
                            serialized[key] = str(val)
                        elif hasattr(val, "isoformat"):
                            serialized[key] = val.isoformat()
                        else:
                            serialized[key] = val

                    all_matches.append(serialized)
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Duplicate check failed for rule %s: %s", rule.id, e)

        # Escalate action
        if rule.action == "block":
            strongest_action = "block"
        elif rule.action == "merge" and strongest_action != "block":
            strongest_action = "merge"

    # Deduplicate matches by id
    seen_ids = set()
    unique_matches = []
    for match in all_matches:
        match_id = match.get("id")
        if match_id and match_id not in seen_ids:
            seen_ids.add(match_id)
            unique_matches.append(match)

    return {
        "duplicates_found": len(unique_matches) > 0,
        "matches": unique_matches,
        "action": strongest_action if unique_matches else None,
        "total": len(unique_matches),
    }
