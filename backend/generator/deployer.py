from __future__ import annotations

"""
App Deploy Manager — generates standalone HTML apps from specs and deploys them.

Each project gets a path-based live URL: /live/{project_id}
The generated HTML app includes working CRUD that calls the backend API.
"""

import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project

# Root directory for build artifacts
BUILDS_DIR = Path(__file__).resolve().parent.parent / "builds"
BUILDS_DIR.mkdir(exist_ok=True)


async def deploy_app(project_id: str, spec: dict, db: AsyncSession) -> dict:
    """
    Generate a frontend build from the spec, save to builds/, and update
    the project status to 'deployed'.

    Returns deploy info dict with URL and status.
    """
    # Determine the base URL for the API (used by the generated app)
    api_base_url = os.getenv("API_BASE_URL", "")

    # Generate the full standalone HTML
    html_content = generate_full_app_html(spec, api_base_url, project_id)

    # Write build artifact
    build_dir = BUILDS_DIR / str(project_id)
    build_dir.mkdir(parents=True, exist_ok=True)
    index_path = build_dir / "index.html"
    index_path.write_text(html_content, encoding="utf-8")

    # Determine the live URL
    app_host = os.getenv("APP_HOST", "")
    if app_host:
        deploy_url = f"{app_host}/live/{project_id}"
    else:
        deploy_url = f"/live/{project_id}"

    # Update project status in DB
    await db.execute(
        update(Project)
        .where(Project.id == uuid.UUID(str(project_id)))
        .values(
            status="deployed",
            build_path=str(index_path),
            updated_at=datetime.utcnow(),
        )
    )
    await db.commit()

    return {
        "project_id": str(project_id),
        "status": "deployed",
        "url": deploy_url,
        "build_path": str(index_path),
    }


def generate_full_app_html(spec: dict, api_base_url: str, project_id: str = "") -> str:
    """
    Generate a complete standalone HTML app from a spec with working CRUD
    that calls the backend API.

    The generated app includes:
    - Sidebar with all modules
    - Working tables that fetch data from /api/apps/{project_id}/data/{table}
    - Working create/edit forms
    - A dashboard with stats
    - fetch() calls to the backend API
    - Auth token handling (localStorage + URL param)
    """
    app_name = spec.get("app_name") or spec.get("name") or "My App"
    entities = spec.get("entities") or []
    modules = spec.get("modules") or []
    design = spec.get("design_system") or {}
    colors = design.get("colors") or {}
    primary_color = colors.get("primary") or "#000000"
    secondary_color = colors.get("secondary") or "#6366f1"

    # Build sidebar items HTML
    sidebar_items_html = []
    for m in modules:
        mod_name = m.get("name", "Module")
        icon = _get_module_icon(mod_name, m)
        sidebar_items_html.append(
            f'<button class="sidebar-item" data-module="{mod_name}" onclick="showModule(\'{mod_name}\')">'
            f'{icon}<span>{mod_name}</span></button>'
        )
    sidebar_html = "\n            ".join(sidebar_items_html)

    # Build entity field maps for JS
    entity_fields_js = _build_entity_fields_js(entities)

    # Build module page containers
    module_pages_html = []
    for m in modules:
        mod_name = m.get("name", "Module")
        entity_name = m.get("entity", "")
        layout = m.get("layout", "table")

        if mod_name.lower() == "dashboard" or layout == "dashboard":
            module_pages_html.append(_build_dashboard_page(mod_name, entities, primary_color))
        else:
            module_pages_html.append(_build_crud_page(mod_name, entity_name, entities, primary_color))

    pages_html = "\n    ".join(module_pages_html)

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{app_name}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
:root {{
  --primary: {primary_color};
  --primary-light: {primary_color}15;
  --secondary: {secondary_color};
  --bg: #ffffff;
  --sidebar-bg: #f8f9fa;
  --border: #e5e7eb;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
}}
body {{
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  display: flex;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
}}
/* Sidebar */
.sidebar {{
  width: 240px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}}
.sidebar-header {{
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border);
}}
.sidebar-header h1 {{
  font-size: 15px;
  font-weight: 700;
  color: var(--primary);
}}
.sidebar-header p {{
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}}
.sidebar-nav {{
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}}
.sidebar-item {{
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: none;
  background: none;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  margin-bottom: 2px;
  transition: all 0.15s;
}}
.sidebar-item:hover {{ background: #e5e7eb; color: var(--text); }}
.sidebar-item.active {{ background: var(--primary); color: #fff; }}
.sidebar-item svg {{ width: 18px; height: 18px; flex-shrink: 0; }}
.sidebar-footer {{
  padding: 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}}
/* Main content */
.main {{
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}}
.topbar {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: #fff;
}}
.topbar h2 {{
  font-size: 16px;
  font-weight: 600;
}}
.topbar-actions {{
  display: flex;
  align-items: center;
  gap: 8px;
}}
.content {{
  flex: 1;
  overflow: auto;
  padding: 24px;
}}
/* Pages */
.page {{ display: none; }}
.page.active {{ display: block; }}
/* Table */
.table-container {{
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}}
table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}}
th {{
  text-align: left;
  padding: 12px 16px;
  background: #f9fafb;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: capitalize;
  font-size: 12px;
}}
td {{
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
}}
tr:last-child td {{ border-bottom: none; }}
tr:hover td {{ background: #f9fafb; }}
.badge {{
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: var(--primary-light);
  color: var(--primary);
}}
.empty-state {{
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}}
.empty-state svg {{
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  opacity: 0.3;
}}
.empty-state p {{ font-size: 14px; }}
/* Buttons */
.btn {{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: #fff;
  color: var(--text);
  transition: all 0.15s;
}}
.btn:hover {{ background: #f3f4f6; }}
.btn-primary {{
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}}
.btn-primary:hover {{ opacity: 0.9; }}
.btn-danger {{
  color: var(--danger);
  border-color: var(--danger);
}}
.btn-danger:hover {{ background: #fef2f2; }}
.btn-sm {{ padding: 5px 10px; font-size: 12px; }}
/* Stats */
.stats-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}}
.stat-card {{
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}}
.stat-card .stat-icon {{
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  background: var(--primary-light);
  color: var(--primary);
}}
.stat-label {{
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}}
.stat-value {{
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
}}
/* Modal */
.modal-overlay {{
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 100;
  align-items: center;
  justify-content: center;
}}
.modal-overlay.show {{ display: flex; }}
.modal {{
  background: #fff;
  border-radius: 16px;
  width: 500px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
}}
.modal-header {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}}
.modal-header h3 {{ font-size: 15px; font-weight: 600; }}
.modal-close {{
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
  border-radius: 6px;
}}
.modal-close:hover {{ background: #f3f4f6; }}
.modal-body {{ padding: 20px; }}
.modal-footer {{
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}}
/* Form */
.form-group {{
  margin-bottom: 16px;
}}
.form-group label {{
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: capitalize;
}}
.form-group input,
.form-group select,
.form-group textarea {{
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
}}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {{
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}}
/* Loading */
.loading {{
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: 13px;
  gap: 8px;
}}
.spinner {{
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}}
@keyframes spin {{ to {{ transform: rotate(360deg); }} }}
/* Toast */
.toast {{
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 20px;
  background: var(--text);
  color: #fff;
  border-radius: 10px;
  font-size: 13px;
  z-index: 200;
  transform: translateY(100px);
  opacity: 0;
  transition: all 0.3s;
}}
.toast.show {{ transform: translateY(0); opacity: 1; }}
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-header">
    <h1>{app_name}</h1>
    <p>Powered by isibi.ai</p>
  </div>
  <div class="sidebar-nav">
    {sidebar_html}
  </div>
  <div class="sidebar-footer">
    Built with isibi.ai
  </div>
</div>

<div class="main">
  <div class="topbar">
    <h2 id="page-title">Dashboard</h2>
    <div class="topbar-actions" id="topbar-actions"></div>
  </div>
  <div class="content" id="content-area">
    {pages_html}
  </div>
</div>

<!-- Create/Edit Modal -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <h3 id="modal-title">Create Record</h3>
      <button class="modal-close" onclick="closeModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save" onclick="saveRecord()">Save</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
(function() {{
  "use strict";

  // ── Config ──
  const PROJECT_ID = "{project_id}";
  const API_BASE = "{api_base_url}";
  const ENTITY_FIELDS = {entity_fields_js};

  // ── Auth ──
  function getToken() {{
    // Check URL param first, then localStorage
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {{
      localStorage.setItem("app_token", urlToken);
      return urlToken;
    }}
    return localStorage.getItem("app_token") || localStorage.getItem("token") || "";
  }}

  function apiHeaders() {{
    const headers = {{ "Content-Type": "application/json" }};
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
  }}

  // ── API helpers ──
  async function apiGet(table) {{
    const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{
      headers: apiHeaders()
    }});
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.items || data.data || []);
  }}

  async function apiCreate(table, record) {{
    const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(record)
    }});
    return res.ok ? await res.json() : null;
  }}

  async function apiUpdate(table, id, record) {{
    const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table + "/" + id, {{
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify(record)
    }});
    return res.ok ? await res.json() : null;
  }}

  async function apiDelete(table, id) {{
    const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table + "/" + id, {{
      method: "DELETE",
      headers: apiHeaders()
    }});
    return res.ok;
  }}

  // ── Toast ──
  function showToast(msg) {{
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }}

  // ── State ──
  let currentModule = null;
  let currentEntity = null;
  let editingId = null;
  const dataCache = {{}};

  // ── Module navigation ──
  window.showModule = function(name) {{
    // Update sidebar
    document.querySelectorAll(".sidebar-item").forEach(b => {{
      b.classList.toggle("active", b.dataset.module === name);
    }});
    // Update pages
    document.querySelectorAll(".page").forEach(p => {{
      p.classList.toggle("active", p.id === "page-" + name);
    }});
    // Update topbar
    document.getElementById("page-title").textContent = name;
    currentModule = name;

    // Find associated entity
    const pageEl = document.getElementById("page-" + name);
    currentEntity = pageEl ? pageEl.dataset.entity : null;

    // Update topbar actions
    const actions = document.getElementById("topbar-actions");
    if (currentEntity && ENTITY_FIELDS[currentEntity]) {{
      actions.innerHTML = '<button class="btn btn-primary btn-sm" onclick="openCreate()">+ Add New</button>';
    }} else {{
      actions.innerHTML = "";
    }}

    // Load data for CRUD pages
    if (currentEntity && ENTITY_FIELDS[currentEntity]) {{
      loadTableData(currentEntity, name);
    }}

    // Load dashboard stats
    if (name.toLowerCase() === "dashboard" || pageEl?.dataset.layout === "dashboard") {{
      loadDashboardStats();
    }}
  }};

  // ── Load table data ──
  async function loadTableData(entity, moduleName) {{
    const tbody = document.getElementById("tbody-" + moduleName);
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="20"><div class="loading"><div class="spinner"></div>Loading...</div></td></tr>';

    try {{
      const rows = await apiGet(entity.toLowerCase());
      dataCache[entity] = rows;

      if (rows.length === 0) {{
        tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><p>No records yet. Click "+ Add New" to create one.</p></div></td></tr>';
        return;
      }}

      const fields = ENTITY_FIELDS[entity] || [];
      const visibleFields = fields.filter(f =>
        !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
      ).slice(0, 7);

      tbody.innerHTML = rows.map(row => {{
        const cells = visibleFields.map(f => {{
          let val = row[f.name] ?? "";
          if (f.enum_values && f.enum_values.length) {{
            return '<td><span class="badge">' + escHtml(String(val)) + '</span></td>';
          }}
          if (f.name.includes("amount") || f.name.includes("value") || f.name.includes("price")) {{
            return '<td>$' + escHtml(String(val)) + '</td>';
          }}
          return '<td>' + escHtml(String(val)) + '</td>';
        }}).join("");

        const rowId = row.id || row.ID || "";
        return '<tr>' + cells +
          '<td style="text-align:right">' +
            '<button class="btn btn-sm" onclick="openEdit(\\'' + entity + '\\',\\'' + rowId + '\\')">Edit</button> ' +
            '<button class="btn btn-sm btn-danger" onclick="deleteRecord(\\'' + entity + '\\',\\'' + rowId + '\\')">Delete</button>' +
          '</td></tr>';
      }}).join("");
    }} catch (e) {{
      tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><p>Could not load data. API may not be connected.</p></div></td></tr>';
    }}
  }}

  // ── Dashboard stats ──
  async function loadDashboardStats() {{
    const entities = Object.keys(ENTITY_FIELDS);
    for (const entity of entities) {{
      const countEl = document.getElementById("stat-count-" + entity);
      if (!countEl) continue;
      try {{
        const rows = await apiGet(entity.toLowerCase());
        countEl.textContent = rows.length;
      }} catch {{
        countEl.textContent = "—";
      }}
    }}
  }}

  // ── Modal: Create ──
  window.openCreate = function() {{
    if (!currentEntity || !ENTITY_FIELDS[currentEntity]) return;
    editingId = null;
    document.getElementById("modal-title").textContent = "Create " + currentEntity;
    renderForm(currentEntity, {{}});
    document.getElementById("modal-overlay").classList.add("show");
  }};

  // ── Modal: Edit ──
  window.openEdit = function(entity, id) {{
    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    if (!record) return;
    editingId = id;
    currentEntity = entity;
    document.getElementById("modal-title").textContent = "Edit " + entity;
    renderForm(entity, record);
    document.getElementById("modal-overlay").classList.add("show");
  }};

  // ── Render form fields ──
  function renderForm(entity, record) {{
    const fields = (ENTITY_FIELDS[entity] || []).filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    );
    const body = document.getElementById("modal-body");
    body.innerHTML = fields.map(f => {{
      const val = record[f.name] ?? f.default_value ?? "";
      if (f.enum_values && f.enum_values.length) {{
        const opts = f.enum_values.map(v =>
          '<option value="' + escHtml(v) + '"' + (v === val ? ' selected' : '') + '>' + escHtml(v) + '</option>'
        ).join("");
        return '<div class="form-group"><label>' + escHtml(f.name.replace(/_/g, " ")) +
          '</label><select name="' + f.name + '">' + opts + '</select></div>';
      }}
      const type = f.name.includes("email") ? "email" :
                    f.name.includes("date") ? "date" :
                    (f.name.includes("amount") || f.name.includes("value") || f.name.includes("price")) ? "number" :
                    "text";
      return '<div class="form-group"><label>' + escHtml(f.name.replace(/_/g, " ")) +
        '</label><input type="' + type + '" name="' + f.name + '" value="' + escHtml(String(val)) + '"></div>';
    }}).join("");
  }}

  // ── Save record ──
  window.saveRecord = async function() {{
    if (!currentEntity) return;
    const body = document.getElementById("modal-body");
    const inputs = body.querySelectorAll("input, select, textarea");
    const record = {{}};
    inputs.forEach(inp => {{ record[inp.name] = inp.value; }});

    let result;
    if (editingId) {{
      result = await apiUpdate(currentEntity.toLowerCase(), editingId, record);
      if (result) showToast(currentEntity + " updated successfully");
    }} else {{
      result = await apiCreate(currentEntity.toLowerCase(), record);
      if (result) showToast(currentEntity + " created successfully");
    }}

    closeModal();
    if (currentModule) showModule(currentModule);
  }};

  // ── Delete record ──
  window.deleteRecord = async function(entity, id) {{
    if (!confirm("Delete this record?")) return;
    const ok = await apiDelete(entity.toLowerCase(), id);
    if (ok) {{
      showToast(entity + " deleted");
      if (currentModule) showModule(currentModule);
    }} else {{
      showToast("Failed to delete");
    }}
  }};

  // ── Close modal ──
  window.closeModal = function() {{
    document.getElementById("modal-overlay").classList.remove("show");
    editingId = null;
  }};

  // ── Escape HTML ──
  function escHtml(s) {{
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }}

  // ── Init: show first module ──
  const first = document.querySelector(".sidebar-item");
  if (first) {{
    first.click();
  }}
}})();
</script>
</body>
</html>'''


def _get_module_icon(name: str, module: dict) -> str:
    """Return an inline SVG icon based on module name."""
    name_lower = name.lower()
    if "dashboard" in name_lower:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
    if any(k in name_lower for k in ["contact", "lead", "customer", "user", "client", "people"]):
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    if any(k in name_lower for k in ["deal", "sale", "order", "revenue", "invoice"]):
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
    if any(k in name_lower for k in ["task", "todo", "activity"]):
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    if any(k in name_lower for k in ["product", "item", "inventory", "catalog"]):
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>'
    if any(k in name_lower for k in ["setting", "config"]):
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    # Default: list icon
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'


def _build_entity_fields_js(entities: list) -> str:
    """Build a JS object mapping entity names to their field definitions."""
    import json
    fields_map = {}
    for entity in entities:
        name = entity.get("name", "")
        fields = entity.get("fields", [])
        fields_map[name] = [
            {
                "name": f.get("name", ""),
                "type": f.get("type", "string"),
                "required": f.get("required", False),
                "enum_values": f.get("enum_values", []),
                "default_value": f.get("default_value", ""),
            }
            for f in fields
        ]
    return json.dumps(fields_map)


def _build_dashboard_page(mod_name: str, entities: list, primary_color: str) -> str:
    """Build the dashboard page HTML."""
    stat_cards = []
    for entity in entities[:6]:
        ename = entity.get("name", "Entity")
        stat_cards.append(
            f'<div class="stat-card">'
            f'<div class="stat-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>'
            f'<div class="stat-label">Total {ename}s</div>'
            f'<div class="stat-value" id="stat-count-{ename}">—</div>'
            f'</div>'
        )
    cards_html = "\n      ".join(stat_cards)

    return (
        f'<div id="page-{mod_name}" class="page" data-layout="dashboard">'
        f'<div class="stats-grid">{cards_html}</div>'
        f'<div class="table-container" style="padding:20px;margin-top:8px">'
        f'<p style="color:var(--text-muted);font-size:13px">Welcome to your dashboard. '
        f'Use the sidebar to navigate between modules.</p>'
        f'</div>'
        f'</div>'
    )


def _build_crud_page(mod_name: str, entity_name: str, entities: list, primary_color: str) -> str:
    """Build a CRUD table page HTML."""
    entity = next((e for e in entities if e.get("name") == entity_name), None)
    if not entity:
        return (
            f'<div id="page-{mod_name}" class="page">'
            f'<div class="empty-state"><p>{mod_name} — module content</p></div>'
            f'</div>'
        )

    fields = entity.get("fields", [])
    visible_fields = [
        f for f in fields
        if f.get("name") not in ["id", "org_id", "deleted_at", "version", "created_at", "updated_at"]
        and f.get("show_in_table", True) is not False
    ][:7]

    headers = "".join(
        f'<th>{f.get("name", "").replace("_", " ")}</th>' for f in visible_fields
    )
    headers += '<th style="text-align:right">Actions</th>'

    return (
        f'<div id="page-{mod_name}" class="page" data-entity="{entity_name}">'
        f'<div class="table-container">'
        f'<table>'
        f'<thead><tr>{headers}</tr></thead>'
        f'<tbody id="tbody-{mod_name}"></tbody>'
        f'</table>'
        f'</div>'
        f'</div>'
    )
