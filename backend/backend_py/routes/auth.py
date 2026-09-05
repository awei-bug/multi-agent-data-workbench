from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from backend_py.api_helpers import audit
from backend_py.app_context import AppContext
from backend_py.auth import (
    ACCESS_COOKIE_NAME,
    AuthError,
    AuthUser,
    REFRESH_COOKIE_NAME,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_LOCAL,
    TOKEN_TYPE_DOWNLOAD,
    TOKEN_TYPE_REFRESH,
    TOKEN_TYPE_STREAM,
    create_access_token,
    create_ephemeral_token,
    create_refresh_token,
    decode_access_token,
    hash_password,
    normalize_role,
    permissions_for_role,
    user_from_token_payload,
    validate_password,
    validate_username,
    verify_password,
)
from backend_py.repository import reset_workspace_scope, set_workspace_scope
from backend_py.schemas import (
    AuthLoginRequest,
    AuthLogoutRequest,
    AuthPasswordResetConfirm,
    AuthPasswordResetRequest,
    AuthRefreshRequest,
    AuthRegisterRequest,
    RoleUpdateRequest,
)


def register_auth_routes(app: FastAPI, ctx: AppContext) -> None:
    router = APIRouter(tags=["auth"])

    @router.post("/api/auth/register")
    def register_user(payload: AuthRegisterRequest):
        if not ctx.allow_open_registration:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "registration_disabled",
                    "message": "开放注册已关闭，请联系管理员邀请或使用企业 SSO",
                },
            )
        try:
            username = validate_username(payload.username)
            password = validate_password(payload.password, enforce_complexity=ctx.password_complexity)
        except AuthError as error:
            raise HTTPException(
                status_code=400,
                detail={"code": error.code, "message": error.message},
            ) from error

        requested_tenant = (payload.tenantId or "").strip()
        if requested_tenant and not ctx.allow_self_tenant:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "tenant_self_select_disabled",
                    "message": "不允许自选租户，请使用默认租户或管理员邀请",
                },
            )
        tenant_id = requested_tenant or ctx.default_tenant_id
        display_name = (payload.displayName or username).strip() or username
        # First user in the tenant becomes admin; later accounts default to analyst.
        existing_in_tenant = ctx.repo.list_users(tenant_id=tenant_id)
        role = ROLE_ADMIN if len(existing_in_tenant) == 0 else ROLE_ANALYST
        try:
            user = ctx.repo.create_user(
                username=username,
                password_hash=hash_password(password),
                tenant_id=tenant_id,
                display_name=display_name,
                role=role,
            )
        except ValueError as error:
            raise HTTPException(
                status_code=409,
                detail={"code": "username_taken", "message": str(error)},
            ) from error

        scope_token = set_workspace_scope(user["tenantId"], user["id"])
        try:
            audit(ctx.repo, "auth.register", user["id"], {"username": username, "tenantId": tenant_id, "role": role})
        finally:
            reset_workspace_scope(scope_token)
        return ctx.auth_json_response(ctx.issue_token_for_user(user))

    @router.post("/api/auth/login")
    def login_user(payload: AuthLoginRequest, request: Request):
        client_host = request.client.host if request.client else "unknown"
        try:
            username = validate_username(payload.username)
            # Login must not enforce complexity on existing passwords.
            password = payload.password or ""
            if len(password) < 1:
                raise AuthError("密码不能为空", "invalid_password")
        except AuthError as error:
            raise HTTPException(
                status_code=400,
                detail={"code": error.code, "message": error.message},
            ) from error

        blocked, retry_after = ctx.login_guard.is_blocked(username, client_host)
        if blocked:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "login_locked",
                    "message": f"登录失败次数过多，请 {retry_after} 秒后重试",
                    "details": {"retryAfterSeconds": retry_after},
                },
            )

        user = ctx.repo.get_user_by_username(username)
        if not user or not verify_password(password, user["passwordHash"]):
            locked, retry_after = ctx.login_guard.register_failure(username, client_host)
            if locked:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "code": "login_locked",
                        "message": f"登录失败次数过多，请 {retry_after} 秒后重试",
                        "details": {"retryAfterSeconds": retry_after},
                    },
                )
            raise HTTPException(
                status_code=401,
                detail={"code": "invalid_credentials", "message": "用户名或密码不正确，请检查后重试"},
            )

        ctx.login_guard.clear(username, client_host)
        scope_token = set_workspace_scope(user["tenantId"], user["id"])
        try:
            audit(ctx.repo, "auth.login", user["id"], {"username": username, "role": user["role"]})
        finally:
            reset_workspace_scope(scope_token)
        return ctx.auth_json_response(ctx.issue_token_for_user(user))

    @router.post("/api/auth/refresh")
    def refresh_session(payload: AuthRefreshRequest, request: Request):
        refresh_token_value = (payload.refreshToken or request.cookies.get(REFRESH_COOKIE_NAME) or "").strip()
        if not refresh_token_value:
            raise HTTPException(
                status_code=401,
                detail={"code": "invalid_token", "message": "refresh token required"},
            )
        try:
            token_payload = decode_access_token(
                refresh_token_value,
                ctx.auth_secret,
                expected_types={TOKEN_TYPE_REFRESH},
            )
            ctx.assert_token_active(token_payload)
        except AuthError as error:
            raise HTTPException(
                status_code=401,
                detail={"code": error.code, "message": error.message},
            ) from error

        # Rotate: revoke previous refresh jti, issue a new pair under same session id.
        old_jti = str(token_payload.get("jti") or "")
        session_id = str(token_payload.get("sid") or old_jti)
        exp = int(token_payload.get("exp") or 0)
        ttl = max(1, exp - int(datetime.now(timezone.utc).timestamp()))
        if old_jti:
            ctx.revocation_store.revoke(old_jti, ttl_seconds=ttl)

        auth_user = user_from_token_payload(token_payload)
        # Prefer latest role from DB if available.
        db_user = ctx.repo.get_user_by_id(auth_user.id)
        if db_user:
            auth_user = AuthUser(
                id=db_user["id"],
                username=db_user["username"],
                tenant_id=db_user["tenantId"],
                display_name=db_user["displayName"],
                role=db_user["role"],
            )
        access_token = create_access_token(
            user=auth_user,
            secret=ctx.auth_secret,
            expires_minutes=ctx.auth_token_minutes,
            session_id=session_id,
        )
        refresh_token = create_refresh_token(
            user=auth_user,
            secret=ctx.auth_secret,
            expires_days=ctx.auth_refresh_days,
            session_id=session_id,
        )
        issued = {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "tokenType": "Bearer",
            "expiresInMinutes": ctx.auth_token_minutes,
            "refreshExpiresInDays": ctx.auth_refresh_days,
            "user": ctx.public_user(auth_user),
            "sessionId": session_id,
        }
        return ctx.auth_json_response(issued)

    @router.post("/api/auth/logout")
    def logout_user(payload: AuthLogoutRequest, request: Request):
        auth_user = getattr(request.state, "auth_user", None)
        # Revoke current access token session if present.
        authorization = (request.headers.get("authorization") or "").strip()
        access_raw = ""
        if authorization.lower().startswith("bearer "):
            access_raw = authorization[7:].strip()
        if not access_raw:
            access_raw = (request.cookies.get(ACCESS_COOKIE_NAME) or "").strip()
        if access_raw:
            try:
                access_payload = decode_access_token(access_raw, ctx.auth_secret)
                sid = str(access_payload.get("sid") or access_payload.get("jti") or "")
                exp = int(access_payload.get("exp") or 0)
                ttl = max(60, exp - int(datetime.now(timezone.utc).timestamp()))
                if sid:
                    ctx.revocation_store.revoke(sid, ttl_seconds=max(ttl, ctx.auth_refresh_days * 86400))
            except AuthError:
                pass
        refresh_raw = (payload.refreshToken or request.cookies.get(REFRESH_COOKIE_NAME) or "").strip()
        if refresh_raw:
            try:
                refresh_payload = decode_access_token(
                    refresh_raw,
                    ctx.auth_secret,
                    expected_types={TOKEN_TYPE_REFRESH},
                )
                sid = str(refresh_payload.get("sid") or refresh_payload.get("jti") or "")
                if sid:
                    ctx.revocation_store.revoke(sid, ttl_seconds=ctx.auth_refresh_days * 86400)
            except AuthError:
                pass
        if auth_user is not None:
            scope_token = set_workspace_scope(auth_user.tenant_id, auth_user.id)
            try:
                audit(ctx.repo, "auth.logout", auth_user.id, {})
            finally:
                reset_workspace_scope(scope_token)
        response = JSONResponse(content={"ok": True})
        ctx.clear_auth_cookies(response)
        return response

    @router.post("/api/auth/stream-ticket")
    def issue_stream_ticket(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        ticket = create_ephemeral_token(
            user=auth_user,
            secret=ctx.auth_secret,
            token_type=TOKEN_TYPE_STREAM,
            expires_seconds=120,
            purpose="workflow-stream",
        )
        return {"ticket": ticket, "expiresInSeconds": 120}

    @router.post("/api/auth/download-ticket")
    def issue_download_ticket(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        ticket = create_ephemeral_token(
            user=auth_user,
            secret=ctx.auth_secret,
            token_type=TOKEN_TYPE_DOWNLOAD,
            expires_seconds=120,
            purpose="artifact-download",
        )
        return {"ticket": ticket, "expiresInSeconds": 120}

    @router.post("/api/auth/password-reset/request")
    def password_reset_request(payload: AuthPasswordResetRequest) -> dict:
        """Always returns ok to avoid username enumeration. Token is returned only in non-production."""
        username = (payload.username or "").strip()
        user = ctx.repo.get_user_by_username(username) if username else None
        issued = None
        if user:
            issued = ctx.repo.create_password_reset_token(user_id=user["id"], username=user["username"], ttl_minutes=30)
            scope_token = set_workspace_scope(user["tenantId"], user["id"])
            try:
                audit(ctx.repo, "auth.password_reset.request", user["id"], {"username": user["username"]})
            finally:
                reset_workspace_scope(scope_token)
        response = {
            "ok": True,
            "message": "如果账号存在，重置指令已生成。请查收通知或联系管理员。",
        }
        # Dev/test convenience: expose token outside production.
        if issued and not ctx.production_mode:
            response["resetToken"] = issued["token"]
            response["expiresAt"] = issued["expiresAt"]
        return response

    @router.post("/api/auth/password-reset/confirm")
    def password_reset_confirm(payload: AuthPasswordResetConfirm) -> dict:
        try:
            new_password = validate_password(payload.newPassword, enforce_complexity=ctx.password_complexity)
        except AuthError as error:
            raise HTTPException(status_code=400, detail={"code": error.code, "message": error.message}) from error
        consumed = ctx.repo.consume_password_reset_token(payload.token)
        if not consumed:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_reset_token", "message": "重置令牌无效或已过期"},
            )
        user = ctx.repo.get_user_by_id(consumed["userId"])
        if not user:
            raise HTTPException(status_code=400, detail={"code": "invalid_reset_token", "message": "重置令牌无效或已过期"})
        ctx.repo.update_user_password(user["id"], hash_password(new_password))
        scope_token = set_workspace_scope(user["tenantId"], user["id"])
        try:
            audit(ctx.repo, "auth.password_reset.confirm", user["id"], {"username": user["username"]})
        finally:
            reset_workspace_scope(scope_token)
        return {"ok": True, "message": "密码已更新，请使用新密码登录"}

    @router.get("/api/auth/me")
    def current_user(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is not None:
            return {
                "user": ctx.public_user(auth_user),
                "authenticated": True,
                "permissions": permissions_for_role(auth_user.role),
            }

        if ctx.auth_required:
            raise HTTPException(status_code=401, detail="authentication required")

        return {
            "authenticated": False,
            "user": {
                "id": ctx.default_user_id,
                "username": ctx.default_user_id,
                "tenantId": ctx.default_tenant_id,
                "displayName": ctx.default_user_id,
                "role": ROLE_LOCAL,
                "permissions": permissions_for_role(ROLE_LOCAL),
            },
            "permissions": permissions_for_role(ROLE_LOCAL),
        }

    @router.get("/api/auth/users")
    def list_users(request: Request) -> dict:
        ctx.require_admin_access(request)
        auth_user = getattr(request.state, "auth_user", None)
        tenant_id = auth_user.tenant_id if auth_user else ctx.default_tenant_id
        users = ctx.repo.list_users(tenant_id=tenant_id)
        return {
            "items": [
                {
                    **item,
                    "permissions": permissions_for_role(item["role"]),
                }
                for item in users
            ]
        }

    @router.patch("/api/auth/users/{user_id}/role")
    def update_user_role(user_id: str, payload: RoleUpdateRequest, request: Request) -> dict:
        ctx.require_admin_access(request)
        try:
            role = normalize_role(payload.role)
        except AuthError as error:
            raise HTTPException(status_code=400, detail=error.message) from error

        target = ctx.repo.get_user_by_id(user_id)
        if not target:
            raise HTTPException(status_code=404, detail="user not found")

        auth_user = getattr(request.state, "auth_user", None)
        if auth_user and target["tenantId"] != auth_user.tenant_id:
            raise HTTPException(status_code=403, detail="cannot manage users outside your tenant")

        if auth_user and auth_user.id == user_id and role != ROLE_ADMIN:
            admins = [item for item in ctx.repo.list_users(tenant_id=target["tenantId"]) if item["role"] == ROLE_ADMIN]
            if len(admins) <= 1:
                raise HTTPException(status_code=400, detail="cannot demote the last admin")

        updated = ctx.repo.update_user_role(user_id, role)
        if not updated:
            raise HTTPException(status_code=404, detail="user not found")

        audit(ctx.repo, "auth.role_update", user_id, {"role": role, "username": updated["username"]})
        return {
            "user": {
                "id": updated["id"],
                "username": updated["username"],
                "tenantId": updated["tenantId"],
                "displayName": updated["displayName"],
                "role": updated["role"],
                "permissions": permissions_for_role(updated["role"]),
            }
        }


    app.include_router(router)
