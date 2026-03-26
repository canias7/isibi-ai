from __future__ import annotations
"""
File Upload Fields — upload/get/delete files attached to specific record fields.

Routes:
  POST   /api/apps/{project_id}/field-files/{table}/{record_id}/{field_name}  — upload
  GET    /api/apps/{project_id}/field-files/{table}/{record_id}/{field_name}  — get URL
  DELETE /api/apps/{project_id}/field-files/{table}/{record_id}/{field_name}  — remove
"""

import os
import uuid
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.app_field_file import AppFieldFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Field Files"])

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")))
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/field-files/{table}/{record_id}/{field_name}", status_code=201)
async def upload_field_file(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    field_name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Upload a file for a specific field on a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    content = await file.read()
    file_size = len(content)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Remove any existing file for this field
    existing = await db.execute(
        select(AppFieldFile).where(
            AppFieldFile.project_id == project_id,
            AppFieldFile.table_name == table,
            AppFieldFile.record_id == record_id,
            AppFieldFile.field_name == field_name,
        )
    )
    old = existing.scalar_one_or_none()
    if old:
        old_path = UPLOADS_DIR / str(project_id) / "field-files" / old.file_url.lstrip("/uploads/")
        if old_path.exists():
            old_path.unlink(missing_ok=True)
        await db.execute(
            sa_delete(AppFieldFile).where(AppFieldFile.id == old.id)
        )

    # Save new file
    file_id = uuid.uuid4()
    ext = Path(file.filename).suffix
    safe_name = f"{file_id}{ext}"
    file_dir = UPLOADS_DIR / str(project_id) / "field-files" / table / record_id
    file_dir.mkdir(parents=True, exist_ok=True)

    file_path = file_dir / safe_name
    with open(file_path, "wb") as f:
        f.write(content)

    file_key = f"{project_id}/field-files/{table}/{record_id}/{safe_name}"
    file_url = f"/uploads/{file_key}"

    record = AppFieldFile(
        id=file_id,
        project_id=project_id,
        table_name=table,
        record_id=record_id,
        field_name=field_name,
        file_url=file_url,
        file_name=file.filename,
        file_type=file.content_type or "application/octet-stream",
        file_size=file_size,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "id": str(record.id),
        "field_name": record.field_name,
        "file_name": record.file_name,
        "file_url": record.file_url,
        "file_type": record.file_type,
        "file_size": record.file_size,
    }


@router.get("/{project_id}/field-files/{table}/{record_id}/{field_name}")
async def get_field_file(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    field_name: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the file URL for a specific field on a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppFieldFile).where(
            AppFieldFile.project_id == project_id,
            AppFieldFile.table_name == table,
            AppFieldFile.record_id == record_id,
            AppFieldFile.field_name == field_name,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="No file found for this field")

    return {
        "id": str(record.id),
        "field_name": record.field_name,
        "file_name": record.file_name,
        "file_url": record.file_url,
        "file_type": record.file_type,
        "file_size": record.file_size,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@router.delete("/{project_id}/field-files/{table}/{record_id}/{field_name}")
async def delete_field_file(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    field_name: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Remove the file for a specific field on a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppFieldFile).where(
            AppFieldFile.project_id == project_id,
            AppFieldFile.table_name == table,
            AppFieldFile.record_id == record_id,
            AppFieldFile.field_name == field_name,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="No file found for this field")

    # Delete physical file
    file_path = UPLOADS_DIR / record.file_url.lstrip("/uploads/")
    if file_path.exists():
        file_path.unlink(missing_ok=True)

    await db.execute(
        sa_delete(AppFieldFile).where(AppFieldFile.id == record.id)
    )
    await db.commit()

    return {"deleted": True}
