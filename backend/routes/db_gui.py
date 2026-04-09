from __future__ import annotations

"""
Database GUI — visual database management endpoints for an Airtable-like view.
"""

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text, inspect
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db

router = APIRouter(prefix="/apps", tags=["db-gui"])

# ── Security: identifier validation ──────────────────────────────────────────
_SAFE_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_SAFE_TYPE_RE = re.compile(r"^[a-zA-Z][\w() ,]{0,63}$")

def _validate_ident(name: str, label: str = "identifier") -> str:
    """Validate a SQL identifier (table/column name) against injection."""
    if not _SAFE_IDENT_RE.match(name):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid {label}: {name!r}")
    return name

def _validate_type(type_str: str) -> str:
    """Validate a column type string (e.g. 'varchar(255)', 'integer')."""
    if not _SAFE_TYPE_RE.match(type_str):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid column type: {type_str!r}")
    return type_str


# ── Schemas ───────────────────────────────────────────────────────────────────

class CellUpdateBody(BaseModel):
    column: str
    value: object


class AddColumnBody(BaseModel):
    name: str
    type: str  # e.g. "varchar(255)", "integer", "boolean", "text", "timestamp"
    nullable: bool = True
    default: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/db/tables")
async def list_tables(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all tables with row counts."""
    result = await db.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' ORDER BY table_name"
    ))
    table_names = [row[0] for row in result.all()]

    tables = []
    for table_name in table_names:
        _validate_ident(table_name, "table")
        count_result = await db.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))
        row_count = count_result.scalar() or 0
        tables.append({"name": table_name, "row_count": row_count})

    return {"tables": tables, "project_id": project_id}


@router.get("/{project_id}/db/tables/{table}/schema")
async def get_table_schema(
    project_id: str,
    table: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get column definitions for a table."""
    _validate_ident(table, "table")
    result = await db.execute(text(
        "SELECT column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :table "
        "ORDER BY ordinal_position"
    ), {"table": table})
    rows = result.all()

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    columns = [
        {
            "name": row[0],
            "type": row[1],
            "nullable": row[2] == "YES",
            "default": row[3],
        }
        for row in rows
    ]
    return {"table": table, "columns": columns}


@router.get("/{project_id}/db/tables/{table}/rows")
async def list_rows(
    project_id: str,
    table: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    sort: Optional[str] = Query(None),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated rows with sorting."""
    _validate_ident(table, "table")
    if sort:
        _validate_ident(sort, "sort column")
    # Validate table exists
    check = await db.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = :table"
    ), {"table": table})
    if not check.scalar():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    # Count
    count_result = await db.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
    total = count_result.scalar() or 0

    # Build query
    order_clause = ""
    if sort:
        # Validate sort column exists
        col_check = await db.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :table AND column_name = :col"
        ), {"table": table, "col": sort})
        if col_check.scalar():
            order_clause = f'ORDER BY "{sort}" {order.upper()}'

    offset = (page - 1) * limit
    query_str = f'SELECT * FROM "{table}" {order_clause} LIMIT :limit OFFSET :offset'
    result = await db.execute(text(query_str), {"limit": limit, "offset": offset})

    columns = list(result.keys())
    rows = []
    for row in result.all():
        row_dict = {}
        for i, col in enumerate(columns):
            val = row[i]
            # Convert UUIDs and datetimes to strings for JSON serialization
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            elif isinstance(val, uuid.UUID):
                val = str(val)
            row_dict[col] = val
        rows.append(row_dict)

    return {
        "table": table,
        "rows": rows,
        "columns": columns,
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.patch("/{project_id}/db/tables/{table}/rows/{row_id}")
async def update_cell(
    project_id: str,
    table: str,
    row_id: str,
    body: CellUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Inline edit a cell value."""
    _validate_ident(table, "table")
    _validate_ident(body.column, "column")
    # Validate column exists
    col_check = await db.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :table AND column_name = :col"
    ), {"table": table, "col": body.column})
    if not col_check.scalar():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")

    await db.execute(
        text(f'UPDATE "{table}" SET "{body.column}" = :value WHERE id = :id'),
        {"value": body.value, "id": row_id},
    )
    await db.commit()

    return {"detail": "Cell updated", "table": table, "row_id": row_id, "column": body.column}


@router.post("/{project_id}/db/tables/{table}/columns", status_code=201)
async def add_column(
    project_id: str,
    table: str,
    body: AddColumnBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a column to a table."""
    _validate_ident(table, "table")
    _validate_ident(body.name, "column name")
    _validate_type(body.type)
    nullable_str = "" if body.nullable else " NOT NULL"
    # Use parameterized default value to prevent injection
    default_str = ""
    default_params = {}
    if body.default:
        default_str = " DEFAULT :default_val"
        default_params = {"default_val": body.default}
    stmt = f'ALTER TABLE "{table}" ADD COLUMN "{body.name}" {body.type}{nullable_str}'
    if default_params:
        # For defaults, use a safe cast — only allow simple literal values
        import re as _re
        if not _re.match(r"^[a-zA-Z0-9_.'\-\s]+$", body.default):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid default value")
        stmt += f" DEFAULT '{body.default}'"

    try:
        await db.execute(text(stmt))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"detail": "Column added", "table": table, "column": body.name, "type": body.type}


@router.delete("/{project_id}/db/tables/{table}/columns/{column_name}")
async def drop_column(
    project_id: str,
    table: str,
    column_name: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Drop a column from a table."""
    _validate_ident(table, "table")
    _validate_ident(column_name, "column")
    try:
        await db.execute(text(f'ALTER TABLE "{table}" DROP COLUMN "{column_name}"'))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"detail": "Column dropped", "table": table, "column": column_name}
