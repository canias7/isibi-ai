from __future__ import annotations
"""
App AI Chat — natural language queries for generated app data.

End-users of generated apps can ask questions about their data in plain
English and get conversational answers powered by Claude.

Routes:
  POST /api/apps/{project_id}/ai/query — ask a question about app data
"""

import json
import logging
import os
import re
import uuid as _uuid
from typing import Any, Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from generator.app_db import (
    get_schema_name,
    list_schema_tables,
    get_table_columns,
    _get_raw_connection,
)
from models.project import Project
from routes.app_auth import get_current_app_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App AI Chat"])

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")

MAX_ROWS = 200  # cap rows sent to the model to control token usage


# ── Request / Response schemas ───────────────────────────────────────

class AiQueryRequest(BaseModel):
    question: str

class AiQueryResponse(BaseModel):
    answer: str
    data: list[dict[str, Any]]


# ── Helpers ──────────────────────────────────────────────────────────

def _pick_table(question: str, tables: list[str]) -> str | None:
    """
    Simple heuristic: find the table whose name best matches the question.

    Checks for exact table name mentions first, then falls back to singular
    forms and partial matches.
    """
    q = question.lower()

    # Exact table name mentioned
    for t in tables:
        if t in q:
            return t

    # Singular form match (e.g. "lead" matches "leads")
    for t in tables:
        singular = t.rstrip("s")
        if singular and singular in q:
            return t

    # If only one table, use it
    if len(tables) == 1:
        return tables[0]

    return None


def _build_schema_description(
    entity: dict,
) -> str:
    """Build a human-readable schema description from a spec entity."""
    fields = entity.get("fields", [])
    lines = [f"Table: {entity.get('name', 'unknown')}"]
    for f in fields:
        if not isinstance(f, dict):
            continue
        name = f.get("name", "?")
        db_type = f.get("db_type", "TEXT")
        label = f.get("label", name)
        lines.append(f"  - {name} ({db_type}) — {label}")
    return "\n".join(lines)


async def _fetch_table_data(
    project_id: str,
    table_name: str,
    limit: int = MAX_ROWS,
) -> list[dict[str, Any]]:
    """Fetch rows from the app's schema table."""
    schema = get_schema_name(project_id)
    conn = await _get_raw_connection(DATABASE_URL)
    try:
        rows = await conn.fetch(
            f'SELECT * FROM "{schema}"."{table_name}" '
            f'WHERE "deleted_at" IS NULL '
            f"LIMIT {limit}"
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


def _serialize_row(row: dict) -> dict:
    """Make a row JSON-serializable (dates, UUIDs, etc.)."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, _uuid.UUID):
            out[k] = str(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, (bytes, bytearray)):
            out[k] = v.hex()
        else:
            out[k] = v
    return out


# ── Route ────────────────────────────────────────────────────────────

@router.post("/{project_id}/ai/query")
async def ai_query(
    project_id: _uuid.UUID,
    body: AiQueryRequest,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
) -> AiQueryResponse:
    """
    Ask a natural language question about the app's data.

    Requires an app-user JWT (type=app_user).
    """
    # Verify token matches this project
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured.")

    # Fetch the project spec to understand entity schemas
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    spec = project.spec or {}
    entities = spec.get("entities", [])

    # List actual tables in the schema
    pid_str = str(project_id)
    tables = await list_schema_tables(pid_str, DATABASE_URL)
    if not tables:
        raise HTTPException(
            status_code=404,
            detail="No data tables found for this app.",
        )

    # Pick the most relevant table
    target_table = _pick_table(body.question, tables)
    if not target_table:
        raise HTTPException(
            status_code=400,
            detail=f"Could not determine which table to query. "
                   f"Available tables: {', '.join(tables)}. "
                   f"Try mentioning a table name in your question.",
        )

    # Get schema description from spec entities
    schema_desc = ""
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_name = entity.get("name", "").lower().replace(" ", "_")
        if entity_name == target_table:
            schema_desc = _build_schema_description(entity)
            break

    # If we didn't find it in spec entities, build from DB columns
    if not schema_desc:
        columns = await get_table_columns(pid_str, target_table, DATABASE_URL)
        lines = [f"Table: {target_table}"]
        for col in columns:
            lines.append(f"  - {col['column_name']} ({col['data_type']})")
        schema_desc = "\n".join(lines)

    # Fetch actual data
    rows = await _fetch_table_data(pid_str, target_table)
    serialized_rows = [_serialize_row(r) for r in rows]

    # Build Claude prompt
    data_json = json.dumps(serialized_rows[:MAX_ROWS], indent=2, default=str)

    system_prompt = (
        "You are a helpful data assistant for a business application. "
        "Answer the user's question based on the data provided. "
        "Be conversational, include specific numbers, names, and dates. "
        "If the data doesn't contain enough information to answer, say so clearly. "
        "Keep your answer concise but informative."
    )

    user_prompt = (
        f"Here is the schema of the data:\n\n{schema_desc}\n\n"
        f"Here is the current data ({len(serialized_rows)} rows):\n\n{data_json}\n\n"
        f"User question: {body.question}"
    )

    # Call Claude
    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=AI_MODEL,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        answer = message.content[0].text
    except Exception as e:
        logger.error("Claude API error: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to get AI response. Please try again.",
        )

    return AiQueryResponse(answer=answer, data=serialized_rows)
