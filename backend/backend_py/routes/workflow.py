from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend_py.api_helpers import audit
from backend_py.app_context import AppContext
from backend_py.repository import get_workspace_scope
from backend_py.schemas import WorkflowActionRequest
from backend_py.workflow_runner import attach_execution_meta


def register_workflow_routes(app: FastAPI, ctx: AppContext) -> None:
    router = APIRouter(tags=["workflow"])

    @router.post("/api/workflow/action")
    def workflow_action(payload: WorkflowActionRequest) -> dict:
        action = (payload.action or "").strip()
        if not action:
            raise HTTPException(status_code=400, detail="action is required")

        tenant_id, owner_id = get_workspace_scope()
        control_actions = {"pause", "stop"}
        run_actions = {"start", "resume", "retry", "retry_current"}

        if action in control_actions:
            if action == "stop":
                ctx.workflow_runner.request_cancel(tenant_id, owner_id)
            task = ctx.repo.apply_workflow_action(action, chat_client=None, run_to_completion=False)
            audit(ctx.repo, "workflow.action", task["id"], {"action": action, "phase": task.get("snapshot", {}).get("phase"), "mode": "control"})
            job_view = ctx.workflow_runner.job_public_view(ctx.workflow_runner.get_job(tenant_id, owner_id))
            return attach_execution_meta(task, job_view, mode="async" if ctx.workflow_async else "sync")

        if action == "fail":
            task = ctx.repo.apply_workflow_action(action, chat_client=None, run_to_completion=False)
            audit(ctx.repo, "workflow.action", task["id"], {"action": action, "phase": task.get("snapshot", {}).get("phase")})
            job_view = ctx.workflow_runner.job_public_view(ctx.workflow_runner.get_job(tenant_id, owner_id))
            return attach_execution_meta(task, job_view, mode="async" if ctx.workflow_async else "sync")

        if action not in run_actions:
            raise HTTPException(status_code=400, detail=f"unsupported action: {action}")

        if ctx.workflow_runner.is_active(tenant_id, owner_id):
            raise HTTPException(status_code=409, detail="workflow job already running")

        # Transition into running state immediately so clients see progress on first poll.
        task = ctx.repo.apply_workflow_action(action, chat_client=None, run_to_completion=False)

        if not ctx.workflow_async:
            task = ctx.repo.run_workflow_until_idle(ctx.client)
            terminal = "succeeded" if task.get("snapshot", {}).get("phase") != "failed" else "failed"
            task = ctx.repo.set_execution_meta(
                {
                    "mode": "sync",
                    "backend": getattr(ctx.workflow_runner, "backend_name", "memory"),
                    "status": terminal,
                    "action": action,
                    "finishedAt": datetime.now(timezone.utc).isoformat(),
                }
            )
            ctx.metrics.observe_workflow_job(terminal, steps=len(task.get("artifacts") or []))
            audit(ctx.repo, "workflow.action", task["id"], {"action": action, "phase": task.get("snapshot", {}).get("phase"), "mode": "sync"})
            return attach_execution_meta(task, task.get("execution"), mode="sync")

        queue_backend_name = getattr(ctx.workflow_runner, "backend_name", "memory")

        def run_step() -> dict:
            return ctx.repo.advance_workflow(ctx.client)

        def should_continue(current_task: dict) -> bool:
            return current_task.get("snapshot", {}).get("phase") == "running"

        def on_complete(job, final_task):
            ctx.repo.set_execution_meta(
                {
                    "mode": "async",
                    "backend": queue_backend_name,
                    "jobId": job.job_id,
                    "status": job.status,
                    "action": job.action,
                    "submittedAt": job.submitted_at,
                    "startedAt": job.started_at,
                    "finishedAt": job.finished_at,
                    "lastError": job.last_error,
                    "steps": job.steps,
                }
            )
            ctx.metrics.observe_workflow_job(job.status, steps=job.steps)
            if job.status == "failed":
                ctx.tracker.capture_message(
                    job.last_error or "workflow job failed",
                    source="workflow.job",
                    level="error",
                    context={
                        "jobId": job.job_id,
                        "action": job.action,
                        "tenantId": job.tenant_id,
                        "ownerId": job.owner_id,
                        "steps": job.steps,
                        "backend": queue_backend_name,
                    },
                )
            audit(ctx.repo,
                "workflow.job.complete",
                (final_task or {}).get("id", "workspace-active-session"),
                {"jobId": job.job_id, "status": job.status, "steps": job.steps, "error": job.last_error, "backend": queue_backend_name},
            )

        if queue_backend_name == "redis":
            # API only enqueues; external worker process advances nodes.
            job = ctx.workflow_runner.submit(
                tenant_id=tenant_id,
                owner_id=owner_id,
                action=action,
            )
        else:
            job = ctx.workflow_runner.submit(
                tenant_id=tenant_id,
                owner_id=owner_id,
                action=action,
                run_step=run_step,
                should_continue=should_continue,
                on_complete=on_complete,
            )
        job_view = ctx.workflow_runner.job_public_view(job)
        task = ctx.repo.set_execution_meta(
            {
                "mode": "async",
                "backend": queue_backend_name,
                **(job_view or {}),
            }
        )
        audit(ctx.repo,
            "workflow.action",
            task["id"],
            {
                "action": action,
                "phase": task.get("snapshot", {}).get("phase"),
                "mode": "async",
                "backend": queue_backend_name,
                "jobId": job.job_id,
            },
        )
        return attach_execution_meta(task, job_view, mode="async")

    @router.get("/api/workflow/jobs/current")
    def current_workflow_job() -> dict:
        tenant_id, owner_id = get_workspace_scope()
        job_view = ctx.workflow_runner.job_public_view(ctx.workflow_runner.get_job(tenant_id, owner_id))
        task = attach_execution_meta(ctx.repo.get_active_task(), job_view, mode="async" if ctx.workflow_async else "sync")
        return {
            "job": job_view,
            "task": task,
        }

    @router.get("/api/workflow/jobs/stream")
    async def workflow_job_stream(request: Request):
        """Server-Sent Events stream for current workflow job progress."""
        import asyncio
        from fastapi.responses import StreamingResponse

        tenant_id, owner_id = get_workspace_scope()

        async def event_generator():
            last_payload = None
            # Keep connection for up to ~10 minutes by default.
            for _ in range(600):
                if await request.is_disconnected():
                    break
                job_view = ctx.workflow_runner.job_public_view(ctx.workflow_runner.get_job(tenant_id, owner_id))
                task = attach_execution_meta(
                    ctx.repo.get_active_task(),
                    job_view,
                    mode="async" if ctx.workflow_async else "sync",
                )
                payload = {
                    "job": job_view,
                    "task": task,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
                serialized = json.dumps(payload, ensure_ascii=False)
                if serialized != last_payload:
                    yield f"event: workflow\ndata: {serialized}\n\n"
                    last_payload = serialized
                status = (job_view or {}).get("status") or (task.get("execution") or {}).get("status")
                phase = ((task.get("snapshot") or {}).get("phase"))
                if job_view is None:
                    yield f"event: done\ndata: {serialized}\n\n"
                    break
                if status in {"succeeded", "failed", "cancelled"} or phase in {
                    "completed",
                    "needs_review",
                    "failed",
                    "stopped",
                }:
                    yield f"event: done\ndata: {serialized}\n\n"
                    break
                await asyncio.sleep(1.0)

        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
        return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)

    @router.post("/api/workflow/advance")
    def workflow_advance() -> dict:
        # Compatibility endpoint: prefer POST /api/workflow/action with start/resume.
        task = ctx.repo.advance_workflow(ctx.client)
        audit(ctx.repo, "workflow.advance", task["id"])
        tenant_id, owner_id = get_workspace_scope()
        job_view = ctx.workflow_runner.job_public_view(ctx.workflow_runner.get_job(tenant_id, owner_id))
        return attach_execution_meta(task, job_view, mode="async" if ctx.workflow_async else "sync")



    app.include_router(router)
