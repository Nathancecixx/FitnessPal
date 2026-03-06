from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session, init_db, session_scope
from app.core.schemas import AgentManifest, DashboardCardState
from app.core.security import Actor, ensure_admin_user, get_actor
from app.core.storage import ensure_storage_dirs
from app.modules import load_manifests


settings = get_settings()
manifests = load_manifests()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_storage_dirs()
    init_db()
    with session_scope() as session:
        ensure_admin_user(session)
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
        "agent_manifest": settings.agent_manifest_url,
    }


@app.get("/.well-known/fitnesspal-agent.json", response_model=AgentManifest)
def agent_manifest() -> AgentManifest:
    resources = []
    examples = []
    for manifest in manifests:
        routes = []
        for route in manifest.router.routes:
            methods = sorted(method for method in getattr(route, "methods", []) if method != "HEAD")
            if not methods:
                continue
            routes.append({"path": f"{settings.api_prefix}{route.path}", "methods": methods})
        resources.append({"module": manifest.key, "routes": routes})
        examples.extend(manifest.agent_examples)
    return AgentManifest(
        name=settings.app_name,
        version="0.1.0",
        base_url=settings.agent_manifest_url.rsplit("/.well-known", 1)[0],
        auth={"type": "bearer_api_key", "login": f"{settings.api_prefix}/auth/login"},
        capabilities=["nutrition", "training", "weight", "insights", "exports", "assistant"],
        resources=resources,
        examples=examples,
    )


app.include_router(api_router)
