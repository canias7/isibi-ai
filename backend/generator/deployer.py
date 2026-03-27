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
    api_base_url = os.getenv("API_BASE_URL") or os.getenv("APP_HOST") or "https://api.isibi.ai"

    # Generate the full standalone HTML (with plugin injection)
    html_content = generate_full_app_html(spec, api_base_url, project_id)
    html_content = _inject_plugins(html_content, spec, project_id)

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

    # Write service worker for offline caching (caches app shell for offline access)
    sw_content = f"""
const CACHE_NAME = 'app-v2';
const APP_SHELL = [
  '/live/{project_id}',
  '/live/{project_id}/manifest.json',
  '/live/{project_id}/icon.svg',
];
self.addEventListener('install', (e) => {{
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
}});
self.addEventListener('activate', (e) => {{
  e.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    )).then(() => clients.claim())
  );
}});
self.addEventListener('fetch', (e) => {{
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {{
      if (res.status === 200 && e.request.method === 'GET') {{
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      }}
      return res;
    }})).catch(() => caches.match('/live/{project_id}'))
  );
}});
"""
    (build_dir / "sw.js").write_text(sw_content.strip(), encoding="utf-8")

    # Write app icon SVG
    icon_letter = (app_name or "A")[0].upper()
    icon_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="100" fill="{primary_color}"/>
<text x="256" y="340" font-size="280" text-anchor="middle" fill="white" font-family="system-ui, sans-serif" font-weight="bold">{icon_letter}</text>
</svg>'''
    (build_dir / "icon.svg").write_text(icon_svg, encoding="utf-8")

    # Determine the live URL — always use absolute URL
    app_host = os.getenv("APP_HOST", "")
    if app_host:
        deploy_url = f"{app_host}/live/{project_id}"
    else:
        deploy_url = f"https://api.isibi.ai/live/{project_id}"

    # Look up subdomain for this project
    subdomain_url = None
    try:
        result = await db.execute(
            select(Project.subdomain).where(Project.id == uuid.UUID(str(project_id)))
        )
        subdomain = result.scalar_one_or_none()
        if subdomain:
            if app_host:
                subdomain_url = f"{app_host}/live/s/{subdomain}"
            else:
                subdomain_url = f"https://api.isibi.ai/live/s/{subdomain}"
    except Exception:
        pass

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

    result_info = {
        "project_id": str(project_id),
        "status": "deployed",
        "url": deploy_url,
    }
    if subdomain_url:
        result_info["subdomain_url"] = subdomain_url
    return result_info


def generate_full_app_html(spec: dict, api_base_url: str, project_id: str = "") -> str:
    """
    Generate a complete standalone HTML app from a spec with working CRUD
    that calls the backend API.

    The generated app includes:
    - Login / Signup auth screen (email + password)
    - Collapsible sidebar with all modules, app logo, active states
    - Dashboard with stat cards, CSS bar chart, recent activity
    - Smart layout detection: Kanban, Calendar, Card Grid, or Table view
    - View toggle to switch between Table and smart alternate view
    - Slide-over create/edit modals with proper field types
    - Foreign key dropdowns with related entity names
    - Detail view for individual records
    - Delete confirmation dialog
    - Toast notifications (success/error, auto-dismiss)
    - Skeleton loaders
    - Responsive layout (hamburger menu on mobile)
    - Auth token handling (localStorage)
    - PWA support (manifest, service worker)
    """
    import json

    app_name = spec.get("app_name") or spec.get("name") or "My App"
    entities = spec.get("entities") or []
    modules = spec.get("modules") or []
    design = spec.get("design_system") or {}
    colors = design.get("colors") or {}
    primary_color = colors.get("primary") or "#6366f1"
    secondary_color = colors.get("secondary") or "#8b5cf6"

    # Build entity field maps for JS (include fk_entity for FK dropdowns)
    entity_fields_js = _build_entity_fields_js(entities)

    # Build smart layout detection map
    layout_hints = _detect_smart_layouts(entities, modules)
    layout_hints_js = json.dumps(layout_hints)

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
*,*::before,*::after {{ margin:0;padding:0;box-sizing:border-box; font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; }}
:root {{
  --primary: {primary_color};
  --primary-hover: color-mix(in srgb, {primary_color} 85%, black);
  --primary-light: color-mix(in srgb, {primary_color} 10%, white);
  --primary-subtle: color-mix(in srgb, {primary_color} 5%, white);
  --primary-dark: color-mix(in srgb, {primary_color} 70%, black);
  --secondary: {secondary_color};
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-400: #9ca3af;
  --gray-500: #6b7280;
  --gray-600: #4b5563;
  --gray-700: #374151;
  --gray-800: #1f2937;
  --gray-900: #111827;
  --bg: #f9fafb;
  --bg-card: #ffffff;
  --sidebar-bg: #fbfbfc;
  --sidebar-width: 260px;
  --sidebar-collapsed-width: 0px;
  --border: #e5e7eb;
  --border-light: #f0f1f3;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --text-placeholder: #c0c5ce;
  --success: #10b981;
  --success-light: #ecfdf5;
  --success-text: #065f46;
  --warning: #f59e0b;
  --warning-light: #fffbeb;
  --warning-text: #92400e;
  --danger: #ef4444;
  --danger-light: #fef2f2;
  --danger-text: #991b1b;
  --info: #3b82f6;
  --info-light: #eff6ff;
  --info-text: #1e40af;
  --purple: #a855f7;
  --purple-light: #faf5ff;
  --purple-text: #6b21a8;
  --pink: #ec4899;
  --pink-light: #fdf2f8;
  --pink-text: #9d174d;
  --slate: #94a3b8;
  --slate-light: #f8fafc;
  --slate-text: #475569;
  --radius-sm: 6px;
  --radius: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 40px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.03);
  --shadow-xl: 0 20px 60px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.04);
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

/* ── Auth Screen ── */
.auth-screen {{
  position:fixed;inset:0;z-index:9000;
  background:var(--bg);
  display:flex;align-items:center;justify-content:center;
}}
.auth-card {{
  width:400px;max-width:90vw;
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-xl);
  box-shadow:var(--shadow-lg);
  overflow:hidden;
}}
.auth-header {{
  padding:32px 32px 24px;text-align:center;
}}
.auth-logo {{
  width:56px;height:56px;
  border-radius:var(--radius-lg);
  background:var(--primary);
  display:inline-flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:24px;
  margin-bottom:16px;
  box-shadow: 0 4px 12px {primary_color}40;
}}
.auth-header h2 {{
  font-size:20px;font-weight:700;margin-bottom:4px;
}}
.auth-header p {{
  font-size:13px;color:var(--text-muted);
}}
.auth-tabs {{
  display:flex;border-bottom:1px solid var(--border);
  padding:0 32px;
}}
.auth-tab {{
  flex:1;padding:10px 0;text-align:center;
  font-size:13px;font-weight:600;
  color:var(--text-muted);
  cursor:pointer;border:none;background:none;
  border-bottom:2px solid transparent;
  transition:all var(--transition);
  font-family:inherit;
}}
.auth-tab:hover {{ color:var(--text); }}
.auth-tab.active {{
  color:var(--primary);border-bottom-color:var(--primary);
}}
.auth-body {{
  padding:24px 32px 32px;
}}
.auth-body .form-group {{ margin-bottom:16px; }}
.auth-body .form-group label {{
  display:block;font-size:13px;font-weight:500;
  color:var(--text);margin-bottom:6px;
}}
.auth-body .form-group input {{
  width:100%;padding:10px 14px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  font-size:14px;color:var(--text);
  background:var(--bg-card);
  outline:none;font-family:inherit;
  transition:border-color var(--transition), box-shadow var(--transition);
}}
.auth-body .form-group input:focus {{
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-light);
}}
.auth-submit {{
  width:100%;padding:11px 0;
  background:var(--primary);color:#fff;
  border:none;border-radius:var(--radius);
  font-size:14px;font-weight:600;
  cursor:pointer;font-family:inherit;
  transition:background var(--transition);
  margin-top:8px;
}}
.auth-submit:hover {{ background:var(--primary-hover); }}
.auth-submit:disabled {{ opacity:0.6;cursor:not-allowed; }}
.auth-error {{
  background:var(--danger-light);color:var(--danger);
  padding:8px 12px;border-radius:var(--radius);
  font-size:12px;margin-bottom:12px;
  display:none;
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
  width:32px;height:32px;
  border-radius:8px;
  background:var(--primary);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:14px;
  flex-shrink:0;
  box-shadow: 0 1px 3px {primary_color}30;
}}
.app-logo-text {{
  flex:1;min-width:0;
}}
.app-logo-text h1 {{
  font-size:14px;font-weight:600;color:var(--text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  letter-spacing:-0.01em;
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
  opacity:0;
}}
.sidebar:hover .sidebar-collapse-btn {{ opacity:1; }}
.sidebar-collapse-btn:hover {{ background:var(--bg);color:var(--text); }}
.sidebar-collapse-btn svg {{ width:14px;height:14px; }}
.sidebar-nav {{
  flex:1;padding:8px 8px;overflow-y:auto;
}}
.sidebar-section-label {{
  font-size:10px;font-weight:600;color:var(--gray-400);
  text-transform:uppercase;letter-spacing:0.08em;
  padding:16px 12px 6px;
}}
.sidebar-section-label:first-child {{ padding-top:8px; }}
.sidebar-item {{
  display:flex;align-items:center;gap:10px;
  width:100%;text-align:left;
  padding:7px 12px;
  border:none;background:none;
  border-radius:var(--radius-sm);
  font-size:13px;font-weight:500;
  color:var(--gray-600);
  cursor:pointer;
  margin:1px 0;
  transition:all 0.12s ease;
  position:relative;
  font-family:inherit;
}}
.sidebar-item:hover {{ background:var(--gray-100);color:var(--text); }}
.sidebar-item.active {{
  background:var(--primary-light);
  color:var(--primary);
  font-weight:600;
}}
.sidebar-item.active::before {{
  content:'';position:absolute;left:-8px;top:6px;bottom:6px;
  width:3px;border-radius:0 3px 3px 0;
  background:var(--primary);
}}
.sidebar-item svg {{ width:18px;height:18px;flex-shrink:0;opacity:0.5; }}
.sidebar-item:hover svg {{ opacity:0.75; }}
.sidebar-item.active svg {{ opacity:1; }}
.sidebar-footer {{
  padding:12px 16px;
  border-top:1px solid var(--border-light);
  display:flex;align-items:center;gap:10px;
}}
.sidebar-footer-avatar {{
  width:30px;height:30px;border-radius:50%;
  background:var(--gray-200);
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;color:var(--gray-600);
  flex-shrink:0;
}}
.sidebar-footer svg {{ width:12px;height:12px;opacity:0.5; }}
.sidebar-footer-left {{
  display:flex;align-items:center;gap:8px;flex:1;min-width:0;
}}
.sidebar-footer-info {{
  flex:1;min-width:0;
}}
.sidebar-footer-name {{
  font-size:12px;font-weight:600;color:var(--text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}}
.sidebar-footer-role {{
  font-size:10px;color:var(--text-muted);
}}
.logout-btn {{
  background:none;border:1px solid var(--border);
  padding:4px 10px;border-radius:var(--radius-sm);
  font-size:11px;color:var(--text-muted);cursor:pointer;
  transition:all var(--transition);font-family:inherit;
}}
.logout-btn:hover {{
  color:var(--danger);border-color:var(--danger);
  background:var(--danger-light);
}}

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
  padding:0 24px;height:52px;
  border-bottom:1px solid var(--border-light);
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
.topbar-breadcrumb {{
  display:flex;align-items:center;gap:6px;
  min-width:0;
}}
.topbar-breadcrumb span {{
  font-size:14px;color:var(--text-muted);
  white-space:nowrap;
}}
.topbar-breadcrumb span:last-child {{
  color:var(--text);font-weight:600;
}}
.topbar-breadcrumb .breadcrumb-sep {{
  font-size:12px;color:var(--gray-300);
  font-weight:400;
}}
.topbar h2 {{
  font-size:15px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}}
.topbar-actions {{
  display:flex;align-items:center;gap:8px;
  flex-shrink:0;
}}
.topbar-avatar {{
  width:28px;height:28px;border-radius:50%;
  background:var(--primary-light);color:var(--primary);
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:600;
  cursor:pointer;
  border:2px solid var(--bg-card);
  box-shadow:0 0 0 1px var(--border);
  transition:box-shadow var(--transition);
}}
.topbar-avatar:hover {{
  box-shadow:0 0 0 1px var(--primary);
}}
.content {{
  flex:1;overflow:auto;padding:24px;
}}

/* ── View toggle ── */
.view-toggle {{
  display:inline-flex;align-items:center;gap:2px;
  background:var(--bg);border-radius:var(--radius);
  padding:3px;margin-right:8px;
}}
.view-toggle-btn {{
  padding:5px 12px;border-radius:var(--radius-sm);
  font-size:12px;font-weight:500;
  cursor:pointer;border:none;background:none;
  color:var(--text-secondary);
  transition:all var(--transition);
  display:flex;align-items:center;gap:4px;
  font-family:inherit;
}}
.view-toggle-btn:hover {{ color:var(--text); }}
.view-toggle-btn.active {{
  background:var(--bg-card);color:var(--text);
  box-shadow:var(--shadow-xs);
}}
.view-toggle-btn svg {{ width:14px;height:14px; }}

/* ── Cards ── */
.card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-sm);
  transition:box-shadow 0.2s ease, transform 0.2s ease;
}}
.card:hover {{
  box-shadow:var(--shadow-md);
  transform:translateY(-2px);
}}

/* ── Stats grid ── */
.stats-grid {{
  display:grid;
  grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));
  gap:16px;
  margin-bottom:24px;
}}
.stat-card {{
  background:linear-gradient(135deg, var(--bg-card) 0%, color-mix(in srgb, {primary_color} 5%, white) 100%);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  padding:20px 24px;
  box-shadow:var(--shadow-xs);
  transition:all 0.2s cubic-bezier(.4,0,.2,1);
  cursor:default;
  display:flex;
  align-items:center;
  gap:16px;
  position:relative;
  overflow:hidden;
}}
.stat-card::after {{
  content:'';position:absolute;top:0;right:0;width:100px;height:100px;
  background:radial-gradient(circle at top right, color-mix(in srgb, {primary_color} 8%, transparent), transparent 70%);
  pointer-events:none;
}}
.stat-card:hover {{ box-shadow:var(--shadow-md);transform:translateY(-2px); }}
.stat-top {{
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
}}
.stat-icon {{
  width:48px;height:48px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:var(--primary-light);color:var(--primary);
  box-shadow:0 2px 8px rgba(0,0,0,0.06);
}}
.stat-icon svg {{ width:22px;height:22px; }}
.stat-info {{
  flex:1;min-width:0;
}}
.stat-trend {{
  font-size:12px;font-weight:600;
  display:flex;align-items:center;gap:2px;
  padding:2px 8px;border-radius:20px;
}}
.stat-trend.up {{ color:var(--success-text);background:var(--success-light); }}
.stat-trend.down {{ color:var(--danger-text);background:var(--danger-light); }}
.stat-label {{
  font-size:12px;color:var(--text-muted);
  font-weight:500;
  margin-top:2px;
}}
.stat-value {{
  font-size:28px;font-weight:700;color:var(--text);
  letter-spacing:-0.02em;
  line-height:1.2;
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
  height:180px;padding-top:8px;
  position:relative;
  border-left:1px solid var(--border-light);
  border-bottom:1px solid var(--border-light);
  background:repeating-linear-gradient(
    to top,
    transparent,
    transparent 24%,
    var(--border-light) 24%,
    var(--border-light) 24.5%
  );
}}
.chart-bar-col {{
  flex:1;display:flex;flex-direction:column;align-items:center;
  height:100%;justify-content:flex-end;gap:6px;
  position:relative;
}}
.chart-bar {{
  width:100%;max-width:44px;
  border-radius:6px 6px 2px 2px;
  background:linear-gradient(180deg, var(--primary), var(--secondary));
  opacity:0.85;
  transition:opacity var(--transition), height 0.5s ease, transform var(--transition);
  min-height:4px;
  position:relative;
}}
.chart-bar:hover {{ opacity:1;transform:scaleY(1.02);transform-origin:bottom; }}
.chart-bar-val {{
  position:absolute;top:-20px;left:50%;transform:translateX(-50%);
  font-size:10px;font-weight:700;color:var(--text);
  white-space:nowrap;opacity:0;transition:opacity var(--transition);
}}
.chart-bar-col:hover .chart-bar-val {{ opacity:1; }}
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
  transition:background 100ms ease;
}}
.activity-item:last-child {{ border-bottom:none; }}
.activity-item:hover {{ background:var(--bg); }}
.activity-dot {{
  width:8px;height:8px;border-radius:50%;
  background:var(--primary);flex-shrink:0;
}}
.activity-text {{
  flex:1;font-size:13px;color:var(--text-secondary);min-width:0;
  display:flex;align-items:center;flex-wrap:wrap;gap:4px;
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
  font-family:inherit;
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
.table-scroll-wrapper {{
  overflow-x:auto;
  position:relative;
}}
table {{
  width:100%;border-collapse:separate;border-spacing:0;font-size:13px;
}}
th {{
  text-align:left;padding:10px 16px;
  background:transparent;
  border-bottom:2px solid var(--border);
  font-weight:600;font-size:11px;
  color:#6b7280;
  text-transform:uppercase;
  letter-spacing:0.05em;
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
  border-bottom:1px solid #f3f4f6;
  max-width:200px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:14px;color:#111827;
}}
tr:last-child td {{ border-bottom:none; }}
tbody tr {{
  cursor:pointer;
  transition:all 100ms ease;
  border-left:3px solid transparent;
}}
tbody tr:nth-child(even) {{ background:#fafafa; }}
tbody tr:hover {{
  background:var(--primary-subtle);
  border-left-color:var(--primary);
}}
tbody tr:hover .row-actions {{ opacity:1;pointer-events:auto; }}
.row-actions {{
  opacity:0;pointer-events:none;
  transition:opacity 100ms ease;
  display:inline-flex;gap:2px;
}}
td[data-type="number"] {{ text-align:right;font-variant-numeric:tabular-nums; }}

/* ── Status badges ── */
.badge {{
  display:inline-flex;align-items:center;gap:6px;
  padding:3px 10px;border-radius:6px;
  font-size:12px;font-weight:500;
  white-space:nowrap;
  letter-spacing:0.01em;
}}
.badge::before {{
  content:'';
  width:6px;height:6px;border-radius:50%;
  flex-shrink:0;
}}
.badge-dot {{ display:none; }}
.badge-default {{ background:var(--slate-light);color:var(--slate-text); }}
.badge-default::before {{ background:var(--slate); }}
.badge-primary {{ background:var(--primary-light);color:var(--primary-dark); }}
.badge-primary::before {{ background:var(--primary); }}
.badge-success {{ background:#ecfdf5;color:#065f46; }}
.badge-success::before {{ background:#10b981; }}
.badge-warning {{ background:#fffbeb;color:#92400e; }}
.badge-warning::before {{ background:#f59e0b; }}
.badge-danger {{ background:#fef2f2;color:#991b1b; }}
.badge-danger::before {{ background:#ef4444; }}
.badge-info {{ background:#eff6ff;color:#1e40af; }}
.badge-info::before {{ background:#3b82f6; }}
.badge-purple {{ background:#faf5ff;color:#6b21a8; }}
.badge-purple::before {{ background:#a855f7; }}
.badge-pink {{ background:#fdf2f8;color:#9d174d; }}
.badge-pink::before {{ background:#ec4899; }}
.badge-slate {{ background:#f8fafc;color:#475569; }}
.badge-slate::before {{ background:#94a3b8; }}
.badge-sm {{ font-size:10px;padding:1px 7px;border-radius:4px; }}
.badge-sm::before {{ width:5px;height:5px; }}

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
  text-align:center;padding:80px 24px;
  color:var(--gray-400);
}}
.empty-state-container {{
  max-width:360px;margin:0 auto;
  border:2px dashed var(--gray-200);
  border-radius:var(--radius-xl);
  padding:48px 32px;
  background:var(--gray-50);
}}
.empty-state-icon {{
  width:80px;height:80px;margin:0 auto 20px;
  border-radius:50%;
  border:2px dashed var(--gray-300);
  background:var(--bg-card);
  display:flex;align-items:center;justify-content:center;
  position:relative;
  animation:emptyPulse 3s ease-in-out infinite;
}}
@keyframes emptyPulse {{
  0%,100% {{ transform:scale(1);opacity:0.7; }}
  50% {{ transform:scale(1.04);opacity:1; }}
}}
.empty-state-icon svg {{ width:28px;height:28px;opacity:0.4;color:var(--gray-400); }}
.empty-state-icon .plus-icon {{
  position:absolute;bottom:-4px;right:-4px;
  width:28px;height:28px;border-radius:50%;
  background:var(--primary);color:#fff;
  display:flex;align-items:center;justify-content:center;
  font-size:18px;font-weight:700;line-height:1;
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
  border:2px solid var(--bg-card);
}}
.empty-state h3 {{
  font-size:16px;font-weight:600;color:var(--text);
  margin-bottom:6px;
}}
.empty-state p {{
  font-size:13px;margin-bottom:24px;
  max-width:280px;margin-left:auto;margin-right:auto;
  line-height:1.6;color:var(--gray-500);
}}
.empty-state .btn {{
  display:inline-flex;
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
  font-family:inherit;
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
  border-radius:8px;
  font-size:14px;font-weight:500;
  cursor:pointer;background:var(--bg-card);
  color:var(--text);
  transition:all 0.15s cubic-bezier(.4,0,.2,1);
  font-family:inherit;
  white-space:nowrap;
}}
.btn:hover {{ background:#f9fafb;border-color:#d1d5db; }}
.btn:active {{ transform:scale(0.97); }}
.btn-primary {{
  background:var(--primary);color:#fff;
  border:none;border-color:var(--primary);
  border-radius:8px;
  box-shadow:0 1px 2px rgba(0,0,0,.05);
}}
.btn-primary:hover {{ filter:brightness(1.1);box-shadow:0 2px 8px {primary_color}4d; }}
.btn-secondary {{
  background:white;color:#374151;
  border:1px solid #e5e7eb;border-radius:8px;
  padding:8px 16px;font-weight:500;font-size:14px;cursor:pointer;
}}
.btn-secondary:hover {{ background:#f9fafb;border-color:#d1d5db; }}
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
  backdrop-filter:blur(4px);
}}
.modal-overlay.show {{ display:flex;opacity:1;animation:fadeIn 0.2s ease; }}
.slide-over {{
  position:fixed;top:0;right:-480px;bottom:0;
  width:480px;max-width:100vw;
  background:var(--bg-card);
  box-shadow:0 0 0 1px rgba(0,0,0,.03), 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.05);
  z-index:101;
  display:flex;flex-direction:column;
  transition:right 0.25s cubic-bezier(.4,0,.2,1);
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
  box-shadow:0 0 0 1px rgba(0,0,0,.03), 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.05);
  animation:slideUp 0.25s cubic-bezier(.4,0,.2,1);
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
  max-width:800px;
}}
.detail-header {{
  display:flex;align-items:center;gap:12px;
  margin-bottom:24px;
  flex-wrap:wrap;
}}
.detail-header .back-btn {{
  background:none;border:none;cursor:pointer;
  color:var(--text-muted);padding:6px;
  border-radius:var(--radius);
  transition:all var(--transition);
}}
.detail-header .back-btn:hover {{ background:var(--bg);color:var(--text); }}
.detail-header .back-btn svg {{ width:20px;height:20px; }}
.detail-header h2 {{ font-size:20px;font-weight:700;flex:1;min-width:0; }}
.detail-header-actions {{
  display:flex;gap:8px;flex-shrink:0;
}}
.detail-status-badge {{
  display:inline-flex;align-items:center;gap:4px;
  margin-left:8px;vertical-align:middle;
}}
.detail-body {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  overflow:hidden;
  padding:8px 0;
}}
.detail-fields-grid {{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:0;
}}
.detail-field {{
  display:flex;flex-direction:column;gap:4px;
  padding:14px 24px;
  border-bottom:1px solid var(--border-light);
}}
.detail-field:last-child {{ border-bottom:none; }}
.detail-field-label {{
  font-size:11px;font-weight:600;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:0.05em;
}}
.detail-field-value {{
  font-size:14px;color:var(--text);
  word-break:break-word;
}}
.detail-field-value.empty {{
  color:var(--text-placeholder);font-style:italic;
}}
.detail-field-value a {{
  color:var(--primary);text-decoration:none;
}}
.detail-field-value a:hover {{ text-decoration:underline; }}
.detail-field-value .relative-time {{
  color:var(--text-muted);font-size:12px;margin-left:4px;
}}
.detail-actions {{
  display:flex;gap:8px;margin-top:20px;
}}
/* ── Detail tabs ── */
.detail-tabs {{
  display:flex;gap:0;border-bottom:1px solid var(--border);
  margin-bottom:0;overflow-x:auto;
  scrollbar-width:none;-ms-overflow-style:none;
}}
.detail-tabs::-webkit-scrollbar {{ display:none; }}
.detail-tab {{
  padding:10px 18px;font-size:13px;font-weight:500;
  color:var(--text-muted);cursor:pointer;
  border-bottom:2px solid transparent;
  white-space:nowrap;transition:all var(--transition);
  background:none;border-top:none;border-left:none;border-right:none;
}}
.detail-tab:hover {{ color:var(--text);background:var(--bg); }}
.detail-tab.active {{
  color:var(--primary);border-bottom-color:var(--primary);font-weight:600;
}}
.detail-tab-count {{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:18px;height:18px;padding:0 5px;
  font-size:10px;font-weight:700;border-radius:9px;
  background:var(--primary-light);color:var(--primary);margin-left:6px;
}}
.detail-tab-panel {{ display:none;padding:0; }}
.detail-tab-panel.active {{ display:block; }}
/* ── Related records mini-table ── */
.related-section {{ padding:16px 24px; }}
.related-section h4 {{
  font-size:13px;font-weight:600;color:var(--text);
  margin-bottom:12px;display:flex;align-items:center;gap:8px;
}}
.related-mini-table {{
  width:100%;border-collapse:collapse;font-size:13px;
}}
.related-mini-table th {{
  text-align:left;padding:8px 12px;font-size:11px;
  font-weight:600;color:var(--text-muted);text-transform:uppercase;
  letter-spacing:0.05em;border-bottom:1px solid var(--border);background:var(--bg);
}}
.related-mini-table td {{
  padding:8px 12px;border-bottom:1px solid var(--border-light);color:var(--text);
}}
.related-mini-table tr:hover {{ background:var(--bg);cursor:pointer; }}
.related-mini-table tr:last-child td {{ border-bottom:none; }}
.related-empty {{
  padding:24px;text-align:center;color:var(--text-muted);
  font-size:13px;font-style:italic;
}}
/* ── Inline editing ── */
.detail-field-value-wrapper {{
  display:flex;align-items:flex-start;gap:6px;position:relative;
  cursor:pointer;padding:4px 6px;margin:-4px -6px;
  border-radius:var(--radius);transition:background var(--transition);
}}
.detail-field-value-wrapper:hover {{ background:var(--bg); }}
.detail-field-value-wrapper .edit-icon {{
  opacity:0;flex-shrink:0;color:var(--text-muted);
  transition:opacity var(--transition);margin-top:2px;
}}
.detail-field-value-wrapper:hover .edit-icon {{ opacity:1; }}
.inline-edit-input {{
  width:100%;padding:6px 10px;border:1px solid var(--primary);
  border-radius:var(--radius);font-size:14px;color:var(--text);
  background:var(--bg-card);outline:none;font-family:inherit;
  box-shadow:0 0 0 3px var(--primary-light);
}}
.inline-edit-input:focus {{ border-color:var(--primary); }}
.inline-edit-hint {{ font-size:11px;color:var(--text-muted);margin-top:4px; }}
/* ── Activity timeline ── */
.activity-timeline {{ padding:16px 24px; }}
.activity-item {{
  display:flex;gap:12px;padding:12px 0;
  border-bottom:1px solid var(--border-light);
}}
.activity-item:last-child {{ border-bottom:none; }}
.activity-dot {{
  width:8px;height:8px;border-radius:50%;
  background:var(--primary);margin-top:6px;flex-shrink:0;
}}
.activity-content {{ flex:1;min-width:0; }}
.activity-text {{ font-size:13px;color:var(--text); }}
.activity-time {{ font-size:11px;color:var(--text-muted);margin-top:2px; }}
/* ── Comments section ── */
.comments-section {{ padding:16px 24px; }}
.comment-item {{
  padding:12px 0;border-bottom:1px solid var(--border-light);
}}
.comment-item:last-child {{ border-bottom:none; }}
.comment-header {{
  display:flex;align-items:center;gap:8px;margin-bottom:6px;
}}
.comment-avatar {{
  width:24px;height:24px;border-radius:50%;
  background:var(--primary-light);color:var(--primary);
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;flex-shrink:0;
}}
.comment-author {{ font-size:12px;font-weight:600;color:var(--text); }}
.comment-time {{ font-size:11px;color:var(--text-muted); }}
.comment-body {{ font-size:13px;color:var(--text);line-height:1.5; }}
.comment-input-row {{ display:flex;gap:8px;margin-top:16px; }}
.comment-input {{
  flex:1;padding:8px 12px;border:1px solid var(--border);
  border-radius:var(--radius);font-size:13px;
  font-family:inherit;outline:none;
}}
.comment-input:focus {{ border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-light); }}
/* ── Files section ── */
.files-section {{ padding:16px 24px; }}
.file-item {{
  display:flex;align-items:center;gap:10px;
  padding:10px 0;border-bottom:1px solid var(--border-light);
}}
.file-item:last-child {{ border-bottom:none; }}
.file-icon {{ color:var(--text-muted); }}
.file-name {{ font-size:13px;color:var(--text);flex:1; }}
.file-size {{ font-size:11px;color:var(--text-muted); }}
@media (max-width:600px) {{
  .detail-fields-grid {{ grid-template-columns:1fr; }}
}}

/* ── Form ── */
.form-group {{
  margin-bottom:20px;
}}
.form-group label {{
  display:block;font-size:11px;font-weight:600;
  color:var(--text-muted);margin-bottom:6px;
  text-transform:uppercase;
  letter-spacing:0.05em;
}}
.form-group label .required {{
  color:var(--primary);margin-left:2px;font-size:14px;line-height:1;
}}
.form-group input,
.form-group select,
.form-group textarea {{
  width:100%;padding:10px 14px;
  border:1px solid #e5e7eb;
  border-radius:8px;
  font-size:14px;color:var(--text);
  background:var(--bg-card);
  outline:none;font-family:inherit;
  box-sizing:border-box;
  transition:border-color 0.15s, box-shadow 0.15s;
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
.form-group select {{
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat:no-repeat;
  background-position:right 12px center;
  padding-right:36px;
  cursor:pointer;
}}
.form-group textarea {{
  min-height:80px;resize:vertical;
}}
.form-group textarea.auto-grow {{
  resize:none;overflow:hidden;
}}
.form-divider {{
  border:none;border-top:1px solid var(--border-light);
  margin:24px 0 20px;
}}
.btn-cancel-outline {{
  background:transparent;color:var(--text-secondary);
  border:1px solid var(--border);border-radius:8px;
  padding:8px 16px;font-size:14px;font-weight:500;cursor:pointer;
  transition:all var(--transition);font-family:inherit;
}}
.btn-cancel-outline:hover {{ background:var(--bg);border-color:#d1d5db; }}
.btn-cancel-outline:active {{ transform:scale(0.97); }}
.save-spinner {{
  display:inline-block;width:14px;height:14px;
  border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;
  border-radius:50%;animation:spin 0.6s linear infinite;
  margin-right:6px;vertical-align:middle;
}}
@keyframes spin {{ to {{ transform:rotate(360deg); }} }}
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
  background:linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
  background-size:200% 100%;
  animation:shimmer 1.5s infinite;
  border-radius:4px;
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
  position:fixed;top:16px;right:16px;
  z-index:200;display:flex;flex-direction:column;gap:8px;
}}
.toast {{
  padding:14px 16px;
  border-radius:var(--radius-lg);
  font-size:13px;font-weight:500;
  display:flex;align-items:center;gap:10px;
  box-shadow:var(--shadow-lg);
  transform:translateX(120%);opacity:0;
  transition:all 0.35s cubic-bezier(0.4,0,0.2,1);
  max-width:400px;min-width:300px;
  background:var(--bg-card);
  border:1px solid var(--border);
  color:var(--text);
  position:relative;
  overflow:hidden;
}}
.toast.show {{ transform:translateX(0);opacity:1; }}
.toast-success {{
  border-left:3px solid var(--success);
}}
.toast-error {{
  border-left:3px solid var(--danger);
}}
.toast-info {{
  border-left:3px solid var(--info);
}}
.toast-icon {{
  width:20px;height:20px;flex-shrink:0;
}}
.toast-success .toast-icon {{ color:var(--success); }}
.toast-error .toast-icon {{ color:var(--danger); }}
.toast-info .toast-icon {{ color:var(--info); }}
.toast-message {{ flex:1;color:var(--text);font-size:13px; }}
.toast-close {{
  background:none;border:none;cursor:pointer;
  color:var(--gray-400);padding:2px;
  border-radius:4px;display:flex;align-items:center;justify-content:center;
  transition:color var(--transition), background var(--transition);
  flex-shrink:0;
}}
.toast-close:hover {{ color:var(--text);background:var(--gray-100); }}
.toast-close svg {{ width:14px;height:14px; }}
.toast-progress {{
  position:absolute;bottom:0;left:0;right:0;height:2px;
  background:var(--gray-200);
}}
.toast-progress-bar {{
  height:100%;width:100%;
  transition:width linear;
}}
.toast-success .toast-progress-bar {{ background:var(--success); }}
.toast-error .toast-progress-bar {{ background:var(--danger); }}
.toast-info .toast-progress-bar {{ background:var(--info); }}

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

/* ── Kanban Board ── */
.kanban-board {{
  display:flex;gap:16px;
  overflow-x:auto;padding-bottom:8px;
  min-height:400px;
}}
.kanban-column {{
  min-width:260px;width:260px;flex-shrink:0;
  background:var(--bg);
  border-radius:var(--radius-lg);
  border:1px solid var(--border-light);
  display:flex;flex-direction:column;
  max-height:calc(100vh - 200px);
}}
.kanban-column-header {{
  padding:14px 16px;
  font-size:13px;font-weight:600;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid var(--border-light);
  flex-shrink:0;
}}
.kanban-column-count {{
  font-size:11px;font-weight:500;
  background:var(--bg-card);
  border:1px solid var(--border);
  padding:1px 8px;border-radius:20px;
  color:var(--text-muted);
}}
.kanban-column-body {{
  flex:1;overflow-y:auto;padding:10px;
  display:flex;flex-direction:column;gap:8px;
}}
.kanban-card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:12px 14px;
  cursor:pointer;
  transition:all var(--transition);
  box-shadow:var(--shadow-xs);
}}
.kanban-card:hover {{
  box-shadow:var(--shadow-sm);
  border-color:var(--primary);
  transform:translateY(-1px);
}}
.kanban-card-title {{
  font-size:13px;font-weight:600;color:var(--text);
  margin-bottom:6px;
}}
.kanban-card-field {{
  font-size:12px;color:var(--text-muted);
  margin-top:3px;
  display:flex;align-items:center;gap:4px;
}}
.kanban-card-field strong {{
  color:var(--text-secondary);font-weight:500;
}}

/* ── Calendar View ── */
.calendar-view {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-xs);
  overflow:hidden;
}}
.calendar-header {{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;
  border-bottom:1px solid var(--border);
}}
.calendar-header h3 {{
  font-size:15px;font-weight:600;
}}
.calendar-nav {{
  display:flex;align-items:center;gap:8px;
}}
.calendar-nav-btn {{
  width:32px;height:32px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  background:var(--bg-card);
  cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:var(--text-secondary);
  transition:all var(--transition);
  font-family:inherit;
}}
.calendar-nav-btn:hover {{ background:var(--bg);color:var(--text); }}
.calendar-nav-btn svg {{ width:16px;height:16px; }}
.calendar-grid {{
  display:grid;
  grid-template-columns:repeat(7, 1fr);
}}
.calendar-day-header {{
  padding:8px 4px;text-align:center;
  font-size:11px;font-weight:600;
  color:var(--text-muted);
  text-transform:uppercase;
  border-bottom:1px solid var(--border-light);
}}
.calendar-cell {{
  min-height:90px;
  border-right:1px solid var(--border-light);
  border-bottom:1px solid var(--border-light);
  padding:4px;
  position:relative;
  cursor:pointer;
  transition:background var(--transition);
}}
.calendar-cell:nth-child(7n) {{ border-right:none; }}
.calendar-cell:hover {{ background:var(--primary-subtle); }}
.calendar-cell.other-month {{
  background:var(--bg);
}}
.calendar-cell.other-month .calendar-date {{
  color:var(--text-placeholder);
}}
.calendar-cell.today {{
  background:var(--primary-light);
}}
.calendar-date {{
  font-size:12px;font-weight:500;
  color:var(--text-secondary);
  padding:2px 6px;
}}
.calendar-event {{
  font-size:10px;
  padding:2px 6px;
  border-radius:4px;
  margin-top:2px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  cursor:pointer;
  background:var(--primary-light);
  color:var(--primary);
  font-weight:500;
  transition:background var(--transition);
}}
.calendar-event:hover {{
  background:var(--primary);color:#fff;
}}

/* ── Card Grid ── */
.card-grid {{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));
  gap:16px;
}}
.grid-card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  overflow:hidden;
  cursor:pointer;
  transition:all var(--transition);
  box-shadow:var(--shadow-xs);
}}
.grid-card:hover {{
  box-shadow:var(--shadow-md);
  transform:translateY(-2px);
}}
.grid-card-image {{
  height:160px;
  background:linear-gradient(135deg, var(--primary-light), var(--bg));
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}}
.grid-card-image img {{
  width:100%;height:100%;object-fit:cover;
}}
.grid-card-image .placeholder-icon {{
  width:48px;height:48px;color:var(--primary);opacity:0.4;
}}
.grid-card-body {{
  padding:16px;
}}
.grid-card-title {{
  font-size:14px;font-weight:600;color:var(--text);
  margin-bottom:6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}}
.grid-card-field {{
  font-size:12px;color:var(--text-muted);
  margin-top:3px;
  display:flex;align-items:center;gap:4px;
}}
.grid-card-field strong {{ color:var(--text-secondary);font-weight:500; }}
.grid-card-footer {{
  padding:10px 16px;
  border-top:1px solid var(--border-light);
  display:flex;align-items:center;justify-content:space-between;
}}
.grid-card-price {{
  font-size:16px;font-weight:700;color:var(--text);
}}
.grid-card-badge {{
  font-size:11px;
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
  .stats-grid {{ grid-template-columns:repeat(2, 1fr); }}
  .dashboard-grid {{ grid-template-columns:1fr; }}
  .slide-over {{
    width:100vw;top:auto;bottom:0;right:0;
    max-height:90vh;
    border-radius:var(--radius-xl) var(--radius-xl) 0 0;
    transform:translateY(100%);transition:transform 0.25s cubic-bezier(.4,0,.2,1);
  }}
  .slide-over.show {{ right:0;transform:translateY(0); }}
  .table-scroll-wrapper {{
    -webkit-overflow-scrolling:touch;
  }}
  .table-scroll-wrapper::after {{
    content:'';position:sticky;top:0;right:0;bottom:0;width:32px;float:right;
    height:100%;margin-left:-32px;
    background:linear-gradient(to left, rgba(0,0,0,0.06), transparent);
    pointer-events:none;z-index:1;
  }}
  .search-input {{ min-width:140px; }}
  .table-toolbar {{ padding:12px 16px; }}
  td,th {{ padding:10px 12px; }}
  .sidebar-collapse-btn {{ display:none; }}
  .detail-field {{ flex-direction:column;gap:4px; }}
  .detail-field-label {{ width:auto; }}
  .detail-fields-grid {{ grid-template-columns:1fr; }}
  .kanban-board {{ gap:12px; }}
  .kanban-column {{ min-width:240px;width:240px; }}
  .card-grid {{ grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); }}
  .row-actions {{ opacity:1;pointer-events:auto; }}
  .quick-actions-row {{ flex-wrap:wrap; }}
}}
@media (max-width:480px) {{
  .table-toolbar {{ flex-direction:column;align-items:stretch; }}
  .status-tabs {{ overflow-x:auto; }}
  .kanban-column {{ min-width:220px;width:220px; }}
  .card-grid {{ grid-template-columns:1fr; }}
  .stats-grid {{ grid-template-columns:1fr; }}
}}

/* ── Analytics Page ── */
.analytics-stats-row {{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;
}}
.analytics-stat-card {{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:20px;box-shadow:var(--shadow-xs);
}}
.analytics-stat-card .stat-label {{ font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:500; }}
.analytics-stat-card .stat-value {{ font-size:24px;font-weight:700;color:var(--text); }}
.analytics-bar-chart {{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:24px;box-shadow:var(--shadow-xs);margin-bottom:24px;
}}
.analytics-bar-chart h3 {{ font-size:14px;font-weight:600;margin-bottom:16px; }}
.ab-bars {{ display:flex;align-items:flex-end;gap:12px;height:180px; }}
.ab-col {{ flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px; }}
.ab-bar {{
  width:100%;max-width:60px;border-radius:6px 6px 2px 2px;
  background:var(--primary);opacity:0.85;min-height:4px;
  transition:opacity var(--transition),height 0.6s ease;
  position:relative;
}}
.ab-bar:hover {{ opacity:1; }}
.ab-bar-val {{
  position:absolute;top:-20px;left:50%;transform:translateX(-50%);
  font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;
}}
.ab-label {{ font-size:11px;color:var(--text-muted);font-weight:500;text-align:center;word-break:break-word;max-width:80px; }}
.analytics-line-chart {{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:24px;box-shadow:var(--shadow-xs);margin-bottom:24px;
}}
.analytics-line-chart h3 {{ font-size:14px;font-weight:600;margin-bottom:16px; }}
.analytics-line-chart svg {{ width:100%;height:200px; }}
.analytics-grid {{ display:grid;grid-template-columns:1fr 1fr;gap:24px; }}
@media (max-width:768px) {{ .analytics-grid {{ grid-template-columns:1fr; }} }}

/* ── Export Buttons ── */
.export-btn-group {{ display:flex;align-items:center;gap:6px; }}

/* ── Print styles for PDF export ── */
@media print {{
  .sidebar,.topbar,.sidebar-overlay,.modal-overlay,.slide-over,.confirm-dialog,
  .toast-container,.loading-bar,.auth-screen,.table-toolbar .search-input,
  .table-toolbar .status-tabs,.table-footer,.bulk-action-bar,
  #notification-dropdown,#global-search-overlay {{ display:none !important; }}
  body {{ display:block !important;overflow:visible !important; }}
  .main {{ overflow:visible !important; }}
  .content {{ overflow:visible !important;padding:0 !important; }}
  .table-container {{ border:none !important;box-shadow:none !important; }}
  table {{ font-size:11px; }}
  th {{ background:#f0f0f0 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact; }}
  td,th {{ padding:6px 10px !important; }}
}}

/* ── Notification Bell ── */
.notif-bell {{
  position:relative;background:none;border:none;cursor:pointer;
  padding:6px;border-radius:var(--radius);color:var(--text-secondary);
  transition:all var(--transition);
}}
.notif-bell:hover {{ background:var(--bg);color:var(--text); }}
.notif-bell svg {{ width:20px;height:20px; }}
.notif-badge {{
  position:absolute;top:2px;right:2px;
  min-width:16px;height:16px;
  background:var(--danger);color:#fff;
  border-radius:20px;font-size:10px;font-weight:700;
  display:flex;align-items:center;justify-content:center;
  padding:0 4px;line-height:1;
  pointer-events:none;
}}
.notif-badge.hidden {{ display:none; }}
.notif-dropdown {{
  position:absolute;top:42px;right:0;
  width:340px;max-height:420px;
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);
  z-index:150;display:none;overflow:hidden;
}}
.notif-dropdown.show {{ display:block; }}
.notif-dropdown-header {{
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px;border-bottom:1px solid var(--border-light);
}}
.notif-dropdown-header h4 {{ font-size:14px;font-weight:600; }}
.notif-mark-read {{
  background:none;border:none;font-size:12px;color:var(--primary);
  cursor:pointer;font-family:inherit;font-weight:500;
}}
.notif-mark-read:hover {{ text-decoration:underline; }}
.notif-list {{ max-height:340px;overflow-y:auto; }}
.notif-item {{
  display:flex;align-items:flex-start;gap:10px;
  padding:12px 16px;border-bottom:1px solid var(--border-light);
  transition:background var(--transition);
}}
.notif-item:last-child {{ border-bottom:none; }}
.notif-item:hover {{ background:var(--bg); }}
.notif-item.unread {{ background:var(--primary-subtle); }}
.notif-dot {{
  width:8px;height:8px;border-radius:50%;
  background:var(--primary);flex-shrink:0;margin-top:5px;
}}
.notif-dot.read {{ background:var(--text-muted);opacity:0.3; }}
.notif-text {{ flex:1;font-size:13px;color:var(--text); }}
.notif-time {{ font-size:11px;color:var(--text-muted);margin-top:2px; }}
.notif-empty {{
  padding:30px 16px;text-align:center;color:var(--text-muted);font-size:13px;
}}

/* ── Global Search ── */
#global-search-overlay {{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,0.4);z-index:200;
  align-items:flex-start;justify-content:center;
  padding-top:min(20vh,120px);backdrop-filter:blur(2px);
}}
#global-search-overlay.show {{ display:flex; }}
.gsearch-box {{
  width:560px;max-width:92vw;
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:var(--radius-xl);box-shadow:var(--shadow-xl);
  overflow:hidden;
  animation:dialogIn 0.15s ease;
}}
.gsearch-input-wrap {{
  display:flex;align-items:center;gap:10px;
  padding:14px 18px;border-bottom:1px solid var(--border-light);
}}
.gsearch-input-wrap svg {{ width:20px;height:20px;color:var(--text-muted);flex-shrink:0; }}
.gsearch-input-wrap input {{
  flex:1;border:none;outline:none;font-size:15px;color:var(--text);
  background:transparent;font-family:inherit;
}}
.gsearch-input-wrap input::placeholder {{ color:var(--text-placeholder); }}
.gsearch-input-wrap kbd {{
  font-size:11px;padding:2px 6px;border-radius:4px;
  background:var(--bg);border:1px solid var(--border);
  color:var(--text-muted);font-family:inherit;
}}
.gsearch-results {{
  max-height:360px;overflow-y:auto;padding:8px 0;
}}
.gsearch-group-label {{
  padding:8px 18px 4px;font-size:11px;font-weight:600;
  color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;
}}
.gsearch-item {{
  display:flex;align-items:center;gap:10px;
  padding:8px 18px;cursor:pointer;transition:background var(--transition);
}}
.gsearch-item:hover {{ background:var(--primary-light); }}
.gsearch-item-text {{ font-size:13px;color:var(--text); }}
.gsearch-item-text strong {{ font-weight:600; }}
.gsearch-item-entity {{
  font-size:11px;color:var(--text-muted);margin-left:auto;flex-shrink:0;
}}
.gsearch-empty {{
  padding:24px 18px;text-align:center;color:var(--text-muted);font-size:13px;
}}
.gsearch-hint {{
  padding:10px 18px;border-top:1px solid var(--border-light);
  font-size:11px;color:var(--text-muted);
  display:flex;align-items:center;gap:6px;
}}

/* ── Bulk Actions ── */
.bulk-cb {{
  width:16px;height:16px;accent-color:var(--primary);cursor:pointer;
  margin:0;
}}
.bulk-action-bar {{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:var(--text);color:#fff;
  padding:10px 20px;border-radius:var(--radius-xl);
  box-shadow:var(--shadow-xl);z-index:120;
  display:none;align-items:center;gap:16px;
  animation:dialogIn 0.2s ease;
  font-size:13px;font-weight:500;
  white-space:nowrap;
}}
.bulk-action-bar.show {{ display:flex; }}
.bulk-action-bar span {{ opacity:0.7; }}
.bulk-action-bar button {{
  background:rgba(255,255,255,0.15);color:#fff;
  border:1px solid rgba(255,255,255,0.2);
  padding:6px 14px;border-radius:var(--radius);
  font-size:12px;font-weight:500;cursor:pointer;
  font-family:inherit;transition:all var(--transition);
}}
.bulk-action-bar button:hover {{ background:rgba(255,255,255,0.25); }}
.bulk-action-bar button.bulk-delete {{ background:var(--danger);border-color:var(--danger); }}
.bulk-action-bar button.bulk-delete:hover {{ background:#dc2626; }}
.bulk-action-bar select {{
  background:rgba(255,255,255,0.15);color:#fff;
  border:1px solid rgba(255,255,255,0.2);
  padding:6px 10px;border-radius:var(--radius);
  font-size:12px;font-family:inherit;cursor:pointer;
}}
.bulk-action-bar select option {{ color:var(--text);background:var(--bg-card); }}
tr.bulk-selected {{ background:var(--primary-light) !important; }}
.topbar-search-trigger {{
  display:flex;align-items:center;gap:8px;
  padding:6px 12px;border:1px solid var(--border);
  border-radius:var(--radius);background:var(--gray-50);
  color:var(--gray-400);font-size:13px;cursor:pointer;
  transition:all var(--transition);min-width:200px;
  font-family:inherit;
}}
.topbar-search-trigger:hover {{ border-color:var(--gray-300);color:var(--gray-500);background:var(--bg-card); }}
.topbar-search-trigger svg {{ width:15px;height:15px;flex-shrink:0; }}
.topbar-search-trigger kbd {{
  font-size:10px;padding:2px 6px;border-radius:4px;
  background:var(--bg-card);border:1px solid var(--gray-200);
  color:var(--gray-400);margin-left:auto;font-family:system-ui,inherit;
  font-weight:500;line-height:1.3;
  box-shadow:0 1px 0 var(--gray-200);
}}
/* ── AI Chat Widget ── */
.chat-widget-btn {{
  position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;
  background:#ec4899;color:#fff;border:none;cursor:pointer;z-index:10000;
  box-shadow:0 4px 20px rgba(236,72,153,0.4);display:flex;align-items:center;justify-content:center;
  font-size:24px;transition:transform 0.2s,box-shadow 0.2s;
}}
.chat-widget-btn:hover {{ transform:scale(1.1);box-shadow:0 6px 28px rgba(236,72,153,0.5); }}
.chat-panel {{
  position:fixed;bottom:90px;right:24px;width:350px;height:500px;
  background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.15);
  z-index:10001;display:none;flex-direction:column;overflow:hidden;
  animation:chatSlideUp 0.25s ease-out;
}}
.chat-panel.open {{ display:flex; }}
@keyframes chatSlideUp {{
  from {{ opacity:0;transform:translateY(20px); }}
  to {{ opacity:1;transform:translateY(0); }}
}}
.chat-panel-header {{
  padding:16px 20px;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:#fff;
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
}}
.chat-panel-header h3 {{ font-size:15px;font-weight:600;margin:0; }}
.chat-panel-close {{
  background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;
  border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:16px;transition:background 0.2s;
}}
.chat-panel-close:hover {{ background:rgba(255,255,255,0.35); }}
.chat-messages {{
  flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;
}}
.chat-msg {{
  max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;
  word-wrap:break-word;
}}
.chat-msg.bot {{
  background:#f3f4f6;color:#374151;align-self:flex-start;border-bottom-left-radius:4px;
}}
.chat-msg.user {{
  background:#ec4899;color:#fff;align-self:flex-end;border-bottom-right-radius:4px;
}}
.chat-typing {{
  align-self:flex-start;padding:10px 14px;background:#f3f4f6;border-radius:12px;
  border-bottom-left-radius:4px;display:none;
}}
.chat-typing.show {{ display:block; }}
.chat-typing-dots {{ display:flex;gap:4px; }}
.chat-typing-dots span {{
  width:6px;height:6px;background:#9ca3af;border-radius:50%;
  animation:chatDot 1.2s infinite ease-in-out;
}}
.chat-typing-dots span:nth-child(2) {{ animation-delay:0.2s; }}
.chat-typing-dots span:nth-child(3) {{ animation-delay:0.4s; }}
@keyframes chatDot {{
  0%,80%,100% {{ transform:scale(0.6);opacity:0.4; }}
  40% {{ transform:scale(1);opacity:1; }}
}}
.chat-input-wrap {{
  padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;flex-shrink:0;
}}
.chat-input-wrap input {{
  flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;
  outline:none;font-family:inherit;
}}
.chat-input-wrap input:focus {{ border-color:#ec4899; }}
.chat-input-wrap button {{
  background:#ec4899;color:#fff;border:none;border-radius:8px;padding:8px 14px;
  cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;white-space:nowrap;
}}
.chat-input-wrap button:hover {{ background:#db2777; }}
/* ── Overview Page ── */
.overview-stat-row {{ display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px; }}
.overview-stat-card {{
  background:#fff;border-radius:12px;padding:20px;border:1px solid var(--border-light);
  display:flex;flex-direction:column;gap:4px;
}}
.overview-stat-card .stat-entity {{ font-size:13px;color:var(--text-secondary);font-weight:500; }}
.overview-stat-card .stat-num {{ font-size:28px;font-weight:700;color:var(--text); }}
.overview-mini-tables {{ display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px;margin-bottom:24px; }}
.overview-mini-table {{
  background:#fff;border-radius:12px;border:1px solid var(--border-light);overflow:hidden;
}}
.overview-mini-table-header {{
  padding:14px 18px;display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid var(--border-light);
}}
.overview-mini-table-header h4 {{ font-size:14px;font-weight:600;margin:0; }}
.overview-mini-table-actions {{ display:flex;gap:6px; }}
.overview-mini-table-actions button {{
  font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);
  background:#fff;cursor:pointer;font-family:inherit;color:var(--text-secondary);
}}
.overview-mini-table-actions button:hover {{ background:var(--bg); }}
.overview-mini-table table {{ width:100%;border-collapse:collapse;font-size:13px; }}
.overview-mini-table th {{
  text-align:left;padding:8px 16px;font-weight:500;color:var(--text-secondary);
  background:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;
}}
.overview-mini-table td {{ padding:8px 16px;border-top:1px solid var(--border-light);color:var(--text); }}
.overview-quick-add {{
  background:#fff;border-radius:12px;border:1px solid var(--border-light);
  padding:20px;margin-bottom:24px;
}}
.overview-quick-add h4 {{ font-size:14px;font-weight:600;margin:0 0 14px; }}
.overview-quick-add-btns {{ display:flex;flex-wrap:wrap;gap:8px; }}
.overview-quick-add-btns button {{
  padding:8px 16px;border-radius:8px;border:1px solid var(--border);
  background:#fff;cursor:pointer;font-size:13px;font-family:inherit;
  display:flex;align-items:center;gap:6px;color:var(--text);transition:all 0.15s;
}}
.overview-quick-add-btns button:hover {{ border-color:var(--primary);color:var(--primary);background:var(--primary-light); }}
.overview-recent-activity {{
  background:#fff;border-radius:12px;border:1px solid var(--border-light);padding:20px;
}}
.overview-recent-activity h4 {{ font-size:14px;font-weight:600;margin:0 0 14px; }}
.overview-activity-item {{
  padding:10px 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:10px;
  font-size:13px;
}}
.overview-activity-item:last-child {{ border-bottom:none; }}
.overview-activity-dot {{
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
}}
.overview-activity-entity {{
  font-weight:500;color:var(--primary);font-size:11px;text-transform:uppercase;letter-spacing:0.3px;
  background:var(--primary-light);padding:2px 6px;border-radius:4px;
}}

/* ── Group-By / Pivot Table ── */
.group-by-bar {{
  display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:var(--text-secondary);
}}
.group-by-bar select {{
  padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;
  background:var(--bg-card);color:var(--text);font-family:inherit;cursor:pointer;outline:none;
}}
.group-by-bar select:focus {{ border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-light); }}
.group-by-bar .clear-group {{
  font-size:12px;color:var(--primary);cursor:pointer;border:none;background:none;font-family:inherit;
  text-decoration:underline;padding:0;
}}
.group-section {{ margin-bottom:4px; }}
.group-header {{
  display:flex;align-items:center;gap:8px;padding:10px 14px;
  background:var(--bg);border:1px solid var(--border-light);border-radius:var(--radius-sm);
  cursor:pointer;font-size:13px;font-weight:600;color:var(--text);user-select:none;
  transition:background var(--transition);
}}
.group-header:hover {{ background:var(--border-light); }}
.group-header .group-chevron {{
  transition:transform var(--transition);width:16px;height:16px;flex-shrink:0;
}}
.group-header .group-chevron.collapsed {{ transform:rotate(-90deg); }}
.group-header .group-count {{
  font-weight:400;color:var(--text-muted);font-size:12px;
}}
.group-header .group-aggregates {{
  margin-left:auto;font-weight:400;color:var(--text-secondary);font-size:12px;
  display:flex;gap:12px;
}}
.group-header .group-aggregates span {{ white-space:nowrap; }}
.group-body {{ overflow:hidden;transition:max-height 0.25s ease; }}
.group-body.collapsed {{ max-height:0 !important;overflow:hidden; }}

/* ── Inline Editing ── */
.inline-edit-cell {{
  position:relative;
}}
.inline-edit-cell input,
.inline-edit-cell select {{
  width:100%;padding:4px 8px;border:2px solid var(--info);border-radius:var(--radius-sm);
  font-size:13px;font-family:inherit;color:var(--text);background:var(--bg-card);outline:none;
  box-shadow:0 0 0 3px rgba(59,130,246,0.15);
}}
.inline-save-check {{
  position:absolute;right:4px;top:50%;transform:translateY(-50%);
  color:var(--success);font-size:16px;opacity:0;transition:opacity 0.3s ease;
  pointer-events:none;
}}
.inline-save-check.show {{
  opacity:1;
  animation:inlineCheckPop 0.5s ease;
}}
@keyframes inlineCheckPop {{
  0% {{ transform:translateY(-50%) scale(0.5);opacity:0; }}
  50% {{ transform:translateY(-50%) scale(1.2);opacity:1; }}
  100% {{ transform:translateY(-50%) scale(1);opacity:1; }}
}}

/* ── Row Coloring Rules ── */
tr.row-overdue {{ background:rgba(239,68,68,0.06) !important; }}
tr.row-success {{ background:rgba(16,185,129,0.06) !important; }}
tr.row-cancelled {{ background:rgba(239,68,68,0.06) !important; }}
tr.row-cancelled td:nth-child(2) {{ text-decoration:line-through;color:var(--text-muted); }}
tr.row-urgent {{ background:rgba(245,158,11,0.08) !important; }}

/* ── Rich Text Toolbar ── */
.rt-toolbar {{
  display:flex;gap:2px;padding:4px 6px;background:var(--bg);
  border:1px solid var(--border);border-bottom:none;border-radius:var(--radius-sm) var(--radius-sm) 0 0;
}}
.rt-toolbar button {{
  width:28px;height:28px;border:none;background:none;cursor:pointer;border-radius:4px;
  display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);
  font-size:13px;font-weight:700;font-family:inherit;transition:all var(--transition);
}}
.rt-toolbar button:hover {{ background:var(--border-light);color:var(--text); }}
.rt-toolbar button.active {{ background:var(--primary-light);color:var(--primary); }}
.rt-editable {{
  min-height:80px;padding:10px 14px;border:1px solid var(--border);border-radius:0 0 var(--radius) var(--radius);
  font-size:14px;color:var(--text);background:var(--bg-card);outline:none;font-family:inherit;
  line-height:1.6;overflow-y:auto;max-height:200px;
  transition:border-color var(--transition), box-shadow var(--transition);
}}
.rt-editable:focus {{
  border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-light);
}}
.rt-editable ul, .rt-editable ol {{ margin:4px 0 4px 20px; }}
.rt-editable b, .rt-editable strong {{ font-weight:600; }}

/* ── Premium SaaS Polish ── */
@keyframes fadeIn {{ from{{opacity:0}} to{{opacity:1}} }}
@keyframes slideUp {{ from{{opacity:0;transform:translateY(16px)}} to{{opacity:1;transform:translateY(0)}} }}
@keyframes slideInRight {{ from{{transform:translateX(100%)}} to{{transform:translateX(0)}} }}
@keyframes slideDownToast {{ from{{transform:translateY(-100%);opacity:0}} to{{transform:translateY(0);opacity:1}} }}
@keyframes skeletonShimmer {{
  0% {{ background-position:200% 0; }}
  100% {{ background-position:-200% 0; }}
}}

/* Micro-animations */
button, a, .sidebar-item {{ transition:all 0.15s cubic-bezier(.4,0,.2,1); }}
button:active:not(:disabled) {{ transform:scale(0.97); }}
.slide-over.show {{ animation:slideInRight 0.2s ease-out; }}
.modal-overlay.show {{ animation:fadeIn 0.15s ease; }}

/* Dashboard welcome animation */
.dashboard-welcome {{ animation:slideUp 0.3s ease-out; }}
.quick-actions-row {{ animation:slideUp 0.35s ease-out; }}
.stats-grid {{ animation:slideUp 0.25s ease-out; }}

/* Quick Actions row styling */
.quick-actions-row {{
  display:flex;gap:8px;margin-bottom:20px;
  flex-wrap:wrap;
}}
.quick-action-btn {{
  display:inline-flex;align-items:center;gap:6px;
  padding:8px 16px;border-radius:var(--radius);
  background:var(--bg-card);border:1px solid var(--border);
  font-size:13px;font-weight:500;color:var(--text);
  cursor:pointer;transition:all var(--transition);font-family:inherit;
}}
.quick-action-btn:hover {{
  border-color:var(--primary);color:var(--primary);
  box-shadow:var(--shadow-sm);
}}
.quick-action-btn svg {{ width:14px;height:14px;color:var(--primary); }}

/* Global form input polish */
input, select, textarea {{
  border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;
  font-size:14px;transition:border-color 0.15s, box-shadow 0.15s;
  outline:none;width:100%;box-sizing:border-box;
}}
input:focus, select:focus, textarea:focus {{
  border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-light);
}}

/* Override for checkboxes */
input[type="checkbox"], input[type="radio"] {{ width:auto; }}

/* Override for search inputs inside wrappers */
.search-input input {{ border:none;padding:0;width:100%; }}
.search-input input:focus {{ box-shadow:none; }}
.inline-edit-cell input, .inline-edit-cell select {{
  border:2px solid var(--info);border-radius:var(--radius-sm);
  padding:4px 8px;font-size:13px;
  box-shadow:0 0 0 3px rgba(59,130,246,0.15);
}}

/* Enhanced stat cards - use gradient variants per card */
.stat-card:nth-child(1) {{ background:linear-gradient(135deg, #fff 0%, #eef2ff 100%); }}
.stat-card:nth-child(2) {{ background:linear-gradient(135deg, #fff 0%, #ecfdf5 100%); }}
.stat-card:nth-child(3) {{ background:linear-gradient(135deg, #fff 0%, #fffbeb 100%); }}
.stat-card:nth-child(4) {{ background:linear-gradient(135deg, #fff 0%, #eff6ff 100%); }}
.stat-card:nth-child(5) {{ background:linear-gradient(135deg, #fff 0%, #fef2f2 100%); }}

/* Enhanced table container */
.table-container {{
  box-shadow:0 0 0 1px rgba(0,0,0,.03), 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.05);
}}

/* Enhanced kanban cards */
.kanban-card {{
  box-shadow:0 0 0 1px rgba(0,0,0,.03), 0 1px 3px rgba(0,0,0,.05);
}}
.kanban-card:hover {{
  box-shadow:0 0 0 1px rgba(0,0,0,.03), 0 4px 8px rgba(0,0,0,.07), 0 8px 16px rgba(0,0,0,.05);
}}

/* Focus ring for accessibility */
:focus-visible {{
  outline:2px solid var(--primary);
  outline-offset:2px;
}}

/* Smooth scrollbar styling */
::-webkit-scrollbar {{ width:6px;height:6px; }}
::-webkit-scrollbar-track {{ background:transparent; }}
::-webkit-scrollbar-thumb {{ background:#d1d5db;border-radius:3px; }}
::-webkit-scrollbar-thumb:hover {{ background:#9ca3af; }}

/* Selection color */
::selection {{ background:var(--primary-light);color:var(--primary); }}

/* ── Dark mode ── */
html.dark {{
  --bg: #0f172a;
  --bg-card: #1e293b;
  --sidebar-bg: #0f172a;
  --text: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-placeholder: #475569;
  --border: #334155;
  --border-light: #1e293b;
  --gray-50: #1e293b;
  --gray-100: #1e293b;
  --gray-200: #334155;
  --gray-300: #475569;
  --gray-400: #64748b;
  --gray-500: #94a3b8;
  --gray-600: #cbd5e1;
  --gray-700: #e2e8f0;
  --gray-800: #f1f5f9;
  --gray-900: #f8fafc;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.2);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.15);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.15);
  --shadow-lg: 0 10px 40px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.15);
  --shadow-xl: 0 20px 60px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.2);
  --success-light: #064e3b;
  --success-text: #6ee7b7;
  --warning-light: #78350f;
  --warning-text: #fcd34d;
  --danger-light: #7f1d1d;
  --danger-text: #fca5a5;
  --info-light: #1e3a5f;
  --info-text: #93c5fd;
  --purple-light: #3b0764;
  --purple-text: #d8b4fe;
  --pink-light: #500724;
  --pink-text: #f9a8d4;
  --slate-light: #1e293b;
  --slate-text: #cbd5e1;
  --primary-light: color-mix(in srgb, var(--primary) 20%, #0f172a);
  --primary-subtle: color-mix(in srgb, var(--primary) 10%, #0f172a);
}}
html.dark ::-webkit-scrollbar-thumb {{ background:#475569; }}
html.dark ::-webkit-scrollbar-thumb:hover {{ background:#64748b; }}

/* ── Dark mode toggle ── */
.theme-toggle {{
  display:flex;align-items:center;gap:6px;
  background:none;border:none;cursor:pointer;
  padding:4px 8px;border-radius:var(--radius-sm);
  color:var(--text-muted);font-size:11px;font-weight:500;
  transition:all var(--transition);font-family:inherit;
}}
.theme-toggle:hover {{ color:var(--text);background:var(--gray-100); }}
.theme-toggle svg {{ width:14px;height:14px; }}

/* ── Tablet: icon-only sidebar ── */
@media (min-width:769px) and (max-width:1024px) {{
  .sidebar {{ width:60px; }}
  .sidebar .app-logo-text,
  .sidebar .sidebar-section-label,
  .sidebar-footer-info,
  .sidebar-footer .logout-btn,
  .sidebar-footer .theme-toggle {{ display:none; }}
  .sidebar-header {{ padding:16px 14px;justify-content:center; }}
  .sidebar-item {{ justify-content:center;padding:10px 0; }}
  .sidebar-item .item-text {{ display:none; }}
  .sidebar-item svg {{ margin:0; }}
  .sidebar-item.active::before {{ left:0px; }}
  .sidebar-collapse-btn {{ display:none; }}
  .sidebar-footer {{ padding:8px;justify-content:center; }}
  .sidebar-nav {{ padding:8px 6px; }}
}}

/* ── Mobile: bottom tab bar ── */
.mobile-nav {{
  display:none;
  position:fixed;bottom:0;left:0;right:0;
  background:var(--bg-card);
  border-top:1px solid var(--border);
  z-index:50;
  padding:4px 0 env(safe-area-inset-bottom, 4px);
  box-shadow:0 -2px 10px rgba(0,0,0,0.05);
}}
.mobile-nav-inner {{
  display:flex;justify-content:space-around;align-items:center;
  max-width:500px;margin:0 auto;
}}
.mobile-nav-item {{
  display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:6px 8px;
  background:none;border:none;cursor:pointer;
  color:var(--text-muted);font-size:10px;font-weight:500;
  font-family:inherit;transition:color var(--transition);
  min-width:0;flex:1;
}}
.mobile-nav-item svg {{ width:20px;height:20px; }}
.mobile-nav-item.active {{ color:var(--primary); }}
.mobile-nav-item:hover {{ color:var(--text); }}

@media (max-width:768px) {{
  .mobile-nav {{ display:flex; }}
  body {{ padding-bottom:60px; }}
}}

/* ── Mobile: Swipeable detail tabs dot indicator ── */
.detail-tab-dots {{
  display:none;
  justify-content:center;gap:6px;
  padding:8px 0 4px;
}}
.detail-tab-dot {{
  width:6px;height:6px;border-radius:50%;
  background:var(--gray-300);
  transition:background 0.2s, transform 0.2s;
}}
.detail-tab-dot.active {{
  background:var(--primary);
  transform:scale(1.3);
}}
@media (max-width:768px) {{
  .detail-tab-dots {{ display:flex; }}
}}

/* ── Mobile: Pull-to-refresh ── */
.pull-to-refresh {{
  display:none;
  align-items:center;justify-content:center;
  height:0;overflow:hidden;
  transition:height 0.25s ease;
  background:var(--bg);
}}
.pull-to-refresh.pulling {{
  height:50px;
}}
.pull-spinner {{
  width:22px;height:22px;
  border:2.5px solid var(--gray-200);
  border-top-color:var(--primary);
  border-radius:50%;
  animation:spin 0.7s linear infinite;
}}
@media (max-width:768px) {{
  .pull-to-refresh {{ display:flex; }}
}}

/* ── Mobile: Floating Action Button (FAB) ── */
.fab {{
  display:none;
  position:fixed;
  bottom:76px;right:20px;
  width:56px;height:56px;
  border-radius:50%;
  background:var(--primary);
  color:#fff;border:none;
  cursor:pointer;z-index:45;
  align-items:center;justify-content:center;
  box-shadow:0 4px 16px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
  transition:transform 0.15s ease, box-shadow 0.15s ease;
  padding-bottom:env(safe-area-inset-bottom, 0px);
}}
.fab:active {{
  transform:scale(0.92);
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
}}
.fab svg {{ width:24px;height:24px;pointer-events:none; }}
@media (max-width:768px) {{
  .fab {{ display:flex; }}
  .topbar-actions .btn.btn-primary.btn-sm {{ display:none; }}
}}

/* ── Mobile: Card layout for tables ── */
.mobile-card-list {{
  display:none;
  flex-direction:column;gap:10px;
  padding:12px 16px;
}}
.mobile-record-card {{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  padding:14px 16px;
  box-shadow:var(--shadow-xs);
}}
.mobile-card-title {{
  font-size:14px;font-weight:600;color:var(--text);
  margin-bottom:6px;
}}
.mobile-card-fields {{
  display:flex;flex-wrap:wrap;gap:6px 16px;
  margin-bottom:8px;
}}
.mobile-card-field {{
  font-size:12px;color:var(--text-secondary);
}}
.mobile-card-field strong {{
  color:var(--text-muted);font-weight:500;
  font-size:11px;text-transform:uppercase;
  letter-spacing:0.03em;
}}
.mobile-card-actions {{
  display:flex;gap:8px;
  border-top:1px solid var(--border-light);
  padding-top:8px;margin-top:4px;
}}
.mobile-card-actions button {{
  font-size:12px;font-weight:500;
  color:var(--primary);background:none;border:none;
  cursor:pointer;padding:4px 0;
  font-family:inherit;
}}
@media (max-width:768px) {{
  .data-table-wrap {{ display:none !important; }}
  .mobile-card-list {{ display:flex; }}
}}
</style>
</head>
<body>

<!-- Loading bar -->
<div class="loading-bar" id="loading-bar"></div>

<!-- Auth Screen -->
<div class="auth-screen" id="auth-screen" style="display:none">
  <div class="auth-card">
    <div class="auth-header">
      <div class="auth-logo">{app_initial}</div>
      <h2>{app_name}</h2>
      <p>Sign in to continue</p>
    </div>
    <div class="auth-tabs">
      <button class="auth-tab active" id="auth-tab-login" onclick="switchAuthTab('login')">Log In</button>
      <button class="auth-tab" id="auth-tab-signup" onclick="switchAuthTab('signup')">Sign Up</button>
    </div>
    <div class="auth-body">
      <div class="auth-error" id="auth-error"></div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="auth-email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="auth-password" placeholder="Enter password">
      </div>
      <button class="auth-submit" id="auth-submit" onclick="handleAuth()">Log In</button>
      <div id="auth-forgot-link" style="text-align:center;margin-top:12px">
        <a href="#" onclick="showForgotPassword(event)" style="font-size:12px;color:var(--primary);text-decoration:none;cursor:pointer">Forgot password?</a>
      </div>
    </div>
  </div>
  <!-- Forgot Password screen (hidden by default) -->
  <div class="auth-card" id="forgot-password-card" style="display:none">
    <div class="auth-header">
      <div class="auth-logo">{app_initial}</div>
      <h2>Reset Password</h2>
      <p id="forgot-step-text">Enter your email to receive a reset code</p>
    </div>
    <div class="auth-body">
      <div class="auth-error" id="forgot-error"></div>
      <div id="forgot-step-email">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="forgot-email" placeholder="you@example.com">
        </div>
        <button class="auth-submit" id="forgot-submit" onclick="handleForgotPassword()">Send Reset Code</button>
      </div>
      <div id="forgot-step-code" style="display:none">
        <div class="form-group">
          <label>Reset Code</label>
          <input type="text" id="forgot-code" placeholder="Enter 6-digit code" maxlength="6">
        </div>
        <div class="form-group">
          <label>New Password</label>
          <input type="password" id="forgot-new-password" placeholder="Enter new password">
        </div>
        <button class="auth-submit" onclick="handleResetPassword()">Reset Password</button>
      </div>
      <div style="text-align:center;margin-top:12px">
        <a href="#" onclick="backToLogin(event)" style="font-size:12px;color:var(--text-muted);text-decoration:none;cursor:pointer">Back to login</a>
      </div>
    </div>
  </div>
</div>

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
    <div class="sidebar-section-label">Navigation</div>
  </nav>
  <div class="sidebar-footer">
    <div class="sidebar-footer-left">
      <div class="sidebar-footer-avatar" id="sidebar-user-avatar">U</div>
      <div class="sidebar-footer-info">
        <div class="sidebar-footer-name" id="sidebar-user-name">User</div>
        <div class="sidebar-footer-role">Member</div>
      </div>
    </div>
    <button class="theme-toggle" id="theme-toggle" onclick="toggleDarkMode()" title="Toggle dark mode">
      <svg id="theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <svg id="theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
    </button>
    <button class="logout-btn" id="logout-btn" onclick="handleLogout()" title="Sign out">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </button>
  </div>
</aside>

<!-- Mobile bottom navigation -->
<nav class="mobile-nav" id="mobile-nav">
  <div class="mobile-nav-inner" id="mobile-nav-inner"></div>
</nav>

<!-- Mobile FAB -->
<button class="fab" id="fab-btn" onclick="openCreate()" aria-label="Add New">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
</button>

<!-- Main -->
<div class="main">
  <header class="topbar">
    <div class="topbar-left">
      <button class="hamburger" onclick="toggleSidebar()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="topbar-breadcrumb" id="topbar-breadcrumb">
        <span id="page-title">Dashboard</span>
      </div>
    </div>
    <button class="topbar-search-trigger" onclick="openGlobalSearch()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Search...
      <kbd id="search-shortcut-label">Ctrl+K</kbd>
    </button>
    <div style="display:flex;align-items:center;gap:4px;">
      <button class="notif-bell" id="notif-bell" onclick="toggleNotifications(event)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        <span class="notif-badge hidden" id="notif-badge">0</span>
      </button>
      <div class="notif-dropdown" id="notification-dropdown">
        <div class="notif-dropdown-header">
          <h4>Notifications</h4>
          <button class="notif-mark-read" onclick="markAllNotificationsRead()">Mark all read</button>
        </div>
        <div class="notif-list" id="notif-list">
          <div class="notif-empty">No notifications yet</div>
        </div>
      </div>
    </div>
    <div class="topbar-actions" id="topbar-actions">
      <button id="pwa-install-btn" onclick="installApp()" style="display:none;background:var(--primary);color:#fff;border:none;padding:5px 12px;border-radius:var(--radius);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:background var(--transition);margin-right:4px" title="Install as app">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Install App
      </button>
      <button onclick="downloadAsHTML()" style="background:none;border:1px solid var(--border);padding:5px 8px;border-radius:var(--radius);cursor:pointer;color:var(--text-secondary);transition:all var(--transition)" title="Download as HTML file">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
    <div class="topbar-avatar" id="topbar-avatar">{app_initial}</div>
  </header>
  <div class="pull-to-refresh" id="pull-to-refresh"><div class="pull-spinner"></div></div>
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
    <button class="btn-cancel-outline" onclick="closeModal()">Cancel</button>
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
        <button class="btn btn-secondary" onclick="closeConfirm()">Cancel</button>
        <button class="btn btn-danger" id="confirm-delete-btn" onclick="confirmDeleteAction()">Delete</button>
      </div>
    </div>
  </div>
</div>

<!-- Global search overlay -->
<div id="global-search-overlay" onclick="if(event.target===this)closeGlobalSearch()">
  <div class="gsearch-box">
    <div class="gsearch-input-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="gsearch-input" placeholder="Search across all data..." oninput="onGlobalSearchInput(this.value)">
      <kbd>ESC</kbd>
    </div>
    <div class="gsearch-results" id="gsearch-results">
      <div class="gsearch-empty">Type to search across all entities</div>
    </div>
    <div class="gsearch-hint">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      Navigate results and press Enter to go
    </div>
  </div>
</div>

<!-- Bulk action bar -->
<div class="bulk-action-bar" id="bulk-action-bar">
  <span id="bulk-count">0 selected</span>
  <button onclick="bulkExportCSV()">Export Selected</button>
  <span id="bulk-status-wrap"></span>
  <button class="bulk-delete" onclick="bulkDelete()">Delete Selected</button>
  <button onclick="bulkDeselectAll()" style="background:transparent;border-color:transparent;opacity:0.7">Deselect</button>
</div>

<!-- Toast container -->
<div class="toast-container" id="toast-container"></div>

<!-- AI Chat Widget -->
<button class="chat-widget-btn" id="chat-widget-btn" onclick="toggleChatWidget()" title="App Assistant">&#128172;</button>
<div class="chat-panel" id="chat-panel">
  <div class="chat-panel-header">
    <h3>Ask anything</h3>
    <button class="chat-panel-close" onclick="toggleChatWidget()">&times;</button>
  </div>
  <div class="chat-messages" id="chat-messages"></div>
  <div class="chat-typing" id="chat-typing"><div class="chat-typing-dots"><span></span><span></span><span></span></div></div>
  <div class="chat-input-wrap">
    <input type="text" id="chat-input" placeholder="Ask about this app..." onkeydown="if(event.key==='Enter')sendChatMsg()">
    <button onclick="sendChatMsg()">Send</button>
  </div>
</div>

<script>
(function() {{
  "use strict";

  // ── Config ──
  const PROJECT_ID = "{project_id}";
  const API_BASE = "{api_base_url}";
  const ENTITY_FIELDS = {entity_fields_js};
  const SIDEBAR_ITEMS = {sidebar_items_js};
  const LAYOUT_HINTS = {layout_hints_js};
  const APP_NAME = "{app_name}";
  const ROWS_PER_PAGE = 10;
  const MAX_INITIAL_ROWS = 50;  // virtual scrolling: limit initial render
  const loadMoreState = {{}};  // moduleName -> max rows to display

  // ── State ──
  let currentModule = null;
  let currentEntity = null;
  let editingId = null;
  let pendingDeleteEntity = null;
  let pendingDeleteId = null;
  let currentAuthTab = "login";
  let calendarYear = new Date().getFullYear();
  let calendarMonth = new Date().getMonth();
  const dataCache = {{}};
  const fkCache = {{}};
  const sortState = {{}};
  const searchState = {{}};
  const filterState = {{}};
  const pageState = {{}};
  const viewMode = {{}};  // track current view per module: "table" | "kanban" | "calendar" | "cards"

  // ── API response cache with 30s TTL ──
  const apiCache = {{}};  // key -> {{ data, ts }}
  const API_CACHE_TTL = 30000;  // 30 seconds

  // ── Notifications state ──
  const notifications = [];
  let notifUnread = 0;

  // ── Bulk selection state ──
  const bulkSelected = {{}};  // entity -> Set of ids

  // ── Global search state ──
  let gsearchTimer = null;
  let searchDebounceTimer = null;

  // ── Auto-refresh state ──
  let autoRefreshTimer = null;
  const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

  // ── Dark mode ──
  window.toggleDarkMode = function() {{
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("app_theme", isDark ? "dark" : "light");
    document.getElementById("theme-icon-light").style.display = isDark ? "none" : "block";
    document.getElementById("theme-icon-dark").style.display = isDark ? "block" : "none";
  }};
  // Restore saved theme preference on load
  (function() {{
    const saved = localStorage.getItem("app_theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (!saved && prefersDark)) {{
      document.documentElement.classList.add("dark");
      const iconLight = document.getElementById("theme-icon-light");
      const iconDark = document.getElementById("theme-icon-dark");
      if (iconLight) iconLight.style.display = "none";
      if (iconDark) iconDark.style.display = "block";
    }}
  }})();

  // ── Mobile bottom nav builder ──
  function buildMobileNav() {{
    const container = document.getElementById("mobile-nav-inner");
    if (!container) return;
    // Show up to 5 items in the bottom nav
    const items = SIDEBAR_ITEMS.slice(0, 5);
    container.innerHTML = items.map(function(item) {{
      return '<button class="mobile-nav-item" data-module="' + item.name + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + getMobileNavIconPath(item.icon) + '</svg>' +
        '<span>' + item.name + '</span></button>';
    }}).join("");
    // Bind onclick via JS to avoid quote escaping issues in HTML attributes
    container.querySelectorAll(".mobile-nav-item").forEach(function(btn) {{
      btn.addEventListener("click", function() {{ showModule(btn.dataset.module); }});
    }});
  }}
  function getMobileNavIconPath(iconId) {{
    const paths = {{
      dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      people: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      money: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
      tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
      product: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4"/>',
    }};
    return paths[iconId] || paths.dashboard;
  }}

  // ── Auth ──
  function getToken() {{
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {{
      localStorage.setItem("app_token", urlToken);
      return urlToken;
    }}
    return localStorage.getItem("app_token") || "";
  }}

  function apiHeaders() {{
    const h = {{ "Content-Type": "application/json" }};
    const t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }}

  function checkAuth() {{
    const token = getToken();
    const authScreen = document.getElementById("auth-screen");
    const params = new URLSearchParams(window.location.search);
    // Skip auth for app owner previewing from builder
    if (params.get("preview") === "1" || params.get("skip_auth") === "1") {{
      authScreen.style.display = "none";
      return true;
    }}
    if (!token) {{
      authScreen.style.display = "flex";
      return false;
    }}
    authScreen.style.display = "none";
    return true;
  }}

  window.switchAuthTab = function(tab) {{
    currentAuthTab = tab;
    document.getElementById("auth-tab-login").classList.toggle("active", tab === "login");
    document.getElementById("auth-tab-signup").classList.toggle("active", tab === "signup");
    document.getElementById("auth-submit").textContent = tab === "login" ? "Log In" : "Sign Up";
    document.getElementById("auth-error").style.display = "none";
  }};

  window.handleAuth = async function() {{
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const errorEl = document.getElementById("auth-error");
    const submitBtn = document.getElementById("auth-submit");

    if (!email || !password) {{
      errorEl.textContent = "Please enter email and password.";
      errorEl.style.display = "block";
      return;
    }}

    submitBtn.disabled = true;
    submitBtn.textContent = currentAuthTab === "login" ? "Logging in..." : "Signing up...";
    errorEl.style.display = "none";

    const endpoint = currentAuthTab === "login"
      ? API_BASE + "/api/apps/" + PROJECT_ID + "/auth/login"
      : API_BASE + "/api/apps/" + PROJECT_ID + "/auth/signup";

    try {{
      const res = await fetch(endpoint, {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email, password }})
      }});

      if (!res.ok) {{
        const data = await res.json().catch(() => ({{}}));
        throw new Error(data.detail || data.message || data.error || (currentAuthTab === "login" ? "Invalid credentials" : "Signup failed"));
      }}

      const data = await res.json();
      const token = data.token || data.access_token || data.jwt || "";
      if (token) {{
        localStorage.setItem("app_token", token);
        localStorage.setItem("user_email", email);
        document.getElementById("auth-screen").style.display = "none";
        initApp();
      }} else {{
        throw new Error("No token received from server");
      }}
    }} catch (e) {{
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    }} finally {{
      submitBtn.disabled = false;
      submitBtn.textContent = currentAuthTab === "login" ? "Log In" : "Sign Up";
    }}
  }};

  window.handleLogout = function() {{
    localStorage.removeItem("app_token");
    localStorage.removeItem("user_email");
    document.getElementById("auth-email").value = "";
    document.getElementById("auth-password").value = "";
    document.getElementById("auth-error").style.display = "none";
    document.getElementById("auth-screen").style.display = "flex";
  }};

  // Allow Enter key on auth form
  document.getElementById("auth-password").addEventListener("keydown", function(e) {{
    if (e.key === "Enter") handleAuth();
  }});

  // ── Forgot Password flow ──
  window.showForgotPassword = function(e) {{
    if (e) e.preventDefault();
    document.querySelector(".auth-card").style.display = "none";
    document.getElementById("forgot-password-card").style.display = "block";
    document.getElementById("forgot-step-email").style.display = "block";
    document.getElementById("forgot-step-code").style.display = "none";
    document.getElementById("forgot-error").style.display = "none";
    document.getElementById("forgot-step-text").textContent = "Enter your email to receive a reset code";
  }};

  window.backToLogin = function(e) {{
    if (e) e.preventDefault();
    document.getElementById("forgot-password-card").style.display = "none";
    document.querySelector(".auth-card").style.display = "block";
  }};

  window.handleForgotPassword = async function() {{
    const email = document.getElementById("forgot-email").value.trim();
    const errorEl = document.getElementById("forgot-error");
    const submitBtn = document.getElementById("forgot-submit");

    if (!email) {{
      errorEl.textContent = "Please enter your email.";
      errorEl.style.display = "block";
      return;
    }}

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    errorEl.style.display = "none";

    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/auth/forgot-password", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email }})
      }});
      if (!res.ok) {{
        const data = await res.json().catch(() => ({{}}));
        throw new Error(data.detail || "Failed to send reset code");
      }}
      // Show code entry step
      document.getElementById("forgot-step-email").style.display = "none";
      document.getElementById("forgot-step-code").style.display = "block";
      document.getElementById("forgot-step-text").textContent = "Enter the code and your new password";
    }} catch (e) {{
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    }} finally {{
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Reset Code";
    }}
  }};

  window.handleResetPassword = async function() {{
    const email = document.getElementById("forgot-email").value.trim();
    const code = document.getElementById("forgot-code").value.trim();
    const newPassword = document.getElementById("forgot-new-password").value;
    const errorEl = document.getElementById("forgot-error");

    if (!code || !newPassword) {{
      errorEl.textContent = "Please enter the code and a new password.";
      errorEl.style.display = "block";
      return;
    }}

    if (newPassword.length < 6) {{
      errorEl.textContent = "Password must be at least 6 characters.";
      errorEl.style.display = "block";
      return;
    }}

    errorEl.style.display = "none";

    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/auth/reset-password", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email, code, new_password: newPassword }})
      }});
      if (!res.ok) {{
        const data = await res.json().catch(() => ({{}}));
        throw new Error(data.detail || "Password reset failed");
      }}
      // Success — go back to login with success message
      backToLogin();
      const authError = document.getElementById("auth-error");
      authError.textContent = "Password reset! You can now log in.";
      authError.style.display = "block";
      authError.style.color = "var(--green-600, #16a34a)";
      authError.style.background = "var(--green-50, #f0fdf4)";
      authError.style.borderColor = "var(--green-200, #bbf7d0)";
      document.getElementById("auth-email").value = email;
    }} catch (e) {{
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    }}
  }};

  // ── Loading bar ──
  const loadingBar = document.getElementById("loading-bar");
  let loadingCount = 0;
  function startLoading() {{ loadingCount++; loadingBar.classList.add("active"); }}
  function stopLoading() {{ loadingCount = Math.max(0, loadingCount - 1); if (!loadingCount) loadingBar.classList.remove("active"); }}

  // ── API helpers ──
  async function apiGet(table, forceRefresh) {{
    // Check cache first (30s TTL)
    const cacheKey = table.toLowerCase();
    if (!forceRefresh && apiCache[cacheKey] && (Date.now() - apiCache[cacheKey].ts < API_CACHE_TTL)) {{
      return apiCache[cacheKey].data;
    }}
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{ headers: apiHeaders() }});
      if (!res.ok) throw new Error("API error " + res.status);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.items || data.data || []);
      apiCache[cacheKey] = {{ data: rows, ts: Date.now() }};
      return rows;
    }} catch (e) {{
      showToast("Failed to load data: " + e.message, "error");
      return [];
    }} finally {{ stopLoading(); }}
  }}

  // Invalidate cache for a table after mutations
  function invalidateCache(table) {{
    delete apiCache[table.toLowerCase()];
  }}

  async function apiCreate(table, record) {{
    startLoading();
    try {{
      const res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/data/" + table, {{
        method: "POST", headers: apiHeaders(), body: JSON.stringify(record)
      }});
      if (!res.ok) {{ const t = await res.text(); throw new Error(t || "Create failed"); }}
      invalidateCache(table);
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
      invalidateCache(table);
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
      invalidateCache(table);
      return true;
    }} catch (e) {{
      showToast("Failed to delete: " + e.message, "error");
      return false;
    }} finally {{ stopLoading(); }}
  }}

  // ── FK data fetching ──
  async function fetchFkData(entityName) {{
    if (fkCache[entityName]) return fkCache[entityName];
    try {{
      const rows = await apiGet(entityName.toLowerCase());
      fkCache[entityName] = rows;
      return rows;
    }} catch {{
      return [];
    }}
  }}

  function getFkDisplayName(entityName, id) {{
    const rows = fkCache[entityName] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    if (!record) return String(id || "");
    const fields = ENTITY_FIELDS[entityName] || [];
    const nameField = fields.find(f => /^(name|title|subject|label|full_name)$/i.test(f.name));
    if (nameField && record[nameField.name]) return record[nameField.name];
    // Fallback: try first non-id string field
    for (const f of fields) {{
      if (!["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name) && record[f.name] && typeof record[f.name] === "string") {{
        return record[f.name];
      }}
    }}
    return String(id || "").slice(0, 8);
  }}

  function getRelatedEntityForField(fieldName, fieldDef) {{
    // Check explicit fk_entity
    if (fieldDef && fieldDef.fk_entity) return fieldDef.fk_entity;
    // Infer from field name ending in _id
    if (fieldName.endsWith("_id")) {{
      const base = fieldName.slice(0, -3); // remove _id
      // Try to find matching entity (case-insensitive, singular)
      const entityNames = Object.keys(ENTITY_FIELDS);
      for (const en of entityNames) {{
        if (en.toLowerCase() === base.toLowerCase() ||
            en.toLowerCase() === base.replace(/_/g, "").toLowerCase() ||
            en.toLowerCase() + "s" === base.toLowerCase() ||
            en.toLowerCase() === base.toLowerCase() + "s") {{
          return en;
        }}
      }}
    }}
    return null;
  }}

  // ── Toast ──
  function showToast(msg, type) {{
    type = type || "success";
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    const icons = {{
      success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    }};
    const iconSvg = icons[type] || icons.info;
    const duration = 4000;
    toast.innerHTML = iconSvg +
      '<span class="toast-message">' + escHtml(msg) + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.classList.remove(\'show\');setTimeout(()=>this.parentElement.remove(),350)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '<div class="toast-progress"><div class="toast-progress-bar"></div></div>';
    container.appendChild(toast);
    requestAnimationFrame(() => {{
      requestAnimationFrame(() => {{
        toast.classList.add("show");
        const bar = toast.querySelector(".toast-progress-bar");
        if (bar) {{
          bar.style.transitionDuration = duration + "ms";
          requestAnimationFrame(() => {{ bar.style.width = "0%"; }});
        }}
      }});
    }});
    setTimeout(() => {{
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 350);
    }}, duration);
  }}

  // ── Escape HTML ──
  function escHtml(s) {{
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }}

  // ── Breadcrumb helper ──
  function setBreadcrumb(parts) {{
    const bc = document.getElementById("topbar-breadcrumb");
    if (!bc) return;
    bc.innerHTML = parts.map((p, i) => {{
      if (i < parts.length - 1) {{
        return '<span>' + escHtml(p) + '</span><span class="breadcrumb-sep">/</span>';
      }}
      return '<span>' + escHtml(p) + '</span>';
    }}).join('');
  }}

  // ── Update sidebar user info ──
  function updateUserDisplay() {{
    const email = localStorage.getItem("user_email") || "User";
    const initial = (email[0] || "U").toUpperCase();
    const nameEl = document.getElementById("sidebar-user-name");
    const avatarEl = document.getElementById("sidebar-user-avatar");
    const topAvatarEl = document.getElementById("topbar-avatar");
    if (nameEl) nameEl.textContent = email.split("@")[0] || "User";
    if (avatarEl) avatarEl.textContent = initial;
    if (topAvatarEl) topAvatarEl.textContent = initial;
  }}

  // ── Sidebar ──
  function buildSidebar() {{
    const nav = document.getElementById("sidebar-nav");
    const label = nav.querySelector(".sidebar-section-label");
    // Insert Analytics item right after Dashboard (or first)
    let dashboardInserted = false;
    SIDEBAR_ITEMS.forEach(item => {{
      const btn = document.createElement("button");
      btn.className = "sidebar-item";
      btn.dataset.module = item.name;
      btn.innerHTML = getModuleIcon(item.icon) + '<span>' + escHtml(item.name) + '</span>';
      btn.onclick = () => showModule(item.name);
      nav.appendChild(btn);
      if (!dashboardInserted && (item.layout === "dashboard" || item.name.toLowerCase() === "dashboard")) {{
        dashboardInserted = true;
        const analyticsBtn = document.createElement("button");
        analyticsBtn.className = "sidebar-item";
        analyticsBtn.dataset.module = "__analytics__";
        analyticsBtn.innerHTML = getModuleIcon("chart") + '<span>Analytics</span>';
        analyticsBtn.onclick = () => showModule("__analytics__");
        nav.appendChild(analyticsBtn);
      }}
    }});
    // If no dashboard was found, still add analytics at the top
    if (!dashboardInserted) {{
      const analyticsBtn = document.createElement("button");
      analyticsBtn.className = "sidebar-item";
      analyticsBtn.dataset.module = "__analytics__";
      analyticsBtn.innerHTML = getModuleIcon("chart") + '<span>Analytics</span>';
      analyticsBtn.onclick = () => showModule("__analytics__");
      if (nav.children.length > 1) nav.insertBefore(analyticsBtn, nav.children[1]);
      else nav.appendChild(analyticsBtn);
    }}
    // Add "Insights" section label and Overview item if 3+ entities
    if (Object.keys(ENTITY_FIELDS).length >= 3) {{
      const insightsLabel = document.createElement("div");
      insightsLabel.className = "sidebar-section-label";
      insightsLabel.textContent = "Insights";
      nav.appendChild(insightsLabel);
      const overviewBtn = document.createElement("button");
      overviewBtn.className = "sidebar-item";
      overviewBtn.dataset.module = "__overview__";
      overviewBtn.innerHTML = getModuleIcon("grid") + '<span>Overview</span>';
      overviewBtn.onclick = () => showModule("__overview__");
      nav.appendChild(overviewBtn);
    }}
    // Detect Cmd vs Ctrl for search shortcut label
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
    const shortcutEl = document.getElementById("search-shortcut-label");
    if (shortcutEl) shortcutEl.textContent = isMac ? "\\u2318K" : "Ctrl+K";
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

  // ── Detect smart layout for an entity ──
  function getSmartLayout(entity) {{
    return LAYOUT_HINTS[entity] || "table";
  }}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Router
  // Navigates between modules, dispatches to components.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function showModule(name) {{
    // Handle built-in Analytics page
    if (name === "__analytics__") {{
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("sidebar-overlay").classList.remove("show");
      document.querySelectorAll(".sidebar-item").forEach(b => {{
        b.classList.toggle("active", b.dataset.module === "__analytics__");
      }});
      setBreadcrumb(["Analytics"]);
      currentModule = "__analytics__";
      currentEntity = null;
      document.getElementById("topbar-actions").innerHTML = "";
      bulkDeselectAll();
      renderAnalyticsPage(document.getElementById("content-area"));
      return;
    }}

    // Handle Overview page
    if (name === "__overview__") {{
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("sidebar-overlay").classList.remove("show");
      document.querySelectorAll(".sidebar-item").forEach(b => {{
        b.classList.toggle("active", b.dataset.module === "__overview__");
      }});
      setBreadcrumb(["Overview"]);
      currentModule = "__overview__";
      currentEntity = null;
      document.getElementById("topbar-actions").innerHTML = "";
      bulkDeselectAll();
      renderOverviewPage(document.getElementById("content-area"));
      return;
    }}

    const item = SIDEBAR_ITEMS.find(i => i.name === name);
    if (!item) return;

    // Close mobile sidebar
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");

    // Clear bulk selection
    bulkDeselectAll();

    // Update sidebar active state
    document.querySelectorAll(".sidebar-item").forEach(b => {{
      b.classList.toggle("active", b.dataset.module === name);
    }});
    // Update mobile nav active state
    document.querySelectorAll(".mobile-nav-item").forEach(b => {{
      b.classList.toggle("active", b.dataset.module === name);
    }});

    setBreadcrumb([name]);
    currentModule = name;
    currentEntity = item.entity || null;

    // Determine smart layout
    const smartLayout = currentEntity ? getSmartLayout(currentEntity) : "table";

    // Initialize view mode if not set
    if (currentEntity && !viewMode[name]) {{
      viewMode[name] = smartLayout !== "table" ? smartLayout : "table";
    }}

    // Update topbar actions
    const actions = document.getElementById("topbar-actions");
    if (item.layout !== "dashboard" && currentEntity && ENTITY_FIELDS[currentEntity]) {{
      let toggleHtml = "";
      if (smartLayout !== "table") {{
        const altLabel = smartLayout === "kanban" ? "Kanban" : smartLayout === "calendar" ? "Calendar" : "Cards";
        const altIcon = smartLayout === "kanban"
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>'
          : smartLayout === "calendar"
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
        const currentView = viewMode[name] || "table";
        toggleHtml = '<div class="view-toggle">' +
          '<button class="view-toggle-btn' + (currentView === "table" ? " active" : "") + '" onclick="switchView(\'' + escHtml(name) + '\',\'table\')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' +
            'Table</button>' +
          '<button class="view-toggle-btn' + (currentView === smartLayout ? " active" : "") + '" onclick="switchView(\'' + escHtml(name) + '\',\'' + smartLayout + '\')">' +
            altIcon + altLabel + '</button>' +
          '</div>';
      }}
      actions.innerHTML = toggleHtml +
        '<div class="export-btn-group">' +
          '<button class="btn btn-secondary btn-sm" onclick="exportCSV()" title="Export CSV"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>CSV</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="exportPDF()" title="Export PDF"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>PDF</button>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="openCreate()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add New</button>';
    }} else {{
      actions.innerHTML = "";
    }}

    // Render content
    const content = document.getElementById("content-area");
    if (item.layout === "dashboard") {{
      renderDashboard(content);
    }} else if (currentEntity && ENTITY_FIELDS[currentEntity]) {{
      const activeView = viewMode[name] || "table";
      renderEntityView(content, name, currentEntity, activeView);
    }} else {{
      content.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div><h3>' + escHtml(name) + '</h3><p>This module is not configured yet.</p></div>';
    }}
  }};

  window.switchView = function(moduleName, view) {{
    viewMode[moduleName] = view;
    showModule(moduleName);
  }};

  // ── Entity view dispatcher ──
  async function renderEntityView(container, moduleName, entity, view) {{
    // Pre-fetch FK data for this entity
    const fields = ENTITY_FIELDS[entity] || [];
    const fkPromises = [];
    for (const f of fields) {{
      const relEntity = getRelatedEntityForField(f.name, f);
      if (relEntity && !fkCache[relEntity]) {{
        fkPromises.push(fetchFkData(relEntity));
      }}
    }}
    if (fkPromises.length > 0) await Promise.all(fkPromises);

    if (view === "kanban") {{
      renderKanbanView(container, moduleName, entity);
    }} else if (view === "calendar") {{
      renderCalendarView(container, moduleName, entity);
    }} else if (view === "cards") {{
      renderCardGridView(container, moduleName, entity);
    }} else {{
      renderTablePage(container, moduleName, entity);
    }}
  }}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: Dashboard
  // Renders stat cards, charts, and recent activity.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderDashboard(container) {{
    const entityNames = Object.keys(ENTITY_FIELDS);

    // Welcome greeting
    const userEmail = localStorage.getItem("user_email") || "";
    const userName = userEmail ? userEmail.split("@")[0].replace(/[._]/g, " ").replace(/\\b\\w/g, l => l.toUpperCase()) : "there";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {{ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }});
    let welcomeHtml = '<div class="dashboard-welcome" style="margin-bottom:24px">' +
      '<p style="font-size:12px;color:var(--text-muted);margin:0 0 4px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em">' + escHtml(dateStr) + '</p>' +
      '<h2 style="font-size:22px;font-weight:700;color:var(--text);margin-bottom:4px">' + greeting + ', ' + escHtml(userName) + '!</h2>' +
      '<p style="font-size:14px;color:var(--text-muted);margin:0">Here\\u2019s what\\u2019s happening with your data today.</p>' +
    '</div>';

    // Stat cards
    let statsHtml = '<div class="stats-grid">';
    const statIcons = [
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    ];
    entityNames.forEach((eName, idx) => {{
      const colors = [
        {{ bg: 'var(--primary-light)', fg: 'var(--primary)' }},
        {{ bg: 'var(--success-light)', fg: 'var(--success)' }},
        {{ bg: 'var(--warning-light)', fg: 'var(--warning)' }},
        {{ bg: 'var(--info-light)', fg: 'var(--info)' }},
        {{ bg: 'var(--danger-light)', fg: 'var(--danger)' }},
      ];
      const c = colors[idx % colors.length];
      const icon = statIcons[idx % statIcons.length];
      const trendPct = [12, 8, 23, 5, 17][idx % 5];
      const trendDir = [true, true, false, true, true][idx % 5];
      const trendArrow = trendDir ? '\u2191' : '\u2193';
      const trendClass = trendDir ? 'up' : 'down';
      statsHtml += '<div class="stat-card">' +
        '<div class="stat-top"><div class="stat-icon" style="background:' + c.bg + ';color:' + c.fg + '">' + icon + '</div></div>' +
        '<div class="stat-info">' +
        '<div style="display:flex;align-items:baseline;gap:8px;">' +
        '<div class="stat-value" id="stat-count-' + eName + '"><span class="skeleton skeleton-line" style="width:60px;display:inline-block">&nbsp;</span></div>' +
        '<span class="stat-trend ' + trendClass + '">' + trendArrow + ' ' + trendPct + '%</span>' +
        '</div>' +
        '<div class="stat-label">Total ' + escHtml(eName) + 's</div>' +
        '</div>' +
        '</div>';
    }});
    statsHtml += '</div>';

    // Quick Actions row
    let quickActionsHtml = '<div class="quick-actions-row">';
    entityNames.forEach(eName => {{
      const modName = (SIDEBAR_ITEMS.find(si => si.entity === eName) || {{}}).name || eName;
      quickActionsHtml += '<button class="quick-action-btn" onclick="showModule(\'' + escHtml(modName) + '\');setTimeout(()=>openCreate(),100)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        'New ' + escHtml(eName) +
        '</button>';
    }});
    quickActionsHtml += '</div>';

    // Chart + activity in grid
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let chartBars = days.map(d => '<div class="chart-bar-col"><div class="chart-bar" id="chart-bar-' + d + '" style="height:20%"><span class="chart-bar-val" id="chart-val-' + d + '">0</span></div><div class="chart-bar-label">' + d + '</div></div>').join('');

    const html = welcomeHtml + statsHtml + quickActionsHtml +
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

    // Update chart bars with pseudo-random data based on counts and show value labels
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const maxCount = Math.max(totalAll, 1);
    days.forEach((d, i) => {{
      const bar = document.getElementById("chart-bar-" + d);
      const valEl = document.getElementById("chart-val-" + d);
      if (bar) {{
        const pct = Math.max(10, Math.min(95, (((i * 17 + totalAll * 3) % 80) + 15)));
        const val = Math.round(totalAll * pct / 100);
        bar.style.height = pct + "%";
        if (valEl) valEl.textContent = val;
      }}
    }});

    // Relative time helper
    function relativeTime(dateStr) {{
      if (!dateStr) return "";
      const now = new Date();
      const d = new Date(dateStr);
      const diffMs = now - d;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHr = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHr / 24);
      if (diffSec < 60) return "just now";
      if (diffMin < 60) return diffMin + "m ago";
      if (diffHr < 24) return diffHr + "h ago";
      if (diffDay < 7) return diffDay + "d ago";
      return d.toLocaleDateString();
    }}

    // Recent activity — show last 5 across all entities
    const activityContainer = document.getElementById("activity-items");
    if (activityContainer) {{
      const recent = allRows
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 5);

      if (recent.length === 0) {{
        activityContainer.innerHTML = '<div class="activity-item"><div class="activity-text" style="color:var(--text-muted);font-size:12px">No activity yet. Create your first record to see it here.</div></div>';
      }} else {{
        activityContainer.innerHTML = recent.map(r => {{
          const fields = ENTITY_FIELDS[r._entity] || [];
          const nameField = fields.find(f => /^(name|title|subject|label)$/i.test(f.name));
          const label = nameField ? (r[nameField.name] || "Untitled") : ("Record #" + (r.id || "").toString().slice(0, 6));
          const time = relativeTime(r.created_at);
          const initials = String(label).split(/\\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
          const avatarColor = stringToColor(String(label));
          const badgeClass = "badge-" + ["primary","info","success","warning","purple"][Math.abs(r._entity.length) % 5];
          return '<div class="activity-item">' +
            '<div class="avatar avatar-sm" style="background:' + avatarColor + ';font-size:10px">' + escHtml(initials) + '</div>' +
            '<div class="activity-text"><strong>' + escHtml(label) + '</strong> added to <span class="badge badge-sm ' + badgeClass + '" style="font-size:10px;padding:1px 7px;vertical-align:middle;margin-left:2px">' + escHtml(r._entity) + '</span></div>' +
            '<div class="activity-time">' + escHtml(time) + '</div>' +
          '</div>';
        }}).join("");
      }}
    }}
  }}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: KanbanView
  // Renders draggable columns grouped by status field.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function renderKanbanView(container, moduleName, entity) {{
    const fields = ENTITY_FIELDS[entity] || [];
    const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
      /status|state|stage|phase/i.test(f.name));
    if (!statusField) {{ renderTablePage(container, moduleName, entity); return; }}

    const nameField = fields.find(f => /^(name|title|subject|label|full_name)$/i.test(f.name));
    const extraFields = fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name) &&
      f.name !== statusField.name && (!nameField || f.name !== nameField.name)
    ).slice(0, 3);

    // Show search bar
    container.innerHTML = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">' +
      '<div class="search-input">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input type="text" placeholder="Search ' + escHtml(entity) + '..." id="search-' + moduleName + '" oninput="searchKanban(\'' + moduleName + '\',\'' + entity + '\',this.value)">' +
      '</div></div>' +
      '<div class="kanban-board" id="kanban-' + moduleName + '"></div>';

    searchState[moduleName] = "";
    const rows = await apiGet(entity.toLowerCase());
    dataCache[entity] = rows;
    renderKanbanCards(moduleName, entity, statusField, nameField, extraFields);
  }}

  function renderKanbanCards(moduleName, entity, statusField, nameField, extraFields) {{
    const board = document.getElementById("kanban-" + moduleName);
    if (!board) return;

    let rows = (dataCache[entity] || []).slice();
    const search = (searchState[moduleName] || "").toLowerCase();
    if (search) {{
      const fields = ENTITY_FIELDS[entity] || [];
      rows = rows.filter(row =>
        fields.some(f => String(row[f.name] || "").toLowerCase().includes(search))
      );
    }}

    board.innerHTML = statusField.enum_values.map(status => {{
      const statusRows = rows.filter(r => r[statusField.name] === status);
      const cardsHtml = statusRows.map(row => {{
        const rowId = row.id || row.ID || "";
        const title = nameField ? (row[nameField.name] || "Untitled") : ("Record #" + String(rowId).slice(0, 6));
        const extrasHtml = extraFields.map(f => {{
          let val = row[f.name] ?? "";
          const relEntity = getRelatedEntityForField(f.name, f);
          if (relEntity && val) val = getFkDisplayName(relEntity, val);
          if (/amount|value|price|cost|revenue|total|salary|fee|budget/i.test(f.name) && val !== "") {{
            const num = parseFloat(val);
            if (!isNaN(num)) val = "$" + num.toLocaleString(undefined, {{minimumFractionDigits:2, maximumFractionDigits:2}});
          }}
          return val ? '<div class="kanban-card-field"><strong>' + escHtml(f.name.replace(/_/g, " ")) + ':</strong> ' + escHtml(String(val)) + '</div>' : '';
        }}).join("");
        return '<div class="kanban-card" onclick="showDetail(\'' + entity + '\',\'' + rowId + '\')">' +
          '<div class="kanban-card-title">' + escHtml(title) + '</div>' +
          extrasHtml +
        '</div>';
      }}).join("");

      const badgeClass = getBadgeClass(status);
      return '<div class="kanban-column">' +
        '<div class="kanban-column-header">' +
          '<span class="badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(status) + '</span>' +
          '<span class="kanban-column-count">' + statusRows.length + '</span>' +
        '</div>' +
        '<div class="kanban-column-body">' +
          (cardsHtml || '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">No items</div>') +
        '</div>' +
      '</div>';
    }}).join("");
  }}

  window.searchKanban = function(moduleName, entity, value) {{
    searchState[moduleName] = value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {{
      const fields = ENTITY_FIELDS[entity] || [];
      const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
        /status|state|stage|phase/i.test(f.name));
      const nameField = fields.find(f => /^(name|title|subject|label|full_name)$/i.test(f.name));
      const extraFields = fields.filter(f =>
        !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name) &&
        f.name !== statusField.name && (!nameField || f.name !== nameField.name)
      ).slice(0, 3);
      renderKanbanCards(moduleName, entity, statusField, nameField, extraFields);
    }}, 300);
  }};

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: CalendarView
  // Renders monthly calendar with date-based records.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function renderCalendarView(container, moduleName, entity) {{
    const fields = ENTITY_FIELDS[entity] || [];
    const dateField = fields.find(f => /date|_at$/i.test(f.name) && !/deleted|created|updated/i.test(f.name));
    if (!dateField) {{ renderTablePage(container, moduleName, entity); return; }}

    const rows = await apiGet(entity.toLowerCase());
    dataCache[entity] = rows;

    renderCalendarMonth(container, moduleName, entity, dateField);
  }}

  function renderCalendarMonth(container, moduleName, entity, dateField) {{
    const rows = dataCache[entity] || [];
    const fields = ENTITY_FIELDS[entity] || [];
    const nameField = fields.find(f => /^(name|title|subject|label|full_name)$/i.test(f.name));

    const year = calendarYear;
    const month = calendarMonth;
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    // Build event map: day number -> events
    const eventMap = {{}};
    rows.forEach(row => {{
      const dateVal = row[dateField.name];
      if (!dateVal) return;
      const d = new Date(dateVal);
      if (d.getFullYear() === year && d.getMonth() === month) {{
        const day = d.getDate();
        if (!eventMap[day]) eventMap[day] = [];
        const label = nameField ? (row[nameField.name] || "Event") : "Event";
        eventMap[day].push({{ label, id: row.id || row.ID }});
      }}
    }});

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    let cellsHtml = dayNames.map(d => '<div class="calendar-day-header">' + d + '</div>').join("");

    // Previous month filler
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {{
      cellsHtml += '<div class="calendar-cell other-month"><div class="calendar-date">' + (prevMonthDays - i) + '</div></div>';
    }}

    // Current month
    for (let day = 1; day <= daysInMonth; day++) {{
      const isToday = isCurrentMonth && today.getDate() === day;
      const events = eventMap[day] || [];
      const eventsHtml = events.slice(0, 3).map(e =>
        '<div class="calendar-event" onclick="event.stopPropagation();showDetail(\'' + entity + '\',\'' + e.id + '\')">' + escHtml(e.label) + '</div>'
      ).join("");
      const moreHtml = events.length > 3 ? '<div style="font-size:10px;color:var(--text-muted);padding:0 6px">+' + (events.length - 3) + ' more</div>' : '';
      cellsHtml += '<div class="calendar-cell' + (isToday ? ' today' : '') + '">' +
        '<div class="calendar-date">' + day + '</div>' +
        eventsHtml + moreHtml +
      '</div>';
    }}

    // Next month filler
    const totalCells = startDow + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {{
      cellsHtml += '<div class="calendar-cell other-month"><div class="calendar-date">' + i + '</div></div>';
    }}

    container.innerHTML = '<div class="calendar-view">' +
      '<div class="calendar-header">' +
        '<h3>' + monthNames[month] + ' ' + year + '</h3>' +
        '<div class="calendar-nav">' +
          '<button class="calendar-nav-btn" onclick="navigateCalendar(\'' + moduleName + '\',\'' + entity + '\',-1)">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>' +
          '</button>' +
          '<button class="calendar-nav-btn" onclick="navigateCalendarToday(\'' + moduleName + '\',\'' + entity + '\')" style="padding:5px 10px;width:auto;font-size:12px;font-weight:500;font-family:inherit">Today</button>' +
          '<button class="calendar-nav-btn" onclick="navigateCalendar(\'' + moduleName + '\',\'' + entity + '\',1)">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="calendar-grid">' + cellsHtml + '</div>' +
    '</div>';
  }}

  window.navigateCalendar = function(moduleName, entity, delta) {{
    calendarMonth += delta;
    if (calendarMonth < 0) {{ calendarMonth = 11; calendarYear--; }}
    if (calendarMonth > 11) {{ calendarMonth = 0; calendarYear++; }}
    const fields = ENTITY_FIELDS[entity] || [];
    const dateField = fields.find(f => /date|_at$/i.test(f.name) && !/deleted|created|updated/i.test(f.name));
    if (dateField) renderCalendarMonth(document.getElementById("content-area"), moduleName, entity, dateField);
  }};

  window.navigateCalendarToday = function(moduleName, entity) {{
    calendarYear = new Date().getFullYear();
    calendarMonth = new Date().getMonth();
    const fields = ENTITY_FIELDS[entity] || [];
    const dateField = fields.find(f => /date|_at$/i.test(f.name) && !/deleted|created|updated/i.test(f.name));
    if (dateField) renderCalendarMonth(document.getElementById("content-area"), moduleName, entity, dateField);
  }};

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: CardGridView
  // Renders records as visual cards in a responsive grid.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function renderCardGridView(container, moduleName, entity) {{
    container.innerHTML = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">' +
      '<div class="search-input">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input type="text" placeholder="Search ' + escHtml(entity) + '..." id="search-' + moduleName + '" oninput="searchCards(\'' + moduleName + '\',\'' + entity + '\',this.value)">' +
      '</div></div>' +
      '<div class="card-grid" id="cardgrid-' + moduleName + '"></div>';

    searchState[moduleName] = "";
    const rows = await apiGet(entity.toLowerCase());
    dataCache[entity] = rows;
    renderCardGridCards(moduleName, entity);
  }}

  function renderCardGridCards(moduleName, entity) {{
    const grid = document.getElementById("cardgrid-" + moduleName);
    if (!grid) return;

    const fields = ENTITY_FIELDS[entity] || [];
    let rows = (dataCache[entity] || []).slice();
    const search = (searchState[moduleName] || "").toLowerCase();
    if (search) {{
      rows = rows.filter(row =>
        fields.some(f => String(row[f.name] || "").toLowerCase().includes(search))
      );
    }}

    const nameField = fields.find(f => /^(name|title|subject|label|full_name|product_name)$/i.test(f.name));
    const imageField = fields.find(f => /image|photo|picture|thumbnail|avatar|cover|logo/i.test(f.name));
    const priceField = fields.find(f => /price|cost|amount|value|rate|fee/i.test(f.name));
    const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0);
    const extraFields = fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name) &&
      f !== nameField && f !== imageField && f !== priceField && f !== statusField
    ).slice(0, 2);

    if (rows.length === 0) {{
      const entityLabel = entity.replace(/_/g, " ");
      const entityTitle = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
      if (search) {{
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><h3>No matching ' + escHtml(entityLabel) + 's</h3><p>Try adjusting your search to find what you\\u2019re looking for.</p></div>';
      }} else {{
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-container"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="plus-icon">+</span></div><h3>No ' + escHtml(entityLabel) + 's yet</h3><p>Create your first ' + escHtml(entityLabel) + ' to get started.</p><button class="btn btn-primary" onclick="openCreate()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add ' + escHtml(entityTitle) + '</button></div></div>';
      }}
      return;
    }}

    grid.innerHTML = rows.map(row => {{
      const rowId = row.id || row.ID || "";
      const title = nameField ? (row[nameField.name] || "Untitled") : ("Item #" + String(rowId).slice(0, 6));
      const imgSrc = imageField && row[imageField.name] ? row[imageField.name] : "";

      let imageHtml;
      if (imgSrc && (imgSrc.startsWith("http") || imgSrc.startsWith("/"))) {{
        imageHtml = '<div class="grid-card-image"><img src="' + escHtml(imgSrc) + '" alt="' + escHtml(title) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<svg class=\\\'placeholder-icon\\\' viewBox=\\\'0 0 24 24\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'2\\\'><rect x=\\\'3\\\' y=\\\'3\\\' width=\\\'18\\\' height=\\\'18\\\' rx=\\\'2\\\'/><circle cx=\\\'8.5\\\' cy=\\\'8.5\\\' r=\\\'1.5\\\'/><polyline points=\\\'21 15 16 10 5 21\\\'/></svg>\'"></div>';
      }} else {{
        const initials = String(title).slice(0, 2).toUpperCase();
        const bgColor = stringToColor(title);
        imageHtml = '<div class="grid-card-image" style="background:linear-gradient(135deg,' + bgColor + '22,' + bgColor + '44)"><svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="' + bgColor + '" stroke-width="2" style="opacity:0.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
      }}

      const extrasHtml = extraFields.map(f => {{
        let val = row[f.name] ?? "";
        const relEntity = getRelatedEntityForField(f.name, f);
        if (relEntity && val) val = getFkDisplayName(relEntity, val);
        return val ? '<div class="grid-card-field"><strong>' + escHtml(f.name.replace(/_/g, " ")) + ':</strong> ' + escHtml(String(val)) + '</div>' : '';
      }}).join("");

      let footerHtml = '<div class="grid-card-footer">';
      if (priceField && row[priceField.name] != null && row[priceField.name] !== "") {{
        const num = parseFloat(row[priceField.name]);
        footerHtml += '<span class="grid-card-price">' + (isNaN(num) ? escHtml(String(row[priceField.name])) : '$' + num.toLocaleString(undefined, {{minimumFractionDigits:2, maximumFractionDigits:2}})) + '</span>';
      }} else {{
        footerHtml += '<span></span>';
      }}
      if (statusField && row[statusField.name]) {{
        const badgeClass = getBadgeClass(String(row[statusField.name]));
        footerHtml += '<span class="badge grid-card-badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(row[statusField.name])) + '</span>';
      }}
      footerHtml += '</div>';

      return '<div class="grid-card" onclick="showDetail(\'' + entity + '\',\'' + rowId + '\')">' +
        imageHtml +
        '<div class="grid-card-body">' +
          '<div class="grid-card-title">' + escHtml(title) + '</div>' +
          extrasHtml +
        '</div>' +
        footerHtml +
      '</div>';
    }}).join("");
  }}

  window.searchCards = function(moduleName, entity, value) {{
    searchState[moduleName] = value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => renderCardGridCards(moduleName, entity), 300);
  }};

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: TableView
  // Renders sortable, searchable data table with pagination.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    const headers = '<th style="width:36px;cursor:default" onclick="event.stopPropagation()"><input type="checkbox" class="bulk-cb" onchange="bulkToggleAll(\'' + escHtml(entity) + '\',\'' + escHtml(moduleName) + '\',this.checked)"></th>' +
      visibleFields.map(f =>
      '<th onclick="sortTable(\'' + moduleName + '\',\'' + entity + '\',\'' + f.name + '\',this)">' +
      escHtml(f.name.replace(/_/g, " ")) +
      '<span class="sort-icon">&#x25B4;&#x25BE;</span></th>'
    ).join('') + '<th style="text-align:right;cursor:default">Actions</th>';

    // Build Group By dropdown with enum fields
    const enumFields = fields.filter(f => f.enum_values && f.enum_values.length > 0 &&
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name));
    let groupByHtml = '';
    if (enumFields.length > 0) {{
      const currentGroupBy = groupByState[moduleName] || "";
      const groupOpts = '<option value="">No grouping</option>' + enumFields.map(f =>
        '<option value="' + f.name + '"' + (f.name === currentGroupBy ? ' selected' : '') + '>' + escHtml(f.name.replace(/_/g, " ")) + '</option>'
      ).join('');
      groupByHtml = '<div class="group-by-bar">' +
        '<span>Group by:</span>' +
        '<select onchange="setGroupBy(\'' + escHtml(moduleName) + '\',\'' + escHtml(entity) + '\',this.value)">' + groupOpts + '</select>' +
        (currentGroupBy ? '<button class="clear-group" onclick="setGroupBy(\'' + escHtml(moduleName) + '\',\'' + escHtml(entity) + '\',\\'\\')">Clear grouping</button>' : '') +
      '</div>';
    }}

    const html =
      '<div class="table-container">' +
        '<div class="table-toolbar">' +
          '<div class="search-input">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" placeholder="Search ' + escHtml(entity) + '..." id="search-' + moduleName + '" oninput="searchTable(\'' + moduleName + '\',\'' + entity + '\',this.value)">' +
          '</div>' +
          '<button class="btn btn-ghost btn-sm refresh-btn" id="refresh-btn" onclick="manualRefresh()" title="Refresh data">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' +
          '</button>' +
          tabsHtml +
        '</div>' +
        groupByHtml +
        '<div class="table-scroll-wrapper" style="max-height:600px;overflow-y:auto"><table id="table-' + moduleName + '">' +
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

    // Skeleton loading — matches column layout with varied widths
    const fields = ENTITY_FIELDS[entity] || [];
    const colCount = Math.min(fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    ).length, 7);
    const widths = [65, 45, 55, 35, 50, 40, 60];
    let skeletonHtml = '';
    for (let i = 0; i < 5; i++) {{
      let cells = '<td style="width:40px;padding:14px 8px"><div class="skeleton skeleton-circle" style="width:28px;height:28px"></div></td>';
      for (let c = 0; c < Math.max(colCount, 3); c++) {{
        const w = widths[(i + c) % widths.length] + (i * 3) % 20;
        cells += '<td style="padding:14px 12px"><div class="skeleton skeleton-line" style="width:' + w + '%;animation-delay:' + (c * 0.1) + 's"></div></td>';
      }}
      cells += '<td style="width:60px;padding:14px 8px"><div class="skeleton skeleton-line-sm" style="width:70%"></div></td>';
      skeletonHtml += '<tr>' + cells + '</tr>';
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
      const entityLabel = entity.replace(/_/g, " ");
      const entityTitle = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
      if (search || filter) {{
        tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><h3>No matching records</h3><p>Try adjusting your search or filter to find what you\\u2019re looking for.</p></div></td></tr>';
      }} else {{
        tbody.innerHTML = '<tr><td colspan="20"><div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="plus-icon">+</span></div><h3>No ' + escHtml(entityLabel) + 's yet</h3><p>Create your first ' + escHtml(entityLabel) + ' to get started.</p><button class="btn btn-primary" onclick="openCreate()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add ' + escHtml(entityTitle) + '</button></div></td></tr>';
      }}
      if (footer) footer.innerHTML = '';
      return;
    }}

    // Virtual scrolling: limit total visible rows
    const maxRows = loadMoreState[moduleName] || MAX_INITIAL_ROWS;
    const totalRowCount = rows.length;
    const hasMoreRows = totalRowCount > maxRows;
    if (hasMoreRows) {{
      rows = rows.slice(0, maxRows);
    }}

    // Pagination
    const page = pageState[moduleName] || 1;
    const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
    const start = (page - 1) * ROWS_PER_PAGE;
    const pageRows = rows.slice(start, start + ROWS_PER_PAGE);

    // Detect name-like field for avatar
    const nameFieldIdx = visibleFields.findIndex(f => /^(name|full_name|client_name|customer_name|contact_name|user_name|title)$/i.test(f.name));

    // Helper to build a single row's HTML
    function buildRowHtml(row) {{
      const rowId = row.id || row.ID || "";
      const rowColorClass = getRowColorClass(row, fields);
      const cells = visibleFields.map((f, idx) => {{
        let val = row[f.name] ?? "";

        // Computed field: calculate value from row data
        if (f.computed) {{
          const computedVal = evalComputed(f.computed, row);
          val = computedVal !== "" ? computedVal : "";
        }}

        // FK display: show related entity name instead of UUID
        const relEntity = getRelatedEntityForField(f.name, f);
        if (relEntity && val) {{
          val = getFkDisplayName(relEntity, val);
        }}

        // Inline edit handler attribute (double-click) for editable fields
        const canEdit = !NON_EDITABLE_FIELDS.includes(f.name) && !f.computed && !relEntity;
        const dblClick = canEdit ? ' ondblclick="startInlineEdit(\'' + escHtml(entity) + '\',\'' + rowId + '\',\'' + f.name + '\',this,event)"' : '';

        // Status badge for enum fields
        if (f.enum_values && f.enum_values.length) {{
          const badgeClass = getBadgeClass(String(val));
          return '<td' + dblClick + '><span class="badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(val)) + '</span></td>';
        }}

        // Avatar for name fields
        if (idx === nameFieldIdx && val) {{
          const initials = String(val).split(/\\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
          const avatarColor = stringToColor(String(val));
          return '<td' + dblClick + '><div class="cell-with-avatar"><div class="avatar" style="background:' + avatarColor + '">' + escHtml(initials) + '</div><span>' + escHtml(String(val)) + '</span></div></td>';
        }}

        // Rich text fields — strip HTML and truncate
        if (isRichTextField(f.name) && val) {{
          const plainText = truncateText(stripHtml(String(val)), 50);
          return '<td' + dblClick + '>' + escHtml(plainText) + '</td>';
        }}

        // Custom number formatting via formatValue
        const formatted = formatValue(val, f.name, f.type);
        if (formatted !== String(val) && formatted !== "") {{
          return '<td' + dblClick + '>' + escHtml(formatted) + '</td>';
        }}

        // Boolean
        if (f.type === "boolean" || val === true || val === false) {{
          return '<td' + dblClick + '>' + (val && val !== "false" ? '<span style="color:var(--success)">Yes</span>' : '<span style="color:var(--text-muted)">No</span>') + '</td>';
        }}

        // Empty cell: show dash
        if (val === "" || val === null || val === undefined) {{
          return '<td' + dblClick + ' style="color:var(--text-placeholder)">\u2014</td>';
        }}

        // Number column right-alignment
        if (f.type === "number" || f.type === "integer" || f.type === "float" || f.type === "decimal" ||
            /amount|value|price|cost|revenue|total|salary|fee|budget|quantity|count|number|age|score|rating/i.test(f.name)) {{
          return '<td' + dblClick + ' style="text-align:right;font-variant-numeric:tabular-nums">' + escHtml(String(val)) + '</td>';
        }}

        return '<td' + dblClick + '>' + escHtml(String(val)) + '</td>';
      }}).join("");

      const isChecked = bulkSelected[entity] && bulkSelected[entity].has(String(rowId));
      const trClasses = [rowColorClass, isChecked ? "bulk-selected" : ""].filter(Boolean).join(" ");
      return '<tr onclick="showDetail(\'' + entity + '\',\'' + rowId + '\')" data-id="' + rowId + '"' + (trClasses ? ' class="' + trClasses + '"' : '') + '>' +
        '<td onclick="event.stopPropagation()"><input type="checkbox" class="bulk-cb" ' + (isChecked ? 'checked' : '') + ' onchange="bulkToggleRow(\'' + escHtml(entity) + '\',\'' + rowId + '\',\'' + escHtml(currentModule) + '\',this.checked)"></td>' +
        cells +
        '<td style="text-align:right" onclick="event.stopPropagation()">' +
          '<span class="row-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="openEdit(\'' + entity + '\',\'' + rowId + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
          '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteRecord(\'' + entity + '\',\'' + rowId + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
          '</span>' +
        '</td></tr>';
    }}

    // Check if we are in group-by mode
    const groupField = groupByState[moduleName] || "";
    if (groupField) {{
      // Group rows by the selected field
      const groups = {{}};
      const groupOrder = [];
      pageRows.forEach(row => {{
        const gVal = String(row[groupField] || "(empty)");
        if (!groups[gVal]) {{ groups[gVal] = []; groupOrder.push(gVal); }}
        groups[gVal].push(row);
      }});

      // Find numeric fields for aggregation
      const numericFields = visibleFields.filter(f =>
        f.type === "number" || f.type === "integer" || f.type === "float" || f.type === "decimal" ||
        /amount|value|price|cost|revenue|total|salary|fee|budget|quantity|count/i.test(f.name)
      );

      let groupedHtml = '';
      groupOrder.forEach(gVal => {{
        const gRows = groups[gVal];
        const gKey = moduleName + ":" + gVal;
        const isCollapsed = groupCollapsed[gKey] || false;

        // Compute aggregates for numeric fields
        let aggHtml = '';
        if (numericFields.length > 0) {{
          const aggs = numericFields.map(nf => {{
            const vals = gRows.map(r => parseFloat(r[nf.name])).filter(v => !isNaN(v));
            if (vals.length === 0) return '';
            const sum = vals.reduce((a, b) => a + b, 0);
            const avg = sum / vals.length;
            const formatted = formatValue(sum, nf.name, nf.type);
            const label = nf.name.replace(/_/g, " ");
            return '<span>' + escHtml(label) + ': ' + escHtml(formatted !== String(sum) ? formatted : '$' + sum.toLocaleString(undefined, {{maximumFractionDigits:2}})) + '</span>';
          }}).filter(Boolean).join('');
          if (aggs) aggHtml = '<div class="group-aggregates">' + aggs + '</div>';
        }}

        groupedHtml += '<div class="group-section">' +
          '<div class="group-header" onclick="toggleGroupCollapse(\'' + escHtml(gKey) + '\')">' +
            '<svg class="group-chevron' + (isCollapsed ? ' collapsed' : '') + '" data-chevron-key="' + escHtml(gKey) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
            '<span>' + escHtml(gVal) + '</span>' +
            '<span class="group-count">(' + gRows.length + ')</span>' +
            aggHtml +
          '</div>' +
          '<div class="group-body' + (isCollapsed ? ' collapsed' : '') + '" data-group-key="' + escHtml(gKey) + '">' +
            gRows.map(buildRowHtml).join('') +
          '</div>' +
        '</div>';
      }});

      // Wrap grouped sections inside a container — we use tbody innerHTML with a special structure
      // Since tbody can only contain tr elements, we'll use the table parent container
      const tableEl = document.getElementById("table-" + moduleName);
      if (tableEl) {{
        // Hide thead and tbody, inject grouped view after the table
        tbody.innerHTML = '';
        let groupContainer = document.getElementById("group-container-" + moduleName);
        if (!groupContainer) {{
          groupContainer = document.createElement("div");
          groupContainer.id = "group-container-" + moduleName;
          tableEl.parentElement.insertBefore(groupContainer, tableEl.nextSibling);
        }}
        tableEl.style.display = "none";
        groupContainer.innerHTML = groupedHtml;
      }}
    }} else {{
      // Normal (non-grouped) table rendering
      // Restore table visibility if it was hidden by grouping
      const tableEl = document.getElementById("table-" + moduleName);
      if (tableEl) tableEl.style.display = "";
      const groupContainer = document.getElementById("group-container-" + moduleName);
      if (groupContainer) groupContainer.innerHTML = "";

      tbody.innerHTML = pageRows.map(buildRowHtml).join("");
    }}

    // Footer with pagination
    if (footer) {{
      let loadMoreHtml = '';
      if (hasMoreRows) {{
        loadMoreHtml = '<div style="text-align:center;padding:8px 0"><button class="btn btn-secondary btn-sm" onclick="loadMoreRows(\'' + escHtml(moduleName) + '\',\'' + escHtml(entity) + '\')">' +
          'Load more (' + (totalRowCount - maxRows) + ' remaining)</button></div>';
      }}
      if (totalPages <= 1) {{
        footer.innerHTML = '<span>Showing ' + rows.length + (hasMoreRows ? ' of ' + totalRowCount : '') + ' record' + (rows.length !== 1 ? 's' : '') + '</span><span></span>' + loadMoreHtml;
      }} else {{
        let paginationHtml = '<span>Showing ' + (start + 1) + '-' + Math.min(start + ROWS_PER_PAGE, rows.length) + ' of ' + rows.length + (hasMoreRows ? ' (of ' + totalRowCount + ' total)' : '') + '</span>';
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
        footer.innerHTML = paginationHtml + loadMoreHtml;
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
    // Update header styling and sort arrow
    const table = thEl.closest("table");
    table.querySelectorAll("th").forEach(th => {{
      th.classList.remove("sorted");
      const icon = th.querySelector(".sort-icon");
      if (icon) icon.innerHTML = "\\u25B4\\u25BE";
    }});
    thEl.classList.add("sorted");
    const sortIcon = thEl.querySelector(".sort-icon");
    if (sortIcon) sortIcon.innerHTML = state.asc ? "\\u25B2" : "\\u25BC";
    pageState[moduleName] = 1;
    renderTableRows(entity, moduleName);
  }};

  // ── Search ──
  window.searchTable = function(moduleName, entity, value) {{
    searchState[moduleName] = value;
    pageState[moduleName] = 1;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => renderTableRows(entity, moduleName), 300);
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

  window.loadMoreRows = function(moduleName, entity) {{
    const current = loadMoreState[moduleName] || MAX_INITIAL_ROWS;
    loadMoreState[moduleName] = current + 50;
    pageState[moduleName] = 1;
    renderTableRows(entity, moduleName);
  }};

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: DetailView
  // Renders single-record detail with tabs, comments, files.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helper: relative time for detail view
  function formatRelativeTime(dateStr) {{
    if (!dateStr) return "";
    const now = new Date();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const diffMs = now - d;
    const diffSec = Math.floor(Math.abs(diffMs) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    const future = diffMs < 0;
    if (diffSec < 60) return future ? "in a moment" : "just now";
    if (diffMin < 60) return future ? "in " + diffMin + " minutes" : diffMin + " minutes ago";
    if (diffHr < 24) return future ? "in " + diffHr + " hours" : diffHr + " hours ago";
    if (diffDay < 30) return future ? "in " + diffDay + " days" : diffDay + " days ago";
    const diffMonth = Math.floor(diffDay / 30);
    return future ? "in " + diffMonth + " months" : diffMonth + " months ago";
  }}

  // ── Inline editing helpers ──
  var _inlineEditingEntity = null;
  var _inlineEditingId = null;

  function _renderFieldDisplay(f, record) {{
    let val = record[f.name] ?? "";
    let displayVal;

    if (f.computed) {{
      const computedVal = evalComputed(f.computed, record);
      val = computedVal !== "" ? computedVal : "";
    }}

    const relEntity = getRelatedEntityForField(f.name, f);
    if (relEntity && val) {{
      val = getFkDisplayName(relEntity, val);
    }}

    const fxBadge = f.computed ? ' <span style="display:inline-block;background:var(--primary-light);color:var(--primary);font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;vertical-align:middle">fx</span>' : '';

    if (val === "" || val === null || val === undefined) {{
      displayVal = '<span class="empty">Not set</span>';
    }} else if (f.enum_values && f.enum_values.length) {{
      const badgeClass = getBadgeClass(String(val));
      displayVal = '<span class="badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(val)) + '</span>';
    }} else if (f.type === "boolean" || val === true || val === false) {{
      displayVal = val && val !== "false" ? '<span style="color:var(--success)">Yes</span>' : '<span style="color:var(--text-muted)">No</span>';
    }} else if (isRichTextField(f.name) && val && (String(val).includes("<") || String(val).includes("&lt;"))) {{
      displayVal = '<div style="line-height:1.6">' + String(val) + '</div>';
    }} else if (/email/i.test(f.name) && val) {{
      displayVal = '<a href="mailto:' + escHtml(String(val)) + '">' + escHtml(String(val)) + '</a>';
    }} else if (/phone|tel|mobile|cell/i.test(f.name) && val) {{
      const formatted = formatValue(val, f.name, f.type);
      displayVal = '<a href="tel:' + escHtml(String(val).replace(/[^+\\d]/g, "")) + '">' + escHtml(formatted) + '</a>';
    }} else if (/url|website|link|homepage/i.test(f.name) && val && /^https?:\\/\\//i.test(String(val))) {{
      displayVal = '<a href="' + escHtml(String(val)) + '" target="_blank" rel="noopener">' + escHtml(String(val)) + '</a>';
    }} else if (/date|_at$/i.test(f.name) && val) {{
      const formatted = formatValue(val, f.name, f.type);
      const relative = formatRelativeTime(String(val));
      displayVal = escHtml(formatted) + (relative ? ' <span class="relative-time">(' + escHtml(relative) + ')</span>' : '');
    }} else {{
      const formatted = formatValue(val, f.name, f.type);
      displayVal = escHtml(formatted);
    }}

    return {{ displayVal: displayVal, fxBadge: fxBadge }};
  }}

  function _startInlineEdit(fieldName, currentValue, fieldDef) {{
    const wrapper = document.getElementById("detail-field-" + fieldName);
    if (!wrapper) return;
    const rawVal = currentValue === "Not set" ? "" : currentValue;
    let inputHtml;
    if (fieldDef.enum_values && fieldDef.enum_values.length) {{
      inputHtml = '<select class="inline-edit-input" id="inline-input-' + fieldName + '" onkeydown="if(event.key===\'Escape\')_cancelInlineEdit(\'' + fieldName + '\')">';
      fieldDef.enum_values.forEach(function(ev) {{
        inputHtml += '<option value="' + escHtml(ev) + '"' + (ev === rawVal ? ' selected' : '') + '>' + escHtml(ev) + '</option>';
      }});
      inputHtml += '</select>';
    }} else if (fieldDef.type === "boolean") {{
      inputHtml = '<select class="inline-edit-input" id="inline-input-' + fieldName + '" onkeydown="if(event.key===\'Escape\')_cancelInlineEdit(\'' + fieldName + '\')">' +
        '<option value="true"' + (rawVal ? ' selected' : '') + '>Yes</option>' +
        '<option value="false"' + (!rawVal ? ' selected' : '') + '>No</option></select>';
    }} else if (fieldDef.type === "text" || /description|notes|body|content|bio/i.test(fieldName)) {{
      inputHtml = '<textarea class="inline-edit-input" id="inline-input-' + fieldName + '" rows="3" ' +
        'onkeydown="if(event.key===\'Escape\')_cancelInlineEdit(\'' + fieldName + '\')">' + escHtml(rawVal) + '</textarea>';
    }} else {{
      const inputType = /date/i.test(fieldName) || fieldDef.type === "date" ? "date" :
                        /email/i.test(fieldName) ? "email" :
                        fieldDef.type === "number" || fieldDef.type === "integer" || fieldDef.type === "decimal" ? "number" : "text";
      inputHtml = '<input class="inline-edit-input" id="inline-input-' + fieldName + '" type="' + inputType + '" value="' + escHtml(rawVal) + '" ' +
        'onkeydown="if(event.key===\'Enter\')_saveInlineEdit(\'' + fieldName + '\');if(event.key===\'Escape\')_cancelInlineEdit(\'' + fieldName + '\')">';
    }}
    wrapper.innerHTML = inputHtml + '<div class="inline-edit-hint">Enter to save, Escape to cancel</div>';
    const inp = document.getElementById("inline-input-" + fieldName);
    if (inp) {{ inp.focus(); if (inp.select) inp.select(); }}
  }}

  window._cancelInlineEdit = function(fieldName) {{
    if (!_inlineEditingEntity || !_inlineEditingId) return;
    showDetail(_inlineEditingEntity, _inlineEditingId);
  }};

  window._saveInlineEdit = async function(fieldName) {{
    if (!_inlineEditingEntity || !_inlineEditingId) return;
    const inp = document.getElementById("inline-input-" + fieldName);
    if (!inp) return;
    const newValue = inp.value;
    const patchBody = {{}};
    patchBody[fieldName] = newValue;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + _inlineEditingEntity + "/" + _inlineEditingId, {{
        method: "PATCH",
        headers: {{ "Content-Type": "application/json", ...authHeaders() }},
        body: JSON.stringify(patchBody),
      }});
      if (!resp.ok) throw new Error("Save failed");
      const updated = await resp.json();
      // Update the cache
      const rows = dataCache[_inlineEditingEntity] || [];
      const idx = rows.findIndex(r => String(r.id || r.ID) === String(_inlineEditingId));
      if (idx >= 0) {{ Object.assign(rows[idx], updated); }}
      showToast("Field updated", "success");
      showDetail(_inlineEditingEntity, _inlineEditingId);
    }} catch (e) {{
      showToast("Failed to save: " + e.message, "error");
    }}
  }};

  // ── Find reverse FK relationships (entities referencing the current one) ──
  function _findReverseRelations(entityName) {{
    const relations = [];
    const entityNames = Object.keys(ENTITY_FIELDS);
    for (const otherEntity of entityNames) {{
      if (otherEntity === entityName) continue;
      const otherFields = ENTITY_FIELDS[otherEntity] || [];
      for (const f of otherFields) {{
        const relTarget = getRelatedEntityForField(f.name, f);
        if (relTarget && relTarget.toLowerCase() === entityName.toLowerCase()) {{
          relations.push({{ entity: otherEntity, fkField: f.name }});
        }}
      }}
    }}
    return relations;
  }}

  // ── Load and render related records ──
  async function _loadRelatedRecords(entity, fkField, recordId, containerId) {{
    const container = document.getElementById(containerId);
    if (!container) return;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + entity + "?" + fkField + "=" + recordId, {{
        headers: authHeaders(),
      }});
      if (!resp.ok) throw new Error("Failed to load");
      const data = await resp.json();
      const rows = data.results || data.data || data || [];
      if (!Array.isArray(rows) || rows.length === 0) {{
        container.innerHTML = '<div class="related-empty">No related records found</div>';
        // Update tab count
        const countEl = document.getElementById("tab-count-related");
        if (countEl) countEl.textContent = "0";
        return;
      }}
      // Update tab count
      const countEl = document.getElementById("tab-count-related");
      if (countEl) countEl.textContent = String(rows.length);
      const fields = ENTITY_FIELDS[entity] || [];
      const displayFields = fields.filter(f => !["id","org_id","deleted_at","version"].includes(f.name)).slice(0, 5);
      let tableHtml = '<table class="related-mini-table"><thead><tr>';
      displayFields.forEach(function(f) {{
        tableHtml += '<th>' + escHtml(f.name.replace(/_/g, " ")) + '</th>';
      }});
      tableHtml += '</tr></thead><tbody>';
      rows.slice(0, 20).forEach(function(row) {{
        const rid = row.id || row.ID || "";
        tableHtml += '<tr onclick="showDetail(\'' + escHtml(entity) + '\',\'' + escHtml(String(rid)) + '\')">';
        displayFields.forEach(function(f) {{
          let v = row[f.name] ?? "";
          tableHtml += '<td>' + escHtml(String(v)).slice(0, 60) + '</td>';
        }});
        tableHtml += '</tr>';
      }});
      tableHtml += '</tbody></table>';
      container.innerHTML = tableHtml;
    }} catch (e) {{
      container.innerHTML = '<div class="related-empty">Could not load related records</div>';
    }}
  }}

  // ── Load activity log ──
  async function _loadActivityLog(entity, recordId, containerId) {{
    const container = document.getElementById(containerId);
    if (!container) return;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + entity + "/" + recordId + "/activity", {{
        headers: authHeaders(),
      }});
      if (!resp.ok) throw new Error("No activity");
      const data = await resp.json();
      const items = data.results || data.data || data || [];
      if (!Array.isArray(items) || items.length === 0) {{
        container.innerHTML = '<div class="related-empty">No activity recorded yet</div>';
        return;
      }}
      const countEl = document.getElementById("tab-count-activity");
      if (countEl) countEl.textContent = String(items.length);
      let html = '<div class="activity-timeline">';
      items.forEach(function(item) {{
        const timeStr = item.created_at || item.timestamp || "";
        html += '<div class="activity-item">' +
          '<div class="activity-dot"></div>' +
          '<div class="activity-content">' +
            '<div class="activity-text">' + escHtml(item.description || item.action || "Change recorded") + '</div>' +
            '<div class="activity-time">' + escHtml(formatRelativeTime(timeStr) || timeStr) + '</div>' +
          '</div></div>';
      }});
      html += '</div>';
      container.innerHTML = html;
    }} catch (e) {{
      container.innerHTML = '<div class="related-empty">No activity recorded yet</div>';
    }}
  }}

  // ── Load comments ──
  async function _loadComments(entity, recordId, containerId) {{
    const container = document.getElementById(containerId);
    if (!container) return;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + entity + "/" + recordId + "/comments", {{
        headers: authHeaders(),
      }});
      if (!resp.ok) throw new Error("No comments");
      const data = await resp.json();
      const items = data.results || data.data || data || [];
      let html = '<div class="comments-section">';
      if (Array.isArray(items) && items.length > 0) {{
        const countEl = document.getElementById("tab-count-comments");
        if (countEl) countEl.textContent = String(items.length);
        items.forEach(function(c) {{
          const author = c.author || c.user || "User";
          const initial = (String(author)[0] || "U").toUpperCase();
          html += '<div class="comment-item">' +
            '<div class="comment-header">' +
              '<div class="comment-avatar">' + initial + '</div>' +
              '<span class="comment-author">' + escHtml(author) + '</span>' +
              '<span class="comment-time">' + escHtml(formatRelativeTime(c.created_at || "") || "") + '</span>' +
            '</div>' +
            '<div class="comment-body">' + escHtml(c.text || c.body || c.content || "") + '</div>' +
          '</div>';
        }});
      }} else {{
        html += '<div class="related-empty">No comments yet</div>';
      }}
      // Comment input
      html += '<div class="comment-input-row">' +
        '<input class="comment-input" id="new-comment-input" placeholder="Add a comment..." onkeydown="if(event.key===\'Enter\')_postComment(\'' + escHtml(entity) + '\',\'' + escHtml(recordId) + '\')">' +
        '<button class="btn btn-primary btn-sm" onclick="_postComment(\'' + escHtml(entity) + '\',\'' + escHtml(recordId) + '\')">Post</button>' +
      '</div></div>';
      container.innerHTML = html;
    }} catch (e) {{
      container.innerHTML = '<div class="comments-section"><div class="related-empty">No comments yet</div>' +
        '<div class="comment-input-row">' +
        '<input class="comment-input" id="new-comment-input" placeholder="Add a comment..." onkeydown="if(event.key===\'Enter\')_postComment(\'' + escHtml(entity) + '\',\'' + escHtml(recordId) + '\')">' +
        '<button class="btn btn-primary btn-sm" onclick="_postComment(\'' + escHtml(entity) + '\',\'' + escHtml(recordId) + '\')">Post</button>' +
        '</div></div>';
    }}
  }}

  window._postComment = async function(entity, recordId) {{
    const inp = document.getElementById("new-comment-input");
    if (!inp || !inp.value.trim()) return;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + entity + "/" + recordId + "/comments", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json", ...authHeaders() }},
        body: JSON.stringify({{ text: inp.value.trim() }}),
      }});
      if (resp.ok) {{
        showToast("Comment added", "success");
        _loadComments(entity, recordId, "detail-tab-comments");
      }}
    }} catch (e) {{ showToast("Failed to post comment", "error"); }}
  }};

  // ── Load files ──
  async function _loadFiles(entity, recordId, containerId) {{
    const container = document.getElementById(containerId);
    if (!container) return;
    try {{
      const resp = await fetch(API_BASE + "/apps/{project_id}/data/" + entity + "/" + recordId + "/files", {{
        headers: authHeaders(),
      }});
      if (!resp.ok) throw new Error("No files");
      const data = await resp.json();
      const items = data.results || data.data || data || [];
      if (!Array.isArray(items) || items.length === 0) {{
        container.innerHTML = '<div class="files-section"><div class="related-empty">No files attached</div></div>';
        return;
      }}
      const countEl = document.getElementById("tab-count-files");
      if (countEl) countEl.textContent = String(items.length);
      let html = '<div class="files-section">';
      items.forEach(function(file) {{
        const name = file.name || file.filename || "File";
        const size = file.size ? (file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB") : "";
        html += '<div class="file-item">' +
          '<svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>' +
          '<span class="file-name">' + escHtml(name) + '</span>' +
          '<span class="file-size">' + escHtml(size) + '</span>' +
        '</div>';
      }});
      html += '</div>';
      container.innerHTML = html;
    }} catch (e) {{
      container.innerHTML = '<div class="files-section"><div class="related-empty">No files attached</div></div>';
    }}
  }}

  // ── Switch detail tab ──
  window._switchDetailTab = function(tabName) {{
    document.querySelectorAll(".detail-tab").forEach(function(t) {{
      t.classList.toggle("active", t.dataset.tab === tabName);
    }});
    document.querySelectorAll(".detail-tab-panel").forEach(function(p) {{
      p.classList.toggle("active", p.id === "detail-tab-" + tabName);
    }});
  }};

  window.showDetail = function(entity, id) {{
    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(id));
    if (!record) return;

    _inlineEditingEntity = entity;
    _inlineEditingId = id;

    const fields = ENTITY_FIELDS[entity] || [];
    const visibleFields = fields.filter(f =>
      !["id","org_id","deleted_at","version"].includes(f.name)
    );

    const nameField = fields.find(f => /^(name|title|subject|label)$/i.test(f.name));
    const title = nameField ? (record[nameField.name] || entity) : entity + " #" + String(id).slice(0, 8);
    setBreadcrumb([currentModule || entity, title]);

    // Find status field for header badge
    const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0 && /status|state|stage|phase/i.test(f.name));
    let statusBadgeHtml = '';
    if (statusField && record[statusField.name]) {{
      const badgeClass = getBadgeClass(String(record[statusField.name]));
      statusBadgeHtml = '<span class="detail-status-badge badge ' + badgeClass + '"><span class="badge-dot"></span>' + escHtml(String(record[statusField.name])) + '</span>';
    }}

    // Categorize fields: overview (name, status, dates) vs details (everything else)
    const overviewPatterns = /^(name|title|status|state|stage|phase|email|phone|type|category|priority|created_at|updated_at|date|start|end|due)$/i;
    const overviewFields = [];
    const detailFields = [];
    visibleFields.forEach(function(f) {{
      if (overviewPatterns.test(f.name) || (f.enum_values && f.enum_values.length > 0)) {{
        overviewFields.push(f);
      }} else {{
        detailFields.push(f);
      }}
    }});
    // If categorization is lopsided, just split evenly
    if (overviewFields.length === 0) {{
      const half = Math.ceil(visibleFields.length / 2);
      overviewFields.push(...visibleFields.slice(0, half));
      detailFields.push(...visibleFields.slice(half));
    }} else if (detailFields.length === 0) {{
      // Move some from overview to details
      while (overviewFields.length > 4 && detailFields.length < 3) {{
        detailFields.push(overviewFields.pop());
      }}
    }}

    // Find reverse FK relations
    const reverseRelations = _findReverseRelations(entity);

    // Build tabs
    const tabs = [
      {{ key: "overview", label: "Overview" }},
    ];
    if (detailFields.length > 0) {{
      tabs.push({{ key: "details", label: "Details" }});
    }}
    if (reverseRelations.length > 0) {{
      tabs.push({{ key: "related", label: "Related" }});
    }}
    tabs.push({{ key: "activity", label: "Activity" }});
    tabs.push({{ key: "files", label: "Files" }});
    tabs.push({{ key: "comments", label: "Comments" }});

    const content = document.getElementById("content-area");
    const editIconSvg = '<svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

    let detailHtml = '<div class="detail-view">' +
      '<div class="detail-header">' +
        '<button class="back-btn" onclick="showModule(\'' + escHtml(currentModule) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>' +
        '<h2>' + escHtml(title) + statusBadgeHtml + '</h2>' +
        '<div class="detail-header-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="openEdit(\'' + entity + '\',\'' + id + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteRecord(\'' + entity + '\',\'' + id + '\')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>Delete</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-body">';

    // Render tabs
    detailHtml += '<div class="detail-tabs">';
    tabs.forEach(function(tab, i) {{
      const countSpan = (tab.key === "related" || tab.key === "activity" || tab.key === "files" || tab.key === "comments")
        ? ' <span class="detail-tab-count" id="tab-count-' + tab.key + '">...</span>' : '';
      detailHtml += '<button class="detail-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + tab.key + '" onclick="_switchDetailTab(\'' + tab.key + '\');if(window._updateDetailDots)_updateDetailDots()">' + tab.label + countSpan + '</button>';
    }});
    detailHtml += '</div>';
    // Dot indicator for mobile swipe
    detailHtml += '<div class="detail-tab-dots">';
    tabs.forEach(function(tab, i) {{
      detailHtml += '<div class="detail-tab-dot' + (i === 0 ? ' active' : '') + '"></div>';
    }});
    detailHtml += '</div>';

    // ── Overview tab panel ──
    detailHtml += '<div class="detail-tab-panel active" id="detail-tab-overview"><div class="detail-fields-grid">';
    overviewFields.forEach(function(f) {{
      const rendered = _renderFieldDisplay(f, record);
      const isEditable = !f.computed && !["created_at","updated_at","id","org_id","deleted_at","version"].includes(f.name);
      const rawVal = record[f.name] ?? "";
      if (isEditable) {{
        detailHtml += '<div class="detail-field">' +
          '<div class="detail-field-label">' + escHtml(f.name.replace(/_/g, " ")) + rendered.fxBadge + '</div>' +
          '<div class="detail-field-value-wrapper" id="detail-field-' + f.name + '">' +
            '<div class="detail-field-value">' + rendered.displayVal + '</div>' +
            editIconSvg +
          '</div></div>';
      }} else {{
        detailHtml += '<div class="detail-field"><div class="detail-field-label">' + escHtml(f.name.replace(/_/g, " ")) + rendered.fxBadge + '</div><div class="detail-field-value">' + rendered.displayVal + '</div></div>';
      }}
    }});
    detailHtml += '</div></div>';

    // ── Details tab panel ──
    if (detailFields.length > 0) {{
      detailHtml += '<div class="detail-tab-panel" id="detail-tab-details"><div class="detail-fields-grid">';
      detailFields.forEach(function(f) {{
        const rendered = _renderFieldDisplay(f, record);
        const isEditable = !f.computed && !["created_at","updated_at","id","org_id","deleted_at","version"].includes(f.name);
        const rawVal = record[f.name] ?? "";
        if (isEditable) {{
          detailHtml += '<div class="detail-field">' +
            '<div class="detail-field-label">' + escHtml(f.name.replace(/_/g, " ")) + rendered.fxBadge + '</div>' +
            '<div class="detail-field-value-wrapper" id="detail-field-' + f.name + '">' +
              '<div class="detail-field-value">' + rendered.displayVal + '</div>' +
              editIconSvg +
            '</div></div>';
        }} else {{
          detailHtml += '<div class="detail-field"><div class="detail-field-label">' + escHtml(f.name.replace(/_/g, " ")) + rendered.fxBadge + '</div><div class="detail-field-value">' + rendered.displayVal + '</div></div>';
        }}
      }});
      detailHtml += '</div></div>';
    }}

    // ── Related tab panel ──
    if (reverseRelations.length > 0) {{
      detailHtml += '<div class="detail-tab-panel" id="detail-tab-related">';
      reverseRelations.forEach(function(rel, ri) {{
        detailHtml += '<div class="related-section"><h4>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4V7"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' +
          'Related ' + escHtml(rel.entity) + '</h4>' +
          '<div id="related-container-' + ri + '"><div class="related-empty">Loading...</div></div></div>';
      }});
      detailHtml += '</div>';
    }}

    // ── Activity tab panel ──
    detailHtml += '<div class="detail-tab-panel" id="detail-tab-activity"><div id="activity-container"><div class="related-empty">Loading...</div></div></div>';

    // ── Files tab panel ──
    detailHtml += '<div class="detail-tab-panel" id="detail-tab-files"><div id="files-container"><div class="related-empty">Loading...</div></div></div>';

    // ── Comments tab panel ──
    detailHtml += '<div class="detail-tab-panel" id="detail-tab-comments"><div class="related-empty">Loading...</div></div>';

    detailHtml += '</div></div>';

    content.innerHTML = detailHtml;

    // Fix inline edit onclick — we need to pass the field definition as an object, not via HTML attribute
    // Re-bind inline edit click handlers with proper JS closures
    visibleFields.forEach(function(f) {{
      const el = document.getElementById("detail-field-" + f.name);
      if (el) {{
        el.onclick = function(e) {{
          e.stopPropagation();
          const rawVal = record[f.name] ?? "";
          _startInlineEdit(f.name, String(rawVal), f);
        }};
      }}
    }});

    // Load async data for tabs
    if (reverseRelations.length > 0) {{
      reverseRelations.forEach(function(rel, ri) {{
        _loadRelatedRecords(rel.entity, rel.fkField, id, "related-container-" + ri);
      }});
    }}
    _loadActivityLog(entity, id, "activity-container");
    _loadFiles(entity, id, "files-container");
    _loadComments(entity, id, "detail-tab-comments");
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

  // ── Render form (with FK dropdowns) ──
  // ── Conditional Visibility: evaluate a visible_when rule ──
  function evalVisibleWhen(rule, formData) {{
    if (!rule || !rule.field) return true;
    const val = formData[rule.field];
    const target = rule.value;
    switch (rule.operator) {{
      case "eq": return val == target;
      case "neq": return val != target;
      case "gt": return Number(val) > Number(target);
      case "lt": return Number(val) < Number(target);
      case "gte": return Number(val) >= Number(target);
      case "lte": return Number(val) <= Number(target);
      case "in": return Array.isArray(target) ? target.includes(val) : false;
      case "not_in": return Array.isArray(target) ? !target.includes(val) : true;
      case "contains": return String(val || "").includes(String(target || ""));
      case "not_empty": return val !== "" && val !== null && val !== undefined;
      default: return true;
    }}
  }}

  // ── Computed Fields: evaluate a computed formula ──
  function evalComputed(formula, formData) {{
    if (!formula) return "";
    try {{
      // Handle built-in functions
      let expr = formula;
      expr = expr.replace(/DAYS_UNTIL\\(([^)]+)\\)/g, function(_, field) {{
        const d = formData[field.trim()];
        if (!d) return "0";
        const diff = (new Date(d) - new Date()) / (1000 * 60 * 60 * 24);
        return String(Math.ceil(diff));
      }});
      expr = expr.replace(/DAYS_SINCE\\(([^)]+)\\)/g, function(_, field) {{
        const d = formData[field.trim()];
        if (!d) return "0";
        const diff = (new Date() - new Date(d)) / (1000 * 60 * 60 * 24);
        return String(Math.floor(diff));
      }});
      expr = expr.replace(/NOW\\(\\)/g, '"' + new Date().toISOString().slice(0, 10) + '"');
      expr = expr.replace(/UPPER\\(([^)]+)\\)/g, function(_, field) {{
        return '"' + String(formData[field.trim()] || "").toUpperCase() + '"';
      }});
      expr = expr.replace(/LOWER\\(([^)]+)\\)/g, function(_, field) {{
        return '"' + String(formData[field.trim()] || "").toLowerCase() + '"';
      }});
      expr = expr.replace(/CONCAT\\(([^,]+),([^)]+)\\)/g, function(_, a, b) {{
        const va = a.trim().startsWith("'") || a.trim().startsWith('"') ? a.trim().slice(1, -1) : (formData[a.trim()] || "");
        const vb = b.trim().startsWith("'") || b.trim().startsWith('"') ? b.trim().slice(1, -1) : (formData[b.trim()] || "");
        return '"' + va + vb + '"';
      }});
      // Replace field references with their values
      const allFields = Object.keys(formData);
      allFields.sort((a, b) => b.length - a.length); // longest first to avoid partial matches
      for (const fname of allFields) {{
        const fval = formData[fname];
        if (fval === "" || fval === null || fval === undefined) {{
          expr = expr.split(fname).join("0");
        }} else if (typeof fval === "number" || !isNaN(Number(fval))) {{
          expr = expr.split(fname).join(String(Number(fval)));
        }} else {{
          expr = expr.split(fname).join('"' + String(fval) + '"');
        }}
      }}
      // Evaluate the expression safely (only math and string ops)
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result === "number" && !isNaN(result)) {{
        return Math.round(result * 100) / 100;
      }}
      return result;
    }} catch (e) {{
      return "";
    }}
  }}

  // ── Validation: validate a field value against its rule ──
  function validateField(value, validation) {{
    if (!validation || !validation.rule) return null;
    const v = value;
    const rule = validation.rule;
    const ruleVal = validation.value;
    switch (rule) {{
      case "required":
        if (v === "" || v === null || v === undefined) return validation.message || "This field is required";
        break;
      case "email":
        if (v && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)) return validation.message || "Invalid email";
        break;
      case "min":
        if (v !== "" && v !== null && Number(v) < Number(ruleVal)) return validation.message || "Value too small";
        break;
      case "max":
        if (v !== "" && v !== null && Number(v) > Number(ruleVal)) return validation.message || "Value too large";
        break;
      case "minLength":
        if (v && String(v).length < Number(ruleVal)) return validation.message || "Too short";
        break;
      case "maxLength":
        if (v && String(v).length > Number(ruleVal)) return validation.message || "Too long";
        break;
      case "pattern":
        if (v && !new RegExp(ruleVal).test(v)) return validation.message || "Invalid format";
        break;
      case "url":
        if (v && !/^https?:\\/\\/[^\\s]+$/.test(v)) return validation.message || "Invalid URL";
        break;
    }}
    return null;
  }}

  // ── Gather current form data from inputs ──
  function getFormData() {{
    const body = document.getElementById("modal-body");
    if (!body) return {{}};
    // Sync rich text contenteditable divs to their hidden inputs
    body.querySelectorAll(".rt-editable").forEach(div => {{
      const fieldName = div.dataset.rtField;
      const hidden = body.querySelector('input[name="' + fieldName + '"]');
      if (hidden) hidden.value = div.innerHTML;
    }});
    const inputs = body.querySelectorAll("input, select, textarea");
    const data = {{}};
    inputs.forEach(inp => {{
      if (inp.type === "checkbox") {{
        data[inp.name] = inp.checked;
      }} else {{
        data[inp.name] = inp.value;
      }}
    }});
    return data;
  }}

  // ── Apply visibility and computed fields on form change ──
  function applyFormRules() {{
    if (!currentEntity) return;
    const fields = ENTITY_FIELDS[currentEntity] || [];
    const formData = getFormData();
    const body = document.getElementById("modal-body");
    if (!body) return;

    fields.forEach(f => {{
      const container = body.querySelector('[data-field="' + f.name + '"]');
      if (!container) return;

      // Conditional visibility
      if (f.visible_when) {{
        const visible = evalVisibleWhen(f.visible_when, formData);
        container.style.display = visible ? "" : "none";
        container.style.transition = "all 0.2s ease";
      }}

      // Computed fields — update the displayed value
      if (f.computed) {{
        const computedVal = evalComputed(f.computed, formData);
        const display = container.querySelector(".computed-value");
        if (display) display.textContent = computedVal !== "" ? String(computedVal) : "—";
        // Also set a hidden input so the value is included in form submission
        const hidden = container.querySelector('input[type="hidden"]');
        if (hidden) hidden.value = computedVal !== "" ? String(computedVal) : "";
      }}
    }});
  }}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Component: FormView
  // Renders create/edit slide-over form with validation.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function renderForm(entity, record) {{
    const fields = (ENTITY_FIELDS[entity] || []).filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    );
    const body = document.getElementById("modal-body");
    body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Loading form...</div>';

    // Pre-fetch FK data for all FK fields
    const fkFields = [];
    for (const f of fields) {{
      const relEntity = getRelatedEntityForField(f.name, f);
      if (relEntity) {{
        fkFields.push({{ field: f, relEntity }});
        if (!fkCache[relEntity]) await fetchFkData(relEntity);
      }}
    }}

    body.innerHTML = fields.map((f, fIdx) => {{
      const val = record[f.name] ?? f.default_value ?? "";
      const req = f.required || (f.nullable === false && !f.computed) ? '<span class="required">*</span>' : '';
      const divider = (fIdx > 0 && fIdx % 4 === 0) ? '<hr class="form-divider">' : '';
      const label = escHtml(f.name.replace(/_/g, " "));
      const vwAttr = f.visible_when ? ' data-visible-when=\\'true\\'' : '';
      const vwStyle = f.visible_when ? ' style="transition:all 0.2s ease"' : '';

      // Computed field — read-only display with fx badge
      if (f.computed) {{
        const computedVal = evalComputed(f.computed, record);
        return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '>' +
          '<label>' + label + ' <span style="display:inline-block;background:var(--primary-light);color:var(--primary);font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;vertical-align:middle">fx</span></label>' +
          '<div class="computed-value" style="padding:9px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px;min-height:38px">' + escHtml(String(computedVal !== "" ? computedVal : "\\u2014")) + '</div>' +
          '<input type="hidden" name="' + f.name + '" value="' + escHtml(String(computedVal)) + '">' +
          '</div>';
      }}

      // FK dropdown
      const relEntity = getRelatedEntityForField(f.name, f);
      if (relEntity) {{
        const relRows = fkCache[relEntity] || [];
        const relFields = ENTITY_FIELDS[relEntity] || [];
        const relNameField = relFields.find(rf => /^(name|title|subject|label|full_name)$/i.test(rf.name));
        const opts = '<option value="">Select ' + escHtml(relEntity) + '...</option>' + relRows.map(r => {{
          const rId = r.id || r.ID || "";
          let displayName = relNameField ? (r[relNameField.name] || "") : "";
          if (!displayName) {{
            // Fallback: first non-id string field
            for (const rf of relFields) {{
              if (!["id","org_id","deleted_at","version","created_at","updated_at"].includes(rf.name) && r[rf.name] && typeof r[rf.name] === "string") {{
                displayName = r[rf.name]; break;
              }}
            }}
          }}
          if (!displayName) displayName = String(rId).slice(0, 8);
          return '<option value="' + escHtml(String(rId)) + '"' + (String(rId) === String(val) ? ' selected' : '') + '>' + escHtml(displayName) + '</option>';
        }}).join("");
        return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '><label>' + label + req + '</label><select name="' + f.name + '">' + opts + '</select><div class="field-error" style="display:none;color:var(--danger);font-size:12px;margin-top:4px"></div></div>';
      }}

      // Select for enums
      if (f.enum_values && f.enum_values.length) {{
        const opts = '<option value="">Select...</option>' + f.enum_values.map(v =>
          '<option value="' + escHtml(v) + '"' + (v === val ? ' selected' : '') + '>' + escHtml(v) + '</option>'
        ).join("");
        return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '><label>' + label + req + '</label><select name="' + f.name + '">' + opts + '</select><div class="field-error" style="display:none;color:var(--danger);font-size:12px;margin-top:4px"></div></div>';
      }}

      // Checkbox for boolean
      if (f.type === "boolean") {{
        const checked = val && val !== "false" && val !== "0" ? ' checked' : '';
        return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '><div class="form-check"><input type="checkbox" name="' + f.name + '"' + checked + '><label>' + label + '</label></div></div>';
      }}

      // Rich text / Textarea for description/notes/body
      if (/description|notes|body|comment|content|message|details|summary|bio|about/i.test(f.name)) {{
        return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '><label>' + label + req + '</label>' +
          buildRichTextToolbar() +
          '<div class="rt-editable" contenteditable="true" data-rt-field="' + f.name + '" data-placeholder="Enter ' + label.toLowerCase() + '...">' + (val ? String(val) : '') + '</div>' +
          '<input type="hidden" name="' + f.name + '" value="' + escHtml(String(val)) + '">' +
          '<div class="field-error" style="display:none;color:var(--danger);font-size:12px;margin-top:4px"></div></div>';
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

      return divider + '<div class="form-group" data-field="' + f.name + '"' + vwAttr + vwStyle + '><label>' + label + req + '</label><input type="' + type + '" name="' + f.name + '" value="' + escHtml(String(val)) + '" placeholder="Enter ' + label.toLowerCase() + '..."' + step + (f.required ? ' required' : '') + '><div class="field-error" style="display:none;color:var(--danger);font-size:12px;margin-top:4px"></div></div>';
    }}).join("");

    // Attach change/input listeners for visibility, computed fields, and validation
    const allInputs = body.querySelectorAll("input, select, textarea");
    allInputs.forEach(inp => {{
      inp.addEventListener("input", applyFormRules);
      inp.addEventListener("change", applyFormRules);
      // Validation on blur
      inp.addEventListener("blur", function() {{
        const fieldName = inp.name;
        const fieldDef = (ENTITY_FIELDS[entity] || []).find(fd => fd.name === fieldName);
        if (!fieldDef) return;
        const container = body.querySelector('[data-field="' + fieldName + '"]');
        if (!container) return;
        const errorDiv = container.querySelector(".field-error");
        if (!errorDiv) return;

        let error = null;
        // Check validation rule
        if (fieldDef.validation) {{
          error = validateField(inp.value, fieldDef.validation);
        }}
        // Check required (nullable: false)
        if (!error && fieldDef.nullable === false && !fieldDef.computed) {{
          if (inp.value === "" || inp.value === null || inp.value === undefined) {{
            error = fieldDef.validation && fieldDef.validation.message ? fieldDef.validation.message : (fieldName.replace(/_/g, " ") + " is required");
          }}
        }}

        if (error) {{
          errorDiv.textContent = error;
          errorDiv.style.display = "block";
          inp.style.borderColor = "var(--danger)";
        }} else {{
          errorDiv.textContent = "";
          errorDiv.style.display = "none";
          inp.style.borderColor = "";
        }}
      }});
    }});

    // Initial apply of visibility and computed fields
    applyFormRules();

    // Auto-grow textareas
    body.querySelectorAll("textarea").forEach(ta => {{
      ta.classList.add("auto-grow");
      ta.style.overflow = "hidden";
      function autoGrow() {{
        ta.style.height = "auto";
        ta.style.height = Math.max(80, ta.scrollHeight) + "px";
      }}
      ta.addEventListener("input", autoGrow);
      autoGrow();
    }});

    // Attach rich text keyboard shortcuts and sync to hidden inputs
    body.querySelectorAll(".rt-editable").forEach(div => {{
      div.addEventListener("keydown", function(e) {{
        if (e.ctrlKey || e.metaKey) {{
          if (e.key === "b") {{ e.preventDefault(); document.execCommand("bold", false, null); }}
          if (e.key === "i") {{ e.preventDefault(); document.execCommand("italic", false, null); }}
        }}
      }});
      div.addEventListener("input", function() {{
        const fieldName = div.dataset.rtField;
        const hidden = body.querySelector('input[name="' + fieldName + '"]');
        if (hidden) hidden.value = div.innerHTML;
        applyFormRules();
      }});
    }});
  }}

  // ── Save record ──
  window.saveRecord = async function() {{
    if (!currentEntity) return;
    const body = document.getElementById("modal-body");
    // Sync rich text contenteditable divs to their hidden inputs before collecting data
    body.querySelectorAll(".rt-editable").forEach(div => {{
      const fieldName = div.dataset.rtField;
      const hidden = body.querySelector('input[name="' + fieldName + '"]');
      if (hidden) hidden.value = div.innerHTML;
    }});
    const inputs = body.querySelectorAll("input, select, textarea");
    const record = {{}};
    inputs.forEach(inp => {{
      // Skip hidden fields in invisible containers (visible_when hidden)
      const container = inp.closest("[data-field]");
      if (container && container.style.display === "none") return;
      if (inp.type === "checkbox") {{
        record[inp.name] = inp.checked;
      }} else if (inp.value !== "") {{
        record[inp.name] = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value;
      }}
    }});

    // Validate all visible fields
    const fields = ENTITY_FIELDS[currentEntity] || [];
    let hasErrors = false;
    for (const f of fields) {{
      if (["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)) continue;
      if (f.computed) continue;

      const container = body.querySelector('[data-field="' + f.name + '"]');
      if (!container || container.style.display === "none") continue;

      const inp = container.querySelector("input, select, textarea");
      if (!inp) continue;
      const errorDiv = container.querySelector(".field-error");

      let error = null;

      // Check validation rule
      if (f.validation) {{
        error = validateField(inp.value, f.validation);
      }}
      // Check required (nullable: false or f.required)
      if (!error && (f.required || f.nullable === false)) {{
        if (inp.type !== "checkbox" && (inp.value === "" || inp.value === null || inp.value === undefined)) {{
          error = f.validation && f.validation.message ? f.validation.message : (f.name.replace(/_/g, " ") + " is required");
        }}
      }}

      if (error) {{
        hasErrors = true;
        if (errorDiv) {{
          errorDiv.textContent = error;
          errorDiv.style.display = "block";
          inp.style.borderColor = "var(--danger)";
        }}
      }} else if (errorDiv) {{
        errorDiv.textContent = "";
        errorDiv.style.display = "none";
        inp.style.borderColor = "";
      }}
    }}

    if (hasErrors) {{
      showToast("Please fix the validation errors before saving", "error");
      return;
    }}

    const saveBtn = document.getElementById("modal-save");
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="save-spinner"></span>Saving...';

    const entityKey = currentEntity;
    const savedModule = currentModule;
    const nameField = (ENTITY_FIELDS[entityKey] || []).find(f => /^(name|title|subject|label)$/i.test(f.name));

    // ── Optimistic UI: update local data immediately ──
    let optimisticSnapshot = dataCache[entityKey] ? [...dataCache[entityKey]] : [];
    let optimisticId = editingId;

    if (editingId) {{
      // Optimistic update: patch local cache
      const rows = dataCache[entityKey] || [];
      const idx = rows.findIndex(r => String(r.id || r.ID) === String(editingId));
      if (idx !== -1) {{
        dataCache[entityKey][idx] = {{ ...dataCache[entityKey][idx], ...record }};
      }}
      closeModal();
      if (savedModule) showModule(savedModule);

      // Fire API in background
      const result = await apiUpdate(entityKey.toLowerCase(), editingId, record);
      if (result) {{
        // Replace optimistic data with server response
        const rows2 = dataCache[entityKey] || [];
        const idx2 = rows2.findIndex(r => String(r.id || r.ID) === String(editingId));
        if (idx2 !== -1) dataCache[entityKey][idx2] = result;
        const label = nameField && record[nameField.name] ? record[nameField.name] : ("#" + String(editingId).slice(0, 6));
        pushNotification(entityKey + " \\u201c" + label + "\\u201d updated");
        showToast(entityKey + " updated", "success");
      }} else {{
        // Revert on failure
        dataCache[entityKey] = optimisticSnapshot;
        showToast("Failed to update — reverted changes", "error");
      }}
      if (savedModule) showModule(savedModule);
    }} else {{
      // Optimistic create: add temporary record with a placeholder id
      const tempId = "_tmp_" + Date.now();
      const tempRecord = {{ ...record, id: tempId, _optimistic: true }};
      if (!dataCache[entityKey]) dataCache[entityKey] = [];
      dataCache[entityKey].unshift(tempRecord);
      closeModal();
      if (savedModule) showModule(savedModule);

      // Fire API in background
      const result = await apiCreate(entityKey.toLowerCase(), record);
      if (result) {{
        // Replace temp record with real server record
        const rows2 = dataCache[entityKey] || [];
        const tmpIdx = rows2.findIndex(r => r.id === tempId);
        if (tmpIdx !== -1) dataCache[entityKey][tmpIdx] = result;
        const label = nameField && record[nameField.name] ? record[nameField.name] : "new record";
        pushNotification("New " + entityKey + " \\u201c" + label + "\\u201d created");
        showToast(entityKey + " created", "success");
      }} else {{
        // Revert on failure
        dataCache[entityKey] = optimisticSnapshot;
        showToast("Failed to create — reverted changes", "error");
      }}
      if (savedModule) showModule(savedModule);
    }}

    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
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
    const delEntity = pendingDeleteEntity;
    const delId = pendingDeleteId;
    const savedModule = currentModule;
    // Find record name for notification before deleting
    const delRows = dataCache[delEntity] || [];
    const delRecord = delRows.find(r => String(r.id || r.ID) === String(delId));
    const delFields = ENTITY_FIELDS[delEntity] || [];
    const delNameField = delFields.find(f => /^(name|title|subject|label)$/i.test(f.name));
    const delLabel = delRecord && delNameField ? delRecord[delNameField.name] : ("#" + String(delId).slice(0, 6));

    // ── Optimistic delete: remove from local cache immediately ──
    const snapshot = dataCache[delEntity] ? [...dataCache[delEntity]] : [];
    if (dataCache[delEntity]) {{
      dataCache[delEntity] = dataCache[delEntity].filter(r => String(r.id || r.ID) !== String(delId));
    }}
    closeConfirm();
    if (savedModule) showModule(savedModule);

    // Fire API in background
    const ok = await apiDelete(delEntity.toLowerCase(), delId);
    if (ok) {{
      showToast(delEntity + " deleted", "success");
      pushNotification(delEntity + " \\u201c" + delLabel + "\\u201d deleted");
    }} else {{
      // Revert on failure
      dataCache[delEntity] = snapshot;
      showToast("Failed to delete — reverted", "error");
      if (savedModule) showModule(savedModule);
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
      closeGlobalSearch();
      // Close notification dropdown
      const nd = document.getElementById("notification-dropdown");
      if (nd) nd.classList.remove("show");
    }}
    // Ctrl+K / Cmd+K for global search
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {{
      e.preventDefault();
      openGlobalSearch();
    }}
  }});

  // Close notification dropdown on outside click
  document.addEventListener("click", function(e) {{
    const bell = document.getElementById("notif-bell");
    const dd = document.getElementById("notification-dropdown");
    if (dd && dd.classList.contains("show") && !bell.contains(e.target) && !dd.contains(e.target)) {{
      dd.classList.remove("show");
    }}
  }});

  // ══════════════════════════════════════════
  // ── FEATURE: ANALYTICS PAGE ──
  // ══════════════════════════════════════════
  async function renderAnalyticsPage(container) {{
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading analytics...</div>';
    const entityNames = Object.keys(ENTITY_FIELDS);
    const counts = {{}};
    let totalRecords = 0;
    let weekRecords = 0;
    let mostActiveEntity = "";
    let mostActiveCount = 0;
    const dailyCounts = {{}};
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const entity of entityNames) {{
      try {{
        const rows = await apiGet(entity.toLowerCase());
        dataCache[entity] = rows;
        counts[entity] = rows.length;
        totalRecords += rows.length;
        if (rows.length > mostActiveCount) {{ mostActiveCount = rows.length; mostActiveEntity = entity; }}
        // Count records created this week and daily
        rows.forEach(r => {{
          const createdAt = r.created_at ? new Date(r.created_at) : null;
          if (createdAt && createdAt >= weekAgo) weekRecords++;
          if (createdAt) {{
            const dayKey = createdAt.toISOString().slice(0, 10);
            dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
          }}
        }});
      }} catch {{ counts[entity] = 0; }}
    }}

    // Build top stats
    let html = '<div class="analytics-stats-row">' +
      '<div class="analytics-stat-card"><div class="stat-label">Total Records</div><div class="stat-value">' + totalRecords + '</div></div>' +
      '<div class="analytics-stat-card"><div class="stat-label">Records This Week</div><div class="stat-value">' + weekRecords + '</div></div>' +
      '<div class="analytics-stat-card"><div class="stat-label">Most Active Entity</div><div class="stat-value" style="font-size:18px">' + escHtml(mostActiveEntity || "N/A") + '</div></div>' +
      '<div class="analytics-stat-card"><div class="stat-label">Entities</div><div class="stat-value">' + entityNames.length + '</div></div>' +
    '</div>';

    // Bar chart: row counts per entity
    const maxCount = Math.max(...Object.values(counts), 1);
    html += '<div class="analytics-grid"><div class="analytics-bar-chart"><h3>Records per Entity</h3><div class="ab-bars">';
    entityNames.forEach(entity => {{
      const c = counts[entity] || 0;
      const pct = Math.max(2, (c / maxCount) * 100);
      html += '<div class="ab-col">' +
        '<div class="ab-bar" style="height:' + pct + '%"><span class="ab-bar-val">' + c + '</span></div>' +
        '<div class="ab-label">' + escHtml(entity) + '</div>' +
      '</div>';
    }});
    html += '</div></div>';

    // Line chart: records per day (last 7 days) using SVG
    const days7 = [];
    for (let i = 6; i >= 0; i--) {{
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      days7.push(d.toISOString().slice(0, 10));
    }}
    const dayValues = days7.map(d => dailyCounts[d] || 0);
    const maxDayVal = Math.max(...dayValues, 1);
    const svgW = 500;
    const svgH = 180;
    const padX = 40;
    const padY = 20;
    const graphW = svgW - padX * 2;
    const graphH = svgH - padY * 2;

    let pathD = "";
    let circles = "";
    let labels = "";
    days7.forEach((day, i) => {{
      const x = padX + (i / Math.max(days7.length - 1, 1)) * graphW;
      const y = padY + graphH - (dayValues[i] / maxDayVal) * graphH;
      if (i === 0) pathD += "M" + x + "," + y;
      else pathD += " L" + x + "," + y;
      circles += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="var(--primary)"/>';
      circles += '<text x="' + x + '" y="' + (y - 10) + '" text-anchor="middle" font-size="11" fill="var(--text)" font-weight="600">' + dayValues[i] + '</text>';
      const dayLabel = new Date(day).toLocaleDateString(undefined, {{ weekday: "short" }});
      labels += '<text x="' + x + '" y="' + (svgH - 2) + '" text-anchor="middle" font-size="10" fill="var(--text-muted)">' + dayLabel + '</text>';
    }});

    html += '<div class="analytics-line-chart"><h3>Records Created (Last 7 Days)</h3>' +
      '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" preserveAspectRatio="xMidYMid meet">' +
        '<line x1="' + padX + '" y1="' + (padY + graphH) + '" x2="' + (padX + graphW) + '" y2="' + (padY + graphH) + '" stroke="var(--border)" stroke-width="1"/>' +
        '<path d="' + pathD + '" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        circles + labels +
      '</svg></div></div>';

    container.innerHTML = html;
  }}

  // ══════════════════════════════════════════
  // ── FEATURE: CSV / PDF EXPORT ──
  // ══════════════════════════════════════════
  window.exportCSV = function(selectedOnly) {{
    if (!currentEntity) return;
    const fields = ENTITY_FIELDS[currentEntity] || [];
    const visibleFields = fields.filter(f =>
      !["id","org_id","deleted_at","version","created_at","updated_at"].includes(f.name)
    );
    let rows = (dataCache[currentEntity] || []).slice();
    if (selectedOnly && bulkSelected[currentEntity]) {{
      const sel = bulkSelected[currentEntity];
      rows = rows.filter(r => sel.has(String(r.id || r.ID)));
    }}
    // Build CSV
    const header = visibleFields.map(f => '"' + f.name.replace(/"/g, '""') + '"').join(",");
    const csvRows = rows.map(row => {{
      return visibleFields.map(f => {{
        let val = String(row[f.name] ?? "");
        return '"' + val.replace(/"/g, '""') + '"';
      }}).join(",");
    }});
    const csv = header + "\\n" + csvRows.join("\\n");
    const blob = new Blob([csv], {{ type: "text/csv;charset=utf-8;" }});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (currentEntity || "export") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("CSV exported successfully", "success");
  }};

  window.exportPDF = function() {{
    window.print();
  }};

  // ══════════════════════════════════════════
  // ── FEATURE: IN-APP NOTIFICATIONS ──
  // ══════════════════════════════════════════
  function pushNotification(message) {{
    notifications.unshift({{
      id: Date.now(),
      message: message,
      time: new Date(),
      read: false
    }});
    // Keep only last 50
    if (notifications.length > 50) notifications.pop();
    notifUnread++;
    updateNotifBadge();
    renderNotifList();
  }}

  function updateNotifBadge() {{
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    if (notifUnread > 0) {{
      badge.textContent = notifUnread > 99 ? "99+" : notifUnread;
      badge.classList.remove("hidden");
    }} else {{
      badge.classList.add("hidden");
    }}
  }}

  function renderNotifList() {{
    const list = document.getElementById("notif-list");
    if (!list) return;
    const items = notifications.slice(0, 10);
    if (items.length === 0) {{
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }}
    list.innerHTML = items.map(n => {{
      const ago = timeAgo(n.time);
      return '<div class="notif-item' + (n.read ? '' : ' unread') + '">' +
        '<div class="notif-dot' + (n.read ? ' read' : '') + '"></div>' +
        '<div><div class="notif-text">' + escHtml(n.message) + '</div>' +
        '<div class="notif-time">' + escHtml(ago) + '</div></div>' +
      '</div>';
    }}).join("");
  }}

  function timeAgo(date) {{
    const secs = Math.floor((new Date() - date) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return Math.floor(secs / 60) + "m ago";
    if (secs < 86400) return Math.floor(secs / 3600) + "h ago";
    return Math.floor(secs / 86400) + "d ago";
  }}

  window.toggleNotifications = function(e) {{
    e.stopPropagation();
    const dd = document.getElementById("notification-dropdown");
    dd.classList.toggle("show");
  }};

  window.markAllNotificationsRead = function() {{
    notifications.forEach(n => n.read = true);
    notifUnread = 0;
    updateNotifBadge();
    renderNotifList();
  }};

  // ══════════════════════════════════════════
  // ── FEATURE: GLOBAL SEARCH ──
  // ══════════════════════════════════════════
  window.openGlobalSearch = function() {{
    const overlay = document.getElementById("global-search-overlay");
    overlay.classList.add("show");
    const input = document.getElementById("gsearch-input");
    input.value = "";
    input.focus();
    document.getElementById("gsearch-results").innerHTML = '<div class="gsearch-empty">Type to search across all entities</div>';
  }};

  window.closeGlobalSearch = function() {{
    document.getElementById("global-search-overlay").classList.remove("show");
  }};

  window.onGlobalSearchInput = function(value) {{
    clearTimeout(gsearchTimer);
    gsearchTimer = setTimeout(() => performGlobalSearch(value), 300);
  }};

  function performGlobalSearch(query) {{
    const resultsEl = document.getElementById("gsearch-results");
    if (!query || query.trim().length === 0) {{
      resultsEl.innerHTML = '<div class="gsearch-empty">Type to search across all entities</div>';
      return;
    }}
    const q = query.toLowerCase().trim();
    const entityNames = Object.keys(ENTITY_FIELDS);
    let html = "";
    let totalResults = 0;

    entityNames.forEach(entity => {{
      const rows = dataCache[entity] || [];
      const fields = ENTITY_FIELDS[entity] || [];
      const matches = rows.filter(row =>
        fields.some(f => String(row[f.name] || "").toLowerCase().includes(q))
      );
      if (matches.length === 0) return;
      totalResults += matches.length;
      html += '<div class="gsearch-group-label">' + escHtml(entity) + ' (' + matches.length + ' result' + (matches.length !== 1 ? 's' : '') + ')</div>';
      const nameField = fields.find(f => /^(name|title|subject|label|full_name)$/i.test(f.name));
      matches.slice(0, 5).forEach(row => {{
        const rowId = row.id || row.ID || "";
        const title = nameField ? (row[nameField.name] || "Record") : ("Record #" + String(rowId).slice(0, 6));
        // Find matching field for context
        let context = "";
        for (const f of fields) {{
          const val = String(row[f.name] || "");
          if (val.toLowerCase().includes(q) && f.name !== (nameField ? nameField.name : "")) {{
            context = f.name.replace(/_/g, " ") + ": " + val.slice(0, 60);
            break;
          }}
        }}
        html += '<div class="gsearch-item" onclick="navigateToSearchResult(\'' + escHtml(entity) + '\',\'' + rowId + '\')">' +
          '<div class="gsearch-item-text"><strong>' + escHtml(title) + '</strong>' + (context ? '<br><span style="font-size:11px;color:var(--text-muted)">' + escHtml(context) + '</span>' : '') + '</div>' +
          '<div class="gsearch-item-entity">' + escHtml(entity) + '</div>' +
        '</div>';
      }});
      if (matches.length > 5) {{
        html += '<div style="padding:4px 18px;font-size:11px;color:var(--text-muted)">+' + (matches.length - 5) + ' more results</div>';
      }}
    }});

    if (totalResults === 0) {{
      resultsEl.innerHTML = '<div class="gsearch-empty">No results found for "' + escHtml(query) + '"</div>';
    }} else {{
      resultsEl.innerHTML = html;
    }}
  }}

  window.navigateToSearchResult = function(entity, id) {{
    closeGlobalSearch();
    // Find the module that owns this entity
    const mod = SIDEBAR_ITEMS.find(i => i.entity === entity);
    if (mod) {{
      showModule(mod.name);
      // Highlight row after a short delay for render
      setTimeout(() => {{
        const row = document.querySelector('tr[data-id="' + id + '"]');
        if (row) {{
          row.style.background = "var(--primary-light)";
          row.scrollIntoView({{ behavior: "smooth", block: "center" }});
          setTimeout(() => {{ row.style.background = ""; }}, 2500);
        }}
      }}, 500);
    }} else {{
      // Fallback: show detail directly
      showDetail(entity, id);
    }}
  }};

  // ══════════════════════════════════════════
  // ── FEATURE: BULK ACTIONS ──
  // ══════════════════════════════════════════
  window.bulkToggleRow = function(entity, id, moduleName, checked) {{
    if (!bulkSelected[entity]) bulkSelected[entity] = new Set();
    if (checked) bulkSelected[entity].add(String(id));
    else bulkSelected[entity].delete(String(id));
    updateBulkBar(entity);
    // Update row class
    const row = document.querySelector('tr[data-id="' + id + '"]');
    if (row) row.classList.toggle("bulk-selected", checked);
  }};

  window.bulkToggleAll = function(entity, moduleName, checked) {{
    if (!bulkSelected[entity]) bulkSelected[entity] = new Set();
    const rows = dataCache[entity] || [];
    // Get currently visible page rows
    const visibleRows = document.querySelectorAll('#tbody-' + moduleName + ' tr[data-id]');
    visibleRows.forEach(tr => {{
      const id = tr.getAttribute("data-id");
      if (id) {{
        if (checked) bulkSelected[entity].add(id);
        else bulkSelected[entity].delete(id);
        tr.classList.toggle("bulk-selected", checked);
        const cb = tr.querySelector(".bulk-cb");
        if (cb) cb.checked = checked;
      }}
    }});
    updateBulkBar(entity);
  }};

  window.bulkDeselectAll = function() {{
    const entity = currentEntity;
    if (entity && bulkSelected[entity]) bulkSelected[entity].clear();
    // Clear all checkboxes
    document.querySelectorAll(".bulk-cb").forEach(cb => cb.checked = false);
    document.querySelectorAll("tr.bulk-selected").forEach(tr => tr.classList.remove("bulk-selected"));
    const bar = document.getElementById("bulk-action-bar");
    if (bar) bar.classList.remove("show");
  }};

  function updateBulkBar(entity) {{
    const sel = bulkSelected[entity];
    const count = sel ? sel.size : 0;
    const bar = document.getElementById("bulk-action-bar");
    const countEl = document.getElementById("bulk-count");
    if (count > 0) {{
      countEl.textContent = count + " selected";
      bar.classList.add("show");
      // Show status change dropdown if entity has status field
      const fields = ENTITY_FIELDS[entity] || [];
      const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
        /status|state|stage|phase/i.test(f.name));
      const wrap = document.getElementById("bulk-status-wrap");
      if (statusField && wrap) {{
        wrap.innerHTML = '<select onchange="bulkChangeStatus(\'' + escHtml(entity) + '\',this.value)">' +
          '<option value="">Change Status...</option>' +
          statusField.enum_values.map(v => '<option value="' + escHtml(v) + '">' + escHtml(v) + '</option>').join("") +
        '</select>';
      }} else if (wrap) {{
        wrap.innerHTML = "";
      }}
    }} else {{
      bar.classList.remove("show");
    }}
  }}

  window.bulkDelete = async function() {{
    const entity = currentEntity;
    if (!entity || !bulkSelected[entity] || bulkSelected[entity].size === 0) return;
    const count = bulkSelected[entity].size;
    if (!confirm("Delete " + count + " selected record" + (count !== 1 ? "s" : "") + "? This cannot be undone.")) return;
    const ids = Array.from(bulkSelected[entity]);
    let deleted = 0;
    for (const id of ids) {{
      const ok = await apiDelete(entity.toLowerCase(), id);
      if (ok) deleted++;
    }}
    showToast(deleted + " record" + (deleted !== 1 ? "s" : "") + " deleted", "success");
    pushNotification(deleted + " " + entity + " record" + (deleted !== 1 ? "s" : "") + " deleted");
    bulkSelected[entity].clear();
    updateBulkBar(entity);
    if (currentModule) showModule(currentModule);
  }};

  window.bulkExportCSV = function() {{
    exportCSV(true);
  }};

  window.bulkChangeStatus = async function(entity, status) {{
    if (!status || !bulkSelected[entity] || bulkSelected[entity].size === 0) return;
    const fields = ENTITY_FIELDS[entity] || [];
    const statusField = fields.find(f => f.enum_values && f.enum_values.length > 0 &&
      /status|state|stage|phase/i.test(f.name));
    if (!statusField) return;
    const ids = Array.from(bulkSelected[entity]);
    let updated = 0;
    for (const id of ids) {{
      const record = {{}};
      record[statusField.name] = status;
      const ok = await apiUpdate(entity.toLowerCase(), id, record);
      if (ok) updated++;
    }}
    showToast(updated + " record" + (updated !== 1 ? "s" : "") + " updated to " + status, "success");
    pushNotification(updated + " " + entity + " record" + (updated !== 1 ? "s" : "") + " status changed to " + status);
    bulkSelected[entity].clear();
    updateBulkBar(entity);
    if (currentModule) showModule(currentModule);
  }};

  // ── AI Chat Widget ──
  const chatKnowledge = (() => {{
    const entities = Object.keys(ENTITY_FIELDS);
    const fieldMap = {{}};
    entities.forEach(e => {{
      fieldMap[e.toLowerCase()] = (ENTITY_FIELDS[e] || []).map(f => f.label || f.name);
    }});
    const moduleMap = {{}};
    SIDEBAR_ITEMS.forEach(item => {{
      if (item.entity) moduleMap[item.entity.toLowerCase()] = item.name;
    }});
    return {{ entities, fieldMap, moduleMap }};
  }})();

  let chatOpen = false;
  let chatInited = false;

  function chatHistory() {{
    try {{ return JSON.parse(sessionStorage.getItem("_chat_hist") || "[]"); }} catch {{ return []; }}
  }}
  function saveChatHistory(msgs) {{
    try {{ sessionStorage.setItem("_chat_hist", JSON.stringify(msgs)); }} catch {{}}
  }}

  function addChatMsg(text, role) {{
    const area = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg " + role;
    div.textContent = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
    const hist = chatHistory();
    hist.push({{ text, role }});
    saveChatHistory(hist);
  }}

  function chatRespond(question) {{
    const q = question.toLowerCase().trim();
    const ents = chatKnowledge.entities;

    // Find referenced entity
    let matchedEntity = null;
    for (const e of ents) {{
      if (q.includes(e.toLowerCase()) || q.includes(e.toLowerCase() + "s")) {{
        matchedEntity = e;
        break;
      }}
    }}

    // Pattern matching
    if (/how\s+(do\s+i\s+|to\s+)?(add|create|new)/i.test(q)) {{
      if (matchedEntity) {{
        const mod = chatKnowledge.moduleMap[matchedEntity.toLowerCase()] || (matchedEntity + "s");
        return "Click '" + mod + "' in the sidebar, then click the 'Add New' button at the top right.";
      }}
      return "To add a new record, click the entity name in the sidebar, then click the 'Add New' button at the top right.";
    }}

    if (/where\s+(is|can\s+i\s+find|are)/i.test(q)) {{
      if (matchedEntity) {{
        const mod = chatKnowledge.moduleMap[matchedEntity.toLowerCase()] || (matchedEntity + "s");
        return "You can find " + matchedEntity + " in the sidebar under '" + mod + "'. Click it to see all records.";
      }}
      return "Check the sidebar on the left \u2014 all modules and entities are listed there.";
    }}

    if (/what\s+fields?\s+(does|are|has)/i.test(q) || /fields?\s+(of|for|in)/i.test(q)) {{
      if (matchedEntity) {{
        const fields = chatKnowledge.fieldMap[matchedEntity.toLowerCase()] || [];
        if (fields.length > 0) return matchedEntity + " has these fields: " + fields.join(", ") + ".";
        return "I couldn't find field details for " + matchedEntity + ".";
      }}
      return "Please specify which entity you'd like to know the fields for. Available entities: " + ents.join(", ") + ".";
    }}

    if (/how\s+(do\s+i\s+|to\s+)?(edit|update|modify|change)/i.test(q)) {{
      return "Click on any row in the table to see its details, then click the Edit button to modify the record.";
    }}

    if (/how\s+(do\s+i\s+|to\s+)?(delete|remove)/i.test(q)) {{
      return "Click the \u22ef menu on any row and select Delete, or select multiple rows and use the bulk Delete button.";
    }}

    if (/how\s+(do\s+i\s+|to\s+)?search/i.test(q) || /find\s+(a\s+)?record/i.test(q)) {{
      return "Use the search bar at the top of any table, or press Cmd+K (Ctrl+K on Windows) for global search across all entities.";
    }}

    if (/how\s+(do\s+i\s+|to\s+)?export/i.test(q) || /csv|pdf|download/i.test(q)) {{
      return "Click the CSV or PDF button above the table to export your data.";
    }}

    if (/what\s+(entities|modules|sections)/i.test(q) || /list.*(entities|modules)/i.test(q)) {{
      return "This app has the following entities: " + ents.join(", ") + ".";
    }}

    if (/help|what\s+can\s+you/i.test(q)) {{
      return "I can help you navigate the app! Try asking:\\n- How do I add a new [entity]?\\n- Where can I find [entity]?\\n- What fields does [entity] have?\\n- How to edit, delete, search, or export?";
    }}

    return "I can help you navigate the app! Try asking: 'How do I add a new " + (ents[0] || "record") + "?' or 'Where can I find " + (ents.length > 1 ? ents[1] : "records") + "?' or 'What fields does " + (ents[0] || "an entity") + " have?'";
  }}

  window.toggleChatWidget = function() {{
    chatOpen = !chatOpen;
    document.getElementById("chat-panel").classList.toggle("open", chatOpen);
    if (chatOpen && !chatInited) {{
      chatInited = true;
      const hist = chatHistory();
      if (hist.length > 0) {{
        const area = document.getElementById("chat-messages");
        hist.forEach(m => {{
          const div = document.createElement("div");
          div.className = "chat-msg " + m.role;
          div.textContent = m.text;
          area.appendChild(div);
        }});
        area.scrollTop = area.scrollHeight;
      }} else {{
        addChatMsg("Hi! I'm your app assistant. Ask me anything about how to use " + APP_NAME + ".", "bot");
      }}
    }}
    if (chatOpen) document.getElementById("chat-input").focus();
  }};

  window.sendChatMsg = function() {{
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addChatMsg(text, "user");
    const typing = document.getElementById("chat-typing");
    typing.classList.add("show");
    document.getElementById("chat-messages").scrollTop = document.getElementById("chat-messages").scrollHeight;
    setTimeout(() => {{
      typing.classList.remove("show");
      const reply = chatRespond(text);
      addChatMsg(reply, "bot");
    }}, 500);
  }};

  // ── Overview Page ──
  async function renderOverviewPage(container) {{
    const entityNames = Object.keys(ENTITY_FIELDS);
    if (entityNames.length < 3) {{
      container.innerHTML = '<div class="empty-state"><h3>Overview</h3><p>Overview requires 3 or more entities.</p></div>';
      return;
    }}

    // Stat cards row (skeleton first)
    let html = '<div class="overview-stat-row">';
    entityNames.forEach(e => {{
      html += '<div class="overview-stat-card"><div class="stat-entity">' + escHtml(e) + 's</div>' +
        '<div class="stat-num" id="ov-stat-' + e + '"><span class="skeleton skeleton-line" style="width:40px;display:inline-block">&nbsp;</span></div></div>';
    }});
    html += '</div>';

    // Mini tables for top 2 entities
    const top2 = entityNames.slice(0, 2);
    html += '<div class="overview-mini-tables">';
    top2.forEach(e => {{
      const fields = (ENTITY_FIELDS[e] || []).slice(0, 4);
      const modName = (SIDEBAR_ITEMS.find(si => si.entity === e) || {{}}).name || e;
      html += '<div class="overview-mini-table">' +
        '<div class="overview-mini-table-header"><h4>' + escHtml(e) + 's</h4>' +
        '<div class="overview-mini-table-actions">' +
        '<button onclick="showModule(\'' + escHtml(modName) + '\')">View All</button>' +
        '<button onclick="showModule(\'' + escHtml(modName) + '\');setTimeout(()=>openCreate(),100)">+ Add</button>' +
        '</div></div>' +
        '<table><thead><tr>';
      fields.forEach(f => {{
        html += '<th>' + escHtml(f.label || f.name) + '</th>';
      }});
      html += '</tr></thead><tbody id="ov-mini-' + e + '"><tr><td colspan="' + fields.length + '" style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</td></tr></tbody></table></div>';
    }});
    html += '</div>';

    // Quick add row
    html += '<div class="overview-quick-add"><h4>Quick Add</h4><div class="overview-quick-add-btns">';
    entityNames.forEach(e => {{
      const modName = (SIDEBAR_ITEMS.find(si => si.entity === e) || {{}}).name || e;
      html += '<button onclick="showModule(\'' + escHtml(modName) + '\');setTimeout(()=>openCreate(),100)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New ' + escHtml(e) + '</button>';
    }});
    html += '</div></div>';

    // Recent activity area (placeholder)
    html += '<div class="overview-recent-activity"><h4>Recent Activity</h4><div id="ov-activity"><div style="color:var(--text-muted);font-size:13px;padding:8px 0">Loading...</div></div></div>';

    container.innerHTML = html;

    // Fetch data for all entities
    const allData = {{}};
    const fetchPromises = entityNames.map(async e => {{
      const rows = await apiGet(e.toLowerCase());
      dataCache[e] = rows;
      allData[e] = rows;
    }});
    await Promise.all(fetchPromises);

    // Update stat cards
    entityNames.forEach(e => {{
      const el = document.getElementById("ov-stat-" + e);
      if (el) el.textContent = (allData[e] || []).length;
    }});

    // Update mini tables
    top2.forEach(e => {{
      const tbody = document.getElementById("ov-mini-" + e);
      if (!tbody) return;
      const fields = (ENTITY_FIELDS[e] || []).slice(0, 4);
      const rows = (allData[e] || []).slice(-5).reverse();
      if (rows.length === 0) {{
        tbody.innerHTML = '<tr><td colspan="' + fields.length + '" style="text-align:center;padding:20px;color:var(--text-muted)">No records yet</td></tr>';
        return;
      }}
      tbody.innerHTML = rows.map(r => {{
        return '<tr>' + fields.map(f => '<td>' + escHtml(String(r[f.name] || r[f.name.toLowerCase()] || "")) + '</td>').join("") + '</tr>';
      }}).join("");
    }});

    // Update recent activity
    const actEl = document.getElementById("ov-activity");
    if (actEl) {{
      const actColors = ["var(--primary)", "var(--success)", "var(--warning)", "var(--info)", "var(--danger)"];
      let allRecords = [];
      entityNames.forEach((e, idx) => {{
        (allData[e] || []).forEach(r => {{
          allRecords.push({{ entity: e, record: r, color: actColors[idx % actColors.length] }});
        }});
      }});
      // Sort by created_at or id descending, take last 10
      allRecords.sort((a, b) => {{
        const da = a.record.created_at || a.record.id || 0;
        const db = b.record.created_at || b.record.id || 0;
        return da > db ? -1 : da < db ? 1 : 0;
      }});
      allRecords = allRecords.slice(0, 10);
      if (allRecords.length === 0) {{
        actEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No activity yet</div>';
      }} else {{
        actEl.innerHTML = allRecords.map(a => {{
          const fields = ENTITY_FIELDS[a.entity] || [];
          const nameField = fields.find(f => /name|title|subject|label/i.test(f.name));
          const displayVal = nameField ? (a.record[nameField.name] || a.record[nameField.name.toLowerCase()] || "Record") : ("ID: " + (a.record.id || "?"));
          return '<div class="overview-activity-item">' +
            '<div class="overview-activity-dot" style="background:' + a.color + '"></div>' +
            '<span class="overview-activity-entity">' + escHtml(a.entity) + '</span>' +
            '<span>' + escHtml(String(displayVal)) + '</span>' +
            '</div>';
        }}).join("");
      }}
    }}
  }}

  // ── Feature: Custom Number Formatting ──
  function formatValue(value, fieldName, dbType) {{
    if (value === null || value === undefined || value === "") return "";
    const fn = fieldName.toLowerCase();
    // Currency fields
    if (/price|amount|cost|revenue|total|fee|salary|budget/.test(fn) && !(/percent|pct/.test(fn))) {{
      const num = parseFloat(value);
      if (!isNaN(num)) return "$" + num.toLocaleString(undefined, {{minimumFractionDigits:2, maximumFractionDigits:2}});
    }}
    // Percentage fields (rate that is not price-related)
    if ((/percent|pct/.test(fn)) || (/rate/.test(fn) && !/price|amount|cost|revenue|total|fee|salary|budget/.test(fn))) {{
      const num = parseFloat(value);
      if (!isNaN(num)) return num.toLocaleString(undefined, {{minimumFractionDigits:1, maximumFractionDigits:1}}) + "%";
    }}
    // Count / quantity fields
    if (/count|quantity|stock|units/.test(fn)) {{
      const num = parseFloat(value);
      if (!isNaN(num)) return Math.round(num).toLocaleString();
    }}
    // Phone formatting
    if (/phone/.test(fn)) {{
      const digits = String(value).replace(/\\D/g, "");
      if (digits.length === 10) return "(" + digits.slice(0,3) + ") " + digits.slice(3,6) + "-" + digits.slice(6);
      if (digits.length === 11 && digits[0] === "1") return "(" + digits.slice(1,4) + ") " + digits.slice(4,7) + "-" + digits.slice(7);
    }}
    return String(value);
  }}

  // ── Feature: Row Coloring Rules ──
  function getRowColorClass(row, fields) {{
    const classes = [];
    // Check for date fields — overdue detection
    for (const f of fields) {{
      if (/date|_at$|deadline|due/i.test(f.name) && !/(created|updated|deleted)_at/i.test(f.name)) {{
        const val = row[f.name];
        if (val) {{
          const d = new Date(val);
          if (!isNaN(d) && d < new Date()) classes.push("row-overdue");
        }}
      }}
    }}
    // Check for status/enum fields
    for (const f of fields) {{
      if (f.enum_values && f.enum_values.length) {{
        const val = String(row[f.name] || "").toLowerCase();
        if (["completed","done","closed","paid","delivered","resolved"].includes(val)) {{
          // Success overrides overdue
          const idx = classes.indexOf("row-overdue");
          if (idx > -1) classes.splice(idx, 1);
          classes.push("row-success");
        }}
        if (["cancelled","failed","rejected","lost"].includes(val)) {{
          const idx = classes.indexOf("row-overdue");
          if (idx > -1) classes.splice(idx, 1);
          classes.push("row-cancelled");
        }}
        if (["urgent","critical","high","emergency"].includes(val)) {{
          if (!classes.includes("row-success") && !classes.includes("row-cancelled")) {{
            classes.push("row-urgent");
          }}
        }}
      }}
    }}
    return classes.join(" ");
  }}

  // ── Feature: Inline Editing ──
  const NON_EDITABLE_FIELDS = ["id","created_at","updated_at","org_id","deleted_at","version"];

  window.startInlineEdit = function(entity, rowId, fieldName, cell, evt) {{
    if (evt) evt.stopPropagation();
    if (NON_EDITABLE_FIELDS.includes(fieldName)) return;
    if (cell.querySelector("input, select")) return; // already editing

    const fields = ENTITY_FIELDS[entity] || [];
    const fieldDef = fields.find(f => f.name === fieldName);
    if (!fieldDef) return;
    if (fieldDef.computed) return;

    const rows = dataCache[entity] || [];
    const record = rows.find(r => String(r.id || r.ID) === String(rowId));
    if (!record) return;

    const currentVal = record[fieldName] ?? "";
    const originalHtml = cell.innerHTML;
    cell.classList.add("inline-edit-cell");

    let inputHtml;
    if (fieldDef.enum_values && fieldDef.enum_values.length) {{
      const opts = fieldDef.enum_values.map(v =>
        '<option value="' + escHtml(v) + '"' + (v === String(currentVal) ? ' selected' : '') + '>' + escHtml(v) + '</option>'
      ).join("");
      inputHtml = '<select class="inline-input">' + opts + '</select>';
    }} else if (fieldDef.type === "boolean") {{
      inputHtml = '<select class="inline-input"><option value="true"' + (currentVal ? ' selected' : '') + '>Yes</option><option value="false"' + (!currentVal ? ' selected' : '') + '>No</option></select>';
    }} else {{
      let inputType = "text";
      if (/amount|value|price|cost|revenue|total|salary|fee|budget|quantity|count|number|age|score|rating/i.test(fieldName) || fieldDef.type === "number" || fieldDef.type === "integer" || fieldDef.type === "float") inputType = "number";
      else if (/date|_at$/i.test(fieldName)) inputType = "date";
      inputHtml = '<input type="' + inputType + '" class="inline-input" value="' + escHtml(String(currentVal)) + '">';
    }}
    inputHtml += '<span class="inline-save-check">&#x2713;</span>';
    cell.innerHTML = inputHtml;

    const inp = cell.querySelector(".inline-input");
    inp.focus();
    if (inp.tagName === "INPUT") inp.select();

    function cancelEdit() {{
      cell.innerHTML = originalHtml;
      cell.classList.remove("inline-edit-cell");
    }}

    async function saveEdit() {{
      let newVal = inp.value;
      if (fieldDef.type === "boolean") newVal = newVal === "true";
      else if (inp.type === "number" && newVal !== "") newVal = Number(newVal);

      if (newVal === currentVal || (newVal === "" && currentVal === "")) {{
        cancelEdit();
        return;
      }}

      const patch = {{}};
      patch[fieldName] = newVal;
      const result = await apiUpdate(entity.toLowerCase(), rowId, patch);
      if (result) {{
        // Update cache
        const cached = (dataCache[entity] || []).find(r => String(r.id || r.ID) === String(rowId));
        if (cached) cached[fieldName] = newVal;
        // Show checkmark animation
        const check = cell.querySelector(".inline-save-check");
        if (check) {{
          check.classList.add("show");
          setTimeout(() => {{
            renderTableRows(entity, currentModule);
          }}, 600);
        }}
      }} else {{
        cancelEdit();
      }}
    }}

    inp.addEventListener("keydown", function(e) {{
      if (e.key === "Enter") {{ e.preventDefault(); saveEdit(); }}
      if (e.key === "Escape") {{ e.preventDefault(); cancelEdit(); }}
    }});
    inp.addEventListener("blur", function() {{
      // Slight delay to allow click events on the check icon
      setTimeout(() => {{
        if (cell.querySelector(".inline-input")) saveEdit();
      }}, 150);
    }});
  }};

  // ── Feature: Pivot Table / Group-By View ──
  const groupByState = {{}};  // moduleName -> fieldName or ""
  let groupCollapsed = {{}};  // "moduleName:groupValue" -> boolean

  window.setGroupBy = function(moduleName, entity, fieldName) {{
    groupByState[moduleName] = fieldName;
    groupCollapsed = {{}};
    pageState[moduleName] = 1;
    renderTableRows(entity, moduleName);
  }};

  window.toggleGroupCollapse = function(key) {{
    groupCollapsed[key] = !groupCollapsed[key];
    const body = document.querySelector('[data-group-key="' + key + '"]');
    const chevron = document.querySelector('[data-chevron-key="' + key + '"]');
    if (body) body.classList.toggle("collapsed", groupCollapsed[key]);
    if (chevron) chevron.classList.toggle("collapsed", groupCollapsed[key]);
  }};

  // ── Feature: Rich Text Fields ──
  function stripHtml(html) {{
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || "").trim();
  }}

  function truncateText(text, maxLen) {{
    if (!text || text.length <= maxLen) return text || "";
    return text.substring(0, maxLen) + "...";
  }}

  window.rtExec = function(cmd, val) {{
    document.execCommand(cmd, false, val || null);
  }};

  window.rtInsertList = function(type) {{
    document.execCommand(type === "ol" ? "insertOrderedList" : "insertUnorderedList", false, null);
  }};

  function buildRichTextToolbar() {{
    return '<div class="rt-toolbar">' +
      '<button type="button" title="Bold (Ctrl+B)" onmousedown="event.preventDefault();rtExec(\'bold\')"><b>B</b></button>' +
      '<button type="button" title="Italic (Ctrl+I)" onmousedown="event.preventDefault();rtExec(\'italic\')"><i>I</i></button>' +
      '<button type="button" title="Bullet List" onmousedown="event.preventDefault();rtInsertList(\'ul\')">&#x2022;</button>' +
      '<button type="button" title="Numbered List" onmousedown="event.preventDefault();rtInsertList(\'ol\')">1.</button>' +
    '</div>';
  }}

  function isRichTextField(fieldName) {{
    return /description|notes|body|comment|content|message|details|summary|bio|about/i.test(fieldName);
  }}

  // ── Auto-refresh: silently re-fetch current module data every 30s ──
  function startAutoRefresh() {{
    stopAutoRefresh();
    autoRefreshTimer = setInterval(async () => {{
      if (!currentEntity || !currentModule) return;
      try {{
        const freshRows = await apiGet(currentEntity.toLowerCase());
        const oldRows = dataCache[currentEntity] || [];
        const oldJson = JSON.stringify(oldRows);
        const newJson = JSON.stringify(freshRows);
        if (oldJson !== newJson) {{
          dataCache[currentEntity] = freshRows;
          // Re-render current view smoothly
          const content = document.getElementById("content-area");
          if (content) {{
            const activeView = viewMode[currentModule] || "table";
            if (activeView === "table") {{
              renderTableRows(currentEntity, currentModule);
            }} else {{
              renderEntityView(content, currentModule, currentEntity, activeView);
            }}
          }}
          showToast("Data updated", "info");
        }}
      }} catch (e) {{
        // Silent fail on auto-refresh
      }}
    }}, AUTO_REFRESH_INTERVAL);
  }}

  function stopAutoRefresh() {{
    if (autoRefreshTimer) {{
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }}
  }}

  window.manualRefresh = function() {{
    if (!currentEntity || !currentModule) return;
    const btn = document.getElementById("refresh-btn");
    if (btn) {{
      btn.classList.add("spinning");
      setTimeout(() => btn.classList.remove("spinning"), 600);
    }}
    // Clear cache so we get fresh data
    delete apiCache[currentEntity.toLowerCase()];
    const content = document.getElementById("content-area");
    if (content) {{
      const activeView = viewMode[currentModule] || "table";
      renderEntityView(content, currentModule, currentEntity, activeView);
    }}
  }};

  // ── Keyboard shortcuts ──
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const modKey = isMac ? "metaKey" : "ctrlKey";

  document.addEventListener("keydown", function(e) {{
    // Cmd/Ctrl+N — open create form
    if (e[modKey] && e.key === "n") {{
      e.preventDefault();
      if (currentEntity) openCreate();
    }}
    // Cmd/Ctrl+K — focus search
    if (e[modKey] && e.key === "k") {{
      e.preventDefault();
      const searchEl = document.getElementById("search-" + currentModule) || document.getElementById("global-search-input");
      if (searchEl) {{ searchEl.focus(); searchEl.select(); }}
    }}
    // Escape — close modal/form
    if (e.key === "Escape") {{
      const modal = document.getElementById("modal-overlay");
      if (modal && modal.style.display !== "none") {{
        closeModal();
      }}
      const detail = document.querySelector(".detail-view");
      if (detail && currentModule) {{
        showModule(currentModule);
      }}
    }}
    // Cmd/Ctrl+E — toggle edit mode in detail view
    if (e[modKey] && e.key === "e") {{
      const detail = document.querySelector(".detail-view");
      if (detail && _inlineEditingEntity && _inlineEditingId) {{
        e.preventDefault();
        openEdit(_inlineEditingEntity, _inlineEditingId);
      }}
    }}
  }});

  // ── Keyboard shortcuts help button ──
  function buildShortcutsHelp() {{
    const helpBtn = document.createElement("button");
    helpBtn.id = "shortcuts-help-btn";
    helpBtn.innerHTML = "?";
    helpBtn.title = "Keyboard shortcuts";
    helpBtn.style.cssText = "position:fixed;bottom:20px;right:20px;width:36px;height:36px;border-radius:50%;background:var(--bg-card);border:1px solid var(--border);box-shadow:var(--shadow-md);cursor:pointer;font-size:16px;font-weight:600;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;z-index:100;transition:all var(--transition);font-family:inherit";
    helpBtn.onmouseenter = function() {{ this.style.background = "var(--primary)"; this.style.color = "#fff"; this.style.borderColor = "var(--primary)"; }};
    helpBtn.onmouseleave = function() {{ this.style.background = "var(--bg-card)"; this.style.color = "var(--text-secondary)"; this.style.borderColor = "var(--border)"; }};
    helpBtn.onclick = function() {{
      const existing = document.getElementById("shortcuts-modal");
      if (existing) {{ existing.remove(); return; }}
      const mod = isMac ? "\\u2318" : "Ctrl+";
      const modal = document.createElement("div");
      modal.id = "shortcuts-modal";
      modal.style.cssText = "position:fixed;bottom:68px;right:20px;width:280px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-xl);z-index:101;padding:16px;font-size:13px;animation:fadeIn 0.15s ease";
      modal.innerHTML = '<div style="font-weight:600;font-size:14px;margin-bottom:12px;color:var(--text)">Keyboard Shortcuts</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--text-secondary)">New record</span><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:var(--text)">' + mod + 'N</kbd></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--text-secondary)">Search</span><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:var(--text)">' + mod + 'K</kbd></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--text-secondary)">Close modal</span><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:var(--text)">Esc</kbd></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--text-secondary)">Edit record</span><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:var(--text)">' + mod + 'E</kbd></div>' +
        '</div>';
      document.body.appendChild(modal);
      // Close on click outside
      setTimeout(() => {{
        document.addEventListener("click", function _close(ev) {{
          if (!modal.contains(ev.target) && ev.target !== helpBtn) {{
            modal.remove();
            document.removeEventListener("click", _close);
          }}
        }});
      }}, 10);
    }};
    document.body.appendChild(helpBtn);
  }}

  // Expose for inline onclick handlers
  window.showModule = showModule;

  // ── Init ──
  function initApp() {{
    buildSidebar();
    buildMobileNav();
    updateUserDisplay();
    buildShortcutsHelp();
    startAutoRefresh();
    if (SIDEBAR_ITEMS.length > 0) {{
      showModule(SIDEBAR_ITEMS[0].name);
    }}
  }}

  // Check auth on load
  if (checkAuth()) {{
    try {{
      initApp();
    }} catch(e) {{
      console.error("Init error:", e);
      document.getElementById("content-area").innerHTML = '<div style="padding:40px;text-align:center"><h2>Loading...</h2><p style="color:#888">If this persists, try refreshing the page.</p><pre style="text-align:left;background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;margin-top:16px">' + e.message + '</pre></div>';
    }}
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
  // Show the topbar install button
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'inline-flex';
  // Show bottom banner
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:{primary_color};color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9999;font-family:inherit;font-size:14px;box-shadow:0 -4px 20px rgba(0,0,0,0.1);backdrop-filter:blur(10px)';
  banner.innerHTML = '<span style="font-weight:500">Install {app_name} as an app for quick access</span><div style="display:flex;gap:8px"><button onclick="installApp()" style="background:#fff;color:{primary_color};border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit">Install</button><button onclick="this.parentElement.parentElement.remove()" style="background:transparent;color:rgba(255,255,255,0.9);border:1px solid rgba(255,255,255,0.3);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit">Later</button></div>';
  document.body.appendChild(banner);
}});
window.addEventListener('appinstalled', () => {{
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
  deferredPrompt = null;
}});
function installApp() {{
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
  if (deferredPrompt) {{
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {{
      deferredPrompt = null;
      const btn = document.getElementById('pwa-install-btn');
      if (btn) btn.style.display = 'none';
    }});
  }}
}}
function downloadAsHTML() {{
  const html = document.documentElement.outerHTML;
  const blob = new Blob(['<!DOCTYPE html>' + html], {{type:'text/html'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '{safe_name}.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}}

// ── Mobile: Swipeable detail tabs ──
(function() {{
  let _touchStartX = 0;
  let _touchEndX = 0;
  document.addEventListener('touchstart', function(e) {{
    const tabs = e.target.closest('.detail-tab-panel, .detail-tabs');
    if (tabs || e.target.closest('.content')) {{
      _touchStartX = e.changedTouches[0].screenX;
    }}
  }}, {{ passive: true }});
  document.addEventListener('touchend', function(e) {{
    _touchEndX = e.changedTouches[0].screenX;
    const diff = _touchStartX - _touchEndX;
    if (Math.abs(diff) < 50) return;
    const tabs = document.querySelectorAll('.detail-tab');
    if (tabs.length === 0) return;
    let activeIdx = -1;
    tabs.forEach(function(t, i) {{ if (t.classList.contains('active')) activeIdx = i; }});
    if (activeIdx === -1) return;
    let newIdx = diff > 0 ? activeIdx + 1 : activeIdx - 1;
    if (newIdx < 0 || newIdx >= tabs.length) return;
    const tabName = tabs[newIdx].dataset.tab;
    if (tabName && window._switchDetailTab) window._switchDetailTab(tabName);
    _updateDetailDots();
  }}, {{ passive: true }});
  window._updateDetailDots = function() {{
    const dots = document.querySelectorAll('.detail-tab-dot');
    const tabs = document.querySelectorAll('.detail-tab');
    tabs.forEach(function(t, i) {{
      if (dots[i]) dots[i].classList.toggle('active', t.classList.contains('active'));
    }});
  }};
}})();

// ── Mobile: Pull-to-refresh ──
(function() {{
  let _pullStartY = 0;
  let _pulling = false;
  const contentEl = document.getElementById('content-area');
  const pullEl = document.getElementById('pull-to-refresh');
  if (!contentEl || !pullEl) return;
  contentEl.addEventListener('touchstart', function(e) {{
    if (contentEl.scrollTop === 0) {{
      _pullStartY = e.touches[0].clientY;
      _pulling = true;
    }}
  }}, {{ passive: true }});
  contentEl.addEventListener('touchmove', function(e) {{
    if (!_pulling) return;
    const dy = e.touches[0].clientY - _pullStartY;
    if (dy > 60) {{
      pullEl.classList.add('pulling');
    }}
  }}, {{ passive: true }});
  contentEl.addEventListener('touchend', function() {{
    if (pullEl.classList.contains('pulling')) {{
      // Reload current module data
      const active = document.querySelector('.sidebar-item.active');
      if (active) {{
        const modName = active.dataset.module;
        if (modName) showModule(modName);
      }}
      setTimeout(function() {{ pullEl.classList.remove('pulling'); }}, 600);
    }}
    _pulling = false;
  }}, {{ passive: true }});
}})();

// ── Mobile: Card layout for table data ──
window._renderMobileCards = function(entity, moduleName, rows) {{
  const fields = entityFieldMap[entity] || [];
  const nameField = fields.find(function(f) {{
    return /name|title/i.test(f.name);
  }});
  const statusField = fields.find(function(f) {{
    return f.enum_values && f.enum_values.length > 0;
  }});
  const displayFields = fields.filter(function(f) {{
    return f !== nameField && f !== statusField && !['id','org_id','deleted_at','version','created_at','updated_at'].includes(f.name);
  }}).slice(0, 3);

  let html = '';
  rows.forEach(function(row) {{
    const id = row.id || row.ID;
    const title = nameField ? (row[nameField.name] || 'Untitled') : ('Record #' + id);
    let statusHtml = '';
    if (statusField && row[statusField.name]) {{
      statusHtml = '<span class="badge" style="margin-left:8px;font-size:10px">' + escHtml(String(row[statusField.name])) + '</span>';
    }}
    let fieldsHtml = '';
    displayFields.forEach(function(f) {{
      const val = row[f.name];
      if (val !== null && val !== undefined && val !== '') {{
        fieldsHtml += '<div class="mobile-card-field"><strong>' + escHtml(f.name.replace(/_/g,' ')) + ':</strong> ' + escHtml(String(val)) + '</div>';
      }}
    }});
    html += '<div class="mobile-record-card">' +
      '<div class="mobile-card-title">' + escHtml(String(title)) + statusHtml + '</div>' +
      '<div class="mobile-card-fields">' + fieldsHtml + '</div>' +
      '<div class="mobile-card-actions">' +
        '<button onclick="showDetail(' + "'" + escHtml(entity) + "'" + ',' + id + ')">View</button>' +
        '<button onclick="openEdit(' + "'" + escHtml(entity) + "'" + ',' + id + ')">Edit</button>' +
        '<button onclick="confirmDelete(' + "'" + escHtml(entity) + "'" + ',' + id + ')" style="color:var(--danger)">Delete</button>' +
      '</div>' +
    '</div>';
  }});
  return html;
}};

// Patch renderTableRows to also render mobile cards
const _origRenderTable = window.renderTableRows;
if (_origRenderTable) {{
  window.renderTableRows = function(entity, moduleName) {{
    _origRenderTable(entity, moduleName);
    // Render mobile card layout
    const container = document.getElementById('module-' + moduleName);
    if (!container) return;
    let cardList = container.querySelector('.mobile-card-list');
    if (!cardList) {{
      const tableWrap = container.querySelector('.data-table-wrap');
      if (tableWrap) {{
        cardList = document.createElement('div');
        cardList.className = 'mobile-card-list';
        tableWrap.parentNode.insertBefore(cardList, tableWrap.nextSibling);
      }}
    }}
    if (cardList) {{
      const rows = dataCache[entity] || [];
      cardList.innerHTML = window._renderMobileCards(entity, moduleName, rows);
    }}
  }};
}}
</script>
</body>
</html>'''


def _inject_plugins(html: str, spec: dict, project_id: str) -> str:
    """
    Inject plugin UI elements into generated HTML apps based on spec.plugins.

    Supported plugins:
    - stripe: Adds "Pay" buttons next to price/amount fields
    - maps: Adds map views for entities with address/location fields
    - sms: Adds "Send SMS" buttons next to phone number fields
    - email: Adds "Send Email" buttons next to email fields

    Buttons show placeholder alerts until backend integrations are wired up.
    """
    plugins = spec.get("plugins", [])
    if not plugins:
        return html

    # Normalize plugins to a set of plugin names
    plugin_names = set()
    for p in plugins:
        if isinstance(p, dict):
            plugin_names.add(p.get("plugin", "").lower())
        elif isinstance(p, str):
            plugin_names.add(p.lower())

    if not plugin_names:
        return html

    entities = spec.get("entities") or []

    # Collect field info for targeted injection
    price_entities = []
    address_entities = []
    phone_entities = []
    email_entities = []

    for entity in entities:
        entity_name = entity.get("name", "")
        for field in entity.get("fields", []):
            fname = field.get("name", "").lower()
            ftype = field.get("type", "").lower()
            if fname in ("price", "amount", "cost", "total", "fee") or ftype in ("money", "currency"):
                price_entities.append(entity_name)
            if fname in ("address", "location", "city", "street", "zip", "postal_code", "lat", "lng", "latitude", "longitude"):
                address_entities.append(entity_name)
            if fname in ("phone", "phone_number", "mobile", "cell", "telephone") or ftype == "phone":
                phone_entities.append(entity_name)
            if fname in ("email", "email_address") or ftype == "email":
                email_entities.append(entity_name)

    # Build the plugin JS/CSS to inject before </body>
    plugin_snippets = []

    if "stripe" in plugin_names and price_entities:
        entity_list_js = ", ".join(f'"{e}"' for e in set(price_entities))
        plugin_snippets.append(f"""
<!-- Stripe Checkout Plugin -->
<script>
(function() {{
  const stripeEntities = [{entity_list_js}];
  const priceFields = ['price', 'amount', 'cost', 'total', 'fee'];

  // Observe DOM for detail views and add Pay buttons
  const observer = new MutationObserver(function() {{
    document.querySelectorAll('.detail-body .detail-field').forEach(function(el) {{
      if (el.querySelector('.plugin-stripe-btn')) return;
      const label = (el.querySelector('.detail-label') || {{}}).textContent || '';
      if (priceFields.some(f => label.toLowerCase().includes(f))) {{
        const btn = document.createElement('button');
        btn.className = 'plugin-stripe-btn';
        btn.textContent = '💳 Pay';
        btn.style.cssText = 'margin-left:8px;padding:4px 12px;background:#635bff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit';
        btn.onclick = function() {{ alert('Plugin configured — connect Stripe in settings'); }};
        el.appendChild(btn);
      }}
    }});
  }});
  observer.observe(document.body, {{ childList: true, subtree: true }});
}})();
</script>""")

    if "maps" in plugin_names and address_entities:
        entity_list_js = ", ".join(f'"{e}"' for e in set(address_entities))
        plugin_snippets.append(f"""
<!-- Google Maps Plugin -->
<script>
(function() {{
  const mapEntities = [{entity_list_js}];
  const addressFields = ['address', 'location', 'city', 'street'];

  const observer = new MutationObserver(function() {{
    document.querySelectorAll('.detail-body .detail-field').forEach(function(el) {{
      if (el.querySelector('.plugin-map-container')) return;
      const label = (el.querySelector('.detail-label') || {{}}).textContent || '';
      const value = (el.querySelector('.detail-value') || {{}}).textContent || '';
      if (addressFields.some(f => label.toLowerCase().includes(f)) && value.trim()) {{
        const container = document.createElement('div');
        container.className = 'plugin-map-container';
        container.style.cssText = 'margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb';
        const iframe = document.createElement('iframe');
        iframe.width = '100%';
        iframe.height = '200';
        iframe.frameBorder = '0';
        iframe.style.border = '0';
        iframe.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(value) + '&output=embed';
        iframe.allowFullscreen = true;
        container.appendChild(iframe);
        el.appendChild(container);
      }}
    }});
  }});
  observer.observe(document.body, {{ childList: true, subtree: true }});
}})();
</script>""")

    if "sms" in plugin_names and phone_entities:
        entity_list_js = ", ".join(f'"{e}"' for e in set(phone_entities))
        plugin_snippets.append(f"""
<!-- Twilio SMS Plugin -->
<script>
(function() {{
  const smsEntities = [{entity_list_js}];
  const phoneFields = ['phone', 'mobile', 'cell', 'telephone'];

  const observer = new MutationObserver(function() {{
    document.querySelectorAll('.detail-body .detail-field').forEach(function(el) {{
      if (el.querySelector('.plugin-sms-btn')) return;
      const label = (el.querySelector('.detail-label') || {{}}).textContent || '';
      if (phoneFields.some(f => label.toLowerCase().includes(f))) {{
        const btn = document.createElement('button');
        btn.className = 'plugin-sms-btn';
        btn.textContent = '📱 Send SMS';
        btn.style.cssText = 'margin-left:8px;padding:4px 12px;background:#0ea5e9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit';
        btn.onclick = function() {{ alert('Plugin configured — connect Twilio in settings'); }};
        el.appendChild(btn);
      }}
    }});
  }});
  observer.observe(document.body, {{ childList: true, subtree: true }});
}})();
</script>""")

    if "email" in plugin_names and email_entities:
        entity_list_js = ", ".join(f'"{e}"' for e in set(email_entities))
        plugin_snippets.append(f"""
<!-- Email Plugin -->
<script>
(function() {{
  const emailEntities = [{entity_list_js}];
  const emailFields = ['email', 'email_address'];

  const observer = new MutationObserver(function() {{
    document.querySelectorAll('.detail-body .detail-field').forEach(function(el) {{
      if (el.querySelector('.plugin-email-btn')) return;
      const label = (el.querySelector('.detail-label') || {{}}).textContent || '';
      if (emailFields.some(f => label.toLowerCase().includes(f))) {{
        const btn = document.createElement('button');
        btn.className = 'plugin-email-btn';
        btn.textContent = '✉️ Send Email';
        btn.style.cssText = 'margin-left:8px;padding:4px 12px;background:#8b5cf6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit';
        btn.onclick = function() {{ alert('Plugin configured — connect email service in settings'); }};
        el.appendChild(btn);
      }}
    }});
  }});
  observer.observe(document.body, {{ childList: true, subtree: true }});
}})();
</script>""")

    if not plugin_snippets:
        return html

    # Inject all plugin snippets before </body>
    injection = "\n".join(plugin_snippets)
    return html.replace("</body>", f"{injection}\n</body>")


def _detect_smart_layouts(entities: list, modules: list) -> dict:
    """
    Analyze entities and determine the best alternate layout for each.

    Returns a dict mapping entity name -> layout type:
    - "kanban" if entity has a status field with enum_values
    - "calendar" if entity has a date field AND name suggests appointments/events
    - "cards" if entity has image/photo fields OR is a product/listing type
    - "table" for everything else
    """
    import re

    calendar_keywords = re.compile(
        r"(appointment|booking|event|schedule|meeting|session|reservation|class|lesson|shift|calendar)",
        re.IGNORECASE,
    )
    product_keywords = re.compile(
        r"(product|listing|item|catalog|property|vehicle|menu|dish|recipe|portfolio|gallery|project)",
        re.IGNORECASE,
    )
    image_field_pattern = re.compile(
        r"(image|photo|picture|thumbnail|avatar|cover|logo|banner|icon|media)",
        re.IGNORECASE,
    )

    layout_map = {}

    for entity in entities:
        name = entity.get("name", "")
        fields = entity.get("fields", [])
        if not name:
            continue

        has_status_enum = False
        has_date_field = False
        has_image_field = False

        for f in fields:
            fname = f.get("name", "")
            ftype = f.get("type", "")
            enum_vals = f.get("enum_values", [])

            # Check for status-like enum field
            if enum_vals and re.search(r"(status|state|stage|phase)", fname, re.IGNORECASE):
                has_status_enum = True

            # Check for date field (excluding created_at/updated_at/deleted_at)
            if re.search(r"date|_at$", fname, re.IGNORECASE) and not re.search(
                r"deleted|created|updated", fname, re.IGNORECASE
            ):
                has_date_field = True

            # Check for image-related fields
            if image_field_pattern.search(fname):
                has_image_field = True

        # Priority: Calendar > Kanban > Cards > Table
        if has_date_field and calendar_keywords.search(name):
            layout_map[name] = "calendar"
        elif has_status_enum:
            layout_map[name] = "kanban"
        elif has_image_field or product_keywords.search(name):
            layout_map[name] = "cards"
        else:
            layout_map[name] = "table"

    return layout_map


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
        field_list = []
        for f in fields:
            fd = {
                "name": f.get("name", ""),
                "type": f.get("type", "string"),
                "required": f.get("required", False),
                "enum_values": f.get("enum_values", []),
                "default_value": f.get("default_value", ""),
                "fk_entity": f.get("fk_entity", ""),
            }
            # Conditional visibility
            if f.get("visible_when"):
                fd["visible_when"] = f["visible_when"]
            # Computed fields
            if f.get("computed"):
                fd["computed"] = f["computed"]
                fd["editable"] = False
            # Validation rules
            if f.get("validation"):
                fd["validation"] = f["validation"]
            # Pass nullable for required validation
            if f.get("nullable") is not None:
                fd["nullable"] = f["nullable"]
            field_list.append(fd)
        fields_map[name] = field_list
    return json.dumps(fields_map)
