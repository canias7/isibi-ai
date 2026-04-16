from __future__ import annotations
"""
CSV Import/Export — upload CSV to populate app data tables, or export as CSV.

Routes:
  POST /api/apps/{project_id}/data/{table_name}/import  — upload CSV, insert rows
  GET  /api/apps/{project_id}/data/{table_name}/export  — download all rows as CSV
"""

import csv
import io
import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables
from generator.orchestrator import _get_project

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["CSV Import/Export"])


# ── Helpers ──────────────────────────────────────────────────────────

import re

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _validate_identifier(name: str, label: str = "identifier") -> str:
    """Validate and return a safe SQL identifier."""
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    return clean


async def _ensure_project_access(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> None:
    await _get_project(db, project_id, org_id)


async def _ensure_table_exists(project_id: str, table_name: str) -> None:
    tables = await list_schema_tables(project_id, DATABASE_URL)
    if table_name not in tables:
        raise HTTPException(
            status_code=404,
            detail=f"Table '{table_name}' not found in project schema.",
        )


async def _get_table_columns(conn: Any, schema: str, table: str) -> list[str]:
    """Return column names for a table in the given schema."""
    rows = await conn.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = $1 AND table_name = $2 "
        "ORDER BY ordinal_position",
        schema,
        table,
    )
    return [r["column_name"] for r in rows]


def _row_to_dict(record: Any) -> dict[str, Any]:
    """Convert an asyncpg Record to a JSON-safe dict."""
    d = dict(record)
    for k, v in d.items():
        if isinstance(v, UUID):
            d[k] = str(v)
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


# ── IMPORT CSV ───────────────────────────────────────────────────────

@router.post("/{project_id}/data/{table_name}/import")
async def import_csv(
    project_id: UUID,
    table_name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Upload a CSV file and insert rows into the app's schema table."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    # Read and decode CSV
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handles BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no headers")

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        # Get valid column names for the table
        valid_columns = await _get_table_columns(conn, schema, table)

        # Match CSV headers to table columns
        csv_headers = []
        for h in reader.fieldnames:
            clean = h.strip().lower()
            if _IDENT_RE.match(clean) and clean in valid_columns:
                csv_headers.append(clean)

        if not csv_headers:
            raise HTTPException(
                status_code=400,
                detail="No CSV headers match table columns. "
                       f"Table columns: {', '.join(valid_columns)}",
            )

        col_names = ", ".join(f'"{c}"' for c in csv_headers)
        placeholders = ", ".join(f"${i + 1}" for i in range(len(csv_headers)))
        insert_sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})'

        imported = 0
        errors: list[dict[str, Any]] = []

        for row_num, row in enumerate(reader, start=2):  # row 1 = headers
            try:
                values = []
                for col in csv_headers:
                    # Find the matching CSV header (case-insensitive)
                    val = None
                    for k, v in row.items():
                        if k.strip().lower() == col:
                            val = v if v != "" else None
                            break
                    values.append(val)

                await conn.execute(insert_sql, *values)
                imported += 1
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                if len(errors) >= 100:
                    break

        return {"imported": imported, "errors": errors}
    finally:
        await conn.close()


# ── EXPORT CSV ───────────────────────────────────────────────────────

@router.get("/{project_id}/data/{table_name}/export")
async def export_csv(
    project_id: UUID,
    table_name: str,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Export all rows from a table as a CSV download."""
    await _ensure_project_access(db, project_id, org_id)

    table = _validate_identifier(table_name, "table name")
    schema = get_schema_name(str(project_id))

    await _ensure_table_exists(str(project_id), table)

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        await conn.execute(f'SET search_path TO "{schema}"')

        rows = await conn.fetch(
            f'SELECT * FROM "{table}" WHERE "deleted_at" IS NULL ORDER BY "id"'
        )

        if not rows:
            # Return empty CSV with just headers
            columns = await _get_table_columns(conn, schema, table)
        else:
            columns = list(rows[0].keys())

        # Write CSV to an in-memory buffer
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()

        for row in rows:
            row_dict = _row_to_dict(row)
            writer.writerow(row_dict)

        output.seek(0)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{table}.csv"',
            },
        )
    finally:
        await conn.close()
