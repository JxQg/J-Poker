from __future__ import annotations

import json
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVER_ROOT.parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from app.fairness import (  # noqa: E402
    b64url_encode,
    create_shuffle,
    server_seed_commitment,
)
from app.protocol import RULES_VERSION, ProtocolContract  # noqa: E402


def shuffle_vector() -> dict[str, object]:
    room_id = "00000000-0000-0000-0000-000000000001"
    hand_id = "00000000-0000-0000-0000-000000000002"
    server_seed = bytes(range(32))
    contributions = [
        (0, "00000000-0000-0000-0000-000000000010", bytes(range(32, 64))),
        (1, "00000000-0000-0000-0000-000000000011", bytes(range(64, 96))),
    ]
    result = create_shuffle(server_seed, contributions, room_id, hand_id, RULES_VERSION)
    return {
        "version": "shake256-fisher-yates-v1",
        "roomId": room_id,
        "handId": hand_id,
        "rulesVersion": RULES_VERSION,
        "serverSeed": b64url_encode(server_seed),
        "serverCommitment": server_seed_commitment(server_seed, room_id, hand_id),
        "contributions": [
            {"seat": seat, "memberId": member_id, "entropy": b64url_encode(entropy)}
            for seat, member_id, entropy in contributions
        ],
        "deckKey": b64url_encode(result.deck_key),
        "deck": result.deck,
        "leafSalts": [b64url_encode(salt) for salt in result.leaf_salts],
        "merkleRoot": result.merkle_root,
        "proofIndex0": result.proofs[0],
    }


def main() -> None:
    contracts = REPOSITORY_ROOT / "contracts"
    contracts.mkdir(parents=True, exist_ok=True)
    schema = ProtocolContract.model_json_schema(by_alias=True, ref_template="#/$defs/{model}")
    (contracts / "protocol.schema.json").write_text(
        json.dumps(schema, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    (contracts / "shuffle-v1-vectors.json").write_text(
        json.dumps(shuffle_vector(), indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
