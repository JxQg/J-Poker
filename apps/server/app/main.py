from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import socketio  # type: ignore[import-untyped]
from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from .api import build_api
from .config import Settings, get_settings
from .db import Database
from .domain import DomainError, parse_command, rejected_ack
from .fairness import CryptoService
from .manager import RoomManager
from .metrics import MetricsRegistry
from .repository import RoomRepository


class SpaStaticFiles(StaticFiles):
    """Serve the bundled client while preserving SPA routes and missing asset errors."""

    async def get_response(self, path: str, scope: Any):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404 and "." not in Path(path).name:
                return await super().get_response("index.html", scope)
            raise


def create_application(settings: Settings | None = None) -> tuple[FastAPI, socketio.AsyncServer]:
    settings = settings or get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
    metrics = MetricsRegistry()
    database = Database(settings, metrics)
    crypto = CryptoService(settings.secret_bytes)
    repository = RoomRepository(database, crypto)
    manager = RoomManager(repository, settings, metrics)
    api = build_api(settings, metrics)
    if settings.web_dist_dir is not None:
        if not settings.web_dist_dir.is_dir():
            raise RuntimeError(f"WEB_DIST_DIR does not exist: {settings.web_dist_dir}")
        api.mount(
            "/",
            SpaStaticFiles(directory=str(settings.web_dist_dir), html=True),
            name="web-client",
        )
    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=list(settings.allowed_origins),
        logger=False,
        engineio_logger=False,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await database.start()
        app.state.database = database
        app.state.manager = manager

        async def emit(event: str, data: dict[str, Any], sid: str) -> None:
            await sio.emit(event, data, to=sid)

        manager.set_emitter(emit)
        await manager.start()
        try:
            yield
        finally:
            await manager.stop()
            await database.stop()

    api.router.lifespan_context = lifespan

    @sio.event
    async def connect(sid: str, _environ: dict[str, Any], auth: Any) -> bool:
        ticket = auth.get("ticket") if isinstance(auth, dict) else None
        if not isinstance(ticket, str):
            raise socketio.exceptions.ConnectionRefusedError("socket ticket is required")
        principal = await manager.consume_socket_ticket(ticket)
        if principal is None:
            raise socketio.exceptions.ConnectionRefusedError("socket ticket is invalid or expired")
        await sio.enter_room(sid, principal.room_id)
        snapshot = await manager.socket_connected(sid, principal)
        await sio.emit("room:snapshot", snapshot, to=sid)
        return True

    @sio.event
    async def disconnect(sid: str, _reason: str | None = None) -> None:
        await manager.socket_disconnected(sid)

    @sio.on("room:command")
    async def room_command(sid: str, value: Any) -> dict[str, Any]:
        command_id = value.get("commandId", "invalid") if isinstance(value, dict) else "invalid"
        try:
            command = parse_command(value)
            result = await manager.socket_command(sid, command)
        except DomainError as error:
            result = rejected_ack(str(command_id), 0, error)
        await sio.emit("room:ack", result, to=sid)
        if result["status"] == "rejected":
            await sio.emit(
                "room:error",
                {
                    "errorCode": result["errorCode"],
                    "message": result["message"],
                    "commandId": result["commandId"],
                },
                to=sid,
            )
        return result

    return api, sio


app, sio = create_application()
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")
