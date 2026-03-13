from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import AppUser, JobRecord, UserPreference, utcnow


def enqueue_job(
    session: Session,
    job_type: str,
    user_id: str,
    payload: dict[str, Any] | None = None,
    *,
    dedupe_key: str | None = None,
    available_at: datetime | None = None,
    max_attempts: int = 5,
) -> JobRecord:
    if dedupe_key:
        existing = session.scalar(select(JobRecord).where(JobRecord.dedupe_key == dedupe_key))
        if existing:
            return existing

    record = JobRecord(
        user_id=user_id,
        job_type=job_type,
        payload_json=payload or {},
        dedupe_key=dedupe_key,
        available_at=available_at or utcnow(),
        max_attempts=max_attempts,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def claim_next_job(session: Session) -> JobRecord | None:
    now = utcnow()
    record = session.scalar(
        select(JobRecord)
        .where(JobRecord.status == "queued", JobRecord.available_at <= now)
        .order_by(JobRecord.available_at.asc(), JobRecord.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not record:
        return None
    record.status = "running"
    record.attempts += 1
    record.claimed_at = now
    session.commit()
    session.refresh(record)
    return record


def complete_job(session: Session, record: JobRecord, result: dict[str, Any] | None = None) -> None:
    record.status = "completed"
    record.result_json = result
    record.finished_at = utcnow()
    session.commit()


def fail_job(session: Session, record: JobRecord, error: str) -> None:
    if record.attempts >= record.max_attempts:
        record.status = "failed"
    else:
        record.status = "queued"
        record.available_at = utcnow() + timedelta(minutes=min(record.attempts * 2, 15))
    record.last_error = error
    session.commit()


def enqueue_live_insights_refresh(
    session: Session,
    user_id: str,
    payload: dict[str, Any] | None = None,
) -> JobRecord:
    return enqueue_job(
        session,
        "insights.recompute",
        user_id,
        payload or {"source": "live", "user_id": user_id},
        dedupe_key=f"insights-live:{user_id}:{utcnow().strftime('%Y%m%d%H%M')}",
    )


def _server_timezone():
    return datetime.now().astimezone().tzinfo or timezone.utc


def _resolve_user_timezone(session: Session, user_id: str):
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if preference and preference.timezone:
        try:
            return ZoneInfo(preference.timezone)
        except ZoneInfoNotFoundError:
            pass
    return _server_timezone()


def ensure_daily_jobs(session: Session, target_date: date | None = None) -> None:
    now = utcnow()
    active_users = session.scalars(select(AppUser).where(AppUser.is_active.is_(True))).all()
    for user in active_users:
        user_timezone = _resolve_user_timezone(session, user.id)
        local_now = now.astimezone(user_timezone)
        local_date = target_date or local_now.date()
        available_at = datetime.combine(local_date, time(hour=5), tzinfo=user_timezone).astimezone(timezone.utc)
        enqueue_job(
            session,
            "insights.recompute",
            user.id,
            {"date": local_date.isoformat(), "scheduled": True, "user_id": user.id},
            dedupe_key=f"insights:{user.id}:{local_date.isoformat()}",
            available_at=available_at,
        )
        enqueue_job(
            session,
            "platform.backup",
            user.id,
            {"date": local_date.isoformat(), "scheduled": True, "user_id": user.id},
            dedupe_key=f"backup:{user.id}:{local_date.isoformat()}",
            available_at=available_at + timedelta(minutes=5),
        )
