from __future__ import annotations

"""
Public intake form submission — no auth required.
Receives form data and sends it to the configured email via Resend.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any

import resend
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["intake-form"])

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi.ai <onboarding@resend.dev>")
INTAKE_NOTIFY_EMAIL = os.getenv("INTAKE_NOTIFY_EMAIL", "aniascristian@gmail.com")


class IntakeFormData(BaseModel):
    # All fields optional since the form is multi-step
    business_name: str = ""
    tagline: str = ""
    business_description: str = ""
    services: str = ""
    service_area: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    social_media: str = ""
    main_goal: str = ""
    visitor_action: str = ""
    has_logo: str = ""
    brand_colors: str = ""
    preferred_style: str = ""
    example_websites: str = ""
    headline: str = ""
    short_description: str = ""
    top_services: str = ""
    why_choose_us: str = ""
    benefits: str = ""
    testimonials: str = ""
    faq: str = ""
    pages_needed: Any = ""
    main_service_name: str = ""
    service_description: str = ""
    who_its_for: str = ""
    main_benefit: str = ""
    cta_text: str = ""
    has_photos: str = ""
    need_writing: str = ""
    licenses: str = ""
    awards: str = ""
    partnerships: str = ""
    reviews: str = ""
    main_button_text: str = ""
    click_to_call: str = ""
    extra_features: Any = ""
    unique_selling_point: str = ""
    must_include: str = ""
    must_exclude: str = ""
    client_name: str = ""
    client_date: str = ""


def _format_value(val: Any) -> str:
    if isinstance(val, list):
        return ", ".join(str(v) for v in val) if val else "—"
    return str(val).strip() if val else "—"


def _build_email_html(data: IntakeFormData) -> str:
    sections = [
        ("Business Information", [
            ("Business Name", data.business_name),
            ("Tagline/Slogan", data.tagline),
            ("What the business does", data.business_description),
            ("Services", data.services),
            ("Service Area", data.service_area),
            ("Phone", data.phone),
            ("Email", data.email),
            ("Address", data.address),
            ("Social Media", data.social_media),
        ]),
        ("Website Goal", [
            ("Main Goal", data.main_goal),
            ("Visitor First Action", data.visitor_action),
        ]),
        ("Branding", [
            ("Has Logo", data.has_logo),
            ("Brand Colors", data.brand_colors),
            ("Preferred Style", data.preferred_style),
            ("Example Websites", data.example_websites),
        ]),
        ("Homepage Content", [
            ("Main Headline", data.headline),
            ("Short Description", data.short_description),
            ("Top 3 Services", data.top_services),
            ("Why Choose Them", data.why_choose_us),
            ("Benefits/Features", data.benefits),
            ("Testimonials", data.testimonials),
            ("FAQ", data.faq),
        ]),
        ("Pages & Structure", [
            ("Pages Needed", data.pages_needed),
        ]),
        ("Service Details", [
            ("Main Service Name", data.main_service_name),
            ("Description", data.service_description),
            ("Target Audience", data.who_its_for),
            ("Main Benefit", data.main_benefit),
            ("CTA Text", data.cta_text),
        ]),
        ("Images & Content", [
            ("Has Photos", data.has_photos),
            ("Needs Content Writing", data.need_writing),
        ]),
        ("Trust & Credibility", [
            ("Licenses/Certifications", data.licenses),
            ("Awards", data.awards),
            ("Partnerships", data.partnerships),
            ("Reviews", data.reviews),
        ]),
        ("Call to Action", [
            ("Main Button Text", data.main_button_text),
            ("Click-to-Call", data.click_to_call),
        ]),
        ("Extra Features", [
            ("Requested Features", data.extra_features),
        ]),
        ("Final Notes", [
            ("Unique Selling Point", data.unique_selling_point),
            ("Must Include", data.must_include),
            ("Must Exclude", data.must_exclude),
            ("Client Name", data.client_name),
            ("Date", data.client_date),
        ]),
    ]

    rows_html = ""
    for section_title, fields in sections:
        rows_html += f"""
        <tr>
          <td colspan="2" style="padding:16px 0 8px;border-bottom:2px solid #ec4899">
            <h3 style="margin:0;font-size:15px;font-weight:700;color:#ec4899">{section_title}</h3>
          </td>
        </tr>"""
        for label, value in fields:
            formatted = _format_value(value)
            rows_html += f"""
        <tr>
          <td style="padding:8px 12px 8px 0;color:#888;font-size:13px;font-weight:600;vertical-align:top;width:180px;border-bottom:1px solid #f0f0f0">{label}</td>
          <td style="padding:8px 0;font-size:13px;color:#333;border-bottom:1px solid #f0f0f0;white-space:pre-wrap">{formatted}</td>
        </tr>"""

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#ec4899,#8b5cf6);border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
        <h1 style="margin:0;color:white;font-size:22px;font-weight:800">New Website Intake Form</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Submitted on {datetime.now(timezone.utc).strftime('%B %d, %Y at %I:%M %p UTC')}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">{rows_html}</table>
      <div style="margin-top:24px;padding:16px;background:#f8f8f8;border-radius:8px;text-align:center">
        <p style="margin:0;font-size:12px;color:#888">This form was submitted via isibi.ai/website123</p>
      </div>
    </div>
    """


@router.post("/intake-form/submit")
async def submit_intake_form(data: IntakeFormData):
    """
    Receive a website intake form submission and email it.
    No authentication required — this is a public form.
    """
    if not data.business_name and not data.client_name and not data.email:
        raise HTTPException(status_code=400, detail="Please fill out at least your business name and email.")

    # Build email
    html = _build_email_html(data)
    subject = f"Website Intake Form: {data.business_name or data.client_name or 'New Submission'}"

    # Send via Resend
    if RESEND_API_KEY:
        try:
            resend.api_key = RESEND_API_KEY
            resend.Emails.send({
                "from": FROM_EMAIL,
                "to": [INTAKE_NOTIFY_EMAIL],
                "reply_to": data.email or None,
                "subject": subject,
                "html": html,
            })
            logger.info("Intake form email sent for: %s", data.business_name)
        except Exception as e:
            logger.error("Failed to send intake form email: %s", e)
            # Still return success — we don't want the user to think it failed
    else:
        logger.info("DEV MODE — Intake form received: %s", data.business_name)
        logger.info("Subject: %s", subject)

    return {"success": True, "message": "Form submitted successfully!"}
