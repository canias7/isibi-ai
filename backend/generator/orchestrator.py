from __future__ import annotations
"""
Orchestrator — the brain that ties everything together.

Flow:
  1. User says: "Build me a CRM for real estate"
  2. Orchestrator creates a Project record (status: generating)
  3. RAG loads relevant existing specs as context
  4. AI generates a new spec from the prompt + RAG context
  5. Spec is saved to the Project record
  6. Auto-builder generates backend code from the spec
  7. Project status → ready
  8. Frontend fetches the spec via GET /api/spec and renders the UI

The user can then refine:
  "Add a Payments entity" → AI updates the spec → backend regenerated
"""

import os
import json
from uuid import UUID
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project
from .ai_generator import generate_spec, refine_spec
from .builder import build_backend

# Where generated projects are stored on disk
PROJECTS_DIR = os.getenv(
    "PROJECTS_DIR",
    os.path.expanduser("~/Desktop/isibi.ai/generated")
)


async def create_project(
    db: AsyncSession,
    user_id: UUID,
    org_id: UUID,
    prompt: str,
    name: str | None = None,
) -> Project:
    """
    Full pipeline: prompt → AI spec → save → build backend.
    """
    # 1. Create project record
    project = Project(
        user_id=user_id,
        org_id=org_id,
        name=name or _infer_name(prompt),
        prompt=prompt,
        status="generating",
        conversation_history=[],
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    try:
        # 2. Generate spec via AI + RAG
        spec = await generate_spec(prompt)

        # Inject project metadata into spec
        spec.setdefault("_meta", {})
        spec["_meta"]["project_id"] = str(project.id)
        spec["_meta"]["app_name"] = project.name
        spec["_meta"]["generated_from"] = prompt

        # 3. Save spec to project
        project.spec = spec
        project.status = "ready"

        # 4. Build backend code
        build_dir = os.path.join(PROJECTS_DIR, str(project.id), "backend")
        build_backend(spec, build_dir)
        project.build_path = build_dir

        # 5. Also save spec.json for the frontend to load
        spec_dir = os.path.join(PROJECTS_DIR, str(project.id))
        Path(spec_dir).mkdir(parents=True, exist_ok=True)
        with open(os.path.join(spec_dir, "spec.json"), "w") as f:
            json.dump(spec, f, indent=2)

        project.status = "ready"
        project.conversation_history = [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": f"Generated spec with {len(spec.get('entities', []))} entities."},
        ]

        await db.commit()
        await db.refresh(project)

    except Exception as e:
        project.status = "error"
        project.description = f"Generation failed: {str(e)}"
        await db.commit()
        await db.refresh(project)
        raise

    return project


async def refine_project(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    org_id: UUID,
    feedback: str,
) -> Project:
    """
    Refine an existing project's spec based on user feedback.
    """
    project = await _get_project(db, project_id, org_id)

    if not project.spec:
        raise ValueError("Project has no spec to refine")

    try:
        project.status = "generating"
        await db.commit()

        # Refine spec
        updated_spec = await refine_spec(project.spec, feedback)

        # Update metadata
        updated_spec.setdefault("_meta", {})
        updated_spec["_meta"]["project_id"] = str(project.id)
        updated_spec["_meta"]["app_name"] = project.name
        updated_spec["_meta"]["last_refinement"] = feedback

        project.spec = updated_spec

        # Rebuild backend
        build_dir = os.path.join(PROJECTS_DIR, str(project.id), "backend")
        build_backend(updated_spec, build_dir)

        # Update spec.json
        spec_dir = os.path.join(PROJECTS_DIR, str(project.id))
        with open(os.path.join(spec_dir, "spec.json"), "w") as f:
            json.dump(updated_spec, f, indent=2)

        # Append to conversation
        history = project.conversation_history or []
        history.append({"role": "user", "content": feedback})
        history.append({
            "role": "assistant",
            "content": f"Updated spec: {len(updated_spec.get('entities', []))} entities.",
        })
        project.conversation_history = history
        project.status = "ready"
        project.updated_at = datetime.utcnow()
        project.version += 1

        await db.commit()
        await db.refresh(project)

    except Exception as e:
        project.status = "error"
        await db.commit()
        raise

    return project


async def list_projects(
    db: AsyncSession,
    org_id: UUID,
    user_id: UUID | None = None,
) -> list[Project]:
    """List all projects for an org (optionally filtered by user)."""
    filters = [Project.org_id == org_id, Project.deleted_at.is_(None)]
    if user_id:
        filters.append(Project.user_id == user_id)

    q = select(Project).where(and_(*filters)).order_by(Project.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_project(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> Project:
    """Get a single project."""
    return await _get_project(db, project_id, org_id)


async def get_active_spec(
    db: AsyncSession,
    org_id: UUID,
    project_id: UUID | None = None,
) -> dict | None:
    """
    Get the spec for the frontend.
    If project_id is given, return that project's spec.
    Otherwise return the most recently created project's spec.
    """
    if project_id:
        project = await _get_project(db, project_id, org_id)
        return project.spec

    q = (
        select(Project)
        .where(and_(
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
            Project.status == "ready",
        ))
        .order_by(Project.created_at.desc())
        .limit(1)
    )
    result = await db.execute(q)
    project = result.scalar_one_or_none()
    return project.spec if project else None


async def delete_project(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> None:
    """Soft-delete a project."""
    project = await _get_project(db, project_id, org_id)
    project.deleted_at = datetime.utcnow()
    await db.commit()


# ── Helpers ──────────────────────────────────────────────────────────

async def _get_project(db: AsyncSession, project_id: UUID, org_id: UUID) -> Project:
    from fastapi import HTTPException
    q = select(Project).where(and_(
        Project.id == project_id,
        Project.org_id == org_id,
        Project.deleted_at.is_(None),
    ))
    result = await db.execute(q)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _infer_name(prompt: str) -> str:
    """Extract a short project name from the user's prompt."""
    # Take first 60 chars, clean up
    name = prompt.strip()[:60]
    # Remove common prefixes
    for prefix in ["build me a ", "build a ", "create a ", "make a ", "i need a ", "i want a "]:
        if name.lower().startswith(prefix):
            name = name[len(prefix):]
            break
    return name.strip().title() or "New Project"
