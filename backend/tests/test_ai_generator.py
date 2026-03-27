"""Tests for the AI generator JSON parsing utilities."""
import pytest
from generator.ai_generator import _robust_json_parse, _fix_common_json_errors


def test_parse_valid_json():
    result = _robust_json_parse('{"key": "value"}')
    assert result == {"key": "value"}


def test_parse_with_code_fences():
    result = _robust_json_parse('```json\n{"key": "value"}\n```')
    assert result == {"key": "value"}


def test_parse_with_surrounding_text():
    result = _robust_json_parse('Here is the spec:\n{"key": "value"}\nDone!')
    assert result == {"key": "value"}


def test_fix_trailing_comma():
    fixed = _fix_common_json_errors('{"a": 1, "b": 2,}')
    assert '"b": 2}' in fixed or '"b": 2 }' in fixed
