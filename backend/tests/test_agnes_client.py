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

    async def test_classifies_bad_model_payload(self) -> None:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": []}, request=request))
        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=transport)

        with self.assertRaisesRegex(ModelCallError, "invalid_response"):
            await client.complete("hello")

    async def test_classifies_timeout(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("slow", request=request)

        client = AgnesChatClient("key", "https://example.test/v1", "model", transport=httpx.MockTransport(handler))

        with self.assertRaisesRegex(ModelCallError, "timeout"):
            await client.complete("hello")


if __name__ == "__main__":
    unittest.main()
