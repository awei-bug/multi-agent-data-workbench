from __future__ import annotations

import base64
import binascii
import csv
import io
import json
import os
import re
import subprocess
import tempfile
import zlib
from pathlib import Path
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

import pypdfium2
import xlrd


_SPREADSHEET_NS = {
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
_WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_PACKAGE_REL_NS = {"p": "http://schemas.openxmlformats.org/package/2006/relationships"}
_PDF_TEXT_PATTERN = re.compile(rb"\((.*?)\)")
_PDF_STREAM_PATTERN = re.compile(rb"<<(.*?)>>\s*stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
_MAX_ARCHIVE_ENTRIES = 100
_MAX_ARCHIVE_OUTPUT_BYTES = 10_000_000
_MAX_TABLE_ROWS = 100_000
_MAX_TABLE_COLUMNS = 250
_MAX_PREVIEW_ROWS = 100
_MAX_OCR_PAGES = 5
_OCR_TIMEOUT_SECONDS = 30


def ingest_data_source(file_name: str, mime_type: str | None, content_base64: str) -> dict:
    suffix = Path(file_name).suffix.lower()
    try:
        content = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("invalid file payload") from error

    try:
        if suffix == ".csv":
            return _build_table_payload(file_name, "CSV", _parse_csv_rows(content))
        if suffix in {".xlsx", ".xlsm"}:
            return _build_table_payload(file_name, "Excel", _parse_xlsx_rows(content))
        if suffix == ".xls":
            return _build_table_payload(file_name, "Excel", _parse_xls_rows(content))
        if suffix == ".json":
            return _build_table_payload(file_name, "JSON", _parse_json_rows(content))
        if suffix in {".txt", ".md"}:
            return _build_document_payload(file_name, "Markdown" if suffix == ".md" else "Text", _decode_text(content))
        if suffix == ".docx":
            return _build_document_payload(file_name, "Word", _parse_docx_text(content))
        if suffix == ".pdf":
            return _build_document_payload(file_name, "PDF", _parse_pdf_text(content))
    except ValueError:
        raise
    except (BadZipFile, ElementTree.ParseError, IndexError, KeyError, OSError, UnicodeDecodeError, json.JSONDecodeError, xlrd.biffh.XLRDError, zlib.error) as error:
        raise ValueError("unable to parse uploaded file") from error

    raise ValueError(f"unsupported file type: {suffix or mime_type or 'unknown'}")


def _build_table_payload(file_name: str, format_label: str, rows: list[dict[str, str]]) -> dict:
    if len(rows) > _MAX_TABLE_ROWS:
        raise ValueError(f"table exceeds {_MAX_TABLE_ROWS} row limit")

    if not rows:
        return {
            "kind": "table",
            "formatLabel": format_label,
            "fileName": file_name,
            "columnCount": 0,
            "rowCount": 0,
            "columns": [],
            "previewRows": [],
            "analysisRows": [],
            "analysisScope": {"mode": "full", "rowCount": 0, "rowsProcessed": 0},
            "profile": {"nullCounts": {}, "duplicateRows": 0},
            "fieldMappings": [],
            "textPreview": "",
        }

    headers = list(rows[0].keys())
    if len(headers) > _MAX_TABLE_COLUMNS:
        raise ValueError(f"table exceeds {_MAX_TABLE_COLUMNS} column limit")

    columns = [{"name": header, "type": _infer_column_type([row.get(header, "").strip() for row in rows])} for header in headers]
    null_counts = {header: sum(1 for row in rows if not row.get(header, "").strip()) for header in headers}
    duplicate_rows = len(rows) - len({tuple(row.get(header, "") for header in headers) for row in rows})
    return {
        "kind": "table",
        "formatLabel": format_label,
        "fileName": file_name,
        "columnCount": len(headers),
        "rowCount": len(rows),
        "columns": columns,
        "previewRows": rows[:_MAX_PREVIEW_ROWS],
        "analysisRows": rows,
        "analysisScope": {"mode": "full", "rowCount": len(rows), "rowsProcessed": len(rows)},
        "profile": {"nullCounts": null_counts, "duplicateRows": duplicate_rows},
        "fieldMappings": [],
        "textPreview": "",
    }


def _build_document_payload(file_name: str, format_label: str, text: str) -> dict:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    normalized = "\n".join(lines)
    preview = normalized[:4000]
    full_text = normalized[:100_000]
    words = re.findall(r"[\w一-鿿]+", full_text)
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", full_text) if part.strip()] or lines
    # Extract simple keyword frequency for document analytics (Chinese + Latin tokens).
    token_counts: dict[str, int] = {}
    for token in words:
        key = token.lower()
        if len(key) < 2:
            continue
        if key.isdigit():
            continue
        token_counts[key] = token_counts.get(key, 0) + 1
    keywords = sorted(token_counts.items(), key=lambda item: item[1], reverse=True)[:20]
    return {
        "kind": "document",
        "formatLabel": format_label,
        "fileName": file_name,
        "columnCount": 0,
        "rowCount": len(lines),
        "columns": [],
        "previewRows": [],
        "analysisRows": [],
        "fieldMappings": [],
        "textPreview": preview,
        "fullText": full_text,
        "analysisScope": {"mode": "full" if len(normalized) <= 100_000 else "sampled", "rowCount": len(lines), "rowsProcessed": len(lines)},
        "profile": {
            "charCount": len(full_text),
            "wordCount": len(words),
            "lineCount": len(lines),
            "paragraphCount": len(paragraphs),
            "keywords": [{"term": term, "count": count} for term, count in keywords],
            "sampleParagraphs": paragraphs[:8],
        },
    }


def _parse_csv_rows(content: bytes) -> list[dict[str, str]]:
    return [{key.strip(): (value or "").strip() for key, value in row.items() if key} for row in csv.DictReader(io.StringIO(_decode_text(content)))]


def _parse_json_rows(content: bytes) -> list[dict[str, str]]:
    payload = json.loads(_decode_text(content))
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
        raise ValueError("json content must be an object or array of objects")
    headers = list(dict.fromkeys(str(key) for item in payload for key in item))
    return [{header: _stringify_json_value(item.get(header, "")) for header in headers} for item in payload]


def _parse_xlsx_rows(content: bytes) -> list[dict[str, str]]:
    with ZipFile(io.BytesIO(content)) as archive:
        _validate_archive(archive)
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        first_sheet = workbook.find(".//s:sheets/s:sheet", _SPREADSHEET_NS)
        relationship_id = first_sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id") if first_sheet is not None else None
        if not relationship_id:
            raise ValueError("worksheet missing in xlsx")
        relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationship = next((item for item in relationships.findall("p:Relationship", _PACKAGE_REL_NS) if item.get("Id") == relationship_id), None)
        if relationship is None or not relationship.get("Target"):
            raise ValueError("worksheet missing in xlsx")
        target = relationship.attrib["Target"].lstrip("/")
        worksheet = ElementTree.fromstring(archive.read(target if target.startswith("xl/") else f"xl/{target}"))
        shared_strings = _read_shared_strings(archive)

    raw_rows = [_read_xlsx_row(row, shared_strings) for row in worksheet.findall(".//s:sheetData/s:row", _SPREADSHEET_NS)]
    return _rows_to_records(raw_rows)


def _parse_xls_rows(content: bytes) -> list[dict[str, str]]:
    sheet = xlrd.open_workbook(file_contents=content, on_demand=True).sheet_by_index(0)
    return _rows_to_records([[_stringify_xls_value(value) for value in sheet.row_values(index)] for index in range(sheet.nrows)])


def _stringify_xls_value(value: object) -> str:
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def _validate_archive(archive: ZipFile) -> None:
    entries = archive.infolist()
    output_bytes = sum(entry.file_size for entry in entries)
    # ponytail: fixed extraction ceiling; add per-tenant quotas only if uploads become multi-tenant.
    if len(entries) > _MAX_ARCHIVE_ENTRIES or output_bytes > _MAX_ARCHIVE_OUTPUT_BYTES:
        raise ValueError("archive exceeds safe extraction limit")


def _read_xlsx_row(row: ElementTree.Element, shared_strings: list[str]) -> list[str]:
    values: list[str] = []
    for cell in row.findall("s:c", _SPREADSHEET_NS):
        reference = cell.get("r", "")
        column_match = re.match(r"([A-Z]+)", reference)
        column_index = _xlsx_column_index(column_match.group(1)) if column_match else len(values)
        while len(values) <= column_index:
            values.append("")
        cell_type = cell.get("t")
        if cell_type == "inlineStr":
            values[column_index] = "".join(cell.find("s:is", _SPREADSHEET_NS).itertext()) if cell.find("s:is", _SPREADSHEET_NS) is not None else ""
            continue
        value = cell.findtext("s:v", default="", namespaces=_SPREADSHEET_NS)
        values[column_index] = shared_strings[int(value)] if cell_type == "s" and value else value
    return values


def _xlsx_column_index(column: str) -> int:
    result = 0
    for letter in column:
        result = result * 26 + ord(letter) - ord("A") + 1
    return result - 1


def _read_shared_strings(archive: ZipFile) -> list[str]:
    try:
        shared = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(item.itertext()) for item in shared.findall(".//s:si", _SPREADSHEET_NS)]


def _parse_docx_text(content: bytes) -> str:
    with ZipFile(io.BytesIO(content)) as archive:
        _validate_archive(archive)
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    return "\n".join("".join(paragraph.itertext()).strip() for paragraph in document.findall(".//w:p", _WORD_NS) if "".join(paragraph.itertext()).strip())


def _parse_pdf_text(content: bytes) -> str:
    streams = [content]
    for dictionary, stream in _PDF_STREAM_PATTERN.findall(content):
        if b"/FlateDecode" in dictionary:
            streams.append(_decompress_pdf_stream(stream))
        else:
            streams.append(stream)
    chunks = [_decode_pdf_literal(match) for stream in streams for match in _PDF_TEXT_PATTERN.findall(stream)]
    text = "\n".join(chunk for chunk in chunks if chunk)
    return text if _is_usable_pdf_text(text) else _parse_scanned_pdf_text(content)


def _is_usable_pdf_text(text: str) -> bool:
    compact = text.strip()
    return len(compact) >= 2 and sum(character.isprintable() for character in compact) / len(compact) >= 0.9


def _parse_scanned_pdf_text(content: bytes) -> str:
    try:
        document = pypdfium2.PdfDocument(content)
        # ponytail: OCR only the first five pages; add a queued job for long scanned documents.
        with tempfile.TemporaryDirectory() as directory:
            texts = []
            for index in range(min(len(document), _MAX_OCR_PAGES)):
                page = document[index]
                image_path = Path(directory) / f"page-{index}.png"
                page.render(scale=2).to_pil().save(image_path)
                result = subprocess.run(
                    [_tesseract_command(), str(image_path), "stdout", "-l", _ocr_languages(), *_tessdata_args()],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=_OCR_TIMEOUT_SECONDS,
                    check=False,
                )
                if result.returncode == 0 and result.stdout.strip():
                    texts.append(result.stdout.strip())
        if texts:
            return "\n".join(texts)
    except (OSError, subprocess.TimeoutExpired, pypdfium2.PdfiumError) as error:
        raise ValueError("pdf text extraction failed") from error
    raise ValueError("pdf text extraction failed")


def _tesseract_command() -> str:
    configured = os.environ.get("TESSERACT_PATH")
    default_path = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
    return configured or str(default_path if default_path.exists() else "tesseract")


def _tessdata_dir() -> Path | None:
    configured = os.environ.get("TESSDATA_DIR")
    default_path = Path(os.environ.get("LOCALAPPDATA", "")) / "Tesseract-OCR" / "tessdata"
    path = Path(configured) if configured else default_path
    return path if path.is_dir() else None


def _ocr_languages() -> str:
    tessdata_dir = _tessdata_dir()
    if tessdata_dir and (tessdata_dir / "chi_sim.traineddata").is_file() and (tessdata_dir / "eng.traineddata").is_file():
        return "chi_sim+eng"
    return "eng"


def _tessdata_args() -> list[str]:
    tessdata_dir = _tessdata_dir()
    return ["--tessdata-dir", str(tessdata_dir)] if tessdata_dir else []


def _decompress_pdf_stream(stream: bytes) -> bytes:
    decompressor = zlib.decompressobj()
    output = decompressor.decompress(stream, _MAX_ARCHIVE_OUTPUT_BYTES + 1)
    if len(output) > _MAX_ARCHIVE_OUTPUT_BYTES:
        raise ValueError("pdf stream exceeds safe extraction limit")
    return output


def _decode_pdf_literal(value: bytes) -> str:
    return value.replace(rb"\(", b"(").replace(rb"\)", b")").replace(rb"\n", b"\n").replace(rb"\r", b"\r").replace(rb"\t", b"\t").decode("utf-8", errors="ignore").strip()


def _rows_to_records(raw_rows: list[list[str]]) -> list[dict[str, str]]:
    if len(raw_rows) < 2:
        return []
    headers = [item.strip() or f"column_{index + 1}" for index, item in enumerate(raw_rows[0])]
    return [{header: values[index].strip() if index < len(values) else "" for index, header in enumerate(headers)} for values in raw_rows[1:]]


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="ignore")


def _infer_column_type(values: list[str]) -> str:
    non_empty = [value for value in values if value]
    if non_empty and all(re.fullmatch(r"-?\d+(\.\d+)?", value) for value in non_empty):
        return "number"
    if non_empty and all(re.fullmatch(r"\d{4}[-/]\d{1,2}([-/]\d{1,2})?", value) for value in non_empty):
        return "date"
    return "string"


def _stringify_json_value(value: object) -> str:
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
