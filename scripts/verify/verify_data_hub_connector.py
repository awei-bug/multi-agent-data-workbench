# -*- coding: utf-8 -*-
"""data_hub 连接器自检：把商品记忆库只读导入为可分析数据源。

用法::

    python scripts/verify/verify_data_hub_connector.py

覆盖 7 项断言：
1. data_hub 出现在连接器类型清单中
2. 缺 tenantSlug 时报 invalid_config，而不是默默拉全库
3. limit 越界（0 或 >500）被拒绝
4. SSRF 防护对内网地址显式放开（data-hub 默认跑在 127.0.0.1）
5. 远端返回无 items 时报 empty_payload，不产生空数据源
6. 数组/字典字段被压平成字符串列
7. 拉取结果能走 build_table_data_source 生成合法表格数据源

前置：不需要真实 data-hub。用 MockHTTP 拦截 urllib，无网络依赖。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib import request as urlrequest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.connectors import (  # noqa: E402
    ConnectorError,
    build_table_data_source,
    fetch_connector_payload,
    fetch_rows,
    list_connector_types,
    test_connection,
)

checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  {detail}" if detail else ""))


def main() -> int:
    # --- 1. 已注册 ---
    types = {item["type"]: item for item in list_connector_types()}
    check(
        "data_hub.registered",
        "data_hub" in types,
        " / ".join(sorted(types.keys())),
    )

    # --- 2. 缺 tenantSlug ---
    try:
        fetch_rows("data_hub", {"url": "http://127.0.0.1:8120"}, {})
        check("data_hub.requires.tenant", False, "未抛错")
    except ConnectorError as exc:
        check("data_hub.requires.tenant", exc.code == "invalid_config", f"code={exc.code}")

    # --- 3. limit 越界 ---
    for bad_limit in (0, 501):
        try:
            fetch_rows(
                "data_hub",
                {"url": "http://127.0.0.1:8120", "tenantSlug": "demo", "limit": bad_limit},
                {},
            )
            check(f"data_hub.limit.rejects.{bad_limit}", False, "未抛错")
        except ConnectorError as exc:
            check(f"data_hub.limit.rejects.{bad_limit}", exc.code == "invalid_config", f"code={exc.code}")

    # --- 4. 内网地址放行（data-hub 默认部署形态）---
    try:
        # 这里会因为网络不可达而失败，但错误码应为 network_error / http_error，
        # 而不是 private/local hosts are not allowed。
        fetch_rows("data_hub", {"url": "http://127.0.0.1:8120", "tenantSlug": "demo"}, {})
        check("data_hub.allows.private.host", True, "unexpectedly reachable")
    except ConnectorError as exc:
        allowed = exc.code in {"network_error", "http_error", "empty_payload", "invalid_payload"}
        check(
            "data_hub.allows.private.host",
            allowed,
            f"code={exc.code} msg={exc.message}",
        )

    # --- 5/6/7. 用本地打桩的 HTTP 响应验证整条链路 ---
    sample_items = [
        {
            "external_id": "cc-verify-001",
            "title": "便携榨汁杯 380ml",
            "subtitle": "USB 充电一次榨 15 杯",
            "price": 129.0,
            "stock": 30,
            "category": "厨具",
            "brand": "TestBrand",
            "status": "published",
            "version": 3,
            "updated_at": "2026-12-01T00:00:00+00:00",
            "tags": ["榨汁杯", "便携"],
            "selling_points": ["380ml 容量", "刀头可拆洗"],
            "spec": {"容量": "380ml", "电池": "2000mAh"},
            "faq": [{"q": "能榨冰块吗", "a": "不建议"}],
        },
        {
            "external_id": "cc-verify-002",
            "title": "不锈钢水杯 500ml",
            "price": 89.0,
            "stock": 12,
            "category": "日用百货",
            "status": "approved",
            "version": 1,
            "tags": [],
            "selling_points": [],
            "spec": {},
            "faq": [],
        },
    ]
    payload_bytes = json.dumps({"ok": True, "count": 2, "items": sample_items}).encode("utf-8")

    class _FakeResponse:
        """模拟 urllib 响应：按调用方请求的字节数分块返回。

        `_http_fetch_bytes` 会循环 `read(64*1024)` 累加总量，所以这里不能一次
        性 `read()` 返回整个 body，否则超过 max_bytes 触发 response_too_large。
        """

        def __init__(self, body: bytes) -> None:
            self._body = body
            self._pos = 0
            self.headers = {"Content-Type": "application/json; charset=utf-8"}

        def read(self, amount: int = -1) -> bytes:  # noqa: D102
            if amount is None or amount < 0:
                chunk = self._body[self._pos :]
                self._pos = len(self._body)
                return chunk
            chunk = self._body[self._pos : self._pos + amount]
            self._pos += len(chunk)
            return chunk

        def __enter__(self):  # noqa: D102
            return self

        def __exit__(self, *_exc):  # noqa: D102
            return False

    captured: dict[str, str] = {}

    def fake_urlopen(req, timeout=None):  # noqa: ANN001
        captured["url"] = req.full_url
        # urllib 会把 header 键规范化为首字母大写（X-hub-tenant），
        # 因此这里做大小写无关匹配，否则会误判为「没发租户头」。
        captured["tenant"] = next(
            (v for k, v in req.header_items() if k.lower() == "x-hub-tenant"),
            "",
        )
        return _FakeResponse(payload_bytes)

    original_urlopen = urlrequest.urlopen
    urlrequest.urlopen = fake_urlopen
    try:
        rows = fetch_rows(
            "data_hub",
            {"url": "http://127.0.0.1:8120", "tenantSlug": "demo", "limit": 200},
            {"token": "hub-local-token"},
        )
    except ConnectorError as exc:
        rows = []
        print(f"  (fetch failed: {exc.code} {exc.message})")
    finally:
        urlrequest.urlopen = original_urlopen

    check(
        "data_hub.fetches.rows",
        len(rows) == 2 and rows[0]["external_id"] == "cc-verify-001",
        f"rows={len(rows)}",
    )
    check(
        "data_hub.sends.tenant.header",
        captured.get("tenant") == "demo",
        f"X-Hub-Tenant={captured.get('tenant')!r}",
    )
    check(
        "data_hub.flattens.list.fields",
        rows and rows[0]["selling_points"] == "380ml 容量;刀头可拆洗",
        f"selling_points={rows[0]['selling_points'] if rows else None}",
    )
    check(
        "data_hub.flattens.dict.fields",
        rows and rows[0]["spec"] == "容量=380ml;电池=2000mAh",
        f"spec={rows[0]['spec'] if rows else None}",
    )
    check(
        "data_hub.empty.list.stays.empty",
        len(rows) > 1 and rows[1]["selling_points"] == "",
        f"second row selling_points={rows[1]['selling_points'] if len(rows) > 1 else None}",
    )

    # --- 5. 无 items 时报错而非空数据源 ---
    empty_payload = json.dumps({"ok": True, "items": []}).encode("utf-8")

    def fake_urlopen_empty(req, timeout=None):  # noqa: ANN001
        return _FakeResponse(empty_payload)

    urlrequest.urlopen = fake_urlopen_empty
    try:
        try:
            fetch_rows("data_hub", {"url": "http://127.0.0.1:8120", "tenantSlug": "demo"}, {})
            check("data_hub.empty.payload.rejected", False, "未抛错")
        except ConnectorError as exc:
            check("data_hub.empty.payload.rejected", exc.code == "empty_payload", f"code={exc.code}")
    finally:
        urlrequest.urlopen = original_urlopen

    # --- 7. 能生成合法表格数据源 ---
    try:
        source = build_table_data_source(
            name="data-hub 商品",
            connector_type="data_hub",
            rows=rows,
            connection_id=None,
        )
        ok = (
            source["kind"] == "table"
            and source["rowCount"] == 2
            and any(col["name"] == "external_id" for col in source["columns"])
        )
        check("data_hub.builds.table.source", ok, f"rowCount={source.get('rowCount')}")

        # --- 附带的连接器类型在 test_connection 里也能走通 ---
        urlrequest.urlopen = fake_urlopen
        try:
            result = test_connection(
                "data_hub",
                {"url": "http://127.0.0.1:8120", "tenantSlug": "demo"},
                {},
            )
            check(
                "data_hub.test.connection",
                result.get("ok") is True and result.get("rowCount") == 2,
                f"rowCount={result.get('rowCount')}",
            )
        finally:
            urlrequest.urlopen = original_urlopen
    except Exception as exc:  # noqa: BLE001
        check("data_hub.builds.table.source", False, f"raised {exc!r}")

    # --- 8. 不写：连接器只有 GET 语义（fetch_connector_payload 不发 body）---
    try:
        fetch_connector_payload("data_hub", {"url": "http://127.0.0.1:8120", "tenantSlug": "demo"}, {})
        check("data_hub.payload.fetch", True)
    except ConnectorError as exc:
        check("data_hub.payload.fetch", exc.code in {"network_error", "http_error"}, f"code={exc.code}")
    except Exception as exc:  # noqa: BLE001
        check("data_hub.payload.fetch", False, f"raised {exc!r}")

    passed = sum(1 for _, ok, _ in checks if ok)
    print(f"\n{passed}/{len(checks)} passed")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
