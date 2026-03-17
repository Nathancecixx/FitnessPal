from __future__ import annotations

from datetime import date, datetime, timezone
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.models import AppUser, CoachCheckIn, MealEntry, UserPreference, WeightEntry, WorkoutSession
from app.core.security import Actor
from app.modules.calendar import get_calendar_day, get_calendar_month


class CalendarApiTests(unittest.TestCase):
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
            session.add(UserPreference(user_id=self.actor.user_id, weight_unit="kg", timezone="America/Toronto"))
            session.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_calendar_month_groups_entries_by_user_local_date(self) -> None:
        with self.SessionLocal() as session:
            session.add(
                MealEntry(
                    user_id=self.actor.user_id,
                    logged_at=datetime(2026, 3, 2, 1, 30, tzinfo=timezone.utc),
                    meal_type="dinner",
                    source="manual",
                    total_calories=720,
                    total_protein_g=50,
                    total_carbs_g=60,
                    total_fat_g=20,
                )
            )
            session.add(
                WorkoutSession(
                    user_id=self.actor.user_id,
                    started_at=datetime(2026, 3, 2, 2, 15, tzinfo=timezone.utc),
                    notes="Boundary session",
                    total_volume_kg=3200,
                    total_sets=12,
                )
            )
            session.add(
                WeightEntry(
                    user_id=self.actor.user_id,
                    logged_at=datetime(2026, 3, 2, 3, 0, tzinfo=timezone.utc),
                    weight_kg=82.4,
                )
            )
            session.add(
                CoachCheckIn(
                    user_id=self.actor.user_id,
                    check_in_date=date(2026, 3, 1),
                    sleep_hours=7.5,
                    readiness_1_5=4,
                    soreness_1_5=2,
                    hunger_1_5=3,
                    note="Recovered well.",
                )
            )
            session.commit()

            payload = get_calendar_month(date(2026, 3, 15), self.actor, session)

        self.assertEqual(payload["timezone"], "America/Toronto")
        self.assertEqual(len(payload["weeks"]), 6)
        self.assertTrue(all(len(week) == 7 for week in payload["weeks"]))
        cells = [cell for week in payload["weeks"] for cell in week]
        march_first = next(cell for cell in cells if cell["date"] == "2026-03-01")
        self.assertEqual(march_first["meal_count"], 1)
        self.assertEqual(march_first["total_calories"], 720)
        self.assertEqual(march_first["workout_count"], 1)
        self.assertEqual(march_first["latest_weight_kg"], 82.4)
        self.assertTrue(march_first["has_check_in"])

    def test_calendar_day_returns_only_selected_local_day_records(self) -> None:
        with self.SessionLocal() as session:
            session.add(
                MealEntry(
                    user_id=self.actor.user_id,
                    logged_at=datetime(2026, 3, 2, 1, 30, tzinfo=timezone.utc),
                    meal_type="dinner",
                    source="manual",
                    notes="Shows on March 1 locally",
                    total_calories=650,
                    total_protein_g=45,
                    total_carbs_g=58,
                    total_fat_g=18,
                )
            )
            session.add(
                MealEntry(
                    user_id=self.actor.user_id,
                    logged_at=datetime(2026, 3, 2, 14, 0, tzinfo=timezone.utc),
                    meal_type="breakfast",
                    source="manual",
                    notes="March 2 only",
                    total_calories=420,
                    total_protein_g=28,
                    total_carbs_g=40,
                    total_fat_g=12,
                )
            )
            session.add(
                WorkoutSession(
                    user_id=self.actor.user_id,
                    started_at=datetime(2026, 3, 2, 2, 15, tzinfo=timezone.utc),
                    notes="March 1 session",
                    total_volume_kg=2800,
                    total_sets=10,
                )
            )
            session.add(
                WeightEntry(
                    user_id=self.actor.user_id,
                    logged_at=datetime(2026, 3, 2, 3, 0, tzinfo=timezone.utc),
                    weight_kg=82.4,
                    notes="Morning check-in",
                )
            )
            session.add(
                CoachCheckIn(
                    user_id=self.actor.user_id,
                    check_in_date=date(2026, 3, 1),
                    sleep_hours=7,
                    readiness_1_5=4,
                    soreness_1_5=2,
                    hunger_1_5=3,
                    note="Recovered well.",
                )
            )
            session.commit()

            payload = get_calendar_day(date(2026, 3, 1), self.actor, session)

        self.assertEqual(payload["date"], "2026-03-01")
        self.assertEqual(payload["timezone"], "America/Toronto")
        self.assertEqual(len(payload["meals"]), 1)
        self.assertEqual(payload["meals"][0]["notes"], "Shows on March 1 locally")
        self.assertEqual(len(payload["workouts"]), 1)
        self.assertEqual(payload["workouts"][0]["notes"], "March 1 session")
        self.assertEqual(len(payload["weight_entries"]), 1)
        self.assertEqual(payload["weight_entries"][0]["notes"], "Morning check-in")
        self.assertEqual(payload["check_in"]["check_in_date"], "2026-03-01")
        self.assertEqual(payload["check_in"]["note"], "Recovered well.")
        self.assertEqual(payload["summary"]["meal_count"], 1)
        self.assertEqual(payload["summary"]["workout_count"], 1)


if __name__ == "__main__":
    unittest.main()
