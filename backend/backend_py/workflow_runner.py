from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Protocol
from uuid import uuid4

from backend_py.repository import reset_workspace_scope, set_workspace_scope

logger = logging.getLogger("workspace_workflow_queue")

JobStatus = str  # queued | running | succeeded | failed | cancelled | idle


@dataclass
class WorkflowJob:
    job_id: str
    tenant_id: str
    owner_id: str
    action: str
    status: JobStatus = "queued"
    submitted_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: str | None = None
    finished_at: str | None = None
    last_error: str | None = None
    steps: int = 0
    cancel_requested: bool = False
    backend: str = "memory"
    attempts: int = 0
    max_attempts: int = 3
    claimed_at: str | None = None
    worker_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "WorkflowJob":
        return cls(
            job_id=str(payload["job_id"]),
            tenant_id=str(payload["tenant_id"]),
            owner_id=str(payload["owner_id"]),
            action=str(payload.get("action") or "start"),
            status=str(payload.get("status") or "queued"),
            submitted_at=str(payload.get("submitted_at") or datetime.now(timezone.utc).isoformat()),
            started_at=payload.get("started_at"),
            finished_at=payload.get("finished_at"),
            last_error=payload.get("last_error"),
            steps=int(payload.get("steps") or 0),
            cancel_requested=bool(payload.get("cancel_requested")),
            backend=str(payload.get("backend") or "memory"),
            attempts=int(payload.get("attempts") or 0),
            max_attempts=int(payload.get("max_attempts") or 3),
            claimed_at=payload.get("claimed_at"),
            worker_id=payload.get("worker_id"),
        )


def job_public_view(job: WorkflowJob | None) -> dict | None:
    if not job:
        return None
    return {
        "jobId": job.job_id,
        "status": job.status,
        "action": job.action,
        "submittedAt": job.submitted_at,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "lastError": job.last_error,
        "steps": job.steps,
        "cancelRequested": job.cancel_requested,
        "backend": job.backend,
    }


def attach_execution_meta(task: dict, job_view: dict | None, *, mode: str = "async") -> dict:
    next_task = dict(task)
    execution = dict(next_task.get("execution") or {})
    execution["mode"] = mode
    if job_view:
        execution.update(job_view)
    else:
        execution.setdefault("status", "idle")
    next_task["execution"] = execution
    return next_task


class WorkflowQueue(Protocol):
    backend_name: str

    def get_job(self, tenant_id: str, owner_id: str) -> WorkflowJob | None: ...

    def is_active(self, tenant_id: str, owner_id: str) -> bool: ...

    def request_cancel(self, tenant_id: str, owner_id: str) -> bool: ...

    def submit(
        self,
        *,
        tenant_id: str,
        owner_id: str,
        action: str,
        run_step: Callable[[], dict] | None = None,
        should_continue: Callable[[dict], bool] | None = None,
        on_complete: Callable[[WorkflowJob, dict | None], None] | None = None,
    ) -> WorkflowJob: ...

    def job_public_view(self, job: WorkflowJob | None) -> dict | None: ...

    def shutdown(self, wait: bool = False) -> None: ...


class MemoryWorkflowRunner:
    """In-process async workflow runner (single instance only)."""

    backend_name = "memory"

    def __init__(self, *, max_workers: int = 2, step_delay_seconds: float = 0.0) -> None:
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="workflow-job")
        self._lock = threading.RLock()
        self._jobs: dict[str, WorkflowJob] = {}
        self._futures: dict[str, Future] = {}
        self._scope_to_job: dict[tuple[str, str], str] = {}
        self._step_delay_seconds = step_delay_seconds

    def _scope_key(self, tenant_id: str, owner_id: str) -> tuple[str, str]:
        return (tenant_id, owner_id)

    def get_job(self, tenant_id: str, owner_id: str) -> WorkflowJob | None:
        with self._lock:
            job_id = self._scope_to_job.get(self._scope_key(tenant_id, owner_id))
            if not job_id:
                return None
            return self._jobs.get(job_id)

    def is_active(self, tenant_id: str, owner_id: str) -> bool:
        job = self.get_job(tenant_id, owner_id)
        return bool(job and job.status in {"queued", "running"})

    def request_cancel(self, tenant_id: str, owner_id: str) -> bool:
        with self._lock:
            job = self.get_job(tenant_id, owner_id)
            if not job or job.status not in {"queued", "running"}:
                return False
            job.cancel_requested = True
            return True

    def submit(
        self,
        *,
        tenant_id: str,
        owner_id: str,
        action: str,
        run_step: Callable[[], dict] | None = None,
        should_continue: Callable[[dict], bool] | None = None,
        on_complete: Callable[[WorkflowJob, dict | None], None] | None = None,
    ) -> WorkflowJob:
        if run_step is None or should_continue is None:
            raise ValueError("memory backend requires run_step and should_continue callbacks")

        with self._lock:
            existing = self.get_job(tenant_id, owner_id)
            if existing and existing.status in {"queued", "running"}:
                return existing

            job = WorkflowJob(
                job_id=f"job-{uuid4().hex[:12]}",
                tenant_id=tenant_id,
                owner_id=owner_id,
                action=action,
                status="queued",
                backend=self.backend_name,
            )
            self._jobs[job.job_id] = job
            self._scope_to_job[self._scope_key(tenant_id, owner_id)] = job.job_id
            future = self._executor.submit(
                self._run_job,
                job.job_id,
                run_step,
                should_continue,
                on_complete,
            )
            self._futures[job.job_id] = future
            return job

    def _run_job(
        self,
        job_id: str,
        run_step: Callable[[], dict],
        should_continue: Callable[[dict], bool],
        on_complete: Callable[[WorkflowJob, dict | None], None] | None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = "running"
            job.started_at = datetime.now(timezone.utc).isoformat()
            tenant_id = job.tenant_id
            owner_id = job.owner_id

        scope_token = set_workspace_scope(tenant_id, owner_id)
        final_task: dict | None = None
        try:
            while True:
                with self._lock:
                    current = self._jobs.get(job_id)
                    if not current:
                        return
                    if current.cancel_requested:
                        current.status = "cancelled"
                        current.finished_at = datetime.now(timezone.utc).isoformat()
                        job = current
                        break

                try:
                    final_task = run_step()
                except Exception as error:  # noqa: BLE001
                    logger.exception("workflow_job_failed job_id=%s", job_id)
                    with self._lock:
                        current = self._jobs.get(job_id)
                        if current:
                            current.status = "failed"
                            current.last_error = str(error)
                            current.finished_at = datetime.now(timezone.utc).isoformat()
                            job = current
                    break

                with self._lock:
                    current = self._jobs.get(job_id)
                    if not current:
                        return
                    current.steps += 1
                    job = current

                if not should_continue(final_task or {}):
                    with self._lock:
                        current = self._jobs.get(job_id)
                        if current and current.status == "running":
                            current.status = "succeeded"
                            current.finished_at = datetime.now(timezone.utc).isoformat()
                            job = current
                    break

                if self._step_delay_seconds > 0:
                    time.sleep(self._step_delay_seconds)
        finally:
            reset_workspace_scope(scope_token)
            if on_complete is not None:
                try:
                    on_complete(job, final_task)
                except Exception:  # noqa: BLE001
                    logger.exception("workflow_job_complete_hook_failed job_id=%s", job_id)

    def job_public_view(self, job: WorkflowJob | None) -> dict | None:
        return job_public_view(job)

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for job in self._jobs.values():
                if job.status in {"queued", "running"}:
                    job.cancel_requested = True
        self._executor.shutdown(wait=wait, cancel_futures=not wait)


class RedisWorkflowQueue:
    """Redis-backed shared queue with processing lease + dead-letter support."""

    backend_name = "redis"

    def __init__(
        self,
        redis_url: str,
        *,
        queue_key: str = "workspace:workflow:queue",
        processing_key: str = "workspace:workflow:processing",
        dead_letter_key: str = "workspace:workflow:dead",
        job_key_prefix: str = "workspace:workflow:job:",
        scope_key_prefix: str = "workspace:workflow:scope:",
        job_ttl_seconds: int = 60 * 60 * 24,
        step_delay_seconds: float = 0.0,
        visibility_timeout_seconds: int = 300,
        max_attempts: int = 3,
        redis_client: Any | None = None,
        worker_id: str | None = None,
    ) -> None:
        self.redis_url = redis_url
        self.queue_key = queue_key
        self.processing_key = processing_key
        self.dead_letter_key = dead_letter_key
        self.job_key_prefix = job_key_prefix
        self.scope_key_prefix = scope_key_prefix
        self.job_ttl_seconds = job_ttl_seconds
        self.step_delay_seconds = step_delay_seconds
        self.visibility_timeout_seconds = max(30, visibility_timeout_seconds)
        self.max_attempts = max(1, max_attempts)
        self.worker_id = worker_id or f"worker-{uuid4().hex[:8]}"
        self._redis = redis_client or self._connect(redis_url)

    @staticmethod
    def _connect(redis_url: str):
        try:
            import redis
        except ModuleNotFoundError as error:
            raise RuntimeError("redis package is required for WORKSPACE_QUEUE_BACKEND=redis") from error
        return redis.Redis.from_url(redis_url, decode_responses=True)

    def _job_key(self, job_id: str) -> str:
        return f"{self.job_key_prefix}{job_id}"

    def _scope_key(self, tenant_id: str, owner_id: str) -> str:
        return f"{self.scope_key_prefix}{tenant_id}:{owner_id}"

    def _save_job(self, job: WorkflowJob) -> None:
        payload = json.dumps(job.to_dict(), ensure_ascii=False)
        pipe = self._redis.pipeline()
        pipe.set(self._job_key(job.job_id), payload, ex=self.job_ttl_seconds)
        pipe.set(self._scope_key(job.tenant_id, job.owner_id), job.job_id, ex=self.job_ttl_seconds)
        pipe.execute()

    def _load_job(self, job_id: str) -> WorkflowJob | None:
        raw = self._redis.get(self._job_key(job_id))
        if not raw:
            return None
        try:
            return WorkflowJob.from_dict(json.loads(raw))
        except (TypeError, ValueError, KeyError):
            return None

    def _remove_from_processing(self, job_id: str) -> None:
        try:
            self._redis.lrem(self.processing_key, 0, job_id)
        except Exception:  # noqa: BLE001
            pass

    def requeue_stale(self) -> int:
        """Requeue jobs stuck in processing beyond the visibility timeout."""
        try:
            processing = list(self._redis.lrange(self.processing_key, 0, -1) or [])
        except Exception:  # noqa: BLE001
            return 0
        requeued = 0
        now = datetime.now(timezone.utc)
        for job_id in processing:
            job = self._load_job(str(job_id))
            if not job:
                self._remove_from_processing(str(job_id))
                continue
            if job.status not in {"queued", "running"}:
                self._remove_from_processing(str(job_id))
                continue
            claimed_raw = job.claimed_at or job.started_at
            if not claimed_raw:
                continue
            try:
                claimed_at = datetime.fromisoformat(str(claimed_raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            age = (now - claimed_at).total_seconds()
            if age < self.visibility_timeout_seconds:
                continue
            job.attempts = int(job.attempts or 0) + 1
            job.worker_id = None
            job.claimed_at = None
            if job.attempts >= job.max_attempts:
                job.status = "failed"
                job.last_error = job.last_error or "exceeded max attempts after worker lease timeout"
                job.finished_at = now.isoformat()
                self._save_job(job)
                self._remove_from_processing(job.job_id)
                try:
                    self._redis.lpush(self.dead_letter_key, job.job_id)
                except Exception:  # noqa: BLE001
                    pass
            else:
                job.status = "queued"
                job.last_error = "requeued after worker lease timeout"
                self._save_job(job)
                self._remove_from_processing(job.job_id)
                self._redis.lpush(self.queue_key, job.job_id)
                requeued += 1
        return requeued

    def get_job(self, tenant_id: str, owner_id: str) -> WorkflowJob | None:
        job_id = self._redis.get(self._scope_key(tenant_id, owner_id))
        if not job_id:
            return None
        return self._load_job(str(job_id))

    def is_active(self, tenant_id: str, owner_id: str) -> bool:
        job = self.get_job(tenant_id, owner_id)
        return bool(job and job.status in {"queued", "running"})

    def request_cancel(self, tenant_id: str, owner_id: str) -> bool:
        job = self.get_job(tenant_id, owner_id)
        if not job or job.status not in {"queued", "running"}:
            return False
        job.cancel_requested = True
        self._save_job(job)
        return True

    def submit(
        self,
        *,
        tenant_id: str,
        owner_id: str,
        action: str,
        run_step: Callable[[], dict] | None = None,
        should_continue: Callable[[dict], bool] | None = None,
        on_complete: Callable[[WorkflowJob, dict | None], None] | None = None,
    ) -> WorkflowJob:
        del run_step, should_continue, on_complete  # Redis worker reconstructs execution path.
        existing = self.get_job(tenant_id, owner_id)
        if existing and existing.status in {"queued", "running"}:
            return existing

        job = WorkflowJob(
            job_id=f"job-{uuid4().hex[:12]}",
            tenant_id=tenant_id,
            owner_id=owner_id,
            action=action,
            status="queued",
            backend=self.backend_name,
            max_attempts=self.max_attempts,
        )
        self._save_job(job)
        self._redis.lpush(self.queue_key, job.job_id)
        return job

    def claim_next(self, *, timeout_seconds: int = 5) -> WorkflowJob | None:
        self.requeue_stale()
        # Prefer reliable handoff: move into processing list, then ACK on complete.
        job_id = None
        if hasattr(self._redis, "brpoplpush"):
            job_id = self._redis.brpoplpush(self.queue_key, self.processing_key, timeout=max(1, timeout_seconds))
        else:
            item = self._redis.brpop(self.queue_key, timeout=max(1, timeout_seconds))
            if item:
                _, job_id = item
                try:
                    self._redis.lpush(self.processing_key, str(job_id))
                except Exception:  # noqa: BLE001
                    pass
        if not job_id:
            return None
        job = self._load_job(str(job_id))
        if not job:
            self._remove_from_processing(str(job_id))
            return None
        if job.cancel_requested:
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc).isoformat()
            self._save_job(job)
            self._remove_from_processing(job.job_id)
            return None
        if job.status not in {"queued", "running"}:
            self._remove_from_processing(job.job_id)
            return None
        job.status = "running"
        job.attempts = int(job.attempts or 0) + 1
        job.started_at = job.started_at or datetime.now(timezone.utc).isoformat()
        job.claimed_at = datetime.now(timezone.utc).isoformat()
        job.worker_id = self.worker_id
        self._save_job(job)
        return job

    def mark_step(self, job: WorkflowJob) -> WorkflowJob:
        latest = self._load_job(job.job_id) or job
        latest.steps = int(latest.steps) + 1
        latest.status = "running"
        latest.claimed_at = datetime.now(timezone.utc).isoformat()
        self._save_job(latest)
        return latest

    def is_cancel_requested(self, job_id: str) -> bool:
        job = self._load_job(job_id)
        return bool(job and job.cancel_requested)

    def complete(self, job: WorkflowJob, *, status: str, error: str | None = None) -> WorkflowJob:
        latest = self._load_job(job.job_id) or job
        if status == "failed" and int(latest.attempts or 0) < int(latest.max_attempts or self.max_attempts):
            latest.status = "queued"
            latest.last_error = error
            latest.claimed_at = None
            latest.worker_id = None
            self._save_job(latest)
            self._remove_from_processing(latest.job_id)
            self._redis.lpush(self.queue_key, latest.job_id)
            return latest

        latest.status = status
        latest.last_error = error
        latest.finished_at = datetime.now(timezone.utc).isoformat()
        latest.claimed_at = None
        self._save_job(latest)
        self._remove_from_processing(latest.job_id)
        if status == "failed":
            try:
                self._redis.lpush(self.dead_letter_key, latest.job_id)
            except Exception:  # noqa: BLE001
                pass
        return latest

    def job_public_view(self, job: WorkflowJob | None) -> dict | None:
        return job_public_view(job)

    def shutdown(self, wait: bool = False) -> None:
        del wait
        try:
            self._redis.close()
        except Exception:  # noqa: BLE001
            pass


def create_workflow_queue(
    *,
    backend: str = "memory",
    redis_url: str | None = None,
    step_delay_seconds: float = 0.0,
    max_workers: int = 2,
    redis_client: Any | None = None,
) -> WorkflowQueue:
    normalized = (backend or "memory").strip().lower()
    if normalized == "redis":
        if not redis_url and redis_client is None:
            raise RuntimeError("WORKSPACE_REDIS_URL is required when WORKSPACE_QUEUE_BACKEND=redis")
        return RedisWorkflowQueue(
            redis_url or "redis://127.0.0.1:6379/0",
            step_delay_seconds=step_delay_seconds,
            redis_client=redis_client,
        )
    return MemoryWorkflowRunner(max_workers=max_workers, step_delay_seconds=step_delay_seconds)


# Backward-compatible aliases used by existing imports/tests.
WorkflowRunner = MemoryWorkflowRunner
