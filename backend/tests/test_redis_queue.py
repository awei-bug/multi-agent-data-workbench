from __future__ import annotations

import time
import unittest
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
