#!/usr/bin/env python3
"""
Enrich specs 26-50 with metadata:
1. views array per entity
2. Better dashboard stat_cards
3. placeholder and help_text on fields
4. field_groups on create/edit forms
5. quick_filters tabs on list_view for status enum fields
6. Detail view tabs with related entity lists
7. default_sort per entity
8. searchable_fields
9. row_actions
"""
import json
import os
import re

SPEC_DIR = "/Users/marioambar/Desktop/isibi.ai/spec"

TARGET_FILES = [
    "budget_planner_spec.json",
    "commission_tracking_spec.json",
    "expense_tracking_spec.json",
    "meeting_scheduler_spec.json",
    "time_tracking_spec.json",
    "subscription_management_spec.json",
    "workflow_automation_spec.json",
    "team_collaboration_spec.json",
    "risk_management_spec.json",
    "compliance_tracker_spec.json",
    "document_management_spec.json",
    "internal_ticketing_spec.json",
    "resource_allocation_spec.json",
    "okr_goal_tracking_spec.json",
    "incident_tracking_spec.json",
    "payroll_spec.json",
    "procurement_spec.json",
    "tax_management_spec.json",
    "investment_portfolio_spec.json",
    "revenue_analytics_spec.json",
    "credit_tracking_spec.json",
    "financial_dashboard_spec.json",
    "internal_knowledge_base_spec.json",
    "audit_management_spec.json",
    "vendor_payment_spec.json",
]

# Keywords for smart field detection
DATE_FIELDS = {"date", "deadline", "due_date", "start_date", "end_date", "scheduled_at",
               "scheduled_date", "period_start", "period_end", "entry_date", "triggered_at",
               "completed_at", "expires_at", "expiry_date", "fire_date", "meeting_date",
               "payment_date", "invoice_date", "due_date", "target_date", "review_date",
               "next_review", "last_review", "audit_date", "created_at", "updated_at"}

MONEY_FIELDS = {"amount", "total", "price", "cost", "revenue", "budget", "fee", "salary",
                "commission", "payment", "balance", "net", "gross", "tax", "subtotal",
                "discount", "rate", "wage", "bonus", "deduction", "budgeted_amount",
                "actual_amount", "target_amount", "current_amount", "total_budgeted",
                "total_spent", "variance", "threshold_amount", "total_income", "total_expense",
                "net_amount", "hourly_rate", "total_hours", "base_salary", "net_pay",
                "gross_pay", "total_cost", "unit_price", "line_total"}

PRODUCT_ENTITY_HINTS = {"product", "item", "inventory", "asset", "equipment", "material",
                        "supply", "resource", "tool", "device", "subscription", "plan",
                        "package", "service", "offering"}

# Placeholder/help_text mappings by field name pattern
FIELD_HINTS = {
    "email": {"placeholder": "user@example.com", "help_text": "Enter a valid email address"},
    "phone": {"placeholder": "+1 (555) 123-4567", "help_text": "Phone number with area code"},
    "name": {"placeholder": "Enter name", "help_text": "Full name or title"},
    "first_name": {"placeholder": "First name", "help_text": "Person's first name"},
    "last_name": {"placeholder": "Last name", "help_text": "Person's last name"},
    "price": {"placeholder": "0.00", "help_text": "Price in default currency"},
    "amount": {"placeholder": "0.00", "help_text": "Enter the amount"},
    "description": {"placeholder": "Enter description...", "help_text": "Detailed description or notes"},
    "notes": {"placeholder": "Add notes...", "help_text": "Additional notes or comments"},
    "title": {"placeholder": "Enter title", "help_text": "Short descriptive title"},
    "url": {"placeholder": "https://example.com", "help_text": "Enter a valid URL"},
    "address": {"placeholder": "Street address", "help_text": "Full street address"},
    "city": {"placeholder": "City", "help_text": "City name"},
    "state": {"placeholder": "State/Province", "help_text": "State or province"},
    "zip": {"placeholder": "ZIP/Postal code", "help_text": "ZIP or postal code"},
    "country": {"placeholder": "Country", "help_text": "Country name"},
    "company": {"placeholder": "Company name", "help_text": "Organization or company name"},
    "department": {"placeholder": "Department", "help_text": "Department or division"},
    "message": {"placeholder": "Enter message...", "help_text": "Message content"},
    "subject": {"placeholder": "Enter subject", "help_text": "Brief subject line"},
    "comment": {"placeholder": "Add a comment...", "help_text": "Your comment"},
    "summary": {"placeholder": "Brief summary...", "help_text": "Short summary of the item"},
    "rate": {"placeholder": "0.00", "help_text": "Rate per unit"},
    "hourly_rate": {"placeholder": "0.00", "help_text": "Hourly billing rate"},
    "salary": {"placeholder": "0.00", "help_text": "Salary amount"},
    "budget": {"placeholder": "0.00", "help_text": "Budget amount"},
    "cost": {"placeholder": "0.00", "help_text": "Cost amount"},
    "total": {"placeholder": "0.00", "help_text": "Total amount"},
    "percentage": {"placeholder": "0", "help_text": "Percentage value (0-100)"},
    "duration": {"placeholder": "e.g. 1h 30m", "help_text": "Duration of the activity"},
    "location": {"placeholder": "Enter location", "help_text": "Location or venue name"},
    "priority": {"placeholder": "Select priority", "help_text": "Priority level"},
    "category": {"placeholder": "Select category", "help_text": "Category classification"},
    "tag": {"placeholder": "Add tags", "help_text": "Comma-separated tags"},
    "code": {"placeholder": "Enter code", "help_text": "Unique identifier code"},
    "reference": {"placeholder": "Reference number", "help_text": "Reference or tracking number"},
}


def is_date_field(field):
    """Check if a field is a date/datetime field."""
    name = field.get("name", "")
    db_type = field.get("db_type", "").upper()
    return (name in DATE_FIELDS or
            "DATE" in db_type or "TIMESTAMP" in db_type or
            name.endswith("_date") or name.endswith("_at"))


def is_money_field(field):
    """Check if a field is a money/currency field."""
    name = field.get("name", "")
    display = field.get("display_component", "")
    return (name in MONEY_FIELDS or display == "currency" or
            any(m in name for m in ["amount", "total", "price", "cost", "fee",
                                     "salary", "wage", "pay", "revenue", "budget"]))


def is_status_field(field):
    """Check if a field is a status/enum field with badge display."""
    return (field.get("enum_values") and
            field.get("display_component") == "status_badge")


def is_varchar_field(field):
    """Check if a field is a VARCHAR field shown in table."""
    db_type = field.get("db_type", "").upper()
    return ("VARCHAR" in db_type and
            field.get("show_in_table", False) and
            field.get("name") not in ("id", "org_id"))


def is_product_like(entity_name):
    """Check if entity is product-like (deserves card view)."""
    name_lower = entity_name.lower()
    return any(hint in name_lower for hint in PRODUCT_ENTITY_HINTS)


def get_first_status_field(fields):
    """Find the first status enum field."""
    for f in fields:
        if is_status_field(f):
            return f
    return None


def get_first_date_field(fields):
    """Find the first editable date field (not created_at/updated_at)."""
    for f in fields:
        if is_date_field(f) and f.get("name") not in ("created_at", "updated_at"):
            return f
    return None


def get_first_money_field(fields):
    """Find the first money field."""
    for f in fields:
        if is_money_field(f):
            return f
    return None


def build_views(entity_name, fields):
    """Build views array: table + kanban (status) + calendar (dates) + cards (products)."""
    views = [{"type": "table", "default": True}]

    status_field = get_first_status_field(fields)
    if status_field:
        views.append({
            "type": "kanban",
            "group_by": status_field["name"],
            "columns": status_field.get("enum_values", [])
        })

    date_field = get_first_date_field(fields)
    if date_field:
        views.append({
            "type": "calendar",
            "date_field": date_field["name"]
        })

    if is_product_like(entity_name):
        views.append({
            "type": "cards",
            "image_field": None,
            "title_field": next((f["name"] for f in fields if f["name"] in ("name", "title")), None),
            "subtitle_field": next((f["name"] for f in fields if is_status_field(f)), None)
        })

    return views


def build_dashboard_stat_cards(entity_name, table_name, fields):
    """Build dashboard stat_cards: count + revenue/amount sum + active filtered + this week."""
    entity_lower = entity_name.lower()
    label = entity_name + "s" if not entity_name.endswith("s") else entity_name

    cards = [
        {
            "label": f"Total {label}",
            "query": f"COUNT(*) FROM {table_name}",
            "icon": "Hash",
            "color": "blue"
        }
    ]

    # Find a money field for sum card
    money_field = get_first_money_field(fields)
    if money_field:
        money_name = money_field["name"]
        cards.append({
            "label": f"Total {money_name.replace('_', ' ').title()}",
            "query": f"SUM({money_name}) FROM {table_name}",
            "icon": "DollarSign",
            "format": "currency",
            "color": "green"
        })

    # Active/open filtered count
    status_field = get_first_status_field(fields)
    if status_field:
        enums = status_field.get("enum_values", [])
        active_val = next((v for v in enums if v in ("active", "open", "in_progress",
                                                      "on_track", "approved", "running",
                                                      "published", "enabled")), enums[0] if enums else "active")
        cards.append({
            "label": f"Active {label}",
            "query": f"COUNT(*) FROM {table_name} WHERE {status_field['name']} = '{active_val}'",
            "icon": "CheckCircle",
            "color": "emerald"
        })

    # This week card
    date_field = get_first_date_field(fields)
    date_col = date_field["name"] if date_field else "created_at"
    cards.append({
        "label": f"This Week",
        "query": f"COUNT(*) FROM {table_name} WHERE {date_col} >= date_trunc('week', NOW())",
        "icon": "Calendar",
        "color": "purple"
    })

    return cards


def add_field_hints(field):
    """Add placeholder and help_text to fields based on name."""
    name = field.get("name", "")
    if name in ("id", "org_id", "created_at", "updated_at"):
        return

    # Direct match
    if name in FIELD_HINTS:
        if "placeholder" not in field:
            field["placeholder"] = FIELD_HINTS[name]["placeholder"]
        if "help_text" not in field:
            field["help_text"] = FIELD_HINTS[name]["help_text"]
        return

    # Partial match (e.g. employee_email -> email)
    for key, hints in FIELD_HINTS.items():
        if name.endswith(f"_{key}") or name.startswith(f"{key}_"):
            if "placeholder" not in field:
                field["placeholder"] = hints["placeholder"]
            if "help_text" not in field:
                field["help_text"] = hints["help_text"]
            return

    # Money fields
    if is_money_field(field):
        if "placeholder" not in field:
            field["placeholder"] = "0.00"
        if "help_text" not in field:
            field["help_text"] = f"Enter {name.replace('_', ' ')}"
        return

    # Generic for editable text fields
    if field.get("editable") and field.get("show_in_form"):
        input_comp = field.get("input_component", "")
        if input_comp == "text_input" and "placeholder" not in field:
            field["placeholder"] = f"Enter {name.replace('_', ' ')}"
        elif input_comp == "textarea" and "placeholder" not in field:
            field["placeholder"] = f"Enter {name.replace('_', ' ')}..."
        elif input_comp == "select" and "placeholder" not in field:
            field["placeholder"] = f"Select {name.replace('_', ' ')}"
        elif input_comp == "number_input" and "placeholder" not in field:
            field["placeholder"] = "0"
        elif input_comp == "date_picker" and "placeholder" not in field:
            field["placeholder"] = "Select date"


def build_field_groups(entity_name, fields):
    """Build field_groups for create/edit forms."""
    groups = []

    # Contact Info group
    contact_fields = [f["name"] for f in fields
                      if f.get("show_in_form") and f.get("name") in
                      ("name", "first_name", "last_name", "email", "phone",
                       "company", "contact_name", "contact_email", "contact_phone",
                       "address", "city", "state", "zip", "country")]
    if contact_fields:
        groups.append({"label": "Contact Info", "fields": contact_fields})

    # Details group — editable form fields not in contact and not status/dates
    detail_fields = [f["name"] for f in fields
                     if f.get("show_in_form") and f.get("editable") and
                     f["name"] not in contact_fields and
                     f["name"] not in ("id", "org_id", "created_at", "updated_at") and
                     not is_status_field(f) and not is_date_field(f) and
                     f.get("input_component") != "relation_select"]
    if detail_fields:
        groups.append({"label": "Details", "fields": detail_fields})

    # Relationships group
    relation_fields = [f["name"] for f in fields
                       if f.get("show_in_form") and f.get("input_component") == "relation_select"]
    if relation_fields:
        groups.append({"label": "Relationships", "fields": relation_fields})

    # Status & Dates group
    status_date_fields = [f["name"] for f in fields
                          if f.get("show_in_form") and f.get("editable") and
                          (is_status_field(f) or
                           (is_date_field(f) and f["name"] not in ("created_at", "updated_at")))]
    if status_date_fields:
        groups.append({"label": "Status", "fields": status_date_fields})

    # Fallback: if no groups were created, put all form fields in one group
    if not groups:
        all_form = [f["name"] for f in fields
                    if f.get("show_in_form") and f.get("editable") and
                    f["name"] not in ("id", "org_id")]
        if all_form:
            groups.append({"label": "Details", "fields": all_form})

    return groups


def build_quick_filters(fields):
    """Build quick_filters from status enum fields."""
    filters = []
    for f in fields:
        if is_status_field(f):
            filters.append({
                "field": f["name"],
                "label": f["name"].replace("_", " ").title(),
                "options": ["all"] + f.get("enum_values", [])
            })
    return filters


def build_detail_tabs(entity_name, all_entities):
    """Build detail view tabs with related entity lists (find FKs pointing to this entity)."""
    tabs = [{"label": "Details", "type": "fields"}]

    for other in all_entities:
        if other["name"] == entity_name:
            continue
        for f in other.get("fields", []):
            if f.get("fk_entity") == entity_name:
                tab_label = other["name"] + "s" if not other["name"].endswith("s") else other["name"]
                tabs.append({
                    "label": tab_label,
                    "type": "related_list",
                    "entity": other["name"],
                    "foreign_key": f["name"]
                })
                break  # one tab per related entity

    return tabs


def build_default_sort(fields):
    """Build default_sort: prefer editable date DESC, fallback to created_at DESC."""
    date_field = get_first_date_field(fields)
    if date_field:
        return {"field": date_field["name"], "direction": "desc"}
    # Fallback
    return {"field": "created_at", "direction": "desc"}


def build_searchable_fields(fields):
    """Build searchable_fields: VARCHAR fields shown in table, max 4."""
    candidates = [f["name"] for f in fields if is_varchar_field(f)]
    return candidates[:4]


def build_row_actions(entity_name, fields):
    """Build row_actions based on entity type."""
    actions = [
        {"label": "View", "icon": "Eye", "action": "navigate_detail"},
        {"label": "Edit", "icon": "Pencil", "action": "navigate_edit"},
    ]

    # Find status field for contextual actions
    status_field = get_first_status_field(fields)
    if status_field:
        enums = status_field.get("enum_values", [])
        if any(v in enums for v in ("completed", "done", "resolved", "closed")):
            target = next(v for v in ("completed", "done", "resolved", "closed") if v in enums)
            actions.append({
                "label": f"Mark {target.replace('_', ' ').title()}",
                "icon": "CheckCircle",
                "action": "update_field",
                "field": status_field["name"],
                "value": target,
                "confirm": True
            })
        if any(v in enums for v in ("paid", "approved")):
            target = next(v for v in ("paid", "approved") if v in enums)
            actions.append({
                "label": f"Mark {target.title()}",
                "icon": "CheckCircle",
                "action": "update_field",
                "field": status_field["name"],
                "value": target,
                "confirm": True
            })
        if any(v in enums for v in ("cancelled", "canceled", "rejected", "void")):
            target = next(v for v in ("cancelled", "canceled", "rejected", "void") if v in enums)
            actions.append({
                "label": "Cancel",
                "icon": "XCircle",
                "action": "update_field",
                "field": status_field["name"],
                "value": target,
                "confirm": True,
                "variant": "danger"
            })

    actions.append({
        "label": "Delete",
        "icon": "Trash2",
        "action": "delete",
        "confirm": True,
        "variant": "danger"
    })

    return actions


def enrich_spec(filepath):
    """Read a spec file, add metadata, save back."""
    with open(filepath, "r") as f:
        spec = json.load(f)

    entities = spec.get("entities", [])
    if not entities:
        return False, "No entities found"

    entity_names = [e["name"] for e in entities]
    changes = []

    # 2. Dashboard stat_cards (spec-level, use first entity)
    if "dashboard" not in spec:
        spec["dashboard"] = {}
    if "stat_cards" not in spec["dashboard"]:
        all_cards = []
        for ent in entities:
            cards = build_dashboard_stat_cards(ent["name"], ent["table"], ent.get("fields", []))
            all_cards.extend(cards)
        # Deduplicate by label, keep max 6
        seen_labels = set()
        deduped = []
        for c in all_cards:
            if c["label"] not in seen_labels:
                seen_labels.add(c["label"])
                deduped.append(c)
        spec["dashboard"]["stat_cards"] = deduped[:6]
        changes.append("dashboard.stat_cards")

    for entity in entities:
        fields = entity.get("fields", [])

        # 1. Views
        if "views" not in entity:
            entity["views"] = build_views(entity["name"], fields)
            changes.append(f"{entity['name']}.views")

        # 3. Placeholder and help_text on fields
        for field in fields:
            add_field_hints(field)

        # 4. Field groups
        if "field_groups" not in entity:
            entity["field_groups"] = build_field_groups(entity["name"], fields)
            changes.append(f"{entity['name']}.field_groups")

        # 5. Quick filters
        if "quick_filters" not in entity:
            qf = build_quick_filters(fields)
            if qf:
                entity["quick_filters"] = qf
                changes.append(f"{entity['name']}.quick_filters")

        # 6. Detail tabs
        if "detail_tabs" not in entity:
            entity["detail_tabs"] = build_detail_tabs(entity["name"], entities)
            changes.append(f"{entity['name']}.detail_tabs")

        # 7. Default sort
        if "default_sort" not in entity:
            entity["default_sort"] = build_default_sort(fields)
            changes.append(f"{entity['name']}.default_sort")

        # 8. Searchable fields
        if "searchable_fields" not in entity:
            sf = build_searchable_fields(fields)
            if sf:
                entity["searchable_fields"] = sf
                changes.append(f"{entity['name']}.searchable_fields")

        # 9. Row actions
        if "row_actions" not in entity:
            entity["row_actions"] = build_row_actions(entity["name"], fields)
            changes.append(f"{entity['name']}.row_actions")

    changes.append("field placeholders/help_text")

    with open(filepath, "w") as f:
        json.dump(spec, f, indent=2)

    return True, changes


def main():
    results = {"success": [], "missing": [], "errors": []}

    for filename in TARGET_FILES:
        filepath = os.path.join(SPEC_DIR, filename)
        if not os.path.exists(filepath):
            results["missing"].append(filename)
            print(f"  MISSING: {filename}")
            continue

        try:
            ok, info = enrich_spec(filepath)
            if ok:
                results["success"].append(filename)
                print(f"  OK: {filename} -> {len(info)} enrichments")
            else:
                results["errors"].append((filename, info))
                print(f"  SKIP: {filename} -> {info}")
        except Exception as e:
            results["errors"].append((filename, str(e)))
            print(f"  ERROR: {filename} -> {e}")

    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"  Enriched: {len(results['success'])}")
    print(f"  Missing:  {len(results['missing'])}")
    print(f"  Errors:   {len(results['errors'])}")

    if results["missing"]:
        print(f"\n  Missing files:")
        for f in results["missing"]:
            print(f"    - {f}")

    if results["errors"]:
        print(f"\n  Errors:")
        for f, e in results["errors"]:
            print(f"    - {f}: {e}")

    print()


if __name__ == "__main__":
    main()
