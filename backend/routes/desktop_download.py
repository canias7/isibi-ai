from __future__ import annotations

"""
Desktop download routes — generate downloadable Electron-wrapped desktop apps.

Approach: copy a generic Electron shell template, inject the project's deployed
URL and name into the config files, generate a simple icon, and return a zip.
The user unzips and runs start.command (Mac) or start.bat (Windows).
"""

import io
import json
import logging
import os
import struct
import uuid
import zipfile
import zlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id
from db import get_db
from models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter(tags=["desktop-download"])

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "electron_template"


def _generate_icon_png(letter: str, bg_color: tuple[int, int, int] = (0, 0, 0)) -> bytes:
    """
    Generate a minimal 64x64 PNG icon — a colored square with a white letter
    rendered as a simple bitmap font. No Pillow dependency needed.
    """
    width, height = 64, 64
    r, g, b = bg_color

    # Simple 8x8 bitmap font for uppercase letters (enough for an icon)
    FONT: dict[str, list[int]] = {
        "A": [0x3C, 0x42, 0x42, 0x7E, 0x42, 0x42, 0x42, 0x00],
        "B": [0x7C, 0x42, 0x7C, 0x42, 0x42, 0x42, 0x7C, 0x00],
        "C": [0x3C, 0x42, 0x40, 0x40, 0x40, 0x42, 0x3C, 0x00],
        "D": [0x78, 0x44, 0x42, 0x42, 0x42, 0x44, 0x78, 0x00],
        "E": [0x7E, 0x40, 0x7C, 0x40, 0x40, 0x40, 0x7E, 0x00],
        "F": [0x7E, 0x40, 0x7C, 0x40, 0x40, 0x40, 0x40, 0x00],
        "G": [0x3C, 0x42, 0x40, 0x4E, 0x42, 0x42, 0x3C, 0x00],
        "H": [0x42, 0x42, 0x7E, 0x42, 0x42, 0x42, 0x42, 0x00],
        "I": [0x3E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x3E, 0x00],
        "J": [0x1E, 0x04, 0x04, 0x04, 0x04, 0x44, 0x38, 0x00],
        "K": [0x42, 0x44, 0x78, 0x44, 0x42, 0x42, 0x42, 0x00],
        "L": [0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x7E, 0x00],
        "M": [0x42, 0x66, 0x5A, 0x42, 0x42, 0x42, 0x42, 0x00],
        "N": [0x42, 0x62, 0x52, 0x4A, 0x46, 0x42, 0x42, 0x00],
        "O": [0x3C, 0x42, 0x42, 0x42, 0x42, 0x42, 0x3C, 0x00],
        "P": [0x7C, 0x42, 0x42, 0x7C, 0x40, 0x40, 0x40, 0x00],
        "Q": [0x3C, 0x42, 0x42, 0x42, 0x4A, 0x44, 0x3A, 0x00],
        "R": [0x7C, 0x42, 0x42, 0x7C, 0x44, 0x42, 0x42, 0x00],
        "S": [0x3C, 0x42, 0x40, 0x3C, 0x02, 0x42, 0x3C, 0x00],
        "T": [0x7F, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00],
        "U": [0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x3C, 0x00],
        "V": [0x42, 0x42, 0x42, 0x42, 0x24, 0x24, 0x18, 0x00],
        "W": [0x42, 0x42, 0x42, 0x42, 0x5A, 0x66, 0x42, 0x00],
        "X": [0x42, 0x42, 0x24, 0x18, 0x24, 0x42, 0x42, 0x00],
        "Y": [0x41, 0x22, 0x14, 0x08, 0x08, 0x08, 0x08, 0x00],
        "Z": [0x7E, 0x02, 0x04, 0x18, 0x20, 0x40, 0x7E, 0x00],
    }
    default_glyph = [0x7E, 0x42, 0x42, 0x42, 0x42, 0x42, 0x7E, 0x00]

    glyph = FONT.get(letter.upper(), default_glyph)

    # Build raw RGBA pixel data
    pixels = bytearray()
    # Scale: glyph is 8x8, icon is 64x64, so scale=8. Center the letter.
    scale = 4
    glyph_w, glyph_h = 8 * scale, 8 * scale
    ox = (width - glyph_w) // 2
    oy = (height - glyph_h) // 2

    for y in range(height):
        pixels.append(0)  # PNG filter byte: None
        for x in range(width):
            gy = (y - oy) // scale
            gx = (x - ox) // scale
            if 0 <= gy < 8 and 0 <= gx < 8 and (glyph[gy] >> (7 - gx)) & 1:
                pixels.extend([255, 255, 255, 255])  # white letter
            else:
                pixels.extend([r, g, b, 255])  # bg color

    # Build minimal PNG manually (no Pillow)
    def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        chunk = chunk_type + data
        return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png += _png_chunk(b"IHDR", ihdr_data)
    # IDAT
    compressed = zlib.compress(bytes(pixels), 9)
    png += _png_chunk(b"IDAT", compressed)
    # IEND
    png += _png_chunk(b"IEND", b"")

    return png


# Deterministic color from string
def _color_from_name(name: str) -> tuple[int, int, int]:
    """Generate a pleasant color from a project name."""
    colors = [
        (59, 130, 246),   # blue
        (139, 92, 246),   # purple
        (236, 72, 153),   # pink
        (245, 158, 11),   # amber
        (16, 185, 129),   # emerald
        (239, 68, 68),    # red
        (20, 184, 166),   # teal
        (99, 102, 241),   # indigo
    ]
    h = sum(ord(c) for c in name) % len(colors)
    return colors[h]


@router.post("/projects/{project_id}/download/desktop")
async def generate_desktop_app(
    project_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a downloadable desktop app (Electron wrapper) for a deployed project.

    Returns a zip file containing the Electron source, config, launcher scripts,
    and a generated icon. The user unzips and runs start.command (Mac) or
    start.bat (Windows) to launch their app.
    """
    # 1. Validate project_id
    try:
        pid = uuid.UUID(project_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format.",
        )

    # 2. Get the project and verify ownership
    result = await db.execute(select(Project).where(Project.id == pid))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if project.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your project.")

    # 3. Ensure it has a spec (built)
    if not project.spec:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project has no build. Generate an app first.",
        )

    # 4. Determine app name and deployed URL
    spec = project.spec if isinstance(project.spec, dict) else {}
    app_name = spec.get("app_name") or spec.get("name") or project.name or "My App"
    safe_name = "".join(c if c.isalnum() or c in " -_" else "" for c in app_name).strip() or "MyApp"
    folder_name = safe_name.replace(" ", "-")

    app_host = os.getenv("APP_HOST", "")
    deploy_url = (
        f"{app_host}/live/{project_id}" if app_host
        else f"https://api.isibi.ai/live/{project_id}"
    )

    # 5. Read template files
    if not TEMPLATE_DIR.exists():
        raise HTTPException(
            status_code=500,
            detail="Electron template not found on server.",
        )

    template_package = (TEMPLATE_DIR / "package.json").read_text()
    template_main = (TEMPLATE_DIR / "main.js").read_text()

    # 6. Customize package.json
    package_json = template_package.replace("APP_NAME_PLACEHOLDER", safe_name)
    # Also set the npm package name (lowercase, no spaces)
    pkg_name = safe_name.lower().replace(" ", "-").replace("_", "-")
    package_json = package_json.replace('"isibi-app"', f'"{pkg_name}"')

    # 7. Create app-config.json
    app_config = json.dumps(
        {
            "url": deploy_url,
            "name": app_name,
            "width": 1280,
            "height": 800,
        },
        indent=2,
    )

    # 8. Generate icon
    color = _color_from_name(app_name)
    initial = app_name[0] if app_name else "A"
    icon_png = _generate_icon_png(initial, color)

    # 9. Create launcher scripts
    start_command = (
        '#!/bin/bash\n'
        'cd "$(dirname "$0")"\n'
        'echo "Installing dependencies (first run only)..."\n'
        'npm install --production 2>/dev/null\n'
        'echo "Launching app..."\n'
        'npx electron .\n'
    )

    start_bat = (
        '@echo off\r\n'
        'cd /d "%~dp0"\r\n'
        'echo Installing dependencies (first run only)...\r\n'
        'npm install --production 2>nul\r\n'
        'echo Launching app...\r\n'
        'npx electron .\r\n'
    )

    readme_txt = (
        f"{app_name} - Desktop App\n"
        f"{'=' * (len(app_name) + 14)}\n\n"
        "Requirements:\n"
        "  - Node.js 18+ (https://nodejs.org)\n\n"
        "How to launch:\n"
        "  Mac/Linux: Double-click start.command (or run it in Terminal)\n"
        "  Windows:   Double-click start.bat\n\n"
        "What happens:\n"
        "  1. Dependencies are installed automatically on first run\n"
        "  2. Your app opens in its own desktop window\n"
        "  3. It connects to your live isibi.ai deployment\n\n"
        "To build a standalone .app / .exe (optional):\n"
        "  npm install\n"
        "  npm run build-mac   (creates macOS .dmg)\n"
        "  npm run build-win   (creates Windows installer)\n\n"
        f"App URL: {deploy_url}\n"
        "Powered by isibi.ai\n"
    )

    # 10. Build zip in memory
    # macOS .app bundle paths
    app_bundle = f"{folder_name}/{safe_name}.app/"
    app_contents = f"{app_bundle}Contents/"
    app_macos = f"{app_contents}MacOS/"
    app_resources = f"{app_contents}Resources/"

    info_plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleName</key>
    <string>{app_name}</string>
    <key>CFBundleDisplayName</key>
    <string>{app_name}</string>
    <key>CFBundleIdentifier</key>
    <string>ai.isibi.{pkg_name}</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>'''

    launcher_script = f'''#!/bin/bash
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$DIR"
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies (first run only)..."
    npm install --production 2>/dev/null
fi
npx electron .
'''

    prefix = f"{folder_name}/"
    electron_prefix = f"{prefix}electron/"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Electron files (in subfolder for advanced users)
        zf.writestr(f"{electron_prefix}package.json", package_json)
        zf.writestr(f"{electron_prefix}main.js", template_main)
        zf.writestr(f"{electron_prefix}app-config.json", app_config)
        zf.writestr(f"{electron_prefix}icon.png", icon_png)
        zf.writestr(f"{electron_prefix}start.bat", start_bat)

        # start.command with executable permissions
        sc_info = zipfile.ZipInfo(f"{electron_prefix}start.command")
        sc_info.external_attr = 0o755 << 16
        zf.writestr(sc_info, start_command)

        # macOS .app bundle (primary — double-click this)
        zf.writestr(f"{app_contents}Info.plist", info_plist)
        zf.writestr(f"{app_resources}icon.png", icon_png)
        zf.writestr(f"{app_resources}app-config.json", app_config)

        # Launcher with executable permissions
        launcher_info = zipfile.ZipInfo(f"{app_macos}launcher")
        launcher_info.external_attr = 0o755 << 16
        zf.writestr(launcher_info, launcher_script)

        # README at root
        zf.writestr(f"{prefix}README.txt", readme_txt)

    buf.seek(0)
    zip_bytes = buf.getvalue()

    logger.info(
        "Generated desktop app zip for project %s (%s): %d bytes",
        project_id, app_name, len(zip_bytes),
    )

    # 11. Return as downloadable zip
    filename = f"{folder_name}.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(zip_bytes)),
        },
    )
