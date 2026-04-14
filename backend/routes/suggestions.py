from __future__ import annotations

"""
Smart Suggestions API — rules-based analysis of project spec.

POST /api/projects/{project_id}/suggestions — analyze spec and return improvement suggestions
"""

import uuid as _uuid
from typing import Optional

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project

router = APIRouter(tags=["Suggestions"])


# ── Schemas ────────────────────────────────────────────────────────

class Suggestion(BaseModel):
    id: str
    title: str
    description: str
    priority: str  # "high" | "medium" | "low"


class SuggestionsResponse(BaseModel):
    suggestions: list[Suggestion]


# ── Helpers ────────────────────────────────────────────────────────

async def _get_project_for_org(
    db: AsyncSession, project_id: UUID, org_id: UUID
) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _analyze_spec(spec: dict) -> list[Suggestion]:
    """Apply rules engine to the spec and return suggestions."""
    suggestions: list[Suggestion] = []
    if not spec:
        return suggestions

    entities = spec.get("entities", spec.get("modules", []))
    if isinstance(entities, dict):
        entities = list(entities.values())

    # Rule 1: No entity has a "status" enum field
    has_status_field = False
    for entity in entities:
        fields = entity.get("fields", entity.get("columns", []))
        if isinstance(fields, dict):
            fields = list(fields.values())
        for field in fields:
            field_name = field.get("name", "") if isinstance(field, dict) else str(field)
            field_type = field.get("type", "") if isinstance(field, dict) else ""
            if field_name.lower() == "status" and field_type.lower() in ("enum", "select", "status"):
                has_status_field = True
                break
        if has_status_field:
            break
    if not has_status_field:
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Add status tracking",
            description="None of your entities have a status field. Adding status tracking helps manage workflow and lifecycle of records.",
            priority="high",
        ))

    # Rule 2: Less than 2 entities
    if len(entities) < 2:
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Consider adding more entities for a complete system",
            description="Your project has fewer than 2 entities. A robust application typically needs multiple related entities to model the domain properly.",
            priority="high",
        ))

    # Rule 3: No dashboard module
    module_names = []
    modules = spec.get("modules", spec.get("pages", spec.get("views", [])))
    if isinstance(modules, list):
        for m in modules:
            name = m.get("name", "") if isinstance(m, dict) else str(m)
            module_names.append(name.lower())
    elif isinstance(modules, dict):
        module_names = [k.lower() for k in modules.keys()]
    entity_names = [
        (e.get("name", "") if isinstance(e, dict) else str(e)).lower()
        for e in entities
    ]
    all_names = module_names + entity_names
    if not any("dashboard" in n for n in all_names):
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Add a dashboard for quick overview",
            description="Your project lacks a dashboard module. A dashboard provides at-a-glance metrics and quick access to important data.",
            priority="medium",
        ))

    # Rule 4: No search field in any entity
    has_search = False
    for entity in entities:
        fields = entity.get("fields", entity.get("columns", []))
        if isinstance(fields, dict):
            fields = list(fields.values())
        for field in fields:
            field_name = field.get("name", "") if isinstance(field, dict) else str(field)
            if "search" in field_name.lower() or "filter" in field_name.lower():
                has_search = True
                break
        if has_search:
            break
    if not has_search:
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Add a search/filter feature",
            description="No search or filter fields found in your entities. Adding search capabilities improves usability for data-heavy applications.",
            priority="medium",
        ))

    # Rule 5: No notifications entity
    if not any("notification" in n for n in entity_names):
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Add a notifications system",
            description="Your project has no notifications entity. A notification system keeps users informed about important events and updates.",
            priority="low",
        ))

    # Rule 6: No relationships (no FK fields)
    has_fk = False
    for entity in entities:
        fields = entity.get("fields", entity.get("columns", []))
        if isinstance(fields, dict):
            fields = list(fields.values())
        for field in fields:
            if isinstance(field, dict):
                field_type = field.get("type", "").lower()
                field_name = field.get("name", "").lower()
                ref = field.get("reference", field.get("references", field.get("fk", "")))
                if ref or "foreign" in field_type or field_name.endswith("_id"):
                    has_fk = True
                    break
        if has_fk:
            break
    if not has_fk and len(entities) >= 2:
        suggestions.append(Suggestion(
            id=str(_uuid.uuid4()),
            title="Connect your entities with relationships",
            description="Your entities don't appear to have foreign key relationships. Connecting entities enables powerful data queries and ensures data integrity.",
            priority="high",
        ))

    return suggestions


# ── Endpoint ───────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/suggestions",
    response_model=SuggestionsResponse,
)
async def get_suggestions(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Analyze the project spec and return improvement suggestions."""
    project = await _get_project_for_org(db, project_id, org_id)

    if not project.spec:
        raise HTTPException(status_code=400, detail="Project has no spec to analyze")

    suggestions = _analyze_spec(project.spec)
    return SuggestionsResponse(suggestions=suggestions)
