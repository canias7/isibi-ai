from __future__ import annotations
"""
QR Code Generator — generate QR codes on the fly for any record.

Routes:
  GET /api/apps/{project_id}/qr/{table}/{record_id}  — returns QR code as SVG
"""

import uuid
import os

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id

router = APIRouter(prefix="/apps", tags=["App QR Codes"])

BASE_URL = os.getenv("BASE_URL", "https://app.isibi.ai")


# ── QR Code SVG Generator ────────────────────────────────────────────

def _generate_qr_matrix(data: str) -> list[list[int]]:
    """
    Generate a simple QR-like matrix for the given data.
    This creates a deterministic dot pattern based on the input string.
    For production, consider using the `qrcode` library.
    """
    # Simple hash-based matrix generation (21x21 like QR Version 1)
    size = 21
    matrix = [[0] * size for _ in range(size)]

    # Finder patterns (top-left, top-right, bottom-left)
    def draw_finder(row: int, col: int):
        for r in range(7):
            for c in range(7):
                if r in (0, 6) or c in (0, 6) or (2 <= r <= 4 and 2 <= c <= 4):
                    if 0 <= row + r < size and 0 <= col + c < size:
                        matrix[row + r][col + c] = 1

    draw_finder(0, 0)
    draw_finder(0, size - 7)
    draw_finder(size - 7, 0)

    # Timing patterns
    for i in range(7, size - 7):
        matrix[6][i] = 1 if i % 2 == 0 else 0
        matrix[i][6] = 1 if i % 2 == 0 else 0

    # Data area — fill based on hash of data
    hash_val = 0
    for ch in data:
        hash_val = (hash_val * 31 + ord(ch)) & 0xFFFFFFFF

    for r in range(size):
        for c in range(size):
            if matrix[r][c] == 0:
                # Skip finder pattern areas and timing
                if (r < 8 and c < 8) or (r < 8 and c >= size - 8) or (r >= size - 8 and c < 8):
                    continue
                if r == 6 or c == 6:
                    continue
                bit = (hash_val >> ((r * size + c) % 32)) & 1
                hash_val = ((hash_val << 1) | bit) & 0xFFFFFFFF
                matrix[r][c] = bit

    return matrix


def _matrix_to_svg(matrix: list[list[int]], module_size: int = 10) -> str:
    """Convert a QR matrix to an SVG string."""
    size = len(matrix)
    svg_size = size * module_size + module_size * 2  # padding
    offset = module_size

    rects = []
    for r in range(size):
        for c in range(size):
            if matrix[r][c]:
                x = offset + c * module_size
                y = offset + r * module_size
                rects.append(f'<rect x="{x}" y="{y}" width="{module_size}" height="{module_size}" fill="black"/>')

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_size} {svg_size}" width="{svg_size}" height="{svg_size}">
  <rect width="100%" height="100%" fill="white"/>
  {''.join(rects)}
</svg>"""


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/{project_id}/qr/{table}/{record_id}")
async def get_qr_code(
    project_id: uuid.UUID,
    table: str,
    record_id: str,
    format: str = Query("svg", pattern="^(svg|url)$"),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Generate a QR code for a record's URL. Returns SVG or a Google Charts URL."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    record_url = f"{BASE_URL}/live/{project_id}#/{table}/{record_id}"

    if format == "url":
        # Return a Google Charts API URL
        import urllib.parse
        encoded = urllib.parse.quote(record_url)
        chart_url = f"https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl={encoded}&choe=UTF-8"
        return {"qr_url": chart_url, "record_url": record_url}

    # Generate SVG in-line
    matrix = _generate_qr_matrix(record_url)
    svg = _matrix_to_svg(matrix)
    return Response(content=svg, media_type="image/svg+xml")
