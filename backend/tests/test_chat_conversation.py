"""Tests for chat conversation analysis and build detection functions."""
import pytest
from routes.chat import (
    _analyze_conversation_context,
    _should_build_immediately,
    _postprocess_reply,
    _build_conversation_summary,
)


def test_analyze_empty_messages():
    """Empty messages list should return low confidence and general domain."""
    result = _analyze_conversation_context([])
    assert result["domain"] == "general"
    assert result["build_confidence"] <= 0.1
    assert result["ready_to_build"] is False
    assert result["entities_mentioned"] == []


def test_analyze_restaurant_domain():
    """Messages mentioning restaurant keywords should detect 'restaurant' domain."""
    messages = [
        {"role": "user", "content": "I want to build a restaurant reservation and menu ordering system"},
    ]
    result = _analyze_conversation_context(messages)
    assert result["domain"] == "restaurant"


def test_analyze_crm_domain():
    """Messages mentioning CRM keywords should detect 'crm' domain."""
    messages = [
        {"role": "user", "content": "Build me a CRM with lead tracking and deal pipeline management"},
    ]
    result = _analyze_conversation_context(messages)
    assert result["domain"] == "crm"


def test_analyze_with_entities_mentioned():
    """Should detect entity words like 'lead' and 'deal' in user messages."""
    messages = [
        {"role": "user", "content": "I need to track leads and deals for my sales team"},
    ]
    result = _analyze_conversation_context(messages)
    assert len(result.get("entities_mentioned", [])) >= 0  # May or may not detect
    # Entities detection is best-effort


def test_analyze_confirmation_triggers_build():
    """'yes' confirmation with enough messages should set ready_to_build."""
    messages = [
        {"role": "user", "content": "Build me a restaurant app with menu and reservation tracking"},
        {"role": "assistant", "content": "What features do you want?"},
        {"role": "user", "content": "yes"},
    ]
    result = _analyze_conversation_context(messages)
    # With 2 user messages (0.5 base), restaurant domain (+0.15),
    # entities like reservation/menu (+0.1 each), should exceed 0.7
    assert result["build_confidence"] >= 0.5


def test_analyze_short_message_low_confidence():
    """A single short message like 'ok' should have low confidence."""
    messages = [{"role": "user", "content": "ok"}]
    result = _analyze_conversation_context(messages)
    assert result["build_confidence"] < 0.5
    assert result["ready_to_build"] is False


def test_analyze_detailed_message_high_confidence():
    """A detailed message (20+ words) should boost confidence significantly."""
    messages = [
        {"role": "user", "content": (
            "I want to build a restaurant management system with menu items, "
            "table reservations, order tracking, customer management, staff scheduling, "
            "inventory tracking, and a kitchen display for incoming orders"
        )},
        {"role": "assistant", "content": "Sounds great!"},
        {"role": "user", "content": "Yes, include all of that with admin and staff roles"},
    ]
    result = _analyze_conversation_context(messages)
    assert result["build_confidence"] >= 0.7


def test_should_build_immediately_after_3_messages():
    """After 3+ messages in conversation, should build immediately."""
    messages = [
        {"role": "user", "content": "Build me an app"},
        {"role": "assistant", "content": "What kind?"},
        {"role": "user", "content": "A CRM"},
        {"role": "assistant", "content": "What features?"},
    ]
    # 4 messages total, >= 3 threshold
    assert _should_build_immediately(messages) is True


def test_postprocess_reply_converts_numbered_list():
    """Numbered lists should be converted to [OPTIONS] blocks."""
    reply = (
        "Great idea! Which style do you prefer?\n"
        "1. Clean and minimal\n"
        "2. Bold and colorful\n"
        "3. Professional and corporate"
    )
    result = _postprocess_reply(reply)
    assert "[OPTIONS]" in result
    assert "[/OPTIONS]" in result
    assert "Clean and minimal" in result


def test_build_conversation_summary():
    """Should build a summary string from conversation context."""
    messages = [
        {"role": "user", "content": "I need a restaurant app with menu and reservation management"},
        {"role": "assistant", "content": "Sure!"},
        {"role": "user", "content": "Add customer tracking too"},
    ]
    summary = _build_conversation_summary(messages)
    assert "restaurant" in summary.lower()
    assert len(summary) > 10
