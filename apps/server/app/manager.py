from __future__ import annotations

import asyncio
import secrets
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import Any

from sqlalchemy.exc import IntegrityError

from .actor import RoomActor
from .config import Settings
from .domain import DomainError, RoomGame
from .metrics import MetricsRegistry
from .protocol import ErrorCode, RoomCommand, RoomConfig
from .repository import MemberRecord, RoomRepository, SocketPrincipal

Emit = Callable[[str, dict[str, Any], str], Awaitable[None]]
ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _is_room_code_collision(error: IntegrityError) -> bool:
    constraint_name = getattr(error.orig, "constraint_name", None)
    if constraint_name in {"ix_rooms_code", "rooms_code_key"}:
        return True
    return "UNIQUE constraint failed: rooms.code" in str(error.orig)


class RoomManager:
    def __init__(
        self,
        repository: RoomRepository,
        settings: Settings,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.metrics = metrics or repository.database.metrics
        self._actors: dict[str, RoomActor] = {}
        self._actors_lock = asyncio.Lock()
        self._emit: Emit | None = None
        self._sid_principals: dict[str, SocketPrincipal] = {}
        self._member_sids: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        self._seen_members: set[tuple[str, str]] = set()
        self._connection_count = 0
        self._sweeper: asyncio.Task[None] | None = None

    def set_emitter(self, emit: Emit) -> None:
        self._emit = emit

    async def start(self) -> None:
        for room_id in await self.repository.open_room_ids():
            await self.get_actor(room_id)
        self._refresh_active_rooms_metric()
        self._sweeper = asyncio.create_task(self._sweep(), name="room-housekeeping")

    async def stop(self) -> None:
        if self._sweeper is not None:
            self._sweeper.cancel()
            try:
                await self._sweeper
            except asyncio.CancelledError:
                pass
        await asyncio.gather(*(actor.stop() for actor in list(self._actors.values())))

    def _refresh_active_rooms_metric(self) -> None:
        active = sum(
            1 for actor in self._actors.values() if actor.room.data.get("phase") != "closed"
        )
        self.metrics.set_active_rooms(active)

    async def _sweep(self) -> None:
        maintenance_ticks = 0
        while True:
            await asyncio.sleep(1)
            await asyncio.gather(
                *(actor.housekeeping() for actor in list(self._actors.values())),
                return_exceptions=True,
            )
            self._refresh_active_rooms_metric()
            maintenance_ticks += 1
            if maintenance_ticks >= 60:
                maintenance_ticks = 0
                await self.repository.purge_expired_tickets()
                await self.repository.purge_expired_rooms(self.settings.audit_retention_seconds)

    async def get_actor(self, room_id: str) -> RoomActor:
        actor = self._actors.get(room_id)
        if actor is not None:
            return actor
        async with self._actors_lock:
            actor = self._actors.get(room_id)
            if actor is not None:
                return actor
            snapshot, materials = await self.repository.load_room(room_id)
            room = RoomGame(snapshot, materials, self.settings)
            actor = RoomActor(room, self.repository, self._broadcast)
            self._actors[room_id] = actor
            self._refresh_active_rooms_metric()
            return actor

    async def create_room(
        self, nickname: str, config: RoomConfig, guest_hash: str
    ) -> tuple[str, str, str]:
        for _ in range(8):
            room_id = str(uuid.uuid4())
            member_id = str(uuid.uuid4())
            code = "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(8))
            room = RoomGame.create(
                room_id=room_id,
                code=code,
                member_id=member_id,
                nickname=nickname,
                config=config,
                settings=self.settings,
            )
            member = MemberRecord(member_id, room_id, guest_hash, nickname, 0)
            try:
                await self.repository.create_room(room.to_storage(), member)
            except IntegrityError as error:
                if _is_room_code_collision(error):
                    continue
                raise
            async with self._actors_lock:
                self._actors[room_id] = RoomActor(room, self.repository, self._broadcast)
            self._refresh_active_rooms_metric()
            return room_id, code, member_id
        raise RuntimeError("could not allocate a unique room code")

    async def join_room(self, code: str, nickname: str, guest_hash: str) -> tuple[str, str, str]:
        room_id = await self.repository.find_room_id_by_code(code.upper())
        if room_id is None:
            raise DomainError(ErrorCode.ROOM_NOT_FOUND, "room code was not found")
        existing = await self.repository.find_member_by_guest(room_id, guest_hash)
        if existing is not None:
            return room_id, code.upper(), existing.id
        actor = await self.get_actor(room_id)
        member_id = str(uuid.uuid4())
        await actor.add_member(member_id, guest_hash, nickname)
        self._refresh_active_rooms_metric()
        return room_id, code.upper(), member_id

    async def member_for_guest(self, room_id: str, guest_hash: str) -> MemberRecord:
        member = await self.repository.find_member_by_guest(room_id, guest_hash)
        if member is None:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "guest is not a room member")
        return member

    async def issue_socket_ticket(self, room_id: str, guest_hash: str) -> tuple[str, Any]:
        member = await self.member_for_guest(room_id, guest_hash)
        return await self.repository.issue_socket_ticket(
            room_id, member.id, self.settings.socket_ticket_ttl_seconds
        )

    async def consume_socket_ticket(self, ticket: str) -> SocketPrincipal | None:
        return await self.repository.consume_socket_ticket(ticket)

    async def socket_connected(self, sid: str, principal: SocketPrincipal) -> dict[str, Any]:
        actor = await self.get_actor(principal.room_id)
        sids = self._member_sids[principal.room_id][principal.member_id]
        if sid in sids:
            return actor.projection(principal.member_id)
        first = not sids
        sids.add(sid)
        self._sid_principals[sid] = principal
        self._connection_count += 1
        self.metrics.set_connections(self._connection_count)
        if first:
            member_key = (principal.room_id, principal.member_id)
            if member_key in self._seen_members:
                self.metrics.record_reconnect()
            else:
                self._seen_members.add(member_key)
            await actor.set_connection(principal.member_id, True)
        return actor.projection(principal.member_id)

    async def socket_disconnected(self, sid: str) -> None:
        principal = self._sid_principals.pop(sid, None)
        if principal is None:
            return
        sids = self._member_sids[principal.room_id][principal.member_id]
        sids.discard(sid)
        self._connection_count = max(0, self._connection_count - 1)
        self.metrics.set_connections(self._connection_count)
        if not sids:
            actor = await self.get_actor(principal.room_id)
            await actor.set_connection(principal.member_id, False)

    async def socket_command(self, sid: str, command: RoomCommand) -> dict[str, Any]:
        principal = self._sid_principals.get(sid)
        if principal is None:
            raise DomainError(ErrorCode.AUTH_REQUIRED, "socket is not authenticated")
        actor = await self.get_actor(principal.room_id)
        started = perf_counter()
        status = "error"
        try:
            result = await actor.command(principal.member_id, command)
            status = result.get("status", "error")
            error_code = result.get("errorCode")
            self.metrics.record_action(status, error_code)
            if command.type == "request_snapshot" and self._emit is not None:
                await self._emit("room:snapshot", actor.projection(principal.member_id), sid)
            self._refresh_active_rooms_metric()
            return result
        except DomainError as error:
            status = "rejected"
            self.metrics.record_action(status, error.code.value)
            raise
        except Exception:
            self.metrics.record_action("error")
            if command.type in {"shuffle.contribute", "contribute_randomness"}:
                self.metrics.record_shuffle_failure("processing_error")
            raise
        finally:
            self.metrics.observe_action_latency(perf_counter() - started, status)
            self._refresh_active_rooms_metric()

    async def audit_for_guest(self, room_id: str, guest_hash: str) -> dict[str, Any]:
        await self.member_for_guest(room_id, guest_hash)
        return await self.repository.get_audit(room_id)

    async def _broadcast(self, room: RoomGame, events: list[dict[str, Any]]) -> None:
        if self._emit is None:
            return
        room_connections = self._member_sids.get(room.room_id, {})
        all_sids = [sid for sids in room_connections.values() for sid in sids]
        for event in events:
            message = {
                "roomId": room.room_id,
                "version": event["version"],
                "type": event["type"],
                "payload": event["payload"],
                "createdAt": event["createdAt"],
            }
            await asyncio.gather(*(self._emit("room:event", message, sid) for sid in all_sids))
        for member_id, sids in room_connections.items():
            if member_id not in room.data["players"]:
                continue
            snapshot = room.projection(member_id)
            await asyncio.gather(*(self._emit("room:snapshot", snapshot, sid) for sid in sids))
