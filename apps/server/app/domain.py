from __future__ import annotations

import copy
import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from .config import Settings
from .fairness import (
    b64url_decode,
    b64url_encode,
    card_view,
    create_shuffle,
    server_seed_commitment,
)
from .pokerkit_adapter import PokerKitAdapter, PokerRuleError
from .protocol import (
    ROOM_COMMAND_ADAPTER,
    RULES_VERSION,
    CommandAccepted,
    CommandRejected,
    ErrorCode,
    RoomCommand,
    RoomConfig,
    RoomSnapshot,
)
from .repository import MemberRecord

_MAX_COMPLETED_HANDS = 20
_MAX_ROOM_LOGS = 80


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


class DomainError(ValueError):
    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class RoomGame:
    def __init__(
        self,
        data: dict[str, Any],
        materials: dict[str, dict[str, Any]],
        settings: Settings,
    ) -> None:
        self.data = data
        self.materials = materials
        self.settings = settings
        self.events: list[dict[str, Any]] = []
        self.member_upserts: list[MemberRecord] = []
        self.member_deletes: list[str] = []
        self.dirty_audit_hand_id: str | None = None
        self.adapter: PokerKitAdapter | None = None
        # Older snapshots predate these state fields.
        for player in self.data.get("players", {}).values():
            player.setdefault("managed", False)
            player.setdefault("leavePending", False)
            player.setdefault("settlementReady", False)
        self._restore_adapter()

    @classmethod
    def create(
        cls,
        *,
        room_id: str,
        code: str,
        member_id: str,
        nickname: str,
        config: RoomConfig,
        settings: Settings,
    ) -> RoomGame:
        now = _now()
        data: dict[str, Any] = {
            "id": room_id,
            "code": code,
            "version": 0,
            "phase": "lobby",
            "resumePhase": None,
            "config": config.model_dump(mode="json", by_alias=True),
            "hostMemberId": member_id,
            "players": {
                member_id: {
                    "id": member_id,
                    "nickname": nickname,
                    "seat": 0,
                    "stack": config.initial_stack,
                    "ready": False,
                    "online": False,
                    "sittingOut": False,
                    "sitOutNext": False,
                    "rebuyPending": False,
                    "managed": False,
                    "leavePending": False,
                    "settlementReady": False,
                    "borrowedTotal": 0,
                    "eligibleHand": 1,
                    "joinedAt": _iso(now),
                    "lastSeenAt": _iso(now),
                }
            },
            "handNumber": 0,
            "completedHands": [],
            "roomLogs": [],
            "lastButtonSeat": None,
            "hand": None,
            "configLocked": False,
            "closePending": False,
            "createdAt": _iso(now),
            "updatedAt": _iso(now),
            "noConnectedSince": _iso(now),
            "closedAt": None,
        }
        return cls(data, {}, settings)

    def clone(self) -> RoomGame:
        return RoomGame(copy.deepcopy(self.data), copy.deepcopy(self.materials), self.settings)

    def to_storage(self) -> dict[str, Any]:
        return copy.deepcopy(self.data)

    @property
    def room_id(self) -> str:
        return self.data["id"]

    @property
    def version(self) -> int:
        return self.data["version"]

    @property
    def current_audit_material(self) -> dict[str, Any] | None:
        if self.dirty_audit_hand_id is None:
            return None
        return self.materials[self.dirty_audit_hand_id]

    def _restore_adapter(self) -> None:
        hand = self.data.get("hand")
        if hand is None or hand["status"] not in {"playing", "settlement"}:
            return
        material = self.materials.get(hand["id"])
        if material is None or not material.get("deck"):
            raise ValueError(f"encrypted audit material is missing for hand {hand['id']}")
        config = self.data["config"]
        if len(hand.get("memberOrder", [])) < 2 or any(
            int(stack) <= int(config["bigBlind"]) for stack in hand.get("startingStacks", [])
        ):
            self.data["phase"] = "lobby"
            self.data["hand"] = None
            return
        self.adapter = PokerKitAdapter(
            hand["memberOrder"],
            hand["startingStacks"],
            config["smallBlind"],
            config["bigBlind"],
            material["deck"],
            hand["actionLog"],
        )

    def _emit(self, event_type: str, payload: dict[str, Any], now: datetime) -> None:
        self.data["version"] += 1
        self.data["updatedAt"] = _iso(now)
        self.events.append(
            {
                "roomId": self.room_id,
                "version": self.version,
                "type": event_type,
                "payload": payload,
                "createdAt": _iso(now),
            }
        )
        self._append_room_log(event_type, payload, now)

    def _append_room_log(self, event_type: str, payload: dict[str, Any], now: datetime) -> None:
        member_id = payload.get("memberId")
        player = self.data["players"].get(member_id) if isinstance(member_id, str) else None
        nickname = player["nickname"] if player is not None else "玩家"
        action_labels = {
            "fold": "弃牌",
            "check": "过牌",
            "call": "跟注",
            "raiseTo": "加注",
        }
        message: str | None = None
        if event_type == "PlayerJoined":
            message = f"{payload['nickname']} 加入了牌桌"
        elif event_type == "PlayerReadyChanged":
            message = f"{nickname}{' 已准备' if payload['ready'] else ' 取消了准备'}"
        elif event_type == "HandStarted":
            message = f"第 {payload['handNumber']} 手开始"
        elif event_type == "PlayerActed":
            action = action_labels.get(payload["action"], payload["action"])
            street_bet = payload.get("streetBet")
            committed = payload.get("committed")
            if action in {"跟注", "加注"} and street_bet is not None and committed is not None:
                message = f"{nickname} {action}至{street_bet} · 合计{committed}"
            else:
                message = f"{nickname} {action}"
        elif event_type == "PlayerActionTimedOut":
            action = action_labels.get(payload["action"], payload["action"])
            street_bet = payload.get("streetBet")
            committed = payload.get("committed")
            if action in {"跟注", "加注"} and street_bet is not None and committed is not None:
                message = f"{nickname} 超时自动{action}至{street_bet} · 合计{committed}"
            else:
                message = f"{nickname} 超时自动{action}"
        elif event_type == "HandSettled":
            message = f"第 {payload['handNumber']} 手结算完成"
        elif event_type == "RebuyIssued":
            message = f"{nickname} 申请补充 {payload['amount']} 积分 · 下一手恢复入座"
        elif event_type == "PlayerReturned":
            message = f"{nickname} 下一手恢复入座"
        elif event_type == "RoomPauseChanged":
            message = "房主暂停了牌桌" if payload["paused"] else "牌桌已恢复"
        if message is None:
            return
        logs = self.data.setdefault("roomLogs", [])
        logs.append(
            {
                "id": f"log-{self.version}",
                "type": event_type,
                "message": message,
                "createdAt": _iso(now),
                "handId": payload.get("handId"),
            }
        )
        del logs[:-_MAX_ROOM_LOGS]

    def _player(self, member_id: str) -> dict[str, Any]:
        try:
            return self.data["players"][member_id]
        except KeyError as exc:
            raise DomainError(ErrorCode.NOT_MEMBER, "player is not a room member") from exc

    def _require_host(self, member_id: str) -> None:
        if self.data["hostMemberId"] != member_id:
            raise DomainError(ErrorCode.NOT_HOST, "only the room host may do that")

    def _require_open(self) -> None:
        if self.data["phase"] == "closed":
            raise DomainError(ErrorCode.ROOM_CLOSED, "room is closed")

    def add_member(
        self, *, member_id: str, guest_hash: str, nickname: str, now: datetime | None = None
    ) -> MemberRecord:
        now = now or _now()
        self._require_open()
        if len(self.data["players"]) >= self.data["config"]["maxPlayers"]:
            raise DomainError(ErrorCode.ROOM_FULL, "room has no open seats")
        used = {player["seat"] for player in self.data["players"].values()}
        seat = next(
            index for index in range(self.data["config"]["maxPlayers"]) if index not in used
        )
        eligible_hand = self.data["handNumber"] + 1
        ready_for_next_hand = self.data["configLocked"]
        self.data["players"][member_id] = {
            "id": member_id,
            "nickname": nickname,
            "seat": seat,
            "stack": self.data["config"]["initialStack"],
            "ready": ready_for_next_hand,
            "online": False,
            "sittingOut": False,
            "sitOutNext": False,
            "rebuyPending": False,
            "managed": False,
            "leavePending": False,
            "settlementReady": False,
            "borrowedTotal": 0,
            "eligibleHand": eligible_hand,
            "joinedAt": _iso(now),
            "lastSeenAt": _iso(now),
        }
        record = MemberRecord(member_id, self.room_id, guest_hash, nickname, seat)
        self.member_upserts.append(record)
        self._emit(
            "PlayerJoined",
            {
                "memberId": member_id,
                "nickname": nickname,
                "seat": seat,
                "ready": ready_for_next_hand,
            },
            now,
        )
        return record

    def apply_command(
        self, member_id: str, command_value: RoomCommand, now: datetime | None = None
    ) -> CommandAccepted:
        now = now or _now()
        self._require_open()
        self._player(member_id)
        command_type, payload = self._normalize_command(command_value)
        is_entropy = command_type == "shuffle.contribute"
        if command_value.expected_version != self.version and not (
            is_entropy and command_value.expected_version <= self.version
        ):
            raise DomainError(
                ErrorCode.STALE_VERSION,
                "expected version "
                f"{command_value.expected_version}, current version is {self.version}",
            )

        if command_type == "ready":
            self._set_ready(member_id, bool(payload.get("ready", True)), now)
        elif command_type == "start":
            self._require_host(member_id)
            self._start(member_id, now)
        elif command_type == "pause":
            self._require_host(member_id)
            self._set_paused(bool(payload.get("paused", True)), now)
        elif command_type == "close":
            self._require_host(member_id)
            self._close(now)
        elif command_type == "sitOut":
            self._sit_out(member_id, bool(payload.get("sittingOut", True)), now)
        elif command_type == "request_rebuy":
            self._request_rebuy(member_id, now)
        elif command_type == "set_settlement_ready":
            self._set_settlement_ready(member_id, bool(payload.get("ready", True)), now)
        elif command_type == "leave_room":
            self._leave_room(member_id, now)
        elif command_type == "shuffle.contribute":
            self._contribute(member_id, command_value.hand_id, command_value.turn_id, payload, now)
        elif command_type in {"fold", "check", "call", "raiseTo"}:
            self._act(
                member_id,
                command_value.hand_id,
                command_value.turn_id,
                command_type,
                payload.get("amount"),
                now,
            )
        elif command_type == "update_config":
            self._require_host(member_id)
            self._update_config(payload["config"], now)
        elif command_type == "remove_player":
            self._require_host(member_id)
            self._remove_player(member_id, payload["memberId"], now)
        elif command_type == "request_snapshot":
            pass
        else:  # pragma: no cover
            raise DomainError(ErrorCode.INVALID_COMMAND, "unsupported command type")
        return CommandAccepted(command_id=command_value.command_id, applied_version=self.version)

    @staticmethod
    def _normalize_command(command: RoomCommand) -> tuple[str, dict[str, Any]]:
        command_type = command.type
        payload = command.payload.model_dump(mode="json", by_alias=True)
        aliases = {
            "set_ready": "ready",
            "start_hand": "start",
            "contribute_randomness": "shuffle.contribute",
            "pause_room": "pause",
            "resume_room": "pause",
            "close_room": "close",
        }
        normalized = aliases.get(command_type, command_type)
        if command_type == "pause_room":
            payload = {"paused": True}
        elif command_type == "resume_room":
            payload = {"paused": False}
        elif command_type == "player_action":
            normalized = {
                "fold": "fold",
                "check": "check",
                "call": "call",
                "raise_to": "raiseTo",
            }[payload["action"]]
        return normalized, payload

    def _set_ready(self, member_id: str, ready: bool, now: datetime) -> None:
        phase = self.data["phase"]
        current_members = set(self.data["hand"]["memberOrder"]) if self.data.get("hand") else set()
        is_late_joiner = member_id not in current_members
        if phase not in {"lobby", "settlement", "paused"} and not (
            phase in {"collecting_entropy", "playing"} and is_late_joiner
        ):
            raise DomainError(
                ErrorCode.INVALID_PHASE,
                "active-hand players may change readiness only between hands",
            )
        player = self._player(member_id)
        player["ready"] = ready
        self._emit("PlayerReadyChanged", {"memberId": member_id, "ready": ready}, now)

    def _update_config(self, config_value: dict[str, Any], now: datetime) -> None:
        if self.data["phase"] != "lobby" or self.data["configLocked"]:
            raise DomainError(ErrorCode.INVALID_PHASE, "room configuration is frozen")
        config = RoomConfig.model_validate(config_value)
        if len(self.data["players"]) > config.max_players:
            raise DomainError(
                ErrorCode.INVALID_AMOUNT,
                "maxPlayers is below the current member count",
            )
        self.data["config"] = config.model_dump(mode="json", by_alias=True)
        for player in self.data["players"].values():
            player["stack"] = config.initial_stack
        self._emit("RoomConfigUpdated", {"config": self.data["config"]}, now)

    def _start(self, host_id: str, now: datetime) -> None:
        if self.data["phase"] != "lobby":
            raise DomainError(ErrorCode.INVALID_PHASE, "the room is not ready to start")
        host = self._player(host_id)
        big_blind = self.data["config"]["bigBlind"]
        if (
            not host["online"]
            or host["stack"] <= big_blind
            or host["sittingOut"]
            or host.get("leavePending", False)
        ):
            raise DomainError(ErrorCode.INVALID_PHASE, "the host must join the hand to start")
        # Starting a game is the host's commitment to join the hand.
        host["ready"] = True
        self._begin_shuffle(now)

    def _eligible_players(self, hand_number: int) -> list[dict[str, Any]]:
        big_blind = self.data["config"]["bigBlind"]
        return [
            player
            for player in self.data["players"].values()
            if player["ready"]
            and player["online"]
            and player["stack"] > big_blind
            and not player["sittingOut"]
            and not player.get("leavePending", False)
            and player["eligibleHand"] <= hand_number
        ]

    def _order_left_of_button(
        self, players: list[dict[str, Any]], button_seat: int
    ) -> list[dict[str, Any]]:
        ordered = sorted(players, key=lambda player: player["seat"])
        seat_count = self.data["config"]["maxPlayers"]
        return sorted(
            ordered,
            key=lambda player: ((player["seat"] - button_seat) % seat_count or seat_count),
        )

    def _next_button(self, players: list[dict[str, Any]]) -> int:
        seats = sorted(player["seat"] for player in players)
        previous = self.data["lastButtonSeat"]
        if previous is None:
            return seats[0]
        return next((seat for seat in seats if seat > previous), seats[0])

    def _begin_shuffle(self, now: datetime) -> None:
        next_number = self.data["handNumber"] + 1
        players = self._eligible_players(next_number)
        if len(players) < 2:
            raise DomainError(
                ErrorCode.INVALID_PHASE,
                "at least two online, ready players are required",
            )
        button_seat = self._next_button(players)
        member_order = [player["id"] for player in self._order_left_of_button(players, button_seat)]
        hand_id = str(uuid.uuid4())
        server_seed = secrets.token_bytes(32)
        commitment = server_seed_commitment(server_seed, self.room_id, hand_id)
        deadline = now + timedelta(seconds=self.settings.shuffle_timeout_seconds)
        turn_id = str(uuid.uuid4())
        self.data["handNumber"] = next_number
        self.data["lastButtonSeat"] = button_seat
        self.data["configLocked"] = True
        self.data["phase"] = "collecting_entropy"
        self.data["hand"] = {
            "id": hand_id,
            "number": next_number,
            "status": "collecting_entropy",
            "buttonSeat": button_seat,
            "memberOrder": member_order,
            "requiredMemberIds": list(member_order),
            "receivedMemberIds": [],
            "serverCommitment": commitment,
            "merkleRoot": None,
            "turnId": turn_id,
            "deadlineAt": _iso(deadline),
            "startingStacks": [],
            "actionLog": [],
        }
        self.materials[hand_id] = {
            "handId": hand_id,
            "handNumber": next_number,
            "serverSeed": b64url_encode(server_seed),
            "serverCommitment": commitment,
            "contributions": {},
            "deck": [],
            "leafSalts": [],
            "proofs": [],
            "merkleRoot": "",
        }
        self.dirty_audit_hand_id = hand_id
        self._emit(
            "shuffle.commit",
            {
                "handId": hand_id,
                "handNumber": next_number,
                "serverCommitment": commitment,
                "requiredMemberIds": list(member_order),
                "deadlineAt": _iso(deadline),
                "rulesVersion": RULES_VERSION,
            },
            now,
        )

    def _decode_contribution(self, payload: dict[str, Any]) -> bytes:
        entropy = payload.get("entropy")
        contribution = payload.get("contribution")
        try:
            if entropy is not None:
                return b64url_decode(entropy, expected_length=32)
            if contribution is not None and len(contribution) == 64:
                return bytes.fromhex(contribution)
        except ValueError as exc:
            raise DomainError(ErrorCode.ENTROPY_REQUIRED, "entropy must encode 32 bytes") from exc
        raise DomainError(ErrorCode.ENTROPY_REQUIRED, "entropy must encode 32 bytes")

    def _validate_hand_turn(self, hand_id: str | None, turn_id: str | None) -> dict[str, Any]:
        hand = self.data.get("hand")
        if hand is None or hand_id != hand["id"]:
            raise DomainError(ErrorCode.STALE_HAND, "command targets a stale hand")
        if turn_id != hand["turnId"]:
            raise DomainError(ErrorCode.STALE_TURN, "command targets a stale turn")
        return hand

    def _contribute(
        self,
        member_id: str,
        hand_id: str | None,
        turn_id: str | None,
        payload: dict[str, Any],
        now: datetime,
    ) -> None:
        if self.data["phase"] != "collecting_entropy":
            raise DomainError(ErrorCode.INVALID_PHASE, "room is not collecting entropy")
        hand = self._validate_hand_turn(hand_id, turn_id)
        if member_id not in hand["requiredMemberIds"]:
            raise DomainError(ErrorCode.NOT_MEMBER, "player is not participating in this hand")
        if member_id in hand["receivedMemberIds"]:
            raise DomainError(ErrorCode.INVALID_COMMAND, "player already contributed entropy")
        entropy = self._decode_contribution(payload)
        player = self._player(member_id)
        material = self.materials[hand["id"]]
        material["contributions"][member_id] = {
            "seat": player["seat"],
            "entropy": b64url_encode(entropy),
        }
        hand["receivedMemberIds"].append(member_id)
        self.dirty_audit_hand_id = hand["id"]
        self._emit(
            "ShuffleContributionAccepted",
            {
                "handId": hand["id"],
                "memberId": member_id,
                "entropyHash": b64url_encode(hashlib.sha256(entropy).digest()),
                "received": len(hand["receivedMemberIds"]),
                "required": len(hand["requiredMemberIds"]),
            },
            now,
        )
        if set(hand["receivedMemberIds"]) == set(hand["requiredMemberIds"]):
            self._activate_hand(now)

    def _activate_hand(self, now: datetime) -> None:
        hand = self.data["hand"]
        big_blind = self.data["config"]["bigBlind"]
        invalid_members = [
            member_id
            for member_id in hand["memberOrder"]
            if self._player(member_id)["stack"] <= big_blind
        ]
        if invalid_members or len(hand["memberOrder"]) < 2:
            self.data["phase"] = "lobby"
            self.data["hand"] = None
            self.adapter = None
            self._emit(
                "HandCancelled",
                {
                    "handId": hand["id"],
                    "reason": "insufficient_stacks",
                    "memberIds": invalid_members,
                },
                now,
            )
            return
        material = self.materials[hand["id"]]
        server_seed = b64url_decode(material["serverSeed"], expected_length=32)
        contributions = [
            (
                entry["seat"],
                member_id,
                b64url_decode(entry["entropy"], expected_length=32),
            )
            for member_id, entry in material["contributions"].items()
        ]
        result = create_shuffle(
            server_seed,
            contributions,
            self.room_id,
            hand["id"],
            RULES_VERSION,
        )
        material.update(
            {
                "deck": result.deck,
                "leafSalts": [b64url_encode(salt) for salt in result.leaf_salts],
                "proofs": result.proofs,
                "merkleRoot": result.merkle_root,
            }
        )
        hand["merkleRoot"] = result.merkle_root
        hand["status"] = "playing"
        hand["startingStacks"] = [
            self._player(member_id)["stack"] for member_id in hand["memberOrder"]
        ]
        hand["actionLog"] = []
        self.adapter = PokerKitAdapter(
            hand["memberOrder"],
            hand["startingStacks"],
            self.data["config"]["smallBlind"],
            self.data["config"]["bigBlind"],
            result.deck,
        )
        self.data["phase"] = "playing"
        for member_id in hand["memberOrder"]:
            self._player(member_id)["settlementReady"] = False
        self._advance_turn(now)
        self.dirty_audit_hand_id = hand["id"]
        self._emit(
            "HandStarted",
            {
                "handId": hand["id"],
                "handNumber": hand["number"],
                "buttonSeat": hand["buttonSeat"],
                "memberIds": hand["memberOrder"],
                "merkleRoot": result.merkle_root,
            },
            now,
        )

    def _advance_turn(self, now: datetime) -> None:
        hand = self.data["hand"]
        hand["turnId"] = str(uuid.uuid4())
        if self.adapter is not None and not self.adapter.complete:
            hand["deadlineAt"] = _iso(
                now + timedelta(seconds=self.data["config"]["actionTimeoutSeconds"])
            )
            actor_id = self.adapter.actor_member_id
            if actor_id is not None and self._player(actor_id).get("leavePending", False):
                self._action_timeout(now)
        else:
            hand["deadlineAt"] = None

    def _act(
        self,
        member_id: str,
        hand_id: str | None,
        turn_id: str | None,
        action: str,
        amount: int | None,
        now: datetime,
    ) -> None:
        if self.data["phase"] != "playing" or self.adapter is None:
            raise DomainError(ErrorCode.INVALID_PHASE, "there is no active betting round")
        hand = self._validate_hand_turn(hand_id, turn_id)
        if self._player(member_id).get("leavePending", False):
            raise DomainError(ErrorCode.INVALID_COMMAND, "leaving players cannot act")
        if self.adapter.actor_member_id != member_id:
            raise DomainError(ErrorCode.NOT_YOUR_TURN, "another player must act")
        try:
            self.adapter.apply(member_id, action, amount)
        except PokerRuleError as exc:
            message = str(exc)
            code = ErrorCode.INVALID_AMOUNT if "amount" in message else ErrorCode.INVALID_ACTION
            raise DomainError(code, message) from exc
        hand["actionLog"] = copy.deepcopy(self.adapter.actions)
        self._sync_stacks()
        self._emit(
            "PlayerActed",
            {
                "handId": hand["id"],
                "memberId": member_id,
                "action": action,
                "amount": amount,
                "street": self.adapter.street,
                "streetBet": self.adapter.street_bet(member_id),
                "committed": self.adapter.committed(member_id),
            },
            now,
        )
        if self.adapter.complete:
            self._finish_hand(now)
        else:
            self._advance_turn(now)

    def _sync_stacks(self) -> None:
        if self.adapter is None:
            return
        for member_id in self.adapter.member_order:
            self._player(member_id)["stack"] = self.adapter.stack(member_id)

    def _finish_hand(self, now: datetime) -> None:
        if self.adapter is None:
            return
        self._sync_stacks()
        hand = self.data["hand"]
        hand["status"] = "settlement"
        hand["deadlineAt"] = _iso(now + timedelta(seconds=self.settings.next_hand_delay_seconds))
        hand["turnId"] = str(uuid.uuid4())
        self.data["phase"] = "settlement"
        self._record_completed_hand(now)
        self._emit(
            "HandSettled",
            {
                "handId": hand["id"],
                "handNumber": hand["number"],
                "settlement": self.adapter.settlement(),
            },
            now,
        )
        if self.data["closePending"]:
            self._close_now(now, "host_requested")

    def _record_completed_hand(self, now: datetime) -> None:
        if self.adapter is None:
            return
        hand = self.data["hand"]
        starting_stacks = dict(zip(hand["memberOrder"], hand["startingStacks"], strict=True))
        history = {
            "handId": hand["id"],
            "handNumber": hand["number"],
            "completedAt": _iso(now),
            "boardIndices": self.adapter.board_indices,
            "pot": self.adapter.total_pot,
            "players": [
                {
                    "memberId": member_id,
                    "nickname": self._player(member_id)["nickname"],
                    "seat": self._player(member_id)["seat"],
                    "holeIndices": self.adapter.hole_indices(member_id),
                    "handName": self.adapter.hand_name(member_id),
                    "delta": self.adapter.stack(member_id) - starting_stacks[member_id],
                    "folded": self.adapter.folded(member_id),
                }
                for member_id in hand["memberOrder"]
            ],
        }
        completed = self.data.setdefault("completedHands", [])
        completed.append(history)
        del completed[:-_MAX_COMPLETED_HANDS]

    def _set_paused(self, paused: bool, now: datetime) -> None:
        phase = self.data["phase"]
        if paused:
            if phase not in {"lobby", "settlement"}:
                raise DomainError(ErrorCode.INVALID_PHASE, "pause is available between hands only")
            self.data["resumePhase"] = phase
            self.data["phase"] = "paused"
        else:
            if phase != "paused":
                raise DomainError(ErrorCode.INVALID_PHASE, "room is not paused")
            self.data["phase"] = self.data["resumePhase"] or "lobby"
            self.data["resumePhase"] = None
            if self.data["phase"] == "settlement" and self.data["hand"] is not None:
                self.data["hand"]["deadlineAt"] = _iso(
                    now + timedelta(seconds=self.settings.next_hand_delay_seconds)
                )
        self._emit("RoomPauseChanged", {"paused": paused}, now)

    def _sit_out(self, member_id: str, sitting_out: bool, now: datetime) -> None:
        player = self._player(member_id)
        if self.data["phase"] == "playing" and member_id in self.data["hand"]["memberOrder"]:
            player["sitOutNext"] = sitting_out
        else:
            player["sittingOut"] = sitting_out
            player["sitOutNext"] = False
        self._emit(
            "PlayerSitOutChanged",
            {"memberId": member_id, "sittingOut": sitting_out},
            now,
        )

    def _request_rebuy(self, member_id: str, now: datetime) -> None:
        player = self._player(member_id)
        phase = self.data["phase"]
        hand = self.data.get("hand")
        current_members = set(hand["memberOrder"]) if hand is not None else set()
        between_hands = phase in {"settlement", "lobby"}
        waiting_outside_hand = (
            phase in {"playing", "collecting_entropy"} and member_id not in current_members
        )
        paused_between_hands = (
            phase == "paused"
            and self.data["resumePhase"] in {"settlement", "lobby", "playing", "collecting_entropy"}
            and member_id not in current_members
        )
        if not (between_hands or waiting_outside_hand or paused_between_hands):
            raise DomainError(
                ErrorCode.INVALID_PHASE,
                "rebuy is unavailable while you are in the hand",
            )
        if player["stack"] > self.data["config"]["bigBlind"]:
            raise DomainError(
                ErrorCode.INVALID_AMOUNT,
                "rebuy is available only at or below the big blind",
            )
        amount = self.data["config"]["initialStack"]
        player["stack"] += amount
        player["borrowedTotal"] = int(player.get("borrowedTotal", 0)) + amount
        player["ready"] = True
        player["sittingOut"] = False
        player["sitOutNext"] = False
        player["rebuyPending"] = False
        player["eligibleHand"] = self.data["handNumber"] + 1
        self._emit(
            "RebuyIssued",
            {
                "memberId": member_id,
                "amount": amount,
                "eligibleHand": player["eligibleHand"],
                "manual": True,
            },
            now,
        )
        if self.data["phase"] == "lobby" and self.data.get("hand") is None:
            next_hand = self.data["handNumber"] + 1
            if len(self._eligible_players(next_hand)) >= 2:
                self._begin_shuffle(now)

    def _set_settlement_ready(self, member_id: str, ready: bool, now: datetime) -> None:
        if (
            self.data["phase"] != "settlement"
            or self.data.get("hand") is None
            or self.adapter is None
        ):
            raise DomainError(
                ErrorCode.INVALID_PHASE, "settlement readiness is only available after a hand"
            )
        player = self._player(member_id)
        if member_id not in self.adapter.member_order or self.adapter.folded(member_id):
            raise DomainError(
                ErrorCode.INVALID_COMMAND, "folded or non-participating players cannot ready"
            )
        if player.get("leavePending", False):
            raise DomainError(ErrorCode.INVALID_COMMAND, "leaving players cannot ready")
        player["settlementReady"] = ready
        self._emit("SettlementReadyChanged", {"memberId": member_id, "ready": ready}, now)
        if self._settlement_quorum_reached():
            self._next_hand(now)

    def _settlement_quorum_reached(self) -> bool:
        if self.adapter is None:
            return False
        participants = [self._player(member_id) for member_id in self.adapter.member_order]
        required = [
            player
            for player in participants
            if not self.adapter.folded(player["id"])
            and player["online"]
            and not player.get("managed", False)
            and not player.get("leavePending", False)
        ]
        return bool(required) and all(player.get("settlementReady", False) for player in required)

    def _leave_room(self, member_id: str, now: datetime) -> None:
        player = self._player(member_id)
        phase = self.data["phase"]
        hand = self.data.get("hand")
        in_hand = hand is not None and member_id in hand.get("memberOrder", [])
        if phase in {"playing", "collecting_entropy"} and in_hand:
            assert hand is not None
            if player.get("leavePending", False):
                raise DomainError(ErrorCode.INVALID_COMMAND, "leave already requested")
            player["leavePending"] = True
            player["settlementReady"] = False
            player["ready"] = False
            self._emit("PlayerLeaveRequested", {"memberId": member_id, "handId": hand["id"]}, now)
            if (
                phase == "playing"
                and self.adapter is not None
                and self.adapter.actor_member_id == member_id
            ):
                self._action_timeout(now)
            return
        self._remove_member(member_id, now)

    def _remove_member(self, member_id: str, now: datetime) -> None:
        player = self._player(member_id)
        del self.data["players"][member_id]
        self.member_deletes.append(member_id)
        if self.data["hostMemberId"] == member_id:
            replacement = next(
                (
                    candidate
                    for candidate in sorted(
                        self.data["players"].values(),
                        key=lambda item: (not item["online"], item["joinedAt"]),
                    )
                ),
                None,
            )
            if replacement is not None:
                self.data["hostMemberId"] = replacement["id"]
                self._emit(
                    "HostTransferred",
                    {"fromMemberId": member_id, "toMemberId": replacement["id"]},
                    now,
                )
        self._emit("PlayerRemoved", {"memberId": member_id, "nickname": player["nickname"]}, now)

    def _remove_player(self, host_id: str, target_id: str, now: datetime) -> None:
        if target_id == host_id:
            raise DomainError(ErrorCode.INVALID_COMMAND, "host cannot remove themselves")
        if self.data["phase"] not in {"lobby", "settlement", "paused"}:
            raise DomainError(ErrorCode.INVALID_PHASE, "players may be removed between hands only")
        self._remove_member(target_id, now)

    def _close(self, now: datetime) -> None:
        if self.data["phase"] == "playing":
            self.data["closePending"] = True
            self._emit("RoomCloseRequested", {}, now)
            return
        self._close_now(now, "host_requested")

    def _close_now(self, now: datetime, reason: str) -> None:
        self.data["phase"] = "closed"
        self.data["closedAt"] = _iso(now)
        self.data["closePending"] = False
        if self.data.get("hand") is not None:
            self.data["hand"]["deadlineAt"] = None
        self._emit("RoomClosed", {"reason": reason}, now)

    def set_connection(self, member_id: str, online: bool, now: datetime | None = None) -> None:
        now = now or _now()
        if self.data["phase"] == "closed":
            return
        player = self._player(member_id)
        if player["online"] == online:
            return
        player["online"] = online
        player["lastSeenAt"] = _iso(now)
        if online:
            player["managed"] = False
            player["settlementReady"] = False
        elif self.data.get("hand") is not None and player["id"] in self.data["hand"].get(
            "memberOrder", []
        ):
            player["managed"] = True
            player["settlementReady"] = False
        if online:
            self.data["noConnectedSince"] = None
        elif not any(item["online"] for item in self.data["players"].values()):
            self.data["noConnectedSince"] = _iso(now)
        self._emit(
            "PlayerConnectionChanged",
            {
                "memberId": member_id,
                "online": online,
                "managed": bool(player.get("managed", False)),
            },
            now,
        )

    def housekeeping(self, now: datetime | None = None) -> None:
        now = now or _now()
        if self.data["phase"] == "closed":
            return
        phase = self.data["phase"]
        hand = self.data.get("hand")
        if phase == "collecting_entropy" and hand and _parse_time(hand["deadlineAt"]) <= now:
            self._entropy_timeout(now)
        elif phase == "playing" and hand and _parse_time(hand["deadlineAt"]) <= now:
            self._action_timeout(now)
        elif phase == "settlement" and hand and _parse_time(hand["deadlineAt"]) <= now:
            self._next_hand(now)

        if self.data["phase"] == "closed":
            return
        host = self._player(self.data["hostMemberId"])
        if (
            not host["online"]
            and _parse_time(host["lastSeenAt"])
            + timedelta(seconds=self.settings.host_transfer_seconds)
            <= now
        ):
            connected = sorted(
                (player for player in self.data["players"].values() if player["online"]),
                key=lambda player: (player["joinedAt"], player["seat"]),
            )
            if connected:
                old_host = self.data["hostMemberId"]
                self.data["hostMemberId"] = connected[0]["id"]
                self._emit(
                    "HostTransferred",
                    {"fromMemberId": old_host, "toMemberId": connected[0]["id"]},
                    now,
                )

        no_connected_since = self.data.get("noConnectedSince")
        if (
            no_connected_since
            and _parse_time(no_connected_since)
            + timedelta(seconds=self.settings.empty_room_timeout_seconds)
            <= now
        ):
            self._close_now(now, "all_players_offline")
        elif (
            self.data["handNumber"] == 0
            and _parse_time(self.data["createdAt"])
            + timedelta(seconds=self.settings.unstarted_room_timeout_seconds)
            <= now
        ):
            self._close_now(now, "unstarted_room_expired")

    def _entropy_timeout(self, now: datetime) -> None:
        hand = self.data["hand"]
        received = set(hand["receivedMemberIds"])
        missing = [
            member_id for member_id in hand["requiredMemberIds"] if member_id not in received
        ]
        self._emit(
            "ShuffleContributionTimedOut",
            {"handId": hand["id"], "missingMemberIds": missing},
            now,
        )
        if len(received) < 2:
            self.data["phase"] = "lobby"
            self.data["hand"] = None
            self.adapter = None
            self._emit("HandCancelled", {"reason": "insufficient_entropy"}, now)
            return
        participants = [self._player(member_id) for member_id in received]
        button_seat = hand["buttonSeat"]
        participant_seats = {player["seat"] for player in participants}
        if button_seat not in participant_seats:
            seats = sorted(participant_seats)
            button_seat = next((seat for seat in seats if seat > button_seat), seats[0])
        hand["buttonSeat"] = button_seat
        hand["memberOrder"] = [
            player["id"] for player in self._order_left_of_button(participants, button_seat)
        ]
        hand["requiredMemberIds"] = list(hand["memberOrder"])
        self.data["lastButtonSeat"] = button_seat
        self._activate_hand(now)

    def _action_timeout(self, now: datetime) -> None:
        if self.adapter is None or self.adapter.actor_member_id is None:
            return
        member_id = self.adapter.actor_member_id
        legal = self.adapter.legal_actions(member_id)
        action = "check" if legal.can_check else "fold"
        hand = self.data["hand"]
        self.adapter.apply(member_id, action)
        hand["actionLog"] = copy.deepcopy(self.adapter.actions)
        self._sync_stacks()
        self._emit(
            "PlayerActionTimedOut",
            {
                "handId": hand["id"],
                "memberId": member_id,
                "action": action,
                "streetBet": self.adapter.street_bet(member_id),
                "committed": self.adapter.committed(member_id),
            },
            now,
        )
        if self.adapter.complete:
            self._finish_hand(now)
        else:
            self._advance_turn(now)

    def _next_hand(self, now: datetime) -> None:
        if self.data["closePending"]:
            self._close_now(now, "host_requested")
            return
        for player in self.data["players"].values():
            if player["sitOutNext"]:
                player["sittingOut"] = True
                player["sitOutNext"] = False
        for member_id in [
            member_id
            for member_id, player in self.data["players"].items()
            if player.get("leavePending", False)
        ]:
            self._remove_member(member_id, now)
        for player in self.data["players"].values():
            player["settlementReady"] = False
        self.data["hand"] = None
        self.adapter = None
        self.data["phase"] = "lobby"
        if len(self._eligible_players(self.data["handNumber"] + 1)) >= 2:
            self._begin_shuffle(now)
        else:
            self._emit("RoomWaitingForPlayers", {}, now)

    def projection(self, member_id: str, now: datetime | None = None) -> dict[str, Any]:
        now = now or _now()
        viewer = self._player(member_id)
        hand = self.data.get("hand")
        material = self.materials.get(hand["id"]) if hand is not None else None
        adapter = self.adapter
        players: list[dict[str, Any]] = []
        for player in sorted(self.data["players"].values(), key=lambda item: item["seat"]):
            player_adapter = (
                adapter if adapter is not None and player["id"] in adapter.member_order else None
            )
            if player_adapter is not None:
                if player_adapter.folded(player["id"]):
                    status = "folded"
                elif player_adapter.all_in(player["id"]):
                    status = "all_in"
                else:
                    status = "active"
                stack = player_adapter.stack(player["id"])
                street_bet = player_adapter.street_bet(player["id"])
                committed = player_adapter.committed(player["id"])
                last_action = player_adapter.last_action(player["id"])
            else:
                status = "sitting_out" if player["sittingOut"] else "waiting"
                stack = player["stack"]
                street_bet = 0
                committed = 0
                last_action = None
            if player.get("rebuyPending"):
                stack = player["stack"]
                street_bet = 0
                committed = 0
                last_action = None
            if player.get("leavePending", False):
                status = "leaving"
            elif player.get("managed", False) and status not in {"folded", "all_in"}:
                status = "managed"
            borrowed_total = int(player.get("borrowedTotal", 0))
            hole_cards = None
            if player_adapter is not None and material is not None:
                reveal = player["id"] == member_id or (
                    player_adapter.complete and not player_adapter.folded(player["id"])
                )
                if reveal:
                    hole_cards = [
                        card_view(material, index)
                        for index in player_adapter.hole_indices(player["id"])
                    ]
            players.append(
                {
                    "memberId": player["id"],
                    "nickname": player["nickname"],
                    "seat": player["seat"],
                    "stack": stack,
                    "borrowedTotal": borrowed_total,
                    "rankingScore": stack - borrowed_total,
                    "streetBet": street_bet,
                    "committed": committed,
                    "status": status,
                    "ready": player["ready"],
                    "online": player["online"],
                    "isHost": player["id"] == self.data["hostMemberId"],
                    "rebuyPending": bool(player.get("rebuyPending", False)),
                    "settlementReady": bool(player.get("settlementReady", False)),
                    "managed": bool(player.get("managed", False)),
                    "leavePending": bool(player.get("leavePending", False)),
                    "lastAction": last_action,
                    "holeCards": hole_cards,
                }
            )

        hand_view = None
        if hand is not None:
            actor_id = adapter.actor_member_id if adapter is not None else None
            legal = adapter.legal_actions(member_id) if adapter is not None else None
            hand_view = {
                "handId": hand["id"],
                "handNumber": hand["number"],
                "buttonSeat": hand["buttonSeat"],
                "street": adapter.street if adapter is not None else "preflop",
                "board": (
                    [card_view(material, index) for index in adapter.board_indices]
                    if adapter is not None and material is not None
                    else []
                ),
                "pot": adapter.total_pot if adapter is not None else 0,
                "pots": adapter.pots() if adapter is not None else [],
                "currentBet": adapter.current_bet if adapter is not None else 0,
                "actorMemberId": actor_id,
                "actorSeat": self._player(actor_id)["seat"] if actor_id is not None else None,
                "turnId": hand["turnId"],
                "deadlineAt": hand["deadlineAt"],
                "legalActions": {
                    "canFold": legal.can_fold if legal else False,
                    "canCheck": legal.can_check if legal else False,
                    "canCall": legal.can_call if legal else False,
                    "canRaise": legal.can_raise if legal else False,
                    "canAllIn": legal.can_all_in if legal else False,
                    "callAmount": legal.call_amount if legal else 0,
                    "minRaiseTo": legal.min_raise_to if legal else None,
                    "maxRaiseTo": legal.max_raise_to if legal else None,
                },
                "settlement": adapter.settlement() if adapter is not None else None,
            }
        fairness = {
            "serverCommitment": hand["serverCommitment"] if hand else None,
            "merkleRoot": hand["merkleRoot"] if hand else None,
            "contributionsReceived": len(hand["receivedMemberIds"]) if hand else 0,
            "contributionsRequired": len(hand["requiredMemberIds"]) if hand else 0,
            "contributionRequired": bool(
                hand
                and self.data["phase"] == "collecting_entropy"
                and member_id in hand["requiredMemberIds"]
                and member_id not in hand["receivedMemberIds"]
            ),
            "auditAvailable": self.data["phase"] == "closed",
        }
        completed_hands = []
        for history in self.data.get("completedHands", []):
            history_material = self.materials.get(history["handId"])
            if history_material is None or len(history_material.get("deck", [])) != 52:
                continue
            completed_hands.append(
                {
                    "handId": history["handId"],
                    "handNumber": history["handNumber"],
                    "completedAt": history["completedAt"],
                    "board": [
                        card_view(history_material, index) for index in history["boardIndices"]
                    ],
                    "pot": history["pot"],
                    "players": [
                        {
                            "memberId": result["memberId"],
                            "nickname": result["nickname"],
                            "seat": result["seat"],
                            "holeCards": [
                                card_view(history_material, index)
                                for index in result["holeIndices"]
                            ] if not result["folded"] else [],
                            "handName": result["handName"] if not result["folded"] else "未摊牌",
                            "delta": result["delta"],
                            "folded": result["folded"],
                        }
                        for result in history["players"]
                    ],
                }
            )
        snapshot = RoomSnapshot.model_validate(
            {
                "protocolVersion": "1.0",
                "rulesVersion": RULES_VERSION,
                "roomId": self.room_id,
                "roomCode": self.data["code"],
                "version": self.version,
                "phase": self.data["phase"],
                "config": self.data["config"],
                "you": {
                    "memberId": member_id,
                    "seat": viewer["seat"],
                    "isHost": member_id == self.data["hostMemberId"],
                },
                "players": players,
                "hand": hand_view,
                "roomLogs": self.data.get("roomLogs", []),
                "completedHands": completed_hands,
                "fairness": fairness,
                "serverNow": _iso(now),
                "closePending": self.data["closePending"],
            }
        )
        return snapshot.model_dump(mode="json", by_alias=True, exclude_none=True)


def rejected_ack(command_id: str, version: int, error: DomainError) -> dict[str, Any]:
    return CommandRejected(
        command_id=command_id,
        applied_version=version,
        error_code=error.code,
        message=error.message,
    ).model_dump(mode="json", by_alias=True)


def parse_command(value: Any) -> RoomCommand:
    try:
        return ROOM_COMMAND_ADAPTER.validate_python(value)
    except ValueError as exc:
        raise DomainError(ErrorCode.INVALID_COMMAND, "command payload is invalid") from exc
