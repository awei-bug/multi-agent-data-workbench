from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.auth import create_access_token, AuthUser


class RbacApiTest(unittest.TestCase):
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
            auth_required=True,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()

    def _register(self, username: str, tenant_id: str = "tenant-a") -> dict:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": username,
                "password": "password123",
                "tenantId": tenant_id,
                "displayName": username,
            },
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def test_first_user_is_admin_and_can_manage_roles(self) -> None:
        admin = self._register("admin_user")
        self.assertEqual(admin["user"]["role"], "admin")
        self.assertIn("admin", admin["user"]["permissions"])

        second = self._register("analyst_user")
        self.assertEqual(second["user"]["role"], "analyst")

        listed = self.client.get("/api/auth/users", headers=self._headers(admin["accessToken"]))
        self.assertEqual(listed.status_code, 200)
        usernames = {item["username"] for item in listed.json()["items"]}
        self.assertEqual(usernames, {"admin_user", "analyst_user"})

        promoted = self.client.patch(
            f"/api/auth/users/{second['user']['id']}/role",
            headers=self._headers(admin["accessToken"]),
            json={"role": "viewer"},
        )
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(promoted.json()["user"]["role"], "viewer")

    def test_viewer_cannot_write_or_manage(self) -> None:
        admin = self._register("admin_user")
        viewer_reg = self._register("viewer_user")
        demote = self.client.patch(
            f"/api/auth/users/{viewer_reg['user']['id']}/role",
            headers=self._headers(admin["accessToken"]),
            json={"role": "viewer"},
        )
        self.assertEqual(demote.status_code, 200)

        # viewer needs a fresh token with updated role claim
        login = self.client.post(
            "/api/auth/login",
            json={"username": "viewer_user", "password": "password123"},
        )
        self.assertEqual(login.status_code, 200)
        viewer_token = login.json()["accessToken"]
        self.assertEqual(login.json()["user"]["role"], "viewer")

        write_denied = self.client.patch(
            "/api/active-task",
            headers=self._headers(viewer_token),
            json={"summary": "should fail"},
        )
        self.assertEqual(write_denied.status_code, 403)
        self.assertEqual(write_denied.json()["error"]["code"], "permission_denied")

        users_denied = self.client.get("/api/auth/users", headers=self._headers(viewer_token))
        self.assertEqual(users_denied.status_code, 403)

        read_ok = self.client.get("/api/active-task", headers=self._headers(viewer_token))
        self.assertEqual(read_ok.status_code, 200)

    def test_analyst_can_write_but_not_admin(self) -> None:
        self._register("admin_user")
        analyst = self._register("analyst_user")
        write_ok = self.client.patch(
            "/api/active-task",
            headers=self._headers(analyst["accessToken"]),
            json={"summary": "analyst write"},
        )
        self.assertEqual(write_ok.status_code, 200)

        admin_denied = self.client.get("/api/audit/events", headers=self._headers(analyst["accessToken"]))
        self.assertEqual(admin_denied.status_code, 403)

    def test_admin_role_can_access_audit_without_api_key(self) -> None:
        admin = self._register("admin_user")
        response = self.client.get("/api/audit/events", headers=self._headers(admin["accessToken"]))
        self.assertEqual(response.status_code, 200)
        self.assertIn("items", response.json())

    def test_admin_api_key_still_works_when_configured(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret=self.auth_secret,
            auth_required=False,
            admin_api_key="secret-admin",
        )
        client = TestClient(app)
        denied = client.get("/api/audit/events")
        self.assertEqual(denied.status_code, 403)
        allowed = client.get("/api/audit/events", headers={"x-admin-api-key": "secret-admin"})
        self.assertEqual(allowed.status_code, 200)
        client.close()

    def test_cannot_demote_last_admin(self) -> None:
        admin = self._register("solo_admin")
        response = self.client.patch(
            f"/api/auth/users/{admin['user']['id']}/role",
            headers=self._headers(admin["accessToken"]),
            json={"role": "analyst"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("last admin", response.json()["error"]["message"])


if __name__ == "__main__":
    unittest.main()
