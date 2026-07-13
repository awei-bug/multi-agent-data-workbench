from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.compliance import (
    apply_text_watermark,
    build_watermark_lines,
    is_expired,
    mask_text,
)
from backend_py.repository import create_repository, set_workspace_scope


class FakeChatClient:
    def __init__(self) -> None:
        self.api_key = "fake"

    async def complete(self, prompt: str) -> str:
        return "compliance summary"


class ComplianceUnitTest(unittest.TestCase):
    def test_mask_sensitive_patterns(self) -> None:
        text = "联系人 13812345678 邮箱 alice@example.com 身份证 110101199001011234"
        masked = mask_text(text)
        self.assertIn("138****5678", masked)
        self.assertIn("a***@example.com", masked)
        self.assertIn("1101", masked)
        self.assertNotIn("199001011234", masked)

    def test_watermark_and_expiry(self) -> None:
        lines = build_watermark_lines(username="admin", tenant_id="tenant-a")
        content = apply_text_watermark("报告正文", lines)
        self.assertIn("CONFIDENTIAL", content)
        self.assertIn("tenant-a/admin", content)
        self.assertIn("报告正文", content)
        old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        self.assertTrue(is_expired(old, retain_days=7))
        self.assertFalse(is_expired(old, retain_days=0))


class ComplianceApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.artifact_dir = Path(self.temp_dir.name) / "artifacts"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            workflow_async=False,
            chat_client=FakeChatClient(),
            artifact_dir=str(self.artifact_dir),
            export_watermark_enabled=True,
            export_mask_sensitive=True,
            retention_history_days=7,
            retention_dataset_days=7,
            retention_artifact_days=7,
            retention_audit_days=7,
            auth_secret="unit-auth-secret-for-compliance-tests-123",
            credentials_secret="unit-credentials-secret-for-compliance",
        )
        self.client = TestClient(self.app)
        self.repo = self.app.state.repository if hasattr(self.app.state, "repository") else None

    def tearDown(self) -> None:
        runner = getattr(self.app.state, "workflow_runner", None)
        if runner is not None:
            runner.shutdown(wait=False)
        self.client.close()
        self.temp_dir.cleanup()

    def _prepare_exportable_task(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        dataset_id = uploaded.json()["id"]
        self.client.post(f"/api/tasks/active/dataset/{dataset_id}")
        self.client.patch(
            "/api/active-task",
            json={
                "name": "合规导出任务",
                "request": "按区域汇总，联系人 13812345678",
                "summary": "区域销售分析",
            },
        )
        started = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(started.status_code, 200, started.text)
        # ensure audit artifact exists; if workflow didn't fully finish, inject one
        task = self.client.get("/api/tasks/active").json()
        has_audit = any(item.get("type") == "audit" for item in task.get("artifacts", []))
        has_report = any(item.get("type") == "report_markdown" for item in task.get("artifacts", []))
        if not has_audit or not has_report:
            artifacts = list(task.get("artifacts") or [])
            if not has_report:
                artifacts.append(
                    {
                        "type": "report_markdown",
                        "content": {"markdown": "报告包含手机号 13812345678"},
                    }
                )
            if not has_audit:
                artifacts.append({"type": "audit", "content": {"ok": True}})
            # direct repository write through app dependency
            from backend_py.repository import create_repository, set_workspace_scope

            repo = create_repository(db_path=str(self.db_path), seed_demo_data=False)
            set_workspace_scope("local-tenant", "local-user")
            repo.update_active_task({"artifacts": artifacts, "status": "已完成"})

    def test_export_applies_mask_and_watermark(self) -> None:
        self._prepare_exportable_task()
        exported = self.client.post(
            "/api/tasks/active/exports",
            json={"format": "markdown", "report": "联系方式 13812345678 与 alice@example.com"},
        )
        self.assertEqual(exported.status_code, 200, exported.text)
        payload = exported.json()
        self.assertTrue(payload.get("watermark"))
        self.assertTrue(payload.get("masked"))
        download = self.client.get(payload["downloadUrl"])
        self.assertEqual(download.status_code, 200)
        text = download.content.decode("utf-8")
        self.assertIn("CONFIDENTIAL", text)
        self.assertIn("138****5678", text)
        self.assertIn("a***@example.com", text)
        self.assertNotIn("13812345678", text)

    def test_retention_purge_endpoint(self) -> None:
        # create old history task and dataset via repository
        from backend_py.repository import create_repository, set_workspace_scope

        repo = create_repository(db_path=str(self.db_path), seed_demo_data=False)
        set_workspace_scope("local-tenant", "local-user")
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        task = {
            "id": "old-history-1",
            "name": "旧任务",
            "mode": "live",
            "status": "已完成",
            "summary": "旧",
            "request": "旧请求",
            "createdAt": old,
            "updatedAt": old,
            "snapshot": {"phase": "completed", "nodes": [], "logMessage": "done", "context": {}},
            "exports": [],
            "risks": [],
            "executionLog": [],
        }
        # save via internal payload API
        repo._save_payload("history_tasks", task["id"], task)
        dataset = {
            "id": "old-dataset-1",
            "name": "old.csv",
            "fileName": "old.csv",
            "kind": "table",
            "rowCount": 1,
            "columnCount": 1,
            "uploadedAt": old,
            "storageKey": "",
        }
        files = repo._get_uploaded_files()
        files.insert(0, dataset)
        repo._set_json(repo._scoped_key("uploaded_files"), {"items": files})

        purged = self.client.post("/api/admin/retention/purge")
        self.assertEqual(purged.status_code, 200, purged.text)
        body = purged.json()
        self.assertGreaterEqual(body["purged"]["historyTasks"], 1)
        self.assertGreaterEqual(body["purged"]["datasets"], 1)


if __name__ == "__main__":
    unittest.main()
