from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.config import get_settings
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.local_ai import inspect_ai_runtime, parse_natural_language_entry
from app.core.modules import ModuleManifest
from app.core.ownership import ensure_owned
from app.core.schemas import DashboardCardDefinition, DashboardCardState
from app.core.security import (
    Actor,
    authenticate_user,
    clear_failed_logins,
    change_password,
    create_api_key as issue_api_key,
    create_password_setup_token,
    create_session_token,
    ensure_admin_user,
    enforce_login_rate_limit,
    get_actor,
    record_failed_login,
    redeem_password_setup_token,
    revoke_user_sessions,
    require_scope,
)
from app.core.serialization import export_payload, restore_payload
from app.core.storage import write_json_export
from app.core.models import AiFeatureBinding, ApiKey, AppUser, ExportRecord, FoodItem, Goal, JobRecord, MealEntry, SessionToken, WeightEntry, WorkoutSession, utcnow


settings = get_settings()
router = APIRouter(route_class=IdempotentRoute, tags=["platform"])
platform_read = require_scope("platform:read")
platform_write = require_scope("platform:write")
assistant_use = require_scope("assistant:use")


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordSetupRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=12)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12)


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


class AssistantParseRequest(BaseModel):
    note: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    is_admin: bool = False


def admin_write(actor: Actor = Depends(platform_write)) -> Actor:
    if not actor.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return actor


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _session_cookie_secure_flag(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",", 1)[0].strip().lower()
    hostname = (request.url.hostname or "").lower()
    is_local_host = hostname in {"localhost", "127.0.0.1", "::1"}
    secure_cookie = forwarded_proto == "https"
    if not secure_cookie and not is_local_host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="HTTPS is required for session-based login on non-local hosts.",
        )
    return secure_cookie


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    secure_cookie = _session_cookie_secure_flag(request)
    response.set_cookie(
        key="fitnesspal_session",
        value=token,
        httponly=True,
        samesite="strict",
        secure=secure_cookie,
        max_age=settings.session_days * 24 * 3600,
        path="/",
    )


def audit_actor_for_user(user: AppUser) -> Actor:
    return Actor(
        actor_type="user",
        actor_id=user.id,
        display_name=user.username,
        scopes=(),
        user_id=user.id,
        username=user.username,
        is_admin=user.is_admin,
    )


def serialize_user(row: AppUser) -> dict[str, Any]:
    return {
        "id": row.id,
        "username": row.username,
        "is_admin": row.is_admin,
        "is_active": row.is_active,
        "has_password": bool(row.password_hash),
        "password_set_at": row.password_set_at.isoformat() if row.password_set_at else None,
        "created_at": row.created_at.isoformat(),
    }


def build_auth_payload(user: AppUser) -> dict[str, Any]:
    scopes = [
        "platform:read",
        "platform:write",
        "nutrition:*",
        "training:*",
        "metrics:*",
        "insights:*",
        "assistant:use",
    ]
    if user.is_admin:
        scopes.append("admin:*")
    return {
        "user": serialize_user(user),
        "scopes": scopes,
    }


@router.get("/health")
def healthcheck(session: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "ai_configured_features": session.scalar(
            select(func.count(AiFeatureBinding.id)).where(AiFeatureBinding.profile_id.is_not(None))
        ) or 0,
    }


@router.post("/auth/login")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    ensure_admin_user(session)
    client_ip = _client_ip(request)
    enforce_login_rate_limit(payload.username, client_ip)
    user = authenticate_user(session, payload.username, payload.password)
    if not user:
        record_failed_login(payload.username, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    clear_failed_logins(payload.username, client_ip)
    _session_cookie_secure_flag(request)
    token = create_session_token(session, user)
    set_session_cookie(response, request, token)
    return build_auth_payload(user)


@router.post("/auth/password/setup")
def setup_password(
    payload: PasswordSetupRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    user = redeem_password_setup_token(session, payload.token, payload.new_password)
    revoke_user_sessions(session, user.id)
    session.commit()
    _session_cookie_secure_flag(request)
    token = create_session_token(session, user)
    set_session_cookie(response, request, token)
    write_audit(session, audit_actor_for_user(user), "auth.password_setup_completed", "user", user.id, {})
    return build_auth_payload(user)


@router.post("/auth/password/change")
def update_password(
    payload: PasswordChangeRequest,
    request: Request,
    response: Response,
    actor: Actor = Depends(platform_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    user = session.get(AppUser, actor.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found.")
    change_password(session, user, payload.current_password, payload.new_password)
    revoke_user_sessions(session, user.id)
    session.commit()
    _session_cookie_secure_flag(request)
    token = create_session_token(session, user)
    set_session_cookie(response, request, token)
    write_audit(session, actor, "auth.password_changed", "user", user.id, {})
    return {"status": "ok"}


@router.post("/auth/logout")
def logout(
    response: Response,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if actor.actor_type == "session":
        record = session.get(SessionToken, actor.actor_id)
        if record and record.user_id == actor.user_id:
            record.revoked_at = utcnow()
            session.commit()
    response.delete_cookie("fitnesspal_session", path="/")
    return {"status": "ok"}


@router.get("/auth/session")
def current_session(actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    user = session.get(AppUser, actor.user_id)
    return {
        "actor": {
            "id": actor.actor_id,
            "type": actor.actor_type,
            "display_name": actor.display_name,
            "scopes": list(actor.scopes),
        },
        "user": serialize_user(user) if user else None,
    }


@router.get("/users")
def list_users(actor: Actor = Depends(admin_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(AppUser).order_by(AppUser.created_at.desc())).all()
    return {"items": [serialize_user(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    actor: Actor = Depends(admin_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    username = payload.username.strip()
    existing = session.scalar(select(AppUser).where(AppUser.username == username))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists.")
    user = AppUser(username=username, is_admin=payload.is_admin, is_active=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    token_record, token = create_password_setup_token(session, user, created_by_user_id=actor.user_id)
    write_audit(session, actor, "user.created", "user", user.id, {"username": user.username, "is_admin": user.is_admin})
    return {
        **serialize_user(user),
        "setup_token": token,
        "setup_expires_at": token_record.expires_at.isoformat(),
        "setup_path": f"/setup-password?token={quote(token)}",
    }


@router.post("/users/{user_id}/password-setup", status_code=status.HTTP_201_CREATED)
def issue_password_setup(
    user_id: str,
    actor: Actor = Depends(admin_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    user = session.get(AppUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    token_record, token = create_password_setup_token(session, user, created_by_user_id=actor.user_id)
    write_audit(session, actor, "user.password_setup_issued", "user", user.id, {"username": user.username})
    return {
        "user": serialize_user(user),
        "setup_token": token,
        "setup_expires_at": token_record.expires_at.isoformat(),
        "setup_path": f"/setup-password?token={quote(token)}",
    }


@router.get("/metrics")
def metrics(actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "meals": session.scalar(select(func.count(MealEntry.id)).where(MealEntry.user_id == actor.user_id)) or 0,
        "foods": session.scalar(select(func.count(FoodItem.id)).where(FoodItem.user_id == actor.user_id)) or 0,
        "workouts": session.scalar(select(func.count(WorkoutSession.id)).where(WorkoutSession.user_id == actor.user_id)) or 0,
        "weight_entries": session.scalar(select(func.count(WeightEntry.id)).where(WeightEntry.user_id == actor.user_id)) or 0,
        "queued_jobs": session.scalar(
            select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "queued")
        ) or 0,
        "running_jobs": session.scalar(
            select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "running")
        ) or 0,
        "failed_jobs": session.scalar(
            select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "failed")
        ) or 0,
        "generated_at": utcnow().isoformat(),
        "requested_by": actor.display_name,
    }


@router.get("/runtime")
def get_runtime(actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    latest_export = session.scalars(
        select(ExportRecord).where(ExportRecord.user_id == actor.user_id).order_by(ExportRecord.created_at.desc()).limit(1)
    ).first()
    return {
        "app_name": settings.app_name,
        "api_prefix": settings.api_prefix,
        "storage_root": "storage",
        "uploads_root": f"uploads/{actor.user_id}",
        "exports_root": f"exports/{actor.user_id}",
        "allow_origins": list(settings.allow_origins),
        "ai": inspect_ai_runtime(session, include_admin_details=actor.is_admin),
        "jobs": {
            "queued": session.scalar(
                select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "queued")
            ) or 0,
            "running": session.scalar(
                select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "running")
            ) or 0,
            "failed": session.scalar(
                select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "failed")
            ) or 0,
        },
        "last_export_at": latest_export.created_at.isoformat() if latest_export else None,
        "requested_by": actor.display_name,
    }


@router.get("/jobs")
def list_jobs(
    actor: Actor = Depends(platform_read),
    session: Session = Depends(get_session),
    status: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
) -> dict[str, Any]:
    query = select(JobRecord).where(JobRecord.user_id == actor.user_id).order_by(JobRecord.created_at.desc()).limit(limit)
    if status:
        query = (
            select(JobRecord)
            .where(JobRecord.user_id == actor.user_id, JobRecord.status == status)
            .order_by(JobRecord.created_at.desc())
            .limit(limit)
        )
    rows = session.scalars(query).all()
    return {"items": [serialize_job(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.get("/goals")
def list_goals(actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(Goal).where(Goal.user_id == actor.user_id, Goal.deleted_at.is_(None)).order_by(Goal.created_at.desc())
    ).all()
    return {"items": [serialize_goal(row) for row in rows], "total": len(rows)}


@router.post("/goals", status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreate,
    actor: Actor = Depends(platform_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    goal = Goal(user_id=actor.user_id, **payload.model_dump())
    session.add(goal)
    session.commit()
    session.refresh(goal)
    write_audit(session, actor, "goal.created", "goal", goal.id, payload.model_dump())
    return serialize_goal(goal)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, actor: Actor = Depends(platform_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    goal = ensure_owned(session, Goal, goal_id, actor.user_id, "Goal not found.")
    goal.deleted_at = utcnow()
    session.commit()
    write_audit(session, actor, "goal.deleted", "goal", goal.id, {"title": goal.title})
    return {"status": "deleted", "id": goal.id}


@router.get("/api-keys")
def list_api_keys(actor: Actor = Depends(platform_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(ApiKey)
        .where(ApiKey.user_id == actor.user_id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at.desc())
    ).all()
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
    actor: Actor = Depends(platform_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    owner = session.get(AppUser, actor.user_id)
    if not owner:
        raise HTTPException(status_code=404, detail="User not found.")
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
def revoke_api_key(key_id: str, actor: Actor = Depends(platform_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(ApiKey, key_id)
    if not record or record.user_id != actor.user_id or record.revoked_at is not None:
        raise HTTPException(status_code=404, detail="API key not found.")
    record.revoked_at = utcnow()
    session.commit()
    write_audit(session, actor, "api_key.revoked", "api_key", record.id, {"name": record.name})
    return {"status": "revoked", "id": record.id}


@router.get("/exports")
def list_exports(actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(ExportRecord).where(ExportRecord.user_id == actor.user_id).order_by(ExportRecord.created_at.desc())
    ).all()
    return {"items": [serialize_export(row) for row in rows], "total": len(rows)}


@router.post("/exports", status_code=status.HTTP_201_CREATED)
def create_export(actor: Actor = Depends(platform_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    payload = export_payload(session, actor.user_id)
    target = write_json_export("fitnesspal-backup", payload, actor.user_id)
    record = ExportRecord(
        user_id=actor.user_id,
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
def download_export(export_id: str, actor: Actor = Depends(platform_read), session: Session = Depends(get_session)) -> FileResponse:
    record = ensure_owned(session, ExportRecord, export_id, actor.user_id, "Export not found.", include_deleted=True)
    path = Path(record.path).resolve(strict=False)
    expected_root = (settings.export_root / actor.user_id).resolve(strict=False)
    try:
        path.relative_to(expected_root)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Export file missing.") from error
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export file missing.")
    return FileResponse(path, filename=path.name)


@router.post("/exports/restore")
def restore_export(
    payload: ExportRestoreRequest,
    actor: Actor = Depends(platform_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    counts = restore_payload(session, payload.payload, actor.user_id)
    write_audit(session, actor, "export.restored", "export", None, counts)
    return {"status": "restored", "counts": counts}


@router.post("/assistant/parse")
def parse_assistant_note(
    payload: AssistantParseRequest,
    actor: Actor = Depends(assistant_use),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    parsed = parse_natural_language_entry(session, payload.note)
    write_audit(session, actor, "assistant.parsed", "assistant", None, {"draft_count": len(parsed.get("drafts", []))})
    return parsed


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
        "path": Path(record.path).name,
        "summary": record.summary_json,
        "created_at": record.created_at.isoformat(),
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
    }


def serialize_job(record: JobRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "job_type": record.job_type,
        "status": record.status,
        "payload": {},
        "result": None,
        "dedupe_key": None,
        "attempts": record.attempts,
        "max_attempts": record.max_attempts,
        "available_at": record.available_at.isoformat(),
        "claimed_at": record.claimed_at.isoformat() if record.claimed_at else None,
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        "last_error": record.last_error,
        "created_at": record.created_at.isoformat(),
    }


def load_dashboard_cards(session: Session, actor: Actor) -> list[DashboardCardState]:
    latest_export = session.scalars(
        select(ExportRecord).where(ExportRecord.user_id == actor.user_id).order_by(ExportRecord.created_at.desc()).limit(1)
    ).first()
    queued_jobs = session.scalar(
        select(func.count(JobRecord.id)).where(JobRecord.user_id == actor.user_id, JobRecord.status == "queued")
    ) or 0
    return [
        DashboardCardState(
            key="system-health",
            title="System",
            route="/settings",
            description="API, storage, and backup status.",
            accent="emerald",
            value="Healthy",
            detail=f"Last backup: {latest_export.created_at.strftime('%Y-%m-%d %H:%M') if latest_export else 'Never'} | {queued_jobs} queued jobs",
            status="positive",
        )
    ]


def backup_job(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    user_id = str(payload["user_id"])
    export_data = export_payload(session, user_id)
    target = write_json_export("fitnesspal-backup", export_data, user_id)
    record = ExportRecord(
        user_id=user_id,
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
    job_handlers={"platform.backup": backup_job},
)
