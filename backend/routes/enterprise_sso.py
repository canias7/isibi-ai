from __future__ import annotations
"""
Enterprise SSO — SAML/OAuth SSO configuration for enterprise customers.

Routes:
  PUT    /api/org/sso   — configure SSO provider
  GET    /api/org/sso   — get current SSO config
  DELETE /api/org/sso   — disable / remove SSO
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.sso_config import SSOConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/org", tags=["Enterprise SSO"])

SUPPORTED_PROVIDERS = {"okta", "azure_ad", "google_workspace", "onelogin", "custom_saml"}


# ── Schemas ──────────────────────────────────────────────────────────

class SSOConfigRequest(BaseModel):
    provider: str
    entity_id: str
    sso_url: str
    certificate: str
    enabled: bool = True


class SSOConfigResponse(BaseModel):
    id: str
    provider: str
    entity_id: str
    sso_url: str
    certificate_preview: str  # first 40 chars + "..."
    enabled: bool
    created_at: str
    updated_at: str | None = None


# ── Routes ───────────────────────────────────────────────────────────

@router.put("/sso")
async def configure_sso(
    body: SSOConfigRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Configure or update the SSO provider for the organisation."""
    if body.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported provider '{body.provider}'. Supported: {', '.join(sorted(SUPPORTED_PROVIDERS))}",
        )

    if not body.entity_id or not body.sso_url or not body.certificate:
        raise HTTPException(status_code=400, detail="entity_id, sso_url, and certificate are required")

    # Upsert: check if config already exists for this org
    result = await db.execute(
        select(SSOConfig).where(SSOConfig.org_id == org_id)
    )
    existing = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if existing:
        existing.provider = body.provider
        existing.entity_id = body.entity_id
        existing.sso_url = body.sso_url
        existing.certificate = body.certificate
        existing.enabled = body.enabled
        existing.updated_at = now
    else:
        existing = SSOConfig(
            org_id=org_id,
            provider=body.provider,
            entity_id=body.entity_id,
            sso_url=body.sso_url,
            certificate=body.certificate,
            enabled=body.enabled,
        )
        db.add(existing)

    await db.commit()
    await db.refresh(existing)

    return {
        "id": str(existing.id),
        "provider": existing.provider,
        "entity_id": existing.entity_id,
        "sso_url": existing.sso_url,
        "certificate_preview": existing.certificate[:40] + "..." if len(existing.certificate) > 40 else existing.certificate,
        "enabled": existing.enabled,
        "created_at": existing.created_at.isoformat(),
        "updated_at": existing.updated_at.isoformat() if existing.updated_at else None,
        "detail": "SSO configuration saved. Actual SAML flow integration will be wired in a future release.",
    }


@router.get("/sso")
async def get_sso(
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the current SSO configuration for the organisation."""
    result = await db.execute(
        select(SSOConfig).where(SSOConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        return {"configured": False, "provider": None}

    return {
        "configured": True,
        "id": str(config.id),
        "provider": config.provider,
        "entity_id": config.entity_id,
        "sso_url": config.sso_url,
        "certificate_preview": config.certificate[:40] + "..." if len(config.certificate) > 40 else config.certificate,
        "enabled": config.enabled,
        "created_at": config.created_at.isoformat(),
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.delete("/sso")
async def delete_sso(
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Disable and remove SSO configuration for the organisation."""
    result = await db.execute(
        select(SSOConfig).where(SSOConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="No SSO configuration found")

    await db.execute(sa_delete(SSOConfig).where(SSOConfig.org_id == org_id))
    await db.commit()
    return {"detail": "SSO configuration removed"}
