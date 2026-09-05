from __future__ import annotations

import base64
import csv
import io
import json
import re
from datetime import datetime, timezone
from typing import Any, Callable
from urllib import parse as urlparse

from backend_py.connectors import (
    ConnectorError,
    _HTMLTableAndTextParser,
    _apply_auth_headers,
    _decode_html,
    _http_fetch_bytes,
    _table_matrix_to_rows,
    _validate_public_url,
    build_connector_data_source,
)


ModelCompleteFn = Callable[[str], str]


def _heuristic_extract_by_instruction(html: str, instruction: str, *, source_url: str = "") -> dict[str, Any]:
    """Deterministic fallback when model is unavailable."""
    instruction_text = (instruction or "").strip()
    keywords = [token for token in re.split(r"[\s,，。；;、/|]+", instruction_text.lower()) if len(token) >= 2][:12]
    parser = _HTMLTableAndTextParser()
    parser.feed(html or "")
    parser.close()
    tables = parser.tables
    full_text = parser.text()
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", full_text) if item.strip()]

    # Also collect list items as pseudo paragraphs for pages without tables.
    list_items = re.findall(r"<li[^>]*>(.*?)</li>", html or "", flags=re.IGNORECASE | re.DOTALL)
    cleaned_list_items: list[str] = []
    for item in list_items:
        text_item = re.sub(r"<[^>]+>", " ", item)
        text_item = re.sub(r"\s+", " ", text_item).strip()
        if len(text_item) >= 4:
            cleaned_list_items.append(text_item)

    wants_table = any(key in instruction_text for key in ("表", "table", "排名", "列表", "对比", "csv", "销量", "数据", "排行"))
    # Prefer the richest table, not always the first decorative one.
    if tables and (wants_table or not keywords):
        scored: list[tuple[int, list[dict[str, str]]]] = []
        for matrix in tables[:12]:
            rows = _table_matrix_to_rows(matrix)
            if not rows:
                continue
            score = len(rows) * max(1, len(rows[0].keys()))
            # Boost if headers/cells match instruction keywords.
            sample = " ".join(list(rows[0].keys()) + [str(v) for v in list(rows[0].values())[:6]]).lower()
            if keywords and any(key in sample for key in keywords):
                score += 50
            scored.append((score, rows))
        if scored:
            scored.sort(key=lambda item: item[0], reverse=True)
            best_rows = scored[0][1][:1000]
            return {
                "kind": "table",
                "rows": best_rows,
                "meta": {
                    "extractMode": "table",
                    "sourceUrl": source_url,
                    "instruction": instruction_text,
                    "strategy": "heuristic_table_best",
                    "tableCount": len(tables),
                    "matchedKeywords": keywords,
                    "selectedScore": scored[0][0],
                },
            }

    # Keyword-focused paragraph/list extraction.
    corpus = paragraphs + cleaned_list_items
    selected: list[str] = []
    if keywords:
        for para in corpus:
            lower = para.lower()
            if any(key in lower for key in keywords):
                selected.append(para)
    if not selected:
        # Prefer denser content blocks.
        ranked = sorted(corpus, key=lambda item: len(item), reverse=True)
        selected = ranked[:40]
    if not selected and full_text.strip():
        selected = [full_text.strip()[:4000]]
    if not selected:
        raise ConnectorError("no content matched the instruction on this page", "empty_payload")

    # If many short list-like lines, materialize as single-column table for analysis.
    short_lines = [item for item in selected if 4 <= len(item) <= 120]
    if wants_table and len(short_lines) >= 5:
        rows = [{"item": item} for item in short_lines[:1000]]
        return {
            "kind": "table",
            "rows": rows,
            "meta": {
                "extractMode": "table",
                "sourceUrl": source_url,
                "instruction": instruction_text,
                "strategy": "heuristic_list_table",
                "matchedKeywords": keywords,
                "itemCount": len(rows),
            },
        }

    text = "\n\n".join(selected)
    return {
        "kind": "document",
        "text": text[:200_000],
        "paragraphs": selected[:200],
        "meta": {
            "extractMode": "text",
            "sourceUrl": source_url,
            "instruction": instruction_text,
            "strategy": "heuristic_text",
            "matchedKeywords": keywords,
            "paragraphCount": len(selected),
            "charCount": len(text),
        },
    }


def _parse_model_extraction_json(raw: str) -> dict[str, Any] | None:
    content = (raw or "").strip()
    if not content:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", content, flags=re.IGNORECASE)
    if fence:
        content = fence.group(1).strip()
    start = content.find("{")
    end = content.rfind("}")
    if start >= 0 and end > start:
        content = content[start : end + 1]
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _model_extract_by_instruction(
    *,
    html: str,
    instruction: str,
    source_url: str,
    model_complete: ModelCompleteFn | None,
) -> dict[str, Any] | None:
    if model_complete is None:
        return None
    sample = re.sub(r"\s+", " ", (html or ""))[:12000]
    prompt = (
        "你是网页信息抽取助手。根据用户指令，从网页 HTML/文本中提取相关内容。\n"
        "只返回 JSON，不要解释。格式二选一：\n"
        '1) 表格: {"kind":"table","columns":["列1","列2"],"rows":[{"列1":"a","列2":"b"}]}\n'
        '2) 文档: {"kind":"document","title":"标题","text":"正文","bullets":["要点1","要点2"]}\n'
        "要求：\n"
        "- 尽量贴合用户指令，不要编造页面不存在的事实\n"
        "- 表格最多 100 行\n"
        "- 文档 text 控制在 8000 字内\n"
        f"页面URL: {source_url}\n"
        f"用户指令: {instruction}\n"
        f"网页内容: {sample}\n"
    )
    try:
        raw = model_complete(prompt)
    except Exception:
        return None
    parsed = _parse_model_extraction_json(str(raw or ""))
    if not parsed:
        return None

    kind = str(parsed.get("kind") or "").strip().lower()
    if kind == "table":
        columns = [str(item).strip() for item in (parsed.get("columns") or []) if str(item).strip()]
        raw_rows = parsed.get("rows") or []
        rows: list[dict[str, str]] = []
        if isinstance(raw_rows, list):
            for item in raw_rows[:1000]:
                if not isinstance(item, dict):
                    continue
                if columns:
                    rows.append({col: "" if item.get(col) is None else str(item.get(col)) for col in columns})
                else:
                    rows.append({str(k): "" if v is None else str(v) for k, v in item.items()})
        if not rows:
            return None
        return {
            "kind": "table",
            "rows": rows,
            "meta": {
                "extractMode": "table",
                "sourceUrl": source_url,
                "instruction": instruction,
                "strategy": "model_table",
            },
        }

    text = str(parsed.get("text") or "").strip()
    bullets = [str(item).strip() for item in (parsed.get("bullets") or []) if str(item).strip()]
    title = str(parsed.get("title") or "").strip()
    parts: list[str] = []
    if title:
        parts.append(title)
    if text:
        parts.append(text)
    if bullets:
        parts.append("\n".join(f"- {item}" for item in bullets))
    merged = "\n\n".join(parts).strip()
    if not merged:
        return None
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", merged) if item.strip()]
    return {
        "kind": "document",
        "text": merged[:200_000],
        "paragraphs": paragraphs[:200],
        "meta": {
            "extractMode": "text",
            "sourceUrl": source_url,
            "instruction": instruction,
            "strategy": "model_text",
            "title": title,
            "bulletCount": len(bullets),
        },
    }


def _fetch_html_with_playwright(url: str, *, timeout_seconds: float = 20.0) -> str | None:
    """Optional JS rendering path. Returns None when playwright is unavailable/fails."""
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        return None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_default_timeout(max(5.0, float(timeout_seconds)) * 1000)
                page.goto(url, wait_until="domcontentloaded")
                # Give SPA pages a short settle time.
                page.wait_for_timeout(800)
                return page.content()
            finally:
                browser.close()
    except Exception:
        return None


def fetch_web_content_by_instruction(
    *,
    url: str,
    instruction: str,
    credentials: dict[str, Any] | None = None,
    headers: dict[str, Any] | None = None,
    model_complete: ModelCompleteFn | None = None,
    allow_private_hosts: bool = False,
    timeout_seconds: float = 20.0,
    render_js: bool = False,
) -> dict[str, Any]:
    """Fetch a web page and extract content guided by natural-language instruction."""
    instruction_text = (instruction or "").strip()
    if not instruction_text:
        raise ConnectorError("instruction is required", "invalid_config")
    if len(instruction_text) > 2000:
        raise ConnectorError("instruction is too long (max 2000 chars)", "invalid_config")

    target = _validate_public_url(url, allow_private_hosts=allow_private_hosts)
    request_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "workspace-smart-scraper/1.0",
    }
    if headers:
        request_headers.update({str(k): str(v) for k, v in headers.items()})
    _apply_auth_headers(request_headers, credentials or {})

    html = ""
    content_type = "text/html"
    render_mode = "static"
    raw_len = 0

    if render_js:
        rendered = _fetch_html_with_playwright(target, timeout_seconds=timeout_seconds)
        if rendered:
            html = rendered
            raw_len = len(rendered.encode("utf-8", errors="ignore"))
            render_mode = "playwright"
        # If playwright unavailable/fails, fall through to static fetch.

    if not html:
        raw, content_type = _http_fetch_bytes(target, headers=request_headers, timeout_seconds=timeout_seconds)
        html = _decode_html(raw, content_type)
        raw_len = len(raw)
        render_mode = "static"

    extracted = _model_extract_by_instruction(
        html=html,
        instruction=instruction_text,
        source_url=target,
        model_complete=model_complete,
    )
    if extracted is None:
        extracted = _heuristic_extract_by_instruction(html, instruction_text, source_url=target)
    extracted.setdefault("meta", {})
    extracted["meta"]["contentType"] = content_type
    extracted["meta"]["bytes"] = raw_len
    extracted["meta"]["renderMode"] = render_mode
    return extracted


def materialize_scrape_file(
    *,
    payload: dict[str, Any],
    instruction: str,
    source_url: str,
    preferred_format: str | None = None,
) -> dict[str, Any]:
    """Create an in-memory file artifact from scrape payload (csv/md/json)."""
    kind = str(payload.get("kind") or "document")
    fmt = (preferred_format or ("csv" if kind == "table" else "md")).strip().lower()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe_host = re.sub(r"[^a-zA-Z0-9_-]+", "-", urlparse.urlparse(source_url).netloc or "web")[:40] or "web"

    if kind == "table":
        rows = payload.get("rows") or []
        if not isinstance(rows, list) or not rows:
            raise ConnectorError("no table rows to materialize", "empty_payload")
        headers = list(rows[0].keys())
        if fmt == "json":
            content = json.dumps(
                {"sourceUrl": source_url, "instruction": instruction, "rows": rows},
                ensure_ascii=False,
                indent=2,
            )
            file_name = f"scrape-{safe_host}-{stamp}.json"
            mime = "application/json"
            extension = "json"
        else:
            buff = io.StringIO()
            writer = csv.DictWriter(buff, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key, "") for key in headers})
            content = buff.getvalue()
            file_name = f"scrape-{safe_host}-{stamp}.csv"
            mime = "text/csv"
            extension = "csv"
            fmt = "csv"
    else:
        text = str(payload.get("text") or "").strip()
        paragraphs = payload.get("paragraphs") or []
        if not text and paragraphs:
            text = "\n\n".join(str(item) for item in paragraphs)
        if not text:
            raise ConnectorError("no document text to materialize", "empty_payload")
        if fmt == "json":
            content = json.dumps(
                {
                    "sourceUrl": source_url,
                    "instruction": instruction,
                    "text": text,
                    "paragraphs": paragraphs,
                    "meta": payload.get("meta") or {},
                },
                ensure_ascii=False,
                indent=2,
            )
            file_name = f"scrape-{safe_host}-{stamp}.json"
            mime = "application/json"
            extension = "json"
        else:
            lines = [
                "# 智能网页采集结果",
                "",
                f"- 来源: {source_url}",
                f"- 指令: {instruction}",
                f"- 策略: {(payload.get('meta') or {}).get('strategy') or 'unknown'}",
                "",
                "## 内容",
                "",
                text,
            ]
            content = "\n".join(lines)
            file_name = f"scrape-{safe_host}-{stamp}.md"
            mime = "text/markdown"
            extension = "md"
            fmt = "md"

    raw = content.encode("utf-8")
    return {
        "fileName": file_name,
        "mimeType": mime,
        "format": fmt,
        "extension": extension,
        "contentText": content,
        "contentBase64": base64.b64encode(raw).decode("ascii"),
        "byteSize": len(raw),
        "kind": kind,
    }


def smart_scrape_to_dataset(
    *,
    url: str,
    instruction: str,
    dataset_name: str | None = None,
    credentials: dict[str, Any] | None = None,
    headers: dict[str, Any] | None = None,
    model_complete: ModelCompleteFn | None = None,
    preferred_format: str | None = None,
    allow_private_hosts: bool = False,
    timeout_seconds: float = 20.0,
    render_js: bool = False,
) -> dict[str, Any]:
    """End-to-end: scrape by instruction, materialize file, build importable dataset."""
    extracted = fetch_web_content_by_instruction(
        url=url,
        instruction=instruction,
        credentials=credentials,
        headers=headers,
        model_complete=model_complete,
        allow_private_hosts=allow_private_hosts,
        timeout_seconds=timeout_seconds,
        render_js=render_js,
    )
    source_url = str((extracted.get("meta") or {}).get("sourceUrl") or url)
    file_info = materialize_scrape_file(
        payload=extracted,
        instruction=instruction,
        source_url=source_url,
        preferred_format=preferred_format,
    )
    name = (dataset_name or file_info["fileName"]).strip() or file_info["fileName"]
    data_source = build_connector_data_source(
        name=name,
        connector_type="smart_web",
        payload=extracted,
        connection_id=None,
    )
    data_source["fileName"] = file_info["fileName"]
    data_source["formatLabel"] = f"SmartScrape:{file_info['format'].upper()}"
    data_source["sourceType"] = "smart_scrape"
    data_source["connectorType"] = "smart_web"
    data_source["sourceUrl"] = source_url
    data_source["scrapeInstruction"] = instruction
    data_source["generatedFile"] = {
        "fileName": file_info["fileName"],
        "mimeType": file_info["mimeType"],
        "format": file_info["format"],
        "byteSize": file_info["byteSize"],
        "contentBase64": file_info["contentBase64"],
    }
    data_source["scrapeMeta"] = extracted.get("meta") or {}
    return {
        "dataset": data_source,
        "file": file_info,
        "extraction": {
            "kind": extracted.get("kind"),
            "meta": extracted.get("meta") or {},
            "preview": (extracted.get("rows") or extracted.get("paragraphs") or [])[:5],
        },
    }
