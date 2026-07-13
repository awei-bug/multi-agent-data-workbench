from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from backend_py.observability import configure_logging as configure_observability_logging
from backend_py.security import is_production_mode


@dataclass(frozen=True)
class RuntimeSettings:
    api_key: str
    admin_api_key: str
    host: str
    port: int
    model_base_url: str
    model_name: str
    database_url: str | None
    timeout_seconds: float
    enable_audit_events: bool
    max_request_body_bytes: int
    rate_limit_per_minute: int
    cors_origins: list[str] | None
    artifact_dir: str
    default_user_id: str
    default_tenant_id: str
    log_level: str
    run_migrations_on_start: bool
    auth_secret: str
    auth_token_minutes: int
    auth_required: bool
    workflow_async: bool
    workflow_step_delay_ms: int
    json_logs: bool
    metrics_enabled: bool
    queue_backend: str
    redis_url: str | None
    sentry_dsn: str | None
    sentry_environment: str
    sentry_traces_sample_rate: float
    alert_webhook_url: str | None
    alert_min_level: str
    error_tracking_enabled: bool
    rate_limit_backend: str
    credentials_secret: str
    production_mode: bool
    enforce_production_security: bool
    enable_hsts: bool
    content_security_policy: str | None
    artifact_backend: str
    s3_bucket: str | None
    s3_endpoint_url: str | None
    s3_access_key: str | None
    s3_secret_key: str | None
    s3_region: str
    s3_prefix: str
    web_fetch_timeout_seconds: float
    web_fetch_max_bytes: int
    web_table_max_rows: int
    web_text_max_chars: int
    oidc_enabled: bool
    oidc_issuer: str
    oidc_client_id: str
    oidc_client_secret: str
    oidc_redirect_uri: str
    oidc_scopes: str
    oidc_authorize_url: str
    oidc_token_url: str
    oidc_userinfo_url: str
    export_watermark_enabled: bool
    export_mask_sensitive: bool
    retention_history_days: int
    retention_dataset_days: int
    retention_artifact_days: int
    retention_audit_days: int


def configure_logging(level: str, *, json_logs: bool = False) -> None:
    configure_observability_logging(level, json_logs=json_logs)


def load_settings(env: Mapping[str, str] | None = None) -> RuntimeSettings:
    values = os.environ if env is None else env
    api_key = values.get("AGNES_API_KEY") or values.get("OPENAI_API_KEY") or values.get("APIHUB_API_KEY") or ""

    cors_origins = [origin.strip() for origin in values.get("WORKSPACE_CORS_ORIGINS", "").split(",") if origin.strip()]
    production_mode = is_production_mode(dict(values))
    auth_secret = values.get("WORKSPACE_AUTH_SECRET", "").strip()
    if not auth_secret and not production_mode:
        # Deterministic local default keeps single-node demos working; override in production.
        auth_secret = "local-dev-only-change-me"
    credentials_secret = values.get("WORKSPACE_CREDENTIALS_SECRET", "").strip() or auth_secret
    queue_backend = (values.get("WORKSPACE_QUEUE_BACKEND", "memory") or "memory").strip().lower()
    if queue_backend not in {"memory", "redis"}:
        queue_backend = "memory"
    rate_limit_backend = (values.get("WORKSPACE_RATE_LIMIT_BACKEND") or queue_backend or "memory").strip().lower()
    if rate_limit_backend not in {"memory", "redis"}:
        rate_limit_backend = "memory"
    alert_min_level = (values.get("WORKSPACE_ALERT_MIN_LEVEL", "error") or "error").strip().lower()
    if alert_min_level not in {"warning", "error", "fatal", "critical"}:
        alert_min_level = "error"
    artifact_backend = (values.get("WORKSPACE_ARTIFACT_BACKEND", "local") or "local").strip().lower()
    if artifact_backend not in {"local", "s3", "minio"}:
        artifact_backend = "local"
    auth_required_raw = values.get("WORKSPACE_AUTH_REQUIRED")
    if auth_required_raw is None:
        auth_required = production_mode
    else:
        auth_required = auth_required_raw.lower() == "true"

    return RuntimeSettings(
        api_key=api_key,
        admin_api_key=values.get("WORKSPACE_ADMIN_API_KEY", ""),
        host=values.get("WORKSPACE_API_HOST", "127.0.0.1"),
        port=int(values.get("WORKSPACE_API_PORT", "8787")),
        model_base_url=values.get("WORKSPACE_MODEL_BASE_URL", "https://apihub.agnes-ai.com/v1"),
        model_name=values.get("WORKSPACE_MODEL_NAME", "Agnes 2.0 Flash"),
        database_url=values.get("WORKSPACE_DATABASE_URL"),
        timeout_seconds=float(values.get("WORKSPACE_MODEL_TIMEOUT_SECONDS", "60")),
        enable_audit_events=values.get("WORKSPACE_ENABLE_AUDIT_EVENTS", "true").lower() != "false",
        max_request_body_bytes=int(values.get("WORKSPACE_MAX_REQUEST_BODY_BYTES", "10000000")),
        rate_limit_per_minute=int(values.get("WORKSPACE_RATE_LIMIT_PER_MINUTE", "120")),
        cors_origins=cors_origins or None,
        artifact_dir=values.get("WORKSPACE_ARTIFACT_DIR", "workspace-artifacts"),
        default_user_id=values.get("WORKSPACE_DEFAULT_USER_ID", "local-user"),
        default_tenant_id=values.get("WORKSPACE_DEFAULT_TENANT_ID", "local-tenant"),
        log_level=values.get("WORKSPACE_LOG_LEVEL", "INFO"),
        run_migrations_on_start=values.get("WORKSPACE_RUN_MIGRATIONS_ON_START", "true").lower() != "false",
        auth_secret=auth_secret,
        auth_token_minutes=int(values.get("WORKSPACE_AUTH_TOKEN_MINUTES", "720")),
        auth_required=auth_required,
        workflow_async=values.get("WORKSPACE_WORKFLOW_ASYNC", "true").lower() != "false",
        workflow_step_delay_ms=int(values.get("WORKSPACE_WORKFLOW_STEP_DELAY_MS", "0")),
        json_logs=values.get("WORKSPACE_JSON_LOGS", "false").lower() == "true",
        metrics_enabled=values.get("WORKSPACE_METRICS_ENABLED", "true").lower() != "false",
        queue_backend=queue_backend,
        redis_url=values.get("WORKSPACE_REDIS_URL") or None,
        sentry_dsn=values.get("WORKSPACE_SENTRY_DSN") or None,
        sentry_environment=values.get("WORKSPACE_SENTRY_ENVIRONMENT", "local"),
        sentry_traces_sample_rate=float(values.get("WORKSPACE_SENTRY_TRACES_SAMPLE_RATE", "0")),
        alert_webhook_url=values.get("WORKSPACE_ALERT_WEBHOOK_URL") or None,
        alert_min_level=alert_min_level,
        error_tracking_enabled=values.get("WORKSPACE_ERROR_TRACKING_ENABLED", "true").lower() != "false",
        rate_limit_backend=rate_limit_backend,
        credentials_secret=credentials_secret,
        production_mode=production_mode,
        enforce_production_security=values.get("WORKSPACE_ENFORCE_PRODUCTION_SECURITY", "true").lower() != "false",
        enable_hsts=values.get("WORKSPACE_ENABLE_HSTS", "true" if production_mode else "false").lower() == "true",
        content_security_policy=values.get("WORKSPACE_CONTENT_SECURITY_POLICY") or None,
        artifact_backend=artifact_backend,
        s3_bucket=values.get("WORKSPACE_S3_BUCKET") or None,
        s3_endpoint_url=values.get("WORKSPACE_S3_ENDPOINT_URL") or None,
        s3_access_key=values.get("WORKSPACE_S3_ACCESS_KEY") or None,
        s3_secret_key=values.get("WORKSPACE_S3_SECRET_KEY") or None,
        s3_region=values.get("WORKSPACE_S3_REGION", "us-east-1"),
        s3_prefix=values.get("WORKSPACE_S3_PREFIX", "workspace-artifacts"),
        web_fetch_timeout_seconds=float(values.get("WORKSPACE_WEB_FETCH_TIMEOUT_SECONDS", "20")),
        web_fetch_max_bytes=int(values.get("WORKSPACE_WEB_FETCH_MAX_BYTES", "5000000")),
        web_table_max_rows=int(values.get("WORKSPACE_WEB_TABLE_MAX_ROWS", "1000")),
        web_text_max_chars=int(values.get("WORKSPACE_WEB_TEXT_MAX_CHARS", "200000")),
        oidc_enabled=values.get("WORKSPACE_OIDC_ENABLED", "false").lower() == "true",
        oidc_issuer=values.get("WORKSPACE_OIDC_ISSUER", "").strip(),
        oidc_client_id=values.get("WORKSPACE_OIDC_CLIENT_ID", "").strip(),
        oidc_client_secret=values.get("WORKSPACE_OIDC_CLIENT_SECRET", "").strip(),
        oidc_redirect_uri=values.get("WORKSPACE_OIDC_REDIRECT_URI", "").strip(),
        oidc_scopes=values.get("WORKSPACE_OIDC_SCOPES", "openid profile email").strip() or "openid profile email",
        oidc_authorize_url=values.get("WORKSPACE_OIDC_AUTHORIZE_URL", "").strip(),
        oidc_token_url=values.get("WORKSPACE_OIDC_TOKEN_URL", "").strip(),
        oidc_userinfo_url=values.get("WORKSPACE_OIDC_USERINFO_URL", "").strip(),
        export_watermark_enabled=values.get("WORKSPACE_EXPORT_WATERMARK", "true").lower() != "false",
        export_mask_sensitive=values.get("WORKSPACE_EXPORT_MASK_SENSITIVE", "true").lower() != "false",
        retention_history_days=int(values.get("WORKSPACE_RETENTION_HISTORY_DAYS", "0")),
        retention_dataset_days=int(values.get("WORKSPACE_RETENTION_DATASET_DAYS", "0")),
        retention_artifact_days=int(values.get("WORKSPACE_RETENTION_ARTIFACT_DAYS", "0")),
        retention_audit_days=int(values.get("WORKSPACE_RETENTION_AUDIT_DAYS", "0")),
    )
