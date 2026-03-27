"""Tests for overall platform completeness — verifying key files and imports."""
import os
import importlib
import pytest


BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
FRONTEND_ROOT = os.path.join(BACKEND_ROOT, "..", "frontend", "src")


def _frontend_exists(path: str) -> bool:
    return os.path.isfile(os.path.normpath(os.path.join(FRONTEND_ROOT, path)))


def _backend_exists(path: str) -> bool:
    return os.path.isfile(os.path.normpath(os.path.join(BACKEND_ROOT, path)))


# ── Frontend pages ──

def test_all_frontend_pages_exist():
    """All key frontend page files should exist."""
    pages = [
        "pages/OnboardingPage.tsx",
        "pages/LoginPage.tsx",
        "pages/SignupPage.tsx",
        "pages/LandingPage.tsx",
        "pages/MarketplacePage.tsx",
        "pages/ProjectSettingsPage.tsx",
        "pages/MyAppsPage.tsx",
        "pages/DevMarketplacePage.tsx",
    ]
    missing = [p for p in pages if not _frontend_exists(p)]
    assert not missing, f"Missing frontend pages: {missing}"


# ── Frontend components ──

def test_all_frontend_components_exist():
    """All key frontend component files should exist."""
    components = [
        "components/SpecPreview.tsx",
        "components/VisualEditor.tsx",
        "components/CloudIDE.tsx",
        "components/ERDViewer.tsx",
        "components/SpecEditor.tsx",
        "components/FieldEditor.tsx",
        "components/QRCodeSVG.tsx",
        "components/TourOverlay.tsx",
    ]
    missing = [c for c in components if not _frontend_exists(c)]
    assert not missing, f"Missing frontend components: {missing}"


# ── Backend model imports ──

def test_all_backend_models_importable():
    """Core backend models should be importable."""
    model_modules = [
        "models.user",
        "models.project",
        "models.lead",
        "models.deal",
        "models.task",
        "models.conversation",
    ]
    errors = []
    for mod in model_modules:
        try:
            importlib.import_module(mod)
        except Exception as e:
            errors.append(f"{mod}: {e}")
    assert not errors, f"Failed to import models: {errors}"


# ── Backend route imports ──

def test_all_backend_routes_importable():
    """Core backend route modules should be importable."""
    route_modules = [
        "routes.auth",
        "routes.generator",
        "routes.crud",
        "routes.users",
    ]
    errors = []
    for mod in route_modules:
        try:
            importlib.import_module(mod)
        except Exception as e:
            errors.append(f"{mod}: {e}")
    assert not errors, f"Failed to import routes: {errors}"


# ── Router registry ──

def test_router_registry_importable():
    """router_registry module should import cleanly."""
    try:
        import router_registry
        assert hasattr(router_registry, "register_all_routers")
    except ImportError:
        pytest.skip("router_registry not on sys.path")


# ── Spec validator ──

def test_spec_validator_importable():
    """generator.spec_validator should import cleanly."""
    from generator import spec_validator
    assert hasattr(spec_validator, "validate_and_repair") or hasattr(spec_validator, "get_validation_report")


# ── Deployer ──

def test_deployer_importable():
    """generator.deployer should import and expose generate_full_app_html."""
    from generator.deployer import generate_full_app_html
    assert callable(generate_full_app_html)


# ── Builder ──

def test_builder_importable():
    """generator.builder should import cleanly."""
    from generator import builder
    assert builder is not None


# ── Frontend builder ──

def test_frontend_builder_importable():
    """generator.frontend_builder should import cleanly."""
    from generator import frontend_builder
    assert frontend_builder is not None


# ── RAG ──

def test_rag_importable():
    """generator.rag should import cleanly."""
    from generator import rag
    assert rag is not None
