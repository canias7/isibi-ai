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


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def _ensure_tables():
    """Create missing DB tables before tests."""
    try:
        from db import engine, Base
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
            await conn.run_sync(Base.metadata.create_all)
        print("[conftest] Tables created OK")
    except Exception as e:
        print(f"[conftest] Table creation warning: {e}")
    yield


@pytest.fixture
async def client():
    from main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
