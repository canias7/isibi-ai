#!/usr/bin/env python3
"""Enrich top 25 spec files with richer metadata."""

import json
import os
import copy

SPEC_DIR = "/Users/marioambar/Desktop/isibi.ai/spec"

FILES = [
    "ecommerce_spec.json", "restaurant_management_spec.json", "gym_management_spec.json",
    "real_estate_spec.json", "healthcare_clinic_spec.json", "salon_booking_spec.json",
    "hotel_management_spec.json", "school_management_spec.json", "event_management_spec.json",
    "invoice_billing_spec.json", "construction_spec.json", "law_firm_spec.json",
    "recruitment_spec.json", "property_management_spec.json", "veterinary_clinic_spec.json",
    "car_dealership_spec.json", "logistics_spec.json", "task_management_spec.json",
    "insurance_spec.json", "nonprofit_spec.json", "fleet_management_spec.json",
    "photography_spec.json", "music_studio_spec.json", "wedding_planner_spec.json",
    "fitness_tracker_spec.json",
]

ICON_MAP = {
    "Customer": "Users", "Member": "Users", "Patient": "Users", "Student": "Users",
    "Client": "Users", "Guest": "Users", "Donor": "Users", "Candidate": "Users",
    "Employee": "Users", "Staff": "Users", "Teacher": "Users", "Instructor": "Users",
    "Driver": "Users", "Photographer": "Users", "Pet": "PawPrint", "Animal": "PawPrint",
    "Product": "Package", "Item": "Package", "MenuItem": "UtensilsCrossed",
    "Vehicle": "Car", "Car": "Car", "Property": "Building", "Room": "DoorOpen",
    "Order": "ShoppingCart", "Booking": "Calendar", "Appointment": "Calendar",
    "Reservation": "Calendar", "Event": "CalendarDays", "Session": "Clock",
    "Invoice": "FileText", "Payment": "CreditCard", "Bill": "Receipt",
    "Task": "CheckSquare", "Project": "Briefcase", "Case": "Briefcase",
    "Category": "FolderTree", "Class": "GraduationCap", "Course": "BookOpen",
    "Claim": "Shield", "Policy": "FileCheck", "Contract": "FileSignature",
    "Listing": "LayoutGrid", "Workout": "Dumbbell", "Exercise": "Activity",
    "Trip": "MapPin", "Shipment": "Truck", "Delivery": "Truck",
    "Donation": "Heart", "Campaign": "Megaphone", "Vendor": "Store",
}

COLOR_CYCLE = ["blue", "emerald", "violet", "amber", "pink", "cyan", "rose", "teal"]

CALENDAR_ENTITIES = {"appointment", "reservation", "booking", "event", "session",
                     "meeting", "shift", "visit", "schedule", "class", "lesson"}
CARD_ENTITIES = {"product", "menuitem", "menu_item", "item", "listing",
                 "property", "vehicle", "room", "pet", "animal"}
PRICE_FIELDS = {"price", "amount", "total", "total_amount", "total_spent", "cost",
                "fee", "rate", "subtotal", "grand_total", "balance", "revenue", "salary"}


def get_icon(entity_name):
    if entity_name in ICON_MAP:
        return ICON_MAP[entity_name]
    for key, icon in ICON_MAP.items():
        if key.lower() in entity_name.lower():
            return icon
    return "FileText"


def enrich_views(entity):
    """Enhancement 1: Smart view types."""
    views = ["table"]
    for f in entity["fields"]:
        if f.get("enum_values") and f["name"] in ["status", "stage", "phase", "state"]:
            views.append("kanban")
            break
    for f in entity["fields"]:
        if f.get("input_component") == "date_input" and entity["name"].lower() in CALENDAR_ENTITIES:
            views.append("calendar")
            break
    if entity["name"].lower() in CARD_ENTITIES:
        views.append("cards")
    entity["ui_config"]["list_view"]["views"] = views
    return views


def enrich_dashboard(spec):
    """Enhancement 2: Better dashboard stat cards."""
    entities = spec["entities"]
    cards = []
    added = set()

    # Count cards for first 2-3 entities
    for ent in entities[:3]:
        name = ent["name"]
        # Fix pluralization
        plural = name + "es" if name.endswith("s") else name + "s"
        cards.append({
            "label": f"Total {plural}",
            "entity": name,
            "method": "count",
            "icon": get_icon(name),
            "color": COLOR_CYCLE[len(cards) % len(COLOR_CYCLE)]
        })
        added.add(f"count_{name}")

    # Revenue card if any entity has price/amount field
    for ent in entities:
        for f in ent["fields"]:
            if f["name"] in PRICE_FIELDS:
                if "revenue" not in added:
                    cards.append({
                        "label": "Total Revenue",
                        "entity": ent["name"],
                        "method": "sum",
                        "field": f["name"],
                        "icon": "DollarSign",
                        "color": "emerald"
                    })
                    added.add("revenue")
                break
        if "revenue" in added:
            break

    # Active count if any entity has status
    for ent in entities:
        status_f = next((f for f in ent["fields"] if f["name"] == "status" and f.get("enum_values")), None)
        if status_f and "active" in status_f["enum_values"]:
            if "active_count" not in added:
                plural = ent["name"] + "es" if ent["name"].endswith("s") else ent["name"] + "s"
                cards.append({
                    "label": f"Active {plural}",
                    "entity": ent["name"],
                    "method": "count",
                    "filter": {"field": "status", "value": "active"},
                    "icon": "Activity",
                    "color": "cyan"
                })
                added.add("active_count")
            break

    # This week count if any entity has a date field
    for ent in entities:
        date_f = next((f for f in ent["fields"] if f.get("input_component") == "date_input"), None)
        if date_f:
            if "this_week" not in added:
                plural = ent["name"] + "es" if ent["name"].endswith("s") else ent["name"] + "s"
                cards.append({
                    "label": f"This Week's {plural}",
                    "entity": ent["name"],
                    "method": "count",
                    "filter": {"field": date_f["name"], "value": "this_week"},
                    "icon": "CalendarDays",
                    "color": "violet"
                })
                added.add("this_week")
            break

    if "dashboard" not in spec:
        spec["dashboard"] = {}
    spec["dashboard"]["stat_cards"] = cards[:5]
    return len(cards[:5])


def enrich_placeholders(entity):
    """Enhancement 3: Placeholder text & help text."""
    count = 0
    for f in entity["fields"]:
        name_lower = f["name"].lower()
        if "email" in name_lower:
            f["placeholder"] = "john@example.com"
            f["help_text"] = "Used for notifications"
            count += 1
        elif "phone" in name_lower or "tel" in name_lower or "mobile" in name_lower:
            f["placeholder"] = "(555) 123-4567"
            count += 1
        elif name_lower in ("name", "full_name", "first_name", "last_name", "client_name",
                            "customer_name", "patient_name", "student_name", "guest_name",
                            "contact_name", "owner_name"):
            if "first" in name_lower:
                f["placeholder"] = "First name"
            elif "last" in name_lower:
                f["placeholder"] = "Last name"
            else:
                f["placeholder"] = "Full name"
            count += 1
        elif name_lower in PRICE_FIELDS or "price" in name_lower or "amount" in name_lower or "cost" in name_lower or "fee" in name_lower or "rate" in name_lower:
            f["help_text"] = "Enter amount in USD"
            count += 1
        elif name_lower in ("description", "notes", "comments", "details", "bio",
                            "summary", "remarks", "feedback", "message", "reason"):
            f["placeholder"] = "Add details..."
            count += 1
        elif "url" in name_lower or "website" in name_lower or "link" in name_lower:
            f["placeholder"] = "https://..."
            count += 1
        elif "address" in name_lower:
            f["placeholder"] = "Street address"
            count += 1
        elif "title" in name_lower:
            f["placeholder"] = "Enter title"
            count += 1
    return count


def enrich_field_groups(entity):
    """Enhancement 4: Field groups."""
    ui = entity["ui_config"]
    for form_key in ["create_form", "edit_form"]:
        form = ui.get(form_key, {})
        form_fields = form.get("field_order", [])
        if len(form_fields) < 3:
            continue

        contact_names = {"name", "email", "phone", "address", "emergency_contact",
                         "emergency_phone", "mobile", "contact_name", "contact_email",
                         "contact_phone", "first_name", "last_name", "full_name"}
        contact_fields = [f for f in form_fields if f in contact_names]
        status_names = {f for f in form_fields if "status" in f or "type" in f or "priority" in f or "state" in f}
        status_fields = [f for f in form_fields if f in status_names]
        detail_fields = [f for f in form_fields if f not in contact_fields and f not in status_fields]

        if len(contact_fields) >= 2:
            field_groups = [
                {"label": "Contact Information", "fields": contact_fields},
                {"label": "Details", "fields": detail_fields},
            ]
            if status_fields:
                field_groups.append({"label": "Status", "fields": status_fields})
            form["field_groups"] = field_groups
    return True


def enrich_quick_filters(entity):
    """Enhancement 5: Quick filter tabs."""
    status_field = next((f for f in entity["fields"]
                         if f["name"] == "status" and f.get("enum_values")), None)
    if not status_field:
        return False

    tabs = [{"label": "All", "filter": None}]
    for val in status_field["enum_values"][:6]:
        tabs.append({
            "label": val.replace("_", " ").title(),
            "filter": {"field": "status", "value": val}
        })
    entity["ui_config"]["list_view"]["quick_filters"] = tabs
    return True


def enrich_detail_tabs(entity, all_entities):
    """Enhancement 6: Detail view tabs with related entities."""
    ui = entity["ui_config"]
    detail = ui.get("detail_view", {})

    # Get existing overview fields
    show_fields = detail.get("primary_fields", [])
    if not show_fields:
        show_fields = [f["name"] for f in entity["fields"]
                       if f.get("show_in_table") and f["name"] not in
                       ("id", "org_id", "created_at", "updated_at", "deleted_at", "version")]

    # Find related entities via FK
    related = []
    for other_ent in all_entities:
        if other_ent["name"] == entity["name"]:
            continue
        for f in other_ent["fields"]:
            if f.get("fk_entity") == entity["name"]:
                related.append({"entity": other_ent["name"], "fk_field": f["name"]})
                break

    tabs = [{"name": "Overview", "fields": show_fields}]
    for rel in related[:3]:
        rel_plural = rel["entity"] + "s"
        tabs.append({
            "name": rel_plural,
            "type": "related_list",
            "entity": rel["entity"],
            "fk_field": rel["fk_field"]
        })
    tabs.append({"name": "Activity", "fields": ["created_at", "updated_at"]})
    detail["tabs"] = tabs
    return len(related[:3])


def enrich_default_sort(entity):
    """Enhancement 7: Default sort."""
    date_field = next((f for f in entity["fields"]
                       if f.get("input_component") == "date_input"), None)
    if date_field:
        entity["ui_config"]["list_view"]["default_sort"] = {
            "field": date_field["name"], "direction": "desc"
        }
        return date_field["name"]
    else:
        entity["ui_config"]["list_view"]["default_sort"] = {
            "field": "created_at", "direction": "desc"
        }
        return "created_at"


def enrich_searchable(entity):
    """Enhancement 8: Searchable fields."""
    searchable = [f["name"] for f in entity["fields"]
                  if f["name"] not in ("id", "org_id", "created_at", "updated_at",
                                       "deleted_at", "version")
                  and f.get("db_type", "").startswith("VARCHAR")
                  and f.get("show_in_table")][:4]
    entity["ui_config"]["list_view"]["searchable_fields"] = searchable
    return searchable


def enrich_row_actions(entity):
    """Enhancement 9: Action buttons."""
    status_field = next((f for f in entity["fields"]
                         if f["name"] == "status" and f.get("enum_values")), None)
    if not status_field:
        return False

    actions = [
        {"label": "Edit", "action": "edit"},
        {"label": "View", "action": "detail"},
    ]
    vals = status_field["enum_values"]
    for target in ["completed", "done", "paid"]:
        if target in vals:
            actions.append({
                "label": f"Mark {target.title()}",
                "action": "update_status",
                "value": target
            })
            break
    if "cancelled" in vals:
        actions.append({
            "label": "Cancel",
            "action": "update_status",
            "value": "cancelled",
            "confirm": True
        })
    actions.append({"label": "Delete", "action": "delete", "confirm": True})
    entity["ui_config"]["list_view"]["row_actions"] = actions
    return True


def process_file(filename):
    filepath = os.path.join(SPEC_DIR, filename)
    if not os.path.exists(filepath):
        print(f"  SKIP: {filename} not found")
        return

    with open(filepath, "r") as f:
        spec = json.load(f)

    app_name = spec.get("_meta", {}).get("app_name", filename)
    print(f"\n{'='*60}")
    print(f"Processing: {filename} ({app_name})")
    print(f"{'='*60}")

    entities = spec.get("entities", [])
    if not entities:
        print("  No entities found, skipping.")
        return

    for entity in entities:
        ename = entity["name"]
        changes = []

        # Ensure ui_config structure exists
        if "ui_config" not in entity:
            entity["ui_config"] = {}
        if "list_view" not in entity["ui_config"]:
            entity["ui_config"]["list_view"] = {}
        if "detail_view" not in entity["ui_config"]:
            entity["ui_config"]["detail_view"] = {}
        if "create_form" not in entity["ui_config"]:
            entity["ui_config"]["create_form"] = {}
        if "edit_form" not in entity["ui_config"]:
            entity["ui_config"]["edit_form"] = {}

        # 1. Views
        views = enrich_views(entity)
        changes.append(f"views={views}")

        # 3. Placeholders
        ph_count = enrich_placeholders(entity)
        if ph_count:
            changes.append(f"placeholders/help_text={ph_count} fields")

        # 4. Field groups
        enrich_field_groups(entity)
        has_groups = "field_groups" in entity["ui_config"].get("create_form", {})
        if has_groups:
            changes.append("field_groups added")

        # 5. Quick filters
        if enrich_quick_filters(entity):
            changes.append("quick_filters added")

        # 6. Detail tabs
        rel_count = enrich_detail_tabs(entity, entities)
        changes.append(f"detail_tabs (+{rel_count} related)")

        # 7. Default sort
        sort_field = enrich_default_sort(entity)
        changes.append(f"default_sort={sort_field}")

        # 8. Searchable
        searchable = enrich_searchable(entity)
        changes.append(f"searchable={searchable}")

        # 9. Row actions
        if enrich_row_actions(entity):
            changes.append("row_actions added")

        print(f"  {ename}: {', '.join(changes)}")

    # 2. Dashboard
    card_count = enrich_dashboard(spec)
    print(f"  Dashboard: {card_count} stat cards")

    with open(filepath, "w") as f:
        json.dump(spec, f, indent=2)
        f.write("\n")

    print(f"  Saved: {filepath}")


if __name__ == "__main__":
    print("Enriching top 25 spec files with metadata...\n")
    for filename in FILES:
        process_file(filename)
    print(f"\nDone! Processed {len(FILES)} files.")
