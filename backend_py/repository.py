from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse

from backend_py.workflow_service import (
    advance_workflow_with_model,
    apply_workflow_action as run_workflow_action,
    create_execution_log_entry,
)


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
    def __init__(self, db_path: str | None = None, database_url: str | None = None) -> None:
        self.database_url = database_url
        self.db_path = Path(db_path) if db_path else None
        self.use_postgres = _is_postgres_dsn(database_url)
        self._init_db()
        self._ensure_seed_data()

    def _connect(self):
        if self.use_postgres:
            try:
                import psycopg
            except ModuleNotFoundError as error:
                raise RuntimeError("psycopg is required for PostgreSQL support") from error
            return psycopg.connect(self.database_url)
        return sqlite3.connect(self.db_path or "workspace.sqlite3")

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

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS history_tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            connection.commit()

    def _get_json(self, key: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                f"SELECT value FROM kv_store WHERE key = {self._placeholder()}",
                (key,),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def _set_json(self, key: str, value: dict) -> None:
        with self._connect() as connection:
            connection.execute(self._upsert_sql("kv_store", "key"), (key, json.dumps(value, ensure_ascii=False)))
            connection.commit()

    def _list_payloads(self, table: str) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(f"SELECT payload FROM {table}").fetchall()
        return [self._normalize_task_payload(json.loads(row[0])) for row in rows]

    def _save_payload(self, table: str, identifier: str, payload: dict) -> None:
        with self._connect() as connection:
            connection.execute(self._upsert_sql(table, "id"), (identifier, json.dumps(payload, ensure_ascii=False)))
            connection.commit()

    def _ensure_seed_data(self) -> None:
        if not self._get_json("active_task"):
            self._set_json("active_task", _default_active_task())
        if not self._get_json("meta"):
            self._set_json("meta", {"saved_task_counter": 1, "saved_template_counter": 1, "active_task_history_id": None})
        if not self._list_payloads("history_tasks"):
            for task in _seed_recent_tasks():
                self._save_payload("history_tasks", task["id"], task)
        if not self._list_payloads("templates"):
            for template in _seed_templates():
                self._save_payload("templates", template["id"], template)

    def _get_meta(self) -> dict:
        return self._get_json("meta") or {
            "saved_task_counter": 1,
            "saved_template_counter": 1,
            "active_task_history_id": None,
        }

    def _set_meta(self, meta: dict) -> None:
        self._set_json("meta", meta)

    def _normalize_task_payload(self, payload: dict) -> dict:
        task = deepcopy(payload)
        task.setdefault("executionLog", _default_execution_log())
        return task

    def _append_execution_log(self, task: dict, kind: str, message: str) -> dict:
        next_task = self._normalize_task_payload(task)
        next_task["executionLog"].append(create_execution_log_entry(kind, message))
        return next_task

    def get_active_task(self) -> dict:
        return deepcopy(self._normalize_task_payload(self._get_json("active_task") or _default_active_task()))

    def update_active_task(self, update: dict) -> dict:
        active_task = self.get_active_task()
        active_task.update(deepcopy(update))
        active_task = self._normalize_task_payload(active_task)
        self._set_json("active_task", active_task)
        return self.get_active_task()

    def apply_workflow_action(self, action: str) -> dict:
        active_task = run_workflow_action(self.get_active_task(), action)
        active_task = self._append_execution_log(active_task, "action", action)
        self._set_json("active_task", active_task)
        return self.get_active_task()

    def advance_workflow(self, chat_client) -> dict:
        active_task = advance_workflow_with_model(self.get_active_task(), chat_client)
        active_task = self._append_execution_log(active_task, "advance", active_task["snapshot"]["logMessage"])
        self._set_json("active_task", active_task)
        return self.get_active_task()

    def reset_active_task(self) -> dict:
        self._set_json("active_task", _default_active_task())
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
        self._set_json("active_task", active_task)
        meta = self._get_meta()
        meta["active_task_history_id"] = None
        self._set_meta(meta)
        return self.get_active_task()

    def list_recent_tasks(self) -> list[dict]:
        tasks = self._list_payloads("history_tasks")
        return deepcopy(sorted(tasks, key=lambda item: item["time"], reverse=True))

    def get_task_detail(self, task_id: str) -> dict | None:
        for task in self._list_payloads("history_tasks"):
            if task["id"] == task_id:
                return deepcopy(task)
        return None

    def save_active_task_to_history(self) -> dict:
        meta = self._get_meta()
        saved_id = meta["active_task_history_id"] or f"saved-session-{meta['saved_task_counter']}"
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
        return deepcopy(saved_task)

    def list_templates(self) -> list[dict]:
        templates = self._list_payloads("templates")
        workspace_templates = [item for item in templates if item.get("source") == "workspace"]
        system_templates = [item for item in templates if item.get("source") != "workspace"]
        return deepcopy(workspace_templates + system_templates)

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


def create_repository(db_path: str | None = None, database_url: str | None = None) -> TaskRepository:
    return TaskRepository(db_path=db_path, database_url=database_url)


InMemoryTaskRepository = TaskRepository
