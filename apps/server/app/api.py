from __future__ import annotations

import asyncio
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import Settings
from .domain import DomainError
from .fairness import b64url_decode, b64url_encode
from .manager import ROOM_CODE_ALPHABET, RoomManager
from .metrics import METRICS_CONTENT_TYPE, MetricsRegistry
from .protocol import (
    AuditPackage,
    CreateRoomRequest,
    ErrorCode,
    JoinRoomRequest,
    RoomIdentityResponse,
    SocketTicketResponse,
)


class RateLimitExceeded(RuntimeError):
    pass


class RateLimiter:
    def __init__(self) -> None:
        self._entries: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str, limit: int) -> None:
        now = time.monotonic()
        async with self._lock:
            entries = self._entries[key]
            while entries and entries[0] <= now - 60:
                entries.popleft()
            if len(entries) >= limit:
                raise RateLimitExceeded
            entries.append(now)


async def _check_limits(
    limiter: RateLimiter,
    action: str,
    request: Request,
    session_key: str,
    limit: int,
) -> None:
    await limiter.check(f"{action}:ip:{_client_key(request)}", limit)
    await limiter.check(f"{action}:session:{session_key}", limit)


def _manager(request: Request) -> RoomManager:
    return request.app.state.manager


def _client_key(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _guest_token(raw_cookie: str | None) -> tuple[str, bool]:
    if raw_cookie:
        try:
            b64url_decode(raw_cookie, expected_length=32)
            return raw_cookie, False
        except ValueError:
            pass
    return b64url_encode(secrets.token_bytes(32)), True


def _set_guest_cookie(response: JSONResponse, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.cookie_max_age_seconds,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _normalize_code(code: str) -> str:
    code = code.strip().upper()
    if len(code) != 8 or any(character not in ROOM_CODE_ALPHABET for character in code):
        raise DomainError(ErrorCode.ROOM_NOT_FOUND, "room code was not found")
    return code


def build_api(settings: Settings, metrics: MetricsRegistry | None = None) -> FastAPI:
    metrics = metrics or MetricsRegistry()
    app = FastAPI(title="J-Poker Server", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    limiter = RateLimiter()

    @app.middleware("http")
    async def validate_origin(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            normalized = origin.rstrip("/") if origin else None
            if normalized is not None and normalized not in settings.allowed_origins:
                return JSONResponse(
                    status_code=403,
                    content={"errorCode": "AUTH_REQUIRED", "message": "origin is not allowed"},
                )
            if settings.app_env == "production" and normalized is None:
                return JSONResponse(
                    status_code=403,
                    content={"errorCode": "AUTH_REQUIRED", "message": "origin is required"},
                )
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
        status = {
            ErrorCode.AUTH_REQUIRED: 401,
            ErrorCode.ROOM_NOT_FOUND: 404,
            ErrorCode.ROOM_FULL: 409,
            ErrorCode.ROOM_CLOSED: 409,
            ErrorCode.RATE_LIMITED: 429,
        }.get(exc.code, 409)
        return JSONResponse(
            status_code=status,
            content={"errorCode": exc.code.value, "message": exc.message},
        )

    router = APIRouter(prefix="/api/v1")

    @router.post("/rooms", response_model=RoomIdentityResponse, status_code=201)
    async def create_room(
        body: CreateRoomRequest,
        request: Request,
    ) -> JSONResponse:
        token, _ = _guest_token(request.cookies.get(settings.cookie_name))
        manager = _manager(request)
        guest_hash = manager.repository.crypto.token_hash(token)
        try:
            await _check_limits(
                limiter,
                "create",
                request,
                guest_hash,
                settings.rate_limit_create_per_minute,
            )
        except RateLimitExceeded as exc:
            raise DomainError(ErrorCode.RATE_LIMITED, "room creation rate limit exceeded") from exc
        room_id, room_code, member_id = await manager.create_room(
            body.nickname, body.config, guest_hash
        )
        payload = RoomIdentityResponse(
            room_id=room_id, room_code=room_code, member_id=member_id
        ).model_dump(mode="json", by_alias=True)
        response = JSONResponse(status_code=201, content=payload)
        _set_guest_cookie(response, settings, token)
        return response

    @router.post("/rooms/{code}/join", response_model=RoomIdentityResponse)
    async def join_room(
        code: str,
        body: JoinRoomRequest,
        request: Request,
    ) -> JSONResponse:
        token, _ = _guest_token(request.cookies.get(settings.cookie_name))
        manager = _manager(request)
        guest_hash = manager.repository.crypto.token_hash(token)
        try:
            await _check_limits(
                limiter,
                "join",
                request,
                guest_hash,
                settings.rate_limit_join_per_minute,
            )
        except RateLimitExceeded as exc:
            raise DomainError(ErrorCode.RATE_LIMITED, "room join rate limit exceeded") from exc
        room_id, room_code, member_id = await manager.join_room(
            _normalize_code(code), body.nickname, guest_hash
        )
        payload = RoomIdentityResponse(
            room_id=room_id, room_code=room_code, member_id=member_id
        ).model_dump(mode="json", by_alias=True)
        response = JSONResponse(content=payload)
        _set_guest_cookie(response, settings, token)
        return response

    @router.post("/rooms/{room_id}/socket-ticket", response_model=SocketTicketResponse)
    async def socket_ticket(
        room_id: str,
        request: Request,
    ) -> SocketTicketResponse:
        guest_cookie = request.cookies.get(settings.cookie_name)
        if guest_cookie is None:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "guest cookie is required")
        try:
            b64url_decode(guest_cookie, expected_length=32)
        except ValueError as exc:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "guest cookie is invalid") from exc
        manager = _manager(request)
        guest_hash = manager.repository.crypto.token_hash(guest_cookie)
        try:
            await _check_limits(
                limiter,
                "ticket",
                request,
                guest_hash,
                settings.rate_limit_ticket_per_minute,
            )
        except RateLimitExceeded as exc:
            raise DomainError(ErrorCode.RATE_LIMITED, "socket ticket rate limit exceeded") from exc
        ticket, expires_at = await manager.issue_socket_ticket(room_id, guest_hash)
        return SocketTicketResponse(ticket=ticket, expires_at=expires_at)

    @router.get("/rooms/{room_id}/audit", response_model=AuditPackage)
    async def get_audit(
        room_id: str,
        request: Request,
    ) -> dict[str, object]:
        guest_cookie = request.cookies.get(settings.cookie_name)
        if guest_cookie is None:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "guest cookie is required")
        try:
            b64url_decode(guest_cookie, expected_length=32)
        except ValueError as exc:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "guest cookie is invalid") from exc
        manager = _manager(request)
        try:
            return await manager.audit_for_guest(
                room_id, manager.repository.crypto.token_hash(guest_cookie)
            )
        except ValueError as exc:
            raise DomainError(ErrorCode.INVALID_PHASE, str(exc)) from exc

    @router.get("/health/live")
    async def api_liveness() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/health/ready")
    async def api_readiness(request: Request) -> JSONResponse:
        ready = await request.app.state.database.ready()
        return JSONResponse(
            status_code=200 if ready else 503,
            content={"status": "ready" if ready else "unavailable"},
        )

    @router.get("/metrics", include_in_schema=False)
    async def api_metrics() -> Response:
        return Response(
            content=metrics.render(),
            headers={"Content-Type": METRICS_CONTENT_TYPE},
        )

    app.include_router(router)

    @app.get("/health/live")
    async def liveness() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def readiness(request: Request) -> JSONResponse:
        ready = await request.app.state.database.ready()
        return JSONResponse(
            status_code=200 if ready else 503,
            content={"status": "ready" if ready else "unavailable"},
        )

    @app.get("/metrics", include_in_schema=False)
    async def prometheus_metrics() -> Response:
        return Response(
            content=metrics.render(),
            headers={"Content-Type": METRICS_CONTENT_TYPE},
        )

    return app
