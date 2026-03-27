"""Tests for AI prompt expansion and context analysis via RAG category detection."""
import pytest
from generator.rag import _detect_categories, _tokenize, build_rag_context


class TestExpandPromptAddEntities:
    """Test that domain-specific prompts get categorized correctly,
    which drives entity suggestions in the RAG context."""

    def test_expand_crm_adds_entities(self):
        """CRM prompt should detect the 'crm' category."""
        cats = _detect_categories("Build me a CRM to track leads and sales pipeline")
        assert "crm" in cats, f"Expected 'crm' category, got {cats}"

    def test_expand_restaurant_adds_entities(self):
        """Restaurant prompt should detect the 'restaurant' category."""
        cats = _detect_categories("I need a restaurant management system with menu and orders")
        assert "restaurant" in cats, f"Expected 'restaurant' category, got {cats}"

    def test_expand_gym_adds_entities(self):
        """Gym/fitness prompt should detect the 'fitness' category."""
        cats = _detect_categories("Create a gym membership tracking app with workout plans")
        assert "fitness" in cats, f"Expected 'fitness' category, got {cats}"

    def test_expand_ecommerce_adds_entities(self):
        """Ecommerce prompt should detect the 'ecommerce' category."""
        cats = _detect_categories("Build an ecommerce store with products and shopping cart")
        assert "ecommerce" in cats, f"Expected 'ecommerce' category, got {cats}"

    def test_expand_unknown_domain_returns_original(self):
        """An unrecognizable prompt should return an empty category set."""
        cats = _detect_categories("Build me something completely unique and novel")
        # Should not match any domain-specific category
        assert len(cats) == 0, f"Expected no categories for vague prompt, got {cats}"


class TestContextAnalysis:
    """Test context analysis (category detection) for different domains."""

    def test_context_analysis_detects_restaurant(self):
        """Should detect restaurant from food/menu keywords."""
        cats = _detect_categories("food ordering system with menu items and kitchen display")
        assert "restaurant" in cats, f"Expected 'restaurant', got {cats}"

    def test_context_analysis_detects_crm(self):
        """Should detect CRM from customer/lead keywords."""
        cats = _detect_categories("customer relationship management with lead tracking")
        assert "crm" in cats, f"Expected 'crm', got {cats}"

    def test_context_analysis_high_confidence_triggers_build(self):
        """A highly specific prompt should match at least one category."""
        cats = _detect_categories("dental clinic patient appointment scheduling system")
        assert len(cats) >= 1, "Specific domain prompt should match at least one category"
        assert "healthcare" in cats, f"Expected 'healthcare' category, got {cats}"

    def test_context_analysis_low_confidence_no_build(self):
        """A generic/vague prompt should not match any category."""
        cats = _detect_categories("hello world test")
        assert len(cats) == 0, f"Vague prompt should not match categories, got {cats}"


class TestConversationSummary:
    """Test that conversation context yields meaningful domain info."""

    def test_conversation_summary_includes_domain(self):
        """Tokenizing a domain-specific prompt should extract meaningful keywords."""
        tokens = _tokenize("restaurant management system with reservations and menu")
        assert "restaurant" in tokens, f"Expected 'restaurant' in tokens, got {tokens}"
        assert "reservations" in tokens, f"Expected 'reservations' in tokens, got {tokens}"
        assert "menu" in tokens, f"Expected 'menu' in tokens, got {tokens}"
        # Stop words like 'with' and 'and' should be removed
        assert "with" not in tokens, "Stop word 'with' should be removed"
        assert "and" not in tokens, "Stop word 'and' should be removed"
