from __future__ import annotations

"""
Email Triggers — let developers set up email triggers for their generated apps.
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_email_trigger import AppEmailTrigger

router = APIRouter(tags=["app-email-triggers"])

VALID_EVENTS = {"record_created", "record_updated", "field_changed", "record_deleted"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class EmailTriggerCreateBody(BaseModel):
    name: str
    event: str
    entity: str
    to_field: str
    subject_template: str
    body_template: str

    def validate_event(self) -> None:
        if self.event not in VALID_EVENTS:
            raise ValueError(f"Invalid event '{self.event}'. Must be one of: {', '.join(sorted(VALID_EVENTS))}")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(trigger: AppEmailTrigger) -> dict:
    return {
        "id": str(trigger.id),
        "project_id": str(trigger.project_id),
        "org_id": str(trigger.org_id),
        "name": trigger.name,
        "event": trigger.event,
        "entity": trigger.entity,
        "to_field": trigger.to_field,
        "subject_template": trigger.subject_template,
        "body_template": trigger.body_template,
        "enabled": trigger.enabled,
        "created_at": trigger.created_at.isoformat() if trigger.created_at else None,
        "updated_at": trigger.updated_at.isoformat() if trigger.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/email-triggers")
async def list_email_triggers(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all email triggers for a project."""
    result = await db.execute(
        select(AppEmailTrigger).where(
            AppEmailTrigger.project_id == uuid.UUID(project_id),
            AppEmailTrigger.org_id == org_id,
        ).order_by(AppEmailTrigger.created_at.desc())
    )
    triggers = result.scalars().all()
    return {"items": [_serialize(t) for t in triggers]}


@router.post("/projects/{project_id}/email-triggers", status_code=status.HTTP_201_CREATED)
async def create_email_trigger(
    project_id: str,
    body: EmailTriggerCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new email trigger."""
    if body.event not in VALID_EVENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid event '{body.event}'. Must be one of: {', '.join(sorted(VALID_EVENTS))}",
        )

    trigger = AppEmailTrigger(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        event=body.event,
        entity=body.entity,
        to_field=body.to_field,
        subject_template=body.subject_template,
        body_template=body.body_template,
        enabled=True,
    )
    db.add(trigger)
    await db.commit()
    await db.refresh(trigger)
    return _serialize(trigger)


@router.delete("/projects/{project_id}/email-triggers/{trigger_id}")
async def delete_email_trigger(
    project_id: str,
    trigger_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete an email trigger."""
    result = await db.execute(
        select(AppEmailTrigger).where(
            AppEmailTrigger.id == uuid.UUID(trigger_id),
            AppEmailTrigger.project_id == uuid.UUID(project_id),
            AppEmailTrigger.org_id == org_id,
        )
    )
    trigger = result.scalar_one_or_none()
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email trigger not found")

    await db.delete(trigger)
    await db.commit()
    return {"detail": "Email trigger deleted"}


@router.post("/projects/{project_id}/email-triggers/{trigger_id}/test")
async def test_email_trigger(
    project_id: str,
    trigger_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a test email for this trigger (simulated)."""
    result = await db.execute(
        select(AppEmailTrigger).where(
            AppEmailTrigger.id == uuid.UUID(trigger_id),
            AppEmailTrigger.project_id == uuid.UUID(project_id),
            AppEmailTrigger.org_id == org_id,
        )
    )
    trigger = result.scalar_one_or_none()
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email trigger not found")

    # In production, this would send an actual email via SendGrid/SES/etc.
    # For now, we simulate and return the rendered templates with sample data.
    sample_data = {
        "order_number": "ORD-12345",
        "customer_name": "Jane Doe",
        "customer_email": "jane@example.com",
        "total": "$99.00",
    }

    rendered_subject = trigger.subject_template
    rendered_body = trigger.body_template
    for key, value in sample_data.items():
        rendered_subject = rendered_subject.replace("{{" + key + "}}", value)
        rendered_body = rendered_body.replace("{{" + key + "}}", value)

    return {
        "detail": "Test email simulated",
        "rendered_subject": rendered_subject,
        "rendered_body": rendered_body,
        "to": f"test-recipient@example.com (would use {trigger.to_field} field in production)",
        "success": True,
    }
