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
import logging
from uuid import UUID
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from db import DATABASE_URL
from models.project import Project
from .ai_generator import generate_spec, refine_spec
from .builder import build_backend
from .app_db import create_app_schema, drop_app_schema
from .spec_validator import validate_and_repair

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
        logger.info("Generating spec for project %s with prompt: %s", project.id, prompt[:100])
        spec = await generate_spec(prompt)

        # Safeguard: if spec came back as a string, parse it
        if isinstance(spec, str):
            spec = json.loads(spec)
        if not isinstance(spec, dict):
            raise ValueError(f"generate_spec returned {type(spec).__name__}, expected dict")

        # Deep sanitize — fix every value that should be dict/list but is string
        spec = _sanitize_spec(spec)

        # Validate and auto-repair the spec before building
        spec = validate_and_repair(spec)

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

        # 4b. Create isolated database schema + tables for the app
        try:
            app_schema = await create_app_schema(
                project_id=str(project.id),
                spec=spec,
                db_url=DATABASE_URL,
            )
            spec.setdefault("_meta", {})
            spec["_meta"]["db_schema"] = app_schema
        except Exception as schema_err:
            logger.warning("Schema creation failed for project %s: %s", project.id, schema_err)
            # Non-fatal: the app can still work, schema can be retried later

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
        error_msg = str(e)
        logger.error(
            "Project generation failed for %s: %s",
            project.id, error_msg,
            exc_info=True,
        )
        project.status = "error"
        project.description = f"Generation failed: {error_msg[:500]}"
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

        # Validate and auto-repair the refined spec
        updated_spec = validate_and_repair(updated_spec)

        # Update metadata
        updated_spec.setdefault("_meta", {})
        updated_spec["_meta"]["project_id"] = str(project.id)
        updated_spec["_meta"]["app_name"] = project.name
        updated_spec["_meta"]["last_refinement"] = feedback

        project.spec = updated_spec

        # Rebuild backend
        build_dir = os.path.join(PROJECTS_DIR, str(project.id), "backend")
        build_backend(updated_spec, build_dir)

        # Recreate database schema (drop + create to reflect entity changes)
        try:
            from .app_db import get_schema_name
            old_schema = get_schema_name(str(project.id))
            await drop_app_schema(old_schema, DATABASE_URL)
            app_schema = await create_app_schema(
                project_id=str(project.id),
                spec=updated_spec,
                db_url=DATABASE_URL,
            )
            updated_spec.setdefault("_meta", {})
            updated_spec["_meta"]["db_schema"] = app_schema
        except Exception as schema_err:
            logger.warning("Schema recreation failed for project %s: %s", project.id, schema_err)

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


def _sanitize_spec(spec: dict) -> dict:
    """
    Deep-sanitize an AI-generated spec to fix type mismatches.
    The AI sometimes generates strings where dicts/lists are expected.
    """
    # Fix top-level keys that must be dicts
    for key in ("_meta", "design_system", "pagination", "dashboard"):
        if key in spec and not isinstance(spec[key], dict):
            spec[key] = {}

    # Fix top-level keys that must be lists
    for key in ("entities", "modules"):
        if key in spec and not isinstance(spec[key], list):
            spec[key] = []

    # Fix design_system nested dicts
    ds = spec.get("design_system", {})
    if isinstance(ds, dict):
        for key in ("colors", "spacing", "buttons", "table", "typography"):
            if key in ds and not isinstance(ds[key], dict):
                ds[key] = {}

    # Sanitize entities
    clean_entities = []
    for ent in spec.get("entities", []):
        if not isinstance(ent, dict):
            continue
        if "name" not in ent or "table" not in ent:
            continue

        # Fix fields
        fields = ent.get("fields", [])
        if not isinstance(fields, list):
            ent["fields"] = []
            fields = ent["fields"]

        clean_fields = []
        for f in fields:
            if not isinstance(f, dict):
                continue
            # Fix nested dicts that might be strings
            for dk in ("validation", "badge_colors"):
                if dk in f and not isinstance(f[dk], dict):
                    f[dk] = {}
            # Fix enum_values
            if "enum_values" in f and not isinstance(f["enum_values"], list):
                if isinstance(f["enum_values"], str):
                    f["enum_values"] = [v.strip() for v in f["enum_values"].split(",")]
                else:
                    f["enum_values"] = []
            clean_fields.append(f)
        ent["fields"] = clean_fields

        # Fix ui_config
        ui = ent.get("ui_config", {})
        if not isinstance(ui, dict):
            ent["ui_config"] = {}
            ui = ent["ui_config"]
        for uk in ("list_view", "detail_view", "create_form", "edit_form"):
            if uk in ui and not isinstance(ui[uk], dict):
                ui[uk] = {}
        # Fix nested within list_view
        lv = ui.get("list_view", {})
        if isinstance(lv, dict):
            for lk in ("columns", "filters", "quick_filter_tabs", "row_actions"):
                if lk in lv and not isinstance(lv[lk], list):
                    lv[lk] = []
            es = lv.get("empty_state", {})
            if not isinstance(es, dict):
                lv["empty_state"] = {}
        # Fix nested within detail_view
        dv = ui.get("detail_view", {})
        if isinstance(dv, dict):
            if "tabs" in dv and not isinstance(dv["tabs"], list):
                dv["tabs"] = []
            if "header" in dv and not isinstance(dv["header"], dict):
                dv["header"] = {}
        # Fix nested within create_form / edit_form
        for fk in ("create_form", "edit_form"):
            form = ui.get(fk, {})
            if isinstance(form, dict):
                for fl in ("field_order", "required_fields"):
                    if fl in form and not isinstance(form[fl], list):
                        form[fl] = []

        # Fix db_constraints
        if "db_constraints" in ent and not isinstance(ent["db_constraints"], list):
            if isinstance(ent["db_constraints"], dict):
                ent["db_constraints"] = list(ent["db_constraints"].values())
            else:
                ent["db_constraints"] = []

        clean_entities.append(ent)

    spec["entities"] = clean_entities

    # Sanitize modules
    clean_modules = []
    for mod in spec.get("modules", []):
        if not isinstance(mod, dict):
            continue
        clean_modules.append(mod)
    spec["modules"] = clean_modules

    # Sanitize dashboard
    dash = spec.get("dashboard", {})
    if isinstance(dash, dict):
        if "stat_cards" in dash and not isinstance(dash["stat_cards"], list):
            dash["stat_cards"] = []

    return spec
