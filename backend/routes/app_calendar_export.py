from __future__ import annotations

"""
Calendar Export — generate .ics (iCalendar) files from entity records.

Allows users to export records with date fields into a standard .ics file
that can be imported into Google Calendar, Apple Calendar, Outlook, etc.

Route:
  GET /api/apps/{project_id}/calendar/{table}/ics
"""

import re
import uuid
import logging
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL, get_db
from auth import get_current_org_id
from generator.app_db import get_schema_name, _get_raw_connection, list_schema_tables
from generator.orchestrator import _get_project
from utils.sanitize import sanitize_sql_identifier

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["Calendar Export"])

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

# Column types that represent dates/datetimes
_DATE_TYPES = {
    "date",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone",
    "timestamptz",
}

# Column names likely to hold a title/name for the event summary
_NAME_FIELDS = ["name", "title", "subject", "summary", "label", "event_name"]


def _escape_ics(text: str) -> str:
    """Escape special characters for iCalendar text values."""
    if not text:
        return ""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _format_ics_date(val) -> str | None:
    """Format a date or datetime value as an iCalendar DTSTART value."""
    if isinstance(val, datetime):
        return val.strftime("%Y%m%dT%H%M%SZ")
    if isinstance(val, date):
        return val.strftime("%Y%m%d")
    if isinstance(val, str):
        # Try parsing common formats
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                dt = datetime.strptime(val.replace("+00:00", "+0000"), fmt)
                if "T" in val:
                    return dt.strftime("%Y%m%dT%H%M%SZ")
                return dt.strftime("%Y%m%d")
            except ValueError:
                continue
    return None


def _validate_identifier(name: str, label: str = "identifier") -> str:
    clean = name.strip().lower()
    if not _IDENT_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    try:
        sanitize_sql_identifier(clean)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {name}")
    return clean


@router.get("/{project_id}/calendar/{table}/ics")
async def export_calendar_ics(
    project_id: uuid.UUID,
    table: str,
    date_field: str = Query(None, description="Specific date column to use; auto-detected if omitted"),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """
    Generate an .ics (iCalendar) file from entity records that have date fields.

    Scans the entity's columns for date/datetime types, creates VEVENT entries
    for each record, and returns a downloadable .ics file.
    """
    await _get_project(db, project_id, org_id)

    table_name = _validate_identifier(table, "table name")
    schema = get_schema_name(str(project_id))

    # Verify the table exists
    tables = await list_schema_tables(str(project_id), DATABASE_URL)
    if table_name not in tables:
        raise HTTPException(
            status_code=404,
            detail=f"Table '{table_name}' not found. Available: {', '.join(tables) or '(none)'}",
        )

    conn = await _get_raw_connection(DATABASE_URL)
    try:
        # Discover columns and their types
        columns = await conn.fetch(
            "SELECT column_name, data_type "
            "FROM information_schema.columns "
            "WHERE table_schema = $1 AND table_name = $2 "
            "ORDER BY ordinal_position",
            schema,
            table_name,
        )

        col_map = {c["column_name"]: c["data_type"] for c in columns}

        # Find date columns
        date_columns = [
            col for col, dtype in col_map.items()
            if dtype.lower() in _DATE_TYPES
        ]

        if date_field:
            safe_date_field = _validate_identifier(date_field, "date field")
            if safe_date_field not in date_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{date_field}' is not a date/datetime field. "
                           f"Date columns: {', '.join(date_columns) or '(none)'}",
                )
            chosen_date_field = safe_date_field
        else:
            if not date_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Table '{table_name}' has no date/datetime columns. "
                           f"Cannot generate calendar export.",
                )
            # Prefer columns with suggestive names
            preferred = [c for c in date_columns if c in (
                "date", "start_date", "due_date", "event_date", "scheduled_at",
                "starts_at", "deadline", "appointment_date",
            )]
            chosen_date_field = preferred[0] if preferred else date_columns[0]

        # Find the name/title column for SUMMARY
        name_field = None
        for candidate in _NAME_FIELDS:
            if candidate in col_map:
                name_field = candidate
                break
        # Fallback: first text/varchar column that isn't id or date
        if not name_field:
            for col, dtype in col_map.items():
                if col in ("id", "deleted_at", "created_at", "updated_at", chosen_date_field):
                    continue
                if "char" in dtype.lower() or dtype.lower() == "text":
                    name_field = col
                    break

        # Identify description columns (other text columns)
        skip_cols = {"id", "deleted_at", "created_at", "updated_at", chosen_date_field, name_field}
        desc_columns = [
            col for col, dtype in col_map.items()
            if col not in skip_cols
            and ("char" in dtype.lower() or dtype.lower() == "text")
        ]

        # Fetch all non-deleted records
        await conn.execute(f'SET search_path TO "{schema}"')
        rows = await conn.fetch(
            f'SELECT * FROM "{table_name}" WHERE "deleted_at" IS NULL '
            f'ORDER BY "{chosen_date_field}" ASC NULLS LAST'
        )

        # Build the iCalendar output
        app_name = table_name.replace("_", " ").title()
        cal_lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            f"PRODID:-//isibi.ai//{app_name}//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            f"X-WR-CALNAME:{_escape_ics(app_name)}",
        ]

        event_count = 0
        for row in rows:
            row_dict = dict(row)
            date_val = row_dict.get(chosen_date_field)
            if date_val is None:
                continue

            ics_date = _format_ics_date(date_val)
            if not ics_date:
                continue

            event_count += 1

            # Build SUMMARY from name field
            summary = ""
            if name_field and row_dict.get(name_field):
                summary = str(row_dict[name_field])
            else:
                summary = f"{app_name} #{event_count}"

            # Build DESCRIPTION from other text fields
            desc_parts = []
            for dc in desc_columns:
                val = row_dict.get(dc)
                if val is not None and str(val).strip():
                    label = dc.replace("_", " ").title()
                    desc_parts.append(f"{label}: {val}")
            description = " | ".join(desc_parts)

            # Unique ID for the event
            row_id = row_dict.get("id", str(uuid.uuid4()))
            uid = f"{row_id}@{project_id}.isibi.ai"

            cal_lines.extend([
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTART:{ics_date}",
                f"SUMMARY:{_escape_ics(summary)}",
            ])
            if description:
                cal_lines.append(f"DESCRIPTION:{_escape_ics(description)}")
            cal_lines.append("END:VEVENT")

        cal_lines.append("END:VCALENDAR")

        ics_content = "\r\n".join(cal_lines) + "\r\n"

        filename = f"{table_name}_calendar.ics"
        return Response(
            content=ics_content,
            media_type="text/calendar",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    finally:
        await conn.close()
