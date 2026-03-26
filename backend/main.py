import sys
import os

# Ensure the backend directory is on the import path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


@app.get("/health")
async def health():
    return {"status": "ok"}
