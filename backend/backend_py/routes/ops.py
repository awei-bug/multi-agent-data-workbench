from __future__ import annotations

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from backend_py.api_helpers import audit
from backend_py.app_context import AppContext
from backend_py.auth import has_permission, PERMISSION_ADMIN


def register_ops_routes(app: FastAPI, ctx: AppContext) -> None:
    router = APIRouter(tags=["ops"])

    @router.get("/api/health")
    def health_check():
        model_status = {
            "configured": bool(ctx.api_key),
            "baseUrl": ctx.base_url,
            "name": ctx.model,
            "timeoutSeconds": ctx.model_timeout_seconds,
        }
        try:
            database = ctx.repo.ping()
        except Exception as error:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unavailable",
                    "database": {"ok": False, "error": str(error)},
                    "model": model_status,
                },
            )

        from backend_py.auth import ROLE_ADMIN, ROLE_ANALYST, ROLE_VIEWER

        return {
            "status": "ok",
            "database": database,
            "model": model_status,
            "auth": {
                "required": ctx.auth_required,
                "tokenMinutes": ctx.auth_token_minutes,
                "roles": [ROLE_VIEWER, ROLE_ANALYST, ROLE_ADMIN],
                "cookieAuth": True,
            },
            "security": {
                "productionMode": ctx.production_mode,
                "exportWatermark": ctx.export_watermark_enabled,
                "exportMaskSensitive": ctx.export_mask_sensitive,
                "retention": {
                    "historyDays": ctx.retention_history_days,
                    "datasetDays": ctx.retention_dataset_days,
                    "artifactDays": ctx.retention_artifact_days,
                    "auditDays": ctx.retention_audit_days,
                },
                "hsts": ctx.enable_hsts,
                "ok": getattr(ctx.security_report, "ok", True),
                "warnings": getattr(ctx.security_report, "warnings", []),
            },
            "storage": {
                "backend": getattr(ctx.store, "backend", ctx.artifact_backend),
            },
            "queue": {
                "backend": getattr(ctx.workflow_runner, "backend_name", "memory"),
            },
            "observability": {
                "metricsEnabled": ctx.metrics_enabled,
                "metricsPath": "/metrics",
                "metricsPublic": ctx.metrics_public,
                "snapshot": ctx.metrics.snapshot() if ctx.metrics_enabled else {},
                "errorTracking": ctx.tracker.snapshot(),
            },
            "rateLimit": {
                "backend": getattr(ctx.limiter, "backend_name", ctx.rate_limit_backend),
                "perMinute": ctx.rate_limit_per_minute,
            },
        }

    @router.get("/metrics")
    def prometheus_metrics(request: Request):
        if not ctx.metrics_enabled:
            raise HTTPException(status_code=404, detail="metrics disabled")
        if not ctx.metrics_public:
            ctx.require_admin_access(request)
        return PlainTextResponse(ctx.metrics.render_prometheus(), media_type="text/plain; version=0.0.4; charset=utf-8")

    @router.get("/api/metrics")
    def metrics_snapshot(request: Request):
        if not ctx.metrics_enabled:
            raise HTTPException(status_code=404, detail="metrics disabled")
        if not ctx.metrics_public:
            ctx.require_admin_access(request)
        return {
            "status": "ok",
            "metrics": ctx.metrics.snapshot(),
            "errorTracking": ctx.tracker.snapshot(),
        }

    @router.get("/api/errors/recent")
    def recent_errors(request: Request, limit: int = 20):
        ctx.require_admin_access(request)
        return {
            "items": ctx.tracker.recent_events(limit=limit),
            "summary": ctx.tracker.snapshot(),
        }

    @router.get("/api/health/live")
    def live_check():
        from datetime import datetime, timezone

        return {
            "status": "ok",
            "service": "workspace-api",
            "time": datetime.now(timezone.utc).isoformat(),
        }

    @router.get("/api/health/ready")
    def readiness_check():
        model_status = {
            "configured": bool(ctx.api_key),
            "baseUrl": ctx.base_url,
            "name": ctx.model,
            "timeoutSeconds": ctx.model_timeout_seconds,
        }
        try:
            database = ctx.repo.ping()
        except Exception as error:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unavailable",
                    "checks": {
                        "database": {"ok": False, "error": str(error)},
                        "model": model_status,
                    },
                },
            )
        return {
            "status": "ok",
            "checks": {
                "database": database if isinstance(database, dict) else {"ok": True, "detail": database},
                "model": model_status,
            },
        }

    @router.post("/api/admin/retention/purge")
    def purge_retention(request: Request) -> dict:
        ctx.require_admin_access(request)
        from backend_py.repository import get_workspace_scope

        result = ctx.repo.purge_expired_resources(
            history_days=ctx.retention_history_days,
            dataset_days=ctx.retention_dataset_days,
            artifact_days=ctx.retention_artifact_days,
            audit_days=ctx.retention_audit_days,
        )
        deleted_files = 0
        tenant_id, _owner_id = get_workspace_scope()
        for artifact in result.get("artifacts") or []:
            key = artifact.get("storageKey")
            if key:
                try:
                    ctx.store.delete(key, tenant_id=artifact.get("tenantId") or tenant_id)
                    deleted_files += 1
                except Exception:
                    pass
        for dataset in result.get("datasets") or []:
            key = dataset.get("storageKey")
            if key:
                try:
                    ctx.store.delete(key, tenant_id=dataset.get("tenantId") or tenant_id)
                    deleted_files += 1
                except Exception:
                    pass
        audit(
            ctx.repo,
            "admin.retention.purge",
            "retention",
            {
                "history": len(result.get("historyTaskIds") or []),
                "datasets": len(result.get("datasets") or []),
                "artifacts": len(result.get("artifacts") or []),
                "audits": result.get("auditDeleted") or 0,
                "files": deleted_files,
            },
        )
        return {
            "purged": {
                "historyTasks": len(result.get("historyTaskIds") or []),
                "datasets": len(result.get("datasets") or []),
                "artifacts": len(result.get("artifacts") or []),
                "audits": result.get("auditDeleted") or 0,
                "files": deleted_files,
            },
            "policy": {
                "historyDays": ctx.retention_history_days,
                "datasetDays": ctx.retention_dataset_days,
                "artifactDays": ctx.retention_artifact_days,
                "auditDays": ctx.retention_audit_days,
            },
        }

    app.include_router(router)
