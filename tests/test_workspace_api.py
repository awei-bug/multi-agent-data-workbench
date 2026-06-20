import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app


class FakeChatClient:
    async def complete(self, prompt: str) -> str:
        return "model generated summary"


class WorkspaceApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
        )
        self.client = TestClient(self.app)

    def test_get_active_task_returns_workspace_session(self) -> None:
        response = self.client.get("/api/active-task")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], "workspace-active-session")
        self.assertEqual(payload["mode"], "live")

    def test_parse_intent_rejects_empty_request(self) -> None:
        response = self.client.post("/api/intent/parse", json={"request": "   "})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "request is required")

    def test_list_templates_returns_seed_templates(self) -> None:
        response = self.client.get("/api/templates")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload), 2)
        self.assertEqual(payload[0]["source"], "system")

    def test_workflow_start_updates_active_task_snapshot(self) -> None:
        response = self.client.post("/api/workflow/action", json={"action": "start"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["snapshot"]["phase"], "running")
        self.assertEqual(payload["snapshot"]["nodes"][0]["status"], "running")

    def test_workflow_advance_uses_model_output(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            chat_client=FakeChatClient(),
            repository_path=str(self.db_path),
        )
        client = TestClient(app)

        client.patch(
            "/api/active-task",
            json={
                "status": "running",
                "summary": "draft",
                "request": "analyze sales anomalies",
                "snapshot": {
                    "phase": "running",
                    "logMessage": "analysis pending",
                    "nodes": [
                        {"id": "source", "label": "Source Agent", "status": "success"},
                        {"id": "clean", "label": "Clean Agent", "status": "success"},
                        {"id": "metric", "label": "Metric Agent", "status": "success"},
                        {"id": "chart", "label": "Chart Agent", "status": "success"},
                        {"id": "analysis", "label": "Analysis Agent", "status": "running"},
                        {"id": "report", "label": "Report Agent", "status": "pending"},
                        {"id": "audit", "label": "Audit Agent", "status": "pending"},
                    ],
                    "context": {
                        "activeAgent": "Analysis Agent",
                        "inputSummary": "analysis input",
                        "outputSummary": "analysis output",
                        "latestLog": "analysis pending",
                        "risks": [],
                    },
                },
                "risks": [],
            },
        )

        response = client.post("/api/workflow/advance")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["summary"], "model generated summary")

    def test_saved_history_persists_across_app_restart(self) -> None:
        self.client.patch("/api/active-task", json={"summary": "persist me"})
        self.client.post("/api/history/save-active-task")

        restarted = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
        )
        restarted_client = TestClient(restarted)

        response = restarted_client.get("/api/history/tasks")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload[0]["summary"], "persist me")

    def test_history_detail_includes_persisted_execution_log(self) -> None:
        self.client.post("/api/workflow/action", json={"action": "start"})
        saved = self.client.post("/api/history/save-active-task").json()

        response = self.client.get(f"/api/history/tasks/{saved['id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("executionLog", payload)
        self.assertGreaterEqual(len(payload["executionLog"]), 1)
        self.assertEqual(payload["executionLog"][-1]["kind"], "action")


if __name__ == "__main__":
    unittest.main()
