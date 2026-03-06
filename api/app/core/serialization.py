from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, select
from sqlalchemy.inspection import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.models import (
    Exercise,
    FoodItem,
    Goal,
    InsightSnapshot,
    MealEntry,
    MealEntryItem,
    MealTemplate,
    MealTemplateItem,
    PhotoAnalysisDraft,
    Recipe,
    RecipeItem,
    Routine,
    RoutineExercise,
    SetEntry,
    WeightEntry,
    WorkoutSession,
    WorkoutTemplate,
    WorkoutTemplateExercise,
)


EXPORT_MODELS = [
    Goal,
    FoodItem,
    Recipe,
    RecipeItem,
    MealTemplate,
    MealTemplateItem,
    PhotoAnalysisDraft,
    MealEntry,
    MealEntryItem,
    Exercise,
    Routine,
    RoutineExercise,
    WorkoutTemplate,
    WorkoutTemplateExercise,
    WorkoutSession,
    SetEntry,
    WeightEntry,
    InsightSnapshot,
]


def serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def serialize_instance(instance: Any) -> dict[str, Any]:
    mapper = sa_inspect(instance.__class__)
    return {column.key: serialize_value(getattr(instance, column.key)) for column in mapper.columns}


def export_payload(session: Session, user_id: str) -> dict[str, Any]:
    tables: dict[str, list[dict[str, Any]]] = {}
    for model in EXPORT_MODELS:
        rows = session.scalars(select(model).where(model.user_id == user_id)).all()
        tables[model.__tablename__] = [serialize_instance(row) for row in rows]
    return {
        "version": "0.2.0",
        "exported_at": datetime.utcnow().isoformat(),
        "owner": {"user_id": user_id},
        "tables": tables,
    }


def _coerce_value(column_type: Any, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(column_type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    if isinstance(column_type, Date) and isinstance(value, str):
        return date.fromisoformat(value)
    return value


def restore_payload(session: Session, payload: dict[str, Any], user_id: str) -> dict[str, int]:
    tables = payload.get("tables", {})
    counts: dict[str, int] = {}
    try:
        for model in EXPORT_MODELS:
            rows = tables.get(model.__tablename__, [])
            counts[model.__tablename__] = 0
            mapper = sa_inspect(model)
            primary_keys = [column.key for column in mapper.primary_key]
            for row in rows:
                values = {
                    column.key: _coerce_value(column.type, row.get(column.key))
                    for column in mapper.columns
                    if column.key in row
                }
                if "user_id" in {column.key for column in mapper.columns}:
                    values["user_id"] = user_id
                existing_id = next((row[key] for key in primary_keys if key in row), None)
                existing = session.get(model, existing_id) if existing_id else None
                if existing and getattr(existing, "user_id", user_id) == user_id:
                    for key, value in values.items():
                        setattr(existing, key, value)
                else:
                    session.add(model(**values))
                counts[model.__tablename__] += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    return counts
