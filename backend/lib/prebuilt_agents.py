"""
Pre-built agent templates that users can activate with one tap.
Each template comes with a name, role, instructions, and auto-configured triggers.
"""

PREBUILT_AGENTS = {
    "bill_catcher": {
        "name": "Bill Catcher",
        "role": "Invoice & bill processing assistant",
        "icon": "receipt",
        "color": "#2563eb",
        "description": "Automatically catches invoices and bills from your email. Extracts amounts, due dates, and vendor info. Keeps a running log of everything.",
        "requires": ["email"],
        "instructions": (
            "You are Bill Catcher, an AI accounts payable assistant. "
            "Your job is to watch the user's email for invoices, bills, receipts, and payment requests.\n\n"
            "When you detect an invoice or bill email:\n"
            "1. Extract: vendor name, invoice number, amount, due date, line items if visible\n"
            "2. Summarize it in a clean, scannable format\n"
            "3. Flag if it's urgent (due within 7 days) or overdue\n"
            "4. Note if it has attachments (PDF invoice, etc.)\n\n"
            "Format your response like this:\n"
            "HEADLINE: [Vendor] — $[amount] due [date]\n"
            "BODY:\n"
            "💰 Invoice from [Vendor]\n"
            "• Amount: $X,XXX.XX\n"
            "• Invoice #: XXXX\n"
            "• Due: [date] [⚠️ URGENT if <7 days]\n"
            "• Items: [brief summary of line items]\n"
            "• Status: New / Overdue / Due Soon\n\n"
            "If the email is NOT an invoice or bill (just a marketing email, newsletter, etc.), "
            "respond with:\n"
            "HEADLINE: skip\n"
            "BODY: skip\n\n"
            "Be precise with dollar amounts. Never guess — if you can't find the amount, say 'Amount not specified'."
        ),
        "triggers": [
            {"kind": "email_keyword", "subject_keyword": "invoice", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "bill", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "payment due", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "amount due", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "balance due", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "receipt", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "statement", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "billing", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "past due", "actions": ["extract_invoice"]},
            {"kind": "email_keyword", "subject_keyword": "overdue", "actions": ["extract_invoice"]},
        ],
    },
}


def get_prebuilt_agent(template_id: str) -> dict | None:
    return PREBUILT_AGENTS.get(template_id)


def list_prebuilt_agents() -> list[dict]:
    result = []
    for tid, agent in PREBUILT_AGENTS.items():
        result.append({
            "id": tid,
            "name": agent["name"],
            "role": agent["role"],
            "icon": agent.get("icon", "flash"),
            "color": agent.get("color", "#ec4899"),
            "description": agent["description"],
            "requires": agent.get("requires", []),
        })
    return result
