from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import inspect, text

from app.core.config import get_settings
from app.core.database import Base, engine


logger = logging.getLogger(__name__)


def _alembic_config() -> Config:
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    return config


def _diff_operation_name(diff: Any) -> str:
    if isinstance(diff, tuple) and diff and isinstance(diff[0], str):
        return diff[0]
    if isinstance(diff, list) and diff:
        return _diff_operation_name(diff[0])
    return ""


def _schema_supports_current_models() -> tuple[bool, list[Any]]:
    import app.core.models  # noqa: F401

    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        diffs = compare_metadata(context, Base.metadata)

    blocking_diffs = [diff for diff in diffs if not _diff_operation_name(diff).startswith("remove_")]
    return not blocking_diffs, blocking_diffs


def _repair_missing_revision_state(config: Config) -> bool:
    schema_is_compatible, blocking_diffs = _schema_supports_current_models()
    if not schema_is_compatible:
        logger.error(
            "Cannot auto-repair alembic_version because the database still needs schema changes: %s",
            blocking_diffs,
        )
        return False

    heads = tuple(ScriptDirectory.from_config(config).get_heads())
    with engine.begin() as connection:
        # Alembic cannot stamp when the current revision is missing, so repair the version table directly.
        connection.execute(text("DELETE FROM alembic_version"))
        for version_num in heads:
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:version_num)"),
                {"version_num": version_num},
            )

    logger.warning(
        "Repaired alembic_version after detecting an orphaned revision. Current head(s): %s",
        ", ".join(heads),
    )
    return True


def _upgrade_to_head(config: Config) -> None:
    try:
        command.upgrade(config, "head")
    except CommandError as error:
        if "Can't locate revision identified by" not in str(error):
            raise
        if not _repair_missing_revision_state(config):
            raise RuntimeError(
                "Database references an Alembic revision that is no longer present and does not match the current "
                "application schema. Reset the local database volume or restore the missing migration."
            ) from error
        command.upgrade(config, "head")


def ensure_schema_current() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    alembic_tables = {"alembic_version"}
    user_tables = tables - alembic_tables

    config = _alembic_config()
    if not user_tables:
        _upgrade_to_head(config)
        return

    if "alembic_version" not in tables:
        command.stamp(config, "head")
        return

    _upgrade_to_head(config)
