from __future__ import annotations

import httpx


class ModelCallError(RuntimeError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(f"{kind}: {message}")
        self.kind = kind


class AgnesChatClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    async def complete(self, prompt: str) -> str:
        last_error: ModelCallError | None = None
        async with httpx.AsyncClient(timeout=self.timeout_seconds, transport=self.transport) as client:
            for attempt in range(2):
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
                    )
                    if response.status_code >= 500:
                        raise ModelCallError("temporary_http_error", f"HTTP {response.status_code}")
                    response.raise_for_status()
                    payload = response.json()
                    return payload["choices"][0]["message"]["content"]
                except httpx.TimeoutException as error:
                    last_error = ModelCallError("timeout", str(error))
                except (KeyError, IndexError, TypeError, ValueError) as error:
                    raise ModelCallError("invalid_response", str(error)) from error
                except httpx.HTTPStatusError as error:
                    raise ModelCallError("http_error", f"HTTP {error.response.status_code}") from error
                except ModelCallError as error:
                    last_error = error
                    if attempt == 1:
                        raise

        raise last_error or ModelCallError("unknown", "model call failed")


def create_agnes_client(api_key: str, base_url: str, model: str, timeout_seconds: float = 60.0) -> AgnesChatClient:
    return AgnesChatClient(api_key=api_key, base_url=base_url, model=model, timeout_seconds=timeout_seconds)
