from __future__ import annotations

"""
Scheduled Reports — let developers set up automated reports for their generated apps.
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_scheduled_report import AppScheduledReport

router = APIRouter(tags=["app-scheduled-reports"])

VALID_SCHEDULES = {"daily", "weekly_monday", "weekly_friday", "monthly_first", "monthly_last"}
VALID_REPORT_TYPES = {"summary", "detailed"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class ScheduledReportCreateBody(BaseModel):
    name: str
    schedule: str
    entities: list[str]
    recipient_email: str
    report_type: str = "summary"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(report: AppScheduledReport) -> dict:
    return {
        "id": str(report.id),
        "project_id": str(report.project_id),
        "org_id": str(report.org_id),
        "name": report.name,
        "schedule": report.schedule,
        "entities": report.entities or [],
        "recipient_email": report.recipient_email,
        "report_type": report.report_type,
        "enabled": report.enabled,
        "last_sent_at": report.last_sent_at.isoformat() if report.last_sent_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/scheduled-reports")
async def list_scheduled_reports(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all scheduled reports for a project."""
    result = await db.execute(
        select(AppScheduledReport).where(
            AppScheduledReport.project_id == uuid.UUID(project_id),
            AppScheduledReport.org_id == org_id,
        ).order_by(AppScheduledReport.created_at.desc())
    )
    reports = result.scalars().all()
    return {"items": [_serialize(r) for r in reports]}


@router.post("/projects/{project_id}/scheduled-reports", status_code=status.HTTP_201_CREATED)
async def create_scheduled_report(
    project_id: str,
    body: ScheduledReportCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new scheduled report."""
    if body.schedule not in VALID_SCHEDULES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid schedule '{body.schedule}'. Must be one of: {', '.join(sorted(VALID_SCHEDULES))}",
        )
    if body.report_type not in VALID_REPORT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid report_type '{body.report_type}'. Must be one of: {', '.join(sorted(VALID_REPORT_TYPES))}",
        )
    if not body.entities:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one entity is required.",
        )

    report = AppScheduledReport(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        schedule=body.schedule,
        entities=body.entities,
        recipient_email=body.recipient_email,
        report_type=body.report_type,
        enabled=True,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _serialize(report)


@router.delete("/projects/{project_id}/scheduled-reports/{report_id}")
async def delete_scheduled_report(
    project_id: str,
    report_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a scheduled report."""
    result = await db.execute(
        select(AppScheduledReport).where(
            AppScheduledReport.id == uuid.UUID(report_id),
            AppScheduledReport.project_id == uuid.UUID(project_id),
            AppScheduledReport.org_id == org_id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled report not found")

    await db.delete(report)
    await db.commit()
    return {"detail": "Scheduled report deleted"}


@router.post("/projects/{project_id}/scheduled-reports/{report_id}/send-now")
async def send_report_now(
    project_id: str,
    report_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a scheduled report to be sent immediately (simulated)."""
    result = await db.execute(
        select(AppScheduledReport).where(
            AppScheduledReport.id == uuid.UUID(report_id),
            AppScheduledReport.project_id == uuid.UUID(project_id),
            AppScheduledReport.org_id == org_id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled report not found")

    # In production, this would generate and email the report.
    # For now, we update last_sent_at and return a confirmation.
    report.last_sent_at = datetime.utcnow()
    await db.commit()
    await db.refresh(report)

    return {
        "detail": "Report triggered",
        "report_name": report.name,
        "recipient_email": report.recipient_email,
        "entities": report.entities or [],
        "report_type": report.report_type,
        "sent_at": report.last_sent_at.isoformat(),
        "success": True,
    }
