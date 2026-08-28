from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.db import Database
from app.domain import DomainError, RoomGame, parse_command
from app.fairness import CryptoService
from app.manager import RoomManager
from app.protocol import RoomConfig
from app.repository import RoomRepository


def _settings(database_path: Path) -> Settings:
    secret = base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")
    return Settings(
        APP_ENV="test",
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        APP_SECRET_KEY=secret,
        ALLOWED_ORIGINS="http://localhost:5173",
        COOKIE_SECURE=False,
        AUTO_CREATE_SCHEMA=True,
    )


def _command(
    actor_version: int,
    room_id: str,
    command_id: str,
    command_type: str,
    *,
    hand_id: str | None = None,
    turn_id: str | None = None,
    payload: dict[str, Any] | None = None,
    expected_version: int | None = None,
):
    return parse_command(
        {
            "commandId": command_id,
            "roomId": room_id,
            "handId": hand_id,
            "turnId": turn_id,
            "expectedVersion": actor_version if expected_version is None else expected_version,
            "type": command_type,
            "payload": payload or {},
        }
    )


@pytest.mark.asyncio
async def test_room_flow_idempotency_private_projection_recovery_and_audit(tmp_path: Path) -> None:
    settings = _settings(tmp_path / "poker.db")
    database = Database(settings)
    await database.start()
    repository = RoomRepository(database, CryptoService(settings.secret_bytes))
    manager = RoomManager(repository, settings)
    emitted: list[tuple[str, dict[str, Any], str]] = []

    async def emit(event: str, data: dict[str, Any], sid: str) -> None:
        emitted.append((event, data, sid))

    manager.set_emitter(emit)
    try:
        host_hash = repository.crypto.token_hash("host-token")
        guest_hash = repository.crypto.token_hash("guest-token")
        room_id, code, host_id = await manager.create_room("Host", RoomConfig(), host_hash)
        _, _, guest_id = await manager.join_room(code, "Guest", guest_hash)
        actor = await manager.get_actor(room_id)
        await actor.set_connection(host_id, True)
        await actor.set_connection(guest_id, True)

        command = _command(
            actor.room.version,
            room_id,
            "ready-guest-0001",
            "ready",
            payload={"ready": True},
        )
        assert (await actor.command(guest_id, command))["status"] == "accepted"

        start = _command(actor.room.version, room_id, "start-0001", "start")
        assert (await actor.command(host_id, start))["status"] == "accepted"
        hand = actor.room.data["hand"]
        assert actor.room.data["players"][host_id]["ready"] is True
        assert host_id in hand["memberOrder"]
        common_version = actor.room.version
        contribution_ids = {}
        for index, member_id in enumerate(hand["requiredMemberIds"]):
            command_id = f"entropy-{index:02d}"
            contribution_ids[member_id] = command_id
            command = _command(
                common_version,
                room_id,
                command_id,
                "contribute_randomness",
                hand_id=hand["id"],
                turn_id=hand["turnId"],
                payload={"contribution": (bytes([index + 1]) * 32).hex()},
                expected_version=common_version,
            )
            assert (await actor.command(member_id, command))["status"] == "accepted"
            if index == 0:
                assert actor.projection(member_id)["fairness"]["contributionRequired"] is False
                waiting_member = hand["requiredMemberIds"][1]
                assert actor.projection(waiting_member)["fairness"]["contributionRequired"] is True

        assert actor.room.data["phase"] == "playing"
        host_snapshot = actor.projection(host_id)
        guest_snapshot = actor.projection(guest_id)
        host_view = next(
            player for player in host_snapshot["players"] if player["memberId"] == host_id
        )
        other_in_host = next(
            player for player in host_snapshot["players"] if player["memberId"] == guest_id
        )
        guest_view = next(
            player for player in guest_snapshot["players"] if player["memberId"] == guest_id
        )
        assert len(host_view["holeCards"]) == len(guest_view["holeCards"]) == 2
        assert "holeCards" not in other_in_host

        late_hash = repository.crypto.token_hash("late-token")
        _, _, late_id = await manager.join_room(code, "Late", late_hash)
        await actor.set_connection(late_id, True)
        assert actor.room.data["players"][late_id]["eligibleHand"] == 2
        assert actor.room.data["players"][late_id]["ready"] is True
        assert late_id not in actor.room.data["hand"]["memberOrder"]
        assert actor.projection(late_id)["fairness"]["contributionRequired"] is False

        first_member = hand["requiredMemberIds"][0]
        duplicate = _command(
            common_version,
            room_id,
            contribution_ids[first_member],
            "contribute_randomness",
            hand_id=hand["id"],
            turn_id=hand["turnId"],
            payload={"contribution": (bytes([1]) * 32).hex()},
            expected_version=common_version,
        )
        duplicate_result = await actor.command(first_member, duplicate)
        assert duplicate_result["status"] == "accepted"
        assert duplicate_result["appliedVersion"] < actor.room.version

        recovered_snapshot, recovered_materials = await repository.load_room(room_id)
        recovered = actor.room.__class__(recovered_snapshot, recovered_materials, settings)
        assert recovered.projection(host_id)["hand"] == actor.projection(host_id)["hand"]

        while actor.room.data["phase"] == "playing":
            active = actor.room.adapter.actor_member_id
            snapshot = actor.projection(active)
            legal = snapshot["hand"]["legalActions"]
            action = "check" if legal["canCheck"] else "call"
            command = _command(
                actor.room.version,
                room_id,
                f"action-{actor.room.version:08d}",
                action,
                hand_id=actor.room.data["hand"]["id"],
                turn_id=actor.room.data["hand"]["turnId"],
            )
            assert (await actor.command(active, command))["status"] == "accepted"

        assert actor.room.data["phase"] == "settlement"
        assert sum(player["stack"] for player in actor.room.data["players"].values()) == 6000
        settled_snapshot = actor.projection(host_id)
        assert len(settled_snapshot["completedHands"]) == 1
        completed_hand = settled_snapshot["completedHands"][0]
        assert completed_hand["handNumber"] == 1
        assert len(completed_hand["players"]) == 2
        assert sum(result["delta"] for result in completed_hand["players"]) == 0
        assert all(len(result["holeCards"]) == 2 for result in completed_hand["players"])
        assert any(entry["type"] == "HandSettled" for entry in settled_snapshot["roomLogs"])

        actor.room.data["players"][late_id]["stack"] = 10
        assert late_id not in actor.room._eligible_players(actor.room.data["handNumber"] + 1)
        rebuy = _command(actor.room.version, room_id, "rebuy-0001", "request_rebuy")
        assert (await actor.command(late_id, rebuy))["status"] == "accepted"
        late_player = actor.room.data["players"][late_id]
        assert late_player["stack"] == actor.room.data["config"]["initialStack"] + 10
        assert late_player["borrowedTotal"] == actor.room.data["config"]["initialStack"]
        assert late_player["rebuyPending"] is False
        assert late_player["sittingOut"] is False
        assert late_player["eligibleHand"] == 2
        late_projection = next(
            player
            for player in actor.projection(late_id)["players"]
            if player["memberId"] == late_id
        )
        assert late_projection["rankingScore"] == 10

        next_hand = actor.room.clone()
        settlement_deadline = datetime.fromisoformat(next_hand.data["hand"]["deadlineAt"])
        next_hand.housekeeping(settlement_deadline + timedelta(milliseconds=1))
        assert next_hand.data["phase"] == "collecting_entropy"
        assert late_id in next_hand.data["hand"]["requiredMemberIds"]
        close = _command(actor.room.version, room_id, "close-0001", "close")
        assert (await actor.command(host_id, close))["status"] == "accepted"
        package = await repository.get_audit(room_id)
        unsigned = {key: value for key, value in package.items() if key != "signature"}
        repository.crypto.verify_signature(unsigned, package["signature"])
        assert package["events"][0]["previousHash"] == "0" * 64
        assert len(package["hands"][0]["deck"]) == 52
        assert emitted == []
    finally:
        await manager.stop()
        await database.stop()


def test_ten_player_room_uses_ten_seat_button_rotation(tmp_path: Path) -> None:
    room = RoomGame.create(
        room_id="room-ten",
        code="ABCDEFGH",
        member_id="player-0",
        nickname="Player 0",
        config=RoomConfig(max_players=10),
        settings=_settings(tmp_path / "ten-player.db"),
    )
    for index in range(1, 10):
        room.add_member(
            member_id=f"player-{index}",
            guest_hash=f"hash-{index}",
            nickname=f"Player {index}",
        )
    for player in room.data["players"].values():
        player["ready"] = True
        player["online"] = True

    participants = list(room.data["players"].values())
    room._begin_shuffle(datetime.now(UTC))

    assert room.data["hand"]["buttonSeat"] == 0
    expected_order = [f"player-{index}" for index in range(1, 10)] + ["player-0"]
    assert room.data["hand"]["memberOrder"] == expected_order
    room.data["lastButtonSeat"] = 9
    assert room._next_button(participants) == 0
    with pytest.raises(DomainError, match="open seats"):
        room.add_member(
            member_id="player-10",
            guest_hash="hash-10",
            nickname="Player 10",
        )


def test_next_hand_requires_stacks_strictly_above_big_blind(tmp_path: Path) -> None:
    room = RoomGame.create(
        room_id="room-threshold",
        code="THRESHOLD",
        member_id="player-0",
        nickname="Player 0",
        config=RoomConfig(max_players=2),
        settings=_settings(tmp_path / "threshold.db"),
    )
    room.add_member(member_id="player-1", guest_hash="hash-1", nickname="Player 1")
    for player in room.data["players"].values():
        player["ready"] = True
        player["online"] = True

    room.data["players"]["player-0"]["stack"] = 20
    room.data["players"]["player-1"]["stack"] = 21
    assert [player["id"] for player in room._eligible_players(1)] == ["player-1"]

    room.data["players"]["player-1"]["stack"] = 20
    assert room._eligible_players(1) == []

    now = datetime.now(UTC)
    room._append_room_log(
        "PlayerActed",
        {"memberId": "player-0", "action": "call", "streetBet": 20, "committed": 20},
        now,
    )
    room._append_room_log(
        "PlayerActed",
        {"memberId": "player-1", "action": "raiseTo", "streetBet": 60, "committed": 80},
        now,
    )
    assert room.data["roomLogs"][-2]["message"] == "Player 0 跟注至20 · 合计20"
    assert room.data["roomLogs"][-1]["message"] == "Player 1 加注至60 · 合计80"
