from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable


SENSITIVE_KEY_PATTERNS = (
    re.compile(r"(phone|mobile|tel|cellphone)", re.I),
    re.compile(r"(email|mail)", re.I),
    re.compile(r"(id[_-]?card|identity|身份证|证件号)", re.I),
    re.compile(r"(password|passwd|secret|token|api[_-]?key)", re.I),
    re.compile(r"(bank|card|account|账号|卡号)", re.I),
)

PHONE_RE = re.compile(r"(?<!\d)(1\d{10})(?!\d)")
EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
ID_CARD_RE = re.compile(r"(?<!\d)(\d{15}|\d{17}[\dXx])(?!\d)")


def is_sensitive_key(key: str) -> bool:
    return any(pattern.search(str(key or "")) for pattern in SENSITIVE_KEY_PATTERNS)


def mask_phone(value: str) -> str:
    if len(value) < 7:
        return "*" * len(value)
    return value[:3] + "****" + value[-4:]


def mask_email(value: str) -> str:
    parts = value.split("@", 1)
    if len(parts) != 2:
        return "***"
    name, domain = parts
    if not name:
        return f"***@{domain}"
    keep = name[0]
    return f"{keep}***@{domain}"


def mask_id_card(value: str) -> str:
    if len(value) < 8:
        return "*" * len(value)
    return value[:4] + ("*" * (len(value) - 8)) + value[-4:]


def mask_generic(value: str) -> str:
    if len(value) <= 2:
        return "*" * len(value)
    if len(value) <= 6:
        return value[0] + ("*" * (len(value) - 2)) + value[-1]
    return value[:2] + ("*" * (len(value) - 4)) + value[-2:]


def mask_text(value: str) -> str:
    text = str(value)
    text = PHONE_RE.sub(lambda m: mask_phone(m.group(1)), text)
    text = EMAIL_RE.sub(lambda m: mask_email(m.group(0)), text)
    text = ID_CARD_RE.sub(lambda m: mask_id_card(m.group(1)), text)
    return text


def mask_value(key: str, value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, dict):
        return mask_dict(value)
    if isinstance(value, list):
        return [mask_value(key, item) for item in value]
    text = str(value)
    if is_sensitive_key(key):
        lowered = key.lower()
        if "phone" in lowered or "mobile" in lowered or "tel" in lowered:
            return mask_phone(text)
        if "email" in lowered or "mail" in lowered:
            return mask_email(text)
        if "id" in lowered or "证件" in key or "身份证" in key:
            return mask_id_card(text)
        if "password" in lowered or "secret" in lowered or "token" in lowered or "key" in lowered:
            return "******"
        return mask_generic(text)
    return mask_text(text)


def mask_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {str(key): mask_value(str(key), value) for key, value in payload.items()}


def mask_rows(rows: Iterable[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [mask_dict(row) if isinstance(row, dict) else row for row in (rows or [])]


def mask_data_source(data_source: dict[str, Any] | None) -> dict[str, Any] | None:
    if not data_source:
        return data_source
    masked = deepcopy(data_source)
    for key in ("previewRows", "analysisRows"):
        if isinstance(masked.get(key), list):
            masked[key] = mask_rows(masked.get(key))
    if isinstance(masked.get("fullText"), str):
        masked["fullText"] = mask_text(masked["fullText"])
    if isinstance(masked.get("textPreview"), str):
        masked["textPreview"] = mask_text(masked["textPreview"])
    return masked


def mask_task_payload(task: dict[str, Any] | None) -> dict[str, Any] | None:
    if not task:
        return task
    masked = deepcopy(task)
    if isinstance(masked.get("dataSource"), dict):
        masked["dataSource"] = mask_data_source(masked["dataSource"])
    if isinstance(masked.get("summary"), str):
        masked["summary"] = mask_text(masked["summary"])
    if isinstance(masked.get("request"), str):
        masked["request"] = mask_text(masked["request"])
    return masked


def build_watermark_lines(
    *,
    username: str | None,
    tenant_id: str | None,
    exported_at: datetime | None = None,
    label: str = "CONFIDENTIAL",
) -> list[str]:
    ts = (exported_at or datetime.now(timezone.utc)).astimezone().strftime("%Y-%m-%d %H:%M")
    who = username or "unknown-user"
    tenant = tenant_id or "unknown-tenant"
    return [
        f"{label} | {tenant}/{who}",
        f"Exported at {ts}",
    ]


def apply_text_watermark(content: str, lines: list[str]) -> str:
    banner = "\n".join(f"> {line}" for line in lines)
    return f"{banner}\n\n{content}".rstrip() + "\n"


def apply_html_watermark(content: str, lines: list[str]) -> str:
    text = " | ".join(lines)
    style = (
        "position:fixed;inset:0;pointer-events:none;z-index:9999;"
        "display:flex;align-items:center;justify-content:center;"
        "font-size:28px;color:rgba(20,40,60,0.12);transform:rotate(-24deg);"
        "font-weight:700;letter-spacing:0.08em;"
    )
    mark = f'<div style="{style}">{text}</div>'
    if "</body>" in content.lower():
        # keep simple insertion near end
        idx = content.lower().rfind("</body>")
        return content[:idx] + mark + content[idx:]
    return mark + content


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def is_expired(created_at: str | None, *, retain_days: int, now: datetime | None = None) -> bool:
    if retain_days <= 0:
        return False
    created = parse_iso(created_at)
    if created is None:
        return False
    current = now or datetime.now(timezone.utc)
    return created < (current - timedelta(days=retain_days))
