from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import JobRecord, utcnow


def enqueue_job(
    session: Session,
    job_type: str,
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


def ensure_daily_jobs(session: Session, target_date: date | None = None) -> None:
    active_date = target_date or utcnow().date()
    available_at = datetime.combine(active_date, time(hour=3), tzinfo=timezone.utc)
    enqueue_job(
        session,
        "insights.recompute",
        {"date": active_date.isoformat(), "scheduled": True},
        dedupe_key=f"insights:{active_date.isoformat()}",
        available_at=available_at,
    )
    enqueue_job(
        session,
        "platform.backup",
        {"date": active_date.isoformat(), "scheduled": True},
        dedupe_key=f"backup:{active_date.isoformat()}",
        available_at=available_at + timedelta(minutes=5),
    )
