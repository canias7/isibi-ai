from __future__ import annotations

"""
Auto-Fix Errors API — pattern-matching on common errors.

POST /api/projects/{project_id}/auto-fix — analyze error and return fix suggestion
"""

import re
from typing import Optional

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project

router = APIRouter(tags=["AutoFix"])


# ── Schemas ────────────────────────────────────────────────────────

class AutoFixRequest(BaseModel):
    error_message: str
    context: Optional[str] = None


class AutoFixResponse(BaseModel):
    suggestion: str
    auto_fixable: bool
    fix_description: str


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


# Error pattern rules: (regex, suggestion_builder, auto_fixable, fix_description_builder)
_ERROR_PATTERNS: list[tuple[str, str, bool, str]] = []


def _match_error(error_message: str, context: Optional[str] = None) -> AutoFixResponse:
    """Match the error against known patterns and return a fix suggestion."""
    msg = error_message.lower()

    # Pattern 1: column does not exist
    match = re.search(r'column\s+"?(\w+)"?\s+(?:does not exist|not found)', msg)
    if match:
        col_name = match.group(1)
        return AutoFixResponse(
            suggestion=f'Add the field "{col_name}" to the relevant entity in your spec. '
                        f'This column is referenced but not defined.',
            auto_fixable=True,
            fix_description=f'Add a new field "{col_name}" to the entity definition in the project spec. '
                            f'Choose an appropriate type (string, integer, etc.) based on the field name.',
        )

    # Pattern 2: relation does not exist
    match = re.search(r'relation\s+"?(\w+)"?\s+does not exist', msg)
    if match:
        table_name = match.group(1)
        return AutoFixResponse(
            suggestion=f'Create a new entity "{table_name}" in your spec. '
                        f'This table is referenced but does not exist in the database.',
            auto_fixable=True,
            fix_description=f'Add a new entity called "{table_name}" to the project spec with '
                            f'appropriate fields. Consider what data this entity should store.',
        )

    # Pattern 3: null value in column
    match = re.search(r'null value in column\s+"?(\w+)"?', msg)
    if match:
        col_name = match.group(1)
        return AutoFixResponse(
            suggestion=f'Make the field "{col_name}" nullable or add a default value. '
                        f'Currently, a null value is being inserted into a non-nullable column.',
            auto_fixable=True,
            fix_description=f'Update the field "{col_name}" in the entity spec to either '
                            f'set nullable to true or provide a default value.',
        )

    # Pattern 4: duplicate key
    match = re.search(r'duplicate key.*(?:constraint\s+"?(\w+)"?|value)', msg)
    if match:
        constraint = match.group(1) if match.group(1) else "unknown"
        return AutoFixResponse(
            suggestion='Add unique constraint handling to prevent duplicate entries. '
                        'Either check for existing records before inserting, or use '
                        'an upsert (INSERT ON CONFLICT) strategy.',
            auto_fixable=True,
            fix_description=f'Add duplicate-key handling for constraint "{constraint}". '
                            f'Implement a check-before-insert pattern or use database-level '
                            f'upsert to gracefully handle duplicates.',
        )

    # Pattern 5: type mismatch / invalid input syntax
    match = re.search(r'invalid input syntax for (?:type\s+)?(\w+)', msg)
    if match:
        type_name = match.group(1)
        return AutoFixResponse(
            suggestion=f'There is a type mismatch. The value being inserted does not match '
                        f'the expected type "{type_name}". Check the field type in your spec.',
            auto_fixable=False,
            fix_description=f'Review the field types in your spec and ensure values match '
                            f'the expected "{type_name}" type. You may need to add type '
                            f'validation or conversion.',
        )

    # Pattern 6: foreign key violation
    if "foreign key" in msg and "violat" in msg:
        return AutoFixResponse(
            suggestion='A foreign key constraint is being violated. Ensure the referenced '
                        'record exists before creating the relationship.',
            auto_fixable=False,
            fix_description='Check that all foreign key references point to existing records. '
                            'You may need to create the parent record first or add cascading '
                            'delete/update rules.',
        )

    # Default: unknown error
    return AutoFixResponse(
        suggestion='This error could not be automatically diagnosed. Review the error message '
                    'and check your project spec for inconsistencies. Common causes include '
                    'missing fields, incorrect types, or database schema mismatches.',
        auto_fixable=False,
        fix_description='Manual investigation is required. Check the database schema matches '
                        'your spec, verify all required fields have values, and ensure '
                        'referenced entities exist.',
    )


# ── Endpoint ───────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/auto-fix",
    response_model=AutoFixResponse,
)
async def auto_fix_error(
    project_id: UUID,
    body: AutoFixRequest,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Analyze an error message and return a fix suggestion."""
    # Verify project access
    await _get_project_for_org(db, project_id, org_id)

    return _match_error(body.error_message, body.context)
