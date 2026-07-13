from __future__ import annotations

import mimetypes
import re
from pathlib import Path


ALLOWED_UPLOAD_EXTENSIONS = {
    ".csv",
    ".tsv",
    ".txt",
    ".json",
    ".xlsx",
    ".xls",
    ".xlsm",
    ".pdf",
    ".docx",
    ".md",
    ".markdown",
}

ALLOWED_UPLOAD_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument",
    "application/octet-stream",
)

DANGEROUS_EXTENSIONS = {
    ".exe",
    ".bat",
    ".cmd",
    ".ps1",
    ".sh",
    ".js",
    ".mjs",
    ".php",
    ".jsp",
    ".asp",
    ".aspx",
    ".html",
    ".htm",
    ".svg",
    ".wasm",
}


class UploadSecurityError(ValueError):
    def __init__(self, message: str, code: str = "upload_rejected") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def sanitize_filename(file_name: str) -> str:
    base = Path(file_name or "upload.bin").name
    cleaned = re.sub(r"[^\w.\-()+ ]+", "_", base).strip(" ._")
    return cleaned or "upload.bin"


def validate_upload(
    *,
    file_name: str,
    content_type: str | None,
    size_bytes: int,
    max_bytes: int,
    content: bytes | None = None,
) -> dict:
    if size_bytes <= 0:
        raise UploadSecurityError("empty upload is not allowed", "empty_upload")
    if size_bytes > max_bytes:
        raise UploadSecurityError(
            f"upload exceeds max size ({max_bytes} bytes)",
            "upload_too_large",
        )

    safe_name = sanitize_filename(file_name)
    suffix = Path(safe_name).suffix.lower()
    if suffix in DANGEROUS_EXTENSIONS:
        raise UploadSecurityError(f"file type not allowed: {suffix or '(none)'}", "extension_blocked")
    if suffix and suffix not in ALLOWED_UPLOAD_EXTENSIONS:
        raise UploadSecurityError(f"unsupported file extension: {suffix}", "extension_unsupported")

    mime = (content_type or "").split(";")[0].strip().lower()
    guessed, _ = mimetypes.guess_type(safe_name)
    if mime and not any(mime.startswith(prefix) for prefix in ALLOWED_UPLOAD_MIME_PREFIXES):
        # Allow mismatch only when extension is trusted and browser sends generic binary.
        if mime not in {"application/octet-stream", "binary/octet-stream"}:
            raise UploadSecurityError(f"unsupported content type: {mime}", "mime_unsupported")

    # Lightweight content sniffing for HTML/script disguised uploads.
    sample = (content or b"")[:2048].lstrip().lower()
    if sample.startswith(b"<!doctype html") or sample.startswith(b"<html") or b"<script" in sample:
        raise UploadSecurityError("html/script content is not allowed in uploads", "content_blocked")

    return {
        "fileName": safe_name,
        "extension": suffix,
        "contentType": mime or (guessed or "application/octet-stream"),
        "sizeBytes": size_bytes,
    }
