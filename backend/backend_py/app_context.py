from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from backend_py.auth import AuthUser, EphemeralStateStore, LoginAttemptGuard, TokenRevocationStore
from backend_py.oidc import OidcSettings
from backend_py.repository import TaskRepository


@dataclass
class AppContext:
    """Shared runtime dependencies for route modules extracted from create_app."""

    repo: TaskRepository
    client: Any
    store: Any
    workflow_runner: Any
    metrics: Any
    tracker: Any
    limiter: Any
    login_guard: LoginAttemptGuard
    revocation_store: TokenRevocationStore
    oidc_state_store: EphemeralStateStore
    oidc_settings: OidcSettings
    security_report: Any

    auth_secret: str
    auth_token_minutes: int
    auth_refresh_days: int
    auth_required: bool
    allow_open_registration: bool
    allow_self_tenant: bool
    metrics_public: bool
    metrics_enabled: bool
    password_complexity: bool
    production_mode: bool
    enable_hsts: bool
    content_security_policy: str | None
    admin_api_key: str
    default_user_id: str
    default_tenant_id: str
    workflow_async: bool
    rate_limit_backend: str
    rate_limit_per_minute: int
    max_request_body_bytes: int
    artifact_backend: str
    enable_audit_events: bool
    export_watermark_enabled: bool
    export_mask_sensitive: bool
    retention_history_days: int
    retention_dataset_days: int
    retention_artifact_days: int
    retention_audit_days: int
    credentials_secret: str
    web_fetch_timeout_seconds: float
    web_fetch_max_bytes: int
    web_table_max_rows: int
    web_text_max_chars: int
    model_timeout_seconds: float
    api_key: str
    base_url: str
    model: str

    open_paths: set[str] = field(default_factory=set)
    public_user: Callable[[AuthUser | dict], dict] | None = None
    issue_token_for_user: Callable[[dict], dict] | None = None
    auth_json_response: Callable[..., Any] | None = None
    clear_auth_cookies: Callable[[Any], None] | None = None
    set_auth_cookies: Callable[[Any, dict], None] | None = None
    require_permission: Callable[..., None] | None = None
    require_admin_access: Callable[..., None] | None = None
    resolve_scope: Callable[..., tuple[str, str, AuthUser | None]] | None = None
    assert_token_active: Callable[[dict], None] | None = None
