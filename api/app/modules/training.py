from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.jobs import enqueue_job
from app.core.logic import ProgressionContext, SetPerformance, recommend_progression
from app.core.models import (
    Exercise,
    InsightSnapshot,
    Routine,
    RoutineExercise,
    SetEntry,
    WorkoutSession,
    WorkoutTemplate,
    WorkoutTemplateExercise,
    utcnow,
)
from app.core.modules import ModuleManifest
from app.core.schemas import AgentExample, DashboardCardDefinition, DashboardCardState
from app.core.security import Actor, get_actor


router = APIRouter(route_class=IdempotentRoute, tags=["training"])


class ExerciseCreate(BaseModel):
    name: str
    category: str = "strength"
    movement_pattern: str | None = None
    equipment: str | None = None
    primary_muscles_json: list[str] = Field(default_factory=list)
    progression_mode: str = "double_progression"
    rep_target_min: int = 6
    rep_target_max: int = 10
    load_increment: float = 2.5
    notes: str | None = None


class RoutineExerciseInput(BaseModel):
    exercise_id: str
    day_label: str = "Day 1"
    order_index: int = 0
    target_sets: int = 3
    target_reps_min: int = 6
    target_reps_max: int = 10
    target_rir: float | None = None


class RoutineCreate(BaseModel):
    name: str
    goal: str | None = None
    schedule_notes: str | None = None
    notes: str | None = None
    items: list[RoutineExerciseInput] = Field(default_factory=list)


class WorkoutTemplateExerciseInput(BaseModel):
    exercise_id: str
    order_index: int = 0
    target_sets: int = 3
    target_reps_min: int = 6
    target_reps_max: int = 10
    rest_seconds: int = 120
    target_rir: float | None = None


class WorkoutTemplateCreate(BaseModel):
    name: str
    routine_id: str | None = None
    notes: str | None = None
    items: list[WorkoutTemplateExerciseInput] = Field(default_factory=list)


class SetEntryInput(BaseModel):
    exercise_id: str
    template_exercise_id: str | None = None
    set_index: int
    reps: int
    load_kg: float
    rir: float | None = None
    rpe: float | None = None
    rest_seconds: int | None = None
    is_warmup: bool = False
    notes: str | None = None


class WorkoutSessionCreate(BaseModel):
    template_id: str | None = None
    routine_id: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    notes: str | None = None
    perceived_energy: int | None = None
    bodyweight_kg: float | None = None
    sets: list[SetEntryInput] = Field(default_factory=list)


@router.get("/exercises")
def list_exercises(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(Exercise).where(Exercise.deleted_at.is_(None)).order_by(Exercise.name.asc())).all()
    return {"items": [serialize_exercise(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.post("/exercises", status_code=status.HTTP_201_CREATED)
def create_exercise(
    payload: ExerciseCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = Exercise(**payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    write_audit(session, actor, "exercise.created", "exercise", row.id, payload.model_dump())
    return serialize_exercise(row)


@router.get("/exercises/{exercise_id}")
def get_exercise(exercise_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(Exercise, exercise_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Exercise not found.")
    return serialize_exercise(row)


@router.get("/exercises/{exercise_id}/progression")
def get_progression(exercise_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    exercise = session.get(Exercise, exercise_id)
    if not exercise or exercise.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Exercise not found.")
    recent_sets = session.scalars(
        select(SetEntry)
        .where(SetEntry.exercise_id == exercise.id, SetEntry.is_warmup.is_(False))
        .order_by(SetEntry.id.desc())
        .limit(6)
    ).all()
    snapshot = session.scalars(select(InsightSnapshot).order_by(InsightSnapshot.created_at.desc()).limit(1)).first()
    nutrition = snapshot.payload_json.get("nutrition", {}) if snapshot else {}
    body = snapshot.payload_json.get("body", {}) if snapshot else {}
    recommendation = recommend_progression(
        ProgressionContext(
            rep_target_min=exercise.rep_target_min,
            rep_target_max=exercise.rep_target_max,
            load_increment=exercise.load_increment,
            recent_sets=[
                SetPerformance(reps=item.reps, load_kg=item.load_kg, rir=item.rir, completed_at=item.created_at)
                for item in reversed(recent_sets)
            ],
            calorie_adherence=nutrition.get("adherence_ratio"),
            weight_trend_kg_per_week=body.get("weight_trend_kg_per_week"),
        )
    )
    return {
        "exercise": serialize_exercise(exercise),
        "recommendation": recommendation,
        "recent_sets": [serialize_set(item) for item in recent_sets],
    }


@router.get("/routines")
def list_routines(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(Routine).where(Routine.deleted_at.is_(None)).order_by(Routine.created_at.desc())).all()
    return {"items": [serialize_routine(session, row) for row in rows], "total": len(rows)}


@router.post("/routines", status_code=status.HTTP_201_CREATED)
def create_routine(
    payload: RoutineCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = Routine(name=payload.name, goal=payload.goal, schedule_notes=payload.schedule_notes, notes=payload.notes)
    session.add(row)
    try:
        session.flush()
        for item in payload.items:
            if not session.get(Exercise, item.exercise_id):
                raise HTTPException(status_code=404, detail=f"Exercise {item.exercise_id} not found.")
            session.add(RoutineExercise(routine_id=row.id, **item.model_dump()))
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "routine.created", "routine", row.id, payload.model_dump())
    return serialize_routine(session, row)


@router.get("/workout-templates")
def list_workout_templates(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(WorkoutTemplate).where(WorkoutTemplate.deleted_at.is_(None)).order_by(WorkoutTemplate.created_at.desc())).all()
    return {"items": [serialize_workout_template(session, row) for row in rows], "total": len(rows)}


@router.post("/workout-templates", status_code=status.HTTP_201_CREATED)
def create_workout_template(
    payload: WorkoutTemplateCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if payload.routine_id and not session.get(Routine, payload.routine_id):
        raise HTTPException(status_code=404, detail="Routine not found.")
    row = WorkoutTemplate(name=payload.name, routine_id=payload.routine_id, notes=payload.notes)
    session.add(row)
    try:
        session.flush()
        for item in payload.items:
            if not session.get(Exercise, item.exercise_id):
                raise HTTPException(status_code=404, detail=f"Exercise {item.exercise_id} not found.")
            session.add(WorkoutTemplateExercise(workout_template_id=row.id, **item.model_dump()))
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "workout_template.created", "workout_template", row.id, payload.model_dump())
    return serialize_workout_template(session, row)


@router.get("/workout-templates/{template_id}")
def get_workout_template(template_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(WorkoutTemplate, template_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Workout template not found.")
    return serialize_workout_template(session, row)


@router.get("/workout-sessions")
def list_workout_sessions(
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    template_id: str | None = Query(default=None),
) -> dict[str, Any]:
    query = select(WorkoutSession).where(WorkoutSession.deleted_at.is_(None)).order_by(WorkoutSession.started_at.desc())
    conditions = []
    if date_from:
        conditions.append(WorkoutSession.started_at >= date_from)
    if date_to:
        conditions.append(WorkoutSession.started_at <= date_to)
    if template_id:
        conditions.append(WorkoutSession.template_id == template_id)
    if conditions:
        query = query.where(and_(*conditions))
    rows = session.scalars(query).all()
    return {"items": [serialize_workout_session(session, row) for row in rows], "total": len(rows)}


@router.post("/workout-sessions", status_code=status.HTTP_201_CREATED)
def create_workout_session(
    payload: WorkoutSessionCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = WorkoutSession(
        template_id=payload.template_id,
        routine_id=payload.routine_id,
        started_at=payload.started_at or utcnow(),
        ended_at=payload.ended_at,
        notes=payload.notes,
        perceived_energy=payload.perceived_energy,
        bodyweight_kg=payload.bodyweight_kg,
    )
    session.add(row)
    total_volume = 0.0
    working_sets = 0
    try:
        session.flush()
        for item in payload.sets:
            exercise = session.get(Exercise, item.exercise_id)
            if not exercise or exercise.deleted_at is not None:
                raise HTTPException(status_code=404, detail=f"Exercise {item.exercise_id} not found.")
            prior_max = session.scalar(
                select(func.max(SetEntry.load_kg)).where(SetEntry.exercise_id == exercise.id, SetEntry.is_warmup.is_(False))
            ) or 0
            is_pr = not item.is_warmup and item.load_kg >= prior_max and item.reps >= exercise.rep_target_min
            progression_label = "warmup" if item.is_warmup else ("pr" if is_pr else "working")
            session.add(
                SetEntry(
                    workout_session_id=row.id,
                    exercise_id=item.exercise_id,
                    template_exercise_id=item.template_exercise_id,
                    set_index=item.set_index,
                    reps=item.reps,
                    load_kg=item.load_kg,
                    rir=item.rir,
                    rpe=item.rpe,
                    rest_seconds=item.rest_seconds,
                    is_warmup=item.is_warmup,
                    is_pr=is_pr,
                    progression_label=progression_label,
                    notes=item.notes,
                )
            )
            if not item.is_warmup:
                total_volume += item.load_kg * item.reps
                working_sets += 1
        row.total_volume_kg = round(total_volume, 2)
        row.total_sets = working_sets
        session.commit()
    except Exception:
        session.rollback()
        raise
    enqueue_job(session, "insights.recompute", {"source": "workout", "workout_session_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "workout_session.created", "workout_session", row.id, payload.model_dump())
    return serialize_workout_session(session, row)


@router.get("/workout-sessions/{session_id}")
def get_workout_session(session_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(WorkoutSession, session_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Workout session not found.")
    return serialize_workout_session(session, row)


@router.delete("/workout-sessions/{session_id}")
def delete_workout_session(session_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(WorkoutSession, session_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Workout session not found.")
    row.deleted_at = utcnow()
    session.commit()
    enqueue_job(session, "insights.recompute", {"source": "workout_delete", "workout_session_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "workout_session.deleted", "workout_session", row.id, {"template_id": row.template_id})
    return {"status": "deleted", "id": row.id}


def serialize_exercise(row: Exercise) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "category": row.category,
        "movement_pattern": row.movement_pattern,
        "equipment": row.equipment,
        "primary_muscles_json": row.primary_muscles_json,
        "progression_mode": row.progression_mode,
        "rep_target_min": row.rep_target_min,
        "rep_target_max": row.rep_target_max,
        "load_increment": row.load_increment,
        "notes": row.notes,
        "created_at": row.created_at.isoformat(),
    }


def serialize_routine(session: Session, row: Routine) -> dict[str, Any]:
    items = session.scalars(select(RoutineExercise).where(RoutineExercise.routine_id == row.id).order_by(RoutineExercise.order_index.asc())).all()
    return {
        "id": row.id,
        "name": row.name,
        "goal": row.goal,
        "schedule_notes": row.schedule_notes,
        "notes": row.notes,
        "items": [
            {
                "id": item.id,
                "exercise_id": item.exercise_id,
                "exercise_name": session.get(Exercise, item.exercise_id).name if session.get(Exercise, item.exercise_id) else None,
                "day_label": item.day_label,
                "order_index": item.order_index,
                "target_sets": item.target_sets,
                "target_reps_min": item.target_reps_min,
                "target_reps_max": item.target_reps_max,
                "target_rir": item.target_rir,
            }
            for item in items
        ],
        "created_at": row.created_at.isoformat(),
    }


def serialize_template_exercise(session: Session, item: WorkoutTemplateExercise) -> dict[str, Any]:
    exercise = session.get(Exercise, item.exercise_id)
    return {
        "id": item.id,
        "exercise_id": item.exercise_id,
        "exercise_name": exercise.name if exercise else None,
        "order_index": item.order_index,
        "target_sets": item.target_sets,
        "target_reps_min": item.target_reps_min,
        "target_reps_max": item.target_reps_max,
        "rest_seconds": item.rest_seconds,
        "target_rir": item.target_rir,
    }


def serialize_workout_template(session: Session, row: WorkoutTemplate) -> dict[str, Any]:
    items = session.scalars(
        select(WorkoutTemplateExercise).where(WorkoutTemplateExercise.workout_template_id == row.id).order_by(WorkoutTemplateExercise.order_index.asc())
    ).all()
    return {
        "id": row.id,
        "name": row.name,
        "routine_id": row.routine_id,
        "notes": row.notes,
        "items": [serialize_template_exercise(session, item) for item in items],
        "created_at": row.created_at.isoformat(),
    }


def serialize_set(row: SetEntry) -> dict[str, Any]:
    return {
        "id": row.id,
        "exercise_id": row.exercise_id,
        "template_exercise_id": row.template_exercise_id,
        "set_index": row.set_index,
        "reps": row.reps,
        "load_kg": row.load_kg,
        "rir": row.rir,
        "rpe": row.rpe,
        "rest_seconds": row.rest_seconds,
        "is_warmup": row.is_warmup,
        "is_pr": row.is_pr,
        "progression_label": row.progression_label,
        "notes": row.notes,
    }


def serialize_workout_session(session: Session, row: WorkoutSession) -> dict[str, Any]:
    sets = session.scalars(select(SetEntry).where(SetEntry.workout_session_id == row.id).order_by(SetEntry.set_index.asc())).all()
    return {
        "id": row.id,
        "template_id": row.template_id,
        "routine_id": row.routine_id,
        "started_at": row.started_at.isoformat(),
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "notes": row.notes,
        "perceived_energy": row.perceived_energy,
        "bodyweight_kg": row.bodyweight_kg,
        "total_volume_kg": row.total_volume_kg,
        "total_sets": row.total_sets,
        "sets": [serialize_set(item) for item in sets],
    }


def load_dashboard_cards(session: Session) -> list[DashboardCardState]:
    latest = session.scalars(select(WorkoutSession).where(WorkoutSession.deleted_at.is_(None)).order_by(WorkoutSession.started_at.desc()).limit(1)).first()
    return [
        DashboardCardState(
            key="last-workout-volume",
            title="Last Workout",
            route="/training",
            description="Recent training volume and readiness.",
            accent="sky",
            value=round(latest.total_volume_kg, 1) if latest else 0,
            detail=f"{latest.total_sets} working sets" if latest else "No workout logged yet",
            status="positive" if latest else "neutral",
        )
    ]


manifest = ModuleManifest(
    key="training",
    router=router,
    dashboard_cards=[
        DashboardCardDefinition(
            key="last-workout-volume",
            title="Last Workout",
            route="/training",
            description="Recent volume, sets, and overload signals.",
            accent="sky",
            priority=30,
        )
    ],
    dashboard_loader=load_dashboard_cards,
    agent_examples=[
        AgentExample(
            key="create-exercise",
            title="Create exercise",
            method="POST",
            path="/api/v1/exercises",
            summary="Store a new exercise with progression defaults.",
            request_body={
                "name": "Barbell bench press",
                "category": "strength",
                "rep_target_min": 6,
                "rep_target_max": 10,
                "load_increment": 2.5,
            },
        ),
        AgentExample(
            key="log-workout",
            title="Log workout",
            method="POST",
            path="/api/v1/workout-sessions",
            summary="Record a workout session with set-by-set detail.",
            request_body={
                "notes": "Push day",
                "sets": [
                    {"exercise_id": "exercise_ulid", "set_index": 1, "reps": 8, "load_kg": 100, "rir": 2},
                    {"exercise_id": "exercise_ulid", "set_index": 2, "reps": 8, "load_kg": 100, "rir": 1},
                ],
            },
        ),
    ],
)
