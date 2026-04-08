"""
Ghost AI Proxy — routes AI requests through the backend so API keys stay server-side.
Uses Claude's native tool_use for reliable action execution.
"""

from __future__ import annotations
import os
import json
import base64
import httpx
from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/ghost/ai", tags=["ghost-ai"])

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")


def _verify_auth(authorization: str):
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    return verify_ghost_token(token)


# Claude native tools definition
CLAUDE_TOOLS = [
    {"name": "create_file", "description": "Create a file (PDF, XLSX, DOCX, CSV, TXT). The server generates the content based on the description. Use quality 'premium' when the user asks for professional, high-quality, or better output.", "input_schema": {"type": "object", "properties": {"description": {"type": "string", "description": "What the file should contain"}, "file_type": {"type": "string", "enum": ["pdf", "xlsx", "docx", "csv", "txt"], "description": "File format"}, "quality": {"type": "string", "enum": ["standard", "premium"], "description": "standard for quick files, premium for professional layout with tables and colors"}}, "required": ["description", "file_type"]}},
    {"name": "web_search", "description": "Search the web and return results", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "read_url", "description": "Read and summarize a webpage", "input_schema": {"type": "object", "properties": {"url": {"type": "string"}, "question": {"type": "string", "description": "What to look for on the page"}}, "required": ["url"]}},
    {"name": "run_code", "description": "Write and execute Python code", "input_schema": {"type": "object", "properties": {"description": {"type": "string", "description": "What the code should do"}}, "required": ["description"]}},
    {"name": "translate", "description": "Translate text to another language", "input_schema": {"type": "object", "properties": {"text": {"type": "string"}, "target_language": {"type": "string"}}, "required": ["text", "target_language"]}},
    {"name": "generate_image", "description": "Generate an image with DALL-E", "input_schema": {"type": "object", "properties": {"description": {"type": "string"}}, "required": ["description"]}},
    {"name": "call", "description": "Make a phone call", "input_schema": {"type": "object", "properties": {"target": {"type": "string", "description": "Phone number or contact name"}}, "required": ["target"]}},
    {"name": "sms", "description": "Send a text message", "input_schema": {"type": "object", "properties": {"target": {"type": "string", "description": "Phone number or contact name"}, "text": {"type": "string", "description": "Message body"}}, "required": ["target", "text"]}},
    {"name": "email", "description": "Send an email", "input_schema": {"type": "object", "properties": {"target": {"type": "string", "description": "Email address"}, "subject": {"type": "string"}, "body": {"type": "string"}}, "required": ["target", "subject", "body"]}},
    {"name": "maps", "description": "Search maps or get directions", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "remember", "description": "Remember a fact about the user for future conversations", "input_schema": {"type": "object", "properties": {"fact": {"type": "string"}}, "required": ["fact"]}},
    {"name": "youtube_summary", "description": "Summarize a YouTube video", "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    {"name": "research", "description": "Deep research on a topic", "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}, "type": {"type": "string", "enum": ["general", "academic", "patent", "legal"]}}, "required": ["topic"]}},
    {"name": "generate_qr", "description": "Generate a QR code", "input_schema": {"type": "object", "properties": {"data": {"type": "string"}}, "required": ["data"]}},
    {"name": "create_event", "description": "Create a calendar event", "input_schema": {"type": "object", "properties": {"title": {"type": "string"}, "date": {"type": "string", "description": "YYYY-MM-DD"}, "time": {"type": "string", "description": "HH:MM"}}, "required": ["title", "date"]}},
    {"name": "create_invoice", "description": "Create an invoice", "input_schema": {"type": "object", "properties": {"client_name": {"type": "string"}, "items": {"type": "string"}}, "required": ["client_name", "items"]}},
    {"name": "crypto_portfolio", "description": "Check crypto prices", "input_schema": {"type": "object", "properties": {"symbols": {"type": "string", "description": "Comma-separated symbols like BTC,ETH,SOL"}}, "required": ["symbols"]}},
    {"name": "social_post", "description": "Generate a social media post", "input_schema": {"type": "object", "properties": {"platform": {"type": "string", "enum": ["twitter", "instagram", "linkedin"]}, "content": {"type": "string"}}, "required": ["platform", "content"]}},
    {"name": "create_meme", "description": "Create a meme image", "input_schema": {"type": "object", "properties": {"top_text": {"type": "string"}, "bottom_text": {"type": "string"}}, "required": ["top_text"]}},
    {"name": "barcode_lookup", "description": "Look up a product by barcode", "input_schema": {"type": "object", "properties": {"barcode": {"type": "string"}}, "required": ["barcode"]}},
    {"name": "compare_urls", "description": "Compare multiple URLs or products", "input_schema": {"type": "object", "properties": {"urls": {"type": "string", "description": "Comma-separated URLs"}, "question": {"type": "string"}}, "required": ["urls"]}},
    {"name": "modify_file", "description": "Modify an existing file. Operations: edit (change content, add formulas), chart (create visualization), convert (change format), merge (combine files), filter (extract matching rows), compare (diff two files), reconcile (match bank statement vs book records). Use when the user has uploaded a file and wants to change, visualize, convert, merge, filter, compare, or reconcile it.", "input_schema": {"type": "object", "properties": {"operation": {"type": "string", "enum": ["edit", "chart", "convert", "merge", "filter", "compare", "reconcile"], "description": "What to do with the file"}, "instructions": {"type": "string", "description": "What changes to make, what chart to create, or what to filter"}, "target_format": {"type": "string", "enum": ["pdf", "xlsx", "docx", "csv", "txt"], "description": "Target format for convert operation"}}, "required": ["operation", "instructions"]}},
    {"name": "save_contact", "description": "Save a contact to the user's contact list", "input_schema": {"type": "object", "properties": {"label": {"type": "string", "description": "Relationship label e.g. My boss"}, "name": {"type": "string"}, "contact_info": {"type": "string", "description": "Email or phone number"}}, "required": ["label", "name"]}},
]


class ChatRequest(BaseModel):
    messages: list
    system: Optional[str] = "You are GoFarther AI, a powerful mobile assistant. Be concise and friendly."
    max_tokens: Optional[int] = 1024


class VisionRequest(BaseModel):
    image_base64: str
    prompt: Optional[str] = "What do you see in this image?"
    media_type: Optional[str] = "image/jpeg"


class ImageRequest(BaseModel):
    prompt: str
    size: Optional[str] = "1024x1024"


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = "JBFqnCBsd6RMkjVDRZzb"


ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY", "")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")


@router.post("/chat")
async def chat_proxy(req: ChatRequest, authorization: str = Header(...)):
    """Proxy chat request to Claude API with native tool use."""
    auth_payload = _verify_auth(authorization)
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
                "tools": CLAUDE_TOOLS,
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

    # Parse response — could be text, tool_use, or both
    text_parts = []
    tool_use = None

    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block["text"])
        elif block.get("type") == "tool_use":
            tool_use = {
                "name": block["name"],
                "input": block["input"],
            }

    response_text = "\n".join(text_parts) if text_parts else ""

    # If there's a tool call, convert to the JSON format the mobile app expects
    if tool_use:
        name = tool_use["name"]
        inp = tool_use["input"]

        # Map tool_use to the action JSON the app parses
        action_map = {
            "create_file": {"type": "create_file", "target": inp.get("description", ""), "text": inp.get("file_type", "pdf"), "key": inp.get("quality", "standard")},
            "web_search": {"type": "web_search", "target": inp.get("query", "")},
            "read_url": {"type": "read_url", "target": inp.get("url", ""), "text": inp.get("question", "")},
            "run_code": {"type": "run_code", "target": inp.get("description", "")},
            "translate": {"type": "translate", "target": inp.get("text", ""), "text": inp.get("target_language", "")},
            "generate_image": {"type": "generate_image", "target": inp.get("description", "")},
            "call": {"type": "call", "target": inp.get("target", "")},
            "sms": {"type": "sms", "target": inp.get("target", ""), "text": inp.get("text", "")},
            "email": {"type": "email", "target": inp.get("target", ""), "key": inp.get("subject", ""), "text": inp.get("body", "")},
            "maps": {"type": "maps", "target": inp.get("query", "")},
            "remember": {"type": "remember", "target": inp.get("fact", "")},
            "youtube_summary": {"type": "youtube_summary", "target": inp.get("url", "")},
            "research": {"type": "research", "target": inp.get("topic", ""), "text": inp.get("type", "general")},
            "generate_qr": {"type": "generate_qr", "target": inp.get("data", "")},
            "create_event": {"type": "create_event", "target": inp.get("title", ""), "text": inp.get("date", "")},
            "create_invoice": {"type": "create_invoice", "target": inp.get("client_name", ""), "text": inp.get("items", "")},
            "crypto_portfolio": {"type": "crypto_portfolio", "target": inp.get("symbols", "")},
            "social_post": {"type": "social_post", "target": inp.get("content", ""), "text": inp.get("platform", "twitter")},
            "create_meme": {"type": "create_meme", "target": inp.get("top_text", ""), "text": inp.get("bottom_text", "")},
            "barcode_lookup": {"type": "barcode_lookup", "target": inp.get("barcode", "")},
            "compare_urls": {"type": "compare_urls", "target": inp.get("urls", ""), "text": inp.get("question", "")},
            "modify_file": {"type": "modify_file", "target": inp.get("operation", "edit"), "text": inp.get("instructions", ""), "key": inp.get("target_format", "")},
            "save_contact": {"type": "save_contact", "target": inp.get("label", ""), "text": inp.get("name", ""), "key": inp.get("contact_info", "")},
        }

        action_json = action_map.get(name)
        if action_json:
            # Embed the action JSON in the response text so the mobile app can parse it
            response_text = response_text + "\n" + json.dumps(action_json) if response_text else json.dumps(action_json)

    usage = data.get("usage", {})
    input_tok = usage.get("input_tokens", 0)
    output_tok = usage.get("output_tokens", 0)

    # Log usage asynchronously (non-blocking — don't fail the request)
    try:
        from routes.ghost_auth import log_usage
        from db import get_db as _get_db
        async for db in _get_db():
            await log_usage(auth_payload.get("sub", ""), input_tok, output_tok, db)
            break
    except Exception:
        pass  # Usage logging should never break chat

    return {"text": response_text or "No response", "input_tokens": input_tok, "output_tokens": output_tok}


@router.post("/chat-stream")
async def chat_stream_proxy(req: ChatRequest, authorization: str = Header(...)):
    """Streaming chat — returns Server-Sent Events with text deltas and tool calls."""
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "Anthropic API key not configured on server")

    async def event_generator():
        text_so_far = ""
        tool_name = None
        tool_input_json = ""
        input_tokens = 0
        output_tokens = 0

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
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
                    "tools": CLAUDE_TOOLS,
                    "stream": True,
                },
            ) as resp:
                if resp.status_code != 200:
                    error_body = await resp.aread()
                    try:
                        detail = json.loads(error_body).get("error", {}).get("message", "API error")
                    except Exception:
                        detail = "API error"
                    yield f"data: {json.dumps({'type': 'error', 'text': detail})}\n\n"
                    return

                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    event_type = event.get("type", "")

                    if event_type == "content_block_start":
                        block = event.get("content_block", {})
                        if block.get("type") == "tool_use":
                            tool_name = block.get("name")
                            tool_input_json = ""

                    elif event_type == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            text_so_far += text
                            yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
                        elif delta.get("type") == "input_json_delta":
                            tool_input_json += delta.get("partial_json", "")

                    elif event_type == "content_block_stop":
                        if tool_name and tool_input_json:
                            try:
                                inp = json.loads(tool_input_json)
                            except json.JSONDecodeError:
                                inp = {}
                            # Map to mobile app action format
                            action_map = {
                                "create_file": {"type": "create_file", "target": inp.get("description", ""), "text": inp.get("file_type", "pdf"), "key": inp.get("quality", "standard")},
                                "web_search": {"type": "web_search", "target": inp.get("query", "")},
                                "read_url": {"type": "read_url", "target": inp.get("url", ""), "text": inp.get("question", "")},
                                "run_code": {"type": "run_code", "target": inp.get("description", "")},
                                "translate": {"type": "translate", "target": inp.get("text", ""), "text": inp.get("target_language", "")},
                                "generate_image": {"type": "generate_image", "target": inp.get("description", "")},
                                "call": {"type": "call", "target": inp.get("target", "")},
                                "sms": {"type": "sms", "target": inp.get("target", ""), "text": inp.get("text", "")},
                                "email": {"type": "email", "target": inp.get("target", ""), "key": inp.get("subject", ""), "text": inp.get("body", "")},
                                "maps": {"type": "maps", "target": inp.get("query", "")},
                                "remember": {"type": "remember", "target": inp.get("fact", "")},
                                "youtube_summary": {"type": "youtube_summary", "target": inp.get("url", "")},
                                "research": {"type": "research", "target": inp.get("topic", ""), "text": inp.get("type", "general")},
                                "generate_qr": {"type": "generate_qr", "target": inp.get("data", "")},
                                "create_event": {"type": "create_event", "target": inp.get("title", ""), "text": inp.get("date", "")},
                                "create_invoice": {"type": "create_invoice", "target": inp.get("client_name", ""), "text": inp.get("items", "")},
                                "crypto_portfolio": {"type": "crypto_portfolio", "target": inp.get("symbols", "")},
                                "social_post": {"type": "social_post", "target": inp.get("content", ""), "text": inp.get("platform", "twitter")},
                                "create_meme": {"type": "create_meme", "target": inp.get("top_text", ""), "text": inp.get("bottom_text", "")},
                                "barcode_lookup": {"type": "barcode_lookup", "target": inp.get("barcode", "")},
                                "compare_urls": {"type": "compare_urls", "target": inp.get("urls", ""), "text": inp.get("question", "")},
                                "modify_file": {"type": "modify_file", "target": inp.get("operation", "edit"), "text": inp.get("instructions", ""), "key": inp.get("target_format", "")},
                                "save_contact": {"type": "save_contact", "target": inp.get("label", ""), "text": inp.get("name", ""), "key": inp.get("contact_info", "")},
                            }
                            action_json = action_map.get(tool_name)
                            if action_json:
                                yield f"data: {json.dumps({'type': 'action', 'action': action_json})}\n\n"
                            tool_name = None
                            tool_input_json = ""

                    elif event_type == "message_start":
                        usage = event.get("message", {}).get("usage", {})
                        input_tokens = usage.get("input_tokens", 0)

                    elif event_type == "message_delta":
                        usage = event.get("usage", {})
                        output_tokens = usage.get("output_tokens", output_tokens)

                    elif event_type == "message_stop":
                        break

        yield f"data: {json.dumps({'type': 'done', 'text': text_so_far, 'input_tokens': input_tokens, 'output_tokens': output_tokens})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/vision")
async def vision_proxy(req: VisionRequest, authorization: str = Header(...)):
    _verify_auth(authorization)
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "Anthropic API key not configured on server")

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
            json={"model": "claude-sonnet-4-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": req.media_type or "image/jpeg", "data": req.image_base64}},
                {"type": "text", "text": req.prompt},
            ]}]},
        )
        if res.status_code != 200:
            detail = "Vision API error"
            try:
                detail = res.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            raise HTTPException(res.status_code, detail)
        data = res.json()
        return {"text": data.get("content", [{}])[0].get("text", "Could not analyze")}


@router.post("/image")
async def image_proxy(req: ImageRequest, authorization: str = Header(...)):
    _verify_auth(authorization)
    if not OPENAI_KEY:
        raise HTTPException(500, "OpenAI API key not configured on server")

    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_KEY}"},
            json={"model": "dall-e-3", "prompt": req.prompt, "n": 1, "size": req.size},
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
    _verify_auth(authorization)
    if not ELEVENLABS_KEY:
        raise HTTPException(500, "ElevenLabs API key not configured on server")

    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
            headers={"Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY},
            json={"text": req.text, "model_id": "eleven_monolingual_v1", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "TTS error")
        audio_b64 = base64.b64encode(res.content).decode()
        return {"audio_base64": audio_b64}
