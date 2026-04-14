from __future__ import annotations

"""
Custom Domains routes — let users map their own domains to deployed apps.

Endpoints:
  POST   /api/projects/{project_id}/domains                     — add custom domain
  GET    /api/projects/{project_id}/domains                     — list domains
  DELETE /api/projects/{project_id}/domains/{domain_id}          — remove domain
  POST   /api/projects/{project_id}/domains/{domain_id}/verify   — verify DNS
"""

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import dns.resolver
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from models.custom_domain import CustomDomain

router = APIRouter(prefix="/projects", tags=["custom-domains"])

# The CNAME target that users should point their domain at.
CNAME_TARGET = os.getenv("CNAME_TARGET", "apps.isibi.ai")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class AddDomainRequest(BaseModel):
    domain: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{project_id}/domains")
async def add_domain(
    project_id: str,
    body: AddDomainRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Register a custom domain for a project and return DNS instructions."""
    pid = uuid.UUID(project_id)

    # Verify the project belongs to this org
    result = await db.execute(
        select(Project).where(
            Project.id == pid,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    domain_name = body.domain.strip().lower()

    # Check uniqueness
    result = await db.execute(
        select(CustomDomain).where(CustomDomain.domain == domain_name)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Domain is already registered",
        )

    custom_domain = CustomDomain(
        project_id=pid,
        org_id=org_id,
        domain=domain_name,
        status="pending",
    )
    db.add(custom_domain)
    await db.commit()
    await db.refresh(custom_domain)

    return {
        "id": str(custom_domain.id),
        "domain": custom_domain.domain,
        "status": custom_domain.status,
        "dns_instructions": {
            "type": "CNAME",
            "name": domain_name,
            "value": CNAME_TARGET,
            "note": (
                f"Add a CNAME record pointing {domain_name} to {CNAME_TARGET}. "
                "Then call the verify endpoint to confirm."
            ),
        },
        "created_at": custom_domain.created_at.isoformat(),
    }


@router.get("/{project_id}/domains")
async def list_domains(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all custom domains for a project."""
    pid = uuid.UUID(project_id)

    result = await db.execute(
        select(CustomDomain).where(
            CustomDomain.project_id == pid,
            CustomDomain.org_id == org_id,
        )
    )
    domains = result.scalars().all()

    return [
        {
            "id": str(d.id),
            "domain": d.domain,
            "status": d.status,
            "verified_at": d.verified_at.isoformat() if d.verified_at else None,
            "created_at": d.created_at.isoformat(),
        }
        for d in domains
    ]


@router.delete("/{project_id}/domains/{domain_id}")
async def remove_domain(
    project_id: str,
    domain_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove a custom domain from a project."""
    pid = uuid.UUID(project_id)
    did = uuid.UUID(domain_id)

    result = await db.execute(
        select(CustomDomain).where(
            CustomDomain.id == did,
            CustomDomain.project_id == pid,
            CustomDomain.org_id == org_id,
        )
    )
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found"
        )

    await db.delete(domain)
    await db.commit()

    return {"detail": "Domain removed"}


@router.post("/{project_id}/domains/{domain_id}/verify")
async def verify_domain(
    project_id: str,
    domain_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Check DNS records for the domain and update its status."""
    pid = uuid.UUID(project_id)
    did = uuid.UUID(domain_id)

    result = await db.execute(
        select(CustomDomain).where(
            CustomDomain.id == did,
            CustomDomain.project_id == pid,
            CustomDomain.org_id == org_id,
        )
    )
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found"
        )

    # Perform DNS lookup
    verified = False
    try:
        answers = dns.resolver.resolve(domain.domain, "CNAME")
        for rdata in answers:
            target = str(rdata.target).rstrip(".")
            if target.lower() == CNAME_TARGET.lower():
                verified = True
                break
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
        verified = False
    except Exception as exc:
        logger.warning("DNS verification failed for %s: %s", domain.domain, exc)
        verified = False

    if verified:
        domain.status = "verified"
        domain.verified_at = datetime.now(timezone.utc)
    else:
        domain.status = "failed"

    await db.commit()
    await db.refresh(domain)

    return {
        "id": str(domain.id),
        "domain": domain.domain,
        "status": domain.status,
        "verified_at": domain.verified_at.isoformat() if domain.verified_at else None,
        "dns_expected": {
            "type": "CNAME",
            "value": CNAME_TARGET,
        },
    }
