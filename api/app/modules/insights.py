from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.logic import rolling_average, weight_trend_per_week
from app.core.models import Goal, InsightSnapshot, MealEntry, SetEntry, WeightEntry, WorkoutSession, utcnow
from app.core.local_ai import refresh_coach_brief
from app.core.modules import ModuleManifest
from app.core.schemas import DashboardCardDefinition, DashboardCardState
from app.core.security import Actor, require_scope


router = APIRouter(route_class=IdempotentRoute, tags=["insights"])
insights_read = require_scope("insights:read")
insights_write = require_scope("insights:write")

INSIGHT_NUTRITION_LOOKBACK_DAYS = 90
INSIGHT_WEIGHT_LOOKBACK_DAYS = 180
INSIGHT_WORKOUT_LOOKBACK_DAYS = 14


@router.get("/insights")
def get_insights(actor: Actor = Depends(insights_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    snapshot = session.scalars(
        select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
    ).first()
    if not snapshot:
        payload = compute_insight_payload(session, actor.user_id)
        snapshot = persist_snapshot(session, actor.user_id, payload, source="live")
        refresh_coach_brief(session, actor.user_id, snapshot)
    return {"snapshot": serialize_snapshot(snapshot), "requested_by": actor.display_name}


@router.get("/insights/summary")
def get_insight_summary(
    actor: Actor = Depends(insights_read),
    session: Session = Depends(get_session),
    days: int = 90,
) -> dict[str, Any]:
    return {
        "summary": build_insight_summary(session, actor.user_id, window_days=days),
        "requested_by": actor.display_name,
    }


@router.post("/insights/recompute", status_code=status.HTTP_201_CREATED)
def recompute_insights(actor: Actor = Depends(insights_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    payload = compute_insight_payload(session, actor.user_id)
    snapshot = persist_snapshot(session, actor.user_id, payload, source="manual")
    refresh_coach_brief(session, actor.user_id, snapshot)
    write_audit(session, actor, "insights.recomputed", "insights", snapshot.id, {"source": "manual"})
    return {"snapshot": serialize_snapshot(snapshot)}


def compute_insight_payload(session: Session, user_id: str) -> dict[str, Any]:
    return build_insight_summary(session, user_id)


def build_insight_summary(session: Session, user_id: str, *, window_days: int = INSIGHT_NUTRITION_LOOKBACK_DAYS) -> dict[str, Any]:
    now = utcnow()
    nutrition_cutoff = now - timedelta(days=max(window_days, 14))
    weight_cutoff = now - timedelta(days=max(window_days, INSIGHT_WEIGHT_LOOKBACK_DAYS))
    workout_cutoff = now - timedelta(days=max(window_days, INSIGHT_WORKOUT_LOOKBACK_DAYS))

    meals = session.scalars(
        select(MealEntry)
        .where(
            MealEntry.user_id == user_id,
            MealEntry.deleted_at.is_(None),
            MealEntry.logged_at >= nutrition_cutoff,
        )
        .order_by(MealEntry.logged_at.asc())
    ).all()
    workouts = session.scalars(
        select(WorkoutSession)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.deleted_at.is_(None),
            WorkoutSession.started_at >= workout_cutoff,
        )
        .order_by(WorkoutSession.started_at.asc())
    ).all()
    weight_entries = session.scalars(
        select(WeightEntry)
        .where(
            WeightEntry.user_id == user_id,
            WeightEntry.deleted_at.is_(None),
            WeightEntry.logged_at >= weight_cutoff,
        )
        .order_by(WeightEntry.logged_at.asc())
    ).all()
    goals = session.scalars(
        select(Goal).where(Goal.user_id == user_id, Goal.deleted_at.is_(None), Goal.is_active.is_(True))
    ).all()

    calorie_goal = next((goal for goal in goals if goal.metric_key == "calories"), None)
    daily_calories: dict[str, float] = defaultdict(float)
    for meal in meals:
        daily_calories[meal.logged_at.date().isoformat()] += meal.total_calories
    calorie_values = list(daily_calories.values())
    avg_calories_7 = mean(calorie_values[-7:]) if calorie_values else 0
    adherence_ratio = avg_calories_7 / calorie_goal.target_value if calorie_goal and calorie_goal.target_value else None

    weights = [row.weight_kg for row in weight_entries]
    latest_weight = weight_entries[-1].weight_kg if weight_entries else None
    if latest_weight is None:
        latest_weight_row = session.scalars(
            select(WeightEntry)
            .where(WeightEntry.user_id == user_id, WeightEntry.deleted_at.is_(None))
            .order_by(WeightEntry.logged_at.desc())
            .limit(1)
        ).first()
        latest_weight = latest_weight_row.weight_kg if latest_weight_row else None
    weight_trend = weight_trend_per_week(weights)
    trend_7 = rolling_average(weights, 7)
    trend_30 = rolling_average(weights, 30)

    last_7_days = now - timedelta(days=7)
    prev_7_days = now - timedelta(days=14)
    recent_workouts = [row for row in workouts if row.started_at >= last_7_days]
    prior_workouts = [row for row in workouts if prev_7_days <= row.started_at < last_7_days]
    weekly_volume = sum(row.total_volume_kg for row in recent_workouts)
    previous_volume = sum(row.total_volume_kg for row in prior_workouts)
    volume_trend = weekly_volume - previous_volume
    pr_count = session.scalar(
        select(func.count(SetEntry.id)).where(
            SetEntry.user_id == user_id,
            SetEntry.is_pr.is_(True),
            SetEntry.is_warmup.is_(False),
        )
    ) or 0

    recovery_flags: list[str] = []
    if adherence_ratio is not None and adherence_ratio < 0.8:
        recovery_flags.append("Calorie adherence is low relative to the active goal.")
    if weight_trend < -0.5:
        recovery_flags.append("Bodyweight is dropping quickly; recovery may suffer.")
    if volume_trend < 0 and recent_workouts:
        recovery_flags.append("Weekly training volume is trending down.")

    recommendations: list[str] = []
    if adherence_ratio is not None:
        if adherence_ratio < 0.9:
            recommendations.append("Increase calorie consistency to support progressive overload.")
        elif adherence_ratio > 1.1:
            recommendations.append("Calories are running above target; monitor weight trend and adjust if needed.")
    if weight_trend > 0.35:
        recommendations.append("Weight is climbing steadily; check whether the gain rate matches your goal.")
    elif weight_trend < -0.35:
        recommendations.append("Weight is falling quickly; consider a recovery-focused week or more calories.")
    if volume_trend > 0:
        recommendations.append("Training volume is up week over week; push load on exercises that have topped the rep range.")
    elif recent_workouts:
        recommendations.append("Volume is flat or down; use the progression recommendations tab to identify stalled lifts.")

    return {
        "nutrition": {
            "daily_calories": daily_calories,
            "average_calories_7": round(avg_calories_7, 1),
            "goal_calories": calorie_goal.target_value if calorie_goal else None,
            "adherence_ratio": round(adherence_ratio, 3) if adherence_ratio is not None else None,
        },
        "body": {
            "latest_weight_kg": latest_weight,
            "weight_trend_kg_per_week": round(weight_trend, 3),
            "trend_7": trend_7,
            "trend_30": trend_30,
        },
        "training": {
            "weekly_volume_kg": round(weekly_volume, 1),
            "volume_delta_kg": round(volume_trend, 1),
            "session_count_7": len(recent_workouts),
            "last_session_at": recent_workouts[-1].started_at.isoformat() if recent_workouts else None,
            "pr_count": pr_count,
        },
        "recovery_flags": recovery_flags,
        "recommendations": recommendations,
        "generated_at": now.isoformat(),
        "window_days": window_days,
    }


def persist_snapshot(session: Session, user_id: str, payload: dict[str, Any], source: str) -> InsightSnapshot:
    snapshot = InsightSnapshot(user_id=user_id, source=source, payload_json=payload)
    session.add(snapshot)
    session.commit()
    session.refresh(snapshot)
    return snapshot


def serialize_snapshot(snapshot: InsightSnapshot) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "snapshot_date": snapshot.snapshot_date.isoformat(),
        "source": snapshot.source,
        "payload": snapshot.payload_json,
        "created_at": snapshot.created_at.isoformat(),
    }


def load_dashboard_cards(session: Session, actor: Actor) -> list[DashboardCardState]:
    snapshot = session.scalars(
        select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
    ).first()
    if not snapshot:
        payload = compute_insight_payload(session, actor.user_id)
        snapshot = persist_snapshot(session, actor.user_id, payload, source="dashboard")
    recommendation = (snapshot.payload_json.get("recommendations") or ["No recommendations yet."])[0]
    return [
        DashboardCardState(
            key="coaching-signal",
            title="Coaching Signal",
            route="/insights",
            description="Highest-priority recommendation from recent logs.",
            accent="lime",
            value="Insight",
            detail=recommendation,
            status="positive" if snapshot.payload_json.get("recommendations") else "neutral",
        )
    ]


def recompute_job(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    user_id = str(payload["user_id"])
    snapshot = persist_snapshot(session, user_id, compute_insight_payload(session, user_id), source="job")
    refresh_coach_brief(session, user_id, snapshot)
    return {"snapshot_id": snapshot.id, "scheduled": payload.get("scheduled", False)}


manifest = ModuleManifest(
    key="insights",
    router=router,
    dashboard_cards=[
        DashboardCardDefinition(
            key="coaching-signal",
            title="Coaching Signal",
            route="/insights",
            description="Nutrition, weight, and training recommendations.",
            accent="lime",
            priority=50,
        )
    ],
    dashboard_loader=load_dashboard_cards,
    job_handlers={"insights.recompute": recompute_job},
)
