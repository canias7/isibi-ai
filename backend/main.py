from __future__ import annotations

import sys
import os

# Ensure the backend directory is on the import path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from fastapi import Path as FastAPIPath
from fastapi.responses import HTMLResponse
from db import engine, Base, async_session
from routes import all_routers
from middleware.rate_limiter import RateLimiterMiddleware
from utils.errors import global_exception_handler

# Import all models so Base.metadata knows every table
import models  # noqa: F401

# Import new models so Base.metadata picks up their tables
from models.gallery_entry import GalleryEntry  # noqa: F401
from models.referral import Referral  # noqa: F401
from models.webhook import Webhook  # noqa: F401
from models.api_key import ApiKey  # noqa: F401
from models.user_preference import UserPreference  # noqa: F401
from models.app_translation import AppTranslation  # noqa: F401

# Import new route modules
from routes.gallery import router as gallery_router
from routes.referrals import router as referrals_router
from routes.embed import router as embed_router
from routes.webhooks import router as webhooks_router
from routes.api_keys import router as api_keys_router
from routes.preferences import router as preferences_router
from routes.suggestions import router as suggestions_router
from routes.auto_fix import router as auto_fix_router
from routes.i18n import router as i18n_router

# Import new feature models so Base.metadata picks up their tables
from models.plugin import Plugin, ProjectPlugin  # noqa: F401
from models.component import SharedComponent  # noqa: F401
from models.review import Review  # noqa: F401
from models.app_analytics import AppEvent  # noqa: F401
from models.push_subscription import PushSubscription, PushNotificationLog  # noqa: F401
from models.serverless_function import ServerlessFunction  # noqa: F401
from models.app_email_trigger import AppEmailTrigger  # noqa: F401
from models.app_scheduled_report import AppScheduledReport  # noqa: F401
from models.app_webhook_trigger import AppWebhookTrigger  # noqa: F401

# Import new feature routers
from routes.plugins import router as plugins_router, project_plugins_router
from routes.components import router as components_router
from routes.cloning import router as cloning_router
from routes.reviews import router as reviews_router
from routes.app_analytics import router as app_analytics_router
from routes.db_gui import router as db_gui_router
from routes.push_notifications import router as push_notifications_router
from routes.serverless import router as serverless_router
from routes.billing_check import router as billing_check_router
from routes.app_subdomain import router as app_subdomain_router
from routes.app_ai_chat import router as app_ai_chat_router
from routes.app_dashboard import router as app_dashboard_router
from routes.app_branding import router as app_branding_router
from routes.app_email_triggers import router as app_email_triggers_router
from routes.app_scheduled_reports import router as app_scheduled_reports_router
from routes.app_webhook_config import router as app_webhook_config_router

# Import new app feature models
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

# Import embeds public router (no auth, mounted without /api prefix)
from routes.app_embeds import public_router as app_embeds_public_router

# Import new app feature routers
from routes.app_roles import router as app_roles_router
from routes.app_import_wizard import router as app_import_wizard_router
from routes.app_activity_log import router as app_activity_log_router
from routes.app_record_comments import router as app_record_comments_router
from routes.app_record_files import router as app_record_files_router
from routes.app_auto_assign import router as app_auto_assign_router
from routes.app_deadline_reminders import router as app_deadline_reminders_router
from routes.app_status_rules import router as app_status_rules_router
from routes.app_duplicate_detection import router as app_duplicate_detection_router
from routes.app_messaging import router as app_messaging_router
from routes.app_email_inbox import router as app_email_inbox_router
from routes.app_snapshots import router as app_snapshots_router
from routes.app_ui_language import router as app_ui_language_router

# Import form/input feature models
from models.app_field_file import AppFieldFile  # noqa: F401
from models.app_signature import AppSignature  # noqa: F401

# Import 12-feature batch models
from models.app_custom_report import AppCustomReport  # noqa: F401
from models.app_goal import AppGoal  # noqa: F401
from models.app_funnel import AppFunnel  # noqa: F401
from models.app_dashboard_widget import AppDashboardWidget  # noqa: F401
from models.app_session import AppSession  # noqa: F401

# Import 12-feature batch routers (features 1-6)
from routes.app_report_builder import router as app_report_builder_router
from routes.app_goals import router as app_goals_router
from routes.app_funnels import router as app_funnels_router
from routes.app_cohorts import router as app_cohorts_router
from routes.app_excel_export import router as app_excel_export_router
from routes.app_dashboard_builder import router as app_dashboard_builder_router

# Import 12-feature batch routers (features 7-12)
from routes.app_ip_whitelist import router as app_ip_whitelist_router
from routes.app_encryption import router as app_encryption_router
from routes.app_gdpr import router as app_gdpr_router
from routes.app_sessions import router as app_sessions_router
from routes.app_google_sheets import router as app_google_sheets_router
from routes.app_2fa import router as app_2fa_router

# Import form/input feature routers
from routes.app_multistep_forms import router as app_multistep_forms_router
from routes.app_field_files import router as app_field_files_router
from routes.app_signatures import router as app_signatures_router
from routes.app_qr_codes import router as app_qr_codes_router
from routes.app_barcode import router as app_barcode_router
from routes.app_voice_config import router as app_voice_config_router
from routes.app_field_types import router as app_field_types_router
from routes.app_view_configs import router as app_view_configs_router
from routes.app_workflows import router as app_workflows_router
from routes.app_collaboration import router as app_collaboration_router
from routes.app_integrations import router as app_integrations_router
from routes.file_serve import router as file_serve_router

# Import collaborative editing & enterprise feature routers
from routes.collab_editing import router as collab_editing_router, ws_router as collab_ws_router
from routes.custom_domain_ssl import router as custom_domain_ssl_router
from routes.custom_domain_ssl import get_project_id_for_domain
from routes.enterprise_sso import router as enterprise_sso_router
from routes.app_uptime import router as app_uptime_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        # One-time: add missing auth columns to users table
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT ''"))
            await conn.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN CREATE TYPE account_type AS ENUM ('user', 'developer'); END IF; END $$"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type account_type NOT NULL DEFAULT 'user'"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ"))
            # Add missing columns to projects table
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT"))
            # Add missing columns to users table for 2FA
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT false"))
            # Add subdomain column to projects table
            await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE"))
            # Add file_data column for cloud file storage (replaces disk storage)
            await conn.execute(text("ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS file_data TEXT"))
            await conn.execute(text("ALTER TABLE app_field_files ADD COLUMN IF NOT EXISTS file_data TEXT"))
            await conn.execute(text("ALTER TABLE app_record_files ADD COLUMN IF NOT EXISTS file_data TEXT"))
            print("ALL COLUMNS MIGRATED")
        except Exception as e:
            print(f"MIGRATION NOTE: {e}")
        # NOTE: Alembic is the preferred way to manage schema changes (adding/removing
        # columns, renaming tables, etc.).  Run `alembic revision --autogenerate -m "desc"`
        # then `alembic upgrade head`.  The create_all below is kept as a fallback so that
        # brand-new deployments still get every table on first boot.
        await conn.run_sync(Base.metadata.create_all)
    print("ALL TABLES CREATED")

    # Start background scheduler
    from worker.scheduler import run_scheduler
    scheduler_task = asyncio.create_task(run_scheduler())

    yield

    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()


app = FastAPI(
    title="CRM API",
    version="1.0.0",
    description="Multi-tenant CRM backend API",
    lifespan=lifespan,
)

# CORS — configurable via ALLOWED_ORIGINS env var (comma-separated).
# Defaults to * for development; set to specific origins in production.
_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting — must be added after CORS so preflight OPTIONS requests
# are handled before rate limiting kicks in.
app.add_middleware(RateLimiterMiddleware)

# Global exception handler — returns structured JSON, never raw stack traces
app.add_exception_handler(Exception, global_exception_handler)

# ── Custom Domain Middleware ──
# Resolves custom domains via the Host header and serves the matching project

_SKIP_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "apps.isibi.ai", "testserver", "test"}


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

for router in all_routers:
    app.include_router(router, prefix="/api")

# Register new feature routers
app.include_router(gallery_router, prefix="/api")
app.include_router(referrals_router, prefix="/api")
app.include_router(embed_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(api_keys_router, prefix="/api")
app.include_router(preferences_router, prefix="/api")
app.include_router(suggestions_router, prefix="/api")
app.include_router(auto_fix_router, prefix="/api")
app.include_router(i18n_router, prefix="/api")

# Register new feature routers
app.include_router(plugins_router, prefix="/api")
app.include_router(project_plugins_router, prefix="/api")
app.include_router(components_router, prefix="/api")
app.include_router(cloning_router, prefix="/api")
app.include_router(reviews_router, prefix="/api")
app.include_router(app_analytics_router)  # Uses raw /api paths internally
app.include_router(db_gui_router, prefix="/api")
app.include_router(push_notifications_router)  # Uses raw /api paths internally
app.include_router(serverless_router, prefix="/api")
app.include_router(billing_check_router, prefix="/api")
app.include_router(app_subdomain_router, prefix="/api")
app.include_router(app_ai_chat_router, prefix="/api")
app.include_router(app_dashboard_router, prefix="/api")
app.include_router(app_branding_router, prefix="/api")
app.include_router(app_email_triggers_router, prefix="/api")
app.include_router(app_scheduled_reports_router, prefix="/api")
app.include_router(app_webhook_config_router, prefix="/api")

# Register new app feature routers
app.include_router(app_roles_router, prefix="/api")
app.include_router(app_import_wizard_router, prefix="/api")
app.include_router(app_activity_log_router, prefix="/api")
app.include_router(app_record_comments_router, prefix="/api")
app.include_router(app_record_files_router, prefix="/api")
app.include_router(app_auto_assign_router, prefix="/api")
app.include_router(app_deadline_reminders_router, prefix="/api")
app.include_router(app_status_rules_router, prefix="/api")
app.include_router(app_duplicate_detection_router, prefix="/api")
app.include_router(app_messaging_router, prefix="/api")
app.include_router(app_email_inbox_router, prefix="/api")
app.include_router(app_snapshots_router, prefix="/api")
app.include_router(app_ui_language_router, prefix="/api")

# Register form/input feature routers
app.include_router(app_multistep_forms_router, prefix="/api")
app.include_router(app_field_files_router, prefix="/api")
app.include_router(app_signatures_router, prefix="/api")
app.include_router(app_qr_codes_router, prefix="/api")
app.include_router(app_barcode_router, prefix="/api")
app.include_router(app_voice_config_router, prefix="/api")
app.include_router(app_field_types_router, prefix="/api")
app.include_router(app_view_configs_router, prefix="/api")
app.include_router(app_workflows_router, prefix="/api")
app.include_router(app_collaboration_router, prefix="/api")
app.include_router(app_integrations_router, prefix="/api")

# Register file serve router (serves files from DB)
app.include_router(file_serve_router, prefix="/api")

# Register collaborative editing & enterprise feature routers
app.include_router(collab_editing_router, prefix="/api")
app.include_router(collab_ws_router)  # WebSocket at /ws/projects/{id}, no /api prefix
app.include_router(custom_domain_ssl_router, prefix="/api")
app.include_router(enterprise_sso_router, prefix="/api")
app.include_router(app_uptime_router, prefix="/api")

# Register 12-feature batch routers
app.include_router(app_report_builder_router, prefix="/api")
app.include_router(app_goals_router, prefix="/api")
app.include_router(app_funnels_router, prefix="/api")
app.include_router(app_cohorts_router, prefix="/api")
app.include_router(app_excel_export_router, prefix="/api")
app.include_router(app_dashboard_builder_router, prefix="/api")
app.include_router(app_ip_whitelist_router, prefix="/api")
app.include_router(app_encryption_router, prefix="/api")
app.include_router(app_gdpr_router, prefix="/api")
app.include_router(app_sessions_router, prefix="/api")
app.include_router(app_google_sheets_router, prefix="/api")
app.include_router(app_2fa_router, prefix="/api")

# Register embeddable widgets public router (serves JS at /embed/{id}.js, no auth)
app.include_router(app_embeds_public_router)

# ── Serve uploaded files ──
_uploads_dir = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(__file__), "uploads")))
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Serve deployed apps via path-based routing ──
# /live/{project_id} serves the generated app's index.html
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
    """Look up a project ID by its custom subdomain."""
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
    """Serve a deployed app by its custom subdomain slug."""
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
    """Serve a deployed app's generated HTML from DB."""
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


# ── Serve embeddable apps via iframe-friendly route ──
# /embed/{project_id} serves the deployed app without X-Frame-Options
# and includes a postMessage API for cross-origin communication.


@app.get("/embed/{project_id}", response_class=HTMLResponse)
async def serve_embed_app(project_id: str):
    """Serve a deployed app in an embeddable iframe-friendly page."""
    build_path = BUILDS_DIR / project_id / "index.html"
    if not build_path.exists():
        return HTMLResponse(
            content="<html><body><h1>App not found</h1>"
            "<p>This app has not been deployed yet.</p></body></html>",
            status_code=404,
        )

    app_html = build_path.read_text(encoding="utf-8")

    # Wrap app HTML with postMessage API for cross-origin communication
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
  // Notify parent that embed is ready
  if (window.parent !== window) {{
    window.parent.postMessage({{ type: 'isibi_embed_ready', projectId: '{project_id}' }}, '*');
  }}
}})();
</script>
</body>
</html>"""

    response = HTMLResponse(content=embed_html)
    # Remove X-Frame-Options to allow iframe embedding
    response.headers["X-Frame-Options"] = "ALLOWALL"
    response.headers["Content-Security-Policy"] = "frame-ancestors *"
    return response
