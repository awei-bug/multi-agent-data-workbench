from __future__ import annotations

import json
import sqlite3
import threading
from contextvars import ContextVar, Token
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from backend_py.workflow_service import (
    advance_workflow_with_model,
    apply_workflow_action as run_workflow_action,
    create_execution_log_entry,
)

_workspace_scope: ContextVar[tuple[str, str]] = ContextVar("workspace_scope", default=("local-tenant", "local-user"))


def set_workspace_scope(tenant_id: str, owner_id: str) -> Token:
    return _workspace_scope.set((tenant_id, owner_id))


def reset_workspace_scope(token: Token) -> None:
    _workspace_scope.reset(token)


def get_workspace_scope() -> tuple[str, str]:
    return _workspace_scope.get()


def _make_idle_snapshot() -> dict:
    return {
        "phase": "idle",
        "logMessage": "等待启动",
        "nodes": [
            {"id": "source", "label": "数据接入 Agent", "status": "pending"},
            {"id": "clean", "label": "数据清洗 Agent", "status": "pending"},
            {"id": "metric", "label": "指标计算 Agent", "status": "pending"},
            {"id": "chart", "label": "可视化 Agent", "status": "pending"},
            {"id": "analysis", "label": "洞察分析 Agent", "status": "pending"},
            {"id": "report", "label": "报告生成 Agent", "status": "pending"},
            {"id": "audit", "label": "审核校验 Agent", "status": "pending"},
        ],
        "context": {
            "activeAgent": "等待启动",
            "inputSummary": "当前还没有载入任务输入。",
            "outputSummary": "当前还没有中间产出。",
            "latestLog": "系统空闲。",
            "risks": ["字段映射尚未确认。"],
        },
    }


def _make_done_snapshot() -> dict:
    snapshot = _make_idle_snapshot()
    snapshot["phase"] = "done"
    snapshot["logMessage"] = "审核校验 Agent 已完成"
    snapshot["nodes"] = [{**node, "status": "success"} for node in snapshot["nodes"]]
    snapshot["context"] = {
        "activeAgent": "审核校验 Agent",
        "inputSummary": "销售分析输入已载入。",
        "outputSummary": "分析摘要和图表已生成。",
        "latestLog": "流程已完成。",
        "risks": ["缺失销售额已按人工确认规则处理。"],
    }
    return snapshot


def _make_running_snapshot() -> dict:
    snapshot = _make_idle_snapshot()
    snapshot["phase"] = "running"
    snapshot["logMessage"] = "洞察分析 Agent 执行中"
    snapshot["nodes"] = [
        {**node, "status": "success" if index < 4 else ("running" if index == 4 else "pending")}
        for index, node in enumerate(snapshot["nodes"])
    ]
    snapshot["context"] = {
        "activeAgent": "洞察分析 Agent",
        "inputSummary": "数据清洗和指标计算已完成。",
        "outputSummary": "正在生成归因分析结论。",
        "latestLog": "洞察分析 Agent 正在处理。",
        "risks": ["六月活动备注仍未补齐。"],
    }
    return snapshot


def _default_execution_log() -> list[dict]:
    return [create_execution_log_entry("system", "任务已初始化")]


def _default_active_task(request: str = "尚未填写分析需求。") -> dict:
    return {
        "id": "workspace-active-session",
        "name": "当前工作台会话",
        "mode": "live",
        "status": "等待启动",
        "time": "今天 15:00",
        "summary": "当前会话尚未开始。",
        "request": request,
        "snapshot": _make_idle_snapshot(),
        "exports": [],
        "risks": ["字段映射尚未确认。"],
        "executionLog": _default_execution_log(),
    }


def _seed_recent_tasks() -> list[dict]:
    return [
        {
            "id": "east-china-sales-report",
            "name": "华东销售月报",
            "mode": "live",
            "status": "已导出 Word / PDF",
            "time": "今天 14:20",
            "summary": "已生成趋势图、异常说明和管理摘要。",
            "request": "分析 2025 年月度销售趋势并输出管理摘要",
            "snapshot": _make_done_snapshot(),
            "exports": [
                {"format": "Markdown", "status": "Markdown 导出完成"},
                {"format": "Word", "status": "Word 导出完成"},
                {"format": "PDF", "status": "PDF 导出完成"},
            ],
            "risks": ["缺失销售额已按人工确认规则处理。"],
            "executionLog": [
                create_execution_log_entry("system", "任务已初始化"),
                create_execution_log_entry("action", "启动"),
                create_execution_log_entry("advance", "流程推进到审核校验"),
                create_execution_log_entry("export", "PDF 导出完成"),
            ],
        },
        {
            "id": "channel-roi-retro",
            "name": "渠道投放复盘",
            "mode": "live",
            "status": "等待人工复核",
            "time": "今天 11:05",
            "summary": "数据清洗和归因拆解已完成，等待补充备注。",
            "request": "复盘渠道 ROI 异常并准备周会材料",
            "snapshot": _make_running_snapshot(),
            "exports": [{"format": "Markdown", "status": "Markdown 草稿已生成"}],
            "risks": ["六月活动备注仍未补齐。"],
            "executionLog": [
                create_execution_log_entry("system", "任务已初始化"),
                create_execution_log_entry("action", "启动"),
                create_execution_log_entry("advance", "流程推进到洞察分析"),
            ],
        },
    ]


def _seed_templates() -> list[dict]:
    return [
        {
            "id": "template-business-retro",
            "name": "经营复盘模板",
            "tag": "推荐",
            "description": "适合月度复盘和管理汇报场景。",
            "request": "分析 2025 年月度销售趋势并输出管理摘要",
            "summary": "复用经营复盘模板并加载示例数据后启动流程。",
            "source": "system",
        },
        {
            "id": "template-anomaly-retro",
            "name": "异常波动排查模板",
            "tag": "排障",
            "description": "适合异常追踪和风险备注场景。",
            "request": "复盘渠道 ROI 异常并准备周会材料",
            "summary": "复用异常波动排查模板并加载示例数据后启动流程。",
            "source": "system",
        },
    ]


def _is_postgres_dsn(value: str | None) -> bool:
    if not value:
        return False
    return urlparse(value).scheme in {"postgres", "postgresql"}


class TaskRepository:
    def __init__(
        self,
        db_path: str | None = None,
        database_url: str | None = None,
        seed_demo_data: bool = True,
    ) -> None:
        self.database_url = database_url
        self.db_path = Path(db_path) if db_path else None
        self.use_postgres = _is_postgres_dsn(database_url)
        self._workflow_lock = threading.RLock()
        self._init_db()
        self._ensure_seed_data(seed_demo_data)

    def _connect(self):
        if self.use_postgres:
            try:
                import psycopg
            except ModuleNotFoundError as error:
                raise RuntimeError("psycopg is required for PostgreSQL support") from error
            return psycopg.connect(self.database_url)
        return sqlite3.connect(self.db_path or "workspace.sqlite3")

    def ping(self) -> dict:
        with closing(self._connect()) as connection:
            connection.execute("SELECT 1").fetchone()
        return {"ok": True, "type": "postgresql" if self.use_postgres else "sqlite"}

    def _placeholder(self) -> str:
        return "%s" if self.use_postgres else "?"

    def _upsert_sql(self, table: str, key_column: str) -> str:
        value_column = "value" if table == "kv_store" else "payload"
        if self.use_postgres:
            return (
                f"INSERT INTO {table}({key_column}, {value_column}) VALUES(%s, %s) "
                f"ON CONFLICT({key_column}) DO UPDATE SET {value_column} = EXCLUDED.{value_column}"
            )
        return (
            f"INSERT INTO {table}({key_column}, {value_column}) VALUES(?, ?) "
            f"ON CONFLICT({key_column}) DO UPDATE SET {value_column} = excluded.{value_column}"
        )

    def _upsert_scoped_payload_sql(self, table: str) -> str:
        if self.use_postgres:
            return (
                f"INSERT INTO {table}(id, tenant_id, owner_id, payload) VALUES(%s, %s, %s, %s) "
                "ON CONFLICT(id) DO UPDATE SET "
                "tenant_id = EXCLUDED.tenant_id, owner_id = EXCLUDED.owner_id, payload = EXCLUDED.payload"
            )
        return (
            f"INSERT INTO {table}(id, tenant_id, owner_id, payload) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "tenant_id = excluded.tenant_id, owner_id = excluded.owner_id, payload = excluded.payload"
        )

    def _init_db(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS history_tasks ("
                "id TEXT PRIMARY KEY, "
                "tenant_id TEXT NOT NULL DEFAULT 'local-tenant', "
                "owner_id TEXT NOT NULL DEFAULT 'local-user', "
                "payload TEXT NOT NULL"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS templates ("
                "id TEXT PRIMARY KEY, "
                "tenant_id TEXT NOT NULL DEFAULT 'local-tenant', "
                "owner_id TEXT NOT NULL DEFAULT '__system__', "
                "payload TEXT NOT NULL"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS audit_events ("
                "id TEXT PRIMARY KEY, "
                "action TEXT NOT NULL, "
                "target TEXT NOT NULL, "
                "payload TEXT NOT NULL, "
                "created_at TEXT NOT NULL, "
                "tenant_id TEXT NOT NULL DEFAULT 'local-tenant', "
                "owner_id TEXT NOT NULL DEFAULT 'local-user'"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS users ("
                "id TEXT PRIMARY KEY, "
                "username TEXT NOT NULL UNIQUE, "
                "password_hash TEXT NOT NULL, "
                "tenant_id TEXT NOT NULL, "
                "display_name TEXT NOT NULL, "
                "role TEXT NOT NULL, "
                "created_at TEXT NOT NULL"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS organizations ("
                "id TEXT PRIMARY KEY, "
                "tenant_id TEXT NOT NULL, "
                "name TEXT NOT NULL, "
                "slug TEXT NOT NULL, "
                "owner_user_id TEXT NOT NULL, "
                "created_at TEXT NOT NULL"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS organization_members ("
                "id TEXT PRIMARY KEY, "
                "org_id TEXT NOT NULL, "
                "user_id TEXT NOT NULL, "
                "role TEXT NOT NULL, "
                "status TEXT NOT NULL, "
                "joined_at TEXT NOT NULL"
                ")"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS organization_invites ("
                "id TEXT PRIMARY KEY, "
                "org_id TEXT NOT NULL, "
                "username TEXT NOT NULL, "
                "role TEXT NOT NULL, "
                "token TEXT NOT NULL UNIQUE, "
                "status TEXT NOT NULL, "
                "created_by TEXT NOT NULL, "
                "created_at TEXT NOT NULL, "
                "expires_at TEXT NOT NULL"
                ")"
            )
            
            connection.execute(
                "CREATE TABLE IF NOT EXISTS resource_tasks ("
                "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL, org_id TEXT, "
                "name TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'live', "
                "summary TEXT NOT NULL DEFAULT '', request TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, "
                "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS resource_datasets ("
                "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL, org_id TEXT, "
                "name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'table', row_count INTEGER NOT NULL DEFAULT 0, "
                "column_count INTEGER NOT NULL DEFAULT 0, storage_key TEXT, payload TEXT NOT NULL, "
                "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS resource_artifacts ("
                "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL, task_id TEXT, "
                "artifact_type TEXT NOT NULL, storage_key TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS org_shares ("
                "id TEXT PRIMARY KEY, org_id TEXT NOT NULL, tenant_id TEXT NOT NULL, resource_type TEXT NOT NULL, "
                "resource_id TEXT NOT NULL, shared_by TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'read', "
                "payload TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS oidc_identities ("
                "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL, "
                "email TEXT, created_at TEXT NOT NULL)"
            )

            self._ensure_scope_columns(connection)
            connection.commit()

    def _table_columns(self, connection, table: str) -> set[str]:
        if self.use_postgres:
            rows = connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = %s",
                (table,),
            ).fetchall()
            return {str(row[0]) for row in rows}
        rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
        # sqlite pragma: (cid, name, type, notnull, dflt_value, pk)
        return {str(row[1]) for row in rows}

    def _ensure_scope_columns(self, connection) -> None:
        history_columns = self._table_columns(connection, "history_tasks")
        if "tenant_id" not in history_columns:
            connection.execute("ALTER TABLE history_tasks ADD COLUMN tenant_id TEXT")
        if "owner_id" not in history_columns:
            connection.execute("ALTER TABLE history_tasks ADD COLUMN owner_id TEXT")

        template_columns = self._table_columns(connection, "templates")
        if "tenant_id" not in template_columns:
            connection.execute("ALTER TABLE templates ADD COLUMN tenant_id TEXT")
        if "owner_id" not in template_columns:
            connection.execute("ALTER TABLE templates ADD COLUMN owner_id TEXT")

        audit_columns = self._table_columns(connection, "audit_events")
        if "tenant_id" not in audit_columns:
            connection.execute("ALTER TABLE audit_events ADD COLUMN tenant_id TEXT")
        if "owner_id" not in audit_columns:
            connection.execute("ALTER TABLE audit_events ADD COLUMN owner_id TEXT")

        # Best-effort indexes for both SQLite bootstrap and Postgres runtime.
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_history_tasks_scope ON history_tasks(tenant_id, owner_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_templates_scope ON templates(tenant_id, owner_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_audit_events_scope_created ON audit_events(tenant_id, owner_id, created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_audit_events_action ON audit_events(action)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_users_tenant_id ON users(tenant_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_organizations_tenant_id ON organizations(tenant_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_organization_members_user_id ON organization_members(user_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_organization_members_org_id ON organization_members(org_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_organization_invites_org_id ON organization_invites(org_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_organization_invites_username ON organization_invites(username)"
        )

        # Backfill missing scope values from payload JSON when present.
        for table in ("history_tasks", "templates"):
            rows = connection.execute(f"SELECT id, payload, tenant_id, owner_id FROM {table}").fetchall()
            for row in rows:
                row_id, payload_raw, tenant_id, owner_id = row[0], row[1], row[2], row[3]
                if tenant_id and owner_id:
                    continue
                try:
                    payload = json.loads(payload_raw or "{}")
                except (TypeError, ValueError):
                    payload = {}
                next_tenant = tenant_id or payload.get("tenantId") or "local-tenant"
                next_owner = owner_id or payload.get("ownerId") or ("__system__" if table == "templates" else "local-user")
                connection.execute(
                    f"UPDATE {table} SET tenant_id = {self._placeholder()}, owner_id = {self._placeholder()} "
                    f"WHERE id = {self._placeholder()}",
                    (str(next_tenant), str(next_owner), row_id),
                )

        audit_rows = connection.execute(
            "SELECT id, payload, tenant_id, owner_id FROM audit_events"
        ).fetchall()
        for row in audit_rows:
            row_id, payload_raw, tenant_id, owner_id = row[0], row[1], row[2], row[3]
            if tenant_id and owner_id:
                continue
            try:
                payload = json.loads(payload_raw or "{}")
            except (TypeError, ValueError):
                payload = {}
            next_tenant = tenant_id or payload.get("tenantId") or "local-tenant"
            next_owner = owner_id or payload.get("ownerId") or "local-user"
            connection.execute(
                f"UPDATE audit_events SET tenant_id = {self._placeholder()}, owner_id = {self._placeholder()} "
                f"WHERE id = {self._placeholder()}",
                (str(next_tenant), str(next_owner), row_id),
            )

    def _get_json(self, key: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                f"SELECT value FROM kv_store WHERE key = {self._placeholder()}",
                (key,),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def _scoped_key(self, key: str) -> str:
        tenant_id, owner_id = get_workspace_scope()
        return f"{key}:{tenant_id}:{owner_id}"

    def _set_json(self, key: str, value: dict) -> None:
        with closing(self._connect()) as connection:
            connection.execute(self._upsert_sql("kv_store", "key"), (key, json.dumps(value, ensure_ascii=False)))
            connection.commit()

    def _scope_payload(self, payload: dict, include_owner: bool = True) -> dict:
        scoped = deepcopy(payload)
        tenant_id, owner_id = get_workspace_scope()
        scoped["tenantId"] = tenant_id
        if include_owner:
            scoped["ownerId"] = owner_id
        return scoped

    def _payload_row_id(self, identifier: str, include_owner: bool = True) -> str:
        tenant_id, owner_id = get_workspace_scope()
        if include_owner:
            return f"{tenant_id}:{owner_id}:{identifier}"
        return f"{tenant_id}:system:{identifier}"

    def _scope_slug(self) -> str:
        tenant_id, owner_id = get_workspace_scope()
        raw = f"{tenant_id}-{owner_id}"
        return "".join(character if character.isalnum() or character in {"-", "_"} else "-" for character in raw).strip("-") or "workspace"

    def _matches_scope(self, payload: dict, include_owner: bool = True) -> bool:
        tenant_id, owner_id = get_workspace_scope()
        if payload.get("tenantId") != tenant_id:
            return False
        if include_owner and payload.get("ownerId") != owner_id:
            return False
        return True

    def _list_payloads(self, table: str, include_owner: bool = True) -> list[dict]:
        tenant_id, owner_id = get_workspace_scope()
        placeholder = self._placeholder()
        with closing(self._connect()) as connection:
            if include_owner:
                rows = connection.execute(
                    f"SELECT payload FROM {table} "
                    f"WHERE tenant_id = {placeholder} AND owner_id = {placeholder}",
                    (tenant_id, owner_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    f"SELECT payload FROM {table} "
                    f"WHERE tenant_id = {placeholder} AND owner_id = {placeholder}",
                    (tenant_id, "__system__"),
                ).fetchall()
        payloads = [json.loads(row[0]) for row in rows]
        # Keep payload-level scope check as defense in depth for legacy rows.
        scoped = [payload for payload in payloads if self._matches_scope(payload, include_owner=include_owner)]
        return [self._normalize_task_payload(payload) for payload in scoped]

    def _save_payload(self, table: str, identifier: str, payload: dict, include_owner: bool = True) -> None:
        tenant_id, owner_id = get_workspace_scope()
        scoped_payload = self._scope_payload(payload, include_owner=include_owner)
        row_owner = owner_id if include_owner else "__system__"
        with closing(self._connect()) as connection:
            connection.execute(
                self._upsert_scoped_payload_sql(table),
                (
                    self._payload_row_id(identifier, include_owner=include_owner),
                    tenant_id,
                    row_owner,
                    json.dumps(scoped_payload, ensure_ascii=False),
                ),
            )
            connection.commit()

    def _delete_payload(self, table: str, identifier: str, include_owner: bool = True) -> None:
        target = self._get_payload_by_id(table, identifier, include_owner=include_owner)
        if not target:
            return
        tenant_id, owner_id = get_workspace_scope()
        row_owner = owner_id if include_owner else "__system__"
        placeholder = self._placeholder()
        with closing(self._connect()) as connection:
            connection.execute(
                f"DELETE FROM {table} WHERE id = {placeholder} AND tenant_id = {placeholder} AND owner_id = {placeholder}",
                (self._payload_row_id(identifier, include_owner=include_owner), tenant_id, row_owner),
            )
            connection.commit()

    def _get_payload_by_id(self, table: str, identifier: str, include_owner: bool = True) -> dict | None:
        tenant_id, owner_id = get_workspace_scope()
        row_owner = owner_id if include_owner else "__system__"
        placeholder = self._placeholder()
        with closing(self._connect()) as connection:
            row = connection.execute(
                f"SELECT payload FROM {table} "
                f"WHERE id = {placeholder} AND tenant_id = {placeholder} AND owner_id = {placeholder}",
                (self._payload_row_id(identifier, include_owner=include_owner), tenant_id, row_owner),
            ).fetchone()
        if not row:
            return None
        payload = json.loads(row[0])
        if not self._matches_scope(payload, include_owner=include_owner):
            return None
        return payload

    def add_audit_event(self, action: str, target: str, payload: dict | None = None) -> dict:
        tenant_id, owner_id = get_workspace_scope()
        event = {
            "id": str(uuid4()),
            "action": action,
            "target": target,
            "payload": payload or {},
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "tenantId": tenant_id,
            "ownerId": owner_id,
        }
        placeholder = self._placeholder()
        with closing(self._connect()) as connection:
            connection.execute(
                f"INSERT INTO audit_events(id, action, target, payload, created_at, tenant_id, owner_id) "
                f"VALUES({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})",
                (
                    event["id"],
                    event["action"],
                    event["target"],
                    json.dumps(event, ensure_ascii=False),
                    event["createdAt"],
                    tenant_id,
                    owner_id,
                ),
            )
            connection.commit()
        return deepcopy(event)

    def count_audit_events(self) -> int:
        tenant_id, owner_id = get_workspace_scope()
        placeholder = self._placeholder()
        with closing(self._connect()) as connection:
            row = connection.execute(
                f"SELECT COUNT(*) FROM audit_events WHERE tenant_id = {placeholder} AND owner_id = {placeholder}",
                (tenant_id, owner_id),
            ).fetchone()
        return int(row[0] if row else 0)

    def list_audit_events(self, limit: int = 50, offset: int = 0) -> list[dict]:
        tenant_id, owner_id = get_workspace_scope()
        placeholder = self._placeholder()
        safe_limit = max(1, int(limit))
        safe_offset = max(0, int(offset))
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT id, action, target, payload, created_at, tenant_id, owner_id "
                f"FROM audit_events WHERE tenant_id = {placeholder} AND owner_id = {placeholder} "
                f"ORDER BY created_at DESC LIMIT {placeholder} OFFSET {placeholder}",
                (tenant_id, owner_id, safe_limit, safe_offset),
            ).fetchall()
        events = []
        for row in rows:
            payload = json.loads(row[3]) if row[3] else {}
            events.append(
                {
                    "id": row[0],
                    "action": row[1],
                    "target": row[2],
                    "createdAt": row[4],
                    "tenantId": row[5] or payload.get("tenantId"),
                    "ownerId": row[6] or payload.get("ownerId"),
                    **payload,
                }
            )
        return events

    def _ensure_seed_data(self, seed_demo_data: bool) -> None:
        if not self._get_json(self._scoped_key("active_task")):
            self._set_json(self._scoped_key("active_task"), _default_active_task())
        if not self._get_json(self._scoped_key("meta")):
            self._set_json(self._scoped_key("meta"), {"saved_task_counter": 1, "saved_template_counter": 1, "active_task_history_id": None})
        if seed_demo_data and not self._list_payloads("history_tasks"):
            for task in _seed_recent_tasks():
                self._save_payload("history_tasks", task["id"], task)
        if seed_demo_data and not self._list_payloads("templates", include_owner=False):
            for template in _seed_templates():
                self._save_payload("templates", template["id"], template, include_owner=False)

    def _get_meta(self) -> dict:
        return self._get_json(self._scoped_key("meta")) or {
            "saved_task_counter": 1,
            "saved_template_counter": 1,
            "active_task_history_id": None,
        }

    def _set_meta(self, meta: dict) -> None:
        self._set_json(self._scoped_key("meta"), meta)

    def _get_uploaded_files(self) -> list[dict]:
        return (self._get_json(self._scoped_key("uploaded_files")) or {"items": []}).get("items", [])

    def _get_artifacts(self) -> list[dict]:
        return (self._get_json(self._scoped_key("artifacts")) or {"items": []}).get("items", [])

    def add_artifact(self, artifact: dict) -> dict:
        artifacts = self._get_artifacts()
        artifacts.insert(0, deepcopy(artifact))
        self._set_json(self._scoped_key("artifacts"), {"items": artifacts})
        return deepcopy(artifact)

    def delete_artifacts_for_task(self, task_id: str) -> list[dict]:
        artifacts = self._get_artifacts()
        removed = [deepcopy(artifact) for artifact in artifacts if artifact.get("taskId") == task_id]
        kept = [artifact for artifact in artifacts if artifact.get("taskId") != task_id]
        self._set_json(self._scoped_key("artifacts"), {"items": kept})
        return removed

    def list_artifacts(self, task_id: str | None = None) -> list[dict]:
        artifacts = self._get_artifacts()
        if task_id:
            artifacts = [artifact for artifact in artifacts if artifact.get("taskId") == task_id]
        return deepcopy(artifacts)

    def get_artifact(self, artifact_id: str) -> dict | None:
        return next((deepcopy(artifact) for artifact in self._get_artifacts() if artifact.get("id") == artifact_id), None)

    def _dataset_from_data_source(self, identifier: str, data_source: dict, used_by: str) -> dict:
        return {
            "id": identifier,
            "name": data_source.get("fileName", used_by),
            "fileName": data_source.get("fileName", used_by),
            "kind": data_source.get("kind", "csv"),
            "formatLabel": data_source.get("formatLabel"),
            "columnCount": data_source.get("columnCount", 0),
            "rowCount": data_source.get("rowCount", 0),
            "columns": data_source.get("columns", []),
            "previewRows": data_source.get("previewRows", []),
            "analysisRows": data_source.get("analysisRows", []),
            "textPreview": data_source.get("textPreview", ""),
            "fullText": data_source.get("fullText", ""),
            "fieldMappings": data_source.get("fieldMappings", []),
            "profile": data_source.get("profile", {}),
            "analysisScope": data_source.get("analysisScope", {}),
            "storageKey": data_source.get("storageKey", ""),
            "originalMimeType": data_source.get("originalMimeType", "application/octet-stream"),
            "originalFileSize": data_source.get("originalFileSize", 0),
            "usedBy": used_by,
            "uploadedAt": data_source.get("uploadedAt", ""),
            "sourceType": data_source.get("sourceType", "upload"),
            "connectorType": data_source.get("connectorType"),
            "connectionId": data_source.get("connectionId"),
        }

    def add_uploaded_dataset(self, data_source: dict) -> dict:
        uploaded_files = [item for item in self._get_uploaded_files() if item.get("name") != data_source.get("fileName")]
        used_by = "外部连接导入" if data_source.get("sourceType") == "connector" else "已上传文件"
        dataset = self._dataset_from_data_source(
            f"uploaded-file-{uuid4()}",
            {**data_source, "uploadedAt": datetime.now(timezone.utc).isoformat()},
            used_by,
        )
        uploaded_files.insert(0, dataset)
        self._set_json(self._scoped_key("uploaded_files"), {"items": uploaded_files})
        try:
            self.upsert_resource_dataset(dataset)
        except Exception:
            pass
        return deepcopy(dataset)

    def delete_dataset(self, dataset_id: str) -> dict | None:
        uploaded_files = self._get_uploaded_files()
        target = next((deepcopy(dataset) for dataset in uploaded_files if dataset.get("id") == dataset_id), None)
        if not target:
            return None
        remaining = [dataset for dataset in uploaded_files if dataset.get("id") != dataset_id]
        self._set_json(self._scoped_key("uploaded_files"), {"items": remaining})
        return target

    def purge_expired_resources(
        self,
        *,
        history_days: int = 0,
        dataset_days: int = 0,
        artifact_days: int = 0,
        audit_days: int = 0,
    ) -> dict:
        """Delete expired scoped resources by retention policy (days <= 0 means keep forever)."""
        from backend_py.compliance import is_expired

        now = datetime.now(timezone.utc)
        removed_history: list[str] = []
        removed_datasets: list[dict] = []
        removed_artifacts: list[dict] = []
        removed_audits = 0

        if history_days > 0:
            for task in list(self.list_recent_tasks()):
                if task.get("shared"):
                    continue
                stamp = (
                    task.get("updatedAt")
                    or task.get("createdAt")
                    or task.get("savedAt")
                    or task.get("time")
                )
                if is_expired(str(stamp) if stamp else None, retain_days=history_days, now=now):
                    deleted = self.delete_history_task(str(task.get("id")))
                    if deleted:
                        removed_history.append(str(task.get("id")))

        if dataset_days > 0:
            for dataset in list(self.list_datasets()):
                if dataset.get("shared"):
                    continue
                stamp = dataset.get("uploadedAt") or dataset.get("createdAt") or dataset.get("updatedAt")
                if is_expired(str(stamp) if stamp else None, retain_days=dataset_days, now=now):
                    deleted = self.delete_dataset(str(dataset.get("id")))
                    if deleted:
                        removed_datasets.append(deleted)

        if artifact_days > 0:
            artifacts = self._get_artifacts()
            kept = []
            for artifact in artifacts:
                stamp = artifact.get("createdAt") or artifact.get("uploadedAt")
                if is_expired(str(stamp) if stamp else None, retain_days=artifact_days, now=now):
                    removed_artifacts.append(deepcopy(artifact))
                else:
                    kept.append(artifact)
            self._set_json(self._scoped_key("artifacts"), {"items": kept})

        if audit_days > 0:
            # Audit purge is tenant/user scoped by payload fields.
            tenant_id, owner_id = get_workspace_scope()
            with closing(self._connect()) as connection:
                rows = connection.execute(
                    "SELECT id, payload, created_at, tenant_id, owner_id FROM audit_events"
                ).fetchall()
                for row in rows:
                    event_id, payload_raw, created_at, row_tenant, row_owner = row
                    try:
                        payload = json.loads(payload_raw or "{}")
                    except Exception:
                        payload = {}
                    event_tenant = row_tenant or payload.get("tenantId")
                    event_owner = row_owner or payload.get("ownerId")
                    if event_tenant != tenant_id or event_owner != owner_id:
                        continue
                    stamp = created_at or payload.get("createdAt")
                    if is_expired(str(stamp) if stamp else None, retain_days=audit_days, now=now):
                        connection.execute(
                            f"DELETE FROM audit_events WHERE id = {self._placeholder()}",
                            (event_id,),
                        )
                        removed_audits += 1
                connection.commit()

        return {
            "historyTaskIds": removed_history,
            "datasets": removed_datasets,
            "artifacts": removed_artifacts,
            "auditDeleted": removed_audits,
        }

    def get_dataset(self, dataset_id: str) -> dict | None:
        uploaded = next((deepcopy(dataset) for dataset in self._get_uploaded_files() if dataset.get("id") == dataset_id), None)
        if uploaded:
            return uploaded
        for task in [self.get_active_task(), *self.list_recent_tasks()]:
            data_source = task.get("dataSource")
            if data_source and task.get("id") == dataset_id:
                return self._dataset_from_data_source(task["id"], data_source, task["name"])
        return None

    def active_task_uses_dataset(self, dataset_id: str) -> bool:
        active = self.get_active_task()
        data_source = active.get("dataSource") or {}
        return str(data_source.get("id") or "") == dataset_id

    def _get_connections(self) -> list[dict]:
        return (self._get_json(self._scoped_key("connections")) or {"items": []}).get("items", [])

    def list_connections(self) -> list[dict]:
        return deepcopy(self._get_connections())

    def get_connection(self, connection_id: str) -> dict | None:
        return next((deepcopy(item) for item in self._get_connections() if item.get("id") == connection_id), None)

    def save_connection(self, connection: dict) -> dict:
        items = self._get_connections()
        connection_id = connection.get("id") or f"conn-{uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        tenant_id, owner_id = get_workspace_scope()
        payload = {
            **deepcopy(connection),
            "id": connection_id,
            "tenantId": tenant_id,
            "ownerId": owner_id,
            "updatedAt": now,
            "createdAt": connection.get("createdAt") or now,
        }
        next_items = [item for item in items if item.get("id") != connection_id]
        next_items.insert(0, payload)
        self._set_json(self._scoped_key("connections"), {"items": next_items})
        return deepcopy(payload)

    def delete_connection(self, connection_id: str) -> dict | None:
        items = self._get_connections()
        target = next((deepcopy(item) for item in items if item.get("id") == connection_id), None)
        if not target:
            return None
        remaining = [item for item in items if item.get("id") != connection_id]
        self._set_json(self._scoped_key("connections"), {"items": remaining})
        return target

    def _normalize_task_payload(self, payload: dict) -> dict:
        task = deepcopy(payload)
        task.setdefault("executionLog", _default_execution_log())
        task.setdefault(
            "execution",
            {
                "mode": "async",
                "status": "idle",
                "jobId": None,
                "action": None,
                "submittedAt": None,
                "startedAt": None,
                "finishedAt": None,
                "lastError": None,
                "steps": 0,
            },
        )
        return task

    def _append_execution_log(self, task: dict, kind: str, message: str) -> dict:
        next_task = self._normalize_task_payload(task)
        next_task["executionLog"].append(create_execution_log_entry(kind, message))
        return next_task

    def get_active_task(self) -> dict:
        return deepcopy(self._normalize_task_payload(self._get_json(self._scoped_key("active_task")) or _default_active_task()))

    def update_active_task(self, update: dict) -> dict:
        active_task = self.get_active_task()
        active_task.update(deepcopy(update))
        active_task = self._normalize_task_payload(active_task)
        self._set_json(self._scoped_key("active_task"), active_task)
        return self.get_active_task()

    def apply_workflow_action(self, action: str, chat_client=None, *, run_to_completion: bool = True) -> dict:
        with self._workflow_lock:
            active_task = run_workflow_action(self.get_active_task(), action)
            active_task = self._append_execution_log(active_task, "action", action)
            self._set_json(self._scoped_key("active_task"), active_task)
            if chat_client is not None and run_to_completion and action in {"start", "resume", "retry", "retry_current"}:
                return self.run_workflow_until_idle(chat_client)
            return self.get_active_task()

    def set_execution_meta(self, execution: dict) -> dict:
        with self._workflow_lock:
            active_task = self.get_active_task()
            current = dict(active_task.get("execution") or {})
            current.update(execution)
            active_task["execution"] = current
            self._set_json(self._scoped_key("active_task"), active_task)
            return self.get_active_task()

    def advance_workflow(self, chat_client) -> dict:
        with self._workflow_lock:
            active_task = self.get_active_task()
            # Do not advance after terminal control actions.
            if active_task.get("snapshot", {}).get("phase") in {"stopped", "paused", "failed", "completed", "needs_review"}:
                return active_task
            active_task = advance_workflow_with_model(active_task, chat_client)
            active_task = self._append_execution_log(active_task, "advance", active_task["snapshot"]["logMessage"])
            self._set_json(self._scoped_key("active_task"), active_task)
            return self.get_active_task()

    def run_workflow_until_idle(self, chat_client, max_steps: int = 12) -> dict:
        task = self.get_active_task()
        steps = 0
        while task.get("snapshot", {}).get("phase") == "running" and steps < max_steps:
            task = self.advance_workflow(chat_client)
            steps += 1
        return task

    def reset_active_task(self) -> dict:
        self._set_json(self._scoped_key("active_task"), _default_active_task())
        meta = self._get_meta()
        meta["active_task_history_id"] = None
        self._set_meta(meta)
        return self.get_active_task()

    def create_task_from_replay(self) -> dict:
        active_task = _default_active_task(self.get_active_task()["request"])
        active_task["name"] = f"回放新任务：{active_task['name']}"
        active_task["summary"] = "已基于回放上下文创建新任务。"
        active_task["executionLog"] = [
            create_execution_log_entry("system", "任务已初始化"),
            create_execution_log_entry("action", "基于回放新建"),
        ]
        self._set_json(self._scoped_key("active_task"), active_task)
        meta = self._get_meta()
        meta["active_task_history_id"] = None
        self._set_meta(meta)
        return self.get_active_task()

    def load_history_task_into_active(self, task_id: str) -> dict | None:
        task = self.get_task_detail(task_id)
        if not task:
            return None
        task["id"] = "workspace-active-session"
        task["mode"] = "replay"
        task["status"] = f"回放模式 - {task.get('status', '已完成')}"
        self._set_json(self._scoped_key("active_task"), task)
        meta = self._get_meta()
        meta["active_task_history_id"] = task_id
        self._set_meta(meta)
        return self.get_active_task()

    def create_task_from_template(self, template_id: str) -> dict | None:
        template = next((item for item in self.list_templates() if item.get("id") == template_id), None)
        if not template:
            return None
        task = _default_active_task(template.get("request", ""))
        task["name"] = template.get("name", task["name"])
        task["summary"] = template.get("summary", task["summary"])
        task["executionLog"] = [create_execution_log_entry("system", "已从模板创建新任务")]
        self._set_json(self._scoped_key("active_task"), task)
        meta = self._get_meta()
        meta["active_task_history_id"] = None
        self._set_meta(meta)
        return self.get_active_task()

    def list_recent_tasks(self) -> list[dict]:
        tasks = self._list_payloads("history_tasks")
        # include org-shared tasks
        try:
            _, owner_id = get_workspace_scope()
            shared_tasks = self.list_shared_resources_for_user(owner_id, "task")
            existing_ids = {str(item.get("id")) for item in tasks}
            for item in shared_tasks:
                if str(item.get("id")) not in existing_ids:
                    tasks.append(item)
        except Exception:
            pass
        return deepcopy(sorted(tasks, key=lambda item: item.get("time") or item.get("updatedAt") or item.get("createdAt") or "", reverse=True))

    def get_task_detail(self, task_id: str) -> dict | None:
        payload = self._get_payload_by_id("history_tasks", task_id)
        if not payload:
            return None
        return deepcopy(self._normalize_task_payload(payload))

    def delete_history_task(self, task_id: str) -> dict | None:
        task = self.get_task_detail(task_id)
        if not task:
            return None
        self._delete_payload("history_tasks", task_id)
        meta = self._get_meta()
        if meta.get("active_task_history_id") == task_id:
            meta["active_task_history_id"] = None
            self._set_meta(meta)
        return task

    def save_active_task_to_history(self) -> dict:
        meta = self._get_meta()
        saved_id = meta["active_task_history_id"] or f"saved-session-{self._scope_slug()}-{meta['saved_task_counter']}"
        saved_task = self.get_active_task()
        saved_task["id"] = saved_id
        saved_task["time"] = f"今天 16:{meta['saved_task_counter']:02d}"
        if saved_task.get("exports"):
            latest_export = saved_task["exports"][0]["status"]
            saved_task = self._append_execution_log(saved_task, "export", latest_export)
        self._save_payload("history_tasks", saved_id, saved_task)
        if not meta["active_task_history_id"]:
            meta["saved_task_counter"] += 1
        meta["active_task_history_id"] = saved_id
        self._set_meta(meta)
        try:
            self.upsert_resource_task(saved_task)
        except Exception:
            pass
        return deepcopy(saved_task)

    def list_templates(self) -> list[dict]:
        workspace_templates = [item for item in self._list_payloads("templates") if item.get("source") == "workspace"]
        system_templates = [
            item
            for item in self._list_payloads("templates", include_owner=False)
            if item.get("source") not in {"workspace", "organization"}
        ]
        tenant_id, owner_id = get_workspace_scope()
        org_ids = [item["id"] for item in self.list_organizations_for_user(owner_id, tenant_id)]
        org_templates = self.list_org_templates(org_ids)
        seen = {item.get("id") for item in workspace_templates + system_templates}
        merged_org = [item for item in org_templates if item.get("id") not in seen]
        return deepcopy(workspace_templates + merged_org + system_templates)

    def list_datasets(self) -> list[dict]:
        datasets = self._get_uploaded_files()
        # include org-shared datasets
        try:
            _, owner_id = get_workspace_scope()
            shared = self.list_shared_resources_for_user(owner_id, "dataset")
            existing_ids = {str(item.get("id")) for item in datasets}
            for item in shared:
                if str(item.get("id")) not in existing_ids:
                    datasets.append(item)
        except Exception:
            pass
        seen_sources = set()
        for dataset in datasets:
            if dataset.get("name"):
                seen_sources.add(dataset["name"])
        for task in [self.get_active_task(), *self.list_recent_tasks()]:
            data_source = task.get("dataSource")
            file_name = data_source.get("fileName") if data_source else None
            if data_source and file_name and file_name not in seen_sources:
                seen_sources.add(file_name)
                datasets.append(self._dataset_from_data_source(task["id"], data_source, task["name"]))
        return deepcopy(datasets)

    def list_reports(self) -> list[dict]:
        reports = []
        for task in self.list_recent_tasks():
            reports.append(
                {
                    "id": task["id"],
                    "name": task["name"],
                    "summary": task["summary"],
                    "time": task["time"],
                    "exports": task.get("exports", []),
                    "status": task["status"],
                }
            )
        return deepcopy(reports)

    def search(self, query: str) -> list[dict]:
        normalized = query.strip().lower()
        if not normalized:
            return []
        results = []
        for kind, items in (("task", self.list_recent_tasks()), ("template", self.list_templates()), ("dataset", self.list_datasets())):
            for item in items:
                haystack = " ".join(str(item.get(key, "")) for key in ("name", "summary", "description", "request", "usedBy")).lower()
                if normalized in haystack:
                    results.append({"kind": kind, "id": item["id"], "name": item["name"]})
        return results[:10]

    def list_notifications(self) -> list[dict]:
        active_task = self.get_active_task()
        running = next((node for node in active_task["snapshot"]["nodes"] if node["status"] == "running"), None)
        notifications = []
        if running:
            notifications.append({"id": "running-agent", "level": "info", "message": f"{running['label']} 正在执行"})
        for index, risk in enumerate(active_task.get("risks", []), start=1):
            notifications.append({"id": f"risk-{index}", "level": "warn", "message": risk})
        return notifications or [{"id": "idle", "level": "info", "message": "暂无新的任务告警"}]

    def save_active_task_as_template(self, draft: dict | None = None) -> dict:
        active_task = self.get_active_task()
        request = draft.get("request", active_task["request"]) if draft else active_task["request"]
        summary = draft.get("summary", active_task["summary"]) if draft else active_task["summary"]
        name = draft.get("name", request) if draft else request
        meta = self._get_meta()
        template = {
            "id": f"workspace-template-{meta['saved_template_counter']}",
            "name": name,
            "tag": "来自工作台",
            "description": summary.split("\n")[0] or "已从当前工作台会话保存。",
            "request": request,
            "summary": summary,
            "source": "workspace",
        }
        self._save_payload("templates", template["id"], template)
        meta["saved_template_counter"] += 1
        self._set_meta(meta)
        return deepcopy(template)

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
                    raise ValueError("username already exists") from error
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
        tenant = tenant_id or get_workspace_scope()[0]
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
        tenant = tenant_id or get_workspace_scope()[0]
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
        tenant_id, _ = get_workspace_scope()
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
        tenant_id, _ = get_workspace_scope()
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
        tenant_id, owner_id = get_workspace_scope()
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
        tenant_id, owner_id = get_workspace_scope()
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
        tenant_id, owner_id = get_workspace_scope()
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
        tenant_id, _ = get_workspace_scope()
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
        tenant_id, _ = get_workspace_scope()
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


def create_repository(
    db_path: str | None = None,
    database_url: str | None = None,
    seed_demo_data: bool = True,
) -> TaskRepository:
    return TaskRepository(db_path=db_path, database_url=database_url, seed_demo_data=seed_demo_data)


InMemoryTaskRepository = TaskRepository
