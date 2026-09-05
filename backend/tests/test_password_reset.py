from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app


class PasswordResetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret="test-auth-secret-for-reset",
            auth_required=False,
            production_mode=False,
        )
        self.client = TestClient(self.app)
        register = self.client.post(
            "/api/auth/register",
            json={"username": "reset_user", "password": "password123", "tenantId": "tenant-r"},
        )
        self.assertEqual(register.status_code, 200)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()

    def test_password_reset_roundtrip(self) -> None:
        requested = self.client.post(
            "/api/auth/password-reset/request",
            json={"username": "reset_user"},
        )
        self.assertEqual(requested.status_code, 200)
        payload = requested.json()
        self.assertTrue(payload["ok"])
        token = payload["resetToken"]

        confirmed = self.client.post(
            "/api/auth/password-reset/confirm",
            json={"token": token, "newPassword": "NewPass123"},
        )
        self.assertEqual(confirmed.status_code, 200)

        old_login = self.client.post(
            "/api/auth/login",
            json={"username": "reset_user", "password": "password123"},
        )
        self.assertEqual(old_login.status_code, 401)

        new_login = self.client.post(
            "/api/auth/login",
            json={"username": "reset_user", "password": "NewPass123"},
        )
        self.assertEqual(new_login.status_code, 200)
        self.assertIn("accessToken", new_login.json())

        # token is one-time
        reused = self.client.post(
            "/api/auth/password-reset/confirm",
            json={"token": token, "newPassword": "AnotherPass1"},
        )
        self.assertEqual(reused.status_code, 400)

    def test_unknown_username_still_ok(self) -> None:
        response = self.client.post(
            "/api/auth/password-reset/request",
            json={"username": "no_such_user"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertNotIn("resetToken", response.json())


if __name__ == "__main__":
    unittest.main()
