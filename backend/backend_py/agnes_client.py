from __future__ import annotations

import asyncio
import logging
import random
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Awaitable, Callable

import httpx

logger = logging.getLogger("model_client")


class ModelCallError(RuntimeError):
    def __init__(
        self,
        kind: str,
        message: str,
        *,
        status_code: int | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(f"{kind}: {message}")
        self.kind = kind
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds


class ModelCircuitBreaker:
    """Thread-safe closed/open/half-open breaker shared by one model client."""

    def __init__(self, *, failure_threshold: int = 5, recovery_seconds: float = 30.0) -> None:
        self.failure_threshold = max(1, int(failure_threshold))
        self.recovery_seconds = max(0.0, float(recovery_seconds))
        self._lock = threading.RLock()
        self._state = "closed"
        self._consecutive_failures = 0
        self._opened_at: float | None = None
        self._half_open_probe_active = False

    def before_call(self) -> None:
        now = time.monotonic()
        with self._lock:
            if self._state == "closed":
                return
            if self._state == "open":
                elapsed = now - (self._opened_at or now)
                if elapsed < self.recovery_seconds:
                    remaining = max(0.0, self.recovery_seconds - elapsed)
                    raise ModelCallError(
                        "circuit_open",
                        f"model circuit is open; retry after {remaining:.2f}s",
                        retry_after_seconds=remaining,
                    )
                self._state = "half_open"
                self._half_open_probe_active = False
            if self._half_open_probe_active:
                raise ModelCallError("circuit_open", "model circuit half-open probe already in progress")
            self._half_open_probe_active = True

    def record_success(self) -> None:
        with self._lock:
            self._state = "closed"
            self._consecutive_failures = 0
            self._opened_at = None
            self._half_open_probe_active = False

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            self._half_open_probe_active = False
            if self._state == "half_open" or self._consecutive_failures >= self.failure_threshold:
                self._state = "open"
                self._opened_at = time.monotonic()

    def record_ignored_failure(self) -> None:
        """Release a half-open probe for caller errors that should not trip the breaker."""
        with self._lock:
            self._state = "closed"
            self._consecutive_failures = 0
            self._opened_at = None
            self._half_open_probe_active = False

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "state": self._state,
                "consecutiveFailures": self._consecutive_failures,
                "failureThreshold": self.failure_threshold,
                "recoverySeconds": self.recovery_seconds,
            }


class AgnesChatClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        max_attempts: int = 2,
        total_timeout_seconds: float | None = None,
        backoff_base_seconds: float = 0.5,
        backoff_max_seconds: float = 8.0,
        circuit_failure_threshold: int = 5,
        circuit_recovery_seconds: float = 30.0,
        sleep_func: Callable[[float], Awaitable[None]] | None = None,
        random_func: Callable[[float, float], float] | None = None,
        circuit_breaker: ModelCircuitBreaker | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = max(0.01, float(timeout_seconds))
        self.transport = transport
        self.max_attempts = max(1, int(max_attempts))
        self.total_timeout_seconds = max(
            0.01,
            float(total_timeout_seconds if total_timeout_seconds is not None else self.timeout_seconds * self.max_attempts),
        )
        self.backoff_base_seconds = max(0.0, float(backoff_base_seconds))
        self.backoff_max_seconds = max(0.0, float(backoff_max_seconds))
        self._sleep = sleep_func or asyncio.sleep
        self._random = random_func or random.uniform
        self.circuit_breaker = circuit_breaker or ModelCircuitBreaker(
            failure_threshold=circuit_failure_threshold,
            recovery_seconds=circuit_recovery_seconds,
        )

    async def complete(self, prompt: str) -> str:
        self.circuit_breaker.before_call()
        last_error: ModelCallError | None = None
        started_at = time.perf_counter()
        deadline = time.monotonic() + self.total_timeout_seconds

        async with httpx.AsyncClient(transport=self.transport) as client:
            for attempt in range(1, self.max_attempts + 1):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    last_error = ModelCallError("deadline_exceeded", "model call total deadline exceeded")
                    break
                request_timeout = min(self.timeout_seconds, remaining)
                try:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.2,
                        },
                        timeout=request_timeout,
                    )
                    retryable_error = self._response_error(response)
                    if retryable_error is not None:
                        raise retryable_error
                    response.raise_for_status()
                    payload = response.json()
                    content = payload["choices"][0]["message"]["content"]
                    if not isinstance(content, str):
                        raise TypeError("model content must be a string")
                    self.circuit_breaker.record_success()
                    logger.info(
                        "model_call status=success model=%s attempt=%s duration_ms=%s",
                        self.model,
                        attempt,
                        round((time.perf_counter() - started_at) * 1000, 2),
                    )
                    return content
                except httpx.TimeoutException as error:
                    last_error = ModelCallError("timeout", str(error))
                except httpx.TransportError as error:
                    last_error = ModelCallError("transport_error", str(error))
                except (KeyError, IndexError, TypeError, ValueError) as error:
                    model_error = ModelCallError("invalid_response", str(error))
                    self._finish_failure(model_error, attempt, started_at, count_for_circuit=False)
                    raise model_error from error
                except httpx.HTTPStatusError as error:
                    model_error = ModelCallError(
                        "http_error",
                        f"HTTP {error.response.status_code}",
                        status_code=error.response.status_code,
                    )
                    self._finish_failure(model_error, attempt, started_at, count_for_circuit=False)
                    raise model_error from error
                except ModelCallError as error:
                    last_error = error

                if last_error is None or attempt >= self.max_attempts:
                    break
                delay = self._retry_delay(attempt, last_error)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    last_error = ModelCallError("deadline_exceeded", "model call total deadline exceeded")
                    break
                if delay > 0:
                    await self._sleep(min(delay, remaining))

        final_error = last_error or ModelCallError("unknown", "model call failed")
        self._finish_failure(final_error, self.max_attempts, started_at, count_for_circuit=True)
        raise final_error

    @staticmethod
    def _response_error(response: httpx.Response) -> ModelCallError | None:
        status = response.status_code
        if status == 429:
            return ModelCallError(
                "rate_limited",
                "HTTP 429",
                status_code=status,
                retry_after_seconds=_parse_retry_after(response.headers.get("retry-after")),
            )
        if status in {408, 425} or status >= 500:
            return ModelCallError("temporary_http_error", f"HTTP {status}", status_code=status)
        return None

    def _retry_delay(self, attempt: int, error: ModelCallError) -> float:
        cap = min(self.backoff_max_seconds, self.backoff_base_seconds * (2 ** max(0, attempt - 1)))
        jittered = self._random(0.0, cap) if cap > 0 else 0.0
        return max(jittered, float(error.retry_after_seconds or 0.0))

    def _finish_failure(
        self,
        error: ModelCallError,
        attempt: int,
        started_at: float,
        *,
        count_for_circuit: bool,
    ) -> None:
        if count_for_circuit:
            self.circuit_breaker.record_failure()
        else:
            self.circuit_breaker.record_ignored_failure()
        self._log_failure(error, attempt, started_at)

    def _log_failure(self, error: ModelCallError, attempt: int, started_at: float) -> None:
        logger.warning(
            "model_call status=failed model=%s attempt=%s duration_ms=%s error_kind=%s status_code=%s",
            self.model,
            attempt,
            round((time.perf_counter() - started_at) * 1000, 2),
            error.kind,
            error.status_code,
        )

    def resilience_snapshot(self) -> dict[str, object]:
        return {
            "maxAttempts": self.max_attempts,
            "requestTimeoutSeconds": self.timeout_seconds,
            "totalTimeoutSeconds": self.total_timeout_seconds,
            "backoffBaseSeconds": self.backoff_base_seconds,
            "backoffMaxSeconds": self.backoff_max_seconds,
            "circuitBreaker": self.circuit_breaker.snapshot(),
        }


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value.strip()))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def create_agnes_client(
    api_key: str,
    base_url: str,
    model: str,
    timeout_seconds: float = 60.0,
    *,
    max_attempts: int = 2,
    total_timeout_seconds: float | None = None,
    backoff_base_seconds: float = 0.5,
    backoff_max_seconds: float = 8.0,
    circuit_failure_threshold: int = 5,
    circuit_recovery_seconds: float = 30.0,
) -> AgnesChatClient:
    return AgnesChatClient(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
        total_timeout_seconds=total_timeout_seconds,
        backoff_base_seconds=backoff_base_seconds,
        backoff_max_seconds=backoff_max_seconds,
        circuit_failure_threshold=circuit_failure_threshold,
        circuit_recovery_seconds=circuit_recovery_seconds,
    )
