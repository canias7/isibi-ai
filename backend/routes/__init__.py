from .leads import router as leads_router
from .tasks import router as tasks_router
from .deals import router as deals_router
from .users import router as users_router
from .conversations import router as conversations_router
from .pipeline_stages import router as pipeline_stages_router
from .generator import router as generator_router
from .auth import router as auth_router
from .chat import router as chat_router
from .app_data import router as app_data_router
from .versions import router as versions_router
from .github_export import router as github_export_router
from .deploy import router as deploy_router
from .file_storage import router as file_storage_router
from .app_auth import router as app_auth_router
from .stripe_integration import router as stripe_router
from .collaboration import router as collaboration_router
from .custom_domains import router as custom_domains_router
from .figma_import import router as figma_import_router
from .preview_stream import router as preview_stream_router
from .pricing import router as pricing_router
from .templates import router as templates_router
from .whitelabel import router as whitelabel_router
from .gallery import router as gallery_router
from .referrals import router as referrals_router
from .embed import router as embed_router
from .webhooks import router as webhooks_router
from .api_keys import router as api_keys_router
from .csv_io import router as csv_router
from .audit_log import router as audit_log_router
from .two_factor import router as two_factor_router
from .preferences import router as preferences_router
from .suggestions import router as suggestions_router
from .auto_fix import router as auto_fix_router
from .i18n import router as i18n_router
from .affiliates import router as affiliates_router
from .credits import router as credits_router
from .notifications import router as notifications_router
from .comments import router as comments_router
from .sharing import router as sharing_router
from .team_activity import router as team_activity_router
from .scheduled_tasks import router as scheduled_tasks_router
from .email_templates import router as email_templates_router
from .plugins import router as plugins_router
from .components import router as components_router
from .cloning import router as cloning_router
from .reviews import router as reviews_router
from .app_analytics import router as app_analytics_router
from .db_gui import router as db_gui_router
from .push_notifications import router as push_notifications_router
from .serverless import router as serverless_router

all_routers = [
    auth_router,
    leads_router,
    tasks_router,
    deals_router,
    users_router,
    conversations_router,
    pipeline_stages_router,
    generator_router,
    chat_router,
    app_data_router,
    versions_router,
    github_export_router,
    deploy_router,
    file_storage_router,
    app_auth_router,
    stripe_router,
    collaboration_router,
    custom_domains_router,
    figma_import_router,
    preview_stream_router,
    pricing_router,
    templates_router,
    whitelabel_router,
    gallery_router,
    referrals_router,
    embed_router,
    webhooks_router,
    api_keys_router,
    csv_router,
    audit_log_router,
    two_factor_router,
    preferences_router,
    suggestions_router,
    auto_fix_router,
    i18n_router,
    affiliates_router,
    credits_router,
    notifications_router,
    comments_router,
    sharing_router,
    team_activity_router,
    scheduled_tasks_router,
    email_templates_router,
    plugins_router,
    components_router,
    cloning_router,
    reviews_router,
    app_analytics_router,
    db_gui_router,
    push_notifications_router,
    serverless_router,
]
