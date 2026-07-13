from __future__ import annotations

import base64
import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any
from uuid import uuid4


class OidcError(ValueError):
    def __init__(self, message: str, code: str = "oidc_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class OidcSettings:
    enabled: bool
    issuer: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: str = "openid profile email"
    authorize_url: str = ""
    token_url: str = ""
    userinfo_url: str = ""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def create_pkce_pair() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def discovery_urls(issuer: str) -> dict[str, str]:
    base = issuer.rstrip("/")
    well_known = f"{base}/.well-known/openid-configuration"
    try:
        with urllib.request.urlopen(well_known, timeout=10) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise OidcError(f"oidc discovery failed: {error}", "oidc_discovery_failed") from error
    return {
        "authorization_endpoint": str(payload.get("authorization_endpoint") or ""),
        "token_endpoint": str(payload.get("token_endpoint") or ""),
        "userinfo_endpoint": str(payload.get("userinfo_endpoint") or ""),
        "issuer": str(payload.get("issuer") or issuer),
    }


def build_authorize_url(settings: OidcSettings, *, state: str, code_challenge: str) -> str:
    authorize = settings.authorize_url
    if not authorize:
        discovered = discovery_urls(settings.issuer)
        authorize = discovered["authorization_endpoint"]
    if not authorize:
        raise OidcError("authorization endpoint missing", "oidc_config_invalid")
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": settings.client_id,
            "redirect_uri": settings.redirect_uri,
            "scope": settings.scopes,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{authorize}?{query}"


def exchange_code_for_tokens(
    settings: OidcSettings,
    *,
    code: str,
    code_verifier: str,
) -> dict[str, Any]:
    token_url = settings.token_url
    if not token_url:
        discovered = discovery_urls(settings.issuer)
        token_url = discovered["token_endpoint"]
    if not token_url:
        raise OidcError("token endpoint missing", "oidc_config_invalid")

    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.redirect_uri,
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "code_verifier": code_verifier,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        token_url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OidcError(f"token exchange failed: {error.code} {detail}", "oidc_token_failed") from error
    except Exception as error:  # noqa: BLE001
        raise OidcError(f"token exchange failed: {error}", "oidc_token_failed") from error


def fetch_userinfo(settings: OidcSettings, access_token: str) -> dict[str, Any]:
    userinfo_url = settings.userinfo_url
    if not userinfo_url:
        discovered = discovery_urls(settings.issuer)
        userinfo_url = discovered["userinfo_endpoint"]
    if not userinfo_url:
        # Fallback: decode id_token payload without signature verification is not ideal;
        # require userinfo when possible.
        raise OidcError("userinfo endpoint missing", "oidc_config_invalid")
    request = urllib.request.Request(
        userinfo_url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        raise OidcError(f"userinfo failed: {error}", "oidc_userinfo_failed") from error


def normalize_oidc_profile(userinfo: dict[str, Any], *, default_tenant: str) -> dict[str, str]:
    subject = str(userinfo.get("sub") or "").strip()
    if not subject:
        raise OidcError("oidc profile missing sub", "oidc_profile_invalid")
    email = str(userinfo.get("email") or "").strip()
    preferred = str(userinfo.get("preferred_username") or userinfo.get("nickname") or "").strip()
    name = str(userinfo.get("name") or preferred or email or subject).strip()
    username_source = preferred or (email.split("@")[0] if email else f"oidc-{subject[:12]}")
    username = "".join(ch if ch.isalnum() or ch in {"_", ".", "-"} else "-" for ch in username_source).strip("-_.")
    if len(username) < 3:
        username = f"oidc-{uuid4().hex[:8]}"
    return {
        "subject": subject,
        "email": email,
        "displayName": name,
        "username": username[:64],
        "tenantId": default_tenant,
    }
