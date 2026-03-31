"""
Industry sub-type templates — the intelligence layer that guarantees
domain-specific quality in generated app specs.

Instead of treating "restaurant" as one thing, this module breaks each
broad industry into specific sub-types with guaranteed entities, fields,
dashboard KPIs, and design hints.

Usage in the AI generator:
    context = get_required_fields_context(user_prompt)
    # inject `context` into the system prompt so Claude knows
    # exactly which entities/fields are non-negotiable.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# INDUSTRY_SUBTYPES — master registry
# ---------------------------------------------------------------------------

INDUSTRY_SUBTYPES: dict[str, dict[str, dict[str, Any]]] = {

    # ======================================================================
    # RESTAURANT
    # ======================================================================
    "restaurant": {

        "fine_dining": {
            "name": "Fine Dining Restaurant",
            "keywords": [
                "fine dining", "upscale", "tasting menu", "michelin",
                "prix fixe", "sommelier", "wine pairing", "haute cuisine",
                "multi-course", "gourmet", "white tablecloth",
            ],
            "required_entities": [
                {
                    "name": "Reservation",
                    "must_have_fields": [
                        {"name": "guest_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "party_size", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "table_id", "db_type": "UUID", "ts_type": "string"},
                        {"name": "special_requests", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'confirmed'", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "WineList",
                    "must_have_fields": [
                        {"name": "wine_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "region", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "vintage", "db_type": "INT", "ts_type": "number"},
                        {"name": "varietal", "db_type": "VARCHAR(100)", "ts_type": "string"},
                        {"name": "price_bottle", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "price_glass", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "pairing_notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "in_stock", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Course",
                    "must_have_fields": [
                        {"name": "course_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "course_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "allergens", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "available", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "TableAssignment",
                    "must_have_fields": [
                        {"name": "table_number", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "seats", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "section", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'available'", "ts_type": "string"},
                        {"name": "server_name", "db_type": "VARCHAR(120)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "TastingMenu",
                    "must_have_fields": [
                        {"name": "menu_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "num_courses", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "wine_pairing_price", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Reservations Today", "Tables Occupied", "Average Spend per Guest",
                "Wine Revenue", "Tasting Menu Orders", "Guest Satisfaction",
            ],
            "suggested_workflows": [
                "reservation_confirmation", "table_turnover_tracking",
                "wine_inventory_management", "course_sequencing",
            ],
            "design_hint": "Dark, elegant theme with gold accents. Serif or display font. Muted tones, sophisticated feel.",
        },

        "fast_food": {
            "name": "Fast Food Restaurant",
            "keywords": [
                "fast food", "quick service", "drive through", "drive-thru",
                "combo meal", "takeout", "take-out", "burger", "fried chicken",
                "speed", "counter service",
            ],
            "required_entities": [
                {
                    "name": "QuickOrder",
                    "must_have_fields": [
                        {"name": "order_number", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "customer_name", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "order_type", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'counter'", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "total", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'pending'", "ts_type": "string"},
                        {"name": "estimated_ready", "db_type": "TIMESTAMPTZ", "ts_type": "string"},
                    ],
                },
                {
                    "name": "DriveThrough",
                    "must_have_fields": [
                        {"name": "lane", "db_type": "VARCHAR(20) NOT NULL DEFAULT 'lane_1'", "ts_type": "string"},
                        {"name": "order_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "vehicle_description", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "entered_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string"},
                        {"name": "served_at", "db_type": "TIMESTAMPTZ", "ts_type": "string"},
                        {"name": "wait_seconds", "db_type": "INT", "ts_type": "number"},
                    ],
                },
                {
                    "name": "ComboMeal",
                    "must_have_fields": [
                        {"name": "combo_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "items_included", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "calories", "db_type": "INT", "ts_type": "number"},
                        {"name": "available", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                        {"name": "image_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "SpeedMetric",
                    "must_have_fields": [
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "shift", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "avg_order_time_sec", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "avg_drive_thru_sec", "db_type": "INT", "ts_type": "number"},
                        {"name": "orders_per_hour", "db_type": "DECIMAL(8,2)", "ts_type": "number"},
                        {"name": "complaints", "db_type": "INT DEFAULT 0", "ts_type": "number"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Orders Today", "Avg Order Time", "Drive-Thru Wait",
                "Revenue Today", "Combo Meal Popularity", "Orders per Hour",
            ],
            "suggested_workflows": [
                "order_queue_management", "drive_thru_tracking",
                "inventory_countdown", "shift_speed_reporting",
            ],
            "design_hint": "Bold, energetic colors (red, orange, yellow). Sans-serif font. Clean, fast-feeling interface.",
        },

        "food_truck": {
            "name": "Food Truck",
            "keywords": [
                "food truck", "mobile food", "street food", "popup",
                "pop-up", "food cart", "mobile kitchen", "roaming",
            ],
            "required_entities": [
                {
                    "name": "Location",
                    "must_have_fields": [
                        {"name": "location_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "latitude", "db_type": "DECIMAL(10,7)", "ts_type": "number"},
                        {"name": "longitude", "db_type": "DECIMAL(10,7)", "ts_type": "number"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "time_start", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "time_end", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "MenuItem",
                    "must_have_fields": [
                        {"name": "item_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "category", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "available_today", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "DailySpecial",
                    "must_have_fields": [
                        {"name": "special_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "quantity_available", "db_type": "INT", "ts_type": "number"},
                    ],
                },
                {
                    "name": "CashRegister",
                    "must_have_fields": [
                        {"name": "transaction_id", "db_type": "VARCHAR(50) NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "subtotal", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "tax", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "total", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "payment_method", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'cash'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Today's Location", "Sales Today", "Items Sold",
                "Top Seller", "Cash vs Card", "Daily Specials Left",
            ],
            "suggested_workflows": [
                "daily_location_posting", "simple_pos_flow",
                "end_of_day_reconciliation", "menu_rotation",
            ],
            "design_hint": "Fun, casual, street-art vibe. Warm or bold accent colors. Rounded corners, friendly font.",
        },

        "catering": {
            "name": "Catering Business",
            "keywords": [
                "catering", "event food", "corporate catering", "wedding catering",
                "banquet", "buffet service", "meal prep delivery", "bulk orders",
            ],
            "required_entities": [
                {
                    "name": "Event",
                    "must_have_fields": [
                        {"name": "event_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "client_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "event_date", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "venue", "db_type": "VARCHAR(300)", "ts_type": "string"},
                        {"name": "guest_count", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "event_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'inquiry'", "ts_type": "string"},
                        {"name": "total_quote", "db_type": "DECIMAL(12,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Package",
                    "must_have_fields": [
                        {"name": "package_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "price_per_person", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "min_guests", "db_type": "INT NOT NULL DEFAULT 10", "ts_type": "number"},
                        {"name": "includes", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "DietaryRequirement",
                    "must_have_fields": [
                        {"name": "event_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "requirement_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "guest_count", "db_type": "INT NOT NULL DEFAULT 1", "ts_type": "number"},
                        {"name": "details", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "DeliveryLogistic",
                    "must_have_fields": [
                        {"name": "event_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "pickup_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "delivery_address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "driver", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "vehicle", "db_type": "VARCHAR(80)", "ts_type": "string"},
                        {"name": "setup_required", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Upcoming Events", "Revenue This Month", "Avg Guests per Event",
                "Dietary Accommodations", "Pending Quotes", "Events This Week",
            ],
            "suggested_workflows": [
                "event_inquiry_to_booking", "dietary_collection",
                "delivery_dispatch", "post_event_feedback",
            ],
            "design_hint": "Professional, warm tones. Clean layout with good card structure. Elegant but approachable.",
        },

        "cafe": {
            "name": "Cafe / Coffee Shop",
            "keywords": [
                "cafe", "coffee shop", "coffee house", "espresso bar",
                "bakery cafe", "tea house", "brunch spot", "pastry shop",
            ],
            "required_entities": [
                {
                    "name": "Beverage",
                    "must_have_fields": [
                        {"name": "beverage_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "size_options", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "base_price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "customizations", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "caffeinated", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                        {"name": "available", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Pastry",
                    "must_have_fields": [
                        {"name": "pastry_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "allergens", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "vegan", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "gluten_free", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "quantity_today", "db_type": "INT", "ts_type": "number"},
                    ],
                },
                {
                    "name": "LoyaltyMember",
                    "must_have_fields": [
                        {"name": "member_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "points", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "tier", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'bronze'", "ts_type": "string"},
                        {"name": "join_date", "db_type": "DATE NOT NULL DEFAULT CURRENT_DATE", "ts_type": "string"},
                        {"name": "favorite_drink", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "WiFiCode",
                    "must_have_fields": [
                        {"name": "code", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "valid_from", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "valid_until", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "network_name", "db_type": "VARCHAR(100)", "ts_type": "string"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Drinks Sold Today", "Loyalty Members", "Top Beverage",
                "Pastry Inventory", "Revenue Today", "Avg Ticket Size",
            ],
            "suggested_workflows": [
                "loyalty_point_tracking", "daily_pastry_count",
                "wifi_code_rotation", "monthly_specials",
            ],
            "design_hint": "Warm browns, creams, soft earth tones. Rounded, cozy feel. Friendly font like Nunito or Quicksand.",
        },

        "bar": {
            "name": "Bar / Lounge",
            "keywords": [
                "bar", "pub", "lounge", "cocktail bar", "sports bar",
                "brewery", "taproom", "nightclub", "wine bar", "tavern",
            ],
            "required_entities": [
                {
                    "name": "DrinksMenu",
                    "must_have_fields": [
                        {"name": "drink_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "abv", "db_type": "DECIMAL(4,1)", "ts_type": "number"},
                        {"name": "available", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Tab",
                    "must_have_fields": [
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "opened_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string"},
                        {"name": "closed_at", "db_type": "TIMESTAMPTZ", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL DEFAULT '[]'", "ts_type": "object"},
                        {"name": "subtotal", "db_type": "DECIMAL(10,2) NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "tip", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'open'", "ts_type": "string"},
                        {"name": "card_on_file", "db_type": "VARCHAR(30)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "HappyHour",
                    "must_have_fields": [
                        {"name": "name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "day_of_week", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "start_time", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "end_time", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "discount_percent", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "applicable_items", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "InventoryItem",
                    "must_have_fields": [
                        {"name": "item_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "quantity_on_hand", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "unit", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'bottle'", "ts_type": "string"},
                        {"name": "reorder_level", "db_type": "INT NOT NULL DEFAULT 5", "ts_type": "number"},
                        {"name": "supplier", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "cost_per_unit", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Open Tabs", "Revenue Tonight", "Avg Tab Size",
                "Happy Hour Sales", "Low Stock Alerts", "Drinks Served",
            ],
            "suggested_workflows": [
                "tab_management", "happy_hour_automation",
                "inventory_reorder_alerts", "nightly_close_out",
            ],
            "design_hint": "Dark theme with neon or amber accents. Moody, atmospheric. Bold or display font.",
        },
    },

    # ======================================================================
    # MEDICAL
    # ======================================================================
    "medical": {

        "general_clinic": {
            "name": "General Medical Clinic",
            "keywords": [
                "clinic", "doctor", "physician", "general practice",
                "family medicine", "primary care", "medical office",
                "healthcare", "patient management", "medical practice",
            ],
            "required_entities": [
                {
                    "name": "Patient",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "gender", "db_type": "VARCHAR(20)", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "blood_type", "db_type": "VARCHAR(10)", "ts_type": "string"},
                        {"name": "allergies", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "emergency_contact", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Appointment",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "doctor_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 30", "ts_type": "number"},
                        {"name": "visit_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "room", "db_type": "VARCHAR(30)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Prescription",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "medication", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "dosage", "db_type": "VARCHAR(100) NOT NULL", "ts_type": "string"},
                        {"name": "frequency", "db_type": "VARCHAR(100) NOT NULL", "ts_type": "string"},
                        {"name": "prescribed_by", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "refills_remaining", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Vital",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "recorded_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string"},
                        {"name": "blood_pressure_sys", "db_type": "INT", "ts_type": "number"},
                        {"name": "blood_pressure_dia", "db_type": "INT", "ts_type": "number"},
                        {"name": "heart_rate", "db_type": "INT", "ts_type": "number"},
                        {"name": "temperature_f", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "weight_lbs", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "height_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "oxygen_saturation", "db_type": "INT", "ts_type": "number"},
                        {"name": "recorded_by", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Insurance",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "provider_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "policy_number", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "group_number", "db_type": "VARCHAR(80)", "ts_type": "string"},
                        {"name": "subscriber_name", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "copay", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "effective_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "expiration_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Patients Seen", "Pending Prescriptions",
                "No-Show Rate", "Insurance Claims", "Avg Wait Time",
            ],
            "suggested_workflows": [
                "patient_check_in", "appointment_reminders",
                "prescription_renewal", "insurance_verification",
            ],
            "design_hint": "Clean, clinical blues and whites. Light theme. Professional sans-serif. Spacious layout.",
        },

        "dental": {
            "name": "Dental Practice",
            "keywords": [
                "dental", "dentist", "orthodontist", "teeth", "oral health",
                "dental clinic", "dental office", "braces", "dental hygiene",
            ],
            "required_entities": [
                {
                    "name": "Patient",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "insurance_provider", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "last_visit", "db_type": "DATE", "ts_type": "string"},
                        {"name": "next_cleaning_due", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
                {
                    "name": "TeethChart",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tooth_number", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "condition", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "last_examined", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Procedure",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "procedure_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "tooth_numbers", "db_type": "VARCHAR(100)", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "dentist", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "insurance_covered", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'completed'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "XRay",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "date_taken", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "file_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "findings", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "taken_by", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "TreatmentPlan",
                    "must_have_fields": [
                        {"name": "patient_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "plan_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "procedures_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "total_cost", "db_type": "DECIMAL(12,2) NOT NULL", "ts_type": "number"},
                        {"name": "insurance_estimate", "db_type": "DECIMAL(12,2)", "ts_type": "number"},
                        {"name": "patient_responsibility", "db_type": "DECIMAL(12,2)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'proposed'", "ts_type": "string"},
                        {"name": "start_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Procedures This Week", "Treatment Plans Active",
                "Overdue Cleanings", "Revenue This Month", "Insurance Claims Pending",
            ],
            "suggested_workflows": [
                "cleaning_recall_reminders", "treatment_plan_approval",
                "xray_review", "insurance_claim_submission",
            ],
            "design_hint": "Fresh cyan/teal tones. Light and clean. Friendly, approachable feel with professional undertone.",
        },

        "mental_health": {
            "name": "Mental Health Practice",
            "keywords": [
                "therapy", "therapist", "counseling", "counselor",
                "psychologist", "psychiatrist", "mental health",
                "behavioral health", "psychology practice",
            ],
            "required_entities": [
                {
                    "name": "Client",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "emergency_contact", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "primary_diagnosis", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Session",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "therapist_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 50", "ts_type": "number"},
                        {"name": "session_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                        {"name": "copay_collected", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "TherapyNote",
                    "must_have_fields": [
                        {"name": "session_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "subjective", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "objective", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "assessment", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "plan", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "risk_level", "db_type": "VARCHAR(30) DEFAULT 'low'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "MoodEntry",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "mood_score", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "anxiety_level", "db_type": "INT", "ts_type": "number"},
                        {"name": "sleep_hours", "db_type": "DECIMAL(4,1)", "ts_type": "number"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "TreatmentGoal",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "goal_description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "target_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "progress_percent", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "milestones_json", "db_type": "JSONB", "ts_type": "object"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Sessions Today", "Active Clients", "Avg Mood Score Trend",
                "Goal Completion Rate", "Cancellation Rate", "High Risk Alerts",
            ],
            "suggested_workflows": [
                "session_scheduling", "soap_note_creation",
                "mood_trend_analysis", "goal_progress_review",
            ],
            "design_hint": "Calming purples, soft greens, or warm neutrals. Light theme. Rounded, gentle UI. Approachable font.",
        },

        "veterinary": {
            "name": "Veterinary Clinic",
            "keywords": [
                "vet", "veterinary", "animal hospital", "pet clinic",
                "animal care", "pet health", "veterinarian",
            ],
            "required_entities": [
                {
                    "name": "Pet",
                    "must_have_fields": [
                        {"name": "pet_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "species", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "breed", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE", "ts_type": "string"},
                        {"name": "weight_lbs", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "color", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "microchip_id", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "spayed_neutered", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "owner_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Owner",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "preferred_contact", "db_type": "VARCHAR(30) DEFAULT 'phone'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Vaccination",
                    "must_have_fields": [
                        {"name": "pet_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "vaccine_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date_given", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "next_due_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "administered_by", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "lot_number", "db_type": "VARCHAR(60)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Visit",
                    "must_have_fields": [
                        {"name": "pet_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "reason", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "vet_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "diagnosis", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "treatment", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "weight_lbs", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "follow_up_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Vaccinations Due", "Active Patients",
                "Revenue This Month", "Species Breakdown", "Follow-ups Needed",
            ],
            "suggested_workflows": [
                "vaccination_reminders", "patient_check_in",
                "prescription_dispensing", "follow_up_scheduling",
            ],
            "design_hint": "Warm greens and earth tones. Friendly, inviting feel. Rounded UI with playful touches.",
        },

        "pharmacy": {
            "name": "Pharmacy",
            "keywords": [
                "pharmacy", "drugstore", "dispensary", "pharmacist",
                "medication", "prescriptions", "pharmaceutical",
            ],
            "required_entities": [
                {
                    "name": "Medication",
                    "must_have_fields": [
                        {"name": "drug_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "generic_name", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "ndc_code", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "dosage_form", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "strength", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "manufacturer", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "controlled_schedule", "db_type": "VARCHAR(10)", "ts_type": "string"},
                        {"name": "requires_refrigeration", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Prescription",
                    "must_have_fields": [
                        {"name": "patient_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "prescriber", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "medication_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "quantity", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "directions", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "refills_authorized", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "refills_used", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "date_written", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "date_filled", "db_type": "DATE", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'pending'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Inventory",
                    "must_have_fields": [
                        {"name": "medication_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "quantity_on_hand", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "reorder_point", "db_type": "INT NOT NULL DEFAULT 10", "ts_type": "number"},
                        {"name": "lot_number", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "expiration_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "cost_per_unit", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "supplier", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "DrugInteraction",
                    "must_have_fields": [
                        {"name": "drug_a", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "drug_b", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "severity", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "recommendation", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Prescriptions to Fill", "Low Stock Alerts", "Expiring Soon",
                "Revenue Today", "Controlled Substance Log", "Refills Due",
            ],
            "suggested_workflows": [
                "prescription_filling", "inventory_reorder",
                "drug_interaction_check", "expiration_tracking",
            ],
            "design_hint": "Clean clinical look. Blue-green tones. Professional, precise. Good contrast for readability.",
        },
    },

    # ======================================================================
    # FITNESS
    # ======================================================================
    "fitness": {

        "crossfit_gym": {
            "name": "CrossFit / Functional Fitness Gym",
            "keywords": [
                "crossfit", "functional fitness", "wod", "box gym",
                "olympic lifting", "metcon", "amrap", "emom",
                "crossfit box", "cf gym",
            ],
            "required_entities": [
                {
                    "name": "WOD",
                    "must_have_fields": [
                        {"name": "wod_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "wod_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "time_cap_minutes", "db_type": "INT", "ts_type": "number"},
                        {"name": "scaling_options", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Benchmark",
                    "must_have_fields": [
                        {"name": "member_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "movement", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "value", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "unit", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "date_recorded", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "is_pr", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Leaderboard",
                    "must_have_fields": [
                        {"name": "wod_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "member_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "result", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "rx", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ClassSlot",
                    "must_have_fields": [
                        {"name": "class_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "day_of_week", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "start_time", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "coach", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "capacity", "db_type": "INT NOT NULL DEFAULT 20", "ts_type": "number"},
                        {"name": "enrolled", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Today's WOD", "Members Checked In", "PRs This Week",
                "Class Capacity Fill Rate", "Active Members", "Top Performer",
            ],
            "suggested_workflows": [
                "wod_publishing", "benchmark_tracking",
                "class_signup_management", "pr_celebrations",
            ],
            "design_hint": "Bold, dark theme. Strong typography (Oswald, Bebas). High contrast. Athletic, intense vibe.",
        },

        "yoga_studio": {
            "name": "Yoga Studio",
            "keywords": [
                "yoga", "yoga studio", "hot yoga", "vinyasa", "hatha",
                "pilates", "meditation studio", "mindfulness", "ashtanga",
            ],
            "required_entities": [
                {
                    "name": "ClassType",
                    "must_have_fields": [
                        {"name": "class_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "style", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "level", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 60", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "heated", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                        {"name": "props_needed", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Schedule",
                    "must_have_fields": [
                        {"name": "class_type_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "instructor", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "day_of_week", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "start_time", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "room", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "max_students", "db_type": "INT NOT NULL DEFAULT 25", "ts_type": "number"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "MeditationSession",
                    "must_have_fields": [
                        {"name": "session_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "instructor", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "difficulty", "db_type": "VARCHAR(30) DEFAULT 'all levels'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Classes Today", "Students This Week", "Most Popular Class",
                "Instructor Hours", "Membership Revenue", "Class Fill Rate",
            ],
            "suggested_workflows": [
                "class_booking", "instructor_scheduling",
                "membership_management", "waitlist_handling",
            ],
            "design_hint": "Calming, serene. Soft purples, sage greens, warm creams. Light, airy layout. Elegant font.",
        },

        "personal_training": {
            "name": "Personal Training Studio",
            "keywords": [
                "personal training", "personal trainer", "pt studio",
                "1-on-1 training", "fitness coaching", "strength training",
                "body transformation", "fitness studio",
            ],
            "required_entities": [
                {
                    "name": "WorkoutPlan",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "plan_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "goal", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "exercises_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "frequency_per_week", "db_type": "INT NOT NULL DEFAULT 3", "ts_type": "number"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ProgressLog",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "exercise", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "sets", "db_type": "INT", "ts_type": "number"},
                        {"name": "reps", "db_type": "INT", "ts_type": "number"},
                        {"name": "weight_lbs", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "duration_sec", "db_type": "INT", "ts_type": "number"},
                        {"name": "trainer_notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "BodyMeasurement",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "weight_lbs", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "body_fat_percent", "db_type": "DECIMAL(5,2)", "ts_type": "number"},
                        {"name": "chest_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "waist_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "hips_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "bicep_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "thigh_in", "db_type": "DECIMAL(5,1)", "ts_type": "number"},
                        {"name": "photo_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Sessions Today", "Active Clients", "Avg Progress Score",
                "Measurements Taken This Month", "Revenue This Month", "Client Retention",
            ],
            "suggested_workflows": [
                "workout_plan_creation", "progress_photo_tracking",
                "body_measurement_schedule", "client_goal_review",
            ],
            "design_hint": "Modern, motivational. Dark or bold color scheme. Strong contrasts. Clean data-driven layout.",
        },

        "martial_arts": {
            "name": "Martial Arts School",
            "keywords": [
                "martial arts", "karate", "jiu jitsu", "bjj", "taekwondo",
                "mma", "kung fu", "boxing gym", "kickboxing", "dojo",
                "muay thai", "judo",
            ],
            "required_entities": [
                {
                    "name": "Student",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "belt_rank", "db_type": "VARCHAR(40) NOT NULL DEFAULT 'white'", "ts_type": "string"},
                        {"name": "stripes", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "join_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE", "ts_type": "string"},
                        {"name": "emergency_contact", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "BeltPromotion",
                    "must_have_fields": [
                        {"name": "student_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "from_rank", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "to_rank", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "promoted_by", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Technique",
                    "must_have_fields": [
                        {"name": "technique_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "belt_level", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "video_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "SparringRecord",
                    "must_have_fields": [
                        {"name": "student_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "opponent_id", "db_type": "UUID", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "rounds", "db_type": "INT NOT NULL DEFAULT 3", "ts_type": "number"},
                        {"name": "result", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "techniques_used", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "coach_notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Active Students", "Promotions This Month", "Classes This Week",
                "Belt Distribution", "Attendance Rate", "Upcoming Tests",
            ],
            "suggested_workflows": [
                "belt_promotion_tracking", "technique_curriculum",
                "sparring_pairing", "attendance_tracking",
            ],
            "design_hint": "Bold, disciplined. Dark background with red or gold accents. Strong typography. Traditional feel.",
        },
    },

    # ======================================================================
    # REAL ESTATE
    # ======================================================================
    "real_estate": {

        "residential": {
            "name": "Residential Real Estate",
            "keywords": [
                "residential", "home sales", "realtor", "real estate agent",
                "house listing", "home buying", "single family", "condo",
                "townhouse", "mls listing",
            ],
            "required_entities": [
                {
                    "name": "Listing",
                    "must_have_fields": [
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "city", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "state", "db_type": "VARCHAR(2) NOT NULL", "ts_type": "string"},
                        {"name": "zip", "db_type": "VARCHAR(10) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(14,2) NOT NULL", "ts_type": "number"},
                        {"name": "bedrooms", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "bathrooms", "db_type": "DECIMAL(3,1) NOT NULL", "ts_type": "number"},
                        {"name": "sqft", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "lot_size_acres", "db_type": "DECIMAL(8,2)", "ts_type": "number"},
                        {"name": "year_built", "db_type": "INT", "ts_type": "number"},
                        {"name": "property_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "mls_number", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "listing_agent", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "PropertyFeature",
                    "must_have_fields": [
                        {"name": "listing_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "feature_category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "feature_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "details", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Neighborhood",
                    "must_have_fields": [
                        {"name": "neighborhood_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "city", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "walkability_score", "db_type": "INT", "ts_type": "number"},
                        {"name": "school_rating", "db_type": "INT", "ts_type": "number"},
                        {"name": "median_home_price", "db_type": "DECIMAL(14,2)", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Showing",
                    "must_have_fields": [
                        {"name": "listing_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "buyer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "agent", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "feedback", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "interest_level", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Active Listings", "Avg Days on Market", "Total Portfolio Value",
                "Showings This Week", "Pending Offers", "Sold This Month",
            ],
            "suggested_workflows": [
                "listing_creation", "showing_scheduling",
                "offer_management", "closing_checklist",
            ],
            "design_hint": "Professional blues and neutrals. Clean, trustworthy feel. Good imagery support. Modern font.",
        },

        "commercial": {
            "name": "Commercial Real Estate",
            "keywords": [
                "commercial real estate", "office space", "retail space",
                "commercial lease", "commercial property", "warehouse",
                "industrial", "cre", "commercial listing",
            ],
            "required_entities": [
                {
                    "name": "Property",
                    "must_have_fields": [
                        {"name": "property_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "property_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "total_sqft", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "available_sqft", "db_type": "INT", "ts_type": "number"},
                        {"name": "price_per_sqft", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "zoning", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "year_built", "db_type": "INT", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'available'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Lease",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tenant_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "lease_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "monthly_rent", "db_type": "DECIMAL(12,2) NOT NULL", "ts_type": "number"},
                        {"name": "sqft_leased", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "escalation_percent", "db_type": "DECIMAL(5,2)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Tenant",
                    "must_have_fields": [
                        {"name": "company_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "contact_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "industry", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "credit_rating", "db_type": "VARCHAR(10)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Occupancy Rate", "Revenue per Sqft", "Lease Expirations (90 days)",
                "Vacant Space", "Total NOI", "Avg Lease Duration",
            ],
            "suggested_workflows": [
                "lease_negotiation", "tenant_screening",
                "rent_escalation", "vacancy_marketing",
            ],
            "design_hint": "Corporate, polished. Dark navy or charcoal. Professional serif or clean sans-serif. Data-dense.",
        },

        "property_management": {
            "name": "Property Management Company",
            "keywords": [
                "property management", "landlord", "rental management",
                "apartment management", "tenant management", "rent collection",
                "maintenance requests", "property manager",
            ],
            "required_entities": [
                {
                    "name": "Unit",
                    "must_have_fields": [
                        {"name": "property_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "unit_number", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "bedrooms", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "bathrooms", "db_type": "DECIMAL(3,1) NOT NULL", "ts_type": "number"},
                        {"name": "sqft", "db_type": "INT", "ts_type": "number"},
                        {"name": "rent_amount", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'vacant'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "MaintenanceRequest",
                    "must_have_fields": [
                        {"name": "unit_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tenant_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "title", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "priority", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'medium'", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'open'", "ts_type": "string"},
                        {"name": "assigned_to", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "completed_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
                {
                    "name": "RentPayment",
                    "must_have_fields": [
                        {"name": "unit_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tenant_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "amount", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "due_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "paid_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "payment_method", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'pending'", "ts_type": "string"},
                        {"name": "late_fee", "db_type": "DECIMAL(10,2) DEFAULT 0", "ts_type": "number"},
                    ],
                },
                {
                    "name": "LeaseAgreement",
                    "must_have_fields": [
                        {"name": "unit_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tenant_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "monthly_rent", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "security_deposit", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "document_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Occupancy Rate", "Rent Collected This Month", "Open Maintenance",
                "Overdue Payments", "Leases Expiring Soon", "Total Units",
            ],
            "suggested_workflows": [
                "maintenance_dispatch", "rent_collection",
                "lease_renewal", "move_in_move_out",
            ],
            "design_hint": "Practical, organized. Blue-gray tones. Dashboard-heavy layout. Clear status indicators.",
        },

        "vacation_rental": {
            "name": "Vacation Rental / Airbnb Management",
            "keywords": [
                "vacation rental", "airbnb", "vrbo", "short term rental",
                "holiday rental", "beach house", "cabin rental",
                "rental management", "vacation property",
            ],
            "required_entities": [
                {
                    "name": "Property",
                    "must_have_fields": [
                        {"name": "property_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "bedrooms", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "bathrooms", "db_type": "DECIMAL(3,1) NOT NULL", "ts_type": "number"},
                        {"name": "max_guests", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "base_nightly_rate", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "cleaning_fee", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "amenities_json", "db_type": "JSONB", "ts_type": "object"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Booking",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "guest_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "check_in", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "check_out", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "guests", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "total_amount", "db_type": "DECIMAL(12,2) NOT NULL", "ts_type": "number"},
                        {"name": "source", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'confirmed'", "ts_type": "string"},
                        {"name": "special_requests", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "PricingSeason",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "season_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "nightly_rate", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "min_nights", "db_type": "INT NOT NULL DEFAULT 1", "ts_type": "number"},
                    ],
                },
                {
                    "name": "CleaningSchedule",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "cleaner_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "check_out_guest", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "check_in_guest", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Bookings This Month", "Occupancy Rate", "Revenue This Month",
                "Upcoming Check-ins", "Cleaning Tasks Today", "Avg Nightly Rate",
            ],
            "suggested_workflows": [
                "booking_confirmation", "cleaning_dispatch",
                "seasonal_pricing_update", "guest_communication",
            ],
            "design_hint": "Warm, inviting. Sunset oranges, ocean blues, or forest greens. Friendly, visual layout.",
        },
    },

    # ======================================================================
    # E-COMMERCE
    # ======================================================================
    "ecommerce": {

        "fashion": {
            "name": "Fashion / Apparel Store",
            "keywords": [
                "fashion", "clothing", "apparel", "boutique", "garment",
                "fashion store", "online clothing", "streetwear",
                "designer", "wardrobe", "outfit",
            ],
            "required_entities": [
                {
                    "name": "Product",
                    "must_have_fields": [
                        {"name": "product_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "sku", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "material", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "image_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ProductVariant",
                    "must_have_fields": [
                        {"name": "product_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "size", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "color", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "sku_variant", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "stock_quantity", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "price_override", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Order",
                    "must_have_fields": [
                        {"name": "order_number", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "subtotal", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "shipping", "db_type": "DECIMAL(10,2) NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "total", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'pending'", "ts_type": "string"},
                        {"name": "tracking_number", "db_type": "VARCHAR(100)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "OutfitSuggestion",
                    "must_have_fields": [
                        {"name": "outfit_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "products_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "occasion", "db_type": "VARCHAR(80)", "ts_type": "string"},
                        {"name": "season", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "image_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Orders Today", "Revenue This Week", "Low Stock Alerts",
                "Top Selling Products", "Return Rate", "Avg Order Value",
            ],
            "suggested_workflows": [
                "order_fulfillment", "inventory_management",
                "return_processing", "outfit_curation",
            ],
            "design_hint": "Trendy, editorial. Black and white with a bold accent. Fashion-forward font. Minimal layout.",
        },

        "electronics": {
            "name": "Electronics Store",
            "keywords": [
                "electronics", "tech store", "gadgets", "computer store",
                "phone store", "electronics shop", "hardware store",
                "tech products", "consumer electronics",
            ],
            "required_entities": [
                {
                    "name": "Product",
                    "must_have_fields": [
                        {"name": "product_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "sku", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "brand", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "specs_json", "db_type": "JSONB", "ts_type": "object"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "stock_quantity", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "image_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Warranty",
                    "must_have_fields": [
                        {"name": "product_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "purchase_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "warranty_type", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "expiration_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "serial_number", "db_type": "VARCHAR(100)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "claim_count", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Compatibility",
                    "must_have_fields": [
                        {"name": "product_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "compatible_with", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "compatibility_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "verified", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Orders Today", "Revenue This Week", "Low Stock Products",
                "Warranty Claims", "Top Categories", "Avg Order Value",
            ],
            "suggested_workflows": [
                "order_processing", "warranty_claim_handling",
                "compatibility_verification", "price_comparison_update",
            ],
            "design_hint": "Tech-forward, sleek. Dark or midnight theme. Blue/purple accents. Space Grotesk or similar.",
        },

        "food_delivery": {
            "name": "Food Delivery Service",
            "keywords": [
                "food delivery", "meal delivery", "delivery service",
                "online ordering", "restaurant delivery", "cloud kitchen",
                "ghost kitchen", "delivery app",
            ],
            "required_entities": [
                {
                    "name": "Order",
                    "must_have_fields": [
                        {"name": "order_number", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "customer_phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "delivery_address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "subtotal", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "delivery_fee", "db_type": "DECIMAL(10,2) NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "total", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "prep_time_minutes", "db_type": "INT", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'received'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "DeliveryZone",
                    "must_have_fields": [
                        {"name": "zone_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "radius_miles", "db_type": "DECIMAL(5,1) NOT NULL", "ts_type": "number"},
                        {"name": "delivery_fee", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "estimated_time_minutes", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "min_order", "db_type": "DECIMAL(10,2) DEFAULT 0", "ts_type": "number"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Driver",
                    "must_have_fields": [
                        {"name": "driver_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "vehicle_type", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "license_plate", "db_type": "VARCHAR(20)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'available'", "ts_type": "string"},
                        {"name": "current_order_id", "db_type": "UUID", "ts_type": "string"},
                        {"name": "rating", "db_type": "DECIMAL(3,2)", "ts_type": "number"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Active Orders", "Drivers Available", "Avg Delivery Time",
                "Orders Today", "Revenue Today", "Customer Satisfaction",
            ],
            "suggested_workflows": [
                "order_dispatch", "driver_assignment",
                "delivery_tracking", "zone_management",
            ],
            "design_hint": "Energetic, warm. Orange/red primary. Clean and fast-feeling. Good status visualization.",
        },

        "subscription_box": {
            "name": "Subscription Box Service",
            "keywords": [
                "subscription box", "subscription service", "monthly box",
                "curated box", "subscription", "box service",
                "membership box", "recurring delivery",
            ],
            "required_entities": [
                {
                    "name": "SubscriptionTier",
                    "must_have_fields": [
                        {"name": "tier_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "price_monthly", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "items_per_box", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "retail_value_min", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Subscriber",
                    "must_have_fields": [
                        {"name": "name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string"},
                        {"name": "tier_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "shipping_address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "preferences_json", "db_type": "JSONB", "ts_type": "object"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "next_billing_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                    ],
                },
                {
                    "name": "CuratedBox",
                    "must_have_fields": [
                        {"name": "box_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "month", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "tier_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "items_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "theme", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "retail_value", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'draft'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Shipment",
                    "must_have_fields": [
                        {"name": "subscriber_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "box_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "ship_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "tracking_number", "db_type": "VARCHAR(100)", "ts_type": "string"},
                        {"name": "carrier", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'pending'", "ts_type": "string"},
                        {"name": "delivered_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Active Subscribers", "MRR", "Churn Rate",
                "Boxes Shipped This Month", "Pending Shipments", "Avg Subscriber Lifetime",
            ],
            "suggested_workflows": [
                "box_curation", "shipment_batch_processing",
                "subscription_billing", "preference_collection",
            ],
            "design_hint": "Fun, branded. Vibrant accent color. Gift-like aesthetic. Rounded, playful UI elements.",
        },
    },

    # ======================================================================
    # EDUCATION
    # ======================================================================
    "education": {

        "k12_school": {
            "name": "K-12 School",
            "keywords": [
                "school", "k-12", "k12", "elementary", "middle school",
                "high school", "school management", "student information",
                "school admin", "education management",
            ],
            "required_entities": [
                {
                    "name": "Student",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "student_id", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "grade", "db_type": "VARCHAR(10) NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "parent_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "parent_phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "parent_email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'enrolled'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Attendance",
                    "must_have_fields": [
                        {"name": "student_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'present'", "ts_type": "string"},
                        {"name": "period", "db_type": "VARCHAR(20)", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "recorded_by", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ReportCard",
                    "must_have_fields": [
                        {"name": "student_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "term", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "year", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "grades_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "gpa", "db_type": "DECIMAL(4,2)", "ts_type": "number"},
                        {"name": "teacher_comments", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "conduct", "db_type": "VARCHAR(30)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "BusRoute",
                    "must_have_fields": [
                        {"name": "route_name", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "bus_number", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "driver_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "stops_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "morning_departure", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "afternoon_departure", "db_type": "TIME NOT NULL", "ts_type": "string"},
                        {"name": "active", "db_type": "BOOLEAN NOT NULL DEFAULT true", "ts_type": "boolean"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Total Enrollment", "Attendance Rate Today", "Avg GPA",
                "Absent Today", "Bus Routes Active", "Parent Contacts",
            ],
            "suggested_workflows": [
                "daily_attendance", "report_card_generation",
                "parent_notification", "bus_route_management",
            ],
            "design_hint": "Friendly, educational. Bright but not childish. Blues and greens. Rounded, approachable layout.",
        },

        "online_courses": {
            "name": "Online Course Platform",
            "keywords": [
                "online courses", "e-learning", "online education",
                "course platform", "learning management", "lms",
                "online class", "video courses", "mooc",
            ],
            "required_entities": [
                {
                    "name": "Course",
                    "must_have_fields": [
                        {"name": "title", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "instructor", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "level", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "duration_hours", "db_type": "DECIMAL(6,1)", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'draft'", "ts_type": "string"},
                        {"name": "thumbnail_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Lesson",
                    "must_have_fields": [
                        {"name": "course_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "title", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "order_index", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "video_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT", "ts_type": "number"},
                        {"name": "content_text", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "is_preview", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Quiz",
                    "must_have_fields": [
                        {"name": "course_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "title", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "questions_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "passing_score", "db_type": "INT NOT NULL DEFAULT 70", "ts_type": "number"},
                        {"name": "time_limit_minutes", "db_type": "INT", "ts_type": "number"},
                        {"name": "attempts_allowed", "db_type": "INT NOT NULL DEFAULT 3", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Certificate",
                    "must_have_fields": [
                        {"name": "student_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "course_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "issued_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "certificate_number", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "final_score", "db_type": "INT", "ts_type": "number"},
                        {"name": "certificate_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Enrollment",
                    "must_have_fields": [
                        {"name": "student_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string"},
                        {"name": "course_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "enrolled_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string"},
                        {"name": "progress_percent", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "last_accessed", "db_type": "TIMESTAMPTZ", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Total Enrollments", "Course Completion Rate", "Revenue This Month",
                "Active Students", "Certificates Issued", "Avg Quiz Score",
            ],
            "suggested_workflows": [
                "course_publishing", "enrollment_tracking",
                "quiz_grading", "certificate_generation",
            ],
            "design_hint": "Modern, knowledge-focused. Indigo/purple primary. Clean, structured layout. Progress-oriented.",
        },

        "tutoring": {
            "name": "Tutoring Service",
            "keywords": [
                "tutoring", "tutor", "private lessons", "academic help",
                "test prep", "homework help", "tutoring center",
                "private tutor", "math tutor",
            ],
            "required_entities": [
                {
                    "name": "TutorSession",
                    "must_have_fields": [
                        {"name": "student_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "tutor_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "subject", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 60", "ts_type": "number"},
                        {"name": "location_type", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'online'", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'scheduled'", "ts_type": "string"},
                        {"name": "session_notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "rate", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Tutor",
                    "must_have_fields": [
                        {"name": "name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "subjects_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "hourly_rate", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "bio", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "rating", "db_type": "DECIMAL(3,2)", "ts_type": "number"},
                        {"name": "availability_json", "db_type": "JSONB", "ts_type": "object"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Student",
                    "must_have_fields": [
                        {"name": "name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "parent_name", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "parent_phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "grade_level", "db_type": "VARCHAR(20)", "ts_type": "string"},
                        {"name": "subjects_needed", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Sessions Today", "Active Students", "Revenue This Week",
                "Top Subjects", "Tutor Utilization", "Avg Session Rating",
            ],
            "suggested_workflows": [
                "session_booking", "tutor_matching",
                "billing_and_invoicing", "progress_reporting",
            ],
            "design_hint": "Approachable, academic. Teal or green primary. Warm, encouraging feel. Clean scheduling view.",
        },
    },

    # ======================================================================
    # SALON / BEAUTY
    # ======================================================================
    "salon": {

        "hair_salon": {
            "name": "Hair Salon",
            "keywords": [
                "hair salon", "hairdresser", "barber", "barbershop",
                "hair stylist", "hair cut", "hair color", "blow dry",
                "salon", "beauty parlor",
            ],
            "required_entities": [
                {
                    "name": "Client",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "hair_type", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "hair_texture", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "preferred_stylist", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ColorHistory",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "color_formula", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "brand", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "processing_time", "db_type": "INT", "ts_type": "number"},
                        {"name": "result", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "stylist", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "photo_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Appointment",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "stylist", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "service", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 60", "ts_type": "number"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'booked'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Product",
                    "must_have_fields": [
                        {"name": "product_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "brand", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "stock_quantity", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "for_hair_type", "db_type": "VARCHAR(100)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Revenue This Week", "Top Stylist",
                "Product Sales", "Client Retention", "No-Show Rate",
            ],
            "suggested_workflows": [
                "appointment_booking", "color_formula_tracking",
                "product_recommendation", "loyalty_rewards",
            ],
            "design_hint": "Stylish, trendy. Rose gold, blush, or modern neutrals. Elegant font. Visual, image-friendly.",
        },

        "nail_salon": {
            "name": "Nail Salon",
            "keywords": [
                "nail salon", "nails", "manicure", "pedicure",
                "nail art", "gel nails", "acrylic nails", "nail tech",
                "nail studio",
            ],
            "required_entities": [
                {
                    "name": "Client",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "preferred_tech", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "allergies", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "design_preferences", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "NailArtGallery",
                    "must_have_fields": [
                        {"name": "design_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "image_url", "db_type": "VARCHAR(500) NOT NULL", "ts_type": "string"},
                        {"name": "difficulty", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "base_price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "description", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "tech_name", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "PolishInventory",
                    "must_have_fields": [
                        {"name": "brand", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "color_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "color_code", "db_type": "VARCHAR(20)", "ts_type": "string"},
                        {"name": "type", "db_type": "VARCHAR(40) NOT NULL", "ts_type": "string"},
                        {"name": "quantity", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "popular", "db_type": "BOOLEAN NOT NULL DEFAULT false", "ts_type": "boolean"},
                    ],
                },
                {
                    "name": "Appointment",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "tech_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "services_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "date_time", "db_type": "TIMESTAMPTZ NOT NULL", "ts_type": "string"},
                        {"name": "duration_minutes", "db_type": "INT NOT NULL DEFAULT 60", "ts_type": "number"},
                        {"name": "total_price", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'booked'", "ts_type": "string"},
                        {"name": "design_reference_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Revenue This Week", "Popular Designs",
                "Polish Stock Low", "Top Nail Tech", "Avg Ticket Size",
            ],
            "suggested_workflows": [
                "appointment_booking", "design_consultation",
                "polish_inventory_tracking", "client_gallery_review",
            ],
            "design_hint": "Playful, feminine. Pink, lavender, or pastel palette. Rounded UI. Image-gallery friendly.",
        },

        "med_spa": {
            "name": "Medical Spa / Aesthetics Clinic",
            "keywords": [
                "med spa", "medical spa", "aesthetics", "botox", "filler",
                "laser treatment", "skin care clinic", "cosmetic",
                "dermatology spa", "wellness spa", "anti-aging",
            ],
            "required_entities": [
                {
                    "name": "Client",
                    "must_have_fields": [
                        {"name": "first_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "last_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "date_of_birth", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "skin_type", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "allergies", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "medical_history", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Treatment",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "treatment_type", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "provider", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "areas_treated", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "units_or_amount", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "follow_up_date", "db_type": "DATE", "ts_type": "string"},
                    ],
                },
                {
                    "name": "BeforeAfterPhoto",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "treatment_id", "db_type": "UUID", "ts_type": "string"},
                        {"name": "photo_type", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "photo_url", "db_type": "VARCHAR(500) NOT NULL", "ts_type": "string"},
                        {"name": "date_taken", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "angle", "db_type": "VARCHAR(30)", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ConsentForm",
                    "must_have_fields": [
                        {"name": "client_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "treatment_type", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "signed_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "document_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                        {"name": "witnessed_by", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "expires_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'signed'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Appointments Today", "Revenue This Month", "Top Treatments",
                "Consent Forms Expiring", "Client Retention", "Avg Treatment Value",
            ],
            "suggested_workflows": [
                "treatment_consultation", "consent_form_collection",
                "before_after_documentation", "follow_up_scheduling",
            ],
            "design_hint": "Luxurious, clean. White/cream with gold or rose-gold accents. Elegant serif font. Premium feel.",
        },
    },

    # ======================================================================
    # CONSTRUCTION
    # ======================================================================
    "construction": {

        "general_contractor": {
            "name": "General Contractor",
            "keywords": [
                "general contractor", "construction", "builder", "home builder",
                "renovation", "remodel", "construction company",
                "building contractor", "gc", "home renovation",
            ],
            "required_entities": [
                {
                    "name": "Project",
                    "must_have_fields": [
                        {"name": "project_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "client_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "project_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "budget", "db_type": "DECIMAL(14,2) NOT NULL", "ts_type": "number"},
                        {"name": "start_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "target_end_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'planning'", "ts_type": "string"},
                        {"name": "actual_cost", "db_type": "DECIMAL(14,2) DEFAULT 0", "ts_type": "number"},
                    ],
                },
                {
                    "name": "ProjectPhase",
                    "must_have_fields": [
                        {"name": "project_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "phase_name", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "order_index", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "start_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "end_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "progress_percent", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'not_started'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Permit",
                    "must_have_fields": [
                        {"name": "project_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "permit_type", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "permit_number", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "issuing_authority", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "application_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "approval_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "expiration_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'applied'", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "Subcontractor",
                    "must_have_fields": [
                        {"name": "company_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "contact_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "trade", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "email", "db_type": "VARCHAR(255)", "ts_type": "string"},
                        {"name": "license_number", "db_type": "VARCHAR(60)", "ts_type": "string"},
                        {"name": "insurance_expiry", "db_type": "DATE", "ts_type": "string"},
                        {"name": "rating", "db_type": "DECIMAL(3,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "MaterialOrder",
                    "must_have_fields": [
                        {"name": "project_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "material_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "quantity", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "unit", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "supplier", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(12,2) NOT NULL", "ts_type": "number"},
                        {"name": "order_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "delivery_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'ordered'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Active Projects", "Total Budget vs Spent", "Permits Pending",
                "Phases Behind Schedule", "Material Orders Due", "Subcontractor Count",
            ],
            "suggested_workflows": [
                "project_phase_management", "permit_tracking",
                "material_ordering", "subcontractor_scheduling",
            ],
            "design_hint": "Rugged, professional. Dark grays, orange/yellow accents. Bold font. Data-dense dashboard.",
        },

        "plumbing_hvac": {
            "name": "Plumbing / HVAC Service",
            "keywords": [
                "plumbing", "plumber", "hvac", "heating", "cooling",
                "air conditioning", "furnace", "water heater",
                "pipe", "drain", "ac repair",
            ],
            "required_entities": [
                {
                    "name": "ServiceCall",
                    "must_have_fields": [
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "phone", "db_type": "VARCHAR(30) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "issue_description", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "service_type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "priority", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'normal'", "ts_type": "string"},
                        {"name": "assigned_tech", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "scheduled_date", "db_type": "TIMESTAMPTZ", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'new'", "ts_type": "string"},
                        {"name": "cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                    ],
                },
                {
                    "name": "PartsInventory",
                    "must_have_fields": [
                        {"name": "part_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "part_number", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "category", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "quantity_on_hand", "db_type": "INT NOT NULL DEFAULT 0", "ts_type": "number"},
                        {"name": "reorder_level", "db_type": "INT NOT NULL DEFAULT 5", "ts_type": "number"},
                        {"name": "cost_per_unit", "db_type": "DECIMAL(10,2) NOT NULL", "ts_type": "number"},
                        {"name": "supplier", "db_type": "VARCHAR(200)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "WarrantyRecord",
                    "must_have_fields": [
                        {"name": "service_call_id", "db_type": "UUID", "ts_type": "string"},
                        {"name": "customer_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "equipment_type", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "brand_model", "db_type": "VARCHAR(200)", "ts_type": "string"},
                        {"name": "install_date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "warranty_expiry", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "coverage_details", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "serial_number", "db_type": "VARCHAR(100)", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Open Service Calls", "Jobs Today", "Parts Low Stock",
                "Revenue This Week", "Warranties Expiring", "Avg Job Time",
            ],
            "suggested_workflows": [
                "service_dispatch", "parts_reordering",
                "warranty_tracking", "invoice_generation",
            ],
            "design_hint": "Practical, blue-collar. Blue and gray tones. Clean, functional layout. Easy mobile view.",
        },

        "landscaping": {
            "name": "Landscaping Company",
            "keywords": [
                "landscaping", "lawn care", "garden", "yard maintenance",
                "landscape design", "lawn service", "tree service",
                "irrigation", "hardscape", "outdoor living",
            ],
            "required_entities": [
                {
                    "name": "Property",
                    "must_have_fields": [
                        {"name": "client_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "address", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "lot_size_sqft", "db_type": "INT", "ts_type": "number"},
                        {"name": "service_frequency", "db_type": "VARCHAR(60) NOT NULL", "ts_type": "string"},
                        {"name": "monthly_rate", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "special_instructions", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'active'", "ts_type": "string"},
                        {"name": "property_map_url", "db_type": "VARCHAR(500)", "ts_type": "string"},
                    ],
                },
                {
                    "name": "SeasonalPlan",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "season", "db_type": "VARCHAR(20) NOT NULL", "ts_type": "string"},
                        {"name": "year", "db_type": "INT NOT NULL", "ts_type": "number"},
                        {"name": "services_json", "db_type": "JSONB NOT NULL", "ts_type": "object"},
                        {"name": "estimated_cost", "db_type": "DECIMAL(10,2)", "ts_type": "number"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'planned'", "ts_type": "string"},
                    ],
                },
                {
                    "name": "Equipment",
                    "must_have_fields": [
                        {"name": "equipment_name", "db_type": "VARCHAR(200) NOT NULL", "ts_type": "string"},
                        {"name": "type", "db_type": "VARCHAR(80) NOT NULL", "ts_type": "string"},
                        {"name": "purchase_date", "db_type": "DATE", "ts_type": "string"},
                        {"name": "last_maintenance", "db_type": "DATE", "ts_type": "string"},
                        {"name": "next_maintenance_due", "db_type": "DATE", "ts_type": "string"},
                        {"name": "condition", "db_type": "VARCHAR(30) NOT NULL DEFAULT 'good'", "ts_type": "string"},
                        {"name": "assigned_crew", "db_type": "VARCHAR(120)", "ts_type": "string"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                    ],
                },
                {
                    "name": "ServiceVisit",
                    "must_have_fields": [
                        {"name": "property_id", "db_type": "UUID NOT NULL", "ts_type": "string"},
                        {"name": "date", "db_type": "DATE NOT NULL", "ts_type": "string"},
                        {"name": "crew", "db_type": "VARCHAR(120) NOT NULL", "ts_type": "string"},
                        {"name": "services_performed", "db_type": "TEXT NOT NULL", "ts_type": "string"},
                        {"name": "duration_hours", "db_type": "DECIMAL(4,1)", "ts_type": "number"},
                        {"name": "photos_json", "db_type": "JSONB", "ts_type": "object"},
                        {"name": "notes", "db_type": "TEXT", "ts_type": "string"},
                        {"name": "status", "db_type": "VARCHAR(50) NOT NULL DEFAULT 'completed'", "ts_type": "string"},
                    ],
                },
            ],
            "suggested_dashboard": [
                "Jobs Today", "Active Properties", "Revenue This Month",
                "Equipment Due Maintenance", "Seasonal Plans Active", "Crew Utilization",
            ],
            "suggested_workflows": [
                "route_scheduling", "seasonal_plan_creation",
                "equipment_maintenance_tracking", "client_billing",
            ],
            "design_hint": "Natural, earthy. Greens and browns. Outdoor feel. Clean routing/scheduling layout.",
        },
    },
}


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """Lowercase and collapse whitespace for keyword matching."""
    return re.sub(r"\s+", " ", text.lower().strip())


def detect_subtype(prompt: str, domain: str | None = None) -> dict | None:
    """
    Analyze the user prompt and return the best matching industry sub-type.

    Parameters
    ----------
    prompt : str
        The raw user prompt describing the app they want built.
    domain : str | None
        Optional broad domain hint (e.g. "restaurant", "medical").
        If provided, only sub-types within that domain are searched.

    Returns
    -------
    dict | None
        The full sub-type definition dict (with an extra ``"domain"`` and
        ``"subtype_key"`` injected), or ``None`` if nothing matched.
    """
    norm = _normalize(prompt)

    best_match: dict | None = None
    best_score: int = 0

    domains_to_search = (
        {domain: INDUSTRY_SUBTYPES[domain]}
        if domain and domain in INDUSTRY_SUBTYPES
        else INDUSTRY_SUBTYPES
    )

    for domain_key, subtypes in domains_to_search.items():
        for subtype_key, definition in subtypes.items():
            score = 0
            for kw in definition["keywords"]:
                if kw in norm:
                    # Longer keyword matches are more specific and valuable
                    score += len(kw.split())
            if score > best_score:
                best_score = score
                best_match = {
                    **definition,
                    "domain": domain_key,
                    "subtype_key": subtype_key,
                }

    return best_match


def get_required_fields_context(prompt: str, domain: str | None = None) -> str:
    """
    Return a formatted string to inject into the AI system prompt, listing
    required entities and fields for the detected sub-type.

    If no sub-type is detected, returns an empty string so the AI still
    works with its generic logic.

    Parameters
    ----------
    prompt : str
        The raw user prompt.
    domain : str | None
        Optional domain hint.

    Returns
    -------
    str
        A block of text ready to inject into the system prompt.
    """
    subtype = detect_subtype(prompt, domain)
    if subtype is None:
        return ""

    lines: list[str] = []
    lines.append(f"## INDUSTRY SUB-TYPE DETECTED: {subtype['name']}")
    lines.append(f"Domain: {subtype['domain']} | Sub-type: {subtype['subtype_key']}")
    lines.append("")
    lines.append(f"Design hint: {subtype['design_hint']}")
    lines.append("")

    # Required entities and fields
    lines.append("### REQUIRED ENTITIES (you MUST include all of these)")
    for entity in subtype["required_entities"]:
        lines.append(f"\n**{entity['name']}**")
        lines.append("Required fields:")
        for field in entity["must_have_fields"]:
            lines.append(f"  - {field['name']} ({field['db_type']}, ts: {field['ts_type']})")

    # Dashboard
    lines.append("")
    lines.append("### SUGGESTED DASHBOARD KPIs")
    for kpi in subtype["suggested_dashboard"]:
        lines.append(f"  - {kpi}")

    # Workflows
    if "suggested_workflows" in subtype:
        lines.append("")
        lines.append("### SUGGESTED WORKFLOWS")
        for wf in subtype["suggested_workflows"]:
            lines.append(f"  - {wf}")

    lines.append("")
    lines.append("IMPORTANT: All entities and fields listed above are MANDATORY.")
    lines.append("You may add MORE entities and fields, but you must NOT omit any listed above.")

    return "\n".join(lines)
