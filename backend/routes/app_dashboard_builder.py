from __future__ import annotations

"""
Dashboard Builder Config — add, arrange, and configure dashboard widgets.
"""

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_dashboard_widget import AppDashboardWidget

router = APIRouter(prefix="/apps", tags=["App Dashboard Builder"])

VALID_WIDGET_TYPES = {
    "stat_card", "bar_chart", "line_chart", "pie_chart",
    "recent_items", "calendar", "todo_list", "funnel", "goal_progress",
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class WidgetCreateBody(BaseModel):
    type: str
    entity: Optional[str] = None
    config: dict[str, Any] = {}
    position: int = 0
    width: str = "full"


class WidgetUpdateBody(BaseModel):
    type: Optional[str] = None
    entity: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    position: Optional[int] = None
    width: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(w: AppDashboardWidget) -> dict:
    return {
        "id": str(w.id),
        "project_id": str(w.project_id),
        "org_id": str(w.org_id),
        "type": w.type,
        "entity": w.entity,
        "config": w.config or {},
        "position": w.position,
        "width": w.width,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/dashboard-widgets", status_code=status.HTTP_201_CREATED)
async def create_widget(
    project_id: str,
    body: WidgetCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a widget to the dashboard."""
    if body.type not in VALID_WIDGET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid widget type '{body.type}'. Must be one of: {', '.join(sorted(VALID_WIDGET_TYPES))}",
        )

    widget = AppDashboardWidget(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        type=body.type,
        entity=body.entity,
        config=body.config,
        position=body.position,
        width=body.width,
    )
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return _serialize(widget)


@router.get("/{project_id}/dashboard-widgets")
async def list_widgets(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all dashboard widgets, ordered by position."""
    result = await db.execute(
        select(AppDashboardWidget).where(
            AppDashboardWidget.project_id == uuid.UUID(project_id),
            AppDashboardWidget.org_id == org_id,
        ).order_by(AppDashboardWidget.position)
    )
    widgets = result.scalars().all()
    return {"items": [_serialize(w) for w in widgets]}


@router.put("/{project_id}/dashboard-widgets/{widget_id}")
async def update_widget(
    project_id: str,
    widget_id: str,
    body: WidgetUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a widget's position or config."""
    result = await db.execute(
        select(AppDashboardWidget).where(
            AppDashboardWidget.id == uuid.UUID(widget_id),
            AppDashboardWidget.project_id == uuid.UUID(project_id),
            AppDashboardWidget.org_id == org_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    if body.type is not None:
        if body.type not in VALID_WIDGET_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid widget type '{body.type}'")
        widget.type = body.type
    if body.entity is not None:
        widget.entity = body.entity
    if body.config is not None:
        widget.config = body.config
    if body.position is not None:
        widget.position = body.position
    if body.width is not None:
        widget.width = body.width

    await db.commit()
    await db.refresh(widget)
    return _serialize(widget)


@router.delete("/{project_id}/dashboard-widgets/{widget_id}")
async def delete_widget(
    project_id: str,
    widget_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove a widget from the dashboard."""
    result = await db.execute(
        select(AppDashboardWidget).where(
            AppDashboardWidget.id == uuid.UUID(widget_id),
            AppDashboardWidget.project_id == uuid.UUID(project_id),
            AppDashboardWidget.org_id == org_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    await db.delete(widget)
    await db.commit()
    return {"detail": "Widget deleted"}
