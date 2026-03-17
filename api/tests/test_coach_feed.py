from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base, get_session
from app.core.models import AppUser, Goal, InsightSnapshot, JobRecord, MealEntry, UserPreference, WeightEntry, WorkoutSession
from app.core.security import Actor, get_actor
from app.modules.ai import router as ai_router


class CoachFeedApiTests(unittest.TestCase):
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
            actor_id="actor-athlete",
            display_name="athlete",
            scopes=("assistant:use",),
            user_id="user-athlete",
            username="athlete",
            is_admin=False,
        )

        with self.SessionLocal() as session:
            session.add(AppUser(id=self.actor.user_id, username=self.actor.username, is_active=True, is_admin=False))
            session.add(UserPreference(user_id=self.actor.user_id, weight_unit="kg", timezone="America/Toronto"))
            session.commit()

        self.app = FastAPI()
        self.app.include_router(ai_router)
        self.app.dependency_overrides[get_actor] = lambda: self.actor

        def override_get_session():
            session = self.SessionLocal()
            try:
                yield session
            finally:
                session.close()

        self.app.dependency_overrides[get_session] = override_get_session
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def _seed_training_day(self) -> dict[str, object]:
        payload = {
            "nutrition": {
                "daily_calories": {"2026-03-11": 2510, "2026-03-12": 2640},
                "average_calories_7": 2575,
                "goal_calories": 2600,
                "adherence_ratio": 0.97,
            },
            "body": {
                "latest_weight_kg": 82.4,
                "weight_trend_kg_per_week": -0.12,
                "trend_7": [82.8, 82.7, 82.6, 82.5, 82.5, 82.4, 82.4],
                "trend_30": [83.2, 83.0, 82.9, 82.8, 82.7, 82.5, 82.4],
            },
            "training": {
                "weekly_volume_kg": 5420,
                "volume_delta_kg": 240,
                "session_count_7": 3,
                "last_session_at": "2026-03-12T12:00:00+00:00",
                "pr_count": 2,
            },
            "recovery_flags": [],
            "recommendations": [
                "Push protein earlier in the day so dinner does not carry the whole target.",
                "Keep the next upper session at the current load and own cleaner reps.",
            ],
            "generated_at": "2026-03-12T12:00:00+00:00",
        }

        with self.SessionLocal() as session:
            session.add(
                Goal(
                    user_id=self.actor.user_id,
                    category="nutrition",
                    title="Daily calories",
                    metric_key="calories",
                    target_value=2600,
                    unit="kcal",
                    period="daily",
                )
            )
            session.add(
                MealEntry(
                    user_id=self.actor.user_id,
                    meal_type="lunch",
                    source="manual",
                    notes="Chicken and rice",
                    total_calories=720,
                    total_protein_g=54,
                    total_carbs_g=68,
                    total_fat_g=18,
                )
            )
            session.add(
                WorkoutSession(
                    user_id=self.actor.user_id,
                    notes="Upper day",
                    total_volume_kg=5420,
                    total_sets=18,
                )
            )
            session.add(WeightEntry(user_id=self.actor.user_id, weight_kg=82.4))
            session.add(
                InsightSnapshot(
                    user_id=self.actor.user_id,
                    source="manual",
                    payload_json=payload,
                )
            )
            session.commit()
        return payload

    def test_assistant_feed_and_refresh_return_shared_coach_payload(self) -> None:
        payload = self._seed_training_day()

        check_in_response = self.client.put(
            "/assistant/check-in",
            json={
                "sleep_hours": 7.5,
                "readiness_1_5": 4,
                "soreness_1_5": 2,
                "hunger_1_5": 3,
                "note": "Ready to train.",
            },
        )
        self.assertEqual(check_in_response.status_code, 200)

        response = self.client.get("/assistant/feed")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["feed"]
        self.assertEqual(payload["freshness"]["timezone"], "America/Toronto")
        self.assertTrue(payload["top_focus"]["title"])
        self.assertTrue(payload["actions"])
        self.assertTrue(payload["quick_prompts"])
        self.assertEqual(payload["today_check_in"]["note"], "Ready to train.")
        self.assertEqual(payload["brief"]["title"], "Daily Brief")

        with patch("app.modules.insights.compute_insight_payload", return_value=payload):
            refresh_response = self.client.post("/assistant/feed/refresh")

        self.assertEqual(refresh_response.status_code, 201)
        refreshed = refresh_response.json()["feed"]
        self.assertTrue(refreshed["brief"]["summary"])
        self.assertEqual(refreshed["today_check_in"]["note"], "Ready to train.")

    def test_assistant_check_in_upserts_latest_row_and_enqueues_refresh(self) -> None:
        first_response = self.client.put(
            "/assistant/check-in",
            json={
                "sleep_hours": 6.5,
                "readiness_1_5": 3,
                "soreness_1_5": 4,
                "hunger_1_5": 2,
                "note": "Low sleep.",
            },
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.put(
            "/assistant/check-in",
            json={
                "sleep_hours": 8,
                "readiness_1_5": 4,
                "soreness_1_5": 2,
                "hunger_1_5": 3,
                "note": "Recovered well.",
            },
        )

        self.assertEqual(second_response.status_code, 200)
        payload = second_response.json()["check_in"]
        self.assertEqual(payload["sleep_hours"], 8)
        self.assertEqual(payload["note"], "Recovered well.")
        self.assertTrue(payload["is_today"])

        latest_response = self.client.get("/assistant/check-in")

        self.assertEqual(latest_response.status_code, 200)
        self.assertEqual(latest_response.json()["check_in"]["note"], "Recovered well.")

        with self.SessionLocal() as session:
            jobs = session.scalars(
                select(JobRecord).where(JobRecord.user_id == self.actor.user_id, JobRecord.job_type == "insights.recompute")
            ).all()

        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].payload_json["source"], "coach_check_in")

    def test_assistant_check_in_supports_explicit_dates_without_changing_default_today_behavior(self) -> None:
        today_response = self.client.put(
            "/assistant/check-in",
            json={
                "sleep_hours": 7.5,
                "readiness_1_5": 4,
                "soreness_1_5": 2,
                "hunger_1_5": 3,
                "note": "Today note.",
            },
        )
        self.assertEqual(today_response.status_code, 200)

        dated_response = self.client.put(
            "/assistant/check-in",
            json={
                "check_in_date": "2026-03-10",
                "sleep_hours": 8,
                "readiness_1_5": 5,
                "soreness_1_5": 1,
                "hunger_1_5": 3,
                "note": "Earlier note.",
            },
        )
        self.assertEqual(dated_response.status_code, 200)
        self.assertEqual(dated_response.json()["check_in"]["check_in_date"], "2026-03-10")
        self.assertEqual(dated_response.json()["check_in"]["note"], "Earlier note.")

        explicit_response = self.client.get("/assistant/check-in?date=2026-03-10")
        self.assertEqual(explicit_response.status_code, 200)
        self.assertEqual(explicit_response.json()["check_in"]["check_in_date"], "2026-03-10")
        self.assertEqual(explicit_response.json()["check_in"]["note"], "Earlier note.")

        latest_response = self.client.get("/assistant/check-in")
        self.assertEqual(latest_response.status_code, 200)
        self.assertEqual(latest_response.json()["check_in"]["note"], "Today note.")


if __name__ == "__main__":
    unittest.main()
