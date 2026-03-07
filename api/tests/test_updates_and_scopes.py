from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.models import (
    AppUser,
    Exercise,
    FoodItem,
    Goal,
    MealEntry,
    MealEntryItem,
    MealTemplate,
    MealTemplateItem,
    PhotoAnalysisDraft,
    SetEntry,
    WeightEntry,
    WorkoutSession,
    WorkoutTemplate,
    WorkoutTemplateExercise,
)
from app.core.security import Actor, require_scope
from app.core.serialization import export_payload, restore_payload
from app.modules.metrics import WeightEntryCreate, WeightEntryUpdate, create_weight_entry, update_weight_entry
from app.modules.nutrition import (
    MealCreate,
    MealItemInput,
    MealTemplateCreate,
    MealTemplateUpdate,
    MealUpdate,
    create_meal,
    create_meal_template,
    delete_meal_template,
    update_meal,
    update_meal_template,
)
from app.modules.training import (
    SetEntryInput,
    WorkoutSessionCreate,
    WorkoutSessionUpdate,
    WorkoutTemplateCreate,
    WorkoutTemplateExerciseInput,
    WorkoutTemplateUpdate,
    create_workout_session,
    create_workout_template,
    delete_workout_template,
    update_workout_session,
    update_workout_template,
)


class UpdateAndScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)
        self.actor = Actor(
            actor_type="session",
            actor_id="actor-test",
            display_name="owner",
            scopes=("*",),
            user_id="user-test",
            username="owner",
            is_admin=False,
        )
        with self.SessionLocal() as session:
            session.add(AppUser(id=self.actor.user_id, username=self.actor.username, password_hash="hashed", is_active=True))
            session.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_require_scope_accepts_namespace_wildcard(self) -> None:
        dependency = require_scope("nutrition:write")
        scoped_actor = Actor(
            actor_type="api_key",
            actor_id="key-test",
            display_name="assistant",
            scopes=("nutrition:*",),
            user_id="user-test",
            username="assistant",
            is_admin=False,
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
            username="assistant",
            is_admin=False,
        )

        with self.assertRaises(HTTPException) as error:
            dependency(scoped_actor)

        self.assertEqual(error.exception.status_code, 403)
        self.assertIn("nutrition:write", error.exception.detail)

    def test_update_meal_replaces_items_and_recalculates_totals(self) -> None:
        with self.SessionLocal() as session:
            chicken = FoodItem(user_id=self.actor.user_id, name="Chicken breast", calories=165, protein_g=31, carbs_g=0, fat_g=3.6)
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
            bench = Exercise(user_id=self.actor.user_id, name="Bench press", rep_target_min=5, rep_target_max=8, load_increment=2.5)
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

    def test_update_meal_template_replaces_items_and_recalculates_totals(self) -> None:
        with self.SessionLocal() as session:
            chicken = FoodItem(user_id=self.actor.user_id, name="Chicken breast", calories=165, protein_g=31, carbs_g=0, fat_g=3.6)
            session.add(chicken)
            session.commit()
            session.refresh(chicken)

            created = create_meal_template(
                MealTemplateCreate(
                    name="Lunch base",
                    meal_type="lunch",
                    items=[MealItemInput(food_id=chicken.id, label="Chicken breast", grams=100)],
                ),
                self.actor,
                session,
            )

            updated = update_meal_template(
                created["id"],
                MealTemplateUpdate(
                    name="Lunch base v2",
                    meal_type="dinner",
                    notes="updated",
                    items=[
                        MealItemInput(
                            label="Rice bowl",
                            grams=450,
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

            item_count = session.scalar(select(func.count(MealTemplateItem.id)).where(MealTemplateItem.meal_template_id == created["id"])) or 0
            template = session.get(MealTemplate, created["id"])

        self.assertEqual(item_count, 1)
        self.assertIsNotNone(template)
        self.assertEqual(updated["name"], "Lunch base v2")
        self.assertEqual(updated["meal_type"], "dinner")
        self.assertEqual(updated["notes"], "updated")
        self.assertEqual(updated["totals"]["calories"], 540)
        self.assertEqual(updated["totals"]["protein_g"], 38)

    def test_delete_meal_template_soft_deletes_template(self) -> None:
        with self.SessionLocal() as session:
            created = create_meal_template(
                MealTemplateCreate(
                    name="Delete me",
                    meal_type="meal",
                    items=[MealItemInput(label="Oats", grams=80, calories=300, protein_g=10, carbs_g=54, fat_g=5)],
                ),
                self.actor,
                session,
            )

            deleted = delete_meal_template(created["id"], self.actor, session)
            template = session.get(MealTemplate, created["id"])

        self.assertEqual(deleted["status"], "deleted")
        self.assertIsNotNone(template)
        self.assertIsNotNone(template.deleted_at)

    def test_update_workout_template_replaces_exercises(self) -> None:
        with self.SessionLocal() as session:
            bench = Exercise(user_id=self.actor.user_id, name="Bench press", rep_target_min=5, rep_target_max=8, load_increment=2.5)
            row = Exercise(user_id=self.actor.user_id, name="Barbell row", rep_target_min=6, rep_target_max=10, load_increment=2.5)
            session.add_all([bench, row])
            session.commit()
            session.refresh(bench)
            session.refresh(row)

            created = create_workout_template(
                WorkoutTemplateCreate(
                    name="Upper A",
                    items=[WorkoutTemplateExerciseInput(exercise_id=bench.id, order_index=0, target_sets=3, target_reps_min=5, target_reps_max=8)],
                ),
                self.actor,
                session,
            )

            updated = update_workout_template(
                created["id"],
                WorkoutTemplateUpdate(
                    name="Upper B",
                    notes="updated",
                    items=[WorkoutTemplateExerciseInput(exercise_id=row.id, order_index=0, target_sets=4, target_reps_min=8, target_reps_max=12, rest_seconds=90)],
                ),
                self.actor,
                session,
            )

            item_count = session.scalar(
                select(func.count(WorkoutTemplateExercise.id)).where(WorkoutTemplateExercise.workout_template_id == created["id"])
            ) or 0
            template = session.get(WorkoutTemplate, created["id"])

        self.assertEqual(item_count, 1)
        self.assertIsNotNone(template)
        self.assertEqual(updated["name"], "Upper B")
        self.assertEqual(updated["notes"], "updated")
        self.assertEqual(updated["items"][0]["exercise_id"], row.id)
        self.assertEqual(updated["items"][0]["target_sets"], 4)
        self.assertEqual(updated["items"][0]["rest_seconds"], 90)

    def test_delete_workout_template_soft_deletes_template(self) -> None:
        with self.SessionLocal() as session:
            bench = Exercise(user_id=self.actor.user_id, name="Bench press", rep_target_min=5, rep_target_max=8, load_increment=2.5)
            session.add(bench)
            session.commit()
            session.refresh(bench)

            created = create_workout_template(
                WorkoutTemplateCreate(
                    name="Delete workout",
                    items=[WorkoutTemplateExerciseInput(exercise_id=bench.id, order_index=0)],
                ),
                self.actor,
                session,
            )

            deleted = delete_workout_template(created["id"], self.actor, session)
            template = session.get(WorkoutTemplate, created["id"])

        self.assertEqual(deleted["status"], "deleted")
        self.assertIsNotNone(template)
        self.assertIsNotNone(template.deleted_at)

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

    def test_export_and_restore_drop_photo_draft_links(self) -> None:
        with self.SessionLocal() as session:
            draft = PhotoAnalysisDraft(
                user_id=self.actor.user_id,
                status="ready",
                source_path="storage/uploads/user-test/meal-photos/example.jpg",
                candidates_json=[],
            )
            session.add(draft)
            session.flush()
            meal = MealEntry(
                user_id=self.actor.user_id,
                meal_type="meal",
                source="photo",
                total_calories=540,
                total_protein_g=40,
                total_carbs_g=50,
                total_fat_g=18,
                photo_draft_id=draft.id,
            )
            session.add(meal)
            session.commit()
            session.refresh(meal)

            exported = export_payload(session, self.actor.user_id)
            exported_meal = exported["tables"]["meal_entries"][0]
            self.assertNotIn("photo_analysis_drafts", exported["tables"])
            self.assertIsNone(exported_meal["photo_draft_id"])

            restore_payload(
                session,
                {
                    "tables": {
                        "meal_entries": [{**exported_meal, "photo_draft_id": draft.id}],
                    }
                },
                self.actor.user_id,
            )
            restored = session.get(MealEntry, meal.id)

        self.assertIsNotNone(restored)
        self.assertIsNone(restored.photo_draft_id)

    def test_restore_payload_rejects_malformed_tables(self) -> None:
        with self.SessionLocal() as session:
            with self.assertRaises(ValueError) as error:
                restore_payload(session, {"tables": {"food_items": {}}}, self.actor.user_id)

        self.assertIn("must be a list", str(error.exception))

    def test_restore_payload_rolls_back_all_rows_when_any_row_is_invalid(self) -> None:
        payload = {
            "tables": {
                "food_items": [
                    {
                        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
                        "name": "Chicken breast",
                        "calories": 165,
                        "protein_g": 31,
                        "carbs_g": 0,
                        "fat_g": 3.6,
                        "fiber_g": 0,
                        "sugar_g": 0,
                        "sodium_mg": 0,
                        "is_favorite": False,
                        "tags_json": [],
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
                restore_payload(session, payload, self.actor.user_id)

            food_count = session.scalar(select(func.count(FoodItem.id))) or 0
            goal_count = session.scalar(select(func.count(Goal.id))) or 0

        self.assertEqual(food_count, 0)
        self.assertEqual(goal_count, 0)


if __name__ == "__main__":
    unittest.main()
