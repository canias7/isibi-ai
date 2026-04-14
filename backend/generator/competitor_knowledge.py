"""Competitor product knowledge — detect "like Shopify" patterns and inject context."""
from __future__ import annotations

import re
import logging

logger = logging.getLogger(__name__)

COMPETITOR_PRODUCTS = {
    "shopify": {"entities": ["Product", "Collection", "Order", "Customer", "Discount", "Inventory"], "features": ["cart", "checkout", "shipping_rates", "tax_calculation", "product_variants"]},
    "toast": {"entities": ["MenuItem", "Order", "Table", "Server", "Payment", "Kitchen"], "features": ["pos", "table_management", "kitchen_display", "tip_management", "split_checks"]},
    "salesforce": {"entities": ["Lead", "Contact", "Account", "Opportunity", "Task", "Campaign"], "features": ["pipeline_management", "lead_scoring", "email_tracking", "forecasting"]},
    "mindbody": {"entities": ["Client", "Class", "Instructor", "Membership", "Booking", "Payment"], "features": ["class_scheduling", "online_booking", "membership_management", "attendance_tracking"]},
    "square": {"entities": ["Item", "Order", "Customer", "Payment", "Employee", "Timecard"], "features": ["pos", "inventory", "employee_management", "payroll", "loyalty"]},
    "quickbooks": {"entities": ["Invoice", "Customer", "Expense", "Payment", "Account", "TaxRate"], "features": ["invoicing", "expense_tracking", "tax_calculation", "bank_reconciliation", "profit_loss"]},
    "trello": {"entities": ["Board", "List", "Card", "Member", "Label", "Checklist"], "features": ["kanban_board", "drag_drop", "due_dates", "checklists", "labels"]},
    "asana": {"entities": ["Project", "Task", "Section", "Team", "Goal", "Portfolio"], "features": ["project_timeline", "workload_management", "custom_fields", "automations"]},
    "calendly": {"entities": ["EventType", "Booking", "Availability", "Client", "Team"], "features": ["scheduling_links", "buffer_times", "round_robin", "timezone_detection"]},
    "stripe": {"entities": ["Customer", "Subscription", "Invoice", "Payment", "Product", "Price"], "features": ["recurring_billing", "usage_metering", "proration", "tax_automation"]},
    "hubspot": {"entities": ["Contact", "Company", "Deal", "Ticket", "Task", "Email"], "features": ["crm_pipeline", "email_sequences", "meeting_scheduler", "live_chat"]},
    "zendesk": {"entities": ["Ticket", "Customer", "Agent", "Group", "Article", "Macro"], "features": ["ticket_routing", "sla_management", "knowledge_base", "satisfaction_survey"]},
    "notion": {"entities": ["Page", "Database", "Block", "Workspace", "Template"], "features": ["nested_pages", "database_views", "templates", "team_collaboration"]},
    "airtable": {"entities": ["Base", "Table", "View", "Record", "Field", "Automation"], "features": ["linked_records", "rollup_fields", "form_views", "automations"]},
    "opentable": {"entities": ["Restaurant", "Reservation", "Table", "Guest", "Review", "Waitlist"], "features": ["online_reservations", "table_management", "guest_profiles", "waitlist"]},
    "docusign": {"entities": ["Document", "Envelope", "Signer", "Template", "Audit"], "features": ["e_signatures", "templates", "bulk_send", "audit_trail"]},
    "mailchimp": {"entities": ["Contact", "Campaign", "Template", "List", "Automation", "Report"], "features": ["email_campaigns", "automation_workflows", "audience_segmentation", "analytics"]},
    "freshbooks": {"entities": ["Client", "Invoice", "Expense", "TimeEntry", "Project", "Payment"], "features": ["time_tracking", "invoicing", "expense_management", "project_budgets"]},
    "wix": {"entities": ["Page", "Product", "Order", "Member", "Booking", "Blog"], "features": ["drag_drop_builder", "ecommerce", "bookings", "blog", "member_area"]},
    "zoho": {"entities": ["Lead", "Contact", "Deal", "Account", "Task", "Invoice"], "features": ["crm", "invoicing", "project_management", "email", "analytics"]},
}

# Patterns to detect competitor references in user prompts
_PATTERNS = [
    r"\blike\s+(\w+)\b",
    r"\bsimilar\s+to\s+(\w+)\b",
    r"\b(\w+)\s+alternative\b",
    r"\b(\w+)\s+clone\b",
    r"\b(\w+)\s+replacement\b",
    r"\b(\w+)[- ]style\b",
]


def detect_competitor(prompt: str) -> dict | None:
    """Scan the prompt for 'like X', 'similar to X', 'X alternative' patterns and return matching product info."""
    prompt_lower = prompt.lower()
    for pattern in _PATTERNS:
        match = re.search(pattern, prompt_lower)
        if match:
            name = match.group(1).strip()
            if name in COMPETITOR_PRODUCTS:
                logger.info("Detected competitor reference: %s", name)
                return {"name": name, **COMPETITOR_PRODUCTS[name]}
    # Also do a simple keyword scan for product names mentioned anywhere
    for name, info in COMPETITOR_PRODUCTS.items():
        if name in prompt_lower:
            logger.info("Detected competitor mention: %s", name)
            return {"name": name, **info}
    return None


def get_competitor_context(prompt: str) -> str:
    """Return a formatted string for the AI prompt with the competitor's entities and features."""
    competitor = detect_competitor(prompt)
    if not competitor:
        return ""
    name = competitor["name"].title()
    entities = ", ".join(competitor["entities"])
    features = ", ".join(f.replace("_", " ") for f in competitor["features"])
    return (
        f"The user referenced {name}. This product typically has these core entities: {entities}.\n"
        f"Key features include: {features}.\n"
        f"Use these as inspiration — include equivalent entities and features, but tailor them to the user's specific business."
    )
