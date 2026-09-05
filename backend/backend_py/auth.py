from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{3,64}$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_COMPLEXITY = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).+$")

ROLE_VIEWER = "viewer"
ROLE_ANALYST = "analyst"
ROLE_ADMIN = "admin"
ROLE_LOCAL = "local"

VALID_ROLES = (ROLE_VIEWER, ROLE_ANALYST, ROLE_ADMIN)
ROLE_RANK = {
    ROLE_VIEWER: 1,
    ROLE_ANALYST: 2,
    ROLE_ADMIN: 3,
    ROLE_LOCAL: 2,
}

PERMISSION_READ = "read"
PERMISSION_WRITE = "write"
PERMISSION_ADMIN = "admin"

ROLE_PERMISSIONS: dict[str, set[str]] = {
    ROLE_VIEWER: {PERMISSION_READ},
    ROLE_ANALYST: {PERMISSION_READ, PERMISSION_WRITE},
    ROLE_ADMIN: {PERMISSION_READ, PERMISSION_WRITE, PERMISSION_ADMIN},
    ROLE_LOCAL: {PERMISSION_READ, PERMISSION_WRITE, PERMISSION_ADMIN},
}

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"
TOKEN_TYPE_STREAM = "stream"
TOKEN_TYPE_DOWNLOAD = "download"

ACCESS_COOKIE_NAME = "workspace_access_token"
REFRESH_COOKIE_NAME = "workspace_refresh_token"
CSRF_COOKIE_NAME = "workspace_csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"


@dataclass(frozen=True)
class AuthUser:
    id: str
    username: str
    tenant_id: str
    display_name: str
    role: str


class AuthError(ValueError):
    def __init__(self, message: str, code: str = "auth_error") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class PermissionError(AuthError):
    def __init__(self, message: str = "permission denied", code: str = "permission_denied") -> None:
        super().__init__(message, code=code)


def normalize_role(role: str | None, *, default: str = ROLE_ANALYST) -> str:
    value = (role or default).strip().lower()
    if value not in VALID_ROLES and value != ROLE_LOCAL:
        raise AuthError(f"角色无效，可选：{'、'.join(VALID_ROLES)}", "invalid_role")
    return value


def permissions_for_role(role: str | None) -> list[str]:
    normalized = (role or ROLE_VIEWER).strip().lower()
    return sorted(ROLE_PERMISSIONS.get(normalized, {PERMISSION_READ}))


def has_permission(role: str | None, permission: str) -> bool:
    normalized = (role or ROLE_VIEWER).strip().lower()
    return permission in ROLE_PERMISSIONS.get(normalized, {PERMISSION_READ})


def role_at_least(role: str | None, minimum: str) -> bool:
    current = ROLE_RANK.get((role or ROLE_VIEWER).strip().lower(), 0)
    required = ROLE_RANK.get(minimum, 99)
    return current >= required


def validate_username(username: str) -> str:
    value = (username or "").strip()
    if not USERNAME_PATTERN.fullmatch(value):
        raise AuthError("用户名需为 3～64 位，只能包含字母、数字、下划线 _、点 . 或短横线 -", "invalid_username")
    return value


def validate_password(password: str, *, enforce_complexity: bool = False) -> str:
    value = password or ""
    if len(value) < PASSWORD_MIN_LENGTH:
        raise AuthError(f"密码至少需要 {PASSWORD_MIN_LENGTH} 位，请再设置长一点", "invalid_password")
    if enforce_complexity and not PASSWORD_COMPLEXITY.fullmatch(value):
        raise AuthError("密码需同时包含字母和数字", "invalid_password")
    return value


def hash_password(password: str, *, iterations: int = 120_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_raw.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_raw.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _encode_token(payload: dict[str, Any], secret: str) -> str:
    if not secret:
        raise AuthError("auth secret is not configured", "auth_secret_missing")
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = (
        f"{_b64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))}."
        f"{_b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))}"
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def create_access_token(
    *,
    user: AuthUser,
    secret: str,
    expires_minutes: int = 30,
    jti: str | None = None,
    session_id: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    token_jti = jti or secrets.token_urlsafe(16)
    payload = {
        "sub": user.id,
        "username": user.username,
        "tenantId": user.tenant_id,
        "displayName": user.display_name,
        "role": user.role,
        "typ": TOKEN_TYPE_ACCESS,
        "jti": token_jti,
        "sid": session_id or token_jti,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=max(1, expires_minutes))).timestamp()),
    }
    return _encode_token(payload, secret)


def create_refresh_token(
    *,
    user: AuthUser,
    secret: str,
    expires_days: int = 14,
    jti: str | None = None,
    session_id: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    token_jti = jti or secrets.token_urlsafe(18)
    payload = {
        "sub": user.id,
        "username": user.username,
        "tenantId": user.tenant_id,
        "displayName": user.display_name,
        "role": user.role,
        "typ": TOKEN_TYPE_REFRESH,
        "jti": token_jti,
        "sid": session_id or token_jti,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=max(1, expires_days))).timestamp()),
    }
    return _encode_token(payload, secret)


def create_ephemeral_token(
    *,
    user: AuthUser,
    secret: str,
    token_type: str,
    expires_seconds: int = 120,
    purpose: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "tenantId": user.tenant_id,
        "displayName": user.display_name,
        "role": user.role,
        "typ": token_type,
        "jti": secrets.token_urlsafe(12),
        "purpose": purpose or token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=max(15, expires_seconds))).timestamp()),
    }
    return _encode_token(payload, secret)


def decode_access_token(
    token: str,
    secret: str,
    *,
    expected_types: set[str] | None = None,
) -> dict[str, Any]:
    if not secret:
        raise AuthError("auth secret is not configured", "auth_secret_missing")
    try:
        header_raw, payload_raw, signature_raw = token.split(".", 2)
    except ValueError as error:
        raise AuthError("invalid access token", "invalid_token") from error

    signing_input = f"{header_raw}.{payload_raw}"
    expected = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    actual = _b64url_decode(signature_raw)
    if not hmac.compare_digest(expected, actual):
        raise AuthError("invalid access token signature", "invalid_token")

    try:
        payload = json.loads(_b64url_decode(payload_raw).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise AuthError("invalid access token payload", "invalid_token") from error

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(datetime.now(timezone.utc).timestamp()):
        raise AuthError("access token expired", "token_expired")

    if not payload.get("sub") or not payload.get("tenantId"):
        raise AuthError("access token missing required claims", "invalid_token")

    token_type = str(payload.get("typ") or TOKEN_TYPE_ACCESS)
    allowed = expected_types or {TOKEN_TYPE_ACCESS, TOKEN_TYPE_STREAM, TOKEN_TYPE_DOWNLOAD}
    if token_type not in allowed:
        raise AuthError("invalid token type", "invalid_token")
    payload["typ"] = token_type
    return payload


def user_from_token_payload(payload: dict[str, Any]) -> AuthUser:
    role = str(payload.get("role") or ROLE_ANALYST)
    try:
        role = normalize_role(role)
    except AuthError:
        role = ROLE_ANALYST
    return AuthUser(
        id=str(payload["sub"]),
        username=str(payload.get("username") or payload["sub"]),
        tenant_id=str(payload["tenantId"]),
        display_name=str(payload.get("displayName") or payload.get("username") or payload["sub"]),
        role=role,
    )


def public_auth_paths() -> set[str]:
    return {
        "/api/health",
        "/api/health/live",
        "/api/health/ready",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/refresh",
        "/api/auth/password-reset/request",
        "/api/auth/password-reset/confirm",
    }


class LoginAttemptGuard:
    """In-process login brute-force protection (per username + IP)."""

    def __init__(self, *, max_failures: int = 8, window_seconds: int = 900) -> None:
        self.max_failures = max(1, max_failures)
        self.window_seconds = max(60, window_seconds)
        self._lock = threading.RLock()
        self._failures: dict[str, list[float]] = {}

    def _key(self, username: str, client_host: str) -> str:
        return f"{username.strip().lower()}|{client_host or 'unknown'}"

    def _prune(self, key: str, now: float) -> list[float]:
        values = [ts for ts in self._failures.get(key, []) if now - ts <= self.window_seconds]
        if values:
            self._failures[key] = values
        else:
            self._failures.pop(key, None)
        return values

    def is_blocked(self, username: str, client_host: str) -> tuple[bool, int]:
        now = time.time()
        with self._lock:
            values = self._prune(self._key(username, client_host), now)
            if len(values) < self.max_failures:
                return False, 0
            oldest = min(values)
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return True, retry_after

    def register_failure(self, username: str, client_host: str) -> tuple[bool, int]:
        now = time.time()
        key = self._key(username, client_host)
        with self._lock:
            values = self._prune(key, now)
            values.append(now)
            self._failures[key] = values
            if len(values) < self.max_failures:
                return False, 0
            oldest = min(values)
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return True, retry_after

    def clear(self, username: str, client_host: str) -> None:
        with self._lock:
            self._failures.pop(self._key(username, client_host), None)


class TokenRevocationStore:
    """Tracks revoked jti / session ids. Memory by default; optional Redis."""

    def __init__(self, redis_client: Any | None = None, *, key_prefix: str = "workspace:auth:revoked") -> None:
        self._redis = redis_client
        self._key_prefix = key_prefix
        self._lock = threading.RLock()
        self._until: dict[str, float] = {}

    def _cleanup_locked(self, now: float) -> None:
        expired = [key for key, until in self._until.items() if until <= now]
        for key in expired:
            self._until.pop(key, None)

    def revoke(self, token_id: str, *, ttl_seconds: int) -> None:
        if not token_id:
            return
        ttl = max(1, int(ttl_seconds))
        if self._redis is not None:
            self._redis.setex(f"{self._key_prefix}:{token_id}", ttl, "1")
            return
        with self._lock:
            self._until[token_id] = time.time() + ttl

    def is_revoked(self, token_id: str | None) -> bool:
        if not token_id:
            return False
        if self._redis is not None:
            return bool(self._redis.get(f"{self._key_prefix}:{token_id}"))
        now = time.time()
        with self._lock:
            self._cleanup_locked(now)
            until = self._until.get(token_id)
            return bool(until and until > now)


class EphemeralStateStore:
    """Short-lived state bag for OIDC PKCE etc. Shared via Redis when available."""

    def __init__(
        self,
        redis_client: Any | None = None,
        *,
        key_prefix: str = "workspace:auth:state",
        default_ttl_seconds: int = 600,
    ) -> None:
        self._redis = redis_client
        self._key_prefix = key_prefix
        self._default_ttl = max(60, default_ttl_seconds)
        self._lock = threading.RLock()
        self._items: dict[str, tuple[float, dict[str, Any]]] = {}

    def put(self, key: str, value: dict[str, Any], *, ttl_seconds: int | None = None) -> None:
        ttl = max(30, int(ttl_seconds or self._default_ttl))
        if self._redis is not None:
            self._redis.setex(f"{self._key_prefix}:{key}", ttl, json.dumps(value, ensure_ascii=False))
            return
        with self._lock:
            self._items[key] = (time.time() + ttl, value)

    def pop(self, key: str) -> dict[str, Any] | None:
        if self._redis is not None:
            raw = self._redis.get(f"{self._key_prefix}:{key}")
            if not raw:
                return None
            try:
                self._redis.delete(f"{self._key_prefix}:{key}")
            except Exception:  # noqa: BLE001
                pass
            try:
                payload = json.loads(raw)
            except (TypeError, ValueError):
                return None
            return payload if isinstance(payload, dict) else None
        now = time.time()
        with self._lock:
            item = self._items.pop(key, None)
            if not item:
                return None
            expires_at, value = item
            if expires_at < now:
                return None
            return value


def is_write_method(method: str) -> bool:
    return method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
