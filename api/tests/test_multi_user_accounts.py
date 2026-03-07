from __future__ import annotations

import unittest

from fastapi import Request, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.models import AppUser
from app.core.security import Actor
from app.modules.nutrition import FoodCreate, create_food, list_foods
from app.modules.platform import PasswordSetupRequest, UserCreate, create_user, setup_password


class MultiUserAccountTests(unittest.TestCase):
    def setUp(self) -> None:
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
            actor_id="admin-session",
            display_name="owner",
            scopes=("*",),
            user_id="admin-user",
            username="owner",
            is_admin=True,
        )
        with self.SessionLocal() as session:
            session.add(
                AppUser(
                    id=self.admin_actor.user_id,
                    username=self.admin_actor.username,
                    password_hash="hashed",
                    is_active=True,
                    is_admin=True,
                )
            )
            session.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_admin_can_issue_password_setup_and_user_can_complete_it(self) -> None:
        with self.SessionLocal() as session:
            created = create_user(UserCreate(username="alice"), self.admin_actor, session)
            self.assertTrue(created["setup_token"].startswith("fpset_"))

            response = Response()
            request = Request(
                {
                    "type": "http",
                    "scheme": "http",
                    "method": "POST",
                    "path": "/api/v1/auth/password/setup",
                    "headers": [],
                    "server": ("localhost", 8000),
                    "client": ("127.0.0.1", 12345),
                    "query_string": b"",
                }
            )
            completed = setup_password(
                PasswordSetupRequest(token=created["setup_token"], new_password="strong-pass-123"),
                request,
                response,
                session,
            )
            user = session.get(AppUser, created["id"])

        self.assertIsNotNone(user)
        self.assertIsNotNone(user.password_hash)
        self.assertEqual(completed["user"]["username"], "alice")
        self.assertTrue(response.headers.get("set-cookie", "").startswith("fitnesspal_session="))

    def test_user_data_is_isolated_by_user_id(self) -> None:
        user_actor = Actor(
            actor_type="session",
            actor_id="user-session",
            display_name="alice",
            scopes=("*",),
            user_id="user-alice",
            username="alice",
            is_admin=False,
        )
        with self.SessionLocal() as session:
            session.add(AppUser(id=user_actor.user_id, username=user_actor.username, password_hash="hashed", is_active=True))
            session.commit()

            create_food(FoodCreate(name="Admin oats", calories=380), self.admin_actor, session)
            create_food(FoodCreate(name="User yogurt", calories=120), user_actor, session)

            admin_foods = list_foods(self.admin_actor, session, None)["items"]
            user_foods = list_foods(user_actor, session, None)["items"]

        self.assertEqual([item["name"] for item in admin_foods], ["Admin oats"])
        self.assertEqual([item["name"] for item in user_foods], ["User yogurt"])


if __name__ == "__main__":
    unittest.main()
