#!/usr/bin/env python3
"""
Enrich the 100 thinnest spec files to production quality.

Reads each file, adds missing metadata (fields, validations, relationships,
dashboard cards, views, filters, etc.), then writes back.
"""

import json
import os
import re
import copy
from collections import defaultdict

SPEC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spec")
SYSTEM_FIELDS = {"id", "org_id", "created_at", "updated_at", "deleted_at", "version"}

BADGE_PALETTE = ["pink", "blue", "green", "amber", "purple", "red", "slate", "emerald",
                 "cyan", "orange", "indigo", "teal", "rose", "lime", "sky", "violet"]

SIDEBAR_ICONS = [
    "Box", "Users", "Package", "Briefcase", "ShoppingCart", "Calendar",
    "ClipboardList", "FileText", "Settings", "Tag", "Truck", "Wrench",
    "DollarSign", "Building", "MapPin", "Star", "Heart", "Zap",
    "BarChart", "CheckSquare", "Layers", "BookOpen", "Globe", "Shield"
]

# ─── Domain-appropriate extra fields keyed by common entity name fragments ────

DOMAIN_FIELDS = {
    # People / contacts
    "customer": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "address", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "client": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "company", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "patient": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "date_of_birth", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "address", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "member": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "joined_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
    ],
    "contact": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "company", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
    "employee": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "hire_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "department", "db_type": "VARCHAR(100)", "input_component": "text_input", "display_component": "text"},
    ],
    "staff": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "role", "db_type": "VARCHAR(100)", "input_component": "text_input", "display_component": "text"},
    ],
    "user": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
    ],
    "vendor": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "website", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "address", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "supplier": [
        {"name": "email", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "website", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
    # Work items
    "job": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "scheduled_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "priority", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
         "enum_values": ["low", "medium", "high", "urgent"],
         "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "task": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "due_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "priority", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
         "enum_values": ["low", "medium", "high", "urgent"],
         "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
        {"name": "assigned_to", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
    "ticket": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "priority", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
         "enum_values": ["low", "medium", "high", "urgent"],
         "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
        {"name": "assigned_to", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
    "request": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "requested_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "priority", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
         "enum_values": ["low", "medium", "high", "urgent"],
         "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
    ],
    "order": [
        {"name": "quantity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "total", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
        {"name": "order_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "booking": [
        {"name": "booking_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "start_time", "db_type": "TIME", "input_component": "text_input", "display_component": "text"},
        {"name": "end_time", "db_type": "TIME", "input_component": "text_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "appointment": [
        {"name": "appointment_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "start_time", "db_type": "TIME", "input_component": "text_input", "display_component": "text"},
        {"name": "duration_minutes", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "reservation": [
        {"name": "reservation_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "party_size", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "inspection": [
        {"name": "inspection_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "inspector", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "findings", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "invoice": [
        {"name": "invoice_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "due_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "total", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "payment": [
        {"name": "payment_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "amount", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
        {"name": "method", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
         "enum_values": ["cash", "card", "bank_transfer", "check"],
         "badge_colors": {"cash": "green", "card": "blue", "bank_transfer": "purple", "check": "amber"}},
    ],
    "project": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "start_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "end_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "budget", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    # Service items
    "service": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "duration_minutes", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "price", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    # Products / items / inventory
    "product": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "sku", "db_type": "VARCHAR(100)", "input_component": "text_input", "display_component": "text"},
        {"name": "quantity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "price", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    "item": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "quantity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "price", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    "equipment": [
        {"name": "serial_number", "db_type": "VARCHAR(100)", "input_component": "text_input", "display_component": "text"},
        {"name": "purchase_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "location", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "vehicle": [
        {"name": "license_plate", "db_type": "VARCHAR(20)", "input_component": "text_input", "display_component": "text"},
        {"name": "vin", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "year", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "mileage", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
    ],
    # Locations / properties
    "location": [
        {"name": "address", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "city", "db_type": "VARCHAR(100)", "input_component": "text_input", "display_component": "text"},
        {"name": "phone", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "capacity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
    ],
    "property": [
        {"name": "address", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "square_feet", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "price", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    "room": [
        {"name": "capacity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "floor", "db_type": "VARCHAR(50)", "input_component": "text_input", "display_component": "text"},
        {"name": "rate", "db_type": "NUMERIC(10,2)", "input_component": "number_input", "display_component": "text"},
    ],
    # Events
    "event": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "event_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "location", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "capacity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
    ],
    "class": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "schedule", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "instructor", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
        {"name": "capacity", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
    ],
    "session": [
        {"name": "session_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "duration_minutes", "db_type": "INTEGER", "input_component": "number_input", "display_component": "text"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    # Reports / records
    "report": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "report_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "author", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
    "record": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "record_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    ],
    "log": [
        {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
        {"name": "log_date", "db_type": "DATE", "input_component": "date_picker", "display_component": "date"},
        {"name": "logged_by", "db_type": "VARCHAR(255)", "input_component": "text_input", "display_component": "text"},
    ],
}

# Generic fallback fields for any entity
GENERIC_EXTRA_FIELDS = [
    {"name": "description", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    {"name": "notes", "db_type": "TEXT", "input_component": "textarea", "display_component": "text"},
    {"name": "priority", "db_type": "VARCHAR(50)", "input_component": "select", "display_component": "status_badge",
     "enum_values": ["low", "medium", "high", "urgent"],
     "badge_colors": {"low": "slate", "medium": "blue", "high": "amber", "urgent": "red"}},
]

# Validation patterns
VALIDATIONS = {
    "email": {"pattern": r"^[^@]+@[^@]+\.[^@]+$", "message": "Enter a valid email address"},
    "phone": {"pattern": r"^\+?[\d\s\-\(\)]{7,20}$", "message": "Enter a valid phone number"},
    "price": {"min": 0, "message": "Price must be a positive number"},
    "total": {"min": 0, "message": "Total must be a positive number"},
    "amount": {"min": 0, "message": "Amount must be a positive number"},
    "budget": {"min": 0, "message": "Budget must be a positive number"},
    "rate": {"min": 0, "message": "Rate must be a positive number"},
    "cost": {"min": 0, "message": "Cost must be a positive number"},
    "fee": {"min": 0, "message": "Fee must be a positive number"},
    "quantity": {"min": 0, "message": "Quantity must be a positive number"},
    "capacity": {"min": 1, "message": "Capacity must be at least 1"},
    "duration_minutes": {"min": 1, "message": "Duration must be at least 1 minute"},
    "party_size": {"min": 1, "message": "Party size must be at least 1"},
    "mileage": {"min": 0, "message": "Mileage must be a positive number"},
    "square_feet": {"min": 1, "message": "Square feet must be positive"},
    "pieces": {"min": 1, "message": "Must be at least 1"},
    "weight": {"min": 0, "message": "Weight must be positive"},
}

# Placeholder / help text for common fields
FIELD_HINTS = {
    "name": {"placeholder": "Enter name", "help_text": "Full name"},
    "email": {"placeholder": "email@example.com", "help_text": "Primary email address"},
    "phone": {"placeholder": "+1 (555) 000-0000", "help_text": "Contact phone number"},
    "address": {"placeholder": "Street, City, State, ZIP", "help_text": "Full mailing address"},
    "description": {"placeholder": "Enter description...", "help_text": "Brief description"},
    "notes": {"placeholder": "Additional notes...", "help_text": "Internal notes (not visible to customers)"},
    "price": {"placeholder": "0.00", "help_text": "Price in USD"},
    "total": {"placeholder": "0.00", "help_text": "Total amount in USD"},
    "amount": {"placeholder": "0.00", "help_text": "Amount in USD"},
    "budget": {"placeholder": "0.00", "help_text": "Budget in USD"},
    "rate": {"placeholder": "0.00", "help_text": "Rate in USD"},
    "cost": {"placeholder": "0.00", "help_text": "Cost in USD"},
    "quantity": {"placeholder": "1", "help_text": "Number of units"},
    "sku": {"placeholder": "SKU-001", "help_text": "Stock keeping unit identifier"},
    "serial_number": {"placeholder": "SN-XXXXXX", "help_text": "Manufacturer serial number"},
    "website": {"placeholder": "https://example.com", "help_text": "Website URL"},
    "company": {"placeholder": "Company name", "help_text": "Organization or company name"},
    "department": {"placeholder": "e.g. Engineering", "help_text": "Department name"},
    "location": {"placeholder": "e.g. Building A, Room 101", "help_text": "Physical location"},
    "city": {"placeholder": "e.g. San Francisco", "help_text": "City name"},
    "assigned_to": {"placeholder": "e.g. John Smith", "help_text": "Person responsible"},
    "inspector": {"placeholder": "Inspector name", "help_text": "Name of inspector"},
    "instructor": {"placeholder": "Instructor name", "help_text": "Name of instructor"},
    "author": {"placeholder": "Author name", "help_text": "Report author"},
    "logged_by": {"placeholder": "Logger name", "help_text": "Person who logged this"},
    "license_plate": {"placeholder": "e.g. ABC-1234", "help_text": "Vehicle license plate"},
    "vin": {"placeholder": "17-character VIN", "help_text": "Vehicle identification number"},
    "customer": {"placeholder": "Customer name", "help_text": "Customer full name"},
    "title": {"placeholder": "Enter title", "help_text": "Short descriptive title"},
    "findings": {"placeholder": "Describe findings...", "help_text": "Inspection findings and observations"},
}

# FK relationship patterns: if entity A name contains key, link to entity B name containing value
FK_LINK_PATTERNS = [
    # (child_entity_pattern, parent_entity_pattern, fk_field_name)
    ("job", "customer", "customer_id"),
    ("job", "client", "client_id"),
    ("order", "customer", "customer_id"),
    ("order", "client", "client_id"),
    ("booking", "customer", "customer_id"),
    ("booking", "client", "client_id"),
    ("booking", "room", "room_id"),
    ("booking", "service", "service_id"),
    ("appointment", "customer", "customer_id"),
    ("appointment", "client", "client_id"),
    ("appointment", "patient", "patient_id"),
    ("invoice", "customer", "customer_id"),
    ("invoice", "client", "client_id"),
    ("invoice", "order", "order_id"),
    ("invoice", "job", "job_id"),
    ("payment", "invoice", "invoice_id"),
    ("payment", "customer", "customer_id"),
    ("payment", "order", "order_id"),
    ("ticket", "customer", "customer_id"),
    ("ticket", "client", "client_id"),
    ("request", "customer", "customer_id"),
    ("request", "client", "client_id"),
    ("session", "client", "client_id"),
    ("session", "customer", "customer_id"),
    ("session", "patient", "patient_id"),
    ("session", "member", "member_id"),
    ("inspection", "property", "property_id"),
    ("inspection", "equipment", "equipment_id"),
    ("inspection", "vehicle", "vehicle_id"),
    ("task", "project", "project_id"),
    ("report", "project", "project_id"),
    ("record", "patient", "patient_id"),
    ("record", "member", "member_id"),
    ("log", "equipment", "equipment_id"),
    ("log", "vehicle", "vehicle_id"),
    ("reservation", "customer", "customer_id"),
    ("reservation", "room", "room_id"),
    ("event", "location", "location_id"),
    ("class", "instructor", "instructor_id"),
]


# ─── Helper functions ─────────────────────────────────────────────────────────

def get_custom_fields(entity):
    """Return non-system fields."""
    return [f for f in entity["fields"] if f["name"] not in SYSTEM_FIELDS]


def get_field_names(entity):
    """Return set of all field names."""
    return {f["name"] for f in entity["fields"]}


def entity_name_lower(entity):
    """Lowercase entity name for matching."""
    return entity["name"].lower().replace(" ", "_")


def make_full_field(base, existing_field_names):
    """Create a complete field dict from a partial template."""
    if base["name"] in existing_field_names:
        return None
    field = {
        "name": base["name"],
        "db_type": base.get("db_type", "VARCHAR(255)"),
        "ts_type": "string",
        "nullable": True,
        "editable": True,
        "show_in_table": True,
        "show_in_form": True,
        "input_component": base.get("input_component", "text_input"),
        "display_component": base.get("display_component", "text"),
    }
    if "enum_values" in base:
        field["enum_values"] = base["enum_values"]
    if "badge_colors" in base:
        field["badge_colors"] = base["badge_colors"]
    return field


def make_fk_field(fk_name, parent_entity):
    """Create a foreign key field."""
    return {
        "name": fk_name,
        "db_type": "UUID",
        "ts_type": "string",
        "nullable": True,
        "editable": True,
        "show_in_table": True,
        "show_in_form": True,
        "input_component": "relation_picker",
        "display_component": "relation_link",
        "foreign_key": {
            "table": parent_entity["table"],
            "column": "id",
            "display_column": _guess_display_column(parent_entity)
        }
    }


def _guess_display_column(entity):
    """Guess which column to display for a related entity."""
    names = get_field_names(entity)
    for candidate in ["name", "title", "customer", "client", "label", "subject"]:
        if candidate in names:
            return candidate
    # Fall back to first custom field
    custom = get_custom_fields(entity)
    return custom[0]["name"] if custom else "id"


def assign_badge_colors(enum_values):
    """Assign badge colors to enum values."""
    colors = {}
    for i, val in enumerate(enum_values):
        colors[val] = BADGE_PALETTE[i % len(BADGE_PALETTE)]
    return colors


def find_status_field(entity):
    """Find the status enum field, if any."""
    for f in entity["fields"]:
        if f["name"] == "status" and f.get("enum_values"):
            return f
    return None


def find_enum_fields(entity):
    """Find all enum fields."""
    return [f for f in entity["fields"] if f.get("enum_values")]


def find_date_fields(entity):
    """Find all date/datetime fields (excluding system fields)."""
    return [f for f in entity["fields"]
            if f["name"] not in SYSTEM_FIELDS
            and ("DATE" in f.get("db_type", "") or "date" in f["name"])]


def find_price_fields(entity):
    """Find numeric/price fields."""
    return [f for f in entity["fields"]
            if f["name"] not in SYSTEM_FIELDS
            and ("NUMERIC" in f.get("db_type", "") or f["name"] in ("price", "total", "amount", "cost", "fee", "rate", "budget"))]


# ─── Scoring function ─────────────────────────────────────────────────────────

def score_spec(spec):
    """Score a spec — lower = thinner. Returns (score, details)."""
    score = 0
    entities = spec.get("entities", [])
    total_custom = 0
    has_fk = False
    has_validation = False
    has_views = False
    has_quick_filters = False
    has_searchable = False
    has_row_actions = False
    has_computed = False
    num_dashboard_cards = len(spec.get("dashboard", {}).get("stat_cards", []))

    for entity in entities:
        custom = get_custom_fields(entity)
        total_custom += len(custom)
        for f in entity["fields"]:
            if "foreign_key" in f:
                has_fk = True
            if "validation" in f:
                has_validation = True
            if "computed" in f:
                has_computed = True
        ui = entity.get("ui_config", {})
        lv = ui.get("list_view", {})
        if lv.get("views"):
            has_views = True
        if lv.get("quick_filters"):
            has_quick_filters = True
        if lv.get("searchable_fields"):
            has_searchable = True
        if lv.get("row_actions"):
            has_row_actions = True

    score = total_custom * 3
    if has_fk: score += 15
    if has_validation: score += 10
    if has_views: score += 8
    if has_quick_filters: score += 5
    if has_searchable: score += 5
    if has_row_actions: score += 5
    if has_computed: score += 10
    score += num_dashboard_cards * 3

    return score


# ─── Enrichment functions ─────────────────────────────────────────────────────

def enrich_fields(entity):
    """Add domain-appropriate fields if entity has < 5 custom fields."""
    custom = get_custom_fields(entity)
    if len(custom) >= 5:
        return 0

    existing_names = get_field_names(entity)
    ename = entity_name_lower(entity)
    added = 0

    # Find matching domain fields
    fields_to_add = []
    for pattern, domain_fields in DOMAIN_FIELDS.items():
        if pattern in ename:
            for df in domain_fields:
                field = make_full_field(df, existing_names)
                if field:
                    fields_to_add.append(field)
                    existing_names.add(field["name"])

    # If still not enough, add generic fields
    if len(custom) + len(fields_to_add) < 5:
        for gf in GENERIC_EXTRA_FIELDS:
            if len(custom) + len(fields_to_add) >= 5:
                break
            field = make_full_field(gf, existing_names)
            if field:
                fields_to_add.append(field)
                existing_names.add(field["name"])

    # Insert before system fields (created_at, updated_at, etc.)
    insert_idx = len(entity["fields"])
    for i, f in enumerate(entity["fields"]):
        if f["name"] in ("created_at", "updated_at", "deleted_at", "version"):
            insert_idx = i
            break

    for field in fields_to_add:
        entity["fields"].insert(insert_idx, field)
        insert_idx += 1
        added += 1

    return added


def enrich_fk_relationships(spec):
    """Add FK relationships between entities where logical."""
    entities = spec.get("entities", [])
    entity_map = {entity_name_lower(e): e for e in entities}
    added = 0

    for child_pattern, parent_pattern, fk_name in FK_LINK_PATTERNS:
        for ename, entity in entity_map.items():
            if child_pattern not in ename:
                continue
            existing_names = get_field_names(entity)
            if fk_name in existing_names:
                continue
            # Find parent
            for pname, pentity in entity_map.items():
                if parent_pattern in pname and pname != ename:
                    fk_field = make_fk_field(fk_name, pentity)
                    # Insert after org_id
                    insert_idx = 2
                    for i, f in enumerate(entity["fields"]):
                        if f["name"] == "org_id":
                            insert_idx = i + 1
                            break
                    entity["fields"].insert(insert_idx, fk_field)
                    # Update ui_config
                    _add_field_to_ui(entity, fk_name)
                    added += 1
                    break

    return added


def enrich_validations(entity):
    """Add validation rules to email, phone, price fields."""
    added = 0
    for f in entity["fields"]:
        if f["name"] in VALIDATIONS and "validation" not in f:
            f["validation"] = VALIDATIONS[f["name"]]
            added += 1
    return added


def enrich_computed_fields(entity):
    """Add computed fields where logical (totals, full names)."""
    existing = get_field_names(entity)
    custom = get_custom_fields(entity)
    added = 0

    # If has quantity and price but no total, add computed total
    if "quantity" in existing and "price" in existing and "total" not in existing:
        insert_idx = _find_insert_idx(entity)
        entity["fields"].insert(insert_idx, {
            "name": "total",
            "db_type": "NUMERIC(10,2)",
            "ts_type": "string",
            "nullable": True,
            "editable": False,
            "show_in_table": True,
            "show_in_form": False,
            "input_component": "none",
            "display_component": "text",
            "computed": {"formula": "quantity * price", "dependencies": ["quantity", "price"]}
        })
        _add_field_to_ui(entity, "total")
        added += 1

    # If has first_name and last_name but no full_name
    if "first_name" in existing and "last_name" in existing and "full_name" not in existing:
        insert_idx = _find_insert_idx(entity)
        entity["fields"].insert(insert_idx, {
            "name": "full_name",
            "db_type": "VARCHAR(255)",
            "ts_type": "string",
            "nullable": True,
            "editable": False,
            "show_in_table": True,
            "show_in_form": False,
            "input_component": "none",
            "display_component": "text",
            "computed": {"formula": "first_name || ' ' || last_name", "dependencies": ["first_name", "last_name"]}
        })
        _add_field_to_ui(entity, "full_name")
        added += 1

    return added


def enrich_badge_colors(entity):
    """Add badge_colors to all enum fields that don't have them."""
    added = 0
    for f in entity["fields"]:
        if f.get("enum_values") and not f.get("badge_colors"):
            f["badge_colors"] = assign_badge_colors(f["enum_values"])
            f["display_component"] = "status_badge"
            added += 1
    return added


def enrich_views(entity):
    """Add views array to list_view (table + kanban/calendar)."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    if lv.get("views"):
        return 0

    views = [{"name": "Table", "layout": "table"}]

    status_field = find_status_field(entity)
    date_fields = find_date_fields(entity)

    if status_field:
        views.append({
            "name": "Board",
            "layout": "kanban",
            "group_by": "status"
        })

    if date_fields:
        date_field = date_fields[0]
        views.append({
            "name": "Calendar",
            "layout": "calendar",
            "date_field": date_field["name"]
        })

    lv["views"] = views
    return 1


def enrich_quick_filters(entity):
    """Add quick_filters for status enum fields."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    if lv.get("quick_filters"):
        return 0

    status_field = find_status_field(entity)
    if not status_field:
        return 0

    lv["quick_filters"] = [
        {"field": "status", "label": "Status", "options": status_field["enum_values"]}
    ]

    # Also add priority quick filter if exists
    for f in entity["fields"]:
        if f["name"] == "priority" and f.get("enum_values"):
            lv["quick_filters"].append(
                {"field": "priority", "label": "Priority", "options": f["enum_values"]}
            )
            break

    return 1


def enrich_default_sort(entity):
    """Add default_sort."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    if lv.get("default_sort"):
        return 0

    lv["default_sort"] = {"field": "created_at", "direction": "desc"}
    return 1


def enrich_searchable_fields(entity):
    """Add searchable_fields."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    if lv.get("searchable_fields"):
        return 0

    searchable = []
    for f in get_custom_fields(entity):
        if f["name"] in ("name", "title", "customer", "client", "email",
                         "phone", "description", "company", "address",
                         "subject", "label", "sku", "serial_number",
                         "license_plate", "vin"):
            searchable.append(f["name"])
        elif f.get("input_component") == "text_input" and "VARCHAR" in f.get("db_type", ""):
            searchable.append(f["name"])

    if not searchable:
        # Use first text field
        for f in get_custom_fields(entity):
            if f.get("input_component") == "text_input":
                searchable.append(f["name"])
                break

    if searchable:
        lv["searchable_fields"] = searchable[:5]
        return 1
    return 0


def enrich_row_actions(entity):
    """Add row_actions for entities with status fields."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    if lv.get("row_actions"):
        return 0

    status_field = find_status_field(entity)
    actions = [
        {"name": "Edit", "icon": "Pencil", "action": "edit"},
        {"name": "View", "icon": "Eye", "action": "view"},
    ]

    if status_field:
        enum_vals = status_field.get("enum_values", [])
        # Add status transition actions for the last status (usually "done"/"completed")
        terminal_states = [v for v in enum_vals if v in
                           ("done", "completed", "closed", "cancelled", "archived",
                            "finished", "resolved", "paid", "delivered", "approved")]
        if terminal_states:
            actions.append({
                "name": f"Mark {terminal_states[0].replace('_', ' ').title()}",
                "icon": "CheckCircle",
                "action": "update_status",
                "value": terminal_states[0]
            })

    actions.append({"name": "Delete", "icon": "Trash2", "action": "delete", "confirm": True})

    lv["row_actions"] = actions
    return 1


def enrich_dashboard(spec):
    """Add dashboard.stat_cards with 3-4 smart cards."""
    dashboard = spec.get("dashboard", {})
    existing_cards = dashboard.get("stat_cards", [])

    if len(existing_cards) >= 3:
        return 0

    entities = spec.get("entities", [])
    cards = []
    used_combos = {(c.get("entity"), c.get("method")) for c in existing_cards}

    for entity in entities:
        ename = entity["name"]

        # Total count card
        if (ename, "count") not in used_combos:
            cards.append({
                "label": f"Total {ename}s",
                "entity": ename,
                "method": "count",
                "icon": "Hash",
                "color": "blue"
            })
            used_combos.add((ename, "count"))

        # Status-based cards
        status_field = find_status_field(entity)
        if status_field:
            enum_vals = status_field.get("enum_values", [])
            active_states = [v for v in enum_vals if v in
                             ("active", "in_progress", "printing", "open", "pending",
                              "scheduled", "booked", "confirmed", "processing")]
            if active_states and (ename, "count_where_active") not in used_combos:
                cards.append({
                    "label": f"Active {ename}s",
                    "entity": ename,
                    "method": "count",
                    "filter": {"field": "status", "value": active_states[0]},
                    "icon": "Activity",
                    "color": "green"
                })
                used_combos.add((ename, "count_where_active"))

            completed_states = [v for v in enum_vals if v in
                                ("done", "completed", "closed", "finished", "resolved",
                                 "paid", "delivered", "approved")]
            if completed_states and (ename, "count_where_completed") not in used_combos:
                cards.append({
                    "label": f"Completed {ename}s",
                    "entity": ename,
                    "method": "count",
                    "filter": {"field": "status", "value": completed_states[0]},
                    "icon": "CheckCircle",
                    "color": "emerald"
                })
                used_combos.add((ename, "count_where_completed"))

        # Revenue / sum card for price fields
        price_fields = find_price_fields(entity)
        if price_fields and (ename, "sum") not in used_combos:
            pf = price_fields[0]
            cards.append({
                "label": f"Total {pf['name'].replace('_', ' ').title()}",
                "entity": ename,
                "method": "sum",
                "field": pf["name"],
                "icon": "DollarSign",
                "color": "amber"
            })
            used_combos.add((ename, "sum"))

    # Keep existing cards and add new ones up to 4 total
    all_cards = existing_cards + [c for c in cards if c not in existing_cards]
    dashboard["stat_cards"] = all_cards[:4]
    spec["dashboard"] = dashboard
    return max(0, len(dashboard["stat_cards"]) - len(existing_cards))


def enrich_field_hints(entity):
    """Add placeholder and help_text to common fields."""
    added = 0
    for f in entity["fields"]:
        if f["name"] in FIELD_HINTS:
            hints = FIELD_HINTS[f["name"]]
            if "placeholder" not in f:
                f["placeholder"] = hints["placeholder"]
                added += 1
            if "help_text" not in f:
                f["help_text"] = hints["help_text"]
                added += 1
    return added


def _find_insert_idx(entity):
    """Find index before system fields."""
    for i, f in enumerate(entity["fields"]):
        if f["name"] in ("created_at", "updated_at", "deleted_at", "version"):
            return i
    return len(entity["fields"])


def _add_field_to_ui(entity, field_name):
    """Add a field to relevant ui_config sections."""
    ui = entity.get("ui_config", {})

    # Add to list_view columns
    lv = ui.get("list_view", {})
    cols = lv.get("columns", [])
    if field_name not in cols:
        cols.append(field_name)
        lv["columns"] = cols

    # Add to create_form field_order
    cf = ui.get("create_form", {})
    fo = cf.get("field_order", [])
    if field_name not in fo:
        fo.append(field_name)
        cf["field_order"] = fo

    # Add to edit_form field_order
    ef = ui.get("edit_form", {})
    efo = ef.get("field_order", [])
    if field_name not in efo:
        efo.append(field_name)
        ef["field_order"] = efo

    # Add to detail_view tabs
    dv = ui.get("detail_view", {})
    tabs = dv.get("tabs", [])
    if tabs:
        tab_fields = tabs[0].get("fields", [])
        if field_name not in tab_fields:
            tab_fields.append(field_name)
            tabs[0]["fields"] = tab_fields


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("SPEC ENRICHMENT TOOL — Upgrading thin specs to production quality")
    print("=" * 70)

    # 1. Scan all spec files and score them
    print("\n[1/4] Scanning all spec files...")
    spec_scores = []
    for fname in sorted(os.listdir(SPEC_DIR)):
        if not fname.endswith("_spec.json"):
            continue
        fpath = os.path.join(SPEC_DIR, fname)
        try:
            with open(fpath) as f:
                spec = json.load(f)
            score = score_spec(spec)
            spec_scores.append((score, fname, fpath))
        except Exception as e:
            print(f"  WARNING: Could not read {fname}: {e}")

    print(f"  Scanned {len(spec_scores)} spec files")

    # 2. Identify the 100 thinnest
    spec_scores.sort(key=lambda x: x[0])
    thin_100 = spec_scores[:100]

    print(f"\n[2/4] Identified 100 thinnest specs (score range: {thin_100[0][0]} — {thin_100[-1][0]})")
    print(f"  Thinnest:  {thin_100[0][1]} (score={thin_100[0][0]})")
    print(f"  100th:     {thin_100[-1][1]} (score={thin_100[-1][0]})")

    # Show score distribution
    richest = spec_scores[-1]
    median = spec_scores[len(spec_scores) // 2]
    print(f"  Median:    {median[1]} (score={median[0]})")
    print(f"  Richest:   {richest[1]} (score={richest[0]})")

    # 3. Enrich each thin spec
    print(f"\n[3/4] Enriching 100 thin specs...")
    stats = defaultdict(int)
    enriched_files = []

    for i, (score, fname, fpath) in enumerate(thin_100):
        with open(fpath) as f:
            spec = json.load(f)

        original_score = score
        changes = []

        for entity in spec.get("entities", []):
            n = enrich_fields(entity)
            if n: changes.append(f"+{n} fields")
            stats["fields_added"] += n

            n = enrich_validations(entity)
            if n: changes.append(f"+{n} validations")
            stats["validations_added"] += n

            n = enrich_computed_fields(entity)
            if n: changes.append(f"+{n} computed")
            stats["computed_added"] += n

            n = enrich_badge_colors(entity)
            if n: changes.append(f"+{n} badges")
            stats["badges_added"] += n

            n = enrich_views(entity)
            if n: changes.append("+views")
            stats["views_added"] += n

            n = enrich_quick_filters(entity)
            if n: changes.append("+quick_filters")
            stats["quick_filters_added"] += n

            n = enrich_default_sort(entity)
            if n: changes.append("+default_sort")
            stats["default_sort_added"] += n

            n = enrich_searchable_fields(entity)
            if n: changes.append("+searchable")
            stats["searchable_added"] += n

            n = enrich_row_actions(entity)
            if n: changes.append("+row_actions")
            stats["row_actions_added"] += n

            n = enrich_field_hints(entity)
            stats["hints_added"] += n

        n = enrich_fk_relationships(spec)
        if n: changes.append(f"+{n} FK")
        stats["fk_added"] += n

        n = enrich_dashboard(spec)
        if n: changes.append(f"+{n} dashboard cards")
        stats["dashboard_cards_added"] += n

        new_score = score_spec(spec)
        change_str = ", ".join(changes) if changes else "no changes needed"

        if (i + 1) % 10 == 0 or i < 5:
            print(f"  [{i+1:3d}/100] {fname:45s} score {original_score:3d} -> {new_score:3d}  ({change_str})")

        enriched_files.append((fname, fpath, spec, original_score, new_score))

    # 4. Write back
    print(f"\n[4/4] Writing enriched specs back to disk...")
    written = 0
    for fname, fpath, spec, old_score, new_score in enriched_files:
        with open(fpath, "w") as f:
            json.dump(spec, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written += 1

    print(f"  Written {written} files")

    # Summary
    print("\n" + "=" * 70)
    print("ENRICHMENT SUMMARY")
    print("=" * 70)
    print(f"  Specs scanned:          {len(spec_scores)}")
    print(f"  Specs enriched:         {written}")
    print(f"  Fields added:           {stats['fields_added']}")
    print(f"  FK relationships added: {stats['fk_added']}")
    print(f"  Validations added:      {stats['validations_added']}")
    print(f"  Computed fields added:   {stats['computed_added']}")
    print(f"  Badge colors added:     {stats['badges_added']}")
    print(f"  Views configs added:    {stats['views_added']}")
    print(f"  Quick filters added:    {stats['quick_filters_added']}")
    print(f"  Default sorts added:    {stats['default_sort_added']}")
    print(f"  Searchable fields:      {stats['searchable_added']}")
    print(f"  Row actions added:      {stats['row_actions_added']}")
    print(f"  Dashboard cards added:  {stats['dashboard_cards_added']}")
    print(f"  Hints (placeholder/help): {stats['hints_added']}")
    print()

    # Show before/after scores for first 20
    print("BEFORE/AFTER SCORES (first 20):")
    print(f"  {'File':45s} {'Before':>8s} {'After':>8s} {'Delta':>8s}")
    print(f"  {'-'*45} {'-'*8} {'-'*8} {'-'*8}")
    for fname, fpath, spec, old_score, new_score in enriched_files[:20]:
        delta = new_score - old_score
        print(f"  {fname:45s} {old_score:8d} {new_score:8d} {'+' + str(delta):>8s}")

    print("\nDone!")


if __name__ == "__main__":
    main()
