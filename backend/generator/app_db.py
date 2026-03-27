from __future__ import annotations
"""
App Database Manager — creates isolated PostgreSQL schemas for generated apps.

Each generated project gets its own schema (app_{short_id}) containing tables
derived from the spec's entities[]. This provides full data isolation between
generated apps while keeping everything in a single PostgreSQL database.
"""

import re
import time
import asyncio
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


# ── Connection Pool Cache ────────────────────────────────────────────

_POOL_SIZE_PER_SCHEMA = 3
_MAX_TOTAL_POOLS = 50
_POOL_IDLE_TIMEOUT_SECONDS = 600  # 10 minutes

# schema_name → (pool, last_used_timestamp)
_schema_pools: dict[str, tuple[asyncpg.Pool, float]] = {}
_pool_lock = asyncio.Lock()


def _make_raw_dsn(db_url: str) -> str:
    """Convert a SQLAlchemy-style URL to a plain PostgreSQL DSN."""
    raw = db_url
    if "+asyncpg" in raw:
        raw = raw.replace("+asyncpg", "")
    return raw


async def _get_or_create_pool(schema: str, db_url: str) -> asyncpg.Pool:
    """
    Return a connection pool for the given schema. Creates one if it
    doesn't exist yet. Evicts idle pools when the total exceeds the cap.
    """
    now = time.monotonic()

    async with _pool_lock:
        # Check for existing pool
        if schema in _schema_pools:
            pool, _ = _schema_pools[schema]
            _schema_pools[schema] = (pool, now)
            return pool

        # Evict idle pools if at capacity
        if len(_schema_pools) >= _MAX_TOTAL_POOLS:
            idle_schemas = sorted(
                _schema_pools.keys(),
                key=lambda s: _schema_pools[s][1],
            )
            for idle_schema in idle_schemas:
                if len(_schema_pools) < _MAX_TOTAL_POOLS:
                    break
                old_pool, last_used = _schema_pools[idle_schema]
                if now - last_used > _POOL_IDLE_TIMEOUT_SECONDS:
                    try:
                        await old_pool.close()
                    except Exception:
                        pass
                    del _schema_pools[idle_schema]
                    logger.info("Evicted idle pool for schema %s", idle_schema)

            # If still at capacity after evicting idle, evict the oldest
            if len(_schema_pools) >= _MAX_TOTAL_POOLS:
                oldest = min(_schema_pools.keys(), key=lambda s: _schema_pools[s][1])
                old_pool, _ = _schema_pools[oldest]
                try:
                    await old_pool.close()
                except Exception:
                    pass
                del _schema_pools[oldest]
                logger.info("Evicted oldest pool for schema %s", oldest)

        # Create new pool
        dsn = _make_raw_dsn(db_url)

        async def _init_conn(conn):
            await conn.execute(f'SET search_path TO "{schema}"')

        pool = await asyncpg.create_pool(
            dsn,
            min_size=1,
            max_size=_POOL_SIZE_PER_SCHEMA,
            init=_init_conn,
        )
        _schema_pools[schema] = (pool, now)
        logger.info("Created pool for schema %s (total pools: %d)", schema, len(_schema_pools))
        return pool


async def cleanup_idle_pools() -> int:
    """
    Close pools that haven't been used in the last 10 minutes.
    Returns the number of pools closed.
    """
    now = time.monotonic()
    closed = 0
    async with _pool_lock:
        to_remove = []
        for schema, (pool, last_used) in _schema_pools.items():
            if now - last_used > _POOL_IDLE_TIMEOUT_SECONDS:
                to_remove.append(schema)
        for schema in to_remove:
            pool, _ = _schema_pools.pop(schema)
            try:
                await pool.close()
            except Exception:
                pass
            closed += 1
            logger.info("Cleaned up idle pool for schema %s", schema)
    return closed


async def close_all_pools() -> None:
    """Close all connection pools. Call on shutdown."""
    async with _pool_lock:
        for schema, (pool, _) in _schema_pools.items():
            try:
                await pool.close()
            except Exception:
                pass
        _schema_pools.clear()
        logger.info("All schema connection pools closed")


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

    Converts postgresql+asyncpg://... -> postgresql://...
    """
    raw = _make_raw_dsn(db_url)
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

    # Sort entities by FK dependencies: entities with no FKs first, then those referencing them
    def _get_entity_table(e):
        return _sanitize_identifier(e.get("table", e.get("name", "unknown")))

    entity_tables = {_get_entity_table(e) for e in entities if isinstance(e, dict)}

    def _has_fk_to(entity, target_tables):
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            db_type = (field.get("db_type", "") or "").upper()
            if "REFERENCES" in db_type:
                for t in target_tables:
                    if t.upper() in db_type:
                        return True
        return False

    # Simple topological sort: entities with no FKs first
    sorted_entities = []
    remaining = [e for e in entities if isinstance(e, dict)]
    created_tables = set()
    max_passes = len(remaining) + 1
    for _ in range(max_passes):
        if not remaining:
            break
        next_remaining = []
        for entity in remaining:
            # Check if all FK targets are already created or not in our entity set
            has_unmet_deps = False
            for field in entity.get("fields", []):
                if not isinstance(field, dict):
                    continue
                db_type = (field.get("db_type", "") or "").upper()
                if "REFERENCES" in db_type:
                    # Extract referenced table name
                    import re as _re
                    ref_match = _re.search(r'REFERENCES\s+"?(\w+)"?\s*\(', db_type)
                    if ref_match:
                        ref_table = ref_match.group(1).lower()
                        if ref_table in entity_tables and ref_table not in created_tables:
                            has_unmet_deps = True
                            break
            if not has_unmet_deps:
                sorted_entities.append(entity)
                created_tables.add(_get_entity_table(entity))
            else:
                next_remaining.append(entity)
        remaining = next_remaining

    # Add any remaining (circular deps) at the end
    sorted_entities.extend(remaining)

    conn = await _get_raw_connection(db_url)
    try:
        # Create schema
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        logger.info("Created schema %s for project %s", schema, project_id)

        # Create tables (sorted by FK dependencies)
        for entity in sorted_entities:
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
                raw_type = field.get("db_type", "TEXT") or "TEXT"
                col_type = map_spec_type_to_sql(raw_type)
                # Fix REFERENCES to use schema-qualified table names
                if "REFERENCES" in col_type.upper():
                    import re as _re2
                    def _fix_ref(m):
                        ref_table = m.group(1).lower()
                        ref_col = m.group(2)
                        return f'REFERENCES "{schema}"."{ref_table}"({ref_col})'
                    col_type = _re2.sub(
                        r'REFERENCES\s+"?(\w+)"?\s*\((\w+)\)',
                        _fix_ref,
                        col_type,
                        flags=_re2.IGNORECASE
                    )
                    # Also strip ON DELETE/CASCADE for simplicity — avoid FK constraint issues
                    col_type = _re2.sub(r'\s+ON\s+DELETE\s+\w+', '', col_type, flags=_re2.IGNORECASE)
                    col_type = _re2.sub(r'\s+ON\s+UPDATE\s+\w+', '', col_type, flags=_re2.IGNORECASE)
                    # Strip REFERENCES entirely — just use UUID type
                    col_type = _re2.sub(r'\s*REFERENCES\s+"[^"]+"\."[^"]+"\(\w+\)', '', col_type, flags=_re2.IGNORECASE)
                    if not col_type.strip():
                        col_type = "UUID"
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

            # Create performance indexes for common query patterns
            # 1. Partial index on active rows (deleted_at IS NULL) for faster counts and listings
            try:
                await conn.execute(
                    f'CREATE INDEX IF NOT EXISTS "idx_{table_name}_active" '
                    f'ON "{schema}"."{table_name}" ("id") WHERE "deleted_at" IS NULL'
                )
            except Exception:
                pass  # Index creation is best-effort

            # 2. Index on deleted_at for soft-delete filtering
            try:
                await conn.execute(
                    f'CREATE INDEX IF NOT EXISTS "idx_{table_name}_deleted_at" '
                    f'ON "{schema}"."{table_name}" ("deleted_at")'
                )
            except Exception:
                pass

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

    # Also close the pool for this schema if it exists
    async with _pool_lock:
        if schema_name in _schema_pools:
            pool, _ = _schema_pools.pop(schema_name)
            try:
                await pool.close()
            except Exception:
                pass


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


async def get_schema_pool(
    project_id: str,
    db_url: str,
) -> asyncpg.Pool:
    """
    Get a connection pool for the project's schema.

    Usage:
        pool = await get_schema_pool(project_id, db_url)
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM my_table")

    The pool automatically sets search_path on each connection.
    """
    schema = _schema_name(project_id)
    return await _get_or_create_pool(schema, db_url)


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
