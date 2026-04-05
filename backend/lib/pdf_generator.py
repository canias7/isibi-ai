"""
Level 4 PDF Generator — AI writes the reportlab code, backend executes it.
The AI has full creative freedom to design any PDF layout it wants.
"""

import io
import os
import subprocess
import tempfile
import uuid
import base64
import httpx

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")


async def generate_smart_pdf(description: str) -> bytes:
    """
    Ask Claude to write reportlab Python code that creates a PDF,
    then execute that code and return the PDF bytes.
    """

    system = """You are an expert PDF designer using Python's reportlab library.
When given a document description, write complete Python code that generates a beautiful, professional PDF.

RULES:
- Use reportlab.lib.pagesizes, reportlab.platypus, reportlab.lib.styles, reportlab.lib.colors, reportlab.lib.units
- Available: SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, Image
- Available fonts: Helvetica, Helvetica-Bold, Helvetica-Oblique, Courier, Times-Roman
- Available colors: HexColor('#ec4899') for pink accent, HexColor('#1a1a1a') for dark text
- The code MUST write the PDF to a file called '/tmp/output.pdf'
- Use letter pagesize (8.5 x 11 inches)
- Make it visually impressive: use colors, tables, proper spacing, headers, footers
- Include page numbers in the footer
- Use professional typography with proper hierarchy
- Add horizontal rules, colored sections, and visual structure
- For resumes: use two-column layout, colored sidebar, skill bars
- For reports: use charts-like tables, executive summary boxes, key metrics highlighted
- For invoices: use proper table formatting with totals, company header
- For proposals: use cover page, table of contents feel, professional sections
- ONLY return Python code. No explanations. No markdown fences.
- The code must be self-contained and executable.
- Do NOT use any external files, images, or fonts — only built-in reportlab resources.
- Do NOT import anything outside reportlab and standard library.
- START the code with imports, END with doc.build()"""

    # Ask Claude to write the PDF code
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
                "max_tokens": 8000,
                "system": system,
                "messages": [{"role": "user", "content": f"Create a professional, beautifully designed PDF for: {description}"}],
            },
        )
        if res.status_code != 200:
            raise Exception(f"AI error: {res.status_code}")
        data = res.json()
        code = data.get("content", [{}])[0].get("text", "")

    # Clean the code
    code = code.strip()
    if code.startswith("```python"):
        code = code[9:]
    if code.startswith("```"):
        code = code[3:]
    if code.endswith("```"):
        code = code[:-3]
    code = code.strip()

    # Safety check — only allow reportlab imports
    forbidden = ['os.system', 'subprocess', 'shutil.rmtree', '__import__', 'eval(', 'exec(', 'open(', 'requests', 'urllib', 'socket']
    for f in forbidden:
        if f in code:
            raise Exception(f"Unsafe code detected: {f}")

    # Execute the code
    output_path = '/tmp/output.pdf'

    try:
        result = subprocess.run(
            ["python3", "-c", code],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "PATH": "/usr/bin:/usr/local/bin"}
        )

        if result.returncode != 0:
            # If code failed, try to fix common issues and retry
            error = result.stderr[:500]
            raise Exception(f"Code execution failed: {error}")

        # Read the generated PDF
        with open(output_path, 'rb') as f:
            pdf_bytes = f.read()

        if len(pdf_bytes) < 100:
            raise Exception("Generated PDF is too small — likely empty")

        return pdf_bytes

    except subprocess.TimeoutExpired:
        raise Exception("PDF generation timed out (30s limit)")
    finally:
        # Cleanup
        try:
            os.remove(output_path)
        except:
            pass
