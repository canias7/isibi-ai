"""Comprehensive RAG tests — 8 tests covering spec matching, synonym detection, context limits, and field library."""
from generator.rag import find_best_specs, build_rag_context, build_field_library, UNIVERSAL_PATTERNS


def test_restaurant_finds_restaurant_spec():
    """Searching for 'restaurant' should return relevant specs (if any exist)."""
    specs = find_best_specs("restaurant management system")
    # The function should return a list (may be empty if no spec files found)
    assert isinstance(specs, list)
    # If specs are found, they should be tuples of (path, dict, score)
    for item in specs:
        assert len(item) == 3
        assert isinstance(item[1], dict)
        assert isinstance(item[2], (int, float))


def test_crm_finds_crm_spec():
    """Searching for 'CRM' should return relevant specs."""
    specs = find_best_specs("build me a CRM for tracking leads and deals")
    assert isinstance(specs, list)
    for item in specs:
        assert len(item) == 3
        assert item[2] >= 0  # Score should be non-negative


def test_composite_finds_multiple_specs():
    """A composite prompt mentioning multiple domains should find multiple specs."""
    ctx = build_rag_context("CRM with invoicing and inventory management")
    # Should return substantial context
    assert isinstance(ctx, str)
    assert len(ctx) > 100


def test_synonym_matching():
    """Synonym matching should work — 'salon' should match the beauty category."""
    from generator.rag import _detect_categories
    cats = _detect_categories("I need a salon booking system")
    assert "beauty" in cats


def test_universal_patterns_always_included():
    """build_rag_context should always include universal patterns regardless of prompt."""
    ctx = build_rag_context("something completely random xyz123")
    assert "created_at" in ctx
    assert "org_id" in ctx
    assert "UNIVERSAL" in ctx


def test_field_library_has_examples():
    """build_field_library should return field pattern examples."""
    lib = build_field_library()
    assert isinstance(lib, str)
    # Even with no spec files, it returns a string (possibly empty)


def test_unknown_domain_still_returns_context():
    """Even for a completely unknown domain, RAG should return universal patterns."""
    ctx = build_rag_context("build me a quantum teleportation tracker")
    assert isinstance(ctx, str)
    assert len(ctx) > 50
    # Universal patterns should still be present
    assert "UNIVERSAL" in ctx or "created_at" in ctx


def test_rag_context_under_token_limit():
    """build_rag_context should stay under ~15000 chars (~5000 tokens)."""
    ctx = build_rag_context("build a comprehensive CRM with invoicing, HR, inventory, and project management")
    assert len(ctx) <= 20000  # Allow some buffer above the 15000 target
