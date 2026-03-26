from __future__ import annotations
"""
App Database Manager — creates isolated PostgreSQL schemas for generated apps.

Each generated project gets its own schema (app_{short_id}) containing tables
derived from the spec's entities[]. This provides full data isolation between
generated apps while keeping everything in a single PostgreSQL database.
"""

import re
import logging
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)


# ── Type mapping ─────────────────────────────────────────────────────

_TYPE_MAP: dict[str, str] = {
    # Direct pass-through types (already valid SQL)
    "uuid": "UUID",
    "text": "TEXT",
    "integer": "INTEGER",
    "int": "INTEGER",
    "bigint": "BIGINT",
    "smallint": "SMALLINT",
    "boolean": "BOOLEAN",
    "bool": "BOOLEAN",
    "date": "DATE",
    "time": "TIME",
    "timestamp": "TIMESTAMP",
    "timestamptz": "TIMESTAMPTZ",
    "numeric": "NUMERIC",
    "decimal": "DECIMAL",
    "float": "FLOAT",
    "double precision": "DOUBLE PRECISION",
    "real": "REAL",
    "json": "JSON",
    "jsonb": "JSONB",
    "bytea": "BYTEA",
}


def map_spec_type_to_sql(db_type: str) -> str:
    """
    Map a spec db_type string to a PostgreSQL column definition.

    Spec db_type values can be:
      - Simple:  "TEXT", "INTEGER", "BOOLEAN"
      - With modifiers: "VARCHAR(255)", "NUMERIC(10,2)"
      - Full column defs: "UUID DEFAULT gen_random_uuid() PRIMARY KEY"
      - Already valid SQL — passed through as-is

    Returns the SQL type/constraint fragment ready for a CREATE TABLE column.
    """
    if not db_type:
        return "TEXT"

    stripped = db_type.strip()

    # If it contains keywords like DEFAULT, PRIMARY KEY, NOT NULL, REFERENCES
    # treat as a full column definition fragment — pass through directly
    upper = stripped.upper()
    if any(kw in upper for kw in ("DEFAULT", "PRIMARY KEY", "REFERENCES", "NOT NULL", "UNIQUE", "CHECK")):
        return stripped

    # Try matching the base type (before any parentheses)
    base = re.split(r"[\s(]", stripped, maxsplit=1)[0].lower()
    mapped = _TYPE_MAP.get(base)

    if mapped:
        # Re-attach any size/precision specifier, e.g. VARCHAR(255)
        rest = stripped[len(base):]
        return mapped + rest

    # VARCHAR(N) — common pattern
    if upper.startswith("VARCHAR"):
        return stripped.upper()

    # Fallback: pass through as-is (PostgreSQL will validate)
    return stripped


# ── Schema helpers ───────────────────────────────────────────────────

def _schema_name(project_id: str | UUID) -> str:
    """Derive a schema name from a project ID (first 12 hex chars)."""
    short = str(project_id).replace("-", "")[:12].lower()
    return f"app_{short}"


def _sanitize_identifier(name: str) -> str:
    """Ensure a name is safe for use as a SQL identifier."""
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip())
    if not clean or clean[0].isdigit():
        clean = f"t_{clean}"
    return clean.lower()


async def _get_raw_connection(db_url: str) -> asyncpg.Connection:
    """
    Get a raw asyncpg connection from a SQLAlchemy-style URL.

    Converts postgresql+asyncpg://... → postgresql://...
    """
    raw = db_url
    if "+asyncpg" in raw:
        raw = raw.replace("+asyncpg", "")
    return await asyncpg.connect(raw)


# ── Public API ───────────────────────────────────────────────────────

async def create_app_schema(
    project_id: str,
    spec: dict,
    db_url: str,
) -> str:
    """
    Create a PostgreSQL schema and tables from the spec's entities.

    Args:
        project_id: The project UUID string.
        spec: The full generated spec dict (must contain entities[]).
        db_url: The SQLAlchemy DATABASE_URL.

    Returns:
        The schema name created (e.g. "app_a1b2c3d4e5f6").
    """
    schema = _schema_name(project_id)
    entities = spec.get("entities", [])

    if not entities:
        logger.warning("No entities in spec for project %s — schema created but empty", project_id)

    conn = await _get_raw_connection(db_url)
    try:
        # Create schema
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        logger.info("Created schema %s for project %s", schema, project_id)

        # Create tables
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            table_name = _sanitize_identifier(entity.get("name", "unknown"))
            fields = entity.get("fields", [])
            if not isinstance(fields, list):
                fields = []

            columns = []
            for field in fields:
                if not isinstance(field, dict):
                    continue
                col_name = _sanitize_identifier(field.get("name", "col"))
                col_type = map_spec_type_to_sql(field.get("db_type", "TEXT"))
                columns.append(f'    "{col_name}" {col_type}')

            # Add soft-delete column if not already present
            field_names = [_sanitize_identifier(f.get("name", "")) for f in fields]
            if "deleted_at" not in field_names:
                columns.append('    "deleted_at" TIMESTAMPTZ DEFAULT NULL')

            columns_sql = ",\n".join(columns)
            create_sql = (
                f'CREATE TABLE IF NOT EXISTS "{schema}"."{table_name}" (\n'
                f"{columns_sql}\n"
                f")"
            )

            logger.info("Creating table %s.%s", schema, table_name)
            await conn.execute(create_sql)

    finally:
        await conn.close()

    return schema


async def drop_app_schema(schema_name: str, db_url: str) -> None:
    """
    Drop an entire app schema and all its tables.

    Args:
        schema_name: The schema to drop (e.g. "app_a1b2c3d4e5f6").
        db_url: The SQLAlchemy DATABASE_URL.
    """
    # Safety check: only drop schemas that match our naming convention
    if not schema_name.startswith("app_"):
        raise ValueError(f"Refusing to drop schema '{schema_name}' — not an app schema")

    conn = await _get_raw_connection(db_url)
    try:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        logger.info("Dropped schema %s", schema_name)
    finally:
        await conn.close()


async def get_schema_connection(
    project_id: str,
    db_url: str,
) -> asyncpg.Connection:
    """
    Get a raw asyncpg connection with search_path set to the project's schema.

    Caller is responsible for closing the connection.
    """
    schema = _schema_name(project_id)
    conn = await _get_raw_connection(db_url)
    await conn.execute(f'SET search_path TO "{schema}"')
    return conn


def get_schema_name(project_id: str | UUID) -> str:
    """Public helper to get the schema name for a project."""
    return _schema_name(project_id)


async def list_schema_tables(project_id: str, db_url: str) -> list[str]:
    """List all table names in a project's schema."""
    schema = _schema_name(project_id)
    conn = await _get_raw_connection(db_url)
    try:
        rows = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = $1 ORDER BY table_name",
            schema,
        )
        return [r["table_name"] for r in rows]
    finally:
        await conn.close()


async def get_table_columns(
    project_id: str,
    table_name: str,
    db_url: str,
) -> list[dict]:
    """Get column info for a table in a project's schema."""
    schema = _schema_name(project_id)
    conn = await _get_raw_connection(db_url)
    try:
        rows = await conn.fetch(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns "
            "WHERE table_schema = $1 AND table_name = $2 "
            "ORDER BY ordinal_position",
            schema,
            table_name,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()
