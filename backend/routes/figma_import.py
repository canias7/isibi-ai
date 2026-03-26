from __future__ import annotations
"""
Figma / Design Import API — upload design screenshots and generate components.

Routes:
  POST  /api/projects/{project_id}/import/design                    — upload a design image
  GET   /api/projects/{project_id}/import/designs                   — list design imports
  POST  /api/projects/{project_id}/import/design/{import_id}/process — trigger AI processing
"""

import os
import uuid
import logging
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.design_import import DesignImport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Design Import"])

# Base directory for uploaded files
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")))

# Max image size: 20 MB
MAX_IMAGE_SIZE = int(os.getenv("MAX_IMAGE_SIZE", 20 * 1024 * 1024))

ALLOWED_IMAGE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
}


# ── Upload a design image ────────────────────────────────────────────

@router.post("/{project_id}/import/design", status_code=201)
async def upload_design(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Upload a design screenshot/image for AI component generation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if file.content_type and file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type}. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}",
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Maximum size is {MAX_IMAGE_SIZE // (1024 * 1024)} MB",
        )

    # Build storage path: uploads/{project_id}/designs/{uuid}_{filename}
    file_uuid = uuid.uuid4()
    safe_filename = file.filename.replace("/", "_").replace("\\", "_")
    stored_name = f"{file_uuid}_{safe_filename}"
    designs_dir = UPLOADS_DIR / str(project_id) / "designs"
    file_path = designs_dir / stored_name

    # Ensure directory exists
    designs_dir.mkdir(parents=True, exist_ok=True)

    # Write file to disk asynchronously
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Build the public URL
    file_url = f"/uploads/{project_id}/designs/{stored_name}"

    # Save metadata to database
    record = DesignImport(
        id=file_uuid,
        project_id=project_id,
        org_id=org_id,
        file_name=safe_filename,
        file_url=file_url,
        description=description,
        status="processing",
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return {
        "id": str(record.id),
        "file_url": record.file_url,
        "status": record.status,
    }


# ── List design imports ──────────────────────────────────────────────

@router.get("/{project_id}/import/designs")
async def list_design_imports(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all design imports for a project."""
    result = await db.execute(
        select(DesignImport)
        .where(DesignImport.project_id == project_id, DesignImport.org_id == org_id)
        .order_by(DesignImport.created_at.desc())
    )
    imports = result.scalars().all()

    return {
        "imports": [
            {
                "id": str(imp.id),
                "file_name": imp.file_name,
                "file_url": imp.file_url,
                "description": imp.description,
                "status": imp.status,
                "generated_spec_fragment": imp.generated_spec_fragment,
                "created_at": imp.created_at.isoformat() if imp.created_at else None,
            }
            for imp in imports
        ]
    }


# ── Trigger AI processing ────────────────────────────────────────────

@router.post("/{project_id}/import/design/{import_id}/process")
async def process_design_import(
    project_id: uuid.UUID,
    import_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Trigger AI processing of an uploaded design image.

    For now, returns a mock spec fragment. In production this would
    send the image to a vision model and generate real components.
    """
    result = await db.execute(
        select(DesignImport).where(
            DesignImport.id == import_id,
            DesignImport.project_id == project_id,
            DesignImport.org_id == org_id,
        )
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail="Design import not found")

    if record.status == "completed":
        return {
            "id": str(record.id),
            "status": record.status,
            "generated_spec_fragment": record.generated_spec_fragment,
        }

    # Mock spec fragment — replace with real AI vision processing later
    mock_spec_fragment = {
        "components": [
            {
                "name": "ImportedDesignComponent",
                "type": "container",
                "description": f"Component generated from design: {record.file_name}",
                "children": [
                    {"type": "heading", "text": "Imported Design", "level": 2},
                    {"type": "text", "text": record.description or "Design component placeholder"},
                ],
            }
        ],
        "source_image": record.file_url,
    }

    record.status = "completed"
    record.generated_spec_fragment = mock_spec_fragment
    await db.commit()
    await db.refresh(record)

    return {
        "id": str(record.id),
        "status": record.status,
        "generated_spec_fragment": record.generated_spec_fragment,
    }
