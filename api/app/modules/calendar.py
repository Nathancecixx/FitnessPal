from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.local_ai import get_check_in_for_date, resolve_user_timezone, serialize_coach_check_in
from app.core.models import CoachCheckIn, MealEntry, WeightEntry, WorkoutSession, utcnow
from app.core.modules import ModuleManifest
from app.core.security import Actor, require_scope
from app.modules.metrics import serialize_weight_entry
from app.modules.nutrition import serialize_meal
from app.modules.training import serialize_workout_session


router = APIRouter(route_class=IdempotentRoute, tags=["calendar"])
calendar_read = require_scope("calendar:read")


def _month_start(anchor_date: date) -> date:
    return anchor_date.replace(day=1)


def _next_month_start(anchor_date: date) -> date:
    if anchor_date.month == 12:
        return date(anchor_date.year + 1, 1, 1)
    return date(anchor_date.year, anchor_date.month + 1, 1)


def _grid_start(month_start: date) -> date:
    return month_start - timedelta(days=(month_start.weekday() + 1) % 7)


def _grid_days(anchor_date: date) -> list[date]:
    start = _grid_start(_month_start(anchor_date))
    return [start + timedelta(days=offset) for offset in range(42)]


def _local_bounds(target_date: date, timezone_info: Any) -> tuple[datetime, datetime]:
    start = datetime.combine(target_date, time.min, tzinfo=timezone_info)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _local_date(value: datetime, timezone_info: Any) -> date:
    active_value = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return active_value.astimezone(timezone_info).date()


def _build_summary_map(
    session: Session,
    user_id: str,
    grid_start: date,
    grid_end: date,
    timezone_info: Any,
) -> dict[date, dict[str, Any]]:
    range_start_utc, _ = _local_bounds(grid_start, timezone_info)
    _, range_end_utc = _local_bounds(grid_end, timezone_info)
    summaries = {
        grid_start + timedelta(days=offset): {
            "meal_count": 0,
            "total_calories": 0.0,
            "workout_count": 0,
            "latest_weight_kg": None,
            "has_check_in": False,
        }
        for offset in range((grid_end - grid_start).days + 1)
    }

    meals = session.scalars(
        select(MealEntry)
        .where(
            MealEntry.user_id == user_id,
            MealEntry.deleted_at.is_(None),
            MealEntry.logged_at >= range_start_utc,
            MealEntry.logged_at < range_end_utc,
        )
    ).all()
    for row in meals:
        local_day = _local_date(row.logged_at, timezone_info)
        summary = summaries.get(local_day)
        if summary is None:
            continue
        summary["meal_count"] += 1
        summary["total_calories"] += float(row.total_calories or 0)

    workouts = session.scalars(
        select(WorkoutSession)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.deleted_at.is_(None),
            WorkoutSession.started_at >= range_start_utc,
            WorkoutSession.started_at < range_end_utc,
        )
    ).all()
    for row in workouts:
        local_day = _local_date(row.started_at, timezone_info)
        summary = summaries.get(local_day)
        if summary is None:
            continue
        summary["workout_count"] += 1

    weights = session.scalars(
        select(WeightEntry)
        .where(
            WeightEntry.user_id == user_id,
            WeightEntry.deleted_at.is_(None),
            WeightEntry.logged_at >= range_start_utc,
            WeightEntry.logged_at < range_end_utc,
        )
        .order_by(WeightEntry.logged_at.asc(), WeightEntry.id.asc())
    ).all()
    for row in weights:
        local_day = _local_date(row.logged_at, timezone_info)
        summary = summaries.get(local_day)
        if summary is None:
            continue
        summary["latest_weight_kg"] = row.weight_kg

    check_ins = session.scalars(
        select(CoachCheckIn).where(
            CoachCheckIn.user_id == user_id,
            CoachCheckIn.check_in_date >= grid_start,
            CoachCheckIn.check_in_date <= grid_end,
        )
    ).all()
    for row in check_ins:
        summary = summaries.get(row.check_in_date)
        if summary is not None:
            summary["has_check_in"] = True

    return summaries


def _serialize_day_summary(
    target_date: date,
    *,
    month_start: date,
    today_date: date,
    summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "date": target_date.isoformat(),
        "is_in_month": target_date.month == month_start.month and target_date.year == month_start.year,
        "is_today": target_date == today_date,
        "is_future": target_date > today_date,
        "is_editable": target_date <= today_date,
        "meal_count": summary["meal_count"],
        "total_calories": round(summary["total_calories"]),
        "workout_count": summary["workout_count"],
        "latest_weight_kg": summary["latest_weight_kg"],
        "has_check_in": summary["has_check_in"],
    }


@router.get("/calendar/month")
def get_calendar_month(
    anchor_date: date | None = Query(default=None),
    actor: Actor = Depends(calendar_read),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    timezone_info, timezone_name = resolve_user_timezone(session, actor.user_id)
    local_today = utcnow().astimezone(timezone_info).date()
    active_anchor = anchor_date or local_today
    month_start = _month_start(active_anchor)
    month_end = _next_month_start(active_anchor) - timedelta(days=1)
    grid_dates = _grid_days(active_anchor)
    grid_start = grid_dates[0]
    grid_end = grid_dates[-1]
    summaries = _build_summary_map(session, actor.user_id, grid_start, grid_end, timezone_info)
    cells = [
        _serialize_day_summary(
            day,
            month_start=month_start,
            today_date=local_today,
            summary=summaries[day],
        )
        for day in grid_dates
    ]

    return {
        "anchor_date": active_anchor.isoformat(),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "grid_start": grid_start.isoformat(),
        "grid_end": grid_end.isoformat(),
        "today": local_today.isoformat(),
        "timezone": timezone_name,
        "weeks": [cells[index:index + 7] for index in range(0, len(cells), 7)],
    }


@router.get("/calendar/days/{target_date}")
def get_calendar_day(
    target_date: date,
    actor: Actor = Depends(calendar_read),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    timezone_info, timezone_name = resolve_user_timezone(session, actor.user_id)
    local_today = utcnow().astimezone(timezone_info).date()
    start_utc, end_utc = _local_bounds(target_date, timezone_info)
    meals = session.scalars(
        select(MealEntry)
        .where(
            MealEntry.user_id == actor.user_id,
            MealEntry.deleted_at.is_(None),
            MealEntry.logged_at >= start_utc,
            MealEntry.logged_at < end_utc,
        )
        .order_by(MealEntry.logged_at.asc(), MealEntry.id.asc())
    ).all()
    workouts = session.scalars(
        select(WorkoutSession)
        .where(
            WorkoutSession.user_id == actor.user_id,
            WorkoutSession.deleted_at.is_(None),
            WorkoutSession.started_at >= start_utc,
            WorkoutSession.started_at < end_utc,
        )
        .order_by(WorkoutSession.started_at.asc(), WorkoutSession.id.asc())
    ).all()
    weight_entries = session.scalars(
        select(WeightEntry)
        .where(
            WeightEntry.user_id == actor.user_id,
            WeightEntry.deleted_at.is_(None),
            WeightEntry.logged_at >= start_utc,
            WeightEntry.logged_at < end_utc,
        )
        .order_by(WeightEntry.logged_at.asc(), WeightEntry.id.asc())
    ).all()
    check_in = get_check_in_for_date(session, actor.user_id, target_date)
    summary_map = _build_summary_map(session, actor.user_id, target_date, target_date, timezone_info)
    summary = _serialize_day_summary(
        target_date,
        month_start=_month_start(target_date),
        today_date=local_today,
        summary=summary_map[target_date],
    )

    return {
        "date": target_date.isoformat(),
        "today": local_today.isoformat(),
        "timezone": timezone_name,
        "is_today": target_date == local_today,
        "is_future": target_date > local_today,
        "is_editable": target_date <= local_today,
        "summary": summary,
        "meals": [serialize_meal(session, row) for row in meals],
        "workouts": [serialize_workout_session(session, row) for row in workouts],
        "weight_entries": [serialize_weight_entry(row) for row in weight_entries],
        "check_in": serialize_coach_check_in(check_in, timezone_name, today_date=local_today) if check_in else None,
    }


manifest = ModuleManifest(key="calendar", router=router)
