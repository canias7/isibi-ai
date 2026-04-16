from __future__ import annotations

"""
API Playground / Auto-Docs — auto-generate API documentation for generated apps.

Endpoints:
  GET /api/apps/{project_id}/docs       — OpenAPI/Swagger JSON
  GET /api/apps/{project_id}/docs/html  — rendered HTML docs page
"""

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project

router = APIRouter(tags=["app-api-docs"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project(db: AsyncSession, project_id: str, org_id: uuid.UUID) -> Project:
    pid = uuid.UUID(project_id)
    result = await db.execute(
        select(Project).where(
            Project.id == pid,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _field_type_to_json_schema(field_type: str) -> dict:
    """Map spec field types to JSON Schema types."""
    mapping = {
        "string": {"type": "string"},
        "number": {"type": "number"},
        "integer": {"type": "integer"},
        "boolean": {"type": "boolean"},
        "date": {"type": "string", "format": "date"},
        "datetime": {"type": "string", "format": "date-time"},
        "json": {"type": "object"},
        "text": {"type": "string"},
        "email": {"type": "string", "format": "email"},
        "url": {"type": "string", "format": "uri"},
    }
    return mapping.get(field_type, {"type": "string"})


def _build_openapi(project: Project) -> dict:
    """Build an OpenAPI 3.0 spec from the project's entities."""
    spec = project.spec or {}
    entities = spec.get("entities", [])
    app_name = spec.get("app_name", project.name or "App")
    base_url = f"/live/{project.id}/api"

    paths = {}
    schemas = {}

    for entity in entities:
        name = entity.get("name", "Unknown")
        fields = entity.get("fields", [])
        slug = name.lower() + "s"  # simple pluralisation

        # Build schema
        properties = {"id": {"type": "string", "format": "uuid"}}
        required_fields = []
        for f in fields:
            fname = f.get("name", "field")
            ftype = f.get("type", "string")
            properties[fname] = _field_type_to_json_schema(ftype)
            required_fields.append(fname)

        properties["created_at"] = {"type": "string", "format": "date-time"}
        properties["updated_at"] = {"type": "string", "format": "date-time"}

        schemas[name] = {
            "type": "object",
            "properties": properties,
            "required": required_fields,
        }

        schemas[f"{name}Create"] = {
            "type": "object",
            "properties": {k: v for k, v in properties.items() if k not in ("id", "created_at", "updated_at")},
            "required": required_fields,
        }

        # Build example
        example = {}
        for f in fields:
            fname = f.get("name", "field")
            ftype = f.get("type", "string")
            if ftype in ("number", "integer"):
                example[fname] = 0
            elif ftype == "boolean":
                example[fname] = False
            elif ftype == "date":
                example[fname] = "2025-01-01"
            elif ftype == "datetime":
                example[fname] = "2025-01-01T00:00:00Z"
            elif ftype == "json":
                example[fname] = {}
            else:
                example[fname] = ""

        # Paths
        list_path = f"/{slug}"
        item_path = f"/{slug}/{{id}}"

        paths[list_path] = {
            "get": {
                "summary": f"List all {name} records",
                "operationId": f"list_{slug}",
                "tags": [name],
                "security": [{"BearerAuth": []}],
                "parameters": [
                    {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 25}},
                    {"name": "offset", "in": "query", "schema": {"type": "integer", "default": 0}},
                ],
                "responses": {
                    "200": {
                        "description": f"List of {name} records",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "items": {"type": "array", "items": {"$ref": f"#/components/schemas/{name}"}},
                                        "total": {"type": "integer"},
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "post": {
                "summary": f"Create a new {name}",
                "operationId": f"create_{name.lower()}",
                "tags": [name],
                "security": [{"BearerAuth": []}],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": f"#/components/schemas/{name}Create"},
                            "example": example,
                        },
                    },
                },
                "responses": {
                    "201": {
                        "description": f"{name} created",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": f"#/components/schemas/{name}"},
                            },
                        },
                    },
                },
            },
        }

        paths[item_path] = {
            "get": {
                "summary": f"Get a single {name} by ID",
                "operationId": f"get_{name.lower()}",
                "tags": [name],
                "security": [{"BearerAuth": []}],
                "parameters": [
                    {"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}},
                ],
                "responses": {
                    "200": {
                        "description": f"{name} details",
                        "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{name}"}}},
                    },
                    "404": {"description": "Not found"},
                },
            },
            "patch": {
                "summary": f"Update a {name}",
                "operationId": f"update_{name.lower()}",
                "tags": [name],
                "security": [{"BearerAuth": []}],
                "parameters": [
                    {"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}},
                ],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": f"#/components/schemas/{name}Create"},
                            "example": example,
                        },
                    },
                },
                "responses": {
                    "200": {
                        "description": f"{name} updated",
                        "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{name}"}}},
                    },
                    "404": {"description": "Not found"},
                },
            },
            "delete": {
                "summary": f"Delete a {name}",
                "operationId": f"delete_{name.lower()}",
                "tags": [name],
                "security": [{"BearerAuth": []}],
                "parameters": [
                    {"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}},
                ],
                "responses": {
                    "204": {"description": "Deleted"},
                    "404": {"description": "Not found"},
                },
            },
        }

    openapi = {
        "openapi": "3.0.3",
        "info": {
            "title": f"{app_name} API",
            "version": "1.0.0",
            "description": f"Auto-generated API documentation for {app_name}",
        },
        "servers": [{"url": base_url, "description": "App API"}],
        "components": {
            "securitySchemes": {
                "BearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                },
            },
            "schemas": schemas,
        },
        "paths": paths,
    }

    return openapi


def _build_docs_html(openapi: dict) -> str:
    """Build a self-contained HTML API docs page."""
    info = openapi.get("info", {})
    title = info.get("title", "API Docs")
    paths = openapi.get("paths", {})
    schemas = openapi.get("components", {}).get("schemas", {})

    method_colors = {
        "get": "#16a34a",
        "post": "#2563eb",
        "patch": "#d97706",
        "put": "#d97706",
        "delete": "#dc2626",
    }

    cards_html = ""
    for path, methods in paths.items():
        for method, details in methods.items():
            color = method_colors.get(method, "#6b7280")
            summary = details.get("summary", "")
            tags = ", ".join(details.get("tags", []))
            op_id = details.get("operationId", "")

            # Request body example
            req_body_html = ""
            req_body = details.get("requestBody", {})
            if req_body:
                content = req_body.get("content", {}).get("application/json", {})
                example = content.get("example")
                schema_ref = content.get("schema", {}).get("$ref", "")
                if example:
                    req_body_html = (
                        f'<div style="margin-top:12px;">'
                        f'<div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;">Request Body</div>'
                        f'<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;overflow-x:auto;">{json.dumps(example, indent=2)}</pre>'
                        f'</div>'
                    )

            # Response example
            resp_html = ""
            responses = details.get("responses", {})
            for code, resp in responses.items():
                resp_content = resp.get("content", {}).get("application/json", {})
                resp_schema = resp_content.get("schema", {})
                ref = resp_schema.get("$ref", "")
                if ref:
                    schema_name = ref.split("/")[-1]
                    schema_def = schemas.get(schema_name, {})
                    props = schema_def.get("properties", {})
                    resp_example = {}
                    for k, v in props.items():
                        t = v.get("type", "string")
                        if t == "string":
                            resp_example[k] = v.get("format", "string") if v.get("format") else ""
                        elif t == "number" or t == "integer":
                            resp_example[k] = 0
                        elif t == "boolean":
                            resp_example[k] = False
                        elif t == "object":
                            resp_example[k] = {}
                        elif t == "array":
                            resp_example[k] = []
                        else:
                            resp_example[k] = ""
                    resp_html = (
                        f'<div style="margin-top:12px;">'
                        f'<div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;">Response ({code})</div>'
                        f'<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;overflow-x:auto;">{json.dumps(resp_example, indent=2)}</pre>'
                        f'</div>'
                    )
                    break  # only first successful response

            cards_html += f"""
<details style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;">
  <summary style="padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;user-select:none;">
    <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700;color:#fff;background:{color};text-transform:uppercase;min-width:56px;text-align:center;">{method.upper()}</span>
    <code style="font-size:14px;color:#374151;font-weight:500;">{path}</code>
    <span style="margin-left:auto;font-size:13px;color:#9ca3af;">{summary}</span>
  </summary>
  <div style="padding:16px 18px;border-top:1px solid #e5e7eb;">
    <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">{summary}</div>
    {req_body_html}
    {resp_html}
    <div style="margin-top:16px;">
      <button onclick="tryEndpoint(this, '{method.upper()}', '{path}')"
        style="padding:8px 16px;background:{color};color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;">
        Try it
      </button>
      <pre class="try-result" style="display:none;margin-top:10px;background:#1f2937;color:#f9fafb;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto;max-height:300px;"></pre>
    </div>
  </div>
</details>"""

    openapi_json_escaped = json.dumps(openapi).replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: #f3f4f6; color: #111827; }}
  .container {{ max-width: 900px; margin: 0 auto; padding: 32px 20px; }}
  h1 {{ font-size: 28px; margin: 0 0 8px; }}
  .subtitle {{ color: #6b7280; font-size: 15px; margin-bottom: 24px; }}
  .auth-bar {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }}
  .auth-bar label {{ font-size: 13px; font-weight: 600; color: #374151; white-space: nowrap; }}
  .auth-bar input {{ flex: 1; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: monospace; }}
  details > summary::-webkit-details-marker {{ display: none; }}
  details > summary::marker {{ display: none; }}
</style>
</head>
<body>
<div class="container">
  <h1>{title}</h1>
  <div class="subtitle">Auto-generated API documentation. All endpoints require Bearer token authentication.</div>
  <div class="auth-bar">
    <label for="auth-token">Auth Token:</label>
    <input id="auth-token" type="text" placeholder="Paste your Bearer token here to use Try it" />
  </div>
  {cards_html}
</div>
<script>
var _openapi = {openapi_json_escaped};
function tryEndpoint(btn, method, path) {{
  var resultEl = btn.parentElement.querySelector('.try-result');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Loading...';
  var token = document.getElementById('auth-token').value;
  var baseUrl = _openapi.servers && _openapi.servers[0] ? _openapi.servers[0].url : '';
  var url = baseUrl + path.replace(/\\{{id\\}}/g, 'example-id');
  var opts = {{
    method: method,
    headers: {{ 'Content-Type': 'application/json' }},
  }};
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  fetch(url, opts)
    .then(function(r) {{ return r.text().then(function(t) {{ return {{ status: r.status, body: t }}; }}); }})
    .then(function(data) {{
      try {{ resultEl.textContent = data.status + ' ' + JSON.stringify(JSON.parse(data.body), null, 2); }}
      catch(e) {{ resultEl.textContent = data.status + ' ' + data.body; }}
    }})
    .catch(function(err) {{ resultEl.textContent = 'Error: ' + err.message; }});
}}
</script>
</body>
</html>"""

    return html


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/apps/{project_id}/docs")
async def get_api_docs_json(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Return auto-generated OpenAPI/Swagger JSON for a project's entities."""
    project = await _get_project(db, project_id, org_id)
    openapi = _build_openapi(project)
    return JSONResponse(content=openapi)


@router.get("/apps/{project_id}/docs/html", response_class=HTMLResponse)
async def get_api_docs_html(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Return a rendered HTML page with API docs for a project."""
    project = await _get_project(db, project_id, org_id)
    openapi = _build_openapi(project)
    html = _build_docs_html(openapi)
    return HTMLResponse(content=html)
