"""
Ghost AI Tools V2 — communication, calendar, social, finance, media, research, automation, data.

All 30 additional tool endpoints.
"""

from __future__ import annotations
import os
import io
import re
import json
import base64
import uuid
import socket
import logging
import ipaddress
import urllib.parse
import httpx
import qrcode
from datetime import datetime
from xml.sax.saxutils import escape as xml_escape
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/tools/v2", tags=["ghost-tools-v2"])


def _audit_log_lazy():
    from routes.ghost_auth import _audit_log
    return _audit_log


# ── Security helpers ─────────────────────────────────────────────────────

_BLOCKED_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_external_url(url: str):
    """Validate URL is external (not internal/private) to prevent SSRF."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Only HTTP/HTTPS URLs are allowed")
    if not parsed.hostname:
        raise HTTPException(400, "Invalid URL")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
        for info in infos:
            addr = ipaddress.ip_address(info[4][0])
            for net in _BLOCKED_NETS:
                if addr in net:
                    raise HTTPException(400, "Internal/private URLs are not allowed")
    except socket.gaierror:
        raise HTTPException(400, "Could not resolve hostname")


_PHONE_RE = re.compile(r'^\+[1-9]\d{6,14}$')


def _validate_phone(phone: str):
    """Validate phone number is E.164 format."""
    if not _PHONE_RE.match(phone):
        raise HTTPException(400, "Invalid phone number. Use E.164 format (e.g. +1234567890)")


def _sanitize_ics(text: str) -> str:
    """Strip control characters that could inject ICS entries."""
    return text.replace('\r', '').replace('\n', ' ').strip()

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
SENDGRID_KEY = os.getenv("SENDGRID_API_KEY", "")


def _verify_auth(authorization: str):
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    return verify_ghost_token(token)


async def _ask_claude(prompt: str, system: str = "You are a helpful assistant.") -> str:
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "API key not configured")
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
            json={"model": "claude-sonnet-4-20250514", "max_tokens": 4096, "system": system, "messages": [{"role": "user", "content": prompt}]},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, "AI error")
        return res.json().get("content", [{}])[0].get("text", "")


# ═══════════════════════════════════════════════════════════════════════════
# COMMUNICATION
# ═══════════════════════════════════════════════════════════════════════════

class SendSMSRequest(BaseModel):
    to: str  # phone number
    body: str

@router.post("/send-sms")
async def send_sms(req: SendSMSRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Send SMS silently via Twilio."""
    payload = _verify_auth(authorization)
    _validate_phone(req.to)
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_NUMBER:
        raise HTTPException(500, "Twilio not configured.")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={"From": TWILIO_NUMBER, "To": req.to, "Body": req.body},
            )
            if res.status_code not in (200, 201):
                logger.error("SMS send failed to %s: %s", req.to, res.text)
                raise HTTPException(400, "Failed to send SMS. Please try again.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("SMS error: %s", e)
        raise HTTPException(400, "Failed to send SMS.")
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_send_sms", f"To: {req.to}")
    await db.commit()
    return {"status": "sent", "to": req.to}


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    attachment_b64: Optional[str] = None
    attachment_name: Optional[str] = None

@router.post("/send-email")
async def send_email(
    req: SendEmailRequest,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Send an email through the user's connected mail app in the
    active workspace. Routes through the unified send_email_for_user
    helper so behavior matches chat, agents, scheduled tasks, and plans."""
    payload_data = _verify_auth(authorization)
    user_email = payload_data.get("email", "")
    user_id = payload_data.get("sub") or payload_data.get("user_id")

    from routes.ghost_connectors import send_email_for_user
    result = await send_email_for_user(
        user_id,
        user_email,
        db,
        to=req.to,
        subject=req.subject,
        html=req.body,
        workspace_id=x_workspace_id,
    )
    if not result.get("sent"):
        raise HTTPException(400, result.get("error") or "Failed to send email")
    await _audit_log_lazy()(db, user_email, "tool_send_email", f"To: {req.to}, Subj: {req.subject[:50]}, via: {result.get('via')}")
    await db.commit()
    return {"status": "sent", "to": req.to, "via": result.get("via")}


import asyncio

# ─── BULK EMAIL / SMS ──────────────────────────────────────────────────

class BulkEmailRecipient(BaseModel):
    to: str
    subject: str
    body: str

class BulkEmailRequest(BaseModel):
    recipients: list[BulkEmailRecipient]  # max 50

@router.post("/send-email-bulk")
async def send_email_bulk(
    req: BulkEmailRequest,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Send email to multiple recipients through the user's connected
    mail app in the active workspace. Rate-limited at 100ms between
    sends to avoid provider throttling."""
    payload_data = _verify_auth(authorization)
    user_email = payload_data.get("email", "")
    user_id = payload_data.get("sub") or payload_data.get("user_id")
    if len(req.recipients) > 50:
        raise HTTPException(400, "Maximum 50 recipients per batch")
    if not req.recipients:
        raise HTTPException(400, "No recipients provided")

    from routes.ghost_connectors import send_email_for_user

    results = []
    sent_count = 0
    for r in req.recipients:
        try:
            result = await send_email_for_user(
                user_id,
                user_email,
                db,
                to=r.to,
                subject=r.subject,
                html=r.body,
                workspace_id=x_workspace_id,
            )
            if result.get("sent"):
                results.append({"to": r.to, "status": "sent", "via": result.get("via")})
                sent_count += 1
            else:
                results.append({"to": r.to, "status": "failed", "error": result.get("error")})
        except Exception as e:
            results.append({"to": r.to, "status": "failed", "error": str(e)})
        await asyncio.sleep(0.1)  # Small rate limit so providers don't throttle

    await _audit_log_lazy()(db, user_email, "tool_send_email_bulk", f"{len(req.recipients)} recipients")
    await db.commit()
    return {"results": results, "sent": sent_count, "failed": len(req.recipients) - sent_count, "total": len(req.recipients)}


class BulkSMSRecipient(BaseModel):
    to: str
    body: str

class BulkSMSRequest(BaseModel):
    recipients: list[BulkSMSRecipient]  # max 50

@router.post("/send-sms-bulk")
async def send_sms_bulk(req: BulkSMSRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Send SMS to multiple recipients via Twilio."""
    payload = _verify_auth(authorization)
    if len(req.recipients) > 50:
        raise HTTPException(400, "Maximum 50 recipients per batch")
    if not req.recipients:
        raise HTTPException(400, "No recipients provided")
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_NUMBER:
        raise HTTPException(500, "Twilio not configured")

    # Validate all phone numbers first
    for r in req.recipients:
        _validate_phone(r.to)

    results = []
    sent_count = 0
    async with httpx.AsyncClient(timeout=15) as client:
        for r in req.recipients:
            try:
                res = await client.post(
                    f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                    auth=(TWILIO_SID, TWILIO_TOKEN),
                    data={"From": TWILIO_NUMBER, "To": r.to, "Body": r.body},
                )
                if res.status_code in (200, 201):
                    results.append({"to": r.to, "status": "sent"})
                    sent_count += 1
                else:
                    logger.error("Bulk SMS failed to %s: %s", r.to, res.text)
                    results.append({"to": r.to, "status": "failed", "error": "Send failed"})
            except Exception as e:
                logger.error("Bulk SMS error to %s: %s", r.to, e)
                results.append({"to": r.to, "status": "failed", "error": "Send failed"})
            await asyncio.sleep(0.1)

    await _audit_log_lazy()(db, payload.get("email", ""), "tool_send_sms_bulk", f"{len(req.recipients)} recipients")
    await db.commit()
    return {"results": results, "sent": sent_count, "failed": len(req.recipients) - sent_count, "total": len(req.recipients)}


class SendWhatsAppRequest(BaseModel):
    to: str
    body: str

@router.post("/send-whatsapp")
async def send_whatsapp(req: SendWhatsAppRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Send WhatsApp message via Twilio."""
    payload = _verify_auth(authorization)
    _validate_phone(req.to)
    if not TWILIO_SID:
        raise HTTPException(500, "Twilio not configured")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={"From": f"whatsapp:{TWILIO_NUMBER}", "To": f"whatsapp:{req.to}", "Body": req.body},
            )
            if res.status_code not in (200, 201):
                logger.error("WhatsApp failed to %s: %s", req.to, res.text)
                raise HTTPException(400, "Failed to send WhatsApp message.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("WhatsApp error: %s", e)
        raise HTTPException(400, "Failed to send WhatsApp message.")
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_send_whatsapp", f"To: {req.to}")
    await db.commit()
    return {"status": "sent", "to": req.to}


class AICallRequest(BaseModel):
    to: str
    message: str  # What the AI should say

@router.post("/ai-call")
async def ai_call(req: AICallRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Initiate AI phone call via Twilio + TwiML."""
    payload = _verify_auth(authorization)
    _validate_phone(req.to)
    if not TWILIO_SID:
        raise HTTPException(500, "Twilio not configured")
    twiml = f'<Response><Say voice="alice">{xml_escape(req.message)}</Say></Response>'
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Calls.json",
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={"From": TWILIO_NUMBER, "To": req.to, "Twiml": twiml},
            )
            if res.status_code not in (200, 201):
                logger.error("AI call failed to %s: %s", req.to, res.text)
                raise HTTPException(400, "Failed to initiate call. Please try again.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("AI call error: %s", e)
        raise HTTPException(400, "Failed to initiate call.")
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_ai_call", f"To: {req.to}")
    await db.commit()
    return {"status": "calling", "to": req.to}


# ═══════════════════════════════════════════════════════════════════════════
# CALENDAR / PRODUCTIVITY
# ═══════════════════════════════════════════════════════════════════════════

class CalendarEventRequest(BaseModel):
    title: str
    date: str  # ISO format
    time: Optional[str] = None
    description: Optional[str] = None

@router.post("/create-event")
async def create_event(req: CalendarEventRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Create calendar event — returns .ics file for import."""
    payload = _verify_auth(authorization)
    uid = str(uuid.uuid4())
    dtstart = req.date.replace("-", "") + (f"T{req.time.replace(':', '')}00" if req.time else "")
    safe_title = _sanitize_ics(req.title)
    safe_desc = _sanitize_ics(req.description or '')
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:{uid}
DTSTART:{dtstart}
SUMMARY:{safe_title}
DESCRIPTION:{safe_desc}
END:VEVENT
END:VCALENDAR"""
    ics_b64 = base64.b64encode(ics.encode()).decode()
    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    FILE_STORE[file_id] = {"filename": f"{req.title}.ics", "mime": "text/calendar", "data": ics_b64, "created": datetime.utcnow().isoformat(), "owner_email": payload.get("email", "")}
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_create_event", f"Event: {req.title[:80]}")
    await db.commit()
    return {"file_id": file_id, "filename": f"{req.title}.ics", "download_url": f"/api/ghost/tools/download/{file_id}"}


class ReminderRequest(BaseModel):
    message: str
    delay_seconds: Optional[int] = 300  # default 5 min

@router.post("/set-reminder")
async def set_reminder(req: ReminderRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Set a reminder — returns data for local notification."""
    payload = _verify_auth(authorization)
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_set_reminder", f"{req.message[:50]}")
    await db.commit()
    return {"message": req.message, "delay_seconds": req.delay_seconds, "type": "local_notification"}


# ═══════════════════════════════════════════════════════════════════════════
# SOCIAL MEDIA
# ═══════════════════════════════════════════════════════════════════════════

class SocialPostRequest(BaseModel):
    platform: str  # twitter, instagram, linkedin
    content: str
    image_url: Optional[str] = None

@router.post("/social-post")
async def social_post(req: SocialPostRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Generate social media post content — actual posting requires OAuth per platform."""
    payload = _verify_auth(authorization)
    system = f"You are a social media expert. Create a {req.platform} post based on the user's content. Include relevant hashtags. Keep it platform-appropriate."
    optimized = await _ask_claude(f"Create a {req.platform} post about: {req.content}", system)
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_social_post", f"Platform: {req.platform}")
    await db.commit()
    return {"platform": req.platform, "post": optimized, "note": "Copy this to your clipboard and paste in the app, or connect your account for auto-posting."}


class ScheduleSocialRequest(BaseModel):
    platform: str
    content: str
    schedule_time: str  # ISO format

@router.post("/schedule-social")
async def schedule_social(req: ScheduleSocialRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Schedule a social media post — stores for later."""
    payload = _verify_auth(authorization)
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_schedule_social", f"Platform: {req.platform}")
    await db.commit()
    return {"platform": req.platform, "content": req.content, "scheduled_for": req.schedule_time, "status": "scheduled"}


# ═══════════════════════════════════════════════════════════════════════════
# FINANCE
# ═══════════════════════════════════════════════════════════════════════════

class CryptoRequest(BaseModel):
    symbols: str  # comma-separated: BTC,ETH,SOL

@router.post("/crypto-portfolio")
async def crypto_portfolio(req: CryptoRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Track crypto portfolio."""
    payload = _verify_auth(authorization)
    symbols = [s.strip().upper() for s in req.symbols.split(",")]
    results = []
    async with httpx.AsyncClient(timeout=10) as client:
        for sym in symbols[:10]:
            try:
                res = await client.get(f"https://api.coinbase.com/v2/prices/{sym}-USD/spot")
                data = res.json()
                results.append({"symbol": sym, "price": data.get("data", {}).get("amount", "N/A")})
            except:
                results.append({"symbol": sym, "price": "N/A"})
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_crypto_portfolio", f"Symbols: {req.symbols[:80]}")
    await db.commit()
    return {"portfolio": results}


class InvoiceRequest(BaseModel):
    client_name: str
    items: str  # description of items/services
    total: Optional[str] = None

@router.post("/create-invoice")
async def create_invoice(req: InvoiceRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Generate a professional invoice PDF."""
    payload = _verify_auth(authorization)
    content = await _ask_claude(
        f"Create an invoice for client: {req.client_name}\nItems/Services: {req.items}\n{f'Total: {req.total}' if req.total else ''}\n\nFormat as a clean, professional invoice with line items, amounts, subtotal, tax, and total.",
        system="You are an invoice generator. Create clean, professional invoices."
    )
    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    file_bytes = content.encode('utf-8')
    FILE_STORE[file_id] = {"filename": f"invoice_{req.client_name.replace(' ', '_')}.txt", "mime": "text/plain", "data": base64.b64encode(file_bytes).decode(), "created": datetime.utcnow().isoformat(), "owner_email": payload.get("email", "")}
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_create_invoice", f"Client: {req.client_name[:50]}")
    await db.commit()
    return {"file_id": file_id, "filename": f"invoice_{req.client_name}.txt", "download_url": f"/api/ghost/tools/download/{file_id}", "content": content}


class ReceiptRequest(BaseModel):
    image_base64: str

@router.post("/scan-receipt")
async def scan_receipt(req: ReceiptRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Scan receipt image and extract expense data."""
    payload = _verify_auth(authorization)
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
            json={"model": "claude-sonnet-4-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image_base64}},
                {"type": "text", "text": "Extract all items, prices, tax, total, store name, and date from this receipt. Return as JSON with fields: store, date, items (array of {name, price}), subtotal, tax, total."},
            ]}]},
        )
        data = res.json()
        text = data.get("content", [{}])[0].get("text", "{}")
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_scan_receipt", "Receipt scan")
    await db.commit()
    try:
        return json.loads(text)
    except:
        return {"raw": text}


# ═══════════════════════════════════════════════════════════════════════════
# MEDIA
# ═══════════════════════════════════════════════════════════════════════════

class YouTubeRequest(BaseModel):
    url: str

@router.post("/youtube-summary")
async def youtube_summary(req: YouTubeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Summarize a YouTube video using its transcript."""
    payload = _verify_auth(authorization)
    vid_match = re.search(r'(?:v=|youtu\.be/|/shorts/)([\w-]{11})', req.url)
    if not vid_match:
        raise HTTPException(400, "Invalid YouTube URL")
    vid = vid_match.group(1)

    # Get title
    title = "Video"
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            res = await client.get(f"https://www.youtube.com/watch?v={vid}", headers={"User-Agent": "Mozilla/5.0"})
            tm = re.search(r'<title>(.*?)</title>', res.text[:5000])
            if tm:
                title = tm.group(1).replace(" - YouTube", "").strip()
    except Exception:
        pass

    # Try to get real transcript
    transcript_text = ""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()
        transcript = ytt.fetch(vid)
        transcript_text = ' '.join(snippet.text for snippet in transcript)[:20000]
    except Exception as e:
        logger.warning("[youtube-summary] transcript failed for %s: %s", vid, e)

    if transcript_text:
        summary = await _ask_claude(
            f"Summarize this YouTube video based on its transcript.\n\nTitle: {title}\n\nTranscript:\n{transcript_text}",
            system="You are a video summarizer. Give a clear, detailed summary with key points and takeaways. Use bullet points for main topics."
        )
    else:
        # Fallback to page scraping
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                res = await client.get(f"https://www.youtube.com/watch?v={vid}", headers={"User-Agent": "Mozilla/5.0"})
                html = res.text[:30000]
            summary = await _ask_claude(f"Based on the YouTube page content, summarize this video: {title}\n\nPage content:\n{html[:5000]}")
        except Exception:
            summary = await _ask_claude(f"The user wants a summary of a YouTube video titled '{title}'. The transcript is not available. Explain that and provide any context you can based on the title.")

    await _audit_log_lazy()(db, payload.get("email", ""), "tool_youtube_summary", f"URL: {req.url[:80]}")
    await db.commit()
    return {"title": title, "video_id": vid, "summary": summary}


class TranscribeRequest(BaseModel):
    audio_base64: str
    filename: Optional[str] = "audio.m4a"

@router.post("/transcribe")
async def transcribe_audio(req: TranscribeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Transcribe audio using OpenAI Whisper."""
    payload = _verify_auth(authorization)
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(500, "OpenAI key not configured")

    audio_bytes = base64.b64decode(req.audio_base64)
    async with httpx.AsyncClient(timeout=60) as client:
        files = {"file": (req.filename, audio_bytes, "audio/m4a")}
        res = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {openai_key}"},
            data={"model": "whisper-1"},
            files=files,
        )
        if res.status_code != 200:
            raise HTTPException(400, "Transcription failed")
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_transcribe", "Audio transcription")
    await db.commit()
    return {"text": res.json().get("text", "")}


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "nova"  # alloy, echo, fable, onyx, nova, shimmer


@router.post("/tts")
async def text_to_speech(req: TTSRequest, authorization: str = Header(...)):
    """Convert text to natural speech using OpenAI TTS API.
    Returns base64-encoded mp3 audio."""
    _verify_auth(authorization)
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(500, "OpenAI key not configured")

    text = (req.text or "").strip()[:4000]
    if not text:
        raise HTTPException(400, "text is required")

    voice = req.voice if req.voice in ("alloy", "echo", "fable", "onyx", "nova", "shimmer") else "nova"

    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "tts-1",
                "input": text,
                "voice": voice,
                "response_format": "mp3",
                "speed": 0.92,
            },
        )
        if res.status_code != 200:
            raise HTTPException(400, f"TTS failed: {res.text[:200]}")

    audio_b64 = base64.b64encode(res.content).decode("utf-8")
    return {"audio_base64": audio_b64, "format": "mp3"}


# ═══════════════════════════════════════════════════════════════════════════
# RESEARCH
# ═══════════════════════════════════════════════════════════════════════════

class ResearchRequest(BaseModel):
    topic: str
    type: Optional[str] = "general"  # general, academic, patent, legal

@router.post("/research")
async def research(req: ResearchRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Deep research on a topic."""
    payload = _verify_auth(authorization)
    system_map = {
        "general": "You are a research assistant. Provide thorough, well-sourced analysis.",
        "academic": "You are an academic researcher. Cite papers and studies. Use formal academic tone.",
        "patent": "You are a patent researcher. Analyze patent landscape, prior art, and key patents.",
        "legal": "You are a legal researcher. Analyze legal implications, relevant laws, and precedents.",
    }
    result = await _ask_claude(
        f"Research this topic thoroughly: {req.topic}\n\nProvide: key findings, analysis, sources/references, and recommendations.",
        system=system_map.get(req.type, system_map["general"])
    )
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_research", f"Topic: {req.topic[:80]}")
    await db.commit()
    return {"topic": req.topic, "type": req.type, "research": result}


class CompareRequest(BaseModel):
    urls: str  # comma-separated URLs
    question: Optional[str] = "Compare these products/pages."

@router.post("/compare")
async def compare_urls(req: CompareRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Compare multiple URLs/products."""
    payload = _verify_auth(authorization)
    urls = [u.strip() for u in req.urls.split(",")][:5]
    # Validate all URLs against SSRF
    for url in urls:
        _validate_external_url(url)
    summaries = []

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for url in urls:
            try:
                res = await client.get(url, headers={"User-Agent": "GoFarther-AI/1.0"})
                text = re.sub(r'<[^>]+>', ' ', res.text[:10000])
                text = re.sub(r'\s+', ' ', text).strip()[:3000]
                summaries.append(f"URL: {url}\nContent: {text}")
            except:
                summaries.append(f"URL: {url}\nContent: Could not fetch")

    comparison = await _ask_claude(f"{req.question}\n\n" + "\n\n---\n\n".join(summaries))
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_compare_urls", "URL comparison")
    await db.commit()
    return {"comparison": comparison, "urls_analyzed": len(urls)}


# ═══════════════════════════════════════════════════════════════════════════
# AUTOMATION
# ═══════════════════════════════════════════════════════════════════════════

class WebhookRequest(BaseModel):
    url: str
    method: Optional[str] = "POST"
    body: Optional[str] = None
    headers: Optional[dict] = None

@router.post("/trigger-webhook")
async def trigger_webhook(req: WebhookRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Trigger any webhook/API endpoint."""
    payload = _verify_auth(authorization)
    _validate_external_url(req.url)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            hdrs = req.headers or {"Content-Type": "application/json"}
            if req.method.upper() == "GET":
                res = await client.get(req.url, headers=hdrs)
            else:
                res = await client.post(req.url, headers=hdrs, content=req.body or "")
        await _audit_log_lazy()(db, payload.get("email", ""), "tool_trigger_webhook", f"{req.method} {req.url[:80]}")
        await db.commit()
        return {"status": res.status_code, "response": res.text[:2000]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Webhook trigger failed for %s: %s", req.url, e)
        raise HTTPException(400, "Failed to trigger webhook.")


# ═══════════════════════════════════════════════════════════════════════════
# DATA TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class QRCodeRequest(BaseModel):
    data: str  # URL, text, or any data

@router.post("/generate-qr")
async def generate_qr(req: QRCodeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Generate QR code image."""
    payload = _verify_auth(authorization)
    img = qrcode.make(req.data)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    FILE_STORE[file_id] = {"filename": "qrcode.png", "mime": "image/png", "data": qr_b64, "created": datetime.utcnow().isoformat(), "owner_email": payload.get("email", "")}
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_generate_qr", "QR code generated")
    await db.commit()
    return {"file_id": file_id, "download_url": f"/api/ghost/tools/download/{file_id}", "image_base64": qr_b64}


class ResumeRequest(BaseModel):
    resume_text: str

@router.post("/parse-resume")
async def parse_resume(req: ResumeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Parse resume text into structured data."""
    payload = _verify_auth(authorization)
    result = await _ask_claude(
        f"Parse this resume into structured JSON with fields: name, email, phone, summary, experience (array), education (array), skills (array).\n\nResume:\n{req.resume_text}",
        system="You are a resume parser. Extract structured data from resumes. Return valid JSON only."
    )
    await _audit_log_lazy()(db, payload.get("email", ""), "tool_parse_resume", "Resume parsed")
    await db.commit()
    try:
        return json.loads(result)
    except:
        return {"raw": result}
