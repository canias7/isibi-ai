"""Central router registry — keeps main.py clean."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def register_all_routers(app):
    """Register all API routers on the FastAPI app."""
    from routes import all_routers

    # Core routes (from routes/__init__.py)
    for router in all_routers:
        app.include_router(router, prefix="/api")

    # Feature routers grouped by category
    _register_content_routers(app)
    _register_app_feature_routers(app)
    _register_automation_routers(app)
    _register_analytics_routers(app)
    _register_security_routers(app)
    _register_collaboration_routers(app)
    _register_enterprise_routers(app)

    logger.info("All routers registered successfully")


def _register_content_routers(app):
    """Content management: gallery, plugins, components, reviews, etc."""
    from routes.generated_files import router as generated_files_router
    from routes.gallery import router as gallery_router
    from routes.referrals import router as referrals_router
    from routes.embed import router as embed_router
    from routes.suggestions import router as suggestions_router
    from routes.auto_fix import router as auto_fix_router
    from routes.i18n import router as i18n_router
    from routes.plugins import router as plugins_router, project_plugins_router
    from routes.components import router as components_router
    from routes.cloning import router as cloning_router
    from routes.reviews import router as reviews_router
    from routes.file_serve import router as file_serve_router

    app.include_router(generated_files_router, prefix="/api")
    app.include_router(gallery_router, prefix="/api")
    app.include_router(referrals_router, prefix="/api")
    app.include_router(embed_router, prefix="/api")
    app.include_router(suggestions_router, prefix="/api")
    app.include_router(auto_fix_router, prefix="/api")
    app.include_router(i18n_router, prefix="/api")
    app.include_router(plugins_router, prefix="/api")
    app.include_router(project_plugins_router, prefix="/api")
    app.include_router(components_router, prefix="/api")
    app.include_router(cloning_router, prefix="/api")
    app.include_router(reviews_router, prefix="/api")
    app.include_router(file_serve_router, prefix="/api")


def _register_app_feature_routers(app):
    """App-level features: roles, import, comments, files, messaging, etc."""
    from routes.webhooks import router as webhooks_router
    from routes.api_keys import router as api_keys_router
    from routes.preferences import router as preferences_router
    from routes.db_gui import router as db_gui_router
    from routes.serverless import router as serverless_router
    from routes.billing_check import router as billing_check_router
    from routes.app_subdomain import router as app_subdomain_router
    from routes.app_ai_chat import router as app_ai_chat_router
    from routes.app_dashboard import router as app_dashboard_router
    from routes.app_branding import router as app_branding_router
    from routes.app_roles import router as app_roles_router
    from routes.app_import_wizard import router as app_import_wizard_router
    from routes.app_activity_log import router as app_activity_log_router
    from routes.app_record_comments import router as app_record_comments_router
    from routes.app_record_files import router as app_record_files_router
    from routes.app_messaging import router as app_messaging_router
    from routes.app_email_inbox import router as app_email_inbox_router
    from routes.app_snapshots import router as app_snapshots_router
    from routes.app_ui_language import router as app_ui_language_router

    # Form/input feature routers
    from routes.app_multistep_forms import router as app_multistep_forms_router
    from routes.app_field_files import router as app_field_files_router
    from routes.app_signatures import router as app_signatures_router
    from routes.app_qr_codes import router as app_qr_codes_router
    from routes.app_barcode import router as app_barcode_router
    from routes.app_voice_config import router as app_voice_config_router
    from routes.app_field_types import router as app_field_types_router
    from routes.app_view_configs import router as app_view_configs_router
    from routes.app_workflows import router as app_workflows_router
    from routes.desktop_download import router as desktop_download_router
    from routes.control_center_download import router as control_center_router

    app.include_router(webhooks_router, prefix="/api")
    app.include_router(api_keys_router, prefix="/api")
    app.include_router(preferences_router, prefix="/api")
    app.include_router(db_gui_router, prefix="/api")
    app.include_router(serverless_router, prefix="/api")
    app.include_router(billing_check_router, prefix="/api")
    app.include_router(app_subdomain_router, prefix="/api")
    app.include_router(app_ai_chat_router, prefix="/api")
    app.include_router(app_dashboard_router, prefix="/api")
    app.include_router(app_branding_router, prefix="/api")
    app.include_router(app_roles_router, prefix="/api")
    app.include_router(app_import_wizard_router, prefix="/api")
    app.include_router(app_activity_log_router, prefix="/api")
    app.include_router(app_record_comments_router, prefix="/api")
    app.include_router(app_record_files_router, prefix="/api")
    app.include_router(app_messaging_router, prefix="/api")
    app.include_router(app_email_inbox_router, prefix="/api")
    app.include_router(app_snapshots_router, prefix="/api")
    app.include_router(app_ui_language_router, prefix="/api")

    # Form/input features
    app.include_router(app_multistep_forms_router, prefix="/api")
    app.include_router(app_field_files_router, prefix="/api")
    app.include_router(app_signatures_router, prefix="/api")
    app.include_router(app_qr_codes_router, prefix="/api")
    app.include_router(app_barcode_router, prefix="/api")
    app.include_router(app_voice_config_router, prefix="/api")
    app.include_router(app_field_types_router, prefix="/api")
    app.include_router(app_view_configs_router, prefix="/api")
    app.include_router(app_workflows_router, prefix="/api")
    app.include_router(desktop_download_router, prefix="/api")
    app.include_router(control_center_router, prefix="/api")


def _register_automation_routers(app):
    """Automation: email triggers, webhooks, scheduled reports, auto-assign, etc."""
    from routes.app_email_triggers import router as app_email_triggers_router
    from routes.app_scheduled_reports import router as app_scheduled_reports_router
    from routes.app_webhook_config import router as app_webhook_config_router
    from routes.app_auto_assign import router as app_auto_assign_router
    from routes.app_deadline_reminders import router as app_deadline_reminders_router
    from routes.app_status_rules import router as app_status_rules_router
    from routes.app_duplicate_detection import router as app_duplicate_detection_router
    from routes.app_scheduled_commands import router as app_scheduled_commands_router

    app.include_router(app_email_triggers_router, prefix="/api")
    app.include_router(app_scheduled_reports_router, prefix="/api")
    app.include_router(app_scheduled_commands_router, prefix="/api")
    app.include_router(app_webhook_config_router, prefix="/api")
    app.include_router(app_auto_assign_router, prefix="/api")
    app.include_router(app_deadline_reminders_router, prefix="/api")
    app.include_router(app_status_rules_router, prefix="/api")
    app.include_router(app_duplicate_detection_router, prefix="/api")


def _register_analytics_routers(app):
    """Analytics: events, reports, goals, funnels, cohorts, dashboards, exports."""
    from routes.app_analytics import router as app_analytics_router
    from routes.push_notifications import router as push_notifications_router
    from routes.app_report_builder import router as app_report_builder_router
    from routes.app_goals import router as app_goals_router
    from routes.app_funnels import router as app_funnels_router
    from routes.app_cohorts import router as app_cohorts_router
    from routes.app_excel_export import router as app_excel_export_router
    from routes.app_dashboard_builder import router as app_dashboard_builder_router

    app.include_router(app_analytics_router)  # Uses raw /api paths internally
    app.include_router(push_notifications_router)  # Uses raw /api paths internally
    app.include_router(app_report_builder_router, prefix="/api")
    app.include_router(app_goals_router, prefix="/api")
    app.include_router(app_funnels_router, prefix="/api")
    app.include_router(app_cohorts_router, prefix="/api")
    app.include_router(app_excel_export_router, prefix="/api")
    app.include_router(app_dashboard_builder_router, prefix="/api")


def _register_security_routers(app):
    """Security: IP whitelist, encryption, GDPR, sessions, 2FA."""
    from routes.app_ip_whitelist import router as app_ip_whitelist_router
    from routes.app_encryption import router as app_encryption_router
    from routes.app_gdpr import router as app_gdpr_router
    from routes.app_sessions import router as app_sessions_router
    from routes.app_2fa import router as app_2fa_router

    app.include_router(app_ip_whitelist_router, prefix="/api")
    app.include_router(app_encryption_router, prefix="/api")
    app.include_router(app_gdpr_router, prefix="/api")
    app.include_router(app_sessions_router, prefix="/api")
    app.include_router(app_2fa_router, prefix="/api")


def _register_collaboration_routers(app):
    """Collaboration: real-time editing, integrations, shared views, Google Sheets."""
    from routes.app_collaboration import router as app_collaboration_router
    from routes.app_integrations import router as app_integrations_router
    from routes.collab_editing import router as collab_editing_router, ws_router as collab_ws_router
    from routes.app_google_sheets import router as app_google_sheets_router
    from routes.app_embeds import public_router as app_embeds_public_router

    app.include_router(app_collaboration_router, prefix="/api")
    app.include_router(app_integrations_router, prefix="/api")
    app.include_router(collab_editing_router, prefix="/api")
    app.include_router(collab_ws_router)  # WebSocket at /ws/projects/{id}, no /api prefix
    app.include_router(app_google_sheets_router, prefix="/api")

    from routes.app_calendar_export import router as app_calendar_export_router
    app.include_router(app_calendar_export_router, prefix="/api")
    # Public embeds router (no auth, no /api prefix)
    app.include_router(app_embeds_public_router)


def _register_enterprise_routers(app):
    """Enterprise: custom domains, SSO, uptime monitoring."""
    from routes.custom_domain_ssl import router as custom_domain_ssl_router
    from routes.enterprise_sso import router as enterprise_sso_router
    from routes.app_uptime import router as app_uptime_router

    app.include_router(custom_domain_ssl_router, prefix="/api")
    app.include_router(enterprise_sso_router, prefix="/api")
    app.include_router(app_uptime_router, prefix="/api")
