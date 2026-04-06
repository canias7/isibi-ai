"""
Microsoft Teams Bot Integration for GoFarther AI.

Allows users in Teams to @mention the bot and interact with the same AI
and tools available in the mobile app (create files, search web, run code, etc).

Route: POST /api/teams/messages
"""

from __future__ import annotations
import os
import io
import re
import json
import base64
import uuid
import traceback
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from botbuilder.core import (
    BotFrameworkAdapter,
    BotFrameworkAdapterSettings,
    TurnContext,
    ActivityHandler,
)
from botbuilder.schema import (
    Activity,
    ActivityTypes,
    Attachment,
    ChannelAccount,
)

from lib.claude_client import call_claude
from routes.ghost_ai import CLAUDE_TOOLS

router = APIRouter(prefix="/teams", tags=["teams-bot"])

# ─── Config ───────────────────────────────────────────────────────────────

TEAMS_APP_ID = os.getenv("TEAMS_APP_ID", "")
TEAMS_APP_PASSWORD = os.getenv("TEAMS_APP_PASSWORD", "")

ADAPTER_SETTINGS = BotFrameworkAdapterSettings(
    app_id=TEAMS_APP_ID,
    app_password=TEAMS_APP_PASSWORD,
    channel_auth_tenant="botframework.com",
)
ADAPTER = BotFrameworkAdapter(ADAPTER_SETTINGS)

# Debug: log if credentials are loaded (never log the actual values)
print(f"[TEAMS CONFIG] App ID set: {bool(TEAMS_APP_ID)}, App ID length: {len(TEAMS_APP_ID)}, Password set: {bool(TEAMS_APP_PASSWORD)}, Password length: {len(TEAMS_APP_PASSWORD)}")

# ─── Conversation State ──────────────────────────────────────────────────

SESSION_TTL_MINUTES = 30

# Tools available in Teams (subset — no phone calls, SMS, maps, etc.)
TEAMS_TOOLS = [t for t in CLAUDE_TOOLS if t["name"] not in ("call", "sms", "maps", "remember")]

TEAMS_SYSTEM_PROMPT = """You are GoFarther AI, an assistant available in Microsoft Teams. Talk naturally, be concise and helpful.

CONVERSATION STYLE:
- Be conversational. If someone says "hey", just say hey back.
- Keep responses SHORT. 1-3 sentences for casual chat.
- Match the user's energy — casual or professional.
- Use contractions. Sound human.
- When the user needs something done, just do it.

TEAMS-SPECIFIC:
- You're in a Teams channel. Keep responses well-formatted.
- Use markdown for formatting (bold, bullet points, etc.)
- For file creation, ask 2-3 quick questions first to get details.
- Files will be uploaded directly to the conversation.
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


def _cleanup_sessions():
    """Remove expired sessions."""
    now = datetime.utcnow()
    expired = [k for k, v in _sessions.items()
               if (now - v.last_activity) > timedelta(minutes=SESSION_TTL_MINUTES)]
    for k in expired:
        del _sessions[k]


# ─── Tool Execution ──────────────────────────────────────────────────────

async def _execute_tool(tool_name: str, tool_input: dict) -> dict:
    """Execute a tool and return the result. Returns {text, file_bytes, filename, mime}."""
    result = {"text": "", "file_bytes": None, "filename": None, "mime": None}

    try:
        if tool_name == "create_file":
            from routes.ghost_tools import _ask_claude as tools_ask_claude, FILE_STORE
            description = tool_input.get("description", "")
            file_type = tool_input.get("file_type", "pdf")
            quality = tool_input.get("quality", "standard")

            # Generate content
            format_instructions = {
                "csv": "Return raw CSV data with headers.",
                "txt": "Return well-written plain text with clear structure.",
                "xlsx": "Return a JSON array of objects where keys are column headers.",
                "pdf": "Return well-structured text using markdown-style headings.",
                "docx": "Return well-structured text using markdown-style headings.",
            }
            system = f"""You are an expert professional writer. Create high-quality content.
DOCUMENT TYPE: {file_type.upper()}
FORMAT: {format_instructions.get(file_type, 'Return clean text.')}
Return ONLY the document content, no explanations."""

            content = await tools_ask_claude(description, system)
            filename = f"document_{uuid.uuid4().hex[:8]}"

            # Generate file bytes
            if file_type == "csv":
                file_bytes = content.encode("utf-8")
                filename += ".csv"
                mime = "text/csv"
            elif file_type == "txt":
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
                        headers = list(rows[0].keys())
                        ws.append(headers)
                        for row in rows:
                            ws.append([row.get(h, "") for h in headers])
                    buf = io.BytesIO()
                    wb.save(buf)
                    file_bytes = buf.getvalue()
                    filename += ".xlsx"
                    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                        if line.startswith("# "):
                            doc.add_heading(line[2:], level=1)
                        elif line.startswith("## "):
                            doc.add_heading(line[3:], level=2)
                        elif line.startswith("### "):
                            doc.add_heading(line[4:], level=3)
                        elif line.startswith("- "):
                            doc.add_paragraph(line[2:], style="List Bullet")
                        elif line:
                            doc.add_paragraph(line)
                    buf = io.BytesIO()
                    doc.save(buf)
                    file_bytes = buf.getvalue()
                    filename += ".docx"
                    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                except Exception:
                    file_bytes = content.encode("utf-8")
                    filename += ".txt"
                    mime = "text/plain"
            else:  # pdf
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
                        for line in content.split("\n"):
                            line = line.strip()
                            if not line:
                                story.append(Spacer(1, 12))
                            else:
                                clean = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
                                clean = re.sub(r"\*(.+?)\*", r"\1", clean)
                                clean = re.sub(r"^#+\s*", "", clean)
                                story.append(Paragraph(clean, styles["Normal"]))
                        doc.build(story)
                        file_bytes = buf.getvalue()
                        filename += ".pdf"
                        mime = "application/pdf"
                    except Exception:
                        file_bytes = content.encode("utf-8")
                        filename += ".txt"
                        mime = "text/plain"

            result["file_bytes"] = file_bytes
            result["filename"] = filename
            result["mime"] = mime
            result["text"] = f"File created: {filename} ({len(file_bytes)} bytes)"

        elif tool_name == "web_search":
            query = tool_input.get("query", "")
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.get(f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1")
                data = res.json()
            results = []
            if data.get("Abstract"):
                results.append(f"**{data.get('Heading', 'Answer')}**: {data['Abstract']}")
            for topic in data.get("RelatedTopics", [])[:5]:
                if isinstance(topic, dict) and topic.get("Text"):
                    results.append(f"- {topic['Text']}")
            result["text"] = "\n".join(results) if results else f"No results found for '{query}'."

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
            from lib.claude_client import ask_claude
            summary = await ask_claude(f"{question}\n\nPage content:\n{text}", "You are a web page summarizer. Be concise.")
            result["text"] = summary

        elif tool_name == "run_code":
            description = tool_input.get("description", "")
            from lib.claude_client import ask_claude
            code = await ask_claude(
                f"Write Python code to: {description}\n\nReturn ONLY the code.",
                "You are a Python code generator. Write safe, clean code. Only standard library."
            )
            code = code.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()
            import subprocess
            proc = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=30)
            output = proc.stdout or proc.stderr or "(no output)"
            result["text"] = f"**Code:**\n```python\n{code}\n```\n\n**Output:**\n```\n{output}\n```"

        elif tool_name == "translate":
            text = tool_input.get("text", "")
            target = tool_input.get("target_language", "Spanish")
            from lib.claude_client import ask_claude
            translation = await ask_claude(
                f"Translate to {target}. Return ONLY the translation:\n\n{text}",
                f"You are a professional translator. Translate to {target}."
            )
            result["text"] = translation

        elif tool_name == "generate_image":
            description = tool_input.get("description", "")
            openai_key = os.getenv("OPENAI_API_KEY", "")
            if openai_key:
                async with httpx.AsyncClient(timeout=120) as client:
                    res = await client.post(
                        "https://api.openai.com/v1/images/generations",
                        headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                        json={"model": "dall-e-3", "prompt": description, "n": 1, "size": "1024x1024"},
                    )
                    if res.status_code == 200:
                        url = res.json().get("data", [{}])[0].get("url", "")
                        result["text"] = f"Image generated: {url}"
                    else:
                        result["text"] = "Image generation failed."
            else:
                result["text"] = "Image generation not available."

        else:
            result["text"] = f"Tool '{tool_name}' executed successfully."

    except Exception as e:
        print(f"[TEAMS TOOL ERROR] {tool_name}: {e}")
        traceback.print_exc()
        result["text"] = f"Tool execution failed: {str(e)}"

    return result


# ─── Bot Handler ──────────────────────────────────────────────────────────

class GoFartherBot(ActivityHandler):
    async def on_message_activity(self, turn_context: TurnContext):
        print(f"[TEAMS BOT] on_message_activity called")
        # Strip @mention from text
        text = turn_context.activity.text or ""
        if turn_context.activity.entities:
            for entity in turn_context.activity.entities:
                if entity.type == "mention":
                    mentioned = entity.additional_properties.get("text", "")
                    text = text.replace(mentioned, "").strip()
        text = text.strip()
        if not text:
            return

        # Get conversation session
        conv_id = turn_context.activity.conversation.id if turn_context.activity.conversation else "unknown"
        user_id = turn_context.activity.from_property.id if turn_context.activity.from_property else "unknown"
        session = _get_session(conv_id, user_id)

        # Send typing indicator
        await turn_context.send_activity(Activity(type=ActivityTypes.typing))

        # Add user message to history
        session.messages.append({"role": "user", "content": text})

        # Keep last 20 messages for context
        messages = session.messages[-20:]

        try:
            # Call Claude with tools
            response = await call_claude(
                messages=messages,
                system=TEAMS_SYSTEM_PROMPT,
                tools=TEAMS_TOOLS,
                max_tokens=4096,
            )

            response_text = response["text"]
            tool_use = response["tool_use"]

            # If Claude wants to use a tool, execute it
            if tool_use and response["stop_reason"] == "tool_use":
                tool_result = await _execute_tool(tool_use["name"], tool_use["input"])

                # If a file was created, upload it as attachment
                if tool_result["file_bytes"]:
                    attachment = Attachment(
                        name=tool_result["filename"],
                        content_type=tool_result["mime"],
                        content_url=f"data:{tool_result['mime']};base64,{base64.b64encode(tool_result['file_bytes']).decode()}",
                    )

                    # Send file with tool result back to Claude for a nice response
                    session.messages.append({"role": "assistant", "content": response_text or "Creating file..."})
                    session.messages.append({"role": "user", "content": f"[Tool result: {tool_result['text']}]"})

                    followup = await call_claude(
                        messages=session.messages[-20:],
                        system=TEAMS_SYSTEM_PROMPT,
                        max_tokens=1024,
                    )

                    reply = Activity(
                        type=ActivityTypes.message,
                        text=followup["text"] or "Here's your file!",
                        attachments=[attachment],
                    )
                    await turn_context.send_activity(reply)
                    session.messages.append({"role": "assistant", "content": followup["text"] or "File created."})
                else:
                    # Non-file tool result — feed back to Claude
                    session.messages.append({"role": "assistant", "content": response_text or "Processing..."})
                    session.messages.append({"role": "user", "content": f"[Tool result: {tool_result['text']}]"})

                    followup = await call_claude(
                        messages=session.messages[-20:],
                        system=TEAMS_SYSTEM_PROMPT,
                        max_tokens=4096,
                    )

                    await turn_context.send_activity(Activity(
                        type=ActivityTypes.message,
                        text=followup["text"] or tool_result["text"],
                    ))
                    session.messages.append({"role": "assistant", "content": followup["text"] or tool_result["text"]})
            else:
                # Simple text response
                await turn_context.send_activity(Activity(
                    type=ActivityTypes.message,
                    text=response_text or "I'm not sure what to say.",
                ))
                session.messages.append({"role": "assistant", "content": response_text})

        except Exception as e:
            print(f"[TEAMS BOT ERROR] {e}")
            traceback.print_exc()
            await turn_context.send_activity(Activity(
                type=ActivityTypes.message,
                text=f"Sorry, something went wrong. Please try again.",
            ))

        # Cleanup old sessions periodically
        if len(_sessions) > 100:
            _cleanup_sessions()


BOT = GoFartherBot()


# ─── FastAPI Route ────────────────────────────────────────────────────────

@router.post("/messages")
async def teams_messages(request: Request):
    """Receive messages from Microsoft Teams Bot Framework."""
    body = await request.json()
    auth_header = request.headers.get("Authorization", "")

    print(f"[TEAMS] Received activity type: {body.get('type', 'unknown')}, text: {body.get('text', '')[:50]}")

    activity = Activity().deserialize(body)

    async def _aux_func(turn_context: TurnContext):
        await BOT.on_turn(turn_context)

    try:
        response = await ADAPTER.process_activity(activity, auth_header, _aux_func)
        if response:
            return JSONResponse(content=response.body, status_code=response.status)
        return JSONResponse(content={}, status_code=200)
    except PermissionError as pe:
        print(f"[TEAMS AUTH ERROR] {pe}")
        return JSONResponse(content={"error": "Unauthorized"}, status_code=401)
    except Exception as e:
        print(f"[TEAMS ADAPTER ERROR] {e}")
        traceback.print_exc()
        return JSONResponse(content={"error": str(e)}, status_code=500)
