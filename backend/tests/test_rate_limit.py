from __future__ import annotations

import unittest
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.rate_limit import MemoryRateLimiter, RedisRateLimiter, create_rate_limiter, rate_limit_key


class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.ttl_map: dict[str, int] = {}

    def pipeline(self):
        return FakeRedisPipeline(self)

    def ttl(self, key: str) -> int:
        return self.ttl_map.get(key, -1)

    def incr(self, key: str, amount: int = 1) -> int:
        value = int(self.kv.get(key, "0")) + amount
        self.kv[key] = str(value)
        return value

    def expire(self, key: str, seconds: int) -> bool:
        self.ttl_map[key] = seconds
        return True


class FakeRedisPipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self.redis = redis
        self.ops: list[tuple] = []

    def incr(self, key: str, amount: int = 1):
        self.ops.append(("incr", key, amount))
        return self

    def expire(self, key: str, seconds: int):
        self.ops.append(("expire", key, seconds))
        return self

    def execute(self):
        results = []
        for op in self.ops:
            if op[0] == "incr":
                results.append(self.redis.incr(op[1], op[2]))
            elif op[0] == "expire":
                results.append(self.redis.expire(op[1], op[2]))
        return results


class RateLimitUnitTest(unittest.TestCase):
    def test_memory_rate_limiter_blocks_after_limit(self) -> None:
        limiter = MemoryRateLimiter()
        self.assertTrue(limiter.allow("ip:1.1.1.1", limit=2).allowed)
        self.assertTrue(limiter.allow("ip:1.1.1.1", limit=2).allowed)
        blocked = limiter.allow("ip:1.1.1.1", limit=2)
        self.assertFalse(blocked.allowed)
        self.assertGreaterEqual(blocked.retry_after_seconds, 1)

    def test_redis_rate_limiter_is_shared(self) -> None:
        fake = FakeRedis()
        limiter_a = RedisRateLimiter("redis://fake", redis_client=fake)
        limiter_b = RedisRateLimiter("redis://fake", redis_client=fake)
        self.assertTrue(limiter_a.allow("user:t1:u1", limit=2).allowed)
        self.assertTrue(limiter_b.allow("user:t1:u1", limit=2).allowed)
        blocked = limiter_a.allow("user:t1:u1", limit=2)
        self.assertFalse(blocked.allowed)
        self.assertEqual(blocked.backend, "redis")

    def test_rate_limit_key_prefers_user(self) -> None:
        self.assertEqual(
            rate_limit_key(client_host="1.2.3.4", tenant_id="tenant-a", user_id="user-a"),
            "user:tenant-a:user-a",
        )
        self.assertEqual(rate_limit_key(client_host="1.2.3.4"), "ip:1.2.3.4")

    def test_create_rate_limiter_defaults_to_memory(self) -> None:
        limiter = create_rate_limiter(backend="memory")
        self.assertEqual(limiter.backend_name, "memory")


class RateLimitApiTest(unittest.TestCase):
    def test_health_reports_rate_limit_backend(self) -> None:
        with TemporaryDirectory() as temp_dir:
            app = create_app(
                api_key="test-key",
                base_url="https://apihub.agnes-ai.com/v1",
                model="Agnes 2.0 Flash",
                repository_path=str(Path(temp_dir) / "workspace.sqlite3"),
                seed_demo_data=False,
                rate_limit_backend="memory",
            )
            client = TestClient(app)
            payload = client.get("/api/health").json()
            self.assertEqual(payload["rateLimit"]["backend"], "memory")
            self.assertIn("x-ratelimit-backend", client.get("/api/health").headers)
            client.close()

    def test_redis_backend_can_be_injected(self) -> None:
        with TemporaryDirectory() as temp_dir:
            fake = FakeRedis()
            limiter = RedisRateLimiter("redis://fake", redis_client=fake)
            app = create_app(
                api_key="test-key",
                base_url="https://apihub.agnes-ai.com/v1",
                model="Agnes 2.0 Flash",
                repository_path=str(Path(temp_dir) / "workspace.sqlite3"),
                seed_demo_data=False,
                rate_limit_per_minute=2,
                rate_limit_backend="redis",
                rate_limiter=limiter,
            )
            client = TestClient(app)
            self.assertEqual(client.get("/api/health").status_code, 200)
            self.assertEqual(client.get("/api/health").status_code, 200)
            blocked = client.get("/api/health")
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers.get("x-ratelimit-backend"), "redis")
            self.assertEqual(blocked.json()["error"]["details"]["backend"], "redis")
            client.close()


if __name__ == "__main__":
    unittest.main()
