"""Industry compliance fields — auto-detect domain and inject required regulatory fields."""
from __future__ import annotations

import re
import logging

logger = logging.getLogger(__name__)

COMPLIANCE_FIELDS = {
    "medical": [
        {"name": "hipaa_consent", "db_type": "BOOLEAN", "description": "HIPAA consent obtained"},
        {"name": "insurance_provider", "db_type": "VARCHAR(255)", "description": "Insurance company"},
        {"name": "insurance_id", "db_type": "VARCHAR(100)", "description": "Insurance policy number"},
        {"name": "emergency_contact", "db_type": "VARCHAR(255)", "description": "Emergency contact info"},
        {"name": "blood_type", "db_type": "VARCHAR(5)", "description": "Patient blood type"},
        {"name": "allergies", "db_type": "TEXT", "description": "Known allergies"},
    ],
    "financial": [
        {"name": "audit_trail", "db_type": "JSONB", "description": "Change history for compliance"},
        {"name": "approved_by", "db_type": "UUID", "description": "Approver reference"},
        {"name": "approval_date", "db_type": "TIMESTAMPTZ", "description": "Date of approval"},
        {"name": "tax_id", "db_type": "VARCHAR(50)", "description": "Tax identification number"},
    ],
    "food": [
        {"name": "allergens", "db_type": "TEXT", "description": "Allergen information (comma-separated)"},
        {"name": "nutritional_info", "db_type": "JSONB", "description": "Calories, fat, protein, etc."},
        {"name": "dietary_tags", "db_type": "VARCHAR(255)", "description": "Vegan, gluten-free, halal, etc."},
        {"name": "expiry_date", "db_type": "DATE", "description": "Product expiration date"},
    ],
    "childcare": [
        {"name": "guardian_name", "db_type": "VARCHAR(255)", "description": "Parent/guardian name"},
        {"name": "guardian_phone", "db_type": "VARCHAR(20)", "description": "Emergency contact phone"},
        {"name": "medical_conditions", "db_type": "TEXT", "description": "Known medical conditions"},
        {"name": "pickup_authorized", "db_type": "TEXT", "description": "Authorized pickup persons"},
        {"name": "photo_consent", "db_type": "BOOLEAN", "description": "Photo/video consent"},
    ],
    "legal": [
        {"name": "case_number", "db_type": "VARCHAR(50)", "description": "Court case reference"},
        {"name": "confidentiality_level", "db_type": "VARCHAR(20)", "description": "Confidential/Public/Restricted"},
        {"name": "statute_of_limitations", "db_type": "DATE", "description": "Filing deadline"},
        {"name": "jurisdiction", "db_type": "VARCHAR(100)", "description": "Legal jurisdiction"},
    ],
    "real_estate": [
        {"name": "mls_number", "db_type": "VARCHAR(20)", "description": "MLS listing number"},
        {"name": "zoning", "db_type": "VARCHAR(50)", "description": "Zoning classification"},
        {"name": "year_built", "db_type": "INTEGER", "description": "Year constructed"},
        {"name": "property_tax", "db_type": "NUMERIC(12,2)", "description": "Annual property tax"},
        {"name": "hoa_fee", "db_type": "NUMERIC(10,2)", "description": "Monthly HOA fee"},
    ],
}

# Keywords that map to each compliance domain
_DOMAIN_KEYWORDS = {
    "medical": [
        "medical", "clinic", "hospital", "doctor", "patient", "healthcare",
        "health care", "dental", "pharmacy", "therapist", "veterinary", "vet",
        "optometry", "chiropractic", "psychiatr", "mental health",
    ],
    "financial": [
        "financial", "accounting", "bank", "investment", "loan", "mortgage",
        "insurance", "tax", "audit", "bookkeeping", "payroll", "fintech",
    ],
    "food": [
        "restaurant", "food", "catering", "bakery", "cafe", "coffee",
        "pizza", "kitchen", "menu", "dining", "food truck", "meal",
        "grocery", "deli", "bar", "brewery", "winery",
    ],
    "childcare": [
        "childcare", "daycare", "preschool", "nursery", "kindergarten",
        "after school", "child care", "babysit", "nanny", "kids",
        "pediatric", "tutoring children",
    ],
    "legal": [
        "legal", "law firm", "attorney", "lawyer", "court", "litigation",
        "paralegal", "notary", "contract", "compliance",
    ],
    "real_estate": [
        "real estate", "property", "realty", "housing", "apartment",
        "rental", "landlord", "tenant", "listing", "broker", "realtor",
        "mortgage", "mls",
    ],
}


def _detect_domain(prompt: str) -> str | None:
    """Detect which compliance domain the prompt falls into."""
    prompt_lower = prompt.lower()
    for domain, keywords in _DOMAIN_KEYWORDS.items():
        for kw in keywords:
            if kw in prompt_lower:
                logger.info("Detected compliance domain: %s (keyword: %s)", domain, kw)
                return domain
    return None


def get_compliance_context(prompt: str) -> str:
    """Detect the domain and return compliance fields to inject into the AI prompt."""
    domain = _detect_domain(prompt)
    if not domain:
        return ""
    fields = COMPLIANCE_FIELDS[domain]
    lines = [f"This is a {domain} application. Include these compliance/regulatory fields on the relevant entities:"]
    for f in fields:
        lines.append(f"- {f['name']} ({f['db_type']}): {f['description']}")
    return "\n".join(lines)
