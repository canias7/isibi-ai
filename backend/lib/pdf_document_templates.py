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

INVOICE_PROMPT = """You generate structured invoice data. Return ONLY a valid JSON object with this EXACT structure — no markdown, no explanation, no commentary:

{
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
- Generate realistic, detailed line items based on the user's description
- Include at least 3-5 line items unless the user specifies fewer
- Calculate subtotal, tax, and total correctly
- Use the user's company/client info if provided, otherwise generate realistic ones
- Currency defaults to USD unless specified
- Invoice number should be realistic (INV-0001 or similar)
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

    # ── Header: INVOICE title + invoice details ───────────────────────
    inv_number = data.get('invoice_number', 'INV-0001')
    inv_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    due_date = data.get('due_date', '')

    header_left = [
        [Paragraph('INVOICE', s['InvTitle'])],
    ]
    header_right_data = [
        [Paragraph('INVOICE NO.', s['InvLabel']), Paragraph(inv_number, s['InvValueBold'])],
        [Paragraph('DATE', s['InvLabel']), Paragraph(inv_date, s['InvValue'])],
    ]
    if due_date:
        header_right_data.append([Paragraph('DUE DATE', s['InvLabel']), Paragraph(due_date, s['InvValue'])])

    header_right = Table(header_right_data, colWidths=[1.0 * inch, 1.8 * inch])
    header_right.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))

    header_table = Table(
        [[Paragraph('INVOICE', s['InvTitle']), header_right]],
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
    totals_data.append(['TOTAL DUE', f"{sym}{total:,.2f}"])

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
        leftMargin=0.55 * inch, rightMargin=0.55 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
    )

    # ── Styles ────────────────────────────────────────────────────────
    s = getSampleStyleSheet()
    s.add(ParagraphStyle('ResName', fontSize=24, leading=28, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResTitle', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResContact', fontSize=8.5, leading=11, textColor=MID, fontName='Helvetica', alignment=TA_CENTER))
    s.add(ParagraphStyle('ResSectionHead', fontSize=11, leading=14, textColor=ACCENT_BLUE, fontName='Helvetica-Bold', spaceBefore=10, spaceAfter=2))
    s.add(ParagraphStyle('ResCompany', fontSize=10.5, leading=13, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('ResRole', fontSize=10, leading=13, textColor=MID, fontName='Helvetica-Oblique'))
    s.add(ParagraphStyle('ResDates', fontSize=9, leading=12, textColor=LIGHT, fontName='Helvetica'))
    s.add(ParagraphStyle('ResBullet', fontSize=9.5, leading=13, textColor=DARK, fontName='Helvetica', leftIndent=14, bulletIndent=4, spaceAfter=2))
    s.add(ParagraphStyle('ResBody', fontSize=9.5, leading=13, textColor=DARK, fontName='Helvetica', spaceAfter=4))
    s.add(ParagraphStyle('ResSkillCat', fontSize=9, leading=12, textColor=DARK, fontName='Helvetica-Bold'))
    s.add(ParagraphStyle('ResSkillList', fontSize=9, leading=12, textColor=MID, fontName='Helvetica'))
    s.add(ParagraphStyle('ResSmall', fontSize=8.5, leading=11, textColor=MID, fontName='Helvetica'))

    story = []

    # ── Name + title header ───────────────────────────────────────────
    name = data.get('name', 'Your Name')
    title = data.get('title', '')
    contact = data.get('contact', {})

    story.append(Paragraph(name, s['ResName']))
    if title:
        story.append(Paragraph(title, s['ResTitle']))
    story.append(Spacer(1, 6))

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

    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT_BLUE, spaceAfter=8))

    # ── Summary ───────────────────────────────────────────────────────
    summary = data.get('summary', '')
    if summary:
        story.append(Paragraph('PROFESSIONAL SUMMARY', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph(summary, s['ResBody']))
        story.append(Spacer(1, 4))

    # ── Experience ────────────────────────────────────────────────────
    experience = data.get('experience', [])
    if experience:
        story.append(Paragraph('EXPERIENCE', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))

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
                story.append(Paragraph(f"▸  {bullet}", s['ResBullet']))

            story.append(Spacer(1, 6))

    # ── Education ─────────────────────────────────────────────────────
    education = data.get('education', [])
    if education:
        story.append(Paragraph('EDUCATION', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))

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

            story.append(Spacer(1, 4))

    # ── Skills ────────────────────────────────────────────────────────
    skills = data.get('skills', {})
    if skills:
        story.append(Paragraph('SKILLS', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))

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
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph('  ·  '.join(certs), s['ResBody']))
        story.append(Spacer(1, 4))

    # ── Languages ─────────────────────────────────────────────────────
    languages = data.get('languages', [])
    if languages:
        story.append(Paragraph('LANGUAGES', s['ResSectionHead']))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
        story.append(Paragraph('  ·  '.join(languages), s['ResBody']))

    doc.build(story)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  PROPOSAL TEMPLATE
# ══════════════════════════════════════════════════════════════════════════

PROPOSAL_PROMPT = """You generate structured business proposal data. Return ONLY a valid JSON object with this EXACT structure — no markdown, no explanation, no commentary:

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
#  DOCUMENT TYPE DETECTION + ROUTING
# ══════════════════════════════════════════════════════════════════════════

INVOICE_KEYWORDS = ['invoice', 'bill', 'billing', 'factura', 'facture']
RESUME_KEYWORDS = ['resume', 'cv', 'curriculum vitae']
PROPOSAL_KEYWORDS = ['proposal', 'pitch', 'bid']
REPORT_KEYWORDS = ['report', 'analysis', 'findings', 'quarterly', 'annual review']


def detect_document_type(description: str) -> str | None:
    """Detect document type from user description. Returns type or None for generic."""
    desc = description.lower()
    if any(kw in desc for kw in INVOICE_KEYWORDS):
        return 'invoice'
    if any(kw in desc for kw in RESUME_KEYWORDS):
        return 'resume'
    if any(kw in desc for kw in PROPOSAL_KEYWORDS):
        return 'proposal'
    return None


def get_structured_prompt(doc_type: str) -> str:
    """Return the structured JSON prompt for a given document type."""
    if doc_type == 'invoice':
        return INVOICE_PROMPT
    if doc_type == 'resume':
        return RESUME_PROMPT
    if doc_type == 'proposal':
        return PROPOSAL_PROMPT
    return ""


def render_structured_pdf(doc_type: str, data: dict) -> bytes:
    """Render structured data into a PDF using the appropriate template."""
    if doc_type == 'invoice':
        return create_invoice_pdf(data)
    if doc_type == 'resume':
        return create_resume_pdf(data)
    if doc_type == 'proposal':
        return create_proposal_pdf(data)
    raise ValueError(f"Unknown document type: {doc_type}")
