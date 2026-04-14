"""
GoFarther AI — Tools v4: Call Recording, Summaries, Smart Actions

Routes:
  POST /ghost/tools/v4/call-summary       — Transcribe audio + generate AI summary
  POST /ghost/tools/v4/daily-briefing     — Generate morning briefing
  POST /ghost/tools/v4/company-lookup     — Look up company info
  POST /ghost/tools/v4/flight-status      — Check flight status
  POST /ghost/tools/v4/package-tracking   — Track a package
  POST /ghost/tools/v4/currency-convert   — Real-time currency conversion
"""

from __future__ import annotations

import os
import logging
import json
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/tools/v4", tags=["ghost-tools-v4"])

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")


def _verify_auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "")
    return verify_ghost_token(token)


def _audit_log_lazy():
    from routes.ghost_auth import _audit_log
    return _audit_log


# ── Call Recording Summary ───────────────────────────────────────────────

class CallSummaryRequest(BaseModel):
    transcript: str
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None


@router.post("/call-summary")
async def call_summary(req: CallSummaryRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Generate AI summary from call transcript."""
    payload = _verify_auth(authorization)

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Analyze this call transcript and provide:
1. **Summary** (2-3 sentences)
2. **Key Points** (bullet points of important information discussed)
3. **Action Items** (specific tasks that need to be done)
4. **Follow-up Email Draft** (professional email summarizing the call and next steps)
5. **Suggested Lead Status** (hot/warm/cold based on conversation tone)

Contact: {req.contact_name or 'Unknown'} ({req.contact_phone or 'N/A'})

Transcript:
{req.transcript}"""

    message = client.messages.create(
        model=AI_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text if message.content else ""

    # Parse sections from the response
    sections = {"summary": "", "key_points": [], "action_items": [], "follow_up_email": "", "lead_status": "warm"}

    current_section = ""
    for line in response_text.split("\n"):
        lower = line.lower().strip()
        if "summary" in lower and ("**" in line or "#" in line):
            current_section = "summary"
        elif "key point" in lower and ("**" in line or "#" in line):
            current_section = "key_points"
        elif "action item" in lower and ("**" in line or "#" in line):
            current_section = "action_items"
        elif "follow-up" in lower and ("**" in line or "#" in line):
            current_section = "follow_up_email"
        elif "lead status" in lower or "suggested" in lower:
            current_section = "lead_status"
        elif current_section == "summary":
            sections["summary"] += line.strip() + " "
        elif current_section == "key_points" and line.strip().startswith(("-", "•", "*")):
            sections["key_points"].append(line.strip().lstrip("-•* "))
        elif current_section == "action_items" and line.strip().startswith(("-", "•", "*")):
            sections["action_items"].append(line.strip().lstrip("-•* "))
        elif current_section == "follow_up_email":
            sections["follow_up_email"] += line + "\n"
        elif current_section == "lead_status":
            for status in ["hot", "warm", "cold"]:
                if status in lower:
                    sections["lead_status"] = status
                    break

    await _audit_log_lazy()(db, payload.get("email", ""), "tool_call_summary", f"Contact: {req.contact_name or 'Unknown'}")
    await db.commit()
    return {
        "summary": sections["summary"].strip() or response_text[:200],
        "key_points": sections["key_points"] or [response_text[:100]],
        "action_items": sections["action_items"],
        "follow_up_email": sections["follow_up_email"].strip(),
        "lead_status": sections["lead_status"],
        "full_response": response_text,
        "contact_name": req.contact_name,
    }


# ── Currency Conversion ─────────────────────────────────────────────────

class CurrencyConvertRequest(BaseModel):
    amount: float
    from_currency: str
    to_currency: str


@router.post("/currency-convert")
async def currency_convert(req: CurrencyConvertRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Convert currency using real-time exchange rates."""
    payload = _verify_auth(authorization)

    async with httpx.AsyncClient(timeout=15) as client:
        # Use a free exchange rate API
        try:
            r = await client.get(f"https://api.exchangerate-api.com/v4/latest/{req.from_currency.upper()}")
            r.raise_for_status()
            data = r.json()
            rate = data.get("rates", {}).get(req.to_currency.upper())
            if rate is None:
                raise HTTPException(400, f"Unknown currency: {req.to_currency}")
            converted = round(req.amount * rate, 2)
            await _audit_log_lazy()(db, payload.get("email", ""), "tool_currency_convert", f"{req.amount} {req.from_currency.upper()} -> {req.to_currency.upper()}")
            await db.commit()
            return {
                "amount": req.amount,
                "from": req.from_currency.upper(),
                "to": req.to_currency.upper(),
                "rate": rate,
                "result": converted,
                "formatted": f"{req.amount} {req.from_currency.upper()} = {converted} {req.to_currency.upper()}",
            }
        except httpx.HTTPError:
            raise HTTPException(500, "Exchange rate service unavailable")


# ── Company Lookup ───────────────────────────────────────────────────────

class CompanyLookupRequest(BaseModel):
    company: str


@router.post("/company-lookup")
async def company_lookup(req: CompanyLookupRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Look up company information."""
    payload = _verify_auth(authorization)

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    message = client.messages.create(
        model=AI_MODEL,
        max_tokens=800,
        messages=[{"role": "user", "content": f"Give me a brief company profile for {req.company}. Include: what they do, industry, approximate size/revenue if known, headquarters, key products/services, competitors. Be concise."}],
    )

    await _audit_log_lazy()(db, payload.get("email", ""), "tool_company_lookup", f"Company: {req.company[:40]}")
    await db.commit()
    return {"company": req.company, "profile": message.content[0].text if message.content else "No info found"}


# ── Flight Status ────────────────────────────────────────────────────────

class FlightStatusRequest(BaseModel):
    flight: str


@router.post("/flight-status")
async def flight_status(req: FlightStatusRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Check flight status."""
    payload = _verify_auth(authorization)

    async with httpx.AsyncClient(timeout=15) as client:
        # Use AviationStack or similar free API
        api_key = os.getenv("AVIATIONSTACK_KEY", "")
        if api_key:
            try:
                r = await client.get(f"https://api.aviationstack.com/v1/flights?access_key={api_key}&flight_iata={req.flight}")
                r.raise_for_status()
                flights = r.json().get("data", [])
                if flights:
                    f = flights[0]
                    await _audit_log_lazy()(db, payload.get("email", ""), "tool_flight_status", f"Flight: {req.flight}")
                    await db.commit()
                    return {
                        "flight": req.flight,
                        "status": f.get("flight_status", "unknown"),
                        "departure": f.get("departure", {}),
                        "arrival": f.get("arrival", {}),
                        "airline": f.get("airline", {}).get("name", ""),
                    }
            except Exception:
                pass

        # Fallback: return guidance
        await _audit_log_lazy()(db, payload.get("email", ""), "tool_flight_status", f"Flight: {req.flight}")
        await db.commit()
        return {
            "flight": req.flight,
            "message": f"Flight {req.flight} status — check flightaware.com or your airline's app for real-time updates.",
            "tip": "For real-time tracking, add your AVIATIONSTACK_KEY to the backend environment.",
        }


# ── Package Tracking ────────────────────────────────────────────────────

class PackageTrackingRequest(BaseModel):
    tracking_number: str
    carrier: Optional[str] = None


@router.post("/package-tracking")
async def package_tracking(req: PackageTrackingRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Track a package."""
    payload = _verify_auth(authorization)

    # Auto-detect carrier from tracking number format
    num = req.tracking_number.upper().strip()
    carrier = req.carrier or "unknown"
    if not req.carrier:
        if num.startswith("1Z"): carrier = "UPS"
        elif len(num) == 22 and num.isdigit(): carrier = "USPS"
        elif len(num) in [12, 15, 20] and num.isdigit(): carrier = "FedEx"
        elif len(num) == 10 and num.isdigit(): carrier = "DHL"

    tracking_urls = {
        "UPS": f"https://www.ups.com/track?tracknum={num}",
        "FedEx": f"https://www.fedex.com/fedextrack/?trknbr={num}",
        "USPS": f"https://tools.usps.com/go/TrackConfirmAction?tLabels={num}",
        "DHL": f"https://www.dhl.com/en/express/tracking.html?AWB={num}",
    }

    await _audit_log_lazy()(db, payload.get("email", ""), "tool_package_tracking", f"Tracking: {num}, Carrier: {carrier}")
    await db.commit()
    return {
        "tracking_number": num,
        "carrier": carrier,
        "tracking_url": tracking_urls.get(carrier, f"https://parcelsapp.com/en/tracking/{num}"),
        "message": f"Track your {carrier} package: {tracking_urls.get(carrier, 'https://parcelsapp.com/en/tracking/' + num)}",
    }
