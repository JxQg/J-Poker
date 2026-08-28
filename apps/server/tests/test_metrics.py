from __future__ import annotations

from app.metrics import MetricsRegistry


def test_metrics_registry_renders_bounded_prometheus_series() -> None:
    registry = MetricsRegistry()
    registry.set_connections(3)
    registry.set_active_rooms(2)
    registry.record_action("accepted")
    registry.record_action("rejected", "STALE_TURN")
    registry.observe_action_latency(0.025, "accepted")
    registry.record_reconnect()
    registry.observe_database_latency("read", 0.004)
    registry.record_shuffle_failure("processing_error")

    rendered = registry.render()

    assert "# TYPE holdem_connections gauge" in rendered
    assert "holdem_connections 3" in rendered
    assert "holdem_active_rooms 2" in rendered
    assert 'holdem_actions_total{error_code="STALE_TURN",status="rejected"} 1' in rendered
    assert 'holdem_action_latency_seconds_bucket{le="0.025",status="accepted"} 1' in rendered
    assert "holdem_reconnects_total 1" in rendered
    assert 'holdem_database_latency_seconds_count{operation="read",status="success"} 1' in rendered
    assert 'holdem_shuffle_failures_total{reason="processing_error"} 1' in rendered


def test_metrics_registry_discards_unbounded_label_values() -> None:
    registry = MetricsRegistry()
    registry.record_action("rejected", 'private\nvalue="secret"')

    rendered = registry.render()

    assert "private" not in rendered
    assert "secret" not in rendered
    assert 'error_code="UNKNOWN"' in rendered
