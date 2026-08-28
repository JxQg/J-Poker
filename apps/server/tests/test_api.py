from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_application


def test_comma_separated_origins_load_from_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    settings = Settings()
    assert settings.allowed_origins == ("http://localhost:5173", "http://127.0.0.1:5173")


def test_create_join_ticket_and_health(tmp_path: Path) -> None:
    secret = base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")
    settings = Settings(
        APP_ENV="test",
        DATABASE_URL=f"sqlite+aiosqlite:///{(tmp_path / 'api.db').as_posix()}",
        APP_SECRET_KEY=secret,
        ALLOWED_ORIGINS="http://localhost:5173",
        COOKIE_SECURE=False,
        AUTO_CREATE_SCHEMA=True,
    )
    app, _ = create_application(settings)
    with TestClient(app) as host_client:
        assert host_client.get("/health/live").json() == {"status": "ok"}
        assert host_client.get("/health/ready").status_code == 200
        created = host_client.post("/api/v1/rooms", json={"nickname": "Host"})
        assert created.status_code == 201
        identity = created.json()
        host_cookie = host_client.cookies.get(settings.cookie_name)
        assert len(identity["roomCode"]) == 8
        ticket = host_client.post(f"/api/v1/rooms/{identity['roomId']}/socket-ticket")
        assert ticket.status_code == 200
        assert len(ticket.json()["ticket"]) == 43
        host_client.cookies.clear()
        joined = host_client.post(
            f"/api/v1/rooms/{identity['roomCode']}/join", json={"nickname": "Guest"}
        )
        assert joined.status_code == 200
        assert joined.json()["roomId"] == identity["roomId"]
        assert host_cookie is not None

        metrics = host_client.get("/metrics")
        assert metrics.status_code == 200
        assert metrics.headers["content-type"] == "text/plain; version=0.0.4; charset=utf-8"
        assert "holdem_active_rooms 1" in metrics.text
        assert "holdem_connections 0" in metrics.text
        assert "holdem_database_latency_seconds_count" in metrics.text
        assert identity["roomId"] not in metrics.text
        assert identity["roomCode"] not in metrics.text
        assert host_cookie not in metrics.text
        assert host_client.get("/api/v1/metrics").text == metrics.text


def test_serves_bundled_web_with_spa_fallback(tmp_path: Path) -> None:
    secret = base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")
    web_dist = tmp_path / "web"
    web_dist.mkdir()
    (web_dist / "index.html").write_text("<main>J-Poker</main>", encoding="utf-8")
    (web_dist / "asset.js").write_text("console.log('asset')", encoding="utf-8")
    settings = Settings(
        APP_ENV="test",
        DATABASE_URL=f"sqlite+aiosqlite:///{(tmp_path / 'static.db').as_posix()}",
        APP_SECRET_KEY=secret,
        ALLOWED_ORIGINS="http://localhost:5173",
        COOKIE_SECURE=False,
        AUTO_CREATE_SCHEMA=True,
        WEB_DIST_DIR=web_dist,
    )
    app, _ = create_application(settings)

    with TestClient(app) as client:
        assert client.get("/").text == "<main>J-Poker</main>"
        assert client.get("/r/ABCD2345").text == "<main>J-Poker</main>"
        assert client.get("/asset.js").text == "console.log('asset')"
        assert client.get("/missing.js").status_code == 404
        assert client.get("/health/live").json() == {"status": "ok"}
