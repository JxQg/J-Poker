"""Create authoritative room storage.

Revision ID: 0001_initial
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rooms",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(8), nullable=False),
        sa.Column("phase", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("last_event_hash", sa.String(64), nullable=False),
        sa.Column("audit_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("audit_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_rooms_code", "rooms", ["code"], unique=True)
    op.create_index("ix_rooms_phase", "rooms", ["phase"])
    op.create_table(
        "room_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("guest_hash", sa.String(64), nullable=False),
        sa.Column("nickname", sa.String(20), nullable=False),
        sa.Column("seat", sa.Integer(), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("room_id", "guest_hash", name="uq_room_member_guest"),
        sa.UniqueConstraint("room_id", "seat", name="uq_room_member_seat"),
    )
    op.create_index("ix_room_members_room_id", "room_members", ["room_id"])
    op.create_index("ix_room_members_guest_hash", "room_members", ["guest_hash"])
    op.create_table(
        "room_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("previous_hash", sa.String(64), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("room_id", "version", name="uq_room_event_version"),
    )
    op.create_index("ix_room_events_room_id", "room_events", ["room_id"])
    op.create_table(
        "command_results",
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("command_id", sa.String(64), nullable=False),
        sa.Column("member_id", sa.String(36), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("room_id", "command_id"),
    )
    op.create_table(
        "outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("event", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_outbox_room_id", "outbox", ["room_id"])
    op.create_index("ix_outbox_unpublished", "outbox", ["published_at", "id"])
    op.create_table(
        "socket_tickets",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("member_id", sa.String(36), sa.ForeignKey("room_members.id", ondelete="CASCADE")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_socket_tickets_room_id", "socket_tickets", ["room_id"])
    op.create_index("ix_socket_tickets_member_id", "socket_tickets", ["member_id"])
    op.create_index("ix_socket_tickets_expires_at", "socket_tickets", ["expires_at"])
    op.create_table(
        "audit_secrets",
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id", ondelete="CASCADE")),
        sa.Column("hand_id", sa.String(36), nullable=False),
        sa.Column("hand_number", sa.Integer(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("room_id", "hand_id"),
        sa.UniqueConstraint("room_id", "hand_number", name="uq_audit_hand_number"),
    )


def downgrade() -> None:
    op.drop_table("audit_secrets")
    op.drop_table("socket_tickets")
    op.drop_table("outbox")
    op.drop_table("command_results")
    op.drop_table("room_events")
    op.drop_table("room_members")
    op.drop_table("rooms")
