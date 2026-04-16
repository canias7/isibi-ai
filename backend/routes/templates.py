from __future__ import annotations

"""
Templates Marketplace routes — browse, create, and clone templates.

Endpoints:
  GET    /api/templates          — list templates (query: category, search, sort)
  GET    /api/templates/{id}     — get template detail with spec
  POST   /api/templates          — create template (publish a spec as template)
  POST   /api/templates/{id}/use — clone a template into a new project
  DELETE /api/templates/{id}     — delete (only owner)
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id, get_current_user_id
from db import get_db
from models.template import Template
from models.project import Project

router = APIRouter(prefix="/templates", tags=["templates"])


# ---------------------------------------------------------------------------
# Seed templates
# ---------------------------------------------------------------------------
SEED_TEMPLATES = [
    {
        "name": "Restaurant POS",
        "description": "Full point-of-sale system for restaurants with menu management, order tracking, and table assignments.",
        "category": "restaurant",
        "is_official": True,
        "spec": {
            "app_name": "Restaurant POS",
            "entities": [
                {
                    "name": "MenuItem",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "price", "type": "number"},
                        {"name": "category", "type": "string"},
                        {"name": "available", "type": "boolean"},
                    ],
                },
                {
                    "name": "Order",
                    "fields": [
                        {"name": "table_number", "type": "number"},
                        {"name": "items", "type": "json"},
                        {"name": "total", "type": "number"},
                        {"name": "status", "type": "string"},
                    ],
                },
                {
                    "name": "Table",
                    "fields": [
                        {"name": "number", "type": "number"},
                        {"name": "capacity", "type": "number"},
                        {"name": "status", "type": "string"},
                    ],
                },
                {
                    "name": "Staff",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "role", "type": "string"},
                        {"name": "shift", "type": "string"},
                    ],
                },
            ],
        },
    },
    {
        "name": "Gym Management",
        "description": "Manage gym members, classes, trainers, and memberships with scheduling and billing.",
        "category": "fitness",
        "is_official": True,
        "spec": {
            "app_name": "Gym Management",
            "entities": [
                {
                    "name": "Member",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "phone", "type": "string"},
                        {"name": "joined_date", "type": "date"},
                    ],
                },
                {
                    "name": "Class",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "schedule", "type": "string"},
                        {"name": "capacity", "type": "number"},
                        {"name": "trainer_id", "type": "string"},
                    ],
                },
                {
                    "name": "Trainer",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "specialty", "type": "string"},
                        {"name": "bio", "type": "string"},
                    ],
                },
                {
                    "name": "Membership",
                    "fields": [
                        {"name": "type", "type": "string"},
                        {"name": "price", "type": "number"},
                        {"name": "duration_months", "type": "number"},
                        {"name": "member_id", "type": "string"},
                    ],
                },
            ],
        },
    },
    {
        "name": "Real Estate CRM",
        "description": "Track properties, leads, agents, and showings for real estate businesses.",
        "category": "crm",
        "is_official": True,
        "spec": {
            "app_name": "Real Estate CRM",
            "entities": [
                {
                    "name": "Property",
                    "fields": [
                        {"name": "address", "type": "string"},
                        {"name": "price", "type": "number"},
                        {"name": "bedrooms", "type": "number"},
                        {"name": "status", "type": "string"},
                    ],
                },
                {
                    "name": "Lead",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "budget", "type": "number"},
                        {"name": "source", "type": "string"},
                    ],
                },
                {
                    "name": "Agent",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "phone", "type": "string"},
                        {"name": "license_number", "type": "string"},
                    ],
                },
                {
                    "name": "Showing",
                    "fields": [
                        {"name": "property_id", "type": "string"},
                        {"name": "lead_id", "type": "string"},
                        {"name": "agent_id", "type": "string"},
                        {"name": "scheduled_at", "type": "datetime"},
                    ],
                },
            ],
        },
    },
    {
        "name": "Salon Booking",
        "description": "Appointment scheduling and client management for salons and spas.",
        "category": "salon",
        "is_official": True,
        "spec": {
            "app_name": "Salon Booking",
            "entities": [
                {
                    "name": "Service",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "duration_minutes", "type": "number"},
                        {"name": "price", "type": "number"},
                        {"name": "category", "type": "string"},
                    ],
                },
                {
                    "name": "Appointment",
                    "fields": [
                        {"name": "client_id", "type": "string"},
                        {"name": "stylist_id", "type": "string"},
                        {"name": "service_id", "type": "string"},
                        {"name": "scheduled_at", "type": "datetime"},
                    ],
                },
                {
                    "name": "Client",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "phone", "type": "string"},
                        {"name": "notes", "type": "string"},
                    ],
                },
                {
                    "name": "Stylist",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "specialties", "type": "string"},
                        {"name": "availability", "type": "string"},
                    ],
                },
            ],
        },
    },
    {
        "name": "Invoice Tracker",
        "description": "Create and track invoices, payments, and client billing with line item support.",
        "category": "finance",
        "is_official": True,
        "spec": {
            "app_name": "Invoice Tracker",
            "entities": [
                {
                    "name": "Invoice",
                    "fields": [
                        {"name": "number", "type": "string"},
                        {"name": "client_id", "type": "string"},
                        {"name": "total", "type": "number"},
                        {"name": "status", "type": "string"},
                        {"name": "due_date", "type": "date"},
                    ],
                },
                {
                    "name": "Client",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "company", "type": "string"},
                        {"name": "address", "type": "string"},
                    ],
                },
                {
                    "name": "Payment",
                    "fields": [
                        {"name": "invoice_id", "type": "string"},
                        {"name": "amount", "type": "number"},
                        {"name": "method", "type": "string"},
                        {"name": "paid_at", "type": "datetime"},
                    ],
                },
                {
                    "name": "LineItem",
                    "fields": [
                        {"name": "invoice_id", "type": "string"},
                        {"name": "description", "type": "string"},
                        {"name": "quantity", "type": "number"},
                        {"name": "unit_price", "type": "number"},
                    ],
                },
            ],
        },
    },
    {
        "name": "Job Board",
        "description": "Post jobs, manage applications, and track candidates through the hiring pipeline.",
        "category": "hr",
        "is_official": True,
        "spec": {
            "app_name": "Job Board",
            "entities": [
                {
                    "name": "Job",
                    "fields": [
                        {"name": "title", "type": "string"},
                        {"name": "description", "type": "string"},
                        {"name": "company_id", "type": "string"},
                        {"name": "location", "type": "string"},
                        {"name": "salary_range", "type": "string"},
                    ],
                },
                {
                    "name": "Application",
                    "fields": [
                        {"name": "job_id", "type": "string"},
                        {"name": "candidate_id", "type": "string"},
                        {"name": "status", "type": "string"},
                        {"name": "cover_letter", "type": "string"},
                    ],
                },
                {
                    "name": "Company",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "industry", "type": "string"},
                        {"name": "website", "type": "string"},
                        {"name": "logo_url", "type": "string"},
                    ],
                },
                {
                    "name": "Candidate",
                    "fields": [
                        {"name": "name", "type": "string"},
                        {"name": "email", "type": "string"},
                        {"name": "resume_url", "type": "string"},
                        {"name": "skills", "type": "string"},
                    ],
                },
            ],
        },
    },
]


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------
class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    spec: dict
    preview_image_url: Optional[str] = None
    is_public: bool = True
    price: int = 0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("")
async def list_templates(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("popular", pattern="^(popular|newest|name)$"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List templates with optional filtering by category, search, and sort."""
    query = select(Template).where(Template.is_public.is_(True))

    if category:
        query = query.where(Template.category == category)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                Template.name.ilike(search_pattern),
                Template.description.ilike(search_pattern),
            )
        )

    if sort == "popular":
        query = query.order_by(Template.use_count.desc())
    elif sort == "newest":
        query = query.order_by(Template.created_at.desc())
    elif sort == "name":
        query = query.order_by(Template.name.asc())

    # Count total
    count_query = select(func.count()).select_from(
        query.subquery()
    )
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    templates = result.scalars().all()

    return {
        "templates": [
            {
                "id": str(t.id),
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "preview_image_url": t.preview_image_url,
                "is_official": t.is_official,
                "use_count": t.use_count,
                "price": t.price,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in templates
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{template_id}")
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get template detail including full spec."""
    tid = uuid.UUID(template_id)
    result = await db.execute(select(Template).where(Template.id == tid))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    return {
        "id": str(template.id),
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "spec": template.spec,
        "preview_image_url": template.preview_image_url,
        "author_id": str(template.author_id) if template.author_id else None,
        "is_official": template.is_official,
        "is_public": template.is_public,
        "use_count": template.use_count,
        "price": template.price,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


@router.post("", status_code=201)
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Create a new template (publish a spec as a template)."""
    template = Template(
        name=body.name,
        description=body.description,
        category=body.category,
        spec=body.spec,
        preview_image_url=body.preview_image_url,
        author_id=user_id,
        is_official=False,
        is_public=body.is_public,
        price=body.price,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    return {
        "id": str(template.id),
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "is_public": template.is_public,
        "created_at": template.created_at.isoformat() if template.created_at else None,
    }


@router.post("/{template_id}/use", status_code=201)
async def use_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Clone a template into a new project for the current org."""
    tid = uuid.UUID(template_id)
    result = await db.execute(select(Template).where(Template.id == tid))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # Increment use count
    template.use_count = (template.use_count or 0) + 1

    # Create a new project from the template spec
    project = Project(
        org_id=org_id,
        user_id=user_id,
        name=template.name,
        description=f"Created from template: {template.name}",
        prompt=f"Template: {template.name}",
        spec=template.spec,
        status="ready",
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    return {
        "project_id": str(project.id),
        "name": project.name,
        "template_id": str(template.id),
        "template_name": template.name,
    }


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Delete a template (only the owner can delete)."""
    tid = uuid.UUID(template_id)
    result = await db.execute(select(Template).where(Template.id == tid))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    if template.author_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the template owner can delete this template",
        )

    await db.delete(template)
    await db.commit()
