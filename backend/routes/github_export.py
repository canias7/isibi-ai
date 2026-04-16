from __future__ import annotations
"""
GitHub Export API route.

POST /api/projects/{id}/export/github — generate codebase and return as zip download.
"""

import io
import zipfile
import tempfile
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project
from generator.builder import build_backend

router = APIRouter(tags=["GitHub Export"])


class ExportRequest(BaseModel):
    repo_name: str = Field(..., min_length=1, max_length=200, description="Repository / folder name")


@router.post("/projects/{project_id}/export/github")
async def export_to_github(
    project_id: UUID,
    body: ExportRequest,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """
    Generate the full codebase from the project spec and return it as a zip download.
    The repo_name is used as the root folder inside the zip.
    """
    # Fetch project
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.spec:
        raise HTTPException(status_code=400, detail="Project has no spec to export")

    # Sanitize repo name
    safe_name = body.repo_name.strip().lower()
    safe_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in safe_name)
    if not safe_name:
        safe_name = "my-app"

    # Generate all files using the builder
    with tempfile.TemporaryDirectory() as tmpdir:
        generated_files = build_backend(project.spec, tmpdir)

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path, content in generated_files.items():
            zf.writestr(f"{safe_name}/{rel_path}", content)

    zip_buffer.seek(0)

    # Save the repo name on the project
    project.github_repo = safe_name
    await db.commit()

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.zip"',
        },
    )
