from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{3,64}$")
PASSWORD_MIN_LENGTH = 8

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
        raise AuthError(f"role must be one of: {', '.join(VALID_ROLES)}", "invalid_role")
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
        raise AuthError("username must be 3-64 chars of letters, numbers, _ . -", "invalid_username")
    return value


def validate_password(password: str) -> str:
    value = password or ""
    if len(value) < PASSWORD_MIN_LENGTH:
        raise AuthError(f"password must be at least {PASSWORD_MIN_LENGTH} characters", "invalid_password")
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


def create_access_token(
    *,
    user: AuthUser,
    secret: str,
    expires_minutes: int = 720,
) -> str:
    if not secret:
        raise AuthError("auth secret is not configured", "auth_secret_missing")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "tenantId": user.tenant_id,
        "displayName": user.display_name,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = f"{_b64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))}.{_b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))}"
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def decode_access_token(token: str, secret: str) -> dict[str, Any]:
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
        "/metrics",
        "/api/metrics",
    }


def is_write_method(method: str) -> bool:
    return method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
