from __future__ import annotations

from datetime import timedelta
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.models import AppUser, Exercise, MealEntry, utcnow
from app.core.security import Actor
from app.modules.insights import build_insight_summary
from app.modules.nutrition import FoodCreate, MealCreate, MealItemInput, create_food, create_meal, list_foods, list_meals
from app.modules.training import (
    RoutineCreate,
    RoutineExerciseInput,
    RoutineUpdate,
    create_exercise,
    create_routine,
    delete_routine,
    list_routines,
    update_routine,
    ExerciseCreate,
)


class PaginationAndRoutineTests(unittest.TestCase):
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

    def test_food_list_uses_cursor_pagination(self) -> None:
        with self.SessionLocal() as session:
            create_food(FoodCreate(name="Apples", calories=52), self.actor, session)
            create_food(FoodCreate(name="Bananas", calories=89), self.actor, session)
            create_food(FoodCreate(name="Chicken", calories=165), self.actor, session)

            first_page = list_foods(self.actor, session, limit=2)
            second_page = list_foods(self.actor, session, limit=2, cursor=first_page["next_cursor"])

        self.assertEqual([item["name"] for item in first_page["items"]], ["Apples", "Bananas"])
        self.assertTrue(first_page["has_more"])
        self.assertEqual([item["name"] for item in second_page["items"]], ["Chicken"])
        self.assertFalse(second_page["has_more"])

    def test_meal_list_supports_cursor_pagination(self) -> None:
        with self.SessionLocal() as session:
            create_meal(
                MealCreate(
                    meal_type="breakfast",
                    logged_at=utcnow() - timedelta(hours=2),
                    items=[MealItemInput(label="Eggs", calories=300, protein_g=20, carbs_g=2, fat_g=22)],
                ),
                self.actor,
                session,
            )
            create_meal(
                MealCreate(
                    meal_type="lunch",
                    logged_at=utcnow() - timedelta(hours=1),
                    items=[MealItemInput(label="Rice bowl", calories=620, protein_g=42, carbs_g=64, fat_g=18)],
                ),
                self.actor,
                session,
            )

            first_page = list_meals(self.actor, session, limit=1)
            second_page = list_meals(self.actor, session, limit=1, cursor=first_page["next_cursor"])

        self.assertEqual(len(first_page["items"]), 1)
        self.assertTrue(first_page["has_more"])
        self.assertEqual(first_page["items"][0]["meal_type"], "lunch")
        self.assertEqual(second_page["items"][0]["meal_type"], "breakfast")

    def test_routines_can_be_updated_and_deleted(self) -> None:
        with self.SessionLocal() as session:
            bench = create_exercise(ExerciseCreate(name="Bench press"), self.actor, session)
            row = create_exercise(ExerciseCreate(name="Barbell row"), self.actor, session)

            created = create_routine(
                RoutineCreate(
                    name="Upper / Lower",
                    items=[RoutineExerciseInput(exercise_id=bench["id"], day_label="Day 1", order_index=0)],
                ),
                self.actor,
                session,
            )
            updated = update_routine(
                created["id"],
                RoutineUpdate(
                    name="Upper / Lower v2",
                    goal="Hypertrophy",
                    schedule_notes="Mon Tue Thu Fri",
                    items=[RoutineExerciseInput(exercise_id=row["id"], day_label="Day 2", order_index=0, target_sets=4)],
                ),
                self.actor,
                session,
            )
            listing = list_routines(self.actor, session)
            deleted = delete_routine(created["id"], self.actor, session)

        self.assertEqual(updated["name"], "Upper / Lower v2")
        self.assertEqual(updated["items"][0]["exercise_id"], row["id"])
        self.assertEqual(updated["items"][0]["day_label"], "Day 2")
        self.assertEqual(listing["items"][0]["name"], "Upper / Lower v2")
        self.assertEqual(deleted["status"], "deleted")

    def test_insight_summary_uses_recent_window(self) -> None:
        with self.SessionLocal() as session:
            recent_meal = MealEntry(
                user_id=self.actor.user_id,
                meal_type="meal",
                source="manual",
                logged_at=utcnow() - timedelta(days=3),
                total_calories=700,
                total_protein_g=45,
                total_carbs_g=60,
                total_fat_g=20,
            )
            stale_meal = MealEntry(
                user_id=self.actor.user_id,
                meal_type="meal",
                source="manual",
                logged_at=utcnow() - timedelta(days=200),
                total_calories=1200,
                total_protein_g=50,
                total_carbs_g=100,
                total_fat_g=30,
            )
            session.add_all([recent_meal, stale_meal])
            session.commit()

            summary = build_insight_summary(session, self.actor.user_id, window_days=30)

        self.assertEqual(summary["window_days"], 30)
        self.assertEqual(list(summary["nutrition"]["daily_calories"].values()), [700])


if __name__ == "__main__":
    unittest.main()
