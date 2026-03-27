"""Shared test fixtures."""
import os
import sys
import asyncio
import pytest
from httpx import AsyncClient, ASGITransport

# Ensure dotenv is loaded before any imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Disable rate limiting during tests
os.environ["TESTING"] = "1"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def _ensure_tables():
    """Create / migrate DB tables before tests."""
    try:
        from db import engine, Base
        from sqlalchemy import text
        import models  # noqa
        # Import models that main.py imports explicitly
        for mod_name in [
            "models.gallery_entry", "models.referral", "models.webhook",
            "models.api_key", "models.plugin", "models.component",
            "models.review", "models.app_analytics", "models.file_upload",
            "models.marketplace_template", "models.push_subscription",
            "models.serverless_function", "models.app_embed",
            "models.sso_config", "models.app_view_config",
        ]:
            try:
                __import__(mod_name)
            except ImportError:
                pass

        async with engine.begin() as conn:
            # Drop and recreate all tables to ensure schema is up to date
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        print("[conftest] Tables recreated OK")
    except Exception as e:
        print(f"[conftest] Table creation warning: {e}")
    yield


@pytest.fixture
async def client():
    """Provide an async HTTP test client.

    Dispose and recreate the DB engine pool so that asyncpg connections
    are bound to the *current* event loop (avoids 'attached to a different
    loop' errors that previously required xfail markers).
    """
    from db import engine

    # Dispose the old pool (connections tied to a previous loop iteration)
    await engine.dispose()

    from main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
