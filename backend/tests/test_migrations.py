from argparse import Namespace
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from alembic import command
from alembic.config import Config


class MigrationTest(unittest.TestCase):
    def test_initial_migration_creates_required_tables(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "workspace.sqlite3"
            config = Config("alembic.ini")
            config.cmd_opts = Namespace(x=[f"database_url=sqlite:///{db_path.as_posix()}"])

            command.upgrade(config, "head")

            with closing(sqlite3.connect(db_path)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }

        self.assertTrue({"kv_store", "history_tasks", "templates", "audit_events"}.issubset(tables))


if __name__ == "__main__":
    unittest.main()
