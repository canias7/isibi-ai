from __future__ import annotations

"""
Serverless Functions — create, manage, and invoke custom backend logic.
"""

import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
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
    model_config = ConfigDict(extra="allow")  # Accept any additional JSON fields
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

    # Build the full input payload (body.input + any extra fields)
    invoke_input = body.input or {}
    if hasattr(body, "model_extra") and body.model_extra:
        invoke_input = {**invoke_input, **body.model_extra}

    # Execute the function code in a sandboxed restricted environment
    exec_output = None
    exec_error = None

    # Enforce code size limit (50 KB)
    if len(func_obj.code) > 50_000:
        raise HTTPException(status_code=400, detail="Function code exceeds maximum size (50 KB)")

    try:
        import ast as _ast
        import subprocess as _sp
        import json as _json
        import tempfile as _tf

        # AST-based security check — whitelist safe modules, block dangerous builtins
        _ALLOWED_MODULES = {"math", "statistics", "json", "datetime", "re", "collections",
                            "itertools", "functools", "decimal", "fractions", "random",
                            "string", "textwrap", "csv", "operator", "numbers"}
        _BLOCKED_BUILTINS = {"__import__", "exec", "eval", "compile", "open", "getattr",
                             "setattr", "delattr", "globals", "locals", "vars", "dir",
                             "type", "breakpoint", "input", "memoryview", "help"}

        tree = _ast.parse(func_obj.code)
        for node in _ast.walk(tree):
            if isinstance(node, _ast.Import):
                for alias in node.names:
                    mod = alias.name.split(".")[0]
                    if mod not in _ALLOWED_MODULES:
                        raise HTTPException(400, f"Blocked: import of '{mod}' is not allowed")
            elif isinstance(node, _ast.ImportFrom):
                if node.module:
                    mod = node.module.split(".")[0]
                    if mod not in _ALLOWED_MODULES:
                        raise HTTPException(400, f"Blocked: import from '{mod}' is not allowed")
            elif isinstance(node, _ast.Call):
                func = node.func
                if isinstance(func, _ast.Name) and func.id in _BLOCKED_BUILTINS:
                    raise HTTPException(400, f"Blocked: '{func.id}()' is not allowed")
                elif isinstance(func, _ast.Attribute) and func.attr in _BLOCKED_BUILTINS:
                    raise HTTPException(400, f"Blocked: '.{func.attr}()' is not allowed")
            # Block attribute access to dunder methods (class hierarchy escape)
            elif isinstance(node, _ast.Attribute) and node.attr.startswith("__") and node.attr.endswith("__"):
                raise HTTPException(400, f"Blocked: access to '{node.attr}' is not allowed")

        # Execute in isolated subprocess instead of in-process exec()
        wrapper = f"""
import json, sys
input_data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {{}}
result = None

{func_obj.code}

if 'handler' in dir() and callable(handler):
    output = handler(input_data)
elif result is not None:
    output = result
else:
    output = {{"status": "executed", "message": "Function executed"}}
print(json.dumps(output, default=str))
"""
        with _tf.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
            tmp.write(wrapper)
            tmp_path = tmp.name

        try:
            proc = _sp.run(
                ["python3", tmp_path, _json.dumps(invoke_input)],
                capture_output=True, text=True, timeout=10,
                env={"PATH": "/usr/bin:/usr/local/bin"}
            )
            if proc.returncode != 0:
                exec_error = proc.stderr[:500] if proc.stderr else "Execution failed"
            else:
                try:
                    exec_output = _json.loads(proc.stdout)
                except _json.JSONDecodeError:
                    exec_output = {"status": "executed", "output": proc.stdout.strip()}
        finally:
            import os as _os
            _os.unlink(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        exec_error = str(e)

    func_obj.last_invoked_at = datetime.now(timezone.utc)
    func_obj.invoke_count = (func_obj.invoke_count or 0) + 1

    await db.commit()
    await db.refresh(func_obj)

    response = {
        "function_id": str(func_obj.id),
        "function_name": func_obj.name,
        "runtime": func_obj.runtime,
        "invoke_count": func_obj.invoke_count,
        "invoked_at": func_obj.last_invoked_at.isoformat() if func_obj.last_invoked_at else None,
        "input": invoke_input,
    }

    if exec_error:
        response["output"] = {"status": "error", "error": exec_error}
    else:
        response["output"] = exec_output

    return response


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
