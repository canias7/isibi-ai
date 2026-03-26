from __future__ import annotations

"""
Serverless Functions — create, manage, and invoke custom backend logic.
"""

import uuid
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id, get_current_user_id
from db import get_db
from models.serverless_function import ServerlessFunction

router = APIRouter(prefix="/projects", tags=["serverless"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class FunctionCreateBody(BaseModel):
    name: str
    description: Optional[str] = None
    code: str
    runtime: str = "javascript"
    trigger_type: str  # "http", "schedule", "event"
    trigger_config: Optional[dict] = None
    is_active: bool = True


class FunctionUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    runtime: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[dict] = None
    is_active: Optional[bool] = None


class InvokeBody(BaseModel):
    input: Optional[dict] = None


def _serialize(f: ServerlessFunction) -> dict:
    return {
        "id": str(f.id),
        "project_id": str(f.project_id),
        "org_id": str(f.org_id),
        "name": f.name,
        "description": f.description,
        "code": f.code,
        "runtime": f.runtime,
        "trigger_type": f.trigger_type,
        "trigger_config": f.trigger_config,
        "is_active": f.is_active,
        "last_invoked_at": f.last_invoked_at.isoformat() if f.last_invoked_at else None,
        "invoke_count": f.invoke_count,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/functions")
async def list_functions(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List serverless functions for a project."""
    pid = uuid.UUID(project_id)
    result = await db.execute(
        select(ServerlessFunction)
        .where(ServerlessFunction.project_id == pid)
        .order_by(ServerlessFunction.created_at.desc())
    )
    functions = result.scalars().all()
    return {"functions": [_serialize(f) for f in functions]}


@router.post("/{project_id}/functions", status_code=201)
async def create_function(
    project_id: str,
    body: FunctionCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new serverless function."""
    pid = uuid.UUID(project_id)

    func_obj = ServerlessFunction(
        project_id=pid,
        org_id=org_id,
        name=body.name,
        description=body.description,
        code=body.code,
        runtime=body.runtime,
        trigger_type=body.trigger_type,
        trigger_config=body.trigger_config,
        is_active=body.is_active,
    )
    db.add(func_obj)
    await db.commit()
    await db.refresh(func_obj)
    return _serialize(func_obj)


@router.patch("/{project_id}/functions/{func_id}")
async def update_function(
    project_id: str,
    func_id: str,
    body: FunctionUpdateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a serverless function's code/config."""
    pid = uuid.UUID(project_id)
    fid = uuid.UUID(func_id)

    result = await db.execute(
        select(ServerlessFunction).where(
            ServerlessFunction.id == fid,
            ServerlessFunction.project_id == pid,
        )
    )
    func_obj = result.scalar_one_or_none()
    if not func_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found")

    if body.name is not None:
        func_obj.name = body.name
    if body.description is not None:
        func_obj.description = body.description
    if body.code is not None:
        func_obj.code = body.code
    if body.runtime is not None:
        func_obj.runtime = body.runtime
    if body.trigger_type is not None:
        func_obj.trigger_type = body.trigger_type
    if body.trigger_config is not None:
        func_obj.trigger_config = body.trigger_config
    if body.is_active is not None:
        func_obj.is_active = body.is_active

    await db.commit()
    await db.refresh(func_obj)
    return _serialize(func_obj)


@router.delete("/{project_id}/functions/{func_id}")
async def delete_function(
    project_id: str,
    func_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a serverless function."""
    pid = uuid.UUID(project_id)
    fid = uuid.UUID(func_id)

    result = await db.execute(
        select(ServerlessFunction).where(
            ServerlessFunction.id == fid,
            ServerlessFunction.project_id == pid,
        )
    )
    func_obj = result.scalar_one_or_none()
    if not func_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found")

    await db.delete(func_obj)
    await db.commit()
    return {"detail": "Function deleted"}


@router.post("/{project_id}/functions/{func_id}/invoke")
async def invoke_function(
    project_id: str,
    func_id: str,
    body: InvokeBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Manually invoke a serverless function."""
    pid = uuid.UUID(project_id)
    fid = uuid.UUID(func_id)

    result = await db.execute(
        select(ServerlessFunction).where(
            ServerlessFunction.id == fid,
            ServerlessFunction.project_id == pid,
        )
    )
    func_obj = result.scalar_one_or_none()
    if not func_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found")

    if not func_obj.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Function is not active")

    # In production, this would execute the code in a sandboxed environment.
    # For now, we record the invocation and return a placeholder result.
    func_obj.last_invoked_at = datetime.utcnow()
    func_obj.invoke_count = (func_obj.invoke_count or 0) + 1

    await db.commit()
    await db.refresh(func_obj)

    return {
        "function_id": str(func_obj.id),
        "function_name": func_obj.name,
        "runtime": func_obj.runtime,
        "invoke_count": func_obj.invoke_count,
        "invoked_at": func_obj.last_invoked_at.isoformat() if func_obj.last_invoked_at else None,
        "input": body.input,
        "output": {
            "status": "executed",
            "message": f"Function '{func_obj.name}' invoked successfully. Sandboxed execution pending runtime setup.",
        },
    }


@router.get("/{project_id}/functions/{func_id}/logs")
async def get_function_logs(
    project_id: str,
    func_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get invocation logs for a function (last 50)."""
    pid = uuid.UUID(project_id)
    fid = uuid.UUID(func_id)

    result = await db.execute(
        select(ServerlessFunction).where(
            ServerlessFunction.id == fid,
            ServerlessFunction.project_id == pid,
        )
    )
    func_obj = result.scalar_one_or_none()
    if not func_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found")

    # In production, logs would come from a separate logging table/service.
    # For now, return function metadata as a placeholder log.
    return {
        "function_id": str(func_obj.id),
        "function_name": func_obj.name,
        "invoke_count": func_obj.invoke_count,
        "last_invoked_at": func_obj.last_invoked_at.isoformat() if func_obj.last_invoked_at else None,
        "logs": [
            {
                "timestamp": func_obj.last_invoked_at.isoformat() if func_obj.last_invoked_at else None,
                "level": "info",
                "message": f"Function '{func_obj.name}' last invoked. Total invocations: {func_obj.invoke_count}",
            }
        ] if func_obj.last_invoked_at else [],
    }
