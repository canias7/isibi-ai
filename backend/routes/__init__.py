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
]
