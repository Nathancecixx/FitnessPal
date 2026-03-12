from __future__ import annotations

import os
import unittest

from fastapi import Request, Response
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base
from app.core.models import AppUser
from app.core.security import Actor
from app.modules.nutrition import FoodCreate, create_food, list_foods
from app.modules.platform import (
    PasswordSetupRequest,
    UserCreate,
    UserPreferencesUpdate,
    _session_cookie_secure_flag,
    create_user,
    get_user_preferences,
    setup_password,
    update_user_preferences,
)


class MultiUserAccountTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_allow_insecure_http_private_hosts = os.environ.get("FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS")
        get_settings.cache_clear()
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
        if self.original_allow_insecure_http_private_hosts is None:
            os.environ.pop("FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS", None)
        else:
            os.environ["FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS"] = self.original_allow_insecure_http_private_hosts
        get_settings.cache_clear()

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

    def test_preferences_default_to_metric_until_updated(self) -> None:
        with self.SessionLocal() as session:
            preferences = get_user_preferences(self.admin_actor, session)

        self.assertEqual(preferences["weight_unit"], "kg")
        self.assertIsNone(preferences["created_at"])

    def test_preferences_are_stored_per_user(self) -> None:
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

            update_user_preferences(UserPreferencesUpdate(weight_unit="lbs"), self.admin_actor, session)

            admin_preferences = get_user_preferences(self.admin_actor, session)
            user_preferences = get_user_preferences(user_actor, session)

        self.assertEqual(admin_preferences["weight_unit"], "lbs")
        self.assertEqual(user_preferences["weight_unit"], "kg")

    def test_private_lan_http_hosts_can_receive_session_cookies_when_enabled(self) -> None:
        os.environ["FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS"] = "true"
        get_settings.cache_clear()
        request = Request(
            {
                "type": "http",
                "scheme": "http",
                "method": "POST",
                "path": "/api/v1/auth/login",
                "headers": [(b"host", b"192.168.1.25:8080")],
                "server": ("192.168.1.25", 8080),
                "client": ("192.168.1.50", 12345),
                "query_string": b"",
            }
        )

        self.assertFalse(_session_cookie_secure_flag(request))

    def test_public_http_hosts_still_require_https_for_session_cookies(self) -> None:
        os.environ["FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS"] = "true"
        get_settings.cache_clear()
        request = Request(
            {
                "type": "http",
                "scheme": "http",
                "method": "POST",
                "path": "/api/v1/auth/login",
                "headers": [(b"host", b"example.com")],
                "server": ("example.com", 80),
                "client": ("203.0.113.5", 12345),
                "query_string": b"",
            }
        )

        with self.assertRaises(HTTPException) as error:
            _session_cookie_secure_flag(request)

        self.assertEqual(error.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
