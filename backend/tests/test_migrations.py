from argparse import Namespace
import importlib.util
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
            backend_root = Path(__file__).resolve().parents[1]
            config = Config(str(backend_root / "alembic.ini"))
            config.set_main_option("script_location", str(backend_root / "migrations"))
            config.cmd_opts = Namespace(x=[f"database_url=sqlite:///{db_path.as_posix()}"])

            command.upgrade(config, "head")

            with closing(sqlite3.connect(db_path)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                history_columns = {row[1] for row in connection.execute("PRAGMA table_info(history_tasks)").fetchall()}
                audit_columns = {row[1] for row in connection.execute("PRAGMA table_info(audit_events)").fetchall()}

            self.assertTrue({"kv_store", "history_tasks", "templates", "audit_events", "users"}.issubset(tables))
            self.assertTrue({"tenant_id", "owner_id"}.issubset(history_columns))
            self.assertTrue({"tenant_id", "owner_id"}.issubset(audit_columns))

    def test_startup_migration_helper_creates_required_tables(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "startup.sqlite3"
            script_path = Path(__file__).resolve().parents[1] / "start-workspace-api.py"
            spec = importlib.util.spec_from_file_location("workspace_api_entry", script_path)
            module = importlib.util.module_from_spec(spec)
            assert spec and spec.loader
            spec.loader.exec_module(module)

            module.run_migrations(f"sqlite:///{db_path.as_posix()}")

            with closing(sqlite3.connect(db_path)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }

            self.assertTrue({"kv_store", "history_tasks", "templates", "audit_events", "users"}.issubset(tables))


if __name__ == "__main__":
    unittest.main()
