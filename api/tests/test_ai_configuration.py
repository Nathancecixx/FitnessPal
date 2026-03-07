from __future__ import annotations

import os
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core import local_ai
from app.core.config import get_settings
from app.core.config_crypto import decrypt_secret_payload
from app.core.database import Base, get_session
from app.core.models import AiProfile, AppUser, Goal, InsightSnapshot, MealEntry, WeightEntry, WorkoutSession
from app.core.security import Actor, get_actor, hash_password
from app.modules.ai import router as ai_router
from app.modules.platform import router as platform_router


class AiConfigurationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_config_secret = os.environ.get("FITNESSPAL_CONFIG_SECRET")
        os.environ["FITNESSPAL_CONFIG_SECRET"] = "test-config-secret"
        get_settings.cache_clear()

        self.original_legacy_values = (
            local_ai.settings.local_ai_base_url,
            local_ai.settings.local_ai_model,
            local_ai.settings.local_ai_timeout_seconds,
        )
        object.__setattr__(local_ai.settings, "local_ai_base_url", None)
        object.__setattr__(local_ai.settings, "local_ai_model", "qwen3-vl:8b")
        object.__setattr__(local_ai.settings, "local_ai_timeout_seconds", 60)

        self.engine = create_engine(
            "sqlite://",
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)

        self.admin_actor = Actor(
            actor_type="session",
            actor_id="actor-admin",
            display_name="owner",
            scopes=("*",),
            user_id="user-admin",
            username="owner",
            is_admin=True,
        )
        self.user_actor = Actor(
            actor_type="session",
            actor_id="actor-user",
            display_name="athlete",
            scopes=("platform:read", "assistant:use"),
            user_id="user-athlete",
            username="athlete",
            is_admin=False,
        )
        self.current_actor = self.admin_actor

        with self.SessionLocal() as session:
            session.add_all(
                [
                    AppUser(
                        id=self.admin_actor.user_id,
                        username=self.admin_actor.username,
                        password_hash=hash_password("fitnesspal"),
                        is_active=True,
                        is_admin=True,
                    ),
                    AppUser(
                        id=self.user_actor.user_id,
                        username=self.user_actor.username,
                        password_hash=hash_password("fitnesspal"),
                        is_active=True,
                        is_admin=False,
                    ),
                ]
            )
            session.commit()

        self.app = FastAPI()
        self.app.include_router(ai_router)
        self.app.include_router(platform_router)
        self.app.dependency_overrides[get_actor] = lambda: self.current_actor

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
        object.__setattr__(local_ai.settings, "local_ai_base_url", self.original_legacy_values[0])
        object.__setattr__(local_ai.settings, "local_ai_model", self.original_legacy_values[1])
        object.__setattr__(local_ai.settings, "local_ai_timeout_seconds", self.original_legacy_values[2])
        if self.original_config_secret is None:
            os.environ.pop("FITNESSPAL_CONFIG_SECRET", None)
        else:
            os.environ["FITNESSPAL_CONFIG_SECRET"] = self.original_config_secret
        get_settings.cache_clear()

    def _create_profile(
        self,
        session,
        *,
        name: str,
        provider: str,
        base_url: str,
        api_key: str | None = None,
        default_model: str | None = None,
    ) -> dict[str, object]:
        return local_ai.create_profile(
            session,
            name=name,
            provider=provider,
            base_url=base_url,
            description=None,
            api_key=api_key,
            default_model=default_model,
            timeout_seconds=60,
            is_enabled=True,
            default_headers_json={},
            advanced_settings_json={},
        )

    def _seed_snapshot(self, session) -> InsightSnapshot:
        session.add(
            Goal(
                user_id=self.user_actor.user_id,
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
                user_id=self.user_actor.user_id,
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
                user_id=self.user_actor.user_id,
                notes="Upper day",
                total_volume_kg=5420,
                total_sets=18,
            )
        )
        session.add(WeightEntry(user_id=self.user_actor.user_id, weight_kg=82.4))
        snapshot = InsightSnapshot(
            user_id=self.user_actor.user_id,
            source="manual",
            payload_json={
                "nutrition": {
                    "daily_calories": {"2026-03-05": 2510, "2026-03-06": 2640},
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
                    "last_session_at": "2026-03-05T12:00:00+00:00",
                    "pr_count": 2,
                },
                "recovery_flags": [],
                "recommendations": [
                    "Push protein earlier in the day so dinner does not carry the whole target.",
                    "Keep the next upper session at the current load and own cleaner reps.",
                ],
                "generated_at": "2026-03-06T12:00:00+00:00",
            },
        )
        session.add(snapshot)
        session.commit()
        session.refresh(snapshot)
        return snapshot

    def test_ai_admin_routes_require_admin(self) -> None:
        self.current_actor = self.user_actor

        response = self.client.get("/ai/profiles")

        self.assertEqual(response.status_code, 403)
        self.assertIn("Admin access required", response.text)

    def test_profile_crud_masks_secrets_and_normalizes_openapi_alias(self) -> None:
        response = self.client.post(
            "/ai/profiles",
            json={
                "name": "Primary cloud",
                "provider": "openapi",
                "base_url": "https://api.openai.com/v1",
                "description": "Main assistant backend",
                "api_key": "sk-live-secret",
                "default_model": "gpt-4.1-mini",
                "timeout_seconds": 45,
                "is_enabled": True,
                "default_headers_json": {"X-Test": "1"},
                "advanced_settings_json": {"reasoning_effort": "medium"},
            },
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["provider"], "openai")
        self.assertTrue(payload["has_api_key"])
        self.assertNotIn("api_key", payload)
        self.assertNotIn("sk-live-secret", response.text)

        profile_id = payload["id"]
        with self.SessionLocal() as session:
            row = session.get(AiProfile, profile_id)
            self.assertIsNotNone(row)
            assert row is not None
            self.assertNotEqual(row.api_key_encrypted, "sk-live-secret")
            self.assertEqual(decrypt_secret_payload(row.api_key_encrypted)["api_key"], "sk-live-secret")

        with patch("app.core.local_ai.list_models_for_profile", return_value=["gpt-4.1-mini", "gpt-4o-mini"]):
            test_response = self.client.post(f"/ai/profiles/{profile_id}/test")
            refresh_response = self.client.post(f"/ai/profiles/{profile_id}/models/refresh")

        self.assertEqual(test_response.status_code, 200)
        self.assertTrue(test_response.json()["reachable"])
        self.assertTrue(test_response.json()["selected_model_available"])
        self.assertEqual(refresh_response.status_code, 200)
        self.assertEqual(refresh_response.json()["models_json"], ["gpt-4.1-mini", "gpt-4o-mini"])

        clear_response = self.client.patch(f"/ai/profiles/{profile_id}", json={"clear_api_key": True})
        self.assertEqual(clear_response.status_code, 200)
        self.assertFalse(clear_response.json()["has_api_key"])

    def test_runtime_and_feature_routing_follow_assigned_backends(self) -> None:
        with self.SessionLocal() as session:
            meal_profile = self._create_profile(
                session,
                name="Vision host",
                provider="openai",
                base_url="http://vision.local/v1",
                default_model="gpt-4o-mini",
            )
            parse_profile = self._create_profile(
                session,
                name="Anthropic parse",
                provider="anthropic",
                base_url="https://api.anthropic.com/v1",
                api_key="anthropic-secret",
                default_model="claude-3-5-haiku-latest",
            )
            local_ai.upsert_feature_bindings(
                session,
                [
                    {"feature_key": "meal_photo_estimation", "profile_id": meal_profile["id"], "model": "gpt-4o-mini"},
                    {"feature_key": "assistant_quick_capture", "profile_id": parse_profile["id"], "model": "claude-3-5-haiku-latest"},
                ],
            )

        captured: dict[str, tuple[str, str | None]] = {}

        def fake_request(resolved, **_: object) -> dict[str, object]:
            assert resolved.profile is not None
            captured[resolved.feature_key] = (resolved.profile.provider, resolved.model)
            if resolved.feature_key == "assistant_quick_capture":
                return {
                    "drafts": [{"kind": "meal_entry", "summary": "Log lunch", "payload": {"meal_type": "lunch", "items": []}}],
                    "warnings": [],
                }
            return {
                "items": [{"label": "Chicken rice bowl", "calories": 640, "protein_g": 48, "carbs_g": 62, "fat_g": 16}],
                "confidence": 0.78,
                "notes": "Looks like a chicken and rice meal.",
            }

        with patch("app.core.local_ai._request_feature_json", side_effect=fake_request):
            parse_response = self.client.post("/assistant/parse", json={"note": "Lunch was 640 kcal with 48P 62C 16F"})
            with self.SessionLocal() as session:
                meal_result = local_ai.analyze_meal_photo(session, Path("chicken-rice.jpg"))

        runtime = self.client.get("/runtime")

        self.assertEqual(parse_response.status_code, 200)
        self.assertEqual(parse_response.json()["provider"], "anthropic")
        self.assertEqual(parse_response.json()["model_name"], "claude-3-5-haiku-latest")
        self.assertEqual(meal_result["provider"], "openai")
        self.assertEqual(meal_result["model_name"], "gpt-4o-mini")
        self.assertEqual(captured["assistant_quick_capture"], ("anthropic", "claude-3-5-haiku-latest"))
        self.assertEqual(captured["meal_photo_estimation"], ("openai", "gpt-4o-mini"))
        self.assertEqual(runtime.status_code, 200)
        self.assertEqual(runtime.json()["ai"]["configured_feature_count"], 2)

    def test_fallback_parser_and_label_scan_setup_errors_behave_as_expected(self) -> None:
        with self.SessionLocal() as session:
            profile = self._create_profile(
                session,
                name="Fallback test",
                provider="openai",
                base_url="http://fallback.local/v1",
                default_model="gpt-4o-mini",
            )
            local_ai.upsert_feature_bindings(
                session,
                [{"feature_key": "assistant_quick_capture", "profile_id": profile["id"], "model": "gpt-4o-mini"}],
            )

        with self.SessionLocal() as session:
            with patch("app.core.local_ai._request_feature_json", side_effect=RuntimeError("backend unavailable")):
                parsed = local_ai.parse_natural_language_entry(session, "Weighed 82.4 kg this morning after waking up")

            self.assertEqual(parsed["provider"], "heuristic-fallback")
            self.assertEqual(parsed["drafts"][0]["kind"], "weight_entry")

        with self.SessionLocal() as session:
            with self.assertRaises(local_ai.AiConfigurationError) as error:
                local_ai.analyze_nutrition_label(session, Path("nutrition-label.jpg"))

        self.assertIn("nutrition_label_scan", str(error.exception))

    def test_coach_brief_refresh_supports_deterministic_and_ai_modes(self) -> None:
        with self.SessionLocal() as session:
            snapshot = self._seed_snapshot(session)
            row = local_ai.refresh_coach_brief(session, self.user_actor.user_id, snapshot)
            serialized = local_ai.serialize_coach_brief(row, local_ai.get_persona_config(session))

        self.assertEqual(row.source, "deterministic")
        self.assertEqual(serialized["title"], "Daily Brief")
        self.assertTrue(serialized["actions"])
        self.assertEqual(serialized["persona_name"], "FitnessPal Coach")

        self.current_actor = self.user_actor
        brief_response = self.client.get("/assistant/brief")
        self.assertEqual(brief_response.status_code, 200)
        self.assertEqual(brief_response.json()["brief"]["persona_name"], "FitnessPal Coach")

        with self.SessionLocal() as session:
            profile = self._create_profile(
                session,
                name="Coach cloud",
                provider="openai",
                base_url="https://api.openai.com/v1",
                api_key="sk-brief-secret",
                default_model="gpt-4.1-mini",
            )
            local_ai.upsert_feature_bindings(
                session,
                [{"feature_key": "coach_brief", "profile_id": profile["id"], "model": "gpt-4.1-mini"}],
            )
            snapshot = self._seed_snapshot(session)

            with patch(
                "app.core.local_ai._request_feature_json",
                return_value={
                    "title": "Daily Brief",
                    "summary": "You are on pace. Keep protein tight and make the next upper day clean.",
                    "body_markdown": "**Coach call:** stay steady and keep execution boring.",
                    "actions": ["Hit 180 g protein before dinner.", "Repeat the last upper session with cleaner reps."],
                    "stats": {"average_calories_7": 2575, "weekly_volume_kg": 5420, "weight_trend_kg_per_week": -0.12, "pr_count": 2},
                },
            ):
                ai_row = local_ai.refresh_coach_brief(session, self.user_actor.user_id, snapshot)

        self.assertEqual(ai_row.source, "ai")
        self.assertEqual(ai_row.provider, "openai")
        self.assertEqual(ai_row.model_name, "gpt-4.1-mini")

    def test_assistant_advice_uses_default_coach_prompt(self) -> None:
        with self.SessionLocal() as session:
            profile = self._create_profile(
                session,
                name="Coach cloud",
                provider="openai",
                base_url="https://api.openai.com/v1",
                api_key="sk-advice-secret",
                default_model="gpt-4.1-mini",
            )
            local_ai.upsert_feature_bindings(
                session,
                [{"feature_key": "coach_brief", "profile_id": profile["id"], "model": "gpt-4.1-mini"}],
            )
            self._seed_snapshot(session)

        self.current_actor = self.user_actor
        captured: dict[str, str] = {}

        def fake_request(resolved, **kwargs: object) -> dict[str, object]:
            assert resolved.profile is not None
            captured["system_prompt"] = str(kwargs["system_prompt"])
            captured["user_prompt"] = str(kwargs["user_prompt"])
            return {
                "title": "Upper-day check-in",
                "summary": "Your next upper session should be about owning rep quality, not forcing more load.",
                "body_markdown": "Keep calories steady, hit protein early, and aim for cleaner execution on the first compound lift.",
                "actions": [
                    "Eat a protein-forward meal 2 to 3 hours before training.",
                    "Repeat the last top set and beat it with cleaner reps.",
                ],
                "watchouts": ["Do not treat one flat session as a sign you need a full program change."],
                "focus_area": "Upper-day execution",
                "follow_up_prompt": "How did your last upper session feel by the final working set?",
                "stats": {"weekly_volume_kg": 5420},
            }

        with patch("app.core.local_ai._request_feature_json", side_effect=fake_request):
            response = self.client.post("/assistant/advice", json={"prompt": "What should I focus on before my next upper day?"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()["advice"]
        self.assertEqual(payload["source"], "ai")
        self.assertEqual(payload["provider"], "openai")
        self.assertEqual(payload["model_name"], "gpt-4.1-mini")
        self.assertEqual(payload["focus_area"], "Upper-day execution")
        self.assertEqual(payload["question"], "What should I focus on before my next upper day?")
        self.assertIn("dedicated strength, nutrition, body-composition, and recovery coach", captured["system_prompt"])
        self.assertIn("What should I focus on before my next upper day?", captured["user_prompt"])

    def test_manifest_route_is_removed_from_main_app(self) -> None:
        from app.main import app, root

        paths = {route.path for route in app.routes}

        self.assertNotIn("/.well-known/fitnesspal-agent.json", paths)
        self.assertNotIn("agent_manifest", root())


if __name__ == "__main__":
    unittest.main()
