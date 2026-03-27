from __future__ import annotations

import sys
import os

# Ensure the backend directory is on the import path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import asyncio
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.responses import Response, RedirectResponse
from starlette.requests import Request as StarletteRequest
from fastapi.responses import HTMLResponse
from db import engine, Base, async_session
from middleware.rate_limiter import RateLimiterMiddleware
from middleware.request_logger import RequestLoggerMiddleware
from middleware.cache import ResponseCacheMiddleware
from utils.errors import global_exception_handler
from router_registry import register_all_routers

# Import all models so Base.metadata knows every table
import models  # noqa: F401
from models.gallery_entry import GalleryEntry  # noqa: F401
from models.referral import Referral  # noqa: F401
from models.webhook import Webhook  # noqa: F401
from models.api_key import ApiKey  # noqa: F401
from models.user_preference import UserPreference  # noqa: F401
from models.app_translation import AppTranslation  # noqa: F401
from models.plugin import Plugin, ProjectPlugin  # noqa: F401
from models.component import SharedComponent  # noqa: F401
from models.review import Review  # noqa: F401
from models.app_analytics import AppEvent  # noqa: F401
from models.push_subscription import PushSubscription, PushNotificationLog  # noqa: F401
from models.serverless_function import ServerlessFunction  # noqa: F401
from models.app_email_trigger import AppEmailTrigger  # noqa: F401
from models.app_scheduled_report import AppScheduledReport  # noqa: F401
from models.app_webhook_trigger import AppWebhookTrigger  # noqa: F401
from models.app_role import AppRole  # noqa: F401
from models.app_activity_entry import AppActivityEntry  # noqa: F401
from models.app_record_comment import AppRecordComment  # noqa: F401
from models.app_record_file import AppRecordFile  # noqa: F401
from models.marketplace_template import MarketplaceTemplate, MarketplaceRating  # noqa: F401
from models.app_embed import AppEmbed  # noqa: F401
from models.app_auto_assign_rule import AppAutoAssignRule  # noqa: F401
from models.app_deadline_reminder import AppDeadlineReminder  # noqa: F401
from models.app_status_rule import AppStatusRule  # noqa: F401
from models.app_duplicate_rule import AppDuplicateRule  # noqa: F401
from models.app_message import AppMessage  # noqa: F401
from models.app_email import AppEmail  # noqa: F401
from models.app_snapshot import AppSnapshot  # noqa: F401
from models.app_view_config import AppViewConfig  # noqa: F401
from models.app_workflow import AppWorkflow  # noqa: F401
from models.app_shared_view import AppSharedView  # noqa: F401
from models.app_record_lock import AppRecordLock  # noqa: F401
from models.app_record_view import AppRecordView  # noqa: F401
from models.app_integration import AppIntegration  # noqa: F401
from models.sso_config import SSOConfig  # noqa: F401
from models.app_field_file import AppFieldFile  # noqa: F401
from models.app_signature import AppSignature  # noqa: F401
from models.app_custom_report import AppCustomReport  # noqa: F401
from models.app_goal import AppGoal  # noqa: F401
from models.app_funnel import AppFunnel  # noqa: F401
from models.app_dashboard_widget import AppDashboardWidget  # noqa: F401
from models.app_session import AppSession  # noqa: F401

logger = logging.getLogger(__name__)

# Track app start time for uptime calculation
import time as _time
_APP_START_TIME = _time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT ''"))
            await conn.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN CREATE TYPE account_type AS ENUM ('user', 'developer'); END IF; END $$"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type account_type NOT NULL DEFAULT 'user'"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ"))
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT false"))
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE"))
            await conn.execute(text("ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS file_data TEXT"))
            await conn.execute(text("ALTER TABLE app_field_files ADD COLUMN IF NOT EXISTS file_data TEXT"))
            await conn.execute(text("ALTER TABLE app_record_files ADD COLUMN IF NOT EXISTS file_data TEXT"))
            print("ALL COLUMNS MIGRATED")
        except Exception as e:
            print(f"MIGRATION NOTE: {e}")
        await conn.run_sync(Base.metadata.create_all)
    print("ALL TABLES CREATED")

    # Load verified custom domains into in-memory index
    from routes.custom_domain_ssl import load_verified_domains
    async with async_session() as session:
        await load_verified_domains(session)

    # Start background scheduler
    from worker.scheduler import run_scheduler
    scheduler_task = asyncio.create_task(run_scheduler())

    yield

    # Graceful shutdown
    logger.info("Server shutting down gracefully")
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass

    # Close all schema connection pools
    from generator.app_db import close_all_pools
    await close_all_pools()

    await engine.dispose()
    logger.info("Database engine closed")


app = FastAPI(
    title="CRM API",
    version="1.0.0",
    description="Multi-tenant CRM backend API",
    lifespan=lifespan,
)

# CORS
_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Response caching (must be before rate limiter so cached responses skip it)
app.add_middleware(ResponseCacheMiddleware)

# Rate limiting
app.add_middleware(RateLimiterMiddleware)

# Request logging
app.add_middleware(RequestLoggerMiddleware)

# Global exception handler
app.add_exception_handler(Exception, global_exception_handler)

# ── Custom Domain Middleware ──
from routes.custom_domain_ssl import get_project_id_for_domain

_SKIP_HOSTS = {
    "localhost", "127.0.0.1", "0.0.0.0",
    "apps.isibi.ai", "isibi.ai", "www.isibi.ai",
    "isibi-backend.onrender.com",
    "testserver", "test",
}


@app.middleware("http")
async def custom_domain_middleware(request: StarletteRequest, call_next):
    """If the Host header matches a registered custom domain, serve that project's HTML."""
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if (
        host in _SKIP_HOSTS
        or request.url.path.startswith("/api")
        or request.url.path.startswith("/ws")
        or request.url.path.startswith("/live")
        or request.url.path.startswith("/health")
    ):
        return await call_next(request)

    project_id = get_project_id_for_domain(host)
    if project_id:
        data = await _get_build_data(project_id)
        if data and "index_html" in data:
            return HTMLResponse(content=data["index_html"])

    return await call_next(request)


# ── Register all routers via the registry ──
register_all_routers(app)

# ── Serve uploaded files ──
_uploads_dir = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(__file__), "uploads")))
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


# ── API v1 versioning redirect ──


@app.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def v1_redirect(path: str, request: StarletteRequest):
    """Redirect /api/v1/* to /api/* for forward-compatible API versioning."""
    query = str(request.query_params)
    target = f"/api/{path}"
    if query:
        target += f"?{query}"
    return RedirectResponse(url=target, status_code=307)


@app.get("/health")
async def health():
    import time as _t
    from middleware.cache import _cache as _cache_store
    from generator.app_db import _schema_pools

    # Check DB connectivity
    db_status = "connected"
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_status = "disconnected"

    # Count registered routes
    routes_count = len(app.routes)

    # Cache entries
    cache_entries = len(_cache_store)

    # Active DB pools
    active_pools = len(_schema_pools)

    return {
        "status": "ok",
        "version": app.version,
        "uptime_seconds": int(_t.time() - _APP_START_TIME),
        "database": db_status,
        "routes_count": routes_count,
        "cache_entries": cache_entries,
        "active_pools": active_pools,
    }


# ── Serve deployed apps ──
from generator.deployer import BUILDS_DIR
import json as _json
from sqlalchemy import select as sa_select
from models.project import Project as ProjectModel


async def _get_build_data(project_id: str) -> dict | None:
    """Get build data from DB (stored in build_path as JSON)."""
    import uuid as _uuid
    try:
        pid = _uuid.UUID(str(project_id))
    except (ValueError, AttributeError):
        return None
    try:
        async with async_session() as session:
            result = await session.execute(
                sa_select(ProjectModel.build_path).where(
                    ProjectModel.id == pid,
                    ProjectModel.status == "deployed",
                    ProjectModel.deleted_at.is_(None),
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return None
            return _json.loads(row)
    except Exception:
        return None


async def _resolve_subdomain_to_project_id(subdomain: str) -> str | None:
    try:
        async with async_session() as session:
            result = await session.execute(
                sa_select(ProjectModel.id).where(
                    ProjectModel.subdomain == subdomain.lower(),
                    ProjectModel.status == "deployed",
                    ProjectModel.deleted_at.is_(None),
                )
            )
            pid = result.scalar_one_or_none()
            return str(pid) if pid else None
    except Exception:
        return None


@app.get("/live/s/{subdomain}", response_class=HTMLResponse)
async def serve_live_app_by_subdomain(subdomain: str):
    project_id = await _resolve_subdomain_to_project_id(subdomain)
    if not project_id:
        return HTMLResponse(
            content="<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
            "<div style='text-align:center'><h2>App not found</h2><p style='color:#888'>No app is linked to this subdomain.</p></div></body></html>",
            status_code=404,
        )
    data = await _get_build_data(project_id)
    if not data or "index_html" not in data:
        return HTMLResponse(
            content="<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
            "<div style='text-align:center'><h2>App not found</h2><p style='color:#888'>This app has not been deployed yet.</p></div></body></html>",
            status_code=404,
        )
    return HTMLResponse(content=data["index_html"])


@app.get("/live/{project_id}", response_class=HTMLResponse)
async def serve_live_app(project_id: str):
    data = await _get_build_data(project_id)
    if not data or "index_html" not in data:
        return HTMLResponse(
            content="<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
            "<div style='text-align:center'><h2>App not found</h2><p style='color:#888'>This app has not been deployed yet.</p></div></body></html>",
            status_code=404,
        )
    return HTMLResponse(content=data["index_html"])


@app.get("/live/{project_id}/manifest.json")
async def serve_manifest(project_id: str):
    data = await _get_build_data(project_id)
    if not data or "manifest_json" not in data:
        return Response(content="{}", media_type="application/json", status_code=404)
    return Response(content=data["manifest_json"], media_type="application/manifest+json")


@app.get("/live/{project_id}/sw.js")
async def serve_sw(project_id: str):
    data = await _get_build_data(project_id)
    if not data or "sw_js" not in data:
        return Response(content="", media_type="application/javascript", status_code=404)
    return Response(content=data["sw_js"], media_type="application/javascript")


@app.get("/live/{project_id}/icon.svg")
async def serve_icon(project_id: str):
    data = await _get_build_data(project_id)
    if not data or "icon_svg" not in data:
        return Response(content="", media_type="image/svg+xml", status_code=404)
    return Response(content=data["icon_svg"], media_type="image/svg+xml")


@app.get("/embed/{project_id}", response_class=HTMLResponse)
async def serve_embed_app(project_id: str):
    build_path = BUILDS_DIR / project_id / "index.html"
    if not build_path.exists():
        return HTMLResponse(
            content="<html><body><h1>App not found</h1>"
            "<p>This app has not been deployed yet.</p></body></html>",
            status_code=404,
        )

    app_html = build_path.read_text(encoding="utf-8")

    embed_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Embedded App</title>
<style>
  html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: auto; }}
</style>
</head>
<body>
{app_html}
<script>
// postMessage API for cross-origin communication
(function() {{
  window.addEventListener('message', function(event) {{
    if (event.data && event.data.type === 'isibi_ping') {{
      event.source.postMessage({{ type: 'isibi_pong', projectId: '{project_id}' }}, event.origin);
    }}
  }});
  if (window.parent !== window) {{
    window.parent.postMessage({{ type: 'isibi_embed_ready', projectId: '{project_id}' }}, '*');
  }}
}})();
</script>
</body>
</html>"""

    response = HTMLResponse(content=embed_html)
    response.headers["X-Frame-Options"] = "ALLOWALL"
    response.headers["Content-Security-Policy"] = "frame-ancestors *"
    return response
