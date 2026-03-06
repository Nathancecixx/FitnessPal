from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.models import AppUser, Exercise, FoodItem, Goal, MealEntry, MealEntryItem, SetEntry, WeightEntry, WorkoutSession
from app.core.security import Actor, require_scope
from app.core.serialization import restore_payload
from app.modules.metrics import WeightEntryCreate, WeightEntryUpdate, create_weight_entry, update_weight_entry
from app.modules.nutrition import MealCreate, MealItemInput, MealUpdate, create_meal, update_meal
from app.modules.training import SetEntryInput, WorkoutSessionCreate, WorkoutSessionUpdate, create_workout_session, update_workout_session


class UpdateAndScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}", future=True)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)
        self.actor = Actor(
            actor_type="session",
            actor_id="actor-test",
            display_name="owner",
            scopes=("*",),
            user_id="user-test",
        )

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_require_scope_accepts_namespace_wildcard(self) -> None:
        dependency = require_scope("nutrition:write")
        scoped_actor = Actor(
            actor_type="api_key",
            actor_id="key-test",
            display_name="assistant",
            scopes=("nutrition:*",),
            user_id="user-test",
        )

        resolved = dependency(scoped_actor)

        self.assertIs(resolved, scoped_actor)

    def test_require_scope_rejects_other_namespace(self) -> None:
        dependency = require_scope("nutrition:write")
        scoped_actor = Actor(
            actor_type="api_key",
            actor_id="key-test",
            display_name="assistant",
            scopes=("training:*",),
            user_id="user-test",
        )

        with self.assertRaises(HTTPException) as error:
            dependency(scoped_actor)

        self.assertEqual(error.exception.status_code, 403)
        self.assertIn("nutrition:write", error.exception.detail)

    def test_update_meal_replaces_items_and_recalculates_totals(self) -> None:
        with self.SessionLocal() as session:
            chicken = FoodItem(name="Chicken breast", calories=165, protein_g=31, carbs_g=0, fat_g=3.6)
            session.add(chicken)
            session.commit()
            session.refresh(chicken)

            created = create_meal(
                MealCreate(
                    meal_type="lunch",
                    items=[MealItemInput(food_id=chicken.id, label="Chicken breast", grams=100)],
                ),
                self.actor,
                session,
            )

            updated = update_meal(
                created["id"],
                MealUpdate(
                    meal_type="lunch",
                    notes="edited",
                    items=[
                        MealItemInput(
                            label="Rice bowl",
                            calories=540,
                            protein_g=38,
                            carbs_g=62,
                            fat_g=15,
                            fiber_g=6,
                            sodium_mg=720,
                        )
                    ],
                ),
                self.actor,
                session,
            )

            item_count = session.scalar(select(func.count(MealEntryItem.id)).where(MealEntryItem.meal_entry_id == created["id"])) or 0
            meal = session.get(MealEntry, created["id"])

        self.assertEqual(item_count, 1)
        self.assertIsNotNone(meal)
        self.assertEqual(updated["notes"], "edited")
        self.assertEqual(updated["totals"]["calories"], 540)
        self.assertEqual(updated["totals"]["protein_g"], 38)
        self.assertEqual(meal.total_carbs_g, 62)

    def test_update_workout_session_replaces_sets_and_recalculates_volume(self) -> None:
        with self.SessionLocal() as session:
            bench = Exercise(name="Bench press", rep_target_min=5, rep_target_max=8, load_increment=2.5)
            session.add(bench)
            session.commit()
            session.refresh(bench)

            created = create_workout_session(
                WorkoutSessionCreate(
                    notes="initial",
                    sets=[
                        SetEntryInput(exercise_id=bench.id, set_index=1, reps=5, load_kg=100),
                        SetEntryInput(exercise_id=bench.id, set_index=2, reps=5, load_kg=100),
                    ],
                ),
                self.actor,
                session,
            )

            updated = update_workout_session(
                created["id"],
                WorkoutSessionUpdate(
                    notes="edited",
                    sets=[SetEntryInput(exercise_id=bench.id, set_index=1, reps=8, load_kg=90)],
                ),
                self.actor,
                session,
            )

            set_count = session.scalar(select(func.count(SetEntry.id)).where(SetEntry.workout_session_id == created["id"])) or 0
            workout = session.get(WorkoutSession, created["id"])

        self.assertEqual(set_count, 1)
        self.assertIsNotNone(workout)
        self.assertEqual(updated["notes"], "edited")
        self.assertEqual(updated["total_sets"], 1)
        self.assertEqual(updated["total_volume_kg"], 720.0)
        self.assertEqual(workout.total_volume_kg, 720.0)

    def test_update_weight_entry_overwrites_existing_values(self) -> None:
        with self.SessionLocal() as session:
            created = create_weight_entry(
                WeightEntryCreate(weight_kg=82.4, body_fat_pct=16.2, waist_cm=84.0, notes="before"),
                self.actor,
                session,
            )

            updated = update_weight_entry(
                created["id"],
                WeightEntryUpdate(weight_kg=81.7, body_fat_pct=15.8, waist_cm=83.2, notes="after"),
                self.actor,
                session,
            )

            entry = session.get(WeightEntry, created["id"])

        self.assertIsNotNone(entry)
        self.assertEqual(updated["weight_kg"], 81.7)
        self.assertEqual(updated["body_fat_pct"], 15.8)
        self.assertEqual(updated["notes"], "after")
        self.assertEqual(entry.waist_cm, 83.2)

    def test_restore_payload_rolls_back_all_rows_when_any_row_is_invalid(self) -> None:
        payload = {
            "tables": {
                "app_users": [
                    {
                        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                        "username": "owner",
                        "password_hash": "hashed-password",
                        "is_active": True,
                    }
                ],
                "goals": [
                    {
                        "id": "01ARZ3NDEKTSV4RRFFQ69G5FB0",
                        "title": "Broken goal",
                        "metric_key": "calories",
                        "target_value": 2200,
                        "unit": "kcal",
                        "period": "daily",
                        "is_active": True,
                    }
                ],
            }
        }

        with self.SessionLocal() as session:
            with self.assertRaises(Exception):
                restore_payload(session, payload)

            user_count = session.scalar(select(func.count(AppUser.id))) or 0
            goal_count = session.scalar(select(func.count(Goal.id))) or 0

        self.assertEqual(user_count, 0)
        self.assertEqual(goal_count, 0)


if __name__ == "__main__":
    unittest.main()
