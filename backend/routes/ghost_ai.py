"""
Ghost AI Proxy — routes AI requests through the backend so API keys stay server-side.

Routes:
  POST /api/ghost/ai/chat          — proxy to Claude API
  POST /api/ghost/ai/vision        — proxy to Claude Vision API
  POST /api/ghost/ai/image         — proxy to DALL-E API
  POST /api/ghost/ai/tts           — proxy to ElevenLabs TTS
"""

from __future__ import annotations
import os
import base64
import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/ghost/ai", tags=["ghost-ai"])

# API keys from environment variables
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
ELEVEN_KEY = os.getenv("ELEVENLABS_API_KEY", "")


def _verify_auth(authorization: str):
    """Verify ghost JWT token from Authorization header."""
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    return verify_ghost_token(token)


class ChatRequest(BaseModel):
    messages: list
    system: Optional[str] = "You are GoFarther AI, a helpful mobile assistant."
    max_tokens: Optional[int] = 1024


class VisionRequest(BaseModel):
    image_base64: str
    prompt: Optional[str] = "What do you see in this image?"


class ImageRequest(BaseModel):
    prompt: str
    size: Optional[str] = "1024x1024"


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = "JBFqnCBsd6RMkjVDRZzb"


@router.post("/chat")
async def chat_proxy(req: ChatRequest, authorization: str = Header(...)):
    """Proxy chat request to Claude API."""
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "Anthropic API key not configured on server")

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": req.max_tokens,
                "system": req.system,
                "messages": req.messages,
            },
        )
        if res.status_code != 200:
            detail = "API error"
            try:
                detail = res.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            raise HTTPException(res.status_code, detail)
        data = res.json()
        return {"text": data.get("content", [{}])[0].get("text", "No response")}


@router.post("/vision")
async def vision_proxy(req: VisionRequest, authorization: str = Header(...)):
    """Proxy vision request to Claude API."""
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "Anthropic API key not configured on server")

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image_base64}},
                        {"type": "text", "text": req.prompt},
                    ],
                }],
            },
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "Vision API error")
        data = res.json()
        return {"text": data.get("content", [{}])[0].get("text", "Could not analyze")}


@router.post("/image")
async def image_proxy(req: ImageRequest, authorization: str = Header(...)):
    """Proxy image generation to DALL-E."""
    _verify_auth(authorization)
    if not OPENAI_KEY:
        raise HTTPException(500, "OpenAI API key not configured on server")

    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_KEY}",
            },
            json={
                "model": "dall-e-3",
                "prompt": req.prompt,
                "n": 1,
                "size": req.size,
            },
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "Image generation error")
        data = res.json()
        url = data.get("data", [{}])[0].get("url", "")
        if not url:
            raise HTTPException(500, "No image URL returned")
        return {"url": url}


@router.post("/tts")
async def tts_proxy(req: TTSRequest, authorization: str = Header(...)):
    """Proxy TTS request to ElevenLabs."""
    _verify_auth(authorization)
    if not ELEVEN_KEY:
        raise HTTPException(500, "ElevenLabs API key not configured on server")

    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
            headers={
                "Content-Type": "application/json",
                "xi-api-key": ELEVEN_KEY,
            },
            json={
                "text": req.text,
                "model_id": "eleven_monolingual_v1",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "TTS error")
        audio_b64 = base64.b64encode(res.content).decode()
        return {"audio_base64": audio_b64}
