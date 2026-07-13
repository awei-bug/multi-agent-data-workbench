from __future__ import annotations

import sqlite3
import unittest
from argparse import Namespace
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from alembic import command
from alembic.config import Config

from backend_py.repository import TaskRepository, reset_workspace_scope, set_workspace_scope


class RelationalScopeMigrationTest(unittest.TestCase):
    def test_scope_migration_adds_columns_and_indexes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "workspace.sqlite3"
            backend_root = Path(__file__).resolve().parents[1]
            config = Config(str(backend_root / "alembic.ini"))
            config.set_main_option("script_location", str(backend_root / "migrations"))
            config.cmd_opts = Namespace(x=[f"database_url=sqlite:///{db_path.as_posix()}"])

            command.upgrade(config, "head")

            with closing(sqlite3.connect(db_path)) as connection:
                history_columns = {row[1] for row in connection.execute("PRAGMA table_info(history_tasks)").fetchall()}
                template_columns = {row[1] for row in connection.execute("PRAGMA table_info(templates)").fetchall()}
                audit_columns = {row[1] for row in connection.execute("PRAGMA table_info(audit_events)").fetchall()}
                indexes = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'index'"
                    ).fetchall()
                }

            self.assertTrue({"tenant_id", "owner_id"}.issubset(history_columns))
            self.assertTrue({"tenant_id", "owner_id"}.issubset(template_columns))
            self.assertTrue({"tenant_id", "owner_id"}.issubset(audit_columns))
            self.assertIn("ix_history_tasks_scope", indexes)
            self.assertIn("ix_templates_scope", indexes)
            self.assertIn("ix_audit_events_scope_created", indexes)


class RelationalScopeRepositoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.repo = TaskRepository(db_path=str(self.db_path), seed_demo_data=False)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_history_and_audit_use_scope_columns(self) -> None:
        token_a = set_workspace_scope("tenant-a", "user-a")
        try:
            self.repo.update_active_task({"name": "A任务", "summary": "A摘要", "request": "A需求"})
            saved_a = self.repo.save_active_task_to_history()
            self.repo.add_audit_event("task.save", saved_a["id"], {"name": "A"})
        finally:
            reset_workspace_scope(token_a)

        token_b = set_workspace_scope("tenant-b", "user-b")
        try:
            self.repo.update_active_task({"name": "B任务", "summary": "B摘要", "request": "B需求"})
            saved_b = self.repo.save_active_task_to_history()
            self.repo.add_audit_event("task.save", saved_b["id"], {"name": "B"})
            tasks_b = self.repo.list_recent_tasks()
            audits_b = self.repo.list_audit_events()
            self.assertEqual([item["id"] for item in tasks_b], [saved_b["id"]])
            self.assertTrue(all(item.get("ownerId") == "user-b" for item in audits_b))
            self.assertEqual(self.repo.count_audit_events(), 1)
        finally:
            reset_workspace_scope(token_b)

        with closing(sqlite3.connect(self.db_path)) as connection:
            history_rows = connection.execute(
                "SELECT tenant_id, owner_id FROM history_tasks ORDER BY tenant_id"
            ).fetchall()
            audit_rows = connection.execute(
                "SELECT tenant_id, owner_id FROM audit_events ORDER BY tenant_id"
            ).fetchall()
            self.assertEqual(
                history_rows,
                [("tenant-a", "user-a"), ("tenant-b", "user-b")],
            )
            self.assertEqual(
                audit_rows,
                [("tenant-a", "user-a"), ("tenant-b", "user-b")],
            )

    def test_system_templates_use_system_owner_column(self) -> None:
        token = set_workspace_scope("tenant-x", "user-x")
        try:
            self.repo._save_payload(
                "templates",
                "template-system-demo",
                {
                    "id": "template-system-demo",
                    "name": "系统模板",
                    "tag": "系统",
                    "description": "系统共享",
                    "request": "系统请求",
                    "summary": "系统摘要",
                    "source": "system",
                },
                include_owner=False,
            )
            templates = self.repo.list_templates()
            self.assertTrue(any(item["id"] == "template-system-demo" for item in templates))
        finally:
            reset_workspace_scope(token)

        with closing(sqlite3.connect(self.db_path)) as connection:
            row = connection.execute(
                "SELECT tenant_id, owner_id FROM templates WHERE id LIKE ?",
                ("%template-system-demo",),
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "tenant-x")
        self.assertEqual(row[1], "__system__")


if __name__ == "__main__":
    unittest.main()
