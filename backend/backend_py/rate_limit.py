from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int
    backend: str
    key: str


class RateLimiter(Protocol):
    backend_name: str

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> RateLimitDecision: ...


class MemoryRateLimiter:
    """Process-local fixed-window limiter. Suitable for single-instance only."""

    backend_name = "memory"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._windows: dict[str, tuple[float, int]] = {}

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> RateLimitDecision:
        if limit <= 0:
            return RateLimitDecision(
                allowed=True,
                limit=limit,
                remaining=0,
                retry_after_seconds=0,
                backend=self.backend_name,
                key=key,
            )

        now = time.time()
        with self._lock:
            started_at, count = self._windows.get(key, (now, 0))
            if now - started_at >= window_seconds:
                started_at, count = now, 0
            count += 1
            self._windows[key] = (started_at, count)
            if count > limit:
                retry_after = max(1, int(window_seconds - (now - started_at)))
                return RateLimitDecision(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    retry_after_seconds=retry_after,
                    backend=self.backend_name,
                    key=key,
                )
            return RateLimitDecision(
                allowed=True,
                limit=limit,
                remaining=max(0, limit - count),
                retry_after_seconds=0,
                backend=self.backend_name,
                key=key,
            )


class RedisRateLimiter:
    """Shared fixed-window limiter backed by Redis INCR + EXPIRE."""

    backend_name = "redis"

    def __init__(
        self,
        redis_url: str,
        *,
        key_prefix: str = "workspace:rate:",
        redis_client: Any | None = None,
    ) -> None:
        self.redis_url = redis_url
        self.key_prefix = key_prefix
        self._redis = redis_client or self._connect(redis_url)

    @staticmethod
    def _connect(redis_url: str):
        try:
            import redis
        except ModuleNotFoundError as error:
            raise RuntimeError("redis package is required for WORKSPACE_RATE_LIMIT_BACKEND=redis") from error
        return redis.Redis.from_url(redis_url, decode_responses=True)

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> RateLimitDecision:
        if limit <= 0:
            return RateLimitDecision(
                allowed=True,
                limit=limit,
                remaining=0,
                retry_after_seconds=0,
                backend=self.backend_name,
                key=key,
            )

        bucket = int(time.time() // max(1, window_seconds))
        redis_key = f"{self.key_prefix}{key}:{bucket}"
        pipe = self._redis.pipeline()
        pipe.incr(redis_key, 1)
        pipe.expire(redis_key, max(1, window_seconds) + 1)
        count, _ = pipe.execute()
        count = int(count)
        if count > limit:
            ttl = self._redis.ttl(redis_key)
            retry_after = ttl if isinstance(ttl, int) and ttl > 0 else max(1, window_seconds)
            return RateLimitDecision(
                allowed=False,
                limit=limit,
                remaining=0,
                retry_after_seconds=int(retry_after),
                backend=self.backend_name,
                key=key,
            )
        return RateLimitDecision(
            allowed=True,
            limit=limit,
            remaining=max(0, limit - count),
            retry_after_seconds=0,
            backend=self.backend_name,
            key=key,
        )


def create_rate_limiter(
    *,
    backend: str = "memory",
    redis_url: str | None = None,
    redis_client: Any | None = None,
) -> RateLimiter:
    normalized = (backend or "memory").strip().lower()
    if normalized == "redis":
        if not redis_url and redis_client is None:
            raise RuntimeError("WORKSPACE_REDIS_URL is required when WORKSPACE_RATE_LIMIT_BACKEND=redis")
        return RedisRateLimiter(redis_url or "redis://127.0.0.1:6379/0", redis_client=redis_client)
    return MemoryRateLimiter()


def rate_limit_key(*, client_host: str, tenant_id: str | None = None, user_id: str | None = None) -> str:
    # Prefer authenticated identity when present so multi-instance tenants share budget fairly.
    if user_id and user_id not in {"", "local-user"}:
        return f"user:{(tenant_id or 'default')}:{user_id}"
    if tenant_id and tenant_id not in {"", "local-tenant"}:
        return f"tenant:{tenant_id}:{client_host or 'unknown'}"
    return f"ip:{client_host or 'unknown'}"
