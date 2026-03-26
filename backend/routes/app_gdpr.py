from __future__ import annotations

"""
GDPR Data Export & Deletion — export or delete all data for a specific user.

Endpoints:
  POST /api/apps/{project_id}/gdpr/export/{user_id}  — export all user data
  POST /api/apps/{project_id}/gdpr/delete/{user_id}  — delete all user data
"""

import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

router = APIRouter(prefix="/apps", tags=["App GDPR"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_ident(name: str) -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return clean


def _row_to_dict(record) -> dict[str, Any]:
    d = dict(record)
    for k, v in d.items():
        if hasattr(v, "hex"):
            d[k] = str(v)
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
        elif isinstance(v, (dict, list)):
            pass  # already JSON-safe
    return d


async def _find_user_columns(conn, schema: str, table: str) -> list[str]:
    """Find columns in a table that might reference a user (user_id, created_by, etc.)."""
    cols_rows = await conn.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = $1 AND table_name = $2",
        schema, table,
    )
    existing_cols = {r["column_name"] for r in cols_rows}

    user_cols = []
    for candidate in ["user_id", "created_by", "owner_id", "assigned_to", "updated_by"]:
        if candidate in existing_cols:
            user_cols.append(candidate)
    return user_cols


@router.post("/{project_id}/gdpr/export/{user_id}")
async def gdpr_export(
    project_id: str,
    user_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Export all data associated with a specific user across all tables."""
    schema = get_schema_name(project_id)
    tables = await list_schema_tables(project_id, DATABASE_URL)

    if not tables:
        return {"user_id": user_id, "data": {}, "tables_scanned": 0}

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        exported: dict[str, list[dict]] = {}
        tables_scanned = 0

        for table in tables:
            user_cols = await _find_user_columns(conn, schema, table)
            if not user_cols:
                continue

            tables_scanned += 1
            for col in user_cols:
                rows = await conn.fetch(
                    f'SELECT * FROM "{table}" WHERE "{col}" = $1 LIMIT 5000',
                    user_id,
                )
                if rows:
                    key = f"{table}.{col}"
                    exported[key] = [_row_to_dict(r) for r in rows]

        return {
            "user_id": user_id,
            "data": exported,
            "tables_scanned": tables_scanned,
            "total_records": sum(len(v) for v in exported.values()),
        }
    finally:
        await conn.close()


@router.post("/{project_id}/gdpr/delete/{user_id}")
async def gdpr_delete(
    project_id: str,
    user_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete all data associated with a specific user across all tables."""
    schema = get_schema_name(project_id)
    tables = await list_schema_tables(project_id, DATABASE_URL)

    if not tables:
        return {"user_id": user_id, "deleted": {}, "tables_scanned": 0}

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        deleted: dict[str, int] = {}
        tables_scanned = 0

        for table in tables:
            user_cols = await _find_user_columns(conn, schema, table)
            if not user_cols:
                continue

            tables_scanned += 1
            for col in user_cols:
                # Soft-delete if deleted_at column exists, hard-delete otherwise
                cols_rows = await conn.fetch(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = $1 AND table_name = $2 AND column_name = 'deleted_at'",
                    schema, table,
                )
                if cols_rows:
                    result = await conn.execute(
                        f'UPDATE "{table}" SET "deleted_at" = NOW() '
                        f'WHERE "{col}" = $1 AND "deleted_at" IS NULL',
                        user_id,
                    )
                else:
                    result = await conn.execute(
                        f'DELETE FROM "{table}" WHERE "{col}" = $1',
                        user_id,
                    )

                count_str = result.split(" ")[-1] if isinstance(result, str) else "0"
                try:
                    count = int(count_str)
                except (ValueError, TypeError):
                    count = 0

                if count > 0:
                    deleted[f"{table}.{col}"] = count

        return {
            "user_id": user_id,
            "deleted": deleted,
            "tables_scanned": tables_scanned,
            "total_deleted": sum(deleted.values()),
        }
    finally:
        await conn.close()
