from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("workspace_error_tracking")


@dataclass
class ErrorEvent:
    id: str
    level: str
    message: str
    timestamp: str
    source: str
    context: dict[str, Any] = field(default_factory=dict)
    exception_type: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "level": self.level,
            "message": self.message,
            "timestamp": self.timestamp,
            "source": self.source,
            "context": self.context,
            "exceptionType": self.exception_type,
        }


class ErrorTracker:
    """Capture errors for local inspection, optional Sentry, and webhook alerts."""

    def __init__(
        self,
        *,
        enabled: bool = True,
        sentry_dsn: str | None = None,
        environment: str = "local",
        release: str | None = None,
        traces_sample_rate: float = 0.0,
        alert_webhook_url: str | None = None,
        alert_min_level: str = "error",
        max_buffer: int = 100,
        sentry_module: Any | None = None,
        webhook_sender: Any | None = None,
    ) -> None:
        self.enabled = enabled
        self.sentry_dsn = (sentry_dsn or "").strip() or None
        self.environment = environment
        self.release = release
        self.traces_sample_rate = traces_sample_rate
        self.alert_webhook_url = (alert_webhook_url or "").strip() or None
        self.alert_min_level = alert_min_level.lower()
        self._lock = threading.RLock()
        self._buffer: deque[ErrorEvent] = deque(maxlen=max(10, max_buffer))
        self._total_captured = 0
        self._total_alerts = 0
        self._sentry = sentry_module
        self._webhook_sender = webhook_sender or self._default_webhook_sender
        self._sentry_ready = False
        self._counter = 0
        if self.enabled and self.sentry_dsn:
            self._init_sentry()

    def _init_sentry(self) -> None:
        try:
            sentry_sdk = self._sentry
            if sentry_sdk is None:
                import sentry_sdk as sentry_sdk  # type: ignore
                self._sentry = sentry_sdk
            sentry_sdk.init(
                dsn=self.sentry_dsn,
                environment=self.environment,
                release=self.release,
                traces_sample_rate=self.traces_sample_rate,
                send_default_pii=False,
            )
            self._sentry_ready = True
            logger.info("sentry_initialized environment=%s", self.environment)
        except Exception as error:  # noqa: BLE001
            self._sentry_ready = False
            logger.warning("sentry_init_failed error=%s", error)

    def _next_id(self) -> str:
        self._counter += 1
        return f"err-{int(time.time())}-{self._counter}"

    @staticmethod
    def _level_rank(level: str) -> int:
        order = {"debug": 10, "info": 20, "warning": 30, "error": 40, "fatal": 50, "critical": 50}
        return order.get(level.lower(), 40)

    def capture_exception(
        self,
        error: BaseException,
        *,
        source: str = "app",
        context: dict[str, Any] | None = None,
        level: str = "error",
    ) -> ErrorEvent | None:
        if not self.enabled:
            return None
        event = ErrorEvent(
            id=self._next_id(),
            level=level.lower(),
            message=str(error) or error.__class__.__name__,
            timestamp=datetime.now(timezone.utc).isoformat(),
            source=source,
            context=dict(context or {}),
            exception_type=error.__class__.__name__,
        )
        self._store(event)
        if self._sentry_ready and self._sentry is not None:
            try:
                with self._sentry.push_scope() as scope:
                    scope.set_tag("source", source)
                    scope.set_level(level.lower())
                    for key, value in event.context.items():
                        scope.set_extra(key, value)
                    self._sentry.capture_exception(error)
            except Exception as sentry_error:  # noqa: BLE001
                logger.warning("sentry_capture_exception_failed error=%s", sentry_error)
        self._maybe_alert(event)
        return event

    def capture_message(
        self,
        message: str,
        *,
        source: str = "app",
        context: dict[str, Any] | None = None,
        level: str = "error",
    ) -> ErrorEvent | None:
        if not self.enabled:
            return None
        event = ErrorEvent(
            id=self._next_id(),
            level=level.lower(),
            message=message,
            timestamp=datetime.now(timezone.utc).isoformat(),
            source=source,
            context=dict(context or {}),
        )
        self._store(event)
        if self._sentry_ready and self._sentry is not None:
            try:
                with self._sentry.push_scope() as scope:
                    scope.set_tag("source", source)
                    scope.set_level(level.lower())
                    for key, value in event.context.items():
                        scope.set_extra(key, value)
                    self._sentry.capture_message(message, level=level.lower())
            except Exception as sentry_error:  # noqa: BLE001
                logger.warning("sentry_capture_message_failed error=%s", sentry_error)
        self._maybe_alert(event)
        return event

    def _store(self, event: ErrorEvent) -> None:
        with self._lock:
            self._buffer.appendleft(event)
            self._total_captured += 1

    def _maybe_alert(self, event: ErrorEvent) -> None:
        if not self.alert_webhook_url:
            return
        if self._level_rank(event.level) < self._level_rank(self.alert_min_level):
            return
        payload = {
            "text": f"[{event.level.upper()}] {event.source}: {event.message}",
            "event": event.to_dict(),
            "environment": self.environment,
        }
        try:
            self._webhook_sender(self.alert_webhook_url, payload)
            with self._lock:
                self._total_alerts += 1
        except Exception as error:  # noqa: BLE001
            logger.warning("alert_webhook_failed error=%s", error)

    @staticmethod
    def _default_webhook_sender(url: str, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310 - operator configured webhook
            response.read()

    def recent_events(self, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 100))
        with self._lock:
            return [event.to_dict() for event in list(self._buffer)[:safe_limit]]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.enabled,
                "sentryEnabled": bool(self.sentry_dsn and self._sentry_ready),
                "alertWebhookConfigured": bool(self.alert_webhook_url),
                "environment": self.environment,
                "totalCaptured": self._total_captured,
                "totalAlerts": self._total_alerts,
                "recent": [event.to_dict() for event in list(self._buffer)[:5]],
            }


_default_tracker: ErrorTracker | None = None
_tracker_lock = threading.RLock()


def init_error_tracking(
    *,
    enabled: bool = True,
    sentry_dsn: str | None = None,
    environment: str = "local",
    release: str | None = None,
    traces_sample_rate: float = 0.0,
    alert_webhook_url: str | None = None,
    alert_min_level: str = "error",
    sentry_module: Any | None = None,
    webhook_sender: Any | None = None,
) -> ErrorTracker:
    global _default_tracker
    with _tracker_lock:
        _default_tracker = ErrorTracker(
            enabled=enabled,
            sentry_dsn=sentry_dsn,
            environment=environment,
            release=release,
            traces_sample_rate=traces_sample_rate,
            alert_webhook_url=alert_webhook_url,
            alert_min_level=alert_min_level,
            sentry_module=sentry_module,
            webhook_sender=webhook_sender,
        )
        return _default_tracker


def get_error_tracker() -> ErrorTracker:
    global _default_tracker
    with _tracker_lock:
        if _default_tracker is None:
            _default_tracker = ErrorTracker(enabled=True)
        return _default_tracker


def reset_error_tracker_for_tests() -> ErrorTracker:
    return init_error_tracking(enabled=True, sentry_dsn=None, alert_webhook_url=None)
