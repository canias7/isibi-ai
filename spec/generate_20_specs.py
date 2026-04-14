#!/usr/bin/env python3
"""Generate 20 production-depth spec files with FK relationships, validation,
computed fields, conditional visibility, and enum badge_colors."""

import json
import os

SPEC_DIR = os.path.dirname(os.path.abspath(__file__))

# ── System fields ──────────────────────────────────────────────────────────
SYS_PRE = [
    {"name":"id","db_type":"UUID DEFAULT gen_random_uuid() PRIMARY KEY","ts_type":"string","nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,"input_component":"none","display_component":"text"},
    {"name":"org_id","db_type":"UUID NOT NULL","ts_type":"string","nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,"input_component":"none","display_component":"text"},
]
SYS_POST = [
    {"name":"created_at","db_type":"TIMESTAMPTZ NOT NULL DEFAULT NOW()","ts_type":"string","nullable":False,"editable":False,"show_in_table":True,"show_in_form":False,"input_component":"none","display_component":"datetime"},
    {"name":"updated_at","db_type":"TIMESTAMPTZ NOT NULL DEFAULT NOW()","ts_type":"string","nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,"input_component":"none","display_component":"datetime"},
    {"name":"deleted_at","db_type":"TIMESTAMPTZ","ts_type":"string","nullable":True,"editable":False,"show_in_table":False,"show_in_form":False,"input_component":"none","display_component":"datetime"},
    {"name":"version","db_type":"INTEGER NOT NULL DEFAULT 1","ts_type":"number","nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,"input_component":"none","display_component":"text"},
]

# ── Helper functions ───────────────────────────────────────────────────────
def F(name, db_type="VARCHAR(255) NOT NULL", ts_type="string", nullable=False,
      editable=True, show_in_table=True, show_in_form=True,
      input_component="text_input", display_component="text",
      validation=None, enum_values=None, badge_colors=None,
      conditional_visibility=None, computed=None, default=None,
      sortable=True, filterable=True, is_fk=False, fk_table=None,
      fk_display=None, label=None):
    f = {
        "name": name,
        "db_type": db_type,
        "ts_type": ts_type,
        "nullable": nullable,
        "editable": editable,
        "show_in_table": show_in_table,
        "show_in_form": show_in_form,
        "input_component": input_component,
        "display_component": display_component,
        "sortable": sortable,
        "filterable": filterable,
    }
    if label:
        f["label"] = label
    if default is not None:
        f["default"] = default
    if validation:
        f["validation"] = validation
    if enum_values:
        f["enum_values"] = enum_values
    if badge_colors:
        f["badge_colors"] = badge_colors
    if conditional_visibility:
        f["conditional_visibility"] = conditional_visibility
    if computed:
        f["computed"] = computed
    if is_fk:
        f["is_fk"] = True
        f["fk_table"] = fk_table
        f["fk_display"] = fk_display
    return f

def ENT(name, table, description, fields, foreign_keys=None, computed_fields=None,
        ui_config=None):
    all_fields = SYS_PRE + fields + SYS_POST
    editable_names = [f["name"] for f in fields if f.get("editable", True)]
    table_cols = [f["name"] for f in fields if f.get("show_in_table", True)][:6]
    form_fields = [f["name"] for f in fields if f.get("show_in_form", True)]
    required = [f["name"] for f in fields if not f.get("nullable", True) and f.get("editable", True)]

    if ui_config is None:
        ui_config = {
            "list_view": {
                "layout": "table",
                "columns": table_cols,
                "filters": [],
                "empty_state": {
                    "icon": "Box",
                    "heading": f"No {name}s yet",
                    "subtext": f"Create your first {name.lower()}",
                    "action_label": f"Add {name}"
                }
            },
            "create_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": required
            },
            "edit_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": required,
                "prefilled": True
            },
            "detail_view": {
                "route": f"/{table}/:id",
                "layout": "tabbed",
                "header": {
                    "title_fields": [table_cols[0]] if table_cols else ["id"],
                    "badge_fields": []
                },
                "primary_fields": table_cols[:4],
                "tabs": [
                    {"name": "Overview", "fields": table_cols},
                    {"name": "Details", "fields": form_fields}
                ]
            }
        }

    ent = {
        "name": name,
        "table": table,
        "description": description,
        "fields": all_fields,
        "ui_config": ui_config,
    }
    if foreign_keys:
        ent["foreign_keys"] = foreign_keys
    if computed_fields:
        ent["computed_fields"] = computed_fields
    return ent

def SPEC(app_name, description, entities):
    return {
        "_meta": {"app_name": app_name, "description": description},
        "entities": entities,
    }

def save(filename, spec):
    path = os.path.join(SPEC_DIR, filename)
    with open(path, "w") as f:
        json.dump(spec, f, indent=2)
    print(f"  Wrote {filename} ({len(spec['entities'])} entities)")


# ── 1. salon_booking_spec.json ─────────────────────────────────────────────
def gen_salon_booking():
    return SPEC("Salon Booking", "Hair and beauty salon appointment management", [
        ENT("Client", "clients", "Salon client", [
            F("first_name", "VARCHAR(100) NOT NULL", label="First Name"),
            F("last_name", "VARCHAR(100) NOT NULL", label="Last Name"),
            F("email", "VARCHAR(255)", nullable=True, validation={"pattern": "^[^@]+@[^@]+\\.[^@]+$", "message": "Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern": "^\\+?[0-9\\-\\s]{7,20}$", "message": "Valid phone required"}),
            F("gender", "VARCHAR(20)", nullable=True, input_component="select", enum_values=["female","male","non_binary","prefer_not_to_say"],
              badge_colors={"female":"pink","male":"blue","non_binary":"purple","prefer_not_to_say":"gray"}),
            F("date_of_birth", "DATE", nullable=True, ts_type="string", input_component="date_picker", display_component="date", show_in_table=False),
            F("preferred_stylist_id", "UUID", nullable=True, is_fk=True, fk_table="stylists", fk_display="name", input_component="foreign_key_select", show_in_table=False),
            F("loyalty_points", "INTEGER NOT NULL DEFAULT 0", ts_type="number", editable=False, show_in_form=False, default=0),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select", enum_values=["active","inactive","vip"],
              badge_colors={"active":"green","inactive":"gray","vip":"gold"}, default="active"),
        ], foreign_keys=[
            {"column":"preferred_stylist_id","references":{"table":"stylists","column":"id"}}
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Service", "services", "Salon service offering", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("category", "VARCHAR(50) NOT NULL", input_component="select",
              enum_values=["haircut","coloring","styling","treatment","nails","makeup","spa"],
              badge_colors={"haircut":"blue","coloring":"purple","styling":"pink","treatment":"green","nails":"red","makeup":"orange","spa":"teal"}),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("duration_minutes", "INTEGER NOT NULL", ts_type="number", validation={"min":5,"max":480,"message":"Duration 5-480 mins"}),
            F("price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0,"message":"Price must be positive"}),
            F("is_active", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
            F("skill_level_required", "VARCHAR(20) NOT NULL DEFAULT 'junior'", input_component="select",
              enum_values=["junior","senior","specialist"], badge_colors={"junior":"gray","senior":"blue","specialist":"gold"}),
        ]),

        ENT("Stylist", "stylists", "Salon stylist / staff member", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern": "^[^@]+@[^@]+\\.[^@]+$", "message": "Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern": "^\\+?[0-9\\-\\s]{7,20}$", "message": "Valid phone required"}),
            F("specialization", "VARCHAR(50) NOT NULL", input_component="select",
              enum_values=["hair","nails","makeup","spa","all_rounder"],
              badge_colors={"hair":"blue","nails":"red","makeup":"pink","spa":"teal","all_rounder":"purple"}),
            F("experience_years", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":50}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","busy","on_leave","terminated"],
              badge_colors={"available":"green","busy":"yellow","on_leave":"orange","terminated":"red"}, default="available"),
            F("commission_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, show_in_table=False),
        ]),

        ENT("Appointment", "appointments", "Client appointment booking", [
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="first_name", input_component="foreign_key_select"),
            F("stylist_id", "UUID NOT NULL", is_fk=True, fk_table="stylists", fk_display="name", input_component="foreign_key_select"),
            F("service_id", "UUID NOT NULL", is_fk=True, fk_table="services", fk_display="name", input_component="foreign_key_select"),
            F("appointment_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("start_time", "TIME NOT NULL", input_component="time_picker", display_component="text"),
            F("end_time", "TIME", nullable=True, input_component="time_picker", display_component="text"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","confirmed","in_progress","completed","cancelled","no_show"],
              badge_colors={"scheduled":"blue","confirmed":"green","in_progress":"yellow","completed":"teal","cancelled":"red","no_show":"gray"},
              default="scheduled"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("cancellation_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False, show_in_form=True,
              conditional_visibility={"field":"status","operator":"equals","value":"cancelled"}),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"stylist_id","references":{"table":"stylists","column":"id"}},
            {"column":"service_id","references":{"table":"services","column":"id"}},
        ]),

        ENT("Product", "products", "Retail product sold at salon", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("brand", "VARCHAR(100) NOT NULL"),
            F("category", "VARCHAR(50) NOT NULL", input_component="select",
              enum_values=["shampoo","conditioner","styling","treatment","tools","accessories"],
              badge_colors={"shampoo":"blue","conditioner":"green","styling":"pink","treatment":"purple","tools":"gray","accessories":"orange"}),
            F("sku", "VARCHAR(50) NOT NULL", validation={"pattern":"^[A-Z0-9\\-]+$","message":"SKU must be uppercase alphanumeric"}),
            F("cost_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("retail_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("stock_qty", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("reorder_level", "INTEGER NOT NULL DEFAULT 5", ts_type="number", default=5, show_in_table=False),
        ], computed_fields=[
            {"name":"profit_margin","expression":"ROUND((retail_price - cost_price) / NULLIF(retail_price,0) * 100, 2)","ts_expression":"((retail_price - cost_price) / retail_price * 100).toFixed(2)"}
        ]),

        ENT("Payment", "payments", "Payment for services or products", [
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="first_name", input_component="foreign_key_select"),
            F("appointment_id", "UUID", nullable=True, is_fk=True, fk_table="appointments", fk_display="id", input_component="foreign_key_select"),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0.01,"message":"Amount must be positive"}),
            F("tip_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("payment_method", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["cash","credit_card","debit_card","mobile_pay","gift_card"],
              badge_colors={"cash":"green","credit_card":"blue","debit_card":"purple","mobile_pay":"teal","gift_card":"orange"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'completed'", input_component="select",
              enum_values=["pending","completed","refunded","failed"],
              badge_colors={"pending":"yellow","completed":"green","refunded":"orange","failed":"red"}, default="completed"),
            F("refund_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"refunded"}),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"appointment_id","references":{"table":"appointments","column":"id"}},
        ], computed_fields=[
            {"name":"total_with_tip","expression":"amount + tip_amount","ts_expression":"amount + tip_amount"}
        ]),

        ENT("Review", "reviews", "Client review of service", [
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="first_name", input_component="foreign_key_select"),
            F("stylist_id", "UUID NOT NULL", is_fk=True, fk_table="stylists", fk_display="name", input_component="foreign_key_select"),
            F("appointment_id", "UUID", nullable=True, is_fk=True, fk_table="appointments", fk_display="id", input_component="foreign_key_select"),
            F("rating", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":5,"message":"Rating 1-5"}),
            F("comment", "TEXT", nullable=True, input_component="textarea"),
            F("is_public", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
            F("response", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"is_public","operator":"equals","value":True}),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"stylist_id","references":{"table":"stylists","column":"id"}},
            {"column":"appointment_id","references":{"table":"appointments","column":"id"}},
        ]),
    ])

# ── 2. hotel_management_spec.json ──────────────────────────────────────────
def gen_hotel_management():
    return SPEC("Hotel Management", "Hotel reservation and operations management", [
        ENT("RoomType", "room_types", "Category of hotel room", [
            F("name", "VARCHAR(100) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("base_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("max_occupancy", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":20}),
            F("bed_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["single","double","queen","king","twin","suite"],
              badge_colors={"single":"gray","double":"blue","queen":"purple","king":"gold","twin":"teal","suite":"pink"}),
            F("amenities", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ]),

        ENT("Room", "rooms", "Individual hotel room", [
            F("room_number", "VARCHAR(10) NOT NULL"),
            F("room_type_id", "UUID NOT NULL", is_fk=True, fk_table="room_types", fk_display="name", input_component="foreign_key_select"),
            F("floor", "INTEGER NOT NULL", ts_type="number", validation={"min":0,"max":100}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","occupied","maintenance","reserved","out_of_order"],
              badge_colors={"available":"green","occupied":"red","maintenance":"yellow","reserved":"blue","out_of_order":"gray"}, default="available"),
            F("is_smoking", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("rate_override", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"status","operator":"not_equals","value":"out_of_order"}),
        ], foreign_keys=[
            {"column":"room_type_id","references":{"table":"room_types","column":"id"}}
        ]),

        ENT("Guest", "guests", "Hotel guest", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("id_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["passport","drivers_license","national_id","other"],
              badge_colors={"passport":"blue","drivers_license":"green","national_id":"purple","other":"gray"}),
            F("id_number", "VARCHAR(50) NOT NULL", show_in_table=False),
            F("nationality", "VARCHAR(50)", nullable=True),
            F("vip_level", "VARCHAR(20) NOT NULL DEFAULT 'standard'", input_component="select",
              enum_values=["standard","silver","gold","platinum"],
              badge_colors={"standard":"gray","silver":"blue","gold":"yellow","platinum":"purple"}, default="standard"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Reservation", "reservations", "Room reservation", [
            F("guest_id", "UUID NOT NULL", is_fk=True, fk_table="guests", fk_display="first_name", input_component="foreign_key_select"),
            F("room_id", "UUID NOT NULL", is_fk=True, fk_table="rooms", fk_display="room_number", input_component="foreign_key_select"),
            F("check_in_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("check_out_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("num_guests", "INTEGER NOT NULL DEFAULT 1", ts_type="number", validation={"min":1,"max":10}),
            F("nightly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'confirmed'", input_component="select",
              enum_values=["pending","confirmed","checked_in","checked_out","cancelled","no_show"],
              badge_colors={"pending":"yellow","confirmed":"blue","checked_in":"green","checked_out":"teal","cancelled":"red","no_show":"gray"}, default="confirmed"),
            F("special_requests", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("cancellation_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"cancelled"}),
        ], foreign_keys=[
            {"column":"guest_id","references":{"table":"guests","column":"id"}},
            {"column":"room_id","references":{"table":"rooms","column":"id"}},
        ], computed_fields=[
            {"name":"total_cost","expression":"nightly_rate * (check_out_date - check_in_date)","ts_expression":"nightly_rate * Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / 86400000)"}
        ]),

        ENT("Housekeeping", "housekeeping_tasks", "Room housekeeping task", [
            F("room_id", "UUID NOT NULL", is_fk=True, fk_table="rooms", fk_display="room_number", input_component="foreign_key_select"),
            F("staff_id", "UUID", nullable=True, is_fk=True, fk_table="staff", fk_display="name", input_component="foreign_key_select"),
            F("task_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["daily_clean","deep_clean","turnover","inspection","laundry"],
              badge_colors={"daily_clean":"blue","deep_clean":"purple","turnover":"green","inspection":"yellow","laundry":"teal"}),
            F("scheduled_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","in_progress","completed","skipped"],
              badge_colors={"pending":"yellow","in_progress":"blue","completed":"green","skipped":"gray"}, default="pending"),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'normal'", input_component="select",
              enum_values=["low","normal","high","urgent"],
              badge_colors={"low":"gray","normal":"blue","high":"orange","urgent":"red"}, default="normal"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"room_id","references":{"table":"rooms","column":"id"}},
            {"column":"staff_id","references":{"table":"staff","column":"id"}},
        ]),

        ENT("Billing", "billings", "Guest billing record", [
            F("reservation_id", "UUID NOT NULL", is_fk=True, fk_table="reservations", fk_display="id", input_component="foreign_key_select"),
            F("guest_id", "UUID NOT NULL", is_fk=True, fk_table="guests", fk_display="first_name", input_component="foreign_key_select"),
            F("item_description", "VARCHAR(255) NOT NULL"),
            F("category", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["room","food","beverage","spa","laundry","minibar","parking","other"],
              badge_colors={"room":"blue","food":"green","beverage":"orange","spa":"purple","laundry":"teal","minibar":"pink","parking":"gray","other":"yellow"}),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("tax_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("payment_status", "VARCHAR(20) NOT NULL DEFAULT 'unpaid'", input_component="select",
              enum_values=["unpaid","paid","partial","refunded"],
              badge_colors={"unpaid":"red","paid":"green","partial":"yellow","refunded":"orange"}, default="unpaid"),
            F("payment_method", "VARCHAR(20)", nullable=True, input_component="select",
              enum_values=["cash","credit_card","debit_card","room_charge","comp"],
              badge_colors={"cash":"green","credit_card":"blue","debit_card":"purple","room_charge":"teal","comp":"gray"},
              conditional_visibility={"field":"payment_status","operator":"not_equals","value":"unpaid"}),
        ], foreign_keys=[
            {"column":"reservation_id","references":{"table":"reservations","column":"id"}},
            {"column":"guest_id","references":{"table":"guests","column":"id"}},
        ], computed_fields=[
            {"name":"total_with_tax","expression":"amount + tax_amount","ts_expression":"amount + tax_amount"}
        ]),

        ENT("Staff", "staff", "Hotel staff member", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("department", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["front_desk","housekeeping","maintenance","food_beverage","management","security"],
              badge_colors={"front_desk":"blue","housekeeping":"green","maintenance":"yellow","food_beverage":"orange","management":"purple","security":"red"}),
            F("role", "VARCHAR(50) NOT NULL"),
            F("shift", "VARCHAR(20) NOT NULL DEFAULT 'morning'", input_component="select",
              enum_values=["morning","afternoon","night","flexible"],
              badge_colors={"morning":"yellow","afternoon":"orange","night":"purple","flexible":"blue"}, default="morning"),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}, show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","on_leave","terminated"],
              badge_colors={"active":"green","on_leave":"yellow","terminated":"red"}, default="active"),
        ]),
    ])

# ── 3. school_management_spec.json ─────────────────────────────────────────
def gen_school_management():
    return SPEC("School Management", "K-12 school administration system", [
        ENT("Student", "students", "Enrolled student", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255)", nullable=True, validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("date_of_birth", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("grade_level", "VARCHAR(10) NOT NULL", input_component="select",
              enum_values=["K","1","2","3","4","5","6","7","8","9","10","11","12"],
              badge_colors={"K":"pink","1":"blue","2":"blue","3":"blue","4":"green","5":"green","6":"green","7":"purple","8":"purple","9":"teal","10":"teal","11":"orange","12":"orange"}),
            F("enrollment_status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","withdrawn","graduated","suspended","transferred"],
              badge_colors={"active":"green","withdrawn":"gray","graduated":"blue","suspended":"red","transferred":"yellow"}, default="active"),
            F("parent_id", "UUID", nullable=True, is_fk=True, fk_table="parents", fk_display="first_name", input_component="foreign_key_select"),
            F("medical_notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"parent_id","references":{"table":"parents","column":"id"}}
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Teacher", "teachers", "School teacher", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("subject_specialty", "VARCHAR(50) NOT NULL", input_component="select",
              enum_values=["math","science","english","history","art","music","pe","languages","computer_science"],
              badge_colors={"math":"blue","science":"green","english":"red","history":"orange","art":"pink","music":"purple","pe":"teal","languages":"yellow","computer_science":"gray"}),
            F("hire_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("certification_level", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["provisional","standard","advanced","national_board"],
              badge_colors={"provisional":"yellow","standard":"blue","advanced":"green","national_board":"gold"}),
            F("salary", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}, show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","on_leave","retired","terminated"],
              badge_colors={"active":"green","on_leave":"yellow","retired":"blue","terminated":"red"}, default="active"),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Course", "courses", "Academic course", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("code", "VARCHAR(20) NOT NULL", validation={"pattern":"^[A-Z]{2,4}[0-9]{3,4}$","message":"Format: SUBJ101"}),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("teacher_id", "UUID NOT NULL", is_fk=True, fk_table="teachers", fk_display="first_name", input_component="foreign_key_select"),
            F("credits", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":6}),
            F("max_enrollment", "INTEGER NOT NULL DEFAULT 30", ts_type="number", validation={"min":1,"max":200}, default=30),
            F("semester", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["fall","spring","summer","year_long"],
              badge_colors={"fall":"orange","spring":"green","summer":"yellow","year_long":"blue"}),
            F("difficulty", "VARCHAR(20) NOT NULL DEFAULT 'standard'", input_component="select",
              enum_values=["remedial","standard","honors","ap"],
              badge_colors={"remedial":"yellow","standard":"blue","honors":"green","ap":"purple"}, default="standard"),
        ], foreign_keys=[
            {"column":"teacher_id","references":{"table":"teachers","column":"id"}}
        ]),

        ENT("Enrollment", "enrollments", "Student course enrollment", [
            F("student_id", "UUID NOT NULL", is_fk=True, fk_table="students", fk_display="first_name", input_component="foreign_key_select"),
            F("course_id", "UUID NOT NULL", is_fk=True, fk_table="courses", fk_display="name", input_component="foreign_key_select"),
            F("enrollment_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'enrolled'", input_component="select",
              enum_values=["enrolled","dropped","completed","incomplete","withdrawn"],
              badge_colors={"enrolled":"green","dropped":"gray","completed":"blue","incomplete":"yellow","withdrawn":"red"}, default="enrolled"),
            F("final_grade", "VARCHAR(5)", nullable=True, input_component="select",
              enum_values=["A+","A","A-","B+","B","B-","C+","C","C-","D","F","I","W"],
              badge_colors={"A+":"green","A":"green","A-":"green","B+":"blue","B":"blue","B-":"blue","C+":"yellow","C":"yellow","C-":"yellow","D":"orange","F":"red","I":"gray","W":"gray"},
              conditional_visibility={"field":"status","operator":"in","value":["completed","incomplete"]}),
            F("drop_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"in","value":["dropped","withdrawn"]}),
        ], foreign_keys=[
            {"column":"student_id","references":{"table":"students","column":"id"}},
            {"column":"course_id","references":{"table":"courses","column":"id"}},
        ]),

        ENT("Grade", "grades", "Individual grade entry", [
            F("student_id", "UUID NOT NULL", is_fk=True, fk_table="students", fk_display="first_name", input_component="foreign_key_select"),
            F("course_id", "UUID NOT NULL", is_fk=True, fk_table="courses", fk_display="name", input_component="foreign_key_select"),
            F("assignment_name", "VARCHAR(255) NOT NULL"),
            F("assignment_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["homework","quiz","test","midterm","final","project","participation"],
              badge_colors={"homework":"blue","quiz":"teal","test":"purple","midterm":"orange","final":"red","project":"green","participation":"gray"}),
            F("points_earned", "NUMERIC(6,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("points_possible", "NUMERIC(6,2) NOT NULL", ts_type="number", validation={"min":0.01}),
            F("weight", "NUMERIC(5,2) NOT NULL DEFAULT 1.0", ts_type="number", validation={"min":0,"max":100}, show_in_table=False, default=1.0),
            F("comments", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"student_id","references":{"table":"students","column":"id"}},
            {"column":"course_id","references":{"table":"courses","column":"id"}},
        ], computed_fields=[
            {"name":"percentage","expression":"ROUND(points_earned / NULLIF(points_possible,0) * 100, 2)","ts_expression":"(points_earned / points_possible * 100).toFixed(2)"}
        ]),

        ENT("Attendance", "attendance_records", "Daily attendance record", [
            F("student_id", "UUID NOT NULL", is_fk=True, fk_table="students", fk_display="first_name", input_component="foreign_key_select"),
            F("course_id", "UUID NOT NULL", is_fk=True, fk_table="courses", fk_display="name", input_component="foreign_key_select"),
            F("date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'present'", input_component="select",
              enum_values=["present","absent","tardy","excused","half_day"],
              badge_colors={"present":"green","absent":"red","tardy":"yellow","excused":"blue","half_day":"orange"}, default="present"),
            F("excuse_note", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"in","value":["absent","excused"]}),
            F("arrival_time", "TIME", nullable=True, input_component="time_picker",
              conditional_visibility={"field":"status","operator":"equals","value":"tardy"}),
        ], foreign_keys=[
            {"column":"student_id","references":{"table":"students","column":"id"}},
            {"column":"course_id","references":{"table":"courses","column":"id"}},
        ]),

        ENT("Parent", "parents", "Student parent/guardian", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("relationship", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["mother","father","guardian","grandparent","other"],
              badge_colors={"mother":"pink","father":"blue","guardian":"purple","grandparent":"teal","other":"gray"}),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("emergency_contact", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),
    ])

# ── 4. event_management_spec.json ──────────────────────────────────────────
def gen_event_management():
    return SPEC("Event Management", "Conference and event planning platform", [
        ENT("Venue", "venues", "Event venue location", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("address", "TEXT NOT NULL", input_component="textarea"),
            F("city", "VARCHAR(100) NOT NULL"),
            F("capacity", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":100000}),
            F("venue_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["hotel","convention_center","outdoor","theater","restaurant","virtual","hybrid"],
              badge_colors={"hotel":"blue","convention_center":"purple","outdoor":"green","theater":"red","restaurant":"orange","virtual":"teal","hybrid":"pink"}),
            F("daily_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("contact_email", "VARCHAR(255)", nullable=True, validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("contact_phone", "VARCHAR(20)", nullable=True, validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
        ]),

        ENT("Event", "events", "Planned event", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("venue_id", "UUID NOT NULL", is_fk=True, fk_table="venues", fk_display="name", input_component="foreign_key_select"),
            F("start_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("end_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("event_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["conference","workshop","seminar","gala","concert","trade_show","webinar"],
              badge_colors={"conference":"blue","workshop":"green","seminar":"purple","gala":"gold","concert":"red","trade_show":"orange","webinar":"teal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'", input_component="select",
              enum_values=["planning","confirmed","in_progress","completed","cancelled","postponed"],
              badge_colors={"planning":"yellow","confirmed":"blue","in_progress":"green","completed":"teal","cancelled":"red","postponed":"orange"}, default="planning"),
            F("budget", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("max_attendees", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("cancellation_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"in","value":["cancelled","postponed"]}),
        ], foreign_keys=[
            {"column":"venue_id","references":{"table":"venues","column":"id"}}
        ]),

        ENT("Ticket", "tickets", "Event ticket", [
            F("event_id", "UUID NOT NULL", is_fk=True, fk_table="events", fk_display="name", input_component="foreign_key_select"),
            F("tier", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["general","vip","premium","early_bird","student","group"],
              badge_colors={"general":"gray","vip":"gold","premium":"purple","early_bird":"green","student":"blue","group":"teal"}),
            F("price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("quantity_available", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("quantity_sold", "INTEGER NOT NULL DEFAULT 0", ts_type="number", editable=False, show_in_form=False, default=0),
            F("sale_start_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("sale_end_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
        ], foreign_keys=[
            {"column":"event_id","references":{"table":"events","column":"id"}}
        ], computed_fields=[
            {"name":"revenue","expression":"price * quantity_sold","ts_expression":"price * quantity_sold"},
            {"name":"remaining","expression":"quantity_available - quantity_sold","ts_expression":"quantity_available - quantity_sold"}
        ]),

        ENT("Speaker", "speakers", "Event speaker / presenter", [
            F("event_id", "UUID NOT NULL", is_fk=True, fk_table="events", fk_display="name", input_component="foreign_key_select"),
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("bio", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("topic", "VARCHAR(255) NOT NULL"),
            F("speaker_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["keynote","panelist","workshop_lead","guest","moderator"],
              badge_colors={"keynote":"gold","panelist":"blue","workshop_lead":"green","guest":"purple","moderator":"teal"}),
            F("fee", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'invited'", input_component="select",
              enum_values=["invited","confirmed","declined","cancelled"],
              badge_colors={"invited":"yellow","confirmed":"green","declined":"red","cancelled":"gray"}, default="invited"),
        ], foreign_keys=[
            {"column":"event_id","references":{"table":"events","column":"id"}}
        ]),

        ENT("Sponsor", "sponsors", "Event sponsor", [
            F("event_id", "UUID NOT NULL", is_fk=True, fk_table="events", fk_display="name", input_component="foreign_key_select"),
            F("company_name", "VARCHAR(255) NOT NULL"),
            F("contact_name", "VARCHAR(255) NOT NULL"),
            F("contact_email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("tier", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["title","platinum","gold","silver","bronze","in_kind"],
              badge_colors={"title":"red","platinum":"purple","gold":"yellow","silver":"gray","bronze":"orange","in_kind":"teal"}),
            F("amount", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pledged'", input_component="select",
              enum_values=["pledged","confirmed","paid","withdrawn"],
              badge_colors={"pledged":"yellow","confirmed":"blue","paid":"green","withdrawn":"red"}, default="pledged"),
        ], foreign_keys=[
            {"column":"event_id","references":{"table":"events","column":"id"}}
        ]),

        ENT("Schedule", "schedules", "Event schedule / agenda item", [
            F("event_id", "UUID NOT NULL", is_fk=True, fk_table="events", fk_display="name", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("start_time", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("end_time", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("location", "VARCHAR(100)", nullable=True),
            F("session_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["keynote","breakout","workshop","panel","networking","meal","registration"],
              badge_colors={"keynote":"gold","breakout":"blue","workshop":"green","panel":"purple","networking":"teal","meal":"orange","registration":"gray"}),
            F("speaker_id", "UUID", nullable=True, is_fk=True, fk_table="speakers", fk_display="name", input_component="foreign_key_select"),
        ], foreign_keys=[
            {"column":"event_id","references":{"table":"events","column":"id"}},
            {"column":"speaker_id","references":{"table":"speakers","column":"id"}},
        ]),

        ENT("Attendee", "attendees", "Event attendee", [
            F("event_id", "UUID NOT NULL", is_fk=True, fk_table="events", fk_display="name", input_component="foreign_key_select"),
            F("ticket_id", "UUID NOT NULL", is_fk=True, fk_table="tickets", fk_display="tier", input_component="foreign_key_select"),
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("company", "VARCHAR(255)", nullable=True),
            F("dietary_restrictions", "VARCHAR(50)", nullable=True, input_component="select",
              enum_values=["none","vegetarian","vegan","gluten_free","kosher","halal","other"],
              badge_colors={"none":"gray","vegetarian":"green","vegan":"teal","gluten_free":"yellow","kosher":"blue","halal":"purple","other":"orange"}),
            F("check_in_status", "VARCHAR(20) NOT NULL DEFAULT 'registered'", input_component="select",
              enum_values=["registered","checked_in","no_show"],
              badge_colors={"registered":"blue","checked_in":"green","no_show":"red"}, default="registered"),
        ], foreign_keys=[
            {"column":"event_id","references":{"table":"events","column":"id"}},
            {"column":"ticket_id","references":{"table":"tickets","column":"id"}},
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),
    ])

# ── 5. invoice_billing_spec.json (upgrade existing) ───────────────────────
def gen_invoice_billing():
    return SPEC("Invoice & Billing", "Professional invoicing and billing management", [
        ENT("Customer", "customers", "Billing customer", [
            F("company_name", "VARCHAR(255) NOT NULL"),
            F("contact_name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20)", nullable=True, validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("billing_address", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("tax_id", "VARCHAR(50)", nullable=True, show_in_table=False),
            F("payment_terms", "VARCHAR(20) NOT NULL DEFAULT 'net_30'", input_component="select",
              enum_values=["due_on_receipt","net_15","net_30","net_45","net_60"],
              badge_colors={"due_on_receipt":"red","net_15":"orange","net_30":"blue","net_45":"teal","net_60":"purple"}, default="net_30"),
            F("credit_limit", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0, show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","suspended","on_hold"],
              badge_colors={"active":"green","inactive":"gray","suspended":"red","on_hold":"yellow"}, default="active"),
        ]),

        ENT("Invoice", "invoices", "Customer invoice", [
            F("invoice_number", "VARCHAR(50) NOT NULL", validation={"pattern":"^INV-[0-9]+$","message":"Format: INV-001"}),
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="company_name", input_component="foreign_key_select"),
            F("issue_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("subtotal", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("tax_rate", "NUMERIC(5,2) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0),
            F("tax_amount", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","sent","viewed","paid","overdue","void","refunded"],
              badge_colors={"draft":"gray","sent":"blue","viewed":"purple","paid":"green","overdue":"red","void":"gray","refunded":"orange"}, default="draft"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"customer_id","references":{"table":"customers","column":"id"}}
        ], computed_fields=[
            {"name":"total","expression":"subtotal + tax_amount - (subtotal * discount_pct / 100)","ts_expression":"subtotal + tax_amount - (subtotal * discount_pct / 100)"},
            {"name":"discount_amount","expression":"subtotal * discount_pct / 100","ts_expression":"subtotal * discount_pct / 100"}
        ]),

        ENT("InvoiceLine", "invoice_lines", "Invoice line item", [
            F("invoice_id", "UUID NOT NULL", is_fk=True, fk_table="invoices", fk_display="invoice_number", input_component="foreign_key_select"),
            F("description", "VARCHAR(500) NOT NULL"),
            F("quantity", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0.01}),
            F("unit_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("tax_rate_id", "UUID", nullable=True, is_fk=True, fk_table="tax_rates", fk_display="name", input_component="foreign_key_select"),
            F("discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0, show_in_table=False),
        ], foreign_keys=[
            {"column":"invoice_id","references":{"table":"invoices","column":"id"}},
            {"column":"tax_rate_id","references":{"table":"tax_rates","column":"id"}},
        ], computed_fields=[
            {"name":"line_total","expression":"quantity * unit_price * (1 - discount_pct / 100)","ts_expression":"quantity * unit_price * (1 - discount_pct / 100)"}
        ]),

        ENT("Payment", "payments", "Payment received", [
            F("invoice_id", "UUID NOT NULL", is_fk=True, fk_table="invoices", fk_display="invoice_number", input_component="foreign_key_select"),
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="company_name", input_component="foreign_key_select"),
            F("amount", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0.01}),
            F("payment_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("payment_method", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["bank_transfer","credit_card","check","cash","paypal","stripe"],
              badge_colors={"bank_transfer":"blue","credit_card":"purple","check":"teal","cash":"green","paypal":"blue","stripe":"purple"}),
            F("reference_number", "VARCHAR(100)", nullable=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'completed'", input_component="select",
              enum_values=["pending","completed","failed","refunded"],
              badge_colors={"pending":"yellow","completed":"green","failed":"red","refunded":"orange"}, default="completed"),
            F("refund_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"refunded"}),
        ], foreign_keys=[
            {"column":"invoice_id","references":{"table":"invoices","column":"id"}},
            {"column":"customer_id","references":{"table":"customers","column":"id"}},
        ]),

        ENT("TaxRate", "tax_rates", "Tax rate configuration", [
            F("name", "VARCHAR(100) NOT NULL"),
            F("rate", "NUMERIC(5,2) NOT NULL", ts_type="number", validation={"min":0,"max":100}),
            F("description", "VARCHAR(255)", nullable=True, show_in_table=False),
            F("tax_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["sales_tax","vat","gst","service_tax","custom"],
              badge_colors={"sales_tax":"blue","vat":"green","gst":"purple","service_tax":"orange","custom":"gray"}),
            F("is_default", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("is_active", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ]),

        ENT("FinancialPeriod", "financial_periods", "Accounting period", [
            F("name", "VARCHAR(100) NOT NULL"),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("period_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["monthly","quarterly","semi_annual","annual"],
              badge_colors={"monthly":"blue","quarterly":"green","semi_annual":"purple","annual":"gold"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'open'", input_component="select",
              enum_values=["open","closed","locked"],
              badge_colors={"open":"green","closed":"blue","locked":"red"}, default="open"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ]),

        ENT("RevenueAccount", "revenue_accounts", "Revenue chart of accounts", [
            F("account_code", "VARCHAR(20) NOT NULL", validation={"pattern":"^[0-9]{3,6}$","message":"3-6 digit code"}),
            F("name", "VARCHAR(255) NOT NULL"),
            F("account_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["revenue","cost_of_goods","operating_expense","other_income","other_expense"],
              badge_colors={"revenue":"green","cost_of_goods":"orange","operating_expense":"red","other_income":"teal","other_expense":"purple"}),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("parent_account_id", "UUID", nullable=True, is_fk=True, fk_table="revenue_accounts", fk_display="name", input_component="foreign_key_select"),
            F("is_active", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ], foreign_keys=[
            {"column":"parent_account_id","references":{"table":"revenue_accounts","column":"id"}}
        ]),
    ])

# ── 6. construction_spec.json ──────────────────────────────────────────────
def gen_construction():
    return SPEC("Construction Management", "Construction project and site management", [
        ENT("Client", "clients", "Construction client", [
            F("company_name", "VARCHAR(255) NOT NULL"),
            F("contact_name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("client_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["residential","commercial","government","industrial"],
              badge_colors={"residential":"blue","commercial":"green","government":"purple","industrial":"orange"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","prospect"],
              badge_colors={"active":"green","inactive":"gray","prospect":"yellow"}, default="active"),
        ]),

        ENT("Project", "projects", "Construction project", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="company_name", input_component="foreign_key_select"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("site_address", "TEXT NOT NULL", input_component="textarea"),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("estimated_end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("actual_end_date", "DATE", nullable=True, input_component="date_picker", display_component="date",
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
            F("contract_value", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'", input_component="select",
              enum_values=["planning","in_progress","on_hold","completed","cancelled"],
              badge_colors={"planning":"yellow","in_progress":"blue","on_hold":"orange","completed":"green","cancelled":"red"}, default="planning"),
            F("project_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["new_build","renovation","extension","demolition","maintenance"],
              badge_colors={"new_build":"blue","renovation":"green","extension":"purple","demolition":"red","maintenance":"teal"}),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}}
        ]),

        ENT("Worker", "workers", "Construction worker / laborer", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("project_id", "UUID NOT NULL", is_fk=True, fk_table="projects", fk_display="name", input_component="foreign_key_select"),
            F("trade", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["carpenter","electrician","plumber","mason","welder","painter","laborer","foreman"],
              badge_colors={"carpenter":"orange","electrician":"yellow","plumber":"blue","mason":"gray","welder":"red","painter":"green","laborer":"teal","foreman":"purple"}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("certification", "VARCHAR(50)", nullable=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","off_site","terminated","injured"],
              badge_colors={"active":"green","off_site":"yellow","terminated":"gray","injured":"red"}, default="active"),
        ], foreign_keys=[
            {"column":"project_id","references":{"table":"projects","column":"id"}}
        ]),

        ENT("Material", "materials", "Construction material", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("project_id", "UUID NOT NULL", is_fk=True, fk_table="projects", fk_display="name", input_component="foreign_key_select"),
            F("category", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["concrete","lumber","steel","electrical","plumbing","finishing","hardware","safety"],
              badge_colors={"concrete":"gray","lumber":"orange","steel":"blue","electrical":"yellow","plumbing":"teal","finishing":"pink","hardware":"purple","safety":"red"}),
            F("unit", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["each","kg","ton","meter","sqm","cubic_m","liter","bag"],
              badge_colors={"each":"gray","kg":"blue","ton":"purple","meter":"green","sqm":"teal","cubic_m":"orange","liter":"yellow","bag":"pink"}),
            F("quantity_ordered", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("unit_cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("quantity_used", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("supplier", "VARCHAR(255)", nullable=True),
        ], foreign_keys=[
            {"column":"project_id","references":{"table":"projects","column":"id"}}
        ], computed_fields=[
            {"name":"total_cost","expression":"quantity_ordered * unit_cost","ts_expression":"quantity_ordered * unit_cost"},
            {"name":"remaining_qty","expression":"quantity_ordered - quantity_used","ts_expression":"quantity_ordered - quantity_used"}
        ]),

        ENT("Inspection", "inspections", "Site inspection record", [
            F("project_id", "UUID NOT NULL", is_fk=True, fk_table="projects", fk_display="name", input_component="foreign_key_select"),
            F("inspector_name", "VARCHAR(255) NOT NULL"),
            F("inspection_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("inspection_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["foundation","framing","electrical","plumbing","fire","final","safety"],
              badge_colors={"foundation":"gray","framing":"orange","electrical":"yellow","plumbing":"blue","fire":"red","final":"green","safety":"purple"}),
            F("result", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["pass","fail","conditional","pending"],
              badge_colors={"pass":"green","fail":"red","conditional":"yellow","pending":"blue"}),
            F("findings", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("follow_up_date", "DATE", nullable=True, input_component="date_picker", display_component="date",
              conditional_visibility={"field":"result","operator":"in","value":["fail","conditional"]}),
        ], foreign_keys=[
            {"column":"project_id","references":{"table":"projects","column":"id"}}
        ]),

        ENT("Budget", "budgets", "Project budget line", [
            F("project_id", "UUID NOT NULL", is_fk=True, fk_table="projects", fk_display="name", input_component="foreign_key_select"),
            F("category", "VARCHAR(50) NOT NULL"),
            F("budgeted_amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("actual_amount", "NUMERIC(14,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'on_track'", input_component="select",
              enum_values=["on_track","over_budget","under_budget","pending"],
              badge_colors={"on_track":"green","over_budget":"red","under_budget":"blue","pending":"yellow"}, default="on_track"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"project_id","references":{"table":"projects","column":"id"}}
        ], computed_fields=[
            {"name":"variance","expression":"budgeted_amount - actual_amount","ts_expression":"budgeted_amount - actual_amount"},
            {"name":"variance_pct","expression":"ROUND((budgeted_amount - actual_amount) / NULLIF(budgeted_amount,0) * 100, 2)","ts_expression":"((budgeted_amount - actual_amount) / budgeted_amount * 100).toFixed(2)"}
        ]),

        ENT("Task", "tasks", "Project task", [
            F("project_id", "UUID NOT NULL", is_fk=True, fk_table="projects", fk_display="name", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("assigned_worker_id", "UUID", nullable=True, is_fk=True, fk_table="workers", fk_display="name", input_component="foreign_key_select"),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'medium'", input_component="select",
              enum_values=["low","medium","high","critical"],
              badge_colors={"low":"gray","medium":"blue","high":"orange","critical":"red"}, default="medium"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","in_progress","completed","blocked"],
              badge_colors={"pending":"yellow","in_progress":"blue","completed":"green","blocked":"red"}, default="pending"),
            F("completion_pct", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0),
        ], foreign_keys=[
            {"column":"project_id","references":{"table":"projects","column":"id"}},
            {"column":"assigned_worker_id","references":{"table":"workers","column":"id"}},
        ]),
    ])

# ── 7. law_firm_spec.json ─────────────────────────────────────────────────
def gen_law_firm():
    return SPEC("Law Firm Management", "Legal practice management system", [
        ENT("Client", "clients", "Law firm client", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("company", "VARCHAR(255)", nullable=True),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("client_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["individual","corporate","government","nonprofit"],
              badge_colors={"individual":"blue","corporate":"green","government":"purple","nonprofit":"teal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","prospective","archived"],
              badge_colors={"active":"green","inactive":"gray","prospective":"yellow","archived":"blue"}, default="active"),
            F("retainer_amount", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"client_type","operator":"equals","value":"corporate"}),
        ]),

        ENT("Attorney", "attorneys", "Lawyer / attorney", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("bar_number", "VARCHAR(50) NOT NULL"),
            F("practice_area", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["corporate","criminal","family","real_estate","immigration","tax","ip","litigation"],
              badge_colors={"corporate":"blue","criminal":"red","family":"pink","real_estate":"green","immigration":"purple","tax":"orange","ip":"teal","litigation":"yellow"}),
            F("billing_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("seniority", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["associate","senior_associate","partner","managing_partner","of_counsel"],
              badge_colors={"associate":"gray","senior_associate":"blue","partner":"green","managing_partner":"gold","of_counsel":"purple"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","on_leave","retired"],
              badge_colors={"active":"green","on_leave":"yellow","retired":"blue"}, default="active"),
        ]),

        ENT("Case", "cases", "Legal case / matter", [
            F("case_number", "VARCHAR(50) NOT NULL"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="name", input_component="foreign_key_select"),
            F("attorney_id", "UUID NOT NULL", is_fk=True, fk_table="attorneys", fk_display="name", input_component="foreign_key_select"),
            F("case_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["civil","criminal","family","corporate","real_estate","immigration","bankruptcy"],
              badge_colors={"civil":"blue","criminal":"red","family":"pink","corporate":"green","real_estate":"orange","immigration":"purple","bankruptcy":"gray"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'open'", input_component="select",
              enum_values=["open","discovery","trial","appeal","settled","closed","dismissed"],
              badge_colors={"open":"blue","discovery":"purple","trial":"red","appeal":"orange","settled":"green","closed":"gray","dismissed":"yellow"}, default="open"),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'normal'", input_component="select",
              enum_values=["low","normal","high","urgent"],
              badge_colors={"low":"gray","normal":"blue","high":"orange","urgent":"red"}, default="normal"),
            F("filing_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("settlement_amount", "NUMERIC(14,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"status","operator":"equals","value":"settled"}),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"attorney_id","references":{"table":"attorneys","column":"id"}},
        ]),

        ENT("TimeEntry", "time_entries", "Billable time entry", [
            F("case_id", "UUID NOT NULL", is_fk=True, fk_table="cases", fk_display="title", input_component="foreign_key_select"),
            F("attorney_id", "UUID NOT NULL", is_fk=True, fk_table="attorneys", fk_display="name", input_component="foreign_key_select"),
            F("date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("hours", "NUMERIC(5,2) NOT NULL", ts_type="number", validation={"min":0.1,"max":24}),
            F("description", "TEXT NOT NULL", input_component="textarea"),
            F("billing_type", "VARCHAR(20) NOT NULL DEFAULT 'billable'", input_component="select",
              enum_values=["billable","non_billable","pro_bono","contingency"],
              badge_colors={"billable":"green","non_billable":"gray","pro_bono":"blue","contingency":"orange"}, default="billable"),
            F("rate_override", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"billing_type","operator":"equals","value":"billable"}),
            F("is_approved", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
        ], foreign_keys=[
            {"column":"case_id","references":{"table":"cases","column":"id"}},
            {"column":"attorney_id","references":{"table":"attorneys","column":"id"}},
        ], computed_fields=[
            {"name":"amount","expression":"hours * COALESCE(rate_override, (SELECT billing_rate FROM attorneys WHERE id = attorney_id))","ts_expression":"hours * (rate_override || 0)"}
        ]),

        ENT("Document", "documents", "Legal document", [
            F("case_id", "UUID NOT NULL", is_fk=True, fk_table="cases", fk_display="title", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("document_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["contract","brief","motion","affidavit","deposition","evidence","correspondence","memo"],
              badge_colors={"contract":"blue","brief":"green","motion":"purple","affidavit":"orange","deposition":"teal","evidence":"red","correspondence":"gray","memo":"yellow"}),
            F("file_url", "TEXT NOT NULL", show_in_table=False),
            F("file_size_kb", "INTEGER", nullable=True, ts_type="number", editable=False, show_in_form=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","review","final","filed","archived"],
              badge_colors={"draft":"yellow","review":"blue","final":"green","filed":"teal","archived":"gray"}, default="draft"),
            F("confidentiality", "VARCHAR(20) NOT NULL DEFAULT 'standard'", input_component="select",
              enum_values=["public","standard","confidential","privileged"],
              badge_colors={"public":"green","standard":"blue","confidential":"orange","privileged":"red"}, default="standard"),
        ], foreign_keys=[
            {"column":"case_id","references":{"table":"cases","column":"id"}}
        ]),

        ENT("Invoice", "invoices", "Client billing invoice", [
            F("case_id", "UUID NOT NULL", is_fk=True, fk_table="cases", fk_display="title", input_component="foreign_key_select"),
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="name", input_component="foreign_key_select"),
            F("invoice_number", "VARCHAR(50) NOT NULL"),
            F("issue_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("total_hours", "NUMERIC(8,2) NOT NULL DEFAULT 0", ts_type="number", editable=False, show_in_form=False, default=0),
            F("amount", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","sent","paid","overdue","void","write_off"],
              badge_colors={"draft":"gray","sent":"blue","paid":"green","overdue":"red","void":"gray","write_off":"orange"}, default="draft"),
            F("payment_received", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
        ], foreign_keys=[
            {"column":"case_id","references":{"table":"cases","column":"id"}},
            {"column":"client_id","references":{"table":"clients","column":"id"}},
        ], computed_fields=[
            {"name":"balance_due","expression":"amount - payment_received","ts_expression":"amount - payment_received"}
        ]),

        ENT("CourtDate", "court_dates", "Scheduled court appearance", [
            F("case_id", "UUID NOT NULL", is_fk=True, fk_table="cases", fk_display="title", input_component="foreign_key_select"),
            F("attorney_id", "UUID NOT NULL", is_fk=True, fk_table="attorneys", fk_display="name", input_component="foreign_key_select"),
            F("date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("time", "TIME NOT NULL", input_component="time_picker"),
            F("court_name", "VARCHAR(255) NOT NULL"),
            F("hearing_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["arraignment","preliminary","motion","trial","sentencing","appeal","mediation"],
              badge_colors={"arraignment":"blue","preliminary":"teal","motion":"purple","trial":"red","sentencing":"orange","appeal":"yellow","mediation":"green"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","continued","completed","cancelled"],
              badge_colors={"scheduled":"blue","continued":"yellow","completed":"green","cancelled":"red"}, default="scheduled"),
            F("outcome", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
        ], foreign_keys=[
            {"column":"case_id","references":{"table":"cases","column":"id"}},
            {"column":"attorney_id","references":{"table":"attorneys","column":"id"}},
        ]),
    ])

# ── 8. recruitment_spec.json ───────────────────────────────────────────────
def gen_recruitment():
    return SPEC("Recruitment", "Applicant tracking and recruitment management", [
        ENT("Department", "departments", "Company department", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("code", "VARCHAR(10) NOT NULL"),
            F("head_name", "VARCHAR(255)", nullable=True),
            F("budget", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("headcount", "INTEGER NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","frozen","restructuring"],
              badge_colors={"active":"green","frozen":"blue","restructuring":"yellow"}, default="active"),
        ]),

        ENT("Recruiter", "recruiters", "Internal or external recruiter", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("recruiter_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["internal","agency","freelance"],
              badge_colors={"internal":"green","agency":"blue","freelance":"purple"}),
            F("specialization", "VARCHAR(50)", nullable=True),
            F("commission_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0,
              conditional_visibility={"field":"recruiter_type","operator":"not_equals","value":"internal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive"],
              badge_colors={"active":"green","inactive":"gray"}, default="active"),
        ]),

        ENT("JobPosting", "job_postings", "Open job position", [
            F("title", "VARCHAR(255) NOT NULL"),
            F("department_id", "UUID NOT NULL", is_fk=True, fk_table="departments", fk_display="name", input_component="foreign_key_select"),
            F("recruiter_id", "UUID NOT NULL", is_fk=True, fk_table="recruiters", fk_display="name", input_component="foreign_key_select"),
            F("description", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("employment_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["full_time","part_time","contract","internship","temporary"],
              badge_colors={"full_time":"green","part_time":"blue","contract":"purple","internship":"teal","temporary":"orange"}),
            F("salary_min", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency"),
            F("salary_max", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency"),
            F("location", "VARCHAR(100) NOT NULL"),
            F("remote_policy", "VARCHAR(20) NOT NULL DEFAULT 'on_site'", input_component="select",
              enum_values=["on_site","hybrid","remote","flexible"],
              badge_colors={"on_site":"blue","hybrid":"green","remote":"purple","flexible":"teal"}, default="on_site"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","open","paused","filled","cancelled"],
              badge_colors={"draft":"gray","open":"green","paused":"yellow","filled":"blue","cancelled":"red"}, default="draft"),
        ], foreign_keys=[
            {"column":"department_id","references":{"table":"departments","column":"id"}},
            {"column":"recruiter_id","references":{"table":"recruiters","column":"id"}},
        ], computed_fields=[
            {"name":"salary_range","expression":"'$' || salary_min || ' - $' || salary_max","ts_expression":"'$' + salary_min + ' - $' + salary_max"}
        ]),

        ENT("Candidate", "candidates", "Job candidate", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("resume_url", "TEXT", nullable=True, show_in_table=False),
            F("linkedin_url", "VARCHAR(500)", nullable=True, show_in_table=False),
            F("experience_years", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":50}),
            F("source", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["linkedin","indeed","referral","website","career_fair","agency","other"],
              badge_colors={"linkedin":"blue","indeed":"purple","referral":"green","website":"teal","career_fair":"orange","agency":"yellow","other":"gray"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'new'", input_component="select",
              enum_values=["new","screening","interviewing","offer_stage","hired","rejected","withdrawn"],
              badge_colors={"new":"blue","screening":"teal","interviewing":"purple","offer_stage":"yellow","hired":"green","rejected":"red","withdrawn":"gray"}, default="new"),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Application", "applications", "Job application", [
            F("job_posting_id", "UUID NOT NULL", is_fk=True, fk_table="job_postings", fk_display="title", input_component="foreign_key_select"),
            F("candidate_id", "UUID NOT NULL", is_fk=True, fk_table="candidates", fk_display="first_name", input_component="foreign_key_select"),
            F("applied_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("cover_letter_url", "TEXT", nullable=True, show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'received'", input_component="select",
              enum_values=["received","reviewed","shortlisted","interview","offer","hired","rejected"],
              badge_colors={"received":"blue","reviewed":"teal","shortlisted":"purple","interview":"yellow","offer":"orange","hired":"green","rejected":"red"}, default="received"),
            F("rating", "INTEGER", nullable=True, ts_type="number", validation={"min":1,"max":5}),
            F("rejection_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"rejected"}),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"job_posting_id","references":{"table":"job_postings","column":"id"}},
            {"column":"candidate_id","references":{"table":"candidates","column":"id"}},
        ]),

        ENT("Interview", "interviews", "Candidate interview", [
            F("application_id", "UUID NOT NULL", is_fk=True, fk_table="applications", fk_display="id", input_component="foreign_key_select"),
            F("interviewer_name", "VARCHAR(255) NOT NULL"),
            F("scheduled_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("duration_minutes", "INTEGER NOT NULL DEFAULT 60", ts_type="number", validation={"min":15,"max":480}, default=60),
            F("interview_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["phone","video","in_person","panel","technical","behavioral"],
              badge_colors={"phone":"blue","video":"teal","in_person":"green","panel":"purple","technical":"orange","behavioral":"yellow"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","completed","cancelled","no_show","rescheduled"],
              badge_colors={"scheduled":"blue","completed":"green","cancelled":"red","no_show":"gray","rescheduled":"yellow"}, default="scheduled"),
            F("score", "INTEGER", nullable=True, ts_type="number", validation={"min":1,"max":10},
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
            F("feedback", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
        ], foreign_keys=[
            {"column":"application_id","references":{"table":"applications","column":"id"}}
        ]),

        ENT("Offer", "offers", "Job offer to candidate", [
            F("candidate_id", "UUID NOT NULL", is_fk=True, fk_table="candidates", fk_display="first_name", input_component="foreign_key_select"),
            F("job_posting_id", "UUID NOT NULL", is_fk=True, fk_table="job_postings", fk_display="title", input_component="foreign_key_select"),
            F("salary", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("expiry_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("signing_bonus", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","accepted","declined","expired","negotiating","withdrawn"],
              badge_colors={"pending":"yellow","accepted":"green","declined":"red","expired":"gray","negotiating":"blue","withdrawn":"orange"}, default="pending"),
            F("decline_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"in","value":["declined","withdrawn"]}),
        ], foreign_keys=[
            {"column":"candidate_id","references":{"table":"candidates","column":"id"}},
            {"column":"job_posting_id","references":{"table":"job_postings","column":"id"}},
        ], computed_fields=[
            {"name":"total_compensation","expression":"salary + signing_bonus","ts_expression":"salary + signing_bonus"}
        ]),
    ])

# ── 9. property_management_spec.json ───────────────────────────────────────
def gen_property_management():
    return SPEC("Property Management", "Rental property and tenant management", [
        ENT("Property", "properties", "Rental property", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("address", "TEXT NOT NULL", input_component="textarea"),
            F("city", "VARCHAR(100) NOT NULL"),
            F("state", "VARCHAR(50) NOT NULL"),
            F("property_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["apartment","house","condo","townhouse","commercial","mixed_use"],
              badge_colors={"apartment":"blue","house":"green","condo":"purple","townhouse":"teal","commercial":"orange","mixed_use":"pink"}),
            F("total_units", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("year_built", "INTEGER", nullable=True, ts_type="number", validation={"min":1800,"max":2030}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","under_renovation","inactive","sold"],
              badge_colors={"active":"green","under_renovation":"yellow","inactive":"gray","sold":"blue"}, default="active"),
        ]),

        ENT("Unit", "units", "Individual rental unit", [
            F("property_id", "UUID NOT NULL", is_fk=True, fk_table="properties", fk_display="name", input_component="foreign_key_select"),
            F("unit_number", "VARCHAR(20) NOT NULL"),
            F("floor", "INTEGER", nullable=True, ts_type="number"),
            F("bedrooms", "INTEGER NOT NULL", ts_type="number", validation={"min":0,"max":10}),
            F("bathrooms", "NUMERIC(3,1) NOT NULL", ts_type="number", validation={"min":0,"max":10}),
            F("sqft", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("monthly_rent", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'vacant'", input_component="select",
              enum_values=["occupied","vacant","maintenance","reserved"],
              badge_colors={"occupied":"green","vacant":"blue","maintenance":"yellow","reserved":"purple"}, default="vacant"),
            F("amenities", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"property_id","references":{"table":"properties","column":"id"}}
        ], computed_fields=[
            {"name":"price_per_sqft","expression":"ROUND(monthly_rent / NULLIF(sqft,0), 2)","ts_expression":"(monthly_rent / sqft).toFixed(2)"}
        ]),

        ENT("Tenant", "tenants", "Property tenant", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("date_of_birth", "DATE", nullable=True, input_component="date_picker", display_component="date", show_in_table=False),
            F("employer", "VARCHAR(255)", nullable=True, show_in_table=False),
            F("monthly_income", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency", show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","past","evicted","applicant"],
              badge_colors={"active":"green","past":"gray","evicted":"red","applicant":"yellow"}, default="active"),
            F("emergency_contact", "VARCHAR(255)", nullable=True, show_in_table=False),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Lease", "leases", "Rental lease agreement", [
            F("unit_id", "UUID NOT NULL", is_fk=True, fk_table="units", fk_display="unit_number", input_component="foreign_key_select"),
            F("tenant_id", "UUID NOT NULL", is_fk=True, fk_table="tenants", fk_display="first_name", input_component="foreign_key_select"),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("monthly_rent", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("security_deposit", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("lease_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["fixed","month_to_month","sublease"],
              badge_colors={"fixed":"blue","month_to_month":"green","sublease":"purple"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","expired","terminated","renewed","pending"],
              badge_colors={"active":"green","expired":"gray","terminated":"red","renewed":"blue","pending":"yellow"}, default="active"),
            F("termination_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"terminated"}),
        ], foreign_keys=[
            {"column":"unit_id","references":{"table":"units","column":"id"}},
            {"column":"tenant_id","references":{"table":"tenants","column":"id"}},
        ]),

        ENT("Payment", "payments", "Rent payment", [
            F("lease_id", "UUID NOT NULL", is_fk=True, fk_table="leases", fk_display="id", input_component="foreign_key_select"),
            F("tenant_id", "UUID NOT NULL", is_fk=True, fk_table="tenants", fk_display="first_name", input_component="foreign_key_select"),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0.01}),
            F("payment_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("payment_method", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["check","bank_transfer","cash","online","money_order"],
              badge_colors={"check":"blue","bank_transfer":"green","cash":"teal","online":"purple","money_order":"orange"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'completed'", input_component="select",
              enum_values=["pending","completed","late","bounced","partial"],
              badge_colors={"pending":"yellow","completed":"green","late":"red","bounced":"red","partial":"orange"}, default="completed"),
            F("late_fee", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0,
              conditional_visibility={"field":"status","operator":"in","value":["late","bounced"]}),
        ], foreign_keys=[
            {"column":"lease_id","references":{"table":"leases","column":"id"}},
            {"column":"tenant_id","references":{"table":"tenants","column":"id"}},
        ], computed_fields=[
            {"name":"total_with_fees","expression":"amount + late_fee","ts_expression":"amount + late_fee"}
        ]),

        ENT("MaintenanceRequest", "maintenance_requests", "Maintenance work request", [
            F("unit_id", "UUID NOT NULL", is_fk=True, fk_table="units", fk_display="unit_number", input_component="foreign_key_select"),
            F("tenant_id", "UUID", nullable=True, is_fk=True, fk_table="tenants", fk_display="first_name", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("category", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["plumbing","electrical","hvac","appliance","structural","pest","landscaping","other"],
              badge_colors={"plumbing":"blue","electrical":"yellow","hvac":"teal","appliance":"orange","structural":"red","pest":"purple","landscaping":"green","other":"gray"}),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'normal'", input_component="select",
              enum_values=["low","normal","high","emergency"],
              badge_colors={"low":"gray","normal":"blue","high":"orange","emergency":"red"}, default="normal"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'submitted'", input_component="select",
              enum_values=["submitted","assigned","in_progress","completed","cancelled"],
              badge_colors={"submitted":"blue","assigned":"purple","in_progress":"yellow","completed":"green","cancelled":"gray"}, default="submitted"),
            F("vendor_id", "UUID", nullable=True, is_fk=True, fk_table="vendors", fk_display="company_name", input_component="foreign_key_select"),
            F("cost", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
        ], foreign_keys=[
            {"column":"unit_id","references":{"table":"units","column":"id"}},
            {"column":"tenant_id","references":{"table":"tenants","column":"id"}},
            {"column":"vendor_id","references":{"table":"vendors","column":"id"}},
        ]),

        ENT("Vendor", "vendors", "Maintenance vendor / contractor", [
            F("company_name", "VARCHAR(255) NOT NULL"),
            F("contact_name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("specialty", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["plumbing","electrical","hvac","general","landscaping","cleaning","pest_control"],
              badge_colors={"plumbing":"blue","electrical":"yellow","hvac":"teal","general":"gray","landscaping":"green","cleaning":"pink","pest_control":"purple"}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("rating", "NUMERIC(3,1)", nullable=True, ts_type="number", validation={"min":1,"max":5}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","blacklisted"],
              badge_colors={"active":"green","inactive":"gray","blacklisted":"red"}, default="active"),
        ]),
    ])

# ── 10. veterinary_clinic_spec.json ────────────────────────────────────────
def gen_veterinary_clinic():
    return SPEC("Veterinary Clinic", "Animal healthcare and veterinary practice management", [
        ENT("Owner", "owners", "Pet owner", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("preferred_contact", "VARCHAR(20) NOT NULL DEFAULT 'phone'", input_component="select",
              enum_values=["phone","email","text"],
              badge_colors={"phone":"blue","email":"green","text":"purple"}, default="phone"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive"],
              badge_colors={"active":"green","inactive":"gray"}, default="active"),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Pet", "pets", "Patient animal", [
            F("name", "VARCHAR(100) NOT NULL"),
            F("owner_id", "UUID NOT NULL", is_fk=True, fk_table="owners", fk_display="first_name", input_component="foreign_key_select"),
            F("species", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["dog","cat","bird","rabbit","reptile","fish","hamster","other"],
              badge_colors={"dog":"blue","cat":"orange","bird":"green","rabbit":"pink","reptile":"teal","fish":"purple","hamster":"yellow","other":"gray"}),
            F("breed", "VARCHAR(100)", nullable=True),
            F("date_of_birth", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("weight_kg", "NUMERIC(6,2)", nullable=True, ts_type="number", validation={"min":0.01}),
            F("gender", "VARCHAR(10) NOT NULL", input_component="select",
              enum_values=["male","female","unknown"],
              badge_colors={"male":"blue","female":"pink","unknown":"gray"}),
            F("is_neutered", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("microchip_id", "VARCHAR(50)", nullable=True, show_in_table=False),
            F("allergies", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"owner_id","references":{"table":"owners","column":"id"}}
        ]),

        ENT("Visit", "visits", "Veterinary visit / appointment", [
            F("pet_id", "UUID NOT NULL", is_fk=True, fk_table="pets", fk_display="name", input_component="foreign_key_select"),
            F("visit_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("reason", "VARCHAR(255) NOT NULL"),
            F("visit_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["checkup","sick","emergency","surgery","vaccination","follow_up"],
              badge_colors={"checkup":"blue","sick":"orange","emergency":"red","surgery":"purple","vaccination":"green","follow_up":"teal"}),
            F("diagnosis", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("treatment", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("weight_kg", "NUMERIC(6,2)", nullable=True, ts_type="number", validation={"min":0.01}),
            F("vet_name", "VARCHAR(255) NOT NULL"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","in_progress","completed","cancelled","no_show"],
              badge_colors={"scheduled":"blue","in_progress":"yellow","completed":"green","cancelled":"red","no_show":"gray"}, default="scheduled"),
        ], foreign_keys=[
            {"column":"pet_id","references":{"table":"pets","column":"id"}}
        ]),

        ENT("Vaccination", "vaccinations", "Pet vaccination record", [
            F("pet_id", "UUID NOT NULL", is_fk=True, fk_table="pets", fk_display="name", input_component="foreign_key_select"),
            F("vaccine_name", "VARCHAR(100) NOT NULL"),
            F("date_administered", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("next_due_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("batch_number", "VARCHAR(50)", nullable=True, show_in_table=False),
            F("administered_by", "VARCHAR(255) NOT NULL"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'current'", input_component="select",
              enum_values=["current","overdue","upcoming","expired"],
              badge_colors={"current":"green","overdue":"red","upcoming":"yellow","expired":"gray"}),
            F("reaction_notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"pet_id","references":{"table":"pets","column":"id"}}
        ]),

        ENT("Prescription", "prescriptions", "Medication prescription", [
            F("visit_id", "UUID NOT NULL", is_fk=True, fk_table="visits", fk_display="reason", input_component="foreign_key_select"),
            F("pet_id", "UUID NOT NULL", is_fk=True, fk_table="pets", fk_display="name", input_component="foreign_key_select"),
            F("medication_name", "VARCHAR(255) NOT NULL"),
            F("dosage", "VARCHAR(100) NOT NULL"),
            F("frequency", "VARCHAR(50) NOT NULL"),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("refills_remaining", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","completed","discontinued","expired"],
              badge_colors={"active":"green","completed":"blue","discontinued":"red","expired":"gray"}, default="active"),
        ], foreign_keys=[
            {"column":"visit_id","references":{"table":"visits","column":"id"}},
            {"column":"pet_id","references":{"table":"pets","column":"id"}},
        ]),

        ENT("Surgery", "surgeries", "Surgical procedure", [
            F("pet_id", "UUID NOT NULL", is_fk=True, fk_table="pets", fk_display="name", input_component="foreign_key_select"),
            F("visit_id", "UUID NOT NULL", is_fk=True, fk_table="visits", fk_display="reason", input_component="foreign_key_select"),
            F("procedure_name", "VARCHAR(255) NOT NULL"),
            F("scheduled_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("surgeon_name", "VARCHAR(255) NOT NULL"),
            F("anesthesia_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["general","local","sedation","none"],
              badge_colors={"general":"red","local":"blue","sedation":"yellow","none":"gray"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","in_progress","completed","cancelled","post_op"],
              badge_colors={"scheduled":"blue","in_progress":"yellow","completed":"green","cancelled":"red","post_op":"purple"}, default="scheduled"),
            F("cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("complications", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
        ], foreign_keys=[
            {"column":"pet_id","references":{"table":"pets","column":"id"}},
            {"column":"visit_id","references":{"table":"visits","column":"id"}},
        ]),

        ENT("Invoice", "invoices", "Billing invoice", [
            F("visit_id", "UUID NOT NULL", is_fk=True, fk_table="visits", fk_display="reason", input_component="foreign_key_select"),
            F("owner_id", "UUID NOT NULL", is_fk=True, fk_table="owners", fk_display="first_name", input_component="foreign_key_select"),
            F("invoice_number", "VARCHAR(50) NOT NULL"),
            F("issue_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("subtotal", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("tax_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("discount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'unpaid'", input_component="select",
              enum_values=["unpaid","paid","partial","overdue","void"],
              badge_colors={"unpaid":"red","paid":"green","partial":"yellow","overdue":"orange","void":"gray"}, default="unpaid"),
            F("payment_method", "VARCHAR(20)", nullable=True, input_component="select",
              enum_values=["cash","credit_card","check","insurance","payment_plan"],
              badge_colors={"cash":"green","credit_card":"blue","check":"teal","insurance":"purple","payment_plan":"orange"},
              conditional_visibility={"field":"status","operator":"in","value":["paid","partial"]}),
        ], foreign_keys=[
            {"column":"visit_id","references":{"table":"visits","column":"id"}},
            {"column":"owner_id","references":{"table":"owners","column":"id"}},
        ], computed_fields=[
            {"name":"total","expression":"subtotal + tax_amount - discount","ts_expression":"subtotal + tax_amount - discount"}
        ]),
    ])

# ── 11. car_dealership_spec.json ───────────────────────────────────────────
def gen_car_dealership():
    return SPEC("Car Dealership", "Automobile sales and service management", [
        ENT("Vehicle", "vehicles", "Vehicle in inventory", [
            F("vin", "VARCHAR(17) NOT NULL", validation={"pattern":"^[A-HJ-NPR-Z0-9]{17}$","message":"Valid 17-char VIN"}),
            F("make", "VARCHAR(50) NOT NULL"),
            F("model", "VARCHAR(50) NOT NULL"),
            F("year", "INTEGER NOT NULL", ts_type="number", validation={"min":1900,"max":2030}),
            F("color", "VARCHAR(30) NOT NULL"),
            F("mileage", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("price", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("cost", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}, show_in_table=False),
            F("condition", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["new","certified_preowned","used","salvage"],
              badge_colors={"new":"green","certified_preowned":"blue","used":"orange","salvage":"red"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","reserved","sold","in_transit","service"],
              badge_colors={"available":"green","reserved":"yellow","sold":"blue","in_transit":"purple","service":"orange"}, default="available"),
        ], computed_fields=[
            {"name":"profit_margin","expression":"price - cost","ts_expression":"price - cost"}
        ]),

        ENT("Customer", "customers", "Dealership customer", [
            F("first_name", "VARCHAR(100) NOT NULL"),
            F("last_name", "VARCHAR(100) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("drivers_license", "VARCHAR(50)", nullable=True, show_in_table=False),
            F("customer_type", "VARCHAR(20) NOT NULL DEFAULT 'individual'", input_component="select",
              enum_values=["individual","business","fleet"],
              badge_colors={"individual":"blue","business":"green","fleet":"purple"}, default="individual"),
            F("credit_score", "INTEGER", nullable=True, ts_type="number", validation={"min":300,"max":850}, show_in_table=False),
        ], computed_fields=[
            {"name":"full_name","expression":"first_name || ' ' || last_name","ts_expression":"first_name + ' ' + last_name"}
        ]),

        ENT("Salesperson", "salespeople", "Sales staff", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("hire_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("commission_rate", "NUMERIC(5,2) NOT NULL DEFAULT 5.0", ts_type="number", validation={"min":0,"max":100}, default=5.0),
            F("monthly_quota", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","on_leave","terminated"],
              badge_colors={"active":"green","on_leave":"yellow","terminated":"red"}, default="active"),
        ]),

        ENT("Sale", "sales", "Vehicle sale transaction", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="vin", input_component="foreign_key_select"),
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="first_name", input_component="foreign_key_select"),
            F("salesperson_id", "UUID NOT NULL", is_fk=True, fk_table="salespeople", fk_display="name", input_component="foreign_key_select"),
            F("sale_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("sale_price", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("trade_in_id", "UUID", nullable=True, is_fk=True, fk_table="trade_ins", fk_display="id", input_component="foreign_key_select"),
            F("financing_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["cash","bank_loan","dealer_finance","lease"],
              badge_colors={"cash":"green","bank_loan":"blue","dealer_finance":"purple","lease":"teal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","completed","financed","cancelled"],
              badge_colors={"pending":"yellow","completed":"green","financed":"blue","cancelled":"red"}, default="pending"),
            F("down_payment", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0,
              conditional_visibility={"field":"financing_type","operator":"not_equals","value":"cash"}),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"customer_id","references":{"table":"customers","column":"id"}},
            {"column":"salesperson_id","references":{"table":"salespeople","column":"id"}},
            {"column":"trade_in_id","references":{"table":"trade_ins","column":"id"}},
        ], computed_fields=[
            {"name":"financed_amount","expression":"sale_price - down_payment","ts_expression":"sale_price - down_payment"}
        ]),

        ENT("TestDrive", "test_drives", "Customer test drive", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="vin", input_component="foreign_key_select"),
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="first_name", input_component="foreign_key_select"),
            F("salesperson_id", "UUID NOT NULL", is_fk=True, fk_table="salespeople", fk_display="name", input_component="foreign_key_select"),
            F("scheduled_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("duration_minutes", "INTEGER NOT NULL DEFAULT 30", ts_type="number", validation={"min":10,"max":120}, default=30),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","in_progress","completed","cancelled","no_show"],
              badge_colors={"scheduled":"blue","in_progress":"yellow","completed":"green","cancelled":"red","no_show":"gray"}, default="scheduled"),
            F("feedback", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"customer_id","references":{"table":"customers","column":"id"}},
            {"column":"salesperson_id","references":{"table":"salespeople","column":"id"}},
        ]),

        ENT("ServiceAppointment", "service_appointments", "Vehicle service appointment", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="vin", input_component="foreign_key_select"),
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="first_name", input_component="foreign_key_select"),
            F("service_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["oil_change","tire_rotation","brake","transmission","engine","inspection","recall","detailing"],
              badge_colors={"oil_change":"blue","tire_rotation":"teal","brake":"orange","transmission":"purple","engine":"red","inspection":"green","recall":"yellow","detailing":"pink"}),
            F("scheduled_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("estimated_cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("actual_cost", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","in_progress","completed","cancelled"],
              badge_colors={"scheduled":"blue","in_progress":"yellow","completed":"green","cancelled":"red"}, default="scheduled"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"customer_id","references":{"table":"customers","column":"id"}},
        ]),

        ENT("TradeIn", "trade_ins", "Vehicle trade-in", [
            F("customer_id", "UUID NOT NULL", is_fk=True, fk_table="customers", fk_display="first_name", input_component="foreign_key_select"),
            F("vin", "VARCHAR(17) NOT NULL", validation={"pattern":"^[A-HJ-NPR-Z0-9]{17}$","message":"Valid 17-char VIN"}),
            F("make", "VARCHAR(50) NOT NULL"),
            F("model", "VARCHAR(50) NOT NULL"),
            F("year", "INTEGER NOT NULL", ts_type="number", validation={"min":1900,"max":2030}),
            F("mileage", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("condition", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["excellent","good","fair","poor"],
              badge_colors={"excellent":"green","good":"blue","fair":"yellow","poor":"red"}),
            F("appraised_value", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","accepted","rejected","completed"],
              badge_colors={"pending":"yellow","accepted":"green","rejected":"red","completed":"blue"}, default="pending"),
        ], foreign_keys=[
            {"column":"customer_id","references":{"table":"customers","column":"id"}}
        ]),
    ])

# ── 12. logistics_spec.json ────────────────────────────────────────────────
def gen_logistics():
    return SPEC("Logistics", "Supply chain and logistics management", [
        ENT("Warehouse", "warehouses", "Storage warehouse", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("address", "TEXT NOT NULL", input_component="textarea"),
            F("city", "VARCHAR(100) NOT NULL"),
            F("capacity_sqft", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("warehouse_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["general","cold_storage","hazmat","bonded","cross_dock"],
              badge_colors={"general":"blue","cold_storage":"teal","hazmat":"red","bonded":"purple","cross_dock":"green"}),
            F("manager_name", "VARCHAR(255)", nullable=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","full","maintenance","closed"],
              badge_colors={"active":"green","full":"yellow","maintenance":"orange","closed":"red"}, default="active"),
        ]),

        ENT("Vehicle", "vehicles", "Fleet vehicle", [
            F("plate_number", "VARCHAR(20) NOT NULL"),
            F("vehicle_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["van","truck","semi","flatbed","refrigerated","tanker"],
              badge_colors={"van":"blue","truck":"green","semi":"purple","flatbed":"orange","refrigerated":"teal","tanker":"red"}),
            F("make", "VARCHAR(50) NOT NULL"),
            F("model", "VARCHAR(50) NOT NULL"),
            F("year", "INTEGER NOT NULL", ts_type="number", validation={"min":1990,"max":2030}),
            F("max_weight_kg", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("fuel_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["diesel","gasoline","electric","hybrid","cng"],
              badge_colors={"diesel":"gray","gasoline":"orange","electric":"green","hybrid":"teal","cng":"blue"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","in_transit","maintenance","decommissioned"],
              badge_colors={"available":"green","in_transit":"blue","maintenance":"yellow","decommissioned":"gray"}, default="available"),
        ]),

        ENT("Driver", "drivers", "Delivery driver", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("license_number", "VARCHAR(50) NOT NULL"),
            F("license_class", "VARCHAR(10) NOT NULL", input_component="select",
              enum_values=["A","B","C","CDL_A","CDL_B"],
              badge_colors={"A":"blue","B":"green","C":"gray","CDL_A":"purple","CDL_B":"teal"}),
            F("hire_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","on_route","off_duty","on_leave","terminated"],
              badge_colors={"available":"green","on_route":"blue","off_duty":"gray","on_leave":"yellow","terminated":"red"}, default="available"),
        ]),

        ENT("Route", "routes", "Delivery route", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("origin", "VARCHAR(255) NOT NULL"),
            F("destination", "VARCHAR(255) NOT NULL"),
            F("distance_km", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("estimated_hours", "NUMERIC(5,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("route_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["local","regional","long_haul","international"],
              badge_colors={"local":"green","regional":"blue","long_haul":"purple","international":"orange"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","seasonal"],
              badge_colors={"active":"green","inactive":"gray","seasonal":"yellow"}, default="active"),
        ]),

        ENT("Shipment", "shipments", "Delivery shipment", [
            F("tracking_number", "VARCHAR(50) NOT NULL"),
            F("driver_id", "UUID NOT NULL", is_fk=True, fk_table="drivers", fk_display="name", input_component="foreign_key_select"),
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="plate_number", input_component="foreign_key_select"),
            F("route_id", "UUID NOT NULL", is_fk=True, fk_table="routes", fk_display="name", input_component="foreign_key_select"),
            F("origin_warehouse_id", "UUID NOT NULL", is_fk=True, fk_table="warehouses", fk_display="name", input_component="foreign_key_select"),
            F("pickup_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("estimated_delivery", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("actual_delivery", "TIMESTAMPTZ", nullable=True, input_component="datetime_picker", display_component="datetime",
              conditional_visibility={"field":"status","operator":"equals","value":"delivered"}),
            F("weight_kg", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","picked_up","in_transit","delivered","returned","lost"],
              badge_colors={"pending":"yellow","picked_up":"blue","in_transit":"purple","delivered":"green","returned":"orange","lost":"red"}, default="pending"),
        ], foreign_keys=[
            {"column":"driver_id","references":{"table":"drivers","column":"id"}},
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"route_id","references":{"table":"routes","column":"id"}},
            {"column":"origin_warehouse_id","references":{"table":"warehouses","column":"id"}},
        ]),

        ENT("Inventory", "inventory_items", "Warehouse inventory item", [
            F("warehouse_id", "UUID NOT NULL", is_fk=True, fk_table="warehouses", fk_display="name", input_component="foreign_key_select"),
            F("sku", "VARCHAR(50) NOT NULL"),
            F("name", "VARCHAR(255) NOT NULL"),
            F("quantity", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("unit", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["each","pallet","case","kg","liter"],
              badge_colors={"each":"gray","pallet":"blue","case":"green","kg":"orange","liter":"teal"}),
            F("reorder_point", "INTEGER NOT NULL DEFAULT 10", ts_type="number", default=10),
            F("unit_cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'in_stock'", input_component="select",
              enum_values=["in_stock","low_stock","out_of_stock","discontinued"],
              badge_colors={"in_stock":"green","low_stock":"yellow","out_of_stock":"red","discontinued":"gray"}, default="in_stock"),
        ], foreign_keys=[
            {"column":"warehouse_id","references":{"table":"warehouses","column":"id"}}
        ], computed_fields=[
            {"name":"total_value","expression":"quantity * unit_cost","ts_expression":"quantity * unit_cost"}
        ]),

        ENT("DeliveryNote", "delivery_notes", "Proof of delivery", [
            F("shipment_id", "UUID NOT NULL", is_fk=True, fk_table="shipments", fk_display="tracking_number", input_component="foreign_key_select"),
            F("recipient_name", "VARCHAR(255) NOT NULL"),
            F("delivery_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("signature_obtained", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("condition", "VARCHAR(20) NOT NULL DEFAULT 'good'", input_component="select",
              enum_values=["good","damaged","partial","refused"],
              badge_colors={"good":"green","damaged":"red","partial":"yellow","refused":"gray"}, default="good"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("damage_description", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"condition","operator":"equals","value":"damaged"}),
        ], foreign_keys=[
            {"column":"shipment_id","references":{"table":"shipments","column":"id"}}
        ]),
    ])

# ── 13. task_management_spec.json (upgrade existing) ──────────────────────
def gen_task_management():
    return SPEC("Task Management", "Project task tracking and collaboration", [
        ENT("TaskList", "task_lists", "Group of related tasks", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("color", "VARCHAR(20) NOT NULL DEFAULT 'blue'", input_component="select",
              enum_values=["blue","green","red","yellow","purple","orange","teal","pink"],
              badge_colors={"blue":"blue","green":"green","red":"red","yellow":"yellow","purple":"purple","orange":"orange","teal":"teal","pink":"pink"}, default="blue"),
            F("sort_order", "INTEGER NOT NULL DEFAULT 0", ts_type="number", default=0, show_in_table=False),
            F("is_archived", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","completed","archived"],
              badge_colors={"active":"green","completed":"blue","archived":"gray"}, default="active"),
        ]),

        ENT("Task", "tasks", "Individual task item", [
            F("title", "VARCHAR(500) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("task_list_id", "UUID NOT NULL", is_fk=True, fk_table="task_lists", fk_display="name", input_component="foreign_key_select"),
            F("assignee_id", "UUID", nullable=True, is_fk=True, fk_table="assignees", fk_display="name", input_component="foreign_key_select"),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'medium'", input_component="select",
              enum_values=["low","medium","high","urgent"],
              badge_colors={"low":"gray","medium":"blue","high":"orange","urgent":"red"}, default="medium"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'todo'", input_component="select",
              enum_values=["todo","in_progress","review","done","blocked"],
              badge_colors={"todo":"gray","in_progress":"blue","review":"purple","done":"green","blocked":"red"}, default="todo"),
            F("due_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("estimated_hours", "NUMERIC(5,2)", nullable=True, ts_type="number", validation={"min":0}),
            F("actual_hours", "NUMERIC(5,2)", nullable=True, ts_type="number", validation={"min":0},
              conditional_visibility={"field":"status","operator":"in","value":["review","done"]}),
            F("completion_pct", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":100}, default=0),
        ], foreign_keys=[
            {"column":"task_list_id","references":{"table":"task_lists","column":"id"}},
            {"column":"assignee_id","references":{"table":"assignees","column":"id"}},
        ]),

        ENT("Assignee", "assignees", "Team member who can be assigned tasks", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("avatar_url", "TEXT", nullable=True, show_in_table=False),
            F("role", "VARCHAR(20) NOT NULL DEFAULT 'member'", input_component="select",
              enum_values=["admin","manager","member","viewer"],
              badge_colors={"admin":"red","manager":"purple","member":"blue","viewer":"gray"}, default="member"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","away","offline"],
              badge_colors={"active":"green","away":"yellow","offline":"gray"}, default="active"),
            F("capacity_hours_weekly", "INTEGER NOT NULL DEFAULT 40", ts_type="number", validation={"min":0,"max":80}, default=40, show_in_table=False),
        ]),

        ENT("Label", "labels", "Task label / tag", [
            F("name", "VARCHAR(50) NOT NULL"),
            F("color", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["red","orange","yellow","green","blue","purple","pink","gray"],
              badge_colors={"red":"red","orange":"orange","yellow":"yellow","green":"green","blue":"blue","purple":"purple","pink":"pink","gray":"gray"}),
            F("description", "VARCHAR(255)", nullable=True, show_in_table=False),
            F("is_active", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ]),

        ENT("ChecklistItem", "checklist_items", "Sub-task checklist item", [
            F("task_id", "UUID NOT NULL", is_fk=True, fk_table="tasks", fk_display="title", input_component="foreign_key_select"),
            F("title", "VARCHAR(500) NOT NULL"),
            F("is_completed", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("sort_order", "INTEGER NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("assigned_to_id", "UUID", nullable=True, is_fk=True, fk_table="assignees", fk_display="name", input_component="foreign_key_select"),
            F("due_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
        ], foreign_keys=[
            {"column":"task_id","references":{"table":"tasks","column":"id"}},
            {"column":"assigned_to_id","references":{"table":"assignees","column":"id"}},
        ]),

        ENT("Comment", "comments", "Task comment", [
            F("task_id", "UUID NOT NULL", is_fk=True, fk_table="tasks", fk_display="title", input_component="foreign_key_select"),
            F("author_id", "UUID NOT NULL", is_fk=True, fk_table="assignees", fk_display="name", input_component="foreign_key_select"),
            F("body", "TEXT NOT NULL", input_component="textarea"),
            F("is_edited", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", editable=False, show_in_form=False, default=False),
            F("comment_type", "VARCHAR(20) NOT NULL DEFAULT 'comment'", input_component="select",
              enum_values=["comment","status_change","assignment","mention"],
              badge_colors={"comment":"blue","status_change":"purple","assignment":"green","mention":"orange"}, default="comment"),
        ], foreign_keys=[
            {"column":"task_id","references":{"table":"tasks","column":"id"}},
            {"column":"author_id","references":{"table":"assignees","column":"id"}},
        ]),

        ENT("Reminder", "reminders", "Task reminder / notification", [
            F("task_id", "UUID NOT NULL", is_fk=True, fk_table="tasks", fk_display="title", input_component="foreign_key_select"),
            F("assignee_id", "UUID NOT NULL", is_fk=True, fk_table="assignees", fk_display="name", input_component="foreign_key_select"),
            F("remind_at", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("reminder_type", "VARCHAR(20) NOT NULL DEFAULT 'once'", input_component="select",
              enum_values=["once","daily","weekly"],
              badge_colors={"once":"blue","daily":"green","weekly":"purple"}, default="once"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","triggered","dismissed","expired"],
              badge_colors={"active":"blue","triggered":"green","dismissed":"gray","expired":"orange"}, default="active"),
            F("message", "VARCHAR(500)", nullable=True),
        ], foreign_keys=[
            {"column":"task_id","references":{"table":"tasks","column":"id"}},
            {"column":"assignee_id","references":{"table":"assignees","column":"id"}},
        ]),
    ])

# ── 14. insurance_spec.json ────────────────────────────────────────────────
def gen_insurance():
    return SPEC("Insurance", "Insurance policy and claims management", [
        ENT("Agent", "agents", "Insurance agent", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("license_number", "VARCHAR(50) NOT NULL"),
            F("specialization", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["life","health","auto","home","commercial","specialty"],
              badge_colors={"life":"blue","health":"green","auto":"orange","home":"purple","commercial":"teal","specialty":"pink"}),
            F("commission_rate", "NUMERIC(5,2) NOT NULL DEFAULT 10", ts_type="number", validation={"min":0,"max":100}, default=10),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","suspended"],
              badge_colors={"active":"green","inactive":"gray","suspended":"red"}, default="active"),
        ]),

        ENT("Policy", "policies", "Insurance policy", [
            F("policy_number", "VARCHAR(50) NOT NULL"),
            F("agent_id", "UUID NOT NULL", is_fk=True, fk_table="agents", fk_display="name", input_component="foreign_key_select"),
            F("holder_name", "VARCHAR(255) NOT NULL"),
            F("holder_email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("policy_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["life","health","auto","home","renters","commercial","umbrella"],
              badge_colors={"life":"blue","health":"green","auto":"orange","home":"purple","renters":"teal","commercial":"yellow","umbrella":"pink"}),
            F("premium_amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("coverage_amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("deductible", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","expired","cancelled","suspended","pending"],
              badge_colors={"active":"green","expired":"gray","cancelled":"red","suspended":"orange","pending":"yellow"}, default="active"),
        ], foreign_keys=[
            {"column":"agent_id","references":{"table":"agents","column":"id"}}
        ]),

        ENT("Claim", "claims", "Insurance claim", [
            F("claim_number", "VARCHAR(50) NOT NULL"),
            F("policy_id", "UUID NOT NULL", is_fk=True, fk_table="policies", fk_display="policy_number", input_component="foreign_key_select"),
            F("date_of_incident", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("date_filed", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("description", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("claimed_amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("approved_amount", "NUMERIC(14,2)", nullable=True, ts_type="number", display_component="currency",
              conditional_visibility={"field":"status","operator":"in","value":["approved","paid"]}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'filed'", input_component="select",
              enum_values=["filed","under_review","approved","denied","paid","appealed"],
              badge_colors={"filed":"blue","under_review":"yellow","approved":"green","denied":"red","paid":"teal","appealed":"orange"}, default="filed"),
            F("denial_reason", "TEXT", nullable=True, input_component="textarea", show_in_table=False,
              conditional_visibility={"field":"status","operator":"equals","value":"denied"}),
        ], foreign_keys=[
            {"column":"policy_id","references":{"table":"policies","column":"id"}}
        ]),

        ENT("Payment", "payments", "Premium payment", [
            F("policy_id", "UUID NOT NULL", is_fk=True, fk_table="policies", fk_display="policy_number", input_component="foreign_key_select"),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0.01}),
            F("payment_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("payment_method", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["bank_transfer","credit_card","check","auto_debit","cash"],
              badge_colors={"bank_transfer":"blue","credit_card":"purple","check":"teal","auto_debit":"green","cash":"orange"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'completed'", input_component="select",
              enum_values=["pending","completed","failed","refunded","late"],
              badge_colors={"pending":"yellow","completed":"green","failed":"red","refunded":"orange","late":"red"}, default="completed"),
            F("late_fee", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0,
              conditional_visibility={"field":"status","operator":"equals","value":"late"}),
        ], foreign_keys=[
            {"column":"policy_id","references":{"table":"policies","column":"id"}}
        ]),

        ENT("Document", "documents", "Policy or claim document", [
            F("policy_id", "UUID", nullable=True, is_fk=True, fk_table="policies", fk_display="policy_number", input_component="foreign_key_select"),
            F("claim_id", "UUID", nullable=True, is_fk=True, fk_table="claims", fk_display="claim_number", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("document_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["policy_doc","claim_form","evidence","medical_report","police_report","estimate","correspondence"],
              badge_colors={"policy_doc":"blue","claim_form":"green","evidence":"orange","medical_report":"purple","police_report":"red","estimate":"teal","correspondence":"gray"}),
            F("file_url", "TEXT NOT NULL", show_in_table=False),
            F("uploaded_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","archived","expired"],
              badge_colors={"active":"green","archived":"gray","expired":"orange"}, default="active"),
        ], foreign_keys=[
            {"column":"policy_id","references":{"table":"policies","column":"id"}},
            {"column":"claim_id","references":{"table":"claims","column":"id"}},
        ]),

        ENT("Beneficiary", "beneficiaries", "Policy beneficiary", [
            F("policy_id", "UUID NOT NULL", is_fk=True, fk_table="policies", fk_display="policy_number", input_component="foreign_key_select"),
            F("name", "VARCHAR(255) NOT NULL"),
            F("relationship", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["spouse","child","parent","sibling","other","trust","estate"],
              badge_colors={"spouse":"pink","child":"blue","parent":"purple","sibling":"teal","other":"gray","trust":"green","estate":"orange"}),
            F("percentage", "NUMERIC(5,2) NOT NULL", ts_type="number", validation={"min":0,"max":100}),
            F("phone", "VARCHAR(20)", nullable=True, validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("email", "VARCHAR(255)", nullable=True, validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("is_primary", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
        ], foreign_keys=[
            {"column":"policy_id","references":{"table":"policies","column":"id"}}
        ]),

        ENT("Quote", "quotes", "Insurance quote", [
            F("agent_id", "UUID NOT NULL", is_fk=True, fk_table="agents", fk_display="name", input_component="foreign_key_select"),
            F("applicant_name", "VARCHAR(255) NOT NULL"),
            F("applicant_email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("policy_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["life","health","auto","home","renters","commercial"],
              badge_colors={"life":"blue","health":"green","auto":"orange","home":"purple","renters":"teal","commercial":"yellow"}),
            F("estimated_premium", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("coverage_amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("valid_until", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","sent","accepted","declined","expired"],
              badge_colors={"draft":"gray","sent":"blue","accepted":"green","declined":"red","expired":"orange"}, default="draft"),
        ], foreign_keys=[
            {"column":"agent_id","references":{"table":"agents","column":"id"}}
        ]),
    ])

# ── 15. nonprofit_spec.json ────────────────────────────────────────────────
def gen_nonprofit():
    return SPEC("Nonprofit Management", "Nonprofit organization and fundraising management", [
        ENT("Donor", "donors", "Financial donor", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20)", nullable=True, validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("donor_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["individual","corporate","foundation","government","anonymous"],
              badge_colors={"individual":"blue","corporate":"green","foundation":"purple","government":"teal","anonymous":"gray"}),
            F("total_donated", "NUMERIC(14,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("tier", "VARCHAR(20) NOT NULL DEFAULT 'supporter'", input_component="select",
              enum_values=["supporter","bronze","silver","gold","platinum","benefactor"],
              badge_colors={"supporter":"gray","bronze":"orange","silver":"blue","gold":"yellow","platinum":"purple","benefactor":"green"}, default="supporter"),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","lapsed","deceased","opted_out"],
              badge_colors={"active":"green","lapsed":"yellow","deceased":"gray","opted_out":"red"}, default="active"),
        ]),

        ENT("Campaign", "campaigns", "Fundraising campaign", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("goal_amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("raised_amount", "NUMERIC(14,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("campaign_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["annual","capital","planned_giving","event","emergency","peer_to_peer"],
              badge_colors={"annual":"blue","capital":"purple","planned_giving":"green","event":"orange","emergency":"red","peer_to_peer":"teal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'", input_component="select",
              enum_values=["planning","active","paused","completed","cancelled"],
              badge_colors={"planning":"yellow","active":"green","paused":"orange","completed":"blue","cancelled":"red"}, default="planning"),
        ], computed_fields=[
            {"name":"progress_pct","expression":"ROUND(raised_amount / NULLIF(goal_amount,0) * 100, 2)","ts_expression":"(raised_amount / goal_amount * 100).toFixed(2)"},
            {"name":"remaining","expression":"goal_amount - raised_amount","ts_expression":"goal_amount - raised_amount"}
        ]),

        ENT("Donation", "donations", "Individual donation", [
            F("donor_id", "UUID NOT NULL", is_fk=True, fk_table="donors", fk_display="name", input_component="foreign_key_select"),
            F("campaign_id", "UUID", nullable=True, is_fk=True, fk_table="campaigns", fk_display="name", input_component="foreign_key_select"),
            F("amount", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0.01}),
            F("donation_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("payment_method", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["credit_card","check","bank_transfer","cash","stock","crypto","in_kind"],
              badge_colors={"credit_card":"blue","check":"teal","bank_transfer":"green","cash":"orange","stock":"purple","crypto":"yellow","in_kind":"pink"}),
            F("is_recurring", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("frequency", "VARCHAR(20)", nullable=True, input_component="select",
              enum_values=["weekly","monthly","quarterly","annually"],
              badge_colors={"weekly":"blue","monthly":"green","quarterly":"purple","annually":"orange"},
              conditional_visibility={"field":"is_recurring","operator":"equals","value":True}),
            F("is_anonymous", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("tax_receipt_sent", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
        ], foreign_keys=[
            {"column":"donor_id","references":{"table":"donors","column":"id"}},
            {"column":"campaign_id","references":{"table":"campaigns","column":"id"}},
        ]),

        ENT("Program", "programs", "Nonprofit program", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("budget", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("spent", "NUMERIC(14,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("category", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["education","health","environment","social_services","arts","research","community"],
              badge_colors={"education":"blue","health":"green","environment":"teal","social_services":"purple","arts":"pink","research":"orange","community":"yellow"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["planning","active","paused","completed","discontinued"],
              badge_colors={"planning":"yellow","active":"green","paused":"orange","completed":"blue","discontinued":"red"}, default="active"),
        ], computed_fields=[
            {"name":"remaining_budget","expression":"budget - spent","ts_expression":"budget - spent"},
            {"name":"utilization_pct","expression":"ROUND(spent / NULLIF(budget,0) * 100, 2)","ts_expression":"(spent / budget * 100).toFixed(2)"}
        ]),

        ENT("Volunteer", "volunteers", "Volunteer participant", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("program_id", "UUID", nullable=True, is_fk=True, fk_table="programs", fk_display="name", input_component="foreign_key_select"),
            F("skills", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("hours_logged", "NUMERIC(8,2) NOT NULL DEFAULT 0", ts_type="number", editable=False, show_in_form=False, default=0),
            F("availability", "VARCHAR(20) NOT NULL DEFAULT 'flexible'", input_component="select",
              enum_values=["weekdays","weekends","evenings","flexible","limited"],
              badge_colors={"weekdays":"blue","weekends":"green","evenings":"purple","flexible":"teal","limited":"orange"}, default="flexible"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","on_leave"],
              badge_colors={"active":"green","inactive":"gray","on_leave":"yellow"}, default="active"),
        ], foreign_keys=[
            {"column":"program_id","references":{"table":"programs","column":"id"}}
        ]),

        ENT("Grant", "grants", "Grant received", [
            F("program_id", "UUID NOT NULL", is_fk=True, fk_table="programs", fk_display="name", input_component="foreign_key_select"),
            F("grantor_name", "VARCHAR(255) NOT NULL"),
            F("amount", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("disbursed_amount", "NUMERIC(14,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("end_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("grant_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["federal","state","private","corporate","foundation"],
              badge_colors={"federal":"blue","state":"green","private":"purple","corporate":"orange","foundation":"teal"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'applied'", input_component="select",
              enum_values=["applied","awarded","active","reporting","closed","rejected"],
              badge_colors={"applied":"yellow","awarded":"green","active":"blue","reporting":"purple","closed":"gray","rejected":"red"}, default="applied"),
            F("reporting_frequency", "VARCHAR(20)", nullable=True, input_component="select",
              enum_values=["monthly","quarterly","semi_annual","annual"],
              badge_colors={"monthly":"blue","quarterly":"green","semi_annual":"purple","annual":"orange"},
              conditional_visibility={"field":"status","operator":"in","value":["active","reporting"]}),
        ], foreign_keys=[
            {"column":"program_id","references":{"table":"programs","column":"id"}}
        ], computed_fields=[
            {"name":"remaining_funds","expression":"amount - disbursed_amount","ts_expression":"amount - disbursed_amount"}
        ]),

        ENT("Event", "events", "Fundraising event", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("campaign_id", "UUID", nullable=True, is_fk=True, fk_table="campaigns", fk_display="name", input_component="foreign_key_select"),
            F("event_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("location", "VARCHAR(255) NOT NULL"),
            F("budget", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("ticket_price", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("max_attendees", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("event_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["gala","auction","walk_run","concert","dinner","virtual","golf"],
              badge_colors={"gala":"gold","auction":"purple","walk_run":"green","concert":"red","dinner":"orange","virtual":"teal","golf":"blue"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'", input_component="select",
              enum_values=["planning","confirmed","in_progress","completed","cancelled"],
              badge_colors={"planning":"yellow","confirmed":"blue","in_progress":"green","completed":"teal","cancelled":"red"}, default="planning"),
        ], foreign_keys=[
            {"column":"campaign_id","references":{"table":"campaigns","column":"id"}}
        ]),
    ])

# ── 16. fleet_management_spec.json ─────────────────────────────────────────
def gen_fleet_management():
    return SPEC("Fleet Management", "Vehicle fleet tracking and maintenance", [
        ENT("Vehicle", "vehicles", "Fleet vehicle", [
            F("plate_number", "VARCHAR(20) NOT NULL"),
            F("vin", "VARCHAR(17) NOT NULL", validation={"pattern":"^[A-HJ-NPR-Z0-9]{17}$","message":"Valid VIN required"}),
            F("make", "VARCHAR(50) NOT NULL"),
            F("model", "VARCHAR(50) NOT NULL"),
            F("year", "INTEGER NOT NULL", ts_type="number", validation={"min":1990,"max":2030}),
            F("vehicle_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["sedan","suv","van","truck","bus","motorcycle"],
              badge_colors={"sedan":"blue","suv":"green","van":"purple","truck":"orange","bus":"teal","motorcycle":"red"}),
            F("odometer_km", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("fuel_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["gasoline","diesel","electric","hybrid","cng"],
              badge_colors={"gasoline":"orange","diesel":"gray","electric":"green","hybrid":"teal","cng":"blue"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","maintenance","retired","sold","reserved"],
              badge_colors={"active":"green","maintenance":"yellow","retired":"gray","sold":"blue","reserved":"purple"}, default="active"),
        ]),

        ENT("Driver", "drivers", "Fleet driver", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("license_number", "VARCHAR(50) NOT NULL"),
            F("license_expiry", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("license_class", "VARCHAR(10) NOT NULL", input_component="select",
              enum_values=["A","B","C","D","CDL"],
              badge_colors={"A":"blue","B":"green","C":"gray","D":"orange","CDL":"purple"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","on_trip","off_duty","suspended","terminated"],
              badge_colors={"available":"green","on_trip":"blue","off_duty":"gray","suspended":"red","terminated":"orange"}, default="available"),
        ]),

        ENT("Route", "routes", "Predefined travel route", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("start_location", "VARCHAR(255) NOT NULL"),
            F("end_location", "VARCHAR(255) NOT NULL"),
            F("distance_km", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("estimated_time_hrs", "NUMERIC(5,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("route_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["urban","highway","rural","mixed"],
              badge_colors={"urban":"blue","highway":"green","rural":"orange","mixed":"purple"}),
            F("is_active", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ]),

        ENT("Trip", "trips", "Vehicle trip record", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="plate_number", input_component="foreign_key_select"),
            F("driver_id", "UUID NOT NULL", is_fk=True, fk_table="drivers", fk_display="name", input_component="foreign_key_select"),
            F("route_id", "UUID", nullable=True, is_fk=True, fk_table="routes", fk_display="name", input_component="foreign_key_select"),
            F("start_time", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("end_time", "TIMESTAMPTZ", nullable=True, input_component="datetime_picker", display_component="datetime",
              conditional_visibility={"field":"status","operator":"in","value":["completed","cancelled"]}),
            F("start_odometer", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("end_odometer", "INTEGER", nullable=True, ts_type="number",
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
            F("purpose", "VARCHAR(50) NOT NULL"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planned'", input_component="select",
              enum_values=["planned","in_progress","completed","cancelled"],
              badge_colors={"planned":"yellow","in_progress":"blue","completed":"green","cancelled":"red"}, default="planned"),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"driver_id","references":{"table":"drivers","column":"id"}},
            {"column":"route_id","references":{"table":"routes","column":"id"}},
        ], computed_fields=[
            {"name":"distance_traveled","expression":"COALESCE(end_odometer,0) - start_odometer","ts_expression":"(end_odometer || 0) - start_odometer"}
        ]),

        ENT("Maintenance", "maintenance_records", "Vehicle maintenance record", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="plate_number", input_component="foreign_key_select"),
            F("maintenance_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["oil_change","tire","brake","engine","transmission","inspection","body_repair","electrical"],
              badge_colors={"oil_change":"blue","tire":"green","brake":"orange","engine":"red","transmission":"purple","inspection":"teal","body_repair":"yellow","electrical":"pink"}),
            F("description", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("scheduled_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("completed_date", "DATE", nullable=True, input_component="date_picker", display_component="date",
              conditional_visibility={"field":"status","operator":"equals","value":"completed"}),
            F("cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("odometer_at_service", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("vendor_name", "VARCHAR(255)", nullable=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'scheduled'", input_component="select",
              enum_values=["scheduled","in_progress","completed","overdue","cancelled"],
              badge_colors={"scheduled":"blue","in_progress":"yellow","completed":"green","overdue":"red","cancelled":"gray"}, default="scheduled"),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}}
        ]),

        ENT("FuelLog", "fuel_logs", "Vehicle fuel purchase", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="plate_number", input_component="foreign_key_select"),
            F("driver_id", "UUID NOT NULL", is_fk=True, fk_table="drivers", fk_display="name", input_component="foreign_key_select"),
            F("date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("liters", "NUMERIC(8,2) NOT NULL", ts_type="number", validation={"min":0.1}),
            F("cost_per_liter", "NUMERIC(6,3) NOT NULL", ts_type="number", validation={"min":0}),
            F("odometer", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("fuel_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["gasoline","diesel","electric","cng"],
              badge_colors={"gasoline":"orange","diesel":"gray","electric":"green","cng":"blue"}),
            F("is_full_tank", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"driver_id","references":{"table":"drivers","column":"id"}},
        ], computed_fields=[
            {"name":"total_cost","expression":"liters * cost_per_liter","ts_expression":"liters * cost_per_liter"}
        ]),

        ENT("Incident", "incidents", "Vehicle incident / accident", [
            F("vehicle_id", "UUID NOT NULL", is_fk=True, fk_table="vehicles", fk_display="plate_number", input_component="foreign_key_select"),
            F("driver_id", "UUID NOT NULL", is_fk=True, fk_table="drivers", fk_display="name", input_component="foreign_key_select"),
            F("incident_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("location", "VARCHAR(255) NOT NULL"),
            F("incident_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["collision","breakdown","theft","vandalism","traffic_violation","injury"],
              badge_colors={"collision":"red","breakdown":"orange","theft":"purple","vandalism":"yellow","traffic_violation":"blue","injury":"red"}),
            F("severity", "VARCHAR(10) NOT NULL", input_component="select",
              enum_values=["minor","moderate","major","total_loss"],
              badge_colors={"minor":"yellow","moderate":"orange","major":"red","total_loss":"gray"}),
            F("description", "TEXT NOT NULL", input_component="textarea", show_in_table=False),
            F("estimated_damage", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency"),
            F("insurance_claim_filed", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'reported'", input_component="select",
              enum_values=["reported","under_investigation","resolved","closed"],
              badge_colors={"reported":"yellow","under_investigation":"blue","resolved":"green","closed":"gray"}, default="reported"),
        ], foreign_keys=[
            {"column":"vehicle_id","references":{"table":"vehicles","column":"id"}},
            {"column":"driver_id","references":{"table":"drivers","column":"id"}},
        ]),
    ])

# ── 17. photography_spec.json ──────────────────────────────────────────────
def gen_photography():
    return SPEC("Photography Business", "Photography studio and session management", [
        ENT("Client", "clients", "Photography client", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("client_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["individual","wedding","corporate","real_estate","event"],
              badge_colors={"individual":"blue","wedding":"pink","corporate":"green","real_estate":"orange","event":"purple"}),
            F("address", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("referral_source", "VARCHAR(30)", nullable=True, input_component="select",
              enum_values=["website","instagram","referral","google","facebook","other"],
              badge_colors={"website":"blue","instagram":"pink","referral":"green","google":"orange","facebook":"blue","other":"gray"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","past","vip","lead"],
              badge_colors={"active":"green","past":"gray","vip":"gold","lead":"yellow"}, default="active"),
        ]),

        ENT("Location", "locations", "Shoot location", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("address", "TEXT NOT NULL", input_component="textarea"),
            F("location_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["studio","outdoor","venue","home","office","other"],
              badge_colors={"studio":"blue","outdoor":"green","venue":"purple","home":"orange","office":"teal","other":"gray"}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("capacity", "INTEGER", nullable=True, ts_type="number", validation={"min":1}),
            F("has_lighting", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ]),

        ENT("Session", "sessions", "Photography session / shoot", [
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="name", input_component="foreign_key_select"),
            F("location_id", "UUID", nullable=True, is_fk=True, fk_table="locations", fk_display="name", input_component="foreign_key_select"),
            F("session_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("duration_hours", "NUMERIC(4,1) NOT NULL", ts_type="number", validation={"min":0.5,"max":12}),
            F("session_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["portrait","wedding","event","product","real_estate","headshot","family","newborn"],
              badge_colors={"portrait":"blue","wedding":"pink","event":"purple","product":"green","real_estate":"orange","headshot":"teal","family":"yellow","newborn":"red"}),
            F("package_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'booked'", input_component="select",
              enum_values=["inquiry","booked","confirmed","completed","editing","delivered","cancelled"],
              badge_colors={"inquiry":"gray","booked":"blue","confirmed":"green","completed":"teal","editing":"purple","delivered":"gold","cancelled":"red"}, default="booked"),
            F("num_photos_delivered", "INTEGER NOT NULL DEFAULT 0", ts_type="number", editable=False, show_in_form=False, default=0),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"location_id","references":{"table":"locations","column":"id"}},
        ]),

        ENT("Gallery", "galleries", "Photo gallery for client delivery", [
            F("session_id", "UUID NOT NULL", is_fk=True, fk_table="sessions", fk_display="id", input_component="foreign_key_select"),
            F("name", "VARCHAR(255) NOT NULL"),
            F("gallery_url", "TEXT", nullable=True, show_in_table=False),
            F("password", "VARCHAR(50)", nullable=True, show_in_table=False),
            F("photo_count", "INTEGER NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("download_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("expiry_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","published","expired","archived"],
              badge_colors={"draft":"gray","published":"green","expired":"orange","archived":"blue"}, default="draft"),
        ], foreign_keys=[
            {"column":"session_id","references":{"table":"sessions","column":"id"}}
        ]),

        ENT("Invoice", "invoices", "Client invoice", [
            F("session_id", "UUID NOT NULL", is_fk=True, fk_table="sessions", fk_display="id", input_component="foreign_key_select"),
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="name", input_component="foreign_key_select"),
            F("invoice_number", "VARCHAR(50) NOT NULL"),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("tax_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("deposit_paid", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'unpaid'", input_component="select",
              enum_values=["unpaid","partial","paid","overdue","void"],
              badge_colors={"unpaid":"red","partial":"yellow","paid":"green","overdue":"orange","void":"gray"}, default="unpaid"),
        ], foreign_keys=[
            {"column":"session_id","references":{"table":"sessions","column":"id"}},
            {"column":"client_id","references":{"table":"clients","column":"id"}},
        ], computed_fields=[
            {"name":"total","expression":"amount + tax_amount","ts_expression":"amount + tax_amount"},
            {"name":"balance_due","expression":"amount + tax_amount - deposit_paid","ts_expression":"amount + tax_amount - deposit_paid"}
        ]),

        ENT("Contract", "contracts", "Client service contract", [
            F("client_id", "UUID NOT NULL", is_fk=True, fk_table="clients", fk_display="name", input_component="foreign_key_select"),
            F("session_id", "UUID", nullable=True, is_fk=True, fk_table="sessions", fk_display="id", input_component="foreign_key_select"),
            F("contract_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["standard","wedding","commercial","event","custom"],
              badge_colors={"standard":"blue","wedding":"pink","commercial":"green","event":"purple","custom":"orange"}),
            F("signed_date", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("contract_url", "TEXT", nullable=True, show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","sent","signed","expired","cancelled"],
              badge_colors={"draft":"gray","sent":"blue","signed":"green","expired":"orange","cancelled":"red"}, default="draft"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"client_id","references":{"table":"clients","column":"id"}},
            {"column":"session_id","references":{"table":"sessions","column":"id"}},
        ]),

        ENT("Equipment", "equipment", "Photography gear", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("category", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["camera","lens","lighting","tripod","backdrop","audio","drone","accessory"],
              badge_colors={"camera":"blue","lens":"green","lighting":"yellow","tripod":"gray","backdrop":"purple","audio":"orange","drone":"teal","accessory":"pink"}),
            F("brand", "VARCHAR(100) NOT NULL"),
            F("serial_number", "VARCHAR(100)", nullable=True, show_in_table=False),
            F("purchase_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("purchase_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("condition", "VARCHAR(20) NOT NULL DEFAULT 'good'", input_component="select",
              enum_values=["new","good","fair","needs_repair","retired"],
              badge_colors={"new":"green","good":"blue","fair":"yellow","needs_repair":"orange","retired":"gray"}, default="good"),
            F("insurance_value", "NUMERIC(10,2)", nullable=True, ts_type="number", display_component="currency", show_in_table=False),
        ]),
    ])

# ── 18. music_studio_spec.json ─────────────────────────────────────────────
def gen_music_studio():
    return SPEC("Music Studio", "Recording studio session and project management", [
        ENT("Artist", "artists", "Recording artist or band", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("genre", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["rock","pop","hip_hop","rnb","jazz","classical","electronic","country","latin","other"],
              badge_colors={"rock":"red","pop":"pink","hip_hop":"purple","rnb":"blue","jazz":"teal","classical":"gold","electronic":"green","country":"orange","latin":"yellow","other":"gray"}),
            F("artist_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["solo","band","duo","ensemble","dj"],
              badge_colors={"solo":"blue","band":"green","duo":"purple","ensemble":"teal","dj":"orange"}),
            F("label", "VARCHAR(255)", nullable=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","inactive","prospect"],
              badge_colors={"active":"green","inactive":"gray","prospect":"yellow"}, default="active"),
        ]),

        ENT("Room", "rooms", "Studio room", [
            F("name", "VARCHAR(100) NOT NULL"),
            F("room_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["tracking","mixing","mastering","rehearsal","vocal_booth","production"],
              badge_colors={"tracking":"blue","mixing":"green","mastering":"gold","rehearsal":"orange","vocal_booth":"purple","production":"teal"}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("capacity", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":50}),
            F("has_isolation", "BOOLEAN NOT NULL DEFAULT TRUE", ts_type="boolean", input_component="toggle", display_component="boolean", default=True),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","in_use","maintenance","reserved"],
              badge_colors={"available":"green","in_use":"blue","maintenance":"yellow","reserved":"purple"}, default="available"),
        ]),

        ENT("Engineer", "engineers", "Audio engineer", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("specialization", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["recording","mixing","mastering","live_sound","post_production","producer"],
              badge_colors={"recording":"blue","mixing":"green","mastering":"gold","live_sound":"orange","post_production":"purple","producer":"red"}),
            F("hourly_rate", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("experience_years", "INTEGER NOT NULL DEFAULT 0", ts_type="number", validation={"min":0,"max":50}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'available'", input_component="select",
              enum_values=["available","in_session","off_duty","on_leave"],
              badge_colors={"available":"green","in_session":"blue","off_duty":"gray","on_leave":"yellow"}, default="available"),
        ]),

        ENT("Session", "sessions", "Recording session", [
            F("artist_id", "UUID NOT NULL", is_fk=True, fk_table="artists", fk_display="name", input_component="foreign_key_select"),
            F("room_id", "UUID NOT NULL", is_fk=True, fk_table="rooms", fk_display="name", input_component="foreign_key_select"),
            F("engineer_id", "UUID NOT NULL", is_fk=True, fk_table="engineers", fk_display="name", input_component="foreign_key_select"),
            F("session_date", "TIMESTAMPTZ NOT NULL", input_component="datetime_picker", display_component="datetime"),
            F("duration_hours", "NUMERIC(4,1) NOT NULL", ts_type="number", validation={"min":0.5,"max":24}),
            F("session_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["recording","mixing","mastering","rehearsal","overdub","vocal"],
              badge_colors={"recording":"blue","mixing":"green","mastering":"gold","rehearsal":"orange","overdub":"purple","vocal":"pink"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'booked'", input_component="select",
              enum_values=["booked","in_progress","completed","cancelled","no_show"],
              badge_colors={"booked":"blue","in_progress":"yellow","completed":"green","cancelled":"red","no_show":"gray"}, default="booked"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"artist_id","references":{"table":"artists","column":"id"}},
            {"column":"room_id","references":{"table":"rooms","column":"id"}},
            {"column":"engineer_id","references":{"table":"engineers","column":"id"}},
        ], computed_fields=[
            {"name":"estimated_cost","expression":"duration_hours * (SELECT hourly_rate FROM rooms WHERE id = room_id)","ts_expression":"duration_hours * 0"}
        ]),

        ENT("Project", "projects", "Music project / album", [
            F("artist_id", "UUID NOT NULL", is_fk=True, fk_table="artists", fk_display="name", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("project_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["single","ep","album","mixtape","compilation","soundtrack"],
              badge_colors={"single":"blue","ep":"green","album":"purple","mixtape":"orange","compilation":"teal","soundtrack":"gold"}),
            F("start_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("target_release", "DATE", nullable=True, input_component="date_picker", display_component="date"),
            F("budget", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("spent", "NUMERIC(12,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", editable=False, show_in_form=False, default=0),
            F("track_count", "INTEGER NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'pre_production'", input_component="select",
              enum_values=["pre_production","recording","mixing","mastering","complete","released","shelved"],
              badge_colors={"pre_production":"yellow","recording":"blue","mixing":"green","mastering":"gold","complete":"teal","released":"purple","shelved":"gray"}, default="pre_production"),
        ], foreign_keys=[
            {"column":"artist_id","references":{"table":"artists","column":"id"}}
        ], computed_fields=[
            {"name":"remaining_budget","expression":"budget - spent","ts_expression":"budget - spent"}
        ]),

        ENT("Invoice", "invoices", "Studio invoice", [
            F("artist_id", "UUID NOT NULL", is_fk=True, fk_table="artists", fk_display="name", input_component="foreign_key_select"),
            F("project_id", "UUID", nullable=True, is_fk=True, fk_table="projects", fk_display="title", input_component="foreign_key_select"),
            F("invoice_number", "VARCHAR(50) NOT NULL"),
            F("amount", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("tax_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("issue_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'draft'", input_component="select",
              enum_values=["draft","sent","paid","overdue","void"],
              badge_colors={"draft":"gray","sent":"blue","paid":"green","overdue":"red","void":"gray"}, default="draft"),
        ], foreign_keys=[
            {"column":"artist_id","references":{"table":"artists","column":"id"}},
            {"column":"project_id","references":{"table":"projects","column":"id"}},
        ], computed_fields=[
            {"name":"total","expression":"amount + tax_amount","ts_expression":"amount + tax_amount"}
        ]),

        ENT("Equipment", "equipment", "Studio equipment", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("category", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["microphone","preamp","compressor","console","monitor","headphones","cable","instrument","software"],
              badge_colors={"microphone":"blue","preamp":"green","compressor":"orange","console":"purple","monitor":"teal","headphones":"pink","cable":"gray","instrument":"red","software":"yellow"}),
            F("brand", "VARCHAR(100) NOT NULL"),
            F("model", "VARCHAR(100)", nullable=True),
            F("serial_number", "VARCHAR(100)", nullable=True, show_in_table=False),
            F("purchase_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("room_id", "UUID", nullable=True, is_fk=True, fk_table="rooms", fk_display="name", input_component="foreign_key_select"),
            F("condition", "VARCHAR(20) NOT NULL DEFAULT 'good'", input_component="select",
              enum_values=["new","good","fair","needs_repair","retired"],
              badge_colors={"new":"green","good":"blue","fair":"yellow","needs_repair":"orange","retired":"gray"}, default="good"),
        ], foreign_keys=[
            {"column":"room_id","references":{"table":"rooms","column":"id"}}
        ]),
    ])

# ── 19. wedding_planner_spec.json ──────────────────────────────────────────
def gen_wedding_planner():
    return SPEC("Wedding Planner", "Wedding event planning and coordination", [
        ENT("Wedding", "weddings", "Wedding event", [
            F("couple_names", "VARCHAR(255) NOT NULL", label="Couple Names"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("wedding_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("guest_count", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":2000}),
            F("total_budget", "NUMERIC(14,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("theme", "VARCHAR(50)", nullable=True),
            F("wedding_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["traditional","destination","elopement","micro","virtual","cultural"],
              badge_colors={"traditional":"blue","destination":"green","elopement":"pink","micro":"teal","virtual":"purple","cultural":"gold"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'", input_component="select",
              enum_values=["inquiry","planning","confirmed","day_of","completed","cancelled"],
              badge_colors={"inquiry":"gray","planning":"yellow","confirmed":"blue","day_of":"green","completed":"teal","cancelled":"red"}, default="planning"),
        ]),

        ENT("Venue", "venues", "Wedding venue", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("address", "TEXT NOT NULL", input_component="textarea"),
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("venue_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["ceremony","reception","both","rehearsal_dinner","after_party"],
              badge_colors={"ceremony":"blue","reception":"green","both":"purple","rehearsal_dinner":"orange","after_party":"pink"}),
            F("capacity", "INTEGER NOT NULL", ts_type="number", validation={"min":1}),
            F("cost", "NUMERIC(12,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("contact_name", "VARCHAR(255)", nullable=True),
            F("contact_phone", "VARCHAR(20)", nullable=True, validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'considering'", input_component="select",
              enum_values=["considering","booked","confirmed","cancelled"],
              badge_colors={"considering":"yellow","booked":"blue","confirmed":"green","cancelled":"red"}, default="considering"),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ]),

        ENT("Vendor", "vendors", "Wedding vendor / supplier", [
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("company_name", "VARCHAR(255) NOT NULL"),
            F("contact_name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255) NOT NULL", validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("phone", "VARCHAR(20) NOT NULL", validation={"pattern":"^\\+?[0-9\\-\\s]{7,20}$","message":"Valid phone required"}),
            F("vendor_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["photographer","videographer","florist","caterer","dj","band","cake","officiant","hair_makeup","planner","rentals","transportation"],
              badge_colors={"photographer":"blue","videographer":"green","florist":"pink","caterer":"orange","dj":"purple","band":"red","cake":"yellow","officiant":"teal","hair_makeup":"pink","planner":"gold","rentals":"gray","transportation":"blue"}),
            F("quoted_price", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("deposit_paid", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'contacted'", input_component="select",
              enum_values=["contacted","quoted","booked","confirmed","paid","cancelled"],
              badge_colors={"contacted":"gray","quoted":"yellow","booked":"blue","confirmed":"green","paid":"teal","cancelled":"red"}, default="contacted"),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ], computed_fields=[
            {"name":"balance_due","expression":"quoted_price - deposit_paid","ts_expression":"quoted_price - deposit_paid"}
        ]),

        ENT("Guest", "guests", "Wedding guest", [
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("name", "VARCHAR(255) NOT NULL"),
            F("email", "VARCHAR(255)", nullable=True, validation={"pattern":"^[^@]+@[^@]+\\.[^@]+$","message":"Valid email required"}),
            F("plus_one", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
            F("rsvp_status", "VARCHAR(20) NOT NULL DEFAULT 'pending'", input_component="select",
              enum_values=["pending","accepted","declined","tentative"],
              badge_colors={"pending":"yellow","accepted":"green","declined":"red","tentative":"blue"}, default="pending"),
            F("dietary_restrictions", "VARCHAR(50)", nullable=True, input_component="select",
              enum_values=["none","vegetarian","vegan","gluten_free","kosher","halal","other"],
              badge_colors={"none":"gray","vegetarian":"green","vegan":"teal","gluten_free":"yellow","kosher":"blue","halal":"purple","other":"orange"},
              conditional_visibility={"field":"rsvp_status","operator":"equals","value":"accepted"}),
            F("table_number", "INTEGER", nullable=True, ts_type="number",
              conditional_visibility={"field":"rsvp_status","operator":"equals","value":"accepted"}),
            F("group_name", "VARCHAR(50)", nullable=True, input_component="select",
              enum_values=["bride_family","groom_family","bride_friends","groom_friends","work","other"],
              badge_colors={"bride_family":"pink","groom_family":"blue","bride_friends":"purple","groom_friends":"teal","work":"green","other":"gray"}),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ]),

        ENT("Task", "tasks", "Planning task", [
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("category", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["venue","attire","food","decor","entertainment","photography","invitations","legal","beauty","transportation","other"],
              badge_colors={"venue":"blue","attire":"pink","food":"orange","decor":"purple","entertainment":"green","photography":"teal","invitations":"yellow","legal":"gray","beauty":"red","transportation":"blue","other":"gray"}),
            F("due_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("priority", "VARCHAR(10) NOT NULL DEFAULT 'medium'", input_component="select",
              enum_values=["low","medium","high","critical"],
              badge_colors={"low":"gray","medium":"blue","high":"orange","critical":"red"}, default="medium"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'todo'", input_component="select",
              enum_values=["todo","in_progress","done","deferred"],
              badge_colors={"todo":"gray","in_progress":"blue","done":"green","deferred":"yellow"}, default="todo"),
            F("assigned_to", "VARCHAR(255)", nullable=True),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ]),

        ENT("Budget", "budget_items", "Budget line item", [
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("category", "VARCHAR(50) NOT NULL"),
            F("description", "VARCHAR(255) NOT NULL"),
            F("estimated_cost", "NUMERIC(10,2) NOT NULL", ts_type="number", display_component="currency", validation={"min":0}),
            F("actual_cost", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("paid_amount", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", display_component="currency", default=0),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'estimated'", input_component="select",
              enum_values=["estimated","quoted","booked","paid","over_budget"],
              badge_colors={"estimated":"gray","quoted":"yellow","booked":"blue","paid":"green","over_budget":"red"}, default="estimated"),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ], computed_fields=[
            {"name":"variance","expression":"estimated_cost - actual_cost","ts_expression":"estimated_cost - actual_cost"},
            {"name":"balance_due","expression":"actual_cost - paid_amount","ts_expression":"actual_cost - paid_amount"}
        ]),

        ENT("Timeline", "timeline_items", "Wedding day timeline event", [
            F("wedding_id", "UUID NOT NULL", is_fk=True, fk_table="weddings", fk_display="couple_names", input_component="foreign_key_select"),
            F("title", "VARCHAR(255) NOT NULL"),
            F("start_time", "TIME NOT NULL", input_component="time_picker"),
            F("end_time", "TIME NOT NULL", input_component="time_picker"),
            F("location", "VARCHAR(255)", nullable=True),
            F("responsible_person", "VARCHAR(255)", nullable=True),
            F("category", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["prep","ceremony","photos","cocktail","reception","entertainment","departure"],
              badge_colors={"prep":"yellow","ceremony":"blue","photos":"green","cocktail":"orange","reception":"purple","entertainment":"red","departure":"gray"}),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'planned'", input_component="select",
              enum_values=["planned","confirmed","completed","changed"],
              badge_colors={"planned":"yellow","confirmed":"blue","completed":"green","changed":"orange"}, default="planned"),
        ], foreign_keys=[
            {"column":"wedding_id","references":{"table":"weddings","column":"id"}}
        ]),
    ])

# ── 20. fitness_tracker_spec.json ──────────────────────────────────────────
def gen_fitness_tracker():
    return SPEC("Fitness Tracker", "Personal fitness and wellness tracking", [
        ENT("Program", "programs", "Training program", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("duration_weeks", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":52}),
            F("difficulty", "VARCHAR(20) NOT NULL DEFAULT 'intermediate'", input_component="select",
              enum_values=["beginner","intermediate","advanced","elite"],
              badge_colors={"beginner":"green","intermediate":"blue","advanced":"orange","elite":"red"}, default="intermediate"),
            F("program_type", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["strength","cardio","hiit","yoga","flexibility","crossfit","bodybuilding","sports"],
              badge_colors={"strength":"red","cardio":"green","hiit":"orange","yoga":"purple","flexibility":"teal","crossfit":"yellow","bodybuilding":"blue","sports":"gray"}),
            F("sessions_per_week", "INTEGER NOT NULL DEFAULT 3", ts_type="number", validation={"min":1,"max":14}, default=3),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["draft","active","completed","archived"],
              badge_colors={"draft":"gray","active":"green","completed":"blue","archived":"orange"}, default="active"),
        ]),

        ENT("Goal", "goals", "Fitness goal", [
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("goal_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["weight_loss","muscle_gain","endurance","flexibility","strength","general_fitness"],
              badge_colors={"weight_loss":"green","muscle_gain":"red","endurance":"blue","flexibility":"purple","strength":"orange","general_fitness":"teal"}),
            F("target_value", "NUMERIC(10,2) NOT NULL", ts_type="number", validation={"min":0}),
            F("current_value", "NUMERIC(10,2) NOT NULL DEFAULT 0", ts_type="number", default=0),
            F("unit", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["kg","lbs","minutes","reps","km","miles","percent"],
              badge_colors={"kg":"blue","lbs":"blue","minutes":"green","reps":"orange","km":"teal","miles":"teal","percent":"purple"}),
            F("target_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("status", "VARCHAR(20) NOT NULL DEFAULT 'active'", input_component="select",
              enum_values=["active","achieved","missed","paused"],
              badge_colors={"active":"blue","achieved":"green","missed":"red","paused":"yellow"}, default="active"),
        ], computed_fields=[
            {"name":"progress_pct","expression":"ROUND(current_value / NULLIF(target_value,0) * 100, 2)","ts_expression":"(current_value / target_value * 100).toFixed(2)"},
            {"name":"remaining","expression":"target_value - current_value","ts_expression":"target_value - current_value"}
        ]),

        ENT("Exercise", "exercises", "Exercise definition", [
            F("name", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("muscle_group", "VARCHAR(30) NOT NULL", input_component="select",
              enum_values=["chest","back","shoulders","biceps","triceps","legs","core","glutes","full_body","cardio"],
              badge_colors={"chest":"red","back":"blue","shoulders":"orange","biceps":"purple","triceps":"teal","legs":"green","core":"yellow","glutes":"pink","full_body":"gray","cardio":"green"}),
            F("exercise_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["compound","isolation","cardio","flexibility","plyometric","isometric"],
              badge_colors={"compound":"blue","isolation":"orange","cardio":"green","flexibility":"purple","plyometric":"red","isometric":"teal"}),
            F("equipment_needed", "VARCHAR(50)", nullable=True),
            F("difficulty", "VARCHAR(20) NOT NULL DEFAULT 'intermediate'", input_component="select",
              enum_values=["beginner","intermediate","advanced"],
              badge_colors={"beginner":"green","intermediate":"blue","advanced":"red"}, default="intermediate"),
            F("calories_per_hour", "INTEGER", nullable=True, ts_type="number", validation={"min":0}),
        ]),

        ENT("Workout", "workouts", "Workout session", [
            F("program_id", "UUID", nullable=True, is_fk=True, fk_table="programs", fk_display="name", input_component="foreign_key_select"),
            F("workout_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("start_time", "TIME NOT NULL", input_component="time_picker"),
            F("duration_minutes", "INTEGER NOT NULL", ts_type="number", validation={"min":1,"max":480}),
            F("workout_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["strength","cardio","hiit","yoga","flexibility","mixed"],
              badge_colors={"strength":"red","cardio":"green","hiit":"orange","yoga":"purple","flexibility":"teal","mixed":"blue"}),
            F("calories_burned", "INTEGER", nullable=True, ts_type="number", validation={"min":0}),
            F("intensity", "VARCHAR(10) NOT NULL DEFAULT 'moderate'", input_component="select",
              enum_values=["light","moderate","high","maximum"],
              badge_colors={"light":"green","moderate":"blue","high":"orange","maximum":"red"}, default="moderate"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("rating", "INTEGER", nullable=True, ts_type="number", validation={"min":1,"max":5}),
        ], foreign_keys=[
            {"column":"program_id","references":{"table":"programs","column":"id"}}
        ]),

        ENT("MealLog", "meal_logs", "Daily meal tracking", [
            F("meal_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("meal_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["breakfast","lunch","dinner","snack","pre_workout","post_workout"],
              badge_colors={"breakfast":"yellow","lunch":"green","dinner":"blue","snack":"orange","pre_workout":"purple","post_workout":"teal"}),
            F("description", "TEXT NOT NULL", input_component="textarea"),
            F("calories", "INTEGER NOT NULL", ts_type="number", validation={"min":0}),
            F("protein_g", "NUMERIC(6,1) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("carbs_g", "NUMERIC(6,1) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("fat_g", "NUMERIC(6,1) NOT NULL DEFAULT 0", ts_type="number", validation={"min":0}, default=0),
            F("goal_id", "UUID", nullable=True, is_fk=True, fk_table="goals", fk_display="title", input_component="foreign_key_select"),
        ], foreign_keys=[
            {"column":"goal_id","references":{"table":"goals","column":"id"}}
        ], computed_fields=[
            {"name":"total_macros_g","expression":"protein_g + carbs_g + fat_g","ts_expression":"protein_g + carbs_g + fat_g"}
        ]),

        ENT("BodyMetric", "body_metrics", "Body measurement record", [
            F("date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("weight_kg", "NUMERIC(5,1)", nullable=True, ts_type="number", validation={"min":20,"max":300}),
            F("body_fat_pct", "NUMERIC(4,1)", nullable=True, ts_type="number", validation={"min":2,"max":60}),
            F("muscle_mass_kg", "NUMERIC(5,1)", nullable=True, ts_type="number", validation={"min":0}),
            F("waist_cm", "NUMERIC(5,1)", nullable=True, ts_type="number", validation={"min":30,"max":200}),
            F("chest_cm", "NUMERIC(5,1)", nullable=True, ts_type="number", validation={"min":50,"max":200}),
            F("bmi", "NUMERIC(4,1)", nullable=True, ts_type="number", editable=False, show_in_form=False),
            F("goal_id", "UUID", nullable=True, is_fk=True, fk_table="goals", fk_display="title", input_component="foreign_key_select"),
            F("notes", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
        ], foreign_keys=[
            {"column":"goal_id","references":{"table":"goals","column":"id"}}
        ]),

        ENT("Achievement", "achievements", "Fitness milestone / achievement", [
            F("title", "VARCHAR(255) NOT NULL"),
            F("description", "TEXT", nullable=True, input_component="textarea", show_in_table=False),
            F("achieved_date", "DATE NOT NULL", input_component="date_picker", display_component="date"),
            F("achievement_type", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["personal_record","streak","milestone","challenge","competition"],
              badge_colors={"personal_record":"gold","streak":"green","milestone":"blue","challenge":"purple","competition":"red"}),
            F("category", "VARCHAR(20) NOT NULL", input_component="select",
              enum_values=["strength","cardio","consistency","nutrition","body_composition"],
              badge_colors={"strength":"red","cardio":"green","consistency":"blue","nutrition":"orange","body_composition":"purple"}),
            F("value", "NUMERIC(10,2)", nullable=True, ts_type="number"),
            F("unit", "VARCHAR(20)", nullable=True),
            F("is_verified", "BOOLEAN NOT NULL DEFAULT FALSE", ts_type="boolean", input_component="toggle", display_component="boolean", default=False),
        ]),
    ])


# ── Main execution ─────────────────────────────────────────────────────────
def main():
    generators = [
        ("salon_booking_spec.json", gen_salon_booking),
        ("hotel_management_spec.json", gen_hotel_management),
        ("school_management_spec.json", gen_school_management),
        ("event_management_spec.json", gen_event_management),
        ("invoice_billing_spec.json", gen_invoice_billing),
        ("construction_spec.json", gen_construction),
        ("law_firm_spec.json", gen_law_firm),
        ("recruitment_spec.json", gen_recruitment),
        ("property_management_spec.json", gen_property_management),
        ("veterinary_clinic_spec.json", gen_veterinary_clinic),
        ("car_dealership_spec.json", gen_car_dealership),
        ("logistics_spec.json", gen_logistics),
        ("task_management_spec.json", gen_task_management),
        ("insurance_spec.json", gen_insurance),
        ("nonprofit_spec.json", gen_nonprofit),
        ("fleet_management_spec.json", gen_fleet_management),
        ("photography_spec.json", gen_photography),
        ("music_studio_spec.json", gen_music_studio),
        ("wedding_planner_spec.json", gen_wedding_planner),
        ("fitness_tracker_spec.json", gen_fitness_tracker),
    ]

    print(f"Generating {len(generators)} production-depth specs...")
    total_entities = 0
    for filename, gen_func in generators:
        spec = gen_func()
        save(filename, spec)
        total_entities += len(spec["entities"])

    print(f"\nDone! Generated {total_entities} total entities across {len(generators)} specs.")

if __name__ == "__main__":
    main()
