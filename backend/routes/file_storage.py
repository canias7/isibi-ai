from __future__ import annotations
"""
File Storage API — upload, list, serve, and delete files for generated apps.

Routes:
  POST   /api/apps/{project_id}/files              — upload a file
  GET    /api/apps/{project_id}/files               — list uploaded files
  DELETE /api/apps/{project_id}/files/{file_id}     — delete a file

Static serving of /uploads/{project_id}/{filename} is handled via
StaticFiles mount in main.py.
"""

import base64
import os
import uuid
import logging
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.file_upload import FileUpload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["File Storage"])

# Base directory for uploaded files (relative to backend/)
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")))

# Max file size: 50 MB
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 50 * 1024 * 1024))


# ── Upload a file ────────────────────────────────────────────────────

@router.post("/{project_id}/files", status_code=201)
async def upload_file(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Upload a file for a generated app. Saves to local disk and records metadata."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Read file content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB",
        )

    # Store file as base64 in the database (cloud-safe, no disk writes)
    file_uuid = uuid.uuid4()
    safe_filename = file.filename.replace("/", "_").replace("\\", "_")
    file_data_b64 = base64.b64encode(content).decode("ascii")
    file_key = f"uploads/{project_id}/{file_uuid}_{safe_filename}"
    file_url = f"/api/files/{file_uuid}"

    # Save metadata + data to database
    record = FileUpload(
        id=file_uuid,
        project_id=project_id,
        org_id=org_id,
        file_name=safe_filename,
        file_key=file_key,
        file_url=file_url,
        file_type=file.content_type,
        file_size=file_size,
        file_data=file_data_b64,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "id": str(record.id),
        "url": record.file_url,
        "file_name": record.file_name,
        "file_type": record.file_type,
        "file_size": record.file_size,
    }


# ── List files ───────────────────────────────────────────────────────

@router.get("/{project_id}/files")
async def list_files(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all uploaded files for a project."""
    result = await db.execute(
        select(FileUpload)
        .where(FileUpload.project_id == project_id, FileUpload.org_id == org_id)
        .order_by(FileUpload.created_at.desc())
    )
    files = result.scalars().all()

    return {
        "files": [
            {
                "id": str(f.id),
                "url": f.file_url,
                "file_name": f.file_name,
                "file_type": f.file_type,
                "file_size": f.file_size,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in files
        ]
    }


# ── Delete a file ────────────────────────────────────────────────────

@router.delete("/{project_id}/files/{file_id}", status_code=204)
async def delete_file(
    project_id: uuid.UUID,
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a file from disk and database."""
    result = await db.execute(
        select(FileUpload).where(
            FileUpload.id == file_id,
            FileUpload.project_id == project_id,
            FileUpload.org_id == org_id,
        )
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    # Delete from database
    await db.execute(
        sa_delete(FileUpload).where(FileUpload.id == file_id)
    )
    await db.commit()
