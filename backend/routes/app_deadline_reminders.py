from __future__ import annotations

"""
Deadline Reminders — scan generated app records for upcoming deadlines
and return notifications based on configurable rules.
"""

import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_deadline_reminder import AppDeadlineReminder
from generator.app_db import get_schema_name, _get_raw_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["app-deadline-reminders"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class DeadlineReminderCreateBody(BaseModel):
    entity: str
    date_field: str
    remind_days_before: int = 2
    notify_field: str
    message_template: str
    enabled: bool = True


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(reminder: AppDeadlineReminder) -> dict:
    return {
        "id": str(reminder.id),
        "project_id": str(reminder.project_id),
        "org_id": str(reminder.org_id),
        "entity": reminder.entity,
        "date_field": reminder.date_field,
        "remind_days_before": reminder.remind_days_before,
        "notify_field": reminder.notify_field,
        "message_template": reminder.message_template,
        "enabled": reminder.enabled,
        "created_at": reminder.created_at.isoformat() if reminder.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/deadline-reminders")
async def list_deadline_reminders(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all deadline reminder rules for a project."""
    result = await db.execute(
        select(AppDeadlineReminder).where(
            AppDeadlineReminder.project_id == uuid.UUID(project_id),
            AppDeadlineReminder.org_id == org_id,
        ).order_by(AppDeadlineReminder.created_at.desc())
    )
    reminders = result.scalars().all()
    return {"items": [_serialize(r) for r in reminders]}


@router.post("/projects/{project_id}/deadline-reminders", status_code=status.HTTP_201_CREATED)
async def create_deadline_reminder(
    project_id: str,
    body: DeadlineReminderCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new deadline reminder rule."""
    if body.remind_days_before < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remind_days_before must be a non-negative integer",
        )

    reminder = AppDeadlineReminder(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        entity=body.entity,
        date_field=body.date_field,
        remind_days_before=body.remind_days_before,
        notify_field=body.notify_field,
        message_template=body.message_template,
        enabled=body.enabled,
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return _serialize(reminder)


@router.delete("/projects/{project_id}/deadline-reminders/{reminder_id}")
async def delete_deadline_reminder(
    project_id: str,
    reminder_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a deadline reminder rule."""
    result = await db.execute(
        select(AppDeadlineReminder).where(
            AppDeadlineReminder.id == uuid.UUID(reminder_id),
            AppDeadlineReminder.project_id == uuid.UUID(project_id),
            AppDeadlineReminder.org_id == org_id,
        )
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deadline reminder not found")

    await db.delete(reminder)
    await db.commit()
    return {"detail": "Deadline reminder deleted"}


@router.post("/projects/{project_id}/deadline-reminders/check")
async def check_deadlines(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan records for upcoming deadlines matching enabled reminder rules.
    Returns a list of upcoming deadline notifications.
    """
    result = await db.execute(
        select(AppDeadlineReminder).where(
            AppDeadlineReminder.project_id == uuid.UUID(project_id),
            AppDeadlineReminder.org_id == org_id,
            AppDeadlineReminder.enabled.is_(True),
        )
    )
    reminders = result.scalars().all()

    if not reminders:
        return {"upcoming": [], "detail": "No enabled deadline reminder rules found"}

    schema = get_schema_name(project_id)
    upcoming = []
    now = datetime.now(timezone.utc)

    for reminder in reminders:
        table = reminder.entity.lower()
        deadline_window = now + timedelta(days=reminder.remind_days_before)

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                rows = await conn.fetch(
                    f'SELECT * FROM "{schema}"."{table}" '
                    f'WHERE "{reminder.date_field}" IS NOT NULL '
                    f'AND "{reminder.date_field}"::date <= $1::date '
                    f'AND "{reminder.date_field}"::date >= $2::date '
                    f'AND "deleted_at" IS NULL '
                    f'ORDER BY "{reminder.date_field}" ASC',
                    deadline_window,
                    now,
                )

                for row in rows:
                    record = dict(row)
                    due_date = record.get(reminder.date_field)
                    if due_date and hasattr(due_date, "date"):
                        days_until = (due_date.date() - now.date()).days
                    elif due_date:
                        days_until = (due_date - now.date()).days
                    else:
                        days_until = 0

                    # Render template
                    message = reminder.message_template
                    message = message.replace("{{days}}", str(days_until))
                    for key, value in record.items():
                        if isinstance(value, (str, int, float)):
                            message = message.replace("{{" + str(key) + "}}", str(value))
                        elif hasattr(value, "isoformat"):
                            message = message.replace("{{" + str(key) + "}}", value.isoformat())

                    # Serialize record values for JSON
                    record_id = record.get("id")
                    notify_to = record.get(reminder.notify_field, "unknown")

                    upcoming.append({
                        "rule_id": str(reminder.id),
                        "entity": reminder.entity,
                        "record_id": str(record_id) if record_id else None,
                        "date_field": reminder.date_field,
                        "due_date": due_date.isoformat() if hasattr(due_date, "isoformat") else str(due_date),
                        "days_until_due": days_until,
                        "notify": str(notify_to),
                        "message": message,
                    })
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Deadline check failed for rule %s: %s", reminder.id, e)
            upcoming.append({
                "rule_id": str(reminder.id),
                "entity": reminder.entity,
                "error": str(e),
            })

    return {"upcoming": upcoming, "total": len(upcoming)}
