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
from .csv_io import router as csv_router
from .audit_log import router as audit_log_router
from .two_factor import router as two_factor_router
from .affiliates import router as affiliates_router
from .credits import router as credits_router
from .notifications import router as notifications_router
from .comments import router as comments_router
from .sharing import router as sharing_router
from .team_activity import router as team_activity_router
from .scheduled_tasks import router as scheduled_tasks_router
from .email_templates import router as email_templates_router
from .template_marketplace import router as template_marketplace_router
from .white_label import router as white_label_router
from .app_embeds import router as app_embeds_router
from .app_embeds import public_router as app_embeds_public_router
from .app_api_docs import router as app_api_docs_router

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
    csv_router,
    audit_log_router,
    two_factor_router,
    affiliates_router,
    credits_router,
    notifications_router,
    comments_router,
    sharing_router,
    team_activity_router,
    scheduled_tasks_router,
    email_templates_router,
    template_marketplace_router,
    white_label_router,
    app_embeds_router,
    app_api_docs_router,
]
