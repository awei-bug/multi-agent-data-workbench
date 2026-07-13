from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.oidc import create_pkce_pair, normalize_oidc_profile
from backend_py.repository import create_repository, set_workspace_scope


class OidcAndShareTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret="unit-auth-secret-for-oidc-tests-123456",
            credentials_secret="unit-credentials-secret-for-oidc-tests",
            auth_required=True,
            oidc_enabled=True,
            oidc_issuer="https://issuer.example",
            oidc_client_id="workbench",
            oidc_client_secret="secret",
            oidc_redirect_uri="http://127.0.0.1:8787/api/auth/oidc/callback",
            oidc_scopes="openid profile email",
            oidc_authorize_url="https://issuer.example/oauth/authorize",
            oidc_token_url="https://issuer.example/oauth/token",
            oidc_userinfo_url="https://issuer.example/oauth/userinfo",
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        runner = getattr(self.app.state, "workflow_runner", None)
        if runner is not None:
            runner.shutdown(wait=False)
        self.client.close()
        self.temp_dir.cleanup()

    def _register(self, username: str, password: str = "password123", tenant: str = "tenant-sso") -> dict:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": username,
                "password": password,
                "tenantId": tenant,
                "displayName": username,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_oidc_status_and_login_url(self) -> None:
        status = self.client.get("/api/auth/oidc/status")
        self.assertEqual(status.status_code, 200)
        self.assertTrue(status.json()["enabled"])
        login = self.client.get("/api/auth/oidc/login")
        self.assertEqual(login.status_code, 200)
        payload = login.json()
        self.assertIn("authorizeUrl", payload)
        self.assertIn("state", payload)
        self.assertIn("https://issuer.example/oauth/authorize", payload["authorizeUrl"])

    def test_oidc_callback_creates_user(self) -> None:
        login = self.client.get("/api/auth/oidc/login").json()
        state = login["state"]
        with patch("backend_py.app.exchange_code_for_tokens", return_value={"access_token": "idp-token"}):
            with patch(
                "backend_py.app.fetch_userinfo",
                return_value={
                    "sub": "oidc-sub-1",
                    "preferred_username": "sso-user",
                    "email": "sso@example.com",
                    "name": "SSO User",
                },
            ):
                callback = self.client.get(f"/api/auth/oidc/callback?code=abc&state={state}")
        self.assertEqual(callback.status_code, 200, callback.text)
        body = callback.json()
        self.assertIn("accessToken", body)
        self.assertEqual(body["user"]["username"], "sso-user")

        me = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['accessToken']}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["user"]["username"], "sso-user")

    def test_share_task_and_dataset_to_org(self) -> None:
        owner = self._register("owner-share")
        member = self._register("member-share")
        owner_headers = {"Authorization": f"Bearer {owner['accessToken']}"}
        member_headers = {"Authorization": f"Bearer {member['accessToken']}"}

        org = self.client.post(
            "/api/orgs",
            headers=owner_headers,
            json={"name": "共享组", "slug": "share-team"},
        ).json()["organization"]
        token = self.client.post(
            f"/api/orgs/{org['id']}/invites",
            headers=owner_headers,
            json={"username": "member-share", "role": "member"},
        ).json()["invite"]["token"]
        accepted = self.client.post(
            "/api/orgs/invites/accept",
            headers=member_headers,
            json={"token": token},
        )
        self.assertEqual(accepted.status_code, 200)

        # owner prepares active task + dataset
        uploaded = self.client.post(
            "/api/data-source/upload",
            headers=owner_headers,
            files={"file": ("sales.csv", b"region,sales\nEast,10\n", "text/csv")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        dataset_id = uploaded.json()["id"]
        bind = self.client.post(f"/api/tasks/active/dataset/{dataset_id}", headers=owner_headers)
        self.assertEqual(bind.status_code, 200)
        self.client.patch(
            "/api/active-task",
            headers=owner_headers,
            json={"name": "共享销售任务", "request": "分析区域销售", "summary": "组织共享任务"},
        )

        share_task = self.client.post(
            f"/api/orgs/{org['id']}/share/resource",
            headers=owner_headers,
            json={"resourceType": "task", "resourceId": "active", "permission": "read"},
        )
        self.assertEqual(share_task.status_code, 200, share_task.text)

        share_dataset = self.client.post(
            f"/api/orgs/{org['id']}/share/resource",
            headers=owner_headers,
            json={"resourceType": "dataset", "resourceId": dataset_id, "permission": "read"},
        )
        self.assertEqual(share_dataset.status_code, 200, share_dataset.text)

        shares = self.client.get(f"/api/orgs/{org['id']}/shares", headers=member_headers)
        self.assertEqual(shares.status_code, 200)
        types = {item["resourceType"] for item in shares.json()["items"]}
        self.assertIn("task", types)
        self.assertIn("dataset", types)

        # member can see shared dataset in dataset list
        datasets = self.client.get("/api/datasets", headers=member_headers)
        self.assertEqual(datasets.status_code, 200)
        dataset_ids = {item.get("id") for item in datasets.json()}
        self.assertIn(dataset_id, dataset_ids)

    def test_normalize_profile_helper(self) -> None:
        profile = normalize_oidc_profile(
            {"sub": "x", "email": "u@example.com", "name": "U"},
            default_tenant="tenant-x",
        )
        self.assertEqual(profile["subject"], "x")
        self.assertTrue(profile["username"])


if __name__ == "__main__":
    unittest.main()
