from __future__ import annotations

import json
import logging
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.observability import JsonLogFormatter, get_metrics, reset_metrics_for_tests


class ObservabilityTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_metrics_for_tests()
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            metrics_enabled=True,
            workflow_async=False,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()
        reset_metrics_for_tests()

    def test_metrics_endpoint_exposes_prometheus_text(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)

        response = self.client.get("/metrics")
        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn("workspace_up 1", body)
        self.assertIn("workspace_http_requests_total", body)
        self.assertIn('route="/api/health"', body)

        snapshot = self.client.get("/api/metrics")
        self.assertEqual(snapshot.status_code, 200)
        payload = snapshot.json()
        self.assertEqual(payload["status"], "ok")
        self.assertGreaterEqual(payload["metrics"]["requestsTotal"], 1)

    def test_health_includes_observability_snapshot(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["observability"]["metricsEnabled"])
        self.assertEqual(payload["observability"]["metricsPath"], "/metrics")
        self.assertIn("requestsTotal", payload["observability"]["snapshot"])

    def test_json_log_formatter_emits_structured_fields(self) -> None:
        formatter = JsonLogFormatter()
        record = logging.LogRecord(
            name="workspace_api",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="request handled",
            args=(),
            exc_info=None,
        )
        record.request_id = "req-1"
        record.tenant_id = "tenant-a"
        record.user_id = "user-a"
        record.method = "GET"
        record.path = "/api/health"
        record.status = 200
        record.duration_ms = 12.5
        payload = json.loads(formatter.format(record))
        self.assertEqual(payload["level"], "INFO")
        self.assertEqual(payload["request_id"], "req-1")
        self.assertEqual(payload["tenant_id"], "tenant-a")
        self.assertEqual(payload["path"], "/api/health")
        self.assertEqual(payload["status"], 200)

    def test_workflow_job_metrics_increment_on_sync_run(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        ).json()
        self.client.post(f"/api/tasks/active/dataset/{uploaded['id']}")
        self.client.patch("/api/active-task", json={"request": "按区域汇总", "name": "metrics-run"})
        started = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(started.status_code, 200)
        metrics = get_metrics().snapshot()
        self.assertGreaterEqual(metrics["workflowJobs"].get("succeeded", 0) + metrics["workflowJobs"].get("failed", 0), 1)


if __name__ == "__main__":
    unittest.main()
