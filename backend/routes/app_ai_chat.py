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


# ── AI Command — natural language CRUD + conversation ────────────────

class AiCommandRequest(BaseModel):
    text: str

class AiCommandResponse(BaseModel):
    message: str
    action: Optional[str] = None  # "created", "deleted", "listed", "chat"
    data: Optional[list[dict[str, Any]]] = None


@router.post("/{project_id}/ai/command")
async def ai_command(
    project_id: _uuid.UUID,
    body: AiCommandRequest,
    db: AsyncSession = Depends(get_db),
) -> AiCommandResponse:
    """
    Process a natural language voice command — conversational AI with CRUD capabilities.

    Accepts plain text (from voice or typing) and uses Claude to:
    - Understand intent (create, list, delete, or just chat)
    - Execute CRUD operations if needed
    - Respond conversationally
    """
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured.")

    # Fetch project spec
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
    app_name = spec.get("app_name", project.name or "App")

    # Build entity schema summary for Claude with required field info
    entity_summaries = []
    entity_map = {}  # name -> table_name
    skip_fields = {"id", "org_id", "created_at", "updated_at", "deleted_at", "version"}
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        name = entity.get("name", "")
        table = entity.get("table", name.lower().replace(" ", "_"))
        entity_map[name.lower()] = table
        fields = entity.get("fields", [])
        field_details = []
        for f in fields:
            if not isinstance(f, dict):
                continue
            fname = f.get("name", "")
            if fname in skip_fields:
                continue
            nullable = f.get("nullable", True)
            has_validation = f.get("validation", {}).get("rule") == "required"
            required = not nullable or has_validation
            enum_values = f.get("enum_values", [])
            detail = fname
            if required:
                detail += " (REQUIRED)"
            if enum_values:
                detail += f" [options: {', '.join(str(v) for v in enum_values[:8])}]"
            field_details.append(detail)
        entity_summaries.append(f"- {name} (table: {table}):\n  Fields: {', '.join(field_details)}")

    schema_text = "\n".join(entity_summaries) if entity_summaries else "No entities defined."

    # System prompt for Claude
    system_prompt = f"""You are a helpful voice assistant for "{app_name}". You help users manage their data through natural conversation.

Available entities and their fields:
{schema_text}

IMPORTANT: You must respond with a JSON object in this exact format:
{{
  "intent": "create" | "list" | "delete" | "count" | "chat",
  "entity": "EntityName" (only for create/list/delete/count),
  "data": {{ "field": "value", ... }} (only for create, include ALL required fields),
  "filter": "search term" (optional, for list/delete),
  "message": "Your conversational response to the user"
}}

Rules:
- For casual conversation (hello, hi, how are you, thanks, etc.), use intent "chat" and respond friendly and brief
- IMPORTANT: When the user wants to create a record but has NOT provided all REQUIRED fields, DO NOT use intent "create". Instead use intent "chat" and ASK them for the missing required information. For example if they say "create a lead", ask "Sure! What's the lead's name?" or list what info you need.
- Only use intent "create" when you have enough data to fill at least the required fields
- For creating records, extract ALL field values mentioned and map them to the correct field names
- For fields with options/enums, pick the best matching option from the list
- For listing/showing records, use intent "list"
- For counting, use intent "count"
- For deleting, use intent "delete" and include a filter to identify the record
- Always be conversational, friendly, and brief in your message (this is voice, keep it short)
- If you're not sure what entity they mean, ask them in your message with intent "chat"
- Only use entity names from the available list above"""

    # Call Claude
    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=AI_MODEL,
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": text}],
        )
        raw = message.content[0].text
    except Exception as e:
        logger.error("Claude API error in ai_command: %s", e)
        raise HTTPException(status_code=502, detail="AI service unavailable.")

    # Parse Claude's response
    try:
        # Extract JSON from response (Claude sometimes wraps in markdown)
        json_match = re.search(r"\{[\s\S]*\}", raw)
        if not json_match:
            return AiCommandResponse(message=raw, action="chat")
        parsed = json.loads(json_match.group())
    except (json.JSONDecodeError, AttributeError):
        return AiCommandResponse(message=raw, action="chat")

    intent = parsed.get("intent", "chat")
    entity_name = parsed.get("entity", "")
    ai_message = parsed.get("message", raw)
    pid_str = str(project_id)

    # Find the actual table name
    table_name = None
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        if ent.get("name", "").lower() == entity_name.lower():
            table_name = ent.get("table", entity_name.lower().replace(" ", "_"))
            break
    if not table_name and entity_name:
        table_name = entity_name.lower().replace(" ", "_")

    # Execute the action
    if intent == "create" and table_name:
        try:
            data = parsed.get("data", {})
            if not data:
                return AiCommandResponse(message=ai_message, action="chat")

            schema = get_schema_name(pid_str)
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                # Get columns to validate field names
                columns = await get_table_columns(pid_str, table_name, DATABASE_URL)
                col_names = {c["column_name"] for c in columns}

                # Filter data to only include valid columns
                valid_data = {k: v for k, v in data.items() if k in col_names}
                if not valid_data:
                    return AiCommandResponse(message=f"I couldn't map the fields correctly. Available fields: {', '.join(col_names - {'id', 'org_id', 'created_at', 'updated_at', 'deleted_at', 'version'})}", action="chat")

                cols = ", ".join(f'"{k}"' for k in valid_data.keys())
                placeholders = ", ".join(f"${i+1}" for i in range(len(valid_data)))
                values = list(valid_data.values())

                await conn.execute(
                    f'INSERT INTO "{schema}"."{table_name}" ({cols}) VALUES ({placeholders})',
                    *values,
                )
                return AiCommandResponse(message=ai_message, action="created")
            finally:
                await conn.close()
        except Exception as e:
            logger.error("AI create error: %s", e)
            return AiCommandResponse(message=f"I tried to create the record but got an error: {str(e)}", action="chat")

    elif intent == "list" and table_name:
        try:
            rows = await _fetch_table_data(pid_str, table_name, limit=20)
            serialized = [_serialize_row(r) for r in rows]
            return AiCommandResponse(message=ai_message, action="listed", data=serialized)
        except Exception as e:
            logger.error("AI list error: %s", e)
            return AiCommandResponse(message=f"I couldn't fetch the data: {str(e)}", action="chat")

    elif intent == "count" and table_name:
        try:
            rows = await _fetch_table_data(pid_str, table_name, limit=10000)
            count = len(rows)
            return AiCommandResponse(message=ai_message or f"You have {count} {entity_name}(s).", action="listed")
        except Exception as e:
            return AiCommandResponse(message=f"I couldn't count: {str(e)}", action="chat")

    elif intent == "delete" and table_name:
        try:
            filter_text = parsed.get("filter", "")
            if not filter_text:
                return AiCommandResponse(message="I need to know which record to delete. Can you be more specific?", action="chat")

            schema = get_schema_name(pid_str)
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                # Soft delete by name/title match
                name_col = None
                columns = await get_table_columns(pid_str, table_name, DATABASE_URL)
                for c in columns:
                    if c["column_name"] in ("name", "title", "first_name", "customer_name"):
                        name_col = c["column_name"]
                        break

                if not name_col:
                    return AiCommandResponse(message="I couldn't find a name field to match against.", action="chat")

                result = await conn.execute(
                    f'UPDATE "{schema}"."{table_name}" SET "deleted_at" = NOW() '
                    f'WHERE LOWER("{name_col}") LIKE $1 AND "deleted_at" IS NULL',
                    f"%{filter_text.lower()}%",
                )
                deleted = result.split()[-1] if isinstance(result, str) else "0"
                return AiCommandResponse(message=ai_message, action="deleted")
            finally:
                await conn.close()
        except Exception as e:
            logger.error("AI delete error: %s", e)
            return AiCommandResponse(message=f"I couldn't delete: {str(e)}", action="chat")

    # Default: conversational response
    return AiCommandResponse(message=ai_message, action="chat")
