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

import os
import re
import random
import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables
from generator.orchestrator import _get_project
from worker.email_worker import fire_email_triggers
from worker.webhook_worker import fire_webhooks
from worker.slack_worker import send_slack_notification
from utils.sanitize import sanitize_dict, sanitize_sql_identifier
from models.app_auto_assign_rule import AppAutoAssignRule
from models.app_duplicate_rule import AppDuplicateRule
from models.app_activity_entry import AppActivityEntry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Data"])

_bearer = HTTPBearer(auto_error=False)
_JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
_JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")


# ── Flexible Auth ────────────────────────────────────────────────────
# Accepts EITHER a platform JWT (org_id) OR an app-user JWT (project_id)

import os

async def _get_app_auth(
    project_id: UUID,
    request: Request,
    db: AsyncSession,
) -> None:
    """Verify caller has access to this project's data.

    Accepts:
    - Platform JWT (type=platform or no type): verifies org owns project
    - App-user JWT (type=app_user): verifies project_id matches
    - No token: returns 401
    """
    # Allow preview mode (read-only, no auth required)
    preview = request.query_params.get("preview") or request.headers.get("x-preview")
    if preview:
        return  # Skip auth for preview mode

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    token_type = payload.get("type", "platform")

    if token_type == "app_user":
        # App-user JWT: verify project_id matches
        token_project = payload.get("project_id")
        if not token_project or str(project_id) != token_project:
            raise HTTPException(status_code=403, detail="Token not valid for this project")
        return  # Access granted
    else:
        # Platform JWT: verify org owns project
        org_id_str = payload.get("org_id")
        if not org_id_str:
            raise HTTPException(status_code=401, detail="Invalid token claims")
        try:
            org_id = UUID(org_id_str)
        except (ValueError, TypeError):
            raise HTTPException(status_code=401, detail="Invalid org_id in token")
        await _get_project(db, project_id, org_id)
        return  # Access granted


# ── Helpers ──────────────────────────────────────────────────────────

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _validate_identifier(name: str, label: str = "identifier") -> str:
    """Validate and return a safe SQL identifier."""
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
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


async def _ensure_schema_or_create(project_id: str, db: AsyncSession) -> None:
    """Ensure the project's DB schema exists. Create from spec if missing."""
    tables = await list_schema_tables(project_id, DATABASE_URL)
    if tables:
        return  # Schema already exists

    # Schema doesn't exist — try to create it from the project's spec
    from models.project import Project as ProjectModel

    result = await db.execute(
        select(ProjectModel.spec).where(ProjectModel.id == UUID(project_id))
    )
    spec = result.scalar_one_or_none()
    if spec and isinstance(spec, dict) and spec.get("entities"):
        from generator.app_db import create_app_schema
        await create_app_schema(project_id, spec, DATABASE_URL)


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


# ── Duplicate Detection ──────────────────────────────────────────────

async def _check_duplicates(
    project_id: str,
    table_name: str,
    body: dict[str, Any],
    db: AsyncSession,
) -> dict | None:
    """Check duplicate rules before inserting a record.

    Returns:
        None if no duplicates found or no rules exist.
        {"action": "warn", "warnings": [...]} if duplicates found with warn action.
        Raises HTTPException 409 if action is "block".
    """
    try:
        result = await db.execute(
            select(AppDuplicateRule).where(
                AppDuplicateRule.project_id == UUID(project_id),
                AppDuplicateRule.entity == table_name,
                AppDuplicateRule.enabled.is_(True),
            )
        )
        rules = result.scalars().all()
    except Exception as e:
        logger.warning("Duplicate rule lookup failed: %s", e)
        return None

    if not rules:
        return None

    schema = get_schema_name(project_id)
    warnings = []

    for rule in rules:
        match_fields = rule.match_fields
        if not match_fields or not isinstance(match_fields, list):
            continue

        # Build query to check for existing records matching on match_fields
        # Only check fields that are present in the incoming body
        check_fields = [f for f in match_fields if f in body and body[f] is not None]
        if not check_fields:
            continue

        conn = await _get_raw_connection(DATABASE_URL)
        try:
            await conn.execute(f'SET search_path TO "{schema}"')

            conditions = []
            values = []
            for i, field in enumerate(check_fields):
                safe_field = field.strip().lower()
                if not _IDENT_RE.match(safe_field):
                    continue
                conditions.append(f'"{safe_field}" = ${i + 1}')
                values.append(body[field])

            if not conditions:
                continue

            where_clause = " AND ".join(conditions)
            row = await conn.fetchrow(
                f'SELECT * FROM "{table_name}" WHERE {where_clause} '
                f'AND "deleted_at" IS NULL LIMIT 1',
                *values,
            )

            if row:
                duplicate_data = _row_to_dict(row)
                field_desc = ", ".join(check_fields)

                if rule.action == "block":
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": f"Duplicate record found: existing record matches on {field_desc}",
                            "duplicate_record": duplicate_data,
                            "match_fields": check_fields,
                        },
                    )
                else:
                    # warn
                    warnings.append(
                        f"Possible duplicate: record with same {field_desc} exists "
                        f"(id: {duplicate_data.get('id', 'unknown')})"
                    )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Duplicate check failed for rule %s: %s", rule.id, e)
        finally:
            await conn.close()

    if warnings:
        return {"_warnings": warnings}
    return None


# ── Auto-Assign on Record Creation ──────────────────────────────────

async def _apply_auto_assign(
    project_id: str,
    table_name: str,
    record_id: str,
    db: AsyncSession,
) -> None:
    """Apply auto-assign rules after a record is created."""
    try:
        result = await db.execute(
            select(AppAutoAssignRule).where(
                AppAutoAssignRule.project_id == UUID(project_id),
                AppAutoAssignRule.entity == table_name,
                AppAutoAssignRule.enabled.is_(True),
            )
        )
        rules = result.scalars().all()
    except Exception as e:
        logger.warning("Auto-assign rule lookup failed: %s", e)
        return

    if not rules:
        return

    schema = get_schema_name(project_id)

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
            try:
                conn = await _get_raw_connection(DATABASE_URL)
                try:
                    counts = {}
                    for member in members:
                        row = await conn.fetchrow(
                            f'SELECT COUNT(*) as cnt FROM "{schema}"."{table_name}" '
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
                    f'UPDATE "{schema}"."{table_name}" SET "{rule.assign_field}" = $1 WHERE "id" = $2',
                    assignee,
                    record_id,
                )
            finally:
                await conn.close()

            logger.info(
                "Auto-assigned %s=%s on %s.%s (strategy=%s)",
                rule.assign_field, assignee, schema, table_name, rule.strategy,
            )
        except Exception as e:
            logger.error("Auto-assign failed for rule %s: %s", rule.id, e)

    try:
        await db.commit()
    except Exception as e:
        logger.warning("Auto-assign commit failed: %s", e)


# ── Activity Logging ─────────────────────────────────────────────────

async def _log_activity(
    project_id: str,
    table_name: str,
    record_id: str,
    action: str,
    db: AsyncSession,
    changes: dict | None = None,
) -> None:
    """Auto-log an activity entry after create/update/delete."""
    try:
        if action == "updated" and changes:
            # Log one entry per changed field for granular tracking
            for field, vals in changes.items():
                entry = AppActivityEntry(
                    project_id=UUID(project_id),
                    table_name=table_name,
                    record_id=record_id,
                    action=action,
                    field_name=field,
                    old_value=str(vals.get("from", "")) if vals.get("from") is not None else None,
                    new_value=str(vals.get("to", "")) if vals.get("to") is not None else None,
                )
                db.add(entry)
        else:
            entry = AppActivityEntry(
                project_id=UUID(project_id),
                table_name=table_name,
                record_id=record_id,
                action=action,
            )
            db.add(entry)
        await db.commit()
    except Exception as e:
        logger.warning("Activity log error for %s/%s: %s", table_name, record_id, e)


# ── LIST rows ────────────────────────────────────────────────────────

@router.get("/{project_id}/data/{table_name}")
async def list_rows(
    project_id: UUID,
    table_name: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    sort_by: str = Query("id", description="Column to sort by"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
):
    """List rows in a generated app's table with pagination."""
    await _get_app_auth(project_id, request, db)

    table = _validate_identifier(table_name, "table name")
    sort_col = _validate_identifier(sort_by, "sort column")
    schema = get_schema_name(str(project_id))

    await _ensure_schema_or_create(str(project_id), db)
    await _ensure_table_exists(str(project_id), table)

    # Enforce hard LIMIT cap for safety (default 100, max 500)
    effective_page_size = min(page_size, 500)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Optimized COUNT(*): uses deleted_at IS NULL filter which benefits from
        # a partial index: CREATE INDEX idx_{table}_active ON {table} (id) WHERE deleted_at IS NULL
        count_row = await conn.fetchrow(
            f'SELECT COUNT(*) as total FROM "{table}" WHERE "deleted_at" IS NULL'
        )
        total = count_row["total"] if count_row else 0

        # Fetch page with explicit LIMIT (capped at 500)
        # Index hint: ensure index on (deleted_at, {sort_col}) for best performance
        offset = (page - 1) * effective_page_size
        rows = await conn.fetch(
            f'SELECT * FROM "{table}" '
            f'WHERE "deleted_at" IS NULL '
            f'ORDER BY "{sort_col}" {sort_dir.upper()} '
            f"LIMIT $1 OFFSET $2",
            effective_page_size,
            offset,
        )

        return {
            "data": [_row_to_dict(r) for r in rows],
            "pagination": {
                "page": page,
                "page_size": effective_page_size,
                "total": total,
                "total_pages": max(1, (total + effective_page_size - 1) // effective_page_size),
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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get a single row by its id."""
    await _get_app_auth(project_id, request, db)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_schema_or_create(str(project_id), db)
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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Insert a new row into a generated app's table."""
    await _get_app_auth(project_id, request, db)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_schema_or_create(str(project_id), db)
    await _ensure_table_exists(str(project_id), table)

    if not body:
        raise HTTPException(status_code=400, detail="Request body cannot be empty")

    # Sanitize all string values in body to prevent XSS
    body = sanitize_dict(body)

    # ── Duplicate detection: check before insert ──
    duplicate_warnings = None
    try:
        duplicate_warnings = await _check_duplicates(str(project_id), table, body, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Duplicate detection error: %s", e)

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

        # ── Auto-assign: apply rules after record creation ──
        try:
            await _apply_auto_assign(str(project_id), table, row_data.get("id", ""), db)
        except Exception as e:
            logger.warning("Auto-assign error on create: %s", e)

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

        # Log activity: record created
        try:
            await _log_activity(str(project_id), table, row_data.get("id", ""), "created", db)
        except Exception as e:
            logger.warning("Activity log error on create: %s", e)

        # Merge duplicate warnings into response if any
        if duplicate_warnings:
            row_data.update(duplicate_warnings)

        return row_data
    except HTTPException:
        raise
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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing row (partial update)."""
    await _get_app_auth(project_id, request, db)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_schema_or_create(str(project_id), db)
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

        # Fetch old values before updating (for activity log change tracking)
        old_row = await conn.fetchrow(
            f'SELECT * FROM "{table}" WHERE "id" = $1 AND "deleted_at" IS NULL',
            row_id,
        )

        row = await conn.fetchrow(
            f'UPDATE "{table}" SET {set_clause} '
            f'WHERE "id" = {id_param} AND "deleted_at" IS NULL '
            f"RETURNING *",
            *values,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")

        row_data = _row_to_dict(row)

        # Build changes dict for activity log
        changes = {}
        if old_row:
            old_dict = _row_to_dict(dict(old_row))
            for field in safe_data:
                old_val = old_dict.get(field)
                new_val = row_data.get(field)
                if str(old_val) != str(new_val):
                    changes[field] = {"from": old_val, "to": new_val}

        # Log activity: record updated
        try:
            await _log_activity(str(project_id), table, row_id, "updated", db, changes=changes or None)
        except Exception as e:
            logger.warning("Activity log error on update: %s", e)

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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a row by setting deleted_at."""
    await _get_app_auth(project_id, request, db)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_schema_or_create(str(project_id), db)
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

        # Log activity: record deleted
        try:
            await _log_activity(str(project_id), table, row_id, "deleted", db)
        except Exception as e:
            logger.warning("Activity log error on delete: %s", e)

    finally:
        await conn.close()


# ── Schema introspection ─────────────────────────────────────────────

@router.get("/{project_id}/schema")
async def get_app_schema(
    project_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get the list of tables and their columns for a project's app database."""
    await _get_app_auth(project_id, request, db)

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
