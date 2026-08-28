from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from threading import RLock

METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"

# The buckets cover the service's sub-200 ms target while retaining useful
# visibility into slow database/network incidents.
DEFAULT_BUCKETS: tuple[float, ...] = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    math.inf,
)

_LABEL_VALUE = re.compile(r"^[A-Za-z0-9_.:-]+$")
_ACTION_STATUSES = ("accepted", "rejected", "error")
_DATABASE_OPERATIONS = ("read", "write", "schema", "other")
_DATABASE_STATUSES = ("success", "error")
_SHUFFLE_REASONS = ("processing_error",)


def _labels_key(labels: Mapping[str, str] | None) -> tuple[tuple[str, str], ...]:
    if not labels:
        return ()
    normalized: list[tuple[str, str]] = []
    for name, value in labels.items():
        # All call sites use bounded enums. Keep a defensive fallback so a
        # future caller cannot inject arbitrary text into the exposition.
        safe_name = name if _LABEL_VALUE.fullmatch(name) else "label"
        safe_value = value if _LABEL_VALUE.fullmatch(value) else "unknown"
        normalized.append((safe_name, safe_value))
    return tuple(sorted(normalized))


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _format_labels(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    body = ",".join(f'{name}="{_escape_label(value)}"' for name, value in labels)
    return "{" + body + "}"


@dataclass(slots=True)
class _Histogram:
    buckets: tuple[float, ...]
    bucket_counts: list[int]
    total: float = 0.0
    count: int = 0

    @classmethod
    def create(cls, buckets: tuple[float, ...]) -> _Histogram:
        return cls(buckets=buckets, bucket_counts=[0] * len(buckets))

    def observe(self, value: float) -> None:
        if not math.isfinite(value):
            return
        value = max(0.0, value)
        self.total += value
        self.count += 1
        for index, boundary in enumerate(self.buckets):
            if value <= boundary:
                self.bucket_counts[index] += 1


class MetricsRegistry:
    """Small in-process Prometheus registry with a deliberately bounded schema.

    The service is a single instance in the MVP, so an in-memory registry is
    sufficient. Metric labels never contain room/member identifiers or payload
    data; they are limited to protocol outcomes and operation categories.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._gauges: dict[str, float] = {
            "holdem_connections": 0.0,
            "holdem_active_rooms": 0.0,
        }
        self._counters: dict[str, dict[tuple[tuple[str, str], ...], int]] = {
            "holdem_actions_total": {
                _labels_key({"status": status, "error_code": "none"}): 0
                for status in _ACTION_STATUSES
            },
            "holdem_reconnects_total": {(): 0},
            "holdem_shuffle_failures_total": {
                (("reason", reason),): 0 for reason in _SHUFFLE_REASONS
            },
        }
        self._histograms: dict[str, dict[tuple[tuple[str, str], ...], _Histogram]] = {
            "holdem_action_latency_seconds": {
                (("status", status),): _Histogram.create(DEFAULT_BUCKETS)
                for status in _ACTION_STATUSES
            },
            "holdem_database_latency_seconds": {},
        }

    def set_connections(self, value: int) -> None:
        with self._lock:
            self._gauges["holdem_connections"] = float(max(0, value))

    def set_active_rooms(self, value: int) -> None:
        with self._lock:
            self._gauges["holdem_active_rooms"] = float(max(0, value))

    def record_action(self, status: str, error_code: str | None = None) -> None:
        safe_status = status if status in _ACTION_STATUSES else "error"
        labels: dict[str, str] = {"status": safe_status, "error_code": "none"}
        if safe_status == "rejected" and error_code:
            labels["error_code"] = error_code if _LABEL_VALUE.fullmatch(error_code) else "UNKNOWN"
        key = _labels_key(labels)
        with self._lock:
            values = self._counters["holdem_actions_total"]
            values[key] = values.get(key, 0) + 1

    def observe_action_latency(self, seconds: float, status: str) -> None:
        safe_status = status if status in _ACTION_STATUSES else "error"
        key = _labels_key({"status": safe_status})
        with self._lock:
            histogram = self._histograms["holdem_action_latency_seconds"].get(key)
            if histogram is None:
                histogram = _Histogram.create(DEFAULT_BUCKETS)
                self._histograms["holdem_action_latency_seconds"][key] = histogram
            histogram.observe(seconds)

    def record_reconnect(self) -> None:
        with self._lock:
            self._counters["holdem_reconnects_total"][()] += 1

    def observe_database_latency(
        self, operation: str, seconds: float, status: str = "success"
    ) -> None:
        safe_operation = operation if operation in _DATABASE_OPERATIONS else "other"
        safe_status = status if status in _DATABASE_STATUSES else "error"
        key = _labels_key({"operation": safe_operation, "status": safe_status})
        with self._lock:
            histogram = self._histograms["holdem_database_latency_seconds"].get(key)
            if histogram is None:
                histogram = _Histogram.create(DEFAULT_BUCKETS)
                self._histograms["holdem_database_latency_seconds"][key] = histogram
            histogram.observe(seconds)

    def record_shuffle_failure(self, reason: str) -> None:
        safe_reason = reason if reason in _SHUFFLE_REASONS else "processing_error"
        key = _labels_key({"reason": safe_reason})
        with self._lock:
            values = self._counters["holdem_shuffle_failures_total"]
            values[key] = values.get(key, 0) + 1

    def render(self) -> str:
        with self._lock:
            gauges = dict(self._gauges)
            counters = {name: dict(values) for name, values in self._counters.items()}
            histograms = {
                name: {
                    labels: _Histogram(
                        buckets=histogram.buckets,
                        bucket_counts=list(histogram.bucket_counts),
                        total=histogram.total,
                        count=histogram.count,
                    )
                    for labels, histogram in values.items()
                }
                for name, values in self._histograms.items()
            }

        lines: list[str] = []
        gauge_help = {
            "holdem_connections": "Current Socket.IO connections.",
            "holdem_active_rooms": "Current non-closed room actors.",
        }
        for name in sorted(gauges):
            lines.extend((f"# HELP {name} {gauge_help[name]}", f"# TYPE {name} gauge"))
            lines.append(f"{name} {gauges[name]:.0f}")

        counter_help = {
            "holdem_actions_total": "Room commands by outcome.",
            "holdem_reconnects_total": "Socket reconnects after a member had no active connection.",
            "holdem_shuffle_failures_total": "Shuffle contribution or activation failures.",
        }
        for name in sorted(counters):
            lines.extend((f"# HELP {name} {counter_help[name]}", f"# TYPE {name} counter"))
            for labels, value in sorted(counters[name].items()):
                lines.append(f"{name}{_format_labels(labels)} {value}")

        histogram_help = {
            "holdem_action_latency_seconds": "Room command processing latency in seconds.",
            "holdem_database_latency_seconds": "Database statement latency in seconds.",
        }
        for name in sorted(histograms):
            lines.extend((f"# HELP {name} {histogram_help[name]}", f"# TYPE {name} histogram"))
            for labels, histogram in sorted(histograms[name].items()):
                for boundary, bucket_count in zip(
                    histogram.buckets, histogram.bucket_counts, strict=True
                ):
                    bucket_labels = dict(labels)
                    bucket_labels["le"] = "+Inf" if math.isinf(boundary) else format(boundary, "g")
                    lines.append(
                        f"{name}_bucket{_format_labels(_labels_key(bucket_labels))} {bucket_count}"
                    )
                suffix = _format_labels(labels)
                lines.append(f"{name}_sum{suffix} {histogram.total:.9g}")
                lines.append(f"{name}_count{suffix} {histogram.count}")

        return "\n".join(lines) + "\n"
