from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.artifact_store import LocalArtifactStore, create_artifact_store
from backend_py.security import validate_production_settings
from backend_py.upload_security import UploadSecurityError, validate_upload


class SecurityBaselineTest(unittest.TestCase):
    def test_production_validation_rejects_weak_settings(self) -> None:
        report = validate_production_settings(
            auth_required=False,
            auth_secret="local-dev-only-change-me",
            admin_api_key="",
            credentials_secret="short",
            cors_origins=None,
            env={"WORKSPACE_PRODUCTION_MODE": "true"},
        )
        self.assertTrue(report.production_mode)
        self.assertFalse(report.ok)
        self.assertTrue(any("AUTH_REQUIRED" in item for item in report.errors))

    def test_create_app_blocks_insecure_production_mode(self) -> None:
        with self.assertRaises(RuntimeError):
            create_app(
                api_key="k",
                base_url="https://example.com",
                model="m",
                seed_demo_data=False,
                production_mode=True,
                enforce_production_security=True,
                auth_required=False,
                auth_secret="local-dev-only-change-me",
                admin_api_key="",
                credentials_secret="local-dev-only-change-me",
                cors_origins=None,
            )

    def test_security_headers_and_health_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                api_key="k",
                base_url="https://example.com",
                model="m",
                repository_path=str(Path(temp_dir) / "db.sqlite3"),
                seed_demo_data=False,
                production_mode=False,
                enable_hsts=True,
            )
            client = TestClient(app)
            response = client.get("/api/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")
            self.assertEqual(response.headers.get("x-frame-options"), "DENY")
            self.assertIn("content-security-policy", response.headers)
            self.assertIn("strict-transport-security", response.headers)
            payload = response.json()
            self.assertIn("security", payload)
            self.assertIn("storage", payload)
            client.close()


class UploadSecurityTest(unittest.TestCase):
    def test_rejects_html_upload(self) -> None:
        with self.assertRaises(UploadSecurityError):
            validate_upload(
                file_name="note.html",
                content_type="text/html",
                size_bytes=20,
                max_bytes=1000,
                content=b"<html><script>alert(1)</script></html>",
            )

    def test_accepts_csv_upload(self) -> None:
        result = validate_upload(
            file_name="sales.csv",
            content_type="text/csv",
            size_bytes=12,
            max_bytes=1000,
            content=b"a,b\n1,2\n",
        )
        self.assertEqual(result["extension"], ".csv")


class ArtifactStoreTest(unittest.TestCase):
    def test_local_store_roundtrip(self) -> None:
        with TemporaryDirectory() as temp_dir:
            store = create_artifact_store(backend="local", artifact_dir=temp_dir)
            self.assertIsInstance(store, LocalArtifactStore)
            saved = store.save("uploads", "a.txt", b"hello")
            self.assertEqual(store.read(saved["storageKey"]), b"hello")
            store.delete(saved["storageKey"])


class WorkflowStreamTest(unittest.TestCase):
    def test_stream_endpoint_returns_sse(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                api_key="k",
                base_url="https://example.com",
                model="m",
                repository_path=str(Path(temp_dir) / "db.sqlite3"),
                seed_demo_data=False,
                workflow_async=True,
            )
            client = TestClient(app)
            with client.stream("GET", "/api/workflow/jobs/stream") as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn("text/event-stream", response.headers.get("content-type", ""))
                # Read a small amount then stop.
                chunk = next(response.iter_text())
                self.assertTrue(chunk.startswith("event:") or chunk.startswith("data:") or "workflow" in chunk or chunk == "")
            client.close()


if __name__ == "__main__":
    unittest.main()
