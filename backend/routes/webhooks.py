from __future__ import annotations

"""
Webhook Support — manage webhooks for project events.
"""

import secrets
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
from models.webhook import Webhook

router = APIRouter(tags=["webhooks"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class WebhookCreateBody(BaseModel):
    url: str
    events: list[str] = []


class WebhookUpdateBody(BaseModel):
    url: Optional[str] = None
    events: Optional[list[str]] = None
    is_active: Optional[bool] = None


def _serialize(wh: Webhook) -> dict:
    return {
        "id": str(wh.id),
        "project_id": str(wh.project_id),
        "org_id": str(wh.org_id),
        "url": wh.url,
        "events": wh.events or [],
        "is_active": wh.is_active,
        "last_triggered_at": wh.last_triggered_at.isoformat() if wh.last_triggered_at else None,
        "failure_count": wh.failure_count,
        "created_at": wh.created_at.isoformat() if wh.created_at else None,
        "updated_at": wh.updated_at.isoformat() if wh.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/webhooks")
async def list_webhooks(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all webhooks for a project."""
    result = await db.execute(
        select(Webhook).where(
            Webhook.project_id == uuid.UUID(project_id),
            Webhook.org_id == org_id,
        ).order_by(Webhook.created_at.desc())
    )
    webhooks = result.scalars().all()
    return {"items": [_serialize(wh) for wh in webhooks]}


@router.post("/projects/{project_id}/webhooks", status_code=status.HTTP_201_CREATED)
async def create_webhook(
    project_id: str,
    body: WebhookCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new webhook."""
    webhook = Webhook(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        url=body.url,
        events=body.events,
        secret=secrets.token_hex(32),
        is_active=True,
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)
    return {**_serialize(webhook), "secret": webhook.secret}


@router.patch("/projects/{project_id}/webhooks/{webhook_id}")
async def update_webhook(
    project_id: str,
    webhook_id: str,
    body: WebhookUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a webhook."""
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == uuid.UUID(webhook_id),
            Webhook.project_id == uuid.UUID(project_id),
            Webhook.org_id == org_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    if body.url is not None:
        webhook.url = body.url
    if body.events is not None:
        webhook.events = body.events
    if body.is_active is not None:
        webhook.is_active = body.is_active

    webhook.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(webhook)
    return _serialize(webhook)


@router.delete("/projects/{project_id}/webhooks/{webhook_id}")
async def delete_webhook(
    project_id: str,
    webhook_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a webhook."""
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == uuid.UUID(webhook_id),
            Webhook.project_id == uuid.UUID(project_id),
            Webhook.org_id == org_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    await db.delete(webhook)
    await db.commit()
    return {"detail": "Webhook deleted"}


@router.post("/projects/{project_id}/webhooks/{webhook_id}/test")
async def test_webhook(
    project_id: str,
    webhook_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a test payload to the webhook."""
    result = await db.execute(
        select(Webhook).where(
            Webhook.id == uuid.UUID(webhook_id),
            Webhook.project_id == uuid.UUID(project_id),
            Webhook.org_id == org_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    test_payload = {
        "event": "test",
        "project_id": project_id,
        "webhook_id": webhook_id,
        "timestamp": datetime.utcnow().isoformat(),
        "data": {"message": "This is a test webhook delivery from isibi.ai"},
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                webhook.url,
                json=test_payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Secret": webhook.secret,
                    "X-Webhook-Event": "test",
                },
            )
        webhook.last_triggered_at = datetime.utcnow()
        await db.commit()
        return {
            "detail": "Test webhook sent",
            "status_code": response.status_code,
            "success": 200 <= response.status_code < 300,
        }
    except Exception as exc:
        webhook.failure_count = (webhook.failure_count or 0) + 1
        await db.commit()
        return {
            "detail": "Test webhook failed",
            "error": str(exc),
            "success": False,
        }
