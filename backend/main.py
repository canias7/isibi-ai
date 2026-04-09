from __future__ import annotations

import sys
import os

# Ensure the backend directory is on the import path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import asyncio
import logging

# ── Logging setup — output to stdout for Render/Docker ──────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.responses import Response, RedirectResponse
from starlette.requests import Request as StarletteRequest
from fastapi.responses import HTMLResponse, Response
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


def _validate_env():
    """Validate required environment variables at startup."""
    is_prod = bool(os.getenv("RENDER"))
    missing_critical = []
    for var in ("DATABASE_URL", "JWT_SECRET", "SMTP_ENCRYPTION_KEY"):
        if not os.getenv(var):
            missing_critical.append(var)
    if is_prod and missing_critical:
        raise RuntimeError(f"CRITICAL: Missing required environment variables in production: {', '.join(missing_critical)}")

    for var in ("ANTHROPIC_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
                "SENDGRID_API_KEY", "RESEND_API_KEY", "CONNECTOR_ENCRYPTION_KEY", "CHAT_ENCRYPTION_KEY"):
        if not os.getenv(var):
            logger.warning("Optional env var %s is not set — related features will be unavailable", var)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_env()
    # Create tables from SQLAlchemy models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All database tables created")

    # Add missing columns if they don't exist (safe to run multiple times)
    async with engine.begin() as conn:
        _missing_cols = [
            'smtp_host VARCHAR', 'smtp_port INTEGER', 'smtp_user VARCHAR',
            'smtp_pass VARCHAR', 'smtp_from VARCHAR', 'smtp_pass_encrypted VARCHAR',
            'totp_secret VARCHAR', 'is_2fa_enabled BOOLEAN DEFAULT FALSE',
            'public_key TEXT',
        ]
        for col in _missing_cols:
            try:
                await conn.execute(text(f"ALTER TABLE ghost_users ADD COLUMN IF NOT EXISTS {col}"))
            except Exception:
                pass
        # Ensure newer ghost_scheduled_tasks columns exist
        try:
            await conn.execute(text(
                "ALTER TABLE ghost_scheduled_tasks "
                "ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'"
            ))
        except Exception:
            pass
        await conn.commit()
    logger.info("Ghost user columns ensured")

    # Run Alembic migrations (idempotent — safe to run on every startup)
    try:
        from alembic.config import Config
        from alembic import command
        import os
        alembic_cfg = Config(os.path.join(os.path.dirname(__file__), "alembic.ini"))
        alembic_cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "alembic"))
        command.upgrade(alembic_cfg, "head")
        logger.info("Alembic migrations applied")
    except Exception as e:
        logger.warning("Migration note: %s", e)

    # Load verified custom domains into in-memory index
    from routes.custom_domain_ssl import load_verified_domains
    async with async_session() as session:
        await load_verified_domains(session)

    # Start background scheduler
    from worker.scheduler import run_scheduler
    scheduler_task = asyncio.create_task(run_scheduler())
    scheduler_task.add_done_callback(
        lambda t: logger.error("Scheduler crashed: %s", t.exception()) if not t.cancelled() and t.exception() else None
    )

    yield

    # Graceful shutdown
    logger.info("Server shutting down gracefully")
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass

    # Close Redis connection
    from utils.redis_client import close_redis
    await close_redis()
    logger.info("Redis connection closed")

    # Close all schema connection pools
    from generator.app_db import close_all_pools
    await close_all_pools()

    await engine.dispose()
    logger.info("Database engine closed")


app = FastAPI(
    title="isibi.ai API",
    version="1.0.0",
    description="API for the isibi.ai no-code app builder",
    lifespan=lifespan,
)

# CORS — default to known origins; never fall back to "*" with credentials
_DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:3000,https://isibi.ai,https://www.isibi.ai,https://isibi-frontend.onrender.com"
_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")
# Strip localhost origins in production
if os.getenv("RENDER"):
    _ALLOWED_ORIGINS = [o for o in _ALLOWED_ORIGINS if "localhost" not in o and "127.0.0.1" not in o]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _ALLOWED_ORIGINS if o.strip() and o.strip() != "*" and o.strip().startswith(("http://", "https://"))],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Preview", "X-Requested-With"],
)

# Security headers middleware
class SecurityHeadersMiddleware:
    """Add standard security headers to all responses."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend([
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"SAMEORIGIN"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (b"content-security-policy", b"default-src 'self'; script-src 'self'; style-src 'self' https:; img-src 'self' https:; connect-src 'self' https:"),
                ])
                # Only add HSTS in production
                if os.getenv("RENDER"):
                    headers.append(
                        (b"strict-transport-security", b"max-age=63072000; includeSubDomains")
                    )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


app.add_middleware(SecurityHeadersMiddleware)

# Response caching (must be before rate limiter so cached responses skip it)
app.add_middleware(ResponseCacheMiddleware)

# ── Request size limit middleware ──
MAX_BODY_SIZE = 10 * 1024 * 1024  # 10MB max request body

class RequestSizeLimitMiddleware:
    """Reject requests with bodies exceeding MAX_BODY_SIZE."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = 0
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"content-length":
                try:
                    content_length = int(header_value)
                except ValueError:
                    pass
                break

        if content_length > MAX_BODY_SIZE:
            from starlette.responses import JSONResponse
            response = JSONResponse({"detail": f"Request body too large. Max {MAX_BODY_SIZE // 1024 // 1024}MB."}, status_code=413)
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)

app.add_middleware(RequestSizeLimitMiddleware)

# CSRF protection — require X-Requested-With header on mutating requests
class CSRFMiddleware:
    """Block cross-origin form submissions by requiring a custom header.

    Browsers don't send custom headers on cross-origin form POSTs,
    so requiring X-Requested-With blocks CSRF without needing tokens.
    Safe methods (GET, HEAD, OPTIONS) and preview/webhook paths are exempt.
    """
    SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
    EXEMPT_PREFIXES = ("/live/", "/health", "/api/intake", "/webhook", "/api/apps/", "/api/billing/", "/api/auth/", "/embed/", "/api/chat", "/api/teams/")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        path = scope.get("path", "")

        if method in self.SAFE_METHODS or any(path.startswith(p) for p in self.EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        # Check for custom header
        headers = dict(scope.get("headers", []))
        has_xhr = b"x-requested-with" in headers
        has_auth = b"authorization" in headers
        has_content = headers.get(b"content-type", b"").startswith(b"application/json")

        # Allow if: has XHR header, has Authorization header (API client), or sends JSON
        if has_xhr or has_auth or has_content:
            await self.app(scope, receive, send)
            return

        # Block — likely a cross-origin form submission
        from starlette.responses import JSONResponse
        response = JSONResponse({"detail": "CSRF validation failed"}, status_code=403)
        await response(scope, receive, send)

app.add_middleware(CSRFMiddleware)

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


class CustomDomainMiddleware:
    """Pure ASGI middleware: if the Host header matches a registered custom domain, serve that project's HTML."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        headers_dict = dict(scope.get("headers", []))
        host_raw = headers_dict.get(b"host", b"").decode()
        host = host_raw.split(":")[0].lower()

        if (
            host in _SKIP_HOSTS
            or path.startswith("/api")
            or path.startswith("/ws")
            or path.startswith("/live")
            or path.startswith("/health")
        ):
            await self.app(scope, receive, send)
            return

        project_id = get_project_id_for_domain(host)
        if project_id:
            data = await _get_build_data(project_id)
            if data and "index_html" in data:
                body = data["index_html"].encode("utf-8")
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        (b"content-type", b"text/html; charset=utf-8"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body})
                return

        await self.app(scope, receive, send)


app.add_middleware(CustomDomainMiddleware)


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
    from utils.redis_client import get_redis

    # Check DB connectivity
    db_status = "connected"
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_status = "disconnected"

    # Check Redis connectivity
    redis_status = "not configured"
    try:
        redis_client = await get_redis()
        if redis_client:
            await redis_client.ping()
            redis_status = "connected"
    except Exception:
        redis_status = "disconnected"

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
        "redis": redis_status,
        "routes_count": routes_count,
        "cache_entries": cache_entries,
        "active_pools": active_pools,
    }


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/.well-known/security.txt", response_class=Response)
async def security_txt():
    from datetime import datetime, timedelta
    expires = (datetime.now() + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    content = f"""Contact: security@gofarther.ai
Preferred-Languages: en
Canonical: https://isibi-backend.onrender.com/.well-known/security.txt
Policy: https://gofarther.ai/security-policy
Expires: {expires}
"""
    return Response(content=content, media_type="text/plain")


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
    except Exception as exc:
        logger.warning("Failed to load build data for project %s: %s", project_id, exc)
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
    except Exception as exc:
        logger.warning("Failed to resolve subdomain %s: %s", subdomain, exc)
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


@app.get("/live/{project_id}/{path:path}")
async def serve_live_app_assets(project_id: str, path: str):
    """Serve React build static assets (JS, CSS, images)."""
    from worker.react_builder import get_react_build_path
    react_dir = get_react_build_path(project_id)
    if react_dir:
        asset_path = react_dir / path
        if asset_path.exists() and asset_path.is_file():
            import mimetypes
            content_type = mimetypes.guess_type(str(asset_path))[0] or "application/octet-stream"
            return Response(content=asset_path.read_bytes(), media_type=content_type)
    # Fall through to 404 for unknown assets
    return Response(status_code=404)


@app.get("/live/{project_id}", response_class=HTMLResponse)
async def serve_live_app(project_id: str):
    # Try React build first (better quality)
    try:
        from worker.react_builder import get_react_build_path
        react_dir = get_react_build_path(project_id)
        if react_dir:
            index_html = (react_dir / "index.html").read_text(encoding="utf-8")
            return HTMLResponse(content=index_html)
    except Exception:
        pass

    # Fallback to deployer HTML
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
    # Validate project_id is a valid UUID to prevent path traversal
    import uuid as _uuid_mod
    try:
        _uuid_mod.UUID(project_id)
    except (ValueError, AttributeError):
        return HTMLResponse(
            content="<html><body><h1>Invalid project ID</h1></body></html>",
            status_code=400,
        )
    build_path = BUILDS_DIR / project_id / "index.html"
    # Ensure resolved path is within BUILDS_DIR
    if not build_path.resolve().is_relative_to(BUILDS_DIR.resolve()):
        return HTMLResponse(
            content="<html><body><h1>Invalid project ID</h1></body></html>",
            status_code=400,
        )
    if not build_path.exists():
        return HTMLResponse(
            content="<html><body><h1>App not found</h1>"
            "<p>This app has not been deployed yet.</p></body></html>",
            status_code=404,
        )

    app_html = build_path.read_text(encoding="utf-8")

    # Use JSON encoding for project_id in JS to prevent template injection
    safe_pid = _json.dumps(str(project_id))

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
  var pid = {safe_pid};
  window.addEventListener('message', function(event) {{
    if (event.data && event.data.type === 'isibi_ping') {{
      event.source.postMessage({{ type: 'isibi_pong', projectId: pid }}, event.origin);
    }}
  }});
  if (window.parent !== window) {{
    window.parent.postMessage({{ type: 'isibi_embed_ready', projectId: pid }}, '*');
  }}
}})();
</script>
</body>
</html>"""

    response = HTMLResponse(content=embed_html)
    response.headers["X-Frame-Options"] = "ALLOWALL"
    response.headers["Content-Security-Policy"] = "frame-ancestors *"
    return response
