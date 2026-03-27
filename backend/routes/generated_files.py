"""Return the list of generated files with content for the CloudIDE."""
from __future__ import annotations

import os
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Generated Files"])

PROJECTS_DIR = os.getenv(
    "PROJECTS_DIR",
    os.path.expanduser("~/Desktop/isibi.ai/generated"),
)

# Extensions we serve in the IDE (skip binary/large files)
_ALLOWED_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html",
    ".txt", ".md", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".env",
    ".sql", ".sh", ".bat",
}

_LANGUAGE_MAP: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "typescript",
    ".jsx": "tsx",
    ".json": "json",
    ".css": "css",
    ".html": "text",
    ".txt": "text",
    ".md": "text",
    ".yml": "text",
    ".yaml": "text",
    ".toml": "text",
    ".sql": "python",
    ".sh": "text",
}

MAX_FILE_SIZE = 256 * 1024  # 256 KB per file


@router.get("/projects/{project_id}/generated-files")
async def get_generated_files(
    project_id: UUID,
    _user_id: UUID = Depends(get_current_user_id),
):
    """Return list of generated files with content for the CloudIDE."""
    project_root = os.path.join(PROJECTS_DIR, str(project_id))

    if not os.path.isdir(project_root):
        raise HTTPException(status_code=404, detail="No generated files found for this project")

    result: list[dict] = []

    for dirpath, _dirnames, filenames in os.walk(project_root):
        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1].lower()
            if ext not in _ALLOWED_EXTENSIONS:
                continue

            full_path = os.path.join(dirpath, fname)

            # Skip files that are too large
            try:
                if os.path.getsize(full_path) > MAX_FILE_SIZE:
                    continue
            except OSError:
                continue

            # Build relative path from project root (e.g. "backend/models/lead.py")
            rel_path = os.path.relpath(full_path, project_root)

            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except (OSError, UnicodeDecodeError):
                continue

            language = _LANGUAGE_MAP.get(ext, "text")
            result.append({
                "path": rel_path,
                "content": content,
                "language": language,
            })

    # Sort: backend first, then frontend, then config files
    def sort_key(item: dict) -> tuple:
        p = item["path"]
        if p.startswith("backend/"):
            return (0, p)
        if p.startswith("frontend/"):
            return (1, p)
        return (2, p)

    result.sort(key=sort_key)
    return result
