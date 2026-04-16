from __future__ import annotations

"""
Plugin System — browse, install, and configure plugins for projects.
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
from models.plugin import Plugin, ProjectPlugin

router = APIRouter(prefix="/plugins", tags=["plugins"])
project_plugins_router = APIRouter(prefix="/projects", tags=["project-plugins"])


# ── Seed Plugins ──────────────────────────────────────────────────────────────

SEED_PLUGINS = [
    {
        "name": "Stripe Checkout",
        "description": "Add a Stripe-powered payment button to your app. Supports one-time and subscription payments with customizable pricing.",
        "category": "payments",
        "icon": "credit-card",
        "is_official": True,
        "config_schema": {
            "stripe_public_key": {"type": "string", "label": "Stripe Public Key", "required": True},
            "price_id": {"type": "string", "label": "Stripe Price ID", "required": True},
            "success_url": {"type": "string", "label": "Success URL", "required": False},
            "cancel_url": {"type": "string", "label": "Cancel URL", "required": False},
        },
        "code_snippet": '<script src="https://js.stripe.com/v3/"></script>\n<button id="stripe-checkout-btn" class="btn btn-primary">Pay Now</button>\n<script>\nconst stripe = Stripe(window.__PLUGIN_CONFIG__.stripe_public_key);\ndocument.getElementById("stripe-checkout-btn").addEventListener("click", async () => {\n  const res = await fetch("/api/create-checkout-session", { method: "POST" });\n  const { sessionId } = await res.json();\n  await stripe.redirectToCheckout({ sessionId });\n});\n</script>',
    },
    {
        "name": "Google Maps",
        "description": "Embed an interactive Google Map with markers, search, and directions into your application.",
        "category": "maps",
        "icon": "map-pin",
        "is_official": True,
        "config_schema": {
            "api_key": {"type": "string", "label": "Google Maps API Key", "required": True},
            "default_lat": {"type": "number", "label": "Default Latitude", "required": False},
            "default_lng": {"type": "number", "label": "Default Longitude", "required": False},
            "zoom": {"type": "number", "label": "Default Zoom Level", "required": False},
        },
        "code_snippet": '<div id="google-map" style="width:100%;height:400px;"></div>\n<script>\nfunction initMap() {\n  const cfg = window.__PLUGIN_CONFIG__;\n  const map = new google.maps.Map(document.getElementById("google-map"), {\n    center: { lat: cfg.default_lat || 40.7128, lng: cfg.default_lng || -74.0060 },\n    zoom: cfg.zoom || 12,\n  });\n}\n</script>\n<script src="https://maps.googleapis.com/maps/api/js?key={{api_key}}&callback=initMap" async defer></script>',
    },
    {
        "name": "Chart Widget",
        "description": "Add beautiful, responsive data visualization charts (bar, line, pie, doughnut) powered by Chart.js.",
        "category": "data",
        "icon": "bar-chart",
        "is_official": True,
        "config_schema": {
            "chart_type": {"type": "string", "label": "Chart Type", "required": True, "options": ["bar", "line", "pie", "doughnut"]},
            "data_source_url": {"type": "string", "label": "Data Source API URL", "required": False},
            "title": {"type": "string", "label": "Chart Title", "required": False},
        },
        "code_snippet": '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n<canvas id="plugin-chart" width="400" height="200"></canvas>\n<script>\nconst cfg = window.__PLUGIN_CONFIG__;\nconst ctx = document.getElementById("plugin-chart").getContext("2d");\nnew Chart(ctx, {\n  type: cfg.chart_type || "bar",\n  data: { labels: ["Jan","Feb","Mar","Apr"], datasets: [{ label: cfg.title || "Data", data: [12, 19, 3, 5] }] },\n});\n</script>',
    },
    {
        "name": "Contact Form",
        "description": "A ready-to-use contact form that sends submissions via email. Includes validation, spam protection, and customizable fields.",
        "category": "forms",
        "icon": "mail",
        "is_official": True,
        "config_schema": {
            "recipient_email": {"type": "string", "label": "Recipient Email", "required": True},
            "subject_prefix": {"type": "string", "label": "Subject Prefix", "required": False},
            "success_message": {"type": "string", "label": "Success Message", "required": False},
        },
        "code_snippet": '<form id="contact-form" class="space-y-4">\n  <input type="text" name="name" placeholder="Your Name" required class="input" />\n  <input type="email" name="email" placeholder="Your Email" required class="input" />\n  <textarea name="message" placeholder="Your Message" required class="textarea"></textarea>\n  <button type="submit" class="btn btn-primary">Send Message</button>\n</form>\n<script>\ndocument.getElementById("contact-form").addEventListener("submit", async (e) => {\n  e.preventDefault();\n  const formData = new FormData(e.target);\n  await fetch("/api/contact", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)), headers: { "Content-Type": "application/json" } });\n  alert(window.__PLUGIN_CONFIG__.success_message || "Message sent!");\n});\n</script>',
    },
    {
        "name": "Social Login",
        "description": "Add Google and GitHub OAuth login buttons to your app with one click. Supports custom redirect URLs.",
        "category": "auth",
        "icon": "log-in",
        "is_official": True,
        "config_schema": {
            "google_client_id": {"type": "string", "label": "Google Client ID", "required": False},
            "github_client_id": {"type": "string", "label": "GitHub Client ID", "required": False},
            "redirect_url": {"type": "string", "label": "Redirect URL", "required": False},
        },
        "code_snippet": '<div class="social-login-buttons" style="display:flex;gap:12px;">\n  <button onclick="loginWithGoogle()" class="btn btn-outline">Sign in with Google</button>\n  <button onclick="loginWithGithub()" class="btn btn-outline">Sign in with GitHub</button>\n</div>\n<script>\nconst cfg = window.__PLUGIN_CONFIG__;\nfunction loginWithGoogle() { window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.google_client_id}&redirect_uri=${cfg.redirect_url}&response_type=code&scope=email profile`; }\nfunction loginWithGithub() { window.location.href = `https://github.com/login/oauth/authorize?client_id=${cfg.github_client_id}&redirect_uri=${cfg.redirect_url}&scope=user:email`; }\n</script>',
    },
]


# ── Schemas ───────────────────────────────────────────────────────────────────

class PluginCreateBody(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    version: str = "1.0.0"
    config_schema: Optional[dict] = None
    code_snippet: Optional[str] = None
    icon: Optional[str] = None
    is_public: bool = True


class PluginConfigBody(BaseModel):
    config: dict


def _serialize_plugin(p: Plugin) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "category": p.category,
        "author_id": str(p.author_id) if p.author_id else None,
        "version": p.version,
        "config_schema": p.config_schema,
        "code_snippet": p.code_snippet,
        "icon": p.icon,
        "install_count": p.install_count,
        "is_official": p.is_official,
        "is_public": p.is_public,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _serialize_project_plugin(pp: ProjectPlugin, plugin: Plugin) -> dict:
    return {
        "id": str(pp.id),
        "project_id": str(pp.project_id),
        "plugin_id": str(pp.plugin_id),
        "config": pp.config,
        "is_active": pp.is_active,
        "installed_at": pp.installed_at.isoformat() if pp.installed_at else None,
        "plugin": _serialize_plugin(plugin),
    }


# ── Plugin CRUD ───────────────────────────────────────────────────────────────

@router.get("")
async def list_plugins(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List available plugins."""
    query = select(Plugin).where(Plugin.is_public.is_(True))

    if category:
        query = query.where(Plugin.category == category)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(Plugin.name.ilike(term), Plugin.description.ilike(term))
        )

    query = query.order_by(Plugin.install_count.desc())
    result = await db.execute(query)
    plugins = result.scalars().all()

    return {"plugins": [_serialize_plugin(p) for p in plugins]}


@router.get("/{plugin_id}")
async def get_plugin(
    plugin_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get plugin detail."""
    result = await db.execute(
        select(Plugin).where(Plugin.id == uuid.UUID(plugin_id))
    )
    plugin = result.scalar_one_or_none()
    if not plugin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")
    return _serialize_plugin(plugin)


@router.post("", status_code=201)
async def create_plugin(
    body: PluginCreateBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a new plugin (dev accounts)."""
    plugin = Plugin(
        name=body.name,
        description=body.description,
        category=body.category,
        author_id=user_id,
        version=body.version,
        config_schema=body.config_schema,
        code_snippet=body.code_snippet,
        icon=body.icon,
        is_official=False,
        is_public=body.is_public,
    )
    db.add(plugin)
    await db.commit()
    await db.refresh(plugin)
    return _serialize_plugin(plugin)


# ── Project Plugin Management ────────────────────────────────────────────────

@project_plugins_router.get("/{project_id}/plugins")
async def list_project_plugins(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List installed plugins for a project."""
    pid = uuid.UUID(project_id)
    query = (
        select(ProjectPlugin, Plugin)
        .join(Plugin, ProjectPlugin.plugin_id == Plugin.id)
        .where(ProjectPlugin.project_id == pid)
    )
    result = await db.execute(query)
    rows = result.all()

    return {"plugins": [_serialize_project_plugin(pp, plugin) for pp, plugin in rows]}


@project_plugins_router.post("/{project_id}/plugins/{plugin_id}/install", status_code=201)
async def install_plugin(
    project_id: str,
    plugin_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Install a plugin on a project."""
    pid = uuid.UUID(project_id)
    plid = uuid.UUID(plugin_id)

    # Check plugin exists
    result = await db.execute(select(Plugin).where(Plugin.id == plid))
    plugin = result.scalar_one_or_none()
    if not plugin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not found")

    # Check not already installed
    existing = await db.execute(
        select(ProjectPlugin).where(
            ProjectPlugin.project_id == pid,
            ProjectPlugin.plugin_id == plid,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Plugin already installed")

    pp = ProjectPlugin(project_id=pid, plugin_id=plid)
    db.add(pp)

    plugin.install_count = (plugin.install_count or 0) + 1
    await db.commit()
    await db.refresh(pp)

    return _serialize_project_plugin(pp, plugin)


@project_plugins_router.delete("/{project_id}/plugins/{plugin_id}/uninstall")
async def uninstall_plugin(
    project_id: str,
    plugin_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Uninstall a plugin from a project."""
    pid = uuid.UUID(project_id)
    plid = uuid.UUID(plugin_id)

    result = await db.execute(
        select(ProjectPlugin).where(
            ProjectPlugin.project_id == pid,
            ProjectPlugin.plugin_id == plid,
        )
    )
    pp = result.scalar_one_or_none()
    if not pp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not installed")

    await db.delete(pp)
    await db.commit()
    return {"detail": "Plugin uninstalled"}


@project_plugins_router.patch("/{project_id}/plugins/{plugin_id}/config")
async def update_plugin_config(
    project_id: str,
    plugin_id: str,
    body: PluginConfigBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Update plugin config for a project."""
    pid = uuid.UUID(project_id)
    plid = uuid.UUID(plugin_id)

    result = await db.execute(
        select(ProjectPlugin).where(
            ProjectPlugin.project_id == pid,
            ProjectPlugin.plugin_id == plid,
        )
    )
    pp = result.scalar_one_or_none()
    if not pp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plugin not installed")

    pp.config = body.config
    await db.commit()
    await db.refresh(pp)

    # Fetch plugin for serialization
    plugin_result = await db.execute(select(Plugin).where(Plugin.id == plid))
    plugin = plugin_result.scalar_one()

    return _serialize_project_plugin(pp, plugin)
