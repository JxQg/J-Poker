from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from .domain import DomainError, RoomGame, rejected_ack
from .protocol import CommandRejected, ErrorCode, RoomCommand
from .repository import MemberRecord, RoomRepository, StorageConflict

logger = logging.getLogger(__name__)

Broadcast = Callable[[RoomGame, list[dict[str, Any]]], Awaitable[None]]


@dataclass(slots=True)
class _Envelope:
    kind: str
    values: dict[str, Any]
    future: asyncio.Future[Any]


class RoomActor:
    def __init__(self, room: RoomGame, repository: RoomRepository, broadcast: Broadcast) -> None:
        self.room = room
        self.repository = repository
        self.broadcast = broadcast
        self._queue: asyncio.Queue[_Envelope | None] = asyncio.Queue()
        self._task = asyncio.create_task(self._run(), name=f"room-actor:{room.room_id}")

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    async def stop(self) -> None:
        await self._queue.put(None)
        await self._task

    async def command(self, member_id: str, command: RoomCommand) -> dict[str, Any]:
        return await self._ask("command", member_id=member_id, command=command)

    async def add_member(self, member_id: str, guest_hash: str, nickname: str) -> MemberRecord:
        return await self._ask(
            "add_member",
            member_id=member_id,
            guest_hash=guest_hash,
            nickname=nickname,
        )

    async def set_connection(self, member_id: str, online: bool) -> None:
        await self._ask("connection", member_id=member_id, online=online)

    async def housekeeping(self) -> None:
        await self._ask("housekeeping")

    def projection(self, member_id: str) -> dict[str, Any]:
        return self.room.projection(member_id)

    async def _ask(self, kind: str, **values: Any) -> Any:
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        await self._queue.put(_Envelope(kind, values, future))
        return await future

    async def _run(self) -> None:
        while True:
            envelope = await self._queue.get()
            if envelope is None:
                return
            try:
                result = await self._dispatch(envelope)
            except Exception as exc:
                if not envelope.future.done():
                    envelope.future.set_exception(exc)
            else:
                if not envelope.future.done():
                    envelope.future.set_result(result)

    async def _dispatch(self, envelope: _Envelope) -> Any:
        if envelope.kind == "command":
            return await self._handle_command(
                envelope.values["member_id"], envelope.values["command"]
            )
        candidate = self.room.clone()
        if envelope.kind == "add_member":
            record = candidate.add_member(**envelope.values)
            await self._commit(candidate, member_upserts=[record])
            return record
        if envelope.kind == "connection":
            candidate.set_connection(**envelope.values)
            if candidate.events:
                await self._commit(candidate)
            return None
        if envelope.kind == "housekeeping":
            candidate.housekeeping()
            if candidate.events:
                await self._commit(candidate)
            return None
        raise RuntimeError(f"unknown actor envelope {envelope.kind}")

    async def _handle_command(self, member_id: str, command: RoomCommand) -> dict[str, Any]:
        duplicate = await self.repository.get_command_result(self.room.room_id, command.command_id)
        if duplicate is not None:
            original_member_id, result = duplicate
            if original_member_id == member_id:
                return result
            error = DomainError(ErrorCode.INVALID_COMMAND, "commandId belongs to another player")
            return rejected_ack(command.command_id, self.room.version, error)

        if command.room_id != self.room.room_id:
            error = DomainError(ErrorCode.ROOM_NOT_FOUND, "command targets another room")
            result = rejected_ack(command.command_id, self.room.version, error)
            await self.repository.save_rejection(
                self.room.room_id, member_id, command.command_id, result
            )
            return result

        candidate = self.room.clone()
        try:
            accepted = candidate.apply_command(member_id, command)
        except DomainError as error:
            result = rejected_ack(command.command_id, self.room.version, error)
            await self.repository.save_rejection(
                self.room.room_id, member_id, command.command_id, result
            )
            return result
        result = accepted.model_dump(mode="json", by_alias=True)
        try:
            await self._commit(
                candidate,
                command_result=(member_id, command.command_id, result),
            )
        except (SQLAlchemyError, StorageConflict):
            logger.exception(
                "room transition could not be persisted",
                extra={"room_id": self.room.room_id},
            )
            return CommandRejected(
                command_id=command.command_id,
                applied_version=self.room.version,
                error_code=ErrorCode.DATABASE_UNAVAILABLE,
                message="room is paused while persistence is unavailable",
            ).model_dump(mode="json", by_alias=True)
        return result

    async def _commit(
        self,
        candidate: RoomGame,
        *,
        command_result: tuple[str, str, dict[str, Any]] | None = None,
        member_upserts: list[MemberRecord] | None = None,
    ) -> None:
        previous_version = self.room.version
        await self.repository.persist_transition(
            room_id=self.room.room_id,
            expected_version=previous_version,
            snapshot=candidate.to_storage(),
            events=candidate.events,
            command_result=command_result,
            member_upserts=member_upserts or candidate.member_upserts,
            member_deletes=candidate.member_deletes,
            audit_material=candidate.current_audit_material,
        )
        self.room = candidate
        try:
            await self.broadcast(candidate, candidate.events)
        except Exception:
            logger.exception("room outbox delivery failed", extra={"room_id": self.room.room_id})
        else:
            await self.repository.mark_events_published(
                self.room.room_id, [event["version"] for event in candidate.events]
            )
        if self.room.data["phase"] == "closed":
            try:
                await self.repository.finalize_audit(self.room.room_id)
            except (SQLAlchemyError, ValueError):
                logger.exception(
                    "room audit finalization deferred",
                    extra={"room_id": self.room.room_id},
                )
