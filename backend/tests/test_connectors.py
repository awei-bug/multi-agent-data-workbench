from __future__ import annotations

import json
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from fastapi.testclient import TestClient

from backend_py.app import create_app
from backend_py.connectors import (
    build_connector_data_source,
    build_table_data_source,
    decrypt_credentials,
    encrypt_credentials,
    fetch_connector_payload,
    fetch_rows,
    list_connector_types,
)


class _JsonHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        payload = {
            "data": {
                "items": [
                    {"region": "East", "sales": 120},
                    {"region": "West", "sales": 80},
                ]
            }
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A003
        return


class _HtmlHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        html = """
        <html>
          <body>
            <h1>Sales Report</h1>
            <table>
              <tr><th>region</th><th>sales</th></tr>
              <tr><td>East</td><td>120</td></tr>
              <tr><td>West</td><td>80</td></tr>
            </table>
            <p>Quarter summary for management review.</p>
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


class ConnectorUnitTest(unittest.TestCase):
    def test_credentials_roundtrip(self) -> None:
        token = encrypt_credentials({"bearerToken": "secret-token"}, "unit-secret")
        payload = decrypt_credentials(token, "unit-secret")
        self.assertEqual(payload["bearerToken"], "secret-token")

    def test_http_json_fetch_and_build_dataset(self) -> None:
        server = HTTPServer(("127.0.0.1", 0), _JsonHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            rows = fetch_rows(
                "http_json",
                {
                    "url": f"http://{host}:{port}/sales",
                    "jsonPath": "data.items",
                    "allowPrivateHosts": True,
                },
                {},
            )
            self.assertEqual(len(rows), 2)
            dataset = build_table_data_source(
                name="http-sales",
                connector_type="http_json",
                rows=rows,
                connection_id="conn-1",
            )
            self.assertEqual(dataset["sourceType"], "connector")
            self.assertEqual(dataset["rowCount"], 2)
            self.assertEqual(dataset["connectionId"], "conn-1")
        finally:
            server.shutdown()

    def test_web_page_table_extract(self) -> None:
        server = HTTPServer(("127.0.0.1", 0), _HtmlHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            payload = fetch_connector_payload(
                "web_page",
                {
                    "url": f"http://{host}:{port}/report",
                    "extractMode": "auto",
                    "allowPrivateHosts": True,
                },
                {},
            )
            self.assertEqual(payload["kind"], "table")
            self.assertEqual(len(payload["rows"]), 2)
            dataset = build_connector_data_source(
                name="web-sales",
                connector_type="web_page",
                payload=payload,
                connection_id="conn-web-1",
            )
            self.assertEqual(dataset["kind"], "table")
            self.assertEqual(dataset["rowCount"], 2)
            self.assertEqual(dataset["columns"][0]["name"], "region")
        finally:
            server.shutdown()


class ConnectorApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.server = HTTPServer(("127.0.0.1", 0), _JsonHandler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host, self.port = self.server.server_address
        self.html_server = HTTPServer(("127.0.0.1", 0), _HtmlHandler)
        self.html_thread = Thread(target=self.html_server.serve_forever, daemon=True)
        self.html_thread.start()
        self.html_host, self.html_port = self.html_server.server_address
        self.app = create_app(
            api_key="test-key",
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
        self.html_server.shutdown()
        self.temp_dir.cleanup()

    def test_connection_lifecycle_import(self) -> None:
        types = self.client.get("/api/connectors/types")
        self.assertEqual(types.status_code, 200)
        type_names = {item["type"] for item in types.json()["items"]}
        self.assertIn("http_json", type_names)
        self.assertIn("web_page", type_names)
        self.assertGreaterEqual(len(list_connector_types()), 3)

        created = self.client.post(
            "/api/connections",
            json={
                "name": "销售接口",
                "connectorType": "http_json",
                "config": {
                    "url": f"http://{self.host}:{self.port}/sales",
                    "jsonPath": "data.items",
                    "allowPrivateHosts": True,
                },
                "credentials": {"bearerToken": "token-1"},
            },
        )
        self.assertEqual(created.status_code, 200)
        connection = created.json()
        self.assertTrue(connection["hasCredentials"])
        self.assertNotIn("credentialsEncrypted", connection)

        tested = self.client.post(f"/api/connections/{connection['id']}/test", json={})
        self.assertEqual(tested.status_code, 200)
        self.assertTrue(tested.json()["ok"])
        self.assertEqual(tested.json()["rowCount"], 2)

        imported = self.client.post(
            f"/api/connections/{connection['id']}/import",
            json={"datasetName": "接口导入销售"},
        )
        self.assertEqual(imported.status_code, 200)
        dataset = imported.json()
        self.assertEqual(dataset["sourceType"], "connector")
        self.assertEqual(dataset["rowCount"], 2)

        datasets = self.client.get("/api/datasets").json()
        self.assertTrue(any(item["id"] == dataset["id"] for item in datasets))

        listed = self.client.get("/api/connections").json()["items"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["lastTestStatus"], "ok")

    def test_web_page_connection_import(self) -> None:
        created = self.client.post(
            "/api/connections",
            json={
                "name": "网页销售表",
                "connectorType": "web_page",
                "config": {
                    "url": f"http://{self.html_host}:{self.html_port}/report",
                    "extractMode": "auto",
                    "tableIndex": 1,
                    "allowPrivateHosts": True,
                },
                "credentials": {},
            },
        )
        self.assertEqual(created.status_code, 200)
        connection = created.json()

        tested = self.client.post(f"/api/connections/{connection['id']}/test", json={})
        self.assertEqual(tested.status_code, 200)
        self.assertTrue(tested.json()["ok"])
        self.assertEqual(tested.json()["kind"], "table")
        self.assertEqual(tested.json()["rowCount"], 2)

        imported = self.client.post(
            f"/api/connections/{connection['id']}/import",
            json={"datasetName": "网页导入销售"},
        )
        self.assertEqual(imported.status_code, 200)
        dataset = imported.json()
        self.assertEqual(dataset["sourceType"], "connector")
        self.assertEqual(dataset["connectorType"], "web_page")
        self.assertEqual(dataset["kind"], "table")
        self.assertEqual(dataset["rowCount"], 2)


if __name__ == "__main__":
    unittest.main()
