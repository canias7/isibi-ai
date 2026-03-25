from __future__ import annotations
"""
Generator API routes — the user-facing endpoints for the AI system.

POST /api/projects           → Create new project (prompt → spec → backend)
GET  /api/projects           → List user's projects
GET  /api/projects/{id}      → Get project details + spec
POST /api/projects/{id}/refine → Refine with feedback
DELETE /api/projects/{id}    → Soft delete
GET  /api/spec               → Serve active spec for frontend
"""

from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id, get_current_user_id
from schemas.project import ProjectCreate, ProjectRefine, ProjectResponse, ProjectListItem
from generator.orchestrator import (
    create_project,
    refine_project,
    list_projects,
    get_project,
    get_active_spec,
    delete_project,
)

router = APIRouter(tags=["Generator"])


# ── Create a new project ────────────────────────────────────────────

@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def api_create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Takes a user prompt like "Build me a CRM for real estate" and:
    1. Generates a complete spec via AI + RAG
    2. Builds a FastAPI backend from the spec
    3. Returns the project with spec ready for the frontend
    """
    project = await create_project(
        db=db,
        user_id=user_id,
        org_id=org_id,
        prompt=body.prompt,
        name=body.name,
    )
    return project


# ── List projects ───────────────────────────────────────────────────

@router.get("/projects", response_model=list[ProjectListItem])
async def api_list_projects(
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
    user_id: UUID = Depends(get_current_user_id),
):
    """List all projects for the current user."""
    return await list_projects(db, org_id, user_id)


# ── Get single project ──────────────────────────────────────────────

@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def api_get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get project details including the full spec."""
    return await get_project(db, project_id, org_id)


# ── Refine a project ────────────────────────────────────────────────

@router.post("/projects/{project_id}/refine", response_model=ProjectResponse)
async def api_refine_project(
    project_id: UUID,
    body: ProjectRefine,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Refine an existing project's spec.
    e.g. "Add a Payments entity" or "Change status options for Orders"
    """
    return await refine_project(
        db=db,
        project_id=project_id,
        user_id=user_id,
        org_id=org_id,
        feedback=body.feedback,
    )


# ── Delete a project ────────────────────────────────────────────────

@router.delete("/projects/{project_id}", status_code=204)
async def api_delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Soft-delete a project."""
    await delete_project(db, project_id, org_id)


# ── Serve spec for frontend ─────────────────────────────────────────

@router.get("/spec")
async def api_serve_spec(
    project_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """
    Serve the active spec for the frontend renderer.
    The frontend calls this on boot to know what to render.
    """
    spec = await get_active_spec(db, org_id, project_id)
    if not spec:
        raise HTTPException(status_code=404, detail="No active project found")
    return spec
