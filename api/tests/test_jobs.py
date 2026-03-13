from __future__ import annotations

from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.models  # noqa: F401
from app.core.database import Base
from app.core.jobs import enqueue_live_insights_refresh, ensure_daily_jobs
from app.core.models import AppUser, JobRecord, UserPreference


class JobSchedulingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_enqueue_live_insights_refresh_dedupes_within_the_same_minute(self) -> None:
        with self.SessionLocal() as session:
            session.add(AppUser(id="user-1", username="athlete", is_active=True, is_admin=False))
            session.commit()

            frozen_now = datetime(2026, 3, 12, 14, 7, tzinfo=timezone.utc)
            with patch("app.core.jobs.utcnow", return_value=frozen_now):
                first = enqueue_live_insights_refresh(session, "user-1", {"source": "meal", "user_id": "user-1"})
                second = enqueue_live_insights_refresh(session, "user-1", {"source": "weight", "user_id": "user-1"})

            jobs = session.scalars(select(JobRecord).where(JobRecord.user_id == "user-1")).all()

        self.assertEqual(first.id, second.id)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].dedupe_key, "insights-live:user-1:202603121407")

    def test_ensure_daily_jobs_uses_user_timezone_and_server_fallback(self) -> None:
        with self.SessionLocal() as session:
            session.add_all(
                [
                    AppUser(id="user-berlin", username="berlin", is_active=True, is_admin=False),
                    AppUser(id="user-server", username="server", is_active=True, is_admin=False),
                    UserPreference(user_id="user-berlin", weight_unit="kg", timezone="Europe/Berlin"),
                ]
            )
            session.commit()

            frozen_now = datetime(2026, 3, 12, 1, 30, tzinfo=timezone.utc)
            with patch("app.core.jobs.utcnow", return_value=frozen_now), patch("app.core.jobs._server_timezone", return_value=timezone.utc):
                ensure_daily_jobs(session, target_date=date(2026, 3, 12))

            rows = session.scalars(select(JobRecord).order_by(JobRecord.user_id.asc(), JobRecord.job_type.asc())).all()

        self.assertEqual(len(rows), 4)

        by_key = {(row.user_id, row.job_type): row for row in rows}
        self.assertEqual(
            by_key[("user-berlin", "insights.recompute")].available_at.isoformat(),
            datetime(2026, 3, 12, 4, 0, tzinfo=timezone.utc).replace(tzinfo=None).isoformat(),
        )
        self.assertEqual(
            by_key[("user-berlin", "platform.backup")].available_at.isoformat(),
            datetime(2026, 3, 12, 4, 5, tzinfo=timezone.utc).replace(tzinfo=None).isoformat(),
        )
        self.assertEqual(
            by_key[("user-server", "insights.recompute")].available_at.isoformat(),
            datetime(2026, 3, 12, 5, 0, tzinfo=timezone.utc).replace(tzinfo=None).isoformat(),
        )
        self.assertEqual(
            by_key[("user-server", "platform.backup")].available_at.isoformat(),
            datetime(2026, 3, 12, 5, 5, tzinfo=timezone.utc).replace(tzinfo=None).isoformat(),
        )


if __name__ == "__main__":
    unittest.main()
