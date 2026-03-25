from .leads import router as leads_router
from .tasks import router as tasks_router
from .deals import router as deals_router
from .users import router as users_router
from .conversations import router as conversations_router
from .pipeline_stages import router as pipeline_stages_router
from .generator import router as generator_router
from .auth import router as auth_router

all_routers = [
    auth_router,
    leads_router,
    tasks_router,
    deals_router,
    users_router,
    conversations_router,
    pipeline_stages_router,
    generator_router,
]
