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

from backend_py.repository_parts.users_orgs import UsersOrgsMixin
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


class _DbApiConnectionAdapter:
    """Give psycopg2 DBAPI connections the execute API used by this repository."""

    def __init__(self, connection) -> None:
        self._connection = connection

    def execute(self, statement: str, parameters=None):
        cursor = self._connection.cursor()
        cursor.execute(statement, parameters)
        return cursor

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def close(self) -> None:
        self._connection.close()


class TaskRepository(UsersOrgsMixin):
    def __init__(
        self,
        db_path: str | None = None,
        database_url: str | None = None,
        seed_demo_data: bool = True,
        *,
        pool_size: int = 5,
        max_overflow: int = 10,
    ) -> None:
        self.database_url = database_url
        self.db_path = Path(db_path) if db_path else None
        self.use_postgres = _is_postgres_dsn(database_url)
        self._workflow_lock = threading.RLock()
        self._pool_size = max(1, pool_size)
        self._max_overflow = max(0, max_overflow)
        self._engine = None
        self._sqlite_lock = threading.RLock()
        if self.use_postgres:
            self._engine = self._create_engine()
        self._init_db()
        self._ensure_seed_data(seed_demo_data)

    def _create_engine(self):
        try:
            from sqlalchemy import create_engine
        except ModuleNotFoundError as error:
            raise RuntimeError("sqlalchemy is required for PostgreSQL connection pooling") from error
        # SQLAlchemy 2.x + psycopg3
        return create_engine(
            self.database_url,
            pool_size=self._pool_size,
            max_overflow=self._max_overflow,
            pool_pre_ping=True,
            future=True,
        )

    def _connect(self):
        if self.use_postgres:
            if self._engine is not None:
                return _DbApiConnectionAdapter(self._engine.raw_connection())
            try:
                import psycopg
            except ModuleNotFoundError as error:
                raise RuntimeError("psycopg is required for PostgreSQL support") from error
            return psycopg.connect(self.database_url)
        # SQLite: check_same_thread=False for worker/thread usage; serialize writes via lock when needed.
        connection = sqlite3.connect(self.db_path or "workspace.sqlite3", check_same_thread=False)
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

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
                "CREATE TABLE IF NOT EXISTS password_reset_tokens ("
                "token TEXT PRIMARY KEY, "
                "user_id TEXT NOT NULL, "
                "username TEXT NOT NULL, "
                "expires_at TEXT NOT NULL, "
                "used_at TEXT, "
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
            "name": data_source.get("name") or data_source.get("fileName", used_by),
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
        task.setdefault("artifacts", [])
        task.setdefault("exports", [])
        task.setdefault("risks", [])
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


def create_repository(
    db_path: str | None = None,
    database_url: str | None = None,
    seed_demo_data: bool = True,
) -> TaskRepository:
    return TaskRepository(db_path=db_path, database_url=database_url, seed_demo_data=seed_demo_data)


InMemoryTaskRepository = TaskRepository
