from __future__ import annotations

"""
App Workflows — approval, sequential, conditional notification,
recurring record, record template, and data archiving workflows.
"""

import uuid
import logging
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import DATABASE_URL, get_db
from models.app_workflow import AppWorkflow
from generator.app_db import get_schema_name, _get_raw_connection

logger = logging.getLogger(__name__)

_IDENT_RE = __import__("re").compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_ident(name: str) -> str:
    """Validate SQL identifier to prevent injection."""
    if not name or not _IDENT_RE.match(name) or len(name) > 128:
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name}")
    return name


router = APIRouter(tags=["app-workflows"])

VALID_TYPES = {
    "approval",
    "sequential",
    "conditional_notification",
    "recurring_record",
    "record_template",
    "data_archiving",
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class WorkflowCreateBody(BaseModel):
    name: str
    type: str
    entity: Optional[str] = None
    config: Optional[dict] = None
    enabled: bool = True


class WorkflowUpdateBody(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    entity: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None


class WorkflowExecuteBody(BaseModel):
    record_id: Optional[str] = None
    params: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(wf: AppWorkflow) -> dict:
    return {
        "id": str(wf.id),
        "project_id": str(wf.project_id),
        "org_id": str(wf.org_id),
        "name": wf.name,
        "type": wf.type,
        "entity": wf.entity,
        "config": wf.config,
        "enabled": wf.enabled,
        "created_at": wf.created_at.isoformat() if wf.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/workflows")
async def list_workflows(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List all workflows for a project."""
    result = await db.execute(
        select(AppWorkflow).where(
            AppWorkflow.project_id == uuid.UUID(project_id),
            AppWorkflow.org_id == org_id,
        ).order_by(AppWorkflow.created_at.desc())
    )
    workflows = result.scalars().all()
    return {"items": [_serialize(w) for w in workflows]}


@router.post("/projects/{project_id}/workflows", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    project_id: str,
    body: WorkflowCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new workflow."""
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid type '{body.type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}",
        )

    wf = AppWorkflow(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        type=body.type,
        entity=body.entity,
        config=body.config or {},
        enabled=body.enabled,
    )
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return _serialize(wf)


@router.put("/projects/{project_id}/workflows/{workflow_id}")
async def update_workflow(
    project_id: str,
    workflow_id: str,
    body: WorkflowUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a workflow."""
    result = await db.execute(
        select(AppWorkflow).where(
            AppWorkflow.id == uuid.UUID(workflow_id),
            AppWorkflow.project_id == uuid.UUID(project_id),
            AppWorkflow.org_id == org_id,
        )
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")

    if body.name is not None:
        wf.name = body.name
    if body.type is not None:
        if body.type not in VALID_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid type '{body.type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}",
            )
        wf.type = body.type
    if body.entity is not None:
        wf.entity = body.entity
    if body.config is not None:
        wf.config = body.config
    if body.enabled is not None:
        wf.enabled = body.enabled

    await db.commit()
    await db.refresh(wf)
    return _serialize(wf)


@router.delete("/projects/{project_id}/workflows/{workflow_id}")
async def delete_workflow(
    project_id: str,
    workflow_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a workflow."""
    result = await db.execute(
        select(AppWorkflow).where(
            AppWorkflow.id == uuid.UUID(workflow_id),
            AppWorkflow.project_id == uuid.UUID(project_id),
            AppWorkflow.org_id == org_id,
        )
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")

    await db.delete(wf)
    await db.commit()
    return {"detail": "Workflow deleted"}


@router.post("/projects/{project_id}/workflows/{workflow_id}/execute")
async def execute_workflow(
    project_id: str,
    workflow_id: str,
    body: WorkflowExecuteBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Execute a workflow against a record or as a standalone action."""
    result = await db.execute(
        select(AppWorkflow).where(
            AppWorkflow.id == uuid.UUID(workflow_id),
            AppWorkflow.project_id == uuid.UUID(project_id),
            AppWorkflow.org_id == org_id,
        )
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")

    if not wf.enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workflow is disabled")

    config = wf.config or {}
    schema = get_schema_name(project_id)

    # ── approval workflow ────────────────────────────────────────────────
    if wf.type == "approval":
        if not body.record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="record_id required for approval workflow")
        entity = _safe_ident((wf.entity or config.get("entity", "")).lower())
        field = _safe_ident(config.get("field", "status"))
        trigger_value = config.get("trigger_value", "submitted")
        approved_value = config.get("approved_value", "approved")
        rejected_value = config.get("rejected_value", "rejected")
        action = (body.params or {}).get("action", "approve")

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                row = await conn.fetchrow(
                    f'SELECT "{field}" FROM "{schema}"."{entity}" WHERE "id" = $1',
                    uuid.UUID(body.record_id),
                )
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

                current = row[field]
                if current != trigger_value:
                    return {"executed": False, "detail": f"Record status is '{current}', expected '{trigger_value}'"}

                new_value = approved_value if action == "approve" else rejected_value
                await conn.execute(
                    f'UPDATE "{schema}"."{entity}" SET "{field}" = $1 WHERE "id" = $2',
                    new_value, uuid.UUID(body.record_id),
                )
            finally:
                await conn.close()
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Approval workflow failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {"executed": True, "type": "approval", "action": action, "new_status": new_value}

    # ── sequential workflow ──────────────────────────────────────────────
    elif wf.type == "sequential":
        if not body.record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="record_id required for sequential workflow")
        entity = _safe_ident((wf.entity or "").lower())
        field = _safe_ident(config.get("field", "status"))
        steps = config.get("steps", [])

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                row = await conn.fetchrow(
                    f'SELECT "{field}" FROM "{schema}"."{entity}" WHERE "id" = $1',
                    uuid.UUID(body.record_id),
                )
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

                current = row[field]
                next_status = None
                for step in steps:
                    if step.get("status") == current:
                        next_status = step.get("next")
                        break

                if not next_status:
                    return {"executed": False, "detail": f"No next step from status '{current}'"}

                await conn.execute(
                    f'UPDATE "{schema}"."{entity}" SET "{field}" = $1 WHERE "id" = $2',
                    next_status, uuid.UUID(body.record_id),
                )
            finally:
                await conn.close()
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Sequential workflow failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {"executed": True, "type": "sequential", "previous_status": current, "new_status": next_status}

    # ── conditional_notification workflow ─────────────────────────────────
    elif wf.type == "conditional_notification":
        if not body.record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="record_id required")
        entity = _safe_ident((config.get("entity", wf.entity) or "").lower())
        condition = config.get("condition", {})
        cond_field = _safe_ident(condition.get("field", "") or "status")
        operator = condition.get("operator", "eq")
        cond_value = condition.get("value")
        message_template = config.get("message", "Notification triggered")

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                row = await conn.fetchrow(
                    f'SELECT * FROM "{schema}"."{entity}" WHERE "id" = $1',
                    uuid.UUID(body.record_id),
                )
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")

                record_val = row.get(cond_field)
                matched = False
                if operator == "gt" and record_val is not None:
                    matched = float(record_val) > float(cond_value)
                elif operator == "lt" and record_val is not None:
                    matched = float(record_val) < float(cond_value)
                elif operator == "eq":
                    matched = str(record_val) == str(cond_value)
                elif operator == "ne":
                    matched = str(record_val) != str(cond_value)

                if not matched:
                    return {"executed": False, "detail": "Condition not met"}

                # Build message from template
                message = message_template
                for key in dict(row).keys():
                    message = message.replace(f"{{{{{key}}}}}", str(row[key]))

            finally:
                await conn.close()
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Conditional notification failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {
            "executed": True,
            "type": "conditional_notification",
            "notify": config.get("notify", ""),
            "message": message,
        }

    # ── recurring_record workflow ────────────────────────────────────────
    elif wf.type == "recurring_record":
        entity = _safe_ident((config.get("entity", wf.entity) or "").lower())
        template = config.get("template", {})

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                columns = [_safe_ident(k) for k in template.keys()]
                values = list(template.values())
                col_str = ", ".join(f'"{c}"' for c in columns)
                val_placeholders = ", ".join(f"${i+1}" for i in range(len(values)))
                await conn.execute(
                    f'INSERT INTO "{schema}"."{entity}" ({col_str}) VALUES ({val_placeholders})',
                    *values,
                )
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Recurring record workflow failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {"executed": True, "type": "recurring_record", "entity": entity, "template": template}

    # ── record_template workflow ─────────────────────────────────────────
    elif wf.type == "record_template":
        entity = _safe_ident((config.get("entity", wf.entity) or "").lower())
        defaults = config.get("defaults", {})

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                columns = [_safe_ident(k) for k in defaults.keys()]
                values = list(defaults.values())
                col_str = ", ".join(f'"{c}"' for c in columns)
                val_placeholders = ", ".join(f"${i+1}" for i in range(len(values)))
                row = await conn.fetchrow(
                    f'INSERT INTO "{schema}"."{entity}" ({col_str}) VALUES ({val_placeholders}) RETURNING "id"',
                    *values,
                )
                new_id = str(row["id"]) if row else None
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Record template workflow failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {"executed": True, "type": "record_template", "entity": entity, "record_id": new_id, "defaults": defaults}

    # ── data_archiving workflow ──────────────────────────────────────────
    elif wf.type == "data_archiving":
        entity = _safe_ident((config.get("entity", wf.entity) or "").lower())
        condition = config.get("condition", {})
        cond_field = _safe_ident(condition.get("field", "updated_at"))
        older_than_days = condition.get("older_than_days", 365)
        action = config.get("action", "soft_delete")

        try:
            conn = await _get_raw_connection(DATABASE_URL)
            try:
                if action == "soft_delete":
                    result = await conn.execute(
                        f'UPDATE "{schema}"."{entity}" SET "deleted_at" = NOW() '
                        f'WHERE "{cond_field}" < NOW() - INTERVAL \'{int(older_than_days)} days\' '
                        f'AND "deleted_at" IS NULL',
                    )
                else:
                    result = await conn.execute(
                        f'DELETE FROM "{schema}"."{entity}" '
                        f'WHERE "{cond_field}" < NOW() - INTERVAL \'{int(older_than_days)} days\'',
                    )
                archived_count = int(result.split()[-1]) if isinstance(result, str) else 0
            finally:
                await conn.close()
        except Exception as e:
            logger.error("Data archiving workflow failed: %s", e)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

        return {"executed": True, "type": "data_archiving", "entity": entity, "action": action, "archived_count": archived_count}

    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown workflow type: {wf.type}")
