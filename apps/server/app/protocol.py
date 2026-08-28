from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

PROTOCOL_VERSION: Literal["1.0"] = "1.0"
RULES_VERSION: Literal["pokerkit-0.7.5/nlhe-v1"] = "pokerkit-0.7.5/nlhe-v1"


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ProtocolModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class RoomPhase(StrEnum):
    LOBBY = "lobby"
    COLLECTING_ENTROPY = "collecting_entropy"
    PLAYING = "playing"
    SETTLEMENT = "settlement"
    PAUSED = "paused"
    CLOSED = "closed"


class PlayerStatus(StrEnum):
    WAITING = "waiting"
    ACTIVE = "active"
    FOLDED = "folded"
    ALL_IN = "all_in"
    SITTING_OUT = "sitting_out"


class Street(StrEnum):
    PREFLOP = "preflop"
    FLOP = "flop"
    TURN = "turn"
    RIVER = "river"
    COMPLETE = "complete"


class ErrorCode(StrEnum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    INVALID_COMMAND = "INVALID_COMMAND"
    ROOM_NOT_FOUND = "ROOM_NOT_FOUND"
    ROOM_FULL = "ROOM_FULL"
    ROOM_CLOSED = "ROOM_CLOSED"
    NOT_HOST = "NOT_HOST"
    NOT_MEMBER = "NOT_MEMBER"
    NOT_YOUR_TURN = "NOT_YOUR_TURN"
    INVALID_PHASE = "INVALID_PHASE"
    INVALID_ACTION = "INVALID_ACTION"
    INVALID_AMOUNT = "INVALID_AMOUNT"
    STALE_VERSION = "STALE_VERSION"
    STALE_HAND = "STALE_HAND"
    STALE_TURN = "STALE_TURN"
    ENTROPY_REQUIRED = "ENTROPY_REQUIRED"
    RATE_LIMITED = "RATE_LIMITED"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"


class RoomConfig(ProtocolModel):
    max_players: int = Field(default=8, ge=2, le=10)
    small_blind: int = Field(default=10, ge=1, le=1_000_000)
    big_blind: int = Field(default=20, ge=2, le=2_000_000)
    initial_stack: int = Field(default=2000, ge=1)
    action_timeout_seconds: Literal[15, 30, 60] = 30

    @model_validator(mode="after")
    def validate_blinds_and_stack(self) -> RoomConfig:
        if self.big_blind <= self.small_blind:
            raise ValueError("bigBlind must be greater than smallBlind")
        if not self.big_blind * 20 <= self.initial_stack <= self.big_blind * 500:
            raise ValueError("initialStack must be between 20 and 500 big blinds")
        return self


class CreateRoomRequest(ProtocolModel):
    nickname: str = Field(min_length=1, max_length=20)
    config: RoomConfig = Field(default_factory=RoomConfig)

    @field_validator("nickname")
    @classmethod
    def clean_nickname(cls, value: str) -> str:
        value = " ".join(value.strip().split())
        if not value or any(ord(character) < 32 for character in value):
            raise ValueError("nickname contains unsupported characters")
        return value


class JoinRoomRequest(ProtocolModel):
    nickname: str = Field(min_length=1, max_length=20)

    @field_validator("nickname")
    @classmethod
    def clean_nickname(cls, value: str) -> str:
        return CreateRoomRequest.clean_nickname(value)


class RoomIdentityResponse(ProtocolModel):
    room_id: str
    room_code: str
    member_id: str


class SocketTicketResponse(ProtocolModel):
    ticket: str
    expires_at: datetime


class EmptyPayload(ProtocolModel):
    pass


class ReadyPayload(ProtocolModel):
    ready: bool = True


class PausePayload(ProtocolModel):
    paused: bool = True


class SitOutPayload(ProtocolModel):
    sitting_out: bool = True


class RaiseToPayload(ProtocolModel):
    amount: int = Field(gt=0)


class ShuffleContributionPayload(ProtocolModel):
    entropy: str | None = Field(default=None, min_length=43, max_length=44)
    contribution: str | None = Field(default=None, min_length=64, max_length=64)

    @model_validator(mode="after")
    def require_one_encoding(self) -> ShuffleContributionPayload:
        if (self.entropy is None) == (self.contribution is None):
            raise ValueError("provide exactly one of entropy or contribution")
        return self


class UpdateConfigPayload(ProtocolModel):
    config: RoomConfig


class RemovePlayerPayload(ProtocolModel):
    member_id: str


class PlayerActionPayload(ProtocolModel):
    action: Literal["fold", "check", "call", "raise_to"]
    amount: int | None = Field(default=None, gt=0)


class CommandBase(ProtocolModel):
    command_id: str = Field(min_length=8, max_length=64)
    room_id: str
    hand_id: str | None = None
    turn_id: str | None = None
    expected_version: int = Field(ge=0)


class ReadyCommand(CommandBase):
    type: Literal["ready"]
    payload: ReadyPayload = Field(default_factory=ReadyPayload)


class StartCommand(CommandBase):
    type: Literal["start"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class PauseCommand(CommandBase):
    type: Literal["pause"]
    payload: PausePayload = Field(default_factory=PausePayload)


class CloseCommand(CommandBase):
    type: Literal["close"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class SitOutCommand(CommandBase):
    type: Literal["sitOut"]
    payload: SitOutPayload = Field(default_factory=SitOutPayload)


class FoldCommand(CommandBase):
    type: Literal["fold"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class CheckCommand(CommandBase):
    type: Literal["check"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class CallCommand(CommandBase):
    type: Literal["call"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class RaiseToCommand(CommandBase):
    type: Literal["raiseTo"]
    payload: RaiseToPayload


class ShuffleContributionCommand(CommandBase):
    type: Literal["shuffle.contribute"]
    payload: ShuffleContributionPayload


class SetReadyCommand(CommandBase):
    type: Literal["set_ready"]
    payload: ReadyPayload = Field(default_factory=ReadyPayload)


class StartHandCommand(CommandBase):
    type: Literal["start_hand"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class ContributeRandomnessCommand(CommandBase):
    type: Literal["contribute_randomness"]
    payload: ShuffleContributionPayload


class PlayerActionCommand(CommandBase):
    type: Literal["player_action"]
    payload: PlayerActionPayload


class PauseRoomCommand(CommandBase):
    type: Literal["pause_room"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class ResumeRoomCommand(CommandBase):
    type: Literal["resume_room"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class CloseRoomCommand(CommandBase):
    type: Literal["close_room"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class UpdateConfigCommand(CommandBase):
    type: Literal["update_config"]
    payload: UpdateConfigPayload


class RemovePlayerCommand(CommandBase):
    type: Literal["remove_player"]
    payload: RemovePlayerPayload


class RequestSnapshotCommand(CommandBase):
    type: Literal["request_snapshot"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class RequestRebuyCommand(CommandBase):
    type: Literal["request_rebuy"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


type RoomCommandUnion = (
    ReadyCommand
    | StartCommand
    | PauseCommand
    | CloseCommand
    | SitOutCommand
    | FoldCommand
    | CheckCommand
    | CallCommand
    | RaiseToCommand
    | ShuffleContributionCommand
    | SetReadyCommand
    | StartHandCommand
    | ContributeRandomnessCommand
    | PlayerActionCommand
    | PauseRoomCommand
    | ResumeRoomCommand
    | CloseRoomCommand
    | UpdateConfigCommand
    | RemovePlayerCommand
    | RequestSnapshotCommand
    | RequestRebuyCommand
)
type RoomCommand = Annotated[RoomCommandUnion, Field(discriminator="type")]

ROOM_COMMAND_ADAPTER: TypeAdapter[RoomCommand] = TypeAdapter(RoomCommand)


class CommandAccepted(ProtocolModel):
    status: Literal["accepted"] = "accepted"
    command_id: str
    applied_version: int


class CommandRejected(ProtocolModel):
    status: Literal["rejected"] = "rejected"
    command_id: str
    applied_version: int
    error_code: ErrorCode
    message: str


type CommandAck = CommandAccepted | CommandRejected


class CardView(ProtocolModel):
    code: str
    deck_index: int = Field(ge=0, le=51)
    salt: str
    proof: list[str]


class PlayerView(ProtocolModel):
    member_id: str
    nickname: str
    seat: int = Field(ge=0, le=9)
    stack: int = Field(ge=0)
    borrowed_total: int = Field(default=0, ge=0)
    ranking_score: int
    street_bet: int = Field(ge=0)
    committed: int = Field(ge=0)
    status: PlayerStatus
    ready: bool
    online: bool
    is_host: bool
    rebuy_pending: bool = False
    last_action: str | None = None
    hole_cards: list[CardView] | None = None


class LegalActions(ProtocolModel):
    can_fold: bool = False
    can_check: bool = False
    can_call: bool = False
    can_raise: bool = False
    can_all_in: bool = False
    call_amount: int = Field(default=0, ge=0)
    min_raise_to: int | None = Field(default=None, ge=0)
    max_raise_to: int | None = Field(default=None, ge=0)


class FairnessView(ProtocolModel):
    server_commitment: str | None = None
    merkle_root: str | None = None
    contributions_received: int = Field(default=0, ge=0)
    contributions_required: int = Field(default=0, ge=0)
    contribution_required: bool = False
    audit_available: bool = False


class PotView(ProtocolModel):
    amount: int = Field(ge=0)
    eligible_member_ids: list[str]


class SettlementAward(ProtocolModel):
    member_id: str
    amount: int = Field(gt=0)
    hand_name: str | None = None


class SettlementView(ProtocolModel):
    awards: list[SettlementAward]


class CompletedHandPlayer(ProtocolModel):
    member_id: str
    nickname: str
    seat: int = Field(ge=0, le=9)
    hole_cards: list[CardView]
    hand_name: str
    delta: int
    folded: bool


class CompletedHand(ProtocolModel):
    hand_id: str
    hand_number: int = Field(ge=1)
    completed_at: datetime
    board: list[CardView]
    pot: int = Field(ge=0)
    players: list[CompletedHandPlayer]


class RoomLogEntry(ProtocolModel):
    id: str
    type: str
    message: str
    created_at: datetime
    hand_id: str | None = None


class HandView(ProtocolModel):
    hand_id: str
    hand_number: int = Field(ge=1)
    button_seat: int = Field(ge=0, le=9)
    street: Street
    board: list[CardView]
    pot: int = Field(ge=0)
    pots: list[PotView]
    current_bet: int = Field(ge=0)
    actor_member_id: str | None = None
    actor_seat: int | None = Field(default=None, ge=0, le=9)
    turn_id: str
    deadline_at: datetime | None = None
    legal_actions: LegalActions = Field(default_factory=LegalActions)
    settlement: SettlementView | None = None


class YouView(ProtocolModel):
    member_id: str
    seat: int = Field(ge=0, le=9)
    is_host: bool


class RoomSnapshot(ProtocolModel):
    protocol_version: Literal["1.0"] = PROTOCOL_VERSION
    rules_version: Literal["pokerkit-0.7.5/nlhe-v1"] = RULES_VERSION
    room_id: str
    room_code: str
    version: int = Field(ge=0)
    phase: RoomPhase
    config: RoomConfig
    you: YouView
    players: list[PlayerView]
    hand: HandView | None = None
    room_logs: list[RoomLogEntry] = Field(default_factory=list)
    completed_hands: list[CompletedHand] = Field(default_factory=list)
    fairness: FairnessView = Field(default_factory=FairnessView)
    server_now: datetime
    close_pending: bool = False


class RoomEventMessage(ProtocolModel):
    room_id: str
    version: int = Field(ge=1)
    type: str
    payload: dict[str, Any]
    created_at: datetime


class RoomErrorMessage(ProtocolModel):
    error_code: ErrorCode
    message: str
    command_id: str | None = None


class AuditEvent(ProtocolModel):
    version: int
    type: str
    payload: dict[str, Any]
    created_at: datetime
    previous_hash: str
    hash: str


class AuditHand(ProtocolModel):
    hand_id: str
    hand_number: int
    server_seed: str
    server_commitment: str
    contributions: dict[str, dict[str, Any]]
    deck: list[str]
    leaf_salts: list[str]
    merkle_root: str


class AuditPackage(ProtocolModel):
    schema_version: Literal["1.0"] = PROTOCOL_VERSION
    rules_version: Literal["pokerkit-0.7.5/nlhe-v1"] = RULES_VERSION
    room_id: str
    room_code: str
    closed_at: datetime
    final_event_hash: str
    events: list[AuditEvent]
    hands: list[AuditHand]
    signature_algorithm: Literal["Ed25519"] = "Ed25519"
    signing_public_key: str
    signature: str


class ProtocolContract(ProtocolModel):
    create_room_request: CreateRoomRequest | None = None
    join_room_request: JoinRoomRequest | None = None
    room_identity_response: RoomIdentityResponse | None = None
    socket_ticket_response: SocketTicketResponse | None = None
    room_command: RoomCommandUnion | None = Field(default=None, discriminator="type")
    command_ack: CommandAck | None = None
    room_snapshot: RoomSnapshot | None = None
    room_event: RoomEventMessage | None = None
    room_error: RoomErrorMessage | None = None
    audit_package: AuditPackage | None = None
