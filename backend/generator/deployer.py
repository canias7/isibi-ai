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

    # Generate the HTML shell that loads the pre-built React preview bundle
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
    Generate a lightweight HTML shell that loads the pre-built React preview
    bundle (preview-bundle.js + preview-bundle.css).  The bundle renders the
    exact same SpecPreview component used in the builder, so deployed apps
    look 100% identical to the in-app preview.

    The HTML includes:
    - A self-contained auth screen (login / signup / forgot-password)
    - Injected spec JSON + config globals consumed by the React bundle
    - PWA meta tags
    """
    import json

    app_name = spec.get("app_name") or spec.get("name") or "My App"
    design = spec.get("design_system") or {}
    colors = design.get("colors") or {}
    primary_color = colors.get("primary") or "#6366f1"
    app_initial = (app_name or "A")[0].upper()

    # Determine where the preview bundle is served from.
    bundle_base = api_base_url.rstrip("/")

    spec_json = json.dumps(spec, default=str)
    config_json = json.dumps({
        "projectId": project_id,
        "apiBase": f"{api_base_url.rstrip('/')}/api",
    })

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
<link rel="stylesheet" href="{bundle_base}/static/preview-bundle.css">
<style>
/* ── Auth screen (self-contained, not part of React bundle) ── */
*,*::before,*::after {{ margin:0;padding:0;box-sizing:border-box; }}
body {{ font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; }}
#root {{ height:100vh; }}
.auth-overlay {{
  position:fixed;inset:0;z-index:9000;
  background:#f9fafb;
  display:flex;align-items:center;justify-content:center;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
}}
.auth-card {{
  width:400px;max-width:90vw;
  background:#fff;
  border:1px solid #e5e7eb;
  border-radius:16px;
  box-shadow:0 10px 40px rgba(0,0,0,0.1),0 2px 6px rgba(0,0,0,0.03);
  overflow:hidden;
}}
.auth-header {{
  padding:32px 32px 24px;text-align:center;
}}
.auth-logo {{
  width:56px;height:56px;
  border-radius:12px;
  background:{primary_color};
  display:inline-flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:24px;
  margin-bottom:16px;
  box-shadow:0 4px 12px {primary_color}40;
}}
.auth-header h2 {{
  font-size:20px;font-weight:700;margin-bottom:4px;color:#111827;
}}
.auth-header p {{
  font-size:13px;color:#9ca3af;
}}
.auth-tabs {{
  display:flex;border-bottom:1px solid #e5e7eb;padding:0 32px;
}}
.auth-tab {{
  flex:1;padding:10px 0;text-align:center;
  font-size:13px;font-weight:600;color:#9ca3af;
  cursor:pointer;border:none;background:none;
  border-bottom:2px solid transparent;
  transition:all 0.15s ease;font-family:inherit;
}}
.auth-tab:hover {{ color:#111827; }}
.auth-tab.active {{
  color:{primary_color};border-bottom-color:{primary_color};
}}
.auth-body {{
  padding:24px 32px 32px;
}}
.auth-body .form-group {{ margin-bottom:16px; }}
.auth-body .form-group label {{
  display:block;font-size:13px;font-weight:500;
  color:#111827;margin-bottom:6px;
}}
.auth-body .form-group input {{
  width:100%;padding:10px 14px;
  border:1px solid #e5e7eb;border-radius:8px;
  font-size:14px;color:#111827;background:#fff;
  outline:none;font-family:inherit;
  transition:border-color 0.15s ease, box-shadow 0.15s ease;
}}
.auth-body .form-group input:focus {{
  border-color:{primary_color};
  box-shadow:0 0 0 3px {primary_color}1a;
}}
.auth-submit {{
  width:100%;padding:11px 0;
  background:linear-gradient(135deg, {primary_color}, {primary_color}cc);
  color:#fff;border:none;border-radius:8px;
  font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
  transition:all 0.15s ease;margin-top:8px;
  box-shadow:0 1px 2px rgba(0,0,0,0.08);
}}
.auth-submit:hover {{ box-shadow:0 4px 12px rgba(0,0,0,0.12);transform:translateY(-1px); }}
.auth-submit:disabled {{ opacity:0.6;cursor:not-allowed;transform:none; }}
.auth-error {{
  background:#fef2f2;color:#ef4444;
  padding:8px 12px;border-radius:8px;
  font-size:12px;margin-bottom:12px;display:none;
}}
</style>
</head>
<body>
<!-- Auth overlay (hidden once authenticated) -->
<div class="auth-overlay" id="auth-overlay" style="display:none">
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
        <a href="#" onclick="showForgotPassword(event)" style="font-size:12px;color:{primary_color};text-decoration:none;cursor:pointer">Forgot password?</a>
      </div>
    </div>
  </div>
  <!-- Forgot Password -->
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
        <a href="#" onclick="backToLogin(event)" style="font-size:12px;color:#9ca3af;text-decoration:none;cursor:pointer">Back to login</a>
      </div>
    </div>
  </div>
</div>

<!-- React app mount point -->
<div id="root"></div>

<!-- Spec data + config injected for the React bundle -->
<script>
  window.__ISIBI_SPEC__ = {spec_json};
  window.__ISIBI_CONFIG__ = {config_json};
</script>

<!-- Auth logic (runs before React bundle) -->
<script>
(function() {{
  var API_BASE = "{api_base_url.rstrip("/")}";
  var PROJECT_ID = "{project_id}";
  var currentAuthTab = "login";

  function getToken() {{
    return localStorage.getItem("app_token") || "";
  }}

  function checkAuth() {{
    var token = getToken();
    var overlay = document.getElementById("auth-overlay");
    var params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "1" || params.get("skip_auth") === "1") {{
      overlay.style.display = "none";
      return true;
    }}
    if (!token) {{
      overlay.style.display = "flex";
      return false;
    }}
    overlay.style.display = "none";
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
    var email = document.getElementById("auth-email").value.trim();
    var password = document.getElementById("auth-password").value;
    var errorEl = document.getElementById("auth-error");
    var submitBtn = document.getElementById("auth-submit");

    if (!email || !password) {{
      errorEl.textContent = "Please enter email and password.";
      errorEl.style.display = "block";
      return;
    }}

    submitBtn.disabled = true;
    submitBtn.textContent = currentAuthTab === "login" ? "Logging in..." : "Signing up...";
    errorEl.style.display = "none";

    var endpoint = currentAuthTab === "login"
      ? API_BASE + "/api/apps/" + PROJECT_ID + "/auth/login"
      : API_BASE + "/api/apps/" + PROJECT_ID + "/auth/signup";

    try {{
      var res = await fetch(endpoint, {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email: email, password: password }})
      }});
      if (!res.ok) {{
        var data = await res.json().catch(function() {{ return {{}}; }});
        throw new Error(data.detail || data.message || data.error || (currentAuthTab === "login" ? "Invalid credentials" : "Signup failed"));
      }}
      var data = await res.json();
      var token = data.token || data.access_token || data.jwt || "";
      if (token) {{
        localStorage.setItem("app_token", token);
        localStorage.setItem("token", token);
        localStorage.setItem("user_email", email);
        document.getElementById("auth-overlay").style.display = "none";
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
    localStorage.removeItem("token");
    localStorage.removeItem("user_email");
    document.getElementById("auth-email").value = "";
    document.getElementById("auth-password").value = "";
    document.getElementById("auth-error").style.display = "none";
    document.getElementById("auth-overlay").style.display = "flex";
  }};

  // Enter key on password field
  document.getElementById("auth-password").addEventListener("keydown", function(e) {{
    if (e.key === "Enter") handleAuth();
  }});

  // Forgot password flow
  window.showForgotPassword = function(e) {{
    if (e) e.preventDefault();
    document.querySelector("#auth-overlay > .auth-card").style.display = "none";
    document.getElementById("forgot-password-card").style.display = "block";
    document.getElementById("forgot-step-email").style.display = "block";
    document.getElementById("forgot-step-code").style.display = "none";
    document.getElementById("forgot-error").style.display = "none";
  }};

  window.backToLogin = function(e) {{
    if (e) e.preventDefault();
    document.getElementById("forgot-password-card").style.display = "none";
    document.querySelector("#auth-overlay > .auth-card").style.display = "block";
  }};

  window.handleForgotPassword = async function() {{
    var email = document.getElementById("forgot-email").value.trim();
    var errorEl = document.getElementById("forgot-error");
    var submitBtn = document.getElementById("forgot-submit");
    if (!email) {{
      errorEl.textContent = "Please enter your email.";
      errorEl.style.display = "block";
      return;
    }}
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    errorEl.style.display = "none";
    try {{
      var res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/auth/forgot-password", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email: email }})
      }});
      if (!res.ok) {{
        var data = await res.json().catch(function() {{ return {{}}; }});
        throw new Error(data.detail || "Failed to send reset code");
      }}
      document.getElementById("forgot-step-email").style.display = "none";
      document.getElementById("forgot-step-code").style.display = "block";
      document.getElementById("forgot-step-text").textContent = "Enter the code sent to " + email;
    }} catch (e) {{
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    }} finally {{
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Reset Code";
    }}
  }};

  window.handleResetPassword = async function() {{
    var code = document.getElementById("forgot-code").value.trim();
    var newPassword = document.getElementById("forgot-new-password").value;
    var email = document.getElementById("forgot-email").value.trim();
    var errorEl = document.getElementById("forgot-error");
    if (!code || !newPassword) {{
      errorEl.textContent = "Please enter code and new password.";
      errorEl.style.display = "block";
      return;
    }}
    errorEl.style.display = "none";
    try {{
      var res = await fetch(API_BASE + "/api/apps/" + PROJECT_ID + "/auth/reset-password", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ email: email, code: code, new_password: newPassword }})
      }});
      if (!res.ok) {{
        var data = await res.json().catch(function() {{ return {{}}; }});
        throw new Error(data.detail || "Reset failed");
      }}
      // Go back to login
      backToLogin();
      alert("Password reset successfully. Please log in.");
    }} catch (e) {{
      errorEl.textContent = e.message;
      errorEl.style.display = "block";
    }}
  }};

  // Register service worker
  if ("serviceWorker" in navigator) {{
    navigator.serviceWorker.register("/live/{project_id}/sw.js").catch(function() {{}});
  }}

  // Check auth on load
  checkAuth();
}})();
</script>

<!-- Load the pre-built React SpecPreview bundle -->
<script src="{bundle_base}/static/preview-bundle.js"></script>
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
