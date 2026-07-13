import sys
from argparse import Namespace
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.app import create_app
from backend_py.config import configure_logging, load_settings
from backend_py.security import validate_production_settings


def run_migrations(database_url: str | None) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    if database_url:
        config.cmd_opts = Namespace(x=[f"database_url={database_url}"])
    command.upgrade(config, "head")


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level, json_logs=settings.json_logs)
    report = validate_production_settings(
        auth_required=settings.auth_required,
        auth_secret=settings.auth_secret,
        admin_api_key=settings.admin_api_key,
        credentials_secret=settings.credentials_secret,
        cors_origins=settings.cors_origins,
        seed_demo_data=False,
    )
    if settings.production_mode and settings.enforce_production_security and not report.ok:
        raise SystemExit("production security validation failed: " + "; ".join(report.errors))
    if settings.run_migrations_on_start:
        run_migrations(settings.database_url)
    app = create_app(
        api_key=settings.api_key,
        admin_api_key=settings.admin_api_key,
        base_url=settings.model_base_url,
        model=settings.model_name,
        database_url=settings.database_url,
        seed_demo_data=False,
        model_timeout_seconds=settings.timeout_seconds,
        enable_audit_events=settings.enable_audit_events,
        cors_origins=settings.cors_origins,
        max_request_body_bytes=settings.max_request_body_bytes,
        rate_limit_per_minute=settings.rate_limit_per_minute,
        artifact_dir=settings.artifact_dir,
        default_user_id=settings.default_user_id,
        default_tenant_id=settings.default_tenant_id,
        auth_secret=settings.auth_secret,
        auth_token_minutes=settings.auth_token_minutes,
        auth_required=settings.auth_required,
        workflow_async=settings.workflow_async,
        workflow_step_delay_ms=settings.workflow_step_delay_ms,
        metrics_enabled=settings.metrics_enabled,
        queue_backend=settings.queue_backend,
        redis_url=settings.redis_url,
        error_tracking_enabled=settings.error_tracking_enabled,
        sentry_dsn=settings.sentry_dsn,
        sentry_environment=settings.sentry_environment,
        sentry_traces_sample_rate=settings.sentry_traces_sample_rate,
        alert_webhook_url=settings.alert_webhook_url,
        alert_min_level=settings.alert_min_level,
        rate_limit_backend=settings.rate_limit_backend,
        credentials_secret=settings.credentials_secret,
        production_mode=settings.production_mode,
        enforce_production_security=settings.enforce_production_security,
        enable_hsts=settings.enable_hsts,
        content_security_policy=settings.content_security_policy,
        artifact_backend=settings.artifact_backend,
        s3_bucket=settings.s3_bucket,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_access_key=settings.s3_access_key,
        s3_secret_key=settings.s3_secret_key,
        s3_region=settings.s3_region,
        s3_prefix=settings.s3_prefix,
        web_fetch_timeout_seconds=settings.web_fetch_timeout_seconds,
        web_fetch_max_bytes=settings.web_fetch_max_bytes,
        web_table_max_rows=settings.web_table_max_rows,
        web_text_max_chars=settings.web_text_max_chars,
    )
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
