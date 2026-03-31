from __future__ import annotations

"""
Deploy routes — trigger deployments, check status, and serve deployed apps.
"""

import json
import logging
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id
from db import get_db
from models.project import Project
from generator.deployer import deploy_app, BUILDS_DIR

logger = logging.getLogger(__name__)

router = APIRouter(tags=["deploy"])


class DeployRequest(BaseModel):
    force: bool = False


@router.post("/projects/{project_id}/deploy")
async def trigger_deploy(
    project_id: str,
    body: DeployRequest = DeployRequest(),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger a deploy for a project. Generates the frontend build from the
    project's spec, saves it to builds/, and returns the live URL.
    """
    # Validate project_id format
    try:
        pid = uuid.UUID(project_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid project ID format: {project_id}",
        )

    # Fetch the project
    try:
        result = await db.execute(
            select(Project).where(
                Project.id == pid,
                Project.user_id == user_id,
                Project.deleted_at.is_(None),
            )
        )
        project = result.scalar_one_or_none()
    except Exception as e:
        logger.error("DB error fetching project %s: %s", project_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while fetching project.",
        )

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not project.spec:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This project hasn't been built yet. Start a chat to build it.",
        )

    # If already deployed and has build data, return existing URL without re-building
    # Unless force=True (re-deploy after spec changes)
    if project.status == "deployed" and project.build_path and not body.force:
        import os
        app_host = os.getenv("APP_HOST", "")
        existing_url = (
            f"{app_host}/live/{project_id}" if app_host
            else f"https://api.isibi.ai/live/{project_id}"
        )
        result = {
            "project_id": str(project.id),
            "status": "deployed",
            "url": existing_url,
        }
        if project.subdomain:
            sub_url = (
                f"{app_host}/live/s/{project.subdomain}" if app_host
                else f"https://api.isibi.ai/live/s/{project.subdomain}"
            )
            result["subdomain_url"] = sub_url
        return result

    # Ensure database schema exists for this project
    try:
        from generator.app_db import create_app_schema, get_schema_name
        schema_name = get_schema_name(str(project.id))
        await create_app_schema(str(project.id), project.spec, os.getenv("DATABASE_URL", ""))
        logger.info("Ensured app schema exists: %s", schema_name)
    except Exception as e:
        logger.warning("Schema creation during deploy (non-fatal): %s", e)

    # Insert seed data if available (first deploy only)
    try:
        from generator.app_db import _get_raw_connection, get_schema_name
        spec_data = project.spec if isinstance(project.spec, dict) else {}
        entities = spec_data.get("entities", [])
        schema_name = get_schema_name(str(project.id))
        project_org = str(project.org_id) if project.org_id else None

        for entity in entities:
            seed = entity.get("_seed_data", [])
            if not seed or not isinstance(seed, list):
                continue
            table = entity.get("table", entity.get("name", "").lower().replace(" ", "_"))
            try:
                conn = await _get_raw_connection(os.getenv("DATABASE_URL", ""))
                try:
                    # Check if table already has data
                    count = await conn.fetchval(f'SELECT COUNT(*) FROM "{schema_name}"."{table}" WHERE "deleted_at" IS NULL')
                    if count and count > 0:
                        continue  # Already has data, skip seed

                    for row in seed[:10]:
                        if not isinstance(row, dict):
                            continue
                        if project_org:
                            row["org_id"] = project_org
                        cols = ", ".join(f'"{k}"' for k in row.keys())
                        placeholders = ", ".join(f"${i+1}" for i in range(len(row)))
                        values = [str(v) for v in row.values()]
                        await conn.execute(
                            f'INSERT INTO "{schema_name}"."{table}" ({cols}) VALUES ({placeholders})',
                            *values,
                        )
                    logger.info("Inserted %d seed records into %s.%s", len(seed), schema_name, table)
                finally:
                    await conn.close()
            except Exception as e:
                logger.debug("Seed data insert for %s failed (non-fatal): %s", table, e)
    except Exception as e:
        logger.debug("Seed data phase failed (non-fatal): %s", e)

    # Deploy
    try:
        deploy_info = await deploy_app(
            project_id=str(project.id),
            spec=project.spec,
            db=db,
        )
    except Exception as e:
        logger.error(
            "Deploy failed for project %s: %s\n%s",
            project_id, e, traceback.format_exc(),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Deployment failed. Please try building again.",
        )

    # Record deploy history in spec._deploy_history
    try:
        spec = project.spec if isinstance(project.spec, dict) else {}
        history = spec.get("_deploy_history", [])
        history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "success",
            "url": deploy_info.get("url", ""),
        })
        # Cap at 20 entries
        if len(history) > 20:
            history = history[-20:]
        spec["_deploy_history"] = history
        project.spec = spec
        await db.commit()
    except Exception as e:
        logger.warning("Failed to record deploy history: %s", e)

    # Create notification for deploy
    try:
        from models.notification import PlatformNotification
        notif = PlatformNotification(
            user_id=user_id,
            org_id=project.org_id,
            type="deploy",
            title="App Deployed",
            body=f"Your app '{project.name}' has been deployed!",
            action_url=deploy_info.get("url", ""),
        )
        db.add(notif)
        await db.commit()
    except Exception as e:
        logger.warning("Failed to create deploy notification: %s", e)

    return deploy_info


@router.post("/projects/{project_id}/restart")
async def restart_app(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Restart (force-redeploy) an app."""
    body = DeployRequest(force=True)
    return await trigger_deploy(project_id, body, user_id, db)


@router.get("/projects/{project_id}/deploy/status")
async def deploy_status(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the deploy status and live URL for a project.
    """
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.user_id == user_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    is_deployed = project.status == "deployed" and project.build_path

    import os
    if is_deployed:
        app_host = os.getenv("APP_HOST", "")
        url = (
            f"{app_host}/live/{project_id}" if app_host
            else f"https://api.isibi.ai/live/{project_id}"
        )
    else:
        url = None

    subdomain_url = None
    if is_deployed and project.subdomain:
        subdomain_url = (
            f"{app_host}/live/s/{project.subdomain}" if app_host
            else f"https://api.isibi.ai/live/s/{project.subdomain}"
        )

    return {
        "project_id": str(project.id),
        "status": project.status,
        "deployed": is_deployed,
        "url": url,
        "subdomain_url": subdomain_url,
        "build_path": project.build_path,
    }


@router.get("/projects/{project_id}/deploy/history")
async def deploy_history(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the deploy history for a project (last 5 entries)."""
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.user_id == user_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    spec = project.spec if isinstance(project.spec, dict) else {}
    history = spec.get("_deploy_history", [])
    # Return last 5 entries
    return {"history": history[-5:]}


def _verify_admin(request) -> None:
    """Verify admin access: check API key and optionally IP allowlist."""
    admin_key = os.getenv("ADMIN_KEY", "")
    if not admin_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access not configured")
    provided = request.headers.get("x-admin-key", "") or request.query_params.get("key", "")
    if not provided or provided != admin_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin key")
    # IP allowlist (optional)
    allowed_ips = os.getenv("ADMIN_ALLOWED_IPS", "")
    if allowed_ips:
        client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip()
        if client_ip not in [ip.strip() for ip in allowed_ips.split(",") if ip.strip()]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IP not allowed")


@router.post("/admin/redeploy-all")
async def admin_redeploy_all(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Admin: re-deploy ALL deployed projects. Protected by admin key + IP allowlist."""
    _verify_admin(request)

    results = await db.execute(
        select(Project).where(
            Project.status == "deployed",
            Project.spec.isnot(None),
            Project.deleted_at.is_(None),
        )
    )
    projects = results.scalars().all()
    
    redeployed = []
    errors = []
    for project in projects:
        try:
            deploy_info = await deploy_app(
                project_id=str(project.id),
                spec=project.spec,
                db=db,
            )
            redeployed.append({"id": str(project.id), "name": project.name, "url": deploy_info.get("url", "")})
        except Exception as e:
            errors.append({"id": str(project.id), "name": project.name, "error": str(e)})
    
    return {"redeployed": len(redeployed), "errors": len(errors), "projects": redeployed, "failed": errors}


@router.post("/admin/create-schemas")
async def admin_create_schemas(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create database schemas for all deployed projects. Protected by admin key."""
    _verify_admin(request)
    from generator.app_db import create_app_schema, get_schema_name
    from db import DATABASE_URL

    results = await db.execute(
        select(Project).where(
            Project.spec.isnot(None),
            Project.deleted_at.is_(None),
        )
    )
    projects = results.scalars().all()

    created = []
    skipped = []
    errors = []
    for project in projects:
        try:
            schema_name = get_schema_name(str(project.id))
            spec = project.spec if isinstance(project.spec, dict) else {}
            if not spec.get("entities"):
                skipped.append(str(project.id))
                continue
            await create_app_schema(str(project.id), spec, DATABASE_URL)
            created.append({"id": str(project.id), "schema": schema_name})
        except Exception as e:
            if "already exists" in str(e).lower():
                skipped.append(str(project.id))
            else:
                errors.append({"id": str(project.id), "error": str(e)})

    return {"created": len(created), "skipped": len(skipped), "errors": len(errors), "details": created, "failed": errors}
