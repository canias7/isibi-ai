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
    # TEMPORARY: Drop old schema with INTEGER ids, recreate with UUID
    # TODO: Remove the DROP block after first successful deploy
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("GRANT ALL ON SCHEMA public TO PUBLIC"))
        print("OLD SCHEMA DROPPED")
    except Exception as e:
        print(f"Schema drop skipped: {e}")

    async with engine.begin() as conn:
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
