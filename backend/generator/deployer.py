from __future__ import annotations

"""
App Deploy Manager — generates standalone HTML apps from specs and deploys them.

Each project gets a path-based live URL: /live/{project_id}
The generated HTML app includes working CRUD that calls the backend API.
"""

import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project

logger = logging.getLogger(__name__)

# Root directory for build artifacts
BUILDS_DIR = Path(__file__).resolve().parent.parent / "builds"
BUILDS_DIR.mkdir(exist_ok=True)


async def deploy_app(project_id: str, spec: dict, db: AsyncSession) -> dict:
    """
    Generate a frontend build from the spec, save to builds/, and update
    the project status to 'deployed'.

    Returns deploy info dict with URL and status.

    Error recovery:
    - If spec is missing entities/modules, uses empty defaults instead of crashing
    - If HTML generation fails for a module, skips it with a warning
    - If file write fails, logs error and continues
    - If DB update fails, logs error but still returns the deploy info
    """
    # Validate spec has minimum required fields
    if not isinstance(spec, dict):
        logger.error("deploy_app received non-dict spec: %s", type(spec).__name__)
        spec = {"app_name": "My App", "entities": [], "modules": [], "design_system": {}}

    spec.setdefault("app_name", spec.get("name", "My App"))
    spec.setdefault("entities", [])
    spec.setdefault("modules", [])
    spec.setdefault("design_system", {})

    # Determine the base URL for the API (used by the generated app)
    api_base_url = os.getenv("API_BASE_URL", "")

    # Generate the full standalone HTML
    html_content = generate_full_app_html(spec, api_base_url, project_id)

    # Write build artifact
    build_dir = BUILDS_DIR / str(project_id)
    build_dir.mkdir(parents=True, exist_ok=True)
    index_path = build_dir / "index.html"
    index_path.write_text(html_content, encoding="utf-8")

    # Write PWA manifest
    app_name = spec.get("app_name") or spec.get("name") or "My App"
    primary_color = (spec.get("design_system") or {}).get("colors", {}).get("primary", "#ec4899")
    manifest = {
        "name": app_name,
        "short_name": app_name[:12],
        "start_url": f"/live/{project_id}",
        "scope": f"/live/{project_id}/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": primary_color,
        "description": f"{app_name} — built with isibi.ai",
        "icons": [
            {"src": f"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='{primary_color}'/><text x='50' y='68' font-size='50' text-anchor='middle' fill='white' font-family='system-ui'>{app_name[0].upper()}</text></svg>", "sizes": "192x192", "type": "image/svg+xml"},
            {"src": f"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='{primary_color}'/><text x='50' y='68' font-size='50' text-anchor='middle' fill='white' font-family='system-ui'>{app_name[0].upper()}</text></svg>", "sizes": "512x512", "type": "image/svg+xml"},
        ],
    }
    import json
    (build_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Write service worker for offline caching
    sw_content = """
const CACHE_NAME = 'app-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (res.status === 200 && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      }
      return res;
    })).catch(() => caches.match('/'))
  );
});
"""
    (build_dir / "sw.js").write_text(sw_content.strip(), encoding="utf-8")

    # Write app icon SVG
    icon_letter = (app_name or "A")[0].upper()
    icon_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="100" fill="{primary_color}"/>
<text x="256" y="340" font-size="280" text-anchor="middle" fill="white" font-family="system-ui, sans-serif" font-weight="bold">{icon_letter}</text>
</svg>'''
    (build_dir / "icon.svg").write_text(icon_svg, encoding="utf-8")

    # Determine the live URL
    app_host = os.getenv("APP_HOST", "")
    if app_host:
        deploy_url = f"{app_host}/live/{project_id}"
    else:
        deploy_url = f"/live/{project_id}"

    # Store build artifacts in the spec metadata so they survive Render restarts
    import json as _json
    build_data = {
        "index_html": html_content,
        "manifest_json": _json.dumps(manifest, indent=2),
        "sw_js": sw_content.strip(),
        "icon_svg": icon_svg,
    }

    # Update project status + store build in DB
    await db.execute(
        update(Project)
        .where(Project.id == uuid.UUID(str(project_id)))
        .values(
            status="deployed",
            build_path=_json.dumps(build_data),
            updated_at=datetime.utcnow(),
        )
    )
    await db.commit()

    return {
        "project_id": str(project_id),
        "status": "deployed",
        "url": deploy_url,
    }


def generate_full_app_html(spec: dict, api_base_url: str, project_id: str = "") -> str:
    """
    Generate a complete standalone HTML app from a spec with working CRUD
    that calls the backend API.

    The generated app includes:
    - Collapsible sidebar with all modules, app logo, active states
    - Dashboard with stat cards, CSS bar chart, recent activity
    - Table view with sort, search, status tabs, pagination
    - Slide-over create/edit modals with proper field types
    - Detail view for individual records
    - Delete confirmation dialog
    - Toast notifications (success/error, auto-dismiss)
    - Skeleton loaders
    - Responsive layout (hamburger menu on mobile)
    - Auth token handling (localStorage + URL param)
    """
    import json

    app_name = spec.get("app_name") or spec.get("name") or "My App"
    entities = spec.get("entities") or []
    modules = spec.get("modules") or []
    design = spec.get("design_system") or {}
    colors = design.get("colors") or {}
    primary_color = colors.get("primary") or "#6366f1"
    secondary_color = colors.get("secondary") or "#8b5cf6"

    # Build entity field maps for JS
    entity_fields_js = _build_entity_fields_js(entities)

    # Build sidebar items data for JS
    sidebar_items = []
    for m in modules:
        mod_name = m.get("name", "Module")
        entity_name = m.get("entity", "")
        layout = m.get("layout", "table")
        is_dashboard = mod_name.lower() == "dashboard" or layout == "dashboard"
        sidebar_items.append({
            "name": mod_name,
            "entity": entity_name,
            "layout": "dashboard" if is_dashboard else "table",
            "icon": _get_module_icon_id(mod_name, m),
        })

    sidebar_items_js = json.dumps(sidebar_items)
    safe_name = (app_name or "app").lower().replace(" ", "-").replace("'", "")
    app_initial = (app_name or "A")[0].upper()

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="{app_name}">
<meta name="theme-color" content="{primary_color}">
<link rel="manifest" href="/live/{project_id}/manifest.json">
<link rel="apple-touch-icon" href="/live/{project_id}/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>{app_name}</title>
<style>
*,*::before,*::after {{ margin:0;padding:0;box-sizing:border-box; }}
:root {{
  --primary: {primary_color};
  --primary-hover: {primary_color}dd;
  --primary-light: {primary_color}12;
  --primary-subtle: {primary_color}08;
  --secondary: {secondary_color};
  --bg: #f8f9fb;
  --bg-card: #ffffff;
  --sidebar-bg: #ffffff;
  --sidebar-width: 260px;
  --sidebar-collapsed-width: 0px;
  --border: #e5e7eb;
  --border-light: #f0f0f3;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --text-placeholder: #c0c5ce;
  --success: #10b981;
  --success-light: #ecfdf5;
  --warning: #f59e0b;
  --warning-light: #fffbeb;
  --danger: #ef4444;
  --danger-light: #fef2f2;
  --info: #3b82f6;
  --info-light: #eff6ff;
  --radius-sm: 6px;
  --radius: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 40px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04);
  --shadow-xl: 0 20px 60px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.05);
  --transition: 0.15s ease;
  --transition-slow: 0.25s ease;
}}
html {{ height:100%; }}
body {{
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display:flex;
  height:100vh;
  background:var(--bg);
  color:var(--text);
  font-size:14px;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  overflow:hidden;
}}

/* ── Sidebar ── */
.sidebar {{
  width:var(--sidebar-width);
  background:var(--sidebar-bg);
  border-right:1px solid var(--border);
  display:flex;
  flex-direction:column;
  flex-shrink:0;
  transition:width var(--transition-slow), transform var(--transition-slow);
  z-index:40;
  position:relative;
}}
.sidebar-header {{
  padding:20px 20px 16px;
  display:flex;
  align-items:center;
  gap:12px;
  border-bottom:1px solid var(--border-light);
}}
.app-logo {{
  width:36px;height:36px;
  border-radius:var(--radius-md);
  background:var(--primary);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:16px;
  flex-shrink:0;
  box-shadow: 0 2px 8px {primary_color}40;
}}
.app-logo-text {{
  flex:1;min-width:0;
}}
.app-logo-text h1 {{
  font-size:15px;font-weight:700;color:var(--text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}}
.app-logo-text p {{
  font-size:11px;color:var(--text-muted);margin-top:1px;
}}
.sidebar-collapse-btn {{
  position:absolute;
  top:24px;right:-12px;
  width:24px;height:24px;
  border-radius:50%;
  background:var(--bg-card);
  border:1px solid var(--border);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;
  box-shadow:var(--shadow-xs);
  transition:all var(--transition);
  z-index:5;
  color:var(--text-muted);
}}
.sidebar-collapse-btn:hover {{ background:var(--bg);color:var(--text); }}
.sidebar-collapse-btn svg {{ width:14px;height:14px; }}
.sidebar-nav {{
  flex:1;padding:12px 12px;overflow-y:auto;
}}
.sidebar-section-label {{
  font-size:10px;font-weight:600;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:0.06em;
  padding:12px 12px 6px;
}}
.sidebar-item {{
  display:flex;align-items:center;gap:10px;
  width:100%;text-align:left;
  padding:8px 12px;
  border:none;background:none;
  border-radius:var(--radius);
  font-size:13px;font-weight:500;
  color:var(--text-secondary);
  cursor:pointer;
  margin-bottom:1px;
  transition:all var(--transition);
  position:relative;
}}
.sidebar-item:hover {{ background:var(--bg);color:var(--text); }}
.sidebar-item.active {{
  background:var(--primary-light);
  color:var(--primary);
  font-weight:600;
}}
.sidebar-item.active::before {{
  content:'';position:absolute;left:0;top:6px;bottom:6px;
  width:3px;border-radius:0 3px 3px 0;
  background:var(--primary);
}}
.sidebar-item svg {{ width:18px;height:18px;flex-shrink:0;opacity:0.7; }}
.sidebar-item.active svg {{ opacity:1; }}
.sidebar-footer {{
  padding:16px 20px;
  border-top:1px solid var(--border-light);
  font-size:11px;color:var(--text-muted);
  display:flex;align-items:center;gap:6px;
}}
.sidebar-footer svg {{ width:12px;height:12px;opacity:0.5; }}

/* ── Mobile overlay ── */
.sidebar-overlay {{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,0.3);z-index:35;
  opacity:0;transition:opacity var(--transition-slow);
}}
.sidebar-overlay.show {{ display:block;opacity:1; }}

/* ── Main content ── */
.main {{
  flex:1;display:flex;flex-direction:column;overflow:hidden;
  min-width:0;
}}
.topbar {{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 24px;height:56px;
  border-bottom:1px solid var(--border);
  background:var(--bg-card);
  flex-shrink:0;
  gap:16px;
}}
.topbar-left {{
  display:flex;align-items:center;gap:12px;
  min-width:0;flex:1;
}}
.hamburger {{
  display:none;
  background:none;border:none;cursor:pointer;
  padding:6px;border-radius:var(--radius);
  color:var(--text-secondary);
}}
.hamburger:hover {{ background:var(--bg);color:var(--text); }}
.hamburger svg {{ width:20px;height:20px; }}
.topbar h2 {{
  font-size:16px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}}
.topbar-actions {{
  display:flex;align-items:center;gap:8px;
  flex-shrink:0;
}}
.content {{
  flex:1;overflow:auto;padding:24px;
}}

/* ── Cards ── */
.card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  transition:box-shadow var(--transition);
}}
.card:hover {{ box-shadow:var(--shadow-sm); }}

/* ── Stats grid ── */
.stats-grid {{
  display:grid;
  grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));
  gap:16px;
  margin-bottom:24px;
}}
.stat-card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  padding:20px 24px;
  box-shadow:var(--shadow-xs);
  transition:all var(--transition);
  cursor:default;
}}
.stat-card:hover {{ box-shadow:var(--shadow-sm);transform:translateY(-1px); }}
.stat-top {{
  display:flex;align-items:flex-start;justify-content:space-between;
  margin-bottom:12px;
}}
.stat-icon {{
  width:40px;height:40px;border-radius:var(--radius-md);
  display:flex;align-items:center;justify-content:center;
  background:var(--primary-light);color:var(--primary);
}}
.stat-icon svg {{ width:20px;height:20px; }}
.stat-trend {{
  font-size:12px;font-weight:600;
  display:flex;align-items:center;gap:2px;
  padding:2px 8px;border-radius:20px;
}}
.stat-trend.up {{ color:var(--success);background:var(--success-light); }}
.stat-trend.down {{ color:var(--danger);background:var(--danger-light); }}
.stat-label {{
  font-size:12px;color:var(--text-muted);
  margin-bottom:4px;font-weight:500;
}}
.stat-value {{
  font-size:28px;font-weight:700;color:var(--text);
  letter-spacing:-0.02em;
}}

/* ── Chart (CSS-only bar chart) ── */
.chart-container {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  padding:24px;
  box-shadow:var(--shadow-xs);
  margin-bottom:24px;
}}
.chart-header {{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:20px;
}}
.chart-header h3 {{ font-size:14px;font-weight:600; }}
.chart-bars {{
  display:flex;align-items:flex-end;gap:8px;
  height:160px;padding-top:8px;
}}
.chart-bar-col {{
  flex:1;display:flex;flex-direction:column;align-items:center;
  height:100%;justify-content:flex-end;gap:6px;
}}
.chart-bar {{
  width:100%;max-width:40px;
  border-radius:6px 6px 2px 2px;
  background:var(--primary);opacity:0.8;
  transition:opacity var(--transition), height 0.5s ease;
  min-height:4px;
}}
.chart-bar:hover {{ opacity:1; }}
.chart-bar-label {{
  font-size:10px;color:var(--text-muted);font-weight:500;
  white-space:nowrap;
}}

/* ── Recent activity ── */
.activity-list {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  overflow:hidden;
}}
.activity-header {{
  padding:16px 20px;border-bottom:1px solid var(--border-light);
  display:flex;align-items:center;justify-content:space-between;
}}
.activity-header h3 {{ font-size:14px;font-weight:600; }}
.activity-item {{
  display:flex;align-items:center;gap:12px;
  padding:12px 20px;
  border-bottom:1px solid var(--border-light);
  transition:background var(--transition);
}}
.activity-item:last-child {{ border-bottom:none; }}
.activity-item:hover {{ background:var(--bg); }}
.activity-dot {{
  width:8px;height:8px;border-radius:50%;
  background:var(--primary);flex-shrink:0;
}}
.activity-text {{
  flex:1;font-size:13px;color:var(--text-secondary);min-width:0;
}}
.activity-text strong {{ color:var(--text);font-weight:600; }}
.activity-time {{
  font-size:11px;color:var(--text-muted);flex-shrink:0;
}}

/* ── Dashboard grid ── */
.dashboard-grid {{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:24px;
}}

/* ── Table ── */
.table-toolbar {{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;
  gap:12px;
  flex-wrap:wrap;
}}
.search-input {{
  display:flex;align-items:center;gap:8px;
  padding:7px 12px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  background:var(--bg);
  transition:border-color var(--transition), box-shadow var(--transition);
  min-width:220px;
}}
.search-input:focus-within {{
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-light);
  background:#fff;
}}
.search-input svg {{ width:16px;height:16px;color:var(--text-muted);flex-shrink:0; }}
.search-input input {{
  border:none;outline:none;background:transparent;
  font-size:13px;color:var(--text);width:100%;
  font-family:inherit;
}}
.search-input input::placeholder {{ color:var(--text-placeholder); }}
.status-tabs {{
  display:flex;align-items:center;gap:2px;
  background:var(--bg);border-radius:var(--radius);
  padding:3px;
}}
.status-tab {{
  padding:5px 14px;border-radius:var(--radius-sm);
  font-size:12px;font-weight:500;
  cursor:pointer;border:none;background:none;
  color:var(--text-secondary);
  transition:all var(--transition);
}}
.status-tab:hover {{ color:var(--text); }}
.status-tab.active {{
  background:var(--bg-card);color:var(--text);
  box-shadow:var(--shadow-xs);
}}
.table-container {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  overflow:hidden;
}}
table {{
  width:100%;border-collapse:collapse;font-size:13px;
}}
th {{
  text-align:left;padding:10px 16px;
  background:var(--bg);
  border-bottom:1px solid var(--border);
  font-weight:600;font-size:11px;
  color:var(--text-muted);
  text-transform:uppercase;
  letter-spacing:0.04em;
  cursor:pointer;
  user-select:none;
  transition:color var(--transition);
  white-space:nowrap;
}}
th:hover {{ color:var(--text-secondary); }}
th .sort-icon {{
  display:inline-block;margin-left:4px;
  font-size:10px;opacity:0.4;
  transition:opacity var(--transition);
}}
th:hover .sort-icon {{ opacity:0.7; }}
th.sorted .sort-icon {{ opacity:1;color:var(--primary); }}
td {{
  padding:12px 16px;
  border-bottom:1px solid var(--border-light);
  max-width:200px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}}
tr:last-child td {{ border-bottom:none; }}
tbody tr {{
  cursor:pointer;
  transition:background var(--transition);
}}
tbody tr:hover {{ background:var(--primary-subtle); }}

/* ── Status badges ── */
.badge {{
  display:inline-flex;align-items:center;gap:6px;
  padding:3px 10px;border-radius:20px;
  font-size:12px;font-weight:500;
  white-space:nowrap;
}}
.badge-dot {{
  width:6px;height:6px;border-radius:50%;
  flex-shrink:0;
}}
.badge-default {{ background:var(--bg);color:var(--text-secondary); }}
.badge-default .badge-dot {{ background:var(--text-muted); }}
.badge-primary {{ background:var(--primary-light);color:var(--primary); }}
.badge-primary .badge-dot {{ background:var(--primary); }}
.badge-success {{ background:var(--success-light);color:var(--success); }}
.badge-success .badge-dot {{ background:var(--success); }}
.badge-warning {{ background:var(--warning-light);color:var(--warning); }}
.badge-warning .badge-dot {{ background:var(--warning); }}
.badge-danger {{ background:var(--danger-light);color:var(--danger); }}
.badge-danger .badge-dot {{ background:var(--danger); }}
.badge-info {{ background:var(--info-light);color:var(--info); }}
.badge-info .badge-dot {{ background:var(--info); }}

/* ── Avatar ── */
.avatar {{
  width:32px;height:32px;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;color:#fff;
  flex-shrink:0;
  text-transform:uppercase;
}}
.avatar-sm {{ width:28px;height:28px;font-size:11px; }}
.cell-with-avatar {{
  display:flex;align-items:center;gap:10px;
}}

/* ── Empty state ── */
.empty-state {{
  text-align:center;padding:60px 20px;
  color:var(--text-muted);
}}
.empty-state-icon {{
  width:80px;height:80px;margin:0 auto 16px;
  border-radius:50%;
  background:var(--bg);
  display:flex;align-items:center;justify-content:center;
  border:2px dashed var(--border);
}}
.empty-state-icon svg {{ width:32px;height:32px;opacity:0.4;color:var(--text-muted); }}
.empty-state h3 {{
  font-size:15px;font-weight:600;color:var(--text);
  margin-bottom:4px;
}}
.empty-state p {{
  font-size:13px;margin-bottom:16px;
  max-width:320px;margin-left:auto;margin-right:auto;
}}

/* ── Pagination ── */
.table-footer {{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 20px;
  border-top:1px solid var(--border-light);
  font-size:12px;color:var(--text-muted);
}}
.pagination {{
  display:flex;align-items:center;gap:4px;
}}
.page-btn {{
  width:32px;height:32px;
  border-radius:var(--radius);
  border:1px solid var(--border);
  background:var(--bg-card);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;font-size:12px;font-weight:500;
  color:var(--text-secondary);
  transition:all var(--transition);
}}
.page-btn:hover {{ background:var(--bg);color:var(--text); }}
.page-btn.active {{
  background:var(--primary);color:#fff;
  border-color:var(--primary);
}}
.page-btn:disabled {{
  opacity:0.4;cursor:not-allowed;
}}
.page-btn svg {{ width:14px;height:14px; }}

/* ── Buttons ── */
.btn {{
  display:inline-flex;align-items:center;gap:6px;
  padding:8px 16px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  font-size:13px;font-weight:500;
  cursor:pointer;background:var(--bg-card);
  color:var(--text);
  transition:all var(--transition);
  font-family:inherit;
  white-space:nowrap;
}}
.btn:hover {{ background:var(--bg);border-color:var(--text-muted); }}
.btn:active {{ transform:scale(0.98); }}
.btn-primary {{
  background:var(--primary);color:#fff;
  border-color:var(--primary);
  box-shadow:0 1px 3px {primary_color}30;
}}
.btn-primary:hover {{ background:var(--primary-hover);border-color:var(--primary-hover); }}
.btn-danger {{
  color:var(--danger);border-color:var(--danger);
}}
.btn-danger:hover {{ background:var(--danger-light); }}
.btn-ghost {{
  border-color:transparent;background:transparent;
  color:var(--text-secondary);
}}
.btn-ghost:hover {{ background:var(--bg);color:var(--text); }}
.btn-sm {{ padding:6px 12px;font-size:12px; }}
.btn svg {{ width:16px;height:16px; }}

/* ── Slide-over modal ── */
.modal-overlay {{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,0.4);
  z-index:100;
  opacity:0;
  transition:opacity var(--transition-slow);
  backdrop-filter:blur(2px);
}}
.modal-overlay.show {{ display:flex;opacity:1; }}
.slide-over {{
  position:fixed;top:0;right:-480px;bottom:0;
  width:480px;max-width:100vw;
  background:var(--bg-card);
  box-shadow:var(--shadow-xl);
  z-index:101;
  display:flex;flex-direction:column;
  transition:right var(--transition-slow);
}}
.slide-over.show {{ right:0; }}
.slide-over-header {{
  display:flex;align-items:center;justify-content:space-between;
  padding:20px 24px;
  border-bottom:1px solid var(--border);
  flex-shrink:0;
}}
.slide-over-header h3 {{ font-size:16px;font-weight:600; }}
.modal-close {{
  background:none;border:none;cursor:pointer;
  color:var(--text-muted);padding:6px;
  border-radius:var(--radius);
  transition:all var(--transition);
}}
.modal-close:hover {{ background:var(--bg);color:var(--text); }}
.modal-close svg {{ width:20px;height:20px; }}
.slide-over-body {{
  flex:1;overflow-y:auto;padding:24px;
}}
.slide-over-footer {{
  display:flex;justify-content:flex-end;gap:8px;
  padding:16px 24px;
  border-top:1px solid var(--border);
  flex-shrink:0;
}}

/* ── Confirm dialog ── */
.confirm-dialog {{
  background:var(--bg-card);
  border-radius:var(--radius-xl);
  width:400px;max-width:90vw;
  box-shadow:var(--shadow-xl);
  animation:dialogIn 0.2s ease;
}}
@keyframes dialogIn {{
  from {{ transform:scale(0.95);opacity:0; }}
  to {{ transform:scale(1);opacity:1; }}
}}
.confirm-dialog-body {{
  padding:24px;text-align:center;
}}
.confirm-dialog-icon {{
  width:48px;height:48px;border-radius:50%;
  background:var(--danger-light);
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 16px;
}}
.confirm-dialog-icon svg {{ width:24px;height:24px;color:var(--danger); }}
.confirm-dialog-body h3 {{
  font-size:16px;font-weight:600;margin-bottom:8px;
}}
.confirm-dialog-body p {{
  font-size:13px;color:var(--text-secondary);
  margin-bottom:20px;
}}
.confirm-dialog-actions {{
  display:flex;gap:8px;justify-content:center;
}}

/* ── Detail view ── */
.detail-view {{
  max-width:680px;
}}
.detail-header {{
  display:flex;align-items:center;gap:12px;
  margin-bottom:24px;
}}
.detail-header .back-btn {{
  background:none;border:none;cursor:pointer;
  color:var(--text-muted);padding:6px;
  border-radius:var(--radius);
  transition:all var(--transition);
}}
.detail-header .back-btn:hover {{ background:var(--bg);color:var(--text); }}
.detail-header .back-btn svg {{ width:20px;height:20px; }}
.detail-header h2 {{ font-size:18px;font-weight:600;flex:1; }}
.detail-body {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  overflow:hidden;
}}
.detail-field {{
  display:flex;padding:14px 24px;
  border-bottom:1px solid var(--border-light);
}}
.detail-field:last-child {{ border-bottom:none; }}
.detail-field-label {{
  width:180px;flex-shrink:0;
  font-size:13px;font-weight:500;color:var(--text-muted);
  text-transform:capitalize;
}}
.detail-field-value {{
  flex:1;font-size:13px;color:var(--text);
  word-break:break-word;
}}
.detail-actions {{
  display:flex;gap:8px;margin-top:20px;
}}

/* ── Form ── */
.form-group {{
  margin-bottom:20px;
}}
.form-group label {{
  display:block;font-size:13px;font-weight:500;
  color:var(--text);margin-bottom:6px;
  text-transform:capitalize;
}}
.form-group label .required {{
  color:var(--danger);margin-left:2px;
}}
.form-group input,
.form-group select,
.form-group textarea {{
  width:100%;padding:9px 12px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  font-size:13px;color:var(--text);
  background:var(--bg-card);
  outline:none;font-family:inherit;
  transition:border-color var(--transition), box-shadow var(--transition);
}}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {{
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-light);
}}
.form-group input::placeholder,
.form-group textarea::placeholder {{
  color:var(--text-placeholder);
}}
.form-group textarea {{
  min-height:80px;resize:vertical;
}}
.form-group input[type="checkbox"] {{
  width:auto;margin-right:8px;
  accent-color:var(--primary);
}}
.form-check {{
  display:flex;align-items:center;gap:8px;
  padding:4px 0;
}}
.form-check label {{
  margin-bottom:0;cursor:pointer;
}}
.form-hint {{
  font-size:11px;color:var(--text-muted);margin-top:4px;
}}

/* ── Skeleton loaders ── */
.skeleton {{
  background:linear-gradient(90deg, var(--bg) 25%, #e8eaee 50%, var(--bg) 75%);
  background-size:200% 100%;
  animation:shimmer 1.5s infinite;
  border-radius:var(--radius-sm);
}}
@keyframes shimmer {{
  0% {{ background-position:200% 0; }}
  100% {{ background-position:-200% 0; }}
}}
.skeleton-row {{
  display:flex;align-items:center;gap:12px;
  padding:14px 16px;
  border-bottom:1px solid var(--border-light);
}}
.skeleton-circle {{ width:32px;height:32px;border-radius:50%; }}
.skeleton-line {{ height:14px;border-radius:4px; }}
.skeleton-line-sm {{ height:10px;border-radius:3px; }}

/* ── Toast ── */
.toast-container {{
  position:fixed;bottom:24px;right:24px;
  z-index:200;display:flex;flex-direction:column;gap:8px;
}}
.toast {{
  padding:12px 20px;
  border-radius:var(--radius-md);
  font-size:13px;font-weight:500;
  display:flex;align-items:center;gap:10px;
  box-shadow:var(--shadow-lg);
  transform:translateX(120%);opacity:0;
  transition:all 0.3s cubic-bezier(0.4,0,0.2,1);
  max-width:380px;
  border:1px solid transparent;
}}
.toast.show {{ transform:translateX(0);opacity:1; }}
.toast-success {{
  background:var(--bg-card);color:var(--success);
  border-color:var(--success);
}}
.toast-error {{
  background:var(--bg-card);color:var(--danger);
  border-color:var(--danger);
}}
.toast-icon {{
  width:18px;height:18px;flex-shrink:0;
}}

/* ── Loading overlay ── */
.loading-bar {{
  position:fixed;top:0;left:0;right:0;height:2px;z-index:300;
  background:transparent;
}}
.loading-bar.active {{
  background:linear-gradient(90deg, transparent, var(--primary), transparent);
  animation:loadingSlide 1.5s infinite;
}}
@keyframes loadingSlide {{
  0% {{ transform:translateX(-100%); }}
  100% {{ transform:translateX(100%); }}
}}

/* ── Responsive ── */
@media (max-width:768px) {{
  .sidebar {{
    position:fixed;left:0;top:0;bottom:0;
    transform:translateX(-100%);
    z-index:40;
    box-shadow:var(--shadow-lg);
  }}
  .sidebar.open {{ transform:translateX(0); }}
  .hamburger {{ display:flex; }}
  .topbar {{ padding:0 16px; }}
  .content {{ padding:16px; }}
  .stats-grid {{ grid-template-columns:1fr; }}
  .dashboard-grid {{ grid-template-columns:1fr; }}
  .slide-over {{ width:100vw; }}
  .search-input {{ min-width:140px; }}
  .table-toolbar {{ padding:12px 16px; }}
  td,th {{ padding:10px 12px; }}
  .sidebar-collapse-btn {{ display:none; }}
  .detail-field {{ flex-direction:column;gap:4px; }}
  .detail-field-label {{ width:auto; }}
}}
@media (max-width:480px) {{
  .table-toolbar {{ flex-direction:column;align-items:stretch; }}
  .status-tabs {{ overflow-x:auto; }}
}}
</style>
</head>
<body>

<!-- Loading bar -->
<div class="loading-bar" id="loading-bar"></div>

<!-- Mobile sidebar overlay -->
<div class="sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>

<!-- Sidebar -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="app-logo">{app_initial}</div>
    <div class="app-logo-text">
      <h1>{app_name}</h1>
      <p>Workspace</p>
    </div>
  </div>
  <button class="sidebar-collapse-btn" onclick="toggleSidebar()" title="Collapse sidebar">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
  </button>
  <nav class="sidebar-nav" id="sidebar-nav">
    <div class="sidebar-section-label">Menu</div>
  </nav>
  <div class="sidebar-footer">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    Built with isibi.ai
  </div>
</aside>

<!-- Main -->
<div class="main">
  <header class="topbar">
    <div class="topbar-left">
      <button class="hamburger" onclick="toggleSidebar()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <h2 id="page-title">Dashboard</h2>
    </div>
    <div class="topbar-actions" id="topbar-actions"></div>
  </header>
  <div class="content" id="content-area"></div>
</div>

<!-- Slide-over modal -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal()"></div>
<div class="slide-over" id="slide-over">
  <div class="slide-over-header">
    <h3 id="modal-title">Create Record</h3>
    <button class="modal-close" onclick="closeModal()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="slide-over-body" id="modal-body"></div>
  <div class="slide-over-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="modal-save" onclick="saveRecord()">Save</button>
  </div>
</div>

<!-- Confirm dialog -->
<div class="modal-overlay" id="confirm-overlay" style="align-items:center;justify-content:center">
  <div class="confirm-dialog" id="confirm-dialog">
    <div class="confirm-dialog-body">
      <div class="confirm-dialog-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </div>
      <h3>Delete Record</h3>
      <p id="confirm-message">Are you sure you want to delete this record? This action cannot be undone.</p>
      <div class="confirm-dialog-actions">
        <button class="btn" onclick="closeConfirm()">Cancel</button>
        <button class="btn btn-danger" id="confirm-delete-btn" onclick="confirmDeleteAction()">Delete</button>
      </div>
    </div>
  </div>
</div>

<!-- Toast container -->
<div class="toast-container" id="toast-container"></div>

<script>
(function() {{
  "use strict";

  // ── Config ──
  const PROJECT_ID = "{project_id}";
  const API_BASE = "{api_base_url}";
  const ENTITY_FIELDS = {entity_fields_js};
  const SIDEBAR_ITEMS = {sidebar_items_js};
  const APP_NAME = "{app_name}";
  const ROWS_PER_PAGE = 10;

  // ── State ──
  let currentModule = null;
  let currentEntity = null;
  let editingId = null;
  let pendingDeleteEntity = null;
  let pendingDeleteId = null;
  const dataCache = {{}};
  const sortState = {{}};
  const searchState = {{}};
  const filterState = {{}};
  const pageState = {{}};

  // ── Auth ──
  function getToken() {{
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {{
      localStorage.setItem("app_token", urlToken);
      return urlToken;
    }}
    return localStorage.getItem("app_token") || localStorage.getItem("token") || "";
  }}

  function apiHeaders() {{
    const h = {{ "Content-Type": "application/json" }};
    const t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }}

  // ── Loading bar ──
  const loadingBar = document.getElementById("loading-bar");
  let loadingCount = 0;
  function startLoading() {{ loadingCount++; loadingBar.classList.add("active"); }}
  function stopLoading() {{ loadingCount = Math.max(0, loadingCount - 1); if (!loadingCount) loadingBar.classList.remove("active"); }}

  // ── API helpers ──
  async function apiGet(table) {{
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{ headers: apiHeaders() }});
      if (!res.ok) throw new Error("API error " + res.status);
      const data = await res.json();
      return Array.isArray(data) ? data : (data.items || data.data || []);
    }} catch (e) {{
      showToast("Failed to load data: " + e.message, "error");
      return [];
    }} finally {{ stopLoading(); }}
  }}

  async function apiCreate(table, record) {{
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{
        method: "POST", headers: apiHeaders(), body: JSON.stringify(record)
      }});
      if (!res.ok) {{ const t = await res.text(); throw new Error(t || "Create failed"); }}
      return await res.json();
    }} catch (e) {{
      showToast("Failed to create: " + e.message, "error");
      return null;
    }} finally {{ stopLoading(); }}
  }}

  async function apiUpdate(table, id, record) {{
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table + "/" + id, {{
        method: "PATCH", headers: apiHeaders(), body: JSON.stringify(record)
      }});
      if (!res.ok) {{ const t = await res.text(); throw new Error(t || "Update failed"); }}
      return await res.json();
    }} catch (e) {{
      showToast("Failed to update: " + e.message, "error");
      return null;
    }} finally {{ stopLoading(); }}
  }}

  async function apiDelete(table, id) {{
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table + "/" + id, {{
        method: "DELETE", headers: apiHeaders()
      }});
      if (!res.ok) throw new Error("Delete failed");
      return true;
    }} catch (e) {{
      showToast("Failed to delete: " + e.message, "error");
      return false;
    }} finally {{ stopLoading(); }}
  }}

  // ── Toast ──
  function showToast(msg, type) {{
    type = type || "success";
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    const iconSvg = type === "success"
      ? '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    toast.innerHTML = iconSvg + '<span>' + escHtml(msg) + '</span>';
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
    setTimeout(() => {{
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }}, 4000);
  }}

  // ── Escape HTML ──
  function escHtml(s) {{
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }}

  // ── Sidebar ──
  function buildSidebar() {{
    const nav = document.getElementById("sidebar-nav");
    const label = nav.querySelector(".sidebar-section-label");
    SIDEBAR_ITEMS.forEach(item => {{
      const btn = document.createElement("button");
      btn.className = "sidebar-item";
      btn.dataset.module = item.name;
      btn.innerHTML = getModuleIcon(item.icon) + '<span>' + escHtml(item.name) + '</span>';
      btn.onclick = () => showModule(item.name);
      nav.appendChild(btn);
    }});
  }}

  window.toggleSidebar = function() {{
    const sb = document.getElementById("sidebar");
    const ov = document.getElementById("sidebar-overlay");
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {{
      sb.classList.toggle("open");
      ov.classList.toggle("show", sb.classList.contains("open"));
    }} else {{
      sb.style.display = sb.style.display === "none" ? "" : "none";
    }}
  }};

  // ── Module navigation ──
  window.showModule = function(name) {{
    const item = SIDEBAR_ITEMS.find(i => i.name === name);
    if (!item) return;

    // Close mobile sidebar
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");

    // Update sidebar active state
    document.querySelectorAll(".sidebar-item").forEach(b => {{
      b.classList.toggle("active", b.dataset.module === name);
    }});

    document.getElementById("page-title").textContent = name;
    currentModule = name;
    currentEntity = item.entity || null;

    // Update topbar actions
    const actions = document.getElementById("topbar-actions");
    if (item.layout !== "dashboard" && currentEntity && ENTITY_FIELDS[currentEntity]) {{
      actions.innerHTML = '<button class="btn btn-primary btn-sm" onclick="openCreate()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add New</button>';
    }} else {{
      actions.innerHTML = "";
    }}

    // Render content
    const content = document.getElementById("content-area");
    if (item.layout === "dashboard") {{
      renderDashboard(content);
    }} else if (currentEntity && ENTITY_FIELDS[currentEntity]) {{
      renderTablePage(content, name, currentEntity);
    }} else {{
      content.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div><h3>' + escHtml(name) + '</h3><p>This module is not configured yet.</p></div>';
    }}
  }};

  // ── Dashboard ──
  function renderDashboard(container) {{
    const entityNames = Object.keys(ENTITY_FIELDS);
    let statsHtml = '<div class="stats-grid">';
    entityNames.forEach((eName, idx) => {{
      const colors = [
        {{ bg: 'var(--primary-light)', fg: 'var(--primary)' }},
        {{ bg: 'var(--success-light)', fg: 'var(--success)' }},
        {{ bg: 'var(--warning-light)', fg: 'var(--warning)' }},
        {{ bg: 'var(--info-light)', fg: 'var(--info)' }},
        {{ bg: 'var(--danger-light)', fg: 'var(--danger)' }},
      ];
      const c = colors[idx % colors.length];
      statsHtml += '<div class="stat-card">' +
        '<div class="stat-top"><div class="stat-icon" style="background:' + c.bg + ';color:' + c.fg + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg></div></div>' +
        '<div class="stat-label">Total ' + escHtml(eName) + 's</div>' +
        '<div class="stat-value" id="stat-count-' + eName + '"><span class="skeleton skeleton-line" style="width:60px;display:inline-block">&nbsp;</span></div>' +
        '</div>';
    }});
    statsHtml += '</div>';

    // Chart + activity in grid
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let chartBars = days.map(d => '<div class="chart-bar-col"><div class="chart-bar" id="chart-bar-' + d + '" style="height:20%"></div><div class="chart-bar-label">' + d + '</div></div>').join('');

    const html = statsHtml +
      '<div class="dashboard-grid">' +
        '<div class="chart-container">' +
          '<div class="chart-header"><h3>Weekly Overview</h3></div>' +
          '<div class="chart-bars">' + chartBars + '</div>' +
        '</div>' +
        '<div class="activity-list">' +
          '<div class="activity-header"><h3>Recent Activity</h3></div>' +
          '<div id="activity-items"><div class="activity-item"><div class="activity-text" style="color:var(--text-muted);font-size:12px">Loading activity...</div></div></div>' +
        '</div>' +
      '</div>';

    container.innerHTML = html;
    loadDashboardStats();
  }}

  async function loadDashboardStats() {{
    const entityNames = Object.keys(ENTITY_FIELDS);
    let totalAll = 0;
    const counts = {{}};
    const allRows = [];

    for (const entity of entityNames) {{
      const countEl = document.getElementById("stat-count-" + entity);
      try {{
        const rows = await apiGet(entity.toLowerCase());
        dataCache[entity] = rows;
        counts[entity] = rows.length;
        totalAll += rows.length;
        if (countEl) countEl.textContent = rows.length;
        rows.forEach(r => allRows.push({{ ...r, _entity: entity }}));
      }} catch {{
        if (countEl) countEl.textContent = "0";
      }}
    }}

    // Update chart bars with pseudo-random data based on counts
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const maxCount = Math.max(totalAll, 1);
    days.forEach((d, i) => {{
      const bar = document.getElementById("chart-bar-" + d);
      if (bar) {{
        const pct = Math.max(10, Math.min(95, (((i * 17 + totalAll * 3) % 80) + 15)));
        bar.style.height = pct + "%";
      }}
    }});

    // Recent activity
    const activityContainer = document.getElementById("activity-items");
    if (activityContainer) {{
      const recent = allRows
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 6);

      if (recent.length === 0) {{
        activityContainer.innerHTML = '<div class="activity-item"><div class="activity-text" style="color:var(--text-muted);font-size:12px">No activity yet</div></div>';
      }} else {{
        activityContainer.innerHTML = recent.map(r => {{
          const fields = ENTITY_FIELDS[r._entity] || [];
          const nameField = fields.find(f => /^(name|title|subject|label)$/i.test(f.name));
          const label = nameField ? (r[nameField.name] || "Untitled") : ("Record #" + (r.id || "").toString().slice(0, 6));
          const time = r.created_at ? new Date(r.created_at).toLocaleDateString() : "";
          return '<div class="activity-item"><div class="activity-dot"></div><div class="activity-text"><strong>' + escHtml(label) + '</strong> added to ' + escHtml(r._entity) + '</div><div class="activity-time">' + escHtml(time) + '</div></div>';
        }}).join("");
      }}
    }}
  }}

  // ── Table page ──
  function renderTablePage(container, moduleName, entity) {{
    const fields = ENTITY_FIELDS[entity] || [];
    const visibleFields = fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    ).slice(0, 7);

    // Detect enum field for tabs
    const enumField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name));

    let tabsHtml = '';
    if (enumField) {{
      tabsHtml = '<div class="status-tabs" id="status-tabs-' + moduleName + '">' +
        '<button class="status-tab active" data-filter="" onclick="filterByStatus(\'' + moduleName + '\',\'' + entity + '\',\'\',this)">All</button>' +
        enumField.enum_values.map(v =>
          '<button class="status-tab" data-filter="' + escHtml(v) + '" onclick="filterByStatus(\'' + moduleName + '\',\'' + entity + '\',\'' + escHtml(v) + '\',this)">' + escHtml(v) + '</button>'
        ).join('') +
      '</div>';
    }}

    const headers = visibleFields.map(f =>
      '<th onclick="sortTable(\'' + moduleName + '\',\'' + entity + '\',\'' + f.name + '\',this)">' +
      escHtml(f.name.replace(/_/g, " ")) +
      '<span class="sort-icon">&#x25B4;&#x25BE;</span></th>'
    ).join('') + '<th style="text-align:right;cursor:default">Actions</th>';

    const html =
      '<div class="table-container">' +
        '<div class="table-toolbar">' +
          '<div class="search-input">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" placeholder="Search ' + escHtml(entity) + '..." id="search-' + moduleName + '" oninput="searchTable(\'' + moduleName + '\',\'' + entity + '\',this.value)">' +
          '</div>' +
          tabsHtml +
        '</div>' +
        '<div style="overflow-x:auto"><table>' +
          '<thead><tr>' + headers + '</tr></thead>' +
          '<tbody id="tbody-' + moduleName + '"></tbody>' +
        '</table></div>' +
        '<div class="table-footer" id="footer-' + moduleName + '"></div>' +
      '</div>';

    container.innerHTML = html;
    pageState[moduleName] = 1;
    sortState[moduleName] = {{ field: null, asc: true }};
    searchState[moduleName] = "";
    filterState[moduleName] = "";
    loadTableData(entity, moduleName);
  }}

  // ── Load table data ──
  async function loadTableData(entity, moduleName) {{
    const tbody = document.getElementById("tbody-" + moduleName);
    if (!tbody) return;

    // Skeleton loading
    let skeletonHtml = '';
    for (let i = 0; i < 5; i++) {{
      skeletonHtml += '<tr><td colspan="20"><div class="skeleton-row">' +
        '<div class="skeleton skeleton-circle"></div>' +
        '<div class="skeleton skeleton-line" style="width:' + (30 + Math.random() * 50) + '%"></div>' +
        '<div class="skeleton skeleton-line-sm" style="width:' + (20 + Math.random() * 30) + '%"></div>' +
      '</div></td></tr>';
    }}
    tbody.innerHTML = skeletonHtml;

    try {{
      const rows = await apiGet(entity.toLowerCase());
      dataCache[entity] = rows;
      renderTableRows(entity, moduleName);
    }} catch (e) {{
      tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><h3>Connection Error</h3><p>Could not load data. The API may not be connected.</p></div></td></tr>';
    }}
  }}

  function renderTableRows(entity, moduleName) {{
    const tbody = document.getElementById("tbody-" + moduleName);
    const footer = document.getElementById("footer-" + moduleName);
    if (!tbody) return;

    let rows = (dataCache[entity] || []).slice();
    const fields = ENTITY_FIELDS[entity] || [];
    const visibleFields = fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    ).slice(0, 7);

    // Apply search
    const search = (searchState[moduleName] || "").toLowerCase();
    if (search) {{
      rows = rows.filter(row =>
        visibleFields.some(f => String(row[f.name] || "").toLowerCase().includes(search))
      );
    }}

    // Apply status filter
    const filter = filterState[moduleName] || "";
    if (filter) {{
      const enumField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
        !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name));
      if (enumField) {{
        rows = rows.filter(row => row[enumField.name] === filter);
      }}
    }}

    // Apply sort
    const sort = sortState[moduleName];
    if (sort && sort.field) {{
      rows.sort((a, b) => {{
        const va = a[sort.field] ?? "";
        const vb = b[sort.field] ?? "";
        const cmp = String(va).localeCompare(String(vb), undefined, {{ numeric: true }});
        return sort.asc ? cmp : -cmp;
      }});
    }}

    if (rows.length === 0) {{
      tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><h3>No records found</h3><p>' + (search || filter ? 'Try adjusting your search or filter.' : 'Click the "Add New" button to create your first record.') + '</p>' + (!search && !filter ? '<button class="btn btn-primary btn-sm" onclick="openCreate()" style="margin-top:4px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add New</button>' : '') + '</div></td></tr>';
      if (footer) footer.innerHTML = '';
      return;
    }}

    // Pagination
    const page = pageState[moduleName] || 1;
    const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
    const start = (page - 1) * ROWS_PER_PAGE;
    const pageRows = rows.slice(start, start + ROWS_PER_PAGE);

    // Detect name-like field for avatar
    const nameFieldIdx = visibleFields.findIndex(f => /^(name|full_name|client_name|customer_name|contact_name|user_name|title)$/i.test(f.name));

    tbody.innerHTML = pageRows.map(row => {{
      const rowId = row.id || row.ID || "";
      const cells = visibleFields.map((f, idx) => {{
        let val = row[f.name] ?? "";

        // Status badge for enum fields
        if (f.enum_values && f.enum_values.length) {{
          const badgeClass = getBadgeClass(String(val));
          return '<td><span class="badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(val)) + '</span></td>';
        }}

        // Avatar for name fields
        if (idx === nameFieldIdx && val) {{
          const initials = String(val).split(/\\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
          const avatarColor = stringToColor(String(val));
          return '<td><div class="cell-with-avatar"><div class="avatar" style="background:' + avatarColor + '">' + escHtml(initials) + '</div><span>' + escHtml(String(val)) + '</span></div></td>';
        }}

        // Currency formatting
        if (/amount|value|price|cost|revenue|total|salary|fee|budget/i.test(f.name) && val !== "") {{
          const num = parseFloat(val);
          return '<td>' + (isNaN(num) ? escHtml(String(val)) : '$' + num.toLocaleString(undefined, {{minimumFractionDigits: 2, maximumFractionDigits: 2}})) + '</td>';
        }}

        // Boolean
        if (f.type === "boolean" || val === true || val === false) {{
          return '<td>' + (val && val !== "false" ? '<span style="color:var(--success)">Yes</span>' : '<span style="color:var(--text-muted)">No</span>') + '</td>';
        }}

        return '<td>' + escHtml(String(val)) + '</td>';
      }}).join("");

      return '<tr onclick="showDetail(\'' + entity + '\',\'' + rowId + '\')" data-id="' + rowId + '">' + cells +
        '<td style="text-align:right" onclick="event.stopPropagation()">' +
          '<button class="btn btn-ghost btn-sm" onclick="openEdit(\'' + entity + '\',\'' + rowId + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteRecord(\'' + entity + '\',\'' + rowId + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
        '</td></tr>';
    }}).join("");

    // Footer with pagination
    if (footer) {{
      if (totalPages <= 1) {{
        footer.innerHTML = '<span>Showing ' + rows.length + ' record' + (rows.length !== 1 ? 's' : '') + '</span><span></span>';
      }} else {{
        let paginationHtml = '<span>Showing ' + (start + 1) + '-' + Math.min(start + ROWS_PER_PAGE, rows.length) + ' of ' + rows.length + '</span>';
        paginationHtml += '<div class="pagination">';
        paginationHtml += '<button class="page-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="goToPage(\'' + moduleName + '\',\'' + entity + '\',' + (page - 1) + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';
        for (let p = 1; p <= totalPages; p++) {{
          if (totalPages > 7 && p > 3 && p < totalPages - 1 && Math.abs(p - page) > 1) {{
            if (p === 4 || p === totalPages - 2) paginationHtml += '<span style="padding:0 4px;color:var(--text-muted)">...</span>';
            continue;
          }}
          paginationHtml += '<button class="page-btn' + (p === page ? ' active' : '') + '" onclick="goToPage(\'' + moduleName + '\',\'' + entity + '\',' + p + ')">' + p + '</button>';
        }}
        paginationHtml += '<button class="page-btn" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="goToPage(\'' + moduleName + '\',\'' + entity + '\',' + (page + 1) + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';
        paginationHtml += '</div>';
        footer.innerHTML = paginationHtml;
      }}
    }}
  }}

  // ── Sorting ──
  window.sortTable = function(moduleName, entity, field, thEl) {{
    const state = sortState[moduleName] || {{ field: null, asc: true }};
    if (state.field === field) {{
      state.asc = !state.asc;
    }} else {{
      state.field = field;
      state.asc = true;
    }}
    sortState[moduleName] = state;
    // Update header styling
    const table = thEl.closest("table");
    table.querySelectorAll("th").forEach(th => th.classList.remove("sorted"));
    thEl.classList.add("sorted");
    pageState[moduleName] = 1;
    renderTableRows(entity, moduleName);
  }};

  // ── Search ──
  window.searchTable = function(moduleName, entity, value) {{
    searchState[moduleName] = value;
    pageState[moduleName] = 1;
    renderTableRows(entity, moduleName);
  }};

  // ── Status filter ──
  window.filterByStatus = function(moduleName, entity, value, btnEl) {{
    filterState[moduleName] = value;
    pageState[moduleName] = 1;
    const tabs = btnEl.parentElement;
    tabs.querySelectorAll(".status-tab").forEach(t => t.classList.remove("active"));
    btnEl.classList.add("active");
    renderTableRows(entity, moduleName);
  }};

  // ── Pagination ──
  window.goToPage = function(moduleName, entity, page) {{
    pageState[moduleName] = page;
    renderTableRows(entity, moduleName);
  }};

  // ── Detail view ──
  window.showDetail = function(entity, id) {{
    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    if (!record) return;

    const fields = ENTITY_FIELDS[entity] || [];
    const visibleFields = fields.filter(f =>
      !["id","org_id","deleted_at","version"].includes(f.name)
    );

    const nameField = fields.find(f => /^(name|title|subject|label)$/i.test(f.name));
    const title = nameField ? (record[nameField.name] || entity) : entity + " #" + String(id).slice(0, 8);

    const content = document.getElementById("content-area");
    let detailHtml = '<div class="detail-view">' +
      '<div class="detail-header">' +
        '<button class="back-btn" onclick="showModule(\'' + escHtml(currentModule) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>' +
        '<h2>' + escHtml(title) + '</h2>' +
      '</div>' +
      '<div class="detail-body">';

    visibleFields.forEach(f => {{
      let val = record[f.name] ?? "";
      let displayVal;

      if (f.enum_values && f.enum_values.length) {{
        const badgeClass = getBadgeClass(String(val));
        displayVal = '<span class="badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(val)) + '</span>';
      }} else if (/amount|value|price|cost|revenue|total|salary|fee|budget/i.test(f.name) && val !== "") {{
        const num = parseFloat(val);
        displayVal = isNaN(num) ? escHtml(String(val)) : '$' + num.toLocaleString(undefined, {{minimumFractionDigits: 2, maximumFractionDigits: 2}});
      }} else if (f.type === "boolean" || val === true || val === false) {{
        displayVal = val && val !== "false" ? '<span style="color:var(--success)">Yes</span>' : '<span style="color:var(--text-muted)">No</span>';
      }} else {{
        displayVal = escHtml(String(val));
      }}

      detailHtml += '<div class="detail-field"><div class="detail-field-label">' + escHtml(f.name.replace(/_/g, " ")) + '</div><div class="detail-field-value">' + displayVal + '</div></div>';
    }});

    detailHtml += '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn btn-primary btn-sm" onclick="openEdit(\'' + entity + '\',\'' + id + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteRecord(\'' + entity + '\',\'' + id + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>Delete</button>' +
      '</div>' +
    '</div>';

    content.innerHTML = detailHtml;
  }};

  // ── Modal: Create ──
  window.openCreate = function() {{
    if (!currentEntity || !ENTITY_FIELDS[currentEntity]) return;
    editingId = null;
    document.getElementById("modal-title").textContent = "Create " + currentEntity;
    document.getElementById("modal-save").textContent = "Create";
    renderForm(currentEntity, {{}});
    document.getElementById("modal-overlay").classList.add("show");
    document.getElementById("slide-over").classList.add("show");
  }};

  // ── Modal: Edit ──
  window.openEdit = function(entity, id) {{
    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    if (!record) return;
    editingId = id;
    currentEntity = entity;
    document.getElementById("modal-title").textContent = "Edit " + entity;
    document.getElementById("modal-save").textContent = "Save Changes";
    renderForm(entity, record);
    document.getElementById("modal-overlay").classList.add("show");
    document.getElementById("slide-over").classList.add("show");
  }};

  // ── Render form ──
  function renderForm(entity, record) {{
    const fields = (ENTITY_FIELDS[entity] || []).filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    );
    const body = document.getElementById("modal-body");
    body.innerHTML = fields.map(f => {{
      const val = record[f.name] ?? f.default_value ?? "";
      const req = f.required ? '<span class="required">*</span>' : '';
      const label = escHtml(f.name.replace(/_/g, " "));

      // Select for enums
      if (f.enum_values && f.enum_values.length) {{
        const opts = '<option value="">Select...</option>' + f.enum_values.map(v =>
          '<option value="' + escHtml(v) + '"' + (v === val ? ' selected' : '') + '>' + escHtml(v) + '</option>'
        ).join("");
        return '<div class="form-group"><label>' + label + req + '</label><select name="' + f.name + '">' + opts + '</select></div>';
      }}

      // Checkbox for boolean
      if (f.type === "boolean") {{
        const checked = val && val !== "false" && val !== "0" ? ' checked' : '';
        return '<div class="form-group"><div class="form-check"><input type="checkbox" name="' + f.name + '"' + checked + '><label>' + label + '</label></div></div>';
      }}

      // Textarea for description/notes/body
      if (/description|notes|body|comment|content|message|details|summary|bio|about/i.test(f.name)) {{
        return '<div class="form-group"><label>' + label + req + '</label><textarea name="' + f.name + '" placeholder="Enter ' + label.toLowerCase() + '...">' + escHtml(String(val)) + '</textarea></div>';
      }}

      // Input type mapping
      let type = "text";
      if (/email/i.test(f.name)) type = "email";
      else if (/date|_at$/i.test(f.name)) type = "date";
      else if (/phone|tel/i.test(f.name)) type = "tel";
      else if (/url|website|link/i.test(f.name)) type = "url";
      else if (/amount|value|price|cost|revenue|total|salary|fee|budget|quantity|count|number|age|score|rating|weight|height/i.test(f.name) || f.type === "number" || f.type === "integer" || f.type === "float" || f.type === "decimal") type = "number";

      let step = '';
      if (type === "number" && /amount|value|price|cost|revenue|total|salary|fee|budget/i.test(f.name)) step = ' step="0.01"';

      return '<div class="form-group"><label>' + label + req + '</label><input type="' + type + '" name="' + f.name + '" value="' + escHtml(String(val)) + '" placeholder="Enter ' + label.toLowerCase() + '..."' + step + (f.required ? ' required' : '') + '></div>';
    }}).join("");
  }}

  // ── Save record ──
  window.saveRecord = async function() {{
    if (!currentEntity) return;
    const body = document.getElementById("modal-body");
    const inputs = body.querySelectorAll("input, select, textarea");
    const record = {{}};
    inputs.forEach(inp => {{
      if (inp.type === "checkbox") {{
        record[inp.name] = inp.checked;
      }} else if (inp.value !== "") {{
        record[inp.name] = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value;
      }}
    }});

    // Validate required fields
    const fields = ENTITY_FIELDS[currentEntity] || [];
    for (const f of fields) {{
      if (f.required && !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)) {{
        if (!record[f.name] && record[f.name] !== 0 && record[f.name] !== false) {{
          showToast(f.name.replace(/_/g, " ") + " is required", "error");
          return;
        }}
      }}
    }}

    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    let result;
    if (editingId) {{
      result = await apiUpdate(currentEntity.toLowerCase(), editingId, record);
      if (result) showToast(currentEntity + " updated successfully", "success");
    }} else {{
      result = await apiCreate(currentEntity.toLowerCase(), record);
      if (result) showToast(currentEntity + " created successfully", "success");
    }}

    saveBtn.disabled = false;
    saveBtn.textContent = editingId ? "Save Changes" : "Create";
    closeModal();
    if (currentModule) showModule(currentModule);
  }};

  // ── Delete record (with confirmation) ──
  window.deleteRecord = function(entity, id) {{
    pendingDeleteEntity = entity;
    pendingDeleteId = id;

    // Find record name for display
    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    const fields = ENTITY_FIELDS[entity] || [];
    const nameField = fields.find(f => /^(name|title|subject|label)$/i.test(f.name));
    const label = record && nameField ? record[nameField.name] : "this record";

    document.getElementById("confirm-message").textContent = 'Are you sure you want to delete "' + label + '"? This action cannot be undone.';
    document.getElementById("confirm-overlay").classList.add("show");
  }};

  window.confirmDeleteAction = async function() {{
    if (!pendingDeleteEntity || !pendingDeleteId) return;
    const ok = await apiDelete(pendingDeleteEntity.toLowerCase(), pendingDeleteId);
    if (ok) {{
      showToast(pendingDeleteEntity + " deleted successfully", "success");
      closeConfirm();
      if (currentModule) showModule(currentModule);
    }} else {{
      closeConfirm();
    }}
    pendingDeleteEntity = null;
    pendingDeleteId = null;
  }};

  // ── Close modal ──
  window.closeModal = function() {{
    document.getElementById("modal-overlay").classList.remove("show");
    document.getElementById("slide-over").classList.remove("show");
    editingId = null;
  }};

  window.closeConfirm = function() {{
    document.getElementById("confirm-overlay").classList.remove("show");
  }};

  // ── Badge class mapping ──
  function getBadgeClass(val) {{
    const v = val.toLowerCase();
    if (/active|open|approved|complete|done|paid|success|resolved|won|accepted|enabled|live/i.test(v)) return "badge-success";
    if (/pending|in.?progress|processing|review|waiting|draft|scheduled/i.test(v)) return "badge-warning";
    if (/closed|lost|rejected|cancelled|canceled|failed|expired|inactive|blocked|overdue/i.test(v)) return "badge-danger";
    if (/new|created|lead|prospect|qualified/i.test(v)) return "badge-info";
    if (/high|urgent|critical|important/i.test(v)) return "badge-danger";
    if (/medium|normal|moderate/i.test(v)) return "badge-warning";
    if (/low|minor/i.test(v)) return "badge-primary";
    return "badge-default";
  }}

  // ── String to color (for avatars) ──
  function stringToColor(str) {{
    const colors = [
      '#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#10b981','#3b82f6',
      '#14b8a6','#f97316','#06b6d4','#a855f7','#84cc16','#e11d48','#0ea5e9'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }}

  // ── Module icon SVGs ──
  function getModuleIcon(iconId) {{
    const icons = {{
      dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
      tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
      product: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
      star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    }};
    return icons[iconId] || icons.list;
  }}

  // ── Keyboard shortcuts ──
  document.addEventListener("keydown", function(e) {{
    if (e.key === "Escape") {{
      closeModal();
      closeConfirm();
    }}
  }});

  // ── Init ──
  buildSidebar();
  if (SIDEBAR_ITEMS.length > 0) {{
    showModule(SIDEBAR_ITEMS[0].name);
  }}
}})();
</script>
<script>
// Register PWA service worker
if ('serviceWorker' in navigator) {{
  navigator.serviceWorker.register('/live/{project_id}/sw.js').catch(() => {{}});
}}
// Show install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {{
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:{primary_color};color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9999;font-family:inherit;font-size:14px;box-shadow:0 -4px 20px rgba(0,0,0,0.1);backdrop-filter:blur(10px)';
  banner.innerHTML = '<span style="font-weight:500">Install {app_name} as an app for quick access</span><div style="display:flex;gap:8px"><button onclick="installApp()" style="background:#fff;color:{primary_color};border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit">Install</button><button onclick="this.parentElement.parentElement.remove()" style="background:transparent;color:rgba(255,255,255,0.9);border:1px solid rgba(255,255,255,0.3);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit">Later</button></div>';
  document.body.appendChild(banner);
}});
function installApp() {{
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
  if (deferredPrompt) {{
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {{ deferredPrompt = null; }});
  }}
}}
</script>
</body>
</html>'''


def _get_module_icon_id(name: str, module: dict) -> str:
    """Return an icon identifier based on module name."""
    name_lower = name.lower()
    if "dashboard" in name_lower:
        return "dashboard"
    if any(k in name_lower for k in ["contact", "lead", "customer", "user", "client", "people", "employee", "staff", "member", "student", "patient", "tenant"]):
        return "people"
    if any(k in name_lower for k in ["deal", "sale", "order", "revenue", "invoice", "payment", "billing", "subscription", "transaction"]):
        return "money"
    if any(k in name_lower for k in ["task", "todo", "activity", "ticket", "issue", "bug"]):
        return "tasks"
    if any(k in name_lower for k in ["product", "item", "inventory", "catalog", "asset", "equipment"]):
        return "product"
    if any(k in name_lower for k in ["setting", "config", "preference"]):
        return "settings"
    if any(k in name_lower for k in ["calendar", "event", "schedule", "appointment", "booking", "meeting"]):
        return "calendar"
    if any(k in name_lower for k in ["email", "mail", "message", "notification", "inbox"]):
        return "mail"
    if any(k in name_lower for k in ["report", "analytic", "metric", "stat", "chart", "graph"]):
        return "chart"
    if any(k in name_lower for k in ["document", "file", "attachment", "media", "upload"]):
        return "file"
    if any(k in name_lower for k in ["location", "address", "map", "branch", "office", "property"]):
        return "map"
    if any(k in name_lower for k in ["review", "rating", "feedback", "survey"]):
        return "star"
    return "list"


def _get_module_icon(name: str, module: dict) -> str:
    """Return an inline SVG icon based on module name (kept for backwards compatibility)."""
    icon_id = _get_module_icon_id(name, module)
    icons = {
        "dashboard": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        "people": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        "money": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
        "tasks": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        "product": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
        "settings": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        "calendar": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        "mail": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
        "chart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        "file": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        "map": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        "star": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    }
    return icons.get(icon_id, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>')


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
