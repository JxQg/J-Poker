from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pokerkit import Automation, BetCollection, Mode, NoLimitTexasHoldem, State


class PokerRuleError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class LegalActionState:
    can_fold: bool
    can_check: bool
    can_call: bool
    can_raise: bool
    can_all_in: bool
    call_amount: int
    min_raise_to: int | None
    max_raise_to: int | None


class PokerKitAdapter:
    """Pins all mutable PokerKit behavior behind a replayable interface."""

    _AUTOMATIONS = (
        Automation.ANTE_POSTING,
        Automation.BET_COLLECTION,
        Automation.BLIND_OR_STRADDLE_POSTING,
        Automation.RUNOUT_COUNT_SELECTION,
        Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
        Automation.HAND_KILLING,
        Automation.CHIPS_PUSHING,
        Automation.CHIPS_PULLING,
    )

    def __init__(
        self,
        member_order: list[str],
        starting_stacks: list[int],
        small_blind: int,
        big_blind: int,
        deck: list[str],
        actions: list[dict[str, Any]] | None = None,
    ) -> None:
        if not 2 <= len(member_order) <= 10:
            raise ValueError("PokerKit adapter requires 2-10 players")
        if len(member_order) != len(starting_stacks):
            raise ValueError("member and stack counts differ")
        if len(deck) != 52 or len(set(deck)) != 52:
            raise ValueError("deck must contain 52 unique cards")
        self.member_order = list(member_order)
        self.starting_stacks = list(starting_stacks)
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.deck = list(deck)
        self.actions: list[dict[str, Any]] = []
        self._member_indices = {member_id: index for index, member_id in enumerate(member_order)}
        self._deck_position = 0
        self._hole_indices: list[list[int]] = [[] for _ in member_order]
        self._board_indices: list[int] = []
        self._burn_indices: list[int] = []
        self._folded: set[int] = set()
        self._last_actions: dict[int, str] = {}
        self.state = self._create_state()
        self._drive_dealing()
        for action in actions or []:
            self._apply(action["memberId"], action["type"], action.get("amount"), record=True)

    def _create_state(self) -> State:
        blinds = [self.small_blind, self.big_blind]
        blinds.extend(0 for _ in range(len(self.member_order) - 2))
        return NoLimitTexasHoldem.create_state(
            self._AUTOMATIONS,
            True,
            0,
            tuple(blinds),
            self.big_blind,
            tuple(self.starting_stacks),
            len(self.member_order),
            mode=Mode.CASH_GAME,
        )

    def _take_card(self) -> tuple[int, str]:
        if self._deck_position >= len(self.deck):
            raise PokerRuleError("verified deck exhausted")
        index = self._deck_position
        self._deck_position += 1
        return index, self.deck[index]

    def _drive_dealing(self) -> None:
        while self.state.status:
            if self.state.can_burn_card():
                deck_index, card = self._take_card()
                self.state.burn_card(card)
                self._burn_indices.append(deck_index)
                continue
            if self.state.can_deal_hole():
                player_index = self.state.hole_dealee_index
                if player_index is None:
                    raise PokerRuleError("PokerKit did not identify a hole-card recipient")
                deck_index, card = self._take_card()
                self.state.deal_hole(card, player_index)
                self._hole_indices[player_index].append(deck_index)
                continue
            if self.state.can_deal_board():
                count = self.state.board_dealing_count
                if count is None:
                    raise PokerRuleError("PokerKit did not identify a board-card count")
                cards: list[str] = []
                indices: list[int] = []
                for _ in range(count):
                    deck_index, card = self._take_card()
                    cards.append(card)
                    indices.append(deck_index)
                self.state.deal_board("".join(cards))
                self._board_indices.extend(indices)
                continue
            break

    def apply(self, member_id: str, action: str, amount: int | None = None) -> None:
        self._apply(member_id, action, amount, record=True)

    def _apply(self, member_id: str, action: str, amount: int | None, *, record: bool) -> None:
        if not self.state.status:
            raise PokerRuleError("hand is complete")
        player_index = self._member_indices.get(member_id)
        if player_index is None:
            raise PokerRuleError("player is not in this hand")
        if self.state.actor_index != player_index:
            raise PokerRuleError("not this player's turn")

        try:
            if action == "fold":
                self.state.fold()
                self._folded.add(player_index)
            elif action == "check":
                if not self.state.can_check_or_call() or self.state.checking_or_calling_amount != 0:
                    raise PokerRuleError("checking is not legal")
                self.state.check_or_call()
            elif action == "call":
                calling_amount = self.state.checking_or_calling_amount
                if (
                    not self.state.can_check_or_call()
                    or calling_amount is None
                    or calling_amount <= 0
                ):
                    raise PokerRuleError("calling is not legal")
                self.state.check_or_call()
            elif action == "raiseTo":
                if amount is None or not self.state.can_complete_bet_or_raise_to(amount):
                    raise PokerRuleError("raise-to amount is not legal")
                self.state.complete_bet_or_raise_to(amount)
            else:
                raise PokerRuleError("unsupported poker action")
        except (ValueError, UserWarning) as exc:
            if isinstance(exc, PokerRuleError):
                raise
            raise PokerRuleError(str(exc)) from exc

        self._last_actions[player_index] = action if amount is None else f"{action}:{amount}"
        if record:
            entry: dict[str, Any] = {"memberId": member_id, "type": action}
            if amount is not None:
                entry["amount"] = amount
            self.actions.append(entry)
        self._drive_dealing()

    @property
    def complete(self) -> bool:
        return not self.state.status

    @property
    def actor_member_id(self) -> str | None:
        if self.state.actor_index is None:
            return None
        return self.member_order[self.state.actor_index]

    @property
    def street(self) -> str:
        if self.complete:
            return "complete"
        streets = ("preflop", "flop", "turn", "river")
        if self.state.street_index is None:
            return "preflop"
        return streets[self.state.street_index]

    @property
    def board_indices(self) -> list[int]:
        return list(self._board_indices)

    def hole_indices(self, member_id: str) -> list[int]:
        return list(self._hole_indices[self._member_indices[member_id]])

    def stack(self, member_id: str) -> int:
        return int(self.state.stacks[self._member_indices[member_id]])

    def street_bet(self, member_id: str) -> int:
        return int(self.state.bets[self._member_indices[member_id]])

    def committed(self, member_id: str) -> int:
        return self._commitments()[self._member_indices[member_id]]

    def _commitments(self) -> list[int]:
        committed = [0 for _ in self.member_order]
        for operation in self.state.operations:
            if isinstance(operation, BetCollection):
                for index, amount in enumerate(operation.bets):
                    committed[index] += int(amount)
        for index, amount in enumerate(self.state.bets):
            committed[index] += int(amount)
        return committed

    def folded(self, member_id: str) -> bool:
        return self._member_indices[member_id] in self._folded

    def all_in(self, member_id: str) -> bool:
        index = self._member_indices[member_id]
        return not self.complete and index not in self._folded and self.state.stacks[index] == 0

    def last_action(self, member_id: str) -> str | None:
        return self._last_actions.get(self._member_indices[member_id])

    @property
    def current_bet(self) -> int:
        return int(max(self.state.bets, default=0))

    @property
    def total_pot(self) -> int:
        return sum(self._commitments())

    def legal_actions(self, member_id: str) -> LegalActionState:
        if self.complete or self.actor_member_id != member_id:
            return LegalActionState(False, False, False, False, False, 0, None, None)
        raw_call_amount = self.state.checking_or_calling_amount
        call_amount = int(raw_call_amount) if raw_call_amount is not None else 0
        can_check_or_call = self.state.can_check_or_call()
        can_raise = self.state.can_complete_bet_or_raise_to()
        raw_minimum = self.state.min_completion_betting_or_raising_to_amount
        raw_maximum = self.state.max_completion_betting_or_raising_to_amount
        minimum = int(raw_minimum) if can_raise and raw_minimum is not None else None
        maximum = int(raw_maximum) if can_raise and raw_maximum is not None else None
        index = self._member_indices[member_id]
        can_all_in = self.state.stacks[index] > 0 and (can_check_or_call or can_raise)
        return LegalActionState(
            can_fold=call_amount > 0 and self.state.can_fold(),
            can_check=can_check_or_call and call_amount == 0,
            can_call=can_check_or_call and call_amount > 0,
            can_raise=can_raise,
            can_all_in=can_all_in,
            call_amount=call_amount,
            min_raise_to=minimum,
            max_raise_to=maximum,
        )

    def pots(self) -> list[dict[str, Any]]:
        committed = self._commitments()
        levels = sorted({amount for amount in committed if amount > 0})
        previous = 0
        pots: list[dict[str, Any]] = []
        for level in levels:
            contributing = [index for index, amount in enumerate(committed) if amount >= level]
            amount = (level - previous) * len(contributing)
            eligible = [
                self.member_order[index] for index in contributing if index not in self._folded
            ]
            if amount:
                if pots and pots[-1]["eligibleMemberIds"] == eligible:
                    pots[-1]["amount"] += amount
                else:
                    pots.append({"amount": amount, "eligibleMemberIds": eligible})
            previous = level
        return pots

    def settlement(self) -> dict[str, Any] | None:
        if not self.complete:
            return None
        awards: list[dict[str, Any]] = []
        for index, member_id in enumerate(self.member_order):
            payout = int(
                self.state.stacks[index] - self.starting_stacks[index] + self._commitments()[index]
            )
            if payout <= 0:
                continue
            hand = self.state.get_hand(index, 0, 0) if len(self._board_indices) >= 3 else None
            awards.append(
                {
                    "memberId": member_id,
                    "amount": payout,
                    "handName": str(hand).split(" (", 1)[0] if hand is not None else "Uncontested",
                }
            )
        return {"awards": awards}

    def hand_name(self, member_id: str) -> str:
        """Returns the best made hand once enough board cards are available."""
        if self.folded(member_id):
            return "未摊牌"
        if len(self._board_indices) < 3:
            return "Uncontested"
        index = self._member_indices[member_id]
        return str(self.state.get_hand(index, 0, 0)).split(" (", 1)[0]

    def player_order_snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "memberId": member_id,
                "stack": self.stack(member_id),
                "streetBet": self.street_bet(member_id),
                "committed": self.committed(member_id),
                "folded": self.folded(member_id),
                "allIn": self.all_in(member_id),
                "lastAction": self.last_action(member_id),
            }
            for member_id in self.member_order
        ]
