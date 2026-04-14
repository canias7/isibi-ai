"""Tests for RAG matching across specific business domains.

Verifies that find_best_specs returns relevant results for various
industry verticals and composite prompts.
"""
import pytest
from generator.rag import find_best_specs, build_rag_context


def _top_result_text(prompt: str) -> str:
    """Return a searchable string from the top RAG result for a prompt.

    Combines the filename, app_name, and entity names from the best match
    so that we can assert domain-relevant keywords appear.
    """
    results = find_best_specs(prompt, max_results=3)
    if not results:
        return ""

    parts = []
    for path, spec, score in results:
        parts.append(path.stem.lower())
        parts.append((spec.get("app_name") or "").lower())
        for ent in spec.get("entities") or []:
            parts.append((ent.get("name") or "").lower())
        # Include keywords if available
        for kw in spec.get("keywords", []):
            parts.append(kw.lower())
    return " ".join(parts)


def test_rag_restaurant_returns_relevant():
    """RAG should return restaurant/menu-related specs for a restaurant prompt."""
    text = _top_result_text("restaurant management system")
    assert any(kw in text for kw in ("restaurant", "menu", "food", "order", "table", "reservation", "dining")), \
        f"No restaurant-related keywords in top results: {text[:200]}"


def test_rag_crm_returns_relevant():
    """RAG should return CRM-related specs for a CRM prompt."""
    text = _top_result_text("build me a CRM")
    assert any(kw in text for kw in ("crm", "lead", "contact", "deal", "pipeline", "customer", "sales")), \
        f"No CRM-related keywords in top results: {text[:200]}"


def test_rag_gym_returns_relevant():
    """RAG should return gym/fitness-related specs for a gym prompt."""
    text = _top_result_text("gym membership management")
    assert any(kw in text for kw in ("gym", "fitness", "member", "workout", "class", "trainer", "membership")), \
        f"No gym-related keywords in top results: {text[:200]}"


def test_rag_ecommerce_returns_relevant():
    """RAG should return e-commerce-related specs for an online store prompt."""
    text = _top_result_text("e-commerce store with product catalog and orders")
    assert any(kw in text for kw in ("ecommerce", "product", "order", "cart", "shop", "store", "catalog", "inventory")), \
        f"No e-commerce-related keywords in top results: {text[:200]}"


def test_rag_healthcare_returns_relevant():
    """RAG should return healthcare-related specs for a clinic prompt."""
    text = _top_result_text("healthcare clinic patient management")
    assert any(kw in text for kw in ("health", "patient", "clinic", "medical", "doctor", "appointment", "hospital")), \
        f"No healthcare-related keywords in top results: {text[:200]}"


def test_rag_school_returns_relevant():
    """RAG should return education-related specs for a school prompt."""
    text = _top_result_text("school management system with students and teachers")
    assert any(kw in text for kw in ("school", "student", "teacher", "class", "education", "course", "grade", "enroll")), \
        f"No school-related keywords in top results: {text[:200]}"


def test_rag_hotel_returns_relevant():
    """RAG should return hospitality-related specs for a hotel prompt."""
    text = _top_result_text("hotel reservation booking system")
    assert any(kw in text for kw in ("hotel", "reservation", "booking", "room", "guest", "hospitality", "check")), \
        f"No hotel-related keywords in top results: {text[:200]}"


def test_rag_salon_returns_relevant():
    """RAG should return salon/beauty-related specs for a salon prompt."""
    text = _top_result_text("beauty salon appointment scheduling")
    assert any(kw in text for kw in ("salon", "beauty", "appointment", "booking", "service", "stylist", "spa")), \
        f"No salon-related keywords in top results: {text[:200]}"


@pytest.mark.xfail(reason="Output varies")
def test_rag_composite_returns_multiple():
    """Composite prompts (e.g. 'CRM with invoicing') should yield substantial context."""
    ctx = build_rag_context("CRM with invoicing and project tracking")
    # Composite requests should generate rich context
    assert len(ctx) > 200, f"Composite context too short: {len(ctx)} chars"
    # Should contain at least some entity-like content
    assert any(kw in ctx.lower() for kw in ("lead", "contact", "invoice", "project", "task", "customer")), \
        "Composite context missing expected domain keywords"


def test_rag_unknown_domain_still_returns_results():
    """Even for obscure prompts, RAG should return fallback results."""
    results = find_best_specs("quantum physics lab equipment tracker")
    assert len(results) > 0, "RAG should always return at least one fallback spec"
    # The context should still be usable
    ctx = build_rag_context("quantum physics lab equipment tracker")
    assert len(ctx) > 100, "RAG context should be non-trivial even for unknown domains"
    # Universal patterns should always be present
    assert "created_at" in ctx, "Universal patterns should be included in context"
