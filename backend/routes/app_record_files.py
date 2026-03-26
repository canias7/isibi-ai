from __future__ import annotations
"""
Record File Attachments — file uploads on any record in generated apps.

Routes:
  POST   /api/apps/{project_id}/files/{table}/{record_id}            — upload file
  GET    /api/apps/{project_id}/files/{table}/{record_id}            — list files
  DELETE /api/apps/{project_id}/files/{table}/{record_id}/{file_id}  — delete file
"""

import os
import uuid
import logging
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from routes.app_auth import get_current_app_user
from models.app_record_file import AppRecordFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Record Files"])

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")))
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/files/{table}/{record_id}", status_code=201)
async def upload_file(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    file: UploadFile = File(...),
    uploaded_by: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Upload a file attachment to a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    # Read file content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Create directory structure: uploads/{project_id}/{record_id}/
    file_dir = UPLOADS_DIR / str(project_id) / record_id
    file_dir.mkdir(parents=True, exist_ok=True)

    # Generate unique file key to prevent collisions
    file_id = uuid.uuid4()
    ext = Path(file.filename).suffix
    safe_name = f"{file_id}{ext}"
    file_path = file_dir / safe_name

    # Write file
    with open(file_path, "wb") as f:
        f.write(content)

    file_key = f"{project_id}/{record_id}/{safe_name}"
    file_url = f"/uploads/{file_key}"

    record = AppRecordFile(
        id=file_id,
        project_id=project_id,
        table_name=table,
        record_id=record_id,
        file_name=file.filename,
        file_url=file_url,
        file_key=file_key,
        file_type=file.content_type or "application/octet-stream",
        file_size=file_size,
        uploaded_by=uploaded_by,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "id": str(record.id),
        "file_name": record.file_name,
        "file_url": record.file_url,
        "file_type": record.file_type,
        "file_size": record.file_size,
    }


@router.get("/{project_id}/files/{table}/{record_id}")
async def list_files(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List file attachments for a record."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRecordFile)
        .where(
            AppRecordFile.project_id == project_id,
            AppRecordFile.table_name == table,
            AppRecordFile.record_id == record_id,
        )
        .order_by(AppRecordFile.created_at.desc())
    )
    files = result.scalars().all()

    return [
        {
            "id": str(f.id),
            "file_name": f.file_name,
            "file_url": f.file_url,
            "file_type": f.file_type,
            "file_size": f.file_size,
            "uploaded_by": f.uploaded_by,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in files
    ]


@router.delete("/{project_id}/files/{table}/{record_id}/{file_id}")
async def delete_file(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a file attachment."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppRecordFile).where(
            AppRecordFile.id == file_id,
            AppRecordFile.project_id == project_id,
            AppRecordFile.table_name == table,
            AppRecordFile.record_id == record_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    # Delete physical file
    file_path = UPLOADS_DIR / record.file_key
    if file_path.exists():
        file_path.unlink()

    # Delete DB record
    await db.execute(
        sa_delete(AppRecordFile).where(AppRecordFile.id == file_id)
    )
    await db.commit()

    return {"deleted": True}
