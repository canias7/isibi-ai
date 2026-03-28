from __future__ import annotations

"""
Webhook Support — manage webhooks for project events.
"""

import ipaddress
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from auth import get_current_org_id
from db import get_db
from models.webhook import Webhook

router = APIRouter(tags=["webhooks"])


# ── Schemas ──────────────────────────────────────────────────────────────────

_BLOCKED_HOSTS = {
    "localhost", "127.0.0.1", "::1", "0.0.0.0",
    "169.254.169.254", "metadata.google.internal",
    "metadata.google", "metadata",
}


def _validate_webhook_url(url: str) -> None:
    """Reject URLs targeting private/internal networks (SSRF protection)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Webhook URL must use http or https")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid webhook URL")
    hostname = parsed.hostname.lower()
    if hostname in _BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Webhook URL must not target localhost or metadata endpoints")
    # Reject internal-looking hostnames
    if hostname.endswith(".internal") or hostname.endswith(".local"):
        raise HTTPException(status_code=400, detail="Webhook URL must not target internal hosts")
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=400, detail="Webhook URL must not target private IP ranges")
    except ValueError:
        # hostname is a domain — resolve and check the IP
        import socket
        try:
            resolved = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            for family, _, _, _, sockaddr in resolved:
                resolved_ip = ipaddress.ip_address(sockaddr[0])
                if resolved_ip.is_private or resolved_ip.is_loopback or resolved_ip.is_link_local or resolved_ip.is_reserved:
                    raise HTTPException(status_code=400, detail="Webhook URL resolves to a private IP address")
        except socket.gaierror:
            raise HTTPException(status_code=400, detail="Webhook URL hostname could not be resolved")


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
    _validate_webhook_url(body.url)
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
        _validate_webhook_url(body.url)
        webhook.url = body.url
    if body.events is not None:
        webhook.events = body.events
    if body.is_active is not None:
        webhook.is_active = body.is_active

    webhook.updated_at = datetime.now(timezone.utc)
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

    # Re-validate URL before sending (in case it was changed externally)
    _validate_webhook_url(webhook.url)

    test_payload = {
        "event": "test",
        "project_id": project_id,
        "webhook_id": webhook_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {"message": "This is a test webhook delivery from isibi.ai"},
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=3.0)) as client:
            response = await client.post(
                webhook.url,
                json=test_payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Secret": webhook.secret,
                    "X-Webhook-Event": "test",
                },
            )
        webhook.last_triggered_at = datetime.now(timezone.utc)
        await db.commit()
        return {
            "detail": "Test webhook sent",
            "status_code": response.status_code,
            "success": 200 <= response.status_code < 300,
        }
    except Exception as exc:
        logger.warning("Webhook test failed for %s: %s", webhook_id, exc)
        webhook.failure_count = (webhook.failure_count or 0) + 1
        await db.commit()
        return {
            "detail": "Test webhook failed",
            "success": False,
        }
