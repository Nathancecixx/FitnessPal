from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.jobs import enqueue_job
from app.core.logic import rolling_average, weight_trend_per_week
from app.core.models import WeightEntry, utcnow
from app.core.modules import ModuleManifest
from app.core.schemas import AgentExample, DashboardCardDefinition, DashboardCardState
from app.core.security import Actor, get_actor


router = APIRouter(route_class=IdempotentRoute, tags=["metrics"])


class WeightEntryCreate(BaseModel):
    logged_at: datetime | None = None
    weight_kg: float
    body_fat_pct: float | None = None
    waist_cm: float | None = None
    notes: str | None = None


@router.get("/weight-entries")
def list_weight_entries(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(WeightEntry).where(WeightEntry.deleted_at.is_(None)).order_by(WeightEntry.logged_at.desc())).all()
    return {"items": [serialize_weight_entry(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.post("/weight-entries", status_code=status.HTTP_201_CREATED)
def create_weight_entry(
    payload: WeightEntryCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = WeightEntry(
        logged_at=payload.logged_at or utcnow(),
        weight_kg=payload.weight_kg,
        body_fat_pct=payload.body_fat_pct,
        waist_cm=payload.waist_cm,
        notes=payload.notes,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    enqueue_job(session, "insights.recompute", {"source": "weight", "weight_entry_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "weight_entry.created", "weight_entry", row.id, payload.model_dump())
    return serialize_weight_entry(row)


@router.get("/weight-entries/trends")
def get_weight_trends(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(WeightEntry).where(WeightEntry.deleted_at.is_(None)).order_by(WeightEntry.logged_at.asc())).all()
    weights = [row.weight_kg for row in rows]
    trend_7 = rolling_average(weights, 7)
    trend_30 = rolling_average(weights, 30)
    return {
        "points": [
            {
                "logged_at": row.logged_at.isoformat(),
                "weight_kg": row.weight_kg,
                "trend_7": trend_7[idx] if idx < len(trend_7) else row.weight_kg,
                "trend_30": trend_30[idx] if idx < len(trend_30) else row.weight_kg,
            }
            for idx, row in enumerate(rows)
        ],
        "weight_trend_kg_per_week": weight_trend_per_week(weights),
    }


@router.delete("/weight-entries/{entry_id}")
def delete_weight_entry(entry_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(WeightEntry, entry_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Weight entry not found.")
    row.deleted_at = utcnow()
    session.commit()
    enqueue_job(session, "insights.recompute", {"source": "weight_delete", "weight_entry_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "weight_entry.deleted", "weight_entry", row.id, {"weight_kg": row.weight_kg})
    return {"status": "deleted", "id": row.id}


def serialize_weight_entry(row: WeightEntry) -> dict[str, Any]:
    return {
        "id": row.id,
        "logged_at": row.logged_at.isoformat(),
        "weight_kg": row.weight_kg,
        "body_fat_pct": row.body_fat_pct,
        "waist_cm": row.waist_cm,
        "notes": row.notes,
    }


def load_dashboard_cards(session: Session) -> list[DashboardCardState]:
    rows = session.scalars(select(WeightEntry).where(WeightEntry.deleted_at.is_(None)).order_by(WeightEntry.logged_at.asc())).all()
    if not rows:
        return [
            DashboardCardState(
                key="weight-trend",
                title="Weight Trend",
                route="/weight",
                description="Rolling bodyweight trend.",
                accent="rose",
                value="No data",
                detail="Log your first weigh-in",
                status="neutral",
            )
        ]
    weekly_trend = weight_trend_per_week([row.weight_kg for row in rows])
    latest = rows[-1]
    return [
        DashboardCardState(
            key="weight-trend",
            title="Weight Trend",
            route="/weight",
            description="Rolling bodyweight trend.",
            accent="rose",
            value=latest.weight_kg,
            detail=f"{weekly_trend:+.2f} kg/week",
            trend=weekly_trend,
            status="positive" if weekly_trend >= 0 else "neutral",
        )
    ]


manifest = ModuleManifest(
    key="metrics",
    router=router,
    dashboard_cards=[
        DashboardCardDefinition(
            key="weight-trend",
            title="Weight Trend",
            route="/weight",
            description="Daily weigh-ins and rolling averages.",
            accent="rose",
            priority=40,
        )
    ],
    dashboard_loader=load_dashboard_cards,
    agent_examples=[
        AgentExample(
            key="log-weight",
            title="Log weight",
            method="POST",
            path="/api/v1/weight-entries",
            summary="Log a weigh-in with optional body-fat or waist measurement.",
            request_body={"weight_kg": 82.4, "body_fat_pct": 15.8, "waist_cm": 84.2},
        )
    ],
)
