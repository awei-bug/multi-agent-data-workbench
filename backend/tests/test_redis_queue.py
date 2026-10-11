from __future__ import annotations

import time
import unittest
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.repository import create_repository
from backend_py.workflow_runner import RedisWorkflowQueue, create_workflow_queue
from backend_py.workflow_worker import process_job


class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.lists: dict[str, deque[str]] = defaultdict(deque)
        self.expiry: dict[str, float] = {}

    def set(self, key: str, value: str, ex: int | None = None):
        self.kv[key] = value
        if ex is not None:
            self.expiry[key] = time.time() + ex
        return True

    def get(self, key: str):
        expires = self.expiry.get(key)
        if expires is not None and expires < time.time():
            self.kv.pop(key, None)
            self.expiry.pop(key, None)
            return None
        return self.kv.get(key)

    def lpush(self, key: str, value: str):
        self.lists[key].appendleft(value)
        return len(self.lists[key])

    def brpop(self, key: str, timeout: int = 0):
        del timeout
        if not self.lists[key]:
            return None
        return key, self.lists[key].pop()

    def brpoplpush(self, source: str, destination: str, timeout: int = 0):
        del timeout
        if not self.lists[source]:
            return None
        value = self.lists[source].pop()
        self.lists[destination].appendleft(value)
        return value

    def lrange(self, key: str, start: int, end: int):
        values = list(self.lists.get(key, deque()))
        if end == -1:
            end = len(values) - 1
        if not values:
            return []
        return values[start : end + 1]

    def lrem(self, key: str, count: int, value: str):
        items = list(self.lists.get(key, deque()))
        removed = 0
        next_items: list[str] = []
        for item in items:
            if item == value and (count == 0 or removed < abs(count)):
                removed += 1
                continue
            next_items.append(item)
        self.lists[key] = deque(next_items)
        return removed

    def pipeline(self):
        return FakeRedisPipeline(self)

    def close(self):
        return None


class FakeRedisPipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self.redis = redis
        self.ops: list[tuple] = []

    def set(self, key: str, value: str, ex: int | None = None):
        self.ops.append(("set", key, value, ex))
        return self

    def execute(self):
        for op in self.ops:
            if op[0] == "set":
                self.redis.set(op[1], op[2], ex=op[3])
        return [True for _ in self.ops]


class FakeChatClient:
    def __init__(self) -> None:
        self.api_key = "fake"

    async def complete(self, prompt: str) -> str:
        return "redis queue summary"


class RedisQueueTest(unittest.TestCase):
    def test_create_memory_backend_by_default(self) -> None:
        queue = create_workflow_queue(backend="memory")
        self.assertEqual(queue.backend_name, "memory")
        queue.shutdown(wait=False)

    def test_redis_queue_enqueue_claim_and_complete(self) -> None:
        fake = FakeRedis()
        queue = RedisWorkflowQueue("redis://fake", redis_client=fake)
        job = queue.submit(tenant_id="tenant-a", owner_id="user-a", action="start")
        self.assertEqual(job.status, "queued")
        self.assertTrue(queue.is_active("tenant-a", "user-a"))

        claimed = queue.claim_next(timeout_seconds=1)
        self.assertIsNotNone(claimed)
        assert claimed is not None
        self.assertEqual(claimed.job_id, job.job_id)
        self.assertEqual(claimed.status, "running")

        stepped = queue.mark_step(claimed)
        self.assertEqual(stepped.steps, 1)
        done = queue.complete(stepped, status="succeeded")
        self.assertEqual(done.status, "succeeded")
        self.assertFalse(queue.is_active("tenant-a", "user-a"))

        view = queue.job_public_view(queue.get_job("tenant-a", "user-a"))
        self.assertEqual(view["backend"], "redis")
        self.assertEqual(view["status"], "succeeded")
        queue.shutdown(wait=False)


    def test_stale_requeue_does_not_double_count_attempt(self) -> None:
        fake = FakeRedis()
        queue = RedisWorkflowQueue("redis://fake", redis_client=fake, max_attempts=3, visibility_timeout_seconds=30)
        queue.submit(tenant_id="tenant-a", owner_id="user-a", action="start")
        claimed = queue.claim_next(timeout_seconds=1)
        assert claimed is not None
        self.assertEqual(claimed.attempts, 1)

        claimed.claimed_at = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        queue._save_job(claimed)
        self.assertEqual(queue.requeue_stale(), 1)
        requeued = queue.get_job("tenant-a", "user-a")
        assert requeued is not None
        self.assertEqual(requeued.status, "queued")
        self.assertEqual(requeued.attempts, 1)

        claimed_again = queue.claim_next(timeout_seconds=1)
        assert claimed_again is not None
        self.assertEqual(claimed_again.attempts, 2)

    def test_renew_lease_requires_matching_running_worker(self) -> None:
        fake = FakeRedis()
        queue = RedisWorkflowQueue("redis://fake", redis_client=fake, worker_id="worker-a")
        queue.submit(tenant_id="tenant-a", owner_id="user-a", action="start")
        claimed = queue.claim_next(timeout_seconds=1)
        assert claimed is not None
        original_claimed_at = claimed.claimed_at
        time.sleep(0.002)

        self.assertFalse(queue.renew_lease(claimed.job_id, "worker-b"))
        self.assertTrue(queue.renew_lease(claimed.job_id, "worker-a"))
        renewed = queue.get_job("tenant-a", "user-a")
        assert renewed is not None
        self.assertGreater(
            datetime.fromisoformat(renewed.claimed_at),
            datetime.fromisoformat(original_claimed_at),
        )
        queue.complete(renewed, status="succeeded")
        self.assertFalse(queue.renew_lease(renewed.job_id, "worker-a"))

    def test_public_view_exposes_retry_and_lease_diagnostics(self) -> None:
        fake = FakeRedis()
        queue = RedisWorkflowQueue("redis://fake", redis_client=fake, worker_id="worker-a", max_attempts=4)
        queue.submit(tenant_id="tenant-a", owner_id="user-a", action="start")
        claimed = queue.claim_next(timeout_seconds=1)
        assert claimed is not None

        view = queue.job_public_view(claimed)
        self.assertEqual(view["attempts"], 1)
        self.assertEqual(view["maxAttempts"], 4)
        self.assertEqual(view["workerId"], "worker-a")
        self.assertIsNotNone(view["claimedAt"])

    def test_worker_renews_lease_during_long_step(self) -> None:
        class FastHeartbeatQueue(RedisWorkflowQueue):
            renewals = 0

            @property
            def lease_heartbeat_interval_seconds(self) -> float:
                return 0.01

            def renew_lease(self, job_id: str, worker_id: str | None = None) -> bool:
                self.renewals += 1
                return super().renew_lease(job_id, worker_id)

        class SlowRepository:
            def advance_workflow(self, chat_client):
                del chat_client
                time.sleep(0.04)
                return {"id": "task-1", "snapshot": {"phase": "completed"}}

            def set_execution_meta(self, payload):
                self.execution = payload

            def add_audit_event(self, *args):
                self.audit = args

        class Metrics:
            def observe_workflow_job(self, status: str, steps: int = 0) -> None:
                self.status = status
                self.steps = steps

        fake = FakeRedis()
        queue = FastHeartbeatQueue("redis://fake", redis_client=fake, worker_id="worker-a")
        queue.submit(tenant_id="tenant-a", owner_id="user-a", action="start")
        claimed = queue.claim_next(timeout_seconds=1)
        assert claimed is not None
        result = process_job(
            queue,
            claimed,
            repository_factory=SlowRepository,
            chat_client=FakeChatClient(),
            metrics=Metrics(),
        )

        self.assertEqual(result.status, "succeeded")
        self.assertGreaterEqual(queue.renewals, 1)

    def test_api_enqueue_and_worker_process_with_redis_backend(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "workspace.sqlite3"
            fake = FakeRedis()
            queue = RedisWorkflowQueue("redis://fake", redis_client=fake, step_delay_seconds=0.0)
            app = create_app(
                api_key="test-key",
                base_url="https://apihub.agnes-ai.com/v1",
                model="Agnes 2.0 Flash",
                repository_path=str(db_path),
                seed_demo_data=False,
                workflow_async=True,
                queue_backend="redis",
                redis_url="redis://fake",
                workflow_queue=queue,
                chat_client=FakeChatClient(),
            )
            client = TestClient(app)

            uploaded = client.post(
                "/api/data-source/upload",
                files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
            ).json()
            client.post(f"/api/tasks/active/dataset/{uploaded['id']}")
            client.patch("/api/active-task", json={"request": "按区域汇总", "name": "redis-job"})
            started = client.post("/api/workflow/action", json={"action": "start"})
            self.assertEqual(started.status_code, 200)
            payload = started.json()
            self.assertEqual(payload["execution"]["backend"], "redis")
            self.assertEqual(payload["execution"]["status"], "queued")
            self.assertEqual(payload["snapshot"]["phase"], "running")

            claimed = queue.claim_next(timeout_seconds=1)
            self.assertIsNotNone(claimed)

            class Metrics:
                def observe_workflow_job(self, status: str, steps: int = 0) -> None:
                    self.status = status
                    self.steps = steps

            metrics = Metrics()
            process_job(
                queue,
                claimed,
                repository_factory=lambda: create_repository(db_path=str(db_path), seed_demo_data=False),
                chat_client=FakeChatClient(),
                metrics=metrics,
                step_delay_seconds=0.0,
            )

            current = client.get("/api/workflow/jobs/current").json()
            self.assertEqual(current["job"]["status"], "succeeded")
            self.assertIn(current["task"]["snapshot"]["phase"], {"completed", "needs_review"})
            self.assertEqual(metrics.status, "succeeded")
            self.assertGreaterEqual(metrics.steps, 1)

            # health exposes queue backend
            health = client.get("/api/health").json()
            self.assertEqual(health["queue"]["backend"], "redis")

            client.close()
            queue.shutdown(wait=False)


if __name__ == "__main__":
    unittest.main()
