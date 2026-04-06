"""
Ghost AI Tools — file creation, web intelligence, code interpreter, data analysis.

Routes:
  POST /api/ghost/tools/create-file         — create PDF/XLSX/DOCX/CSV/TXT
  POST /api/ghost/tools/create-presentation — create slide deck
  POST /api/ghost/tools/web-search          — search web, return results
  POST /api/ghost/tools/read-url            — scrape and summarize a URL
  POST /api/ghost/tools/read-pdf            — read uploaded PDF, summarize
  POST /api/ghost/tools/stock-report        — stock analysis
  POST /api/ghost/tools/weather-report      — weather forecast
  POST /api/ghost/tools/news                — latest news on topic
  POST /api/ghost/tools/translate-doc       — translate document
  POST /api/ghost/tools/run-code            — execute Python code
  POST /api/ghost/tools/analyze-data        — analyze CSV data
"""

from __future__ import annotations
import os
import io
import re
import json
import base64
import tempfile
import uuid
import httpx
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/ghost/tools", tags=["ghost-tools"])

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Simple file storage — files stored in /tmp with unique IDs
# In production, use S3 or Cloudinary
FILE_STORE: dict[str, dict] = {}


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


# ─── FILE CREATION ────────────────────────────────────────────────────────

class CreateFileRequest(BaseModel):
    description: str  # What the file should contain
    file_type: Optional[str] = "pdf"  # pdf, xlsx, docx, csv, txt
    filename: Optional[str] = None
    quality: Optional[str] = "standard"  # standard or premium


@router.post("/create-file")
async def create_file(req: CreateFileRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    # Ask AI to generate the content with professional quality
    format_instructions = {
        "csv": "Return raw CSV data with headers. Use proper column names. Include realistic, detailed data.",
        "txt": "Return well-written plain text with clear structure.",
        "xlsx": "Return a JSON array of objects where keys are column headers. Include realistic data with at least 10 rows. Use proper number formatting.",
        "pdf": "Return well-structured text using markdown-style headings (# for H1, ## for H2, ### for H3). Use - for bullet points. Use **bold** for emphasis. Use | column1 | column2 | format for tables. Use --- for section dividers. Include specific numbers, metrics, and details.",
        "docx": "Return well-structured text using markdown-style headings (# for H1, ## for H2, ### for H3). Use - for bullet points.",
    }

    system = f"""You are an expert professional writer and document creator. You write with the quality of a top-tier consultant at McKinsey, Goldman Sachs, or a Big 4 firm.

DOCUMENT TYPE: {req.file_type.upper()}

WRITING RULES:
- Write with authority, precision, and professionalism
- Use industry-standard terminology and frameworks
- Include specific details, numbers, metrics, and examples — never vague
- Structure content with clear hierarchy: sections, subsections, bullet points
- For resumes: use strong action verbs, quantify achievements, tailor to the role
- For business documents: include executive summary, key findings, recommendations
- For proposals: lead with value proposition, include timeline, budget, deliverables
- For reports: use data-driven language, cite sources where relevant
- For invoices: use proper formatting with line items, rates, subtotals, tax, total
- Content should be thorough and detailed — aim for 2-4 pages of real content
- Write as if this document will be presented to a CEO or client

FORMAT: {format_instructions.get(req.file_type, 'Return well-structured text with headings.')}

Return ONLY the document content. No explanations, no preamble, no "here is your document". Start directly with the content."""

    content = await _ask_claude(req.description, system)

    file_id = str(uuid.uuid4())
    filename = req.filename or f"document_{file_id[:8]}"

    if req.file_type == "csv":
        file_bytes = content.encode('utf-8')
        filename += ".csv"
        mime = "text/csv"

    elif req.file_type == "txt":
        file_bytes = content.encode('utf-8')
        filename += ".txt"
        mime = "text/plain"

    elif req.file_type == "xlsx":
        try:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active

            # Try to parse JSON data from AI
            try:
                data = json.loads(content)
                if isinstance(data, list) and len(data) > 0:
                    headers = list(data[0].keys())
                    ws.append(headers)
                    for row in data:
                        ws.append([row.get(h, "") for h in headers])
            except json.JSONDecodeError:
                # Fallback: put content as text
                for i, line in enumerate(content.split('\n')):
                    cells = line.split(',') if ',' in line else [line]
                    ws.append(cells)

            buf = io.BytesIO()
            wb.save(buf)
            file_bytes = buf.getvalue()
            filename += ".xlsx"
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        except ImportError:
            # Fallback to CSV if openpyxl not installed
            file_bytes = content.encode('utf-8')
            filename += ".csv"
            mime = "text/csv"

    elif req.file_type == "docx":
        try:
            from docx import Document
            doc = Document()
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('# '):
                    doc.add_heading(line[2:], level=1)
                elif line.startswith('## '):
                    doc.add_heading(line[3:], level=2)
                elif line.startswith('### '):
                    doc.add_heading(line[4:], level=3)
                elif line.startswith('- '):
                    doc.add_paragraph(line[2:], style='List Bullet')
                elif line:
                    doc.add_paragraph(line)
            buf = io.BytesIO()
            doc.save(buf)
            file_bytes = buf.getvalue()
            filename += ".docx"
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        except ImportError:
            file_bytes = content.encode('utf-8')
            filename += ".txt"
            mime = "text/plain"

    else:  # pdf
        try:
            from lib.pdf_templates import create_professional_pdf
            file_bytes = create_professional_pdf(content, title=req.filename)
            filename += ".pdf"
            mime = "application/pdf"
        except Exception as e:
            import traceback
            print(f"[PDF ERROR] Failed to create PDF: {e}")
            traceback.print_exc()
            # Fallback: still try basic PDF with reportlab
            try:
                from reportlab.lib.pagesizes import letter
                from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
                from reportlab.lib.styles import getSampleStyleSheet
                buf = io.BytesIO()
                doc = SimpleDocTemplate(buf, pagesize=letter)
                styles = getSampleStyleSheet()
                story = []
                for line in content.split('\n'):
                    line = line.strip()
                    if not line:
                        story.append(Spacer(1, 12))
                    else:
                        # Strip markdown bold/italic
                        clean = re.sub(r'\*\*(.+?)\*\*', r'\1', line)
                        clean = re.sub(r'\*(.+?)\*', r'\1', clean)
                        clean = re.sub(r'^#+\s*', '', clean)
                        story.append(Paragraph(clean, styles['Normal']))
                doc.build(story)
                file_bytes = buf.getvalue()
                filename += ".pdf"
                mime = "application/pdf"
            except Exception as e2:
                print(f"[PDF FALLBACK ERROR] {e2}")
                file_bytes = content.encode('utf-8')
                filename += ".txt"
                mime = "text/plain"

    # Store file
    file_b64 = base64.b64encode(file_bytes).decode()
    FILE_STORE[file_id] = {"filename": filename, "mime": mime, "data": file_b64, "created": datetime.utcnow().isoformat()}

    return {"file_id": file_id, "filename": filename, "download_url": f"/api/ghost/tools/download/{file_id}", "size": len(file_bytes)}


# ─── ASYNC FILE CREATION (for mobile background support) ─────────────────

JOB_STORE: dict[str, dict] = {}  # job_id -> {status, file_id, error}

@router.post("/create-file-async")
async def create_file_async(req: CreateFileRequest, authorization: str = Header(...)):
    """Start file creation in background. Returns job_id immediately."""
    _verify_auth(authorization)
    import asyncio
    job_id = str(uuid.uuid4())[:8]
    JOB_STORE[job_id] = {"status": "processing", "file_id": None, "error": None}

    async def _background_create():
        try:
            # Reuse the same logic as create_file
            format_instructions = {
                "csv": "Return raw CSV data with headers.",
                "txt": "Return well-written plain text with clear structure.",
                "xlsx": "Return a JSON array of objects where keys are column headers. Include realistic data.",
                "pdf": "Return well-structured text using markdown-style headings (# ## ###). Use - for bullet points. Use **bold** for emphasis.",
                "docx": "Return well-structured text using markdown-style headings.",
            }
            system = f"""You are an expert professional writer. Create high-quality content.
DOCUMENT TYPE: {req.file_type.upper()}
FORMAT: {format_instructions.get(req.file_type, 'Return clean text.')}
Return ONLY the document content, no explanations."""

            content = await _ask_claude(req.description, system)
            file_id = str(uuid.uuid4())[:8]
            filename = req.filename or f"document_{file_id}"

            # Generate file bytes (same as sync endpoint)
            if req.file_type == "pdf":
                try:
                    from lib.pdf_templates import create_professional_pdf
                    file_bytes = create_professional_pdf(content, title=filename)
                    filename += ".pdf"
                    mime = "application/pdf"
                except Exception:
                    try:
                        from reportlab.lib.pagesizes import letter
                        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
                        from reportlab.lib.styles import getSampleStyleSheet
                        buf = io.BytesIO()
                        doc = SimpleDocTemplate(buf, pagesize=letter)
                        styles = getSampleStyleSheet()
                        story = []
                        for line in content.split('\n'):
                            line = line.strip()
                            if not line:
                                story.append(Spacer(1, 12))
                            else:
                                clean = re.sub(r'\*\*(.+?)\*\*', r'\1', line)
                                clean = re.sub(r'\*(.+?)\*', r'\1', clean)
                                clean = re.sub(r'^#+\s*', '', clean)
                                story.append(Paragraph(clean, styles['Normal']))
                        doc.build(story)
                        file_bytes = buf.getvalue()
                        filename += ".pdf"
                        mime = "application/pdf"
                    except Exception:
                        file_bytes = content.encode('utf-8')
                        filename += ".txt"
                        mime = "text/plain"
            else:
                file_bytes = content.encode('utf-8')
                filename += f".{req.file_type}" if req.file_type != "txt" else ".txt"
                mime = "text/plain"

            file_b64 = base64.b64encode(file_bytes).decode()
            FILE_STORE[file_id] = {"filename": filename, "mime": mime, "data": file_b64, "created": datetime.utcnow().isoformat()}
            JOB_STORE[job_id] = {"status": "done", "file_id": file_id, "filename": filename, "download_url": f"/api/ghost/tools/download/{file_id}", "size": len(file_bytes), "error": None}
        except Exception as e:
            JOB_STORE[job_id] = {"status": "failed", "file_id": None, "error": str(e)}

    asyncio.create_task(_background_create())
    return {"job_id": job_id, "status": "processing"}


@router.get("/job-status/{job_id}")
async def job_status(job_id: str):
    """Check if an async file creation job is done."""
    job = JOB_STORE.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/download/{file_id}")
async def download_file(file_id: str):
    if file_id not in FILE_STORE:
        raise HTTPException(404, "File not found or expired")
    f = FILE_STORE[file_id]
    from fastapi.responses import Response
    return Response(content=base64.b64decode(f["data"]), media_type=f["mime"], headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"'})


# ─── FILE MODIFICATION (edit, chart, convert, merge, filter) ──────────────

class ModifyFileRequest(BaseModel):
    operation: str  # edit, chart, convert, merge, filter
    file_id: Optional[str] = None
    file_ids: Optional[list[str]] = None
    instructions: Optional[str] = ""
    target_format: Optional[str] = None  # for convert: pdf, xlsx, docx, csv, txt


@router.post("/modify-file-async")
async def modify_file_async(req: ModifyFileRequest, authorization: str = Header(...)):
    """Modify an existing file: edit, chart, convert, merge, or filter."""
    _verify_auth(authorization)
    import asyncio
    job_id = str(uuid.uuid4())[:8]
    JOB_STORE[job_id] = {"status": "processing", "file_id": None, "error": None}

    async def _background_modify():
        try:
            # Load original file(s)
            if req.operation == "merge" and req.file_ids:
                sources = []
                for fid in req.file_ids:
                    if fid not in FILE_STORE:
                        raise ValueError(f"File {fid} not found")
                    f = FILE_STORE[fid]
                    content = base64.b64decode(f["data"])
                    sources.append({"filename": f["filename"], "content": content, "mime": f["mime"]})
            elif req.file_id and req.file_id in FILE_STORE:
                f = FILE_STORE[req.file_id]
                original_bytes = base64.b64decode(f["data"])
                original_filename = f["filename"]
                original_mime = f["mime"]
            else:
                raise ValueError("File not found")

            file_id = str(uuid.uuid4())[:8]

            if req.operation == "edit":
                # Parse original file content
                text_content = _extract_text(original_bytes, original_mime)
                system = """You are a document editor. The user has an existing document and wants modifications.
Return ONLY the complete modified document content. Keep the same format and structure unless told otherwise.
For XLSX: return JSON array of objects. For CSV: return raw CSV. For others: return text with markdown formatting."""
                prompt = f"Original document content:\n\n{text_content}\n\nModifications requested: {req.instructions}\n\nReturn the complete modified document."
                modified_content = await _ask_claude(prompt, system)
                ext = original_filename.rsplit('.', 1)[-1] if '.' in original_filename else 'txt'
                file_bytes, filename, mime = _content_to_file(modified_content, ext, f"modified_{file_id}")

            elif req.operation == "chart":
                text_content = _extract_text(original_bytes, original_mime)
                system = """You are a data analyst. Given spreadsheet/CSV data, generate Python code that uses matplotlib to create the requested chart.
The code must:
1. Parse the data (provided as a string variable called DATA)
2. Create the chart using matplotlib
3. Save to a BytesIO buffer called 'buf'
4. Use plt.tight_layout() before saving
Return ONLY the Python code, no explanations."""
                prompt = f"Data:\n{text_content}\n\nCreate this chart: {req.instructions or 'Create an appropriate chart for this data'}"
                code = await _ask_claude(prompt, system)
                # Execute the chart code
                import matplotlib
                matplotlib.use('Agg')
                import matplotlib.pyplot as plt
                buf = io.BytesIO()
                local_vars = {"DATA": text_content, "buf": buf, "plt": plt, "io": io}
                clean_code = code.replace("```python", "").replace("```", "").strip()
                exec(clean_code, {"__builtins__": __builtins__}, local_vars)
                buf = local_vars.get("buf", buf)
                buf.seek(0)
                file_bytes = buf.getvalue()
                filename = f"chart_{file_id}.png"
                mime = "image/png"

            elif req.operation == "convert":
                target = req.target_format or "pdf"
                text_content = _extract_text(original_bytes, original_mime)
                file_bytes, filename, mime = _content_to_file(text_content, target, f"converted_{file_id}")

            elif req.operation == "merge":
                combined_text = ""
                for src in sources:
                    text = _extract_text(src["content"], src["mime"])
                    combined_text += f"\n\n--- {src['filename']} ---\n\n{text}"
                # Determine output format from first file
                ext = sources[0]["filename"].rsplit('.', 1)[-1] if '.' in sources[0]["filename"] else 'txt'
                file_bytes, filename, mime = _content_to_file(combined_text, ext, f"merged_{file_id}")

            elif req.operation == "filter":
                text_content = _extract_text(original_bytes, original_mime)
                system = """You are a data processor. Filter the data according to the user's criteria.
Return ONLY the filtered data in the same format (CSV for CSV, JSON array for XLSX)."""
                prompt = f"Data:\n{text_content}\n\nFilter criteria: {req.instructions}"
                filtered = await _ask_claude(prompt, system)
                ext = original_filename.rsplit('.', 1)[-1] if '.' in original_filename else 'csv'
                file_bytes, filename, mime = _content_to_file(filtered, ext, f"filtered_{file_id}")

            else:
                raise ValueError(f"Unknown operation: {req.operation}")

            file_b64 = base64.b64encode(file_bytes).decode()
            FILE_STORE[file_id] = {"filename": filename, "mime": mime, "data": file_b64, "created": datetime.utcnow().isoformat()}
            JOB_STORE[job_id] = {"status": "done", "file_id": file_id, "filename": filename, "download_url": f"/api/ghost/tools/download/{file_id}", "size": len(file_bytes), "error": None}
        except Exception as e:
            JOB_STORE[job_id] = {"status": "failed", "file_id": None, "error": str(e)}

    asyncio.create_task(_background_modify())
    return {"job_id": job_id, "status": "processing"}


def _extract_text(file_bytes: bytes, mime: str) -> str:
    """Extract readable text from file bytes based on mime type."""
    if mime == "application/pdf":
        try:
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            return "\n".join(page.get_text() for page in doc)
        except Exception:
            return file_bytes.decode('utf-8', errors='ignore')
    elif mime in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"):
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(file_bytes))
            ws = wb.active
            rows = []
            for row in ws.iter_rows(values_only=True):
                rows.append(",".join(str(c) if c is not None else "" for c in row))
            return "\n".join(rows)
        except Exception:
            return file_bytes.decode('utf-8', errors='ignore')
    elif mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception:
            return file_bytes.decode('utf-8', errors='ignore')
    else:
        return file_bytes.decode('utf-8', errors='ignore')


def _content_to_file(content: str, ext: str, base_name: str) -> tuple:
    """Convert text content to file bytes in the specified format."""
    if ext == "pdf":
        try:
            from lib.pdf_templates import create_professional_pdf
            file_bytes = create_professional_pdf(content, title=base_name)
        except Exception:
            file_bytes = content.encode('utf-8')
        return file_bytes, f"{base_name}.pdf", "application/pdf"
    elif ext == "xlsx":
        try:
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            # Try parsing as JSON array
            try:
                import json as _json
                data = _json.loads(content)
                if isinstance(data, list) and len(data) > 0:
                    headers = list(data[0].keys())
                    ws.append(headers)
                    for row in data:
                        ws.append([row.get(h, "") for h in headers])
            except Exception:
                # Fall back to CSV-style parsing
                for line in content.strip().split('\n'):
                    ws.append(line.split(','))
            buf = io.BytesIO()
            wb.save(buf)
            return buf.getvalue(), f"{base_name}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        except Exception:
            return content.encode('utf-8'), f"{base_name}.csv", "text/csv"
    elif ext == "docx":
        try:
            from docx import Document
            doc = Document()
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('# '): doc.add_heading(line[2:], level=1)
                elif line.startswith('## '): doc.add_heading(line[3:], level=2)
                elif line.startswith('- '): doc.add_paragraph(line[2:], style='List Bullet')
                elif line: doc.add_paragraph(line)
            buf = io.BytesIO()
            doc.save(buf)
            return buf.getvalue(), f"{base_name}.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        except Exception:
            return content.encode('utf-8'), f"{base_name}.txt", "text/plain"
    elif ext == "csv":
        return content.encode('utf-8'), f"{base_name}.csv", "text/csv"
    else:
        return content.encode('utf-8'), f"{base_name}.txt", "text/plain"


# ─── PRESENTATION ─────────────────────────────────────────────────────────

class PresentationRequest(BaseModel):
    description: str
    slides: Optional[int] = 5


@router.post("/create-presentation")
async def create_presentation(req: PresentationRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    system = f"""Create a {req.slides}-slide presentation. Return JSON array where each item has "title" and "bullets" (array of strings). Example:
[{{"title":"Introduction","bullets":["Point 1","Point 2"]}},{{"title":"Details","bullets":["Info 1","Info 2"]}}]
Return ONLY valid JSON."""

    content = await _ask_claude(req.description, system)

    try:
        slides_data = json.loads(content)
    except:
        slides_data = [{"title": "Presentation", "bullets": [content]}]

    # Create simple HTML presentation
    html_slides = []
    for i, slide in enumerate(slides_data):
        bullets_html = "".join(f"<li>{b}</li>" for b in slide.get("bullets", []))
        html_slides.append(f"""
        <div style="page-break-after: always; padding: 60px; font-family: -apple-system, sans-serif;">
            <h1 style="font-size: 36px; color: #1a1a1a; margin-bottom: 24px;">{slide.get('title', f'Slide {i+1}')}</h1>
            <ul style="font-size: 20px; line-height: 2; color: #444;">{bullets_html}</ul>
            <p style="position: absolute; bottom: 30px; right: 40px; color: #999; font-size: 14px;">{i+1} / {len(slides_data)}</p>
        </div>""")

    html = f"<html><body>{''.join(html_slides)}</body></html>"
    file_bytes = html.encode('utf-8')
    file_id = str(uuid.uuid4())
    filename = f"presentation_{file_id[:8]}.html"

    FILE_STORE[file_id] = {"filename": filename, "mime": "text/html", "data": base64.b64encode(file_bytes).decode(), "created": datetime.utcnow().isoformat()}

    return {"file_id": file_id, "filename": filename, "download_url": f"/api/ghost/tools/download/{file_id}", "slides": len(slides_data)}


# ─── WEB SEARCH ───────────────────────────────────────────────────────────

class WebSearchRequest(BaseModel):
    query: str


@router.post("/web-search")
async def web_search(req: WebSearchRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    # Use DuckDuckGo instant answer API (free, no key needed)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"https://api.duckduckgo.com/?q={req.query}&format=json&no_html=1")
        data = res.json()

    results = []

    # Abstract (main answer)
    if data.get("Abstract"):
        results.append({"title": data.get("Heading", "Answer"), "snippet": data["Abstract"], "url": data.get("AbstractURL", "")})

    # Related topics
    for topic in data.get("RelatedTopics", [])[:5]:
        if isinstance(topic, dict) and topic.get("Text"):
            results.append({"title": topic.get("Text", "")[:80], "snippet": topic.get("Text", ""), "url": topic.get("FirstURL", "")})

    if not results:
        # Fallback: ask AI to answer based on its knowledge
        answer = await _ask_claude(f"Answer this search query concisely: {req.query}")
        results.append({"title": "AI Answer", "snippet": answer, "url": ""})

    return {"query": req.query, "results": results}


# ─── URL READER ───────────────────────────────────────────────────────────

class ReadURLRequest(BaseModel):
    url: str
    question: Optional[str] = "Summarize this page."


@router.post("/read-url")
async def read_url(req: ReadURLRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        res = await client.get(req.url, headers={"User-Agent": "GoFarther-AI/1.0"})
        if res.status_code != 200:
            raise HTTPException(400, f"Could not fetch URL (status {res.status_code})")
        html = res.text[:50000]  # Limit to 50KB

    # Strip HTML tags (basic)
    import re
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()[:10000]

    # Ask AI to answer based on content
    summary = await _ask_claude(f"Based on this webpage content, {req.question}\n\nContent:\n{text}")

    return {"url": req.url, "summary": summary}


# ─── PDF READER ───────────────────────────────────────────────────────────

class ReadPDFRequest(BaseModel):
    pdf_base64: str
    question: Optional[str] = "Summarize this document."


@router.post("/read-pdf")
async def read_pdf(req: ReadPDFRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    try:
        import fitz  # PyMuPDF
        pdf_bytes = base64.b64decode(req.pdf_base64)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        text = text[:10000]
    except ImportError:
        raise HTTPException(500, "PDF reader not available on server")
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {str(e)}")

    summary = await _ask_claude(f"{req.question}\n\nDocument content:\n{text}")
    return {"summary": summary, "pages": len(doc) if doc else 0}


# ─── STOCK REPORT ─────────────────────────────────────────────────────────

class StockRequest(BaseModel):
    symbol: str


@router.post("/stock-report")
async def stock_report(req: StockRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    symbol = req.symbol.upper()
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1mo")
        data = res.json()

    meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
    price = meta.get("regularMarketPrice", "N/A")
    prev_close = meta.get("previousClose", "N/A")
    currency = meta.get("currency", "USD")

    report = await _ask_claude(f"Give a brief stock analysis for {symbol}. Current price: ${price} {currency}. Previous close: ${prev_close}. Include a brief outlook.")

    return {"symbol": symbol, "price": price, "currency": currency, "previous_close": prev_close, "analysis": report}


# ─── WEATHER REPORT ───────────────────────────────────────────────────────

class WeatherRequest(BaseModel):
    location: str


@router.post("/weather-report")
async def weather_report(req: WeatherRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"https://wttr.in/{req.location}?format=j1")
        data = res.json()

    current = data.get("current_condition", [{}])[0]
    forecast = data.get("weather", [])[:3]

    weather_info = {
        "location": req.location,
        "temperature": f"{current.get('temp_F', '?')}°F / {current.get('temp_C', '?')}°C",
        "condition": current.get("weatherDesc", [{}])[0].get("value", "Unknown"),
        "humidity": f"{current.get('humidity', '?')}%",
        "wind": f"{current.get('windspeedMiles', '?')} mph",
        "forecast": [{"date": d.get("date", ""), "high": f"{d.get('maxtempF', '?')}°F", "low": f"{d.get('mintempF', '?')}°F"} for d in forecast],
    }

    return weather_info


# ─── NEWS ─────────────────────────────────────────────────────────────────

class NewsRequest(BaseModel):
    topic: str


@router.post("/news")
async def news(req: NewsRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    # Use DuckDuckGo news
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"https://api.duckduckgo.com/?q={req.topic}&format=json&no_html=1")
        data = res.json()

    # Get AI to provide news summary based on its knowledge
    summary = await _ask_claude(f"Give me the latest news and developments about: {req.topic}. Be specific with recent events, dates, and key details. Format as bullet points.")

    return {"topic": req.topic, "summary": summary}


# ─── TRANSLATE DOCUMENT ───────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    target_language: str  # e.g. "Spanish", "French"


@router.post("/translate-doc")
async def translate_doc(req: TranslateRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    translation = await _ask_claude(
        f"Translate the following text to {req.target_language}. Return ONLY the translation, nothing else.\n\n{req.text}",
        system=f"You are a professional translator. Translate accurately to {req.target_language}."
    )

    return {"original_language": "auto-detected", "target_language": req.target_language, "translation": translation}


# ─── CODE INTERPRETER ─────────────────────────────────────────────────────

class RunCodeRequest(BaseModel):
    description: str  # What the user wants to compute/create


@router.post("/run-code")
async def run_code(req: RunCodeRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    # Ask AI to write Python code
    code = await _ask_claude(
        f"Write Python code to: {req.description}\n\nReturn ONLY the Python code, no explanations. Use print() for output. Do not use any dangerous operations (no file deletion, no network requests, no system commands).",
        system="You are a Python code generator. Write safe, clean Python code. Only use standard library modules."
    )

    # Clean the code (remove markdown fences)
    code = code.strip()
    if code.startswith("```python"):
        code = code[9:]
    if code.startswith("```"):
        code = code[3:]
    if code.endswith("```"):
        code = code[:-3]
    code = code.strip()

    # Execute in a restricted environment
    import subprocess
    try:
        result = subprocess.run(
            ["python3", "-c", code],
            capture_output=True, text=True, timeout=10,
            env={"PATH": "/usr/bin:/usr/local/bin"}  # Restricted PATH
        )
        output = result.stdout or result.stderr or "No output"
    except subprocess.TimeoutExpired:
        output = "Code execution timed out (10s limit)"
    except Exception as e:
        output = f"Execution error: {str(e)}"

    return {"code": code, "output": output.strip()}


# ─── DATA ANALYZER ────────────────────────────────────────────────────────

class AnalyzeDataRequest(BaseModel):
    csv_data: str  # Raw CSV content
    question: Optional[str] = "Analyze this data and provide key insights."


@router.post("/analyze-data")
async def analyze_data(req: AnalyzeDataRequest, authorization: str = Header(...)):
    _verify_auth(authorization)

    # Limit data size
    csv_preview = req.csv_data[:5000]

    analysis = await _ask_claude(
        f"{req.question}\n\nCSV Data:\n{csv_preview}",
        system="You are a data analyst. Analyze the CSV data provided. Give clear insights, trends, and statistics. Format with bullet points and headers."
    )

    return {"analysis": analysis, "rows_analyzed": req.csv_data.count('\n')}
