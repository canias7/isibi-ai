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

PLATFORM_CNAME = "isibi-backend.onrender.com"
RENDER_IP = "216.24.57.1"  # Render's static IP for A-record fallback


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


def _verify_dns(domain: str) -> dict:
    """
    Check whether the domain has a CNAME pointing to PLATFORM_CNAME
    or an A record pointing to RENDER_IP.

    Returns {"verified": bool, "method": str, "detail": str}.
    """
    # Try CNAME check first (preferred)
    try:
        import dns.resolver

        # 1. Check CNAME record
        try:
            answers = dns.resolver.resolve(domain, "CNAME")
            for rdata in answers:
                target = str(rdata.target).rstrip(".")
                if target.lower() == PLATFORM_CNAME.lower():
                    return {"verified": True, "method": "CNAME", "detail": f"CNAME points to {PLATFORM_CNAME}"}
            # CNAME exists but points elsewhere
            targets = [str(r.target).rstrip(".") for r in answers]
            return {
                "verified": False,
                "method": "CNAME",
                "detail": f"CNAME points to {', '.join(targets)} instead of {PLATFORM_CNAME}",
            }
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            pass  # No CNAME — try A record
        except dns.resolver.NoNameservers:
            pass

        # 2. Check A record as fallback
        try:
            answers = dns.resolver.resolve(domain, "A")
            ips = [str(rdata.address) for rdata in answers]
            if RENDER_IP in ips:
                return {"verified": True, "method": "A", "detail": f"A record points to {RENDER_IP}"}
            return {
                "verified": False,
                "method": "A",
                "detail": f"A record points to {', '.join(ips)} instead of {RENDER_IP}",
            }
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            return {
                "verified": False,
                "method": "none",
                "detail": (
                    f"DNS not configured yet. Add a CNAME record pointing {domain} "
                    f"to {PLATFORM_CNAME}, or an A record pointing to {RENDER_IP}"
                ),
            }
        except dns.resolver.NoNameservers:
            return {
                "verified": False,
                "method": "none",
                "detail": "DNS servers unreachable. Please try again in a few minutes.",
            }

    except ImportError:
        # dnspython not installed — fall back to socket resolution
        try:
            addr = socket.gethostbyname(domain)
            if addr == RENDER_IP:
                return {"verified": True, "method": "A-socket", "detail": f"Resolves to {RENDER_IP}"}
            # It resolves somewhere — might be correct via CNAME chain
            # Do a best-effort CNAME check via getfqdn
            fqdn = socket.getfqdn(domain)
            if PLATFORM_CNAME.lower() in fqdn.lower():
                return {"verified": True, "method": "CNAME-socket", "detail": f"FQDN matches {PLATFORM_CNAME}"}
            return {
                "verified": False,
                "method": "socket",
                "detail": (
                    f"Domain resolves to {addr} but expected {RENDER_IP}. "
                    f"Add a CNAME record pointing {domain} to {PLATFORM_CNAME}"
                ),
            }
        except socket.gaierror:
            return {
                "verified": False,
                "method": "none",
                "detail": (
                    f"DNS not configured yet. Add a CNAME record pointing {domain} "
                    f"to {PLATFORM_CNAME}, or an A record pointing to {RENDER_IP}"
                ),
            }
    except Exception as exc:
        logger.warning("DNS verification error for %s: %s", domain, exc)
        return {"verified": False, "method": "error", "detail": f"DNS check failed: {exc}"}


# ── In-memory index: domain -> project_id (for middleware lookup) ───

_domain_index: dict[str, str] = {}


def get_project_id_for_domain(domain: str) -> str | None:
    """Look up project_id by custom domain. Used by middleware in main.py."""
    return _domain_index.get(domain.lower())


async def load_verified_domains(db: AsyncSession):
    """Load all verified custom domains into _domain_index on startup."""
    try:
        result = await db.execute(
            select(Project).where(Project.deleted_at.is_(None))
        )
        projects = result.scalars().all()
        count = 0
        for project in projects:
            domain_data = _get_custom_domain(project)
            if domain_data and domain_data.get("status") == "verified":
                _domain_index[domain_data["domain"].lower()] = str(project.id)
                count += 1
        logger.info("Loaded %d verified custom domains into index", count)
    except Exception as exc:
        logger.warning("Failed to load custom domains on startup: %s", exc)


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
        "render_ip": RENDER_IP,
        "dns_instructions": (
            f"Add a CNAME record pointing {domain} to {PLATFORM_CNAME}, "
            f"or an A record pointing to {RENDER_IP}. "
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
    result = _verify_dns(domain)
    verified = result["verified"]

    if verified:
        domain_data["status"] = "verified"
        domain_data["verified_at"] = datetime.now(timezone.utc).isoformat()
        # Update in-memory index so middleware can serve this domain immediately
        _domain_index[domain] = project_id
        logger.info("Custom domain verified: %s -> project %s (method: %s)", domain, project_id, result["method"])
    else:
        domain_data["status"] = "dns_not_found"
        domain_data["verified_at"] = None

    await _set_custom_domain(project, domain_data, db)

    return {
        "domain": domain,
        "status": domain_data["status"],
        "verified": verified,
        "method": result["method"],
        "detail": result["detail"],
        "cname_target": PLATFORM_CNAME,
        "render_ip": RENDER_IP,
        "verified_at": domain_data.get("verified_at"),
        "dns_instructions": (
            f"Option 1: Add a CNAME record pointing {domain} to {PLATFORM_CNAME}\n"
            f"Option 2: Add an A record pointing {domain} to {RENDER_IP}"
        ) if not verified else None,
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
