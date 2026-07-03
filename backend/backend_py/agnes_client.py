from __future__ import annotations

import logging
import time

import httpx

logger = logging.getLogger("model_client")


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
        started_at = time.perf_counter()
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
                    content = payload["choices"][0]["message"]["content"]
                    logger.info(
                        "model_call status=success model=%s attempt=%s duration_ms=%s",
                        self.model,
                        attempt + 1,
                        round((time.perf_counter() - started_at) * 1000, 2),
                    )
                    return content
                except httpx.TimeoutException as error:
                    last_error = ModelCallError("timeout", str(error))
                except (KeyError, IndexError, TypeError, ValueError) as error:
                    model_error = ModelCallError("invalid_response", str(error))
                    self._log_failure(model_error, attempt + 1, started_at)
                    raise model_error from error
                except httpx.HTTPStatusError as error:
                    model_error = ModelCallError("http_error", f"HTTP {error.response.status_code}")
                    self._log_failure(model_error, attempt + 1, started_at)
                    raise model_error from error
                except ModelCallError as error:
                    last_error = error
                    if attempt == 1:
                        self._log_failure(error, attempt + 1, started_at)
                        raise

        final_error = last_error or ModelCallError("unknown", "model call failed")
        self._log_failure(final_error, 2, started_at)
        raise final_error

    def _log_failure(self, error: ModelCallError, attempt: int, started_at: float) -> None:
        logger.warning(
            "model_call status=failed model=%s attempt=%s duration_ms=%s error_kind=%s",
            self.model,
            attempt,
            round((time.perf_counter() - started_at) * 1000, 2),
            error.kind,
        )


def create_agnes_client(api_key: str, base_url: str, model: str, timeout_seconds: float = 60.0) -> AgnesChatClient:
    return AgnesChatClient(api_key=api_key, base_url=base_url, model=model, timeout_seconds=timeout_seconds)
