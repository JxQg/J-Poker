from __future__ import annotations

import json
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from app.fairness import (
    CryptoService,
    b64url_decode,
    b64url_encode,
    create_shuffle,
    server_seed_commitment,
    verify_merkle_proof,
)
from app.protocol import RULES_VERSION


def test_committed_shuffle_vector() -> None:
    vector_path = Path(__file__).parents[3] / "contracts" / "shuffle-v1-vectors.json"
    vector = json.loads(vector_path.read_text(encoding="utf-8"))
    server_seed = b64url_decode(vector["serverSeed"], expected_length=32)
    contributions = [
        (
            item["seat"],
            item["memberId"],
            b64url_decode(item["entropy"], expected_length=32),
        )
        for item in vector["contributions"]
    ]
    result = create_shuffle(
        server_seed,
        contributions,
        vector["roomId"],
        vector["handId"],
        RULES_VERSION,
    )
    assert (
        server_seed_commitment(server_seed, vector["roomId"], vector["handId"])
        == vector["serverCommitment"]
    )
    assert b64url_encode(result.deck_key) == vector["deckKey"]
    assert result.deck == vector["deck"]
    assert [b64url_encode(value) for value in result.leaf_salts] == vector["leafSalts"]
    assert result.merkle_root == vector["merkleRoot"]
    assert result.proofs[0] == vector["proofIndex0"]
    assert verify_merkle_proof(
        result.deck[0], 0, result.leaf_salts[0], result.proofs[0], result.merkle_root
    )
    assert not verify_merkle_proof(
        "As" if result.deck[0] != "As" else "Ks",
        0,
        result.leaf_salts[0],
        result.proofs[0],
        result.merkle_root,
    )


@given(st.binary(min_size=32, max_size=32), st.binary(min_size=32, max_size=32))
@settings(max_examples=50, deadline=None)
def test_shuffle_is_a_deterministic_permutation(server_seed: bytes, entropy: bytes) -> None:
    contributions = [(0, "member", entropy)]
    first = create_shuffle(server_seed, contributions, "room", "hand", RULES_VERSION)
    second = create_shuffle(server_seed, contributions, "room", "hand", RULES_VERSION)
    assert first.deck == second.deck
    assert len(first.deck) == len(set(first.deck)) == 52
    assert first.merkle_root == second.merkle_root


def test_encrypted_audit_and_ed25519_signature() -> None:
    crypto = CryptoService(bytes(range(32)))
    payload = {"roomId": "room", "secret": "not logged"}
    nonce, ciphertext = crypto.encrypt_json(payload, "room:hand")
    assert b"not logged" not in ciphertext
    assert crypto.decrypt_json(nonce, ciphertext, "room:hand") == payload
    signature = crypto.sign(payload)
    crypto.verify_signature(payload, signature)
