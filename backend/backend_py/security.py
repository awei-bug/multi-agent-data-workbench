from __future__ import annotations

import os
from dataclasses import dataclass


WEAK_SECRETS = {
    "",
    "local-dev-only-change-me",
    "change-me",
    "changeme",
    "secret",
    "password",
    "123456",
    "admin",
}


@dataclass(frozen=True)
class ProductionSecurityReport:
    production_mode: bool
    ok: bool
    errors: list[str]
    warnings: list[str]


def is_production_mode(env: dict[str, str] | None = None) -> bool:
    values = os.environ if env is None else env
    explicit = (values.get("WORKSPACE_ENV") or values.get("APP_ENV") or values.get("ENVIRONMENT") or "").strip().lower()
    if explicit in {"prod", "production"}:
        return True
    if values.get("WORKSPACE_PRODUCTION_MODE", "").lower() == "true":
        return True
    return False


def validate_production_settings(
    *,
    auth_required: bool,
    auth_secret: str,
    admin_api_key: str,
    credentials_secret: str,
    cors_origins: list[str] | None,
    seed_demo_data: bool = False,
    env: dict[str, str] | None = None,
) -> ProductionSecurityReport:
    production = is_production_mode(env)
    errors: list[str] = []
    warnings: list[str] = []

    if not production:
        if not auth_required:
            warnings.append("auth is optional outside production mode")
        if (auth_secret or "").strip() in WEAK_SECRETS:
            warnings.append("auth secret uses a weak/default value")
        return ProductionSecurityReport(production_mode=False, ok=True, errors=errors, warnings=warnings)

    if not auth_required:
        errors.append("WORKSPACE_AUTH_REQUIRED must be true in production")
    if (auth_secret or "").strip() in WEAK_SECRETS or len((auth_secret or "").strip()) < 24:
        errors.append("WORKSPACE_AUTH_SECRET must be a strong secret (>=24 chars) in production")
    if not (admin_api_key or "").strip() or (admin_api_key or "").strip() in WEAK_SECRETS or len((admin_api_key or "").strip()) < 16:
        errors.append("WORKSPACE_ADMIN_API_KEY must be set to a strong value in production")
    if (credentials_secret or "").strip() in WEAK_SECRETS or len((credentials_secret or "").strip()) < 24:
        errors.append("WORKSPACE_CREDENTIALS_SECRET must be a strong secret in production")
    if not cors_origins:
        errors.append("WORKSPACE_CORS_ORIGINS must be explicitly configured in production")
    else:
        for origin in cors_origins:
            if origin.strip() in {"*", "null"}:
                errors.append("WORKSPACE_CORS_ORIGINS must not use wildcard origins in production")
            if origin.startswith("http://") and "localhost" not in origin and "127.0.0.1" not in origin:
                warnings.append(f"CORS origin is not HTTPS: {origin}")
    if seed_demo_data:
        errors.append("seed demo data must be disabled in production")

    return ProductionSecurityReport(
        production_mode=True,
        ok=not errors,
        errors=errors,
        warnings=warnings,
    )


def security_headers(*, enable_hsts: bool = False, csp: str | None = None) -> dict[str, str]:
    headers = {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-site",
        "x-xss-protection": "0",
    }
    if enable_hsts:
        headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
    if csp:
        headers["content-security-policy"] = csp
    else:
        headers["content-security-policy"] = (
            "default-src 'self'; "
            "img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "connect-src 'self' http: https:; "
            "font-src 'self' data:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
    return headers
