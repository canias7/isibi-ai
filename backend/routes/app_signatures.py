from __future__ import annotations
"""
Signature Capture — save and retrieve signature images as base64 PNG data URLs.

Routes:
  POST /api/apps/{project_id}/signatures/{table}/{record_id}  — save signature
  GET  /api/apps/{project_id}/signatures/{table}/{record_id}  — get signature
"""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.app_signature import AppSignature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Signatures"])


# ── Schemas ──────────────────────────────────────────────────────────

class SaveSignatureBody(BaseModel):
    signature_data: str  # base64 PNG data URL
    signer_name: Optional[str] = None


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/signatures/{table}/{record_id}", status_code=201)
async def save_signature(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    body: SaveSignatureBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Save a signature for a record. Replaces any existing signature."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    if not body.signature_data:
        raise HTTPException(status_code=400, detail="signature_data is required")

    # Replace existing signature if present
    result = await db.execute(
        select(AppSignature).where(
            AppSignature.project_id == project_id,
            AppSignature.table_name == table,
            AppSignature.record_id == record_id,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.signature_data = body.signature_data
        existing.signer_name = body.signer_name
        await db.commit()
        await db.refresh(existing)
        sig = existing
    else:
        sig = AppSignature(
            project_id=project_id,
            table_name=table,
            record_id=record_id,
            signature_data=body.signature_data,
            signer_name=body.signer_name,
        )
        db.add(sig)
        await db.commit()
        await db.refresh(sig)

    return {
        "id": str(sig.id),
        "table_name": sig.table_name,
        "record_id": sig.record_id,
        "signer_name": sig.signer_name,
        "signed_at": sig.signed_at.isoformat() if sig.signed_at else None,
    }


@router.get("/{project_id}/signatures/{table}/{record_id}")
async def get_signature(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the signature image for a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppSignature).where(
            AppSignature.project_id == project_id,
            AppSignature.table_name == table,
            AppSignature.record_id == record_id,
        )
    )
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail="No signature found for this record")

    return {
        "id": str(sig.id),
        "table_name": sig.table_name,
        "record_id": sig.record_id,
        "signature_data": sig.signature_data,
        "signer_name": sig.signer_name,
        "signed_at": sig.signed_at.isoformat() if sig.signed_at else None,
    }
