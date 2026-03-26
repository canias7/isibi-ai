from __future__ import annotations

"""
Webhook Triggers UI Config — let developers configure webhook triggers for their generated apps.
"""

import uuid
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_webhook_trigger import AppWebhookTrigger

router = APIRouter(tags=["app-webhook-triggers"])

VALID_EVENTS = {"record_created", "record_updated", "field_changed", "record_deleted"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class WebhookTriggerCreateBody(BaseModel):
    name: str
    event: str
    entity: str
    url: str
    headers: Optional[dict[str, str]] = None
    enabled: bool = True


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(trigger: AppWebhookTrigger) -> dict:
    return {
        "id": str(trigger.id),
        "project_id": str(trigger.project_id),
        "org_id": str(trigger.org_id),
        "name": trigger.name,
        "event": trigger.event,
        "entity": trigger.entity,
        "url": trigger.url,
        "headers": trigger.headers or {},
        "enabled": trigger.enabled,
        "last_triggered_at": trigger.last_triggered_at.isoformat() if trigger.last_triggered_at else None,
        "failure_count": trigger.failure_count,
        "created_at": trigger.created_at.isoformat() if trigger.created_at else None,
        "updated_at": trigger.updated_at.isoformat() if trigger.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/webhook-triggers")
async def list_webhook_triggers(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all webhook triggers for a project."""
    result = await db.execute(
        select(AppWebhookTrigger).where(
            AppWebhookTrigger.project_id == uuid.UUID(project_id),
            AppWebhookTrigger.org_id == org_id,
        ).order_by(AppWebhookTrigger.created_at.desc())
    )
    triggers = result.scalars().all()
    return {"items": [_serialize(t) for t in triggers]}


@router.post("/projects/{project_id}/webhook-triggers", status_code=status.HTTP_201_CREATED)
async def create_webhook_trigger(
    project_id: str,
    body: WebhookTriggerCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new webhook trigger."""
    if body.event not in VALID_EVENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid event '{body.event}'. Must be one of: {', '.join(sorted(VALID_EVENTS))}",
        )

    trigger = AppWebhookTrigger(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        event=body.event,
        entity=body.entity,
        url=body.url,
        headers=body.headers or {},
        enabled=body.enabled,
    )
    db.add(trigger)
    await db.commit()
    await db.refresh(trigger)
    return _serialize(trigger)


@router.delete("/projects/{project_id}/webhook-triggers/{trigger_id}")
async def delete_webhook_trigger(
    project_id: str,
    trigger_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a webhook trigger."""
    result = await db.execute(
        select(AppWebhookTrigger).where(
            AppWebhookTrigger.id == uuid.UUID(trigger_id),
            AppWebhookTrigger.project_id == uuid.UUID(project_id),
            AppWebhookTrigger.org_id == org_id,
        )
    )
    trigger = result.scalar_one_or_none()
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook trigger not found")

    await db.delete(trigger)
    await db.commit()
    return {"detail": "Webhook trigger deleted"}


@router.post("/projects/{project_id}/webhook-triggers/{trigger_id}/test")
async def test_webhook_trigger(
    project_id: str,
    trigger_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a test payload to the webhook trigger URL."""
    result = await db.execute(
        select(AppWebhookTrigger).where(
            AppWebhookTrigger.id == uuid.UUID(trigger_id),
            AppWebhookTrigger.project_id == uuid.UUID(project_id),
            AppWebhookTrigger.org_id == org_id,
        )
    )
    trigger = result.scalar_one_or_none()
    if not trigger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook trigger not found")

    test_payload = {
        "event": trigger.event,
        "entity": trigger.entity,
        "project_id": project_id,
        "trigger_id": str(trigger.id),
        "timestamp": datetime.utcnow().isoformat(),
        "data": {
            "message": "This is a test webhook delivery from isibi.ai",
            "record": {"id": "sample-record-id", "name": "Sample Record"},
        },
    }

    request_headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": trigger.event,
        "X-Webhook-Entity": trigger.entity,
    }
    # Merge custom headers
    if trigger.headers:
        request_headers.update(trigger.headers)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                trigger.url,
                json=test_payload,
                headers=request_headers,
            )
        trigger.last_triggered_at = datetime.utcnow()
        await db.commit()
        return {
            "detail": "Test webhook sent",
            "status_code": response.status_code,
            "success": 200 <= response.status_code < 300,
        }
    except Exception as exc:
        trigger.failure_count = (trigger.failure_count or 0) + 1
        await db.commit()
        return {
            "detail": "Test webhook failed",
            "error": str(exc),
            "success": False,
        }
