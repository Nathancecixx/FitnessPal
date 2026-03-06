from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from fastapi import APIRouter, FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.database import get_session
from app.core.models import Recipe, SetEntry, WorkoutSession
from app.core.security import Actor, get_actor
from app.modules.nutrition import RecipeCreate, RecipeItemInput, create_recipe
from app.modules.nutrition import router as nutrition_router
from app.modules.training import SetEntryInput, WorkoutSessionCreate, create_workout_session
from app.modules.training import router as training_router


class TransactionBoundaryTests(unittest.TestCase):
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

    def build_test_app(self) -> FastAPI:
        app = FastAPI()
        api_router = APIRouter(prefix="/api/v1")
        api_router.include_router(nutrition_router)
        api_router.include_router(training_router)
        app.include_router(api_router)

        def override_session():
            session = self.SessionLocal()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_session] = override_session
        app.dependency_overrides[get_actor] = lambda: self.actor
        return app

    def test_create_recipe_rolls_back_when_food_is_missing(self) -> None:
        session = self.SessionLocal()
        try:
            with self.assertRaises(HTTPException) as error:
                create_recipe(
                    RecipeCreate(
                        name="Broken recipe",
                        items=[RecipeItemInput(food_id="missing-food", grams=100)],
                    ),
                    self.actor,
                    session,
                )
            self.assertEqual(error.exception.status_code, 404)
        finally:
            session.close()

        with self.SessionLocal() as check_session:
            count = check_session.scalar(select(func.count(Recipe.id))) or 0
            self.assertEqual(count, 0)

    def test_create_workout_session_rolls_back_when_exercise_is_missing(self) -> None:
        session = self.SessionLocal()
        try:
            with self.assertRaises(HTTPException) as error:
                create_workout_session(
                    WorkoutSessionCreate(
                        notes="Should fail",
                        sets=[SetEntryInput(exercise_id="missing-exercise", set_index=1, reps=5, load_kg=100)],
                    ),
                    self.actor,
                    session,
                )
            self.assertEqual(error.exception.status_code, 404)
        finally:
            session.close()

        with self.SessionLocal() as check_session:
            workout_count = check_session.scalar(select(func.count(WorkoutSession.id))) or 0
            set_count = check_session.scalar(select(func.count(SetEntry.id))) or 0
            self.assertEqual(workout_count, 0)
            self.assertEqual(set_count, 0)

    def test_create_recipe_endpoint_returns_404_without_persisting_recipe(self) -> None:
        with TestClient(self.build_test_app()) as client:
            response = client.post(
                "/api/v1/recipes",
                json={"name": "Broken recipe", "items": [{"food_id": "missing-food", "grams": 100}]},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Food missing-food not found."})

        with self.SessionLocal() as check_session:
            count = check_session.scalar(select(func.count(Recipe.id))) or 0
            self.assertEqual(count, 0)

    def test_create_workout_session_endpoint_returns_404_without_persisting_rows(self) -> None:
        with TestClient(self.build_test_app()) as client:
            response = client.post(
                "/api/v1/workout-sessions",
                json={
                    "notes": "Should fail",
                    "sets": [{"exercise_id": "missing-exercise", "set_index": 1, "reps": 5, "load_kg": 100}],
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Exercise missing-exercise not found."})

        with self.SessionLocal() as check_session:
            workout_count = check_session.scalar(select(func.count(WorkoutSession.id))) or 0
            set_count = check_session.scalar(select(func.count(SetEntry.id))) or 0
            self.assertEqual(workout_count, 0)
            self.assertEqual(set_count, 0)
