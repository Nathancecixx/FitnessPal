from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.config import get_settings
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.local_ai import inspect_local_ai
from app.core.modules import ModuleManifest
from app.core.schemas import AgentExample, DashboardCardDefinition, DashboardCardState
from app.core.security import (
    Actor,
    authenticate_user,
    create_api_key as issue_api_key,
    create_session_token,
    ensure_bootstrap_user,
    get_actor,
)
from app.core.serialization import export_payload, restore_payload
from app.core.storage import write_json_export
from app.core.models import (
    ApiKey,
    ExportRecord,
    FoodItem,
    Goal,
    JobRecord,
    MealEntry,
    SessionToken,
    WeightEntry,
    WorkoutSession,
    utcnow,
)


settings = get_settings()
router = APIRouter(route_class=IdempotentRoute, tags=["platform"])


class LoginRequest(BaseModel):
    username: str
    password: str


class GoalCreate(BaseModel):
    category: str
    title: str
    metric_key: str
    target_value: float
    unit: str
    period: str = "daily"
    notes: str | None = None


class ApiKeyCreate(BaseModel):
    name: str
    scopes: list[str] = Field(default_factory=lambda: ["*"])


class ExportRestoreRequest(BaseModel):
    payload: dict[str, Any]


@router.get("/health")
def healthcheck() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "storage_root": str(settings.storage_root),
        "local_ai_configured": bool(settings.local_ai_base_url),
    }


@router.post("/auth/login")
def login(payload: LoginRequest, response: Response, session: Session = Depends(get_session)) -> dict[str, Any]:
    ensure_bootstrap_user(session)
    user = authenticate_user(session, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    token = create_session_token(session, user)
    response.set_cookie(
        key="fitnesspal_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=settings.session_days * 24 * 3600,
    )
    return {
        "user": {"id": user.id, "username": user.username},
        "scopes": ["*"],
    }


@router.post("/auth/logout")
def logout(
    response: Response,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if actor.actor_type == "session":
        record = session.get(SessionToken, actor.actor_id)
        if record:
            record.revoked_at = utcnow()
            session.commit()
    response.delete_cookie("fitnesspal_session")
    return {"status": "ok"}


@router.get("/auth/session")
def current_session(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    return {
        "actor": {
            "id": actor.actor_id,
            "type": actor.actor_type,
            "display_name": actor.display_name,
            "scopes": list(actor.scopes),
        }
    }


@router.get("/metrics")
def metrics(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "meals": session.scalar(select(func.count(MealEntry.id))) or 0,
        "foods": session.scalar(select(func.count(FoodItem.id))) or 0,
        "workouts": session.scalar(select(func.count(WorkoutSession.id))) or 0,
        "weight_entries": session.scalar(select(func.count(WeightEntry.id))) or 0,
        "queued_jobs": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "queued")) or 0,
        "running_jobs": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "running")) or 0,
        "failed_jobs": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "failed")) or 0,
        "generated_at": utcnow().isoformat(),
        "requested_by": actor.display_name,
    }


@router.get("/runtime")
def get_runtime(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    latest_export = session.scalars(select(ExportRecord).order_by(ExportRecord.created_at.desc()).limit(1)).first()
    local_ai_status = inspect_local_ai()
    return {
        "app_name": settings.app_name,
        "api_prefix": settings.api_prefix,
        "storage_root": str(settings.storage_root),
        "uploads_root": str(settings.upload_root),
        "exports_root": str(settings.export_root),
        "agent_manifest_url": settings.agent_manifest_url,
        "allow_origins": list(settings.allow_origins),
        "local_ai": {
            "configured": bool(settings.local_ai_base_url),
            "base_url": settings.local_ai_base_url,
            "model": settings.local_ai_model,
            "timeout_seconds": settings.local_ai_timeout_seconds,
            "reachable": local_ai_status["reachable"],
            "available_models": local_ai_status["available_models"],
            "selected_model_available": local_ai_status["selected_model_available"],
            "error": local_ai_status["error"],
        },
        "jobs": {
            "queued": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "queued")) or 0,
            "running": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "running")) or 0,
            "failed": session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "failed")) or 0,
        },
        "last_export_at": latest_export.created_at.isoformat() if latest_export else None,
        "requested_by": actor.display_name,
    }


@router.get("/jobs")
def list_jobs(
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
    status: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
) -> dict[str, Any]:
    query = select(JobRecord).order_by(JobRecord.created_at.desc()).limit(limit)
    if status:
        query = select(JobRecord).where(JobRecord.status == status).order_by(JobRecord.created_at.desc()).limit(limit)
    rows = session.scalars(query).all()
    return {"items": [serialize_job(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.get("/goals")
def list_goals(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(Goal).where(Goal.deleted_at.is_(None)).order_by(Goal.created_at.desc())).all()
    return {"items": [serialize_goal(row) for row in rows], "total": len(rows)}


@router.post("/goals", status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    goal = Goal(**payload.model_dump())
    session.add(goal)
    session.commit()
    session.refresh(goal)
    write_audit(session, actor, "goal.created", "goal", goal.id, payload.model_dump())
    return serialize_goal(goal)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    goal = session.get(Goal, goal_id)
    if not goal or goal.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found.")
    goal.deleted_at = utcnow()
    session.commit()
    write_audit(session, actor, "goal.deleted", "goal", goal.id, {"title": goal.title})
    return {"status": "deleted", "id": goal.id}


@router.get("/api-keys")
def list_api_keys(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(ApiKey).where(ApiKey.revoked_at.is_(None)).order_by(ApiKey.created_at.desc())).all()
    return {
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "prefix": row.prefix,
                "scopes": row.scopes,
                "created_at": row.created_at.isoformat(),
                "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
            }
            for row in rows
        ],
        "total": len(rows),
    }


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
def create_api_key_endpoint(
    payload: ApiKeyCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    owner = ensure_bootstrap_user(session)
    record, token = issue_api_key(session, owner, payload.name, payload.scopes)
    write_audit(session, actor, "api_key.created", "api_key", record.id, {"name": record.name, "scopes": record.scopes})
    return {
        "id": record.id,
        "name": record.name,
        "prefix": record.prefix,
        "scopes": record.scopes,
        "token": token,
    }


@router.delete("/api-keys/{key_id}")
def revoke_api_key(key_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(ApiKey, key_id)
    if not record or record.revoked_at is not None:
        raise HTTPException(status_code=404, detail="API key not found.")
    record.revoked_at = utcnow()
    session.commit()
    write_audit(session, actor, "api_key.revoked", "api_key", record.id, {"name": record.name})
    return {"status": "revoked", "id": record.id}


@router.get("/exports")
def list_exports(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(ExportRecord).order_by(ExportRecord.created_at.desc())).all()
    return {"items": [serialize_export(row) for row in rows], "total": len(rows)}


@router.post("/exports", status_code=status.HTTP_201_CREATED)
def create_export(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    payload = export_payload(session)
    target = write_json_export("fitnesspal-backup", payload)
    record = ExportRecord(
        format="json",
        status="ready",
        path=str(target),
        summary_json={key: len(value) for key, value in payload["tables"].items()},
        finished_at=utcnow(),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    write_audit(session, actor, "export.created", "export", record.id, record.summary_json)
    return serialize_export(record)


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> FileResponse:
    record = session.get(ExportRecord, export_id)
    if not record:
        raise HTTPException(status_code=404, detail="Export not found.")
    path = Path(record.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export file missing.")
    return FileResponse(path)


@router.post("/exports/restore")
def restore_export(
    payload: ExportRestoreRequest,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    counts = restore_payload(session, payload.payload)
    write_audit(session, actor, "export.restored", "export", None, counts)
    return {"status": "restored", "counts": counts}


def serialize_goal(goal: Goal) -> dict[str, Any]:
    return {
        "id": goal.id,
        "category": goal.category,
        "title": goal.title,
        "metric_key": goal.metric_key,
        "target_value": goal.target_value,
        "unit": goal.unit,
        "period": goal.period,
        "notes": goal.notes,
        "created_at": goal.created_at.isoformat(),
    }


def serialize_export(record: ExportRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "format": record.format,
        "status": record.status,
        "path": record.path,
        "summary": record.summary_json,
        "created_at": record.created_at.isoformat(),
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
    }


def serialize_job(record: JobRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "job_type": record.job_type,
        "status": record.status,
        "payload": record.payload_json,
        "result": record.result_json,
        "dedupe_key": record.dedupe_key,
        "attempts": record.attempts,
        "max_attempts": record.max_attempts,
        "available_at": record.available_at.isoformat(),
        "claimed_at": record.claimed_at.isoformat() if record.claimed_at else None,
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        "last_error": record.last_error,
        "created_at": record.created_at.isoformat(),
    }


def load_dashboard_cards(session: Session) -> list[DashboardCardState]:
    latest_export = session.scalars(select(ExportRecord).order_by(ExportRecord.created_at.desc()).limit(1)).first()
    queued_jobs = session.scalar(select(func.count(JobRecord.id)).where(JobRecord.status == "queued")) or 0
    return [
        DashboardCardState(
            key="system-health",
            title="System",
            route="/settings",
            description="API, storage, and backup status.",
            accent="emerald",
            value="Healthy",
            detail=f"Last backup: {latest_export.created_at.strftime('%Y-%m-%d %H:%M') if latest_export else 'Never'} · {queued_jobs} queued jobs",
            status="positive",
        )
    ]


def backup_job(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    export_data = export_payload(session)
    target = write_json_export("fitnesspal-backup", export_data)
    record = ExportRecord(
        format="json",
        status="ready",
        path=str(target),
        summary_json={key: len(value) for key, value in export_data["tables"].items()},
        finished_at=utcnow(),
    )
    session.add(record)
    session.commit()
    return {"export_id": record.id, "path": str(target), "scheduled": payload.get("scheduled", False)}


manifest = ModuleManifest(
    key="platform",
    router=router,
    dashboard_cards=[
        DashboardCardDefinition(
            key="system-health",
            title="System",
            route="/settings",
            description="Local services, auth, and backups.",
            accent="emerald",
            priority=10,
        )
    ],
    dashboard_loader=load_dashboard_cards,
    agent_examples=[
        AgentExample(
            key="create-goal",
            title="Create calorie goal",
            method="POST",
            path="/api/v1/goals",
            summary="Create a tracked goal for weight, calories, or macros.",
            request_body={
                "category": "nutrition",
                "title": "Daily calories",
                "metric_key": "calories",
                "target_value": 2800,
                "unit": "kcal",
                "period": "daily",
            },
        ),
        AgentExample(
            key="create-api-key",
            title="Issue agent key",
            method="POST",
            path="/api/v1/api-keys",
            summary="Create a full-control API key for OpenClaw or local automations.",
            request_body={"name": "openclaw", "scopes": ["*"]},
        ),
    ],
    job_handlers={"platform.backup": backup_job},
)
