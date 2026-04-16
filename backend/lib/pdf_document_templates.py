"""
Dedicated PDF templates for specific document types.
Each template takes structured JSON data and renders a professionally laid out PDF.
"""

import io
import json
import logging
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, Frame, PageTemplate, BaseDocTemplate,
)
from reportlab.pdfgen import canvas as pdf_canvas

logger = logging.getLogger(__name__)

# ── Brand colors ──────────────────────────────────────────────────────────
DARK = HexColor('#1a1a1a')
MID = HexColor('#555555')
LIGHT = HexColor('#888888')
LIGHT_BG = HexColor('#f8f8f8')
BORDER = HexColor('#e0e0e0')
WHITE = white
BLACK = black
PRIMARY = HexColor('#ec4899')
ACCENT_BLUE = HexColor('#2563eb')
ACCENT_GREEN = HexColor('#16a34a')


# ══════════════════════════════════════════════════════════════════════════
#  INVOICE TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

INVOICE_PROMPT = """You generate structured invoice or estimate data. Return ONLY a valid JSON object with this EXACT structure — no markdown, no explanation, no commentary:

{
  "document_type": "invoice",
  "invoice_number": "INV-0001",
  "date": "2024-03-15",
  "due_date": "2024-04-14",
  "from": {
    "company": "Company Name",
    "address": "123 Main St, City, State 12345",
    "email": "billing@company.com",
    "phone": "(555) 123-4567"
  },
  "to": {
    "company": "Client Name",
    "address": "456 Oak Ave, City, State 67890",
    "email": "client@example.com",
    "phone": "(555) 987-6543"
  },
  "items": [
    {"description": "Service or product name", "details": "Brief detail", "qty": 1, "rate": 150.00, "amount": 150.00},
    {"description": "Another item", "details": "Detail", "qty": 2, "rate": 75.00, "amount": 150.00}
  ],
  "subtotal": 300.00,
  "tax_rate": 10,
  "tax_amount": 30.00,
  "discount": 0.00,
  "total": 330.00,
  "currency": "USD",
  "notes": "Payment is due within 30 days. Thank you for your business.",
  "payment_methods": "Bank transfer, PayPal, or check"
}

RULES:
- Set document_type to "invoice" for invoices/bills, "estimate" for estimates/quotes
- For estimates: use number like EST-0001, no due_date needed, notes should say "This estimate is valid for 30 days"
- Generate realistic, detailed line items based on the user's description
- Include at least 3-5 line items unless the user specifies fewer
- Calculate subtotal, tax, and total correctly
- Use the user's company/client info if provided, otherwise generate realistic ones
- Currency defaults to USD unless specified
- Return ONLY the JSON. No text before or after."""


def create_invoice_pdf(data: dict) -> bytes:
    """Create a professional invoice PDF from structured data."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.6 * inch,
    )

    # ── Styles ────────────────────────────────────────────────────────
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('InvTitle', fontSize=28, leading=34, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvNumber', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvValue', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica'))
    s.add(ParagraphStyle('InvValueBold', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvCompany', fontSize=13, leading=16, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvSmall', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('InvNotes', fontSize=9, leading=13, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('InvTotalLabel', fontSize=11, leading=14, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvTotalValue', fontSize=16, leading=20, textColor=ACCENT_BLUE, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('InvFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))

    story = []
    currency = data.get('currency', 'USD')
    sym = {'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$'}.get(currency, '$')
    is_estimate = data.get('document_type', 'invoice').lower() in ('estimate', 'quote')
    doc_label = 'ESTIMATE' if is_estimate else 'INVOICE'
    num_label = 'ESTIMATE NO.' if is_estimate else 'INVOICE NO.'

    # ── Header: title + details ───────────────────────────────────────
    inv_number = data.get('invoice_number', 'EST-0001' if is_estimate else 'INV-0001')
    inv_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    due_date = data.get('due_date', '')

    header_right_data = [
        [Paragraph(num_label, s['InvLabel']), Paragraph(inv_number, s['InvValueBold'])],
        [Paragraph('DATE', s['InvLabel']), Paragraph(inv_date, s['InvValue'])],
    ]
    if due_date and not is_estimate:
        header_right_data.append([Paragraph('DUE DATE', s['InvLabel']), Paragraph(due_date, s['InvValue'])])
    if is_estimate:
        header_right_data.append([Paragraph('VALID FOR', s['InvLabel']), Paragraph('30 days', s['InvValue'])])

    header_right = Table(header_right_data, colWidths=[1.0 * inch, 1.8 * inch])
    header_right.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))

    header_table = Table(
        [[Paragraph(doc_label, s['InvTitle']), header_right]],
        colWidths=[4.0 * inch, 3.0 * inch]
    )
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(header_table)

    # Accent line
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT_BLUE, spaceAfter=16))

    # ── From / To blocks ──────────────────────────────────────────────
    from_data = data.get('from', {})
    to_data = data.get('to', {})

    def _address_block(label, info):
        lines = []
        lines.append(Paragraph(label, s['InvLabel']))
        lines.append(Spacer(1, 4))
        lines.append(Paragraph(info.get('company', ''), s['InvCompany']))
        if info.get('address'):
            lines.append(Paragraph(info['address'], s['InvSmall']))
        if info.get('email'):
            lines.append(Paragraph(info['email'], s['InvSmall']))
        if info.get('phone'):
            lines.append(Paragraph(info['phone'], s['InvSmall']))
        return lines

    from_block = _address_block('FROM', from_data)
    to_block = _address_block('BILL TO', to_data)

    addr_table = Table(
        [[from_block, to_block]],
        colWidths=[3.5 * inch, 3.5 * inch]
    )
    addr_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(addr_table)
    story.append(Spacer(1, 20))

    # ── Line items table ──────────────────────────────────────────────
    items = data.get('items', [])
    table_header = ['DESCRIPTION', 'QTY', 'RATE', 'AMOUNT']
    table_data = [table_header]

    for item in items:
        desc = item.get('description', '')
        details = item.get('details', '')
        if details:
            desc_para = Paragraph(f"<b>{desc}</b><br/><font size='8' color='#888888'>{details}</font>", s['InvValue'])
        else:
            desc_para = Paragraph(f"<b>{desc}</b>", s['InvValue'])
        qty = str(item.get('qty', 1))
        rate = f"{sym}{item.get('rate', 0):,.2f}"
        amount = f"{sym}{item.get('amount', 0):,.2f}"
        table_data.append([desc_para, qty, rate, amount])

    col_widths = [3.6 * inch, 0.8 * inch, 1.2 * inch, 1.2 * inch]
    items_table = Table(table_data, colWidths=col_widths)
    items_table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), DARK),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('LEFTPADDING', (0, 0), (-1, 0), 10),
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('LEFTPADDING', (0, 1), (-1, -1), 10),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        # Alignment
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
        # Grid
        ('LINEBELOW', (0, 0), (-1, 0), 1, DARK),
        ('LINEBELOW', (0, 1), (-1, -2), 0.5, BORDER),
        ('LINEBELOW', (0, -1), (-1, -1), 1, BORDER),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 16))

    # ── Totals box (right-aligned) ────────────────────────────────────
    subtotal = data.get('subtotal', 0)
    tax_rate = data.get('tax_rate', 0)
    tax_amount = data.get('tax_amount', 0)
    discount = data.get('discount', 0)
    total = data.get('total', 0)

    totals_data = [
        ['Subtotal', f"{sym}{subtotal:,.2f}"],
    ]
    if tax_rate:
        totals_data.append([f'Tax ({tax_rate}%)', f"{sym}{tax_amount:,.2f}"])
    if discount:
        totals_data.append(['Discount', f"-{sym}{discount:,.2f}"])
    totals_data.append(['', ''])  # spacer row
    totals_data.append(['ESTIMATED TOTAL' if is_estimate else 'TOTAL DUE', f"{sym}{total:,.2f}"])

    totals_table = Table(totals_data, colWidths=[1.5 * inch, 1.5 * inch])
    totals_style = [
        ('FONTNAME', (0, 0), (-1, -2), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -2), 10),
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        # Total row
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (0, -1), 11),
        ('FONTSIZE', (1, -1), (1, -1), 14),
        ('TEXTCOLOR', (1, -1), (1, -1), ACCENT_BLUE),
        ('LINEABOVE', (0, -1), (-1, -1), 1.5, DARK),
        ('TOPPADDING', (0, -1), (-1, -1), 10),
        # Hide spacer row
        ('FONTSIZE', (0, -2), (-1, -2), 2),
    ]
    totals_table.setStyle(TableStyle(totals_style))

    # Right-align the totals by putting in a wrapper table
    wrapper = Table(
        [['', totals_table]],
        colWidths=[3.8 * inch, 3.0 * inch]
    )
    wrapper.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    story.append(wrapper)
    story.append(Spacer(1, 24))

    # ── Notes + payment methods ───────────────────────────────────────
    notes = data.get('notes', '')
    payment = data.get('payment_methods', '')

    if notes or payment:
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=12))
        if notes:
            story.append(Paragraph('NOTES', s['InvLabel']))
            story.append(Spacer(1, 4))
            story.append(Paragraph(notes, s['InvNotes']))
            story.append(Spacer(1, 10))
        if payment:
            story.append(Paragraph('PAYMENT METHODS', s['InvLabel']))
            story.append(Spacer(1, 4))
            story.append(Paragraph(payment, s['InvNotes']))

    # ── Footer ────────────────────────────────────────────────────────
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['InvFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  RESUME TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

RESUME_PROMPT = """You generate structured resume data. Return ONLY a valid JSON object with this EXACT structure — no markdown, no explanation, no commentary:

{
  "name": "Full Name",
  "title": "Professional Title (e.g. Senior Software Engineer)",
  "contact": {
    "email": "email@example.com",
    "phone": "(555) 123-4567",
    "location": "City, State",
    "linkedin": "linkedin.com/in/name",
    "website": ""
  },
  "summary": "2-3 sentence professional summary highlighting key strengths and years of experience.",
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "dates": "Jan 2022 — Present",
      "location": "City, State",
      "bullets": [
        "Led a team of 8 engineers to deliver a platform serving 2M+ users, reducing latency by 40%",
        "Designed microservices architecture that cut infrastructure costs by $120K/year",
        "Implemented CI/CD pipeline reducing deployment time from 2 hours to 15 minutes"
      ]
    }
  ],
  "education": [
    {
      "school": "University Name",
      "degree": "Bachelor of Science in Computer Science",
      "dates": "2014 — 2018",
      "gpa": "3.8/4.0",
      "honors": "Magna Cum Laude"
    }
  ],
  "skills": {
    "Technical": ["Python", "JavaScript", "React", "AWS", "Docker"],
    "Leadership": ["Team Management", "Agile/Scrum", "Stakeholder Communication"]
  },
  "certifications": ["AWS Solutions Architect", "PMP"],
  "languages": ["English (Native)", "Spanish (Conversational)"]
}

RULES:
- Generate realistic, detailed content based on the user's description
- Experience bullets MUST start with strong action verbs and include quantified achievements
- Include 2-4 experience entries with 3-4 bullets each
- Skills should be grouped into 2-3 categories
- If the user provides their info, use it exactly. Otherwise generate realistic data for the role described
- Tailor everything to the specific role/industry mentioned
- Return ONLY the JSON. No text before or after."""


def create_resume_pdf(data: dict) -> bytes:
    """Create a professional resume PDF from structured data."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.4 * inch, bottomMargin=0.4 * inch,
    )

    # ── Styles ────────────────────────────────────────────────────────
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('ResName', fontSize=22, leading=26, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResTitle', fontSize=10, leading=13, textColor=ACCENT_BLUE, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResContact', fontSize=8, leading=10, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResSectionHead', fontSize=10, leading=13, textColor=ACCENT_BLUE, fontName='Helvetica-Bold', spaceBefore=6, spaceAfter=1))
    s.add(ParagraphStyle('ResCompany', fontSize=10, leading=12, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('ResRole', fontSize=9, leading=11, textColor=MID, fontName='Helvetica-Oblique'))
    s.add(ParagraphStyle('ResDates', fontSize=8.5, leading=11, textColor=LIGHT, fontName='Helvetica'))
    s.add(ParagraphStyle('ResBullet', fontSize=9, leading=12, textColor=DARK, fontName='Helvetica', leftIndent=12, bulletIndent=4, spaceAfter=1))
    s.add(ParagraphStyle('ResBody', fontSize=9, leading=12, textColor=DARK, fontName='Helvetica', spaceAfter=2))
    s.add(ParagraphStyle('ResSkillCat', fontSize=8.5, leading=11, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('ResSkillList', fontSize=8.5, leading=11, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('ResSmall', fontSize=8, leading=10, textColor=MID, fontName='Helvetica'))

    story = []

    # ── Name + title header ───────────────────────────────────────────
    name = data.get('name', 'Your Name')
    title = data.get('title', '')
    contact = data.get('contact', {})

    story.append(Paragraph(name, s['ResName']))
    if title:
        story.append(Paragraph(title, s['ResTitle']))
    story.append(Spacer(1, 3))

    # Contact row
    contact_parts = []
    if contact.get('email'):
        contact_parts.append(contact['email'])
    if contact.get('phone'):
        contact_parts.append(contact['phone'])
    if contact.get('location'):
        contact_parts.append(contact['location'])
    if contact.get('linkedin'):
        contact_parts.append(contact['linkedin'])
    if contact.get('website'):
        contact_parts.append(contact['website'])
    if contact_parts:
        story.append(Paragraph('  ·  '.join(contact_parts), s['ResContact']))

    story.append(Spacer(1, 2))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT_BLUE, spaceAfter=4))

    # ── Summary ───────────────────────────────────────────────────────
    summary = data.get('summary', '')
    if summary:
        story.append(Paragraph('PROFESSIONAL SUMMARY', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))
        story.append(Paragraph(summary, s['ResBody']))

    # ── Experience ────────────────────────────────────────────────────
    experience = data.get('experience', [])
    if experience:
        story.append(Paragraph('EXPERIENCE', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))

        for exp in experience:
            company = exp.get('company', '')
            role = exp.get('role', '')
            dates = exp.get('dates', '')
            location = exp.get('location', '')

            # Company + dates on one line
            right_text = dates
            if location:
                right_text = f"{location}  |  {dates}"

            header_table = Table(
                [[Paragraph(f"<b>{company}</b>", s['ResCompany']),
                  Paragraph(right_text, s['ResDates'])]],
                colWidths=[4.5 * inch, 2.4 * inch]
            )
            header_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
                ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ]))
            story.append(header_table)

            if role:
                story.append(Paragraph(role, s['ResRole']))

            for bullet in exp.get('bullets', []):
                story.append(Paragraph(f"-  {bullet}", s['ResBullet']))

            story.append(Spacer(1, 3))

    # ── Education ─────────────────────────────────────────────────────
    education = data.get('education', [])
    if education:
        story.append(Paragraph('EDUCATION', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))

        for edu in education:
            school = edu.get('school', '')
            degree = edu.get('degree', '')
            dates = edu.get('dates', '')
            gpa = edu.get('gpa', '')
            honors = edu.get('honors', '')

            header_table = Table(
                [[Paragraph(f"<b>{school}</b>", s['ResCompany']),
                  Paragraph(dates, s['ResDates'])]],
                colWidths=[4.5 * inch, 2.4 * inch]
            )
            header_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
                ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ]))
            story.append(header_table)

            detail_parts = []
            if degree:
                detail_parts.append(degree)
            if gpa:
                detail_parts.append(f"GPA: {gpa}")
            if honors:
                detail_parts.append(honors)
            if detail_parts:
                story.append(Paragraph('  |  '.join(detail_parts), s['ResRole']))

            story.append(Spacer(1, 2))

    # ── Skills ────────────────────────────────────────────────────────
    skills = data.get('skills', {})
    if skills:
        story.append(Paragraph('SKILLS', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))

        if isinstance(skills, dict):
            for category, skill_list in skills.items():
                if isinstance(skill_list, list):
                    skills_text = '  ·  '.join(skill_list)
                else:
                    skills_text = str(skill_list)
                skill_row = Table(
                    [[Paragraph(f"{category}:", s['ResSkillCat']),
                      Paragraph(skills_text, s['ResSkillList'])]],
                    colWidths=[1.3 * inch, 5.6 * inch]
                )
                skill_row.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), 2),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ]))
                story.append(skill_row)
        elif isinstance(skills, list):
            story.append(Paragraph('  ·  '.join(skills), s['ResSkillList']))

        story.append(Spacer(1, 4))

    # ── Certifications ────────────────────────────────────────────────
    certs = data.get('certifications', [])
    if certs:
        story.append(Paragraph('CERTIFICATIONS', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))
        story.append(Paragraph('  ·  '.join(certs), s['ResBody']))
        story.append(Spacer(1, 4))

    # ── Languages ─────────────────────────────────────────────────────
    languages = data.get('languages', [])
    if languages:
        story.append(Paragraph('LANGUAGES', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=3))
        story.append(Paragraph('  ·  '.join(languages), s['ResBody']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  PROPOSAL TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

PROPOSAL_PROMPT = """You generate structured business proposal or statement of work (SOW) data. Return ONLY a valid JSON object with this EXACT structure — no markdown, no explanation, no commentary:

{
  "title": "Project Proposal Title",
  "subtitle": "Prepared for Client Name",
  "prepared_by": {
    "company": "Your Company Name",
    "contact": "Your Name, Title",
    "email": "you@company.com",
    "phone": "(555) 123-4567"
  },
  "prepared_for": {
    "company": "Client Company",
    "contact": "Client Name, Title",
    "email": "client@company.com"
  },
  "date": "April 16, 2026",
  "executive_summary": "2-3 paragraph executive summary explaining the opportunity, proposed solution, and expected outcomes. Be specific with numbers and impact.",
  "problem_statement": "1-2 paragraphs clearly defining the problem or opportunity the client faces.",
  "proposed_solution": [
    {
      "title": "Phase 1: Discovery & Planning",
      "description": "Detailed description of what this phase involves and what it delivers."
    },
    {
      "title": "Phase 2: Development",
      "description": "Detailed description of the main work phase."
    },
    {
      "title": "Phase 3: Testing & Launch",
      "description": "Description of QA, deployment, and go-live."
    }
  ],
  "timeline": [
    {"phase": "Discovery & Planning", "duration": "2 weeks", "dates": "May 1 — May 14"},
    {"phase": "Development", "duration": "6 weeks", "dates": "May 15 — Jun 25"},
    {"phase": "Testing & Launch", "duration": "2 weeks", "dates": "Jun 26 — Jul 9"}
  ],
  "pricing": [
    {"item": "Discovery & Planning", "description": "Requirements, research, architecture", "amount": 5000},
    {"item": "Development", "description": "Core build, integrations, UI/UX", "amount": 25000},
    {"item": "Testing & Launch", "description": "QA, deployment, training", "amount": 5000},
    {"item": "Project Management", "description": "Coordination, status updates, documentation", "amount": 3000}
  ],
  "total": 38000,
  "currency": "USD",
  "deliverables": [
    "Fully functional platform deployed to production",
    "Technical documentation and admin guide",
    "30 days post-launch support",
    "Training session for client team"
  ],
  "terms": [
    "50% deposit upon signing, 25% at midpoint, 25% on delivery",
    "Proposal valid for 30 days from date above",
    "Changes in scope will be quoted separately",
    "All intellectual property transfers to client upon final payment"
  ],
  "why_us": "2-3 sentences about why your company is the best fit. Include relevant experience, team expertise, or unique advantages."
}

RULES:
- Generate realistic, detailed content tailored to the user's description
- Executive summary should be compelling and specific — include numbers
- Proposed solution should have 3-5 phases with clear descriptions
- Timeline must be realistic for the scope
- Pricing should include 3-6 line items that add up to the total
- Include at least 4 deliverables and 3-4 terms
- Currency defaults to USD unless specified
- Return ONLY the JSON. No text before or after."""


def create_proposal_pdf(data: dict) -> bytes:
    """Create a professional proposal PDF from structured data."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.6 * inch,
    )

    s = getSampleStyleSheet()
    s.add(ParagraphStyle('PropTitle', fontSize=26, leading=32, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('PropSubtitle', fontSize=12, leading=16, textColor=ACCENT_BLUE, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('PropDate', fontSize=10, leading=13, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('PropSection', fontSize=14, leading=18, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=16, spaceAfter=4))
    s.add(ParagraphStyle('PropBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('PropBodyBold', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica-Bold', spaceAfter=2))
    s.add(ParagraphStyle('PropBullet', fontSize=10, leading=14, textColor=DARK, fontName='Helvetica', leftIndent=16, bulletIndent=6, spaceAfter=3))
    s.add(ParagraphStyle('PropLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('PropSmall', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('PropTotalLabel', fontSize=11, leading=14, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('PropTotalValue', fontSize=16, leading=20, textColor=ACCENT_BLUE, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('PropFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))

    story = []
    currency = data.get('currency', 'USD')
    sym = {'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$'}.get(currency, '$')

    # ── Cover section ─────────────────────────────────────────────────
    story.append(Spacer(1, 40))
    story.append(Paragraph(data.get('title', 'Project Proposal'), s['PropTitle']))
    story.append(Spacer(1, 8))
    subtitle = data.get('subtitle', '')
    if subtitle:
        story.append(Paragraph(subtitle, s['PropSubtitle']))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="30%", thickness=3, color=ACCENT_BLUE, spaceAfter=12))
    story.append(Paragraph(data.get('date', datetime.now().strftime('%B %d, %Y')), s['PropDate']))
    story.append(Spacer(1, 24))

    # Prepared by / for blocks
    prep_by = data.get('prepared_by', {})
    prep_for = data.get('prepared_for', {})

    def _prep_block(label, info):
        lines = []
        lines.append(Paragraph(label, s['PropLabel']))
        lines.append(Spacer(1, 3))
        if info.get('company'):
            lines.append(Paragraph(f"<b>{info['company']}</b>", s['PropBody']))
        if info.get('contact'):
            lines.append(Paragraph(info['contact'], s['PropSmall']))
        if info.get('email'):
            lines.append(Paragraph(info['email'], s['PropSmall']))
        if info.get('phone'):
            lines.append(Paragraph(info['phone'], s['PropSmall']))
        return lines

    prep_table = Table(
        [[_prep_block('PREPARED BY', prep_by), _prep_block('PREPARED FOR', prep_for)]],
        colWidths=[3.5 * inch, 3.5 * inch]
    )
    prep_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(prep_table)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=16))

    # ── Executive Summary ─────────────────────────────────────────────
    exec_summary = data.get('executive_summary', '')
    if exec_summary:
        story.append(Paragraph('Executive Summary', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        # Highlight box
        box_data = [[Paragraph(exec_summary, s['PropBody'])]]
        box = Table(box_data, colWidths=[6.3 * inch])
        box.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0f7ff')),
            ('ROUNDEDCORNERS', [6, 6, 6, 6]),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('LEFTPADDING', (0, 0), (-1, -1), 14),
            ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ]))
        story.append(box)
        story.append(Spacer(1, 8))

    # ── Problem Statement ─────────────────────────────────────────────
    problem = data.get('problem_statement', '')
    if problem:
        story.append(Paragraph('The Challenge', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        story.append(Paragraph(problem, s['PropBody']))

    # ── Proposed Solution ─────────────────────────────────────────────
    solution = data.get('proposed_solution', [])
    if solution:
        story.append(Paragraph('Proposed Solution', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        for i, phase in enumerate(solution):
            story.append(Paragraph(f"{i+1}. {phase.get('title', '')}", s['PropBodyBold']))
            story.append(Paragraph(phase.get('description', ''), s['PropBody']))

    # ── Timeline ──────────────────────────────────────────────────────
    timeline = data.get('timeline', [])
    if timeline:
        story.append(Paragraph('Timeline', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))

        tl_header = ['PHASE', 'DURATION', 'DATES']
        tl_data = [tl_header]
        for item in timeline:
            tl_data.append([item.get('phase', ''), item.get('duration', ''), item.get('dates', '')])

        tl_table = Table(tl_data, colWidths=[2.8 * inch, 1.5 * inch, 2.5 * inch])
        tl_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9.5),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(tl_table)
        story.append(Spacer(1, 8))

    # ── Pricing ───────────────────────────────────────────────────────
    pricing = data.get('pricing', [])
    if pricing:
        story.append(Paragraph('Investment', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))

        pr_header = ['ITEM', 'DESCRIPTION', 'AMOUNT']
        pr_data = [pr_header]
        for item in pricing:
            pr_data.append([
                item.get('item', ''),
                item.get('description', ''),
                f"{sym}{item.get('amount', 0):,.2f}"
            ])

        pr_table = Table(pr_data, colWidths=[2.0 * inch, 3.3 * inch, 1.5 * inch])
        pr_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9.5),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(pr_table)

        # Total
        total = data.get('total', 0)
        total_row = Table(
            [['', 'TOTAL', f"{sym}{total:,.2f}"]],
            colWidths=[2.0 * inch, 3.3 * inch, 1.5 * inch]
        )
        total_row.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (1, 0), (1, 0), 10),
            ('FONTSIZE', (2, 0), (2, 0), 13),
            ('TEXTCOLOR', (2, 0), (2, 0), ACCENT_BLUE),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('LINEABOVE', (1, 0), (-1, 0), 1.5, DARK),
        ]))
        story.append(total_row)
        story.append(Spacer(1, 8))

    # ── Deliverables ──────────────────────────────────────────────────
    deliverables = data.get('deliverables', [])
    if deliverables:
        story.append(Paragraph('Deliverables', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        for d in deliverables:
            story.append(Paragraph(f"✓  {d}", s['PropBullet']))
        story.append(Spacer(1, 4))

    # ── Why Us ────────────────────────────────────────────────────────
    why_us = data.get('why_us', '')
    if why_us:
        story.append(Paragraph('Why Choose Us', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        box_data = [[Paragraph(why_us, s['PropBody'])]]
        box = Table(box_data, colWidths=[6.3 * inch])
        box.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0fdf4')),
            ('ROUNDEDCORNERS', [6, 6, 6, 6]),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('LEFTPADDING', (0, 0), (-1, -1), 14),
            ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ]))
        story.append(box)
        story.append(Spacer(1, 8))

    # ── Terms ─────────────────────────────────────────────────────────
    terms = data.get('terms', [])
    if terms:
        story.append(Paragraph('Terms & Conditions', s['PropSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
        for i, term in enumerate(terms):
            story.append(Paragraph(f"{i+1}.  {term}", s['PropBullet']))
        story.append(Spacer(1, 12))

    # ── Signature block ───────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=16))
    sig_table = Table(
        [
            [Paragraph('ACCEPTED BY', s['PropLabel']), '', Paragraph('DATE', s['PropLabel'])],
            ['_' * 35, '', '_' * 25],
            [Paragraph('Signature', s['PropSmall']), '', Paragraph('Date', s['PropSmall'])],
        ],
        colWidths=[3.2 * inch, 0.6 * inch, 3.0 * inch]
    )
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(sig_table)

    # ── Footer ────────────────────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['PropFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  LETTER TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

LETTER_PROMPT = """You generate structured business letter data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "from": {
    "name": "Your Name",
    "title": "Your Title",
    "company": "Company Name",
    "address": "123 Main St, City, State 12345",
    "email": "you@company.com",
    "phone": "(555) 123-4567"
  },
  "to": {
    "name": "Recipient Name",
    "title": "Recipient Title",
    "company": "Recipient Company",
    "address": "456 Oak Ave, City, State 67890"
  },
  "date": "April 16, 2026",
  "subject": "Brief subject line",
  "salutation": "Dear Mr./Ms. LastName,",
  "body": ["First paragraph of the letter.", "Second paragraph with details.", "Third paragraph with closing thoughts."],
  "closing": "Sincerely,",
  "signature_name": "Your Name",
  "signature_title": "Your Title"
}

RULES:
- Write professional, clear, concise paragraphs
- body is an array of paragraphs (3-5 paragraphs)
- Use the user's details if provided, otherwise generate realistic ones
- Match the tone to the letter type (formal, friendly, urgent, etc.)
- For OFFER LETTERS: include compensation details (salary, start date, benefits, equity) in the body paragraphs. Subject should be "Employment Offer — [Role]"
- For COVER LETTERS: tailor to the job/company. Subject can be omitted.
- Return ONLY the JSON."""


def create_letter_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.8*inch, rightMargin=0.8*inch, topMargin=0.7*inch, bottomMargin=0.7*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('LetFrom', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica'))
    s.add(ParagraphStyle('LetDate', fontSize=10, leading=13, textColor=MID, fontName='Helvetica', spaceBefore=16, spaceAfter=16))
    s.add(ParagraphStyle('LetTo', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica'))
    s.add(ParagraphStyle('LetSubject', fontSize=11, leading=14, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=14, spaceAfter=14))
    s.add(ParagraphStyle('LetBody', fontSize=10.5, leading=16, textColor=DARK, fontName='Helvetica', spaceAfter=10))
    s.add(ParagraphStyle('LetClosing', fontSize=10.5, leading=14, textColor=DARK, fontName='Helvetica', spaceBefore=16))
    s.add(ParagraphStyle('LetSig', fontSize=10.5, leading=14, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('LetSigTitle', fontSize=9.5, leading=13, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('LetFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    frm = data.get('from', {})
    to = data.get('to', {})

    # From block
    if frm.get('company'):
        story.append(Paragraph(f"<b>{frm['company']}</b>", s['LetFrom']))
    if frm.get('name') and frm.get('title'):
        story.append(Paragraph(f"{frm['name']}, {frm['title']}", s['LetFrom']))
    elif frm.get('name'):
        story.append(Paragraph(frm['name'], s['LetFrom']))
    if frm.get('address'):
        story.append(Paragraph(frm['address'], s['LetFrom']))
    if frm.get('email'):
        story.append(Paragraph(f"{frm.get('email', '')}  |  {frm.get('phone', '')}", s['LetFrom']))

    # Date
    story.append(Paragraph(data.get('date', ''), s['LetDate']))

    # To block
    if to.get('name'):
        story.append(Paragraph(f"<b>{to['name']}</b>", s['LetTo']))
    if to.get('title') and to.get('company'):
        story.append(Paragraph(f"{to['title']}, {to['company']}", s['LetTo']))
    elif to.get('company'):
        story.append(Paragraph(to['company'], s['LetTo']))
    if to.get('address'):
        story.append(Paragraph(to['address'], s['LetTo']))

    # Subject
    subject = data.get('subject', '')
    if subject:
        story.append(Paragraph(f"RE: {subject}", s['LetSubject']))

    # Salutation + body
    story.append(Paragraph(data.get('salutation', 'Dear Sir/Madam,'), s['LetBody']))
    for para in data.get('body', []):
        story.append(Paragraph(para, s['LetBody']))

    # Closing
    story.append(Paragraph(data.get('closing', 'Sincerely,'), s['LetClosing']))
    story.append(Spacer(1, 30))
    story.append(Paragraph(data.get('signature_name', ''), s['LetSig']))
    sig_title = data.get('signature_title', '')
    if sig_title:
        story.append(Paragraph(sig_title, s['LetSigTitle']))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['LetFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  CONTRACT TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

CONTRACT_PROMPT = """You generate structured service contract data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "title": "Service Agreement",
  "effective_date": "April 16, 2026",
  "party_a": {
    "name": "Company A Name",
    "address": "123 Main St, City, State 12345",
    "representative": "Person Name, Title"
  },
  "party_b": {
    "name": "Company B Name",
    "address": "456 Oak Ave, City, State 67890",
    "representative": "Person Name, Title"
  },
  "recitals": "Brief background paragraph explaining why this agreement exists.",
  "sections": [
    {"title": "Scope of Services", "content": "Detailed description of services to be provided."},
    {"title": "Compensation", "content": "Payment terms, amounts, schedule."},
    {"title": "Term and Termination", "content": "Duration of agreement and termination conditions."},
    {"title": "Confidentiality", "content": "Obligations regarding confidential information."},
    {"title": "Intellectual Property", "content": "Ownership of work product and IP rights."},
    {"title": "Limitation of Liability", "content": "Caps on liability and exclusions."},
    {"title": "Governing Law", "content": "Jurisdiction and applicable law."}
  ],
  "signatures": [
    {"party": "Company A", "name": "Person Name", "title": "Title"},
    {"party": "Company B", "name": "Person Name", "title": "Title"}
  ]
}

RULES:
- Generate realistic, legally-sound contract language
- Include 5-8 sections covering standard contract terms
- Use clear, professional legal language (not overly complex)
- Tailor to the specific service/agreement described by the user
- Return ONLY the JSON."""


def create_contract_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.7*inch, rightMargin=0.7*inch, topMargin=0.6*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('ConTitle', fontSize=20, leading=26, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('ConDate', fontSize=10, leading=13, textColor=MID, fontName='Helvetica', alignment=TA_CENTER, spaceAfter=16))
    s.add(ParagraphStyle('ConSection', fontSize=12, leading=16, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=14, spaceAfter=4))
    s.add(ParagraphStyle('ConBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('ConLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('ConSmall', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('ConFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    # Title
    story.append(Spacer(1, 10))
    story.append(Paragraph(data.get('title', 'Service Agreement'), s['ConTitle']))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="30%", thickness=2, color=DARK, spaceAfter=8))
    story.append(Paragraph(f"Effective Date: {data.get('effective_date', '')}", s['ConDate']))

    # Parties
    pa = data.get('party_a', {})
    pb = data.get('party_b', {})
    parties_data = [
        [
            [Paragraph('PARTY A', s['ConLabel']), Spacer(1, 3),
             Paragraph(f"<b>{pa.get('name', '')}</b>", s['ConBody']),
             Paragraph(pa.get('address', ''), s['ConSmall']),
             Paragraph(pa.get('representative', ''), s['ConSmall'])],
            [Paragraph('PARTY B', s['ConLabel']), Spacer(1, 3),
             Paragraph(f"<b>{pb.get('name', '')}</b>", s['ConBody']),
             Paragraph(pb.get('address', ''), s['ConSmall']),
             Paragraph(pb.get('representative', ''), s['ConSmall'])]
        ]
    ]
    pt = Table(parties_data, colWidths=[3.4*inch, 3.4*inch])
    pt.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BG),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(pt)

    # Recitals
    recitals = data.get('recitals', '')
    if recitals:
        story.append(Paragraph('RECITALS', s['ConSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(recitals, s['ConBody']))

    # Sections
    for i, section in enumerate(data.get('sections', []), 1):
        story.append(Paragraph(f"{i}. {section.get('title', '')}", s['ConSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(section.get('content', ''), s['ConBody']))

    # Signatures
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=DARK, spaceAfter=16))
    story.append(Paragraph('IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.', s['ConBody']))
    story.append(Spacer(1, 16))

    for sig in data.get('signatures', []):
        story.append(Paragraph(sig.get('party', ''), s['ConLabel']))
        story.append(Spacer(1, 20))
        story.append(Paragraph('_' * 40, s['ConBody']))
        story.append(Paragraph(f"{sig.get('name', '')}  —  {sig.get('title', '')}", s['ConSmall']))
        story.append(Paragraph('Date: _______________', s['ConSmall']))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['ConFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  RECEIPT TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

RECEIPT_PROMPT = """You generate structured receipt data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "receipt_number": "REC-2026-0001",
  "date": "April 16, 2026",
  "from": {
    "company": "Company Name",
    "address": "123 Main St, City, State 12345",
    "email": "info@company.com"
  },
  "to": {
    "name": "Customer Name",
    "email": "customer@email.com"
  },
  "payment_method": "Credit Card ending in 4242",
  "items": [
    {"description": "Item or service", "qty": 1, "amount": 99.00}
  ],
  "subtotal": 99.00,
  "tax": 7.92,
  "total": 106.92,
  "currency": "USD",
  "note": "Thank you for your purchase!"
}

RULES:
- Keep it simple — receipts are confirmations, not invoices
- Include realistic items based on the user's description
- Calculate totals correctly
- Return ONLY the JSON."""


def create_receipt_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.8*inch, rightMargin=0.8*inch, topMargin=0.6*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('RecTitle', fontSize=22, leading=26, textColor=ACCENT_GREEN, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('RecCheck', fontSize=36, leading=40, textColor=ACCENT_GREEN, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('RecLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('RecValue', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica'))
    s.add(ParagraphStyle('RecTotal', fontSize=16, leading=20, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('RecNote', fontSize=9, leading=12, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('RecFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []
    sym = {'USD': '$', 'EUR': '€', 'GBP': '£'}.get(data.get('currency', 'USD'), '$')

    # Header
    story.append(Spacer(1, 20))
    story.append(Paragraph('PAYMENT RECEIPT', s['RecTitle']))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="20%", thickness=2, color=ACCENT_GREEN, spaceAfter=12))

    # Receipt info
    frm = data.get('from', {})
    to = data.get('to', {})
    info_data = [
        [Paragraph('RECEIPT NO.', s['RecLabel']), Paragraph(data.get('receipt_number', ''), s['RecValue'])],
        [Paragraph('DATE', s['RecLabel']), Paragraph(data.get('date', ''), s['RecValue'])],
        [Paragraph('FROM', s['RecLabel']), Paragraph(frm.get('company', ''), s['RecValue'])],
        [Paragraph('TO', s['RecLabel']), Paragraph(to.get('name', ''), s['RecValue'])],
        [Paragraph('PAYMENT', s['RecLabel']), Paragraph(data.get('payment_method', ''), s['RecValue'])],
    ]
    info_table = Table(info_data, colWidths=[1.2*inch, 4.8*inch])
    info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 16))

    # Items
    items = data.get('items', [])
    t_header = ['DESCRIPTION', 'QTY', 'AMOUNT']
    t_data = [t_header]
    for item in items:
        t_data.append([item.get('description', ''), str(item.get('qty', 1)), f"{sym}{item.get('amount', 0):,.2f}"])

    items_table = Table(t_data, colWidths=[3.8*inch, 0.8*inch, 1.4*inch])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('LINEBELOW', (0, -1), (-1, -1), 1, BORDER),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8))

    # Totals
    subtotal = data.get('subtotal', 0)
    tax = data.get('tax', 0)
    total = data.get('total', 0)
    totals_data = [
        ['Subtotal', f"{sym}{subtotal:,.2f}"],
        ['Tax', f"{sym}{tax:,.2f}"],
    ]
    totals_table = Table(totals_data, colWidths=[1.2*inch, 1.2*inch])
    totals_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    wrapper = Table([['', totals_table]], colWidths=[3.6*inch, 2.4*inch])
    wrapper.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    story.append(wrapper)
    story.append(Spacer(1, 10))

    # Total paid box
    total_box = Table([[Paragraph(f"TOTAL PAID: {sym}{total:,.2f}", s['RecTotal'])]], colWidths=[6.0*inch])
    total_box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0fdf4')),
        ('ROUNDEDCORNERS', [6, 6, 6, 6]),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(total_box)

    # Note
    note = data.get('note', '')
    if note:
        story.append(Spacer(1, 16))
        story.append(Paragraph(note, s['RecNote']))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['RecFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  MEETING NOTES TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

MEETING_NOTES_PROMPT = """You generate structured meeting notes data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "title": "Meeting Title",
  "date": "April 16, 2026",
  "time": "2:00 PM — 3:00 PM",
  "location": "Conference Room A / Zoom",
  "attendees": [
    {"name": "Person Name", "role": "Title/Role"}
  ],
  "agenda": ["Topic 1", "Topic 2", "Topic 3"],
  "discussion": [
    {"topic": "Topic 1", "notes": "Summary of what was discussed, decisions made, key points raised."},
    {"topic": "Topic 2", "notes": "Summary of discussion."}
  ],
  "action_items": [
    {"task": "What needs to be done", "owner": "Person Name", "due": "April 23, 2026"},
    {"task": "Another task", "owner": "Person Name", "due": "April 30, 2026"}
  ],
  "next_meeting": "April 23, 2026 at 2:00 PM"
}

RULES:
- Generate realistic, detailed meeting notes based on the user's description
- Include 3-5 agenda items and discussion points
- Include 3-5 action items with owners and due dates
- Keep notes concise but informative
- Return ONLY the JSON."""


def create_meeting_notes_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('MtgTitle', fontSize=18, leading=22, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('MtgMeta', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('MtgSection', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica-Bold', spaceBefore=12, spaceAfter=3))
    s.add(ParagraphStyle('MtgBody', fontSize=10, leading=14, textColor=DARK, fontName='Helvetica', spaceAfter=4))
    s.add(ParagraphStyle('MtgBullet', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica', leftIndent=14, spaceAfter=2))
    s.add(ParagraphStyle('MtgTopic', fontSize=10, leading=13, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=6))
    s.add(ParagraphStyle('MtgFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    # Header
    story.append(Paragraph(data.get('title', 'Meeting Notes'), s['MtgTitle']))
    story.append(Spacer(1, 4))
    meta_parts = []
    if data.get('date'):
        meta_parts.append(data['date'])
    if data.get('time'):
        meta_parts.append(data['time'])
    if data.get('location'):
        meta_parts.append(data['location'])
    if meta_parts:
        story.append(Paragraph('  |  '.join(meta_parts), s['MtgMeta']))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT_BLUE, spaceAfter=10))

    # Attendees
    attendees = data.get('attendees', [])
    if attendees:
        story.append(Paragraph('ATTENDEES', s['MtgSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        att_parts = [f"<b>{a.get('name', '')}</b> ({a.get('role', '')})" for a in attendees]
        story.append(Paragraph('  ·  '.join(att_parts), s['MtgBody']))

    # Agenda
    agenda = data.get('agenda', [])
    if agenda:
        story.append(Paragraph('AGENDA', s['MtgSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        for i, item in enumerate(agenda, 1):
            story.append(Paragraph(f"{i}.  {item}", s['MtgBullet']))

    # Discussion
    discussion = data.get('discussion', [])
    if discussion:
        story.append(Paragraph('DISCUSSION', s['MtgSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        for d in discussion:
            story.append(Paragraph(d.get('topic', ''), s['MtgTopic']))
            story.append(Paragraph(d.get('notes', ''), s['MtgBody']))

    # Action Items
    actions = data.get('action_items', [])
    if actions:
        story.append(Paragraph('ACTION ITEMS', s['MtgSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        a_header = ['TASK', 'OWNER', 'DUE DATE']
        a_data = [a_header]
        for a in actions:
            a_data.append([a.get('task', ''), a.get('owner', ''), a.get('due', '')])
        a_table = Table(a_data, colWidths=[3.6*inch, 1.5*inch, 1.7*inch])
        a_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9.5),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(a_table)

    # Next meeting
    next_mtg = data.get('next_meeting', '')
    if next_mtg:
        story.append(Spacer(1, 12))
        box = Table([[Paragraph(f"<b>Next Meeting:</b>  {next_mtg}", s['MtgBody'])]], colWidths=[6.6*inch])
        box.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0f7ff')),
            ('ROUNDEDCORNERS', [4, 4, 4, 4]),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ]))
        story.append(box)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['MtgFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  NDA TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

NDA_PROMPT = """You generate structured NDA (Non-Disclosure Agreement) data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "title": "Non-Disclosure Agreement",
  "effective_date": "April 16, 2026",
  "disclosing_party": {
    "name": "Company A",
    "address": "123 Main St, City, State 12345",
    "representative": "Person Name, Title"
  },
  "receiving_party": {
    "name": "Company B",
    "address": "456 Oak Ave, City, State 67890",
    "representative": "Person Name, Title"
  },
  "purpose": "The purpose of this NDA is to protect confidential information shared in connection with [describe the business purpose].",
  "sections": [
    {"title": "Definition of Confidential Information", "content": "Detailed definition of what constitutes confidential information."},
    {"title": "Obligations of Receiving Party", "content": "How the receiving party must protect the information."},
    {"title": "Exclusions", "content": "What is NOT considered confidential (public info, independently developed, etc.)."},
    {"title": "Term", "content": "Duration of the NDA and survival period."},
    {"title": "Return of Materials", "content": "Obligation to return or destroy confidential materials."},
    {"title": "Remedies", "content": "Available remedies for breach including injunctive relief."},
    {"title": "Governing Law", "content": "Jurisdiction and applicable law."}
  ],
  "signatures": [
    {"party": "Disclosing Party", "company": "Company A", "name": "Person Name", "title": "Title"},
    {"party": "Receiving Party", "company": "Company B", "name": "Person Name", "title": "Title"}
  ]
}

RULES:
- Generate realistic, legally-sound NDA language
- Include standard NDA clauses (definition, obligations, exclusions, term, return, remedies, governing law)
- Tailor to the specific context described by the user
- Use clear legal language
- Return ONLY the JSON."""


def create_nda_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.7*inch, rightMargin=0.7*inch, topMargin=0.6*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('NdaTitle', fontSize=20, leading=26, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('NdaDate', fontSize=10, leading=13, textColor=MID, fontName='Helvetica', alignment=TA_CENTER, spaceAfter=12))
    s.add(ParagraphStyle('NdaSection', fontSize=11, leading=15, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=12, spaceAfter=4))
    s.add(ParagraphStyle('NdaBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('NdaLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('NdaSmall', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('NdaFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    # Title
    story.append(Spacer(1, 10))
    story.append(Paragraph(data.get('title', 'Non-Disclosure Agreement'), s['NdaTitle']))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="30%", thickness=2, color=DARK, spaceAfter=8))
    story.append(Paragraph(f"Effective Date: {data.get('effective_date', '')}", s['NdaDate']))

    # Parties
    dp = data.get('disclosing_party', {})
    rp = data.get('receiving_party', {})
    parties = Table(
        [[
            [Paragraph('DISCLOSING PARTY', s['NdaLabel']), Spacer(1, 3),
             Paragraph(f"<b>{dp.get('name', '')}</b>", s['NdaBody']),
             Paragraph(dp.get('address', ''), s['NdaSmall']),
             Paragraph(dp.get('representative', ''), s['NdaSmall'])],
            [Paragraph('RECEIVING PARTY', s['NdaLabel']), Spacer(1, 3),
             Paragraph(f"<b>{rp.get('name', '')}</b>", s['NdaBody']),
             Paragraph(rp.get('address', ''), s['NdaSmall']),
             Paragraph(rp.get('representative', ''), s['NdaSmall'])]
        ]],
        colWidths=[3.4*inch, 3.4*inch]
    )
    parties.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BG),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(parties)

    # Purpose
    purpose = data.get('purpose', '')
    if purpose:
        story.append(Paragraph('PURPOSE', s['NdaSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(purpose, s['NdaBody']))

    # Sections
    for i, section in enumerate(data.get('sections', []), 1):
        story.append(Paragraph(f"{i}. {section.get('title', '')}", s['NdaSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(section.get('content', ''), s['NdaBody']))

    # Signatures
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=DARK, spaceAfter=16))
    story.append(Paragraph('IN WITNESS WHEREOF, the parties have executed this Non-Disclosure Agreement as of the Effective Date.', s['NdaBody']))
    story.append(Spacer(1, 16))

    for sig in data.get('signatures', []):
        story.append(Paragraph(f"{sig.get('party', '')} — {sig.get('company', '')}", s['NdaLabel']))
        story.append(Spacer(1, 20))
        story.append(Paragraph('_' * 40, s['NdaBody']))
        story.append(Paragraph(f"{sig.get('name', '')}  —  {sig.get('title', '')}", s['NdaSmall']))
        story.append(Paragraph('Date: _______________', s['NdaSmall']))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['NdaFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  REPORT TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

REPORT_PROMPT = """You generate structured report data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "title": "Report Title",
  "subtitle": "Q1 2026 Performance Review",
  "prepared_by": "Your Name / Department",
  "date": "April 16, 2026",
  "executive_summary": "2-3 sentence overview of key findings.",
  "key_metrics": [
    {"value": "$1.2M", "label": "Revenue"},
    {"value": "24%", "label": "Growth"},
    {"value": "92%", "label": "Retention"},
    {"value": "4.8/5", "label": "CSAT"}
  ],
  "sections": [
    {
      "title": "Section Title",
      "content": "Paragraph of analysis and findings.",
      "data_table": {
        "headers": ["Category", "Q1", "Q2", "Change"],
        "rows": [["Sales", "$500K", "$620K", "+24%"]]
      }
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
  "conclusion": "Summary paragraph wrapping up the report."
}

RULES:
- Include 3-4 key metrics with impactful numbers
- Include 3-5 sections with detailed analysis
- Include data tables where relevant (not every section needs one)
- Recommendations should be actionable and specific
- Tailor everything to the user's description
- Return ONLY the JSON."""


def create_report_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('RptTitle', fontSize=22, leading=28, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('RptSub', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('RptMeta', fontSize=9, leading=12, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('RptSection', fontSize=13, leading=17, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=14, spaceAfter=4))
    s.add(ParagraphStyle('RptBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('RptBullet', fontSize=10, leading=14, textColor=DARK, fontName='Helvetica', leftIndent=14, spaceAfter=3))
    s.add(ParagraphStyle('RptMetricVal', fontSize=20, leading=24, textColor=ACCENT_BLUE, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('RptMetricLbl', fontSize=8, leading=10, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('RptFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    # Title
    story.append(Spacer(1, 10))
    story.append(Paragraph(data.get('title', 'Report'), s['RptTitle']))
    sub = data.get('subtitle', '')
    if sub:
        story.append(Paragraph(sub, s['RptSub']))
    story.append(Spacer(1, 4))
    meta_parts = []
    if data.get('prepared_by'):
        meta_parts.append(f"Prepared by {data['prepared_by']}")
    if data.get('date'):
        meta_parts.append(data['date'])
    if meta_parts:
        story.append(Paragraph('  |  '.join(meta_parts), s['RptMeta']))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="25%", thickness=2, color=ACCENT_BLUE, spaceAfter=14))

    # Key metrics cards
    metrics = data.get('key_metrics', [])
    if metrics:
        cells = []
        for m in metrics[:4]:
            cells.append([
                Paragraph(str(m.get('value', '')), s['RptMetricVal']),
                Paragraph(str(m.get('label', '')), s['RptMetricLbl']),
            ])
        col_w = 6.8 * inch / max(len(cells), 1)
        mt = Table([cells], colWidths=[col_w] * len(cells))
        mt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BG),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 14),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
            ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ]))
        story.append(mt)
        story.append(Spacer(1, 8))

    # Executive summary
    exec_sum = data.get('executive_summary', '')
    if exec_sum:
        story.append(Paragraph('Executive Summary', s['RptSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        box = Table([[Paragraph(exec_sum, s['RptBody'])]], colWidths=[6.6*inch])
        box.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0f7ff')),
            ('ROUNDEDCORNERS', [4, 4, 4, 4]),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ]))
        story.append(box)

    # Sections
    for section in data.get('sections', []):
        story.append(Paragraph(section.get('title', ''), s['RptSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(section.get('content', ''), s['RptBody']))
        dt = section.get('data_table')
        if dt and dt.get('headers') and dt.get('rows'):
            headers = dt['headers']
            rows = dt['rows']
            t_data = [headers] + rows
            col_w = 6.6 * inch / max(len(headers), 1)
            t = Table(t_data, colWidths=[col_w] * len(headers))
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), DARK),
                ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 8),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 9.5),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
                ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
            ]))
            story.append(Spacer(1, 4))
            story.append(t)
            story.append(Spacer(1, 4))

    # Recommendations
    recs = data.get('recommendations', [])
    if recs:
        story.append(Paragraph('Recommendations', s['RptSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        for i, r in enumerate(recs, 1):
            story.append(Paragraph(f"{i}.  {r}", s['RptBullet']))

    # Conclusion
    conclusion = data.get('conclusion', '')
    if conclusion:
        story.append(Paragraph('Conclusion', s['RptSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(conclusion, s['RptBody']))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['RptFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  BUSINESS PLAN TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

BUSINESS_PLAN_PROMPT = """You generate structured business plan data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "company_name": "Company Name",
  "tagline": "One-line description of what the company does",
  "date": "April 2026",
  "prepared_by": "Founder Name",
  "executive_summary": "2-3 paragraph overview of the business, market opportunity, and vision.",
  "problem": "What problem does this business solve? Be specific with market pain points.",
  "solution": "How does the product/service solve it? Key differentiators.",
  "market_analysis": {
    "tam": "$10B",
    "sam": "$2B",
    "som": "$200M",
    "description": "Brief market analysis paragraph."
  },
  "business_model": "How the company makes money. Pricing, revenue streams.",
  "competitive_landscape": [
    {"competitor": "Competitor A", "strength": "Large user base", "weakness": "Slow innovation"},
    {"competitor": "Competitor B", "strength": "Low price", "weakness": "Poor UX"}
  ],
  "go_to_market": "Marketing and sales strategy. Channels, partnerships, growth plan.",
  "team": [
    {"name": "Person Name", "role": "CEO", "background": "Brief relevant background"}
  ],
  "financials": {
    "headers": ["", "Year 1", "Year 2", "Year 3"],
    "rows": [
      ["Revenue", "$100K", "$500K", "$2M"],
      ["Expenses", "$250K", "$400K", "$1.2M"],
      ["Net", "-$150K", "$100K", "$800K"]
    ]
  },
  "funding": "How much funding is needed, what it will be used for.",
  "milestones": [
    {"milestone": "MVP Launch", "date": "Q2 2026"},
    {"milestone": "1,000 users", "date": "Q4 2026"},
    {"milestone": "Series A", "date": "Q2 2027"}
  ]
}

RULES:
- Generate realistic, compelling content tailored to the user's business idea
- Financial projections should be realistic for the stage
- Include 2-4 competitors in competitive landscape
- Include 2-4 team members
- Include 3-5 milestones
- Return ONLY the JSON."""


def create_business_plan_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('BpTitle', fontSize=24, leading=30, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('BpTagline', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica-Oblique', alignment=TA_CENTER))
    s.add(ParagraphStyle('BpMeta', fontSize=9, leading=12, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('BpSection', fontSize=13, leading=17, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=14, spaceAfter=4))
    s.add(ParagraphStyle('BpBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('BpBullet', fontSize=10, leading=14, textColor=DARK, fontName='Helvetica', leftIndent=14, spaceAfter=3))
    s.add(ParagraphStyle('BpLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('BpMetricVal', fontSize=18, leading=22, textColor=ACCENT_BLUE, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('BpMetricLbl', fontSize=8, leading=10, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('BpFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []

    # Cover
    story.append(Spacer(1, 30))
    story.append(Paragraph(data.get('company_name', 'Business Plan'), s['BpTitle']))
    tagline = data.get('tagline', '')
    if tagline:
        story.append(Spacer(1, 4))
        story.append(Paragraph(tagline, s['BpTagline']))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="25%", thickness=2, color=ACCENT_BLUE, spaceAfter=8))
    meta = []
    if data.get('prepared_by'):
        meta.append(f"Prepared by {data['prepared_by']}")
    if data.get('date'):
        meta.append(data['date'])
    if meta:
        story.append(Paragraph('  |  '.join(meta), s['BpMeta']))
    story.append(Spacer(1, 16))

    # Executive Summary
    es = data.get('executive_summary', '')
    if es:
        story.append(Paragraph('Executive Summary', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        box = Table([[Paragraph(es, s['BpBody'])]], colWidths=[6.6*inch])
        box.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor('#f0f7ff')),
            ('ROUNDEDCORNERS', [4, 4, 4, 4]),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ]))
        story.append(box)

    # Problem
    problem = data.get('problem', '')
    if problem:
        story.append(Paragraph('The Problem', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(problem, s['BpBody']))

    # Solution
    solution = data.get('solution', '')
    if solution:
        story.append(Paragraph('Our Solution', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(solution, s['BpBody']))

    # Market Analysis with TAM/SAM/SOM cards
    ma = data.get('market_analysis', {})
    if ma:
        story.append(Paragraph('Market Analysis', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        if ma.get('tam') or ma.get('sam') or ma.get('som'):
            cards = []
            for key, label in [('tam', 'TAM'), ('sam', 'SAM'), ('som', 'SOM')]:
                if ma.get(key):
                    cards.append([
                        Paragraph(str(ma[key]), s['BpMetricVal']),
                        Paragraph(label, s['BpMetricLbl']),
                    ])
            if cards:
                col_w = 6.6 * inch / len(cards)
                mt = Table([cards], colWidths=[col_w] * len(cards))
                mt.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BG),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('TOPPADDING', (0, 0), (-1, -1), 12),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
                    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
                ]))
                story.append(mt)
                story.append(Spacer(1, 6))
        if ma.get('description'):
            story.append(Paragraph(ma['description'], s['BpBody']))

    # Business Model
    bm = data.get('business_model', '')
    if bm:
        story.append(Paragraph('Business Model', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(bm, s['BpBody']))

    # Competitive Landscape
    comp = data.get('competitive_landscape', [])
    if comp:
        story.append(Paragraph('Competitive Landscape', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        c_data = [['COMPETITOR', 'STRENGTH', 'WEAKNESS']]
        for c in comp:
            c_data.append([c.get('competitor', ''), c.get('strength', ''), c.get('weakness', '')])
        ct = Table(c_data, colWidths=[2.2*inch, 2.2*inch, 2.2*inch])
        ct.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9.5),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(ct)

    # Go to Market
    gtm = data.get('go_to_market', '')
    if gtm:
        story.append(Paragraph('Go-to-Market Strategy', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(gtm, s['BpBody']))

    # Team
    team = data.get('team', [])
    if team:
        story.append(Paragraph('Team', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        for member in team:
            story.append(Paragraph(f"<b>{member.get('name', '')}</b> — {member.get('role', '')}", s['BpBody']))
            if member.get('background'):
                story.append(Paragraph(member['background'], s['BpBullet']))

    # Financial Projections
    fin = data.get('financials', {})
    if fin and fin.get('headers') and fin.get('rows'):
        story.append(Paragraph('Financial Projections', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        f_data = [fin['headers']] + fin['rows']
        col_w = 6.6 * inch / len(fin['headers'])
        ft = Table(f_data, colWidths=[col_w] * len(fin['headers']))
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
            ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ]))
        story.append(ft)

    # Funding
    funding = data.get('funding', '')
    if funding:
        story.append(Paragraph('Funding', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(funding, s['BpBody']))

    # Milestones
    milestones = data.get('milestones', [])
    if milestones:
        story.append(Paragraph('Milestones', s['BpSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        m_data = [['MILESTONE', 'TARGET DATE']]
        for m in milestones:
            m_data.append([m.get('milestone', ''), m.get('date', '')])
        mt = Table(m_data, colWidths=[4.4*inch, 2.2*inch])
        mt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), DARK),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(mt)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['BpFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  LEASE AGREEMENT TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

LEASE_PROMPT = """You generate structured lease/rental agreement data. Return ONLY a valid JSON object — no markdown, no explanation:

{
  "title": "Residential Lease Agreement",
  "effective_date": "May 1, 2026",
  "landlord": {
    "name": "Landlord Name / Property Management Co",
    "address": "123 Main St, City, State 12345",
    "phone": "(555) 123-4567",
    "email": "landlord@email.com"
  },
  "tenant": {
    "name": "Tenant Name",
    "phone": "(555) 987-6543",
    "email": "tenant@email.com"
  },
  "property": {
    "address": "456 Oak Ave, Apt 2B, City, State 67890",
    "type": "Apartment",
    "bedrooms": 2,
    "bathrooms": 1
  },
  "lease_term": {
    "start_date": "May 1, 2026",
    "end_date": "April 30, 2027",
    "duration": "12 months"
  },
  "rent": {
    "monthly_amount": 1800,
    "due_day": 1,
    "late_fee": 75,
    "grace_period_days": 5
  },
  "security_deposit": 1800,
  "currency": "USD",
  "sections": [
    {"title": "Use of Premises", "content": "The premises shall be used solely as a private residence."},
    {"title": "Maintenance and Repairs", "content": "Tenant responsible for minor maintenance. Landlord responsible for structural repairs."},
    {"title": "Utilities", "content": "Tenant is responsible for electricity, gas, water, internet, and cable."},
    {"title": "Pets", "content": "No pets allowed without prior written consent. Pet deposit of $500 required."},
    {"title": "Termination", "content": "Either party may terminate with 60 days written notice. Early termination requires 2 months rent penalty."},
    {"title": "Governing Law", "content": "This agreement is governed by the laws of the State."}
  ],
  "signatures": [
    {"party": "Landlord", "name": "Landlord Name"},
    {"party": "Tenant", "name": "Tenant Name"}
  ]
}

RULES:
- Generate realistic lease terms based on the user's description
- Include standard lease clauses (use, maintenance, utilities, pets, termination, governing law)
- Monthly rent and deposit should be realistic for the property type and location
- Return ONLY the JSON."""


def create_lease_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.7*inch, rightMargin=0.7*inch, topMargin=0.6*inch, bottomMargin=0.6*inch)
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('LsTitle', fontSize=20, leading=26, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('LsDate', fontSize=10, leading=13, textColor=MID, fontName='Helvetica', alignment=TA_CENTER, spaceAfter=12))
    s.add(ParagraphStyle('LsSection', fontSize=11, leading=15, textColor=DARK, fontName='Helvetica-Bold', spaceBefore=12, spaceAfter=4))
    s.add(ParagraphStyle('LsBody', fontSize=10, leading=15, textColor=DARK, fontName='Helvetica', spaceAfter=6))
    s.add(ParagraphStyle('LsLabel', fontSize=8, leading=10, textColor=LIGHT, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('LsSmall', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('LsFooter', fontSize=7.5, leading=10, textColor=LIGHT, fontName='Helvetica', alignment=TA_CENTER))
    story = []
    sym = {'USD': '$', 'EUR': '€', 'GBP': '£'}.get(data.get('currency', 'USD'), '$')

    # Title
    story.append(Spacer(1, 10))
    story.append(Paragraph(data.get('title', 'Lease Agreement'), s['LsTitle']))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="30%", thickness=2, color=DARK, spaceAfter=8))
    story.append(Paragraph(f"Effective Date: {data.get('effective_date', '')}", s['LsDate']))

    # Parties
    ll = data.get('landlord', {})
    tn = data.get('tenant', {})
    parties = Table([[
        [Paragraph('LANDLORD', s['LsLabel']), Spacer(1, 3),
         Paragraph(f"<b>{ll.get('name', '')}</b>", s['LsBody']),
         Paragraph(ll.get('address', ''), s['LsSmall']),
         Paragraph(f"{ll.get('email', '')}  |  {ll.get('phone', '')}", s['LsSmall'])],
        [Paragraph('TENANT', s['LsLabel']), Spacer(1, 3),
         Paragraph(f"<b>{tn.get('name', '')}</b>", s['LsBody']),
         Paragraph(f"{tn.get('email', '')}  |  {tn.get('phone', '')}", s['LsSmall'])]
    ]], colWidths=[3.4*inch, 3.4*inch])
    parties.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BG),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(parties)

    # Property details
    prop = data.get('property', {})
    term = data.get('lease_term', {})
    rent = data.get('rent', {})
    deposit = data.get('security_deposit', 0)

    story.append(Paragraph('Property Details', s['LsSection']))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))

    def _money(val):
        try:
            return f"{sym}{float(val):,.2f}"
        except (ValueError, TypeError):
            return str(val)

    monthly = rent.get('monthly_amount', rent.get('amount', 0))
    late = rent.get('late_fee', 'N/A')
    due_day = rent.get('due_day', rent.get('due_date', '1st'))
    grace = rent.get('grace_period_days', '')
    deposit_val = data.get('security_deposit', data.get('deposit', {}))
    if isinstance(deposit_val, dict):
        deposit_display = _money(deposit_val.get('amount', 0))
        deposit_terms = deposit_val.get('terms', '')
    else:
        deposit_display = _money(deposit_val)
        deposit_terms = ''

    late_display = _money(late) if isinstance(late, (int, float)) else str(late)
    if grace:
        late_display += f" after {grace} day grace period"

    details = [
        ['ADDRESS', prop.get('address', '')],
        ['TYPE', prop.get('type', '')],
        ['LEASE TERM', f"{term.get('start_date', term.get('start', ''))} to {term.get('end_date', term.get('end', ''))}"],
        ['MONTHLY RENT', f"{_money(monthly)} due on the {due_day} of each month"],
        ['LATE FEE', late_display],
        ['SECURITY DEPOSIT', deposit_display],
    ]
    for label, value in details:
        row = Table([[Paragraph(label, s['LsLabel']), Paragraph(value, s['LsBody'])]], colWidths=[1.5*inch, 5.3*inch])
        row.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(row)

    # Sections
    for i, section in enumerate(data.get('sections', []), 1):
        story.append(Paragraph(f"{i}. {section.get('title', '')}", s['LsSection']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(section.get('content', ''), s['LsBody']))

    # Signatures
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=DARK, spaceAfter=16))
    story.append(Paragraph('IN WITNESS WHEREOF, the parties have executed this Lease Agreement as of the Effective Date.', s['LsBody']))
    story.append(Spacer(1, 16))

    for sig in data.get('signatures', []):
        story.append(Paragraph(sig.get('party', ''), s['LsLabel']))
        story.append(Spacer(1, 20))
        story.append(Paragraph('_' * 40, s['LsBody']))
        story.append(Paragraph(sig.get('name', ''), s['LsSmall']))
        story.append(Paragraph('Date: _______________', s['LsSmall']))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph('Generated by GoFarther AI', s['LsFooter']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  DOCUMENT TYPE DETECTION + ROUTING
# ══════════════════════════════════════════════════════════════════════════

INVOICE_KEYWORDS = ['invoice', 'bill', 'billing', 'factura', 'facture', 'estimate', 'quote', 'quotation']
RESUME_KEYWORDS = ['resume', 'cv', 'curriculum vitae']
PROPOSAL_KEYWORDS = ['proposal', 'pitch', 'bid', 'sow', 'statement of work']
LETTER_KEYWORDS = ['letter', 'formal letter', 'business letter', 'cover letter', 'offer letter']
CONTRACT_KEYWORDS = ['contract', 'agreement', 'service agreement']
RECEIPT_KEYWORDS = ['receipt', 'payment receipt', 'payment confirmation']
MEETING_KEYWORDS = ['meeting notes', 'meeting minutes', 'meeting summary']
NDA_KEYWORDS = ['nda', 'non-disclosure', 'non disclosure', 'confidentiality agreement']
REPORT_KEYWORDS = ['report', 'analysis', 'findings', 'quarterly report', 'annual report', 'performance review']
BUSINESS_PLAN_KEYWORDS = ['business plan', 'startup plan', 'venture plan', 'pitch deck']
LEASE_KEYWORDS = ['lease', 'rental agreement', 'tenancy agreement', 'rent agreement']


def detect_document_type(description: str) -> str | None:
    desc = description.lower()
    if any(kw in desc for kw in NDA_KEYWORDS):
        return 'nda'
    if any(kw in desc for kw in LEASE_KEYWORDS):
        return 'lease'
    if any(kw in desc for kw in CONTRACT_KEYWORDS):
        return 'contract'
    if any(kw in desc for kw in BUSINESS_PLAN_KEYWORDS):
        return 'business_plan'
    if any(kw in desc for kw in INVOICE_KEYWORDS):
        return 'invoice'
    if any(kw in desc for kw in RESUME_KEYWORDS):
        return 'resume'
    if any(kw in desc for kw in PROPOSAL_KEYWORDS):
        return 'proposal'
    if any(kw in desc for kw in RECEIPT_KEYWORDS):
        return 'receipt'
    if any(kw in desc for kw in MEETING_KEYWORDS):
        return 'meeting_notes'
    if any(kw in desc for kw in REPORT_KEYWORDS):
        return 'report'
    if any(kw in desc for kw in LETTER_KEYWORDS):
        return 'letter'
    return None


def get_structured_prompt(doc_type: str) -> str:
    prompts = {
        'invoice': INVOICE_PROMPT,
        'resume': RESUME_PROMPT,
        'proposal': PROPOSAL_PROMPT,
        'letter': LETTER_PROMPT,
        'contract': CONTRACT_PROMPT,
        'receipt': RECEIPT_PROMPT,
        'meeting_notes': MEETING_NOTES_PROMPT,
        'nda': NDA_PROMPT,
        'report': REPORT_PROMPT,
        'business_plan': BUSINESS_PLAN_PROMPT,
        'lease': LEASE_PROMPT,
    }
    return prompts.get(doc_type, '')


def render_structured_pdf(doc_type: str, data: dict) -> bytes:
    renderers = {
        'invoice': create_invoice_pdf,
        'resume': create_resume_pdf,
        'proposal': create_proposal_pdf,
        'letter': create_letter_pdf,
        'contract': create_contract_pdf,
        'receipt': create_receipt_pdf,
        'meeting_notes': create_meeting_notes_pdf,
        'nda': create_nda_pdf,
        'report': create_report_pdf,
        'business_plan': create_business_plan_pdf,
        'lease': create_lease_pdf,
    }
    renderer = renderers.get(doc_type)
    if not renderer:
        raise ValueError(f"Unknown document type: {doc_type}")
    return renderer(data)
