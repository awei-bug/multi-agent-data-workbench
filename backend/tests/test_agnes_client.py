import unittest

import httpx

from backend_py.agnes_client import AgnesChatClient, ModelCallError


class AgnesClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_retries_temporary_http_failure_once(self) -> None:
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(503, json={"error": "busy"}, request=request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=request)

        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=httpx.MockTransport(handler))

        self.assertEqual(await client.complete("hello"), "ok")
        self.assertEqual(calls, 2)

    async def test_logs_successful_model_call(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=request)
        )
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

    async def test_classifies_bad_model_payload(self) -> None:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": []}, request=request))
        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=transport)

        with self.assertLogs("model_client", level="WARNING"):
            with self.assertRaisesRegex(ModelCallError, "invalid_response"):
                await client.complete("hello")

    async def test_classifies_timeout(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("slow", request=request)

        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=httpx.MockTransport(handler))

        with self.assertLogs("model_client", level="WARNING"):
            with self.assertRaisesRegex(ModelCallError, "timeout"):
                await client.complete("hello")


if __name__ == "__main__":
    unittest.main()
