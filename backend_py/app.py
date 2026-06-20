from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend_py.agnes_client import AgnesChatClient, create_agnes_client
from backend_py.repository import TaskRepository, create_repository


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


def create_app(
    api_key: str,
    base_url: str,
    model: str,
    repository: TaskRepository | None = None,
    chat_client: AgnesChatClient | None = None,
    repository_path: str | None = None,
    database_url: str | None = None,
) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:4173",
            "http://localhost:4173",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:5174",
            "http://localhost:5174",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    repo = repository or create_repository(db_path=repository_path, database_url=database_url)
    client = chat_client or create_agnes_client(api_key=api_key, base_url=base_url, model=model)

    @app.get("/api/active-task")
    def get_active_task() -> dict:
        return repo.get_active_task()

    @app.patch("/api/active-task")
    def patch_active_task(update: ActiveTaskUpdate) -> dict:
        return repo.update_active_task(update.model_dump(exclude_none=True))

    @app.post("/api/active-task/reset")
    def reset_active_task() -> dict:
        return repo.reset_active_task()

    @app.post("/api/active-task/from-replay")
    def create_task_from_replay() -> dict:
        return repo.create_task_from_replay()

    @app.post("/api/history/save-active-task")
    def save_active_task_to_history() -> dict:
        return repo.save_active_task_to_history()

    @app.get("/api/history/tasks")
    def list_history_tasks() -> list[dict]:
        return repo.list_recent_tasks()

    @app.get("/api/history/tasks/{task_id}")
    def get_history_task_detail(task_id: str) -> dict | None:
        return repo.get_task_detail(task_id)

    @app.get("/api/templates")
    def list_templates() -> list[dict]:
        return repo.list_templates()

    @app.post("/api/templates/save-active-task")
    def save_active_task_as_template(payload: TemplateDraftRequest) -> dict:
        return repo.save_active_task_as_template(payload.model_dump(exclude_none=True))

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
        return repo.apply_workflow_action(payload.action)

    @app.post("/api/workflow/advance")
    def workflow_advance() -> dict:
        return repo.advance_workflow(client)

    return app
