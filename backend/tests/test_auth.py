from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.auth import create_access_token, decode_access_token, hash_password, verify_password, AuthUser


class AuthApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.auth_secret = "test-auth-secret"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret=self.auth_secret,
            auth_required=False,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()

    def test_password_hash_roundtrip(self) -> None:
        password_hash = hash_password("password123")
        self.assertTrue(verify_password("password123", password_hash))
        self.assertFalse(verify_password("wrong-password", password_hash))

    def test_register_login_and_scope_binding(self) -> None:
        register = self.client.post(
            "/api/auth/register",
            json={
                "username": "analyst_a",
                "password": "password123",
                "tenantId": "tenant-a",
                "displayName": "Analyst A",
            },
        )
        self.assertEqual(register.status_code, 200)
        register_payload = register.json()
        self.assertIn("accessToken", register_payload)
        self.assertEqual(register_payload["user"]["tenantId"], "tenant-a")
        self.assertEqual(register_payload["user"]["username"], "analyst_a")

        login = self.client.post(
            "/api/auth/login",
            json={"username": "analyst_a", "password": "password123"},
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["accessToken"]

        me = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.json()["authenticated"])
        self.assertEqual(me.json()["user"]["id"], register_payload["user"]["id"])

        active = self.client.get("/api/active-task", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(active.status_code, 200)
        self.assertEqual(active.headers["x-workspace-tenant-id"], "tenant-a")
        self.assertEqual(active.headers["x-workspace-user-id"], register_payload["user"]["id"])

        # Forged workspace headers must not override JWT claims.
        forged = self.client.get(
            "/api/active-task",
            headers={
                "Authorization": f"Bearer {token}",
                "x-workspace-tenant-id": "forged-tenant",
                "x-workspace-user-id": "forged-user",
            },
        )
        self.assertEqual(forged.status_code, 200)
        self.assertEqual(forged.headers["x-workspace-tenant-id"], "tenant-a")
        self.assertEqual(forged.headers["x-workspace-user-id"], register_payload["user"]["id"])

    def test_auth_required_blocks_anonymous_api_access(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret=self.auth_secret,
            auth_required=True,
        )
        client = TestClient(app)

        blocked = client.get("/api/active-task")
        self.assertEqual(blocked.status_code, 401)
        self.assertEqual(blocked.json()["error"]["code"], "auth_required")

        health = client.get("/api/health")
        self.assertEqual(health.status_code, 200)

        register = client.post(
            "/api/auth/register",
            json={"username": "admin_user", "password": "password123", "tenantId": "tenant-b"},
        )
        self.assertEqual(register.status_code, 200)
        token = register.json()["accessToken"]
        allowed = client.get("/api/active-task", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(allowed.status_code, 200)
        client.close()

    def test_rejects_invalid_token(self) -> None:
        response = self.client.get(
            "/api/active-task",
            headers={"Authorization": "Bearer not-a-valid-token"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "invalid_token")

    def test_token_codec_roundtrip(self) -> None:
        user = AuthUser(
            id="user-1",
            username="alice",
            tenant_id="tenant-1",
            display_name="Alice",
            role="analyst",
        )
        token = create_access_token(user=user, secret=self.auth_secret, expires_minutes=30)
        payload = decode_access_token(token, self.auth_secret)
        self.assertEqual(payload["sub"], "user-1")
        self.assertEqual(payload["tenantId"], "tenant-1")


if __name__ == "__main__":
    unittest.main()
