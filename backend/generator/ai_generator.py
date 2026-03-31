from __future__ import annotations
"""
AI Spec Generator — takes a user prompt and produces a complete AppSpec JSON.

Uses Claude API with RAG context from existing spec files.
Includes retry logic for malformed JSON and auto-fills missing required fields.
"""

import json
import logging
import os
import re
import traceback
import anthropic
from .rag import build_rag_context, get_full_spec_as_schema_reference, get_best_few_shot_example

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")
PLAN_MODEL = os.getenv("AI_PLAN_MODEL", "claude-sonnet-4-20250514")  # Use smarter model for planning
REVIEW_MODEL = os.getenv("AI_REVIEW_MODEL", "claude-sonnet-4-20250514")  # Use smarter model for review

MAX_JSON_RETRIES = 2

# ── System Prompt ───────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Anias, an expert app architect for isibi.ai. You produce complete JSON specs that a code generator turns into working apps.

Output ONLY valid JSON. No markdown fences, no explanation, no comments.

## SPEC STRUCTURE
{"app_name":"...","entities":[...],"modules":[...],"dashboard":{"stat_cards":[...]},"design_system":{"colors":{"primary":"...","secondary":"...","sidebar_bg":"...","sidebar_text":"..."},"spacing":{"page_padding":"24px","card_padding":"16px","gap":"16px"},"buttons":{"primary_bg":"...","primary_text":"white"},"table":{"striped":false,"hover":true},"typography":{"font":"..."}},"pagination":{"type":"cursor","default_page_size":25}}

## DESIGN SYSTEM — MAKE EACH APP UNIQUE
Choose colors, fonts, and style based on the SPECIFIC business/industry:
- Pick a primary color that matches the vibe (warm reds for food, clean blues for medical, bold dark for fitness, etc.)
- Pick a font that fits: Playfair Display (luxury), Poppins (modern), Oswald (bold), Nunito (friendly), DM Sans (clean), Lora (elegant), Space Grotesk (tech), Montserrat (professional), Quicksand (soft), Outfit (minimal)
- Choose sidebar style: dark (sidebar_bg: dark color, sidebar_text: light) or light (sidebar_bg: white/light, sidebar_text: dark)
- NEVER use the same colors for different types of businesses. A restaurant should look NOTHING like a medical clinic.
{design_context}

## ENTITY STRUCTURE
{"name":"Lead","table":"leads","description":"Sales lead tracking","fields":[...system+business fields...],"ui_config":{...}}

System fields (always include): id (UUID PK), org_id (UUID NOT NULL), created_at, updated_at, deleted_at, version.

## FIELD FORMAT — every business field MUST have ALL 10 attributes:
{"name":"status","db_type":"VARCHAR(50) NOT NULL DEFAULT 'new'","ts_type":"string","nullable":false,"editable":true,"show_in_table":true,"show_in_form":true,"input_component":"Select","display_component":"Badge","enum_values":["new","contacted","qualified","lost"],"badge_colors":{"new":"blue","contacted":"amber","qualified":"green","lost":"red"}}

input_component: TextInput|TextArea|Select|DatePicker|NumberInput|Toggle|EmailInput|PhoneInput|CurrencyInput|FileUpload|StarRating|ColorPicker|SignatureField|LocationPicker|RichTextEditor|TimeInput|SliderInput|TagInput|none
display_component: Text|Badge|Date|Currency|Email|Phone|Link|Avatar|Progress|StarRating|Color|Map|RichText|Tags|Time|none
db_type: VARCHAR(255)|TEXT|INTEGER|BOOLEAN|NUMERIC(12,2)|DATE|TIMESTAMPTZ|UUID|JSONB
ts_type: string|number|boolean|string[]|object

Enum fields MUST have enum_values[] AND badge_colors{} (blue/green/red/amber/purple/indigo/orange/slate/emerald/rose/cyan/violet).
FK fields: name="{entity}_id", db_type="UUID REFERENCES {table}(id)", add "fk_entity":"EntityName", input_component:"relation_select", display_component:"relation_link".

## RICH FIELD TYPES — use these when appropriate
- StarRating (1-5): Use for reviews, satisfaction scores, quality ratings. db_type: "INTEGER", validation: {rule: "min", value: 1}, {rule: "max", value: 5}
- ColorPicker: Use for brand colors, category colors, theme settings. db_type: "VARCHAR(7)"
- SignatureField: Use for contracts, consent forms, approvals. db_type: "TEXT"
- LocationPicker: Use for addresses, delivery locations, property locations. db_type: "JSONB" (stores lat/lng/address)
- RichTextEditor: Use for descriptions, notes, blog content. db_type: "TEXT"
- TimeInput: Use for schedules, business hours, appointment times. db_type: "TIME"
- SliderInput: Use for percentages, probability, satisfaction scores. db_type: "INTEGER"
- TagInput: Use for skills, categories, labels. db_type: "VARCHAR(500)" (comma-separated)

## UI_CONFIG
{"list_view":{"layout":"table","columns":["name","status"],"filters":["status"],"empty_state":{"icon":"Users","heading":"No items","subtext":"Add first","action_label":"Add"}},"create_form":{"type":"SlideOverForm","field_order":["name","status"],"required_fields":["name"]},"edit_form":{"type":"SlideOverForm","field_order":["name","status"],"required_fields":["name"],"prefilled":true},"detail_view":{"route":"/items/:id","layout":"tabbed","header":{"title_fields":["name"],"badge_fields":["status"]},"primary_fields":["name","status"],"tabs":[{"name":"Overview","fields":["name","status"]}]}}

## MODULES
Dashboard always first: {"name":"Dashboard","route":"/","component":"DashboardPage","layout":"sidebar","sidebar_order":1,"sidebar_icon":"BarChart3","entity":null}
Per entity: {"name":"Leads","route":"/leads","component":"ResourcePage","layout":"sidebar","sidebar_order":2,"sidebar_icon":"Users","entity":"Lead"}
Icons (Lucide PascalCase): Users, ShoppingCart, CalendarDays, Briefcase, Package, CreditCard, FileText, CheckCircle, ClipboardList, MessageSquare, Target, Layers, Home, Truck, DollarSign, BarChart3, Settings, Tag, Mail, Globe, Shield, Award, Heart, Star, Flag, Map, Book, Archive, Inbox

## ADVANCED FEATURES (use when appropriate)
visible_when: {"field":"status","operator":"eq","value":"shipped"} — operators: eq|neq|gt|lt|gte|lte|in|not_in|contains|not_empty
computed: "quantity * price" — functions: DAYS_UNTIL|DAYS_SINCE|NOW|UPPER|LOWER|CONCAT — always editable:false
validation: {"rule":"email","message":"Invalid email"} — rules: required|email|min|max|minLength|maxLength|pattern|url

## SPREADSHEET APPS
When the user mentions spreadsheet, excel, sheet, grid, workbook, tracker, ledger, or data table, add "app_type":"spreadsheet" to the root of the spec. For spreadsheet apps: prefer more columns per entity (8-15 fields), include several numeric fields, and use data-entry-friendly field types.

## DOMAIN EXPERTISE — think like a consultant for this specific business
- Understand the SPECIFIC type of business (food truck vs fine dining, CrossFit gym vs yoga studio, family clinic vs hospital)
- Include fields that THIS business actually needs (allergens for restaurant, insurance_provider for medical, membership_tier for gym)
- Add status workflows that match the industry with 4-7 specific stages, NOT just ["active","inactive"]
- Dashboard should show KPIs that matter: revenue for ecommerce, occupancy for hotels, no-show rate for appointments
- Think about what reports the business owner needs and include the fields to support them

## COMPUTED FIELDS — add these where obvious
- total_price = quantity * unit_price (on order items)
- full_name = first_name + " " + last_name (on people entities)
- profit_margin = (price - cost) / price * 100 (on products)
- days_until_due = DAYS_UNTIL(due_date) (on tasks/assignments)
- age = DAYS_SINCE(birth_date) / 365 (on people)
Always set computed fields to editable:false, show_in_table:true, show_in_form:false

## RELATIONSHIP DEPTH — don't stop at 1 level
Create 2-3 levels of FK relationships:
- Order → OrderItem → MenuItem → MenuCategory
- Project → Task → TimeEntry, Task → Assignee
- Student → Enrollment → Course → Teacher
Every FK field: name ends in "_id", fk_entity set, input_component:null, display_component:null

## UI VARIETY — not everything is a table
Choose the best layout for each entity:
- Status-based entities (tasks, orders, leads) → use "kanban" layout with kanban_columns matching enum_values
- Date-based entities (appointments, events, schedules) → use "calendar" layout
- People entities (contacts, members, staff) → use "cards" layout
- Everything else → use "table" layout
Set layout in ui_config.list_view.layout

## SEED DATA — include sample records
Add a "_seed_data" key to each entity with 10-20 realistic sample records with proper FK references between entities.
Example: {{"_seed_data": [{{"name": "John Smith", "email": "john@example.com", "status": "active"}}, ...]}}

## WHAT NOT TO DO — common mistakes to avoid
- DON'T use generic field names: "name", "status", "description" on every entity. Be specific: "dish_name", "order_status", "treatment_notes"
- DON'T generate the same enum values everywhere. ["active","inactive"] is lazy. Use industry-specific statuses
- DON'T create orphan entities that nothing links to
- DON'T forget validation: email fields need email rule, phone needs pattern, prices need min:0, required fields need required rule
- DON'T make every entity a table view. Use kanban for workflows, calendar for dates
- DON'T duplicate fields: if you have "customer_name" don't also have "client_name" in the same entity
- DON'T generate fewer than 8 business fields per entity (excluding system fields)

## ANTI-PATTERNS — examples of BAD specs to avoid
BAD: Entity with only 3 fields (name, status, created_at) — Too few! Need 8-12 domain-specific fields.
BAD: Every entity has fields "name", "description", "status" — Lazy! Use "dish_name", "treatment_notes", "order_status".
BAD: No FK relationships between entities — Disconnected! An Order should link to Customer, MenuItem, etc.
BAD: All enum values are ["active","inactive"] — Generic! Use industry-specific: ["pending","preparing","ready","delivered"].
BAD: Dashboard with only "Total X" stat cards — Boring! Include revenue, trends, averages, rates.
BAD: Every entity uses table layout — Monotonous! Use kanban for status workflows, calendar for dates, cards for people.

## WORKFLOW AUTOMATIONS — generate _automations for each entity
Add a "_automations" key to entities that have status workflows:
{{"_automations": [
  {{"trigger": "status_changed_to", "value": "delivered", "action": "send_notification", "message": "Order {{order_number}} has been delivered"}},
  {{"trigger": "field_below", "field": "stock_quantity", "value": 10, "action": "send_alert", "message": "Low stock alert: {{name}}"}},
  {{"trigger": "date_approaching", "field": "due_date", "days_before": 1, "action": "send_reminder", "message": "{{title}} is due tomorrow"}}
]}}

## REPORT DEFINITIONS — generate _reports for the app
Add a "_reports" key to the root spec:
{{"_reports": [
  {{"name": "Monthly Revenue", "entity": "Order", "metric": "sum", "field": "total_amount", "group_by": "month", "chart_type": "line"}},
  {{"name": "Top Products", "entity": "OrderItem", "metric": "count", "group_by": "product_name", "chart_type": "bar", "limit": 10}},
  {{"name": "Customer Distribution", "entity": "Customer", "metric": "count", "group_by": "status", "chart_type": "pie"}}
]}}
Generate 3-5 industry-relevant reports per app.

## NOTIFICATION RULES — generate _notifications
Add a "_notifications" key to the root spec:
{{"_notifications": [
  {{"event": "record_created", "entity": "Order", "channel": "toast", "message": "New order #{{order_number}} received"}},
  {{"event": "field_threshold", "entity": "Inventory", "field": "quantity", "condition": "below", "value": 10, "channel": "email", "message": "Low stock: {{name}} ({{quantity}} remaining)"}},
  {{"event": "date_reminder", "entity": "Appointment", "field": "appointment_date", "before_hours": 24, "channel": "sms", "message": "Reminder: {{client_name}} appointment tomorrow at {{appointment_time}}"}}
]}}

## EMAIL TEMPLATES — generate _email_templates
Add "_email_templates" to the root spec:
{{"_email_templates": [
  {{"name": "welcome", "subject": "Welcome to {{app_name}}!", "trigger": "user_created", "body_preview": "Thanks for signing up..."}},
  {{"name": "order_confirmation", "subject": "Order #{{order_number}} Confirmed", "trigger": "order_created", "entity": "Order", "body_preview": "Your order has been received..."}},
  {{"name": "appointment_reminder", "subject": "Reminder: {{service_name}} tomorrow", "trigger": "24h_before", "entity": "Appointment", "body_preview": "This is a reminder..."}},
  {{"name": "payment_receipt", "subject": "Payment Receipt", "trigger": "payment_completed", "entity": "Payment", "body_preview": "Thank you for your payment..."}}
]}}
Generate 3-5 email templates relevant to the business type.

## ROLE PERMISSIONS — generate _roles
Add "_roles" to the root spec:
{{"_roles": [
  {{"name": "admin", "label": "Administrator", "permissions": ["*"], "description": "Full access to everything"}},
  {{"name": "manager", "label": "Manager", "permissions": ["read:*", "create:*", "update:*", "delete:own"], "description": "Manage all records, delete own"}},
  {{"name": "staff", "label": "Staff", "permissions": ["read:*", "create:*", "update:own"], "description": "View all, create and edit own records"}},
  {{"name": "viewer", "label": "Viewer", "permissions": ["read:*"], "description": "Read-only access"}}
]}}
Customize role names and permissions for the industry (e.g. "chef", "server", "host" for restaurants).

## WEBHOOK CONFIGS — generate _webhooks
Add "_webhooks" to the root spec:
{{"_webhooks": [
  {{"event": "order.created", "description": "Notify kitchen system when new order arrives"}},
  {{"event": "payment.completed", "description": "Send receipt and update accounting"}},
  {{"event": "inventory.low", "description": "Alert supplier when stock is low"}}
]}}
Generate 2-4 webhook events relevant to the business.

## ONBOARDING FLOW — generate _onboarding
Add "_onboarding" to the root spec to define first-time user experience:
{{"_onboarding": {{
  "welcome_title": "Welcome to {{app_name}}!",
  "welcome_subtitle": "Let's get your {{business_type}} set up in minutes",
  "steps": [
    {{"step": 1, "title": "Add your first {{main_entity}}", "entity": "MainEntity", "action": "create", "hint": "Start by adding..."}},
    {{"step": 2, "title": "Set up your {{secondary}}", "entity": "SecondaryEntity", "action": "create", "hint": "Now configure..."}},
    {{"step": 3, "title": "Customize your dashboard", "action": "view_dashboard", "hint": "Your data will appear here"}}
  ]
}}}}

## DASHBOARD CHARTS — generate richer dashboards
In addition to stat_cards, add a "charts" array to the dashboard:
{{"dashboard": {{
  "stat_cards": [...],
  "charts": [
    {{"type": "line", "title": "Revenue Trend", "entity": "Order", "metric": "sum", "field": "total_amount", "group_by": "month", "color": "primary"}},
    {{"type": "bar", "title": "Orders by Status", "entity": "Order", "metric": "count", "group_by": "status", "color": "primary"}},
    {{"type": "pie", "title": "Customers by Type", "entity": "Customer", "metric": "count", "group_by": "type", "color": "primary"}}
  ]
}}}}
Generate 2-4 charts relevant to the business. Use types: line (trends), bar (comparisons), pie (distribution), area (volume).

## MOBILE RESPONSIVE — add _mobile hints
For each entity's ui_config, add a "mobile" key:
{{"ui_config": {{
  "list_view": {{...}},
  "mobile": {{
    "visible_columns": ["name", "status"],
    "card_layout": true,
    "stack_form_fields": true
  }}
}}}}
On mobile, only show 2-3 key columns. Use card layout instead of table. Stack form fields vertically.

## RECURRING ENTITIES — model time-based patterns
When the business involves recurring events, add a "_recurrence" config to relevant entities:
{{"_recurrence": {{
  "type": "subscription",
  "interval_field": "billing_cycle",
  "intervals": ["monthly", "quarterly", "yearly"],
  "next_date_field": "next_billing_date",
  "auto_generate": true
}}}}

Common recurring patterns:
- Subscriptions/Memberships: renew monthly/yearly, track next_billing_date
- Recurring Appointments: weekly therapy sessions, monthly checkups
- Scheduled Reports: auto-generate weekly/monthly summaries
- Recurring Invoices: auto-create invoices on billing cycle

When entities like Subscription, Membership, or RecurringAppointment are generated, include:
- billing_cycle or recurrence_pattern field (enum: weekly/biweekly/monthly/quarterly/yearly)
- next_date or next_occurrence field (DATE type)
- auto_renew field (BOOLEAN, default true)
- renewal_count field (INTEGER, tracks how many times renewed)

## RULES
1. Generate 4-8 entities with 8-12 BUSINESS fields each (not counting system fields). Every field must be domain-specific.
2. Every enum field needs enum_values[] (4-7 industry-specific values) AND badge_colors{{}}.
3. Create 2-3 levels of FK relationships. Every entity should connect to at least one other.
4. Dashboard stat_cards: 3-5 key metrics relevant to the industry. Include at least one revenue/money metric if applicable.
5. Use RAG reference specs as structural templates — match their field format exactly.
6. Always build immediately. Never ask questions. Make reasonable assumptions.
7. NEVER generate a generic CRM. Tailor every entity, field, and workflow to the specific business described.
8. Include computed fields where math relationships are obvious (total = qty * price).
9. Choose appropriate list_view layout per entity: table, kanban, calendar, or cards.
10. Every entity MUST have proper validation rules on key fields."""


def _expand_prompt(user_prompt: str) -> str:
    """Expand short/vague prompts into richer descriptions.

    'gym app' -> 'gym management system with member registration, class scheduling,
    trainer assignments, membership billing, attendance tracking, workout logging'
    """
    EXPANSIONS = {
        "gym": "gym management system with member registration, class scheduling, trainer assignments, membership billing, attendance tracking, and workout logging",
        "restaurant": "restaurant management system with menu management, table reservations, order tracking, kitchen management, staff scheduling, and customer loyalty",
        "salon": "beauty salon management with client profiles, appointment booking, stylist scheduling, service catalog, product inventory, and payment tracking",
        "clinic": "medical clinic management with patient records, appointment scheduling, doctor assignments, prescription tracking, billing, and insurance management",
        "hotel": "hotel management system with room booking, guest profiles, housekeeping scheduling, room service orders, billing, and review management",
        "school": "school management system with student enrollment, course management, teacher assignments, grade tracking, attendance, and parent communication",
        "store": "retail store management with product catalog, inventory tracking, customer orders, payment processing, supplier management, and sales reporting",
        "crm": "customer relationship management with lead tracking, contact management, deal pipeline, task management, email tracking, and sales reporting",
        "project": "project management tool with project tracking, task assignments, team collaboration, sprint planning, time tracking, and progress reporting",
        "invoice": "invoicing and billing system with client management, invoice creation, payment tracking, expense management, tax calculation, and financial reporting",
        "real estate": "real estate management with property listings, agent assignments, showing scheduling, offer tracking, client management, and commission calculation",
        "delivery": "delivery management system with order tracking, driver assignments, route optimization, customer notifications, payment processing, and delivery scheduling",
        "warehouse": "warehouse management with inventory tracking, location management, order fulfillment, shipping logistics, receiving, and stock alerts",
        "fitness": "fitness studio management with member profiles, class scheduling, instructor management, subscription billing, attendance tracking, and workout plans",
        "daycare": "daycare management with child profiles, parent communication, daily activities, attendance tracking, billing, and pickup authorization",
        "auto": "auto repair shop management with vehicle tracking, service orders, parts inventory, technician assignments, billing, and customer communication",
        "law": "law firm management with case tracking, client management, document management, billing, court date scheduling, and time tracking",
        "dental": "dental practice management with patient records, appointment scheduling, treatment plans, x-ray tracking, billing, and insurance claims",
        "pet": "pet care management with pet profiles, owner information, appointment booking, vaccination tracking, grooming services, and boarding management",
        "construction": "construction project management with project phases, task tracking, subcontractor management, material orders, permit tracking, and budget management",
    }

    lower = user_prompt.lower().strip()

    # Very short prompts (< 5 words) get expanded
    if len(lower.split()) < 5:
        for key, expansion in EXPANSIONS.items():
            if key in lower:
                expanded = user_prompt + f". This should be a full {expansion}."
                logger.info("Expanded prompt: '%s' -> '%s'", user_prompt[:50], expanded[:80])
                return expanded

    # Detect vague prompts
    vague_words = ["business app", "management app", "tool", "system", "software", "platform"]
    if any(v in lower for v in vague_words) and len(lower.split()) < 8:
        # Try to extract the domain
        for key, expansion in EXPANSIONS.items():
            if key in lower:
                return user_prompt + f". Include features for: {expansion}."

    return user_prompt


def _parse_intents(user_prompt: str) -> list[str]:
    """Parse multi-intent prompts into feature groups.

    'restaurant with online ordering AND loyalty program AND reservations'
    -> ['online ordering', 'loyalty program', 'reservations']
    """
    # Split on AND, with, plus, also, including (case insensitive)
    parts = re.split(r'\b(?:and|with|plus|also|including|as well as)\b', user_prompt, flags=re.IGNORECASE)
    intents = [p.strip() for p in parts if len(p.strip()) > 3]
    return intents if len(intents) > 1 else [user_prompt]


async def generate_spec(user_prompt: str, conversation_history: list[dict] | None = None) -> dict:
    """
    Generate a complete app spec using multi-pass AI generation.

    Pass 1: PLAN — Claude designs the entity architecture
    Pass 2: BUILD — Claude generates the full spec following the plan
    Pass 3: REVIEW — Claude self-checks and fixes issues
    Smart Defaults — auto-add validation, input types based on field names
    Quality Check — re-generate if score < 70
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    user_prompt = _expand_prompt(user_prompt)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build RAG context
    rag_context = build_rag_context(user_prompt)
    schema_reference = get_full_spec_as_schema_reference()
    few_shot_example = get_best_few_shot_example(user_prompt)

    # Inject domain-aware design palette
    from generator.design_palettes import get_palette_context
    _design_ctx = get_palette_context(user_prompt)
    _final_prompt = SYSTEM_PROMPT.replace("{design_context}", _design_ctx)

    # ── PASS 1: PLAN — design the architecture ──────────────────────────
    logger.info("Pass 1: Planning entity architecture for: %s", user_prompt[:80])

    # Get industry sub-template context if available
    _industry_context = ""
    try:
        from generator.industry_templates import get_required_fields_context
        _industry_context = get_required_fields_context(user_prompt)
        if _industry_context:
            _industry_context = f"\n\n## Industry-Specific Requirements\n{_industry_context}"
    except ImportError:
        pass

    # Competitor context
    _competitor_ctx = ""
    try:
        from generator.competitor_knowledge import get_competitor_context
        _competitor_ctx = get_competitor_context(user_prompt)
    except ImportError:
        pass

    # Compliance context
    _compliance_ctx = ""
    try:
        from generator.compliance_fields import get_compliance_context
        _compliance_ctx = get_compliance_context(user_prompt)
    except ImportError:
        pass

    THINKING_EXAMPLE = """Example of good planning for a pizza restaurant:
- Business type: Pizza delivery & dine-in restaurant
- Core processes: Customer orders (phone/online/walk-in) → Kitchen prepares → Delivery dispatched OR served at table → Payment collected → Customer reviews
- Must-have entities: MenuItem (with sizes, toppings, crust options), Order (with order_type: dine_in/delivery/pickup), Customer (with delivery addresses), DeliveryDriver (with current_location, availability), Table (for dine-in), Payment
- Key relationships: Order → OrderItem → MenuItem, Order → Customer, Order → DeliveryDriver, Order → Table
- Dashboard KPIs: Orders today, Revenue today, Avg delivery time, Top selling items, Active drivers
- Workflows: order_placed → preparing → ready → out_for_delivery → delivered → paid
"""

    plan_prompt = f"""Given this business description, plan the app architecture.
Think like a domain expert consultant for THIS specific business.

Business: {user_prompt}

## APP NAMING
If the user mentions a business name (like "Joe's Pizza" or "FitLife Gym"), use that as the app_name.
Otherwise, create a catchy specific name (not generic like "Restaurant Management System").
Good: "Joe's Pizza Manager", "FitLife Pro", "Coastal Realty Hub"
Bad: "Restaurant Management System", "CRM Application", "Business Tool"

## Example of good planning
{THINKING_EXAMPLE}

Return ONLY a JSON object:
{{
  "app_name": "catchy name for the app based on the business",
  "business_type": "specific type (e.g. 'fine dining restaurant' not just 'restaurant')",
  "entities": [
    {{
      "name": "EntityName",
      "description": "what this entity represents",
      "key_fields": ["field1", "field2", "field3"],
      "relationships": ["links to EntityName2 via field_id"]
    }}
  ],
  "workflows": [{{"name": "Order Fulfillment", "steps": ["order_placed", "confirmed", "preparing", "ready", "delivered", "paid"]}}],
  "dashboard_kpis": ["metric 1", "metric 2", "metric 3"],
  "design_vibe": "describe the visual feel (e.g. 'warm and rustic' or 'clean and clinical')"
}}

Generate 4-8 entities. Think about:
- What data does this specific business ACTUALLY track daily?
- What are the core business processes (not generic CRUD)?
- What relationships exist between data?
- What KPIs does the owner care about?
{_industry_context}"""

    # Inject competitor context into plan prompt
    if _competitor_ctx:
        plan_prompt += f"\n\n## Competitor Reference\n{_competitor_ctx}"

    # Inject compliance context into plan prompt
    if _compliance_ctx:
        plan_prompt += f"\n\n## Required Compliance Fields\n{_compliance_ctx}"

    # Cross-spec pattern context
    try:
        from generator.cross_spec_analyzer import get_cross_spec_context
        _cross_ctx = get_cross_spec_context(user_prompt)
        if _cross_ctx:
            plan_prompt += f"\n\n{_cross_ctx}"
    except ImportError:
        pass

    # Inject multi-intent context into plan prompt
    intents = _parse_intents(user_prompt)
    if len(intents) > 1:
        plan_prompt += f"\n\nThe user wants MULTIPLE features: {', '.join(intents)}. Make sure ALL of these are covered with dedicated entities."

    try:
        plan_response = client.messages.create(
            model=PLAN_MODEL,
            max_tokens=2000,
            system="You are a business domain expert. Plan app architectures. Output ONLY valid JSON.",
            messages=[{"role": "user", "content": plan_prompt}],
        )
        plan_text = plan_response.content[0].text.strip()
        plan = _robust_json_parse(plan_text)
        if not isinstance(plan, dict):
            plan = {}
        logger.info("Pass 1 complete: %d entities planned", len(plan.get("entities", [])))
    except Exception as e:
        logger.warning("Pass 1 (plan) failed: %s — proceeding without plan", e)
        plan = {}

    # ── PASS 2: BUILD — generate full spec with plan context ────────────
    logger.info("Pass 2: Building full spec with plan context")

    plan_context = ""
    if plan:
        plan_context = f"""
## Architecture Plan (follow this structure)
Business type: {plan.get('business_type', 'unknown')}
Planned entities: {json.dumps(plan.get('entities', []), indent=2)}
Key workflows: {json.dumps(plan.get('workflows', []))}
Dashboard KPIs: {json.dumps(plan.get('dashboard_kpis', []))}
Design vibe: {plan.get('design_vibe', '')}

Follow this plan closely. Generate ALL planned entities with full field definitions.
"""

    messages: list[dict] = []
    if conversation_history:
        messages.extend(conversation_history)

    few_shot_section = ""
    if few_shot_example:
        few_shot_section = f"\n## Example spec for reference\n{few_shot_example}\n"

    user_message = f"""## User Request
{user_prompt}
{plan_context}
## Reference Patterns
{rag_context}
{few_shot_section}
## JSON Schema Template
{schema_reference}

Generate the COMPLETE JSON spec following the architecture plan above.
- Generate ALL planned entities with 8-12 fields each
- Include domain-specific fields (not just name/status/created_at)
- Include ALL field attributes (db_type, ts_type, nullable, editable, show_in_table, show_in_form, input_component, display_component)
- Include proper validation rules on fields (email, phone, required, min/max)
- Include FK relationships between connected entities
- Include ui_config, dashboard with planned KPIs, design_system
- Include _seed_data with 10-20 realistic sample records per entity with proper FK references
- Output ONLY the JSON object."""

    messages.append({"role": "user", "content": user_message})

    # Build pass with retry logic
    spec = None
    last_error = None
    raw_text = ""

    for attempt in range(1 + MAX_JSON_RETRIES):
        try:
            if attempt == 0:
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=_final_prompt,
                    messages=messages,
                )
            else:
                logger.warning("JSON parse attempt %d failed: %s — asking AI to fix", attempt, last_error)
                fix_messages = messages + [
                    {"role": "assistant", "content": raw_text},
                    {"role": "user", "content": f"Your JSON had an error: {last_error}\n\nOutput the COMPLETE corrected JSON spec. ONLY valid JSON."},
                ]
                response = client.messages.create(model=MODEL, max_tokens=64000, system=_final_prompt, messages=fix_messages)

            raw_text = response.content[0].text.strip()
            truncated = response.stop_reason == "max_tokens"
            if truncated:
                logger.warning("Response truncated at %d chars, attempting recovery", len(raw_text))
                raw_text = _handle_truncated_response(client, messages, raw_text)

            spec = _robust_json_parse(raw_text, truncated=truncated)
            if not isinstance(spec, dict):
                raise ValueError(f"AI returned {type(spec).__name__} instead of dict")
            break

        except (json.JSONDecodeError, ValueError) as e:
            last_error = str(e)
            if attempt >= MAX_JSON_RETRIES:
                logger.warning("All retries exhausted. Trying final recovery.")
                try:
                    recovery = client.messages.create(
                        model=MODEL, max_tokens=64000,
                        system="You are a JSON repair assistant. Output ONLY valid JSON.",
                        messages=[{"role": "user", "content": f"Fix this JSON:\n\n{raw_text[:2000]}\n\nReturn ONLY the valid JSON."}],
                    )
                    spec = _robust_json_parse(recovery.content[0].text.strip())
                    if isinstance(spec, dict):
                        break
                except Exception:
                    pass
                raise ValueError(f"AI returned invalid JSON after {MAX_JSON_RETRIES + 1} attempts: {last_error}")

    if spec is None:
        raise ValueError("Failed to generate spec — no valid JSON returned")

    logger.info("Pass 2 complete: %d entities generated", len(spec.get("entities", [])))

    # Validate and enforce format
    spec = _ensure_required_fields(spec)
    spec = _enforce_format(spec)
    _validate_spec(spec)

    # ── PASS 3: REVIEW — self-check and fix ─────────────────────────────
    logger.info("Pass 3: AI self-review")

    try:
        entity_names = [e.get("name", "?") for e in spec.get("entities", []) if isinstance(e, dict)]
        review_prompt = f"""Review this app spec for a "{plan.get('business_type', user_prompt[:50])}".

Entities: {', '.join(entity_names)}

Check for:
1. Missing FK relationships (e.g. Order should link to Customer)
2. Fields missing validation (email without email rule, phone without pattern, price without min:0)
3. Missing domain-specific fields (e.g. restaurant should have allergens, medical should have insurance)
4. Dashboard stat_cards not reflecting real KPIs
5. Many-to-many relationships that need junction tables (e.g. Student↔Course needs Enrollment)

Return ONLY a JSON object with fixes:
{{
  "add_relationships": [{{"entity": "Order", "field": "customer_id", "fk_entity": "Customer"}}],
  "add_validations": [{{"entity": "Lead", "field": "email", "validation": {{"rule": "email", "message": "Invalid email"}}}}],
  "add_fields": [{{"entity": "MenuItem", "field": "allergens", "db_type": "TEXT", "description": "comma-separated allergens"}}],
  "fix_dashboard": [{{"label": "Revenue This Month", "entity": "Order", "icon": "DollarSign", "color": "green"}}],
  "add_junction_tables": [{{"entity1": "Student", "entity2": "Course", "junction": "Enrollment", "extra_fields": ["grade", "semester"]}}]
}}

If everything looks good, return: {{"add_relationships": [], "add_validations": [], "add_fields": [], "fix_dashboard": [], "add_junction_tables": []}}"""

        review_response = client.messages.create(
            model=REVIEW_MODEL,
            max_tokens=4000,
            system="You are a QA reviewer for app specs. Find missing relationships, validations, and fields. Output ONLY JSON.",
            messages=[{"role": "user", "content": review_prompt}],
        )
        review_text = review_response.content[0].text.strip()
        fixes = _robust_json_parse(review_text)

        if isinstance(fixes, dict):
            _apply_review_fixes(spec, fixes)
            fix_count = sum(len(v) for v in fixes.values() if isinstance(v, list))
            logger.info("Pass 3 complete: applied %d fixes from review", fix_count)
    except Exception as e:
        logger.warning("Pass 3 (review) failed: %s — continuing without review fixes", e)

    # ── SMART DEFAULTS — auto-add validation and input types ────────────
    _apply_smart_defaults(spec)

    # ── QUALITY CHECK ───────────────────────────────────────────────────
    from .spec_validator import score_spec_quality
    quality = score_spec_quality(spec)
    logger.info(
        "Final quality score: %d/100 | Strengths: %s | Issues: %s",
        quality["score"],
        "; ".join(quality["strengths"][:3]),
        "; ".join(quality["issues"][:3]),
    )

    if quality["score"] < 60:
        logger.warning("Quality score %d < 60 — triggering re-generation", quality["score"])
        issue_guidance = "\n".join(f"- Fix: {issue}" for issue in quality["issues"])
        try:
            retry_response = client.messages.create(
                model=MODEL, max_tokens=64000, system=_final_prompt,
                messages=messages + [
                    {"role": "assistant", "content": raw_text},
                    {"role": "user", "content": f"Quality issues (score: {quality['score']}/100):\n{issue_guidance}\n\nRegenerate the COMPLETE JSON spec fixing ALL issues. Output ONLY JSON."},
                ],
            )
            retry_spec = _robust_json_parse(retry_response.content[0].text.strip())
            if isinstance(retry_spec, dict):
                retry_spec = _ensure_required_fields(retry_spec)
                retry_spec = _enforce_format(retry_spec)
                _validate_spec(retry_spec)
                _apply_smart_defaults(retry_spec)
                retry_quality = score_spec_quality(retry_spec)
                logger.info("Re-gen score: %d/100 (was %d)", retry_quality["score"], quality["score"])
                if retry_quality["score"] > quality["score"]:
                    spec = retry_spec
                    quality = retry_quality
        except Exception as e:
            logger.warning("Quality re-gen failed: %s — using original", e)

    # A/B Generation: if quality is borderline (60-75), generate a second spec and pick the better one
    AB_THRESHOLD = int(os.getenv("AB_QUALITY_THRESHOLD", "75"))
    if quality["score"] < AB_THRESHOLD and quality["score"] >= 60:
        logger.info("Quality score %d < %d — trying A/B generation for better result", quality["score"], AB_THRESHOLD)
        try:
            # Generate alternative with slightly different instruction
            ab_messages = messages.copy()
            ab_messages[-1] = {"role": "user", "content": ab_messages[-1]["content"] + "\n\nIMPORTANT: Generate a DIFFERENT approach than your first attempt. Use different entity names, more fields, and richer relationships."}
            ab_response = client.messages.create(model=MODEL, max_tokens=64000, system=_final_prompt, messages=ab_messages)
            ab_text = ab_response.content[0].text.strip()
            ab_spec = _robust_json_parse(ab_text)
            if isinstance(ab_spec, dict):
                ab_spec = _ensure_required_fields(ab_spec)
                ab_spec = _enforce_format(ab_spec)
                _validate_spec(ab_spec)
                _apply_smart_defaults(ab_spec)
                ab_quality = score_spec_quality(ab_spec)
                logger.info("A/B spec quality: %d vs original %d", ab_quality["score"], quality["score"])
                if ab_quality["score"] > quality["score"]:
                    spec = ab_spec
                    quality = ab_quality
                    logger.info("A/B winner: alternative spec (score %d)", ab_quality["score"])
        except Exception as e:
            logger.debug("A/B generation failed: %s", e)

    return spec


def _apply_spec_patch(spec: dict, patch: dict) -> None:
    """Apply a diff-based patch to an existing spec."""
    entities = spec.get("entities", [])
    entity_map = {e.get("name", ""): i for i, e in enumerate(entities) if isinstance(e, dict)}

    # Add new entities
    for new_entity in patch.get("add_entities", []):
        if isinstance(new_entity, dict) and new_entity.get("name"):
            entities.append(new_entity)
            # Add corresponding module
            modules = spec.get("modules", [])
            mod_name = new_entity["name"]
            if not any(m.get("entity") == mod_name for m in modules if isinstance(m, dict)):
                modules.append({
                    "name": mod_name,
                    "route": f"/{mod_name.lower().replace(' ', '-')}",
                    "component": "ResourcePage",
                    "layout": "sidebar",
                    "sidebar_order": len(modules) + 1,
                    "sidebar_icon": "FileText",
                    "entity": mod_name,
                })

    # Remove entities
    for name in patch.get("remove_entities", []):
        if name in entity_map:
            idx = entity_map[name]
            entities.pop(idx)
            # Also remove module
            modules = spec.get("modules", [])
            spec["modules"] = [m for m in modules if not (isinstance(m, dict) and m.get("entity") == name)]

    # Modify entities
    for entity_name, changes in patch.get("modify_entities", {}).items():
        if entity_name not in entity_map:
            continue
        entity = entities[entity_map[entity_name]]
        fields = entity.get("fields", [])

        # Add fields
        for new_field in changes.get("add_fields", []):
            if isinstance(new_field, dict) and new_field.get("name"):
                if not any(f.get("name") == new_field["name"] for f in fields if isinstance(f, dict)):
                    # Insert before system timestamp fields
                    idx = len(fields)
                    for i, f in enumerate(fields):
                        if isinstance(f, dict) and f.get("name") in ("created_at", "updated_at", "deleted_at", "version"):
                            idx = i
                            break
                    fields.insert(idx, new_field)

        # Remove fields
        for field_name in changes.get("remove_fields", []):
            entity["fields"] = [f for f in fields if not (isinstance(f, dict) and f.get("name") == field_name)]

        # Update fields
        for field_name, updates in changes.get("update_fields", {}).items():
            for field in entity.get("fields", []):
                if isinstance(field, dict) and field.get("name") == field_name:
                    field.update(updates)

    # Update design system
    design_update = patch.get("update_design", {})
    if design_update and isinstance(design_update, dict):
        ds = spec.get("design_system", {})
        for key, val in design_update.items():
            if isinstance(val, dict) and isinstance(ds.get(key), dict):
                ds[key].update(val)
            else:
                ds[key] = val

    # Update dashboard
    dash_update = patch.get("update_dashboard", {})
    if dash_update and isinstance(dash_update, dict):
        dashboard = spec.get("dashboard", {})
        for key, val in dash_update.items():
            dashboard[key] = val

    logger.info("Spec patch applied: +%d entities, -%d entities, %d modified",
                len(patch.get("add_entities", [])),
                len(patch.get("remove_entities", [])),
                len(patch.get("modify_entities", {})))


def _apply_review_fixes(spec: dict, fixes: dict) -> None:
    """Apply fixes from the AI review pass to the spec."""
    entities = spec.get("entities", [])
    entity_map = {e.get("name", ""): e for e in entities if isinstance(e, dict)}

    # Add missing FK relationships
    for rel in fixes.get("add_relationships", []):
        entity_name = rel.get("entity", "")
        if entity_name in entity_map:
            fields = entity_map[entity_name].get("fields", [])
            field_name = rel.get("field", "")
            # Don't add if field already exists
            if not any(f.get("name") == field_name for f in fields if isinstance(f, dict)):
                fields.append({
                    "name": field_name,
                    "db_type": "UUID",
                    "ts_type": "string",
                    "nullable": True,
                    "editable": True,
                    "show_in_table": False,
                    "show_in_form": True,
                    "input_component": None,
                    "display_component": None,
                    "fk_entity": rel.get("fk_entity", ""),
                })

    # Add missing validations
    for val in fixes.get("add_validations", []):
        entity_name = val.get("entity", "")
        if entity_name in entity_map:
            for field in entity_map[entity_name].get("fields", []):
                if isinstance(field, dict) and field.get("name") == val.get("field"):
                    if "validation" not in field or not field["validation"]:
                        field["validation"] = val.get("validation", {})

    # Add missing fields
    for new_field in fixes.get("add_fields", []):
        entity_name = new_field.get("entity", "")
        if entity_name in entity_map:
            fields = entity_map[entity_name].get("fields", [])
            field_name = new_field.get("field", "")
            if not any(f.get("name") == field_name for f in fields if isinstance(f, dict)):
                # Insert before system fields (created_at, etc.)
                insert_idx = len(fields)
                for i, f in enumerate(fields):
                    if isinstance(f, dict) and f.get("name") in ("created_at", "updated_at", "deleted_at", "version"):
                        insert_idx = i
                        break
                fields.insert(insert_idx, {
                    "name": field_name,
                    "db_type": new_field.get("db_type", "TEXT"),
                    "ts_type": "string",
                    "nullable": True,
                    "editable": True,
                    "show_in_table": True,
                    "show_in_form": True,
                    "input_component": "TextInput",
                    "display_component": "Text",
                })

    # Fix dashboard
    for card in fixes.get("fix_dashboard", []):
        if card and isinstance(card, dict) and card.get("label"):
            dashboard = spec.get("dashboard", {})
            stat_cards = dashboard.get("stat_cards", [])
            # Don't duplicate
            if not any(c.get("label") == card["label"] for c in stat_cards):
                stat_cards.append(card)

    # Add junction tables for many-to-many relationships
    for jt in fixes.get("add_junction_tables", []):
        if not isinstance(jt, dict) or not jt.get("junction"):
            continue
        # Check if junction entity already exists
        if jt["junction"] not in entity_map:
            new_entity = {
                "name": jt["junction"],
                "table": jt["junction"].lower() + "s",
                "description": f"Links {jt.get('entity1', '')} and {jt.get('entity2', '')}",
                "fields": [
                    {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
                    {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
                    {"name": f"{jt['entity1'].lower()}_id", "db_type": "UUID", "ts_type": "string", "nullable": False, "editable": True, "show_in_table": True, "show_in_form": True, "input_component": None, "display_component": None, "fk_entity": jt["entity1"]},
                    {"name": f"{jt['entity2'].lower()}_id", "db_type": "UUID", "ts_type": "string", "nullable": False, "editable": True, "show_in_table": True, "show_in_form": True, "input_component": None, "display_component": None, "fk_entity": jt["entity2"]},
                ],
            }
            # Add extra fields
            for extra in jt.get("extra_fields", []):
                new_entity["fields"].append({
                    "name": extra, "db_type": "VARCHAR(255)", "ts_type": "string",
                    "nullable": True, "editable": True, "show_in_table": True,
                    "show_in_form": True, "input_component": "TextInput", "display_component": "Text",
                })
            # Add system timestamp fields
            new_entity["fields"].extend([
                {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": True, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": True, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
                {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
            ])
            entities.append(new_entity)
            logger.info("Added junction entity '%s' linking %s and %s", jt["junction"], jt.get("entity1", ""), jt.get("entity2", ""))


def _apply_smart_defaults(spec: dict) -> None:
    """Auto-add validation rules and input types based on field names.

    This catches things Claude often forgets: email validation on email fields,
    phone patterns on phone fields, currency input on price fields, etc.
    """
    for entity in spec.get("entities", []):
        if not isinstance(entity, dict):
            continue
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            name = field.get("name", "").lower()
            db_type = field.get("db_type", "").upper()

            # Skip system fields
            if name in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
                continue

            # Email fields
            if name in ("email", "email_address", "contact_email", "customer_email"):
                field.setdefault("input_component", "EmailInput")
                field.setdefault("display_component", "Email")
                if not field.get("validation"):
                    field["validation"] = {"rule": "email", "message": "Please enter a valid email"}

            # Phone fields
            elif "phone" in name or "tel" in name or "mobile" in name:
                field.setdefault("input_component", "PhoneInput")
                field.setdefault("display_component", "Phone")
                if not field.get("validation"):
                    field["validation"] = {"rule": "pattern", "value": "^[+]?[0-9\\s\\-().]{7,20}$", "message": "Enter a valid phone number"}

            # Price/money fields
            elif any(w in name for w in ("price", "cost", "amount", "rate", "fee", "salary", "wage", "revenue", "budget", "total", "subtotal", "tax")):
                field.setdefault("input_component", "CurrencyInput")
                field.setdefault("display_component", "Currency")
                if not field.get("validation"):
                    field["validation"] = {"rule": "min", "value": 0, "message": "Must be a positive value"}

            # URL fields
            elif any(w in name for w in ("url", "website", "link", "href")):
                field.setdefault("input_component", "TextInput")
                field.setdefault("display_component", "Link")
                if not field.get("validation"):
                    field["validation"] = {"rule": "url", "message": "Enter a valid URL"}

            # Date fields (not timestamps)
            elif "DATE" in db_type and "TIMESTAMP" not in db_type:
                field.setdefault("input_component", "DatePicker")
                field.setdefault("display_component", "Date")

            # Boolean fields
            elif "BOOLEAN" in db_type or "BOOL" in db_type:
                field.setdefault("input_component", "Toggle")

            # Required fields without validation
            if not field.get("nullable", True) and not field.get("validation"):
                field["validation"] = {"rule": "required", "message": f"{field.get('name', 'Field')} is required"}

            # ── Conditional visibility: delivery_address only when order_type = delivery ──
            if name in ("delivery_address", "shipping_address", "delivery_notes", "tracking_number"):
                for other_field in entity.get("fields", []):
                    if isinstance(other_field, dict) and other_field.get("name") in ("order_type", "shipping_method"):
                        field.setdefault("visible_when", {
                            "field": other_field["name"],
                            "operator": "in",
                            "value": ["delivery", "shipped", "shipping"]
                        })
                        break

            # ── Conditional: payment fields only when status = completed/paid ──
            if name in ("payment_method", "payment_date", "payment_reference", "receipt_number"):
                field.setdefault("visible_when", {
                    "field": "status",
                    "operator": "in",
                    "value": ["completed", "paid", "closed"]
                })

            # ── Smart default values ──
            if "status" in name and field.get("enum_values"):
                enums = field["enum_values"]
                if enums and not field.get("default"):
                    field["default"] = enums[0]  # Default to first status

            if name in ("is_active", "is_enabled", "is_visible", "is_published"):
                field.setdefault("default", True)

            if "date" in name.lower() and "birth" not in name.lower() and "expir" not in name.lower():
                if "created" in name or "start" in name or "joined" in name or "registered" in name:
                    field.setdefault("auto_set", "NOW")

            # ── Search configuration: make key fields searchable/filterable ──
            if name in ("name", "title", "first_name", "last_name", "email", "phone",
                        "customer_name", "company", "description"):
                field.setdefault("filterable", True)
                field.setdefault("sortable", True)

            # Make status and type fields filterable
            if field.get("enum_values"):
                field.setdefault("filterable", True)
                field.setdefault("filter_type", "select")

    # ── Entity validation: check FK integrity ──
    entity_names = {e.get("name", "") for e in spec.get("entities", []) if isinstance(e, dict)}
    for entity in spec.get("entities", []):
        if not isinstance(entity, dict):
            continue
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            fk = field.get("fk_entity", "")
            if fk and fk not in entity_names:
                logger.warning("FK '%s' in %s.%s points to non-existent entity — removing fk_entity",
                               fk, entity.get("name"), field.get("name"))
                field.pop("fk_entity", None)

    # ── Field deduplication: remove duplicate field names within each entity ──
    for entity in spec.get("entities", []):
        if not isinstance(entity, dict):
            continue
        seen = set()
        unique_fields = []
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            name = field.get("name", "")
            if name in seen:
                logger.warning("Duplicate field '%s' in %s — removing", name, entity.get("name"))
                continue
            seen.add(name)
            unique_fields.append(field)
        entity["fields"] = unique_fields

    # ── Add computed fields where obvious ──
    for entity in spec.get("entities", []):
        if not isinstance(entity, dict):
            continue
        field_names = {f.get("name", "") for f in entity.get("fields", []) if isinstance(f, dict)}

        # total_price = quantity * unit_price
        if "quantity" in field_names and "unit_price" in field_names and "total_price" not in field_names:
            # Insert before system fields
            fields = entity["fields"]
            idx = len(fields)
            for i, f in enumerate(fields):
                if isinstance(f, dict) and f.get("name") in ("created_at", "updated_at", "deleted_at", "version"):
                    idx = i
                    break
            fields.insert(idx, {
                "name": "total_price", "db_type": "NUMERIC(12,2)", "ts_type": "number",
                "nullable": False, "editable": False, "show_in_table": True, "show_in_form": False,
                "input_component": None, "display_component": "Currency",
                "computed": "quantity * unit_price",
            })
            logger.info("Added computed field total_price to %s", entity.get("name"))

    # ── Column ordering: ensure most important fields first ──
    for entity in spec.get("entities", []):
        if isinstance(entity, dict):
            _enforce_column_ordering(entity)

    # ── Index suggestions for frequently filtered fields ──
    for entity in spec.get("entities", []):
        if not isinstance(entity, dict):
            continue
        indexes = entity.get("indexes", [])
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            fname = field.get("name", "")
            if fname in ("status", "type", "category") or field.get("enum_values"):
                idx = f"idx_{entity.get('table', '')}_{fname}"
                if idx not in indexes:
                    indexes.append(idx)
            if "date" in fname.lower() or "TIMESTAMP" in field.get("db_type", ""):
                idx = f"idx_{entity.get('table', '')}_{fname}"
                if idx not in indexes:
                    indexes.append(idx)
        entity["indexes"] = indexes

    logger.info("Smart defaults, validation, deduplication applied")


def _enforce_column_ordering(entity):
    """Ensure most important fields are first in list_view columns."""
    ui = entity.get("ui_config", {})
    lv = ui.get("list_view", {})
    columns = lv.get("columns", [])
    if not columns:
        return

    # Priority order: name/title first, then status, then key fields, then dates last
    priority = {"name": 0, "title": 0, "first_name": 0, "customer_name": 0,
                "status": 1, "order_status": 1, "type": 2, "category": 2,
                "email": 3, "phone": 3, "amount": 4, "price": 4, "total": 4,
                "created_at": 99, "updated_at": 99}

    columns.sort(key=lambda c: priority.get(c, 50))
    lv["columns"] = columns


async def refine_spec(
    current_spec: dict,
    user_feedback: str,
) -> dict:
    """
    Refine an existing spec based on user feedback using diff-based approach.

    Instead of regenerating the entire spec (slow, risky), we ask Claude to
    return ONLY the changes as a patch, then merge them into the existing spec.
    Falls back to full regeneration for complex changes.
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # First try diff-based approach (faster, safer)
    entity_summary = []
    for e in current_spec.get("entities", []):
        if isinstance(e, dict):
            fields = [f.get("name", "") for f in e.get("fields", []) if isinstance(f, dict) and f.get("name") not in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version")]
            entity_summary.append(f"  - {e.get('name')}: {', '.join(fields)}")

    diff_prompt = f"""Current app: {current_spec.get('app_name', 'App')}
Current entities:
{chr(10).join(entity_summary)}

User wants: {user_feedback}

Return ONLY a JSON patch describing what to change:
{{
  "add_entities": [{{full entity objects to add}}],
  "remove_entities": ["EntityName"],
  "modify_entities": {{
    "EntityName": {{
      "add_fields": [{{field objects}}],
      "remove_fields": ["field_name"],
      "update_fields": {{"field_name": {{partial field update}}}}
    }}
  }},
  "update_design": {{partial design_system update}},
  "update_dashboard": {{partial dashboard update}},
  "reply": "Brief description of what was changed"
}}

Only include sections that need changes. If adding a new entity, include full entity with all fields."""

    try:
        diff_response = client.messages.create(
            model=REVIEW_MODEL,
            max_tokens=16000,
            system="You are a spec editor. Apply user changes as minimal JSON patches. Output ONLY valid JSON.",
            messages=[{"role": "user", "content": diff_prompt}],
        )
        diff_text = diff_response.content[0].text.strip()
        patch = _robust_json_parse(diff_text)

        if isinstance(patch, dict) and any(patch.get(k) for k in ("add_entities", "remove_entities", "modify_entities", "update_design", "update_dashboard")):
            # Apply the patch
            _apply_spec_patch(current_spec, patch)
            current_spec = _ensure_required_fields(current_spec)
            current_spec = _enforce_format(current_spec)
            _validate_spec(current_spec)
            _apply_smart_defaults(current_spec)
            logger.info("Spec refined via diff patch — changes applied successfully")
            # Store the reply for the frontend
            current_spec["_refine_reply"] = patch.get("reply", "Changes applied!")
            return current_spec
    except Exception as e:
        logger.warning("Diff-based refine failed: %s — falling back to full regeneration", e)

    # Fallback: full spec regeneration (original approach)
    messages = [
        {
            "role": "user",
            "content": (
                "Here is the current spec:\n\n"
                f"```json\n{json.dumps(current_spec, indent=2)}\n```\n\n"
                f"User wants to change/add: {user_feedback}\n\n"
                "Output the COMPLETE updated JSON spec with the changes applied. "
                "Keep ALL existing entities and their full field definitions. "
                "Output ONLY the JSON object, no explanation."
            ),
        }
    ]

    last_error = None
    spec = None
    raw_text = ""

    for attempt in range(1 + MAX_JSON_RETRIES):
        try:
            if attempt == 0:
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                )
            else:
                fix_messages = messages + [
                    {"role": "assistant", "content": raw_text},
                    {
                        "role": "user",
                        "content": (
                            f"Your JSON output had an error: {last_error}\n\n"
                            "Please output the COMPLETE corrected JSON spec. "
                            "Output ONLY valid JSON — no markdown, no explanation."
                        ),
                    },
                ]
                response = client.messages.create(
                    model=MODEL,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    messages=fix_messages,
                )

            raw_text = response.content[0].text.strip()
            truncated = response.stop_reason == "max_tokens"

            # Handle truncation with continuation calls
            if truncated:
                logger.warning(
                    "Refine response truncated at %d chars (stop_reason=max_tokens), attempting recovery",
                    len(raw_text),
                )
                raw_text = _handle_truncated_response(client, messages, raw_text)

            spec = _robust_json_parse(raw_text, truncated=truncated)
            if not isinstance(spec, dict):
                raise ValueError(f"Expected dict, got {type(spec).__name__}")
            break

        except (json.JSONDecodeError, ValueError) as e:
            last_error = str(e)
            if attempt >= MAX_JSON_RETRIES:
                # Last resort recovery call
                try:
                    recovery_response = client.messages.create(
                        model=MODEL,
                        max_tokens=64000,
                        system="You are a JSON repair assistant. Output ONLY valid JSON, nothing else.",
                        messages=[{
                            "role": "user",
                            "content": (
                                "Your previous response was not valid JSON. "
                                f"Here's what you returned:\n\n{raw_text[:2000]}\n\n"
                                "Please return ONLY the valid JSON spec, nothing else."
                            ),
                        }],
                    )
                    recovery_text = recovery_response.content[0].text.strip()
                    spec = _robust_json_parse(recovery_text)
                    if isinstance(spec, dict):
                        break
                except Exception:
                    pass
                raise ValueError(f"Refinement returned invalid JSON after retries: {last_error}")

    if spec is None:
        raise ValueError("Failed to refine spec — no valid JSON returned")

    spec = _ensure_required_fields(spec)
    spec = _enforce_format(spec)
    _validate_spec(spec)
    return spec


# ── Helpers ─────────────────────────────────────────────────────────

def _handle_truncated_response(
    client: "anthropic.Anthropic",
    messages: list[dict],
    raw_text: str,
    max_continuations: int = 2,
) -> str:
    """
    Handle truncated API responses by making follow-up calls to continue generation.

    If the response was cut off mid-JSON, asks Claude to continue from where it
    left off. Concatenates the continuation to the original text and returns the
    combined result. Tries up to max_continuations follow-up calls.
    """
    combined = raw_text

    for i in range(max_continuations):
        # Check if it looks like complete JSON already
        stripped = _strip_code_fences(combined)
        first_brace = stripped.find("{")
        if first_brace >= 0:
            # Count open/close braces outside strings
            try:
                json.loads(stripped[first_brace:])
                # If it parses, no continuation needed
                return combined
            except (json.JSONDecodeError, ValueError):
                pass

        # Get the last 500 chars as context for continuation
        tail_context = combined[-500:]
        logger.info(
            "Response truncated (continuation %d/%d) — requesting continuation",
            i + 1, max_continuations,
        )

        try:
            continuation_messages = messages + [
                {"role": "assistant", "content": combined},
                {
                    "role": "user",
                    "content": (
                        "Your JSON output was truncated. Continue EXACTLY from where "
                        "you left off. Do NOT repeat any previous content. Do NOT add "
                        "any explanation. Just continue the JSON output.\n\n"
                        f"Last 500 characters of your output:\n{tail_context}"
                    ),
                },
            ]
            cont_response = client.messages.create(
                model=MODEL,
                max_tokens=64000,
                system="You are continuing a truncated JSON output. Output ONLY the continuation of the JSON, nothing else. Do NOT repeat content that was already generated.",
                messages=continuation_messages,
            )
            cont_text = cont_response.content[0].text.strip()
            if not cont_text:
                break

            combined += cont_text
            logger.info("Continuation %d added %d chars", i + 1, len(cont_text))

            # If this continuation wasn't truncated, we're done
            if cont_response.stop_reason != "max_tokens":
                break

        except Exception as e:
            logger.warning("Continuation call %d failed: %s", i + 1, e)
            break

    return combined


def _robust_json_parse(text: str, truncated: bool = False) -> dict:
    """
    Bulletproof JSON parsing with multiple recovery strategies.

    Steps:
      1. Try parsing as-is
      2. Strip markdown code fences and retry
      3. Find first '{' and last '}' and parse that substring
      4. Fix common JSON errors (trailing commas, single quotes, unquoted keys)
      5. If truncated, attempt structural repair (close open braces/brackets)

    Returns a parsed dict or raises ValueError/JSONDecodeError.
    """
    # Step 1: Try parsing as-is
    try:
        result = json.loads(text)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Step 2: Strip markdown code fences
    stripped = _strip_code_fences(text)
    try:
        result = json.loads(stripped)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Step 3: Find the first '{' and last '}' and parse that substring
    first_brace = stripped.find("{")
    last_brace = stripped.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        substr = stripped[first_brace:last_brace + 1]
        try:
            result = json.loads(substr)
            if isinstance(result, str):
                result = json.loads(result)
            return result
        except (json.JSONDecodeError, ValueError):
            pass

        # Step 4: Fix common JSON errors on the substring
        fixed = _fix_common_json_errors(substr)
        try:
            result = json.loads(fixed)
            if isinstance(result, str):
                result = json.loads(result)
            return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Step 5: If truncated or all above failed, try structural repair
    candidate = stripped if first_brace < 0 else stripped[first_brace:]
    repaired = _attempt_json_repair(candidate)
    repaired = _fix_common_json_errors(repaired)
    try:
        result = json.loads(repaired)
        if isinstance(result, str):
            result = json.loads(result)
        return result
    except (json.JSONDecodeError, ValueError):
        pass

    # All recovery steps failed — raise with context
    raise json.JSONDecodeError(
        f"All JSON recovery steps failed. First 200 chars: {text[:200]}",
        text, 0
    )


def _fix_common_json_errors(text: str) -> str:
    """
    Fix common JSON errors that the AI might produce:
    - Trailing commas before } or ]
    - Single quotes instead of double quotes (outside of values)
    - Unquoted keys
    - JavaScript-style comments (// ...)
    """
    # Remove single-line comments (// ...)
    text = re.sub(r'//[^\n]*', '', text)

    # Remove trailing commas before } or ]
    text = re.sub(r',\s*([}\]])', r'\1', text)

    # Replace single quotes with double quotes (careful with apostrophes in values)
    # Only do this if there are no double quotes at all (AI used all single quotes)
    if "'" in text and text.count('"') < text.count("'") // 2:
        # Heuristic: if single quotes outnumber double quotes by a lot,
        # the AI probably used single quotes for JSON strings
        text = text.replace("'", '"')

    # Fix unquoted keys: word: -> "word":
    # Match start-of-line or after { or , followed by whitespace then a bare word then :
    text = re.sub(r'(?<=[\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r' "\1":', text)

    return text


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences from AI output."""
    text = text.strip()

    # Handle ```json ... ``` or ``` ... ```
    if text.startswith("```"):
        # Remove opening fence (possibly with language tag)
        first_newline = text.find("\n")
        if first_newline >= 0:
            text = text[first_newline + 1:]
        else:
            text = text[3:]

    if text.endswith("```"):
        text = text[:-3]

    return text.strip()


def _attempt_json_repair(text: str) -> str:
    """Try to close truncated JSON so it parses."""
    # Count open braces/brackets
    in_string = False
    escape = False
    stack = []
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            stack.append('}')
        elif ch == '[':
            stack.append(']')
        elif ch in ('}', ']') and stack:
            stack.pop()

    # If we're inside a string, close it
    if in_string:
        text += '"'

    # Close remaining open structures
    while stack:
        text += stack.pop()

    return text


def _enforce_format(spec: dict) -> dict:
    """
    Post-generation format enforcer. Validates and repairs the spec structure,
    logging every fix so we can track AI reliability over time.
    """
    fixes: list[str] = []

    # 1. Ensure every entity has name, table, fields[], ui_config
    for i, ent in enumerate(spec.get("entities", [])):
        if not isinstance(ent, dict):
            continue
        ent_name = ent.get("name", f"Entity_{i}")
        if "name" not in ent:
            ent["name"] = f"Entity_{i}"
            fixes.append(f"Entity {i}: added missing 'name'")
        if "table" not in ent:
            ent["table"] = re.sub(r"(?<!^)(?=[A-Z])", "_", ent["name"]).lower() + "s"
            fixes.append(f"{ent_name}: generated missing 'table'")
        if "fields" not in ent or not isinstance(ent["fields"], list):
            ent["fields"] = []
            fixes.append(f"{ent_name}: added missing 'fields' array")
        if "ui_config" not in ent or not isinstance(ent["ui_config"], dict):
            fixes.append(f"{ent_name}: will generate missing 'ui_config'")
            # _ensure_entity_completeness will handle this

        # 2. Ensure every field has ALL 10 required attributes
        required_attrs = {
            "db_type": "TEXT",
            "ts_type": "string",
            "nullable": True,
            "editable": True,
            "show_in_table": True,
            "show_in_form": True,
            "input_component": "TextInput",
            "display_component": "Text",
        }
        for field in ent.get("fields", []):
            if not isinstance(field, dict) or not field.get("name"):
                continue
            fname = field["name"]
            # Skip system fields
            if fname in ("id", "org_id", "created_at", "updated_at", "deleted_at", "version"):
                continue
            for attr, default in required_attrs.items():
                if attr not in field:
                    field[attr] = default
                    fixes.append(f"{ent_name}.{fname}: added missing '{attr}' = {default}")

            # 3. Ensure every enum field has badge_colors
            if field.get("enum_values") and not field.get("badge_colors"):
                color_cycle = ["blue", "green", "amber", "red", "purple", "indigo", "slate", "emerald", "rose", "cyan"]
                field["badge_colors"] = {
                    val: color_cycle[j % len(color_cycle)]
                    for j, val in enumerate(field["enum_values"])
                }
                fixes.append(f"{ent_name}.{fname}: generated missing 'badge_colors'")

            # Ensure enum fields use Badge display
            if field.get("enum_values") and field.get("display_component") == "Text":
                field["display_component"] = "Badge"
                fixes.append(f"{ent_name}.{fname}: corrected display_component to 'Badge'")

            if field.get("enum_values") and field.get("input_component") == "TextInput":
                field["input_component"] = "Select"
                fixes.append(f"{ent_name}.{fname}: corrected input_component to 'Select'")

    # 4. Ensure modules[] exists with Dashboard + one per entity
    modules = spec.get("modules", [])
    if not isinstance(modules, list):
        modules = []
        spec["modules"] = modules
    has_dashboard = any(
        isinstance(m, dict) and m.get("name", "").lower() == "dashboard"
        for m in modules
    )
    if not has_dashboard:
        modules.insert(0, {
            "name": "Dashboard", "route": "/", "component": "DashboardPage",
            "layout": "sidebar", "sidebar_order": 1, "sidebar_icon": "BarChart3", "entity": None,
        })
        fixes.append("Added missing Dashboard module")

    entity_names = {ent.get("name") for ent in spec.get("entities", []) if isinstance(ent, dict)}
    module_entities = {m.get("entity") for m in modules if isinstance(m, dict)}
    for ent_name in entity_names:
        if ent_name and ent_name not in module_entities:
            ent_dict = next((e for e in spec["entities"] if isinstance(e, dict) and e.get("name") == ent_name), None)
            table = ent_dict.get("table", ent_name.lower() + "s") if ent_dict else ent_name.lower() + "s"
            modules.append({
                "name": f"{ent_name}s" if not ent_name.endswith("s") else ent_name,
                "route": f"/{table}",
                "component": "ResourcePage",
                "layout": "sidebar",
                "sidebar_order": len(modules) + 1,
                "sidebar_icon": "Box",
                "entity": ent_name,
            })
            fixes.append(f"Added missing module for entity '{ent_name}'")

    # 5. Ensure design_system has complete color scheme
    ds = spec.get("design_system", {})
    if not isinstance(ds, dict):
        ds = {}
        spec["design_system"] = ds
    ds_defaults = {
        "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
        "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
        "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
        "table": {"striped": False, "hover": True},
        "typography": {"font": "Inter"},
    }
    for key, default in ds_defaults.items():
        if key not in ds:
            ds[key] = default
            fixes.append(f"design_system: added missing '{key}'")
        elif isinstance(default, dict) and isinstance(ds[key], dict):
            for sub_key, sub_val in default.items():
                if sub_key not in ds[key]:
                    ds[key][sub_key] = sub_val
                    fixes.append(f"design_system.{key}: added missing '{sub_key}'")

    # Log all fixes
    if fixes:
        logger.warning(
            "Format enforcer applied %d fixes:\n  %s",
            len(fixes), "\n  ".join(fixes)
        )
    else:
        logger.info("Format enforcer: spec passed all checks — no fixes needed")

    return spec


def _ensure_required_fields(spec: dict) -> dict:
    """
    Auto-fill missing required top-level fields with smart defaults
    instead of crashing.
    """
    # Ensure app_name
    if "app_name" not in spec:
        meta = spec.get("_meta", {})
        if isinstance(meta, dict) and meta.get("app_name"):
            spec["app_name"] = meta["app_name"]
        else:
            spec["app_name"] = "My App"

    # Ensure entities is a list
    if "entities" not in spec or not isinstance(spec["entities"], list):
        spec["entities"] = []

    # Ensure modules exist
    if "modules" not in spec or not isinstance(spec["modules"], list):
        spec["modules"] = _generate_default_modules(spec.get("entities", []))

    # Ensure dashboard
    if "dashboard" not in spec or not isinstance(spec["dashboard"], dict):
        spec["dashboard"] = _generate_default_dashboard(spec.get("entities", []))
    elif "stat_cards" not in spec["dashboard"]:
        spec["dashboard"]["stat_cards"] = _generate_default_stat_cards(spec.get("entities", []))

    # Ensure design_system
    if "design_system" not in spec or not isinstance(spec["design_system"], dict):
        spec["design_system"] = {
            "colors": {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"},
            "spacing": {"page_padding": "24px", "card_padding": "16px", "gap": "16px"},
            "buttons": {"primary_bg": "blue-600", "primary_text": "white"},
            "table": {"striped": False, "hover": True},
            "typography": {"font": "Inter"},
        }
    else:
        ds = spec["design_system"]
        ds.setdefault("colors", {"primary": "#2563eb", "secondary": "#64748b", "sidebar_bg": "#0f172a", "sidebar_text": "#e2e8f0"})
        ds.setdefault("spacing", {"page_padding": "24px"})
        ds.setdefault("buttons", {"primary_bg": "blue-600"})
        ds.setdefault("table", {"hover": True})
        ds.setdefault("typography", {"font": "Inter"})

    # Ensure pagination
    if "pagination" not in spec or not isinstance(spec["pagination"], dict):
        spec["pagination"] = {"type": "cursor", "default_page_size": 25}

    # Ensure each entity has ui_config and system fields
    for ent in spec.get("entities", []):
        if not isinstance(ent, dict):
            continue
        _ensure_entity_completeness(ent)

    # Ensure Dashboard module exists
    modules = spec.get("modules", [])
    has_dashboard = any(
        isinstance(m, dict) and m.get("name", "").lower() == "dashboard"
        for m in modules
    )
    if not has_dashboard:
        modules.insert(0, {
            "name": "Dashboard",
            "route": "/",
            "component": "DashboardPage",
            "layout": "sidebar",
            "sidebar_order": 1,
            "sidebar_icon": "BarChart3",
            "entity": None,
        })

    return spec


def _ensure_entity_completeness(ent: dict) -> None:
    """Ensure an entity has all required structural elements."""
    if "fields" not in ent or not isinstance(ent["fields"], list):
        ent["fields"] = []

    # Ensure system fields exist
    field_names = {f.get("name") for f in ent["fields"] if isinstance(f, dict)}
    system_fields = [
        {"name": "id", "db_type": "UUID DEFAULT gen_random_uuid() PRIMARY KEY", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
        {"name": "org_id", "db_type": "UUID NOT NULL", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
        {"name": "created_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": True, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "updated_at", "db_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "ts_type": "string", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "deleted_at", "db_type": "TIMESTAMPTZ", "ts_type": "string", "nullable": True, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Date"},
        {"name": "version", "db_type": "INTEGER NOT NULL DEFAULT 1", "ts_type": "number", "nullable": False, "editable": False, "show_in_table": False, "show_in_form": False, "input_component": "none", "display_component": "Text"},
    ]

    for sf in system_fields:
        if sf["name"] not in field_names:
            if sf["name"] in ("id", "org_id"):
                ent["fields"].insert(0, sf)
            else:
                ent["fields"].append(sf)

    # Ensure every field has required attributes
    for f in ent["fields"]:
        if not isinstance(f, dict):
            continue
        f.setdefault("db_type", "TEXT")
        f.setdefault("ts_type", "string")
        f.setdefault("nullable", True)
        f.setdefault("editable", True)
        f.setdefault("show_in_table", True)
        f.setdefault("show_in_form", True)
        f.setdefault("input_component", "TextInput")
        f.setdefault("display_component", "Text")

    # Ensure ui_config
    if "ui_config" not in ent or not isinstance(ent["ui_config"], dict):
        form_fields = [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("show_in_form")]
        table_fields = [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("show_in_table")]
        name = ent.get("name", "Item")
        table = ent.get("table", "items")

        ent["ui_config"] = {
            "list_view": {
                "layout": "table",
                "columns": table_fields[:6],
                "empty_state": {
                    "icon": "Box",
                    "heading": f"No {table.replace('_', ' ')} yet",
                    "subtext": f"Create your first {name.lower()}",
                    "action_label": f"Add {name}",
                },
            },
            "create_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": form_fields[:1],
            },
            "edit_form": {
                "type": "SlideOverForm",
                "field_order": form_fields,
                "required_fields": form_fields[:1],
                "prefilled": True,
            },
            "detail_view": {
                "route": f"/{table}/:id",
                "layout": "tabbed",
                "header": {
                    "title_fields": table_fields[:1],
                    "badge_fields": [f["name"] for f in ent["fields"] if isinstance(f, dict) and f.get("enum_values")][:1],
                },
                "primary_fields": table_fields[:5],
            },
        }

    # Ensure table name
    if "table" not in ent and "name" in ent:
        ent["table"] = re.sub(r"(?<!^)(?=[A-Z])", "_", ent["name"]).lower() + "s"

    # Ensure description
    ent.setdefault("description", f"{ent.get('name', 'Entity')} management")


def _generate_default_modules(entities: list) -> list[dict]:
    """Generate default modules from entities."""
    modules = [{
        "name": "Dashboard",
        "route": "/",
        "component": "DashboardPage",
        "layout": "sidebar",
        "sidebar_order": 1,
        "sidebar_icon": "BarChart3",
        "entity": None,
    }]

    icon_map = {
        "user": "Users", "contact": "Users", "customer": "Users", "person": "Users", "people": "Users",
        "deal": "Briefcase", "order": "ShoppingCart", "product": "Package", "item": "Package",
        "task": "CheckCircle", "project": "Layers", "invoice": "FileText", "payment": "CreditCard",
        "message": "MessageSquare", "notification": "Bell", "setting": "Settings",
        "lead": "Target", "ticket": "ClipboardList", "event": "CalendarDays",
    }

    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Module")
        table = ent.get("table", name.lower() + "s")
        icon = icon_map.get(name.lower(), "Box")
        modules.append({
            "name": f"{name}s" if not name.endswith("s") else name,
            "route": f"/{table}",
            "component": "ResourcePage",
            "layout": "sidebar",
            "sidebar_order": i + 2,
            "sidebar_icon": icon,
            "entity": name,
        })

    return modules


def _generate_default_dashboard(entities: list) -> dict:
    """Generate default dashboard from entities."""
    return {"stat_cards": _generate_default_stat_cards(entities)}


def _generate_default_stat_cards(entities: list) -> list[dict]:
    """Generate stat cards for each entity."""
    cards = []
    colors = ["blue", "green", "purple", "amber", "indigo", "rose"]
    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            continue
        name = ent.get("name", "Item")
        cards.append({
            "label": f"Total {name}s" if not name.endswith("s") else f"Total {name}",
            "entity": name,
            "aggregate": "count",
            "icon": "Box",
            "color": colors[i % len(colors)],
        })
    return cards[:6]


def _validate_spec(spec: dict) -> None:
    """Basic structural validation of a generated spec."""
    if "entities" not in spec or not isinstance(spec["entities"], list):
        raise ValueError("Spec must contain 'entities' array")

    if len(spec["entities"]) == 0:
        raise ValueError("Spec must have at least one entity")

    for ent in spec["entities"]:
        if not isinstance(ent, dict):
            continue
        if "name" not in ent:
            raise ValueError(f"Entity missing 'name': {ent}")
        if "table" not in ent:
            raise ValueError(f"Entity '{ent.get('name')}' missing 'table'")
        if "fields" not in ent or not isinstance(ent["fields"], list):
            raise ValueError(f"Entity '{ent['name']}' missing 'fields' array")

    if "modules" not in spec or not isinstance(spec["modules"], list):
        raise ValueError("Spec must contain 'modules' array")
