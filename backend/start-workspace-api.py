import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.app import create_app
from backend_py.config import load_settings


def main() -> None:
    settings = load_settings()
    app = create_app(
        api_key=settings.api_key,
        base_url="https://apihub.agnes-ai.com/v1",
        model="Agnes 2.0 Flash",
        database_url=settings.database_url,
        model_timeout_seconds=settings.timeout_seconds,
        enable_audit_events=settings.enable_audit_events,
        cors_origins=settings.cors_origins,
        max_request_body_bytes=settings.max_request_body_bytes,
        rate_limit_per_minute=settings.rate_limit_per_minute,
    )
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
