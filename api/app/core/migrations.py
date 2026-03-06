from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.core.config import get_settings
from app.core.database import engine


def _alembic_config() -> Config:
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    return config


def ensure_schema_current() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    alembic_tables = {"alembic_version"}
    user_tables = tables - alembic_tables

    config = _alembic_config()
    if not user_tables:
        command.upgrade(config, "head")
        return

    if "alembic_version" not in tables:
        command.stamp(config, "head")
        return

    command.upgrade(config, "head")
