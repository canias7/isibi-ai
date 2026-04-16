from __future__ import annotations
"""
Multi-Language UI — store and retrieve UI translation configs for generated apps.

The translations are stored in the project spec under the `_ui_language` key.
The deployer reads this and includes a language switcher in the generated app.

Routes:
  PUT  /api/projects/{project_id}/ui-language  — set UI language config
  GET  /api/projects/{project_id}/ui-language  — get UI language config
"""

import uuid
import logging
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["App UI Language"])

# Default translation keys with English values
DEFAULT_TRANSLATIONS_EN = {
    "dashboard": "Dashboard",
    "search": "Search",
    "add_new": "Add New",
    "edit": "Edit",
    "delete": "Delete",
    "save": "Save",
    "cancel": "Cancel",
    "no_data": "No data",
    "loading": "Loading...",
    "confirm": "Confirm",
    "back": "Back",
    "next": "Next",
    "submit": "Submit",
    "close": "Close",
    "actions": "Actions",
    "settings": "Settings",
    "profile": "Profile",
    "logout": "Logout",
    "login": "Login",
    "signup": "Sign Up",
}


# ── Schemas ──────────────────────────────────────────────────────────

class UILanguageConfig(BaseModel):
    default_language: str = "en"
    available_languages: List[str] = ["en"]
    translations: Dict[str, Dict[str, str]] = {}


# ── Routes ───────────────────────────────────────────────────────────

@router.put("/{project_id}/ui-language")
async def set_ui_language(
    project_id: uuid.UUID,
    body: UILanguageConfig,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Set the UI language configuration for a project."""
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

    # Validate default_language is in available_languages
    if body.default_language not in body.available_languages:
        raise HTTPException(
            status_code=400,
            detail="default_language must be in available_languages list",
        )

    # Build the language config
    language_config = {
        "default_language": body.default_language,
        "available_languages": body.available_languages,
        "translations": body.translations,
    }

    # Store in the project spec under _ui_language key
    spec = project.spec or {}
    spec["_ui_language"] = language_config
    project.spec = spec

    # Force SQLAlchemy to detect the JSONB mutation
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(project, "spec")

    await db.commit()
    await db.refresh(project)

    return {
        "project_id": str(project_id),
        **language_config,
    }


@router.get("/{project_id}/ui-language")
async def get_ui_language(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the UI language configuration for a project."""
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

    spec = project.spec or {}
    language_config = spec.get("_ui_language", {
        "default_language": "en",
        "available_languages": ["en"],
        "translations": {},
    })

    return {
        "project_id": str(project_id),
        **language_config,
    }
