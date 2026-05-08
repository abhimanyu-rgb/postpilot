from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.backend.api.analytics import router as analytics_router
from app.backend.api.auth import router as auth_router
from app.backend.api.campaigns import router as campaigns_router
from app.backend.api.drafts import router as drafts_router
from app.backend.api.runs import router as runs_router
from app.backend.api.setup import router as setup_router
from app.backend.core.config import settings
from app.backend.core.logging import setup_logging
from app.backend.core.scheduler import shutdown_scheduler, start_scheduler
from app.backend.core.storage import LocalStorageManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage = LocalStorageManager(settings.data_dir)
    storage.ensure_dirs()
    setup_logging(settings.data_dir, settings.log_level)
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title="PostPilot", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(setup_router)
app.include_router(auth_router)
app.include_router(campaigns_router)
app.include_router(runs_router)
app.include_router(drafts_router)
app.include_router(analytics_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
