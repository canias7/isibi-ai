"""
Command Executor — processes scheduled AI commands against app data.

Parses natural language commands and generates text reports by querying
the app's dynamic schema tables.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone, date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_identifier(name: str) -> str:
    """Validate and return a safe SQL identifier (prevents SQL injection)."""
    if not _IDENTIFIER_RE.match(name) or len(name) > 128:
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


async def execute_command(project_id: str, command: str, db: AsyncSession) -> str:
    """
    Execute a scheduled command against a project's data.

    Returns a formatted text report string.
    """
    from generator.app_db import get_schema_name
    schema = get_schema_name(project_id)

    cmd_lower = command.lower().strip()

    try:
        # Discover available tables in the schema
        tables = await _get_schema_tables(schema, db)
        if not tables:
            return "No data tables found for this app."

        # ── Report / Summary commands ────────────────────────────────
        if _matches(cmd_lower, ["report", "summary", "overview", "recap"]):
            entity = _extract_entity(cmd_lower, tables)
            if entity:
                return await _generate_entity_report(schema, entity, tables, cmd_lower, db)
            else:
                return await _generate_full_summary(schema, tables, db)

        # ── Count commands ───────────────────────────────────────────
        if _matches(cmd_lower, ["count", "how many", "total number"]):
            entity = _extract_entity(cmd_lower, tables)
            if entity:
                return await _count_entity(schema, entity, cmd_lower, db)
            else:
                return await _count_all(schema, tables, db)

        # ── List / show commands ─────────────────────────────────────
        if _matches(cmd_lower, ["list", "show", "display", "get all"]):
            entity = _extract_entity(cmd_lower, tables)
            if entity:
                return await _list_entity(schema, entity, cmd_lower, db)
            else:
                return "Please specify which entity to list. Available: " + ", ".join(
                    t.replace("_", " ").title() for t in tables
                )

        # ── Overdue / due commands ───────────────────────────────────
        if _matches(cmd_lower, ["overdue", "past due", "expired", "late"]):
            entity = _extract_entity(cmd_lower, tables)
            return await _find_overdue(schema, entity, tables, db)

        # ── Income / revenue / sales commands ────────────────────────
        if _matches(cmd_lower, ["income", "revenue", "sales", "earnings", "money"]):
            return await _generate_income_report(schema, tables, cmd_lower, db)

        # ── Fallback: try to generate a general report ───────────────
        entity = _extract_entity(cmd_lower, tables)
        if entity:
            return await _generate_entity_report(schema, entity, tables, cmd_lower, db)

        # Generic full summary as last resort
        return await _generate_full_summary(schema, tables, db)

    except Exception as e:
        logger.error(f"Command execution failed for project {project_id}: {e}")
        return f"Error executing command: {str(e)}"


# ── Pattern helpers ──────────────────────────────────────────────────

def _matches(text: str, keywords: list[str]) -> bool:
    return any(kw in text for kw in keywords)


def _extract_entity(cmd: str, tables: list[str]) -> Optional[str]:
    """Find which table the command is about."""
    for table in tables:
        # Match pluralized or singular form
        singular = table.rstrip("s")
        display = table.replace("_", " ")
        display_singular = singular.replace("_", " ")
        if (
            table in cmd
            or singular in cmd
            or display in cmd
            or display_singular in cmd
        ):
            return table
    return None


def _is_today_filter(cmd: str) -> bool:
    return any(w in cmd for w in ["today", "this day", "daily"])


def _is_this_week_filter(cmd: str) -> bool:
    return any(w in cmd for w in ["this week", "weekly", "week"])


def _is_this_month_filter(cmd: str) -> bool:
    return any(w in cmd for w in ["this month", "monthly", "month"])


def _time_filter_sql(cmd: str) -> str:
    """Return a SQL WHERE clause fragment for date filtering."""
    if _is_today_filter(cmd):
        return "AND created_at::date = CURRENT_DATE"
    if _is_this_week_filter(cmd):
        return "AND created_at >= date_trunc('week', CURRENT_DATE)"
    if _is_this_month_filter(cmd):
        return "AND created_at >= date_trunc('month', CURRENT_DATE)"
    return ""


def _time_label(cmd: str) -> str:
    if _is_today_filter(cmd):
        return "Today"
    if _is_this_week_filter(cmd):
        return "This Week"
    if _is_this_month_filter(cmd):
        return "This Month"
    return "All Time"


# ── Schema discovery ─────────────────────────────────────────────────

async def _get_schema_tables(schema: str, db: AsyncSession) -> list[str]:
    """Get all user-data tables in the app schema."""
    _safe_identifier(schema)
    result = await db.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = :schema AND table_type = 'BASE TABLE' "
        "ORDER BY table_name"
    ), {"schema": schema})
    return [row[0] for row in result.fetchall()]


async def _get_table_columns(schema: str, table: str, db: AsyncSession) -> list[dict]:
    """Get column names and types for a table."""
    _safe_identifier(schema)
    _safe_identifier(table)
    result = await db.execute(text(
        "SELECT column_name, data_type "
        "FROM information_schema.columns "
        "WHERE table_schema = :schema AND table_name = :table "
        "ORDER BY ordinal_position"
    ), {"schema": schema, "table": table})
    return [{"name": row[0], "type": row[1]} for row in result.fetchall()]


def _find_numeric_columns(columns: list[dict]) -> list[str]:
    """Find columns that hold numeric/money data (validated identifiers only)."""
    numeric_types = {"numeric", "integer", "bigint", "real", "double precision", "money"}
    skip = {"id", "created_at", "updated_at", "deleted_at"}
    result = []
    for c in columns:
        if c["type"] in numeric_types and c["name"] not in skip:
            try:
                _safe_identifier(c["name"])
                result.append(c["name"])
            except ValueError:
                continue
    return result


def _find_date_columns(columns: list[dict]) -> list[str]:
    """Find columns that hold date/time data (validated identifiers only)."""
    date_types = {"date", "timestamp without time zone", "timestamp with time zone"}
    skip = {"created_at", "updated_at", "deleted_at"}
    result = []
    for c in columns:
        if c["type"] in date_types and c["name"] not in skip:
            try:
                _safe_identifier(c["name"])
                result.append(c["name"])
            except ValueError:
                continue
    return result


def _find_name_column(columns: list[dict]) -> Optional[str]:
    """Find the best 'name' column for display (validated identifier only)."""
    for preferred in ["name", "title", "label", "subject", "email", "first_name"]:
        for c in columns:
            if c["name"] == preferred:
                try:
                    _safe_identifier(c["name"])
                    return c["name"]
                except ValueError:
                    continue
    # Fallback: first text column
    for c in columns:
        if c["type"] in ("character varying", "text") and c["name"] not in ("id",):
            try:
                _safe_identifier(c["name"])
                return c["name"]
            except ValueError:
                continue
    return None


# ── Report generators ────────────────────────────────────────────────

async def _generate_entity_report(
    schema: str, entity: str, tables: list[str], cmd: str, db: AsyncSession
) -> str:
    """Generate a detailed report for a single entity."""
    _safe_identifier(entity)
    columns = await _get_table_columns(schema, entity, db)
    time_filter = _time_filter_sql(cmd)
    time_label = _time_label(cmd)
    display_name = entity.replace("_", " ").title()

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%B %d, %Y")

    lines = [f"--- {display_name} Report ({time_label} - {date_str}) ---", ""]

    # Total count
    count_result = await db.execute(text(
        f"SELECT COUNT(*) FROM {schema}.{entity} WHERE deleted_at IS NULL {time_filter}"
    ))
    total = count_result.scalar() or 0
    lines.append(f"Total {display_name}: {total}")

    # Numeric field summaries
    numeric_cols = _find_numeric_columns(columns)
    for col in numeric_cols:
        try:
            agg_result = await db.execute(text(
                f"SELECT SUM({col}), AVG({col}), MIN({col}), MAX({col}) "
                f"FROM {schema}.{entity} WHERE deleted_at IS NULL {time_filter}"
            ))
            row = agg_result.fetchone()
            if row and row[0] is not None:
                col_label = col.replace("_", " ").title()
                total_val = _format_number(row[0], col)
                avg_val = _format_number(row[1], col)
                lines.append(f"  {col_label}: Total={total_val}, Avg={avg_val}, Min={_format_number(row[2], col)}, Max={_format_number(row[3], col)}")
        except Exception:
            pass

    # Recent entries
    name_col = _find_name_column(columns)
    if name_col:
        try:
            recent = await db.execute(text(
                f"SELECT {name_col} FROM {schema}.{entity} "
                f"WHERE deleted_at IS NULL {time_filter} "
                f"ORDER BY created_at DESC LIMIT 5"
            ))
            rows = recent.fetchall()
            if rows:
                lines.append("")
                lines.append(f"Recent {display_name}:")
                for r in rows:
                    lines.append(f"  - {r[0]}")
        except Exception:
            pass

    # Comparison with yesterday (only if today filter)
    if _is_today_filter(cmd):
        try:
            yesterday_result = await db.execute(text(
                f"SELECT COUNT(*) FROM {schema}.{entity} "
                f"WHERE deleted_at IS NULL AND created_at::date = CURRENT_DATE - INTERVAL '1 day'"
            ))
            yesterday_count = yesterday_result.scalar() or 0
            if yesterday_count > 0:
                change = total - yesterday_count
                pct = ((change / yesterday_count) * 100) if yesterday_count > 0 else 0
                sign = "+" if change >= 0 else ""
                lines.append("")
                lines.append(f"Compared to yesterday: {sign}{change} ({sign}{pct:.0f}%)")
        except Exception:
            pass

    return "\n".join(lines)


async def _generate_full_summary(schema: str, tables: list[str], db: AsyncSession) -> str:
    """Generate a summary across all entities."""
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%B %d, %Y")
    lines = [f"--- App Summary ({date_str}) ---", ""]

    for table in tables:
        try:
            _safe_identifier(table)
            count_result = await db.execute(text(
                f"SELECT COUNT(*) FROM {schema}.{table} WHERE deleted_at IS NULL"
            ))
            count = count_result.scalar() or 0
            display = table.replace("_", " ").title()
            lines.append(f"  {display}: {count} records")
        except Exception:
            pass

    return "\n".join(lines)


async def _generate_income_report(
    schema: str, tables: list[str], cmd: str, db: AsyncSession
) -> str:
    """Generate an income/revenue report across all entities with monetary fields."""
    time_filter = _time_filter_sql(cmd)
    time_label = _time_label(cmd)
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%B %d, %Y")

    lines = [f"--- Income Report ({time_label} - {date_str}) ---", ""]

    total_revenue = 0.0
    found_money = False

    for table in tables:
        try:
            _safe_identifier(table)
        except ValueError:
            continue
        columns = await _get_table_columns(schema, table, db)
        money_cols = [
            c["name"] for c in columns
            if c["name"] in (
                "price", "amount", "total", "revenue", "income", "cost",
                "subtotal", "fee", "payment", "charge", "value",
            )
        ]
        if not money_cols:
            continue

        found_money = True
        display = table.replace("_", " ").title()

        for col in money_cols:
            try:
                result = await db.execute(text(
                    f"SELECT COALESCE(SUM({col}), 0), COUNT(*) "
                    f"FROM {schema}.{table} WHERE deleted_at IS NULL {time_filter}"
                ))
                row = result.fetchone()
                if row:
                    col_total = float(row[0])
                    col_count = row[1]
                    total_revenue += col_total
                    lines.append(f"  {display} ({col.replace('_', ' ').title()}): ${col_total:,.2f} ({col_count} records)")
            except Exception:
                pass

    if not found_money:
        return f"No monetary fields found in your app data. Available tables: {', '.join(t.replace('_', ' ').title() for t in tables)}"

    lines.insert(2, f"Total Revenue: ${total_revenue:,.2f}")
    lines.insert(3, "")

    # Yesterday comparison
    if _is_today_filter(cmd):
        try:
            yesterday_total = 0.0
            for table in tables:
                columns = await _get_table_columns(schema, table, db)
                money_cols = [
                    c["name"] for c in columns
                    if c["name"] in ("price", "amount", "total", "revenue", "income", "cost", "subtotal", "fee", "payment", "charge", "value")
                ]
                for col in money_cols:
                    try:
                        result = await db.execute(text(
                            f"SELECT COALESCE(SUM({col}), 0) FROM {schema}.{table} "
                            f"WHERE deleted_at IS NULL AND created_at::date = CURRENT_DATE - INTERVAL '1 day'"
                        ))
                        yesterday_total += float(result.scalar() or 0)
                    except Exception:
                        pass

            if yesterday_total > 0:
                change = total_revenue - yesterday_total
                pct = (change / yesterday_total) * 100
                sign = "+" if change >= 0 else ""
                lines.append("")
                lines.append(f"Compared to yesterday: {sign}${change:,.2f} ({sign}{pct:.0f}% revenue)")
        except Exception:
            pass

    return "\n".join(lines)


async def _count_entity(schema: str, entity: str, cmd: str, db: AsyncSession) -> str:
    """Count records for a specific entity."""
    _safe_identifier(entity)
    time_filter = _time_filter_sql(cmd)
    time_label = _time_label(cmd)
    display = entity.replace("_", " ").title()

    result = await db.execute(text(
        f"SELECT COUNT(*) FROM {schema}.{entity} WHERE deleted_at IS NULL {time_filter}"
    ))
    count = result.scalar() or 0
    return f"{display} count ({time_label}): {count}"


async def _count_all(schema: str, tables: list[str], db: AsyncSession) -> str:
    """Count records across all entities."""
    lines = ["Record counts:", ""]
    for table in tables:
        try:
            _safe_identifier(table)
            result = await db.execute(text(
                f"SELECT COUNT(*) FROM {schema}.{table} WHERE deleted_at IS NULL"
            ))
            count = result.scalar() or 0
            display = table.replace("_", " ").title()
            lines.append(f"  {display}: {count}")
        except Exception:
            pass
    return "\n".join(lines)


async def _list_entity(schema: str, entity: str, cmd: str, db: AsyncSession) -> str:
    """List recent records for an entity."""
    _safe_identifier(entity)
    columns = await _get_table_columns(schema, entity, db)
    name_col = _find_name_column(columns)
    time_filter = _time_filter_sql(cmd)
    display = entity.replace("_", " ").title()

    if name_col:
        result = await db.execute(text(
            f"SELECT {name_col}, created_at FROM {schema}.{entity} "
            f"WHERE deleted_at IS NULL {time_filter} "
            f"ORDER BY created_at DESC LIMIT 10"
        ))
    else:
        result = await db.execute(text(
            f"SELECT id, created_at FROM {schema}.{entity} "
            f"WHERE deleted_at IS NULL {time_filter} "
            f"ORDER BY created_at DESC LIMIT 10"
        ))

    rows = result.fetchall()
    if not rows:
        return f"No {display} records found."

    lines = [f"Recent {display} ({len(rows)} shown):", ""]
    for r in rows:
        label = r[0] if r[0] else "(unnamed)"
        ts = r[1].strftime("%m/%d %H:%M") if r[1] else ""
        lines.append(f"  - {label}  ({ts})")

    return "\n".join(lines)


async def _find_overdue(
    schema: str, entity: Optional[str], tables: list[str], db: AsyncSession
) -> str:
    """Find overdue records (past due date)."""
    target_tables = [entity] if entity else tables
    lines = ["Overdue Items:", ""]
    found_any = False

    for table in target_tables:
        columns = await _get_table_columns(schema, table, db)
        date_cols = _find_date_columns(columns)
        name_col = _find_name_column(columns)

        for dcol in date_cols:
            if any(kw in dcol for kw in ["due", "deadline", "end", "expir"]):
                try:
                    select_col = name_col if name_col else "id"
                    result = await db.execute(text(
                        f"SELECT {select_col}, {dcol} FROM {schema}.{table} "
                        f"WHERE deleted_at IS NULL AND {dcol} < NOW() "
                        f"ORDER BY {dcol} ASC LIMIT 10"
                    ))
                    rows = result.fetchall()
                    if rows:
                        found_any = True
                        display = table.replace("_", " ").title()
                        lines.append(f"{display} (overdue by {dcol}):")
                        for r in rows:
                            lines.append(f"  - {r[0]} (due: {r[1]})")
                        lines.append("")
                except Exception:
                    pass

    if not found_any:
        return "No overdue items found."

    return "\n".join(lines)


def _format_number(value, col_name: str) -> str:
    """Format a number, using currency format for money-like columns."""
    if value is None:
        return "N/A"
    money_keywords = ("price", "amount", "total", "revenue", "income", "cost", "fee", "payment", "charge", "value", "subtotal")
    if any(kw in col_name.lower() for kw in money_keywords):
        return f"${float(value):,.2f}"
    return f"{float(value):,.2f}"
