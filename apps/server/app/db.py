from __future__ import annotations

from datetime import datetime
from time import perf_counter
from typing import Any, ClassVar

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    event,
    func,
    text,
)
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import Settings
from .metrics import MetricsRegistry


class Base(DeclarativeBase):
    type_annotation_map: ClassVar[dict[Any, Any]] = {
        dict[str, Any]: JSON,
        list[dict[str, Any]]: JSON,
    }


class RoomRow(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    phase: Mapped[str] = mapped_column(String(32), index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    last_event_hash: Mapped[str] = mapped_column(String(64), default="0" * 64)
    audit_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    audit_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MemberRow(Base):
    __tablename__ = "room_members"
    __table_args__ = (
        UniqueConstraint("room_id", "guest_hash", name="uq_room_member_guest"),
        UniqueConstraint("room_id", "seat", name="uq_room_member_seat"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    guest_hash: Mapped[str] = mapped_column(String(64), index=True)
    nickname: Mapped[str] = mapped_column(String(20))
    seat: Mapped[int] = mapped_column(Integer)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoomEventRow(Base):
    __tablename__ = "room_events"
    __table_args__ = (UniqueConstraint("room_id", "version", name="uq_room_event_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    previous_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CommandResultRow(Base):
    __tablename__ = "command_results"

    room_id: Mapped[str] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True
    )
    command_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    member_id: Mapped[str] = mapped_column(String(36))
    result: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OutboxRow(Base):
    __tablename__ = "outbox"
    __table_args__ = (Index("ix_outbox_unpublished", "published_at", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    event: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SocketTicketRow(Base):
    __tablename__ = "socket_tickets"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str] = mapped_column(
        ForeignKey("room_members.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditSecretRow(Base):
    __tablename__ = "audit_secrets"
    __table_args__ = (UniqueConstraint("room_id", "hand_number", name="uq_audit_hand_number"),)

    room_id: Mapped[str] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True
    )
    hand_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    hand_number: Mapped[int] = mapped_column(Integer)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Database:
    def __init__(self, settings: Settings, metrics: MetricsRegistry | None = None) -> None:
        settings.ensure_local_directories()
        self.metrics = metrics or MetricsRegistry()
        self.engine: AsyncEngine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
        )
        event.listen(
            self.engine.sync_engine,
            "before_cursor_execute",
            self._before_cursor_execute,
        )
        event.listen(
            self.engine.sync_engine,
            "after_cursor_execute",
            self._after_cursor_execute,
        )
        event.listen(self.engine.sync_engine, "handle_error", self._handle_database_error)
        if settings.database_url.startswith("sqlite+"):
            event.listen(
                self.engine.sync_engine,
                "connect",
                lambda connection, _record: connection.execute("PRAGMA foreign_keys=ON"),
            )
        self.sessions = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self._auto_create_schema = settings.auto_create_schema

    @staticmethod
    def _database_operation(statement: Any) -> str:
        token = str(statement).lstrip().split(None, 1)[0].lower() if statement else ""
        if token == "select" or token == "pragma" or token == "with":
            return "read"
        if token in {"insert", "update", "delete", "merge"}:
            return "write"
        if token in {"create", "alter", "drop", "truncate"}:
            return "schema"
        return "other"

    def _before_cursor_execute(
        self,
        _connection: Any,
        _cursor: Any,
        _statement: Any,
        _parameters: Any,
        context: Any,
        _executemany: bool,
    ) -> None:
        context._holdem_started_at = perf_counter()

    def _after_cursor_execute(
        self,
        _connection: Any,
        _cursor: Any,
        statement: Any,
        _parameters: Any,
        context: Any,
        _executemany: bool,
    ) -> None:
        started = getattr(context, "_holdem_started_at", None)
        if isinstance(started, float):
            self.metrics.observe_database_latency(
                self._database_operation(statement), perf_counter() - started, "success"
            )

    def _handle_database_error(self, exception_context: Any) -> None:
        context = exception_context.execution_context
        started = getattr(context, "_holdem_started_at", None)
        if isinstance(started, float):
            self.metrics.observe_database_latency(
                self._database_operation(exception_context.statement),
                perf_counter() - started,
                "error",
            )

    async def start(self) -> None:
        if self._auto_create_schema:
            async with self.engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)

    async def stop(self) -> None:
        await self.engine.dispose()

    async def ready(self) -> bool:
        try:
            async with self.sessions() as session:
                await session.execute(text("SELECT 1"))
            return True
        except Exception:
            return False
