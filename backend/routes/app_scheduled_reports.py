from __future__ import annotations

"""
Scheduled Reports — let developers set up automated reports for their generated apps.
"""

import uuid
from datetime import datetime, timezone
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

    # Build the report and send via Resend
    from services.email import send_generic_email
    from generator.app_db import get_schema_name
    from sqlalchemy import text

    schema = get_schema_name(str(report.project_id))
    now = datetime.now(timezone.utc)

    import re as _re
    _IDENT = _re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

    entity_rows = []
    for entity_name in (report.entities or []):
        try:
            entity_table = (entity_name or "").lower() + "s"
            if not _IDENT.match(entity_table):
                entity_rows.append((entity_name, None))
                continue
            count_result = await db.execute(
                text(f"SELECT COUNT(*) FROM {schema}.{entity_table} WHERE deleted_at IS NULL")
            )
            count = count_result.scalar() or 0
            entity_rows.append((entity_name, count))
        except Exception:
            entity_rows.append((entity_name, None))

    rows_html = "".join(
        f'<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">{name}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">'
        f'{count if count is not None else "—"}</td></tr>'
        for (name, count) in entity_rows
    )
    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">{report.name}</h2>
      <p style="font-size:14px;color:#666;margin:0 0 24px">Manual report — {now.strftime('%B %d, %Y')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr>
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #000">Entity</th>
          <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #000">Records</th>
        </tr></thead>
        <tbody>{rows_html or '<tr><td colspan="2" style="padding:12px;color:#999">No data</td></tr>'}</tbody>
      </table>
      <p style="font-size:12px;color:#999;margin:24px 0 0">Sent by isibi.ai</p>
    </div>
    """

    # Unified outbound email: tries the owner's connected mail apps
    # (Gmail / Outlook / Neo / Titan / IMAP) first, then legacy SMTP,
    # then Resend as the last resort. See send_email_for_user in
    # routes/ghost_connectors.py for the full preference chain.
    ok = False
    try:
        from models.project import Project
        from routes.ghost_connectors import send_email_for_user
        from sqlalchemy import select as _select
        proj_res = await db.execute(_select(Project).where(Project.id == report.project_id))
        proj = proj_res.scalar_one_or_none()
        owner_email = ""
        owner_id = None
        if proj and proj.user_id:
            from routes.ghost_auth import GhostUser
            user_res = await db.execute(_select(GhostUser).where(GhostUser.id == proj.user_id))
            owner = user_res.scalar_one_or_none()
            if owner:
                owner_email = owner.email
                owner_id = owner.id
        if owner_id:
            result = await send_email_for_user(
                owner_id,
                owner_email,
                db,
                to=report.recipient_email,
                subject=f"[isibi] {report.name}",
                html=html,
            )
            ok = bool(result.get("sent"))
    except Exception:
        logger.exception("Scheduled report send via unified router failed")

    if not ok:
        ok = await send_generic_email(
            to=report.recipient_email,
            subject=f"[isibi] {report.name}",
            html=html,
        )

    if ok:
        report.last_sent_at = now
        await db.commit()
        await db.refresh(report)

    return {
        "detail": "Report sent" if ok else "Report send failed (email service not configured)",
        "report_name": report.name,
        "recipient_email": report.recipient_email,
        "entities": report.entities or [],
        "report_type": report.report_type,
        "sent_at": report.last_sent_at.isoformat() if report.last_sent_at else None,
        "success": ok,
    }
