from __future__ import annotations
"""
Barcode Scanner Config — configure and lookup records by scanned barcode values.

Routes:
  PUT  /api/projects/{project_id}/barcode-config            — configure barcode scanning
  GET  /api/projects/{project_id}/barcode-config            — get config
  POST /api/apps/{project_id}/barcode/lookup                — lookup record by scanned value
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_org_id
from db import get_db
from models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter(tags=["App Barcode"])


# ── Schemas ──────────────────────────────────────────────────────────

class BarcodeConfigBody(BaseModel):
    entity: str
    lookup_field: str
    scan_type: str = "barcode"  # barcode | qrcode


class BarcodeLookupBody(BaseModel):
    value: str


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


# ── Endpoints ────────────────────────────────────────────────────────

@router.put("/projects/{project_id}/barcode-config")
async def update_barcode_config(
    project_id: str,
    body: BarcodeConfigBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Configure which entity/field to search when scanning a barcode."""
    project = await _get_project(project_id, org_id, db)

    spec = dict(project.spec) if project.spec else {}
    spec["_barcode_config"] = body.model_dump()
    project.spec = spec
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {"barcode_config": project.spec.get("_barcode_config", {})}


@router.get("/projects/{project_id}/barcode-config")
async def get_barcode_config(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get barcode scanning configuration."""
    project = await _get_project(project_id, org_id, db)
    config = (project.spec or {}).get("_barcode_config", {})
    return {"barcode_config": config}


@router.post("/apps/{project_id}/barcode/lookup")
async def barcode_lookup(
    project_id: uuid.UUID,
    body: BarcodeLookupBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Lookup records by a scanned barcode/QR value."""
    from generator.orchestrator import _get_project
    proj = await _get_project(db, project_id, org_id)

    config = (proj.spec or {}).get("_barcode_config")
    if not config:
        raise HTTPException(status_code=400, detail="Barcode scanning is not configured for this project")

    entity = config.get("entity", "")
    lookup_field = config.get("lookup_field", "")

    if not entity or not lookup_field:
        raise HTTPException(status_code=400, detail="Barcode config is incomplete (missing entity or lookup_field)")

    # Sanitize table/field names to prevent injection
    safe_table = entity.replace('"', '').replace("'", "").replace(";", "")
    safe_field = lookup_field.replace('"', '').replace("'", "").replace(";", "")

    try:
        result = await db.execute(
            text(f'SELECT * FROM "{safe_table}" WHERE project_id = :pid AND "{safe_field}" = :val LIMIT 20'),
            {"pid": str(project_id), "val": body.value},
        )
        rows = result.mappings().all()

        records = []
        for row in rows:
            row_dict = {}
            for key, value in dict(row).items():
                if isinstance(value, uuid.UUID):
                    row_dict[key] = str(value)
                elif hasattr(value, "isoformat"):
                    row_dict[key] = value.isoformat()
                else:
                    row_dict[key] = value
            records.append(row_dict)

        return {"matches": records, "count": len(records), "lookup_value": body.value}
    except Exception as e:
        logger.warning(f"Barcode lookup failed: {e}")
        raise HTTPException(status_code=400, detail=f"Lookup failed: {str(e)}")
