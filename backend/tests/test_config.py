import unittest

from backend_py.config import load_settings


class ConfigTest(unittest.TestCase):
    def test_allows_deterministic_mode_without_model_api_key(self) -> None:
        settings = load_settings({})
        self.assertEqual(settings.api_key, "")
        self.assertEqual(settings.admin_api_key, "")
        self.assertTrue(settings.run_migrations_on_start)

    def test_loads_runtime_settings_from_environment(self) -> None:
        settings = load_settings(
            {
                "AGNES_API_KEY": "test-key",
                "WORKSPACE_ADMIN_API_KEY": "admin-key",
                "WORKSPACE_API_HOST": "0.0.0.0",
                "WORKSPACE_API_PORT": "9000",
                "WORKSPACE_DATABASE_URL": "postgresql://postgres:123456@127.0.0.1:5432/workbench",
                "WORKSPACE_MODEL_TIMEOUT_SECONDS": "12.5",
                "WORKSPACE_ENABLE_AUDIT_EVENTS": "false",
                "WORKSPACE_MAX_REQUEST_BODY_BYTES": "1024",
                "WORKSPACE_RATE_LIMIT_PER_MINUTE": "30",
                "WORKSPACE_CORS_ORIGINS": "http://127.0.0.1:5174, http://localhost:5174",
                "WORKSPACE_AUTH_SECRET": "super-secret",
                "WORKSPACE_AUTH_TOKEN_MINUTES": "60",
                "WORKSPACE_AUTH_REQUIRED": "true",
                "WORKSPACE_JSON_LOGS": "false",
                "WORKSPACE_METRICS_ENABLED": "true",
                "WORKSPACE_QUEUE_BACKEND": "memory",
            }
        )

        self.assertEqual(settings.api_key, "test-key")
        self.assertEqual(settings.admin_api_key, "admin-key")
        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 9000)
        self.assertEqual(settings.model_base_url, "https://apihub.agnes-ai.com/v1")
        self.assertEqual(settings.model_name, "Agnes 2.0 Flash")
        self.assertEqual(settings.database_url, "postgresql://postgres:123456@127.0.0.1:5432/workbench")
        self.assertEqual(settings.timeout_seconds, 12.5)
        self.assertFalse(settings.enable_audit_events)
        self.assertEqual(settings.max_request_body_bytes, 1024)
        self.assertEqual(settings.rate_limit_per_minute, 30)
        self.assertEqual(settings.cors_origins, ["http://127.0.0.1:5174", "http://localhost:5174"])
        self.assertEqual(settings.default_user_id, "local-user")
        self.assertEqual(settings.default_tenant_id, "local-tenant")
        self.assertEqual(settings.log_level, "INFO")
        self.assertTrue(settings.run_migrations_on_start)
        self.assertEqual(settings.auth_secret, "super-secret")
        self.assertEqual(settings.auth_token_minutes, 60)
        self.assertTrue(settings.auth_required)
        self.assertTrue(settings.workflow_async)
        self.assertEqual(settings.workflow_step_delay_ms, 0)
        self.assertFalse(settings.json_logs)
        self.assertTrue(settings.metrics_enabled)
        self.assertEqual(settings.queue_backend, "memory")
        self.assertIsNone(settings.redis_url)
        self.assertTrue(settings.error_tracking_enabled)
        self.assertIsNone(settings.sentry_dsn)
        self.assertEqual(settings.sentry_environment, "local")
        self.assertEqual(settings.alert_min_level, "error")
        self.assertEqual(settings.rate_limit_backend, "memory")
        self.assertEqual(settings.credentials_secret, "super-secret")

    def test_loads_workspace_scope_defaults(self) -> None:
        settings = load_settings(
            {
                "WORKSPACE_DEFAULT_USER_ID": "analyst-a",
                "WORKSPACE_DEFAULT_TENANT_ID": "tenant-a",
                "WORKSPACE_MODEL_BASE_URL": "https://example.com/v1",
                "WORKSPACE_MODEL_NAME": "custom-model",
                "WORKSPACE_LOG_LEVEL": "debug",
                "WORKSPACE_RUN_MIGRATIONS_ON_START": "false",
                "WORKSPACE_QUEUE_BACKEND": "redis",
                "WORKSPACE_REDIS_URL": "redis://127.0.0.1:6379/1",
                "WORKSPACE_SENTRY_DSN": "https://example.ingest.sentry.io/1",
                "WORKSPACE_SENTRY_ENVIRONMENT": "staging",
                "WORKSPACE_SENTRY_TRACES_SAMPLE_RATE": "0.2",
                "WORKSPACE_ALERT_WEBHOOK_URL": "https://hooks.example.com/alert",
                "WORKSPACE_ALERT_MIN_LEVEL": "warning",
                "WORKSPACE_RATE_LIMIT_BACKEND": "redis",
            }
        )

        self.assertEqual(settings.default_user_id, "analyst-a")
        self.assertEqual(settings.default_tenant_id, "tenant-a")
        self.assertEqual(settings.model_base_url, "https://example.com/v1")
        self.assertEqual(settings.model_name, "custom-model")
        self.assertEqual(settings.log_level, "debug")
        self.assertFalse(settings.run_migrations_on_start)
        self.assertEqual(settings.queue_backend, "redis")
        self.assertEqual(settings.redis_url, "redis://127.0.0.1:6379/1")
        self.assertEqual(settings.sentry_dsn, "https://example.ingest.sentry.io/1")
        self.assertEqual(settings.sentry_environment, "staging")
        self.assertEqual(settings.sentry_traces_sample_rate, 0.2)
        self.assertEqual(settings.alert_webhook_url, "https://hooks.example.com/alert")
        self.assertEqual(settings.alert_min_level, "warning")
        self.assertEqual(settings.rate_limit_backend, "redis")


if __name__ == "__main__":
    unittest.main()
