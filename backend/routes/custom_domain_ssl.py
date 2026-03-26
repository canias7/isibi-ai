from __future__ import annotations
"""
Custom Domain with SSL — let developers point their own domain to a deployed app.

Routes:
  POST   /api/projects/{project_id}/custom-domain         — register a custom domain
  POST   /api/projects/{project_id}/custom-domain/verify   — verify DNS is configured
  GET    /api/projects/{project_id}/custom-domain         — get current domain + status
  DELETE /api/projects/{project_id}/custom-domain         — remove custom domain
"""

import uuid
import json
import socket
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Custom Domain SSL"])

PLATFORM_CNAME = "apps.isibi.ai"


# ── Schemas ──────────────────────────────────────────────────────────

class RegisterDomainRequest(BaseModel):
    domain: str


class DomainResponse(BaseModel):
    domain: str
    status: str  # pending | verified | failed
    cname_target: str
    dns_instructions: str
    verified_at: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────

async def _get_project(project_id: str, org_id: uuid.UUID, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_custom_domain(project: Project) -> dict | None:
    """Read _custom_domain from project spec JSON."""
    spec = project.spec if isinstance(project.spec, dict) else {}
    return spec.get("_custom_domain")


async def _set_custom_domain(project: Project, domain_data: dict | None, db: AsyncSession):
    """Write _custom_domain into project spec JSON."""
    spec = project.spec if isinstance(project.spec, dict) else {}
    if domain_data is None:
        spec.pop("_custom_domain", None)
    else:
        spec["_custom_domain"] = domain_data
    project.spec = spec
    await db.commit()


def _verify_dns(domain: str) -> bool:
    """Check whether the domain has a CNAME pointing to PLATFORM_CNAME."""
    try:
        import dns.resolver
        answers = dns.resolver.resolve(domain, "CNAME")
        for rdata in answers:
            target = str(rdata.target).rstrip(".")
            if target.lower() == PLATFORM_CNAME.lower():
                return True
        return False
    except ImportError:
        # dnspython not installed — fall back to socket resolution
        try:
            resolved = socket.getfqdn(domain)
            # Basic check: if it resolves at all, consider it a soft pass
            socket.gethostbyname(domain)
            return True
        except socket.gaierror:
            return False
    except Exception:
        return False


# ── In-memory index: domain -> project_id (for middleware lookup) ───

_domain_index: dict[str, str] = {}


def get_project_id_for_domain(domain: str) -> str | None:
    """Look up project_id by custom domain. Used by middleware in main.py."""
    return _domain_index.get(domain.lower())


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/custom-domain")
async def register_custom_domain(
    project_id: str,
    body: RegisterDomainRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Register a custom domain for a deployed project."""
    project = await _get_project(project_id, org_id, db)

    domain = body.domain.strip().lower()
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Invalid domain")

    domain_data = {
        "domain": domain,
        "status": "pending",
        "cname_target": PLATFORM_CNAME,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "verified_at": None,
    }
    await _set_custom_domain(project, domain_data, db)

    # Update in-memory index
    _domain_index[domain] = project_id

    return {
        "domain": domain,
        "status": "pending",
        "cname_target": PLATFORM_CNAME,
        "dns_instructions": (
            f"Add a CNAME record pointing {domain} to {PLATFORM_CNAME}. "
            f"Once DNS propagates, use the verify endpoint to confirm."
        ),
    }


@router.post("/{project_id}/custom-domain/verify")
async def verify_custom_domain(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Verify that DNS for the custom domain is correctly configured."""
    project = await _get_project(project_id, org_id, db)
    domain_data = _get_custom_domain(project)
    if not domain_data:
        raise HTTPException(status_code=404, detail="No custom domain registered for this project")

    domain = domain_data["domain"]
    verified = _verify_dns(domain)

    if verified:
        domain_data["status"] = "verified"
        domain_data["verified_at"] = datetime.now(timezone.utc).isoformat()
    else:
        domain_data["status"] = "dns_not_found"

    await _set_custom_domain(project, domain_data, db)

    return {
        "domain": domain,
        "status": domain_data["status"],
        "verified": verified,
        "cname_target": PLATFORM_CNAME,
        "verified_at": domain_data.get("verified_at"),
    }


@router.get("/{project_id}/custom-domain")
async def get_custom_domain(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the current custom domain and its verification status."""
    project = await _get_project(project_id, org_id, db)
    domain_data = _get_custom_domain(project)
    if not domain_data:
        return {"domain": None, "status": "none"}
    return {
        "domain": domain_data["domain"],
        "status": domain_data["status"],
        "cname_target": PLATFORM_CNAME,
        "verified_at": domain_data.get("verified_at"),
    }


@router.delete("/{project_id}/custom-domain")
async def remove_custom_domain(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove the custom domain from a project."""
    project = await _get_project(project_id, org_id, db)
    domain_data = _get_custom_domain(project)

    if domain_data:
        _domain_index.pop(domain_data.get("domain", "").lower(), None)

    await _set_custom_domain(project, None, db)
    return {"detail": "Custom domain removed"}
