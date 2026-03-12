from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from alembic.util.exc import CommandError

from app.core import migrations


class MigrationBootstrapTests(unittest.TestCase):
    def test_ensure_schema_current_repairs_missing_revision_and_retries_upgrade(self) -> None:
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["alembic_version", "app_users"]
        config = object()

        with (
            patch("app.core.migrations.inspect", return_value=inspector),
            patch("app.core.migrations._alembic_config", return_value=config),
            patch(
                "app.core.migrations.command.upgrade",
                side_effect=[CommandError("Can't locate revision identified by 'c3a6b7d4e9f1'"), None],
            ) as upgrade,
            patch("app.core.migrations._repair_missing_revision_state", return_value=True) as repair,
        ):
            migrations.ensure_schema_current()

        repair.assert_called_once_with(config)
        self.assertEqual(upgrade.call_count, 2)

    def test_repair_missing_revision_state_rewrites_alembic_version_rows(self) -> None:
        connection = MagicMock()
        transaction = MagicMock()
        transaction.__enter__.return_value = connection
        transaction.__exit__.return_value = None
        script_directory = MagicMock()
        script_directory.get_heads.return_value = ["4d3b8a7f9c12", "b91b4a9b0c4e"]
        engine = MagicMock()
        engine.begin.return_value = transaction

        with (
            patch("app.core.migrations._schema_supports_current_models", return_value=(True, [])),
            patch("app.core.migrations.ScriptDirectory.from_config", return_value=script_directory),
            patch("app.core.migrations.engine", engine),
        ):
            repaired = migrations._repair_missing_revision_state(object())

        self.assertTrue(repaired)
        self.assertEqual(str(connection.execute.call_args_list[0].args[0]), "DELETE FROM alembic_version")
        self.assertEqual(
            str(connection.execute.call_args_list[1].args[0]),
            "INSERT INTO alembic_version (version_num) VALUES (:version_num)",
        )
        self.assertEqual(connection.execute.call_args_list[1].args[1], {"version_num": "4d3b8a7f9c12"})
        self.assertEqual(connection.execute.call_args_list[2].args[1], {"version_num": "b91b4a9b0c4e"})


if __name__ == "__main__":
    unittest.main()
