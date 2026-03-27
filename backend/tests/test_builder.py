"""Tests for the backend code builder."""
import pytest
from generator.builder import build_backend


def test_build_creates_files(tmp_path):
    spec = {
        "app_name": "Test",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {
                        "name": "name",
                        "db_type": "VARCHAR(255) NOT NULL",
                        "ts_type": "string",
                        "nullable": False,
                    }
                ],
            }
        ],
    }
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "main.py").exists()
    assert (tmp_path / "db.py").exists()


def test_build_generates_model(tmp_path):
    spec = {
        "app_name": "Test",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255) NOT NULL"},
                ],
            }
        ],
    }
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "models" / "contact.py").exists()


def test_build_generates_route(tmp_path):
    spec = {
        "app_name": "Test",
        "entities": [
            {
                "name": "Contact",
                "table": "contacts",
                "fields": [
                    {"name": "name", "db_type": "VARCHAR(255) NOT NULL"},
                ],
            }
        ],
    }
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "routes" / "contact.py").exists()


def test_build_empty_entities(tmp_path):
    spec = {"app_name": "Test", "entities": []}
    build_backend(spec, str(tmp_path))
    assert (tmp_path / "main.py").exists()
