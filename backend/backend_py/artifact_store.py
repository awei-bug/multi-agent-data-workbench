from __future__ import annotations

import hashlib
import re
from pathlib import Path
from uuid import uuid4


class ArtifactStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, category: str, file_name: str, content: bytes) -> dict:
        safe_category = re.sub(r"[^a-z0-9_-]+", "-", category.lower()).strip("-") or "artifacts"
        safe_name = Path(file_name).name or "artifact"
        artifact_id = str(uuid4())
        path = self.root / safe_category / f"{artifact_id}-{safe_name}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "id": artifact_id,
            "storageKey": str(path.relative_to(self.root)).replace("\\", "/"),
            "fileName": safe_name,
            "byteSize": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
        }

    def resolve(self, storage_key: str) -> Path:
        path = (self.root / storage_key).resolve()
        if self.root.resolve() not in path.parents and path != self.root.resolve():
            raise ValueError("invalid artifact path")
        return path

    def read(self, storage_key: str) -> bytes:
        return self.resolve(storage_key).read_bytes()

    def delete(self, storage_key: str) -> None:
        self.resolve(storage_key).unlink(missing_ok=True)
