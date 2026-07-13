from __future__ import annotations

import logging
import signal
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.agnes_client import create_agnes_client
from backend_py.config import configure_logging, load_settings
from backend_py.error_tracking import init_error_tracking
from backend_py.observability import get_metrics
from backend_py.repository import create_repository
from backend_py.workflow_runner import RedisWorkflowQueue, create_workflow_queue
from backend_py.workflow_worker import process_job

logger = logging.getLogger("workspace_workflow_worker")


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level, json_logs=settings.json_logs)
    if settings.queue_backend != "redis":
        raise SystemExit("WORKSPACE_QUEUE_BACKEND must be redis for worker process")

    error_tracker = init_error_tracking(
        enabled=settings.error_tracking_enabled,
        sentry_dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        alert_webhook_url=settings.alert_webhook_url,
        alert_min_level=settings.alert_min_level,
    )

    queue = create_workflow_queue(
        backend="redis",
        redis_url=settings.redis_url,
        step_delay_seconds=settings.workflow_step_delay_ms / 1000.0,
    )
    if not isinstance(queue, RedisWorkflowQueue):
        raise SystemExit("failed to create redis workflow queue")

    def repository_factory():
        return create_repository(
            database_url=settings.database_url,
            seed_demo_data=False,
            db_path=None if settings.database_url else "workspace.sqlite3",
        )

    chat_client = create_agnes_client(
        api_key=settings.api_key,
        base_url=settings.model_base_url,
        model=settings.model_name,
        timeout_seconds=settings.timeout_seconds,
    )
    metrics = get_metrics()
    stop = False

    def _handle_signal(signum, frame):  # noqa: ANN001
        del signum, frame
        nonlocal stop
        stop = True
        logger.info("workflow_worker_stopping")

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("workflow_worker_started redis=%s", settings.redis_url)
    while not stop:
        job = queue.claim_next(timeout_seconds=2)
        if not job:
            continue
        logger.info(
            "workflow_job_claimed job_id=%s tenant_id=%s owner_id=%s",
            job.job_id,
            job.tenant_id,
            job.owner_id,
        )
        finished = process_job(
            queue,
            job,
            repository_factory=repository_factory,
            chat_client=chat_client,
            metrics=metrics,
            error_tracker=error_tracker,
            step_delay_seconds=settings.workflow_step_delay_ms / 1000.0,
        )
        logger.info(
            "workflow_job_finished job_id=%s status=%s steps=%s",
            finished.job_id,
            finished.status,
            finished.steps,
        )

    queue.shutdown(wait=False)
    logger.info("workflow_worker_stopped")


if __name__ == "__main__":
    main()
