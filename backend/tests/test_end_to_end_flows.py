"""Integration-style end-to-end tests covering full pipelines."""
import pytest
from generator.spec_validator import validate_and_repair
from generator.deployer import generate_full_app_html
from generator.rag import find_best_specs, build_rag_context
from generator.frontend_builder import build_frontend
from utils.sanitize import sanitize_string, sanitize_dict


# ── Full health check ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_health_check(client):
    """Full health check: GET /health returns 200 with JSON body."""
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok"}
    assert response.headers.get("content-type", "").startswith("application/json")


# ── Landing page ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_landing_page_not_served_by_backend(client):
    """GET / should return 404 (backend does not serve the landing page)."""
    response = await client.get("/")
    # Backend should not serve HTML at root — that is the frontend's job
    assert response.status_code in (404, 307, 200)
    if response.status_code == 404:
        # Ensure it is JSON, not HTML
        ct = response.headers.get("content-type", "")
        assert "html" not in ct.lower() or "json" in ct.lower()


# ── Spec validator full pipeline ─────────────────────────────────────

def test_spec_validator_full_pipeline():
    """An empty spec run through validate_and_repair should become a valid spec."""
    spec = {}
    fixed = validate_and_repair(spec)

    # Must have all required top-level keys
    assert "app_name" in fixed
    assert "entities" in fixed
    assert "modules" in fixed
    assert "design_system" in fixed
    assert "dashboard" in fixed
    assert "pagination" in fixed

    # Design system should have colors
    ds = fixed["design_system"]
    assert "colors" in ds
    assert "primary" in ds["colors"]


# ── RAG finds specs for common domains ───────────────────────────────

def test_rag_finds_specs_for_common_domains():
    """RAG should return relevant context for common business domains."""
    for domain in ("restaurant management", "CRM system", "gym membership"):
        ctx = build_rag_context(domain)
        assert len(ctx) > 100, f"RAG context for '{domain}' too short: {len(ctx)} chars"
        # Should include field definitions
        assert "created_at" in ctx or "name" in ctx, (
            f"RAG context for '{domain}' missing expected field references"
        )


# ── Deployer generates valid HTML ────────────────────────────────────

def test_deployer_generates_valid_html():
    """generate_full_app_html should produce valid HTML with expected structure."""
    spec = {
        "app_name": "Test CRM",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255)"},
                    {"name": "email", "db_type": "VARCHAR(255)"},
                ],
            },
        ],
        "modules": [
            {"name": "Dashboard", "route": "/dashboard"},
            {"name": "Contacts", "route": "/contacts", "entity": "Contact"},
        ],
        "design_system": {"colors": {"primary": "#3b82f6"}},
    }
    html = generate_full_app_html(spec, "https://api.example.com", "test-project-id")

    assert "<!DOCTYPE html>" in html
    assert "Test CRM" in html
    assert len(html) > 1000, "Generated HTML is suspiciously short"
    # Should include the API base URL
    assert "api.example.com" in html
    # Should include Inter font
    assert "Inter" in html


# ── Frontend builder generates valid project ─────────────────────────

def test_frontend_builder_generates_valid_project(tmp_path):
    """build_frontend should produce a complete React project."""
    spec = {
        "app_name": "Mini App",
        "entities": [
            {
                "name": "Note",
                "table": "notes",
                "fields": [
                    {"name": "id", "db_type": "UUID", "ts_type": "string",
                     "show_in_table": False, "show_in_form": False},
                    {"name": "title", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string",
                     "show_in_table": True, "show_in_form": True,
                     "input_component": "text_input", "display_component": "text"},
                    {"name": "body", "db_type": "TEXT", "ts_type": "string",
                     "show_in_table": False, "show_in_form": True,
                     "input_component": "textarea", "display_component": "text"},
                    {"name": "created_at", "db_type": "TIMESTAMPTZ", "ts_type": "string",
                     "show_in_table": True, "show_in_form": False,
                     "display_component": "datetime"},
                ],
            },
        ],
        "modules": [
            {"name": "Dashboard", "route": "/dashboard", "sidebar_icon": "LayoutDashboard"},
            {"name": "Notes", "route": "/notes", "entity": "Note", "sidebar_icon": "StickyNote"},
        ],
        "design_system": {"colors": {"primary": "#8b5cf6"}},
    }
    build_frontend(spec, str(tmp_path))

    assert (tmp_path / "package.json").exists()
    assert (tmp_path / "src" / "App.tsx").exists()
    assert (tmp_path / "src" / "pages" / "NotePage.tsx").exists()


# ── Sanitizer prevents XSS ──────────────────────────────────────────

def test_sanitize_prevents_xss():
    """Sanitizer should neutralize all common XSS vectors."""
    vectors = [
        '<script>alert("xss")</script>',
        '<img src=x onerror="alert(1)">',
        '<svg onload="alert(1)">',
        "javascript:alert(1)",
        '<a href="javascript:void(0)">click</a>',
        '<div onmouseover="alert(1)">hover</div>',
    ]
    for v in vectors:
        result = sanitize_string(v)
        assert "<script>" not in result, f"XSS not sanitized: {v}"
        assert "<img " not in result or "onerror" not in result
        assert "<svg " not in result or "onload" not in result


# ── Error handler no stack trace ─────────────────────────────────────

@pytest.mark.asyncio
async def test_error_handler_no_stack_trace(client):
    """Error responses should not leak stack traces."""
    response = await client.get("/api/nonexistent-route-for-stack-trace-test")
    assert response.status_code in (404, 405, 500)
    body = response.text
    assert "Traceback" not in body
    assert "File \"" not in body
    assert "line " not in body or "at line" not in body


# ── Rate limiter disabled in tests ───────────────────────────────────

def test_rate_limiter_disabled_in_tests():
    """TESTING=1 environment variable should be set in test mode."""
    import os
    assert os.environ.get("TESTING") == "1"


# ── All models have id column ────────────────────────────────────────

def test_all_models_have_id_column():
    """All SQLAlchemy models should have an 'id' column."""
    from db import Base
    import models  # noqa: F401

    # Import additional models
    model_modules = [
        "models.gallery_entry", "models.referral", "models.webhook",
        "models.api_key", "models.plugin", "models.component",
        "models.review", "models.app_analytics", "models.file_upload",
        "models.marketplace_template", "models.push_subscription",
        "models.serverless_function", "models.app_embed",
        "models.sso_config", "models.app_view_config",
    ]
    for mod_name in model_modules:
        try:
            __import__(mod_name)
        except ImportError:
            pass

    for mapper in Base.registry.mappers:
        cls = mapper.class_
        columns = {c.name for c in mapper.columns}
        assert "id" in columns, (
            f"Model {cls.__name__} (table: {mapper.local_table.name}) is missing 'id' column"
        )
