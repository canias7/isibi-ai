"""
Ghost Mode download proxy — serves release assets from private GitHub repo.
"""
from __future__ import annotations
import os
import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse, JSONResponse

router = APIRouter(tags=["ghost-download"])

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
REPO = "canias7/isibi-ai"


@router.get("/ghost-mode/download/{platform}")
async def ghost_download(platform: str):
    """Download Ghost Mode for a platform: mac, win, linux"""
    filenames = {
        "mac": "ISIBI-Ghost-Mode-macOS.zip",
        "win": "ISIBI-Ghost-Mode-Setup.exe",
        "linux": "ISIBI-Ghost-Mode.AppImage",
    }
    filename = filenames.get(platform)
    if not filename:
        return JSONResponse({"error": "Invalid platform. Use: mac, win, linux"}, 400)

    # Get latest release assets from GitHub API
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        # Get latest release
        resp = await client.get(
            f"https://api.github.com/repos/{REPO}/releases/latest",
            headers=headers,
        )
        if resp.status_code != 200:
            return JSONResponse({"error": "Could not fetch release info"}, 502)

        release = resp.json()
        asset = next((a for a in release.get("assets", []) if a["name"] == filename), None)
        if not asset:
            return JSONResponse({"error": f"{filename} not found in latest release"}, 404)

        # Download the asset
        download_headers = {
            "Accept": "application/octet-stream",
        }
        if GITHUB_TOKEN:
            download_headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

        asset_resp = await client.get(asset["url"], headers=download_headers)
        if asset_resp.status_code != 200:
            return JSONResponse({"error": "Could not download asset"}, 502)

        content_type = "application/zip" if platform == "mac" else "application/octet-stream"
        return StreamingResponse(
            iter([asset_resp.content]),
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Length": str(len(asset_resp.content)),
            },
        )
