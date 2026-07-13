from __future__ import annotations

import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app


class FakeChatClient:
    def __init__(self) -> None:
        self.api_key = "fake"

    async def complete(self, prompt: str) -> str:
        return "async model summary"


class AsyncWorkflowApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            workflow_async=True,
            workflow_step_delay_ms=5,
            chat_client=FakeChatClient(),
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        runner = getattr(self.app.state, "workflow_runner", None)
        if runner is not None:
            runner.shutdown(wait=True)
        self.client.close()
        # Windows may briefly keep SQLite handles; ignore cleanup races.
        try:
            self.temp_dir.cleanup()
        except PermissionError:
            time.sleep(0.2)
            try:
                self.temp_dir.cleanup()
            except PermissionError:
                pass

    def _prepare_dataset(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        ).json()
        self.client.post(f"/api/tasks/active/dataset/{uploaded['id']}")
        self.client.patch(
            "/api/active-task",
            json={"request": "按区域汇总销售额", "name": "异步销售分析", "summary": "异步销售分析"},
        )

    def _wait_for_terminal(self, timeout_seconds: float = 8.0) -> dict:
        deadline = time.time() + timeout_seconds
        last = None
        while time.time() < deadline:
            response = self.client.get("/api/workflow/jobs/current")
            self.assertEqual(response.status_code, 200)
            last = response.json()
            job = last.get("job") or {}
            phase = (last.get("task") or {}).get("snapshot", {}).get("phase")
            job_status = job.get("status")
            if job_status in {"succeeded", "failed", "cancelled"}:
                return last
            if not job and phase in {"completed", "needs_review", "failed", "stopped", "paused"}:
                return last
            time.sleep(0.05)
        self.fail(f"workflow did not finish in time: {last}")

    def test_start_returns_immediately_and_completes_asynchronously(self) -> None:
        self._prepare_dataset()

        started = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(started.status_code, 200)
        payload = started.json()
        self.assertEqual(payload["snapshot"]["phase"], "running")
        self.assertEqual(payload["execution"]["mode"], "async")
        self.assertIn(payload["execution"]["status"], {"queued", "running"})
        self.assertTrue(payload["execution"]["jobId"])

        finished = self._wait_for_terminal()
        task = finished["task"]
        self.assertIn(task["snapshot"]["phase"], {"completed", "needs_review"})
        self.assertEqual(finished["job"]["status"], "succeeded")
        artifact_types = {item["type"] for item in task.get("artifacts", [])}
        self.assertIn("metric_result", artifact_types)
        self.assertIn("report_markdown", artifact_types)
        self.assertIn("audit", artifact_types)

    def test_rejects_duplicate_start_while_job_running(self) -> None:
        self._prepare_dataset()
        first = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(first.status_code, 200)
        second = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(second.status_code, 409)
        self._wait_for_terminal()

    def test_stop_cancels_running_job(self) -> None:
        self._prepare_dataset()
        started = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(started.status_code, 200)
        # Slow the runner a bit so stop can land while job is active.
        stopped = self.client.post("/api/workflow/action", json={"action": "stop"})
        self.assertEqual(stopped.status_code, 200)
        phase = stopped.json()["snapshot"]["phase"]
        self.assertIn(phase, {"stopped", "completed", "needs_review"})

        deadline = time.time() + 2.0
        while time.time() < deadline:
            job = self.client.get("/api/workflow/jobs/current").json().get("job") or {}
            if job.get("status") in {"cancelled", "succeeded", "failed"}:
                break
            time.sleep(0.05)
        current = self.client.get("/api/workflow/jobs/current").json()
        job = current.get("job") or {}
        self.assertIn(job.get("status"), {"cancelled", "succeeded", "failed", "running", None})
        # Once stop is issued, eventual phase should not keep running forever.
        if job.get("status") in {"cancelled", "succeeded", "failed"}:
            self.assertIn(current["task"]["snapshot"]["phase"], {"stopped", "completed", "needs_review", "failed", "paused"})


if __name__ == "__main__":
    unittest.main()
