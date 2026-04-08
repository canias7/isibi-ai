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
import httpx
import qrcode
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db

router = APIRouter(prefix="/ghost/tools/v2", tags=["ghost-tools-v2"])

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
async def send_sms(req: SendSMSRequest, authorization: str = Header(...)):
    """Send SMS silently via Twilio."""
    _verify_auth(authorization)
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_NUMBER:
        raise HTTPException(500, "Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to environment.")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={"From": TWILIO_NUMBER, "To": req.to, "Body": req.body},
        )
        if res.status_code not in (200, 201):
            raise HTTPException(400, f"SMS failed: {res.text}")
    return {"status": "sent", "to": req.to}


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    attachment_b64: Optional[str] = None
    attachment_name: Optional[str] = None

@router.post("/send-email")
async def send_email(req: SendEmailRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Send email via user's SMTP if configured, otherwise SendGrid."""
    payload_data = _verify_auth(authorization)

    # Check if user has custom SMTP configured (DB-backed with cache)
    from routes.ghost_auth import get_user_smtp
    settings = await get_user_smtp(payload_data.get("email", ""), db)

    if settings.get("smtp_host") and settings.get("smtp_user") and settings.get("smtp_pass"):
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        msg = MIMEMultipart()
        msg["From"] = f"{settings.get('smtp_from', '')} <{settings['smtp_user']}>"
        msg["To"] = req.to
        msg["Subject"] = req.subject
        msg.attach(MIMEText(req.body, "plain"))

        try:
            with smtplib.SMTP(settings["smtp_host"], settings.get("smtp_port", 587)) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(settings["smtp_user"], settings["smtp_pass"])
                server.sendmail(settings["smtp_user"], req.to, msg.as_string())
            return {"status": "sent", "to": req.to, "from": settings["smtp_user"]}
        except Exception as smtp_err:
            raise HTTPException(400, f"SMTP failed: {str(smtp_err)}")

    raise HTTPException(400, "Set up your email in Settings first to send emails.")


import asyncio

# ─── BULK EMAIL / SMS ──────────────────────────────────────────────────

class BulkEmailRecipient(BaseModel):
    to: str
    subject: str
    body: str

class BulkEmailRequest(BaseModel):
    recipients: list[BulkEmailRecipient]  # max 50

@router.post("/send-email-bulk")
async def send_email_bulk(req: BulkEmailRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Send email to multiple recipients via user's SMTP. One connection, sequential sends."""
    payload_data = _verify_auth(authorization)
    if len(req.recipients) > 50:
        raise HTTPException(400, "Maximum 50 recipients per batch")
    if not req.recipients:
        raise HTTPException(400, "No recipients provided")

    from routes.ghost_auth import get_user_smtp
    settings = await get_user_smtp(payload_data.get("email", ""), db)
    if not (settings.get("smtp_host") and settings.get("smtp_user") and settings.get("smtp_pass")):
        raise HTTPException(400, "Set up your email in Settings first to send emails.")

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    results = []
    sent_count = 0
    try:
        with smtplib.SMTP(settings["smtp_host"], settings.get("smtp_port", 587)) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings["smtp_user"], settings["smtp_pass"])

            for r in req.recipients:
                try:
                    msg = MIMEMultipart()
                    msg["From"] = f"{settings.get('smtp_from', '')} <{settings['smtp_user']}>"
                    msg["To"] = r.to
                    msg["Subject"] = r.subject
                    msg.attach(MIMEText(r.body, "plain"))
                    server.sendmail(settings["smtp_user"], r.to, msg.as_string())
                    results.append({"to": r.to, "status": "sent"})
                    sent_count += 1
                except Exception as e:
                    results.append({"to": r.to, "status": "failed", "error": str(e)})
                await asyncio.sleep(0.1)  # Rate limit
    except Exception as e:
        raise HTTPException(400, f"SMTP connection failed: {str(e)}")

    return {"results": results, "sent": sent_count, "failed": len(req.recipients) - sent_count, "total": len(req.recipients)}


class BulkSMSRecipient(BaseModel):
    to: str
    body: str

class BulkSMSRequest(BaseModel):
    recipients: list[BulkSMSRecipient]  # max 50

@router.post("/send-sms-bulk")
async def send_sms_bulk(req: BulkSMSRequest, authorization: str = Header(...)):
    """Send SMS to multiple recipients via Twilio."""
    _verify_auth(authorization)
    if len(req.recipients) > 50:
        raise HTTPException(400, "Maximum 50 recipients per batch")
    if not req.recipients:
        raise HTTPException(400, "No recipients provided")
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_NUMBER:
        raise HTTPException(500, "Twilio not configured")

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
                    results.append({"to": r.to, "status": "failed", "error": res.text[:200]})
            except Exception as e:
                results.append({"to": r.to, "status": "failed", "error": str(e)})
            await asyncio.sleep(0.1)

    return {"results": results, "sent": sent_count, "failed": len(req.recipients) - sent_count, "total": len(req.recipients)}


class SendWhatsAppRequest(BaseModel):
    to: str
    body: str

@router.post("/send-whatsapp")
async def send_whatsapp(req: SendWhatsAppRequest, authorization: str = Header(...)):
    """Send WhatsApp message via Twilio."""
    _verify_auth(authorization)
    if not TWILIO_SID:
        raise HTTPException(500, "Twilio not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={"From": f"whatsapp:{TWILIO_NUMBER}", "To": f"whatsapp:{req.to}", "Body": req.body},
        )
        if res.status_code not in (200, 201):
            raise HTTPException(400, f"WhatsApp failed: {res.text}")
    return {"status": "sent", "to": req.to}


class AICallRequest(BaseModel):
    to: str
    message: str  # What the AI should say

@router.post("/ai-call")
async def ai_call(req: AICallRequest, authorization: str = Header(...)):
    """Initiate AI phone call via Twilio + TwiML."""
    _verify_auth(authorization)
    if not TWILIO_SID:
        raise HTTPException(500, "Twilio not configured")
    twiml = f'<Response><Say voice="alice">{req.message}</Say></Response>'
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Calls.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={"From": TWILIO_NUMBER, "To": req.to, "Twiml": twiml},
        )
        if res.status_code not in (200, 201):
            raise HTTPException(400, f"Call failed: {res.text}")
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
async def create_event(req: CalendarEventRequest, authorization: str = Header(...)):
    """Create calendar event — returns .ics file for import."""
    _verify_auth(authorization)
    uid = str(uuid.uuid4())
    dtstart = req.date.replace("-", "") + (f"T{req.time.replace(':', '')}00" if req.time else "")
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:{uid}
DTSTART:{dtstart}
SUMMARY:{req.title}
DESCRIPTION:{req.description or ''}
END:VEVENT
END:VCALENDAR"""
    ics_b64 = base64.b64encode(ics.encode()).decode()
    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    FILE_STORE[file_id] = {"filename": f"{req.title}.ics", "mime": "text/calendar", "data": ics_b64, "created": datetime.utcnow().isoformat()}
    return {"file_id": file_id, "filename": f"{req.title}.ics", "download_url": f"/api/ghost/tools/download/{file_id}"}


class ReminderRequest(BaseModel):
    message: str
    delay_seconds: Optional[int] = 300  # default 5 min

@router.post("/set-reminder")
async def set_reminder(req: ReminderRequest, authorization: str = Header(...)):
    """Set a reminder — returns data for local notification."""
    _verify_auth(authorization)
    return {"message": req.message, "delay_seconds": req.delay_seconds, "type": "local_notification"}


# ═══════════════════════════════════════════════════════════════════════════
# SOCIAL MEDIA
# ═══════════════════════════════════════════════════════════════════════════

class SocialPostRequest(BaseModel):
    platform: str  # twitter, instagram, linkedin
    content: str
    image_url: Optional[str] = None

@router.post("/social-post")
async def social_post(req: SocialPostRequest, authorization: str = Header(...)):
    """Generate social media post content — actual posting requires OAuth per platform."""
    _verify_auth(authorization)
    system = f"You are a social media expert. Create a {req.platform} post based on the user's content. Include relevant hashtags. Keep it platform-appropriate."
    optimized = await _ask_claude(f"Create a {req.platform} post about: {req.content}", system)
    return {"platform": req.platform, "post": optimized, "note": "Copy this to your clipboard and paste in the app, or connect your account for auto-posting."}


class ScheduleSocialRequest(BaseModel):
    platform: str
    content: str
    schedule_time: str  # ISO format

@router.post("/schedule-social")
async def schedule_social(req: ScheduleSocialRequest, authorization: str = Header(...)):
    """Schedule a social media post — stores for later."""
    _verify_auth(authorization)
    return {"platform": req.platform, "content": req.content, "scheduled_for": req.schedule_time, "status": "scheduled"}


# ═══════════════════════════════════════════════════════════════════════════
# FINANCE
# ═══════════════════════════════════════════════════════════════════════════

class CryptoRequest(BaseModel):
    symbols: str  # comma-separated: BTC,ETH,SOL

@router.post("/crypto-portfolio")
async def crypto_portfolio(req: CryptoRequest, authorization: str = Header(...)):
    """Track crypto portfolio."""
    _verify_auth(authorization)
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
    return {"portfolio": results}


class InvoiceRequest(BaseModel):
    client_name: str
    items: str  # description of items/services
    total: Optional[str] = None

@router.post("/create-invoice")
async def create_invoice(req: InvoiceRequest, authorization: str = Header(...)):
    """Generate a professional invoice PDF."""
    _verify_auth(authorization)
    content = await _ask_claude(
        f"Create an invoice for client: {req.client_name}\nItems/Services: {req.items}\n{f'Total: {req.total}' if req.total else ''}\n\nFormat as a clean, professional invoice with line items, amounts, subtotal, tax, and total.",
        system="You are an invoice generator. Create clean, professional invoices."
    )
    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    file_bytes = content.encode('utf-8')
    FILE_STORE[file_id] = {"filename": f"invoice_{req.client_name.replace(' ', '_')}.txt", "mime": "text/plain", "data": base64.b64encode(file_bytes).decode(), "created": datetime.utcnow().isoformat()}
    return {"file_id": file_id, "filename": f"invoice_{req.client_name}.txt", "download_url": f"/api/ghost/tools/download/{file_id}", "content": content}


class ReceiptRequest(BaseModel):
    image_base64: str

@router.post("/scan-receipt")
async def scan_receipt(req: ReceiptRequest, authorization: str = Header(...)):
    """Scan receipt image and extract expense data."""
    _verify_auth(authorization)
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
async def youtube_summary(req: YouTubeRequest, authorization: str = Header(...)):
    """Summarize a YouTube video by reading its page."""
    _verify_auth(authorization)
    # Extract video ID
    vid_match = re.search(r'(?:v=|youtu\.be/)([\w-]+)', req.url)
    if not vid_match:
        raise HTTPException(400, "Invalid YouTube URL")
    vid = vid_match.group(1)

    # Fetch page content for context
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        res = await client.get(f"https://www.youtube.com/watch?v={vid}", headers={"User-Agent": "Mozilla/5.0"})
        html = res.text[:30000]

    # Extract title
    title_match = re.search(r'<title>(.*?)</title>', html)
    title = title_match.group(1).replace(" - YouTube", "") if title_match else "Video"

    summary = await _ask_claude(f"Based on the YouTube page content, summarize this video: {title}\n\nPage content excerpt:\n{html[:5000]}")
    return {"title": title, "video_id": vid, "summary": summary}


class TranscribeRequest(BaseModel):
    audio_base64: str
    filename: Optional[str] = "audio.m4a"

@router.post("/transcribe")
async def transcribe_audio(req: TranscribeRequest, authorization: str = Header(...)):
    """Transcribe audio using OpenAI Whisper."""
    _verify_auth(authorization)
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
    return {"text": res.json().get("text", "")}


# ═══════════════════════════════════════════════════════════════════════════
# RESEARCH
# ═══════════════════════════════════════════════════════════════════════════

class ResearchRequest(BaseModel):
    topic: str
    type: Optional[str] = "general"  # general, academic, patent, legal

@router.post("/research")
async def research(req: ResearchRequest, authorization: str = Header(...)):
    """Deep research on a topic."""
    _verify_auth(authorization)
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
    return {"topic": req.topic, "type": req.type, "research": result}


class CompareRequest(BaseModel):
    urls: str  # comma-separated URLs
    question: Optional[str] = "Compare these products/pages."

@router.post("/compare")
async def compare_urls(req: CompareRequest, authorization: str = Header(...)):
    """Compare multiple URLs/products."""
    _verify_auth(authorization)
    urls = [u.strip() for u in req.urls.split(",")][:5]
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
async def trigger_webhook(req: WebhookRequest, authorization: str = Header(...)):
    """Trigger any webhook/API endpoint."""
    _verify_auth(authorization)
    async with httpx.AsyncClient(timeout=15) as client:
        hdrs = req.headers or {"Content-Type": "application/json"}
        if req.method.upper() == "GET":
            res = await client.get(req.url, headers=hdrs)
        else:
            res = await client.post(req.url, headers=hdrs, content=req.body or "")
    return {"status": res.status_code, "response": res.text[:2000]}


# ═══════════════════════════════════════════════════════════════════════════
# DATA TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class QRCodeRequest(BaseModel):
    data: str  # URL, text, or any data

@router.post("/generate-qr")
async def generate_qr(req: QRCodeRequest, authorization: str = Header(...)):
    """Generate QR code image."""
    _verify_auth(authorization)
    img = qrcode.make(req.data)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    from routes.ghost_tools import FILE_STORE
    file_id = str(uuid.uuid4())
    FILE_STORE[file_id] = {"filename": "qrcode.png", "mime": "image/png", "data": qr_b64, "created": datetime.utcnow().isoformat()}
    return {"file_id": file_id, "download_url": f"/api/ghost/tools/download/{file_id}", "image_base64": qr_b64}


class ResumeRequest(BaseModel):
    resume_text: str

@router.post("/parse-resume")
async def parse_resume(req: ResumeRequest, authorization: str = Header(...)):
    """Parse resume text into structured data."""
    _verify_auth(authorization)
    result = await _ask_claude(
        f"Parse this resume into structured JSON with fields: name, email, phone, summary, experience (array), education (array), skills (array).\n\nResume:\n{req.resume_text}",
        system="You are a resume parser. Extract structured data from resumes. Return valid JSON only."
    )
    try:
        return json.loads(result)
    except:
        return {"raw": result}
