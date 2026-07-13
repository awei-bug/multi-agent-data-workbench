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


class DocumentAnalysisPathTest(unittest.TestCase):
    def setUp(self) -> None:
        logging.getLogger("workspace_api").disabled = True
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "workspace.sqlite3"
        self.app = create_app(
            api_key="",
            base_url="https://apihub.agnes-ai.com/v1",
            model="Agnes 2.0 Flash",
            repository_path=str(self.db_path),
            artifact_dir=str(Path(self.temp_dir.name) / "artifacts"),
            seed_demo_data=False,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.temp_dir.cleanup()
        logging.getLogger("workspace_api").disabled = False

    def test_document_intent_and_workflow_generate_document_analysis_artifacts(self) -> None:
        upload = self.client.post(
            "/api/data-source/ingest",
            json={
                "fileName": "brief.docx",
                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "contentBase64": base64.b64encode(build_docx_bytes()).decode("ascii"),
            },
        )
        self.assertEqual(upload.status_code, 200)
        dataset = upload.json()
        self.assertEqual(dataset["kind"], "document")
        self.assertIn("keywords", dataset["profile"])

        attach = self.client.post(f"/api/tasks/active/dataset/{dataset['id']}")
        self.assertEqual(attach.status_code, 200)

        intent = self.client.post(
            "/api/intent/parse",
            json={"request": "请分析这份文档的核心结论和行动建议", "dataSource": attach.json()["dataSource"]},
        )
        self.assertEqual(intent.status_code, 200)
        self.assertEqual(intent.json()["analysisMode"], "document")

        self.client.patch(
            "/api/active-task",
            json={
                "name": intent.json()["goal"],
                "request": intent.json()["request"],
                "intent": intent.json(),
                "summary": intent.json()["goal"],
            },
        )

        started = self.client.post("/api/workflow/action", json={"action": "start"})
        self.assertEqual(started.status_code, 200)
        payload = started.json()
        artifact_types = [item["type"] for item in payload.get("artifacts", [])]
        self.assertIn("metric_result", artifact_types)
        self.assertIn("analysis", artifact_types)
        self.assertIn("report_markdown", artifact_types)
        analysis = next(item for item in payload["artifacts"] if item["type"] == "analysis")
        self.assertEqual(analysis["content"]["analysisMode"], "document")
        self.assertIn("高频主题", next(item for item in payload["artifacts"] if item["type"] == "report_markdown")["content"]["markdown"])


if __name__ == "__main__":
    unittest.main()
