from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Protocol
from uuid import uuid4
from urllib.parse import urlparse


class ArtifactStoreProtocol(Protocol):
    def save(self, category: str, file_name: str, content: bytes, *, tenant_id: str | None = None) -> dict: ...

    def resolve(self, storage_key: str, *, tenant_id: str | None = None) -> Path: ...

    def read(self, storage_key: str, *, tenant_id: str | None = None) -> bytes: ...

    def delete(self, storage_key: str, *, tenant_id: str | None = None) -> None: ...


def _safe_segment(value: str, *, fallback: str = "default") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "").strip()).strip("-_")
    return cleaned or fallback


def build_tenant_storage_key(category: str, file_name: str, *, tenant_id: str | None, artifact_id: str | None = None) -> str:
    safe_category = _safe_segment(category, fallback="artifacts").lower()
    safe_name = Path(file_name).name or "artifact"
    safe_tenant = _safe_segment(tenant_id or "local-tenant", fallback="local-tenant")
    artifact = artifact_id or str(uuid4())
    return f"tenants/{safe_tenant}/{safe_category}/{artifact}-{safe_name}"


def assert_storage_key_tenant(storage_key: str, tenant_id: str | None) -> None:
    """Reject cross-tenant object access when a tenant scope is provided."""
    if not tenant_id:
        return
    clean = (storage_key or "").replace("\\", "/").lstrip("/")
    expected_prefix = f"tenants/{_safe_segment(tenant_id, fallback='local-tenant')}/"
    # Legacy keys without tenant prefix remain readable only within the same process
    # when no prefix is present; once tenant-prefixed, enforce hard isolation.
    if clean.startswith("tenants/") and not clean.startswith(expected_prefix):
        raise PermissionError("artifact does not belong to current tenant")


class LocalArtifactStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.backend = "local"

    def save(self, category: str, file_name: str, content: bytes, *, tenant_id: str | None = None) -> dict:
        artifact_id = str(uuid4())
        storage_key = build_tenant_storage_key(category, file_name, tenant_id=tenant_id, artifact_id=artifact_id)
        path = self.root / storage_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "id": artifact_id,
            "storageKey": storage_key,
            "fileName": Path(file_name).name or "artifact",
            "byteSize": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
            "backend": self.backend,
            "tenantId": _safe_segment(tenant_id or "local-tenant", fallback="local-tenant"),
        }

    def resolve(self, storage_key: str, *, tenant_id: str | None = None) -> Path:
        assert_storage_key_tenant(storage_key, tenant_id)
        path = (self.root / storage_key).resolve()
        if self.root.resolve() not in path.parents and path != self.root.resolve():
            raise ValueError("invalid artifact path")
        return path

    def read(self, storage_key: str, *, tenant_id: str | None = None) -> bytes:
        return self.resolve(storage_key, tenant_id=tenant_id).read_bytes()

    def delete(self, storage_key: str, *, tenant_id: str | None = None) -> None:
        self.resolve(storage_key, tenant_id=tenant_id).unlink(missing_ok=True)


class S3ArtifactStore:
    """S3/MinIO-compatible object storage backend."""

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        region: str = "us-east-1",
        prefix: str = "workspace-artifacts",
        local_cache_dir: str | Path = "workspace-artifacts/.s3-cache",
    ) -> None:
        try:
            import boto3
            from botocore.client import Config
        except ModuleNotFoundError as error:
            raise RuntimeError("boto3 is required for S3 artifact storage") from error

        self.backend = "s3"
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.local_cache_dir = Path(local_cache_dir)
        self.local_cache_dir.mkdir(parents=True, exist_ok=True)
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
            region_name=region,
            config=Config(signature_version="s3v4"),
        )
        self._ensure_bucket()

    def _object_key(self, storage_key: str) -> str:
        clean = storage_key.replace("\\", "/").lstrip("/")
        return f"{self.prefix}/{clean}" if self.prefix else clean

    def _ensure_bucket(self) -> None:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except Exception:
            try:
                self._client.create_bucket(Bucket=self.bucket)
            except Exception:
                # Bucket may already exist or require external provisioning.
                pass

    def save(self, category: str, file_name: str, content: bytes, *, tenant_id: str | None = None) -> dict:
        artifact_id = str(uuid4())
        storage_key = build_tenant_storage_key(category, file_name, tenant_id=tenant_id, artifact_id=artifact_id)
        key = self._object_key(storage_key)
        self._client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType="application/octet-stream",
            Metadata={"checksum": hashlib.sha256(content).hexdigest()},
        )
        cache_path = self.local_cache_dir / storage_key
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(content)
        return {
            "id": artifact_id,
            "storageKey": storage_key,
            "fileName": Path(file_name).name or "artifact",
            "byteSize": len(content),
            "checksum": hashlib.sha256(content).hexdigest(),
            "backend": self.backend,
            "tenantId": _safe_segment(tenant_id or "local-tenant", fallback="local-tenant"),
        }

    def resolve(self, storage_key: str, *, tenant_id: str | None = None) -> Path:
        assert_storage_key_tenant(storage_key, tenant_id)
        # Materialize object into local cache for FileResponse compatibility.
        cache_path = self.local_cache_dir / storage_key
        if cache_path.exists():
            return cache_path
        key = self._object_key(storage_key)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self.bucket, key, str(cache_path))
        return cache_path

    def read(self, storage_key: str, *, tenant_id: str | None = None) -> bytes:
        assert_storage_key_tenant(storage_key, tenant_id)
        key = self._object_key(storage_key)
        response = self._client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def delete(self, storage_key: str, *, tenant_id: str | None = None) -> None:
        assert_storage_key_tenant(storage_key, tenant_id)
        key = self._object_key(storage_key)
        try:
            self._client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            pass
        cache_path = self.local_cache_dir / storage_key
        cache_path.unlink(missing_ok=True)


def create_artifact_store(
    *,
    backend: str = "local",
    artifact_dir: str = "workspace-artifacts",
    s3_bucket: str | None = None,
    s3_endpoint_url: str | None = None,
    s3_access_key: str | None = None,
    s3_secret_key: str | None = None,
    s3_region: str = "us-east-1",
    s3_prefix: str = "workspace-artifacts",
) -> LocalArtifactStore | S3ArtifactStore:
    normalized = (backend or "local").strip().lower()
    if normalized in {"s3", "minio"}:
        if not s3_bucket:
            raise RuntimeError("WORKSPACE_S3_BUCKET is required when artifact backend is s3/minio")
        return S3ArtifactStore(
            bucket=s3_bucket,
            endpoint_url=s3_endpoint_url,
            access_key=s3_access_key,
            secret_key=s3_secret_key,
            region=s3_region,
            prefix=s3_prefix,
            local_cache_dir=Path(artifact_dir) / ".s3-cache",
        )
    return LocalArtifactStore(artifact_dir)


# Backward-compatible alias
ArtifactStore = LocalArtifactStore


def is_s3_endpoint(url: str | None) -> bool:
    if not url:
        return False
    return urlparse(url).scheme in {"http", "https"}
