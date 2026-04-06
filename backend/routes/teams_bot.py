"""
Microsoft Teams Bot Integration for GoFarther AI.
Full tool support: file creation, web search, code execution, translation, etc.
Route: POST /api/teams/messages
"""

from __future__ import annotations
import os
import io
import re
import sys
import json
import base64
import uuid
import traceback
from datetime import datetime, timedelta
from dataclasses import dataclass, field

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from botbuilder.core import (
    BotFrameworkAdapter,
    BotFrameworkAdapterSettings,
    TurnContext,
    ActivityHandler,
)
from botbuilder.schema import Activity, ActivityTypes, Attachment

from lib.claude_client import call_claude, ask_claude
from routes.ghost_ai import CLAUDE_TOOLS

router = APIRouter(prefix="/teams", tags=["teams-bot"])

# ─── Config ───────────────────────────────────────────────────────────────

TEAMS_APP_ID = os.getenv("TEAMS_APP_ID", "")
TEAMS_APP_PASSWORD = os.getenv("TEAMS_APP_PASSWORD", "")
TEAMS_TENANT_ID = os.getenv("TEAMS_TENANT_ID", "")

ADAPTER_SETTINGS = BotFrameworkAdapterSettings(
    app_id=TEAMS_APP_ID,
    app_password=TEAMS_APP_PASSWORD,
    channel_auth_tenant=TEAMS_TENANT_ID or None,
)
ADAPTER = BotFrameworkAdapter(ADAPTER_SETTINGS)

print(f"[TEAMS CONFIG] App ID set: {bool(TEAMS_APP_ID)}, Password set: {bool(TEAMS_APP_PASSWORD)}", flush=True)

# ─── Conversation State ──────────────────────────────────────────────────

SESSION_TTL_MINUTES = 30
TEAMS_TOOLS = [t for t in CLAUDE_TOOLS if t["name"] not in ("call", "sms", "maps", "remember")]

TEAMS_SYSTEM_PROMPT = """You are GoFarther AI, an assistant in Microsoft Teams. Be conversational, concise, helpful.

STYLE:
- If someone says hey, just say hey back. Keep it short. Sound human.
- Use contractions. Match the user's energy.
- For file creation, ask 2-3 quick questions first to get details.
- When using tools, just do it. Don't over-explain.
"""


@dataclass
class ConversationSession:
    messages: list = field(default_factory=list)
    last_activity: datetime = field(default_factory=datetime.utcnow)


_sessions: dict[str, ConversationSession] = {}


def _get_session(conversation_id: str, user_id: str) -> ConversationSession:
    key = f"{conversation_id}:{user_id}"
    now = datetime.utcnow()
    session = _sessions.get(key)
    if session and (now - session.last_activity) > timedelta(minutes=SESSION_TTL_MINUTES):
        session = None
    if not session:
        session = ConversationSession()
        _sessions[key] = session
    session.last_activity = now
    return session


# ─── Tool Execution ──────────────────────────────────────────────────────

async def _execute_tool(tool_name: str, tool_input: dict) -> dict:
    """Execute a tool. Returns {text, file_bytes, filename, mime}."""
    result = {"text": "", "file_bytes": None, "filename": None, "mime": None}

    try:
        if tool_name == "create_file":
            description = tool_input.get("description", "")
            file_type = tool_input.get("file_type", "pdf")

            format_map = {
                "csv": "Return raw CSV data with headers.",
                "txt": "Return well-written plain text.",
                "xlsx": "Return a JSON array of objects where keys are column headers.",
                "pdf": "Return well-structured text using markdown headings (# ## ###), bullet points (-), and **bold**.",
                "docx": "Return well-structured text using markdown headings.",
            }
            system = f"You are an expert writer. Create high-quality content.\nTYPE: {file_type.upper()}\nFORMAT: {format_map.get(file_type, 'Return clean text.')}\nReturn ONLY the content."
            content = await ask_claude(description, system)
            filename = f"document_{uuid.uuid4().hex[:8]}"

            if file_type == "pdf":
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
                        story = [Paragraph(re.sub(r'[*#]', '', line.strip()), styles['Normal']) if line.strip() else Spacer(1, 12) for line in content.split("\n")]
                        doc.build(story)
                        file_bytes = buf.getvalue()
                        filename += ".pdf"
                        mime = "application/pdf"
                    except Exception:
                        file_bytes = content.encode("utf-8")
                        filename += ".txt"
                        mime = "text/plain"
            elif file_type == "docx":
                try:
                    from docx import Document
                    doc = Document()
                    for line in content.split("\n"):
                        line = line.strip()
                        if line.startswith("# "): doc.add_heading(line[2:], level=1)
                        elif line.startswith("## "): doc.add_heading(line[3:], level=2)
                        elif line.startswith("- "): doc.add_paragraph(line[2:], style="List Bullet")
                        elif line: doc.add_paragraph(line)
                    buf = io.BytesIO()
                    doc.save(buf)
                    file_bytes = buf.getvalue()
                    filename += ".docx"
                    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                except Exception:
                    file_bytes = content.encode("utf-8")
                    filename += ".txt"
                    mime = "text/plain"
            elif file_type == "xlsx":
                try:
                    import openpyxl
                    wb = openpyxl.Workbook()
                    ws = wb.active
                    rows = json.loads(content)
                    if rows:
                        ws.append(list(rows[0].keys()))
                        for row in rows:
                            ws.append(list(row.values()))
                    buf = io.BytesIO()
                    wb.save(buf)
                    file_bytes = buf.getvalue()
                    filename += ".xlsx"
                    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                except Exception:
                    file_bytes = content.encode("utf-8")
                    filename += ".txt"
                    mime = "text/plain"
            elif file_type == "csv":
                file_bytes = content.encode("utf-8")
                filename += ".csv"
                mime = "text/csv"
            else:
                file_bytes = content.encode("utf-8")
                filename += ".txt"
                mime = "text/plain"

            result["file_bytes"] = file_bytes
            result["filename"] = filename
            result["mime"] = mime
            result["text"] = f"Created {filename} ({len(file_bytes)} bytes)"

        elif tool_name == "web_search":
            query = tool_input.get("query", "")
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.get(f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1")
                data = res.json()
            parts = []
            if data.get("Abstract"):
                parts.append(f"**{data.get('Heading', 'Answer')}**: {data['Abstract']}")
            for topic in data.get("RelatedTopics", [])[:5]:
                if isinstance(topic, dict) and topic.get("Text"):
                    parts.append(f"- {topic['Text']}")
            result["text"] = "\n".join(parts) if parts else f"No results for '{query}'."

        elif tool_name == "read_url":
            url = tool_input.get("url", "")
            question = tool_input.get("question", "Summarize this page")
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                res = await client.get(url, headers={"User-Agent": "GoFarther-AI/1.0"})
                html = res.text[:50000]
            text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
            text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()[:10000]
            result["text"] = await ask_claude(f"{question}\n\nPage:\n{text}", "Summarize concisely.")

        elif tool_name == "run_code":
            description = tool_input.get("description", "")
            code = await ask_claude(f"Write Python code to: {description}\n\nReturn ONLY the code.", "Python code generator. Safe, clean, standard library only.")
            code = code.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()
            import subprocess
            proc = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=30)
            output = proc.stdout or proc.stderr or "(no output)"
            result["text"] = f"**Code:**\n```python\n{code}\n```\n\n**Output:**\n```\n{output}\n```"

        elif tool_name == "translate":
            text = tool_input.get("text", "")
            target = tool_input.get("target_language", "Spanish")
            result["text"] = await ask_claude(f"Translate to {target}. Return ONLY the translation:\n\n{text}")

        elif tool_name == "generate_image":
            description = tool_input.get("description", "")
            openai_key = os.getenv("OPENAI_API_KEY", "")
            if openai_key:
                async with httpx.AsyncClient(timeout=120) as client:
                    res = await client.post("https://api.openai.com/v1/images/generations",
                        headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                        json={"model": "dall-e-3", "prompt": description, "n": 1, "size": "1024x1024"})
                    if res.status_code == 200:
                        result["text"] = f"Image: {res.json().get('data', [{}])[0].get('url', 'failed')}"
                    else:
                        result["text"] = "Image generation failed."
            else:
                result["text"] = "Image generation not configured."

        elif tool_name == "research":
            topic = tool_input.get("topic", "")
            result["text"] = await ask_claude(f"Research this topic thoroughly and provide key findings:\n\n{topic}", "You are a research analyst. Be detailed and factual.")

        elif tool_name == "generate_qr":
            data = tool_input.get("data", "")
            result["text"] = f"QR code generation requested for: {data} (use the mobile app for QR codes)"

        else:
            result["text"] = f"Tool '{tool_name}' executed."

    except Exception as e:
        print(f"[TEAMS TOOL ERROR] {tool_name}: {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        result["text"] = f"Tool failed: {str(e)}"

    return result


# ─── Bot Handler ──────────────────────────────────────────────────────────

class GoFartherBot(ActivityHandler):
    async def on_message_activity(self, turn_context: TurnContext):
        text = turn_context.activity.text or ""
        print(f"[TEAMS BOT] Raw text: {text[:80]}", flush=True)

        # Strip @mention — try multiple approaches
        if turn_context.activity.entities:
            for entity in turn_context.activity.entities:
                if entity.type == "mention":
                    # Try getting mentioned text from different locations
                    mentioned = ""
                    if hasattr(entity, 'text') and entity.text:
                        mentioned = entity.text
                    elif hasattr(entity, 'additional_properties'):
                        mentioned = entity.additional_properties.get("text", "")
                    if mentioned:
                        text = text.replace(mentioned, "")

        # Strip HTML tags and clean up
        text = re.sub(r"<at>[^<]*</at>", "", text)  # Teams wraps mentions in <at> tags
        text = re.sub(r"<[^>]+>", "", text)
        text = text.strip()

        print(f"[TEAMS BOT] Cleaned text: '{text}'", flush=True)

        if not text:
            return

        conv_id = turn_context.activity.conversation.id if turn_context.activity.conversation else "unknown"
        user_id = turn_context.activity.from_property.id if turn_context.activity.from_property else "unknown"
        session = _get_session(conv_id, user_id)
        session.messages.append({"role": "user", "content": text})

        # Send typing indicator
        await turn_context.send_activity(Activity(type=ActivityTypes.typing))

        try:
            print("[TEAMS BOT] Calling Claude...", flush=True)
            response = await call_claude(
                messages=session.messages[-20:],
                system=TEAMS_SYSTEM_PROMPT,
                tools=TEAMS_TOOLS,
                max_tokens=4096,
            )

            response_text = response["text"]
            tool_use = response["tool_use"]
            print(f"[TEAMS BOT] Claude: {response_text[:80]} | tool={tool_use['name'] if tool_use else 'none'}", flush=True)

            # Handle tool use
            if tool_use and response["stop_reason"] == "tool_use":
                print(f"[TEAMS BOT] Executing tool: {tool_use['name']}", flush=True)

                # Let user know we're working on it
                if response_text:
                    await turn_context.send_activity(response_text)

                tool_result = await _execute_tool(tool_use["name"], tool_use["input"])
                print(f"[TEAMS BOT] Tool result: {tool_result['text'][:80]}", flush=True)

                # If file was created, store it and send download link
                if tool_result["file_bytes"]:
                    from routes.ghost_tools import FILE_STORE
                    file_id = str(uuid.uuid4())
                    FILE_STORE[file_id] = {
                        "filename": tool_result["filename"],
                        "mime": tool_result["mime"],
                        "data": base64.b64encode(tool_result["file_bytes"]).decode(),
                        "created": datetime.utcnow().isoformat(),
                    }
                    download_url = f"https://api.isibi.ai/api/ghost/tools/download/{file_id}"
                    await turn_context.send_activity(
                        f"Your file is ready: **{tool_result['filename']}**\n\n[Download File]({download_url})"
                    )
                    session.messages.append({"role": "assistant", "content": f"Created file: {tool_result['filename']}"})
                else:
                    # Feed tool result back to Claude for a natural response
                    session.messages.append({"role": "assistant", "content": response_text or "Processing..."})
                    session.messages.append({"role": "user", "content": f"[Tool result: {tool_result['text'][:2000]}]"})

                    followup = await call_claude(
                        messages=session.messages[-20:],
                        system=TEAMS_SYSTEM_PROMPT,
                        max_tokens=4096,
                    )
                    final_text = followup["text"] or tool_result["text"]
                    await turn_context.send_activity(final_text)
                    session.messages.append({"role": "assistant", "content": final_text})
            else:
                # Simple text response
                await turn_context.send_activity(response_text or "I'm not sure what to say.")
                session.messages.append({"role": "assistant", "content": response_text})

        except Exception as e:
            print(f"[TEAMS BOT ERROR] {e}", flush=True)
            traceback.print_exc()
            sys.stdout.flush()
            try:
                await turn_context.send_activity("Sorry, something went wrong. Please try again.")
            except Exception:
                pass


BOT = GoFartherBot()


# ─── FastAPI Route ────────────────────────────────────────────────────────

@router.post("/messages")
async def teams_messages(request: Request):
    """Receive messages from Microsoft Teams."""
    body = await request.json()
    auth_header = request.headers.get("Authorization", "")
    activity_type = body.get("type", "")

    print(f"[TEAMS] Activity={activity_type} text={body.get('text', '')[:50]}", flush=True)

    activity = Activity().deserialize(body)

    async def _callback(turn_context: TurnContext):
        await BOT.on_turn(turn_context)

    try:
        await ADAPTER.process_activity(activity, auth_header, _callback)
    except Exception as e:
        print(f"[TEAMS ERROR] {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()

    return JSONResponse(content={}, status_code=200)
