from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.error_tracking import ErrorTracker, init_error_tracking, reset_error_tracker_for_tests


class FakeSentry:
    def __init__(self) -> None:
        self.init_calls: list[dict] = []
        self.exceptions: list[BaseException] = []
        self.messages: list[tuple[str, str]] = []

    def init(self, **kwargs):
        self.init_calls.append(kwargs)

    def push_scope(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def set_tag(self, *args, **kwargs):
        return None

    def set_level(self, *args, **kwargs):
        return None

    def set_extra(self, *args, **kwargs):
        return None

    def capture_exception(self, error):
        self.exceptions.append(error)

    def capture_message(self, message, level="error"):
        self.messages.append((message, level))


class ErrorTrackingUnitTest(unittest.TestCase):
    def test_capture_exception_buffers_and_sends_webhook(self) -> None:
        sent: list[tuple[str, dict]] = []

        def sender(url: str, payload: dict) -> None:
            sent.append((url, payload))

        tracker = ErrorTracker(
            enabled=True,
            alert_webhook_url="https://hooks.example.com/alert",
            alert_min_level="error",
            webhook_sender=sender,
        )
        event = tracker.capture_exception(RuntimeError("boom"), source="unit", context={"k": "v"})
        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.message, "boom")
        recent = tracker.recent_events()
        self.assertEqual(recent[0]["message"], "boom")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "https://hooks.example.com/alert")
        self.assertIn("boom", sent[0][1]["text"])

    def test_sentry_capture_paths(self) -> None:
        fake = FakeSentry()
        tracker = ErrorTracker(
            enabled=True,
            sentry_dsn="https://example.ingest.sentry.io/1",
            sentry_module=fake,
        )
        self.assertTrue(tracker.snapshot()["sentryEnabled"])
        tracker.capture_exception(ValueError("bad"), source="unit")
        tracker.capture_message("hello", source="unit", level="warning")
        self.assertEqual(len(fake.exceptions), 1)
        self.assertEqual(fake.messages[0][0], "hello")


class ErrorTrackingApiTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_error_tracker_for_tests()
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.sent: list[tuple[str, dict]] = []

        def sender(url: str, payload: dict) -> None:
            self.sent.append((url, payload))

        self.tracker = init_error_tracking(
            enabled=True,
            alert_webhook_url="https://hooks.example.com/alert",
            webhook_sender=sender,
        )
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            error_tracker=self.tracker,
            admin_api_key="secret-admin",
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()
        reset_error_tracker_for_tests()

    def test_health_and_metrics_include_error_tracking(self) -> None:
        self.tracker.capture_message("probe-error", source="test")
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        payload = health.json()
        self.assertIn("errorTracking", payload["observability"])
        self.assertGreaterEqual(payload["observability"]["errorTracking"]["totalCaptured"], 1)

        metrics = self.client.get("/api/metrics")
        self.assertEqual(metrics.status_code, 200)
        self.assertIn("errorTracking", metrics.json())

    def test_recent_errors_requires_admin(self) -> None:
        self.tracker.capture_exception(RuntimeError("api-boom"), source="test")
        denied = self.client.get("/api/errors/recent")
        self.assertEqual(denied.status_code, 403)

        allowed = self.client.get("/api/errors/recent", headers={"x-admin-api-key": "secret-admin"})
        self.assertEqual(allowed.status_code, 200)
        body = allowed.json()
        self.assertGreaterEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["message"], "api-boom")
        self.assertGreaterEqual(len(self.sent), 1)


if __name__ == "__main__":
    unittest.main()
