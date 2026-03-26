import sys
import os

# Ensure the backend directory is on the import path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from db import engine, Base, async_session
from routes import all_routers

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
            print("ALL COLUMNS MIGRATED")
        except Exception as e:
            print(f"MIGRATION NOTE: {e}")
        await conn.run_sync(Base.metadata.create_all)
    print("ALL TABLES CREATED")
    yield
    await engine.dispose()


app = FastAPI(
    title="CRM API",
    version="1.0.0",
    description="Multi-tenant CRM backend API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# ── Serve uploaded files ──
_uploads_dir = Path(os.getenv("UPLOADS_DIR", os.path.join(os.path.dirname(__file__), "uploads")))
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Serve deployed apps via path-based routing ──
# /live/{project_id} serves the generated app's index.html
from fastapi import Path as FastAPIPath
from fastapi.responses import HTMLResponse
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
from starlette.responses import Response


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
