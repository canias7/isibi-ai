from __future__ import annotations
"""
Import Wizard — step-by-step CSV import for generated apps.

Routes:
  POST /api/apps/{project_id}/import/preview  — upload CSV, preview + auto-map
  POST /api/apps/{project_id}/import/execute  — run the import with user mapping
"""

import base64
import csv
import io
import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Import Wizard"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
MAX_PREVIEW_ROWS = 5


# ── Schemas ──────────────────────────────────────────────────────────

class ImportExecuteRequest(BaseModel):
    table: str
    mapping: dict  # {"CSV Header": "db_column", ...}
    skip_header: bool = True
    csv_data: str  # base64-encoded CSV


# ── Helpers ──────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    """Lowercase, strip, remove spaces/underscores for fuzzy matching."""
    return re.sub(r"[\s_\-]+", "", name.strip().lower())


def _auto_map(csv_headers: list[str], db_fields: list[dict]) -> dict[str, str]:
    """Map CSV headers to entity fields using fuzzy matching."""
    mapping: dict[str, str] = {}
    field_lookup: dict[str, str] = {}
    for f in db_fields:
        field_lookup[_normalize(f["name"])] = f["name"]

    for header in csv_headers:
        norm = _normalize(header)
        if norm in field_lookup:
            mapping[header] = field_lookup[norm]
    return mapping


async def _get_table_columns(project_id: str, table_name: str) -> list[dict]:
    """Return columns for a table in the project schema."""
    schema = get_schema_name(project_id)
    conn = await _get_raw_connection(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            """,
            schema,
            table_name,
        )
        return [{"name": r["column_name"], "db_type": r["data_type"].upper()} for r in rows]
    finally:
        await conn.close()


def _validate_identifier(name: str, label: str = "identifier") -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    return clean


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/import/preview")
async def import_preview(
    project_id: uuid.UUID,
    table: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Upload a CSV and get a preview with auto-mapped columns."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    table_name = _validate_identifier(table, "table name")

    # Verify table exists
    tables = await list_schema_tables(str(project_id), DATABASE_URL)
    if table_name not in tables:
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

    # Read CSV
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.reader(io.StringIO(text))
    all_rows = list(reader)

    if not all_rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    headers = all_rows[0]
    data_rows = all_rows[1:]
    sample_rows = data_rows[:MAX_PREVIEW_ROWS]

    # Get entity fields
    entity_fields = await _get_table_columns(str(project_id), table_name)

    # Auto-map
    suggested_mapping = _auto_map(headers, entity_fields)

    return {
        "headers": headers,
        "sample_rows": sample_rows,
        "row_count": len(data_rows),
        "entity_fields": entity_fields,
        "suggested_mapping": suggested_mapping,
    }


@router.post("/{project_id}/import/execute")
async def import_execute(
    project_id: uuid.UUID,
    body: ImportExecuteRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Execute CSV import with user-provided column mapping."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    table_name = _validate_identifier(body.table, "table name")

    # Verify table exists
    tables = await list_schema_tables(str(project_id), DATABASE_URL)
    if table_name not in tables:
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

    # Decode CSV
    try:
        csv_bytes = base64.b64decode(body.csv_data)
        try:
            csv_text = csv_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            csv_text = csv_bytes.decode("latin-1")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 CSV data")

    reader = csv.reader(io.StringIO(csv_text))
    all_rows = list(reader)

    if not all_rows:
        raise HTTPException(status_code=400, detail="CSV is empty")

    headers = all_rows[0]
    data_rows = all_rows[1:] if body.skip_header else all_rows

    # Build column index from mapping
    col_indices: dict[str, int] = {}
    for csv_header, db_col in body.mapping.items():
        if csv_header in headers:
            col_indices[db_col] = headers.index(csv_header)

    if not col_indices:
        raise HTTPException(status_code=400, detail="No valid column mappings found")

    db_columns = list(col_indices.keys())
    schema = get_schema_name(str(project_id))

    imported = 0
    skipped = 0
    errors: list[dict] = []

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        for row_num, row in enumerate(data_rows, start=1):
            try:
                values = []
                for col in db_columns:
                    idx = col_indices[col]
                    val = row[idx].strip() if idx < len(row) else None
                    values.append(val if val else None)

                placeholders = ", ".join(f"${i+1}" for i in range(len(db_columns)))
                col_names = ", ".join(f'"{c}"' for c in db_columns)

                await conn.execute(
                    f'INSERT INTO "{schema}"."{table_name}" ({col_names}) VALUES ({placeholders})',
                    *values,
                )
                imported += 1
            except Exception as e:
                skipped += 1
                errors.append({"row": row_num, "error": str(e)[:200]})
    finally:
        await conn.close()

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:50],  # cap error list
    }
