from __future__ import annotations

from datetime import date, datetime, timezone
import secrets
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_ulid() -> str:
    timestamp_ms = int(utcnow().timestamp() * 1000)
    randomness = secrets.randbits(80)
    value = (timestamp_ms << 80) | randomness
    chars: list[str] = []
    for _ in range(26):
        value, remainder = divmod(value, 32)
        chars.append(_CROCKFORD[remainder])
    return "".join(reversed(chars))


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


class OwnedMixin:
    user_id: Mapped[str] = mapped_column(ForeignKey("app_users.id"), index=True)


class AppUser(TimestampMixin, Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    password_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasswordSetupToken(TimestampMixin, Base):
    __tablename__ = "password_setup_tokens"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_users.id"), index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("app_users.id"), nullable=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SessionToken(TimestampMixin, Base):
    __tablename__ = "session_tokens"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ApiKey(TimestampMixin, Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_users.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    prefix: Mapped[str] = mapped_column(String(24), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("app_users.id"), nullable=True, index=True)
    actor_type: Mapped[str] = mapped_column(String(32), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(128), index=True)
    resource_type: Mapped[str] = mapped_column(String(64), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("app_users.id"), nullable=True, index=True)
    key: Mapped[str] = mapped_column(String(255), index=True)
    method: Mapped[str] = mapped_column(String(12), index=True)
    path: Mapped[str] = mapped_column(String(255), index=True)
    body_hash: Mapped[str] = mapped_column(String(128))
    status_code: Mapped[int] = mapped_column(Integer)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class JobRecord(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "job_records"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    job_type: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Goal(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    category: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(128))
    metric_key: Mapped[str] = mapped_column(String(64), index=True)
    target_value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(32))
    period: Mapped[str] = mapped_column(String(32), default="daily")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExportRecord(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "export_records"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    format: Mapped[str] = mapped_column(String(16), default="json")
    status: Mapped[str] = mapped_column(String(32), default="ready", index=True)
    path: Mapped[str] = mapped_column(String(512))
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FoodItem(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "food_items"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    brand: Mapped[str | None] = mapped_column(String(128), nullable=True)
    serving_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    calories: Mapped[float] = mapped_column(Float, default=0)
    protein_g: Mapped[float] = mapped_column(Float, default=0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0)
    fat_g: Mapped[float] = mapped_column(Float, default=0)
    fiber_g: Mapped[float] = mapped_column(Float, default=0)
    sugar_g: Mapped[float] = mapped_column(Float, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)


class Recipe(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    servings: Mapped[float] = mapped_column(Float, default=1)
    instructions_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)


class RecipeItem(OwnedMixin, Base):
    __tablename__ = "recipe_items"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    food_id: Mapped[str] = mapped_column(ForeignKey("food_items.id"), index=True)
    grams: Mapped[float] = mapped_column(Float)


class MealTemplate(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "meal_templates"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    meal_type: Mapped[str] = mapped_column(String(32), default="meal")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)


class MealTemplateItem(OwnedMixin, Base):
    __tablename__ = "meal_template_items"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    meal_template_id: Mapped[str] = mapped_column(ForeignKey("meal_templates.id"), index=True)
    food_id: Mapped[str | None] = mapped_column(ForeignKey("food_items.id"), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(128))
    grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories: Mapped[float] = mapped_column(Float, default=0)
    protein_g: Mapped[float] = mapped_column(Float, default=0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0)
    fat_g: Mapped[float] = mapped_column(Float, default=0)
    fiber_g: Mapped[float] = mapped_column(Float, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, default=0)
    source_type: Mapped[str] = mapped_column(String(32), default="manual")


class PhotoAnalysisDraft(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "photo_analysis_drafts"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    source_path: Mapped[str] = mapped_column(String(512))
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidates_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    meal_entry_id: Mapped[str | None] = mapped_column(String(26), nullable=True)


class MealEntry(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "meal_entries"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    meal_type: Mapped[str] = mapped_column(String(32), default="meal", index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("meal_templates.id"), nullable=True, index=True)
    recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id"), nullable=True, index=True)
    photo_draft_id: Mapped[str | None] = mapped_column(ForeignKey("photo_analysis_drafts.id"), nullable=True, index=True)
    total_calories: Mapped[float] = mapped_column(Float, default=0)
    total_protein_g: Mapped[float] = mapped_column(Float, default=0)
    total_carbs_g: Mapped[float] = mapped_column(Float, default=0)
    total_fat_g: Mapped[float] = mapped_column(Float, default=0)
    total_fiber_g: Mapped[float] = mapped_column(Float, default=0)
    total_sodium_mg: Mapped[float] = mapped_column(Float, default=0)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)


class MealEntryItem(OwnedMixin, Base):
    __tablename__ = "meal_entry_items"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    meal_entry_id: Mapped[str] = mapped_column(ForeignKey("meal_entries.id"), index=True)
    food_id: Mapped[str | None] = mapped_column(ForeignKey("food_items.id"), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(128))
    grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories: Mapped[float] = mapped_column(Float, default=0)
    protein_g: Mapped[float] = mapped_column(Float, default=0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0)
    fat_g: Mapped[float] = mapped_column(Float, default=0)
    fiber_g: Mapped[float] = mapped_column(Float, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, default=0)
    source_type: Mapped[str] = mapped_column(String(32), default="manual")


class Exercise(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "exercises"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    category: Mapped[str] = mapped_column(String(64), default="strength")
    movement_pattern: Mapped[str | None] = mapped_column(String(64), nullable=True)
    equipment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    primary_muscles_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    progression_mode: Mapped[str] = mapped_column(String(32), default="double_progression")
    rep_target_min: Mapped[int] = mapped_column(Integer, default=6)
    rep_target_max: Mapped[int] = mapped_column(Integer, default=10)
    load_increment: Mapped[float] = mapped_column(Float, default=2.5)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Routine(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "routines"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    goal: Mapped[str | None] = mapped_column(String(128), nullable=True)
    schedule_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class RoutineExercise(OwnedMixin, Base):
    __tablename__ = "routine_exercises"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    routine_id: Mapped[str] = mapped_column(ForeignKey("routines.id"), index=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"), index=True)
    day_label: Mapped[str] = mapped_column(String(32), default="Day 1")
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    target_sets: Mapped[int] = mapped_column(Integer, default=3)
    target_reps_min: Mapped[int] = mapped_column(Integer, default=6)
    target_reps_max: Mapped[int] = mapped_column(Integer, default=10)
    target_rir: Mapped[float | None] = mapped_column(Float, nullable=True)


class WorkoutTemplate(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "workout_templates"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    name: Mapped[str] = mapped_column(String(128), index=True)
    routine_id: Mapped[str | None] = mapped_column(ForeignKey("routines.id"), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkoutTemplateExercise(OwnedMixin, Base):
    __tablename__ = "workout_template_exercises"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    workout_template_id: Mapped[str] = mapped_column(ForeignKey("workout_templates.id"), index=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    target_sets: Mapped[int] = mapped_column(Integer, default=3)
    target_reps_min: Mapped[int] = mapped_column(Integer, default=6)
    target_reps_max: Mapped[int] = mapped_column(Integer, default=10)
    rest_seconds: Mapped[int] = mapped_column(Integer, default=120)
    target_rir: Mapped[float | None] = mapped_column(Float, nullable=True)


class WorkoutSession(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "workout_sessions"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("workout_templates.id"), nullable=True, index=True)
    routine_id: Mapped[str | None] = mapped_column(ForeignKey("routines.id"), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    perceived_energy: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bodyweight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_volume_kg: Mapped[float] = mapped_column(Float, default=0)
    total_sets: Mapped[int] = mapped_column(Integer, default=0)


class SetEntry(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "set_entries"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    workout_session_id: Mapped[str] = mapped_column(ForeignKey("workout_sessions.id"), index=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"), index=True)
    template_exercise_id: Mapped[str | None] = mapped_column(ForeignKey("workout_template_exercises.id"), nullable=True, index=True)
    set_index: Mapped[int] = mapped_column(Integer, default=1)
    reps: Mapped[int] = mapped_column(Integer, default=0)
    load_kg: Mapped[float] = mapped_column(Float, default=0)
    rir: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    rest_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_warmup: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pr: Mapped[bool] = mapped_column(Boolean, default=False)
    progression_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class WeightEntry(OwnedMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "weight_entries"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    waist_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class InsightSnapshot(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "insight_snapshots"

    id: Mapped[str] = mapped_column(String(26), primary_key=True, default=new_ulid)
    snapshot_date: Mapped[date] = mapped_column(Date, default=lambda: utcnow().date(), index=True)
    source: Mapped[str] = mapped_column(String(64), default="manual")
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
