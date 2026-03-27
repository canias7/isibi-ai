"""Tests for the HTML app deployer / generator."""
import pytest
from generator.deployer import generate_full_app_html


def test_generates_html():
    spec = {
        "app_name": "Test",
        "entities": [],
        "modules": [],
        "design_system": {"colors": {"primary": "#ec4899"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "<!DOCTYPE html>" in html
    assert "Test" in html


def test_includes_inter_font():
    spec = {
        "app_name": "Test",
        "entities": [],
        "modules": [],
        "design_system": {"colors": {"primary": "#ec4899"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "Inter" in html


def test_includes_pwa_manifest():
    spec = {
        "app_name": "Test",
        "entities": [],
        "modules": [],
        "design_system": {"colors": {"primary": "#ec4899"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "manifest.json" in html


def test_empty_entities_no_crash():
    spec = {"entities": []}
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert len(html) > 100


def test_entity_creates_sidebar_item():
    spec = {
        "app_name": "Test",
        "entities": [
            {"name": "Lead", "table": "leads", "fields": []},
        ],
        "modules": [
            {"name": "Leads", "route": "/leads", "entity": "Lead"},
        ],
        "design_system": {"colors": {"primary": "#ec4899"}},
    }
    html = generate_full_app_html(spec, "https://api.test.com", "test-id")
    assert "Lead" in html
