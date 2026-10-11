import asyncio
import unittest

import httpx

from backend_py.agnes_client import AgnesChatClient, ModelCallError, ModelCircuitBreaker


def success_response(request: httpx.Request, content: str = "ok") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]}, request=request)


class AgnesClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_retries_temporary_http_failure_once(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(503, json={"error": "busy"}, request=request)
            return success_response(request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            backoff_base_seconds=0,
        )

        self.assertEqual(await client.complete("hello"), "ok")
        self.assertEqual(calls, 2)

    async def test_429_honors_retry_after_before_retrying(self) -> None:
        calls = 0
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(429, headers={"Retry-After": "2"}, request=request)
            return success_response(request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            sleep_func=fake_sleep,
            random_func=lambda low, high: high,
        )

        self.assertEqual(await client.complete("hello"), "ok")
        self.assertEqual(calls, 2)
        self.assertEqual(sleeps, [2.0])

    async def test_retries_408_425_and_transport_errors(self) -> None:
        for failure in (408, 425, "transport"):
            with self.subTest(failure=failure):
                calls = 0

                def handler(request: httpx.Request) -> httpx.Response:
                    nonlocal calls
                    calls += 1
                    if calls == 1:
                        if failure == "transport":
                            raise httpx.ConnectError("offline", request=request)
                        return httpx.Response(failure, request=request)
                    return success_response(request)

                client = AgnesChatClient(
                    "key",
                    "https://example.test/v1",
                    "model",
                    transport=httpx.MockTransport(handler),
                    backoff_base_seconds=0,
                )
                self.assertEqual(await client.complete("hello"), "ok")
                self.assertEqual(calls, 2)

    async def test_non_retryable_4xx_is_not_retried(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(400, request=request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            max_attempts=4,
            backoff_base_seconds=0,
        )

        with self.assertLogs("model_client", level="WARNING"):
            with self.assertRaisesRegex(ModelCallError, "http_error"):
                await client.complete("hello")
        self.assertEqual(calls, 1)
        self.assertEqual(client.resilience_snapshot()["circuitBreaker"]["consecutiveFailures"], 0)

    async def test_full_jitter_uses_exponential_cap(self) -> None:
        sleeps: list[float] = []
        random_bounds: list[tuple[float, float]] = []
        calls = 0

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        def fake_random(low: float, high: float) -> float:
            random_bounds.append((low, high))
            return high

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls < 3:
                return httpx.Response(503, request=request)
            return success_response(request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            max_attempts=3,
            backoff_base_seconds=0.5,
            backoff_max_seconds=8,
            sleep_func=fake_sleep,
            random_func=fake_random,
        )

        self.assertEqual(await client.complete("hello"), "ok")
        self.assertEqual(random_bounds, [(0.0, 0.5), (0.0, 1.0)])
        self.assertEqual(sleeps, [0.5, 1.0])

    async def test_total_deadline_stops_before_another_attempt(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(503, request=request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            max_attempts=5,
            total_timeout_seconds=0.01,
            backoff_base_seconds=1,
            backoff_max_seconds=1,
            random_func=lambda low, high: high,
        )

        with self.assertLogs("model_client", level="WARNING"):
            with self.assertRaisesRegex(ModelCallError, "deadline_exceeded"):
                await client.complete("hello")
        self.assertEqual(calls, 1)

    async def test_circuit_opens_then_half_open_probe_closes_it(self) -> None:
        calls = 0
        healthy = False

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if healthy:
                return success_response(request, "recovered")
            return httpx.Response(503, request=request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            max_attempts=1,
            circuit_failure_threshold=2,
            circuit_recovery_seconds=0.02,
            backoff_base_seconds=0,
        )

        for _ in range(2):
            with self.assertLogs("model_client", level="WARNING"):
                with self.assertRaises(ModelCallError):
                    await client.complete("hello")
        self.assertEqual(client.resilience_snapshot()["circuitBreaker"]["state"], "open")

        with self.assertRaisesRegex(ModelCallError, "circuit_open"):
            await client.complete("hello")
        self.assertEqual(calls, 2)

        await asyncio.sleep(0.03)
        healthy = True
        self.assertEqual(await client.complete("hello"), "recovered")
        snapshot = client.resilience_snapshot()
        self.assertEqual(snapshot["circuitBreaker"]["state"], "closed")
        self.assertEqual(snapshot["circuitBreaker"]["consecutiveFailures"], 0)

    async def test_half_open_allows_only_one_probe(self) -> None:
        breaker = ModelCircuitBreaker(failure_threshold=1, recovery_seconds=0.01)
        breaker.before_call()
        breaker.record_failure()
        await asyncio.sleep(0.02)
        breaker.before_call()
        with self.assertRaisesRegex(ModelCallError, "probe already in progress"):
            breaker.before_call()
        breaker.record_success()
        self.assertEqual(breaker.snapshot()["state"], "closed")

    async def test_non_retryable_half_open_result_releases_probe(self) -> None:
        breaker = ModelCircuitBreaker(failure_threshold=1, recovery_seconds=0)
        breaker.before_call()
        breaker.record_failure()
        breaker.before_call()
        breaker.record_ignored_failure()
        breaker.before_call()
        breaker.record_success()
        self.assertEqual(breaker.snapshot()["state"], "closed")

    async def test_logs_successful_model_call(self) -> None:
        transport = httpx.MockTransport(lambda request: success_response(request))
        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=transport)

        with self.assertLogs("model_client", level="INFO") as logs:
            await client.complete("hello")

        self.assertIn("model_call status=success", logs.output[0])
        self.assertIn("model=model", logs.output[0])

    async def test_logs_failed_model_call_kind(self) -> None:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": []}, request=request))
        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=transport)

        with self.assertLogs("model_client", level="WARNING") as logs:
            with self.assertRaises(ModelCallError):
                await client.complete("hello")

        self.assertIn("model_call status=failed", logs.output[0])
        self.assertIn("error_kind=invalid_response", logs.output[0])

    async def test_classifies_timeout(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("slow", request=request)

        client = AgnesChatClient(
            "key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            backoff_base_seconds=0,
        )

        with self.assertLogs("model_client", level="WARNING"):
            with self.assertRaisesRegex(ModelCallError, "timeout"):
                await client.complete("hello")


if __name__ == "__main__":
    unittest.main()
