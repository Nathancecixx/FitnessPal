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
from app.core.models import Exercise, InsightSnapshot, Routine, RoutineExercise, SetEntry, WorkoutSession, WorkoutTemplate, WorkoutTemplateExercise, utcnow
from app.core.modules import ModuleManifest
from app.core.ownership import ensure_owned
from app.core.pagination import decode_cursor, descending_cursor_filter, encode_cursor, page_rows
from app.core.schemas import DashboardCardDefinition, DashboardCardState
from app.core.security import Actor, require_scope


router = APIRouter(route_class=IdempotentRoute, tags=["training"])
training_read = require_scope("training:read")
training_write = require_scope("training:write")


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


class RoutineUpdate(RoutineCreate):
    pass


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


class WorkoutTemplateUpdate(WorkoutTemplateCreate):
    pass


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


class WorkoutSessionUpdate(WorkoutSessionCreate):
    pass


@router.get("/exercises")
def list_exercises(actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(Exercise).where(Exercise.user_id == actor.user_id, Exercise.deleted_at.is_(None)).order_by(Exercise.name.asc())
    ).all()
    return {"items": [serialize_exercise(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.post("/exercises", status_code=status.HTTP_201_CREATED)
def create_exercise(
    payload: ExerciseCreate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = Exercise(user_id=actor.user_id, **payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    write_audit(session, actor, "exercise.created", "exercise", row.id, payload.model_dump())
    return serialize_exercise(row)


@router.get("/exercises/{exercise_id}")
def get_exercise(exercise_id: str, actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, Exercise, exercise_id, actor.user_id, "Exercise not found.")
    return serialize_exercise(row)


@router.get("/exercises/{exercise_id}/progression")
def get_progression(exercise_id: str, actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    exercise = ensure_owned(session, Exercise, exercise_id, actor.user_id, "Exercise not found.")
    recent_sets = session.scalars(
        select(SetEntry)
        .where(SetEntry.user_id == actor.user_id, SetEntry.exercise_id == exercise.id, SetEntry.is_warmup.is_(False))
        .order_by(SetEntry.id.desc())
        .limit(6)
    ).all()
    snapshot = session.scalars(
        select(InsightSnapshot).where(InsightSnapshot.user_id == actor.user_id).order_by(InsightSnapshot.created_at.desc()).limit(1)
    ).first()
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
def list_routines(actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(Routine).where(Routine.user_id == actor.user_id, Routine.deleted_at.is_(None)).order_by(Routine.created_at.desc())
    ).all()
    return {"items": [serialize_routine(session, row) for row in rows], "total": len(rows)}


@router.post("/routines", status_code=status.HTTP_201_CREATED)
def create_routine(
    payload: RoutineCreate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = Routine(user_id=actor.user_id, name=payload.name, goal=payload.goal, schedule_notes=payload.schedule_notes, notes=payload.notes)
    session.add(row)
    try:
        session.flush()
        for item in payload.items:
            ensure_owned(session, Exercise, item.exercise_id, actor.user_id, f"Exercise {item.exercise_id} not found.")
            session.add(RoutineExercise(user_id=actor.user_id, routine_id=row.id, **item.model_dump()))
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "routine.created", "routine", row.id, payload.model_dump())
    return serialize_routine(session, row)


@router.get("/routines/{routine_id}")
def get_routine(routine_id: str, actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, Routine, routine_id, actor.user_id, "Routine not found.")
    return serialize_routine(session, row)


@router.patch("/routines/{routine_id}")
def update_routine(
    routine_id: str,
    payload: RoutineUpdate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = ensure_owned(session, Routine, routine_id, actor.user_id, "Routine not found.")
    row.name = payload.name
    row.goal = payload.goal
    row.schedule_notes = payload.schedule_notes
    row.notes = payload.notes
    try:
        existing_items = session.scalars(
            select(RoutineExercise).where(RoutineExercise.user_id == actor.user_id, RoutineExercise.routine_id == row.id)
        ).all()
        for existing in existing_items:
            session.delete(existing)
        session.flush()
        for item in payload.items:
            ensure_owned(session, Exercise, item.exercise_id, actor.user_id, f"Exercise {item.exercise_id} not found.")
            session.add(RoutineExercise(user_id=actor.user_id, routine_id=row.id, **item.model_dump()))
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "routine.updated", "routine", row.id, payload.model_dump())
    return serialize_routine(session, row)


@router.delete("/routines/{routine_id}")
def delete_routine(routine_id: str, actor: Actor = Depends(training_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, Routine, routine_id, actor.user_id, "Routine not found.")
    row.deleted_at = utcnow()
    session.commit()
    write_audit(session, actor, "routine.deleted", "routine", row.id, {"name": row.name})
    return {"status": "deleted", "id": row.id}


@router.get("/workout-templates")
def list_workout_templates(actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(
        select(WorkoutTemplate)
        .where(WorkoutTemplate.user_id == actor.user_id, WorkoutTemplate.deleted_at.is_(None))
        .order_by(WorkoutTemplate.created_at.desc())
    ).all()
    return {"items": [serialize_workout_template(session, row) for row in rows], "total": len(rows)}


@router.post("/workout-templates", status_code=status.HTTP_201_CREATED)
def create_workout_template(
    payload: WorkoutTemplateCreate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        row = persist_workout_template(session, user_id=actor.user_id, workout_template=None, payload=payload)
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "workout_template.created", "workout_template", row.id, payload.model_dump())
    return serialize_workout_template(session, row)


@router.get("/workout-templates/{template_id}")
def get_workout_template(template_id: str, actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutTemplate, template_id, actor.user_id, "Workout template not found.")
    return serialize_workout_template(session, row)


@router.patch("/workout-templates/{template_id}")
def update_workout_template(
    template_id: str,
    payload: WorkoutTemplateUpdate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutTemplate, template_id, actor.user_id, "Workout template not found.")
    try:
        persist_workout_template(session, user_id=actor.user_id, workout_template=row, payload=payload)
        session.commit()
    except Exception:
        session.rollback()
        raise
    write_audit(session, actor, "workout_template.updated", "workout_template", row.id, payload.model_dump())
    return serialize_workout_template(session, row)


@router.delete("/workout-templates/{template_id}")
def delete_workout_template(template_id: str, actor: Actor = Depends(training_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutTemplate, template_id, actor.user_id, "Workout template not found.")
    row.deleted_at = utcnow()
    session.commit()
    write_audit(session, actor, "workout_template.deleted", "workout_template", row.id, {})
    return {"status": "deleted", "id": row.id}


@router.get("/workout-sessions")
def list_workout_sessions(
    actor: Actor = Depends(training_read),
    session: Session = Depends(get_session),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    template_id: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
    cursor: str | None = Query(default=None),
) -> dict[str, Any]:
    query = (
        select(WorkoutSession)
        .where(WorkoutSession.user_id == actor.user_id, WorkoutSession.deleted_at.is_(None))
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
    )
    conditions = []
    if date_from:
        conditions.append(WorkoutSession.started_at >= date_from)
    if date_to:
        conditions.append(WorkoutSession.started_at <= date_to)
    if template_id:
        conditions.append(WorkoutSession.template_id == template_id)
    if cursor:
        cursor_value, cursor_id = decode_cursor(cursor)
        conditions.append(
            descending_cursor_filter(
                WorkoutSession.started_at,
                WorkoutSession.id,
                datetime.fromisoformat(cursor_value),
                cursor_id,
            )
        )
    if conditions:
        query = query.where(and_(*conditions))
    rows = session.scalars(query.limit(limit + 1)).all()
    page, has_more = page_rows(rows, limit)
    next_cursor = encode_cursor(page[-1].started_at, page[-1].id) if has_more and page else None
    return {
        "items": [serialize_workout_session(session, row) for row in page],
        "total": len(page),
        "limit": limit,
        "has_more": has_more,
        "next_cursor": next_cursor,
    }


@router.post("/workout-sessions", status_code=status.HTTP_201_CREATED)
def create_workout_session(
    payload: WorkoutSessionCreate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        row = persist_workout_session(session, user_id=actor.user_id, workout_session=None, payload=payload)
        session.commit()
    except Exception:
        session.rollback()
        raise
    enqueue_job(
        session,
        "insights.recompute",
        actor.user_id,
        {"source": "workout", "workout_session_id": row.id, "user_id": actor.user_id},
        dedupe_key=f"insights-live:{actor.user_id}:{utcnow().strftime('%Y%m%d%H%M')}",
    )
    write_audit(session, actor, "workout_session.created", "workout_session", row.id, payload.model_dump())
    return serialize_workout_session(session, row)


@router.get("/workout-sessions/{session_id}")
def get_workout_session(session_id: str, actor: Actor = Depends(training_read), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutSession, session_id, actor.user_id, "Workout session not found.")
    return serialize_workout_session(session, row)


@router.patch("/workout-sessions/{session_id}")
def update_workout_session(
    session_id: str,
    payload: WorkoutSessionUpdate,
    actor: Actor = Depends(training_write),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutSession, session_id, actor.user_id, "Workout session not found.")
    try:
        persist_workout_session(session, user_id=actor.user_id, workout_session=row, payload=payload)
        session.commit()
    except Exception:
        session.rollback()
        raise
    enqueue_job(
        session,
        "insights.recompute",
        actor.user_id,
        {"source": "workout_update", "workout_session_id": row.id, "user_id": actor.user_id},
        dedupe_key=f"insights-live:{actor.user_id}:{utcnow().strftime('%Y%m%d%H%M')}",
    )
    write_audit(session, actor, "workout_session.updated", "workout_session", row.id, payload.model_dump())
    return serialize_workout_session(session, row)


@router.delete("/workout-sessions/{session_id}")
def delete_workout_session(session_id: str, actor: Actor = Depends(training_write), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = ensure_owned(session, WorkoutSession, session_id, actor.user_id, "Workout session not found.")
    row.deleted_at = utcnow()
    session.commit()
    enqueue_job(
        session,
        "insights.recompute",
        actor.user_id,
        {"source": "workout_delete", "workout_session_id": row.id, "user_id": actor.user_id},
        dedupe_key=f"insights-live:{actor.user_id}:{utcnow().strftime('%Y%m%d%H%M')}",
    )
    write_audit(session, actor, "workout_session.deleted", "workout_session", row.id, {"template_id": row.template_id})
    return {"status": "deleted", "id": row.id}


def persist_workout_session(
    session: Session,
    *,
    user_id: str,
    workout_session: WorkoutSession | None,
    payload: WorkoutSessionCreate,
) -> WorkoutSession:
    if payload.template_id:
        ensure_owned(session, WorkoutTemplate, payload.template_id, user_id, "Workout template not found.")
    if payload.routine_id:
        ensure_owned(session, Routine, payload.routine_id, user_id, "Routine not found.")

    row = workout_session or WorkoutSession(user_id=user_id)
    row.user_id = user_id
    row.template_id = payload.template_id
    row.routine_id = payload.routine_id
    row.started_at = payload.started_at or row.started_at or utcnow()
    row.ended_at = payload.ended_at
    row.notes = payload.notes
    row.perceived_energy = payload.perceived_energy
    row.bodyweight_kg = payload.bodyweight_kg
    session.add(row)
    session.flush()

    existing_sets = session.scalars(
        select(SetEntry).where(SetEntry.user_id == user_id, SetEntry.workout_session_id == row.id)
    ).all()
    for existing in existing_sets:
        session.delete(existing)
    session.flush()

    total_volume = 0.0
    working_sets = 0
    for item in payload.sets:
        exercise = ensure_owned(session, Exercise, item.exercise_id, user_id, f"Exercise {item.exercise_id} not found.")
        if item.template_exercise_id:
            ensure_owned(session, WorkoutTemplateExercise, item.template_exercise_id, user_id, "Template exercise not found.")
        prior_max = session.scalar(
            select(func.max(SetEntry.load_kg)).where(
                SetEntry.user_id == user_id,
                SetEntry.exercise_id == exercise.id,
                SetEntry.workout_session_id != row.id,
                SetEntry.is_warmup.is_(False),
            )
        ) or 0
        is_pr = not item.is_warmup and item.load_kg >= prior_max and item.reps >= exercise.rep_target_min
        progression_label = "warmup" if item.is_warmup else ("pr" if is_pr else "working")
        session.add(
            SetEntry(
                user_id=user_id,
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
    return row


def persist_workout_template(
    session: Session,
    *,
    user_id: str,
    workout_template: WorkoutTemplate | None,
    payload: WorkoutTemplateCreate,
) -> WorkoutTemplate:
    if payload.routine_id:
        ensure_owned(session, Routine, payload.routine_id, user_id, "Routine not found.")

    row = workout_template or WorkoutTemplate(user_id=user_id)
    row.user_id = user_id
    row.name = payload.name
    row.routine_id = payload.routine_id
    row.notes = payload.notes
    session.add(row)
    session.flush()

    existing_items = session.scalars(
        select(WorkoutTemplateExercise).where(
            WorkoutTemplateExercise.user_id == user_id,
            WorkoutTemplateExercise.workout_template_id == row.id,
        )
    ).all()
    for existing in existing_items:
        session.delete(existing)
    session.flush()

    for item in payload.items:
        ensure_owned(session, Exercise, item.exercise_id, user_id, f"Exercise {item.exercise_id} not found.")
        session.add(WorkoutTemplateExercise(user_id=user_id, workout_template_id=row.id, **item.model_dump()))
    return row


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
    items = session.scalars(
        select(RoutineExercise)
        .where(RoutineExercise.user_id == row.user_id, RoutineExercise.routine_id == row.id)
        .order_by(RoutineExercise.order_index.asc())
    ).all()
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
                "exercise_name": session.get(Exercise, item.exercise_id).name
                if session.get(Exercise, item.exercise_id) and session.get(Exercise, item.exercise_id).user_id == row.user_id
                else None,
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
        "exercise_name": exercise.name if exercise and exercise.user_id == item.user_id else None,
        "order_index": item.order_index,
        "target_sets": item.target_sets,
        "target_reps_min": item.target_reps_min,
        "target_reps_max": item.target_reps_max,
        "rest_seconds": item.rest_seconds,
        "target_rir": item.target_rir,
    }


def serialize_workout_template(session: Session, row: WorkoutTemplate) -> dict[str, Any]:
    items = session.scalars(
        select(WorkoutTemplateExercise)
        .where(WorkoutTemplateExercise.user_id == row.user_id, WorkoutTemplateExercise.workout_template_id == row.id)
        .order_by(WorkoutTemplateExercise.order_index.asc())
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
    sets = session.scalars(
        select(SetEntry).where(SetEntry.user_id == row.user_id, SetEntry.workout_session_id == row.id).order_by(SetEntry.set_index.asc())
    ).all()
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


def load_dashboard_cards(session: Session, actor: Actor) -> list[DashboardCardState]:
    latest = session.scalars(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == actor.user_id, WorkoutSession.deleted_at.is_(None))
        .order_by(WorkoutSession.started_at.desc())
        .limit(1)
    ).first()
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
)
