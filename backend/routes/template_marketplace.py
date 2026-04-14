from __future__ import annotations

"""
App Templates Marketplace — publish, browse, purchase, and rate app specs.

Endpoints:
  POST /api/template-marketplace/publish       — publish a project as a template
  GET  /api/template-marketplace               — list templates (search, category, sort)
  GET  /api/template-marketplace/{id}           — template details + spec preview
  POST /api/template-marketplace/{id}/purchase  — purchase / clone a template
  POST /api/template-marketplace/{id}/rate      — rate a template (1-5)
"""

import copy
import re
import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id, get_current_org_id
from db import get_db
from models.marketplace_template import MarketplaceTemplate, MarketplaceRating
from models.project import Project

router = APIRouter(prefix="/template-marketplace", tags=["template-marketplace"])


# ---------------------------------------------------------------------------
# Personal data stripping
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
_PHONE_RE = re.compile(r"\+?\d[\d\-\s()]{7,}\d")
_API_KEY_RE = re.compile(r"(sk|pk|api|key|secret|token)[_-][A-Za-z0-9]{16,}", re.IGNORECASE)


def _strip_personal_data(spec: dict) -> dict:
    """Remove all personal/sensitive data from a spec before marketplace sale."""
    clean = copy.deepcopy(spec)

    # Remove internal metadata (keys starting with underscore)
    for key in list(clean.keys()):
        if key.startswith("_"):  # _branding, _white_label, _deploy_history, _meta, etc.
            del clean[key]

    # Walk through all values and redact personal data patterns
    def _redact(obj):
        if isinstance(obj, dict):
            return {k: _redact(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_redact(item) for item in obj]
        elif isinstance(obj, str):
            s = _EMAIL_RE.sub("[email redacted]", obj)
            s = _PHONE_RE.sub("[phone redacted]", s)
            s = _API_KEY_RE.sub("[key redacted]", s)
            return s
        return obj

    return _redact(clean)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class PublishTemplateBody(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    price: float = 0.0
    preview_images: List[str] = []


class RateTemplateBody(BaseModel):
    rating: int = Field(..., ge=1, le=5)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/publish", status_code=201)
async def publish_template(
    body: PublishTemplateBody,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Publish a project as a reusable marketplace template."""
    pid = uuid.UUID(body.project_id)

    # Fetch the project and verify ownership
    result = await db.execute(
        select(Project).where(
            Project.id == pid,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.spec:
        raise HTTPException(status_code=400, detail="Project has no spec to publish")

    # Strip personal data before storing in the marketplace
    clean_spec = _strip_personal_data(project.spec)

    template = MarketplaceTemplate(
        author_id=user_id,
        project_id=pid,
        title=body.title,
        description=body.description,
        category=body.category,
        price=body.price,
        spec=clean_spec,
        preview_images=body.preview_images,
        is_published=True,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    return {
        "id": str(template.id),
        "title": template.title,
        "category": template.category,
        "price": template.price,
        "is_published": template.is_published,
        "created_at": template.created_at.isoformat() if template.created_at else None,
    }


@router.get("")
async def list_marketplace_templates(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("popular", pattern="^(popular|recent|price|price-high|highest-rated)$"),
    author_id: Optional[str] = Query(None, description="Filter by author UUID"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List published marketplace templates with search, category filter, sort."""
    query = select(MarketplaceTemplate).where(MarketplaceTemplate.is_published.is_(True))

    if author_id:
        query = query.where(MarketplaceTemplate.author_id == uuid.UUID(author_id))

    if category:
        query = query.where(MarketplaceTemplate.category == category)

    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                MarketplaceTemplate.title.ilike(pattern),
                MarketplaceTemplate.description.ilike(pattern),
            )
        )

    if sort == "popular":
        query = query.order_by(MarketplaceTemplate.purchases.desc())
    elif sort == "recent":
        query = query.order_by(MarketplaceTemplate.created_at.desc())
    elif sort == "price":
        query = query.order_by(MarketplaceTemplate.price.asc())
    elif sort == "price-high":
        query = query.order_by(MarketplaceTemplate.price.desc())
    elif sort == "highest-rated":
        query = query.order_by(MarketplaceTemplate.rating_avg.desc())

    # Total count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    result = await db.execute(query.offset(offset).limit(limit))
    templates = result.scalars().all()

    return {
        "templates": [
            {
                "id": str(t.id),
                "title": t.title,
                "description": t.description,
                "category": t.category,
                "price": t.price,
                "rating_avg": t.rating_avg,
                "rating_count": t.rating_count,
                "purchases": t.purchases,
                "preview_images": t.preview_images or [],
                "author_id": str(t.author_id),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in templates
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/my-listings")
async def my_listings(
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Return all templates owned by the current user (including drafts)."""
    result = await db.execute(
        select(MarketplaceTemplate)
        .where(MarketplaceTemplate.author_id == user_id)
        .order_by(MarketplaceTemplate.created_at.desc())
    )
    templates = result.scalars().all()
    return {
        "templates": [
            {
                "id": str(t.id),
                "title": t.title,
                "description": t.description,
                "category": t.category,
                "price": t.price,
                "rating_avg": t.rating_avg,
                "rating_count": t.rating_count,
                "purchases": t.purchases,
                "is_published": t.is_published,
                "preview_images": t.preview_images or [],
                "author_id": str(t.author_id),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in templates
        ],
    }


@router.delete("/{template_id}")
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Delete a marketplace template owned by the current user."""
    tid = uuid.UUID(template_id)
    result = await db.execute(
        select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == tid,
            MarketplaceTemplate.author_id == user_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or not owned by you")
    await db.delete(template)
    await db.commit()
    return {"deleted": True, "id": str(tid)}


@router.patch("/{template_id}")
async def update_template(
    template_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Update a marketplace template owned by the current user."""
    tid = uuid.UUID(template_id)
    result = await db.execute(
        select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == tid,
            MarketplaceTemplate.author_id == user_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or not owned by you")

    for field in ("title", "description", "category", "price", "is_published"):
        if field in body:
            setattr(template, field, body[field])
    await db.commit()
    await db.refresh(template)
    return {
        "id": str(template.id),
        "title": template.title,
        "price": template.price,
        "is_published": template.is_published,
    }


@router.get("/{template_id}")
async def get_marketplace_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get template details with a spec preview (entities/modules only)."""
    tid = uuid.UUID(template_id)
    result = await db.execute(
        select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == tid,
            MarketplaceTemplate.is_published.is_(True),
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Build spec preview — only entities and modules, not full spec
    spec = template.spec or {}
    spec_preview = {}
    if "entities" in spec:
        spec_preview["entities"] = spec["entities"]
    if "modules" in spec:
        spec_preview["modules"] = spec["modules"]
    if "app_name" in spec:
        spec_preview["app_name"] = spec["app_name"]

    return {
        "id": str(template.id),
        "title": template.title,
        "description": template.description,
        "category": template.category,
        "price": template.price,
        "rating_avg": template.rating_avg,
        "rating_count": template.rating_count,
        "purchases": template.purchases,
        "preview_images": template.preview_images or [],
        "author_id": str(template.author_id),
        "spec_preview": spec_preview,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


@router.post("/{template_id}/purchase", status_code=201)
async def purchase_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Purchase a template and clone its spec into a new project."""
    tid = uuid.UUID(template_id)
    result = await db.execute(
        select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == tid,
            MarketplaceTemplate.is_published.is_(True),
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # If price > 0, payment is required (placeholder — accept for now)
    if template.price > 0:
        # TODO: integrate with Stripe payment flow
        pass

    # Strip personal data before cloning to buyer's project
    clean_spec = _strip_personal_data(template.spec or {})

    # Clone spec into a new project for the buyer
    project = Project(
        org_id=org_id,
        user_id=user_id,
        name=template.title,
        description=f"Created from marketplace template: {template.title}",
        prompt=f"Marketplace template: {template.title}",
        spec=clean_spec,
        status="ready",
    )
    db.add(project)

    # Increment purchase count
    template.purchases = (template.purchases or 0) + 1
    await db.commit()
    await db.refresh(project)

    return {
        "project_id": str(project.id),
        "template_id": str(template.id),
        "title": template.title,
        "message": "Template purchased and project created successfully",
    }


@router.post("/{template_id}/rate")
async def rate_template(
    template_id: str,
    body: RateTemplateBody,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Rate a marketplace template (1-5 stars)."""
    tid = uuid.UUID(template_id)
    result = await db.execute(
        select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == tid,
            MarketplaceTemplate.is_published.is_(True),
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check if user already rated — update if so
    existing = await db.execute(
        select(MarketplaceRating).where(
            MarketplaceRating.template_id == tid,
            MarketplaceRating.user_id == user_id,
        )
    )
    existing_rating = existing.scalar_one_or_none()

    if existing_rating:
        existing_rating.rating = body.rating
    else:
        new_rating = MarketplaceRating(
            template_id=tid,
            user_id=user_id,
            rating=body.rating,
        )
        db.add(new_rating)

    await db.flush()

    # Recalculate average rating
    avg_result = await db.execute(
        select(
            func.avg(MarketplaceRating.rating),
            func.count(MarketplaceRating.id),
        ).where(MarketplaceRating.template_id == tid)
    )
    row = avg_result.one()
    template.rating_avg = round(float(row[0] or 0), 2)
    template.rating_count = row[1] or 0

    await db.commit()

    return {
        "template_id": str(template.id),
        "your_rating": body.rating,
        "rating_avg": template.rating_avg,
        "rating_count": template.rating_count,
    }
