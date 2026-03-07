from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.local_ai import (
    AI_FEATURE_KEYS,
    AiConfigurationError,
    AiProfileReadOnlyError,
    create_profile,
    delete_profile,
    generate_coach_advice,
    get_feature_bindings,
    get_latest_coach_brief,
    get_persona_config,
    get_profile,
    list_profiles,
    refresh_coach_brief,
    refresh_profile_models,
    serialize_coach_brief,
    serialize_profile_summary,
    serialize_persona,
    test_profile,
    update_persona,
    update_profile,
    upsert_feature_bindings,
)
from app.core.models import InsightSnapshot
from app.core.modules import ModuleManifest
from app.core.security import Actor, require_admin, require_scope


router = APIRouter(route_class=IdempotentRoute, tags=["ai"])
assistant_use = require_scope("assistant:use")


class AiProfileCreate(BaseModel):
    name: str
    provider: str
    base_url: str
    description: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    timeout_seconds: int = 60
    is_enabled: bool = True
    default_headers_json: dict[str, Any] = Field(default_factory=dict)
    advanced_settings_json: dict[str, Any] = Field(default_factory=dict)


class AiProfileUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None
    description: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    default_model: str | None = None
    timeout_seconds: int | None = None
    is_enabled: bool | None = None
    default_headers_json: dict[str, Any] | None = None
    advanced_settings_json: dict[str, Any] | None = None


class AiFeatureBindingUpdate(BaseModel):
    feature_key: str
    profile_id: str | None = None
    model: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_output_tokens: int | None = None
    system_prompt: str | None = None
    request_overrides_json: dict[str, Any] = Field(default_factory=dict)


class AiFeatureBindingBatchUpdate(BaseModel):
    items: list[AiFeatureBindingUpdate]


class AiPersonaUpdate(BaseModel):
    display_name: str
    tagline: str
    system_prompt: str
    voice_guidelines_json: dict[str, Any] = Field(default_factory=dict)


class AssistantCoachAdviceRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1200)


def _as_http_error(error: Exception) -> HTTPException:
    if isinstance(error, AiProfileReadOnlyError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, AiConfigurationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))


@router.get("/ai/profiles")
def list_ai_profiles(_: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {"items": list_profiles(session), "features": list(AI_FEATURE_KEYS)}


@router.post("/ai/profiles", status_code=status.HTTP_201_CREATED)
def create_ai_profile(
    payload: AiProfileCreate,
    actor: Actor = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        result = create_profile(
            session,
            name=payload.name,
            provider=payload.provider,
            base_url=payload.base_url,
            description=payload.description,
            api_key=payload.api_key,
            default_model=payload.default_model,
            timeout_seconds=payload.timeout_seconds,
            is_enabled=payload.is_enabled,
            default_headers_json=payload.default_headers_json,
            advanced_settings_json=payload.advanced_settings_json,
        )
    except Exception as error:
        raise _as_http_error(error) from error
    write_audit(session, actor, "ai_profile.created", "ai_profile", result["id"], {"provider": result["provider"], "name": result["name"]})
    return result


@router.get("/ai/profiles/{profile_id}")
def get_ai_profile(profile_id: str, _: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return {"profile": serialize_profile_summary(get_profile(session, profile_id))}
    except Exception as error:
        raise _as_http_error(error) from error


@router.patch("/ai/profiles/{profile_id}")
def update_ai_profile(
    profile_id: str,
    payload: AiProfileUpdate,
    actor: Actor = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        result = update_profile(session, profile_id, **payload.model_dump())
    except Exception as error:
        raise _as_http_error(error) from error
    write_audit(session, actor, "ai_profile.updated", "ai_profile", profile_id, {"name": result["name"], "provider": result["provider"]})
    return result


@router.delete("/ai/profiles/{profile_id}")
def delete_ai_profile(
    profile_id: str,
    actor: Actor = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        delete_profile(session, profile_id)
    except Exception as error:
        raise _as_http_error(error) from error
    write_audit(session, actor, "ai_profile.deleted", "ai_profile", profile_id, {})
    return {"status": "deleted", "id": profile_id}


@router.post("/ai/profiles/{profile_id}/test")
def test_ai_profile(profile_id: str, _: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return test_profile(session, profile_id)
    except Exception as error:
        raise _as_http_error(error) from error


@router.post("/ai/profiles/{profile_id}/models/refresh")
def refresh_ai_profile_models(profile_id: str, _: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return refresh_profile_models(session, profile_id)
    except Exception as error:
        raise _as_http_error(error) from error


@router.get("/ai/features")
def list_ai_feature_bindings(_: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {"items": get_feature_bindings(session), "features": list(AI_FEATURE_KEYS)}


@router.put("/ai/features")
def update_ai_feature_bindings(
    payload: AiFeatureBindingBatchUpdate,
    actor: Actor = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        result = upsert_feature_bindings(session, [item.model_dump() for item in payload.items])
    except Exception as error:
        raise _as_http_error(error) from error
    write_audit(session, actor, "ai_features.updated", "ai_feature_binding", None, {"count": len(result)})
    return {"items": result}


@router.get("/ai/persona")
def get_ai_persona(_: Actor = Depends(require_admin), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {"persona": serialize_persona(get_persona_config(session))}


@router.put("/ai/persona")
def update_ai_persona(
    payload: AiPersonaUpdate,
    actor: Actor = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    result = update_persona(session, **payload.model_dump())
    write_audit(session, actor, "ai_persona.updated", "ai_persona", result["id"], {"display_name": result["display_name"]})
    return {"persona": result}


@router.get("/assistant/brief")
def get_assistant_brief(actor: Actor = Depends(assistant_use), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = get_latest_coach_brief(session, actor.user_id)
    if not row:
        snapshot = session.scalars(
            select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
        ).first()
        if snapshot:
            row = refresh_coach_brief(session, actor.user_id, snapshot)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No coach brief is available yet.")
    return {"brief": serialize_coach_brief(row, get_persona_config(session))}


@router.post("/assistant/brief/refresh", status_code=status.HTTP_201_CREATED)
def refresh_assistant_brief(actor: Actor = Depends(assistant_use), session: Session = Depends(get_session)) -> dict[str, Any]:
    snapshot = session.scalars(
        select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
    ).first()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Create an insight snapshot before refreshing the coach brief.")
    row = refresh_coach_brief(session, actor.user_id, snapshot)
    write_audit(session, actor, "assistant_brief.refreshed", "assistant_brief", row.id, {"snapshot_id": snapshot.id})
    return {"brief": serialize_coach_brief(row, get_persona_config(session))}


@router.post("/assistant/advice")
def get_assistant_advice(
    payload: AssistantCoachAdviceRequest,
    actor: Actor = Depends(assistant_use),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    snapshot = session.scalars(
        select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
    ).first()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Create an insight snapshot before asking the coach for advice.")
    advice = generate_coach_advice(session, actor.user_id, snapshot.payload_json, payload.prompt)
    write_audit(
        session,
        actor,
        "assistant_advice.generated",
        "assistant_advice",
        None,
        {"source": advice.get("source"), "prompt_length": len(payload.prompt.strip())},
    )
    return {"advice": advice}


manifest = ModuleManifest(key="ai", router=router)
