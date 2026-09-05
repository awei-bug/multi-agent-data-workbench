from __future__ import annotations

import json
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4


class UsersOrgsMixin:
    def _scope(self):
        from backend_py.repository import get_workspace_scope
        return get_workspace_scope()

    def create_user(
        self,
        *,
        username: str,
        password_hash: str,
        tenant_id: str,
        display_name: str,
        role: str = "analyst",
        user_id: str | None = None,
    ) -> dict:
        user = {
            "id": user_id or f"user-{uuid4().hex[:12]}",
            "username": username,
            "passwordHash": password_hash,
            "tenantId": tenant_id,
            "displayName": display_name,
            "role": role,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        with closing(self._connect()) as connection:
            try:
                connection.execute(
                    "INSERT INTO users(id, username, password_hash, tenant_id, display_name, role, created_at) "
                    f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                    f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                    (
                        user["id"],
                        user["username"],
                        user["passwordHash"],
                        user["tenantId"],
                        user["displayName"],
                        user["role"],
                        user["createdAt"],
                    ),
                )
                connection.commit()
            except Exception as error:
                message = str(error).lower()
                if "unique" in message or "duplicate" in message:
                    raise ValueError("该用户名已被注册，请换一个用户名") from error
                raise
        return user

    def get_user_by_username(self, username: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT id, username, password_hash, tenant_id, display_name, role, created_at "
                f"FROM users WHERE username = {self._placeholder()}",
                (username,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "username": row[1],
            "passwordHash": row[2],
            "tenantId": row[3],
            "displayName": row[4],
            "role": row[5],
            "createdAt": row[6],
        }

    def get_user_by_id(self, user_id: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT id, username, password_hash, tenant_id, display_name, role, created_at "
                f"FROM users WHERE id = {self._placeholder()}",
                (user_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "username": row[1],
            "passwordHash": row[2],
            "tenantId": row[3],
            "displayName": row[4],
            "role": row[5],
            "createdAt": row[6],
        }

    def count_users(self) -> int:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT COUNT(*) FROM users").fetchone()
        return int(row[0] if row else 0)

    def list_users(self, tenant_id: str | None = None) -> list[dict]:
        with closing(self._connect()) as connection:
            if tenant_id:
                rows = connection.execute(
                    "SELECT id, username, tenant_id, display_name, role, created_at "
                    f"FROM users WHERE tenant_id = {self._placeholder()} ORDER BY created_at ASC",
                    (tenant_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT id, username, tenant_id, display_name, role, created_at "
                    "FROM users ORDER BY created_at ASC"
                ).fetchall()
        return [
            {
                "id": row[0],
                "username": row[1],
                "tenantId": row[2],
                "displayName": row[3],
                "role": row[4],
                "createdAt": row[5],
            }
            for row in rows
        ]

    def update_user_role(self, user_id: str, role: str) -> dict | None:
        user = self.get_user_by_id(user_id)
        if not user:
            return None
        with closing(self._connect()) as connection:
            connection.execute(
                f"UPDATE users SET role = {self._placeholder()} WHERE id = {self._placeholder()}",
                (role, user_id),
            )
            connection.commit()
        user["role"] = role
        return user

    # ---- Organizations / collaboration ----

    def _org_row_to_dict(self, row) -> dict:
        return {
            "id": row[0],
            "tenantId": row[1],
            "name": row[2],
            "slug": row[3],
            "ownerUserId": row[4],
            "createdAt": row[5],
        }

    def create_organization(self, *, name: str, slug: str, owner_user_id: str, tenant_id: str | None = None) -> dict:
        tenant = tenant_id or self._scope()[0]
        org = {
            "id": f"org-{uuid4().hex[:12]}",
            "tenantId": tenant,
            "name": name.strip(),
            "slug": slug.strip().lower(),
            "ownerUserId": owner_user_id,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        member_id = f"om-{uuid4().hex[:12]}"
        joined_at = org["createdAt"]
        with closing(self._connect()) as connection:
            try:
                connection.execute(
                    "INSERT INTO organizations(id, tenant_id, name, slug, owner_user_id, created_at) "
                    f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                    f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                    (org["id"], org["tenantId"], org["name"], org["slug"], org["ownerUserId"], org["createdAt"]),
                )
                connection.execute(
                    "INSERT INTO organization_members(id, org_id, user_id, role, status, joined_at) "
                    f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                    f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                    (member_id, org["id"], owner_user_id, "owner", "active", joined_at),
                )
                connection.commit()
            except Exception as error:
                message = str(error).lower()
                if "unique" in message or "duplicate" in message:
                    raise ValueError("organization slug already exists in tenant") from error
                raise
        return org

    def get_organization(self, org_id: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT id, tenant_id, name, slug, owner_user_id, created_at "
                f"FROM organizations WHERE id = {self._placeholder()}",
                (org_id,),
            ).fetchone()
        return self._org_row_to_dict(row) if row else None

    def list_organizations_for_user(self, user_id: str, tenant_id: str | None = None) -> list[dict]:
        tenant = tenant_id or self._scope()[0]
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT o.id, o.tenant_id, o.name, o.slug, o.owner_user_id, o.created_at, m.role "
                "FROM organizations o "
                "JOIN organization_members m ON m.org_id = o.id "
                f"WHERE m.user_id = {self._placeholder()} AND m.status = {self._placeholder()} "
                f"AND o.tenant_id = {self._placeholder()} "
                "ORDER BY o.created_at ASC",
                (user_id, "active", tenant),
            ).fetchall()
        items = []
        for row in rows:
            item = self._org_row_to_dict(row[:6])
            item["memberRole"] = row[6]
            items.append(item)
        return items

    def list_organization_members(self, org_id: str) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT m.id, m.org_id, m.user_id, m.role, m.status, m.joined_at, "
                "u.username, u.display_name "
                "FROM organization_members m "
                f"LEFT JOIN users u ON u.id = m.user_id "
                f"WHERE m.org_id = {self._placeholder()} "
                "ORDER BY m.joined_at ASC",
                (org_id,),
            ).fetchall()
        return [
            {
                "id": row[0],
                "orgId": row[1],
                "userId": row[2],
                "role": row[3],
                "status": row[4],
                "joinedAt": row[5],
                "username": row[6] or row[2],
                "displayName": row[7] or row[6] or row[2],
            }
            for row in rows
        ]

    def get_organization_member(self, org_id: str, user_id: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT id, org_id, user_id, role, status, joined_at "
                f"FROM organization_members WHERE org_id = {self._placeholder()} AND user_id = {self._placeholder()}",
                (org_id, user_id),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "orgId": row[1],
            "userId": row[2],
            "role": row[3],
            "status": row[4],
            "joinedAt": row[5],
        }

    def update_organization_member_role(self, org_id: str, user_id: str, role: str) -> dict | None:
        member = self.get_organization_member(org_id, user_id)
        if not member:
            return None
        with closing(self._connect()) as connection:
            connection.execute(
                f"UPDATE organization_members SET role = {self._placeholder()} "
                f"WHERE org_id = {self._placeholder()} AND user_id = {self._placeholder()}",
                (role, org_id, user_id),
            )
            connection.commit()
        member["role"] = role
        return member

    def remove_organization_member(self, org_id: str, user_id: str) -> bool:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                f"DELETE FROM organization_members WHERE org_id = {self._placeholder()} AND user_id = {self._placeholder()}",
                (org_id, user_id),
            )
            connection.commit()
            return bool(getattr(cursor, "rowcount", 0))

    def create_organization_invite(
        self,
        *,
        org_id: str,
        username: str,
        role: str,
        created_by: str,
        expires_hours: int = 72,
    ) -> dict:
        from datetime import timedelta

        now = datetime.now(timezone.utc)
        invite = {
            "id": f"oi-{uuid4().hex[:12]}",
            "orgId": org_id,
            "username": username.strip().lower(),
            "role": role,
            "token": uuid4().hex,
            "status": "pending",
            "createdBy": created_by,
            "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(hours=expires_hours)).isoformat(),
        }
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO organization_invites(id, org_id, username, role, token, status, created_by, created_at, expires_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                (
                    invite["id"],
                    invite["orgId"],
                    invite["username"],
                    invite["role"],
                    invite["token"],
                    invite["status"],
                    invite["createdBy"],
                    invite["createdAt"],
                    invite["expiresAt"],
                ),
            )
            connection.commit()
        return invite

    def list_organization_invites(self, org_id: str) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT id, org_id, username, role, token, status, created_by, created_at, expires_at "
                f"FROM organization_invites WHERE org_id = {self._placeholder()} ORDER BY created_at DESC",
                (org_id,),
            ).fetchall()
        return [
            {
                "id": row[0],
                "orgId": row[1],
                "username": row[2],
                "role": row[3],
                "token": row[4],
                "status": row[5],
                "createdBy": row[6],
                "createdAt": row[7],
                "expiresAt": row[8],
            }
            for row in rows
        ]

    def get_invite_by_token(self, token: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT id, org_id, username, role, token, status, created_by, created_at, expires_at "
                f"FROM organization_invites WHERE token = {self._placeholder()}",
                (token,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "orgId": row[1],
            "username": row[2],
            "role": row[3],
            "token": row[4],
            "status": row[5],
            "createdBy": row[6],
            "createdAt": row[7],
            "expiresAt": row[8],
        }

    def accept_organization_invite(self, *, token: str, user_id: str, username: str) -> dict:
        invite = self.get_invite_by_token(token)
        if not invite:
            raise ValueError("invite not found")
        if invite["status"] != "pending":
            raise ValueError("invite is not pending")
        if invite["username"] != username.strip().lower():
            raise ValueError("invite username mismatch")
        expires_at = invite["expiresAt"]
        if expires_at and expires_at < datetime.now(timezone.utc).isoformat():
            raise ValueError("invite expired")
        existing = self.get_organization_member(invite["orgId"], user_id)
        if existing and existing.get("status") == "active":
            # mark invite accepted anyway
            with closing(self._connect()) as connection:
                connection.execute(
                    f"UPDATE organization_invites SET status = {self._placeholder()} WHERE id = {self._placeholder()}",
                    ("accepted", invite["id"]),
                )
                connection.commit()
            return existing

        member = {
            "id": f"om-{uuid4().hex[:12]}",
            "orgId": invite["orgId"],
            "userId": user_id,
            "role": invite["role"] if invite["role"] in {"admin", "member", "viewer"} else "member",
            "status": "active",
            "joinedAt": datetime.now(timezone.utc).isoformat(),
        }
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO organization_members(id, org_id, user_id, role, status, joined_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                (member["id"], member["orgId"], member["userId"], member["role"], member["status"], member["joinedAt"]),
            )
            connection.execute(
                f"UPDATE organization_invites SET status = {self._placeholder()} WHERE id = {self._placeholder()}",
                ("accepted", invite["id"]),
            )
            connection.commit()
        return member

    def list_org_member_user_ids(self, org_id: str) -> list[str]:
        members = self.list_organization_members(org_id)
        return [item["userId"] for item in members if item.get("status") == "active"]

    def share_template_to_org(self, *, org_id: str, template: dict) -> dict:
        """Save a copy of template as organization-shared resource."""
        tenant_id, _ = self._scope()
        shared = deepcopy(template)
        shared["id"] = f"org-template-{uuid4().hex[:10]}"
        shared["source"] = "organization"
        shared["orgId"] = org_id
        shared["tag"] = shared.get("tag") or "组织共享"
        shared["tenantId"] = tenant_id
        shared["ownerId"] = f"__org__:{org_id}"
        with closing(self._connect()) as connection:
            connection.execute(
                self._upsert_scoped_payload_sql("templates"),
                (
                    shared["id"],
                    tenant_id,
                    shared["ownerId"],
                    json.dumps(shared, ensure_ascii=False),
                ),
            )
            connection.commit()
        return shared

    def list_org_templates(self, org_ids: list[str]) -> list[dict]:
        if not org_ids:
            return []
        tenant_id, _ = self._scope()
        owners = [f"__org__:{org_id}" for org_id in org_ids]
        placeholder = self._placeholder()
        clauses = ", ".join(placeholder for _ in owners)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"SELECT payload FROM templates WHERE tenant_id = {placeholder} AND owner_id IN ({clauses})",
                (tenant_id, *owners),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]



    # ---- Structured resources + org shares + OIDC identities ----

    def upsert_resource_task(self, task: dict, *, org_id: str | None = None) -> dict:
        tenant_id, owner_id = self._scope()
        now = datetime.now(timezone.utc).isoformat()
        payload = deepcopy(task)
        task_id = str(payload.get("id") or f"task-{uuid4().hex[:12]}")
        payload["id"] = task_id
        conflict = (
            "ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, mode=EXCLUDED.mode, "
            "summary=EXCLUDED.summary, request=EXCLUDED.request, payload=EXCLUDED.payload, "
            "org_id=EXCLUDED.org_id, updated_at=EXCLUDED.updated_at"
            if self.use_postgres
            else "ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, mode=excluded.mode, "
            "summary=excluded.summary, request=excluded.request, payload=excluded.payload, "
            "org_id=excluded.org_id, updated_at=excluded.updated_at"
        )
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO resource_tasks(id, tenant_id, owner_id, org_id, name, status, mode, summary, request, payload, created_at, updated_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}) "
                + conflict,
                (
                    task_id,
                    tenant_id,
                    owner_id,
                    org_id,
                    str(payload.get("name") or "未命名任务"),
                    str(payload.get("status") or "未知"),
                    str(payload.get("mode") or "live"),
                    str(payload.get("summary") or ""),
                    str(payload.get("request") or ""),
                    json.dumps(payload, ensure_ascii=False),
                    str(payload.get("createdAt") or now),
                    now,
                ),
            )
            connection.commit()
        return payload

    def upsert_resource_dataset(self, dataset: dict, *, org_id: str | None = None) -> dict:
        tenant_id, owner_id = self._scope()
        now = datetime.now(timezone.utc).isoformat()
        payload = deepcopy(dataset)
        dataset_id = str(payload.get("id") or f"dataset-{uuid4().hex[:12]}")
        payload["id"] = dataset_id
        conflict = (
            "ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind, row_count=EXCLUDED.row_count, "
            "column_count=EXCLUDED.column_count, storage_key=EXCLUDED.storage_key, payload=EXCLUDED.payload, "
            "org_id=EXCLUDED.org_id, updated_at=EXCLUDED.updated_at"
            if self.use_postgres
            else "ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, row_count=excluded.row_count, "
            "column_count=excluded.column_count, storage_key=excluded.storage_key, payload=excluded.payload, "
            "org_id=excluded.org_id, updated_at=excluded.updated_at"
        )
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO resource_datasets(id, tenant_id, owner_id, org_id, name, kind, row_count, column_count, storage_key, payload, created_at, updated_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}) "
                + conflict,
                (
                    dataset_id,
                    tenant_id,
                    owner_id,
                    org_id,
                    str(payload.get("name") or payload.get("fileName") or "dataset"),
                    str(payload.get("kind") or "table"),
                    int(payload.get("rowCount") or 0),
                    int(payload.get("columnCount") or 0),
                    payload.get("storageKey"),
                    json.dumps(payload, ensure_ascii=False),
                    str(payload.get("uploadedAt") or now),
                    now,
                ),
            )
            connection.commit()
        return payload

    def upsert_resource_artifact(self, artifact: dict, *, task_id: str | None = None) -> dict:
        tenant_id, owner_id = self._scope()
        now = datetime.now(timezone.utc).isoformat()
        payload = deepcopy(artifact)
        artifact_id = str(payload.get("id") or f"artifact-{uuid4().hex[:12]}")
        payload["id"] = artifact_id
        conflict = (
            "ON CONFLICT(id) DO UPDATE SET artifact_type=EXCLUDED.artifact_type, storage_key=EXCLUDED.storage_key, "
            "payload=EXCLUDED.payload, task_id=EXCLUDED.task_id"
            if self.use_postgres
            else "ON CONFLICT(id) DO UPDATE SET artifact_type=excluded.artifact_type, storage_key=excluded.storage_key, "
            "payload=excluded.payload, task_id=excluded.task_id"
        )
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO resource_artifacts(id, tenant_id, owner_id, task_id, artifact_type, storage_key, payload, created_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}) "
                + conflict,
                (
                    artifact_id,
                    tenant_id,
                    owner_id,
                    task_id or payload.get("taskId"),
                    str(payload.get("type") or "unknown"),
                    payload.get("storageKey"),
                    json.dumps(payload, ensure_ascii=False),
                    str(payload.get("createdAt") or now),
                ),
            )
            connection.commit()
        return payload

    def create_org_share(
        self,
        *,
        org_id: str,
        resource_type: str,
        resource_id: str,
        shared_by: str,
        permission: str = "read",
        payload: dict | None = None,
    ) -> dict:
        tenant_id, _ = self._scope()
        share = {
            "id": f"share-{uuid4().hex[:12]}",
            "orgId": org_id,
            "tenantId": tenant_id,
            "resourceType": resource_type,
            "resourceId": resource_id,
            "sharedBy": shared_by,
            "permission": permission,
            "payload": payload or {},
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        with closing(self._connect()) as connection:
            connection.execute(
                f"DELETE FROM org_shares WHERE org_id = {self._placeholder()} AND resource_type = {self._placeholder()} "
                f"AND resource_id = {self._placeholder()}",
                (org_id, resource_type, resource_id),
            )
            connection.execute(
                "INSERT INTO org_shares(id, org_id, tenant_id, resource_type, resource_id, shared_by, permission, payload, created_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                (
                    share["id"],
                    share["orgId"],
                    share["tenantId"],
                    share["resourceType"],
                    share["resourceId"],
                    share["sharedBy"],
                    share["permission"],
                    json.dumps(share["payload"], ensure_ascii=False),
                    share["createdAt"],
                ),
            )
            connection.commit()
        return share

    def list_org_shares(self, org_id: str, resource_type: str | None = None) -> list[dict]:
        with closing(self._connect()) as connection:
            if resource_type:
                rows = connection.execute(
                    "SELECT id, org_id, tenant_id, resource_type, resource_id, shared_by, permission, payload, created_at "
                    f"FROM org_shares WHERE org_id = {self._placeholder()} AND resource_type = {self._placeholder()} "
                    "ORDER BY created_at DESC",
                    (org_id, resource_type),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT id, org_id, tenant_id, resource_type, resource_id, shared_by, permission, payload, created_at "
                    f"FROM org_shares WHERE org_id = {self._placeholder()} ORDER BY created_at DESC",
                    (org_id,),
                ).fetchall()
        items = []
        for row in rows:
            try:
                payload = json.loads(row[7] or "{}")
            except Exception:
                payload = {}
            items.append(
                {
                    "id": row[0],
                    "orgId": row[1],
                    "tenantId": row[2],
                    "resourceType": row[3],
                    "resourceId": row[4],
                    "sharedBy": row[5],
                    "permission": row[6],
                    "payload": payload,
                    "createdAt": row[8],
                }
            )
        return items

    def list_shared_resources_for_user(self, user_id: str, resource_type: str) -> list[dict]:
        tenant_id, _ = self._scope()
        org_ids = [item["id"] for item in self.list_organizations_for_user(user_id, tenant_id)]
        if not org_ids:
            return []
        result = []
        for org_id in org_ids:
            for share in self.list_org_shares(org_id, resource_type=resource_type):
                item = deepcopy(share.get("payload") or {})
                item["id"] = share["resourceId"]
                item["shared"] = True
                item["orgId"] = org_id
                item["sharePermission"] = share.get("permission") or "read"
                result.append(item)
        return result

    def link_oidc_identity(
        self,
        *,
        user_id: str,
        issuer: str,
        subject: str,
        email: str | None = None,
    ) -> dict:
        identity = {
            "id": f"oidc-{uuid4().hex[:12]}",
            "userId": user_id,
            "issuer": issuer,
            "subject": subject,
            "email": email or "",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        with closing(self._connect()) as connection:
            existing = connection.execute(
                f"SELECT id, user_id FROM oidc_identities WHERE issuer = {self._placeholder()} AND subject = {self._placeholder()}",
                (issuer, subject),
            ).fetchone()
            if existing:
                return {
                    "id": existing[0],
                    "userId": existing[1],
                    "issuer": issuer,
                    "subject": subject,
                    "email": email or "",
                }
            connection.execute(
                "INSERT INTO oidc_identities(id, user_id, issuer, subject, email, created_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, {self._placeholder()}, {self._placeholder()})",
                (
                    identity["id"],
                    identity["userId"],
                    identity["issuer"],
                    identity["subject"],
                    identity["email"],
                    identity["createdAt"],
                ),
            )
            connection.commit()
        return identity

    def get_user_by_oidc(self, *, issuer: str, subject: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT user_id FROM oidc_identities "
                f"WHERE issuer = {self._placeholder()} AND subject = {self._placeholder()}",
                (issuer, subject),
            ).fetchone()
        if not row:
            return None
        return self.get_user_by_id(str(row[0]))



    def create_password_reset_token(self, *, user_id: str, username: str, ttl_minutes: int = 30) -> dict:
        import secrets
        from contextlib import closing
        from datetime import datetime, timedelta, timezone

        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(minutes=max(5, ttl_minutes))).isoformat()
        created_at = now.isoformat()
        with closing(self._connect()) as connection:
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE user_id = " + self._placeholder(),
                (user_id,),
            )
            connection.execute(
                "INSERT INTO password_reset_tokens(token, user_id, username, expires_at, used_at, created_at) "
                f"VALUES({self._placeholder()}, {self._placeholder()}, {self._placeholder()}, "
                f"{self._placeholder()}, NULL, {self._placeholder()})",
                (token, user_id, username, expires_at, created_at),
            )
            connection.commit()
        return {"token": token, "userId": user_id, "username": username, "expiresAt": expires_at}

    def consume_password_reset_token(self, token: str) -> dict | None:
        from contextlib import closing
        from datetime import datetime, timezone

        token = (token or "").strip()
        if not token:
            return None
        now = datetime.now(timezone.utc).isoformat()
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT token, user_id, username, expires_at, used_at FROM password_reset_tokens "
                f"WHERE token = {self._placeholder()}",
                (token,),
            ).fetchone()
            if not row:
                return None
            token_v, user_id, username, expires_at, used_at = row
            if used_at:
                return None
            if str(expires_at) < now:
                return None
            connection.execute(
                "UPDATE password_reset_tokens SET used_at = " + self._placeholder() +
                f" WHERE token = {self._placeholder()}",
                (now, token_v),
            )
            connection.commit()
        return {"token": token_v, "userId": str(user_id), "username": str(username)}

    def update_user_password(self, user_id: str, password_hash: str) -> bool:
        from contextlib import closing

        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE users SET password_hash = " + self._placeholder() +
                f" WHERE id = {self._placeholder()}",
                (password_hash, user_id),
            )
            connection.commit()
            return bool(getattr(cursor, "rowcount", 1))
