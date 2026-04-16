#!/usr/bin/env python3
"""Generate 25 production-depth spec files with FK relationships, validation,
computed fields, badge_colors, and conditional visibility."""

import json, os

SPEC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spec")

# ── helpers ──────────────────────────────────────────────────────────────────

SYS_PRE = [
    {"name":"id","db_type":"UUID DEFAULT gen_random_uuid() PRIMARY KEY","ts_type":"string",
     "nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,
     "input_component":"none","display_component":"text"},
    {"name":"org_id","db_type":"UUID NOT NULL","ts_type":"string",
     "nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,
     "input_component":"none","display_component":"text"},
]

SYS_POST = [
    {"name":"created_at","db_type":"TIMESTAMPTZ NOT NULL DEFAULT now()","ts_type":"string",
     "nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,
     "input_component":"none","display_component":"date"},
    {"name":"updated_at","db_type":"TIMESTAMPTZ NOT NULL DEFAULT now()","ts_type":"string",
     "nullable":False,"editable":False,"show_in_table":False,"show_in_form":False,
     "input_component":"none","display_component":"date"},
]

def F(name, db_type="VARCHAR(255) NOT NULL", ts_type="string", nullable=False,
      table=True, form=True, editable=True, inp="text_input", disp="text",
      ev=None, bc=None, fk=None, validation=None, computed=None, visible_when=None):
    """Build a field dict."""
    f = {"name":name,"db_type":db_type,"ts_type":ts_type,"nullable":nullable,
         "editable":editable,"show_in_table":table,"show_in_form":form,
         "input_component":inp,"display_component":disp}
    if ev:
        f["enum_values"] = ev
    if bc:
        f["badge_colors"] = bc
    if fk:
        f["fk_entity"] = fk
    if validation:
        f["validation"] = validation
    if computed:
        f["computed"] = computed
    if visible_when:
        f["visible_when"] = visible_when
    return f

def ENT(name, table_name, fields, desc=None):
    """Build an entity dict with system fields."""
    return {
        "name": name,
        "table": table_name,
        "description": desc or name,
        "fields": SYS_PRE + fields + SYS_POST
    }

def SPEC(spec_name, app_name, entities):
    """Build a full spec dict."""
    return {
        "_meta": {"app_name": app_name, "description": f"Complete {app_name.lower()} management"},
        "spec_name": spec_name,
        "entities": entities
    }

def write_spec(spec_name, data):
    path = os.path.join(SPEC_DIR, f"{spec_name}.json")
    with open(path, "w") as fp:
        json.dump(data, fp, indent=2)
    print(f"  wrote {path}")

# ── status/enum helpers ──────────────────────────────────────────────────────

def status_field(name="status", ev=None, bc=None, default_ev=None, default_bc=None):
    if ev is None:
        ev = default_ev or ["active","inactive","archived"]
    if bc is None:
        bc = default_bc or {"active":"green","inactive":"amber","archived":"slate"}
    return F(name, "VARCHAR(50) NOT NULL", "string", False, True, True, True,
             "select", "status_badge", ev=ev, bc=bc)

def priority_field():
    return F("priority", "VARCHAR(20) NOT NULL", "string", False, True, True, True,
             "select", "status_badge",
             ev=["low","medium","high","critical"],
             bc={"low":"slate","medium":"blue","high":"amber","critical":"red"})

def email_field(name="email"):
    return F(name, "VARCHAR(255) NOT NULL", "string", False, True, True, True,
             "text_input", "text", validation={"rule":"email","message":"Valid email required"})

def phone_field(name="phone"):
    return F(name, "VARCHAR(20)", "string", True, True, True, True,
             "text_input", "text",
             validation={"rule":"phone","message":"Valid phone number required"})

def money_field(name, nullable=False, computed=None, table=True, form=True, editable=True, visible_when=None):
    f = F(name, f"NUMERIC(15,2){'' if nullable else ' NOT NULL'}", "number",
          nullable, table, form, editable, "number_input", "currency")
    if computed:
        f["computed"] = computed
        f["editable"] = False
        f["show_in_form"] = False
    if not nullable:
        f.setdefault("validation", {})["min"] = 0
    if visible_when:
        f["visible_when"] = visible_when
    return f

def pct_field(name, computed=None):
    f = F(name, "NUMERIC(5,2)", "number", True, True, False, False,
          "number_input", "percentage")
    if computed:
        f["computed"] = computed
    return f

def fk_field(name, entity, nullable=False):
    return F(name, f"UUID{'' if nullable else ' NOT NULL'}", "string", nullable,
             True, True, True, "relation_select", "relation_link", fk=entity)

def date_field(name, nullable=True, form=True, visible_when=None):
    return F(name, "DATE" + ("" if nullable else " NOT NULL"), "string", nullable,
             True, form, True, "date_picker", "date", visible_when=visible_when)

def datetime_field(name, nullable=True, form=True, visible_when=None):
    return F(name, "TIMESTAMPTZ" + ("" if nullable else " NOT NULL"), "string", nullable,
             True, form, True, "datetime_picker", "date", visible_when=visible_when)

def text_field(name, nullable=True, table=False, visible_when=None):
    return F(name, "TEXT", "string", nullable, table, True, True, "textarea", "text",
             visible_when=visible_when)

def bool_field(name, default=False):
    return F(name, f"BOOLEAN NOT NULL DEFAULT {'true' if default else 'false'}", "boolean",
             False, True, True, True, "checkbox", "boolean")

def int_field(name, nullable=False, computed=None, table=True, form=True, visible_when=None):
    f = F(name, f"INTEGER{'' if nullable else ' NOT NULL DEFAULT 0'}", "number",
          nullable, table, form, True, "number_input", "text")
    if computed:
        f["computed"] = computed
        f["editable"] = False
        f["show_in_form"] = False
    if visible_when:
        f["visible_when"] = visible_when
    return f

def url_field(name="url"):
    return F(name, "VARCHAR(500)", "string", True, False, True, True,
             "text_input", "link",
             validation={"rule":"url","message":"Valid URL required"})

# ═══════════════════════════════════════════════════════════════════════════════
# 1. BUDGET PLANNER
# ═══════════════════════════════════════════════════════════════════════════════
def budget_planner():
    budget = ENT("Budget","budgets",[
        F("name","VARCHAR(255) NOT NULL"),
        F("fiscal_year","INTEGER NOT NULL","number",False,True,True,True,"number_input","text",
          validation={"min":2000,"max":2100}),
        status_field(ev=["draft","active","closed","archived"],
                     bc={"draft":"slate","active":"green","closed":"blue","archived":"amber"}),
        F("period_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["monthly","quarterly","annual"],
          bc={"monthly":"blue","quarterly":"purple","annual":"green"}),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string",False,False,True,True,"select","text",
          ev=["USD","EUR","GBP","CAD","AUD"]),
        money_field("total_budgeted", computed="SUM(budget_entries.budgeted_amount)"),
        money_field("total_spent", computed="SUM(budget_entries.actual_amount)"),
        money_field("variance", computed="total_budgeted - total_spent"),
        text_field("description"),
    ])
    category = ENT("Category","budget_categories",[
        F("name","VARCHAR(255) NOT NULL"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["income","expense","transfer"],
          bc={"income":"green","expense":"red","transfer":"blue"}),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch",
          validation={"rule":"hex_color","message":"Must be #RRGGBB"}),
        F("icon","VARCHAR(50)","string",True,True,True,True,"icon_select","icon"),
        int_field("sort_order"),
        bool_field("is_active", True),
    ])
    entry = ENT("Entry","budget_entries",[
        fk_field("budget_id","Budget"),
        fk_field("category_id","Category"),
        F("description","VARCHAR(500) NOT NULL"),
        money_field("budgeted_amount"),
        money_field("actual_amount", nullable=True),
        money_field("variance", computed="budgeted_amount - actual_amount"),
        pct_field("variance_pct", computed="(budgeted_amount - actual_amount) / budgeted_amount * 100"),
        date_field("entry_date", nullable=False),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["planned","actual","forecast"],
          bc={"planned":"blue","actual":"green","forecast":"purple"}),
    ])
    goal = ENT("Goal","budget_goals",[
        fk_field("budget_id","Budget"),
        F("name","VARCHAR(255) NOT NULL"),
        money_field("target_amount"),
        money_field("current_amount", nullable=True),
        pct_field("progress_pct", computed="current_amount / target_amount * 100"),
        date_field("deadline", nullable=False),
        status_field(ev=["on_track","at_risk","behind","completed"],
                     bc={"on_track":"green","at_risk":"amber","behind":"red","completed":"blue"}),
    ])
    alert = ENT("Alert","budget_alerts",[
        fk_field("budget_id","Budget"),
        F("type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["overspend","threshold","deadline","anomaly"],
          bc={"overspend":"red","threshold":"amber","deadline":"blue","anomaly":"purple"}),
        F("message","VARCHAR(500) NOT NULL"),
        money_field("threshold_amount", nullable=True),
        pct_field("threshold_pct"),
        bool_field("is_read"),
        datetime_field("triggered_at", nullable=False, form=False),
        F("severity","VARCHAR(10) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["info","warning","critical"],
          bc={"info":"blue","warning":"amber","critical":"red"}),
    ])
    report = ENT("Report","budget_reports",[
        fk_field("budget_id","Budget"),
        F("title","VARCHAR(255) NOT NULL"),
        F("report_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["summary","variance","trend","forecast"],
          bc={"summary":"blue","variance":"amber","trend":"green","forecast":"purple"}),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        money_field("total_income", computed="SUM(entries.actual WHERE type=income)"),
        money_field("total_expense", computed="SUM(entries.actual WHERE type=expense)"),
        money_field("net_amount", computed="total_income - total_expense"),
        text_field("notes"),
    ])
    return SPEC("budget_planner_spec","Budget Planner",[budget,category,entry,goal,alert,report])


# ═══════════════════════════════════════════════════════════════════════════════
# 2. COMMISSION TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def commission_tracking():
    agent = ENT("Agent","agents",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        phone_field(),
        F("tier","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["junior","senior","lead","director"],
          bc={"junior":"slate","senior":"blue","lead":"purple","director":"green"}),
        pct_field("commission_rate"),
        money_field("ytd_earnings", computed="SUM(commissions.amount WHERE year=current)"),
        status_field(ev=["active","suspended","terminated"],
                     bc={"active":"green","suspended":"amber","terminated":"red"}),
    ])
    client = ENT("Client","commission_clients",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field("contact_email"),
        phone_field("contact_phone"),
        F("company","VARCHAR(255)","string",True),
        F("industry","VARCHAR(100)","string",True,True,True,True,"select","text",
          ev=["technology","finance","healthcare","retail","manufacturing","other"]),
        status_field(ev=["active","churned","prospect"],
                     bc={"active":"green","churned":"red","prospect":"blue"}),
    ])
    sale = ENT("Sale","sales",[
        fk_field("agent_id","Agent"),
        fk_field("client_id","Client"),
        F("deal_name","VARCHAR(255) NOT NULL"),
        money_field("deal_value"),
        money_field("cost", nullable=True),
        money_field("profit", computed="deal_value - cost"),
        pct_field("margin_pct", computed="(deal_value - cost) / deal_value * 100"),
        date_field("close_date", nullable=False),
        status_field(ev=["pending","won","lost","cancelled"],
                     bc={"pending":"amber","won":"green","lost":"red","cancelled":"slate"}),
        text_field("notes"),
    ])
    commission = ENT("Commission","commissions",[
        fk_field("sale_id","Sale"),
        fk_field("agent_id","Agent"),
        money_field("base_amount"),
        pct_field("rate"),
        money_field("amount", computed="base_amount * rate / 100"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["standard","bonus","override","spiff"],
          bc={"standard":"blue","bonus":"green","override":"purple","spiff":"amber"}),
        status_field(ev=["pending","approved","paid","reversed"],
                     bc={"pending":"amber","approved":"blue","paid":"green","reversed":"red"}),
        date_field("earned_date", nullable=False),
    ])
    payout = ENT("PayoutRequest","payout_requests",[
        fk_field("agent_id","Agent"),
        money_field("requested_amount"),
        money_field("approved_amount", nullable=True,
                    visible_when={"field":"status","operator":"in","value":["approved","paid"]}),
        F("payout_method","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","text",
          ev=["bank_transfer","check","paypal","wire"]),
        status_field(ev=["submitted","approved","paid","rejected"],
                     bc={"submitted":"amber","approved":"blue","paid":"green","rejected":"red"}),
        text_field("rejection_reason",
                   visible_when={"field":"status","operator":"eq","value":"rejected"}),
        date_field("paid_date", nullable=True),
    ])
    target = ENT("Target","sales_targets",[
        fk_field("agent_id","Agent"),
        F("period","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["monthly","quarterly","annual"],
          bc={"monthly":"blue","quarterly":"purple","annual":"green"}),
        money_field("target_amount"),
        money_field("achieved_amount", computed="SUM(sales.deal_value WHERE agent)"),
        pct_field("achievement_pct", computed="achieved_amount / target_amount * 100"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        status_field(ev=["in_progress","met","exceeded","missed"],
                     bc={"in_progress":"blue","met":"green","exceeded":"purple","missed":"red"}),
    ])
    return SPEC("commission_tracking_spec","Commission Tracking",[agent,client,sale,commission,payout,target])


# ═══════════════════════════════════════════════════════════════════════════════
# 3. EXPENSE TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def expense_tracking():
    employee = ENT("Employee","expense_employees",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        phone_field(),
        F("department","VARCHAR(100) NOT NULL"),
        F("employee_id_code","VARCHAR(50) NOT NULL","string",False,True,True,True,"text_input","text",
          validation={"rule":"unique","message":"Must be unique"}),
        money_field("spending_limit"),
        status_field(ev=["active","on_leave","terminated"],
                     bc={"active":"green","on_leave":"amber","terminated":"red"}),
    ])
    category = ENT("Category","expense_categories",[
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(20) NOT NULL","string",False,True,True,True,"text_input","text"),
        F("expense_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["travel","meals","supplies","equipment","software","other"],
          bc={"travel":"blue","meals":"green","supplies":"amber","equipment":"purple","software":"pink","other":"slate"}),
        money_field("budget_limit", nullable=True),
        bool_field("receipt_required", True),
        bool_field("is_active", True),
    ])
    report = ENT("Report","expense_reports",[
        fk_field("employee_id","Employee"),
        F("title","VARCHAR(255) NOT NULL"),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        money_field("total_amount", computed="SUM(expenses.amount)"),
        int_field("item_count", computed="COUNT(expenses)"),
        status_field(ev=["draft","submitted","approved","rejected","paid"],
                     bc={"draft":"slate","submitted":"amber","approved":"blue","rejected":"red","paid":"green"}),
        text_field("rejection_reason",
                   visible_when={"field":"status","operator":"eq","value":"rejected"}),
    ])
    expense = ENT("Expense","expenses",[
        fk_field("employee_id","Employee"),
        fk_field("category_id","Category"),
        fk_field("report_id","Report", nullable=True),
        F("description","VARCHAR(500) NOT NULL"),
        money_field("amount"),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        date_field("expense_date", nullable=False),
        F("merchant","VARCHAR(255)","string",True),
        F("payment_method","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["corporate_card","personal","cash","other"],
          bc={"corporate_card":"blue","personal":"green","cash":"amber","other":"slate"}),
        bool_field("is_billable"),
    ])
    receipt = ENT("Receipt","expense_receipts",[
        fk_field("expense_id","Expense"),
        F("file_name","VARCHAR(255) NOT NULL"),
        F("file_url","VARCHAR(500) NOT NULL","string",False,False,True,True,"file_upload","file_link"),
        F("file_type","VARCHAR(20) NOT NULL","string",False,True,False,False,"none","text",
          ev=["image","pdf","other"]),
        int_field("file_size_kb", nullable=True),
        money_field("receipt_amount", nullable=True),
        bool_field("ocr_verified"),
    ])
    approval = ENT("Approval","expense_approvals",[
        fk_field("report_id","Report"),
        F("approver_name","VARCHAR(255) NOT NULL"),
        email_field("approver_email"),
        F("decision","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["pending","approved","rejected","escalated"],
          bc={"pending":"amber","approved":"green","rejected":"red","escalated":"purple"}),
        text_field("comments"),
        datetime_field("decided_at", nullable=True, form=False),
        int_field("approval_level", form=True),
    ])
    return SPEC("expense_tracking_spec","Expense Tracking",[employee,category,report,expense,receipt,approval])


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MEETING SCHEDULER
# ═══════════════════════════════════════════════════════════════════════════════
def meeting_scheduler():
    room = ENT("Room","meeting_rooms",[
        F("name","VARCHAR(255) NOT NULL"),
        F("location","VARCHAR(255) NOT NULL"),
        int_field("capacity"),
        F("floor","VARCHAR(10)","string",True),
        F("amenities","VARCHAR(500)","string",True,False,True,True,"textarea","text"),
        bool_field("has_video_conf"),
        bool_field("has_whiteboard"),
        status_field(ev=["available","occupied","maintenance","retired"],
                     bc={"available":"green","occupied":"red","maintenance":"amber","retired":"slate"}),
    ])
    meeting = ENT("Meeting","meetings",[
        fk_field("room_id","Room", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        datetime_field("start_time", nullable=False),
        datetime_field("end_time", nullable=False),
        int_field("duration_minutes", computed="EXTRACT(EPOCH FROM end_time - start_time) / 60"),
        F("type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["standup","planning","review","one_on_one","all_hands","external"],
          bc={"standup":"blue","planning":"purple","review":"green","one_on_one":"amber","all_hands":"pink","external":"slate"}),
        status_field(ev=["scheduled","in_progress","completed","cancelled"],
                     bc={"scheduled":"blue","in_progress":"green","completed":"slate","cancelled":"red"}),
        F("meeting_url","VARCHAR(500)","string",True,False,True,True,"text_input","link",
          validation={"rule":"url","message":"Valid URL required"}),
        text_field("agenda"),
        bool_field("is_recurring"),
    ])
    attendee = ENT("Attendee","meeting_attendees",[
        fk_field("meeting_id","Meeting"),
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("role","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["organizer","required","optional","presenter"],
          bc={"organizer":"purple","required":"blue","optional":"slate","presenter":"green"}),
        F("rsvp_status","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["pending","accepted","declined","tentative"],
          bc={"pending":"amber","accepted":"green","declined":"red","tentative":"blue"}),
        bool_field("is_external"),
    ])
    recurring = ENT("RecurringMeeting","recurring_meetings",[
        fk_field("room_id","Room", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        F("recurrence","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["daily","weekly","biweekly","monthly"],
          bc={"daily":"blue","weekly":"green","biweekly":"purple","monthly":"amber"}),
        F("day_of_week","VARCHAR(10)","string",True,True,True,True,"select","text",
          ev=["monday","tuesday","wednesday","thursday","friday"],
          visible_when={"field":"recurrence","operator":"in","value":["weekly","biweekly"]}),
        F("time_slot","VARCHAR(5) NOT NULL","string"),
        int_field("duration_minutes"),
        date_field("series_start", nullable=False),
        date_field("series_end", nullable=True),
        bool_field("is_active", True),
    ])
    note = ENT("Note","meeting_notes",[
        fk_field("meeting_id","Meeting"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("content"),
        F("author","VARCHAR(255) NOT NULL"),
        F("visibility","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["public","private","team_only"],
          bc={"public":"green","private":"red","team_only":"blue"}),
        bool_field("is_pinned"),
    ])
    action = ENT("Action","meeting_actions",[
        fk_field("meeting_id","Meeting"),
        F("title","VARCHAR(255) NOT NULL"),
        F("assignee","VARCHAR(255) NOT NULL"),
        date_field("due_date", nullable=False),
        priority_field(),
        status_field(ev=["open","in_progress","done","overdue"],
                     bc={"open":"blue","in_progress":"amber","done":"green","overdue":"red"}),
        text_field("notes"),
    ])
    return SPEC("meeting_scheduler_spec","Meeting Scheduler",[room,meeting,attendee,recurring,note,action])


# ═══════════════════════════════════════════════════════════════════════════════
# 5. TIME TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def time_tracking():
    client = ENT("Client","tt_clients",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field("contact_email"),
        phone_field("contact_phone"),
        F("company","VARCHAR(255) NOT NULL"),
        money_field("hourly_rate"),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        status_field(ev=["active","inactive","archived"],
                     bc={"active":"green","inactive":"amber","archived":"slate"}),
        text_field("notes"),
    ])
    employee = ENT("Employee","tt_employees",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("role","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["developer","designer","manager","analyst","consultant"],
          bc={"developer":"blue","designer":"pink","manager":"purple","analyst":"green","consultant":"amber"}),
        money_field("default_rate"),
        int_field("weekly_capacity_hrs"),
        status_field(ev=["active","on_leave","terminated"],
                     bc={"active":"green","on_leave":"amber","terminated":"red"}),
    ])
    project = ENT("Project","tt_projects",[
        fk_field("client_id","Client"),
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(20) NOT NULL","string",False,True,True,True,"text_input","text",
          validation={"rule":"unique","message":"Must be unique"}),
        money_field("budget", nullable=True),
        money_field("total_billed", computed="SUM(time_entries.billable_amount)"),
        money_field("budget_remaining", computed="budget - total_billed"),
        pct_field("budget_used_pct", computed="total_billed / budget * 100"),
        status_field(ev=["planning","active","on_hold","completed","archived"],
                     bc={"planning":"slate","active":"green","on_hold":"amber","completed":"blue","archived":"purple"}),
        F("billing_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["hourly","fixed","retainer"],
          bc={"hourly":"blue","fixed":"green","retainer":"purple"}),
        date_field("deadline", nullable=True),
    ])
    time_entry = ENT("TimeEntry","time_entries",[
        fk_field("project_id","Project"),
        fk_field("employee_id","Employee"),
        F("description","VARCHAR(500) NOT NULL"),
        date_field("entry_date", nullable=False),
        F("hours","NUMERIC(5,2) NOT NULL","number",False,True,True,True,"number_input","text",
          validation={"min":0.25,"max":24}),
        money_field("hourly_rate"),
        money_field("billable_amount", computed="hours * hourly_rate"),
        bool_field("is_billable", True),
        F("task_type","VARCHAR(30)","string",True,True,True,True,"select","status_badge",
          ev=["development","design","meeting","admin","support","testing"],
          bc={"development":"blue","design":"pink","meeting":"purple","admin":"slate","support":"green","testing":"amber"}),
        status_field(ev=["draft","submitted","approved","invoiced"],
                     bc={"draft":"slate","submitted":"amber","approved":"green","invoiced":"blue"}),
    ])
    invoice = ENT("Invoice","tt_invoices",[
        fk_field("project_id","Project"),
        fk_field("client_id","Client"),
        F("invoice_number","VARCHAR(50) NOT NULL","string",False,True,True,True,"text_input","text"),
        money_field("subtotal", computed="SUM(line_items)"),
        pct_field("tax_rate"),
        money_field("tax_amount", computed="subtotal * tax_rate / 100"),
        money_field("total", computed="subtotal + tax_amount"),
        date_field("issue_date", nullable=False),
        date_field("due_date", nullable=False),
        status_field(ev=["draft","sent","paid","overdue","void"],
                     bc={"draft":"slate","sent":"amber","paid":"green","overdue":"red","void":"purple"}),
    ])
    report = ENT("Report","tt_reports",[
        F("title","VARCHAR(255) NOT NULL"),
        F("report_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["timesheet","utilization","project_summary","billing"],
          bc={"timesheet":"blue","utilization":"green","project_summary":"purple","billing":"amber"}),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        F("total_hours","NUMERIC(8,2)","number",True,True,False,False,"none","text",
          computed="SUM(time_entries.hours)"),
        money_field("total_billable", computed="SUM(time_entries.billable_amount)"),
        pct_field("utilization_rate", computed="billable_hours / total_hours * 100"),
        text_field("notes"),
    ])
    return SPEC("time_tracking_spec","Time Tracking",[client,employee,project,time_entry,invoice,report])


# ═══════════════════════════════════════════════════════════════════════════════
# 6. SUBSCRIPTION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
def subscription_management():
    subscriber = ENT("Subscriber","subscribers",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        phone_field(),
        F("company","VARCHAR(255)","string",True),
        F("source","VARCHAR(30)","string",True,True,True,True,"select","status_badge",
          ev=["organic","referral","paid_ad","partner","direct"],
          bc={"organic":"green","referral":"blue","paid_ad":"amber","partner":"purple","direct":"slate"}),
        money_field("lifetime_value", computed="SUM(payments.amount)"),
        status_field(ev=["active","churned","paused","trial"],
                     bc={"active":"green","churned":"red","paused":"amber","trial":"blue"}),
    ])
    plan = ENT("Plan","subscription_plans",[
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(50) NOT NULL","string",False,True,True,True,"text_input","text"),
        money_field("monthly_price"),
        money_field("annual_price", nullable=True),
        F("billing_interval","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["monthly","quarterly","annual","lifetime"],
          bc={"monthly":"blue","quarterly":"purple","annual":"green","lifetime":"amber"}),
        int_field("trial_days"),
        F("features","TEXT","string",True,False,True,True,"textarea","text"),
        bool_field("is_active", True),
        int_field("max_users", nullable=True),
    ])
    subscription = ENT("Subscription","subscriptions",[
        fk_field("subscriber_id","Subscriber"),
        fk_field("plan_id","Plan"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=True),
        date_field("trial_end", nullable=True),
        money_field("mrr", computed="plan.monthly_price"),
        status_field(ev=["trialing","active","past_due","cancelled","expired"],
                     bc={"trialing":"blue","active":"green","past_due":"red","cancelled":"slate","expired":"amber"}),
        F("cancellation_reason","VARCHAR(255)","string",True,False,True,True,"textarea","text",
          visible_when={"field":"status","operator":"eq","value":"cancelled"}),
        bool_field("auto_renew", True),
    ])
    payment = ENT("Payment","subscription_payments",[
        fk_field("subscription_id","Subscription"),
        money_field("amount"),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        F("payment_method","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["credit_card","bank_transfer","paypal","wire","crypto"],
          bc={"credit_card":"blue","bank_transfer":"green","paypal":"amber","wire":"purple","crypto":"pink"}),
        status_field(ev=["pending","completed","failed","refunded"],
                     bc={"pending":"amber","completed":"green","failed":"red","refunded":"purple"}),
        datetime_field("paid_at", nullable=True),
        F("transaction_id","VARCHAR(100)","string",True,True,False,False,"none","text"),
        text_field("failure_reason",
                   visible_when={"field":"status","operator":"eq","value":"failed"}),
    ])
    invoice = ENT("Invoice","subscription_invoices",[
        fk_field("subscription_id","Subscription"),
        F("invoice_number","VARCHAR(50) NOT NULL"),
        money_field("subtotal"),
        money_field("tax"),
        money_field("total", computed="subtotal + tax"),
        date_field("issue_date", nullable=False),
        date_field("due_date", nullable=False),
        status_field(ev=["draft","sent","paid","overdue","void"],
                     bc={"draft":"slate","sent":"amber","paid":"green","overdue":"red","void":"purple"}),
    ])
    usage = ENT("Usage","subscription_usage",[
        fk_field("subscription_id","Subscription"),
        F("metric_name","VARCHAR(100) NOT NULL"),
        F("usage_value","NUMERIC(15,2) NOT NULL","number",False,True,True,True,"number_input","text"),
        F("unit","VARCHAR(30) NOT NULL","string"),
        F("limit_value","NUMERIC(15,2)","number",True,True,True,True,"number_input","text"),
        pct_field("usage_pct", computed="usage_value / limit_value * 100"),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        bool_field("overage_notified"),
    ])
    return SPEC("subscription_management_spec","Subscription Management",
                [subscriber,plan,subscription,payment,invoice,usage])


# ═══════════════════════════════════════════════════════════════════════════════
# 7. WORKFLOW AUTOMATION
# ═══════════════════════════════════════════════════════════════════════════════
def workflow_automation():
    workflow = ENT("Workflow","workflows",[
        F("name","VARCHAR(255) NOT NULL"),
        F("description","TEXT","string",True,False,True,True,"textarea","text"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["approval","notification","data_sync","scheduling","escalation"],
          bc={"approval":"blue","notification":"green","data_sync":"purple","scheduling":"amber","escalation":"red"}),
        status_field(ev=["draft","active","paused","archived"],
                     bc={"draft":"slate","active":"green","paused":"amber","archived":"purple"}),
        int_field("step_count", computed="COUNT(steps)"),
        int_field("total_runs", computed="COUNT(runs)"),
        int_field("success_rate_pct", computed="COUNT(runs WHERE status=success) / COUNT(runs) * 100"),
        F("version","INTEGER NOT NULL DEFAULT 1","number",False,True,False,False,"none","text"),
        bool_field("is_template"),
    ])
    step = ENT("Step","workflow_steps",[
        fk_field("workflow_id","Workflow"),
        F("name","VARCHAR(255) NOT NULL"),
        int_field("step_order"),
        F("step_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["action","condition","delay","loop","parallel","webhook"],
          bc={"action":"blue","condition":"purple","delay":"amber","loop":"green","parallel":"pink","webhook":"slate"}),
        F("config_json","TEXT","string",True,False,True,True,"textarea","text"),
        int_field("timeout_seconds", nullable=True),
        F("on_failure","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["stop","skip","retry","fallback"],
          bc={"stop":"red","skip":"amber","retry":"blue","fallback":"green"}),
        int_field("max_retries"),
    ])
    trigger = ENT("Trigger","workflow_triggers",[
        fk_field("workflow_id","Workflow"),
        F("name","VARCHAR(255) NOT NULL"),
        F("trigger_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["schedule","webhook","event","manual","api"],
          bc={"schedule":"blue","webhook":"green","event":"purple","manual":"amber","api":"pink"}),
        F("cron_expression","VARCHAR(100)","string",True,True,True,True,"text_input","text",
          visible_when={"field":"trigger_type","operator":"eq","value":"schedule"}),
        F("webhook_url","VARCHAR(500)","string",True,False,True,True,"text_input","link",
          visible_when={"field":"trigger_type","operator":"eq","value":"webhook"}),
        F("event_name","VARCHAR(100)","string",True,True,True,True,"text_input","text",
          visible_when={"field":"trigger_type","operator":"eq","value":"event"}),
        bool_field("is_active", True),
    ])
    action = ENT("Action","workflow_actions",[
        fk_field("step_id","Step"),
        F("name","VARCHAR(255) NOT NULL"),
        F("action_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["send_email","api_call","update_record","create_record","notify","transform"],
          bc={"send_email":"blue","api_call":"green","update_record":"purple","create_record":"pink","notify":"amber","transform":"slate"}),
        F("config_json","TEXT","string",True,False,True,True,"textarea","text"),
        F("target_entity","VARCHAR(100)","string",True),
        int_field("execution_order"),
    ])
    run = ENT("Run","workflow_runs",[
        fk_field("workflow_id","Workflow"),
        datetime_field("started_at", nullable=False, form=False),
        datetime_field("completed_at", nullable=True, form=False),
        int_field("duration_ms", computed="EXTRACT(EPOCH FROM completed_at - started_at) * 1000"),
        status_field(ev=["running","success","failed","cancelled","timeout"],
                     bc={"running":"blue","success":"green","failed":"red","cancelled":"slate","timeout":"amber"}),
        F("trigger_source","VARCHAR(50)","string",True),
        int_field("steps_completed"),
        int_field("steps_total"),
        text_field("error_message",
                   visible_when={"field":"status","operator":"in","value":["failed","timeout"]}),
    ])
    log = ENT("Log","workflow_logs",[
        fk_field("run_id","Run"),
        fk_field("step_id","Step", nullable=True),
        F("level","VARCHAR(10) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["debug","info","warn","error"],
          bc={"debug":"slate","info":"blue","warn":"amber","error":"red"}),
        F("message","TEXT NOT NULL","string"),
        datetime_field("logged_at", nullable=False, form=False),
        F("context_json","TEXT","string",True,False,False,False,"none","text"),
        int_field("duration_ms", nullable=True),
    ])
    return SPEC("workflow_automation_spec","Workflow Automation",
                [workflow,step,trigger,action,run,log])


# ═══════════════════════════════════════════════════════════════════════════════
# 8. TEAM COLLABORATION
# ═══════════════════════════════════════════════════════════════════════════════
def team_collaboration():
    team = ENT("Team","teams",[
        F("name","VARCHAR(255) NOT NULL"),
        F("description","TEXT","string",True,False,True,True,"textarea","text"),
        F("department","VARCHAR(100)","string",True,True,True,True,"select","text",
          ev=["engineering","design","marketing","sales","support","operations","hr","finance"]),
        int_field("member_count", computed="COUNT(members)"),
        F("visibility","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["public","private","secret"],
          bc={"public":"green","private":"amber","secret":"red"}),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        status_field(ev=["active","archived"],bc={"active":"green","archived":"slate"}),
    ])
    member = ENT("Member","team_members",[
        fk_field("team_id","Team"),
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("role","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["owner","admin","member","guest"],
          bc={"owner":"purple","admin":"blue","member":"green","guest":"slate"}),
        F("title","VARCHAR(100)","string",True),
        date_field("joined_at", nullable=False),
        status_field(ev=["active","away","offline"],
                     bc={"active":"green","away":"amber","offline":"slate"}),
    ])
    channel = ENT("Channel","team_channels",[
        fk_field("team_id","Team"),
        F("name","VARCHAR(100) NOT NULL"),
        F("description","VARCHAR(500)","string",True),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["general","project","announcement","social","support"],
          bc={"general":"blue","project":"green","announcement":"amber","social":"pink","support":"purple"}),
        bool_field("is_private"),
        int_field("message_count", computed="COUNT(messages)"),
        bool_field("is_archived"),
    ])
    message = ENT("Message","team_messages",[
        fk_field("channel_id","Channel"),
        F("sender_name","VARCHAR(255) NOT NULL"),
        F("content","TEXT NOT NULL","string"),
        F("message_type","VARCHAR(20) NOT NULL","string",False,True,False,False,"select","status_badge",
          ev=["text","image","file","link","system"],
          bc={"text":"blue","image":"green","file":"purple","link":"amber","system":"slate"}),
        bool_field("is_pinned"),
        bool_field("is_edited"),
        int_field("reaction_count", computed="COUNT(reactions)"),
        datetime_field("sent_at", nullable=False, form=False),
    ])
    task = ENT("Task","team_tasks",[
        fk_field("team_id","Team"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("assignee","VARCHAR(255)","string",True),
        priority_field(),
        status_field(ev=["todo","in_progress","review","done"],
                     bc={"todo":"slate","in_progress":"blue","review":"amber","done":"green"}),
        date_field("due_date", nullable=True),
        int_field("estimated_hours", nullable=True),
    ])
    file = ENT("File","team_files",[
        fk_field("channel_id","Channel", nullable=True),
        fk_field("team_id","Team"),
        F("name","VARCHAR(255) NOT NULL"),
        F("file_url","VARCHAR(500) NOT NULL","string",False,False,True,True,"file_upload","file_link"),
        F("file_type","VARCHAR(30)","string",True,True,False,False,"none","status_badge",
          ev=["document","spreadsheet","presentation","image","video","other"],
          bc={"document":"blue","spreadsheet":"green","presentation":"purple","image":"pink","video":"amber","other":"slate"}),
        int_field("file_size_kb"),
        F("uploaded_by","VARCHAR(255) NOT NULL"),
        int_field("download_count"),
    ])
    return SPEC("team_collaboration_spec","Team Collaboration",
                [team,member,channel,message,task,file])


# ═══════════════════════════════════════════════════════════════════════════════
# 9. RISK MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
def risk_management():
    risk = ENT("Risk","risks",[
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["operational","financial","strategic","compliance","reputational","technical"],
          bc={"operational":"blue","financial":"green","strategic":"purple","compliance":"amber","reputational":"pink","technical":"slate"}),
        F("likelihood","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["rare","unlikely","possible","likely","almost_certain"],
          bc={"rare":"green","unlikely":"blue","possible":"amber","likely":"red","almost_certain":"purple"}),
        F("impact","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["negligible","minor","moderate","major","catastrophic"],
          bc={"negligible":"green","minor":"blue","moderate":"amber","major":"red","catastrophic":"purple"}),
        int_field("risk_score", computed="likelihood_rank * impact_rank"),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["identified","analyzing","mitigating","accepted","closed"],
                     bc={"identified":"blue","analyzing":"amber","mitigating":"purple","accepted":"green","closed":"slate"}),
    ])
    assessment = ENT("Assessment","risk_assessments",[
        fk_field("risk_id","Risk"),
        F("assessor","VARCHAR(255) NOT NULL"),
        date_field("assessment_date", nullable=False),
        int_field("likelihood_score"),
        int_field("impact_score"),
        int_field("risk_rating", computed="likelihood_score * impact_score"),
        F("methodology","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","text",
          ev=["qualitative","quantitative","semi_quantitative"]),
        text_field("findings"),
        text_field("recommendations"),
    ])
    mitigation = ENT("Mitigation","risk_mitigations",[
        fk_field("risk_id","Risk"),
        F("title","VARCHAR(255) NOT NULL"),
        F("strategy","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["avoid","transfer","reduce","accept"],
          bc={"avoid":"red","transfer":"blue","reduce":"amber","accept":"green"}),
        money_field("estimated_cost", nullable=True),
        money_field("actual_cost", nullable=True),
        date_field("target_date", nullable=False),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["planned","in_progress","completed","deferred"],
                     bc={"planned":"blue","in_progress":"amber","completed":"green","deferred":"slate"}),
        pct_field("effectiveness_pct"),
    ])
    control = ENT("Control","risk_controls",[
        fk_field("risk_id","Risk"),
        F("name","VARCHAR(255) NOT NULL"),
        F("control_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["preventive","detective","corrective","compensating"],
          bc={"preventive":"green","detective":"blue","corrective":"amber","compensating":"purple"}),
        F("frequency","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["continuous","daily","weekly","monthly","quarterly","annual"]),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["effective","partially_effective","ineffective","not_tested"],
                     bc={"effective":"green","partially_effective":"amber","ineffective":"red","not_tested":"slate"}),
        date_field("last_tested", nullable=True),
        text_field("evidence"),
    ])
    incident = ENT("Incident","risk_incidents",[
        fk_field("risk_id","Risk", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        datetime_field("occurred_at", nullable=False),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["low","medium","high","critical"],
          bc={"low":"slate","medium":"amber","high":"red","critical":"purple"}),
        money_field("financial_impact", nullable=True),
        F("reported_by","VARCHAR(255) NOT NULL"),
        status_field(ev=["reported","investigating","resolved","closed"],
                     bc={"reported":"amber","investigating":"blue","resolved":"green","closed":"slate"}),
    ])
    report = ENT("Report","risk_reports",[
        F("title","VARCHAR(255) NOT NULL"),
        F("report_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["risk_register","heat_map","trend_analysis","executive_summary"],
          bc={"risk_register":"blue","heat_map":"red","trend_analysis":"green","executive_summary":"purple"}),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        int_field("total_risks", computed="COUNT(risks)"),
        int_field("high_risks", computed="COUNT(risks WHERE risk_score >= 15)"),
        int_field("mitigated_count", computed="COUNT(risks WHERE status=mitigating)"),
        text_field("summary"),
        F("prepared_by","VARCHAR(255) NOT NULL"),
    ])
    return SPEC("risk_management_spec","Risk Management",
                [risk,assessment,mitigation,control,incident,report])


# ═══════════════════════════════════════════════════════════════════════════════
# 10. COMPLIANCE TRACKER
# ═══════════════════════════════════════════════════════════════════════════════
def compliance_tracker():
    policy = ENT("Policy","compliance_policies",[
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["data_privacy","security","financial","hr","environmental","safety"],
          bc={"data_privacy":"blue","security":"red","financial":"green","hr":"purple","environmental":"amber","safety":"pink"}),
        F("version","VARCHAR(20) NOT NULL","string"),
        date_field("effective_date", nullable=False),
        date_field("review_date", nullable=True),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["draft","active","under_review","deprecated"],
                     bc={"draft":"slate","active":"green","under_review":"amber","deprecated":"red"}),
    ])
    requirement = ENT("Requirement","compliance_requirements",[
        fk_field("policy_id","Policy"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("regulation","VARCHAR(100) NOT NULL","string",False,True,True,True,"select","text",
          ev=["GDPR","SOX","HIPAA","PCI_DSS","ISO27001","SOC2","CCPA"]),
        F("criticality","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["mandatory","recommended","optional"],
          bc={"mandatory":"red","recommended":"amber","optional":"blue"}),
        status_field(ev=["compliant","non_compliant","partial","not_assessed"],
                     bc={"compliant":"green","non_compliant":"red","partial":"amber","not_assessed":"slate"}),
        date_field("due_date", nullable=True),
        F("owner","VARCHAR(255) NOT NULL"),
    ])
    audit = ENT("Audit","compliance_audits",[
        F("title","VARCHAR(255) NOT NULL"),
        F("audit_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["internal","external","regulatory","certification"],
          bc={"internal":"blue","external":"purple","regulatory":"red","certification":"green"}),
        F("auditor","VARCHAR(255) NOT NULL"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=True),
        F("scope","TEXT","string",True,False,True,True,"textarea","text"),
        int_field("finding_count", computed="COUNT(findings)"),
        status_field(ev=["planned","in_progress","completed","cancelled"],
                     bc={"planned":"slate","in_progress":"blue","completed":"green","cancelled":"red"}),
    ])
    finding = ENT("Finding","compliance_findings",[
        fk_field("audit_id","Audit"),
        fk_field("requirement_id","Requirement", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["critical","major","minor","observation"],
          bc={"critical":"red","major":"amber","minor":"blue","observation":"slate"}),
        F("risk_level","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["high","medium","low"],
          bc={"high":"red","medium":"amber","low":"green"}),
        status_field(ev=["open","in_remediation","resolved","accepted"],
                     bc={"open":"red","in_remediation":"amber","resolved":"green","accepted":"blue"}),
        date_field("due_date", nullable=True),
    ])
    action = ENT("Action","compliance_actions",[
        fk_field("finding_id","Finding"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("assignee","VARCHAR(255) NOT NULL"),
        priority_field(),
        date_field("due_date", nullable=False),
        date_field("completed_date", nullable=True,
                   visible_when={"field":"status","operator":"eq","value":"completed"}),
        status_field(ev=["open","in_progress","completed","overdue","cancelled"],
                     bc={"open":"blue","in_progress":"amber","completed":"green","overdue":"red","cancelled":"slate"}),
        pct_field("completion_pct"),
    ])
    evidence = ENT("Evidence","compliance_evidence",[
        fk_field("requirement_id","Requirement"),
        fk_field("finding_id","Finding", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        F("evidence_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["document","screenshot","log","report","attestation","test_result"],
          bc={"document":"blue","screenshot":"green","log":"purple","report":"amber","attestation":"pink","test_result":"slate"}),
        F("file_url","VARCHAR(500)","string",True,False,True,True,"file_upload","file_link"),
        date_field("collected_date", nullable=False),
        F("collector","VARCHAR(255) NOT NULL"),
        status_field(ev=["pending_review","approved","rejected","expired"],
                     bc={"pending_review":"amber","approved":"green","rejected":"red","expired":"slate"}),
    ])
    return SPEC("compliance_tracker_spec","Compliance Tracker",
                [policy,requirement,audit,finding,action,evidence])


# ═══════════════════════════════════════════════════════════════════════════════
# 11. DOCUMENT MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
def document_management():
    folder = ENT("Folder","doc_folders",[
        F("name","VARCHAR(255) NOT NULL"),
        fk_field("parent_folder_id","Folder", nullable=True),
        F("path","VARCHAR(1000) NOT NULL","string",False,True,False,False,"none","text"),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        int_field("document_count", computed="COUNT(documents)"),
        F("visibility","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["public","team","private"],
          bc={"public":"green","team":"blue","private":"red"}),
        F("owner","VARCHAR(255) NOT NULL"),
    ])
    template = ENT("Template","doc_templates",[
        F("name","VARCHAR(255) NOT NULL"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["contract","proposal","report","letter","memo","sop"],
          bc={"contract":"blue","proposal":"green","report":"purple","letter":"amber","memo":"pink","sop":"slate"}),
        text_field("content"),
        F("format","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["markdown","html","plain_text","rich_text"]),
        int_field("usage_count"),
        bool_field("is_active", True),
    ])
    document = ENT("Document","documents",[
        fk_field("folder_id","Folder"),
        fk_field("template_id","Template", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("content"),
        F("doc_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["document","spreadsheet","presentation","pdf","image","other"],
          bc={"document":"blue","spreadsheet":"green","presentation":"purple","pdf":"red","image":"pink","other":"slate"}),
        int_field("file_size_kb", nullable=True),
        F("author","VARCHAR(255) NOT NULL"),
        int_field("version_number"),
        status_field(ev=["draft","review","approved","published","archived"],
                     bc={"draft":"slate","review":"amber","approved":"blue","published":"green","archived":"purple"}),
    ])
    version = ENT("Version","doc_versions",[
        fk_field("document_id","Document"),
        int_field("version_number"),
        text_field("change_summary"),
        F("author","VARCHAR(255) NOT NULL"),
        F("file_url","VARCHAR(500) NOT NULL","string",False,False,True,True,"file_upload","file_link"),
        int_field("file_size_kb"),
        datetime_field("created_at_version", nullable=False, form=False),
        bool_field("is_current"),
    ])
    share = ENT("Share","doc_shares",[
        fk_field("document_id","Document"),
        F("shared_with","VARCHAR(255) NOT NULL"),
        email_field("shared_with_email"),
        F("permission","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["view","comment","edit","admin"],
          bc={"view":"slate","comment":"blue","edit":"green","admin":"purple"}),
        date_field("expires_at", nullable=True),
        bool_field("notify_on_change"),
        F("share_link","VARCHAR(500)","string",True,True,False,False,"none","link"),
    ])
    tag = ENT("Tag","doc_tags",[
        F("name","VARCHAR(100) NOT NULL"),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        int_field("usage_count", computed="COUNT(document_tags)"),
        F("category","VARCHAR(50)","string",True,True,True,True,"select","text",
          ev=["topic","project","department","custom"]),
        bool_field("is_system"),
    ])
    workflow = ENT("Workflow","doc_workflows",[
        fk_field("document_id","Document"),
        F("workflow_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["approval","review","sign_off","publish"],
          bc={"approval":"blue","review":"green","sign_off":"purple","publish":"amber"}),
        F("current_step","VARCHAR(100)","string",True),
        int_field("total_steps"),
        int_field("completed_steps"),
        pct_field("progress_pct", computed="completed_steps / total_steps * 100"),
        status_field(ev=["pending","in_progress","approved","rejected"],
                     bc={"pending":"slate","in_progress":"blue","approved":"green","rejected":"red"}),
        F("initiated_by","VARCHAR(255) NOT NULL"),
    ])
    return SPEC("document_management_spec","Document Management",
                [folder,template,document,version,share,tag,workflow])


# ═══════════════════════════════════════════════════════════════════════════════
# 12. INTERNAL TICKETING
# ═══════════════════════════════════════════════════════════════════════════════
def internal_ticketing():
    category = ENT("Category","ticket_categories",[
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(20) NOT NULL"),
        F("description","VARCHAR(500)","string",True),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        int_field("ticket_count", computed="COUNT(tickets)"),
        int_field("avg_resolution_hrs", computed="AVG(tickets.resolution_time)"),
        bool_field("is_active", True),
    ])
    agent = ENT("Agent","ticket_agents",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("department","VARCHAR(100) NOT NULL"),
        F("skill_level","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["tier_1","tier_2","tier_3","specialist"],
          bc={"tier_1":"slate","tier_2":"blue","tier_3":"purple","specialist":"green"}),
        int_field("open_tickets", computed="COUNT(tickets WHERE status!=closed)"),
        int_field("avg_satisfaction", computed="AVG(tickets.satisfaction_rating)"),
        status_field(ev=["available","busy","offline"],
                     bc={"available":"green","busy":"amber","offline":"slate"}),
    ])
    sla = ENT("SLA","ticket_slas",[
        F("name","VARCHAR(255) NOT NULL"),
        F("priority_level","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["low","medium","high","critical"],
          bc={"low":"slate","medium":"blue","high":"amber","critical":"red"}),
        int_field("response_time_hrs"),
        int_field("resolution_time_hrs"),
        F("escalation_policy","VARCHAR(50)","string",True),
        bool_field("is_active", True),
        int_field("breach_count", computed="COUNT(tickets WHERE sla_breached)"),
    ])
    ticket = ENT("Ticket","tickets",[
        fk_field("agent_id","Agent", nullable=True),
        fk_field("category_id","Category"),
        fk_field("sla_id","SLA", nullable=True),
        F("ticket_number","VARCHAR(20) NOT NULL","string",False,True,False,False,"none","text"),
        F("subject","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("requester_name","VARCHAR(255) NOT NULL"),
        email_field("requester_email"),
        priority_field(),
        status_field(ev=["new","assigned","in_progress","waiting","resolved","closed"],
                     bc={"new":"blue","assigned":"purple","in_progress":"amber","waiting":"pink","resolved":"green","closed":"slate"}),
        int_field("satisfaction_rating", nullable=True,
                  visible_when={"field":"status","operator":"eq","value":"closed"}),
        bool_field("sla_breached"),
    ])
    comment = ENT("Comment","ticket_comments",[
        fk_field("ticket_id","Ticket"),
        F("author","VARCHAR(255) NOT NULL"),
        text_field("content"),
        F("comment_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["reply","internal_note","status_change","escalation"],
          bc={"reply":"blue","internal_note":"amber","status_change":"green","escalation":"red"}),
        bool_field("is_internal"),
        datetime_field("posted_at", nullable=False, form=False),
    ])
    attachment = ENT("Attachment","ticket_attachments",[
        fk_field("ticket_id","Ticket"),
        fk_field("comment_id","Comment", nullable=True),
        F("file_name","VARCHAR(255) NOT NULL"),
        F("file_url","VARCHAR(500) NOT NULL","string",False,False,True,True,"file_upload","file_link"),
        F("file_type","VARCHAR(30)","string",True,True,False,False,"none","status_badge",
          ev=["image","document","log","screenshot","other"],
          bc={"image":"green","document":"blue","log":"purple","screenshot":"pink","other":"slate"}),
        int_field("file_size_kb"),
        F("uploaded_by","VARCHAR(255) NOT NULL"),
    ])
    return SPEC("internal_ticketing_spec","Internal Ticketing",
                [category,agent,sla,ticket,comment,attachment])


# ═══════════════════════════════════════════════════════════════════════════════
# 13. RESOURCE ALLOCATION
# ═══════════════════════════════════════════════════════════════════════════════
def resource_allocation():
    skill = ENT("Skill","ra_skills",[
        F("name","VARCHAR(255) NOT NULL"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["technical","management","design","analysis","communication","domain"],
          bc={"technical":"blue","management":"purple","design":"pink","analysis":"green","communication":"amber","domain":"slate"}),
        F("proficiency_levels","VARCHAR(100)","string",True,False,True,True,"text_input","text"),
        int_field("resource_count", computed="COUNT(resource_skills)"),
        bool_field("is_active", True),
    ])
    resource = ENT("Resource","resources",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("role","VARCHAR(100) NOT NULL"),
        F("department","VARCHAR(100) NOT NULL"),
        F("resource_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["full_time","part_time","contractor","consultant","intern"],
          bc={"full_time":"green","part_time":"blue","contractor":"amber","consultant":"purple","intern":"pink"}),
        money_field("hourly_cost"),
        int_field("weekly_capacity_hrs"),
        int_field("allocated_hrs", computed="SUM(allocations.hours)"),
        pct_field("utilization_pct", computed="allocated_hrs / weekly_capacity_hrs * 100"),
        status_field(ev=["available","partially_allocated","fully_allocated","unavailable"],
                     bc={"available":"green","partially_allocated":"blue","fully_allocated":"amber","unavailable":"red"}),
    ])
    project = ENT("Project","ra_projects",[
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(20) NOT NULL"),
        F("project_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["development","research","maintenance","consulting","internal"],
          bc={"development":"blue","research":"green","maintenance":"amber","consulting":"purple","internal":"slate"}),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=True),
        priority_field(),
        int_field("required_hours"),
        int_field("allocated_hours", computed="SUM(allocations.hours)"),
        pct_field("allocation_pct", computed="allocated_hours / required_hours * 100"),
        status_field(ev=["planning","active","on_hold","completed"],
                     bc={"planning":"slate","active":"green","on_hold":"amber","completed":"blue"}),
    ])
    allocation = ENT("Allocation","allocations",[
        fk_field("resource_id","Resource"),
        fk_field("project_id","Project"),
        int_field("hours_per_week"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        pct_field("allocation_pct"),
        F("role_in_project","VARCHAR(100)","string",True),
        status_field(ev=["proposed","confirmed","active","completed","cancelled"],
                     bc={"proposed":"slate","confirmed":"blue","active":"green","completed":"purple","cancelled":"red"}),
        text_field("notes"),
    ])
    time_off = ENT("TimeOff","ra_time_off",[
        fk_field("resource_id","Resource"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["vacation","sick","personal","training","holiday"],
          bc={"vacation":"blue","sick":"red","personal":"green","training":"purple","holiday":"amber"}),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        int_field("days", computed="end_date - start_date"),
        status_field(ev=["requested","approved","rejected","cancelled"],
                     bc={"requested":"amber","approved":"green","rejected":"red","cancelled":"slate"}),
        text_field("reason"),
    ])
    forecast = ENT("Forecast","ra_forecasts",[
        fk_field("project_id","Project"),
        F("period","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["weekly","monthly","quarterly"]),
        date_field("forecast_date", nullable=False),
        int_field("required_headcount"),
        int_field("available_headcount"),
        int_field("gap", computed="required_headcount - available_headcount"),
        F("skill_gaps","TEXT","string",True,False,True,True,"textarea","text"),
        text_field("notes"),
    ])
    conflict = ENT("Conflict","ra_conflicts",[
        fk_field("resource_id","Resource"),
        fk_field("project_id","Project", nullable=True),
        F("conflict_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["over_allocation","skill_mismatch","schedule_conflict","availability"],
          bc={"over_allocation":"red","skill_mismatch":"amber","schedule_conflict":"purple","availability":"blue"}),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["low","medium","high","critical"],
          bc={"low":"green","medium":"amber","high":"red","critical":"purple"}),
        text_field("description"),
        status_field(ev=["detected","reviewing","resolved","ignored"],
                     bc={"detected":"red","reviewing":"amber","resolved":"green","ignored":"slate"}),
        text_field("resolution"),
    ])
    return SPEC("resource_allocation_spec","Resource Allocation",
                [skill,resource,project,allocation,time_off,forecast,conflict])


# ═══════════════════════════════════════════════════════════════════════════════
# 14. OKR GOAL TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def okr_goal_tracking():
    team = ENT("Team","okr_teams",[
        F("name","VARCHAR(255) NOT NULL"),
        F("department","VARCHAR(100) NOT NULL"),
        F("lead","VARCHAR(255) NOT NULL"),
        email_field("lead_email"),
        int_field("member_count"),
        int_field("active_objectives", computed="COUNT(objectives WHERE status=active)"),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
    ])
    objective = ENT("Objective","objectives",[
        fk_field("team_id","Team"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("time_frame","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["quarterly","semi_annual","annual"],
          bc={"quarterly":"blue","semi_annual":"purple","annual":"green"}),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        pct_field("progress_pct", computed="AVG(key_results.progress_pct)"),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["draft","active","at_risk","completed","cancelled"],
                     bc={"draft":"slate","active":"green","at_risk":"red","completed":"blue","cancelled":"purple"}),
    ])
    key_result = ENT("KeyResult","key_results",[
        fk_field("objective_id","Objective"),
        F("title","VARCHAR(255) NOT NULL"),
        F("metric_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["number","percentage","currency","boolean"],
          bc={"number":"blue","percentage":"green","currency":"amber","boolean":"purple"}),
        F("start_value","NUMERIC(15,2) NOT NULL","number",False,True,True,True,"number_input","text"),
        F("target_value","NUMERIC(15,2) NOT NULL","number",False,True,True,True,"number_input","text"),
        F("current_value","NUMERIC(15,2)","number",True,True,True,True,"number_input","text"),
        pct_field("progress_pct", computed="(current_value - start_value) / (target_value - start_value) * 100"),
        F("owner","VARCHAR(255) NOT NULL"),
        status_field(ev=["on_track","behind","at_risk","achieved"],
                     bc={"on_track":"green","behind":"amber","at_risk":"red","achieved":"blue"}),
    ])
    initiative = ENT("Initiative","okr_initiatives",[
        fk_field("key_result_id","KeyResult"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("assignee","VARCHAR(255) NOT NULL"),
        priority_field(),
        date_field("start_date", nullable=False),
        date_field("due_date", nullable=False),
        int_field("estimated_effort_days"),
        pct_field("completion_pct"),
        status_field(ev=["not_started","in_progress","blocked","completed"],
                     bc={"not_started":"slate","in_progress":"blue","blocked":"red","completed":"green"}),
    ])
    checkin = ENT("CheckIn","okr_checkins",[
        fk_field("key_result_id","KeyResult"),
        F("author","VARCHAR(255) NOT NULL"),
        date_field("checkin_date", nullable=False),
        F("previous_value","NUMERIC(15,2)","number",True,True,False,False,"none","text"),
        F("new_value","NUMERIC(15,2) NOT NULL","number",False,True,True,True,"number_input","text"),
        F("delta","NUMERIC(15,2)","number",True,True,False,False,"none","text",
          computed="new_value - previous_value"),
        F("confidence","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["on_track","at_risk","off_track"],
          bc={"on_track":"green","at_risk":"amber","off_track":"red"}),
        text_field("notes"),
    ])
    alignment = ENT("Alignment","okr_alignments",[
        fk_field("parent_objective_id","Objective"),
        fk_field("child_objective_id","Objective"),
        F("alignment_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["supports","contributes_to","depends_on","blocks"],
          bc={"supports":"green","contributes_to":"blue","depends_on":"amber","blocks":"red"}),
        pct_field("contribution_weight"),
        text_field("rationale"),
        status_field(ev=["proposed","approved","active","removed"],
                     bc={"proposed":"slate","approved":"blue","active":"green","removed":"red"}),
    ])
    return SPEC("okr_goal_tracking_spec","OKR Goal Tracking",
                [team,objective,key_result,initiative,checkin,alignment])


# ═══════════════════════════════════════════════════════════════════════════════
# 15. INCIDENT TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def incident_tracking():
    category = ENT("Category","incident_categories",[
        F("name","VARCHAR(255) NOT NULL"),
        F("code","VARCHAR(20) NOT NULL"),
        F("type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["security","infrastructure","application","network","hardware","other"],
          bc={"security":"red","infrastructure":"blue","application":"green","network":"purple","hardware":"amber","other":"slate"}),
        text_field("description"),
        int_field("incident_count", computed="COUNT(incidents)"),
        bool_field("is_active", True),
    ])
    incident = ENT("Incident","incidents",[
        fk_field("category_id","Category"),
        F("incident_number","VARCHAR(30) NOT NULL","string",False,True,False,False,"none","text"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["sev1","sev2","sev3","sev4"],
          bc={"sev1":"red","sev2":"amber","sev3":"blue","sev4":"slate"}),
        priority_field(),
        F("impact","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["critical","major","moderate","minor"],
          bc={"critical":"red","major":"amber","moderate":"blue","minor":"green"}),
        F("reported_by","VARCHAR(255) NOT NULL"),
        datetime_field("reported_at", nullable=False),
        datetime_field("resolved_at", nullable=True,
                       visible_when={"field":"status","operator":"in","value":["resolved","closed"]}),
        status_field(ev=["new","triaged","investigating","mitigating","resolved","closed"],
                     bc={"new":"red","triaged":"amber","investigating":"blue","mitigating":"purple","resolved":"green","closed":"slate"}),
    ])
    response = ENT("Response","incident_responses",[
        fk_field("incident_id","Incident"),
        F("responder","VARCHAR(255) NOT NULL"),
        F("role","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["incident_commander","tech_lead","communicator","scribe","subject_expert"],
          bc={"incident_commander":"purple","tech_lead":"blue","communicator":"green","scribe":"amber","subject_expert":"pink"}),
        text_field("actions_taken"),
        datetime_field("joined_at", nullable=False, form=False),
        datetime_field("left_at", nullable=True, form=False),
        int_field("time_spent_minutes", computed="EXTRACT(EPOCH FROM left_at - joined_at) / 60"),
    ])
    investigation = ENT("Investigation","incident_investigations",[
        fk_field("incident_id","Incident"),
        F("investigator","VARCHAR(255) NOT NULL"),
        F("investigation_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["root_cause","timeline","impact_assessment","post_mortem"],
          bc={"root_cause":"red","timeline":"blue","impact_assessment":"amber","post_mortem":"green"}),
        text_field("findings"),
        text_field("root_cause"),
        text_field("recommendations"),
        status_field(ev=["in_progress","completed","needs_review"],
                     bc={"in_progress":"blue","completed":"green","needs_review":"amber"}),
        date_field("completed_date", nullable=True),
    ])
    action = ENT("Action","incident_actions",[
        fk_field("incident_id","Incident"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("action_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["immediate","short_term","long_term","preventive"],
          bc={"immediate":"red","short_term":"amber","long_term":"blue","preventive":"green"}),
        F("assignee","VARCHAR(255) NOT NULL"),
        date_field("due_date", nullable=False),
        priority_field(),
        status_field(ev=["open","in_progress","done","overdue"],
                     bc={"open":"blue","in_progress":"amber","done":"green","overdue":"red"}),
    ])
    notification = ENT("Notification","incident_notifications",[
        fk_field("incident_id","Incident"),
        F("recipient","VARCHAR(255) NOT NULL"),
        email_field("recipient_email"),
        F("channel","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["email","sms","slack","pagerduty","webhook"],
          bc={"email":"blue","sms":"green","slack":"purple","pagerduty":"red","webhook":"amber"}),
        F("message","TEXT NOT NULL","string"),
        status_field(ev=["queued","sent","delivered","failed"],
                     bc={"queued":"slate","sent":"blue","delivered":"green","failed":"red"}),
        datetime_field("sent_at", nullable=True, form=False),
        text_field("failure_reason",
                   visible_when={"field":"status","operator":"eq","value":"failed"}),
    ])
    return SPEC("incident_tracking_spec","Incident Tracking",
                [category,incident,response,investigation,action,notification])


# ═══════════════════════════════════════════════════════════════════════════════
# 16. PAYROLL
# ═══════════════════════════════════════════════════════════════════════════════
def payroll():
    employee = ENT("Employee","payroll_employees",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("employee_id_code","VARCHAR(50) NOT NULL"),
        F("department","VARCHAR(100) NOT NULL"),
        F("employment_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["full_time","part_time","contractor","temporary"],
          bc={"full_time":"green","part_time":"blue","contractor":"amber","temporary":"pink"}),
        F("pay_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["salaried","hourly","commission"],
          bc={"salaried":"blue","hourly":"green","commission":"purple"}),
        money_field("base_salary"),
        money_field("hourly_rate", nullable=True,
                    visible_when={"field":"pay_type","operator":"eq","value":"hourly"}),
        status_field(ev=["active","on_leave","terminated"],
                     bc={"active":"green","on_leave":"amber","terminated":"red"}),
    ])
    pay_period = ENT("PayPeriod","pay_periods",[
        F("name","VARCHAR(100) NOT NULL"),
        F("frequency","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["weekly","biweekly","semi_monthly","monthly"],
          bc={"weekly":"blue","biweekly":"green","semi_monthly":"purple","monthly":"amber"}),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        date_field("pay_date", nullable=False),
        int_field("employee_count", computed="COUNT(pay_stubs)"),
        money_field("total_gross", computed="SUM(pay_stubs.gross_pay)"),
        money_field("total_net", computed="SUM(pay_stubs.net_pay)"),
        status_field(ev=["open","processing","closed","paid"],
                     bc={"open":"blue","processing":"amber","closed":"slate","paid":"green"}),
    ])
    pay_stub = ENT("PayStub","pay_stubs",[
        fk_field("employee_id","Employee"),
        fk_field("pay_period_id","PayPeriod"),
        F("hours_worked","NUMERIC(6,2)","number",True,True,True,True,"number_input","text"),
        F("overtime_hours","NUMERIC(6,2)","number",True,True,True,True,"number_input","text"),
        money_field("gross_pay"),
        money_field("total_deductions", computed="SUM(deductions.amount)"),
        money_field("total_taxes", computed="SUM(taxes.amount)"),
        money_field("net_pay", computed="gross_pay - total_deductions - total_taxes"),
        status_field(ev=["draft","approved","paid","void"],
                     bc={"draft":"slate","approved":"blue","paid":"green","void":"red"}),
        F("payment_method","VARCHAR(30)","string",True,True,True,True,"select","text",
          ev=["direct_deposit","check","wire"]),
    ])
    deduction = ENT("Deduction","payroll_deductions",[
        fk_field("pay_stub_id","PayStub"),
        F("name","VARCHAR(255) NOT NULL"),
        F("deduction_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["health_insurance","dental","vision","retirement_401k","hsa","life_insurance","other"],
          bc={"health_insurance":"blue","dental":"green","vision":"purple","retirement_401k":"amber","hsa":"pink","life_insurance":"slate","other":"red"}),
        money_field("amount"),
        bool_field("is_pre_tax", True),
        bool_field("is_recurring", True),
    ])
    tax = ENT("Tax","payroll_taxes",[
        fk_field("pay_stub_id","PayStub"),
        F("tax_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["federal","state","local","social_security","medicare","suta","futa"],
          bc={"federal":"blue","state":"green","local":"amber","social_security":"purple","medicare":"pink","suta":"slate","futa":"red"}),
        money_field("taxable_amount"),
        pct_field("rate"),
        money_field("amount", computed="taxable_amount * rate / 100"),
        F("jurisdiction","VARCHAR(50)","string",True),
    ])
    bonus = ENT("Bonus","payroll_bonuses",[
        fk_field("employee_id","Employee"),
        fk_field("pay_period_id","PayPeriod", nullable=True),
        F("bonus_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["performance","signing","referral","holiday","spot","retention"],
          bc={"performance":"green","signing":"blue","referral":"purple","holiday":"amber","spot":"pink","retention":"slate"}),
        money_field("amount"),
        text_field("reason"),
        date_field("effective_date", nullable=False),
        status_field(ev=["pending","approved","paid","cancelled"],
                     bc={"pending":"amber","approved":"blue","paid":"green","cancelled":"red"}),
    ])
    return SPEC("payroll_spec","Payroll",[employee,pay_period,pay_stub,deduction,tax,bonus])


# ═══════════════════════════════════════════════════════════════════════════════
# 17. PROCUREMENT
# ═══════════════════════════════════════════════════════════════════════════════
def procurement():
    vendor = ENT("Vendor","procurement_vendors",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field("contact_email"),
        phone_field("contact_phone"),
        F("company","VARCHAR(255) NOT NULL"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["supplier","manufacturer","distributor","service_provider","consultant"],
          bc={"supplier":"blue","manufacturer":"green","distributor":"purple","service_provider":"amber","consultant":"pink"}),
        F("tax_id","VARCHAR(50)","string",True,True,True,True,"text_input","text"),
        F("payment_terms","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","text",
          ev=["net_30","net_60","net_90","upon_receipt","advance"]),
        money_field("total_spent", computed="SUM(purchase_orders.total)"),
        status_field(ev=["active","on_hold","blacklisted","archived"],
                     bc={"active":"green","on_hold":"amber","blacklisted":"red","archived":"slate"}),
    ])
    purchase_request = ENT("PurchaseRequest","purchase_requests",[
        F("request_number","VARCHAR(30) NOT NULL","string",False,True,False,False,"none","text"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("requester","VARCHAR(255) NOT NULL"),
        F("department","VARCHAR(100) NOT NULL"),
        money_field("estimated_total"),
        priority_field(),
        F("justification","TEXT","string",True,False,True,True,"textarea","text"),
        status_field(ev=["draft","submitted","approved","rejected","ordered"],
                     bc={"draft":"slate","submitted":"amber","approved":"blue","rejected":"red","ordered":"green"}),
        text_field("rejection_reason",
                   visible_when={"field":"status","operator":"eq","value":"rejected"}),
    ])
    purchase_order = ENT("PurchaseOrder","purchase_orders",[
        fk_field("vendor_id","Vendor"),
        fk_field("request_id","PurchaseRequest", nullable=True),
        F("po_number","VARCHAR(30) NOT NULL","string",False,True,False,False,"none","text"),
        date_field("order_date", nullable=False),
        date_field("expected_delivery", nullable=True),
        money_field("subtotal", computed="SUM(line_items.total)"),
        pct_field("tax_rate"),
        money_field("tax_amount", computed="subtotal * tax_rate / 100"),
        money_field("total", computed="subtotal + tax_amount"),
        money_field("shipping_cost", nullable=True),
        status_field(ev=["draft","submitted","approved","shipped","received","cancelled"],
                     bc={"draft":"slate","submitted":"amber","approved":"blue","shipped":"purple","received":"green","cancelled":"red"}),
    ])
    line_item = ENT("LineItem","po_line_items",[
        fk_field("purchase_order_id","PurchaseOrder"),
        F("description","VARCHAR(500) NOT NULL"),
        F("sku","VARCHAR(50)","string",True),
        int_field("quantity"),
        money_field("unit_price"),
        money_field("total", computed="quantity * unit_price"),
        F("unit","VARCHAR(20)","string",True,True,True,True,"select","text",
          ev=["each","box","case","pallet","kg","lb","liter","gallon"]),
        int_field("received_qty", nullable=True),
        pct_field("received_pct", computed="received_qty / quantity * 100"),
    ])
    receipt = ENT("Receipt","po_receipts",[
        fk_field("purchase_order_id","PurchaseOrder"),
        F("receipt_number","VARCHAR(30) NOT NULL"),
        date_field("received_date", nullable=False),
        F("received_by","VARCHAR(255) NOT NULL"),
        int_field("items_received"),
        int_field("items_rejected", nullable=True),
        F("condition","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["good","damaged","partial","wrong_item"],
          bc={"good":"green","damaged":"red","partial":"amber","wrong_item":"purple"}),
        text_field("notes"),
        status_field(ev=["pending_inspection","accepted","rejected","partial_accept"],
                     bc={"pending_inspection":"amber","accepted":"green","rejected":"red","partial_accept":"blue"}),
    ])
    invoice = ENT("Invoice","procurement_invoices",[
        fk_field("vendor_id","Vendor"),
        fk_field("purchase_order_id","PurchaseOrder"),
        F("invoice_number","VARCHAR(50) NOT NULL"),
        date_field("invoice_date", nullable=False),
        date_field("due_date", nullable=False),
        money_field("amount"),
        money_field("paid_amount", nullable=True),
        money_field("balance", computed="amount - paid_amount"),
        status_field(ev=["received","approved","paid","overdue","disputed"],
                     bc={"received":"amber","approved":"blue","paid":"green","overdue":"red","disputed":"purple"}),
        text_field("dispute_reason",
                   visible_when={"field":"status","operator":"eq","value":"disputed"}),
    ])
    return SPEC("procurement_spec","Procurement",
                [vendor,purchase_request,purchase_order,line_item,receipt,invoice])


# ═══════════════════════════════════════════════════════════════════════════════
# 18. TAX MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
def tax_management():
    client = ENT("Client","tax_clients",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        phone_field(),
        F("tax_id","VARCHAR(50) NOT NULL","string",False,True,True,True,"text_input","text"),
        F("client_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["individual","business","trust","nonprofit"],
          bc={"individual":"blue","business":"green","trust":"purple","nonprofit":"amber"}),
        F("filing_status","VARCHAR(30)","string",True,True,True,True,"select","status_badge",
          ev=["single","married_joint","married_separate","head_of_household","qualifying_widow"],
          bc={"single":"blue","married_joint":"green","married_separate":"amber","head_of_household":"purple","qualifying_widow":"pink"}),
        money_field("total_tax_paid", computed="SUM(payments.amount)"),
        status_field(ev=["active","inactive","prospect"],
                     bc={"active":"green","inactive":"slate","prospect":"blue"}),
    ])
    tax_return = ENT("TaxReturn","tax_returns",[
        fk_field("client_id","Client"),
        F("tax_year","INTEGER NOT NULL","number",False,True,True,True,"number_input","text",
          validation={"min":2000,"max":2100}),
        F("return_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["1040","1120","1065","990","1041","state"],
          bc={"1040":"blue","1120":"green","1065":"purple","990":"amber","1041":"pink","state":"slate"}),
        money_field("gross_income"),
        money_field("total_deductions"),
        money_field("taxable_income", computed="gross_income - total_deductions"),
        money_field("tax_liability", computed="calculated from brackets"),
        money_field("total_payments"),
        money_field("refund_or_due", computed="total_payments - tax_liability"),
        date_field("due_date", nullable=False),
        status_field(ev=["not_started","in_progress","review","filed","amended","extended"],
                     bc={"not_started":"slate","in_progress":"blue","review":"amber","filed":"green","amended":"purple","extended":"pink"}),
    ])
    document = ENT("Document","tax_documents",[
        fk_field("tax_return_id","TaxReturn"),
        F("name","VARCHAR(255) NOT NULL"),
        F("doc_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["w2","1099","1098","k1","receipt","bank_statement","other"],
          bc={"w2":"blue","1099":"green","1098":"purple","k1":"amber","receipt":"pink","bank_statement":"slate","other":"red"}),
        F("file_url","VARCHAR(500)","string",True,False,True,True,"file_upload","file_link"),
        F("tax_year","INTEGER NOT NULL","number"),
        status_field(ev=["pending","verified","rejected","archived"],
                     bc={"pending":"amber","verified":"green","rejected":"red","archived":"slate"}),
        F("uploaded_by","VARCHAR(255) NOT NULL"),
    ])
    deduction = ENT("Deduction","tax_deductions",[
        fk_field("tax_return_id","TaxReturn"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["mortgage_interest","charitable","medical","state_local_tax","business_expense","education","other"],
          bc={"mortgage_interest":"blue","charitable":"green","medical":"red","state_local_tax":"purple","business_expense":"amber","education":"pink","other":"slate"}),
        F("description","VARCHAR(500) NOT NULL"),
        money_field("amount"),
        bool_field("is_itemized"),
        F("documentation_status","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["documented","needs_docs","insufficient"],
          bc={"documented":"green","needs_docs":"amber","insufficient":"red"}),
    ])
    payment = ENT("Payment","tax_payments",[
        fk_field("tax_return_id","TaxReturn"),
        F("payment_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["estimated_q1","estimated_q2","estimated_q3","estimated_q4","withholding","extension","final"],
          bc={"estimated_q1":"blue","estimated_q2":"green","estimated_q3":"purple","estimated_q4":"amber","withholding":"pink","extension":"slate","final":"red"}),
        money_field("amount"),
        date_field("payment_date", nullable=False),
        F("method","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["eft","check","credit_card","eftps"]),
        F("confirmation_number","VARCHAR(50)","string",True),
        status_field(ev=["scheduled","paid","confirmed","failed"],
                     bc={"scheduled":"blue","paid":"green","confirmed":"purple","failed":"red"}),
    ])
    filing = ENT("Filing","tax_filings",[
        fk_field("tax_return_id","TaxReturn"),
        F("filing_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["original","amended","extension"],
          bc={"original":"blue","amended":"amber","extension":"purple"}),
        F("filing_method","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["e_file","mail","in_person"]),
        date_field("filed_date", nullable=False),
        F("confirmation_number","VARCHAR(100)","string",True),
        F("accepted_rejected","VARCHAR(20)","string",True,True,False,False,"none","status_badge",
          ev=["accepted","rejected","pending"],
          bc={"accepted":"green","rejected":"red","pending":"amber"}),
        text_field("rejection_reason",
                   visible_when={"field":"accepted_rejected","operator":"eq","value":"rejected"}),
        status_field(ev=["submitted","accepted","rejected","processing"],
                     bc={"submitted":"amber","accepted":"green","rejected":"red","processing":"blue"}),
    ])
    return SPEC("tax_management_spec","Tax Management",
                [client,tax_return,document,deduction,payment,filing])


# ═══════════════════════════════════════════════════════════════════════════════
# 19. INVESTMENT PORTFOLIO
# ═══════════════════════════════════════════════════════════════════════════════
def investment_portfolio():
    portfolio = ENT("Portfolio","portfolios",[
        F("name","VARCHAR(255) NOT NULL"),
        F("portfolio_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["growth","income","balanced","aggressive","conservative","index"],
          bc={"growth":"green","income":"blue","balanced":"purple","aggressive":"red","conservative":"amber","index":"slate"}),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        money_field("total_value", computed="SUM(assets.current_value)"),
        money_field("total_cost", computed="SUM(assets.cost_basis)"),
        money_field("total_gain_loss", computed="total_value - total_cost"),
        pct_field("total_return_pct", computed="total_gain_loss / total_cost * 100"),
        F("benchmark","VARCHAR(50)","string",True,True,True,True,"select","text",
          ev=["SP500","NASDAQ","DOW","RUSSELL2000","MSCI_WORLD"]),
        status_field(ev=["active","closed","frozen"],
                     bc={"active":"green","closed":"slate","frozen":"amber"}),
    ])
    asset = ENT("Asset","portfolio_assets",[
        fk_field("portfolio_id","Portfolio"),
        F("symbol","VARCHAR(20) NOT NULL"),
        F("name","VARCHAR(255) NOT NULL"),
        F("asset_class","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["stock","bond","etf","mutual_fund","reit","commodity","crypto","cash"],
          bc={"stock":"blue","bond":"green","etf":"purple","mutual_fund":"amber","reit":"pink","commodity":"slate","crypto":"red","cash":"teal"}),
        F("quantity","NUMERIC(15,6) NOT NULL","number",False,True,True,True,"number_input","text"),
        money_field("avg_cost"),
        money_field("current_price"),
        money_field("cost_basis", computed="quantity * avg_cost"),
        money_field("current_value", computed="quantity * current_price"),
        money_field("unrealized_gain", computed="current_value - cost_basis"),
        pct_field("return_pct", computed="unrealized_gain / cost_basis * 100"),
        pct_field("weight_pct", computed="current_value / portfolio.total_value * 100"),
    ])
    transaction = ENT("Transaction","portfolio_transactions",[
        fk_field("asset_id","Asset"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["buy","sell","dividend","split","transfer_in","transfer_out"],
          bc={"buy":"green","sell":"red","dividend":"blue","split":"purple","transfer_in":"amber","transfer_out":"pink"}),
        F("quantity","NUMERIC(15,6) NOT NULL","number"),
        money_field("price_per_unit"),
        money_field("total_amount", computed="quantity * price_per_unit"),
        money_field("fees", nullable=True),
        money_field("net_amount", computed="total_amount - fees"),
        date_field("transaction_date", nullable=False),
        text_field("notes"),
    ])
    watchlist = ENT("Watchlist","portfolio_watchlist",[
        F("symbol","VARCHAR(20) NOT NULL"),
        F("name","VARCHAR(255) NOT NULL"),
        F("asset_class","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["stock","bond","etf","mutual_fund","crypto"],
          bc={"stock":"blue","bond":"green","etf":"purple","mutual_fund":"amber","crypto":"red"}),
        money_field("target_price", nullable=True),
        money_field("current_price"),
        money_field("alert_above", nullable=True),
        money_field("alert_below", nullable=True),
        text_field("thesis"),
        bool_field("alert_enabled", True),
    ])
    dividend = ENT("Dividend","portfolio_dividends",[
        fk_field("asset_id","Asset"),
        money_field("amount_per_share"),
        F("quantity","NUMERIC(15,6) NOT NULL","number"),
        money_field("total_amount", computed="amount_per_share * quantity"),
        date_field("ex_date", nullable=False),
        date_field("pay_date", nullable=False),
        F("dividend_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["regular","special","return_of_capital"],
          bc={"regular":"blue","special":"green","return_of_capital":"amber"}),
        bool_field("reinvested"),
    ])
    perf_log = ENT("PerformanceLog","portfolio_performance",[
        fk_field("portfolio_id","Portfolio"),
        date_field("log_date", nullable=False),
        money_field("portfolio_value"),
        money_field("daily_change", computed="portfolio_value - prev_day_value"),
        pct_field("daily_return_pct", computed="daily_change / prev_day_value * 100"),
        pct_field("ytd_return_pct"),
        money_field("benchmark_value", nullable=True),
        pct_field("alpha", computed="ytd_return_pct - benchmark_return"),
        F("notes","TEXT","string",True,False,False,False,"none","text"),
    ])
    return SPEC("investment_portfolio_spec","Investment Portfolio",
                [portfolio,asset,transaction,watchlist,dividend,perf_log])


# ═══════════════════════════════════════════════════════════════════════════════
# 20. REVENUE ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════
def revenue_analytics():
    stream = ENT("Stream","revenue_streams",[
        F("name","VARCHAR(255) NOT NULL"),
        F("type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["subscription","one_time","usage_based","licensing","advertising","consulting"],
          bc={"subscription":"blue","one_time":"green","usage_based":"purple","licensing":"amber","advertising":"pink","consulting":"slate"}),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        money_field("monthly_revenue", computed="calculated"),
        money_field("annual_revenue", computed="monthly_revenue * 12"),
        pct_field("growth_rate"),
        pct_field("margin_pct"),
        money_field("cost_of_revenue", nullable=True),
        status_field(ev=["active","declining","growing","new","sunset"],
                     bc={"active":"green","declining":"red","growing":"blue","new":"purple","sunset":"amber"}),
    ])
    segment = ENT("Segment","revenue_segments",[
        F("name","VARCHAR(255) NOT NULL"),
        F("segment_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["geography","product","customer_size","industry","channel"],
          bc={"geography":"blue","product":"green","customer_size":"purple","industry":"amber","channel":"pink"}),
        money_field("total_revenue", computed="SUM(metrics.value WHERE metric=revenue)"),
        pct_field("revenue_share_pct"),
        int_field("customer_count"),
        money_field("arpu", computed="total_revenue / customer_count"),
        text_field("description"),
    ])
    forecast = ENT("Forecast","revenue_forecasts",[
        fk_field("stream_id","Stream"),
        F("period","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["monthly","quarterly","annual"]),
        date_field("forecast_date", nullable=False),
        money_field("predicted_revenue"),
        money_field("actual_revenue", nullable=True),
        money_field("variance", computed="actual_revenue - predicted_revenue"),
        pct_field("accuracy_pct", computed="1 - ABS(variance / predicted_revenue) * 100"),
        F("model","VARCHAR(30)","string",True,True,True,True,"select","text",
          ev=["linear","exponential","seasonal","ml_based","manual"]),
        F("confidence","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["high","medium","low"],
          bc={"high":"green","medium":"amber","low":"red"}),
    ])
    metric = ENT("Metric","revenue_metrics",[
        fk_field("stream_id","Stream"),
        F("metric_name","VARCHAR(100) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["mrr","arr","arpu","churn_rate","ltv","cac","nrr","expansion_revenue"],
          bc={"mrr":"blue","arr":"green","arpu":"purple","churn_rate":"red","ltv":"amber","cac":"pink","nrr":"slate","expansion_revenue":"teal"}),
        F("value","NUMERIC(15,2) NOT NULL","number",False,True,True,True,"number_input","text"),
        F("unit","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["currency","percentage","count","ratio"]),
        date_field("measured_date", nullable=False),
        F("previous_value","NUMERIC(15,2)","number",True,True,False,False,"none","text"),
        pct_field("change_pct", computed="(value - previous_value) / previous_value * 100"),
        F("trend","VARCHAR(10)","string",True,True,False,False,"none","status_badge",
          ev=["up","down","flat"],
          bc={"up":"green","down":"red","flat":"slate"}),
    ])
    target = ENT("Target","revenue_targets",[
        fk_field("stream_id","Stream"),
        F("period","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["monthly","quarterly","annual"]),
        date_field("target_date", nullable=False),
        money_field("target_amount"),
        money_field("achieved_amount", nullable=True),
        pct_field("achievement_pct", computed="achieved_amount / target_amount * 100"),
        money_field("gap", computed="target_amount - achieved_amount"),
        status_field(ev=["on_track","at_risk","behind","exceeded"],
                     bc={"on_track":"green","at_risk":"amber","behind":"red","exceeded":"blue"}),
    ])
    report = ENT("Report","revenue_reports",[
        F("title","VARCHAR(255) NOT NULL"),
        F("report_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["monthly_summary","quarterly_review","annual_report","cohort_analysis","forecast_vs_actual"],
          bc={"monthly_summary":"blue","quarterly_review":"green","annual_report":"purple","cohort_analysis":"amber","forecast_vs_actual":"pink"}),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        money_field("total_revenue", computed="SUM(streams.monthly_revenue)"),
        money_field("total_cost", computed="SUM(streams.cost_of_revenue)"),
        money_field("gross_profit", computed="total_revenue - total_cost"),
        pct_field("gross_margin", computed="gross_profit / total_revenue * 100"),
        F("prepared_by","VARCHAR(255) NOT NULL"),
    ])
    return SPEC("revenue_analytics_spec","Revenue Analytics",
                [stream,segment,forecast,metric,target,report])


# ═══════════════════════════════════════════════════════════════════════════════
# 21. CREDIT TRACKING
# ═══════════════════════════════════════════════════════════════════════════════
def credit_tracking():
    customer = ENT("Customer","credit_customers",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        phone_field(),
        F("customer_id_code","VARCHAR(50) NOT NULL"),
        F("customer_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["individual","business","corporate"],
          bc={"individual":"blue","business":"green","corporate":"purple"}),
        F("tax_id","VARCHAR(50)","string",True),
        money_field("total_credit_limit", computed="SUM(credit_lines.credit_limit)"),
        money_field("total_outstanding", computed="SUM(credit_lines.outstanding_balance)"),
        status_field(ev=["active","suspended","closed","defaulted"],
                     bc={"active":"green","suspended":"amber","closed":"slate","defaulted":"red"}),
    ])
    score = ENT("Score","credit_scores",[
        fk_field("customer_id","Customer"),
        int_field("score"),
        F("score_model","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","text",
          ev=["internal","fico","vantage","custom"]),
        F("risk_grade","VARCHAR(5) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["AAA","AA","A","BBB","BB","B","CCC","D"],
          bc={"AAA":"green","AA":"green","A":"blue","BBB":"blue","BB":"amber","B":"amber","CCC":"red","D":"red"}),
        date_field("assessed_date", nullable=False),
        int_field("previous_score", nullable=True),
        int_field("score_change", computed="score - previous_score"),
        text_field("factors"),
    ])
    credit_line = ENT("CreditLine","credit_lines",[
        fk_field("customer_id","Customer"),
        F("line_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["revolving","installment","line_of_credit","overdraft"],
          bc={"revolving":"blue","installment":"green","line_of_credit":"purple","overdraft":"amber"}),
        money_field("credit_limit"),
        money_field("outstanding_balance"),
        money_field("available_credit", computed="credit_limit - outstanding_balance"),
        pct_field("utilization_pct", computed="outstanding_balance / credit_limit * 100"),
        pct_field("interest_rate"),
        date_field("opened_date", nullable=False),
        date_field("maturity_date", nullable=True),
        status_field(ev=["active","frozen","closed","default"],
                     bc={"active":"green","frozen":"amber","closed":"slate","default":"red"}),
    ])
    transaction = ENT("Transaction","credit_transactions",[
        fk_field("credit_line_id","CreditLine"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["charge","payment","interest","fee","adjustment","refund"],
          bc={"charge":"red","payment":"green","interest":"amber","fee":"purple","adjustment":"blue","refund":"pink"}),
        money_field("amount"),
        money_field("balance_after"),
        date_field("transaction_date", nullable=False),
        F("description","VARCHAR(500) NOT NULL"),
        F("reference","VARCHAR(50)","string",True),
        status_field(ev=["posted","pending","reversed"],
                     bc={"posted":"green","pending":"amber","reversed":"red"}),
    ])
    payment = ENT("Payment","credit_payments",[
        fk_field("credit_line_id","CreditLine"),
        money_field("amount"),
        money_field("principal_portion"),
        money_field("interest_portion", computed="amount - principal_portion"),
        date_field("due_date", nullable=False),
        date_field("paid_date", nullable=True),
        int_field("days_late", computed="paid_date - due_date"),
        F("payment_method","VARCHAR(20)","string",True,True,True,True,"select","text",
          ev=["bank_transfer","check","auto_debit","online"]),
        status_field(ev=["scheduled","paid","late","missed","partial"],
                     bc={"scheduled":"blue","paid":"green","late":"amber","missed":"red","partial":"purple"}),
    ])
    alert = ENT("Alert","credit_alerts",[
        fk_field("customer_id","Customer"),
        fk_field("credit_line_id","CreditLine", nullable=True),
        F("alert_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["high_utilization","missed_payment","score_drop","limit_change","fraud_suspected","maturity"],
          bc={"high_utilization":"amber","missed_payment":"red","score_drop":"purple","limit_change":"blue","fraud_suspected":"red","maturity":"green"}),
        F("message","VARCHAR(500) NOT NULL"),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["info","warning","critical"],
          bc={"info":"blue","warning":"amber","critical":"red"}),
        bool_field("is_acknowledged"),
        datetime_field("triggered_at", nullable=False, form=False),
    ])
    return SPEC("credit_tracking_spec","Credit Tracking",
                [customer,score,credit_line,transaction,payment,alert])


# ═══════════════════════════════════════════════════════════════════════════════
# 22. FINANCIAL DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════
def financial_dashboard():
    account = ENT("Account","fin_accounts",[
        F("name","VARCHAR(255) NOT NULL"),
        F("account_number","VARCHAR(50) NOT NULL"),
        F("account_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["checking","savings","credit_card","investment","loan","cash"],
          bc={"checking":"blue","savings":"green","credit_card":"red","investment":"purple","loan":"amber","cash":"slate"}),
        F("institution","VARCHAR(255) NOT NULL"),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        money_field("current_balance"),
        money_field("available_balance", nullable=True),
        date_field("last_synced", nullable=True),
        status_field(ev=["active","inactive","closed"],
                     bc={"active":"green","inactive":"amber","closed":"slate"}),
    ])
    transaction = ENT("Transaction","fin_transactions",[
        fk_field("account_id","Account"),
        F("description","VARCHAR(500) NOT NULL"),
        money_field("amount"),
        F("type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["income","expense","transfer","refund","fee"],
          bc={"income":"green","expense":"red","transfer":"blue","refund":"purple","fee":"amber"}),
        F("category","VARCHAR(50)","string",True,True,True,True,"select","text",
          ev=["salary","rent","utilities","groceries","dining","transport","entertainment","healthcare","insurance","other"]),
        date_field("transaction_date", nullable=False),
        money_field("running_balance", computed="calculated from sequence"),
        F("reference","VARCHAR(100)","string",True),
        bool_field("is_recurring"),
        status_field(ev=["posted","pending","cleared","reconciled"],
                     bc={"posted":"green","pending":"amber","cleared":"blue","reconciled":"purple"}),
    ])
    budget = ENT("Budget","fin_budgets",[
        fk_field("account_id","Account", nullable=True),
        F("name","VARCHAR(255) NOT NULL"),
        F("category","VARCHAR(50) NOT NULL"),
        F("period","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["weekly","monthly","quarterly","annual"],
          bc={"weekly":"blue","monthly":"green","quarterly":"purple","annual":"amber"}),
        money_field("budgeted_amount"),
        money_field("spent_amount", computed="SUM(transactions.amount WHERE category)"),
        money_field("remaining", computed="budgeted_amount - spent_amount"),
        pct_field("used_pct", computed="spent_amount / budgeted_amount * 100"),
        status_field(ev=["under_budget","on_track","over_budget"],
                     bc={"under_budget":"green","on_track":"blue","over_budget":"red"}),
    ])
    report = ENT("Report","fin_reports",[
        F("title","VARCHAR(255) NOT NULL"),
        F("report_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["balance_sheet","income_statement","cash_flow","net_worth","spending_analysis"],
          bc={"balance_sheet":"blue","income_statement":"green","cash_flow":"purple","net_worth":"amber","spending_analysis":"pink"}),
        date_field("period_start", nullable=False),
        date_field("period_end", nullable=False),
        money_field("total_income", computed="SUM(transactions WHERE type=income)"),
        money_field("total_expenses", computed="SUM(transactions WHERE type=expense)"),
        money_field("net_income", computed="total_income - total_expenses"),
        money_field("savings_rate", computed="net_income / total_income"),
        text_field("notes"),
    ])
    alert = ENT("Alert","fin_alerts",[
        fk_field("account_id","Account", nullable=True),
        F("alert_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["low_balance","large_transaction","budget_exceeded","bill_due","unusual_activity","goal_milestone"],
          bc={"low_balance":"red","large_transaction":"amber","budget_exceeded":"purple","bill_due":"blue","unusual_activity":"pink","goal_milestone":"green"}),
        F("message","VARCHAR(500) NOT NULL"),
        money_field("threshold_amount", nullable=True),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["info","warning","critical"],
          bc={"info":"blue","warning":"amber","critical":"red"}),
        bool_field("is_read"),
        datetime_field("triggered_at", nullable=False, form=False),
    ])
    goal = ENT("Goal","fin_goals",[
        F("name","VARCHAR(255) NOT NULL"),
        F("goal_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["savings","debt_payoff","investment","emergency_fund","purchase","retirement"],
          bc={"savings":"blue","debt_payoff":"red","investment":"green","emergency_fund":"amber","purchase":"purple","retirement":"pink"}),
        money_field("target_amount"),
        money_field("current_amount"),
        money_field("remaining", computed="target_amount - current_amount"),
        pct_field("progress_pct", computed="current_amount / target_amount * 100"),
        date_field("target_date", nullable=True),
        money_field("monthly_contribution", nullable=True),
        status_field(ev=["active","achieved","paused","abandoned"],
                     bc={"active":"green","achieved":"blue","paused":"amber","abandoned":"red"}),
    ])
    return SPEC("financial_dashboard_spec","Financial Dashboard",
                [account,transaction,budget,report,alert,goal])


# ═══════════════════════════════════════════════════════════════════════════════
# 23. INTERNAL KNOWLEDGE BASE
# ═══════════════════════════════════════════════════════════════════════════════
def internal_knowledge_base():
    author = ENT("Author","kb_authors",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field(),
        F("department","VARCHAR(100) NOT NULL"),
        F("role","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["contributor","editor","reviewer","admin"],
          bc={"contributor":"blue","editor":"green","reviewer":"purple","admin":"amber"}),
        int_field("article_count", computed="COUNT(articles)"),
        int_field("total_views", computed="SUM(articles.view_count)"),
        F("avatar_url","VARCHAR(500)","string",True,False,True,True,"text_input","image"),
        status_field(ev=["active","inactive"],bc={"active":"green","inactive":"slate"}),
    ])
    category = ENT("Category","kb_categories",[
        F("name","VARCHAR(255) NOT NULL"),
        F("slug","VARCHAR(100) NOT NULL"),
        text_field("description"),
        fk_field("parent_category_id","Category", nullable=True),
        F("icon","VARCHAR(50)","string",True,True,True,True,"icon_select","icon"),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        int_field("article_count", computed="COUNT(articles)"),
        int_field("sort_order"),
    ])
    tag = ENT("Tag","kb_tags",[
        F("name","VARCHAR(100) NOT NULL"),
        F("slug","VARCHAR(100) NOT NULL"),
        F("color","VARCHAR(7)","string",True,True,True,True,"color_picker","color_swatch"),
        int_field("usage_count", computed="COUNT(article_tags)"),
        bool_field("is_featured"),
    ])
    article = ENT("Article","kb_articles",[
        fk_field("category_id","Category"),
        fk_field("author_id","Author"),
        F("title","VARCHAR(255) NOT NULL"),
        F("slug","VARCHAR(255) NOT NULL"),
        text_field("content"),
        text_field("excerpt"),
        F("format","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["markdown","html","rich_text"]),
        int_field("view_count"),
        int_field("helpful_count"),
        int_field("not_helpful_count"),
        pct_field("helpfulness_pct", computed="helpful_count / (helpful_count + not_helpful_count) * 100"),
        status_field(ev=["draft","review","published","archived"],
                     bc={"draft":"slate","review":"amber","published":"green","archived":"purple"}),
        bool_field("is_featured"),
        bool_field("is_pinned"),
    ])
    comment = ENT("Comment","kb_comments",[
        fk_field("article_id","Article"),
        F("author_name","VARCHAR(255) NOT NULL"),
        email_field("author_email"),
        text_field("content"),
        bool_field("is_helpful"),
        status_field(ev=["pending","approved","rejected","spam"],
                     bc={"pending":"amber","approved":"green","rejected":"red","spam":"slate"}),
        fk_field("parent_comment_id","Comment", nullable=True),
        datetime_field("posted_at", nullable=False, form=False),
    ])
    search_log = ENT("SearchLog","kb_search_logs",[
        F("query","VARCHAR(500) NOT NULL"),
        int_field("results_count"),
        bool_field("had_results"),
        F("clicked_article_id","UUID","string",True,False,False,False,"none","text"),
        F("source","VARCHAR(20)","string",True,True,False,False,"none","status_badge",
          ev=["search_bar","sidebar","suggested","external"],
          bc={"search_bar":"blue","sidebar":"green","suggested":"purple","external":"amber"}),
        datetime_field("searched_at", nullable=False, form=False),
        F("user_department","VARCHAR(100)","string",True),
    ])
    return SPEC("internal_knowledge_base_spec","Internal Knowledge Base",
                [author,category,tag,article,comment,search_log])


# ═══════════════════════════════════════════════════════════════════════════════
# 24. AUDIT MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
def audit_management():
    audit_plan = ENT("AuditPlan","audit_plans",[
        F("title","VARCHAR(255) NOT NULL"),
        F("plan_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["annual","quarterly","special","follow_up"],
          bc={"annual":"blue","quarterly":"green","special":"purple","follow_up":"amber"}),
        F("fiscal_year","INTEGER NOT NULL","number",False,True,True,True,"number_input","text"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        F("plan_owner","VARCHAR(255) NOT NULL"),
        int_field("total_audits", computed="COUNT(audits)"),
        int_field("completed_audits", computed="COUNT(audits WHERE status=completed)"),
        pct_field("completion_pct", computed="completed_audits / total_audits * 100"),
        status_field(ev=["draft","approved","in_progress","completed"],
                     bc={"draft":"slate","approved":"blue","in_progress":"amber","completed":"green"}),
    ])
    checklist = ENT("Checklist","audit_checklists",[
        F("name","VARCHAR(255) NOT NULL"),
        F("category","VARCHAR(50) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["financial","operational","compliance","it","hr","safety"],
          bc={"financial":"blue","operational":"green","compliance":"red","it":"purple","hr":"amber","safety":"pink"}),
        text_field("description"),
        int_field("item_count"),
        F("frequency","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","text",
          ev=["one_time","monthly","quarterly","annual"]),
        bool_field("is_template", True),
        F("version","INTEGER NOT NULL DEFAULT 1","number"),
    ])
    audit = ENT("Audit","audits",[
        fk_field("audit_plan_id","AuditPlan", nullable=True),
        fk_field("checklist_id","Checklist", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        F("audit_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["internal","external","regulatory","surprise","follow_up"],
          bc={"internal":"blue","external":"purple","regulatory":"red","surprise":"amber","follow_up":"green"}),
        F("scope","TEXT","string",True,False,True,True,"textarea","text"),
        F("lead_auditor","VARCHAR(255) NOT NULL"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=True),
        int_field("finding_count", computed="COUNT(findings)"),
        F("risk_rating","VARCHAR(20)","string",True,True,True,True,"select","status_badge",
          ev=["low","medium","high","critical"],
          bc={"low":"green","medium":"amber","high":"red","critical":"purple"}),
        status_field(ev=["planning","fieldwork","reporting","completed","cancelled"],
                     bc={"planning":"slate","fieldwork":"blue","reporting":"amber","completed":"green","cancelled":"red"}),
    ])
    finding = ENT("Finding","audit_findings",[
        fk_field("audit_id","Audit"),
        F("finding_number","VARCHAR(20) NOT NULL"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        F("finding_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["deficiency","material_weakness","significant_deficiency","observation","best_practice"],
          bc={"deficiency":"amber","material_weakness":"red","significant_deficiency":"purple","observation":"blue","best_practice":"green"}),
        F("severity","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["critical","high","medium","low"],
          bc={"critical":"red","high":"amber","medium":"blue","low":"green"}),
        F("root_cause","TEXT","string",True,False,True,True,"textarea","text"),
        date_field("due_date", nullable=True),
        status_field(ev=["open","in_remediation","resolved","accepted","reopened"],
                     bc={"open":"red","in_remediation":"amber","resolved":"green","accepted":"blue","reopened":"purple"}),
    ])
    recommendation = ENT("Recommendation","audit_recommendations",[
        fk_field("finding_id","Finding"),
        F("title","VARCHAR(255) NOT NULL"),
        text_field("description"),
        priority_field(),
        F("assignee","VARCHAR(255) NOT NULL"),
        date_field("due_date", nullable=False),
        date_field("completed_date", nullable=True,
                   visible_when={"field":"status","operator":"eq","value":"implemented"}),
        money_field("estimated_cost", nullable=True),
        money_field("actual_cost", nullable=True,
                    visible_when={"field":"status","operator":"eq","value":"implemented"}),
        status_field(ev=["proposed","accepted","in_progress","implemented","rejected","deferred"],
                     bc={"proposed":"slate","accepted":"blue","in_progress":"amber","implemented":"green","rejected":"red","deferred":"purple"}),
    ])
    evidence = ENT("Evidence","audit_evidence",[
        fk_field("audit_id","Audit"),
        fk_field("finding_id","Finding", nullable=True),
        F("title","VARCHAR(255) NOT NULL"),
        F("evidence_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["document","interview","observation","test_result","sample","photo"],
          bc={"document":"blue","interview":"green","observation":"purple","test_result":"amber","sample":"pink","photo":"slate"}),
        F("file_url","VARCHAR(500)","string",True,False,True,True,"file_upload","file_link"),
        F("collected_by","VARCHAR(255) NOT NULL"),
        date_field("collection_date", nullable=False),
        text_field("notes"),
        status_field(ev=["collected","reviewed","accepted","rejected"],
                     bc={"collected":"amber","reviewed":"blue","accepted":"green","rejected":"red"}),
    ])
    return SPEC("audit_management_spec","Audit Management",
                [audit_plan,checklist,audit,finding,recommendation,evidence])


# ═══════════════════════════════════════════════════════════════════════════════
# 25. VENDOR PAYMENT
# ═══════════════════════════════════════════════════════════════════════════════
def vendor_payment():
    vendor = ENT("Vendor","vp_vendors",[
        F("name","VARCHAR(255) NOT NULL"),
        email_field("contact_email"),
        phone_field("contact_phone"),
        F("company","VARCHAR(255) NOT NULL"),
        F("tax_id","VARCHAR(50)","string",True,True,True,True,"text_input","text"),
        F("vendor_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["supplier","contractor","service_provider","consultant","freelancer"],
          bc={"supplier":"blue","contractor":"green","service_provider":"purple","consultant":"amber","freelancer":"pink"}),
        F("payment_terms","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","text",
          ev=["net_15","net_30","net_45","net_60","upon_receipt","advance"]),
        money_field("total_paid", computed="SUM(payments.amount)"),
        money_field("outstanding_balance", computed="SUM(invoices.balance)"),
        status_field(ev=["active","suspended","inactive","blacklisted"],
                     bc={"active":"green","suspended":"amber","inactive":"slate","blacklisted":"red"}),
    ])
    bank_account = ENT("BankAccount","vp_bank_accounts",[
        fk_field("vendor_id","Vendor"),
        F("account_name","VARCHAR(255) NOT NULL"),
        F("bank_name","VARCHAR(255) NOT NULL"),
        F("account_number_last4","VARCHAR(4) NOT NULL"),
        F("routing_number","VARCHAR(20)","string",True),
        F("account_type","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["checking","savings","business"],
          bc={"checking":"blue","savings":"green","business":"purple"}),
        F("currency","CHAR(3) NOT NULL DEFAULT 'USD'","string"),
        bool_field("is_primary", True),
        status_field(ev=["active","inactive","unverified"],
                     bc={"active":"green","inactive":"slate","unverified":"amber"}),
    ])
    contract = ENT("Contract","vp_contracts",[
        fk_field("vendor_id","Vendor"),
        F("title","VARCHAR(255) NOT NULL"),
        F("contract_number","VARCHAR(50) NOT NULL"),
        F("contract_type","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["fixed_price","time_and_materials","retainer","sow","msa"],
          bc={"fixed_price":"blue","time_and_materials":"green","retainer":"purple","sow":"amber","msa":"pink"}),
        money_field("total_value"),
        money_field("billed_to_date", computed="SUM(invoices.amount)"),
        money_field("remaining_value", computed="total_value - billed_to_date"),
        pct_field("utilization_pct", computed="billed_to_date / total_value * 100"),
        date_field("start_date", nullable=False),
        date_field("end_date", nullable=False),
        status_field(ev=["draft","active","expired","terminated","renewed"],
                     bc={"draft":"slate","active":"green","expired":"amber","terminated":"red","renewed":"blue"}),
    ])
    invoice = ENT("Invoice","vp_invoices",[
        fk_field("vendor_id","Vendor"),
        fk_field("contract_id","Contract", nullable=True),
        F("invoice_number","VARCHAR(50) NOT NULL"),
        date_field("invoice_date", nullable=False),
        date_field("due_date", nullable=False),
        money_field("subtotal"),
        money_field("tax_amount", nullable=True),
        money_field("total", computed="subtotal + tax_amount"),
        money_field("paid_amount", nullable=True),
        money_field("balance", computed="total - paid_amount"),
        int_field("days_outstanding", computed="CURRENT_DATE - invoice_date"),
        status_field(ev=["received","approved","partial_paid","paid","overdue","disputed","void"],
                     bc={"received":"amber","approved":"blue","partial_paid":"purple","paid":"green","overdue":"red","disputed":"pink","void":"slate"}),
    ])
    payment = ENT("Payment","vp_payments",[
        fk_field("invoice_id","Invoice"),
        fk_field("bank_account_id","BankAccount", nullable=True),
        money_field("amount"),
        F("payment_method","VARCHAR(30) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["ach","wire","check","credit_card","virtual_card"],
          bc={"ach":"blue","wire":"green","check":"amber","credit_card":"purple","virtual_card":"pink"}),
        date_field("payment_date", nullable=False),
        F("reference_number","VARCHAR(100)","string",True),
        money_field("fee", nullable=True),
        money_field("net_amount", computed="amount - fee"),
        status_field(ev=["scheduled","processing","completed","failed","reversed"],
                     bc={"scheduled":"slate","processing":"blue","completed":"green","failed":"red","reversed":"amber"}),
        text_field("failure_reason",
                   visible_when={"field":"status","operator":"eq","value":"failed"}),
    ])
    approval_request = ENT("ApprovalRequest","vp_approval_requests",[
        fk_field("invoice_id","Invoice"),
        F("requested_by","VARCHAR(255) NOT NULL"),
        F("approver","VARCHAR(255) NOT NULL"),
        email_field("approver_email"),
        money_field("amount"),
        F("approval_level","VARCHAR(20) NOT NULL","string",False,True,True,True,"select","status_badge",
          ev=["level_1","level_2","level_3","executive"],
          bc={"level_1":"blue","level_2":"green","level_3":"purple","executive":"amber"}),
        status_field(ev=["pending","approved","rejected","escalated"],
                     bc={"pending":"amber","approved":"green","rejected":"red","escalated":"purple"}),
        text_field("comments"),
        text_field("rejection_reason",
                   visible_when={"field":"status","operator":"eq","value":"rejected"}),
        datetime_field("decided_at", nullable=True, form=False),
    ])
    return SPEC("vendor_payment_spec","Vendor Payment",
                [vendor,bank_account,contract,invoice,payment,approval_request])


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN — generate all 25
# ═══════════════════════════════════════════════════════════════════════════════
ALL_GENERATORS = [
    budget_planner,
    commission_tracking,
    expense_tracking,
    meeting_scheduler,
    time_tracking,
    subscription_management,
    workflow_automation,
    team_collaboration,
    risk_management,
    compliance_tracker,
    document_management,
    internal_ticketing,
    resource_allocation,
    okr_goal_tracking,
    incident_tracking,
    payroll,
    procurement,
    tax_management,
    investment_portfolio,
    revenue_analytics,
    credit_tracking,
    financial_dashboard,
    internal_knowledge_base,
    audit_management,
    vendor_payment,
]

if __name__ == "__main__":
    os.makedirs(SPEC_DIR, exist_ok=True)
    print(f"Generating {len(ALL_GENERATORS)} specs into {SPEC_DIR} ...")
    for gen in ALL_GENERATORS:
        spec = gen()
        write_spec(spec["spec_name"], spec)
    print(f"\nDone — {len(ALL_GENERATORS)} spec files written.")
