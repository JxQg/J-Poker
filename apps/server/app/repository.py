from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update

from .db import (
    AuditSecretRow,
    CommandResultRow,
    Database,
    MemberRow,
    OutboxRow,
    RoomEventRow,
    RoomRow,
    SocketTicketRow,
)
from .fairness import CryptoService, b64url_encode, canonical_json
from .protocol import RULES_VERSION, AuditPackage


class StorageConflict(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MemberRecord:
    id: str
    room_id: str
    guest_hash: str
    nickname: str
    seat: int


@dataclass(frozen=True, slots=True)
class SocketPrincipal:
    room_id: str
    member_id: str


def utc_now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class RoomRepository:
    def __init__(self, database: Database, crypto: CryptoService) -> None:
        self.database = database
        self.crypto = crypto

    async def create_room(self, snapshot: dict[str, Any], member: MemberRecord) -> None:
        room = RoomRow(
            id=snapshot["id"],
            code=snapshot["code"],
            phase=snapshot["phase"],
            version=snapshot["version"],
            snapshot=snapshot,
            last_event_hash="0" * 64,
        )
        row = MemberRow(
            id=member.id,
            room_id=member.room_id,
            guest_hash=member.guest_hash,
            nickname=member.nickname,
            seat=member.seat,
        )
        async with self.database.sessions() as session, session.begin():
            session.add(room)
            await session.flush()
            session.add(row)

    async def find_room_id_by_code(self, code: str) -> str | None:
        async with self.database.sessions() as session:
            return await session.scalar(select(RoomRow.id).where(RoomRow.code == code))

    async def room_exists(self, room_id: str) -> bool:
        async with self.database.sessions() as session:
            return await session.scalar(select(RoomRow.id).where(RoomRow.id == room_id)) is not None

    async def find_member_by_guest(self, room_id: str, guest_hash: str) -> MemberRecord | None:
        async with self.database.sessions() as session:
            row = await session.scalar(
                select(MemberRow).where(
                    MemberRow.room_id == room_id,
                    MemberRow.guest_hash == guest_hash,
                )
            )
        if row is None:
            return None
        return MemberRecord(row.id, row.room_id, row.guest_hash, row.nickname, row.seat)

    async def get_member(self, room_id: str, member_id: str) -> MemberRecord | None:
        async with self.database.sessions() as session:
            row = await session.scalar(
                select(MemberRow).where(MemberRow.room_id == room_id, MemberRow.id == member_id)
            )
        if row is None:
            return None
        return MemberRecord(row.id, row.room_id, row.guest_hash, row.nickname, row.seat)

    async def load_room(self, room_id: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        async with self.database.sessions() as session:
            room = await session.get(RoomRow, room_id)
            if room is None:
                raise KeyError(room_id)
            rows = (
                await session.scalars(
                    select(AuditSecretRow)
                    .where(AuditSecretRow.room_id == room_id)
                    .order_by(AuditSecretRow.hand_number)
                )
            ).all()
        materials = {
            row.hand_id: self.crypto.decrypt_json(
                row.nonce, row.ciphertext, f"{room_id}:{row.hand_id}"
            )
            for row in rows
        }
        return dict(room.snapshot), materials

    async def get_command_result(
        self, room_id: str, command_id: str
    ) -> tuple[str, dict[str, Any]] | None:
        async with self.database.sessions() as session:
            row = await session.get(CommandResultRow, (room_id, command_id))
        if row is None:
            return None
        return row.member_id, dict(row.result)

    async def save_rejection(
        self,
        room_id: str,
        member_id: str,
        command_id: str,
        result: dict[str, Any],
    ) -> None:
        async with self.database.sessions() as session, session.begin():
            if await session.get(CommandResultRow, (room_id, command_id)) is None:
                session.add(
                    CommandResultRow(
                        room_id=room_id,
                        command_id=command_id,
                        member_id=member_id,
                        result=result,
                    )
                )

    async def persist_transition(
        self,
        *,
        room_id: str,
        expected_version: int,
        snapshot: dict[str, Any],
        events: list[dict[str, Any]],
        command_result: tuple[str, str, dict[str, Any]] | None = None,
        member_upserts: list[MemberRecord] | None = None,
        member_deletes: list[str] | None = None,
        audit_material: dict[str, Any] | None = None,
    ) -> None:
        async with self.database.sessions() as session, session.begin():
            room = await session.scalar(
                select(RoomRow).where(RoomRow.id == room_id).with_for_update()
            )
            if room is None:
                raise KeyError(room_id)
            if room.version != expected_version:
                raise StorageConflict(
                    f"room version changed from {expected_version} to {room.version}"
                )

            previous_hash = room.last_event_hash
            for event in events:
                envelope = {
                    "roomId": room_id,
                    "version": event["version"],
                    "type": event["type"],
                    "payload": event["payload"],
                    "createdAt": event["createdAt"],
                }
                prefix = bytes.fromhex(previous_hash)
                event_hash = hashlib.sha256(prefix + canonical_json(envelope)).hexdigest()
                session.add(
                    RoomEventRow(
                        room_id=room_id,
                        version=event["version"],
                        type=event["type"],
                        payload=event["payload"],
                        previous_hash=previous_hash,
                        hash=event_hash,
                        created_at=datetime.fromisoformat(event["createdAt"]),
                    )
                )
                session.add(
                    OutboxRow(
                        room_id=room_id,
                        version=event["version"],
                        event=envelope,
                    )
                )
                previous_hash = event_hash

            for member in member_upserts or []:
                existing = await session.get(MemberRow, member.id)
                if existing is None:
                    session.add(
                        MemberRow(
                            id=member.id,
                            room_id=member.room_id,
                            guest_hash=member.guest_hash,
                            nickname=member.nickname,
                            seat=member.seat,
                        )
                    )
                else:
                    existing.nickname = member.nickname
                    existing.seat = member.seat
            if member_deletes:
                await session.execute(delete(MemberRow).where(MemberRow.id.in_(member_deletes)))

            if audit_material is not None:
                hand_id = audit_material["handId"]
                nonce, ciphertext = self.crypto.encrypt_json(audit_material, f"{room_id}:{hand_id}")
                audit_row = await session.get(AuditSecretRow, (room_id, hand_id))
                if audit_row is None:
                    session.add(
                        AuditSecretRow(
                            room_id=room_id,
                            hand_id=hand_id,
                            hand_number=audit_material["handNumber"],
                            nonce=nonce,
                            ciphertext=ciphertext,
                        )
                    )
                else:
                    audit_row.nonce = nonce
                    audit_row.ciphertext = ciphertext

            if command_result is not None:
                member_id, command_id, result = command_result
                session.add(
                    CommandResultRow(
                        room_id=room_id,
                        command_id=command_id,
                        member_id=member_id,
                        result=result,
                    )
                )

            room.phase = snapshot["phase"]
            room.version = snapshot["version"]
            room.snapshot = snapshot
            room.last_event_hash = previous_hash
            room.updated_at = utc_now()
            if snapshot["phase"] == "closed" and room.closed_at is None:
                room.closed_at = utc_now()

    async def mark_events_published(self, room_id: str, versions: list[int]) -> None:
        if not versions:
            return
        async with self.database.sessions() as session, session.begin():
            await session.execute(
                update(OutboxRow)
                .where(OutboxRow.room_id == room_id, OutboxRow.version.in_(versions))
                .values(published_at=utc_now())
            )

    async def issue_socket_ticket(
        self, room_id: str, member_id: str, ttl_seconds: int
    ) -> tuple[str, datetime]:
        token = b64url_encode(secrets.token_bytes(32))
        expires_at = utc_now() + timedelta(seconds=ttl_seconds)
        async with self.database.sessions() as session, session.begin():
            session.add(
                SocketTicketRow(
                    token_hash=self.crypto.token_hash(token),
                    room_id=room_id,
                    member_id=member_id,
                    expires_at=expires_at,
                )
            )
        return token, expires_at

    async def consume_socket_ticket(self, token: str) -> SocketPrincipal | None:
        token_hash = self.crypto.token_hash(token)
        now = utc_now()
        async with self.database.sessions() as session, session.begin():
            row = await session.scalar(
                select(SocketTicketRow)
                .where(SocketTicketRow.token_hash == token_hash)
                .with_for_update()
            )
            if row is None or row.consumed_at is not None or _aware(row.expires_at) <= now:
                return None
            row.consumed_at = now
            return SocketPrincipal(row.room_id, row.member_id)

    async def finalize_audit(self, room_id: str) -> dict[str, Any]:
        async with self.database.sessions() as session:
            room = await session.get(RoomRow, room_id)
            if room is None:
                raise KeyError(room_id)
            if room.phase != "closed" or room.closed_at is None:
                raise ValueError("audit is available only after room closure")
            if room.audit_nonce is not None and room.audit_ciphertext is not None:
                return self.crypto.decrypt_json(
                    room.audit_nonce, room.audit_ciphertext, f"{room_id}:final-audit"
                )
            event_rows = (
                await session.scalars(
                    select(RoomEventRow)
                    .where(RoomEventRow.room_id == room_id)
                    .order_by(RoomEventRow.version)
                )
            ).all()
            secret_rows = (
                await session.scalars(
                    select(AuditSecretRow)
                    .where(AuditSecretRow.room_id == room_id)
                    .order_by(AuditSecretRow.hand_number)
                )
            ).all()

        materials = [
            self.crypto.decrypt_json(row.nonce, row.ciphertext, f"{room_id}:{row.hand_id}")
            for row in secret_rows
        ]
        hands = [hand for hand in materials if len(hand.get("deck", [])) == 52]
        unsigned = {
            "schemaVersion": "1.0",
            "rulesVersion": RULES_VERSION,
            "roomId": room_id,
            "roomCode": room.code,
            "closedAt": _aware(room.closed_at).isoformat(),
            "finalEventHash": room.last_event_hash,
            "events": [
                {
                    "version": row.version,
                    "type": row.type,
                    "payload": row.payload,
                    "createdAt": _aware(row.created_at).isoformat(),
                    "previousHash": row.previous_hash,
                    "hash": row.hash,
                }
                for row in event_rows
            ],
            "hands": [
                {
                    "handId": hand["handId"],
                    "handNumber": hand["handNumber"],
                    "serverSeed": hand["serverSeed"],
                    "serverCommitment": hand["serverCommitment"],
                    "contributions": hand["contributions"],
                    "deck": hand.get("deck", []),
                    "leafSalts": hand.get("leafSalts", []),
                    "merkleRoot": hand.get("merkleRoot", ""),
                }
                for hand in hands
            ],
            "signatureAlgorithm": "Ed25519",
            "signingPublicKey": self.crypto.signing_public_key,
        }
        normalized = AuditPackage.model_validate({**unsigned, "signature": ""}).model_dump(
            mode="json", by_alias=True
        )
        normalized.pop("signature")
        package = {**normalized, "signature": self.crypto.sign(normalized)}
        validated = AuditPackage.model_validate(package).model_dump(mode="json", by_alias=True)
        nonce, ciphertext = self.crypto.encrypt_json(validated, f"{room_id}:final-audit")
        async with self.database.sessions() as session, session.begin():
            stored_room = await session.scalar(
                select(RoomRow).where(RoomRow.id == room_id).with_for_update()
            )
            if stored_room is None:
                raise KeyError(room_id)
            stored_room.audit_nonce = nonce
            stored_room.audit_ciphertext = ciphertext
        return validated

    async def get_audit(self, room_id: str) -> dict[str, Any]:
        return await self.finalize_audit(room_id)

    async def open_room_ids(self) -> list[str]:
        async with self.database.sessions() as session:
            return list(await session.scalars(select(RoomRow.id).where(RoomRow.phase != "closed")))

    async def purge_expired_tickets(self) -> None:
        async with self.database.sessions() as session, session.begin():
            await session.execute(
                delete(SocketTicketRow).where(SocketTicketRow.expires_at < utc_now())
            )

    async def purge_expired_rooms(self, retention_seconds: int) -> int:
        cutoff = utc_now() - timedelta(seconds=retention_seconds)
        async with self.database.sessions() as session, session.begin():
            result = await session.execute(
                delete(RoomRow).where(RoomRow.closed_at.is_not(None), RoomRow.closed_at <= cutoff)
            )
        return result.rowcount or 0
