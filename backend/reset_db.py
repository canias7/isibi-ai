"""Drop all tables and types, then let the app recreate them on startup."""
from __future__ import annotations
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from sqlalchemy import text
from db import engine


async def reset():
    async with engine.begin() as conn:
        # Drop all tables, views, types in public schema
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("GRANT ALL ON SCHEMA public TO PUBLIC"))
    await engine.dispose()
    print("Database wiped. Tables will be created on app startup.")


if __name__ == "__main__":
    asyncio.run(reset())
