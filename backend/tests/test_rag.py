from generator.rag import find_best_specs, build_rag_context


def test_find_best_specs_returns_results():
    specs = find_best_specs("build me a CRM")
    assert len(specs) > 0


def test_rag_context_not_empty():
    ctx = build_rag_context("restaurant management system")
    assert len(ctx) > 100


def test_composite_matching():
    ctx = build_rag_context("CRM with invoicing")
    # The RAG should return relevant context - check it's substantial
    assert len(ctx) > 200


def test_universal_patterns_included():
    ctx = build_rag_context("anything")
    assert "created_at" in ctx
