from __future__ import annotations

"""
Deploy routes — trigger deployments, check status, and serve deployed apps.
"""

import logging
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id
from db import get_db
from models.project import Project
from generator.deployer import deploy_app, BUILDS_DIR

logger = logging.getLogger(__name__)

router = APIRouter(tags=["deploy"])


@router.post("/projects/{project_id}/deploy")
async def trigger_deploy(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger a deploy for a project. Generates the frontend build from the
    project's spec, saves it to builds/, and returns the live URL.
    """
    # Validate project_id format
    try:
        pid = uuid.UUID(project_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid project ID format: {project_id}",
        )

    # Fetch the project
    try:
        result = await db.execute(
            select(Project).where(
                Project.id == pid,
                Project.user_id == user_id,
                Project.deleted_at.is_(None),
            )
        )
        project = result.scalar_one_or_none()
    except Exception as e:
        logger.error("DB error fetching project %s: %s", project_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while fetching project.",
        )

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not project.spec:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project has no spec. Generate a spec first.",
        )

    # Deploy
    try:
        deploy_info = await deploy_app(
            project_id=str(project.id),
            spec=project.spec,
            db=db,
        )
    except Exception as e:
        logger.error(
            "Deploy failed for project %s: %s\n%s",
            project_id, e, traceback.format_exc(),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Deploy failed: {str(e)}",
        )

    return deploy_info


@router.get("/projects/{project_id}/deploy/status")
async def deploy_status(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the deploy status and live URL for a project.
    """
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.user_id == user_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    is_deployed = project.status == "deployed" and project.build_path
    url = f"/live/{project_id}" if is_deployed else None

    return {
        "project_id": str(project.id),
        "status": project.status,
        "deployed": is_deployed,
        "url": url,
        "build_path": project.build_path,
    }
