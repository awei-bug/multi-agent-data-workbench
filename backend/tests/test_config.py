import unittest

from backend_py.config import load_settings


class ConfigTest(unittest.TestCase):
    def test_requires_model_api_key(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Missing model API key"):
            load_settings({})

    def test_loads_runtime_settings_from_environment(self) -> None:
        settings = load_settings(
            {
                "AGNES_API_KEY": "test-key",
                "WORKSPACE_API_HOST": "0.0.0.0",
                "WORKSPACE_API_PORT": "9000",
                "WORKSPACE_DATABASE_URL": "postgresql://postgres:123456@127.0.0.1:5432/workbench",
                "WORKSPACE_MODEL_TIMEOUT_SECONDS": "12.5",
                "WORKSPACE_ENABLE_AUDIT_EVENTS": "false",
                "WORKSPACE_MAX_REQUEST_BODY_BYTES": "1024",
                "WORKSPACE_CORS_ORIGINS": "http://127.0.0.1:5174, http://localhost:5174",
            }
        )

        self.assertEqual(settings.api_key, "test-key")
        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 9000)
        self.assertEqual(settings.database_url, "postgresql://postgres:123456@127.0.0.1:5432/workbench")
        self.assertEqual(settings.timeout_seconds, 12.5)
        self.assertFalse(settings.enable_audit_events)
        self.assertEqual(settings.max_request_body_bytes, 1024)
        self.assertEqual(settings.cors_origins, ["http://127.0.0.1:5174", "http://localhost:5174"])


if __name__ == "__main__":
    unittest.main()
