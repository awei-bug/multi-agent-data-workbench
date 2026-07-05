from __future__ import annotations

import json
import logging
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend_py.agnes_client import AgnesChatClient, create_agnes_client
from backend_py.repository import TaskRepository, create_repository

logger = logging.getLogger("workspace_api")


class IntentRequest(BaseModel):
    request: str = ""


class ActiveTaskUpdate(BaseModel):
    name: str | None = None
    mode: str | None = None
    status: str | None = None
    summary: str | None = None
    request: str | None = None
    snapshot: dict | None = None
    exports: list[dict] | None = None
    risks: list[str] | None = None
    dataSource: dict | None = None


class WorkflowActionRequest(BaseModel):
    action: str


class TemplateDraftRequest(BaseModel):
    name: str | None = None
    request: str | None = None
    summary: str | None = None


def _audit(repo: TaskRepository, action: str, target: str, payload: dict | None = None) -> None:
    repo.add_audit_event(action, target, payload)


def _add_security_headers(response) -> None:
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"


def create_app(
    api_key: str,
    base_url: str,
    model: str,
    repository: TaskRepository | None = None,
    chat_client: AgnesChatClient | None = None,
    repository_path: str | None = None,
    database_url: str | None = None,
    model_timeout_seconds: float = 60.0,
    enable_audit_events: bool = True,
    cors_origins: list[str] | None = None,
    max_request_body_bytes: int = 2_000_000,
    rate_limit_per_minute: int = 120,
) -> FastAPI:
    app = FastAPI()
    # ponytail: per-process limiter; use Redis/API gateway when running multiple backend replicas.
    rate_windows: dict[str, tuple[float, int]] = {}
    allowed_origins = cors_origins or [
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ]

    @app.middleware("http")
    async def request_log_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        started_at = time.perf_counter()
        client_host = request.client.host if request.client else "unknown"
        window_started, request_count = rate_windows.get(client_host, (started_at, 0))
        if started_at - window_started >= 60:
            window_started, request_count = started_at, 0
        request_count += 1
        rate_windows[client_host] = (window_started, request_count)
        if rate_limit_per_minute > 0 and request_count > rate_limit_per_minute:
            retry_after = max(1, int(60 - (started_at - window_started)))
            return JSONResponse(
                status_code=429,
                content={
                    "message": "too many requests",
                    "requestId": request_id,
                    "retryAfterSeconds": retry_after,
                },
                headers={
                    "x-request-id": request_id,
                    "retry-after": str(retry_after),
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "no-referrer",
                },
            )
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > max_request_body_bytes:
            return JSONResponse(
                status_code=413,
                content={"message": "request body too large", "requestId": request_id},
                headers={
                    "x-request-id": request_id,
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "no-referrer",
                },
            )
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.exception(
                "request_failed method=%s path=%s duration_ms=%s request_id=%s",
                request.method,
                request.url.path,
                duration_ms,
                request_id,
            )
            return JSONResponse(
                status_code=500,
                content={"message": "internal server error", "requestId": request_id},
                headers={
                    "x-request-id": request_id,
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "no-referrer",
                },
            )

        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        response.headers["x-request-id"] = request_id
        _add_security_headers(response)
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%s request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    repo = repository or create_repository(db_path=repository_path, database_url=database_url)
    client = chat_client or create_agnes_client(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=model_timeout_seconds,
    )

    @app.get("/api/health")
    def health_check():
        model_status = {
            "configured": bool(api_key),
            "baseUrl": base_url,
            "name": model,
            "timeoutSeconds": model_timeout_seconds,
        }
        try:
            database = repo.ping()
        except Exception as error:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unavailable",
                    "database": {"ok": False, "error": str(error)},
                    "model": model_status,
                },
            )

        return {
            "status": "ok",
            "database": database,
            "model": model_status,
        }

    @app.get("/api/active-task")
    def get_active_task() -> dict:
        return repo.get_active_task()

    @app.patch("/api/active-task")
    def patch_active_task(update: ActiveTaskUpdate) -> dict:
        payload = update.model_dump(exclude_none=True)
        task = repo.update_active_task(payload)
        _audit(repo, "active_task.patch", task["id"], {"fields": sorted(payload.keys())})
        return task

    @app.post("/api/active-task/reset")
    def reset_active_task() -> dict:
        task = repo.reset_active_task()
        _audit(repo, "active_task.reset", task["id"])
        return task

    @app.post("/api/active-task/from-replay")
    def create_task_from_replay() -> dict:
        task = repo.create_task_from_replay()
        _audit(repo, "active_task.from_replay", task["id"])
        return task

    @app.post("/api/history/save-active-task")
    def save_active_task_to_history() -> dict:
        task = repo.save_active_task_to_history()
        _audit(repo, "history.save_active_task", task["id"])
        return task

    @app.get("/api/history/tasks")
    def list_history_tasks() -> list[dict]:
        return repo.list_recent_tasks()

    @app.get("/api/history/tasks/{task_id}")
    def get_history_task_detail(task_id: str) -> dict | None:
        return repo.get_task_detail(task_id)

    @app.get("/api/templates")
    def list_templates() -> list[dict]:
        return repo.list_templates()

    @app.get("/api/datasets")
    def list_datasets() -> list[dict]:
        return repo.list_datasets()

    @app.get("/api/reports")
    def list_reports() -> list[dict]:
        return repo.list_reports()

    @app.get("/api/search")
    def search(query: str = "") -> list[dict]:
        return repo.search(query)

    @app.get("/api/notifications")
    def list_notifications() -> list[dict]:
        return repo.list_notifications()

    @app.post("/api/templates/save-active-task")
    def save_active_task_as_template(payload: TemplateDraftRequest) -> dict:
        template = repo.save_active_task_as_template(payload.model_dump(exclude_none=True))
        _audit(repo, "template.save_active_task", template["id"])
        return template

    @app.get("/api/audit/events")
    def list_audit_events(limit: int = 50) -> list[dict]:
        if not enable_audit_events:
            raise HTTPException(status_code=404, detail="Not found")
        return repo.list_audit_events(limit=max(1, min(limit, 200)))

    @app.post("/api/intent/parse")
    async def parse_intent(payload: IntentRequest):
        request_text = payload.request.strip()
        if not request_text:
            return JSONResponse(status_code=400, content={"message": "request is required"})

        prompt = "\n".join(
            [
                "Convert the analytics request below into JSON only.",
                "Return only JSON.",
                "Use keys: request, goal, metrics, dimensions, charts.",
                f"Request: {request_text}",
            ]
        )

        try:
            content = await client.complete(prompt)
            return json.loads(content)
        except Exception:
            return {
                "request": request_text,
                "goal": request_text,
                "metrics": "sales",
                "dimensions": "month, region",
                "charts": "trend",
            }

    @app.post("/api/workflow/action")
    def workflow_action(payload: WorkflowActionRequest) -> dict:
        task = repo.apply_workflow_action(payload.action)
        _audit(repo, "workflow.action", task["id"], {"action": payload.action})
        return task

    @app.post("/api/workflow/advance")
    def workflow_advance() -> dict:
        task = repo.advance_workflow(client)
        _audit(repo, "workflow.advance", task["id"])
        return task

    return app
