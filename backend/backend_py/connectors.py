from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


class ConnectorError(ValueError):
    def __init__(self, message: str, code: str = "connector_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _b64d(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw.encode("ascii"))


def derive_credentials_key(secret: str) -> bytes:
    material = (secret or "local-dev-only-change-me").encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", material, b"workspace-credentials-v1", 120_000, dklen=32)


def encrypt_credentials(payload: dict[str, Any], secret: str) -> str:
    key = derive_credentials_key(secret)
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    nonce = secrets.token_bytes(16)
    # Stream-like XOR with HMAC-SHA256 keystream (stdlib-only, authenticated).
    stream = b""
    counter = 0
    while len(stream) < len(plaintext):
        stream += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, stream[: len(plaintext)]))
    digest = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
    return f"v1.{_b64e(nonce)}.{_b64e(ciphertext)}.{_b64e(digest)}"


def decrypt_credentials(token: str, secret: str) -> dict[str, Any]:
    try:
        version, nonce_b64, cipher_b64, digest_b64 = token.split(".", 3)
        if version != "v1":
            raise ConnectorError("unsupported credentials token version", "invalid_credentials")
        key = derive_credentials_key(secret)
        nonce = _b64d(nonce_b64)
        ciphertext = _b64d(cipher_b64)
        digest = _b64d(digest_b64)
        expected = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(digest, expected):
            raise ConnectorError("credentials integrity check failed", "invalid_credentials")
        stream = b""
        counter = 0
        while len(stream) < len(ciphertext):
            stream += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
            counter += 1
        plaintext = bytes(a ^ b for a, b in zip(ciphertext, stream[: len(ciphertext)]))
        payload = json.loads(plaintext.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ConnectorError("invalid credentials payload", "invalid_credentials")
        return payload
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ConnectorError("unable to decrypt credentials", "invalid_credentials") from error


def list_connector_types() -> list[dict[str, Any]]:
    return [
        {
            "type": "http_json",
            "name": "HTTP JSON",
            "description": "从 HTTP/HTTPS JSON 接口拉取数据并导入为表格数据源。",
            "configFields": [
                {"key": "url", "label": "URL", "required": True},
                {"key": "method", "label": "Method", "required": False, "default": "GET"},
                {"key": "jsonPath", "label": "JSON 数组路径（如 data.items）", "required": False},
                {"key": "headers", "label": "额外请求头（JSON 对象）", "required": False},
            ],
            "credentialFields": [
                {"key": "bearerToken", "label": "Bearer Token", "required": False, "secret": True},
                {"key": "basicUsername", "label": "Basic 用户名", "required": False},
                {"key": "basicPassword", "label": "Basic 密码", "required": False, "secret": True},
            ],
        },
        {
            "type": "postgres",
            "name": "PostgreSQL",
            "description": "通过 SQL 查询 PostgreSQL，将结果导入为表格数据源。",
            "configFields": [
                {"key": "host", "label": "Host", "required": True},
                {"key": "port", "label": "Port", "required": False, "default": 5432},
                {"key": "database", "label": "Database", "required": True},
                {"key": "sslmode", "label": "SSL Mode", "required": False, "default": "prefer"},
                {"key": "query", "label": "SQL Query", "required": True},
            ],
            "credentialFields": [
                {"key": "username", "label": "用户名", "required": True},
                {"key": "password", "label": "密码", "required": True, "secret": True},
            ],
        },
    ]


def _rows_from_json_payload(payload: Any, json_path: str | None = None) -> list[dict[str, str]]:
    target = payload
    if json_path:
        for part in [item for item in json_path.split(".") if item]:
            if not isinstance(target, dict) or part not in target:
                raise ConnectorError(f"json path not found: {json_path}", "invalid_json_path")
            target = target[part]
    if isinstance(target, dict):
        # Single object -> one row
        target = [target]
    if not isinstance(target, list):
        raise ConnectorError("JSON payload must be an array of objects", "invalid_payload")
    rows: list[dict[str, str]] = []
    for item in target:
        if not isinstance(item, dict):
            continue
        rows.append({str(key): "" if value is None else str(value) for key, value in item.items()})
    if not rows:
        raise ConnectorError("no tabular rows found in JSON payload", "empty_payload")
    return rows


def _http_json_fetch(config: dict[str, Any], credentials: dict[str, Any], *, timeout_seconds: float = 20.0) -> list[dict[str, str]]:
    url = str(config.get("url") or "").strip()
    if not url:
        raise ConnectorError("url is required", "invalid_config")
    method = str(config.get("method") or "GET").upper()
    if method not in {"GET", "POST"}:
        raise ConnectorError("method must be GET or POST", "invalid_config")
    headers = {"Accept": "application/json", "User-Agent": "workspace-connector/1.0"}
    extra_headers = config.get("headers") or {}
    if isinstance(extra_headers, str) and extra_headers.strip():
        try:
            extra_headers = json.loads(extra_headers)
        except json.JSONDecodeError as error:
            raise ConnectorError("headers must be valid JSON object", "invalid_config") from error
    if isinstance(extra_headers, dict):
        headers.update({str(k): str(v) for k, v in extra_headers.items()})
    token = str(credentials.get("bearerToken") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    basic_user = str(credentials.get("basicUsername") or "").strip()
    basic_password = str(credentials.get("basicPassword") or "")
    if basic_user:
        raw = f"{basic_user}:{basic_password}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")

    body = None
    if method == "POST":
        body = json.dumps(config.get("body") or {}).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    request = urlrequest.Request(url, data=body, headers=headers, method=method)
    try:
        with urlrequest.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - operator configured URL
            raw = response.read()
            content_type = response.headers.get("Content-Type", "")
    except urlerror.HTTPError as error:
        raise ConnectorError(f"http error: {error.code}", "http_error") from error
    except urlerror.URLError as error:
        raise ConnectorError(f"network error: {error.reason}", "network_error") from error
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConnectorError(f"response is not valid JSON ({content_type})", "invalid_payload") from error
    return _rows_from_json_payload(payload, str(config.get("jsonPath") or "").strip() or None)


def _postgres_fetch(config: dict[str, Any], credentials: dict[str, Any], *, timeout_seconds: float = 20.0) -> list[dict[str, str]]:
    host = str(config.get("host") or "").strip()
    database = str(config.get("database") or "").strip()
    query = str(config.get("query") or "").strip()
    if not host or not database or not query:
        raise ConnectorError("host, database and query are required", "invalid_config")
    # Guard against multi-statement abuse.
    if ";" in query.strip().rstrip(";"):
        raise ConnectorError("only a single SQL statement is allowed", "invalid_query")
    normalized = query.lstrip().lower()
    if not (normalized.startswith("select") or normalized.startswith("with")):
        raise ConnectorError("only SELECT/WITH queries are allowed", "invalid_query")

    username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "")
    if not username:
        raise ConnectorError("username is required", "invalid_credentials")
    port = int(config.get("port") or 5432)
    sslmode = str(config.get("sslmode") or "prefer")
    dsn = (
        f"host={host} port={port} dbname={database} user={username} "
        f"password={password} sslmode={sslmode} connect_timeout={max(1, int(timeout_seconds))}"
    )
    try:
        import psycopg
    except ModuleNotFoundError as error:
        raise ConnectorError("psycopg is required for postgres connector", "dependency_missing") from error
    try:
        with psycopg.connect(dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query)
                if cursor.description is None:
                    raise ConnectorError("query returned no columns", "empty_payload")
                columns = [col.name for col in cursor.description]
                fetched = cursor.fetchmany(5000)
    except ConnectorError:
        raise
    except Exception as error:  # noqa: BLE001
        raise ConnectorError(f"postgres query failed: {error}", "query_failed") from error

    rows: list[dict[str, str]] = []
    for item in fetched:
        row = {}
        for index, column in enumerate(columns):
            value = item[index]
            row[str(column)] = "" if value is None else str(value)
        rows.append(row)
    if not rows:
        raise ConnectorError("query returned no rows", "empty_payload")
    return rows


def test_connection(connector_type: str, config: dict[str, Any], credentials: dict[str, Any]) -> dict[str, Any]:
    rows = fetch_rows(connector_type, config, credentials)
    columns = list(rows[0].keys()) if rows else []
    return {
        "ok": True,
        "rowCount": len(rows),
        "columnCount": len(columns),
        "columns": columns[:50],
        "previewRows": rows[:5],
    }


def fetch_rows(connector_type: str, config: dict[str, Any], credentials: dict[str, Any]) -> list[dict[str, str]]:
    normalized = (connector_type or "").strip().lower()
    if normalized == "http_json":
        return _http_json_fetch(config or {}, credentials or {})
    if normalized == "postgres":
        return _postgres_fetch(config or {}, credentials or {})
    raise ConnectorError(f"unsupported connector type: {connector_type}", "unsupported_connector")


def build_table_data_source(
    *,
    name: str,
    connector_type: str,
    rows: list[dict[str, str]],
    connection_id: str | None = None,
) -> dict[str, Any]:
    if not rows:
        raise ConnectorError("no rows to import", "empty_payload")
    headers = list(rows[0].keys())
    columns = [{"name": header, "type": "string"} for header in headers]
    null_counts = {header: sum(1 for row in rows if not str(row.get(header, "")).strip()) for header in headers}
    return {
        "kind": "table",
        "formatLabel": f"Connector:{connector_type}",
        "fileName": name,
        "columnCount": len(headers),
        "rowCount": len(rows),
        "columns": columns,
        "previewRows": rows[:100],
        "analysisRows": rows[:1000],
        "analysisScope": {"mode": "full", "rowCount": len(rows), "rowsProcessed": min(len(rows), 1000)},
        "profile": {"nullCounts": null_counts, "duplicateRows": 0},
        "fieldMappings": [],
        "textPreview": "",
        "sourceType": "connector",
        "connectorType": connector_type,
        "connectionId": connection_id,
    }


def public_connection_view(connection: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": connection.get("id"),
        "name": connection.get("name"),
        "connectorType": connection.get("connectorType"),
        "config": connection.get("config") or {},
        "hasCredentials": bool(connection.get("credentialsEncrypted")),
        "createdAt": connection.get("createdAt"),
        "updatedAt": connection.get("updatedAt"),
        "lastTestedAt": connection.get("lastTestedAt"),
        "lastTestStatus": connection.get("lastTestStatus"),
        "lastImportAt": connection.get("lastImportAt"),
        "tenantId": connection.get("tenantId"),
        "ownerId": connection.get("ownerId"),
    }
