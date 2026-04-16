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
    # Future: resume, proposal, report
    return None


def get_structured_prompt(doc_type: str) -> str:
    """Return the structured JSON prompt for a given document type."""
    if doc_type == 'invoice':
        return INVOICE_PROMPT
    return ""


def render_structured_pdf(doc_type: str, data: dict) -> bytes:
    """Render structured data into a PDF using the appropriate template."""
    if doc_type == 'invoice':
        return create_invoice_pdf(data)
    raise ValueError(f"Unknown document type: {doc_type}")
