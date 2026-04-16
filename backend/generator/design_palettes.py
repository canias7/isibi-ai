"""
Domain-aware design palettes for generated apps.

Each industry has multiple palette options so apps feel unique.
The AI generator picks the best-fit palette based on the user's prompt,
or Claude can mix elements from multiple palettes.
"""

from __future__ import annotations
import random
import re
from typing import Any

# ── Palette structure ────────────────────────────────────────────────────────
# Each palette: { name, primary, secondary, sidebar_bg, sidebar_text, accent, font, style }
# style: "light" | "dark" | "colored" | "glass"

PALETTES: dict[str, list[dict[str, str]]] = {

    # ── RESTAURANT / FOOD ────────────────────────────────────────────────
    "restaurant": [
        {"name": "Italian Trattoria", "primary": "#b91c1c", "secondary": "#92400e", "sidebar_bg": "#1c1917", "sidebar_text": "#fef3c7", "accent": "#f59e0b", "font": "Playfair Display", "style": "dark"},
        {"name": "Modern Bistro", "primary": "#dc2626", "secondary": "#57534e", "sidebar_bg": "#fafaf9", "sidebar_text": "#292524", "accent": "#ea580c", "font": "DM Sans", "style": "light"},
        {"name": "Japanese Minimal", "primary": "#0f172a", "secondary": "#64748b", "sidebar_bg": "#ffffff", "sidebar_text": "#334155", "accent": "#dc2626", "font": "Noto Sans", "style": "light"},
        {"name": "Mexican Cantina", "primary": "#dc2626", "secondary": "#15803d", "sidebar_bg": "#fef9c3", "sidebar_text": "#422006", "accent": "#ea580c", "font": "Poppins", "style": "colored"},
        {"name": "Seafood Harbor", "primary": "#0369a1", "secondary": "#155e75", "sidebar_bg": "#0c4a6e", "sidebar_text": "#e0f2fe", "accent": "#06b6d4", "font": "Lora", "style": "dark"},
        {"name": "Café Brunch", "primary": "#b45309", "secondary": "#78716c", "sidebar_bg": "#fef7ed", "sidebar_text": "#44403c", "accent": "#d97706", "font": "Nunito", "style": "light"},
        {"name": "Fine Dining", "primary": "#1e1b4b", "secondary": "#6b7280", "sidebar_bg": "#030712", "sidebar_text": "#d1d5db", "accent": "#c9a96e", "font": "Cormorant Garamond", "style": "dark"},
        {"name": "Fast Casual", "primary": "#ea580c", "secondary": "#57534e", "sidebar_bg": "#fff7ed", "sidebar_text": "#431407", "accent": "#f97316", "font": "Space Grotesk", "style": "light"},
        {"name": "BBQ Smokehouse", "primary": "#7c2d12", "secondary": "#451a03", "sidebar_bg": "#1c1917", "sidebar_text": "#fed7aa", "accent": "#fb923c", "font": "Oswald", "style": "dark"},
        {"name": "Vegan Garden", "primary": "#15803d", "secondary": "#065f46", "sidebar_bg": "#f0fdf4", "sidebar_text": "#14532d", "accent": "#22c55e", "font": "Quicksand", "style": "light"},
    ],

    # ── MEDICAL / HEALTHCARE ─────────────────────────────────────────────
    "medical": [
        {"name": "Clinical Blue", "primary": "#0284c7", "secondary": "#475569", "sidebar_bg": "#f8fafc", "sidebar_text": "#1e293b", "accent": "#0ea5e9", "font": "DM Sans", "style": "light"},
        {"name": "Modern Health", "primary": "#0d9488", "secondary": "#64748b", "sidebar_bg": "#ffffff", "sidebar_text": "#334155", "accent": "#14b8a6", "font": "Inter", "style": "light"},
        {"name": "Pediatric Warm", "primary": "#7c3aed", "secondary": "#6366f1", "sidebar_bg": "#faf5ff", "sidebar_text": "#4c1d95", "accent": "#a78bfa", "font": "Nunito", "style": "light"},
        {"name": "Dental Fresh", "primary": "#0891b2", "secondary": "#06b6d4", "sidebar_bg": "#ecfeff", "sidebar_text": "#164e63", "accent": "#22d3ee", "font": "Outfit", "style": "light"},
        {"name": "Surgical Precision", "primary": "#1e40af", "secondary": "#1e3a5f", "sidebar_bg": "#0f172a", "sidebar_text": "#cbd5e1", "accent": "#3b82f6", "font": "Source Sans 3", "style": "dark"},
        {"name": "Wellness Spa", "primary": "#059669", "secondary": "#10b981", "sidebar_bg": "#f0fdf4", "sidebar_text": "#064e3b", "accent": "#34d399", "font": "Quicksand", "style": "light"},
        {"name": "Pharmacy", "primary": "#16a34a", "secondary": "#15803d", "sidebar_bg": "#ffffff", "sidebar_text": "#166534", "accent": "#4ade80", "font": "Rubik", "style": "light"},
        {"name": "Mental Health", "primary": "#7e22ce", "secondary": "#9333ea", "sidebar_bg": "#faf5ff", "sidebar_text": "#581c87", "accent": "#c084fc", "font": "Lora", "style": "light"},
    ],

    # ── FITNESS / GYM ────────────────────────────────────────────────────
    "fitness": [
        {"name": "Iron Bold", "primary": "#000000", "secondary": "#27272a", "sidebar_bg": "#09090b", "sidebar_text": "#e4e4e7", "accent": "#eab308", "font": "Oswald", "style": "dark"},
        {"name": "Energy Green", "primary": "#16a34a", "secondary": "#15803d", "sidebar_bg": "#052e16", "sidebar_text": "#bbf7d0", "accent": "#22c55e", "font": "Montserrat", "style": "dark"},
        {"name": "CrossFit Red", "primary": "#dc2626", "secondary": "#1c1917", "sidebar_bg": "#0a0a0a", "sidebar_text": "#fecaca", "accent": "#ef4444", "font": "Bebas Neue", "style": "dark"},
        {"name": "Yoga Calm", "primary": "#7c3aed", "secondary": "#a78bfa", "sidebar_bg": "#faf5ff", "sidebar_text": "#4c1d95", "accent": "#8b5cf6", "font": "Quicksand", "style": "light"},
        {"name": "Athletic Blue", "primary": "#1d4ed8", "secondary": "#1e3a8a", "sidebar_bg": "#0f172a", "sidebar_text": "#bfdbfe", "accent": "#3b82f6", "font": "Rajdhani", "style": "dark"},
        {"name": "Boxing Ring", "primary": "#b91c1c", "secondary": "#000000", "sidebar_bg": "#0c0a09", "sidebar_text": "#fca5a5", "accent": "#f87171", "font": "Anton", "style": "dark"},
        {"name": "Pilates Studio", "primary": "#ec4899", "secondary": "#db2777", "sidebar_bg": "#fdf2f8", "sidebar_text": "#831843", "accent": "#f472b6", "font": "Outfit", "style": "light"},
        {"name": "Outdoor Adventure", "primary": "#ca8a04", "secondary": "#854d0e", "sidebar_bg": "#1a2e05", "sidebar_text": "#fef08a", "accent": "#facc15", "font": "Barlow", "style": "dark"},
    ],

    # ── REAL ESTATE ──────────────────────────────────────────────────────
    "real_estate": [
        {"name": "Luxury Estate", "primary": "#1e1b4b", "secondary": "#6b7280", "sidebar_bg": "#020617", "sidebar_text": "#c9a96e", "accent": "#c9a96e", "font": "Playfair Display", "style": "dark"},
        {"name": "Modern Realty", "primary": "#0f766e", "secondary": "#134e4a", "sidebar_bg": "#ffffff", "sidebar_text": "#1e293b", "accent": "#14b8a6", "font": "DM Sans", "style": "light"},
        {"name": "Urban Loft", "primary": "#18181b", "secondary": "#3f3f46", "sidebar_bg": "#09090b", "sidebar_text": "#d4d4d8", "accent": "#f59e0b", "font": "Space Grotesk", "style": "dark"},
        {"name": "Coastal Properties", "primary": "#0369a1", "secondary": "#0284c7", "sidebar_bg": "#f0f9ff", "sidebar_text": "#0c4a6e", "accent": "#38bdf8", "font": "Lora", "style": "light"},
        {"name": "Green Living", "primary": "#166534", "secondary": "#15803d", "sidebar_bg": "#f0fdf4", "sidebar_text": "#14532d", "accent": "#4ade80", "font": "Nunito", "style": "light"},
        {"name": "Commercial Pro", "primary": "#1e3a5f", "secondary": "#374151", "sidebar_bg": "#111827", "sidebar_text": "#9ca3af", "accent": "#2563eb", "font": "Inter", "style": "dark"},
        {"name": "Rustic Country", "primary": "#78350f", "secondary": "#92400e", "sidebar_bg": "#fffbeb", "sidebar_text": "#451a03", "accent": "#b45309", "font": "Merriweather", "style": "light"},
    ],

    # ── E-COMMERCE / RETAIL ──────────────────────────────────────────────
    "ecommerce": [
        {"name": "Shopify Modern", "primary": "#7c3aed", "secondary": "#6d28d9", "sidebar_bg": "#faf5ff", "sidebar_text": "#4c1d95", "accent": "#a78bfa", "font": "Inter", "style": "light"},
        {"name": "Amazon Style", "primary": "#f59e0b", "secondary": "#d97706", "sidebar_bg": "#0f172a", "sidebar_text": "#fef3c7", "accent": "#fbbf24", "font": "Poppins", "style": "dark"},
        {"name": "Luxury Fashion", "primary": "#000000", "secondary": "#404040", "sidebar_bg": "#000000", "sidebar_text": "#ffffff", "accent": "#c9a96e", "font": "Cormorant Garamond", "style": "dark"},
        {"name": "Organic Market", "primary": "#15803d", "secondary": "#166534", "sidebar_bg": "#ffffff", "sidebar_text": "#14532d", "accent": "#22c55e", "font": "Nunito", "style": "light"},
        {"name": "Tech Store", "primary": "#2563eb", "secondary": "#1d4ed8", "sidebar_bg": "#0f172a", "sidebar_text": "#93c5fd", "accent": "#3b82f6", "font": "Space Grotesk", "style": "dark"},
        {"name": "Kids & Toys", "primary": "#ec4899", "secondary": "#8b5cf6", "sidebar_bg": "#fdf2f8", "sidebar_text": "#831843", "accent": "#f472b6", "font": "Quicksand", "style": "light"},
        {"name": "Home Decor", "primary": "#a16207", "secondary": "#854d0e", "sidebar_bg": "#fffbeb", "sidebar_text": "#422006", "accent": "#ca8a04", "font": "Lora", "style": "light"},
        {"name": "Sports Gear", "primary": "#dc2626", "secondary": "#1e293b", "sidebar_bg": "#0f172a", "sidebar_text": "#fca5a5", "accent": "#ef4444", "font": "Montserrat", "style": "dark"},
    ],

    # ── EDUCATION ────────────────────────────────────────────────────────
    "education": [
        {"name": "University Classic", "primary": "#1e3a5f", "secondary": "#475569", "sidebar_bg": "#f1f5f9", "sidebar_text": "#0f172a", "accent": "#2563eb", "font": "Merriweather", "style": "light"},
        {"name": "Online Course", "primary": "#7c3aed", "secondary": "#6366f1", "sidebar_bg": "#ffffff", "sidebar_text": "#312e81", "accent": "#8b5cf6", "font": "Poppins", "style": "light"},
        {"name": "Kids Learning", "primary": "#ea580c", "secondary": "#f59e0b", "sidebar_bg": "#fffbeb", "sidebar_text": "#431407", "accent": "#fb923c", "font": "Nunito", "style": "light"},
        {"name": "STEM Academy", "primary": "#059669", "secondary": "#0d9488", "sidebar_bg": "#0f172a", "sidebar_text": "#a7f3d0", "accent": "#10b981", "font": "Fira Code", "style": "dark"},
        {"name": "Art School", "primary": "#db2777", "secondary": "#c026d3", "sidebar_bg": "#fdf2f8", "sidebar_text": "#701a75", "accent": "#f472b6", "font": "Outfit", "style": "light"},
        {"name": "Language Center", "primary": "#0284c7", "secondary": "#0ea5e9", "sidebar_bg": "#f0f9ff", "sidebar_text": "#0c4a6e", "accent": "#38bdf8", "font": "Rubik", "style": "light"},
    ],

    # ── LEGAL ────────────────────────────────────────────────────────────
    "legal": [
        {"name": "Corporate Law", "primary": "#1e3a5f", "secondary": "#374151", "sidebar_bg": "#111827", "sidebar_text": "#d1d5db", "accent": "#2563eb", "font": "Merriweather", "style": "dark"},
        {"name": "Modern Firm", "primary": "#0f172a", "secondary": "#334155", "sidebar_bg": "#ffffff", "sidebar_text": "#1e293b", "accent": "#6366f1", "font": "DM Sans", "style": "light"},
        {"name": "Family Law", "primary": "#7e22ce", "secondary": "#6d28d9", "sidebar_bg": "#faf5ff", "sidebar_text": "#4c1d95", "accent": "#a78bfa", "font": "Lora", "style": "light"},
        {"name": "Criminal Defense", "primary": "#0a0a0a", "secondary": "#262626", "sidebar_bg": "#0a0a0a", "sidebar_text": "#a3a3a3", "accent": "#dc2626", "font": "Oswald", "style": "dark"},
        {"name": "Immigration", "primary": "#0369a1", "secondary": "#0284c7", "sidebar_bg": "#f0f9ff", "sidebar_text": "#0c4a6e", "accent": "#0ea5e9", "font": "Source Sans 3", "style": "light"},
    ],

    # ── SALON / BEAUTY ───────────────────────────────────────────────────
    "beauty": [
        {"name": "Glam Studio", "primary": "#be185d", "secondary": "#9d174d", "sidebar_bg": "#fdf2f8", "sidebar_text": "#831843", "accent": "#ec4899", "font": "Playfair Display", "style": "light"},
        {"name": "Barber Shop", "primary": "#1c1917", "secondary": "#44403c", "sidebar_bg": "#0c0a09", "sidebar_text": "#d6d3d1", "accent": "#b45309", "font": "Bebas Neue", "style": "dark"},
        {"name": "Nail Art", "primary": "#c026d3", "secondary": "#a21caf", "sidebar_bg": "#fdf4ff", "sidebar_text": "#701a75", "accent": "#e879f9", "font": "Quicksand", "style": "light"},
        {"name": "Spa Retreat", "primary": "#0d9488", "secondary": "#0f766e", "sidebar_bg": "#f0fdfa", "sidebar_text": "#134e4a", "accent": "#2dd4bf", "font": "Cormorant Garamond", "style": "light"},
        {"name": "Modern Salon", "primary": "#e11d48", "secondary": "#be123c", "sidebar_bg": "#ffffff", "sidebar_text": "#1e293b", "accent": "#fb7185", "font": "Outfit", "style": "light"},
        {"name": "Men's Grooming", "primary": "#292524", "secondary": "#57534e", "sidebar_bg": "#1c1917", "sidebar_text": "#a8a29e", "accent": "#78716c", "font": "Montserrat", "style": "dark"},
    ],

    # ── CONSTRUCTION / TRADES ────────────────────────────────────────────
    "construction": [
        {"name": "Builder Pro", "primary": "#f59e0b", "secondary": "#d97706", "sidebar_bg": "#1c1917", "sidebar_text": "#fef3c7", "accent": "#fbbf24", "font": "Barlow", "style": "dark"},
        {"name": "Clean Contractor", "primary": "#1e40af", "secondary": "#1e3a8a", "sidebar_bg": "#ffffff", "sidebar_text": "#1e293b", "accent": "#3b82f6", "font": "Inter", "style": "light"},
        {"name": "Industrial", "primary": "#dc2626", "secondary": "#991b1b", "sidebar_bg": "#0a0a0a", "sidebar_text": "#fca5a5", "accent": "#ef4444", "font": "Oswald", "style": "dark"},
        {"name": "Green Build", "primary": "#15803d", "secondary": "#166534", "sidebar_bg": "#f0fdf4", "sidebar_text": "#14532d", "accent": "#22c55e", "font": "DM Sans", "style": "light"},
        {"name": "Plumbing HVAC", "primary": "#0369a1", "secondary": "#075985", "sidebar_bg": "#0c4a6e", "sidebar_text": "#bae6fd", "accent": "#0ea5e9", "font": "Rubik", "style": "dark"},
    ],

    # ── AUTOMOTIVE ────────────────────────────────────────────────────────
    "automotive": [
        {"name": "Dealership", "primary": "#1e3a8a", "secondary": "#1e40af", "sidebar_bg": "#0f172a", "sidebar_text": "#bfdbfe", "accent": "#3b82f6", "font": "Rajdhani", "style": "dark"},
        {"name": "Custom Shop", "primary": "#dc2626", "secondary": "#000000", "sidebar_bg": "#0a0a0a", "sidebar_text": "#fca5a5", "accent": "#ef4444", "font": "Bebas Neue", "style": "dark"},
        {"name": "Auto Service", "primary": "#f59e0b", "secondary": "#78716c", "sidebar_bg": "#ffffff", "sidebar_text": "#1c1917", "accent": "#fbbf24", "font": "Montserrat", "style": "light"},
        {"name": "EV Modern", "primary": "#059669", "secondary": "#0d9488", "sidebar_bg": "#f0fdf4", "sidebar_text": "#064e3b", "accent": "#10b981", "font": "Space Grotesk", "style": "light"},
        {"name": "Luxury Cars", "primary": "#000000", "secondary": "#262626", "sidebar_bg": "#000000", "sidebar_text": "#c9a96e", "accent": "#c9a96e", "font": "Playfair Display", "style": "dark"},
    ],

    # ── TECHNOLOGY / SAAS ────────────────────────────────────────────────
    "tech": [
        {"name": "Startup Vibrant", "primary": "#7c3aed", "secondary": "#6366f1", "sidebar_bg": "#0f172a", "sidebar_text": "#c4b5fd", "accent": "#8b5cf6", "font": "Space Grotesk", "style": "dark"},
        {"name": "Developer Dark", "primary": "#22c55e", "secondary": "#15803d", "sidebar_bg": "#09090b", "sidebar_text": "#86efac", "accent": "#4ade80", "font": "Fira Code", "style": "dark"},
        {"name": "Clean SaaS", "primary": "#2563eb", "secondary": "#1d4ed8", "sidebar_bg": "#ffffff", "sidebar_text": "#1e293b", "accent": "#3b82f6", "font": "Inter", "style": "light"},
        {"name": "AI/ML Platform", "primary": "#ec4899", "secondary": "#8b5cf6", "sidebar_bg": "#0a0015", "sidebar_text": "#f0abfc", "accent": "#d946ef", "font": "DM Sans", "style": "dark"},
        {"name": "DevOps Dashboard", "primary": "#06b6d4", "secondary": "#0891b2", "sidebar_bg": "#0f172a", "sidebar_text": "#a5f3fc", "accent": "#22d3ee", "font": "Roboto Mono", "style": "dark"},
        {"name": "Analytics", "primary": "#f97316", "secondary": "#ea580c", "sidebar_bg": "#fff7ed", "sidebar_text": "#431407", "accent": "#fb923c", "font": "Poppins", "style": "light"},
    ],

    # ── NONPROFIT / CHARITY ──────────────────────────────────────────────
    "nonprofit": [
        {"name": "Community Heart", "primary": "#dc2626", "secondary": "#b91c1c", "sidebar_bg": "#fff1f2", "sidebar_text": "#7f1d1d", "accent": "#f87171", "font": "Nunito", "style": "light"},
        {"name": "Green Mission", "primary": "#15803d", "secondary": "#166534", "sidebar_bg": "#f0fdf4", "sidebar_text": "#14532d", "accent": "#22c55e", "font": "DM Sans", "style": "light"},
        {"name": "Global Aid", "primary": "#0284c7", "secondary": "#0369a1", "sidebar_bg": "#0c4a6e", "sidebar_text": "#bae6fd", "accent": "#38bdf8", "font": "Lora", "style": "dark"},
        {"name": "Youth Program", "primary": "#7c3aed", "secondary": "#ec4899", "sidebar_bg": "#faf5ff", "sidebar_text": "#4c1d95", "accent": "#a78bfa", "font": "Quicksand", "style": "light"},
    ],

    # ── HOSPITALITY / HOTEL ──────────────────────────────────────────────
    "hospitality": [
        {"name": "Boutique Hotel", "primary": "#1e1b4b", "secondary": "#3730a3", "sidebar_bg": "#020617", "sidebar_text": "#c9a96e", "accent": "#c9a96e", "font": "Cormorant Garamond", "style": "dark"},
        {"name": "Beach Resort", "primary": "#0891b2", "secondary": "#06b6d4", "sidebar_bg": "#ecfeff", "sidebar_text": "#164e63", "accent": "#22d3ee", "font": "Lora", "style": "light"},
        {"name": "Mountain Lodge", "primary": "#78350f", "secondary": "#451a03", "sidebar_bg": "#1c1917", "sidebar_text": "#fed7aa", "accent": "#b45309", "font": "Merriweather", "style": "dark"},
        {"name": "Modern Hostel", "primary": "#ea580c", "secondary": "#c2410c", "sidebar_bg": "#fff7ed", "sidebar_text": "#431407", "accent": "#f97316", "font": "Poppins", "style": "light"},
        {"name": "Business Hotel", "primary": "#1e293b", "secondary": "#334155", "sidebar_bg": "#f8fafc", "sidebar_text": "#0f172a", "accent": "#6366f1", "font": "Inter", "style": "light"},
    ],

    # ── DEFAULT / GENERIC ────────────────────────────────────────────────
    "default": [
        {"name": "Indigo Pro", "primary": "#6366f1", "secondary": "#4f46e5", "sidebar_bg": "#0f172a", "sidebar_text": "#c7d2fe", "accent": "#818cf8", "font": "Inter", "style": "dark"},
        {"name": "Emerald Fresh", "primary": "#059669", "secondary": "#047857", "sidebar_bg": "#ffffff", "sidebar_text": "#064e3b", "accent": "#10b981", "font": "DM Sans", "style": "light"},
        {"name": "Slate Minimal", "primary": "#334155", "secondary": "#475569", "sidebar_bg": "#f8fafc", "sidebar_text": "#0f172a", "accent": "#64748b", "font": "Inter", "style": "light"},
        {"name": "Rose Warm", "primary": "#e11d48", "secondary": "#be123c", "sidebar_bg": "#fff1f2", "sidebar_text": "#881337", "accent": "#fb7185", "font": "Nunito", "style": "light"},
        {"name": "Amber Bold", "primary": "#d97706", "secondary": "#b45309", "sidebar_bg": "#1c1917", "sidebar_text": "#fef3c7", "accent": "#f59e0b", "font": "Montserrat", "style": "dark"},
        {"name": "Ocean Deep", "primary": "#0369a1", "secondary": "#075985", "sidebar_bg": "#0c4a6e", "sidebar_text": "#bae6fd", "accent": "#0ea5e9", "font": "Rubik", "style": "dark"},
        {"name": "Violet Dream", "primary": "#7e22ce", "secondary": "#6d28d9", "sidebar_bg": "#faf5ff", "sidebar_text": "#581c87", "accent": "#a855f7", "font": "Outfit", "style": "light"},
        {"name": "Carbon Dark", "primary": "#18181b", "secondary": "#27272a", "sidebar_bg": "#09090b", "sidebar_text": "#a1a1aa", "accent": "#f59e0b", "font": "Space Grotesk", "style": "dark"},
    ],
}

# ── Domain detection keywords ────────────────────────────────────────────────

DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "restaurant": ["restaurant", "food", "menu", "recipe", "kitchen", "chef", "dining", "cafe", "coffee", "bakery", "pizza", "sushi", "bar", "pub", "catering", "diner", "bistro", "grill", "bbq", "taco", "burger"],
    "medical": ["medical", "health", "clinic", "hospital", "doctor", "patient", "appointment", "pharmacy", "dental", "dentist", "therapy", "therapist", "nurse", "healthcare", "wellness", "mental health", "veterinary", "vet", "optometry"],
    "fitness": ["gym", "fitness", "workout", "exercise", "training", "crossfit", "yoga", "pilates", "boxing", "martial arts", "sport", "athletic", "personal trainer", "membership"],
    "real_estate": ["real estate", "property", "listing", "realtor", "apartment", "rental", "mortgage", "house", "home", "condo", "lease", "tenant", "landlord", "broker"],
    "ecommerce": ["ecommerce", "e-commerce", "shop", "store", "product", "cart", "order", "inventory", "retail", "marketplace", "selling", "merchandise", "catalog"],
    "education": ["education", "school", "university", "college", "course", "student", "teacher", "classroom", "learning", "training", "academy", "tutor", "curriculum", "grade"],
    "legal": ["legal", "law", "attorney", "lawyer", "case", "court", "paralegal", "litigation", "contract", "immigration", "criminal", "family law"],
    "beauty": ["salon", "beauty", "hair", "nail", "spa", "barber", "skincare", "cosmetic", "makeup", "grooming", "aesthetics", "massage"],
    "construction": ["construction", "contractor", "building", "plumbing", "hvac", "electrical", "roofing", "renovation", "landscaping", "painting", "handyman"],
    "automotive": ["automotive", "car", "vehicle", "dealership", "auto", "mechanic", "repair", "garage", "tire", "detailing", "fleet"],
    "tech": ["tech", "software", "saas", "startup", "developer", "api", "platform", "analytics", "dashboard", "ai", "machine learning", "devops", "cloud"],
    "nonprofit": ["nonprofit", "charity", "donation", "volunteer", "ngo", "foundation", "community", "fundraising", "mission"],
    "hospitality": ["hotel", "hostel", "resort", "lodging", "booking", "accommodation", "hospitality", "travel", "tourism", "airbnb", "guest"],
}


def detect_domain(prompt: str) -> str:
    """Detect the business domain from a user prompt."""
    lower = prompt.lower()
    scores: dict[str, int] = {}
    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in lower)
        if score > 0:
            scores[domain] = score
    if not scores:
        return "default"
    return max(scores, key=scores.get)  # type: ignore


def get_palette(prompt: str) -> dict[str, str]:
    """Get a random palette matching the detected domain."""
    domain = detect_domain(prompt)
    palettes = PALETTES.get(domain, PALETTES["default"])
    return random.choice(palettes)


def get_palette_context(prompt: str) -> str:
    """Build a design context string for the AI system prompt.

    Shows 3 palette options from the detected domain so Claude can pick
    the best fit or mix elements.
    """
    domain = detect_domain(prompt)
    palettes = PALETTES.get(domain, PALETTES["default"])

    # Pick 3 random palettes from the domain
    samples = random.sample(palettes, min(3, len(palettes)))

    lines = [f"Detected domain: {domain.replace('_', ' ').title()}", ""]
    lines.append("Suggested design palettes (pick one or mix elements):")
    for p in samples:
        lines.append(f"  - {p['name']}: primary={p['primary']}, sidebar_bg={p['sidebar_bg']}, font={p['font']}, style={p['style']}")

    lines.append("")
    lines.append("You may also create your own palette that fits the specific business described.")
    lines.append("The key is: make the design MATCH the industry and feel unique.")

    return "\n".join(lines)
