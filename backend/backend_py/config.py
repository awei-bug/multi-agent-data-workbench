from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class RuntimeSettings:
    api_key: str
    host: str
    port: int
    database_url: str | None
    timeout_seconds: float
    enable_audit_events: bool
    max_request_body_bytes: int
    cors_origins: list[str] | None


def load_settings(env: Mapping[str, str] | None = None) -> RuntimeSettings:
    values = os.environ if env is None else env
    api_key = values.get("AGNES_API_KEY") or values.get("OPENAI_API_KEY") or values.get("APIHUB_API_KEY")
    if not api_key:
        raise RuntimeError("Missing model API key. Set AGNES_API_KEY, OPENAI_API_KEY, or APIHUB_API_KEY.")

    cors_origins = [origin.strip() for origin in values.get("WORKSPACE_CORS_ORIGINS", "").split(",") if origin.strip()]

    return RuntimeSettings(
        api_key=api_key,
        host=values.get("WORKSPACE_API_HOST", "127.0.0.1"),
        port=int(values.get("WORKSPACE_API_PORT", "8787")),
        database_url=values.get("WORKSPACE_DATABASE_URL"),
        timeout_seconds=float(values.get("WORKSPACE_MODEL_TIMEOUT_SECONDS", "60")),
        enable_audit_events=values.get("WORKSPACE_ENABLE_AUDIT_EVENTS", "true").lower() != "false",
        max_request_body_bytes=int(values.get("WORKSPACE_MAX_REQUEST_BODY_BYTES", "2000000")),
        cors_origins=cors_origins or None,
    )
