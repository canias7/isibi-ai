from __future__ import annotations
"""
App Data API — CRUD endpoints for generated app data.

Each generated app stores its data in an isolated PostgreSQL schema.
These endpoints let the frontend read/write rows in those tables.

Routes:
  GET    /api/apps/{project_id}/data/{table_name}           — list rows (paginated)
  GET    /api/apps/{project_id}/data/{table_name}/{row_id}  — get single row
  POST   /api/apps/{project_id}/data/{table_name}           — create row
  PATCH  /api/apps/{project_id}/data/{table_name}/{row_id}  — update row
  DELETE /api/apps/{project_id}/data/{table_name}/{row_id}  — soft delete
"""

import re
import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables
from generator.orchestrator import _get_project
from worker.email_worker import fire_email_triggers
from worker.webhook_worker import fire_webhooks
from worker.slack_worker import send_slack_notification
from utils.sanitize import sanitize_dict, sanitize_sql_identifier

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Data"])


# ── Helpers ──────────────────────────────────────────────────────────

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _validate_identifier(name: str, label: str = "identifier") -> str:
    """Validate and return a safe SQL identifier."""
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    # Double-check via sanitize utility (defense in depth)
    try:
        sanitize_sql_identifier(clean)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    return clean


async def _ensure_project_access(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> None:
    """Verify the project exists and belongs to the requesting org."""
    await _get_project(db, project_id, org_id)


async def _ensure_table_exists(
    project_id: str,
    table_name: str,
) -> None:
    """Verify the table exists in the project's schema."""
    tables = await list_schema_tables(project_id, DATABASE_URL)
    if table_name not in tables:
        raise HTTPException(
            status_code=404,
            detail=f"Table '{table_name}' not found in project schema. "
                   f"Available tables: {', '.join(tables) or '(none)'}",
        )


def _row_to_dict(record) -> dict[str, Any]:
    """Convert an asyncpg Record to a JSON-safe dict."""
    d = dict(record)
    # Convert non-serializable types to strings
    for k, v in d.items():
        if isinstance(v, UUID):
            d[k] = str(v)
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


async def _fire_slack_notifications(
    project_id: str,
    action: str,
    table_name: str,
    row_data: dict[str, Any],
    db: AsyncSession,
) -> None:
    """Send Slack notifications if the project has an enabled Slack integration."""
    from sqlalchemy import select
    from models.app_integration import AppIntegration

    try:
        result = await db.execute(
            select(AppIntegration).where(
                AppIntegration.project_id == UUID(project_id),
                AppIntegration.type == "slack",
                AppIntegration.enabled.is_(True),
            )
        )
        integrations = result.scalars().all()

        for integ in integrations:
            config = integ.config or {}
            webhook_url = config.get("webhook_url")
            channel = config.get("channel", "#general")
            if not webhook_url:
                continue

            # Build a human-readable message
            name = row_data.get("name") or row_data.get("title") or row_data.get("id", "")
            if action == "record_created":
                message = f"New {table_name} created: {name}"
            elif action == "record_updated":
                message = f"{table_name} updated: {name}"
            elif action == "record_deleted":
                message = f"{table_name} deleted"
            else:
                message = f"{table_name} {action}: {name}"

            await send_slack_notification(webhook_url, channel, message)
    except Exception as e:
        logger.warning("Slack notification error for project %s: %s", project_id, e)


# ── LIST rows ────────────────────────────────────────────────────────

@router.get("/{project_id}/data/{table_name}")
async def list_rows(
    project_id: UUID,
    table_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("id", description="Column to sort by"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """List rows in a generated app's table with pagination."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    sort_col = _validate_identifier(sort_by, "sort column")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Count total rows (excluding soft-deleted)
        count_row = await conn.fetchrow(
            f'SELECT COUNT(*) as total FROM "{table}" WHERE "deleted_at" IS NULL'
        )
        total = count_row["total"] if count_row else 0

        # Fetch page
        offset = (page - 1) * page_size
        rows = await conn.fetch(
            f'SELECT * FROM "{table}" '
            f'WHERE "deleted_at" IS NULL '
            f'ORDER BY "{sort_col}" {sort_dir.upper()} '
            f"LIMIT $1 OFFSET $2",
            page_size,
            offset,
        )

        return {
            "data": [_row_to_dict(r) for r in rows],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        }
    finally:
        await conn.close()


# ── GET single row ───────────────────────────────────────────────────

@router.get("/{project_id}/data/{table_name}/{row_id}")
async def get_row(
    project_id: UUID,
    table_name: str,
    row_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get a single row by its id."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        row = await conn.fetchrow(
            f'SELECT * FROM "{table}" WHERE "id" = $1 AND "deleted_at" IS NULL',
            row_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")

        return _row_to_dict(row)
    finally:
        await conn.close()


# ── CREATE row ───────────────────────────────────────────────────────

@router.post("/{project_id}/data/{table_name}", status_code=201)
async def create_row(
    project_id: UUID,
    table_name: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Insert a new row into a generated app's table."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    if not body:
        raise HTTPException(status_code=400, detail="Request body cannot be empty")

    # Sanitize all string values in body to prevent XSS
    body = sanitize_dict(body)

    # Filter out keys that aren't valid identifiers
    safe_data = {}
    for k, v in body.items():
        try:
            safe_key = _validate_identifier(k, "column name")
            safe_data[safe_key] = v
        except HTTPException:
            continue

    if not safe_data:
        raise HTTPException(status_code=400, detail="No valid columns provided")

    columns = list(safe_data.keys())
    col_names = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    values = list(safe_data.values())

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        row = await conn.fetchrow(
            f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders}) RETURNING *',
            *values,
        )
        row_data = _row_to_dict(row)

        # Fire email triggers for record creation
        await fire_email_triggers(str(project_id), "record_created", table, row_data, db)

        # Fire webhooks (non-blocking — don't fail the request)
        try:
            await fire_webhooks(str(project_id), "record_created", table, row_data, db)
        except Exception as e:
            logger.warning("Webhook fire error on create: %s", e)

        # Fire Slack notifications (non-blocking)
        try:
            await _fire_slack_notifications(str(project_id), "record_created", table, row_data, db)
        except Exception as e:
            logger.warning("Slack fire error on create: %s", e)

        return row_data
    except Exception as e:
        logger.error("Insert failed for %s.%s: %s", schema, table, e)
        raise HTTPException(status_code=400, detail=f"Insert failed: {str(e)}")
    finally:
        await conn.close()


# ── UPDATE row ───────────────────────────────────────────────────────

@router.patch("/{project_id}/data/{table_name}/{row_id}")
async def update_row(
    project_id: UUID,
    table_name: str,
    row_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Update an existing row (partial update)."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    if not body:
        raise HTTPException(status_code=400, detail="Request body cannot be empty")

    # Sanitize all string values in body to prevent XSS
    body = sanitize_dict(body)

    # Build SET clause
    safe_data = {}
    for k, v in body.items():
        try:
            safe_key = _validate_identifier(k, "column name")
            # Don't allow updating id or deleted_at via PATCH
            if safe_key not in ("id", "deleted_at"):
                safe_data[safe_key] = v
        except HTTPException:
            continue

    if not safe_data:
        raise HTTPException(status_code=400, detail="No valid columns to update")

    set_parts = []
    values = []
    for i, (col, val) in enumerate(safe_data.items()):
        set_parts.append(f'"{col}" = ${i + 1}')
        values.append(val)

    set_clause = ", ".join(set_parts)
    id_param = f"${len(values) + 1}"
    values.append(row_id)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        row = await conn.fetchrow(
            f'UPDATE "{table}" SET {set_clause} '
            f'WHERE "id" = {id_param} AND "deleted_at" IS NULL '
            f"RETURNING *",
            *values,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")

        row_data = _row_to_dict(row)

        # Fire email triggers for record update
        await fire_email_triggers(str(project_id), "record_updated", table, row_data, db)

        # Fire webhooks (non-blocking — don't fail the request)
        try:
            await fire_webhooks(str(project_id), "record_updated", table, row_data, db)
        except Exception as e:
            logger.warning("Webhook fire error on update: %s", e)

        # Fire Slack notifications (non-blocking)
        try:
            await _fire_slack_notifications(str(project_id), "record_updated", table, row_data, db)
        except Exception as e:
            logger.warning("Slack fire error on update: %s", e)

        return row_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Update failed for %s.%s: %s", schema, table, e)
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")
    finally:
        await conn.close()


# ── SOFT DELETE row ──────────────────────────────────────────────────

@router.delete("/{project_id}/data/{table_name}/{row_id}", status_code=204)
async def delete_row(
    project_id: UUID,
    table_name: str,
    row_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Soft-delete a row by setting deleted_at."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        result = await conn.execute(
            f'UPDATE "{table}" SET "deleted_at" = NOW() '
            f'WHERE "id" = $1 AND "deleted_at" IS NULL',
            row_id,
        )

        # asyncpg returns "UPDATE N" — check if any rows were affected
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Row not found")

        # Fire email triggers for record deletion
        await fire_email_triggers(str(project_id), "record_deleted", table, {"id": row_id}, db)

        # Fire webhooks (non-blocking — don't fail the request)
        try:
            await fire_webhooks(str(project_id), "record_deleted", table, {"id": row_id}, db)
        except Exception as e:
            logger.warning("Webhook fire error on delete: %s", e)

        # Fire Slack notifications (non-blocking)
        try:
            await _fire_slack_notifications(str(project_id), "record_deleted", table, {"id": row_id}, db)
        except Exception as e:
            logger.warning("Slack fire error on delete: %s", e)

    finally:
        await conn.close()


# ── Schema introspection ─────────────────────────────────────────────

@router.get("/{project_id}/schema")
async def get_app_schema(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get the list of tables and their columns for a project's app database."""
    await _ensure_project_access(db, project_id, org_id)

    schema = get_schema_name(str(project_id))
    conn = await _get_raw_connection(DATABASE_URL)
    try:
        # Get all tables
        tables = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = $1 ORDER BY table_name",
            schema,
        )

        result = {}
        for t in tables:
            tname = t["table_name"]
            cols = await conn.fetch(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = $1 AND table_name = $2 "
                "ORDER BY ordinal_position",
                schema,
                tname,
            )
            result[tname] = [dict(c) for c in cols]

        return {"schema": schema, "tables": result}
    finally:
        await conn.close()
