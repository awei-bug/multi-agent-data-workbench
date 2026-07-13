from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.repository import create_repository, set_workspace_scope


class OrganizationCollaborationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            auth_secret="unit-auth-secret-for-org-tests-123456",
            credentials_secret="unit-credentials-secret-for-org-tests",
            auth_required=True,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        runner = getattr(self.app.state, "workflow_runner", None)
        if runner is not None:
            runner.shutdown(wait=False)
        self.client.close()
        self.temp_dir.cleanup()

    def _register(self, username: str, password: str = "password123", tenant: str = "tenant-org") -> dict:
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

    def test_org_create_invite_accept_and_share_template(self) -> None:
        owner = self._register("owner-a")
        member = self._register("member-b")

        owner_headers = {"Authorization": f"Bearer {owner['accessToken']}"}
        member_headers = {"Authorization": f"Bearer {member['accessToken']}"}

        created = self.client.post(
            "/api/orgs",
            headers=owner_headers,
            json={"name": "华东分析组", "slug": "east-analytics"},
        )
        self.assertEqual(created.status_code, 200, created.text)
        org = created.json()["organization"]
        self.assertEqual(org["slug"], "east-analytics")

        listed = self.client.get("/api/orgs", headers=owner_headers)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 1)

        invite = self.client.post(
            f"/api/orgs/{org['id']}/invites",
            headers=owner_headers,
            json={"username": "member-b", "role": "member"},
        )
        self.assertEqual(invite.status_code, 200, invite.text)
        token = invite.json()["invite"]["token"]
        self.assertTrue(token)

        # member not yet in org
        member_list_before = self.client.get("/api/orgs", headers=member_headers).json()["items"]
        self.assertEqual(member_list_before, [])

        accepted = self.client.post(
            "/api/orgs/invites/accept",
            headers=member_headers,
            json={"token": token},
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["member"]["status"], "active")

        member_list_after = self.client.get("/api/orgs", headers=member_headers).json()["items"]
        self.assertEqual(len(member_list_after), 1)
        self.assertEqual(member_list_after[0]["id"], org["id"])

        detail = self.client.get(f"/api/orgs/{org['id']}", headers=member_headers)
        self.assertEqual(detail.status_code, 200)
        self.assertGreaterEqual(len(detail.json()["members"]), 2)

        # owner shares active task as org template
        shared = self.client.post(
            f"/api/orgs/{org['id']}/share/template",
            headers=owner_headers,
            json={},
        )
        self.assertEqual(shared.status_code, 200, shared.text)
        template = shared.json()["template"]
        self.assertEqual(template["source"], "organization")
        self.assertEqual(template["orgId"], org["id"])

        # member can see org shared template
        templates = self.client.get("/api/templates", headers=member_headers)
        self.assertEqual(templates.status_code, 200)
        ids = {item.get("id") for item in templates.json()}
        self.assertIn(template["id"], ids)

    def test_non_manager_cannot_invite(self) -> None:
        owner = self._register("owner-c")
        member = self._register("member-d")
        owner_headers = {"Authorization": f"Bearer {owner['accessToken']}"}
        member_headers = {"Authorization": f"Bearer {member['accessToken']}"}

        org = self.client.post(
            "/api/orgs",
            headers=owner_headers,
            json={"name": "华南组", "slug": "south"},
        ).json()["organization"]
        token = self.client.post(
            f"/api/orgs/{org['id']}/invites",
            headers=owner_headers,
            json={"username": "member-d", "role": "member"},
        ).json()["invite"]["token"]
        self.client.post("/api/orgs/invites/accept", headers=member_headers, json={"token": token})

        denied = self.client.post(
            f"/api/orgs/{org['id']}/invites",
            headers=member_headers,
            json={"username": "someone", "role": "viewer"},
        )
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
