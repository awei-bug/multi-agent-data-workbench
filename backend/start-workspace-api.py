import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.app import create_app


def main() -> None:
    api_key = (
        os.getenv("AGNES_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("APIHUB_API_KEY")
    )
    if not api_key:
        raise RuntimeError("Missing Agnes API key in environment")

    port = int(os.getenv("WORKSPACE_API_PORT", "8787"))
    host = os.getenv("WORKSPACE_API_HOST", "127.0.0.1")
    database_url = os.getenv("WORKSPACE_DATABASE_URL")
    timeout_seconds = float(os.getenv("WORKSPACE_MODEL_TIMEOUT_SECONDS", "60"))
    enable_audit_events = os.getenv("WORKSPACE_ENABLE_AUDIT_EVENTS", "true").lower() != "false"
    cors_origins = [
        origin.strip()
        for origin in os.getenv("WORKSPACE_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ] or None
    app = create_app(
        api_key=api_key,
        base_url="https://apihub.agnes-ai.com/v1",
        model="Agnes 2.0 Flash",
        database_url=database_url,
        model_timeout_seconds=timeout_seconds,
        enable_audit_events=enable_audit_events,
        cors_origins=cors_origins,
    )
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
