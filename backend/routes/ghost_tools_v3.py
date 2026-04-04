"""
Ghost AI Tools V3 — OCR, meme generator, barcode lookup.
"""

from __future__ import annotations
import os
import io
import json
import base64
import uuid
import httpx
from PIL import Image, ImageDraw, ImageFont
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

router = APIRouter(prefix="/ghost/tools/v3", tags=["ghost-tools-v3"])

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")


def _verify_auth(authorization: str):
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    return verify_ghost_token(token)


# ═══════════════════════════════════════════════════════════════════════════
# OCR — Extract text from any image
# ═══════════════════════════════════════════════════════════════════════════

class OCRRequest(BaseModel):
    image_base64: str

@router.post("/ocr")
async def ocr(req: OCRRequest, authorization: str = Header(...)):
    """Extract all text from an image using Claude Vision."""
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "API key not configured")

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image_base64}},
                        {"type": "text", "text": "Extract ALL text from this image. Return the exact text as it appears, preserving formatting and line breaks. If there are multiple sections, separate them clearly. Return ONLY the extracted text, nothing else."},
                    ],
                }],
            },
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "OCR failed")
        data = res.json()
        text = data.get("content", [{}])[0].get("text", "")

    return {"text": text}


# ═══════════════════════════════════════════════════════════════════════════
# MEME GENERATOR
# ═══════════════════════════════════════════════════════════════════════════

class MemeRequest(BaseModel):
    top_text: str
    bottom_text: Optional[str] = ""
    style: Optional[str] = "classic"  # classic, dark, minimal

@router.post("/create-meme")
async def create_meme(req: MemeRequest, authorization: str = Header(...)):
    """Generate a meme image with text."""
    _verify_auth(authorization)

    # Create meme image
    width, height = 600, 600

    if req.style == "dark":
        bg_color = (30, 30, 30)
        text_color = (255, 255, 255)
    elif req.style == "minimal":
        bg_color = (255, 255, 255)
        text_color = (30, 30, 30)
    else:  # classic
        bg_color = (0, 0, 0)
        text_color = (255, 255, 255)

    img = Image.new('RGB', (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    # Try to use a bold font, fallback to default
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 42)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
    except (OSError, IOError):
        try:
            font_large = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", 42)
            font_small = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", 36)
        except (OSError, IOError):
            font_large = ImageFont.load_default()
            font_small = ImageFont.load_default()

    # Draw top text
    top = req.top_text.upper()
    bbox = draw.textbbox((0, 0), top, font=font_large)
    tw = bbox[2] - bbox[0]
    # Word wrap if too wide
    if tw > width - 40:
        words = top.split()
        lines = []
        current = ""
        for w in words:
            test = current + " " + w if current else w
            bbox = draw.textbbox((0, 0), test, font=font_large)
            if bbox[2] - bbox[0] > width - 40:
                lines.append(current)
                current = w
            else:
                current = test
        if current:
            lines.append(current)
    else:
        lines = [top]

    y = 30
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font_large)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        # Shadow
        draw.text((x + 2, y + 2), line, fill=(0, 0, 0), font=font_large)
        draw.text((x, y), line, fill=text_color, font=font_large)
        y += 50

    # Draw bottom text
    if req.bottom_text:
        bottom = req.bottom_text.upper()
        bbox = draw.textbbox((0, 0), bottom, font=font_small)
        tw = bbox[2] - bbox[0]

        if tw > width - 40:
            words = bottom.split()
            lines_b = []
            current = ""
            for w in words:
                test = current + " " + w if current else w
                bbox = draw.textbbox((0, 0), test, font=font_small)
                if bbox[2] - bbox[0] > width - 40:
                    lines_b.append(current)
                    current = w
                else:
                    current = test
            if current:
                lines_b.append(current)
        else:
            lines_b = [bottom]

        y = height - 40 - len(lines_b) * 45
        for line in lines_b:
            bbox = draw.textbbox((0, 0), line, font=font_small)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            draw.text((x + 2, y + 2), line, fill=(0, 0, 0), font=font_small)
            draw.text((x, y), line, fill=text_color, font=font_small)
            y += 45

    # Save to buffer
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    meme_b64 = base64.b64encode(buf.getvalue()).decode()

    # Store in file store
    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    FILE_STORE[file_id] = {"filename": "meme.png", "mime": "image/png", "data": meme_b64, "created": datetime.utcnow().isoformat()}

    return {"file_id": file_id, "download_url": f"/api/ghost/tools/download/{file_id}", "image_base64": meme_b64}


# ═══════════════════════════════════════════════════════════════════════════
# BARCODE LOOKUP
# ═══════════════════════════════════════════════════════════════════════════

class BarcodeLookupRequest(BaseModel):
    barcode: str  # UPC/EAN code

@router.post("/barcode-lookup")
async def barcode_lookup(req: BarcodeLookupRequest, authorization: str = Header(...)):
    """Look up product info from barcode number."""
    _verify_auth(authorization)

    # Use Open Food Facts API (free, no key needed)
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"https://world.openfoodfacts.org/api/v0/product/{req.barcode}.json")
        data = res.json()

    if data.get("status") == 1:
        product = data.get("product", {})
        return {
            "found": True,
            "name": product.get("product_name", "Unknown"),
            "brand": product.get("brands", "Unknown"),
            "category": product.get("categories", "Unknown"),
            "image_url": product.get("image_url", ""),
            "ingredients": product.get("ingredients_text", ""),
            "nutrition_grade": product.get("nutrition_grades", ""),
            "barcode": req.barcode,
        }

    # Fallback: try UPC Database
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get(f"https://api.upcitemdb.com/prod/trial/lookup?upc={req.barcode}")
            data = res.json()
            items = data.get("items", [])
            if items:
                item = items[0]
                return {
                    "found": True,
                    "name": item.get("title", "Unknown"),
                    "brand": item.get("brand", "Unknown"),
                    "category": item.get("category", "Unknown"),
                    "description": item.get("description", ""),
                    "barcode": req.barcode,
                }
        except:
            pass

    return {"found": False, "barcode": req.barcode, "message": "Product not found in database"}


class BarcodeScanRequest(BaseModel):
    image_base64: str

@router.post("/barcode-scan")
async def barcode_scan(req: BarcodeScanRequest, authorization: str = Header(...)):
    """Scan barcode from image using Claude Vision, then look up product."""
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "API key not configured")

    # Use Vision to read the barcode number
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 256,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image_base64}},
                        {"type": "text", "text": "Read the barcode or UPC/EAN number from this image. Return ONLY the number, nothing else. If you can't read it, return 'unreadable'."},
                    ],
                }],
            },
        )
        data = res.json()
        barcode = data.get("content", [{}])[0].get("text", "").strip()

    if not barcode or barcode == "unreadable":
        return {"found": False, "message": "Could not read barcode from image"}

    # Look up the barcode
    from fastapi import Request
    lookup_req = BarcodeLookupRequest(barcode=barcode)
    return await barcode_lookup(lookup_req, authorization=authorization)
