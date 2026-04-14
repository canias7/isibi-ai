from __future__ import annotations

"""
App Integrations — google_calendar, slack, quickbooks, mailchimp,
whatsapp, zoom, docusign, twilio_voice.
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_integration import AppIntegration

logger = logging.getLogger(__name__)

router = APIRouter(tags=["app-integrations"])

VALID_TYPES = {
    "google_calendar",
    "slack",
    "quickbooks",
    "mailchimp",
    "whatsapp",
    "zoom",
    "docusign",
    "twilio_voice",
}

# Required config keys per integration type
REQUIRED_CONFIG = {
    "google_calendar": ["calendar_id"],
    "slack": ["webhook_url"],
    "quickbooks": ["client_id"],
    "mailchimp": ["api_key", "list_id"],
    "whatsapp": ["api_key"],
    "zoom": ["client_id"],
    "docusign": ["api_key", "template_id"],
    "twilio_voice": ["account_sid", "auth_token", "from_number"],
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class IntegrationCreateBody(BaseModel):
    type: str
    config: dict
    enabled: bool = True


class IntegrationUpdateBody(BaseModel):
    config: Optional[dict] = None
    enabled: Optional[bool] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(integ: AppIntegration) -> dict:
    return {
        "id": str(integ.id),
        "project_id": str(integ.project_id),
        "org_id": str(integ.org_id),
        "type": integ.type,
        "config": integ.config,
        "enabled": integ.enabled,
        "created_at": integ.created_at.isoformat() if integ.created_at else None,
    }


def _validate_config(integration_type: str, config: dict) -> None:
    """Validate that required config keys are present."""
    required = REQUIRED_CONFIG.get(integration_type, [])
    missing = [k for k in required if k not in config]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required config keys for {integration_type}: {', '.join(missing)}",
        )


def _test_integration(integration_type: str, config: dict) -> dict:
    """
    Test an integration connection.
    In production this would make real API calls; here we validate config
    and return a simulated result.
    """
    required = REQUIRED_CONFIG.get(integration_type, [])
    missing = [k for k in required if k not in config]
    if missing:
        return {"success": False, "error": f"Missing config keys: {', '.join(missing)}"}

    # Type-specific validation
    if integration_type == "slack":
        webhook = config.get("webhook_url", "")
        if not webhook.startswith("https://hooks.slack.com/"):
            return {"success": False, "error": "Invalid Slack webhook URL"}

    if integration_type == "twilio_voice":
        phone = config.get("from_number", "")
        if not phone.startswith("+"):
            return {"success": False, "error": "from_number must start with +"}

    return {"success": True, "message": f"{integration_type} connection validated"}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/integrations")
async def list_integrations(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all integrations for a project."""
    result = await db.execute(
        select(AppIntegration).where(
            AppIntegration.project_id == uuid.UUID(project_id),
            AppIntegration.org_id == org_id,
        ).order_by(AppIntegration.created_at.desc())
    )
    integrations = result.scalars().all()
    return {"items": [_serialize(i) for i in integrations]}


@router.post("/projects/{project_id}/integrations", status_code=status.HTTP_201_CREATED)
async def create_integration(
    project_id: str,
    body: IntegrationCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a new integration."""
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid integration type '{body.type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}",
        )

    _validate_config(body.type, body.config)

    integ = AppIntegration(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        type=body.type,
        config=body.config,
        enabled=body.enabled,
    )
    db.add(integ)
    await db.commit()
    await db.refresh(integ)
    return _serialize(integ)


@router.put("/projects/{project_id}/integrations/{integration_id}")
async def update_integration(
    project_id: str,
    integration_id: str,
    body: IntegrationUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update an integration's config or enabled state."""
    result = await db.execute(
        select(AppIntegration).where(
            AppIntegration.id == uuid.UUID(integration_id),
            AppIntegration.project_id == uuid.UUID(project_id),
            AppIntegration.org_id == org_id,
        )
    )
    integ = result.scalar_one_or_none()
    if not integ:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.config is not None:
        _validate_config(integ.type, body.config)
        integ.config = body.config
    if body.enabled is not None:
        integ.enabled = body.enabled

    await db.commit()
    await db.refresh(integ)
    return _serialize(integ)


@router.delete("/projects/{project_id}/integrations/{integration_id}")
async def delete_integration(
    project_id: str,
    integration_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove an integration."""
    result = await db.execute(
        select(AppIntegration).where(
            AppIntegration.id == uuid.UUID(integration_id),
            AppIntegration.project_id == uuid.UUID(project_id),
            AppIntegration.org_id == org_id,
        )
    )
    integ = result.scalar_one_or_none()
    if not integ:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    await db.delete(integ)
    await db.commit()
    return {"detail": "Integration deleted"}


@router.post("/projects/{project_id}/integrations/{integration_id}/test")
async def test_integration(
    project_id: str,
    integration_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Test an integration connection."""
    result = await db.execute(
        select(AppIntegration).where(
            AppIntegration.id == uuid.UUID(integration_id),
            AppIntegration.project_id == uuid.UUID(project_id),
            AppIntegration.org_id == org_id,
        )
    )
    integ = result.scalar_one_or_none()
    if not integ:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    test_result = _test_integration(integ.type, integ.config)
    return {"integration_id": str(integ.id), "type": integ.type, **test_result}
