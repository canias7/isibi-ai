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
from db import engine, Base
from routes import all_routers

# Import all models so Base.metadata knows every table
import models  # noqa: F401


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
            print("AUTH COLUMNS MIGRATED")
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


@app.get("/live/{project_id}", response_class=HTMLResponse)
async def serve_live_app(project_id: str):
    """Serve a deployed app's generated HTML."""
    build_path = BUILDS_DIR / project_id / "index.html"
    if not build_path.exists():
        return HTMLResponse(
            content="<html><body><h1>App not found</h1>"
            "<p>This app has not been deployed yet.</p></body></html>",
            status_code=404,
        )
    return HTMLResponse(content=build_path.read_text(encoding="utf-8"))
