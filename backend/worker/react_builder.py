"""
Background React project builder.

After a project is deployed (HTML version served instantly), this worker
builds the React project in the background. When done, the /live/{id}
route auto-switches to serving the React version.
"""

import asyncio
import logging
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

BUILDS_DIR = Path(os.getenv("BUILDS_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "builds")))
GENERATED_DIR = Path(os.getenv("GENERATED_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "generated")))

# In-memory build status: project_id → "pending" | "building" | "ready" | "failed"
_react_build_status: dict[str, str] = {}

BUILD_TIMEOUT = 300  # 5 minutes max


def get_react_build_status(project_id: str) -> str:
    return _react_build_status.get(project_id, "none")


def get_react_build_path(project_id: str) -> Path | None:
    """Return the path to the built React dist if it exists."""
    react_dir = BUILDS_DIR / project_id / "react"
    index = react_dir / "index.html"
    if index.exists():
        return react_dir
    return None


async def build_react_project(project_id: str):
    """Build a React project in the background.

    Runs npm install + vite build on the generated frontend project.
    Copies the built dist/ to builds/{project_id}/react/.
    """
    frontend_dir = GENERATED_DIR / project_id / "frontend"
    if not frontend_dir.exists():
        logger.warning("No frontend dir for project %s — skipping React build", project_id)
        _react_build_status[project_id] = "failed"
        return

    _react_build_status[project_id] = "building"
    logger.info("Starting React build for project %s", project_id)

    try:
        # Run npm install
        result = await asyncio.to_thread(
            subprocess.run,
            ["npm", "install", "--production=false"],
            cwd=str(frontend_dir),
            capture_output=True,
            text=True,
            timeout=BUILD_TIMEOUT // 2,
        )
        if result.returncode != 0:
            logger.error("npm install failed for %s: %s", project_id, result.stderr[:500])
            _react_build_status[project_id] = "failed"
            return

        # Run vite build
        result = await asyncio.to_thread(
            subprocess.run,
            ["npx", "vite", "build"],
            cwd=str(frontend_dir),
            capture_output=True,
            text=True,
            timeout=BUILD_TIMEOUT // 2,
        )
        if result.returncode != 0:
            logger.error("vite build failed for %s: %s", project_id, result.stderr[:500])
            _react_build_status[project_id] = "failed"
            return

        # Copy dist/ to builds/{project_id}/react/
        dist_dir = frontend_dir / "dist"
        if not dist_dir.exists():
            logger.error("No dist/ directory after build for %s", project_id)
            _react_build_status[project_id] = "failed"
            return

        react_build_dir = BUILDS_DIR / project_id / "react"
        if react_build_dir.exists():
            shutil.rmtree(react_build_dir)
        shutil.copytree(str(dist_dir), str(react_build_dir))

        _react_build_status[project_id] = "ready"
        logger.info("React build complete for project %s — dist at %s", project_id, react_build_dir)

    except subprocess.TimeoutExpired:
        logger.error("React build timed out for %s", project_id)
        _react_build_status[project_id] = "failed"
    except FileNotFoundError:
        logger.error("npm/npx not found — React build skipped for %s", project_id)
        _react_build_status[project_id] = "failed"
    except Exception as e:
        logger.error("React build failed for %s: %s", project_id, e)
        _react_build_status[project_id] = "failed"


def trigger_react_build(project_id: str):
    """Trigger a React build in the background (non-blocking)."""
    if _react_build_status.get(project_id) == "building":
        return  # Already building

    _react_build_status[project_id] = "pending"

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(build_react_project(project_id))
        else:
            loop.run_until_complete(build_react_project(project_id))
    except RuntimeError:
        # No event loop — use asyncio.run in a thread
        import threading
        threading.Thread(
            target=lambda: asyncio.run(build_react_project(project_id)),
            daemon=True,
        ).start()
