"""
GoFarther AI — Universal App Connector System

Routes:
  GET  /ghost/connectors              — list all available apps + connection status
  POST /ghost/connectors/{app_id}/connect    — save API key / credentials
  DELETE /ghost/connectors/{app_id}/disconnect — remove credentials
  POST /ghost/connectors/{app_id}/action     — execute an action on a connected app
"""

from __future__ import annotations

import logging
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import Column, String, Text, DateTime, select, and_
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db, Base

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/connectors", tags=["ghost-connectors"])


# ── Auth helper ──────────────────────────────────────────────────────────────

def _verify_auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "")
    return verify_ghost_token(token)


# ── Encrypted credential storage (DB-backed) ────────────────────────────────

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None  # type: ignore

_CONNECTOR_KEY = os.getenv("CONNECTOR_ENCRYPTION_KEY") or ""
if not _CONNECTOR_KEY and os.getenv("SMTP_ENCRYPTION_KEY", ""):
    logging.getLogger(__name__).warning("CONNECTOR_ENCRYPTION_KEY not set — falling back to SMTP_ENCRYPTION_KEY (set a separate key in production)")
    _CONNECTOR_KEY = os.getenv("SMTP_ENCRYPTION_KEY", "")
_connector_fernet = Fernet(_CONNECTOR_KEY.encode()) if Fernet and _CONNECTOR_KEY else None


class GhostConnectorCred(Base):
    __tablename__ = "ghost_connector_creds"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    app_id = Column(String(100), nullable=False, index=True)
    encrypted_creds = Column(Text, nullable=False)
    connected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def _encrypt_creds(creds: dict) -> str:
    """Encrypt credentials dict to a Fernet token string."""
    raw = json.dumps(creds)
    if _connector_fernet:
        return _connector_fernet.encrypt(raw.encode()).decode()
    logger.warning("CONNECTOR_ENCRYPTION_KEY not set — storing credentials unencrypted")
    return raw


def _decrypt_creds(ciphertext: str) -> dict:
    """Decrypt credentials string back to a dict."""
    if _connector_fernet:
        try:
            return json.loads(_connector_fernet.decrypt(ciphertext.encode()).decode())
        except Exception:
            pass  # Fallback: try as plain JSON (for pre-encryption rows)
    try:
        return json.loads(ciphertext)
    except Exception:
        return {}


async def _get_creds(user_id, app_id: str, db: AsyncSession) -> dict | None:
    """Load and decrypt credentials from DB."""
    result = await db.execute(
        select(GhostConnectorCred).where(
            and_(GhostConnectorCred.user_id == user_id, GhostConnectorCred.app_id == app_id)
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    return _decrypt_creds(row.encrypted_creds)


async def _set_creds(user_id, app_id: str, creds: dict, db: AsyncSession):
    """Encrypt and upsert credentials in DB."""
    encrypted = _encrypt_creds(creds)
    result = await db.execute(
        select(GhostConnectorCred).where(
            and_(GhostConnectorCred.user_id == user_id, GhostConnectorCred.app_id == app_id)
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.encrypted_creds = encrypted
        row.connected_at = datetime.now(timezone.utc)
    else:
        db.add(GhostConnectorCred(
            user_id=user_id, app_id=app_id,
            encrypted_creds=encrypted,
        ))
    await db.flush()


async def _del_creds(user_id, app_id: str, db: AsyncSession):
    """Delete credentials from DB."""
    result = await db.execute(
        select(GhostConnectorCred).where(
            and_(GhostConnectorCred.user_id == user_id, GhostConnectorCred.app_id == app_id)
        )
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.flush()


async def _get_connected_app_ids(user_id, db: AsyncSession) -> set[str]:
    """Get all connected app IDs for a user."""
    result = await db.execute(
        select(GhostConnectorCred.app_id).where(GhostConnectorCred.user_id == user_id)
    )
    return {row[0] for row in result.all()}


# ── App Registry ─────────────────────────────────────────────────────────────
# Each app: id, name, category, icon (Ionicons name), auth_fields, actions

APP_REGISTRY: dict[str, dict] = {
    # ── CRM ──────────────────────────────────────────────────────────────
    "hubspot": {
        "name": "HubSpot", "category": "CRM", "icon": "people",
        "auth_fields": [{"key": "api_key", "label": "Private App Token", "secure": True}],
        "setup": "Go to HubSpot → Settings → Integrations → Private Apps → Create → Copy the token.",
        "actions": ["get_contacts", "create_contact", "get_deals", "create_deal", "search"],
    },
    "salesforce": {
        "name": "Salesforce", "category": "CRM", "icon": "cloud",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "instance_url", "label": "Instance URL"}],
        "setup": "Go to Salesforce → Setup → Apps → App Manager → New Connected App → Copy the Consumer Key and generate an access token.",
        "actions": ["get_leads", "create_lead", "get_opportunities", "create_case", "search"],
    },
    "pipedrive": {
        "name": "Pipedrive", "category": "CRM", "icon": "funnel",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Pipedrive → Settings → Personal preferences → API → Copy your API token.",
        "actions": ["get_deals", "create_deal", "get_persons", "create_person", "search"],
    },
    "gohighlevel": {
        "name": "GoHighLevel", "category": "CRM", "icon": "rocket",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "location_id", "label": "Location ID"}],
        "setup": "Go to GoHighLevel → Settings → Business Profile → API Keys → Create API Key.",
        "actions": ["get_contacts", "create_contact", "get_opportunities", "create_opportunity", "search"],
    },
    "zoho_crm": {
        "name": "Zoho CRM", "category": "CRM", "icon": "globe",
        "auth_fields": [{"key": "api_key", "label": "OAuth Token", "secure": True}],
        "setup": "Go to Zoho API Console → Self Client → Generate token with scope: ZohoCRM.modules.ALL.",
        "actions": ["get_leads", "create_lead", "get_deals", "search"],
    },
    "ringy": {
        "name": "Ringy", "category": "CRM", "icon": "call",
        "auth_fields": [{"key": "sid", "label": "SID"}, {"key": "auth_token", "label": "Auth Token", "secure": True}],
        "setup": "Go to Ringy → Settings → Lead Vendors → Create vendor → Copy the SID and Auth Token.",
        "actions": ["get_leads", "create_lead"],
    },
    "close": {
        "name": "Close", "category": "CRM", "icon": "checkmark-circle",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Close → Settings → API Keys → Generate API Key.",
        "actions": ["get_leads", "create_lead", "get_opportunities", "search"],
    },
    "copper": {
        "name": "Copper", "category": "CRM", "icon": "diamond",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "email", "label": "Account Email"}],
        "setup": "Go to Copper → Settings → Integrations → API Keys → Generate.",
        "actions": ["get_leads", "create_lead", "get_opportunities", "search"],
    },
    "freshsales": {
        "name": "Freshsales", "category": "CRM", "icon": "leaf",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "domain", "label": "Freshsales Domain"}],
        "setup": "Go to Freshsales → Settings → API Settings → Copy your API Key. Domain is your-org.freshsales.io.",
        "actions": ["get_contacts", "create_contact", "get_deals", "search"],
    },
    "monday_crm": {
        "name": "Monday CRM", "category": "CRM", "icon": "grid",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Monday.com → Profile picture → Developers → My Access Tokens → Copy token.",
        "actions": ["get_items", "create_item", "get_boards", "search"],
    },
    "keap": {
        "name": "Keap", "category": "CRM", "icon": "key",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Keap → Settings → API → Generate Personal Access Token.",
        "actions": ["get_contacts", "create_contact", "get_opportunities", "search"],
    },
    "insightly": {
        "name": "Insightly", "category": "CRM", "icon": "eye",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Insightly → User Settings → API → Copy API Key.",
        "actions": ["get_contacts", "create_contact", "get_opportunities", "search"],
    },
    "nutshell": {
        "name": "Nutshell", "category": "CRM", "icon": "nutrition",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "email", "label": "Account Email"}],
        "setup": "Go to Nutshell → Setup → API → Enable API access and copy your key.",
        "actions": ["get_leads", "create_lead", "get_contacts", "search"],
    },
    "less_annoying_crm": {
        "name": "Less Annoying CRM", "category": "CRM", "icon": "happy",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "user_code", "label": "User Code"}],
        "setup": "Go to Less Annoying CRM → Settings → Programmer API → Copy your API key and user code.",
        "actions": ["get_contacts", "create_contact", "search"],
    },
    "liondesk": {
        "name": "LionDesk", "category": "CRM", "icon": "paw",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to LionDesk → Settings → API → Generate API Key.",
        "actions": ["get_contacts", "create_contact", "search"],
    },
    "follow_up_boss": {
        "name": "Follow Up Boss", "category": "CRM", "icon": "person-add",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Follow Up Boss → Admin → API → Copy your API Key.",
        "actions": ["get_leads", "create_lead", "search"],
    },
    "kvcore": {
        "name": "kvCORE", "category": "CRM", "icon": "home",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to kvCORE → Settings → API → Copy your API Key.",
        "actions": ["get_leads", "create_lead", "search"],
    },
    "chime": {
        "name": "Chime", "category": "CRM", "icon": "notifications",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Chime → Settings → Integrations → API → Copy your API Key.",
        "actions": ["get_leads", "create_lead", "search"],
    },

    # ── Accounting & Finance ─────────────────────────────────────────────
    "quickbooks": {
        "name": "QuickBooks", "category": "Accounting", "icon": "calculator",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "realm_id", "label": "Realm/Company ID"}],
        "setup": "Go to developer.intuit.com → Create App → Get OAuth tokens → Copy Access Token and Realm ID.",
        "actions": ["get_invoices", "create_invoice", "get_customers", "get_expenses", "create_expense"],
    },
    "xero": {
        "name": "Xero", "category": "Accounting", "icon": "cash",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "tenant_id", "label": "Tenant ID"}],
        "setup": "Go to developer.xero.com → My Apps → Create → Copy Access Token and Tenant ID.",
        "actions": ["get_invoices", "create_invoice", "get_contacts", "get_accounts"],
    },
    "freshbooks": {
        "name": "FreshBooks", "category": "Accounting", "icon": "book",
        "auth_fields": [{"key": "api_key", "label": "Bearer Token", "secure": True}, {"key": "account_id", "label": "Account ID"}],
        "setup": "Go to FreshBooks → Settings → Developer → Create App → Copy Bearer Token and Account ID.",
        "actions": ["get_invoices", "create_invoice", "get_clients", "get_expenses"],
    },
    "wave": {
        "name": "Wave", "category": "Accounting", "icon": "water",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Wave → Settings → Developer → Create Token.",
        "actions": ["get_invoices", "get_customers", "get_accounts"],
    },
    "sage": {
        "name": "Sage", "category": "Accounting", "icon": "leaf",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developer.sage.com → My Apps → Create → Copy Access Token.",
        "actions": ["get_invoices", "create_invoice", "get_contacts"],
    },
    "zoho_books": {
        "name": "Zoho Books", "category": "Accounting", "icon": "document-text",
        "auth_fields": [{"key": "api_key", "label": "OAuth Token", "secure": True}, {"key": "org_id", "label": "Organization ID"}],
        "setup": "Go to Zoho API Console → Self Client → Generate token with scope: ZohoBooks.fullaccess.all.",
        "actions": ["get_invoices", "create_invoice", "get_contacts", "get_expenses"],
    },
    "billcom": {
        "name": "Bill.com", "category": "Accounting", "icon": "receipt",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "org_id", "label": "Organization ID"}],
        "setup": "Go to Bill.com → Settings → Developer → API → Copy your credentials.",
        "actions": ["get_invoices", "get_bills", "get_vendors"],
    },
    "gusto": {
        "name": "Gusto", "category": "Accounting", "icon": "people",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to developer.gusto.com → Create App → Copy API Token.",
        "actions": ["get_employees", "get_payroll", "get_company"],
    },
    "adp": {
        "name": "ADP", "category": "Accounting", "icon": "briefcase",
        "auth_fields": [{"key": "client_id", "label": "Client ID"}, {"key": "client_secret", "label": "Client Secret", "secure": True}],
        "setup": "Go to ADP Marketplace → My Apps → Create → Copy Client ID and Secret.",
        "actions": ["get_employees", "get_payroll"],
    },
    "plaid": {
        "name": "Plaid", "category": "Accounting", "icon": "card",
        "auth_fields": [{"key": "client_id", "label": "Client ID"}, {"key": "secret", "label": "Secret", "secure": True}],
        "setup": "Go to dashboard.plaid.com → Team → Keys → Copy Client ID and Secret.",
        "actions": ["get_accounts", "get_transactions", "get_balance"],
    },

    # ── Project Management ───────────────────────────────────────────────
    "asana": {
        "name": "Asana", "category": "Project Management", "icon": "checkmark-done",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to Asana → My Profile Settings → Apps → Manage Developer Apps → Personal Access Tokens → Create.",
        "actions": ["get_tasks", "create_task", "get_projects", "update_task", "search"],
    },
    "trello": {
        "name": "Trello", "category": "Project Management", "icon": "albums",
        "auth_fields": [{"key": "api_key", "label": "API Key"}, {"key": "token", "label": "Token", "secure": True}],
        "setup": "Go to trello.com/power-ups/admin → New → Copy API Key. Then visit trello.com/1/authorize?key=YOUR_KEY&scope=read,write&response_type=token to get your Token.",
        "actions": ["get_cards", "create_card", "get_boards", "move_card", "search"],
    },
    "monday": {
        "name": "Monday.com", "category": "Project Management", "icon": "grid",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Monday.com → Profile picture → Developers → My Access Tokens → Copy.",
        "actions": ["get_items", "create_item", "get_boards", "update_item", "search"],
    },
    "clickup": {
        "name": "ClickUp", "category": "Project Management", "icon": "flash",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to ClickUp → Settings → Apps → Generate API Token.",
        "actions": ["get_tasks", "create_task", "get_spaces", "update_task", "search"],
    },
    "notion": {
        "name": "Notion", "category": "Project Management", "icon": "document",
        "auth_fields": [{"key": "api_key", "label": "Integration Token", "secure": True}],
        "setup": "Go to notion.so/my-integrations → New Integration → Copy the Internal Integration Token. Then share your pages/databases with the integration.",
        "actions": ["get_pages", "create_page", "search", "update_page", "query_database"],
    },
    "jira": {
        "name": "Jira", "category": "Project Management", "icon": "bug",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}, {"key": "email", "label": "Email"}, {"key": "domain", "label": "Jira Domain"}],
        "setup": "Go to id.atlassian.com/manage-profile/security → Create API Token. Domain is your-org.atlassian.net.",
        "actions": ["get_issues", "create_issue", "update_issue", "search", "get_projects"],
    },
    "linear": {
        "name": "Linear", "category": "Project Management", "icon": "git-branch",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Linear → Settings → API → Personal API Keys → Create.",
        "actions": ["get_issues", "create_issue", "update_issue", "search"],
    },
    "basecamp": {
        "name": "Basecamp", "category": "Project Management", "icon": "flag",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "account_id", "label": "Account ID"}],
        "setup": "Go to launchpad.37signals.com/integrations → Register App → Copy Access Token.",
        "actions": ["get_todos", "create_todo", "get_projects"],
    },
    "wrike": {
        "name": "Wrike", "category": "Project Management", "icon": "layers",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to Wrike → Apps & Integrations → API → Create Token.",
        "actions": ["get_tasks", "create_task", "get_folders", "search"],
    },
    "teamwork": {
        "name": "Teamwork", "category": "Project Management", "icon": "people-circle",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}, {"key": "domain", "label": "Teamwork Domain"}],
        "setup": "Go to Teamwork → Settings → API → Generate Token.",
        "actions": ["get_tasks", "create_task", "get_projects"],
    },
    "todoist": {
        "name": "Todoist", "category": "Project Management", "icon": "checkbox",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to todoist.com/prefs/integrations → Developer → Copy API Token.",
        "actions": ["get_tasks", "create_task", "update_task", "get_projects"],
    },

    # ── Communication ────────────────────────────────────────────────────
    "slack": {
        "name": "Slack", "category": "Communication", "icon": "chatbubbles",
        "auth_fields": [{"key": "api_key", "label": "Bot Token (xoxb-...)", "secure": True}],
        "setup": "Go to api.slack.com/apps → Create App → OAuth & Permissions → Install to Workspace → Copy Bot Token.",
        "actions": ["send_message", "get_channels", "get_messages", "search"],
    },
    "discord": {
        "name": "Discord", "category": "Communication", "icon": "game-controller",
        "auth_fields": [{"key": "api_key", "label": "Bot Token", "secure": True}],
        "setup": "Go to discord.com/developers → New Application → Bot → Copy Token.",
        "actions": ["send_message", "get_channels", "get_messages"],
    },
    "teams": {
        "name": "Microsoft Teams", "category": "Communication", "icon": "people",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to Azure Portal → App Registrations → New → Copy Token (requires Graph API permissions).",
        "actions": ["send_message", "get_channels", "get_messages"],
    },
    "zoom": {
        "name": "Zoom", "category": "Communication", "icon": "videocam",
        "auth_fields": [{"key": "api_key", "label": "JWT Token", "secure": True}],
        "setup": "Go to marketplace.zoom.us → Create App → JWT → Copy Token.",
        "actions": ["create_meeting", "get_meetings", "get_recordings"],
    },
    "twilio": {
        "name": "Twilio", "category": "Communication", "icon": "call",
        "auth_fields": [{"key": "account_sid", "label": "Account SID"}, {"key": "auth_token", "label": "Auth Token", "secure": True}],
        "setup": "Go to twilio.com/console → Copy Account SID and Auth Token.",
        "actions": ["send_sms", "make_call", "get_messages"],
    },
    "whatsapp_business": {
        "name": "WhatsApp Business", "category": "Communication", "icon": "logo-whatsapp",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "phone_id", "label": "Phone Number ID"}],
        "setup": "Go to developers.facebook.com → My Apps → WhatsApp → API Setup → Copy token and Phone Number ID.",
        "actions": ["send_message", "get_messages"],
    },
    "telegram": {
        "name": "Telegram", "category": "Communication", "icon": "paper-plane",
        "auth_fields": [{"key": "api_key", "label": "Bot Token", "secure": True}],
        "setup": "Message @BotFather on Telegram → /newbot → Copy the token.",
        "actions": ["send_message", "get_updates"],
    },
    "intercom": {
        "name": "Intercom", "category": "Communication", "icon": "chatbox",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to Intercom → Settings → Integrations → Developer Hub → New App → Copy Access Token.",
        "actions": ["get_contacts", "create_contact", "send_message", "get_conversations"],
    },

    # ── Calendar & Scheduling ────────────────────────────────────────────
    "google_calendar": {
        "name": "Google Calendar", "category": "Calendar", "icon": "calendar",
        "auth_fields": [{"key": "api_key", "label": "API Key / OAuth Token", "secure": True}],
        "setup": "Go to console.cloud.google.com → APIs & Services → Credentials → Create API Key or OAuth Token.",
        "actions": ["get_events", "create_event", "update_event", "delete_event"],
    },
    "outlook_calendar": {
        "name": "Outlook Calendar", "category": "Calendar", "icon": "mail",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to Azure Portal → App Registrations → New → Certificates & Secrets → Copy Token.",
        "actions": ["get_events", "create_event", "update_event"],
    },
    "calendly": {
        "name": "Calendly", "category": "Calendar", "icon": "time",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to calendly.com/integrations/api → Create Token → Copy.",
        "actions": ["get_events", "get_event_types", "get_availability"],
    },
    "acuity": {
        "name": "Acuity Scheduling", "category": "Calendar", "icon": "alarm",
        "auth_fields": [{"key": "user_id", "label": "User ID"}, {"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Acuity → Integrations → API → Copy User ID and API Key.",
        "actions": ["get_appointments", "create_appointment", "get_availability"],
    },
    "calcom": {
        "name": "Cal.com", "category": "Calendar", "icon": "today",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Cal.com → Settings → Developer → API Keys → Create.",
        "actions": ["get_bookings", "get_event_types", "get_availability"],
    },

    # ── E-commerce ───────────────────────────────────────────────────────
    "shopify": {
        "name": "Shopify", "category": "E-commerce", "icon": "cart",
        "auth_fields": [{"key": "api_key", "label": "Admin API Access Token", "secure": True}, {"key": "store_url", "label": "Store URL (your-store.myshopify.com)"}],
        "setup": "Go to Shopify Admin → Settings → Apps → Develop apps → Create → Admin API Access Token.",
        "actions": ["get_orders", "get_products", "get_customers", "create_product", "get_inventory"],
    },
    "stripe": {
        "name": "Stripe", "category": "E-commerce", "icon": "card",
        "auth_fields": [{"key": "api_key", "label": "Secret Key (sk_...)", "secure": True}],
        "setup": "Go to dashboard.stripe.com → Developers → API Keys → Copy Secret Key.",
        "actions": ["get_payments", "get_customers", "create_payment_link", "get_invoices", "get_balance"],
    },
    "square": {
        "name": "Square", "category": "E-commerce", "icon": "cube",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developer.squareup.com → Applications → Credentials → Copy Access Token.",
        "actions": ["get_payments", "get_catalog", "get_customers", "get_orders"],
    },
    "woocommerce": {
        "name": "WooCommerce", "category": "E-commerce", "icon": "storefront",
        "auth_fields": [{"key": "consumer_key", "label": "Consumer Key"}, {"key": "consumer_secret", "label": "Consumer Secret", "secure": True}, {"key": "store_url", "label": "Store URL"}],
        "setup": "Go to WooCommerce → Settings → Advanced → REST API → Add Key → Copy Consumer Key and Secret.",
        "actions": ["get_orders", "get_products", "get_customers", "create_product"],
    },
    "paypal": {
        "name": "PayPal", "category": "E-commerce", "icon": "logo-paypal",
        "auth_fields": [{"key": "client_id", "label": "Client ID"}, {"key": "secret", "label": "Secret", "secure": True}],
        "setup": "Go to developer.paypal.com → My Apps → Create → Copy Client ID and Secret.",
        "actions": ["get_transactions", "get_balance", "create_invoice"],
    },
    "amazon_seller": {
        "name": "Amazon Seller", "category": "E-commerce", "icon": "logo-amazon",
        "auth_fields": [{"key": "api_key", "label": "Access Key", "secure": True}, {"key": "secret_key", "label": "Secret Key", "secure": True}],
        "setup": "Go to sellercentral.amazon.com → Settings → User Permissions → Developer Access.",
        "actions": ["get_orders", "get_inventory", "get_products"],
    },
    "etsy": {
        "name": "Etsy", "category": "E-commerce", "icon": "pricetag",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to etsy.com/developers → Create App → Copy API Key.",
        "actions": ["get_orders", "get_listings", "get_shop"],
    },

    # ── Storage & Docs ───────────────────────────────────────────────────
    "google_drive": {
        "name": "Google Drive", "category": "Storage", "icon": "folder",
        "auth_fields": [{"key": "api_key", "label": "OAuth Token", "secure": True}],
        "setup": "Go to console.cloud.google.com → APIs → Enable Drive API → Create OAuth credentials.",
        "actions": ["list_files", "search_files", "get_file", "create_file"],
    },
    "dropbox": {
        "name": "Dropbox", "category": "Storage", "icon": "cloud-download",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to dropbox.com/developers → My Apps → Create → Generate Access Token.",
        "actions": ["list_files", "search_files", "get_file"],
    },
    "onedrive": {
        "name": "OneDrive", "category": "Storage", "icon": "cloud",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to Azure Portal → App Registrations → Create → Get Token via Microsoft Graph API.",
        "actions": ["list_files", "search_files", "get_file"],
    },
    "box": {
        "name": "Box", "category": "Storage", "icon": "cube",
        "auth_fields": [{"key": "api_key", "label": "Developer Token", "secure": True}],
        "setup": "Go to developer.box.com → My Apps → Create → Configuration → Generate Developer Token.",
        "actions": ["list_files", "search_files", "get_file"],
    },
    "google_sheets": {
        "name": "Google Sheets", "category": "Storage", "icon": "grid",
        "auth_fields": [{"key": "api_key", "label": "OAuth Token", "secure": True}],
        "setup": "Go to console.cloud.google.com → APIs → Enable Sheets API → Create OAuth credentials.",
        "actions": ["get_spreadsheet", "update_cells", "create_spreadsheet", "search"],
    },
    "airtable": {
        "name": "Airtable", "category": "Storage", "icon": "apps",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to airtable.com/create/tokens → Create Token → Add scopes (data.records:read, data.records:write).",
        "actions": ["get_records", "create_record", "update_record", "search"],
    },

    # ── Email Marketing ──────────────────────────────────────────────────
    "mailchimp": {
        "name": "Mailchimp", "category": "Email Marketing", "icon": "mail",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Mailchimp → Account → Extras → API Keys → Create.",
        "actions": ["get_lists", "get_campaigns", "create_campaign", "get_subscribers", "add_subscriber"],
    },
    "convertkit": {
        "name": "ConvertKit", "category": "Email Marketing", "icon": "send",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to ConvertKit → Settings → Advanced → API → Copy API Key.",
        "actions": ["get_subscribers", "add_subscriber", "get_sequences", "get_forms"],
    },
    "klaviyo": {
        "name": "Klaviyo", "category": "Email Marketing", "icon": "megaphone",
        "auth_fields": [{"key": "api_key", "label": "Private API Key", "secure": True}],
        "setup": "Go to Klaviyo → Account → Settings → API Keys → Create Private Key.",
        "actions": ["get_lists", "get_campaigns", "get_profiles", "add_profile"],
    },
    "activecampaign": {
        "name": "ActiveCampaign", "category": "Email Marketing", "icon": "pulse",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "api_url", "label": "API URL"}],
        "setup": "Go to ActiveCampaign → Settings → Developer → Copy API URL and Key.",
        "actions": ["get_contacts", "create_contact", "get_campaigns", "get_lists"],
    },
    "constant_contact": {
        "name": "Constant Contact", "category": "Email Marketing", "icon": "at",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to app.constantcontact.com/pages/dma/portal → My Applications → Create → Copy Token.",
        "actions": ["get_contacts", "add_contact", "get_campaigns"],
    },
    "brevo": {
        "name": "Brevo (Sendinblue)", "category": "Email Marketing", "icon": "mail-open",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Brevo → Settings → SMTP & API → API Keys → Generate.",
        "actions": ["get_contacts", "create_contact", "get_campaigns", "send_email"],
    },

    # ── HR & Recruiting ──────────────────────────────────────────────────
    "bamboohr": {
        "name": "BambooHR", "category": "HR", "icon": "people",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "subdomain", "label": "Subdomain"}],
        "setup": "Go to BambooHR → Account → API Keys → Add New Key.",
        "actions": ["get_employees", "get_directory", "get_time_off"],
    },
    "greenhouse": {
        "name": "Greenhouse", "category": "HR", "icon": "leaf",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Greenhouse → Configure → Dev Center → API Credentials → Create.",
        "actions": ["get_candidates", "get_jobs", "create_candidate"],
    },
    "lever": {
        "name": "Lever", "category": "HR", "icon": "swap-horizontal",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Lever → Settings → Integrations → API → Generate Key.",
        "actions": ["get_opportunities", "get_postings", "create_opportunity"],
    },

    # ── Customer Support ─────────────────────────────────────────────────
    "zendesk": {
        "name": "Zendesk", "category": "Support", "icon": "headset",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}, {"key": "email", "label": "Email"}, {"key": "subdomain", "label": "Subdomain"}],
        "setup": "Go to Zendesk → Admin → Channels → API → Add Token.",
        "actions": ["get_tickets", "create_ticket", "update_ticket", "search", "get_users"],
    },
    "freshdesk": {
        "name": "Freshdesk", "category": "Support", "icon": "help-circle",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "domain", "label": "Domain"}],
        "setup": "Go to Freshdesk → Profile → Your API Key.",
        "actions": ["get_tickets", "create_ticket", "update_ticket", "search"],
    },
    "helpscout": {
        "name": "HelpScout", "category": "Support", "icon": "help-buoy",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to HelpScout → Your Profile → API Keys → Generate.",
        "actions": ["get_conversations", "create_conversation", "get_customers"],
    },
    "livechat": {
        "name": "LiveChat", "category": "Support", "icon": "chatbubble-ellipses",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to LiveChat → Settings → Integrations → Personal Access Tokens → Create.",
        "actions": ["get_chats", "get_agents", "send_message"],
    },

    # ── Legal & Signatures ───────────────────────────────────────────────
    "docusign": {
        "name": "DocuSign", "category": "Legal", "icon": "create",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "account_id", "label": "Account ID"}],
        "setup": "Go to developers.docusign.com → My Account → API → Create Key and Access Token.",
        "actions": ["send_envelope", "get_envelopes", "get_envelope_status"],
    },
    "hellosign": {
        "name": "HelloSign", "category": "Legal", "icon": "pencil",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to HelloSign → Settings → API → Copy API Key.",
        "actions": ["send_signature_request", "get_signature_requests"],
    },
    "pandadoc": {
        "name": "PandaDoc", "category": "Legal", "icon": "document-attach",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to PandaDoc → Settings → Integrations → API → Create Key.",
        "actions": ["get_documents", "create_document", "send_document"],
    },
    "contractsafe": {
        "name": "ContractSafe", "category": "Legal", "icon": "shield-checkmark",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to ContractSafe → Settings → API → Generate Key.",
        "actions": ["get_contracts", "search"],
    },

    # ── Social Media ─────────────────────────────────────────────────────
    "instagram": {
        "name": "Instagram", "category": "Social Media", "icon": "logo-instagram",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developers.facebook.com → Create App → Instagram Graph API → Generate Token.",
        "actions": ["get_posts", "create_post", "get_insights"],
    },
    "facebook_pages": {
        "name": "Facebook Pages", "category": "Social Media", "icon": "logo-facebook",
        "auth_fields": [{"key": "api_key", "label": "Page Access Token", "secure": True}, {"key": "page_id", "label": "Page ID"}],
        "setup": "Go to developers.facebook.com → Graph API Explorer → Get Page Token.",
        "actions": ["get_posts", "create_post", "get_insights"],
    },
    "twitter": {
        "name": "Twitter / X", "category": "Social Media", "icon": "logo-twitter",
        "auth_fields": [{"key": "api_key", "label": "Bearer Token", "secure": True}],
        "setup": "Go to developer.twitter.com → Projects & Apps → Keys and Tokens → Generate Bearer Token.",
        "actions": ["get_tweets", "create_tweet", "search"],
    },
    "linkedin": {
        "name": "LinkedIn", "category": "Social Media", "icon": "logo-linkedin",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to linkedin.com/developers → Create App → Auth → Generate Token.",
        "actions": ["get_profile", "create_post", "get_connections"],
    },
    "tiktok": {
        "name": "TikTok", "category": "Social Media", "icon": "musical-notes",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developers.tiktok.com → My Apps → Create → Get Access Token.",
        "actions": ["get_videos", "get_user_info"],
    },
    "buffer": {
        "name": "Buffer", "category": "Social Media", "icon": "share-social",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to buffer.com/developers → My Apps → Create → Copy Access Token.",
        "actions": ["get_profiles", "create_update", "get_updates"],
    },
    "hootsuite": {
        "name": "Hootsuite", "category": "Social Media", "icon": "planet",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developer.hootsuite.com → My Apps → Create → Copy Access Token.",
        "actions": ["get_social_profiles", "schedule_message", "get_messages"],
    },

    # ── Healthcare ───────────────────────────────────────────────────────
    "athenahealth": {
        "name": "Athenahealth", "category": "Healthcare", "icon": "medkit",
        "auth_fields": [{"key": "client_id", "label": "Client ID"}, {"key": "client_secret", "label": "Client Secret", "secure": True}],
        "setup": "Go to developer.athenahealth.com → My Apps → Create → Copy Client ID and Secret.",
        "actions": ["get_patients", "get_appointments", "create_appointment"],
    },
    "drchrono": {
        "name": "DrChrono", "category": "Healthcare", "icon": "fitness",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to drchrono.com → API → Generate Access Token.",
        "actions": ["get_patients", "get_appointments", "create_appointment"],
    },
    "simplepractice": {
        "name": "SimplePractice", "category": "Healthcare", "icon": "heart",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to SimplePractice → Settings → Integrations → API → Generate Key.",
        "actions": ["get_clients", "get_appointments", "create_appointment"],
    },

    # ── Automation ───────────────────────────────────────────────────────
    "zapier": {
        "name": "Zapier Webhooks", "category": "Automation", "icon": "flash",
        "auth_fields": [{"key": "webhook_url", "label": "Webhook URL"}],
        "setup": "Go to zapier.com → Create Zap → Trigger: Webhooks by Zapier → Catch Hook → Copy the webhook URL. This lets GoFarther AI trigger any of your 5,000+ Zapier integrations.",
        "actions": ["trigger_webhook"],
    },
    "make": {
        "name": "Make (Integromat)", "category": "Automation", "icon": "construct",
        "auth_fields": [{"key": "webhook_url", "label": "Webhook URL"}],
        "setup": "Go to make.com → Create Scenario → Add Webhook module → Copy URL.",
        "actions": ["trigger_webhook"],
    },
    "n8n": {
        "name": "n8n", "category": "Automation", "icon": "git-network",
        "auth_fields": [{"key": "webhook_url", "label": "Webhook URL"}],
        "setup": "Go to n8n → Create Workflow → Add Webhook node → Copy production URL.",
        "actions": ["trigger_webhook"],
    },
    "ifttt": {
        "name": "IFTTT", "category": "Automation", "icon": "link",
        "auth_fields": [{"key": "webhook_url", "label": "Webhook URL"}, {"key": "event_name", "label": "Event Name"}],
        "setup": "Go to ifttt.com/maker_webhooks → Settings → Copy URL. Create an Applet with Webhooks trigger.",
        "actions": ["trigger_webhook"],
    },

    # ── Finance & Banking ───────────────────────────────────────────────
    "brex": {
        "name": "Brex", "category": "Finance", "icon": "card",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Brex → Settings → Developer → API Keys → Create Token.",
        "actions": ["get_transactions", "get_accounts", "create_expense"],
    },
    "mercury": {
        "name": "Mercury", "category": "Finance", "icon": "trending-up",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Mercury → Settings → API → Generate API Key.",
        "actions": ["get_transactions", "get_accounts", "get_balance"],
    },
    "ramp": {
        "name": "Ramp", "category": "Finance", "icon": "card",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Ramp → Settings → Developer → API Keys → Create.",
        "actions": ["get_transactions", "get_cards", "get_expenses"],
    },
    "wise": {
        "name": "Wise Business", "category": "Finance", "icon": "swap-horizontal",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Wise → Settings → API Tokens → Create Token with full access.",
        "actions": ["get_transactions", "get_balance", "create_transfer"],
    },

    # ── Real Estate ─────────────────────────────────────────────────────
    "propertybase": {
        "name": "Propertybase", "category": "Real Estate", "icon": "home",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Propertybase → Settings → API → Generate Key.",
        "actions": ["get_listings", "get_leads", "create_lead", "search"],
    },
    "boomtown": {
        "name": "BoomTown", "category": "Real Estate", "icon": "business",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to BoomTown → Settings → API → Copy Key.",
        "actions": ["get_leads", "create_lead", "search"],
    },

    # ── Legal ───────────────────────────────────────────────────────────
    "clio": {
        "name": "Clio", "category": "Legal", "icon": "briefcase",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to app.clio.com → Settings → API → Create App → Copy Access Token.",
        "actions": ["get_matters", "create_matter", "get_contacts", "get_tasks", "create_task"],
    },
    "lawpay": {
        "name": "LawPay", "category": "Legal", "icon": "cash",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to LawPay → Settings → API → Generate Key.",
        "actions": ["get_transactions", "create_payment_link", "get_invoices"],
    },
    "mycase": {
        "name": "MyCase", "category": "Legal", "icon": "folder",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to MyCase → Settings → Integrations → API → Copy Key.",
        "actions": ["get_cases", "create_case", "get_contacts", "get_tasks"],
    },
    "practicepanther": {
        "name": "PracticePanther", "category": "Legal", "icon": "shield",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to PracticePanther → Settings → API → Generate Key.",
        "actions": ["get_matters", "get_contacts", "get_invoices", "create_task"],
    },

    # ── Education ───────────────────────────────────────────────────────
    "canvas_lms": {
        "name": "Canvas LMS", "category": "Education", "icon": "school",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}, {"key": "domain", "label": "Canvas Domain (e.g. school.instructure.com)"}],
        "setup": "Go to Canvas → Account → Settings → New Access Token → Generate.",
        "actions": ["get_courses", "get_assignments", "get_grades", "create_assignment"],
    },
    "google_classroom": {
        "name": "Google Classroom", "category": "Education", "icon": "school",
        "auth_fields": [{"key": "api_key", "label": "OAuth Token", "secure": True}],
        "setup": "Go to console.cloud.google.com → Enable Classroom API → Create OAuth credentials.",
        "actions": ["get_courses", "get_assignments", "create_assignment", "get_students"],
    },

    # ── Restaurants & POS ───────────────────────────────────────────────
    "toast": {
        "name": "Toast POS", "category": "POS", "icon": "restaurant",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "restaurant_id", "label": "Restaurant GUID"}],
        "setup": "Go to Toast → Developer Portal → Create App → Copy API Key and Restaurant GUID.",
        "actions": ["get_orders", "get_menu", "get_employees", "get_revenue"],
    },
    "clover": {
        "name": "Clover", "category": "POS", "icon": "card",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}, {"key": "merchant_id", "label": "Merchant ID"}],
        "setup": "Go to Clover → Developer Dashboard → Create App → Copy Token and Merchant ID.",
        "actions": ["get_orders", "get_inventory", "get_employees", "get_revenue"],
    },
    "lightspeed": {
        "name": "Lightspeed", "category": "POS", "icon": "flash",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Lightspeed → Settings → API → Generate Key.",
        "actions": ["get_sales", "get_inventory", "get_customers", "get_products"],
    },

    # ── Field Service ───────────────────────────────────────────────────
    "servicetitan": {
        "name": "ServiceTitan", "category": "Field Service", "icon": "construct",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "tenant_id", "label": "Tenant ID"}],
        "setup": "Go to ServiceTitan → Settings → Integrations → API → Copy Key and Tenant ID.",
        "actions": ["get_jobs", "create_job", "get_customers", "get_invoices", "schedule_job"],
    },
    "jobber": {
        "name": "Jobber", "category": "Field Service", "icon": "hammer",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Jobber → Settings → API → Generate Token.",
        "actions": ["get_jobs", "create_job", "get_clients", "get_invoices", "schedule_visit"],
    },
    "housecall_pro": {
        "name": "Housecall Pro", "category": "Field Service", "icon": "home",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Housecall Pro → Settings → API → Generate Key.",
        "actions": ["get_jobs", "create_job", "get_customers", "get_invoices"],
    },

    # ── Logistics & Shipping ────────────────────────────────────────────
    "shipstation": {
        "name": "ShipStation", "category": "Logistics", "icon": "boat",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "api_secret", "label": "API Secret", "secure": True}],
        "setup": "Go to ShipStation → Settings → Account → API Settings → Generate Keys.",
        "actions": ["get_orders", "create_label", "get_shipments", "track_package"],
    },
    "shippo": {
        "name": "Shippo", "category": "Logistics", "icon": "airplane",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Shippo → Settings → API → Copy Live Token.",
        "actions": ["get_shipments", "create_shipment", "get_rates", "create_label"],
    },
    "easypost": {
        "name": "EasyPost", "category": "Logistics", "icon": "cube",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to easypost.com → Account → API Keys → Copy Production Key.",
        "actions": ["create_shipment", "get_rates", "create_label", "track_package"],
    },

    # ── Design ──────────────────────────────────────────────────────────
    "figma": {
        "name": "Figma", "category": "Design", "icon": "color-palette",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to Figma → Settings → Account → Personal Access Tokens → Create.",
        "actions": ["get_files", "get_projects", "get_comments", "export_image"],
    },
    "canva": {
        "name": "Canva", "category": "Design", "icon": "brush",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to canva.com/developers → Create App → Copy API Key.",
        "actions": ["get_designs", "create_design", "export_design"],
    },

    # ── Analytics ───────────────────────────────────────────────────────
    "google_analytics": {
        "name": "Google Analytics", "category": "Analytics", "icon": "analytics",
        "auth_fields": [{"key": "api_key", "label": "Service Account JSON Key", "secure": True}, {"key": "property_id", "label": "Property ID"}],
        "setup": "Go to console.cloud.google.com → Enable Analytics API → Create Service Account → Download JSON key.",
        "actions": ["get_report", "get_realtime", "get_users", "get_pageviews"],
    },
    "mixpanel": {
        "name": "Mixpanel", "category": "Analytics", "icon": "bar-chart",
        "auth_fields": [{"key": "api_key", "label": "Service Account", "secure": True}, {"key": "project_id", "label": "Project ID"}],
        "setup": "Go to Mixpanel → Settings → Project Settings → Service Accounts → Create.",
        "actions": ["get_events", "get_funnels", "get_retention", "get_users"],
    },
    "segment": {
        "name": "Segment", "category": "Analytics", "icon": "pie-chart",
        "auth_fields": [{"key": "api_key", "label": "Write Key", "secure": True}],
        "setup": "Go to Segment → Sources → Your Source → Settings → API Keys → Copy Write Key.",
        "actions": ["track_event", "identify_user", "get_events"],
    },

    # ── Dev Tools ───────────────────────────────────────────────────────
    "github": {
        "name": "GitHub", "category": "Dev Tools", "icon": "logo-github",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Generate.",
        "actions": ["get_repos", "get_issues", "create_issue", "get_prs", "search"],
    },
    "gitlab": {
        "name": "GitLab", "category": "Dev Tools", "icon": "git-branch",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to GitLab → Settings → Access Tokens → Create.",
        "actions": ["get_projects", "get_issues", "create_issue", "get_pipelines"],
    },
    "vercel": {
        "name": "Vercel", "category": "Dev Tools", "icon": "triangle",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Vercel → Settings → Tokens → Create.",
        "actions": ["get_deployments", "get_projects", "trigger_deploy"],
    },

    # ── Video ───────────────────────────────────────────────────────────
    "youtube": {
        "name": "YouTube", "category": "Video", "icon": "logo-youtube",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to console.cloud.google.com → Enable YouTube Data API → Create API Key.",
        "actions": ["get_videos", "get_analytics", "get_comments", "search"],
    },
    "loom": {
        "name": "Loom", "category": "Video", "icon": "videocam",
        "auth_fields": [{"key": "api_key", "label": "Developer Token", "secure": True}],
        "setup": "Go to loom.com → Settings → Developer → Generate Token.",
        "actions": ["get_videos", "get_shared_videos"],
    },

    # ── Surveys & Forms ─────────────────────────────────────────────────
    "typeform": {
        "name": "Typeform", "category": "Surveys", "icon": "list",
        "auth_fields": [{"key": "api_key", "label": "Personal Access Token", "secure": True}],
        "setup": "Go to Typeform → Settings → Personal Tokens → Generate.",
        "actions": ["get_forms", "get_responses", "create_form"],
    },
    "surveymonkey": {
        "name": "SurveyMonkey", "category": "Surveys", "icon": "clipboard",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developer.surveymonkey.com → My Apps → Create → Copy Token.",
        "actions": ["get_surveys", "get_responses", "create_survey"],
    },
    "tally": {
        "name": "Tally", "category": "Surveys", "icon": "checkmark-done",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to tally.so → Settings → Integrations → API → Copy Key.",
        "actions": ["get_forms", "get_submissions"],
    },

    # ── Appointments ────────────────────────────────────────────────────
    "vagaro": {
        "name": "Vagaro", "category": "Appointments", "icon": "calendar",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Vagaro → Settings → Developer → API → Generate Key.",
        "actions": ["get_appointments", "create_appointment", "get_clients", "get_services"],
    },
    "mindbody": {
        "name": "Mindbody", "category": "Appointments", "icon": "fitness",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "site_id", "label": "Site ID"}],
        "setup": "Go to Mindbody → Developer Portal → Create App → Copy API Key and Site ID.",
        "actions": ["get_classes", "get_appointments", "get_clients", "book_class"],
    },
    "fresha": {
        "name": "Fresha", "category": "Appointments", "icon": "cut",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Fresha → Settings → Integrations → API → Generate Key.",
        "actions": ["get_appointments", "get_clients", "get_services"],
    },
    "booksy": {
        "name": "Booksy", "category": "Appointments", "icon": "time",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Booksy → Settings → Integrations → API → Copy Key.",
        "actions": ["get_appointments", "get_clients", "get_services"],
    },

    # ── Insurance ───────────────────────────────────────────────────────
    "applied_epic": {
        "name": "Applied Epic", "category": "Insurance", "icon": "shield-checkmark",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Applied Epic → Admin → API → Generate Key.",
        "actions": ["get_policies", "get_clients", "create_client", "search"],
    },
    "hawksoft": {
        "name": "HawkSoft", "category": "Insurance", "icon": "shield",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to HawkSoft → Settings → API → Generate Key.",
        "actions": ["get_policies", "get_clients", "search"],
    },
    "ezlynx": {
        "name": "EZLynx", "category": "Insurance", "icon": "document-text",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to EZLynx → Settings → API → Copy Key.",
        "actions": ["get_policies", "get_clients", "create_quote", "search"],
    },
    "agency_zoom": {
        "name": "Agency Zoom", "category": "Insurance", "icon": "trending-up",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Agency Zoom → Settings → Integrations → API → Generate Key.",
        "actions": ["get_leads", "create_lead", "get_policies", "search"],
    },
    "better_agency": {
        "name": "Better Agency", "category": "Insurance", "icon": "people",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Better Agency → Settings → API → Copy Key.",
        "actions": ["get_leads", "create_lead", "get_clients", "search"],
    },

    # ── Construction ────────────────────────────────────────────────────
    "procore": {
        "name": "Procore", "category": "Construction", "icon": "build",
        "auth_fields": [{"key": "api_key", "label": "Access Token", "secure": True}],
        "setup": "Go to developers.procore.com → Create App → Generate OAuth Token.",
        "actions": ["get_projects", "get_rfis", "create_rfi", "get_submittals", "search"],
    },
    "buildertrend": {
        "name": "Buildertrend", "category": "Construction", "icon": "hammer",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Buildertrend → Settings → API → Generate Key.",
        "actions": ["get_projects", "get_schedules", "get_financials", "search"],
    },
    "coconstruct": {
        "name": "CoConstruct", "category": "Construction", "icon": "home",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to CoConstruct → Settings → API → Copy Key.",
        "actions": ["get_projects", "get_clients", "get_financials"],
    },
    "plangrid": {
        "name": "PlanGrid", "category": "Construction", "icon": "map",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to PlanGrid → Settings → API → Generate Key.",
        "actions": ["get_projects", "get_sheets", "get_issues", "search"],
    },

    # ── Automotive ──────────────────────────────────────────────────────
    "dealersocket": {
        "name": "DealerSocket", "category": "Automotive", "icon": "car",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to DealerSocket → Admin → API → Generate Key.",
        "actions": ["get_leads", "create_lead", "get_inventory", "search"],
    },
    "vinsolutions": {
        "name": "VinSolutions", "category": "Automotive", "icon": "car-sport",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to VinSolutions → Settings → API → Copy Key.",
        "actions": ["get_leads", "create_lead", "get_inventory", "search"],
    },

    # ── Nonprofit ───────────────────────────────────────────────────────
    "bloomerang": {
        "name": "Bloomerang", "category": "Nonprofit", "icon": "heart",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Bloomerang → Settings → API → Copy Key.",
        "actions": ["get_donors", "create_donor", "get_donations", "search"],
    },
    "donorperfect": {
        "name": "DonorPerfect", "category": "Nonprofit", "icon": "gift",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to DonorPerfect → Admin → API → Generate Key.",
        "actions": ["get_donors", "create_donor", "get_donations", "search"],
    },
    "givebutter": {
        "name": "Givebutter", "category": "Nonprofit", "icon": "heart-circle",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Givebutter → Settings → API → Copy Key.",
        "actions": ["get_campaigns", "get_donations", "get_supporters"],
    },

    # ── Hospitality ─────────────────────────────────────────────────────
    "guesty": {
        "name": "Guesty", "category": "Hospitality", "icon": "bed",
        "auth_fields": [{"key": "api_key", "label": "API Token", "secure": True}],
        "setup": "Go to Guesty → Marketplace → Open API → Generate Token.",
        "actions": ["get_listings", "get_reservations", "get_guests", "search"],
    },
    "hostaway": {
        "name": "Hostaway", "category": "Hospitality", "icon": "key",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}, {"key": "account_id", "label": "Account ID"}],
        "setup": "Go to Hostaway → Settings → API → Copy Key and Account ID.",
        "actions": ["get_listings", "get_reservations", "get_guests"],
    },
    "cloudbeds": {
        "name": "Cloudbeds", "category": "Hospitality", "icon": "business",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Cloudbeds → Settings → API → Generate Key.",
        "actions": ["get_reservations", "get_rooms", "get_guests", "search"],
    },

    # ── Fitness ─────────────────────────────────────────────────────────
    "gymmaster": {
        "name": "GymMaster", "category": "Fitness", "icon": "barbell",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to GymMaster → Settings → API → Generate Key.",
        "actions": ["get_members", "get_classes", "get_bookings"],
    },
    "glofox": {
        "name": "Glofox", "category": "Fitness", "icon": "fitness",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Glofox → Settings → API → Copy Key.",
        "actions": ["get_members", "get_classes", "get_bookings"],
    },
    "wellnessliving": {
        "name": "WellnessLiving", "category": "Fitness", "icon": "body",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to WellnessLiving → Settings → Developer → API → Generate Key.",
        "actions": ["get_clients", "get_classes", "get_appointments", "get_bookings"],
    },

    # ── Dental ──────────────────────────────────────────────────────────
    "dentrix": {
        "name": "Dentrix", "category": "Dental", "icon": "medkit",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Dentrix → Settings → Developer API → Generate Key.",
        "actions": ["get_patients", "get_appointments", "get_procedures", "search"],
    },
    "open_dental": {
        "name": "Open Dental", "category": "Dental", "icon": "medical",
        "auth_fields": [{"key": "api_key", "label": "Developer Key", "secure": True}],
        "setup": "Go to Open Dental → Setup → API → Enable and copy Developer Key.",
        "actions": ["get_patients", "get_appointments", "create_appointment", "search"],
    },
    "curve_dental": {
        "name": "Curve Dental", "category": "Dental", "icon": "pulse",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to Curve Dental → Admin → API → Generate Key.",
        "actions": ["get_patients", "get_appointments", "get_procedures"],
    },

    # ── Government ──────────────────────────────────────────────────────
    "govpilot": {
        "name": "GovPilot", "category": "Government", "icon": "flag",
        "auth_fields": [{"key": "api_key", "label": "API Key", "secure": True}],
        "setup": "Go to GovPilot → Admin → API → Generate Key.",
        "actions": ["get_permits", "get_requests", "create_request", "search"],
    },
    "accela": {
        "name": "Accela", "category": "Government", "icon": "document",
        "auth_fields": [{"key": "api_key", "label": "App ID", "secure": True}, {"key": "api_secret", "label": "App Secret", "secure": True}],
        "setup": "Go to developer.accela.com → Create App → Copy App ID and Secret.",
        "actions": ["get_records", "create_record", "get_inspections", "search"],
    },

    # ── Oracle Products ──────────────────────────────────────────────────
    "oracle_netsuite": {
        "name": "Oracle NetSuite", "category": "ERP", "icon": "server",
        "auth_fields": [
            {"key": "account_id", "label": "Account ID", "secure": False},
            {"key": "consumer_key", "label": "Consumer Key", "secure": True},
            {"key": "consumer_secret", "label": "Consumer Secret", "secure": True},
            {"key": "token_id", "label": "Token ID", "secure": True},
            {"key": "token_secret", "label": "Token Secret", "secure": True},
        ],
        "setup": "Go to NetSuite → Setup → Integration → Manage Integrations → New. Enable Token-Based Auth. Create an access token under Setup → Users/Roles → Access Tokens.",
        "actions": ["get_customers", "create_customer", "get_invoices", "create_invoice", "get_sales_orders", "create_sales_order", "get_items", "get_vendors", "get_purchase_orders", "get_journal_entries", "search"],
    },
    "oracle_cloud_erp": {
        "name": "Oracle Cloud ERP", "category": "ERP", "icon": "cloud",
        "auth_fields": [
            {"key": "base_url", "label": "Cloud ERP URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle Cloud → Navigator → Tools → Security Console. Create a user with API access. Your base URL is like https://servername.fa.us2.oraclecloud.com.",
        "actions": ["get_invoices", "create_invoice", "get_purchase_orders", "get_journal_entries", "get_general_ledger", "get_payables", "get_receivables", "get_assets", "search"],
    },
    "oracle_cx_sales": {
        "name": "Oracle CX Sales", "category": "CRM", "icon": "people",
        "auth_fields": [
            {"key": "base_url", "label": "CX Sales URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle CX Sales → Navigator → Tools → Manage Users. Create a user with REST API access. Base URL is like https://servername.cx.us2.oraclecloud.com.",
        "actions": ["get_accounts", "create_account", "get_contacts", "create_contact", "get_opportunities", "create_opportunity", "get_leads", "get_activities", "search"],
    },
    "oracle_cx_service": {
        "name": "Oracle CX Service", "category": "Support", "icon": "headset",
        "auth_fields": [
            {"key": "base_url", "label": "CX Service URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle CX Service (B2C Service) → Configuration → Staff Management → Profiles. Enable REST API access for your profile.",
        "actions": ["get_incidents", "create_incident", "get_contacts", "create_contact", "get_service_requests", "update_incident", "search"],
    },
    "oracle_hcm": {
        "name": "Oracle Cloud HCM", "category": "HR", "icon": "person",
        "auth_fields": [
            {"key": "base_url", "label": "HCM Cloud URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle HCM Cloud → Navigator → Tools → Security Console. Create a user with HCM REST API access.",
        "actions": ["get_employees", "get_departments", "get_jobs", "get_absences", "get_payroll", "get_benefits", "get_compensation", "search"],
    },
    "oracle_epm": {
        "name": "Oracle EPM Cloud", "category": "Finance", "icon": "calculator",
        "auth_fields": [
            {"key": "base_url", "label": "EPM Cloud URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle EPM Cloud → Navigator → Tools → Access Control. Assign the Service Administrator or appropriate role for REST API access.",
        "actions": ["get_planning_data", "submit_data", "run_business_rule", "get_reports", "get_consolidation", "get_budgets", "search"],
    },
    "oracle_scm": {
        "name": "Oracle SCM Cloud", "category": "Logistics", "icon": "cube",
        "auth_fields": [
            {"key": "base_url", "label": "SCM Cloud URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle SCM Cloud → Navigator → Tools → Security Console. Create a user with SCM REST API privileges.",
        "actions": ["get_inventory", "get_shipments", "get_purchase_orders", "get_work_orders", "get_suppliers", "get_warehouses", "search"],
    },
    "oracle_apex": {
        "name": "Oracle APEX", "category": "Dev Tools", "icon": "code",
        "auth_fields": [
            {"key": "base_url", "label": "APEX Workspace URL", "secure": False},
            {"key": "api_key", "label": "API Key", "secure": True},
        ],
        "setup": "Go to Oracle APEX → SQL Workshop → RESTful Services → Register Schema. Create a module and template to expose REST endpoints.",
        "actions": ["run_query", "get_tables", "execute_procedure", "get_apps", "search"],
    },
    "oracle_analytics": {
        "name": "Oracle Analytics Cloud", "category": "Analytics", "icon": "bar-chart",
        "auth_fields": [
            {"key": "base_url", "label": "Analytics Cloud URL", "secure": False},
            {"key": "username", "label": "Username", "secure": False},
            {"key": "password", "label": "Password", "secure": True},
        ],
        "setup": "Go to Oracle Analytics Cloud → Console → Users. Ensure your account has BI Service Administrator or BI Consumer role for API access.",
        "actions": ["get_reports", "get_dashboards", "run_analysis", "get_datasets", "search"],
    },
    "oracle_commerce": {
        "name": "Oracle Commerce Cloud", "category": "E-commerce", "icon": "cart",
        "auth_fields": [
            {"key": "base_url", "label": "Commerce Cloud URL", "secure": False},
            {"key": "app_key", "label": "Application Key", "secure": True},
        ],
        "setup": "Go to Oracle Commerce Cloud → Settings → Web APIs → Register Application. Copy the Application Key.",
        "actions": ["get_products", "get_orders", "get_customers", "get_inventory", "get_collections", "create_product", "search"],
    },
}

# ── Category order for display ───────────────────────────────────────────

CATEGORY_ORDER = [
    "CRM", "ERP", "Accounting", "Finance", "Project Management", "Communication",
    "Calendar", "E-commerce", "Storage", "Email Marketing",
    "HR", "Support", "Legal", "Social Media",
    "Healthcare", "Dental", "Real Estate", "Insurance", "Construction",
    "Automotive", "Field Service", "POS", "Hospitality", "Fitness",
    "Logistics", "Design", "Analytics", "Dev Tools",
    "Video", "Surveys", "Appointments", "Education",
    "Nonprofit", "Government", "Automation",
]


# ── Pydantic models ──────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    credentials: dict[str, str]


class ActionRequest(BaseModel):
    action: str
    params: dict[str, Any] = {}


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_connectors(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """List all available apps with connection status per user."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    connected_ids = await _get_connected_app_ids(user_id, db)

    result = []
    for app_id, info in APP_REGISTRY.items():
        result.append({
            "id": app_id,
            "name": info["name"],
            "category": info["category"],
            "icon": info["icon"],
            "auth_fields": info["auth_fields"],
            "setup": info["setup"],
            "actions": info["actions"],
            "connected": app_id in connected_ids,
        })
    return {"connectors": result, "categories": CATEGORY_ORDER}


@router.post("/{app_id}/connect")
async def connect_app(app_id: str, body: ConnectRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Save credentials for an app (encrypted at rest)."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")

    if app_id not in APP_REGISTRY:
        raise HTTPException(404, f"Unknown app: {app_id}")

    # Validate required fields
    required = [f["key"] for f in APP_REGISTRY[app_id]["auth_fields"]]
    missing = [k for k in required if not body.credentials.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required fields: {', '.join(missing)}")

    await _set_creds(user_id, app_id, body.credentials, db)
    # Audit log
    from routes.ghost_auth import _audit_log
    await _audit_log(db, payload.get("email", ""), "connector_connected", f"Connected app: {app_id}")
    await db.commit()
    return {"status": "connected", "app": app_id}


@router.delete("/{app_id}/disconnect")
async def disconnect_app(app_id: str, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Remove credentials for an app."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    await _del_creds(user_id, app_id, db)
    # Audit log
    from routes.ghost_auth import _audit_log
    await _audit_log(db, payload.get("email", ""), "connector_disconnected", f"Disconnected app: {app_id}")
    await db.commit()
    return {"status": "disconnected", "app": app_id}


@router.post("/{app_id}/action")
async def execute_action(app_id: str, body: ActionRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Execute an action on a connected app."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")

    if app_id not in APP_REGISTRY:
        raise HTTPException(404, f"Unknown app: {app_id}")

    creds = await _get_creds(user_id, app_id, db)
    if not creds:
        raise HTTPException(400, f"{APP_REGISTRY[app_id]['name']} is not connected. Go to Settings → Connect Apps to set it up.")

    if body.action not in APP_REGISTRY[app_id]["actions"]:
        raise HTTPException(400, f"Action '{body.action}' not available for {APP_REGISTRY[app_id]['name']}")

    adapter = ADAPTERS.get(app_id)
    if not adapter:
        raise HTTPException(501, f"{APP_REGISTRY[app_id]['name']} adapter not yet implemented")

    try:
        result = await adapter(body.action, body.params, creds)
        return {"status": "ok", "app": app_id, "action": body.action, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Connector action failed: {app_id}/{body.action}")
        raise HTTPException(500, f"{APP_REGISTRY[app_id]['name']} error: {str(e)}")


# ── Adapter implementations ─────────────────────────────────────────────
# Each adapter is an async function: (action, params, creds) -> dict

async def _hubspot_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = "https://api.hubapi.com"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_contacts":
            limit = params.get("limit", 20)
            r = await client.get(f"{base}/crm/v3/objects/contacts?limit={limit}&properties=firstname,lastname,email,phone", headers=headers)
            r.raise_for_status()
            contacts = [{"id": c["id"], **c.get("properties", {})} for c in r.json().get("results", [])]
            return {"contacts": contacts, "count": len(contacts)}

        if action == "create_contact":
            props = {}
            if params.get("email"): props["email"] = params["email"]
            if params.get("firstname"): props["firstname"] = params["firstname"]
            if params.get("lastname"): props["lastname"] = params["lastname"]
            if params.get("phone"): props["phone"] = params["phone"]
            if params.get("name"):
                parts = params["name"].split(" ", 1)
                props["firstname"] = parts[0]
                if len(parts) > 1: props["lastname"] = parts[1]
            r = await client.post(f"{base}/crm/v3/objects/contacts", headers=headers, json={"properties": props})
            r.raise_for_status()
            return {"contact": r.json(), "message": "Contact created"}

        if action == "get_deals":
            limit = params.get("limit", 20)
            r = await client.get(f"{base}/crm/v3/objects/deals?limit={limit}&properties=dealname,amount,dealstage,closedate", headers=headers)
            r.raise_for_status()
            deals = [{"id": d["id"], **d.get("properties", {})} for d in r.json().get("results", [])]
            return {"deals": deals, "count": len(deals)}

        if action == "create_deal":
            props = {}
            if params.get("name"): props["dealname"] = params["name"]
            if params.get("amount"): props["amount"] = params["amount"]
            if params.get("stage"): props["dealstage"] = params["stage"]
            r = await client.post(f"{base}/crm/v3/objects/deals", headers=headers, json={"properties": props})
            r.raise_for_status()
            return {"deal": r.json(), "message": "Deal created"}

        if action == "search":
            query = params.get("query", "")
            r = await client.post(f"{base}/crm/v3/objects/contacts/search", headers=headers, json={"query": query, "limit": 10})
            r.raise_for_status()
            return {"results": r.json().get("results", []), "count": r.json().get("total", 0)}

    return {"error": f"Unknown action: {action}"}


async def _salesforce_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    instance = creds.get("instance_url", "").rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = f"{instance}/services/data/v59.0"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_leads":
            limit = params.get("limit", 20)
            r = await client.get(f"{base}/query?q=SELECT+Id,Name,Email,Phone,Status+FROM+Lead+LIMIT+{limit}", headers=headers)
            r.raise_for_status()
            return {"leads": r.json().get("records", []), "count": r.json().get("totalSize", 0)}

        if action == "create_lead":
            data = {"LastName": params.get("name", "Unknown")}
            if params.get("email"): data["Email"] = params["email"]
            if params.get("phone"): data["Phone"] = params["phone"]
            if params.get("company"): data["Company"] = params["company"]
            r = await client.post(f"{base}/sobjects/Lead", headers=headers, json=data)
            r.raise_for_status()
            return {"lead": r.json(), "message": "Lead created"}

        if action == "get_opportunities":
            limit = params.get("limit", 20)
            r = await client.get(f"{base}/query?q=SELECT+Id,Name,Amount,StageName+FROM+Opportunity+LIMIT+{limit}", headers=headers)
            r.raise_for_status()
            return {"opportunities": r.json().get("records", []), "count": r.json().get("totalSize", 0)}

        if action == "create_case":
            data = {"Subject": params.get("subject", "New Case")}
            if params.get("description"): data["Description"] = params["description"]
            r = await client.post(f"{base}/sobjects/Case", headers=headers, json=data)
            r.raise_for_status()
            return {"case": r.json(), "message": "Case created"}

        if action == "search":
            query = params.get("query", "")
            r = await client.get(f"{base}/search?q=FIND+{{{query}}}+IN+ALL+FIELDS+RETURNING+Lead,Contact,Opportunity", headers=headers)
            r.raise_for_status()
            return {"results": r.json().get("searchRecords", [])}

    return {"error": f"Unknown action: {action}"}


async def _pipedrive_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    base = "https://api.pipedrive.com/v1"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_deals":
            r = await client.get(f"{base}/deals?api_token={token}&limit={params.get('limit', 20)}")
            r.raise_for_status()
            return {"deals": r.json().get("data", []) or [], "count": len(r.json().get("data", []) or [])}

        if action == "create_deal":
            data = {"title": params.get("name", "New Deal")}
            if params.get("amount"): data["value"] = params["amount"]
            r = await client.post(f"{base}/deals?api_token={token}", json=data)
            r.raise_for_status()
            return {"deal": r.json().get("data"), "message": "Deal created"}

        if action == "get_persons":
            r = await client.get(f"{base}/persons?api_token={token}&limit={params.get('limit', 20)}")
            r.raise_for_status()
            return {"persons": r.json().get("data", []) or [], "count": len(r.json().get("data", []) or [])}

        if action == "create_person":
            data = {"name": params.get("name", "Unknown")}
            if params.get("email"): data["email"] = [{"value": params["email"]}]
            if params.get("phone"): data["phone"] = [{"value": params["phone"]}]
            r = await client.post(f"{base}/persons?api_token={token}", json=data)
            r.raise_for_status()
            return {"person": r.json().get("data"), "message": "Contact created"}

        if action == "search":
            query = params.get("query", "")
            r = await client.get(f"{base}/itemSearch?api_token={token}&term={query}")
            r.raise_for_status()
            return {"results": r.json().get("data", {}).get("items", [])}

    return {"error": f"Unknown action: {action}"}


async def _asana_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}"}
    base = "https://app.asana.com/api/1.0"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_tasks":
            project = params.get("project")
            if project:
                r = await client.get(f"{base}/projects/{project}/tasks?opt_fields=name,completed,due_on,assignee.name", headers=headers)
            else:
                r = await client.get(f"{base}/tasks?assignee=me&workspace={params.get('workspace', '')}&opt_fields=name,completed,due_on", headers=headers)
            r.raise_for_status()
            return {"tasks": r.json().get("data", []), "count": len(r.json().get("data", []))}

        if action == "create_task":
            data = {"data": {"name": params.get("name", "New Task")}}
            if params.get("project"): data["data"]["projects"] = [params["project"]]
            if params.get("due_on"): data["data"]["due_on"] = params["due_on"]
            if params.get("notes"): data["data"]["notes"] = params["notes"]
            r = await client.post(f"{base}/tasks", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json().get("data"), "message": "Task created"}

        if action == "get_projects":
            r = await client.get(f"{base}/projects?opt_fields=name,color,archived", headers=headers)
            r.raise_for_status()
            return {"projects": r.json().get("data", [])}

        if action == "update_task":
            task_id = params.get("task_id", "")
            data = {"data": {}}
            if params.get("completed") is not None: data["data"]["completed"] = params["completed"]
            if params.get("name"): data["data"]["name"] = params["name"]
            r = await client.put(f"{base}/tasks/{task_id}", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json().get("data"), "message": "Task updated"}

        if action == "search":
            r = await client.get(f"{base}/workspaces", headers=headers)
            r.raise_for_status()
            workspaces = r.json().get("data", [])
            if workspaces:
                ws = workspaces[0]["gid"]
                sr = await client.get(f"{base}/workspaces/{ws}/tasks/search?text={params.get('query', '')}", headers=headers)
                sr.raise_for_status()
                return {"results": sr.json().get("data", [])}
            return {"results": []}

    return {"error": f"Unknown action: {action}"}


async def _trello_adapter(action: str, params: dict, creds: dict) -> dict:
    key = creds["api_key"]
    token = creds["token"]
    base = "https://api.trello.com/1"
    auth = f"key={key}&token={token}"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_boards":
            r = await client.get(f"{base}/members/me/boards?{auth}&fields=name,url,closed")
            r.raise_for_status()
            return {"boards": r.json()}

        if action == "get_cards":
            board = params.get("board_id", "")
            r = await client.get(f"{base}/boards/{board}/cards?{auth}&fields=name,desc,due,idList,url")
            r.raise_for_status()
            return {"cards": r.json(), "count": len(r.json())}

        if action == "create_card":
            data = {"name": params.get("name", "New Card"), "idList": params.get("list_id", "")}
            if params.get("desc"): data["desc"] = params["desc"]
            if params.get("due"): data["due"] = params["due"]
            r = await client.post(f"{base}/cards?{auth}", json=data)
            r.raise_for_status()
            return {"card": r.json(), "message": "Card created"}

        if action == "move_card":
            card_id = params.get("card_id", "")
            r = await client.put(f"{base}/cards/{card_id}?{auth}", json={"idList": params.get("list_id", "")})
            r.raise_for_status()
            return {"card": r.json(), "message": "Card moved"}

        if action == "search":
            r = await client.get(f"{base}/search?{auth}&query={params.get('query', '')}&modelTypes=cards,boards")
            r.raise_for_status()
            return {"results": r.json()}

    return {"error": f"Unknown action: {action}"}


async def _notion_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Notion-Version": "2022-06-28"}
    base = "https://api.notion.com/v1"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "search":
            r = await client.post(f"{base}/search", headers=headers, json={"query": params.get("query", ""), "page_size": 20})
            r.raise_for_status()
            results = [{"id": p["id"], "title": p.get("properties", {}).get("title", {}).get("title", [{}])[0].get("plain_text", "") if p["object"] == "page" else p.get("title", [{}])[0].get("plain_text", ""), "type": p["object"]} for p in r.json().get("results", [])]
            return {"results": results, "count": len(results)}

        if action == "get_pages":
            r = await client.post(f"{base}/search", headers=headers, json={"filter": {"property": "object", "value": "page"}, "page_size": 20})
            r.raise_for_status()
            return {"pages": r.json().get("results", [])}

        if action == "create_page":
            page_data: dict[str, Any] = {"parent": {"page_id": params.get("parent_id", "")}, "properties": {"title": {"title": [{"text": {"content": params.get("title", "New Page")}}]}}}
            if params.get("content"):
                page_data["children"] = [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": params["content"]}}]}}]
            r = await client.post(f"{base}/pages", headers=headers, json=page_data)
            r.raise_for_status()
            return {"page": r.json(), "message": "Page created"}

        if action == "update_page":
            page_id = params.get("page_id", "")
            props = {}
            if params.get("title"):
                props["title"] = {"title": [{"text": {"content": params["title"]}}]}
            r = await client.patch(f"{base}/pages/{page_id}", headers=headers, json={"properties": props})
            r.raise_for_status()
            return {"page": r.json(), "message": "Page updated"}

        if action == "query_database":
            db_id = params.get("database_id", "")
            r = await client.post(f"{base}/databases/{db_id}/query", headers=headers, json={"page_size": params.get("limit", 20)})
            r.raise_for_status()
            return {"results": r.json().get("results", []), "count": len(r.json().get("results", []))}

    return {"error": f"Unknown action: {action}"}


async def _slack_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = "https://slack.com/api"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_channels":
            r = await client.get(f"{base}/conversations.list?limit=50", headers=headers)
            r.raise_for_status()
            channels = [{"id": c["id"], "name": c["name"]} for c in r.json().get("channels", [])]
            return {"channels": channels}

        if action == "send_message":
            channel = params.get("channel", "")
            text = params.get("text", "")
            # If channel is a name, find its ID
            if not channel.startswith("C") and not channel.startswith("D"):
                ch_r = await client.get(f"{base}/conversations.list?limit=200", headers=headers)
                ch_r.raise_for_status()
                for c in ch_r.json().get("channels", []):
                    if c["name"] == channel.lstrip("#"):
                        channel = c["id"]
                        break
            r = await client.post(f"{base}/chat.postMessage", headers=headers, json={"channel": channel, "text": text})
            r.raise_for_status()
            return {"message": "Message sent", "channel": channel}

        if action == "get_messages":
            channel = params.get("channel", "")
            r = await client.get(f"{base}/conversations.history?channel={channel}&limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            return {"messages": r.json().get("messages", [])}

        if action == "search":
            r = await client.get(f"{base}/search.messages?query={params.get('query', '')}&count=20", headers=headers)
            r.raise_for_status()
            return {"results": r.json().get("messages", {}).get("matches", [])}

    return {"error": f"Unknown action: {action}"}


async def _stripe_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}"}
    base = "https://api.stripe.com/v1"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_payments":
            r = await client.get(f"{base}/charges?limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            charges = [{"id": c["id"], "amount": c["amount"] / 100, "currency": c["currency"], "status": c["status"], "description": c.get("description")} for c in r.json().get("data", [])]
            return {"payments": charges, "count": len(charges)}

        if action == "get_customers":
            r = await client.get(f"{base}/customers?limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            customers = [{"id": c["id"], "name": c.get("name"), "email": c.get("email")} for c in r.json().get("data", [])]
            return {"customers": customers, "count": len(customers)}

        if action == "create_payment_link":
            data = {"line_items[0][price_data][currency]": params.get("currency", "usd"), "line_items[0][price_data][product_data][name]": params.get("name", "Payment"), "line_items[0][price_data][unit_amount]": int(float(params.get("amount", 0)) * 100), "line_items[0][quantity]": "1"}
            r = await client.post(f"{base}/payment_links", headers=headers, data=data)
            r.raise_for_status()
            return {"payment_link": r.json().get("url"), "id": r.json().get("id")}

        if action == "get_invoices":
            r = await client.get(f"{base}/invoices?limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            invoices = [{"id": i["id"], "amount_due": i["amount_due"] / 100, "status": i["status"], "customer": i.get("customer_name")} for i in r.json().get("data", [])]
            return {"invoices": invoices, "count": len(invoices)}

        if action == "get_balance":
            r = await client.get(f"{base}/balance", headers=headers)
            r.raise_for_status()
            available = sum(b["amount"] for b in r.json().get("available", []))
            pending = sum(b["amount"] for b in r.json().get("pending", []))
            return {"available": available / 100, "pending": pending / 100, "currency": r.json().get("available", [{}])[0].get("currency", "usd")}

    return {"error": f"Unknown action: {action}"}


async def _shopify_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    store = creds.get("store_url", "").rstrip("/")
    if not store.startswith("https://"): store = f"https://{store}"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    base = f"{store}/admin/api/2024-01"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_orders":
            r = await client.get(f"{base}/orders.json?status=any&limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            orders = [{"id": o["id"], "name": o["name"], "total": o["total_price"], "status": o["financial_status"], "customer": o.get("customer", {}).get("first_name", "")} for o in r.json().get("orders", [])]
            return {"orders": orders, "count": len(orders)}

        if action == "get_products":
            r = await client.get(f"{base}/products.json?limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            products = [{"id": p["id"], "title": p["title"], "status": p["status"], "price": p.get("variants", [{}])[0].get("price")} for p in r.json().get("products", [])]
            return {"products": products, "count": len(products)}

        if action == "get_customers":
            r = await client.get(f"{base}/customers.json?limit={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            customers = [{"id": c["id"], "name": f"{c.get('first_name', '')} {c.get('last_name', '')}", "email": c.get("email"), "orders_count": c.get("orders_count")} for c in r.json().get("customers", [])]
            return {"customers": customers, "count": len(customers)}

        if action == "create_product":
            data = {"product": {"title": params.get("title", "New Product"), "body_html": params.get("description", ""), "variants": [{"price": params.get("price", "0")}]}}
            r = await client.post(f"{base}/products.json", headers=headers, json=data)
            r.raise_for_status()
            return {"product": r.json().get("product"), "message": "Product created"}

        if action == "get_inventory":
            r = await client.get(f"{base}/products.json?limit=50", headers=headers)
            r.raise_for_status()
            inventory = [{"title": p["title"], "variants": [{"sku": v.get("sku"), "inventory": v.get("inventory_quantity")} for v in p.get("variants", [])]} for p in r.json().get("products", [])]
            return {"inventory": inventory}

    return {"error": f"Unknown action: {action}"}


async def _clickup_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": token, "Content-Type": "application/json"}
    base = "https://api.clickup.com/api/v2"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_tasks":
            list_id = params.get("list_id", "")
            r = await client.get(f"{base}/list/{list_id}/task", headers=headers)
            r.raise_for_status()
            return {"tasks": r.json().get("tasks", [])}

        if action == "create_task":
            list_id = params.get("list_id", "")
            data = {"name": params.get("name", "New Task")}
            if params.get("description"): data["description"] = params["description"]
            if params.get("due_date"): data["due_date"] = params["due_date"]
            r = await client.post(f"{base}/list/{list_id}/task", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json(), "message": "Task created"}

        if action == "get_spaces":
            # First get teams
            tr = await client.get(f"{base}/team", headers=headers)
            tr.raise_for_status()
            teams = tr.json().get("teams", [])
            if teams:
                sr = await client.get(f"{base}/team/{teams[0]['id']}/space", headers=headers)
                sr.raise_for_status()
                return {"spaces": sr.json().get("spaces", [])}
            return {"spaces": []}

        if action == "update_task":
            task_id = params.get("task_id", "")
            data = {}
            if params.get("name"): data["name"] = params["name"]
            if params.get("status"): data["status"] = params["status"]
            r = await client.put(f"{base}/task/{task_id}", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json(), "message": "Task updated"}

        if action == "search":
            tr = await client.get(f"{base}/team", headers=headers)
            tr.raise_for_status()
            teams = tr.json().get("teams", [])
            if teams:
                r = await client.get(f"{base}/team/{teams[0]['id']}/task?name={params.get('query', '')}", headers=headers)
                r.raise_for_status()
                return {"results": r.json().get("tasks", [])}
            return {"results": []}

    return {"error": f"Unknown action: {action}"}


async def _todoist_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = "https://api.todoist.com/rest/v2"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_tasks":
            r = await client.get(f"{base}/tasks", headers=headers)
            r.raise_for_status()
            tasks = [{"id": t["id"], "content": t["content"], "due": t.get("due", {}).get("string") if t.get("due") else None, "completed": t.get("is_completed", False)} for t in r.json()]
            return {"tasks": tasks, "count": len(tasks)}

        if action == "create_task":
            data = {"content": params.get("name", "New Task")}
            if params.get("due"): data["due_string"] = params["due"]
            if params.get("project_id"): data["project_id"] = params["project_id"]
            r = await client.post(f"{base}/tasks", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json(), "message": "Task created"}

        if action == "update_task":
            task_id = params.get("task_id", "")
            data = {}
            if params.get("content"): data["content"] = params["content"]
            if params.get("due"): data["due_string"] = params["due"]
            r = await client.post(f"{base}/tasks/{task_id}", headers=headers, json=data)
            r.raise_for_status()
            return {"task": r.json(), "message": "Task updated"}

        if action == "get_projects":
            r = await client.get(f"{base}/projects", headers=headers)
            r.raise_for_status()
            return {"projects": r.json()}

    return {"error": f"Unknown action: {action}"}


async def _jira_adapter(action: str, params: dict, creds: dict) -> dict:
    import base64
    email = creds.get("email", "")
    token = creds["api_key"]
    domain = creds.get("domain", "").rstrip("/")
    if not domain.startswith("https://"): domain = f"https://{domain}"
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    base = f"{domain}/rest/api/3"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_issues":
            jql = params.get("jql", "assignee=currentUser() ORDER BY updated DESC")
            r = await client.get(f"{base}/search?jql={jql}&maxResults={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            issues = [{"key": i["key"], "summary": i["fields"]["summary"], "status": i["fields"]["status"]["name"], "type": i["fields"]["issuetype"]["name"]} for i in r.json().get("issues", [])]
            return {"issues": issues, "count": r.json().get("total", 0)}

        if action == "create_issue":
            data = {"fields": {"project": {"key": params.get("project", "")}, "summary": params.get("summary", "New Issue"), "issuetype": {"name": params.get("type", "Task")}}}
            if params.get("description"): data["fields"]["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": params["description"]}]}]}
            r = await client.post(f"{base}/issue", headers=headers, json=data)
            r.raise_for_status()
            return {"issue": r.json(), "message": f"Issue {r.json().get('key')} created"}

        if action == "update_issue":
            issue_key = params.get("issue_key", "")
            data = {"fields": {}}
            if params.get("summary"): data["fields"]["summary"] = params["summary"]
            if params.get("status"):
                # Get transitions
                tr = await client.get(f"{base}/issue/{issue_key}/transitions", headers=headers)
                tr.raise_for_status()
                for t in tr.json().get("transitions", []):
                    if t["name"].lower() == params["status"].lower():
                        await client.post(f"{base}/issue/{issue_key}/transitions", headers=headers, json={"transition": {"id": t["id"]}})
                        return {"message": f"Issue {issue_key} moved to {params['status']}"}
            r = await client.put(f"{base}/issue/{issue_key}", headers=headers, json=data)
            r.raise_for_status()
            return {"message": f"Issue {issue_key} updated"}

        if action == "search":
            jql = f'text ~ "{params.get("query", "")}"'
            r = await client.get(f"{base}/search?jql={jql}&maxResults=20", headers=headers)
            r.raise_for_status()
            return {"results": [{"key": i["key"], "summary": i["fields"]["summary"]} for i in r.json().get("issues", [])]}

        if action == "get_projects":
            r = await client.get(f"{base}/project", headers=headers)
            r.raise_for_status()
            return {"projects": [{"key": p["key"], "name": p["name"]} for p in r.json()]}

    return {"error": f"Unknown action: {action}"}


async def _linear_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": token, "Content-Type": "application/json"}
    base = "https://api.linear.app/graphql"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_issues":
            query = '{ issues(first: 20, orderBy: updatedAt) { nodes { id identifier title state { name } priority assignee { name } } } }'
            r = await client.post(base, headers=headers, json={"query": query})
            r.raise_for_status()
            issues = r.json().get("data", {}).get("issues", {}).get("nodes", [])
            return {"issues": [{"id": i["id"], "key": i["identifier"], "title": i["title"], "status": i.get("state", {}).get("name")} for i in issues]}

        if action == "create_issue":
            query = 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier title } } }'
            variables = {"input": {"title": params.get("title", "New Issue"), "teamId": params.get("team_id", "")}}
            if params.get("description"): variables["input"]["description"] = params["description"]
            r = await client.post(base, headers=headers, json={"query": query, "variables": variables})
            r.raise_for_status()
            issue = r.json().get("data", {}).get("issueCreate", {}).get("issue", {})
            return {"issue": issue, "message": f"Issue {issue.get('identifier')} created"}

        if action == "update_issue":
            issue_id = params.get("issue_id", "")
            query = 'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { issue { id identifier title state { name } } } }'
            inp: dict[str, Any] = {}
            if params.get("title"): inp["title"] = params["title"]
            if params.get("state_id"): inp["stateId"] = params["state_id"]
            r = await client.post(base, headers=headers, json={"query": query, "variables": {"id": issue_id, "input": inp}})
            r.raise_for_status()
            return {"issue": r.json().get("data", {}).get("issueUpdate", {}).get("issue"), "message": "Issue updated"}

        if action == "search":
            query_text = params.get("query", "")
            gql = f'{{ issueSearch(query: "{query_text}", first: 20) {{ nodes {{ id identifier title state {{ name }} }} }} }}'
            r = await client.post(base, headers=headers, json={"query": gql})
            r.raise_for_status()
            return {"results": r.json().get("data", {}).get("issueSearch", {}).get("nodes", [])}

    return {"error": f"Unknown action: {action}"}


async def _webhook_adapter(action: str, params: dict, creds: dict) -> dict:
    """Generic webhook adapter for Zapier, Make, n8n, IFTTT."""
    url = creds.get("webhook_url", "")
    if not url:
        return {"error": "No webhook URL configured"}

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "trigger_webhook":
            payload = params.get("data", params)
            # For IFTTT, append event name
            if creds.get("event_name"):
                url = url.replace("{event}", creds["event_name"])
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return {"message": "Webhook triggered successfully", "status_code": r.status_code}

    return {"error": f"Unknown action: {action}"}


async def _telegram_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    base = f"https://api.telegram.org/bot{token}"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "send_message":
            chat_id = params.get("chat_id", "")
            text = params.get("text", "")
            r = await client.post(f"{base}/sendMessage", json={"chat_id": chat_id, "text": text})
            r.raise_for_status()
            return {"message": "Message sent", "result": r.json().get("result")}

        if action == "get_updates":
            r = await client.get(f"{base}/getUpdates?limit=20")
            r.raise_for_status()
            return {"updates": r.json().get("result", [])}

    return {"error": f"Unknown action: {action}"}


async def _airtable_adapter(action: str, params: dict, creds: dict) -> dict:
    token = creds["api_key"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base_id = params.get("base_id", "")
    table = params.get("table", "")
    base = f"https://api.airtable.com/v0/{base_id}/{table}"

    async with httpx.AsyncClient(timeout=30) as client:
        if action == "get_records":
            r = await client.get(f"{base}?maxRecords={params.get('limit', 20)}", headers=headers)
            r.raise_for_status()
            return {"records": r.json().get("records", []), "count": len(r.json().get("records", []))}

        if action == "create_record":
            fields = params.get("fields", {})
            r = await client.post(base, headers=headers, json={"fields": fields})
            r.raise_for_status()
            return {"record": r.json(), "message": "Record created"}

        if action == "update_record":
            record_id = params.get("record_id", "")
            fields = params.get("fields", {})
            r = await client.patch(f"{base}/{record_id}", headers=headers, json={"fields": fields})
            r.raise_for_status()
            return {"record": r.json(), "message": "Record updated"}

        if action == "search":
            formula = f'SEARCH("{params.get("query", "")}", ARRAYJOIN({{Name}}))'
            r = await client.get(f"{base}?filterByFormula={formula}&maxRecords=20", headers=headers)
            r.raise_for_status()
            return {"results": r.json().get("records", [])}

    return {"error": f"Unknown action: {action}"}


# Generic adapter for apps that just need basic REST calls
async def _generic_rest_adapter(app_id: str, action: str, params: dict, creds: dict) -> dict:
    """Placeholder adapter — returns a helpful message about the app not being fully implemented."""
    app_name = APP_REGISTRY.get(app_id, {}).get("name", app_id)
    return {
        "message": f"{app_name} is connected but this action ({action}) is coming soon. For now, you can use Zapier webhooks to trigger {app_name} actions.",
        "connected": True,
        "action": action,
    }


# ── Adapter map ──────────────────────────────────────────────────────────

ADAPTERS: dict[str, Any] = {
    # CRM
    "hubspot": _hubspot_adapter,
    "salesforce": _salesforce_adapter,
    "pipedrive": _pipedrive_adapter,
    # PM
    "asana": _asana_adapter,
    "trello": _trello_adapter,
    "notion": _notion_adapter,
    "clickup": _clickup_adapter,
    "todoist": _todoist_adapter,
    "jira": _jira_adapter,
    "linear": _linear_adapter,
    # Communication
    "slack": _slack_adapter,
    "telegram": _telegram_adapter,
    # E-commerce
    "stripe": _stripe_adapter,
    "shopify": _shopify_adapter,
    # Storage
    "airtable": _airtable_adapter,
    # Automation
    "zapier": _webhook_adapter,
    "make": _webhook_adapter,
    "n8n": _webhook_adapter,
    "ifttt": _webhook_adapter,
}

# Fill in generic adapter for all apps without a specific implementation
for _app_id in APP_REGISTRY:
    if _app_id not in ADAPTERS:
        ADAPTERS[_app_id] = lambda action, params, creds, aid=_app_id: _generic_rest_adapter(aid, action, params, creds)
