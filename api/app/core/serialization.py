from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime
from sqlalchemy.inspection import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.models import (
    ApiKey,
    AppUser,
    AuditLog,
    Exercise,
    ExportRecord,
    FoodItem,
    Goal,
    InsightSnapshot,
    JobRecord,
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
    AppUser,
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
    ApiKey,
    AuditLog,
    ExportRecord,
    JobRecord,
]


def serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def serialize_instance(instance: Any) -> dict[str, Any]:
    mapper = sa_inspect(instance.__class__)
    return {column.key: serialize_value(getattr(instance, column.key)) for column in mapper.columns}


def export_payload(session: Session) -> dict[str, Any]:
    tables: dict[str, list[dict[str, Any]]] = {}
    for model in EXPORT_MODELS:
        rows = session.query(model).all()
        tables[model.__tablename__] = [serialize_instance(row) for row in rows]
    return {
        "version": "0.1.0",
        "exported_at": datetime.utcnow().isoformat(),
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


def restore_payload(session: Session, payload: dict[str, Any]) -> dict[str, int]:
    tables = payload.get("tables", {})
    counts: dict[str, int] = {}
    for model in EXPORT_MODELS:
        rows = tables.get(model.__tablename__, [])
        counts[model.__tablename__] = 0
        mapper = sa_inspect(model)
        primary_keys = [column.key for column in mapper.primary_key]
        for row in rows:
            criteria = {key: row[key] for key in primary_keys if key in row}
            existing = session.get(model, tuple(criteria.values()) if len(criteria) > 1 else next(iter(criteria.values()), None))
            values = {
                column.key: _coerce_value(column.type, row.get(column.key))
                for column in mapper.columns
                if column.key in row
            }
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
            else:
                session.add(model(**values))
            counts[model.__tablename__] += 1
        session.commit()
    return counts
