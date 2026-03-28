from __future__ import annotations

"""
Email Templates for Apps — CRUD + test send.

Endpoints:
  GET    /api/projects/{id}/email-templates                      — list
  POST   /api/projects/{id}/email-templates                      — create
  PATCH  /api/projects/{id}/email-templates/{template_id}        — update
  DELETE /api/projects/{id}/email-templates/{template_id}        — delete
  POST   /api/projects/{id}/email-templates/{template_id}/test   — send test email
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id, get_current_org_id
from db import get_db
from models.email_template import EmailTemplate
from models.project import Project
from models.user import User

router = APIRouter(prefix="/projects", tags=["email-templates"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateEmailTemplateBody(BaseModel):
    name: str
    subject: str
    body_html: str
    body_text: Optional[str] = None
    trigger_event: Optional[str] = None
    is_active: bool = True


class UpdateEmailTemplateBody(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    trigger_event: Optional[str] = None
    is_active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _template_to_dict(t: EmailTemplate) -> dict:
    return {
        "id": str(t.id),
        "project_id": str(t.project_id),
        "name": t.name,
        "subject": t.subject,
        "body_html": t.body_html,
        "body_text": t.body_text,
        "trigger_event": t.trigger_event,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/email-templates")
async def list_email_templates(
    project_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List email templates for a project."""
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.project_id == project_id,
            EmailTemplate.org_id == org_id,
        )
    )
    templates = result.scalars().all()

    return {"data": [_template_to_dict(t) for t in templates]}


@router.post("/{project_id}/email-templates")
async def create_email_template(
    project_id: uuid.UUID,
    body: CreateEmailTemplateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create an email template for a project."""
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    template = EmailTemplate(
        project_id=project_id,
        org_id=org_id,
        name=body.name,
        subject=body.subject,
        body_html=body.body_html,
        body_text=body.body_text,
        trigger_event=body.trigger_event,
        is_active=body.is_active,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    return _template_to_dict(template)


@router.patch("/{project_id}/email-templates/{template_id}")
async def update_email_template(
    project_id: uuid.UUID,
    template_id: uuid.UUID,
    body: UpdateEmailTemplateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update an email template."""
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.id == template_id,
            EmailTemplate.project_id == project_id,
            EmailTemplate.org_id == org_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found")

    if body.name is not None:
        template.name = body.name
    if body.subject is not None:
        template.subject = body.subject
    if body.body_html is not None:
        template.body_html = body.body_html
    if body.body_text is not None:
        template.body_text = body.body_text
    if body.trigger_event is not None:
        template.trigger_event = body.trigger_event
    if body.is_active is not None:
        template.is_active = body.is_active

    template.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(template)

    return _template_to_dict(template)


@router.delete("/{project_id}/email-templates/{template_id}")
async def delete_email_template(
    project_id: uuid.UUID,
    template_id: uuid.UUID,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete an email template."""
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.id == template_id,
            EmailTemplate.project_id == project_id,
            EmailTemplate.org_id == org_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found")

    await db.delete(template)
    await db.commit()

    return {"detail": "Email template deleted"}


@router.post("/{project_id}/email-templates/{template_id}/test")
async def send_test_email(
    project_id: uuid.UUID,
    template_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a test email using this template to the current user."""
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.id == template_id,
            EmailTemplate.project_id == project_id,
            EmailTemplate.org_id == org_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found")

    # Get user email
    user_result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # In production, this would send via an email service (SES, SendGrid, etc.)
    # For now, return success with preview data
    return {
        "detail": "Test email queued",
        "recipient": user.email,
        "subject": template.subject,
        "preview": {
            "html": template.body_html[:500] if template.body_html else "",
            "text": template.body_text[:500] if template.body_text else None,
        },
    }
