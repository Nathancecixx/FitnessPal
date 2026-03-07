from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.core.config import ensure_secure_runtime_settings, get_settings
from app.core.database import get_session, init_db, session_scope
from app.core.local_ai import ensure_ai_defaults
from app.core.schemas import DashboardCardState
from app.core.security import Actor, ensure_admin_user, get_actor
from app.core.storage import ensure_storage_dirs
from app.modules import load_manifests


settings = get_settings()
manifests = load_manifests()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_secure_runtime_settings()
    ensure_storage_dirs()
    init_db()
    with session_scope() as session:
        ensure_admin_user(session)
        ensure_ai_defaults(session)
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    openapi_url=f"{settings.api_prefix}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allow_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_api_security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(settings.api_prefix):
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Pragma", "no-cache")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response

api_router = APIRouter(prefix=settings.api_prefix)
for manifest in manifests:
    api_router.include_router(manifest.router)


@api_router.get("/dashboard")
def get_dashboard(session: Session = Depends(get_session), actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    cards: list[DashboardCardState] = []
    for manifest in manifests:
        if manifest.dashboard_loader:
            cards.extend(manifest.dashboard_loader(session, actor))
    cards.sort(key=lambda card: card.priority, reverse=True)
    return {
        "cards": [card.model_dump() for card in cards],
        "available_modules": [manifest.key for manifest in manifests],
    }


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "api": settings.api_prefix,
    }


app.include_router(api_router)
