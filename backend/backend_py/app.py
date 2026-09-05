from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from backend_py.agnes_client import AgnesChatClient, create_agnes_client
from backend_py.artifact_store import ArtifactStore, create_artifact_store
from backend_py.auth import (
    ACCESS_COOKIE_NAME,
    AuthError,
    AuthUser,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    EphemeralStateStore,
    LoginAttemptGuard,
    PERMISSION_ADMIN,
    PERMISSION_READ,
    PERMISSION_WRITE,
    REFRESH_COOKIE_NAME,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_LOCAL,
    ROLE_VIEWER,
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_DOWNLOAD,
    TOKEN_TYPE_REFRESH,
    TOKEN_TYPE_STREAM,
    TokenRevocationStore,
    create_access_token,
    create_ephemeral_token,
    create_refresh_token,
    decode_access_token,
    has_permission,
    hash_password,
    is_write_method,
    normalize_role,
    permissions_for_role,
    public_auth_paths,
    user_from_token_payload,
    validate_password,
    validate_username,
    verify_password,
)
from backend_py.compliance import (
    apply_html_watermark,
    apply_text_watermark,
    build_watermark_lines,
    mask_text,
)
from backend_py.connectors import (
    ConnectorError,
    build_connector_data_source,
    decrypt_credentials,
    encrypt_credentials,
    fetch_connector_payload,
    list_connector_types,
    public_connection_view,
    test_connection,
)
from backend_py.data_source_ingest import ingest_data_source
from backend_py.error_tracking import get_error_tracker, init_error_tracking
from backend_py.observability import get_metrics
from backend_py.rate_limit import create_rate_limiter, rate_limit_key
from backend_py.repository import TaskRepository, create_repository, get_workspace_scope, reset_workspace_scope, set_workspace_scope
from backend_py.security import security_headers, validate_production_settings
from backend_py.upload_security import UploadSecurityError, validate_upload
from backend_py.oidc import (
    OidcError,
    OidcSettings,
    build_authorize_url,
    create_pkce_pair,
    exchange_code_for_tokens,
    fetch_userinfo,
    normalize_oidc_profile,
)
from backend_py.workflow_runner import create_workflow_queue, attach_execution_meta

logger = logging.getLogger("workspace_api")


from backend_py.schemas import (
    ActiveTaskUpdate,
    AuthLoginRequest,
    AuthLogoutRequest,
    AuthPasswordResetConfirm,
    AuthPasswordResetRequest,
    AuthRefreshRequest,
    AuthRegisterRequest,
    ConnectionImportRequest,
    ConnectionTestRequest,
    ConnectionUpsertRequest,
    DataSourceIngestRequest,
    ExportRequest,
    IntentRequest,
    InviteAcceptRequest,
    OrganizationCreateRequest,
    OrganizationInviteRequest,
    OrganizationMemberRoleRequest,
    OrganizationShareResourceRequest,
    OrganizationShareTemplateRequest,
    RoleUpdateRequest,
    TaskCorrectionRequest,
    TemplateDraftRequest,
    WorkflowActionRequest,
)
from backend_py.api_helpers import (
    add_security_headers as _add_security_headers,
    audit as _audit,
    build_agentic_intent as _build_agentic_intent,
    data_source_context as _data_source_context,
    error_response as _error_response,
    field_names as _field_names,
)
from backend_py.app_context import AppContext
from backend_py.routes.ops import register_ops_routes
from backend_py.routes.auth import register_auth_routes
from backend_py.routes.orgs import register_org_routes
from backend_py.routes.workflow import register_workflow_routes
from backend_py.routes.data import register_data_routes



def create_app(
    api_key: str,
    base_url: str,
    model: str,
    repository: TaskRepository | None = None,
    chat_client: AgnesChatClient | None = None,
    repository_path: str | None = None,
    database_url: str | None = None,
    admin_api_key: str = "",
    seed_demo_data: bool = True,
    model_timeout_seconds: float = 60.0,
    enable_audit_events: bool = True,
    cors_origins: list[str] | None = None,
    artifact_dir: str = "workspace-artifacts",
    max_request_body_bytes: int = 10_000_000,
    rate_limit_per_minute: int = 120,
    default_user_id: str = "local-user",
    default_tenant_id: str = "local-tenant",
    auth_secret: str = "local-dev-only-change-me",
    auth_token_minutes: int = 30,
    auth_refresh_days: int = 14,
    auth_required: bool = False,
    allow_open_registration: bool = True,
    allow_self_tenant: bool = True,
    metrics_public: bool = True,
    password_complexity: bool = False,
    login_max_failures: int = 8,
    login_lockout_seconds: int = 900,
    workflow_async: bool = False,
    workflow_step_delay_ms: int = 0,
    metrics_enabled: bool = True,
    queue_backend: str = "memory",
    redis_url: str | None = None,
    workflow_queue=None,
    error_tracking_enabled: bool = True,
    sentry_dsn: str | None = None,
    sentry_environment: str = "local",
    sentry_traces_sample_rate: float = 0.0,
    alert_webhook_url: str | None = None,
    alert_min_level: str = "error",
    error_tracker=None,
    rate_limit_backend: str = "memory",
    rate_limiter=None,
    credentials_secret: str = "local-dev-only-change-me",
    production_mode: bool = False,
    enforce_production_security: bool = True,
    enable_hsts: bool = False,
    content_security_policy: str | None = None,
    artifact_backend: str = "local",
    s3_bucket: str | None = None,
    s3_endpoint_url: str | None = None,
    s3_access_key: str | None = None,
    s3_secret_key: str | None = None,
    s3_region: str = "us-east-1",
    s3_prefix: str = "workspace-artifacts",
    web_fetch_timeout_seconds: float = 20.0,
    web_fetch_max_bytes: int = 5_000_000,
    web_table_max_rows: int = 1000,
    web_text_max_chars: int = 200_000,
    oidc_enabled: bool = False,
    oidc_issuer: str = "",
    oidc_client_id: str = "",
    oidc_client_secret: str = "",
    oidc_redirect_uri: str = "",
    oidc_scopes: str = "openid profile email",
    oidc_authorize_url: str = "",
    oidc_token_url: str = "",
    oidc_userinfo_url: str = "",
    export_watermark_enabled: bool = True,
    export_mask_sensitive: bool = True,
    retention_history_days: int = 0,
    retention_dataset_days: int = 0,
    retention_artifact_days: int = 0,
    retention_audit_days: int = 0,
) -> FastAPI:
    security_report = validate_production_settings(
        auth_required=auth_required,
        auth_secret=auth_secret,
        admin_api_key=admin_api_key,
        credentials_secret=credentials_secret,
        cors_origins=cors_origins,
        seed_demo_data=seed_demo_data,
        env={"WORKSPACE_PRODUCTION_MODE": "true" if production_mode else "false"},
    )
    if security_report.production_mode and enforce_production_security and not security_report.ok:
        raise RuntimeError(
            "production security validation failed: " + "; ".join(security_report.errors)
        )
    for warning in security_report.warnings:
        logger.warning("security_warning %s", warning)

    app = FastAPI()
    # Rate limiting supports memory (single instance) or redis (shared multi-instance).
    workflow_runner = workflow_queue or create_workflow_queue(
        backend=queue_backend,
        redis_url=redis_url,
        step_delay_seconds=max(0.0, workflow_step_delay_ms / 1000.0),
        max_workers=2,
    )
    app.state.workflow_runner = workflow_runner
    metrics = get_metrics()
    app.state.metrics = metrics
    tracker = error_tracker or init_error_tracking(
        enabled=error_tracking_enabled,
        sentry_dsn=sentry_dsn,
        environment=sentry_environment,
        traces_sample_rate=sentry_traces_sample_rate,
        alert_webhook_url=alert_webhook_url,
        alert_min_level=alert_min_level,
    )
    app.state.error_tracker = tracker
    limiter = rate_limiter or create_rate_limiter(
        backend=rate_limit_backend,
        redis_url=redis_url,
    )
    app.state.rate_limiter = limiter
    app.state.security_report = security_report
    allowed_origins = cors_origins or (
        []
        if production_mode
        else [
            "http://127.0.0.1:4173",
            "http://localhost:4173",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:5174",
            "http://localhost:5174",
            "http://127.0.0.1:5175",
            "http://localhost:5175",
        ]
    )
    open_paths = public_auth_paths() | {"/api/auth/oidc/login", "/api/auth/oidc/callback", "/api/auth/oidc/status"}
    if metrics_public:
        open_paths = open_paths | {"/metrics", "/api/metrics"}
    login_guard = LoginAttemptGuard(max_failures=login_max_failures, window_seconds=login_lockout_seconds)
    revocation_store = TokenRevocationStore()
    oidc_state_store = EphemeralStateStore()
    if redis_url:
        try:
            import redis as redis_lib

            shared_redis = redis_lib.Redis.from_url(redis_url, decode_responses=True)
            revocation_store = TokenRevocationStore(shared_redis)
            oidc_state_store = EphemeralStateStore(shared_redis)
        except Exception:  # noqa: BLE001
            logger.warning("auth_state_redis_unavailable falling_back_to_memory")
    app.state.login_guard = login_guard
    app.state.token_revocation = revocation_store
    app.state.oidc_state_store = oidc_state_store
    oidc_settings = OidcSettings(
        enabled=bool(oidc_enabled and oidc_issuer and oidc_client_id and oidc_redirect_uri),
        issuer=oidc_issuer,
        client_id=oidc_client_id,
        client_secret=oidc_client_secret,
        redirect_uri=oidc_redirect_uri,
        scopes=oidc_scopes or "openid profile email",
        authorize_url=oidc_authorize_url,
        token_url=oidc_token_url,
        userinfo_url=oidc_userinfo_url,
    )
    app.state.oidc_settings = oidc_settings

    def _public_user(user: AuthUser | dict) -> dict:
        if isinstance(user, AuthUser):
            role = user.role
            return {
                "id": user.id,
                "username": user.username,
                "tenantId": user.tenant_id,
                "displayName": user.display_name,
                "role": role,
                "permissions": permissions_for_role(role),
            }
        role = user["role"]
        return {
            "id": user["id"],
            "username": user["username"],
            "tenantId": user["tenantId"],
            "displayName": user["displayName"],
            "role": role,
            "permissions": permissions_for_role(role),
        }

    def _issue_token_for_user(user: dict) -> dict:
        auth_user = AuthUser(
            id=user["id"],
            username=user["username"],
            tenant_id=user["tenantId"],
            display_name=user["displayName"],
            role=user["role"],
        )
        session_id = f"sid-{uuid4().hex}"
        access_token = create_access_token(
            user=auth_user,
            secret=auth_secret,
            expires_minutes=auth_token_minutes,
            session_id=session_id,
        )
        refresh_token = create_refresh_token(
            user=auth_user,
            secret=auth_secret,
            expires_days=auth_refresh_days,
            session_id=session_id,
        )
        return {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "tokenType": "Bearer",
            "expiresInMinutes": auth_token_minutes,
            "refreshExpiresInDays": auth_refresh_days,
            "user": _public_user(auth_user),
            "sessionId": session_id,
        }

    def _cookie_secure() -> bool:
        return bool(production_mode or enable_hsts)

    def _cookie_samesite() -> str:
        # Lax keeps first-party navigation working while still blocking most CSRF.
        return "lax"

    def _set_auth_cookies(response: Response, issued: dict) -> None:
        secure = _cookie_secure()
        samesite = _cookie_samesite()
        response.set_cookie(
            key=ACCESS_COOKIE_NAME,
            value=str(issued["accessToken"]),
            max_age=max(60, int(auth_token_minutes) * 60),
            httponly=True,
            secure=secure,
            samesite=samesite,
            path="/",
        )
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=str(issued["refreshToken"]),
            max_age=max(3600, int(auth_refresh_days) * 86400),
            httponly=True,
            secure=secure,
            samesite=samesite,
            path="/api/auth",
        )
        # Double-submit CSRF token (readable by JS, validated on cookie-auth writes).
        import secrets as _secrets

        csrf = _secrets.token_urlsafe(24)
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=csrf,
            max_age=max(3600, int(auth_refresh_days) * 86400),
            httponly=False,
            secure=secure,
            samesite=samesite,
            path="/",
        )
        response.headers["x-csrf-token"] = csrf

    def _clear_auth_cookies(response: Response) -> None:
        for name, path in (
            (ACCESS_COOKIE_NAME, "/"),
            (REFRESH_COOKIE_NAME, "/api/auth"),
            (CSRF_COOKIE_NAME, "/"),
        ):
            response.delete_cookie(key=name, path=path)

    def _auth_json_response(issued: dict, *, status_code: int = 200) -> JSONResponse:
        # Prefer cookie transport; still return tokens for API clients/tests.
        response = JSONResponse(status_code=status_code, content=issued)
        _set_auth_cookies(response, issued)
        return response

    def _extract_bearer_token(request: Request) -> str | None:
        authorization = (request.headers.get("authorization") or "").strip()
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
            return token or None
        cookie_token = (request.cookies.get(ACCESS_COOKIE_NAME) or "").strip()
        if cookie_token:
            return cookie_token
        # Long-lived access tokens must not travel in query strings.
        # Only short-lived stream/download tickets are accepted via ticket=.
        ticket = (request.query_params.get("ticket") or "").strip()
        return ticket or None

    def _assert_csrf_if_cookie_auth(request: Request, token_source: str) -> None:
        """Require CSRF header when auth comes from cookie (not Authorization header)."""
        if token_source != "cookie":
            return
        if not is_write_method(request.method):
            return
        # Auth bootstrap endpoints manage their own cookies.
        if request.url.path.startswith("/api/auth/"):
            return
        cookie_csrf = (request.cookies.get(CSRF_COOKIE_NAME) or "").strip()
        header_csrf = (request.headers.get(CSRF_HEADER_NAME) or request.headers.get("X-CSRF-Token") or "").strip()
        if not cookie_csrf or not header_csrf or cookie_csrf != header_csrf:
            raise AuthError("csrf token missing or invalid", "csrf_failed")

    def _assert_token_active(payload: dict) -> None:
        jti = str(payload.get("jti") or "")
        sid = str(payload.get("sid") or "")
        if revocation_store.is_revoked(jti) or revocation_store.is_revoked(sid):
            raise AuthError("token has been revoked", "token_revoked")

    def _resolve_scope(request: Request) -> tuple[str, str, AuthUser | None]:
        authorization = (request.headers.get("authorization") or "").strip()
        cookie_token = (request.cookies.get(ACCESS_COOKIE_NAME) or "").strip()
        ticket = (request.query_params.get("ticket") or "").strip()
        token = None
        token_source = "none"
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip() or None
            token_source = "header"
        elif cookie_token:
            token = cookie_token
            token_source = "cookie"
        elif ticket:
            token = ticket
            token_source = "ticket"

        if token:
            path = request.url.path
            expected_types = {TOKEN_TYPE_ACCESS}
            if path.endswith("/stream") or "/jobs/stream" in path:
                expected_types = {TOKEN_TYPE_ACCESS, TOKEN_TYPE_STREAM}
            elif path.endswith("/download"):
                expected_types = {TOKEN_TYPE_ACCESS, TOKEN_TYPE_DOWNLOAD}
            payload = decode_access_token(token, auth_secret, expected_types=expected_types)
            _assert_token_active(payload)
            _assert_csrf_if_cookie_auth(request, token_source)
            auth_user = user_from_token_payload(payload)
            return auth_user.tenant_id, auth_user.id, auth_user

        if auth_required and request.url.path not in open_paths:
            raise AuthError("authentication required", "auth_required")

        tenant_id = (
            request.headers.get("x-workspace-tenant-id")
            or request.query_params.get("workspaceTenantId")
            or default_tenant_id
        ).strip() or default_tenant_id
        owner_id = (
            request.headers.get("x-workspace-user-id")
            or request.query_params.get("workspaceUserId")
            or default_user_id
        ).strip() or default_user_id
        return tenant_id, owner_id, None

    def _effective_role(request: Request) -> str:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is not None:
            return auth_user.role
        if auth_required:
            return ROLE_VIEWER
        return ROLE_LOCAL

    def require_permission(request: Request, permission: str) -> None:
        role = _effective_role(request)
        if not has_permission(role, permission):
            raise HTTPException(status_code=403, detail=f"{permission} permission required")

    def require_admin_access(request: Request) -> None:
        """Accept either a valid admin API key or an authenticated admin role."""
        if admin_api_key:
            provided = (request.headers.get("x-admin-api-key") or "").strip()
            if provided == admin_api_key:
                return
            if provided:
                raise HTTPException(status_code=403, detail="admin api key required")
            auth_user = getattr(request.state, "auth_user", None)
            if auth_user is not None and has_permission(auth_user.role, PERMISSION_ADMIN):
                return
            raise HTTPException(status_code=403, detail="admin api key or admin role required")
        require_permission(request, PERMISSION_ADMIN)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", str(uuid4()))
        code = f"http_{exc.status_code}"
        message = "请求失败"
        details: dict = {}
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code") or code)
            message = str(exc.detail.get("message") or message)
            raw_details = exc.detail.get("details")
            if isinstance(raw_details, dict):
                details = raw_details
        elif isinstance(exc.detail, str):
            message = exc.detail
        return _error_response(
            request_id=request_id,
            status_code=exc.status_code,
            code=code,
            message=message,
            details=details,
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", str(uuid4()))
        return _error_response(
            request_id=request_id,
            status_code=422,
            code="request_validation_failed",
            message="提交内容不完整或格式不正确，请检查用户名和密码",
            details={"errors": exc.errors()},
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )

    @app.middleware("http")
    async def request_log_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        request.state.auth_user = None
        try:
            tenant_id, owner_id, auth_user = _resolve_scope(request)
        except AuthError as error:
            status_code = 401
            metrics.observe_auth_failure()
            metrics.observe_request(
                method=request.method,
                path=request.url.path,
                status_code=status_code,
                duration_ms=0.0,
            )
            return _error_response(
                request_id=request_id,
                status_code=status_code,
                code=error.code,
                message=error.message,
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )

        request.state.auth_user = auth_user
        scope_token = set_workspace_scope(tenant_id, owner_id)
        try:
            started_at = time.perf_counter()
            client_host = request.client.host if request.client else "unknown"
            limit_key = rate_limit_key(
                client_host=client_host,
                tenant_id=tenant_id,
                user_id=owner_id if auth_user is not None else None,
            )
            decision = limiter.allow(limit_key, limit=rate_limit_per_minute, window_seconds=60)
            if rate_limit_per_minute > 0 and not decision.allowed:
                metrics.observe_rate_limited()
                metrics.observe_request(
                    method=request.method,
                    path=request.url.path,
                    status_code=429,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
                )
                return _error_response(
                    request_id=request_id,
                    status_code=429,
                    code="rate_limit_exceeded",
                    message="too many requests",
                    details={
                        "retryAfterSeconds": decision.retry_after_seconds,
                        "limit": decision.limit,
                        "backend": decision.backend,
                    },
                    extra_headers={
                        "retry-after": str(decision.retry_after_seconds),
                        "x-ratelimit-limit": str(decision.limit),
                        "x-ratelimit-remaining": "0",
                        "x-ratelimit-backend": decision.backend,
                    },
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > max_request_body_bytes:
                metrics.observe_request(
                    method=request.method,
                    path=request.url.path,
                    status_code=413,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
                )
                return _error_response(
                    request_id=request_id,
                    status_code=413,
                    code="request_too_large",
                    message="request body too large",
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )
            if request.url.path not in open_paths and is_write_method(request.method):
                role = auth_user.role if auth_user else (ROLE_VIEWER if auth_required else ROLE_LOCAL)
                if not has_permission(role, PERMISSION_WRITE):
                    metrics.observe_request(
                        method=request.method,
                        path=request.url.path,
                        status_code=403,
                        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
                    )
                    return _error_response(
                        request_id=request_id,
                        status_code=403,
                        code="permission_denied",
                        message="write permission required",
                        details={"role": role, "required": PERMISSION_WRITE},
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )
            try:
                response = await call_next(request)
            except Exception as error:
                duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
                metrics.observe_request(
                    method=request.method,
                    path=request.url.path,
                    status_code=500,
                    duration_ms=duration_ms,
                )
                tracker.capture_exception(
                    error,
                    source="http.middleware",
                    context={
                        "requestId": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "tenantId": tenant_id,
                        "userId": owner_id,
                        "durationMs": duration_ms,
                    },
                )
                logger.exception(
                    "request_failed method=%s path=%s duration_ms=%s request_id=%s",
                    request.method,
                    request.url.path,
                    duration_ms,
                    request_id,
                    extra={
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "duration_ms": duration_ms,
                        "status": 500,
                        "tenant_id": tenant_id,
                        "user_id": owner_id,
                    },
                )
                return _error_response(
                    request_id=request_id,
                    status_code=500,
                    code="internal_server_error",
                    message="internal server error",
            enable_hsts=enable_hsts,
            csp=content_security_policy,
        )

            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            if metrics_enabled and request.url.path not in {"/metrics", "/api/metrics"}:
                metrics.observe_request(
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                )
            response.headers["x-request-id"] = request_id
            response.headers["x-workspace-tenant-id"] = tenant_id
            response.headers["x-workspace-user-id"] = owner_id
            response.headers["x-workspace-role"] = (
                auth_user.role if auth_user else (ROLE_VIEWER if auth_required else ROLE_LOCAL)
            )
            response.headers["x-ratelimit-limit"] = str(decision.limit)
            response.headers["x-ratelimit-remaining"] = str(decision.remaining)
            response.headers["x-ratelimit-backend"] = decision.backend
            _add_security_headers(response, enable_hsts=enable_hsts, csp=content_security_policy)
            log_method = logger.warning if response.status_code >= 500 else logger.info
            log_method(
                "request method=%s path=%s status=%s duration_ms=%s request_id=%s tenant_id=%s user_id=%s",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
                request_id,
                tenant_id,
                owner_id,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "tenant_id": tenant_id,
                    "user_id": owner_id,
                    "role": auth_user.role if auth_user else (ROLE_VIEWER if auth_required else ROLE_LOCAL),
                },
            )
            return response
        finally:
            reset_workspace_scope(scope_token)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    repo = repository or create_repository(
        db_path=repository_path,
        database_url=database_url,
        seed_demo_data=seed_demo_data,
    )
    client = chat_client or create_agnes_client(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=model_timeout_seconds,
    )
    store = create_artifact_store(
        backend=artifact_backend,
        artifact_dir=artifact_dir,
        s3_bucket=s3_bucket,
        s3_endpoint_url=s3_endpoint_url,
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key,
        s3_region=s3_region,
        s3_prefix=s3_prefix,
    )
    app.state.artifact_store = store
    app.state.artifact_backend = getattr(store, "backend", artifact_backend)

    # Modular route registration (ops extracted; more domains will follow).
    # Build a lightweight context bag for extracted routers.
    ctx = AppContext(
        repo=repo,
        client=client,
        store=store,
        workflow_runner=workflow_runner,
        metrics=metrics,
        tracker=tracker,
        limiter=limiter,
        login_guard=login_guard,
        revocation_store=revocation_store,
        oidc_state_store=oidc_state_store,
        oidc_settings=oidc_settings,
        security_report=security_report,
        auth_secret=auth_secret,
        auth_token_minutes=auth_token_minutes,
        auth_refresh_days=auth_refresh_days,
        auth_required=auth_required,
        allow_open_registration=allow_open_registration,
        allow_self_tenant=allow_self_tenant,
        metrics_public=metrics_public,
        metrics_enabled=metrics_enabled,
        password_complexity=password_complexity,
        production_mode=production_mode,
        enable_hsts=enable_hsts,
        content_security_policy=content_security_policy,
        admin_api_key=admin_api_key,
        default_user_id=default_user_id,
        default_tenant_id=default_tenant_id,
        workflow_async=workflow_async,
        rate_limit_backend=rate_limit_backend,
        rate_limit_per_minute=rate_limit_per_minute,
        max_request_body_bytes=max_request_body_bytes,
        artifact_backend=artifact_backend,
        enable_audit_events=enable_audit_events,
        export_watermark_enabled=export_watermark_enabled,
        export_mask_sensitive=export_mask_sensitive,
        retention_history_days=retention_history_days,
        retention_dataset_days=retention_dataset_days,
        retention_artifact_days=retention_artifact_days,
        retention_audit_days=retention_audit_days,
        credentials_secret=credentials_secret,
        web_fetch_timeout_seconds=web_fetch_timeout_seconds,
        web_fetch_max_bytes=web_fetch_max_bytes,
        web_table_max_rows=web_table_max_rows,
        web_text_max_chars=web_text_max_chars,
        model_timeout_seconds=model_timeout_seconds,
        api_key=api_key,
        base_url=base_url,
        model=model,
        open_paths=open_paths,
        public_user=_public_user,
        issue_token_for_user=_issue_token_for_user,
        auth_json_response=_auth_json_response,
        clear_auth_cookies=_clear_auth_cookies,
        set_auth_cookies=_set_auth_cookies,
        require_permission=require_permission,
        require_admin_access=require_admin_access,
        resolve_scope=_resolve_scope,
        assert_token_active=_assert_token_active,
    )
    register_ops_routes(app, ctx)
    register_auth_routes(app, ctx)
    register_org_routes(app, ctx)
    register_workflow_routes(app, ctx)
    register_data_routes(app, ctx)

    return app
