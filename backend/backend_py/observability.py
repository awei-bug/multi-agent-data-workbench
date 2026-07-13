from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable


class JsonLogFormatter(logging.Formatter):
    """Emit one JSON object per log line for centralized log collectors."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "request_id",
            "tenant_id",
            "user_id",
            "method",
            "path",
            "status",
            "duration_ms",
            "job_id",
            "action",
            "role",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str, *, json_logs: bool = False) -> None:
    normalized = getattr(logging, level.upper(), logging.INFO)
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler()
    if json_logs:
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(normalized)


_DURATION_BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000)


@dataclass
class MetricsRegistry:
    started_at: float = field(default_factory=time.time)
    _lock: threading.RLock = field(default_factory=threading.RLock)
    request_total: dict[tuple[str, str, str], int] = field(default_factory=lambda: defaultdict(int))
    request_errors_total: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))
    request_duration_sum_ms: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(float))
    request_duration_count: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))
    request_duration_bucket: dict[tuple[str, str, str], int] = field(default_factory=lambda: defaultdict(int))
    workflow_jobs_total: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    workflow_job_steps_total: int = 0
    auth_failures_total: int = 0
    rate_limited_total: int = 0

    def observe_request(self, *, method: str, path: str, status_code: int, duration_ms: float) -> None:
        route = _normalize_path(path)
        status = str(status_code)
        key = (method.upper(), route, status)
        duration_key = (method.upper(), route)
        with self._lock:
            self.request_total[key] += 1
            self.request_duration_sum_ms[duration_key] += float(duration_ms)
            self.request_duration_count[duration_key] += 1
            for bucket in _DURATION_BUCKETS_MS:
                if duration_ms <= bucket:
                    self.request_duration_bucket[(method.upper(), route, str(bucket))] += 1
            self.request_duration_bucket[(method.upper(), route, "+Inf")] += 1
            if status_code >= 500:
                self.request_errors_total[(method.upper(), route)] += 1

    def observe_auth_failure(self) -> None:
        with self._lock:
            self.auth_failures_total += 1

    def observe_rate_limited(self) -> None:
        with self._lock:
            self.rate_limited_total += 1

    def observe_workflow_job(self, status: str, steps: int = 0) -> None:
        with self._lock:
            self.workflow_jobs_total[status] += 1
            self.workflow_job_steps_total += max(0, int(steps))

    def uptime_seconds(self) -> float:
        return max(0.0, time.time() - self.started_at)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "uptimeSeconds": round(self.uptime_seconds(), 3),
                "requestsTotal": sum(self.request_total.values()),
                "requestErrorsTotal": sum(self.request_errors_total.values()),
                "authFailuresTotal": self.auth_failures_total,
                "rateLimitedTotal": self.rate_limited_total,
                "workflowJobs": dict(self.workflow_jobs_total),
                "workflowJobStepsTotal": self.workflow_job_steps_total,
            }

    def render_prometheus(self) -> str:
        lines: list[str] = [
            "# HELP workspace_up Workspace API process is up.",
            "# TYPE workspace_up gauge",
            "workspace_up 1",
            "# HELP workspace_uptime_seconds Process uptime in seconds.",
            "# TYPE workspace_uptime_seconds gauge",
            f"workspace_uptime_seconds {self.uptime_seconds():.3f}",
            "# HELP workspace_http_requests_total Total HTTP requests.",
            "# TYPE workspace_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status), value in sorted(self.request_total.items()):
                lines.append(
                    f'workspace_http_requests_total{{method="{_escape(method)}",route="{_escape(route)}",status="{_escape(status)}"}} {value}'
                )

            lines.extend(
                [
                    "# HELP workspace_http_request_errors_total Total HTTP 5xx responses.",
                    "# TYPE workspace_http_request_errors_total counter",
                ]
            )
            for (method, route), value in sorted(self.request_errors_total.items()):
                lines.append(
                    f'workspace_http_request_errors_total{{method="{_escape(method)}",route="{_escape(route)}"}} {value}'
                )

            lines.extend(
                [
                    "# HELP workspace_http_request_duration_ms HTTP request duration in milliseconds.",
                    "# TYPE workspace_http_request_duration_ms histogram",
                ]
            )
            for (method, route), count in sorted(self.request_duration_count.items()):
                for bucket in [str(item) for item in _DURATION_BUCKETS_MS] + ["+Inf"]:
                    bucket_value = self.request_duration_bucket.get((method, route, bucket), 0)
                    lines.append(
                        f'workspace_http_request_duration_ms_bucket{{method="{_escape(method)}",route="{_escape(route)}",le="{bucket}"}} {bucket_value}'
                    )
                lines.append(
                    f'workspace_http_request_duration_ms_sum{{method="{_escape(method)}",route="{_escape(route)}"}} {self.request_duration_sum_ms[(method, route)]:.3f}'
                )
                lines.append(
                    f'workspace_http_request_duration_ms_count{{method="{_escape(method)}",route="{_escape(route)}"}} {count}'
                )

            lines.extend(
                [
                    "# HELP workspace_workflow_jobs_total Workflow jobs by terminal/active status.",
                    "# TYPE workspace_workflow_jobs_total counter",
                ]
            )
            for status, value in sorted(self.workflow_jobs_total.items()):
                lines.append(f'workspace_workflow_jobs_total{{status="{_escape(status)}"}} {value}')

            lines.extend(
                [
                    "# HELP workspace_workflow_job_steps_total Total workflow steps executed.",
                    "# TYPE workspace_workflow_job_steps_total counter",
                    f"workspace_workflow_job_steps_total {self.workflow_job_steps_total}",
                    "# HELP workspace_auth_failures_total Authentication failures.",
                    "# TYPE workspace_auth_failures_total counter",
                    f"workspace_auth_failures_total {self.auth_failures_total}",
                    "# HELP workspace_rate_limited_total Rate limited requests.",
                    "# TYPE workspace_rate_limited_total counter",
                    f"workspace_rate_limited_total {self.rate_limited_total}",
                ]
            )
        return "\n".join(lines) + "\n"


def _normalize_path(path: str) -> str:
    if not path:
        return "/"
    # Keep cardinality bounded for dynamic ids.
    parts = []
    for part in path.split("/"):
        if not part:
            continue
        if _looks_like_id(part):
            parts.append(":id")
        else:
            parts.append(part)
    return "/" + "/".join(parts) if parts else "/"


def _looks_like_id(value: str) -> bool:
    if value.startswith("job-") or value.startswith("user-") or value.startswith("uploaded-file-"):
        return True
    if len(value) >= 16 and any(ch.isdigit() for ch in value) and any(ch.isalpha() for ch in value):
        return True
    if value.count("-") >= 2 and len(value) >= 20:
        return True
    return False


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


_default_metrics = MetricsRegistry()


def get_metrics() -> MetricsRegistry:
    return _default_metrics


def reset_metrics_for_tests() -> MetricsRegistry:
    global _default_metrics
    _default_metrics = MetricsRegistry()
    return _default_metrics
