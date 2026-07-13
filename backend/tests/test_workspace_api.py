import logging
import base64
import io
import unittest
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from fastapi.testclient import TestClient

from backend_py.app import create_app


class FakeChatClient:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def complete(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return "model generated summary"


class BrokenRepository:
    def get_active_task(self) -> dict:
        raise RuntimeError("database unavailable")


class BrokenHealthRepository(BrokenRepository):
    def ping(self) -> dict:
        raise RuntimeError("database unavailable")


def build_xlsx_bytes(worksheet_relationship_id: str = "rId1") -> bytes:
    workbook = io.BytesIO()
    with ZipFile(workbook, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>""",
        )
        archive.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""",
        )
        archive.writestr(
            "xl/workbook.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="%s"/>
  </sheets>
</workbook>""" % worksheet_relationship_id,
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>""" % worksheet_relationship_id,
        )
        archive.writestr(
            "xl/sharedStrings.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
  <si><t>month</t></si>
  <si><t>region</t></si>
  <si><t>sales</t></si>
  <si><t>2025-04</t></si>
  <si><t>华东</t></si>
  <si><t>4100</t></si>
</sst>""",
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>3</v></c>
      <c r="B2" t="s"><v>4</v></c>
      <c r="C2" t="s"><v>5</v></c>
    </row>
  </sheetData>
</worksheet>""",
        )
    return workbook.getvalue()


def build_docx_bytes() -> bytes:
    document = io.BytesIO()
    with ZipFile(document, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""",
        )
        archive.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
        )
        archive.writestr(
            "word/document.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>第一段结论</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段行动项</w:t></w:r></w:p>
  </w:body>
</w:document>""",
        )
    return document.getvalue()


class WorkspaceApiTest(unittest.TestCase):
    def setUp(self) -> None:
        logging.getLogger("workspace_api").disabled = True
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()
        logging.getLogger("workspace_api").disabled = False

    def _scope_headers(self, tenant_id: str, user_id: str) -> dict[str, str]:
        return {
            "x-workspace-tenant-id": tenant_id,
            "x-workspace-user-id": user_id,
        }

    def test_get_active_task_returns_workspace_session(self) -> None:
        response = self.client.get("/api/active-task")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], "workspace-active-session")
        self.assertEqual(payload["mode"], "live")

    def test_health_check_reports_database_and_model(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertIn("x-request-id", response.headers)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["database"]["type"], "sqlite")
        self.assertTrue(payload["model"]["configured"])
        self.assertEqual(payload["model"]["timeoutSeconds"], 60.0)
        self.assertEqual(response.headers["x-workspace-tenant-id"], "local-tenant")
        self.assertEqual(response.headers["x-workspace-user-id"], "local-user")

    def test_live_and_ready_checks_report_service_state(self) -> None:
        live = self.client.get("/api/health/live")
        ready = self.client.get("/api/health/ready")

        self.assertEqual(live.status_code, 200)
        self.assertEqual(live.json()["service"], "workspace-api")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["status"], "ok")
        self.assertEqual(ready.json()["checks"]["database"]["ok"], True)
        self.assertEqual(ready.json()["checks"]["model"]["configured"], True)

    def test_responses_include_basic_security_headers(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")

    def test_rejects_request_body_over_configured_limit(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            max_request_body_bytes=20,
        )
        client = TestClient(app)

        response = client.post("/api/intent/parse", json={"request": "x" * 64})

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["message"], "request body too large")

    def test_rate_limits_repeated_requests(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            rate_limit_per_minute=2,
        )
        client = TestClient(app)

        self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertEqual(client.get("/api/health").status_code, 200)
        response = client.get("/api/health")

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["message"], "too many requests")
        self.assertGreaterEqual(response.json()["error"]["details"]["retryAfterSeconds"], 1)
        self.assertEqual(response.headers.get("x-ratelimit-backend"), "memory")
        self.assertEqual(response.headers.get("x-ratelimit-remaining"), "0")

    def test_health_check_reports_database_failure_as_unavailable(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository=BrokenHealthRepository(),  # type: ignore[arg-type]
        )
        client = TestClient(app)

        response = client.get("/api/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertEqual(response.json()["database"]["ok"], False)
        self.assertIn("database unavailable", response.json()["database"]["error"])

    def test_ready_check_reports_database_failure_as_unavailable(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository=BrokenHealthRepository(),  # type: ignore[arg-type]
        )
        client = TestClient(app)

        response = client.get("/api/health/ready")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertEqual(response.json()["checks"]["database"]["ok"], False)

    def test_unhandled_errors_return_stable_json(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository=BrokenRepository(),  # type: ignore[arg-type]
        )
        client = TestClient(app)

        response = client.get("/api/active-task", headers={"x-request-id": "test-request-id"})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["x-request-id"], "test-request-id")
        self.assertEqual(
            response.json(),
            {
                "error": {"code": "internal_server_error", "message": "internal server error", "details": {}},
                "requestId": "test-request-id",
            },
        )

    def test_write_operations_create_audit_event(self) -> None:
        self.client.patch("/api/active-task", json={"summary": "audited"})

        response = self.client.get("/api/audit/events")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["action"], "active_task.patch")
        self.assertEqual(payload["items"][0]["target"], "workspace-active-session")
        self.assertEqual(payload["pagination"]["offset"], 0)

    def test_active_task_is_isolated_by_workspace_scope(self) -> None:
        user_a = self._scope_headers("tenant-a", "user-a")
        user_b = self._scope_headers("tenant-a", "user-b")

        self.client.patch("/api/active-task", json={"summary": "A summary"}, headers=user_a)
        self.client.patch("/api/active-task", json={"summary": "B summary"}, headers=user_b)

        response_a = self.client.get("/api/active-task", headers=user_a)
        response_b = self.client.get("/api/active-task", headers=user_b)

        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_b.status_code, 200)
        self.assertEqual(response_a.json()["summary"], "A summary")
        self.assertEqual(response_b.json()["summary"], "B summary")

    def test_history_and_audit_are_isolated_by_workspace_scope(self) -> None:
        user_a = self._scope_headers("tenant-a", "user-a")
        user_b = self._scope_headers("tenant-a", "user-b")

        self.client.patch("/api/active-task", json={"name": "用户A任务", "summary": "仅A可见"}, headers=user_a)
        saved_a = self.client.post("/api/history/save-active-task", headers=user_a).json()
        self.client.patch("/api/active-task", json={"name": "用户B任务", "summary": "仅B可见"}, headers=user_b)
        saved_b = self.client.post("/api/history/save-active-task", headers=user_b).json()

        history_a = self.client.get("/api/history/tasks", headers=user_a).json()
        history_b = self.client.get("/api/history/tasks", headers=user_b).json()
        audit_a = self.client.get("/api/audit/events", headers=user_a).json()["items"]
        audit_b = self.client.get("/api/audit/events", headers=user_b).json()["items"]

        self.assertTrue(any(item["id"] == saved_a["id"] for item in history_a))
        self.assertFalse(any(item["id"] == saved_b["id"] for item in history_a))
        self.assertTrue(any(item["id"] == saved_b["id"] for item in history_b))
        self.assertFalse(any(item["id"] == saved_a["id"] for item in history_b))
        self.assertTrue(all(item["ownerId"] == "user-a" for item in audit_a))
        self.assertTrue(all(item["ownerId"] == "user-b" for item in audit_b))

    def test_workspace_scope_can_fallback_to_query_parameters(self) -> None:
        self.client.patch("/api/active-task?workspaceTenantId=tenant-q&workspaceUserId=user-q", json={"summary": "query scope"})

        response = self.client.get("/api/active-task?workspaceTenantId=tenant-q&workspaceUserId=user-q")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"], "query scope")
        self.assertEqual(response.headers["x-workspace-tenant-id"], "tenant-q")
        self.assertEqual(response.headers["x-workspace-user-id"], "user-q")

    def test_audit_events_can_be_disabled(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            enable_audit_events=False,
        )
        client = TestClient(app)

        response = client.get("/api/audit/events")

        self.assertEqual(response.status_code, 404)

    def test_admin_api_key_protects_sensitive_endpoints(self) -> None:
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            admin_api_key="secret-admin",
            repository_path=str(self.db_path),
        )
        client = TestClient(app)

        audit_denied = client.get("/api/audit/events")
        template_denied = client.post("/api/templates/save-active-task", json={"name": "模板A"})

        self.assertEqual(audit_denied.status_code, 403)
        self.assertEqual(template_denied.status_code, 403)
        self.assertIn("admin", audit_denied.json()["error"]["message"])

        audit_allowed = client.get("/api/audit/events", headers={"x-admin-api-key": "secret-admin"})
        template_allowed = client.post(
            "/api/templates/save-active-task",
            json={"name": "模板A"},
            headers={"x-admin-api-key": "secret-admin"},
        )

        self.assertEqual(audit_allowed.status_code, 200)
        self.assertEqual(template_allowed.status_code, 200)

    def test_parse_intent_rejects_empty_request(self) -> None:
        response = self.client.post("/api/intent/parse", json={"request": "   "})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["message"], "request is required")

    def test_list_templates_returns_seed_templates(self) -> None:
        response = self.client.get("/api/templates")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload), 2)
        self.assertEqual(payload[0]["source"], "system")

    def test_frontend_support_endpoints_return_workspace_data(self) -> None:
        datasets = self.client.get("/api/datasets")
        reports = self.client.get("/api/reports")
        notifications = self.client.get("/api/notifications")
        search = self.client.get("/api/search", params={"query": "销售"})

        self.assertEqual(datasets.status_code, 200)
        self.assertEqual(reports.status_code, 200)
        self.assertEqual(notifications.status_code, 200)
        self.assertEqual(search.status_code, 200)
        self.assertEqual(datasets.json(), [])
        self.assertGreaterEqual(len(reports.json()), 1)
        self.assertGreaterEqual(len(notifications.json()), 1)
        self.assertIsInstance(search.json(), list)

    def test_datasets_include_file_preview_for_frontend_opening(self) -> None:
        self.client.patch(
            "/api/active-task",
            json={
                "dataSource": {
                    "kind": "table",
                    "formatLabel": "Excel",
                    "fileName": "产品数据.xlsx",
                    "columnCount": 2,
                    "rowCount": 1,
                    "columns": [{"name": "型号", "type": "text"}, {"name": "容量", "type": "number"}],
                    "previewRows": [{"型号": "A1", "容量": "100"}],
                    "originalFileBase64": "b3JpZ2luYWw=",
                    "originalMimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "originalFileSize": 8,
                    "fieldMappings": [{"source": "型号", "target": "型号"}],
                }
            },
        )

        response = self.client.get("/api/datasets")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload[0]["name"], "产品数据.xlsx")
        self.assertEqual(payload[0]["formatLabel"], "Excel")
        self.assertEqual(payload[0]["columns"][0]["name"], "型号")
        self.assertEqual(payload[0]["previewRows"][0]["容量"], "100")
        self.assertNotIn("originalFileBase64", payload[0])
        self.assertEqual(payload[0]["originalFileSize"], 8)

    def test_dataset_derived_from_saved_task_can_bind_to_active_task(self) -> None:
        self.client.patch(
            "/api/active-task",
            json={
                "name": "产品参数分析",
                "dataSource": {
                    "kind": "table",
                    "formatLabel": "Excel",
                    "fileName": "产品数据.xlsx",
                    "columnCount": 2,
                    "rowCount": 1,
                    "columns": [{"name": "型号", "type": "text"}, {"name": "容量", "type": "number"}],
                    "previewRows": [{"型号": "A1", "容量": "100"}],
                    "analysisRows": [{"型号": "A1", "容量": "100"}],
                    "fieldMappings": [],
                },
            },
        )
        saved = self.client.post("/api/history/save-active-task").json()
        self.client.post("/api/active-task/reset")

        response = self.client.post(f"/api/tasks/active/dataset/{saved['id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["dataSource"]["fileName"], "产品数据.xlsx")
        self.assertEqual(payload["status"], "等待需求解析")

    def test_data_source_ingest_parses_excel_into_table_metadata(self) -> None:
        xlsx_bytes = build_xlsx_bytes()
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "sales.xlsx",
                "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "contentBase64": base64.b64encode(xlsx_bytes).decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["kind"], "table")
        self.assertEqual(payload["formatLabel"], "Excel")
        self.assertEqual(payload["columnCount"], 3)
        self.assertEqual(payload["rowCount"], 1)
        self.assertEqual(payload["columns"][0]["name"], "month")
        self.assertEqual(payload["previewRows"][0]["region"], "华东")
        self.assertNotIn("originalFileBase64", payload)
        self.assertEqual(payload["originalFileSize"], len(xlsx_bytes))
        datasets = self.client.get("/api/datasets").json()
        self.assertEqual(datasets[0]["name"], "sales.xlsx")
        self.assertEqual(datasets[0]["usedBy"], "已上传文件")

    @patch("xlrd.open_workbook")
    def test_data_source_ingest_parses_legacy_excel_into_table_metadata(self, open_workbook: object) -> None:
        sheet = open_workbook.return_value.sheet_by_index.return_value  # type: ignore[attr-defined]
        sheet.nrows = 2
        sheet.ncols = 2
        sheet.row_values.side_effect = [["month", "sales"], ["2025-04", 4100.0]]

        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "sales.xls",
                "mimeType": "application/vnd.ms-excel",
                "contentBase64": base64.b64encode(b"legacy excel bytes").decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["formatLabel"], "Excel")
        self.assertEqual(payload["rowCount"], 1)
        self.assertEqual(payload["previewRows"][0], {"month": "2025-04", "sales": "4100"})

    def test_data_source_ingest_uses_the_workbook_sheet_relationship(self) -> None:
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "sales.xlsx",
                "contentBase64": base64.b64encode(build_xlsx_bytes("rId7")).decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["previewRows"][0]["sales"], "4100")

    def test_data_source_ingest_rejects_corrupt_office_files(self) -> None:
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "broken.xlsx",
                "contentBase64": base64.b64encode(b"not a zip").decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["message"], "unable to parse uploaded file")

    def test_data_source_ingest_rejects_archives_over_the_extraction_limit(self) -> None:
        archive_bytes = io.BytesIO()
        with ZipFile(archive_bytes, "w") as archive:
            for index in range(101):
                archive.writestr(f"entry-{index}.txt", "x")

        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "oversized.docx",
                "contentBase64": base64.b64encode(archive_bytes.getvalue()).decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["message"], "archive exceeds safe extraction limit")

    def test_data_source_ingest_extracts_compressed_pdf_text(self) -> None:
        pdf = (
            b"%PDF-1.4\n1 0 obj\n<< /Length 24 /Filter /FlateDecode >>\nstream\n"
            + zlib.compress(b"BT (compressed finding) Tj ET")
            + b"\nendstream\nendobj\n%%EOF"
        )
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "brief.pdf",
                "contentBase64": base64.b64encode(pdf).decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("compressed finding", response.json()["textPreview"])

    @patch("backend_py.data_source_ingest._parse_scanned_pdf_text", return_value="扫描件结论")
    def test_data_source_ingest_uses_ocr_for_pdf_without_embedded_text(self, parse_scanned_pdf_text: object) -> None:
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "scanned.pdf",
                "contentBase64": base64.b64encode(b"%PDF-1.4\n%%EOF").decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["textPreview"], "扫描件结论")
        parse_scanned_pdf_text.assert_called_once()  # type: ignore[attr-defined]

    @patch("backend_py.data_source_ingest._parse_scanned_pdf_text", return_value="扫描件结论")
    def test_data_source_ingest_uses_ocr_when_pdf_literals_are_binary_garbage(self, parse_scanned_pdf_text: object) -> None:
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "scanned.pdf",
                "contentBase64": base64.b64encode(b"%PDF-1.4\nstream\n(\x01\x02\x03\x04binary)\nendstream\n%%EOF").decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["textPreview"], "扫描件结论")
        parse_scanned_pdf_text.assert_called_once()  # type: ignore[attr-defined]

    def test_parse_intent_includes_uploaded_file_context(self) -> None:
        chat_client = FakeChatClient()
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            chat_client=chat_client,
            repository_path=str(self.db_path),
        )
        client = TestClient(app)

        response = client.post(
            "/api/intent/parse",
            json={
                "request": "summarize the file",
                "dataSource": {"fileName": "brief.txt", "textPreview": "uploaded source fact"},
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("uploaded source fact", chat_client.prompts[-1])

    def test_parse_intent_returns_multi_agent_plan_and_assets(self) -> None:
        response = self.client.post(
            "/api/intent/parse",
            json={
                "request": "对销售文件做异常归因，输出管理层简报",
                "dataSource": {
                    "fileName": "sales.csv",
                    "columns": [{"name": "region", "type": "text"}, {"name": "sales", "type": "number"}],
                    "previewRows": [{"region": "华东", "sales": "120"}],
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["agents"]), 8)
        self.assertEqual(payload["agents"][0]["id"], "orchestrator")
        self.assertIn("sales", payload["metrics"])
        self.assertIn("region", payload["dimensions"])
        self.assertIn("分析模板", payload["assets"])
        self.assertEqual(payload["roleViews"]["manager"], "管理层决策简报")

    def test_data_source_ingest_parses_documents_into_text_preview(self) -> None:
        response = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "brief.docx",
                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "contentBase64": base64.b64encode(build_docx_bytes()).decode("ascii"),
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["kind"], "document")
        self.assertEqual(payload["formatLabel"], "Word")
        self.assertEqual(payload["columnCount"], 0)
        self.assertIn("第一段结论", payload["textPreview"])

    def test_multipart_upload_persists_downloadable_dataset_without_base64(self) -> None:
        response = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        )

        self.assertEqual(response.status_code, 200)
        dataset = response.json()
        self.assertEqual(dataset["analysisScope"]["rowsProcessed"], 2)
        self.assertNotIn("originalFileBase64", dataset)
        downloaded = self.client.get(f"/api/datasets/{dataset['id']}/download")
        self.assertEqual(downloaded.status_code, 200)
        self.assertIn(b"East,120", downloaded.content)

    def test_dataset_delete_removes_uploaded_file(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        ).json()

        response = self.client.delete(f"/api/datasets/{uploaded['id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], True)
        datasets = self.client.get("/api/datasets").json()
        self.assertFalse(any(item["id"] == uploaded["id"] for item in datasets))

    def test_dataset_delete_rejects_active_task_dataset(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        ).json()
        self.client.post(f"/api/tasks/active/dataset/{uploaded['id']}")

        response = self.client.delete(f"/api/datasets/{uploaded['id']}")

        self.assertEqual(response.status_code, 409)

        uploaded = self.client.post(
            "/api/data-source/upload",
            files={"file": ("sales.csv", b"region,sales\nEast,120\nWest,80\n", "text/csv")},
        ).json()
        self.client.post(f"/api/tasks/active/dataset/{uploaded['id']}")
        self.client.post("/api/workflow/action", json={"action": "start"})
        for _ in range(7):
            self.client.post("/api/workflow/advance")
        exported = self.client.post("/api/tasks/active/exports", json={"format": "Markdown"})
        self.assertEqual(exported.status_code, 200)
        download = self.client.get(exported.json()["downloadUrl"])
        self.assertEqual(download.status_code, 200)
        self.assertIn(b"#", download.content)

        response = self.client.post("/api/workflow/action", json={"action": "start"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn(payload["snapshot"]["phase"], {"completed", "needs_review", "running"})
        self.assertTrue(any(node["status"] in {"running", "success"} for node in payload["snapshot"]["nodes"]))

    def test_workflow_advance_uses_model_output(self) -> None:
        chat_client = FakeChatClient()
        app = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            chat_client=chat_client,
            repository_path=str(self.db_path),
        )
        client = TestClient(app)

        client.patch(
            "/api/active-task",
            json={
                "status": "running",
                "summary": "draft",
                "request": "analyze sales anomalies",
                "snapshot": {
                    "phase": "running",
                    "logMessage": "analysis pending",
                    "nodes": [
                        {"id": "source", "label": "Source Agent", "status": "success"},
                        {"id": "clean", "label": "Clean Agent", "status": "success"},
                        {"id": "metric", "label": "Metric Agent", "status": "success"},
                        {"id": "chart", "label": "Chart Agent", "status": "success"},
                        {"id": "analysis", "label": "Analysis Agent", "status": "running"},
                        {"id": "report", "label": "Report Agent", "status": "pending"},
                        {"id": "audit", "label": "Audit Agent", "status": "pending"},
                    ],
                    "context": {
                        "activeAgent": "Analysis Agent",
                        "inputSummary": "analysis input",
                        "outputSummary": "analysis output",
                        "latestLog": "analysis pending",
                        "risks": [],
                    },
                },
                "risks": [],
                "dataSource": {
                    "kind": "document",
                    "formatLabel": "Text",
                    "fileName": "evidence.txt",
                    "columnCount": 0,
                    "rowCount": 1,
                    "columns": [],
                    "previewRows": [],
                    "textPreview": "uploaded evidence: sales dropped 12 percent",
                    "fieldMappings": [],
                },
            },
        )

        response = client.post("/api/workflow/advance")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["summary"], "model generated summary")
        self.assertIn("uploaded evidence: sales dropped 12 percent", chat_client.prompts[-1])

    def test_document_workflow_generates_keywords_and_evidence(self) -> None:
        uploaded = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "brief.txt",
                "mimeType": "text/plain",
                "contentBase64": base64.b64encode("第一段结论\n第二段行动项\n行动项继续推进结论落实".encode("utf-8")).decode("ascii"),
            },
        ).json()
        self.client.post(f"/api/tasks/active/dataset/{uploaded['id']}")
        self.client.patch("/api/active-task", json={"request": "总结这份文档里的结论和行动项", "name": "文档分析"})
        self.client.post("/api/workflow/action", json={"action": "start"})
        for _ in range(7):
            self.client.post("/api/workflow/advance")
        task = self.client.get("/api/tasks/active").json()
        metric = next(item for item in task["artifacts"] if item["type"] == "metric_result")
        analysis = next(item for item in task["artifacts"] if item["type"] == "analysis")
        report = next(item for item in task["artifacts"] if item["type"] == "report_markdown")
        self.assertEqual(metric["content"]["analysisMode"], "document")
        self.assertGreater(len(metric["content"]["groups"]), 0)
        self.assertIn("关键证据", report["content"]["markdown"])
        self.assertTrue(any(item.get("text") for item in analysis["content"]["evidence"]["evidence"]))
        self.assertTrue("结论" in analysis["content"]["summary"] or "行动项" in analysis["content"]["summary"])

        self.client.patch("/api/active-task", json={"summary": "persist me"})
        self.client.post("/api/history/save-active-task")

        restarted = create_app(
            api_key="test-key",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
        )
        restarted_client = TestClient(restarted)

        response = restarted_client.get("/api/history/tasks")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload[0]["summary"], "persist me")

    def test_history_detail_includes_persisted_execution_log(self) -> None:
        self.client.post("/api/workflow/action", json={"action": "start"})
        saved = self.client.post("/api/history/save-active-task").json()

        response = self.client.get(f"/api/history/tasks/{saved['id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("executionLog", payload)
        self.assertGreaterEqual(len(payload["executionLog"]), 1)
        self.assertIn(payload["executionLog"][-1]["kind"], {"action", "advance"})

    def test_report_delete_removes_saved_history_task(self) -> None:
        self.client.patch("/api/active-task", json={"summary": "delete me"})
        saved = self.client.post("/api/history/save-active-task").json()

        response = self.client.delete(f"/api/history/tasks/{saved['id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], True)
        remaining = self.client.get("/api/history/tasks").json()
        self.assertFalse(any(task["id"] == saved["id"] for task in remaining))


if __name__ == "__main__":
    unittest.main()
