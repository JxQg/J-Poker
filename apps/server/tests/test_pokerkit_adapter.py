from __future__ import annotations

import warnings

from app.fairness import CANONICAL_DECK
from app.pokerkit_adapter import PokerKitAdapter


def test_heads_up_button_and_action_order() -> None:
    adapter = PokerKitAdapter(
        ["big-blind", "button-small-blind"],
        [2000, 2000],
        10,
        20,
        list(CANONICAL_DECK),
    )
    assert adapter.street_bet("big-blind") == 20
    assert adapter.street_bet("button-small-blind") == 10
    assert adapter.hole_indices("big-blind") == [0, 2]
    assert adapter.hole_indices("button-small-blind") == [1, 3]
    assert adapter.actor_member_id == "button-small-blind"

    adapter.apply("button-small-blind", "call")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        legal = adapter.legal_actions("big-blind")
    assert legal.can_check
    assert not legal.can_fold
    adapter.apply("big-blind", "check")

    assert adapter.street == "flop"
    assert adapter.actor_member_id == "big-blind"
    assert adapter.board_indices == [5, 6, 7]
    assert sum(adapter.stack(member) for member in adapter.member_order) + adapter.total_pot == 4000


def test_all_in_side_pots_and_uncalled_chips() -> None:
    adapter = PokerKitAdapter(
        ["small", "big", "button"],
        [50, 100, 200],
        1,
        2,
        list(CANONICAL_DECK),
    )
    adapter.apply("button", "raiseTo", 200)
    adapter.apply("small", "call")
    adapter.apply("big", "call")

    assert adapter.complete
    assert [adapter.committed(member) for member in adapter.member_order] == [50, 100, 100]
    assert adapter.pots() == [
        {"amount": 150, "eligibleMemberIds": ["small", "big", "button"]},
        {"amount": 100, "eligibleMemberIds": ["big", "button"]},
    ]
    assert sum(adapter.stack(member) for member in adapter.member_order) == 350
    assert sum(award["amount"] for award in adapter.settlement()["awards"]) == 250


def test_replay_reconstructs_identical_state() -> None:
    adapter = PokerKitAdapter(["big", "button"], [2000, 2000], 10, 20, list(CANONICAL_DECK))
    adapter.apply("button", "raiseTo", 80)
    adapter.apply("big", "call")
    adapter.apply("big", "check")
    adapter.apply("button", "check")

    replay = PokerKitAdapter(
        ["big", "button"],
        [2000, 2000],
        10,
        20,
        list(CANONICAL_DECK),
        adapter.actions,
    )
    assert replay.actions == adapter.actions
    assert replay.actor_member_id == adapter.actor_member_id
    assert replay.board_indices == adapter.board_indices
    assert replay.player_order_snapshot() == adapter.player_order_snapshot()


def test_ten_player_hand_deals_unique_hole_cards() -> None:
    members = [f"player-{index}" for index in range(10)]
    adapter = PokerKitAdapter(members, [2000] * 10, 10, 20, list(CANONICAL_DECK))

    assert all(len(adapter.hole_indices(member)) == 2 for member in members)
    assert len({index for member in members for index in adapter.hole_indices(member)}) == 20
    assert sum(adapter.stack(member) for member in members) + adapter.total_pot == 20_000
