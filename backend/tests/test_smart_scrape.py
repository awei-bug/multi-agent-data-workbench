from __future__ import annotations

import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.smart_scrape import (
    _heuristic_extract_by_instruction,
    materialize_scrape_file,
    smart_scrape_to_dataset,
)


class _HtmlHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        html = """
        <html>
          <body>
            <h1>2025 Regional Sales</h1>
            <p>This report summarizes regional performance.</p>
            <table>
              <tr><th>region</th><th>sales</th></tr>
              <tr><td>East</td><td>120</td></tr>
              <tr><td>West</td><td>80</td></tr>
              <tr><td>North</td><td>95</td></tr>
            </table>
            <p>East leads the ranking this quarter.</p>
          </body>
        </html>
        """.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    def log_message(self, format, *args):  # noqa: A003
        return


class SmartScrapeUnitTest(unittest.TestCase):
    def test_heuristic_prefers_table_for_tabular_instruction(self) -> None:
        html = """
        <html><body>
          <table>
            <tr><th>region</th><th>sales</th></tr>
            <tr><td>East</td><td>120</td></tr>
          </table>
          <p>East is leading sales growth.</p>
        </body></html>
        """
        payload = _heuristic_extract_by_instruction(html, "提取销售数据表", source_url="http://local/test")
        self.assertEqual(payload["kind"], "table")
        self.assertGreaterEqual(len(payload["rows"]), 1)

    def test_materialize_csv_and_markdown(self) -> None:
        table_file = materialize_scrape_file(
            payload={"kind": "table", "rows": [{"region": "East", "sales": "120"}], "meta": {}},
            instruction="提取销售表",
            source_url="https://example.com/a",
            preferred_format="csv",
        )
        self.assertEqual(table_file["format"], "csv")
        self.assertIn("region,sales", table_file["contentText"])

        doc_file = materialize_scrape_file(
            payload={"kind": "document", "text": "East leads growth", "paragraphs": ["East leads growth"], "meta": {"strategy": "x"}},
            instruction="总结观点",
            source_url="https://example.com/b",
            preferred_format="md",
        )
        self.assertEqual(doc_file["format"], "md")
        self.assertIn("智能网页采集结果", doc_file["contentText"])

    def test_end_to_end_local_html(self) -> None:
        server = HTTPServer(("127.0.0.1", 0), _HtmlHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            result = smart_scrape_to_dataset(
                url=f"http://{host}:{port}/report",
                instruction="提取区域销售表格",
                allow_private_hosts=True,
                preferred_format="csv",
            )
            self.assertEqual(result["extraction"]["kind"], "table")
            self.assertEqual(result["file"]["format"], "csv")
            self.assertEqual(result["dataset"]["sourceType"], "smart_scrape")
            self.assertGreaterEqual(result["dataset"]["rowCount"], 1)
        finally:
            server.shutdown()


class SmartScrapeApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.server = HTTPServer(("127.0.0.1", 0), _HtmlHandler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host, self.port = self.server.server_address
        self.app = create_app(
            api_key="",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            seed_demo_data=False,
            credentials_secret="unit-credentials-secret",
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.server.shutdown()
        self.temp_dir.cleanup()

    def test_smart_scrape_api_imports_dataset(self) -> None:
        response = self.client.post(
            "/api/smart-scrape",
            json={
                "url": f"http://{self.host}:{self.port}/report",
                "instruction": "提取区域销售表格数据",
                "outputFormat": "csv",
                "allowPrivateHosts": True,
                "datasetName": "智能采集销售表",
                "commit": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("dataset", payload)
        self.assertEqual(payload["dataset"]["sourceType"], "smart_scrape")
        self.assertTrue(payload["file"]["fileName"].endswith(".csv") or payload["file"]["format"] == "csv")
        datasets = self.client.get("/api/datasets").json()
        self.assertTrue(any(item["id"] == payload["dataset"]["id"] for item in datasets))

    def test_smart_scrape_preview_then_commit(self) -> None:
        preview = self.client.post(
            "/api/smart-scrape",
            json={
                "url": f"http://{self.host}:{self.port}/report",
                "instruction": "提取区域销售表格数据",
                "outputFormat": "csv",
                "allowPrivateHosts": True,
                "commit": False,
            },
        )
        self.assertEqual(preview.status_code, 200, preview.text)
        body = preview.json()
        self.assertFalse(body.get("committed", True))
        self.assertIn("contentBase64", body["file"])
        self.assertTrue(body["extraction"]["preview"])

        # Preview should not create dataset yet.
        before = self.client.get("/api/datasets").json()
        before_count = len(before)

        commit = self.client.post(
            "/api/smart-scrape/commit",
            json={
                "url": f"http://{self.host}:{self.port}/report",
                "instruction": "提取区域销售表格数据",
                "datasetName": "预览确认导入表",
                "fileName": body["file"]["fileName"],
                "mimeType": body["file"]["mimeType"],
                "format": body["file"]["format"],
                "contentBase64": body["file"]["contentBase64"],
                "kind": body["extraction"]["kind"],
                "extractionMeta": body["extraction"].get("meta") or {},
                "rows": body["extraction"].get("rows") or [],
                "selectedFields": ["region", "sales"],
                "selectedRowIndexes": [0, 1],
                "startAnalysis": False,
            },
        )
        self.assertEqual(commit.status_code, 200, commit.text)
        committed = commit.json()
        self.assertTrue(committed.get("committed"))
        self.assertEqual(committed["dataset"]["name"], "预览确认导入表")
        # Field projection should keep only selected columns.
        columns = [item.get("name") for item in committed["dataset"].get("columns") or []]
        self.assertEqual(columns, ["region", "sales"])
        self.assertEqual(committed["dataset"]["rowCount"], 2)

        after = self.client.get("/api/datasets").json()
        self.assertEqual(len(after), before_count + 1)


if __name__ == "__main__":
    unittest.main()
