from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from backend_py.error_tracking import get_error_tracker
from backend_py.observability import get_metrics
from backend_py.repository import reset_workspace_scope, set_workspace_scope
from backend_py.workflow_runner import RedisWorkflowQueue, WorkflowJob

logger = logging.getLogger("workspace_workflow_worker")


def process_job(
    queue: RedisWorkflowQueue,
    job: WorkflowJob,
    *,
    repository_factory: Callable[[], Any],
    chat_client: Any,
    metrics: Any | None = None,
    error_tracker: Any | None = None,
    step_delay_seconds: float = 0.0,
) -> WorkflowJob:
    """Execute one claimed Redis workflow job to terminal status."""
    metrics = metrics or get_metrics()
    tracker = error_tracker or get_error_tracker()
    scope_token = set_workspace_scope(job.tenant_id, job.owner_id)
    repo = repository_factory()
    final_task = None
    heartbeat_stop = threading.Event()

    def heartbeat_loop() -> None:
        interval = queue.lease_heartbeat_interval_seconds
        while not heartbeat_stop.wait(interval):
            try:
                if not queue.renew_lease(job.job_id, job.worker_id):
                    logger.warning("workflow_lease_heartbeat_stopped job_id=%s", job.job_id)
                    return
            except Exception:  # noqa: BLE001
                logger.exception("workflow_lease_heartbeat_failed job_id=%s", job.job_id)

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop,
        name=f"workflow-lease-{job.job_id}",
        daemon=True,
    )
    heartbeat_thread.start()

    def stop_heartbeat() -> None:
        heartbeat_stop.set()
        if heartbeat_thread.is_alive() and heartbeat_thread is not threading.current_thread():
            heartbeat_thread.join(timeout=max(1.0, queue.lease_heartbeat_interval_seconds + 1.0))

    try:
        while True:
            if queue.is_cancel_requested(job.job_id):
                stop_heartbeat()
                job = queue.complete(job, status="cancelled")
                break

            try:
                final_task = repo.advance_workflow(chat_client)
            except Exception as error:  # noqa: BLE001
                logger.exception("redis_workflow_job_failed job_id=%s", job.job_id)
                tracker.capture_exception(
                    error,
                    source="workflow.worker",
                    context={
                        "jobId": job.job_id,
                        "tenantId": job.tenant_id,
                        "ownerId": job.owner_id,
                        "action": job.action,
                    },
                )
                stop_heartbeat()
                job = queue.complete(job, status="failed", error=str(error))
                break

            job = queue.mark_step(job)
            phase = (final_task or {}).get("snapshot", {}).get("phase")
            if phase != "running":
                status = "failed" if phase == "failed" else "succeeded"
                stop_heartbeat()
                job = queue.complete(job, status=status)
                break

            if step_delay_seconds > 0:
                time.sleep(step_delay_seconds)

        repo.set_execution_meta(
            {
                "mode": "async",
                "backend": "redis",
                "jobId": job.job_id,
                "status": job.status,
                "action": job.action,
                "submittedAt": job.submitted_at,
                "startedAt": job.started_at,
                "finishedAt": job.finished_at,
                "lastError": job.last_error,
                "steps": job.steps,
                "attempts": job.attempts,
                "maxAttempts": job.max_attempts,
                "workerId": job.worker_id,
            }
        )
        repo.add_audit_event(
            "workflow.job.complete",
            (final_task or {}).get("id", "workspace-active-session"),
            {
                "jobId": job.job_id,
                "status": job.status,
                "steps": job.steps,
                "error": job.last_error,
                "backend": "redis",
            },
        )
        metrics.observe_workflow_job(job.status, steps=job.steps)
        if job.status == "failed":
            tracker.capture_message(
                job.last_error or "workflow job failed",
                source="workflow.worker",
                level="error",
                context={
                    "jobId": job.job_id,
                    "tenantId": job.tenant_id,
                    "ownerId": job.owner_id,
                    "action": job.action,
                    "steps": job.steps,
                },
            )
        return job
    finally:
        stop_heartbeat()
        reset_workspace_scope(scope_token)
