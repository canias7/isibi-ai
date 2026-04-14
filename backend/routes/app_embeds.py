from __future__ import annotations

"""
Embeddable Widgets — generate embed codes for forms, tables, charts, stat cards.

Endpoints (auth required):
  POST   /api/projects/{project_id}/embeds              — create embed
  GET    /api/projects/{project_id}/embeds              — list embeds
  GET    /api/projects/{project_id}/embeds/{embed_id}   — get embed + snippet
  DELETE /api/projects/{project_id}/embeds/{embed_id}   — remove embed

Public (no auth):
  GET    /embed/{embed_id}.js                           — serve widget JS
"""

import json
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_embed import AppEmbed
from models.project import Project

router = APIRouter(tags=["app-embeds"])

# A second router for the public embed JS endpoint (no auth)
public_router = APIRouter(tags=["app-embeds-public"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateEmbedBody(BaseModel):
    type: str  # form, table, chart, stat_card
    entity: str
    fields: Optional[List[str]] = None
    submit_text: Optional[str] = "Submit"
    success_message: Optional[str] = "Submitted successfully!"
    style: Optional[str] = "minimal"
    title: Optional[str] = None
    chart_type: Optional[str] = None  # bar, line, pie (for chart type)
    stat_field: Optional[str] = None  # for stat_card


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project(db: AsyncSession, project_id: str, org_id: uuid.UUID) -> Project:
    pid = uuid.UUID(project_id)
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
    return project


def _generate_embed_snippet(embed_id: str) -> dict:
    """Generate the HTML/JS embed snippet."""
    html_snippet = (
        f'<script src="https://api.isibi.ai/embed/{embed_id}.js"></script>\n'
        f'<div id="isibi-embed-{embed_id}"></div>'
    )
    return {"html": html_snippet}


def _serialize_embed(embed: AppEmbed) -> dict:
    eid = str(embed.id)
    return {
        "id": eid,
        "project_id": str(embed.project_id),
        "type": embed.type,
        "entity": embed.entity,
        "config": embed.config,
        "snippet": _generate_embed_snippet(eid),
        "created_at": embed.created_at.isoformat() if embed.created_at else None,
    }


def _render_form_js(embed: AppEmbed) -> str:
    config = embed.config or {}
    fields = config.get("fields", [])
    submit_text = config.get("submit_text", "Submit")
    success_message = config.get("success_message", "Submitted successfully!")
    entity = embed.entity
    style = config.get("style", "minimal")
    eid = str(embed.id)

    fields_html = ""
    for f in fields:
        fields_html += (
            f'<div style="margin-bottom:12px;">'
            f'<label style="display:block;font-size:14px;margin-bottom:4px;color:#374151;">{f}</label>'
            f'<input name="{f}" type="text" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;" />'
            f'</div>'
        )

    return f"""(function(){{
  var container = document.getElementById('isibi-embed-{eid}');
  if (!container) return;
  container.innerHTML = '<form id="isibi-form-{eid}" style="max-width:480px;font-family:system-ui,-apple-system,sans-serif;padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">'
    + '<h3 style="margin:0 0 16px;font-size:18px;color:#111827;">{entity}</h3>'
    + '{fields_html}'
    + '<button type="submit" style="width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;">{submit_text}</button>'
    + '<div id="isibi-msg-{eid}" style="display:none;margin-top:12px;padding:10px;background:#d1fae5;color:#065f46;border-radius:6px;font-size:14px;"></div>'
    + '</form>';
  var form = document.getElementById('isibi-form-{eid}');
  form.addEventListener('submit', function(e) {{
    e.preventDefault();
    var msg = document.getElementById('isibi-msg-{eid}');
    msg.textContent = '{success_message}';
    msg.style.display = 'block';
    form.reset();
  }});
}})();"""


def _render_table_js(embed: AppEmbed) -> str:
    config = embed.config or {}
    fields = config.get("fields", [])
    entity = embed.entity
    eid = str(embed.id)

    headers = "".join(f"<th style='padding:10px 14px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:13px;color:#6b7280;text-transform:uppercase;'>{f}</th>" for f in fields)
    sample_row = "".join(f"<td style='padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;'>—</td>" for f in fields)

    return f"""(function(){{
  var container = document.getElementById('isibi-embed-{eid}');
  if (!container) return;
  container.innerHTML = '<div style="font-family:system-ui,-apple-system,sans-serif;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;">'
    + '<div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;"><h3 style="margin:0;font-size:16px;color:#111827;">{entity}</h3></div>'
    + '<table style="width:100%;border-collapse:collapse;"><thead><tr>{headers}</tr></thead>'
    + '<tbody><tr>{sample_row}</tr></tbody></table>'
    + '<div style="padding:12px 20px;text-align:center;color:#9ca3af;font-size:13px;">Connect your data source to populate this table</div>'
    + '</div>';
}})();"""


def _render_chart_js(embed: AppEmbed) -> str:
    config = embed.config or {}
    entity = embed.entity
    eid = str(embed.id)
    chart_type = config.get("chart_type", "bar")

    return f"""(function(){{
  var container = document.getElementById('isibi-embed-{eid}');
  if (!container) return;
  container.innerHTML = '<div style="font-family:system-ui,-apple-system,sans-serif;padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;text-align:center;">'
    + '<h3 style="margin:0 0 16px;font-size:16px;color:#111827;">{entity} — {chart_type} chart</h3>'
    + '<div style="height:200px;display:flex;align-items:flex-end;justify-content:center;gap:8px;padding:0 20px;">'
    + '<div style="width:40px;background:#2563eb;border-radius:4px 4px 0 0;height:60%;"></div>'
    + '<div style="width:40px;background:#3b82f6;border-radius:4px 4px 0 0;height:80%;"></div>'
    + '<div style="width:40px;background:#60a5fa;border-radius:4px 4px 0 0;height:45%;"></div>'
    + '<div style="width:40px;background:#93c5fd;border-radius:4px 4px 0 0;height:90%;"></div>'
    + '<div style="width:40px;background:#bfdbfe;border-radius:4px 4px 0 0;height:55%;"></div>'
    + '</div>'
    + '<p style="margin:12px 0 0;color:#9ca3af;font-size:13px;">Sample data — connect your data source</p>'
    + '</div>';
}})();"""


def _render_stat_card_js(embed: AppEmbed) -> str:
    config = embed.config or {}
    entity = embed.entity
    eid = str(embed.id)
    stat_field = config.get("stat_field", "count")

    return f"""(function(){{
  var container = document.getElementById('isibi-embed-{eid}');
  if (!container) return;
  container.innerHTML = '<div style="font-family:system-ui,-apple-system,sans-serif;padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;text-align:center;min-width:200px;">'
    + '<div style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">{entity}</div>'
    + '<div style="font-size:36px;font-weight:700;color:#111827;margin:8px 0;">—</div>'
    + '<div style="font-size:13px;color:#9ca3af;">{stat_field}</div>'
    + '</div>';
}})();"""


def _render_embed_js(embed: AppEmbed) -> str:
    embed_type = embed.type
    if embed_type == "form":
        return _render_form_js(embed)
    elif embed_type == "table":
        return _render_table_js(embed)
    elif embed_type == "chart":
        return _render_chart_js(embed)
    elif embed_type == "stat_card":
        return _render_stat_card_js(embed)
    else:
        eid = str(embed.id)
        return f"""(function(){{
  var c = document.getElementById('isibi-embed-{eid}');
  if(c) c.innerHTML = '<p>Unsupported embed type</p>';
}})();"""


# ---------------------------------------------------------------------------
# Authenticated endpoints
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/embeds", status_code=201)
async def create_embed(
    project_id: str,
    body: CreateEmbedBody,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create an embeddable widget for a project entity."""
    project = await _get_project(db, project_id, org_id)

    if body.type not in ("form", "table", "chart", "stat_card"):
        raise HTTPException(status_code=400, detail="type must be one of: form, table, chart, stat_card")

    config = {
        "fields": body.fields or [],
        "submit_text": body.submit_text,
        "success_message": body.success_message,
        "style": body.style,
        "title": body.title,
        "chart_type": body.chart_type,
        "stat_field": body.stat_field,
    }

    embed = AppEmbed(
        project_id=project.id,
        org_id=org_id,
        type=body.type,
        entity=body.entity,
        config=config,
    )
    db.add(embed)
    await db.commit()
    await db.refresh(embed)

    return _serialize_embed(embed)


@router.get("/projects/{project_id}/embeds")
async def list_embeds(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all embeds for a project."""
    project = await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppEmbed)
        .where(AppEmbed.project_id == project.id, AppEmbed.org_id == org_id)
        .order_by(AppEmbed.created_at.desc())
    )
    embeds = result.scalars().all()
    return {"embeds": [_serialize_embed(e) for e in embeds]}


@router.get("/projects/{project_id}/embeds/{embed_id}")
async def get_embed(
    project_id: str,
    embed_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get embed details including the generated HTML/JS snippet."""
    await _get_project(db, project_id, org_id)
    eid = uuid.UUID(embed_id)

    result = await db.execute(
        select(AppEmbed).where(
            AppEmbed.id == eid,
            AppEmbed.project_id == uuid.UUID(project_id),
            AppEmbed.org_id == org_id,
        )
    )
    embed = result.scalar_one_or_none()
    if not embed:
        raise HTTPException(status_code=404, detail="Embed not found")

    return _serialize_embed(embed)


@router.delete("/projects/{project_id}/embeds/{embed_id}", status_code=204)
async def delete_embed(
    project_id: str,
    embed_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Remove an embed."""
    await _get_project(db, project_id, org_id)
    eid = uuid.UUID(embed_id)

    result = await db.execute(
        select(AppEmbed).where(
            AppEmbed.id == eid,
            AppEmbed.project_id == uuid.UUID(project_id),
            AppEmbed.org_id == org_id,
        )
    )
    embed = result.scalar_one_or_none()
    if not embed:
        raise HTTPException(status_code=404, detail="Embed not found")

    await db.delete(embed)
    await db.commit()


# ---------------------------------------------------------------------------
# Public endpoint — serve embed JS (no auth)
# ---------------------------------------------------------------------------

@public_router.get("/embed/{embed_id}.js")
async def serve_embed_js(
    embed_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: returns JavaScript that renders the embedded widget."""
    eid = uuid.UUID(embed_id)
    result = await db.execute(select(AppEmbed).where(AppEmbed.id == eid))
    embed = result.scalar_one_or_none()
    if not embed:
        return Response(
            content="/* Embed not found */",
            media_type="application/javascript",
            status_code=404,
        )

    js_code = _render_embed_js(embed)
    return Response(content=js_code, media_type="application/javascript")
