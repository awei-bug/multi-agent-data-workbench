from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from html.parser import HTMLParser
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
            "type": "web_page",
            "name": "网页抓取",
            "description": "自动抓取网页中的 HTML 表格或正文文本，导入为可分析数据源。",
            "configFields": [
                {"key": "url", "label": "网页 URL", "required": True},
                {
                    "key": "extractMode",
                    "label": "提取模式（table / text / auto）",
                    "required": False,
                    "default": "auto",
                },
                {"key": "tableIndex", "label": "表格序号（从 1 开始）", "required": False, "default": 1},
                {"key": "headers", "label": "额外请求头（JSON 对象）", "required": False},
            ],
            "credentialFields": [
                {"key": "bearerToken", "label": "Bearer Token", "required": False, "secret": True},
                {"key": "basicUsername", "label": "Basic 用户名", "required": False},
                {"key": "basicPassword", "label": "Basic 密码", "required": False, "secret": True},
            ],
        },
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
        {
            "type": "data_hub",
            "name": "商品记忆库（data-hub）",
            "description": (
                "从商品知识数据中心只读拉取商品与指标记录，作为经营诊断的分析输入，"
                "而不是上传 CSV。返回的字段不含本地推导结论，只含原始事实。"
            ),
            "configFields": [
                {"key": "url", "label": "data-hub 地址", "required": True},
                {"key": "tenantSlug", "label": "租户标识", "required": True},
                {"key": "status", "label": "状态过滤（draft/approved/published）", "required": False},
                {"key": "limit", "label": "最大条数", "required": False, "default": 200},
            ],
            "credentialFields": [
                {"key": "token", "label": "X-Hub-Token", "required": False, "secret": True},
            ],
        },
    ]


class _HTMLTableAndTextParser(HTMLParser):
    """Extract HTML tables and visible text without third-party dependencies."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._current_table: list[list[str]] | None = None
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None
        self._capture_text = True
        self._skip_depth = 0
        self._text_chunks: list[str] = []
        self._block_tags = {
            "p",
            "div",
            "section",
            "article",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "br",
            "tr",
        }

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth > 0:
            return
        if normalized == "table":
            self._current_table = []
            return
        if normalized == "tr" and self._current_table is not None:
            self._current_row = []
            return
        if normalized in {"td", "th"} and self._current_row is not None:
            self._current_cell = []
            return
        if normalized == "br":
            self._text_chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript"}:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth > 0:
            return
        if normalized in {"td", "th"} and self._current_cell is not None and self._current_row is not None:
            cell = re.sub(r"\s+", " ", "".join(self._current_cell)).strip()
            self._current_row.append(cell)
            self._current_cell = None
            return
        if normalized == "tr" and self._current_row is not None and self._current_table is not None:
            if any(cell.strip() for cell in self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
            return
        if normalized == "table" and self._current_table is not None:
            if self._current_table:
                self.tables.append(self._current_table)
            self._current_table = None
            return
        if normalized in self._block_tags:
            self._text_chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if self._current_cell is not None:
            self._current_cell.append(data)
            return
        # Ignore pure whitespace noise.
        if data.strip():
            self._text_chunks.append(data)

    def text(self) -> str:
        joined = "".join(self._text_chunks)
        joined = re.sub(r"[ \t]+", " ", joined)
        joined = re.sub(r"\n{3,}", "\n\n", joined)
        return joined.strip()


def _table_matrix_to_rows(matrix: list[list[str]]) -> list[dict[str, str]]:
    if not matrix:
        return []
    width = max(len(row) for row in matrix)
    normalized = [row + [""] * (width - len(row)) for row in matrix]
    header_row = normalized[0]
    headers: list[str] = []
    used: dict[str, int] = {}
    for index, raw in enumerate(header_row):
        name = (raw or "").strip() or f"列{index + 1}"
        count = used.get(name, 0)
        used[name] = count + 1
        headers.append(name if count == 0 else f"{name}_{count + 1}")

    body = normalized[1:] if len(normalized) > 1 else []
    # If there is only one row, treat it as data with generic headers.
    if not body:
        headers = [f"列{index + 1}" for index in range(width)]
        body = normalized

    rows: list[dict[str, str]] = []
    for row in body:
        item = {headers[index]: row[index] for index in range(width)}
        if any(str(value).strip() for value in item.values()):
            rows.append(item)
    return rows


def _validate_public_url(url: str, *, allow_private_hosts: bool = False) -> str:
    value = (url or "").strip()
    if not value:
        raise ConnectorError("url is required", "invalid_config")
    parsed = urlparse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ConnectorError("only http/https URLs are supported", "invalid_config")
    if not parsed.netloc:
        raise ConnectorError("url host is required", "invalid_config")
    host = (parsed.hostname or "").lower()
    if allow_private_hosts:
        return value
    # Basic SSRF guard for common private targets.
    blocked_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
    if host in blocked_hosts or host.endswith(".local"):
        raise ConnectorError("private/local hosts are not allowed", "invalid_config")
    if host.startswith("10.") or host.startswith("192.168.") or host.startswith("169.254."):
        raise ConnectorError("private network hosts are not allowed", "invalid_config")
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", host):
        raise ConnectorError("private network hosts are not allowed", "invalid_config")
    return value


def _apply_auth_headers(headers: dict[str, str], credentials: dict[str, Any]) -> None:
    token = str(credentials.get("bearerToken") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    basic_user = str(credentials.get("basicUsername") or "").strip()
    basic_password = str(credentials.get("basicPassword") or "")
    if basic_user:
        raw = f"{basic_user}:{basic_password}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")


def _parse_extra_headers(config: dict[str, Any]) -> dict[str, str]:
    extra_headers = config.get("headers") or {}
    if isinstance(extra_headers, str) and extra_headers.strip():
        try:
            extra_headers = json.loads(extra_headers)
        except json.JSONDecodeError as error:
            raise ConnectorError("headers must be valid JSON object", "invalid_config") from error
    if not isinstance(extra_headers, dict):
        return {}
    return {str(key): str(value) for key, value in extra_headers.items()}


def _http_fetch_bytes(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout_seconds: float = 20.0,
    max_bytes: int = 5_000_000,
) -> tuple[bytes, str]:
    request = urlrequest.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urlrequest.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - operator configured URL
            content_type = response.headers.get("Content-Type", "")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ConnectorError(
                        f"remote response exceeds max size ({max_bytes} bytes)",
                        "response_too_large",
                    )
                chunks.append(chunk)
            return b"".join(chunks), content_type
    except urlerror.HTTPError as error:
        raise ConnectorError(f"http error: {error.code}", "http_error") from error
    except urlerror.URLError as error:
        raise ConnectorError(f"network error: {error.reason}", "network_error") from error


def _decode_html(raw: bytes, content_type: str) -> str:
    charset = "utf-8"
    match = re.search(r"charset=([\w\-]+)", content_type or "", flags=re.IGNORECASE)
    if match:
        charset = match.group(1)
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


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
    allow_private = bool(config.get("allowPrivateHosts"))
    url = _validate_public_url(str(config.get("url") or ""), allow_private_hosts=allow_private)
    method = str(config.get("method") or "GET").upper()
    if method not in {"GET", "POST"}:
        raise ConnectorError("method must be GET or POST", "invalid_config")
    headers = {"Accept": "application/json", "User-Agent": "workspace-connector/1.0"}
    headers.update(_parse_extra_headers(config))
    _apply_auth_headers(headers, credentials or {})

    body = None
    if method == "POST":
        body = json.dumps(config.get("body") or {}).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    raw, content_type = _http_fetch_bytes(
        url,
        method=method,
        headers=headers,
        body=body,
        timeout_seconds=timeout_seconds,
    )
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConnectorError(f"response is not valid JSON ({content_type})", "invalid_payload") from error
    return _rows_from_json_payload(payload, str(config.get("jsonPath") or "").strip() or None)


def _web_page_fetch(
    config: dict[str, Any],
    credentials: dict[str, Any],
    *,
    timeout_seconds: float = 20.0,
) -> dict[str, Any]:
    allow_private = bool(config.get("allowPrivateHosts"))
    url = _validate_public_url(str(config.get("url") or ""), allow_private_hosts=allow_private)
    extract_mode = str(config.get("extractMode") or "auto").strip().lower() or "auto"
    if extract_mode not in {"auto", "table", "text"}:
        raise ConnectorError("extractMode must be auto/table/text", "invalid_config")
    table_index = int(config.get("tableIndex") or 1)
    if table_index < 1:
        raise ConnectorError("tableIndex must be >= 1", "invalid_config")

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "workspace-web-connector/1.0",
    }
    headers.update(_parse_extra_headers(config))
    _apply_auth_headers(headers, credentials or {})
    raw, content_type = _http_fetch_bytes(url, headers=headers, timeout_seconds=timeout_seconds)
    html = _decode_html(raw, content_type)

    parser = _HTMLTableAndTextParser()
    parser.feed(html)
    parser.close()
    tables = parser.tables
    text = parser.text()

    if extract_mode in {"auto", "table"} and tables:
        if table_index > len(tables):
            raise ConnectorError(
                f"tableIndex {table_index} out of range, found {len(tables)} tables",
                "table_not_found",
            )
        rows = _table_matrix_to_rows(tables[table_index - 1])
        if not rows:
            raise ConnectorError("selected HTML table is empty", "empty_payload")
        max_rows = int(config.get("maxRows") or 1000)
        if max_rows > 0:
            rows = rows[:max_rows]
        return {
            "kind": "table",
            "rows": rows,
            "meta": {
                "tableCount": len(tables),
                "tableIndex": table_index,
                "extractMode": "table",
                "sourceUrl": url,
            },
        }

    if extract_mode == "table":
        raise ConnectorError("no HTML tables found on the page", "table_not_found")

    if not text:
        raise ConnectorError("no readable text found on the page", "empty_payload")
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", text) if item.strip()]
    return {
        "kind": "document",
        "text": text,
        "paragraphs": paragraphs,
        "meta": {
            "tableCount": len(tables),
            "extractMode": "text",
            "sourceUrl": url,
            "charCount": len(text),
            "paragraphCount": len(paragraphs),
        },
    }


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
    normalized = (connector_type or "").strip().lower()
    if normalized == "web_page":
        payload = _web_page_fetch(config or {}, credentials or {})
        if payload["kind"] == "table":
            rows = payload["rows"]
            columns = list(rows[0].keys()) if rows else []
            return {
                "ok": True,
                "kind": "table",
                "rowCount": len(rows),
                "columnCount": len(columns),
                "columns": columns[:50],
                "previewRows": rows[:5],
                "meta": payload.get("meta") or {},
            }
        text = str(payload.get("text") or "")
        paragraphs = payload.get("paragraphs") or []
        return {
            "ok": True,
            "kind": "document",
            "rowCount": len(paragraphs),
            "columnCount": 1,
            "columns": ["text"],
            "previewRows": [{"text": item[:200]} for item in paragraphs[:5]],
            "meta": {
                **(payload.get("meta") or {}),
                "textPreview": text[:300],
            },
        }

    rows = fetch_rows(connector_type, config, credentials)
    columns = list(rows[0].keys()) if rows else []
    return {
        "ok": True,
        "kind": "table",
        "rowCount": len(rows),
        "columnCount": len(columns),
        "columns": columns[:50],
        "previewRows": rows[:5],
    }


_DATA_HUB_LIST_FIELDS = (
    "external_id",
    "title",
    "subtitle",
    "title_en",
    "price",
    "currency",
    "stock",
    "category",
    "brand",
    "scenario",
    "status",
    "source",
    "source_job_id",
    "version",
    "updated_at",
)


def _hub_scalar(value: object) -> str:
    """把 data-hub 的列表型字段压平成可分析的字符串列。

    数组与对象在 CSV 里没有位置，压成 `a;b` 或 `k=v;k=v`，否则前端表格列会炸。
    空值返回空串而不是 "[]"，避免分析节点把字面量 "[]" 当成内容。
    """
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ";".join(str(item) for item in value if str(item).strip())
    if isinstance(value, dict):
        return ";".join(f"{k}={v}" for k, v in value.items())
    return str(value)


def _data_hub_fetch(
    config: dict[str, Any],
    credentials: dict[str, Any],
    *,
    timeout_seconds: float = 20.0,
) -> list[dict[str, str]]:
    """只读拉取 data-hub 商品记录。

    data-hub 默认跑在本机（127.0.0.1:8120），因此这里显式放开私有地址限制——
    这是内网自建服务的既定部署形态，不是绕过 SSRF 防护。
    """
    url = _validate_public_url(str(config.get("url") or ""), allow_private_hosts=True)
    tenant = str(config.get("tenantSlug") or config.get("tenant") or "").strip()
    if not tenant:
        raise ConnectorError("tenantSlug is required", "invalid_config")
    # 区分「未配置」与「显式填 0」：后者是用户误操作，必须报错而不是悄悄用默认值。
    raw_limit = config.get("limit")
    limit = 200 if raw_limit in (None, "") else int(raw_limit)
    if limit <= 0 or limit > 500:
        raise ConnectorError("limit must be between 1 and 500", "invalid_config")

    path = f"/hub/products?tenant={urlparse.quote(tenant)}&limit={limit}"
    status = str(config.get("status") or "").strip()
    if status:
        path += f"&status={urlparse.quote(status, safe='')}"

    headers = {"Accept": "application/json", "User-Agent": "workspace-connector/1.0"}
    token = str((credentials or {}).get("token") or "").strip()
    if token:
        headers["X-Hub-Token"] = token
    headers["X-Hub-Tenant"] = tenant

    base = url.rstrip("/")
    raw, content_type = _http_fetch_bytes(
        f"{base}{path}",
        method="GET",
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConnectorError(f"response is not valid JSON ({content_type})", "invalid_payload") from error
    if not isinstance(payload, dict):
        raise ConnectorError("data-hub payload must be an object", "invalid_payload")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ConnectorError("data-hub payload has no items array", "invalid_payload")

    rows: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row: dict[str, str] = {}
        for field in _DATA_HUB_LIST_FIELDS:
            row[field] = _hub_scalar(item.get(field))
        for field in ("tags", "selling_points", "spec", "faq"):
            row[field] = _hub_scalar(item.get(field))
        if any(value for value in row.values()):
            rows.append(row)
    if not rows:
        raise ConnectorError("data-hub returned no product rows", "empty_payload")
    return rows


def fetch_rows(connector_type: str, config: dict[str, Any], credentials: dict[str, Any]) -> list[dict[str, str]]:
    normalized = (connector_type or "").strip().lower()
    if normalized == "http_json":
        return _http_json_fetch(config or {}, credentials or {})
    if normalized == "postgres":
        return _postgres_fetch(config or {}, credentials or {})
    if normalized == "data_hub":
        return _data_hub_fetch(config or {}, credentials or {})
    if normalized == "web_page":
        payload = _web_page_fetch(config or {}, credentials or {})
        if payload["kind"] != "table":
            raise ConnectorError("web page extract mode returned text, not tabular rows", "not_tabular")
        return payload["rows"]
    raise ConnectorError(f"unsupported connector type: {connector_type}", "unsupported_connector")


def fetch_connector_payload(
    connector_type: str,
    config: dict[str, Any],
    credentials: dict[str, Any],
) -> dict[str, Any]:
    """Fetch connector payload in either table or document form."""
    normalized = (connector_type or "").strip().lower()
    if normalized == "web_page":
        return _web_page_fetch(config or {}, credentials or {})
    rows = fetch_rows(connector_type, config, credentials)
    return {"kind": "table", "rows": rows, "meta": {"extractMode": "table"}}


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


def build_document_data_source(
    *,
    name: str,
    connector_type: str,
    text: str,
    connection_id: str | None = None,
    source_url: str | None = None,
) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ConnectorError("no text content to import", "empty_payload")
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", cleaned) if item.strip()]
    preview = cleaned[:2000]
    return {
        "kind": "document",
        "formatLabel": f"Connector:{connector_type}",
        "fileName": name,
        "columnCount": 1,
        "rowCount": len(paragraphs) or 1,
        "columns": [{"name": "text", "type": "string"}],
        "previewRows": [{"text": item[:300]} for item in paragraphs[:20]],
        "analysisRows": [{"text": item} for item in paragraphs[:200]],
        "analysisScope": {
            "mode": "full",
            "rowCount": len(paragraphs) or 1,
            "rowsProcessed": min(len(paragraphs) or 1, 200),
        },
        "profile": {
            "charCount": len(cleaned),
            "wordCount": len(re.findall(r"\S+", cleaned)),
            "lineCount": cleaned.count("\n") + 1,
            "paragraphCount": len(paragraphs),
            "sampleParagraphs": paragraphs[:5],
        },
        "fieldMappings": [],
        "textPreview": preview,
        "fullText": cleaned[:200_000],
        "sourceType": "connector",
        "connectorType": connector_type,
        "connectionId": connection_id,
        "sourceUrl": source_url or "",
    }


def build_connector_data_source(
    *,
    name: str,
    connector_type: str,
    payload: dict[str, Any],
    connection_id: str | None = None,
) -> dict[str, Any]:
    kind = str(payload.get("kind") or "table")
    if kind == "document":
        return build_document_data_source(
            name=name,
            connector_type=connector_type,
            text=str(payload.get("text") or ""),
            connection_id=connection_id,
            source_url=str((payload.get("meta") or {}).get("sourceUrl") or ""),
        )
    rows = payload.get("rows") or []
    if not isinstance(rows, list):
        raise ConnectorError("invalid connector payload rows", "invalid_payload")
    return build_table_data_source(
        name=name,
        connector_type=connector_type,
        rows=rows,
        connection_id=connection_id,
    )


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
