from __future__ import annotations

import base64
import binascii
import hashlib
import json
import secrets
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

CANONICAL_DECK = tuple(f"{rank}{suit}" for rank in "23456789TJQKA" for suit in "cdhs")
SHUFFLE_VERSION = "shake256-fisher-yates-v1"


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def b64url_decode(value: str, *, expected_length: int | None = None) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("value must be URL-safe base64") from exc
    if expected_length is not None and len(decoded) != expected_length:
        raise ValueError(f"value must decode to {expected_length} bytes")
    if b64url_encode(decoded) != value.rstrip("="):
        raise ValueError("value is not canonical URL-safe base64")
    return decoded


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def server_seed_commitment(server_seed: bytes, room_id: str, hand_id: str) -> str:
    digest = hashlib.sha256(
        b"holdem-server-seed-v1\0"
        + room_id.encode()
        + b"\0"
        + hand_id.encode()
        + b"\0"
        + server_seed
    ).digest()
    return b64url_encode(digest)


def derive_deck_key(
    server_seed: bytes,
    contributions: Iterable[tuple[int, str, bytes]],
    room_id: str,
    hand_id: str,
    rules_version: str,
) -> bytes:
    ordered = sorted(contributions, key=lambda item: (item[0], item[1]))
    ikm = server_seed + b"".join(entropy for _, _, entropy in ordered)
    context = canonical_json(
        {
            "handId": hand_id,
            "members": [{"memberId": member_id, "seat": seat} for seat, member_id, _ in ordered],
            "roomId": room_id,
            "rulesVersion": rules_version,
            "shuffleVersion": SHUFFLE_VERSION,
        }
    )
    return HKDF(
        algorithm=SHA256(),
        length=32,
        salt=hashlib.sha256(b"holdem-deck-key-v1").digest(),
        info=context,
    ).derive(ikm)


class _ShakeReader:
    def __init__(self, key: bytes) -> None:
        self._shake = hashlib.shake_256(b"holdem-shuffle-stream-v1\0" + key)
        self._offset = 0

    def read_byte(self) -> int:
        end = self._offset + 1
        value = self._shake.digest(end)[self._offset]
        self._offset = end
        return value

    def randbelow(self, bound: int) -> int:
        if not 1 <= bound <= 256:
            raise ValueError("bound must be in [1, 256]")
        limit = 256 - (256 % bound)
        while True:
            value = self.read_byte()
            if value < limit:
                return value % bound


def shuffled_deck(deck_key: bytes) -> list[str]:
    deck = list(CANONICAL_DECK)
    random_stream = _ShakeReader(deck_key)
    for index in range(len(deck) - 1, 0, -1):
        target = random_stream.randbelow(index + 1)
        deck[index], deck[target] = deck[target], deck[index]
    return deck


def _leaf_hash(index: int, card: str, salt: bytes) -> bytes:
    return hashlib.sha256(
        b"holdem-merkle-leaf-v1\0" + index.to_bytes(2, "big") + card.encode() + b"\0" + salt
    ).digest()


def _node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"holdem-merkle-node-v1\0" + left + right).digest()


def build_merkle_tree(deck: list[str], leaf_salts: list[bytes]) -> tuple[str, list[list[str]]]:
    if len(deck) != 52 or len(leaf_salts) != len(deck):
        raise ValueError("a standard deck and one salt per card are required")
    levels = [[_leaf_hash(index, card, leaf_salts[index]) for index, card in enumerate(deck)]]
    while len(levels[-1]) > 1:
        current = levels[-1]
        next_level: list[bytes] = []
        for index in range(0, len(current), 2):
            left = current[index]
            right = current[index + 1] if index + 1 < len(current) else left
            next_level.append(_node_hash(left, right))
        levels.append(next_level)

    proofs: list[list[str]] = []
    for deck_index in range(len(deck)):
        proof: list[str] = []
        position = deck_index
        for level in levels[:-1]:
            if position % 2:
                proof.append("L:" + b64url_encode(level[position - 1]))
            else:
                sibling = position + 1 if position + 1 < len(level) else position
                proof.append("R:" + b64url_encode(level[sibling]))
            position //= 2
        proofs.append(proof)
    return b64url_encode(levels[-1][0]), proofs


def verify_merkle_proof(
    card: str,
    deck_index: int,
    salt: bytes,
    proof: list[str],
    expected_root: str,
) -> bool:
    value = _leaf_hash(deck_index, card, salt)
    for step in proof:
        side, encoded = step.split(":", 1)
        sibling = b64url_decode(encoded, expected_length=32)
        value = _node_hash(sibling, value) if side == "L" else _node_hash(value, sibling)
    return secrets.compare_digest(b64url_encode(value), expected_root)


@dataclass(frozen=True, slots=True)
class ShuffleResult:
    deck_key: bytes
    deck: list[str]
    leaf_salts: list[bytes]
    merkle_root: str
    proofs: list[list[str]]


def create_shuffle(
    server_seed: bytes,
    contributions: Iterable[tuple[int, str, bytes]],
    room_id: str,
    hand_id: str,
    rules_version: str,
) -> ShuffleResult:
    key = derive_deck_key(server_seed, contributions, room_id, hand_id, rules_version)
    deck = shuffled_deck(key)
    leaf_salts = [
        HKDF(
            algorithm=SHA256(),
            length=16,
            salt=None,
            info=b"holdem-merkle-salt-v1\0" + index.to_bytes(2, "big"),
        ).derive(key)
        for index in range(52)
    ]
    merkle_root, proofs = build_merkle_tree(deck, leaf_salts)
    return ShuffleResult(key, deck, leaf_salts, merkle_root, proofs)


class CryptoService:
    def __init__(self, master_secret: bytes) -> None:
        self._encryption_key = self._derive(master_secret, b"audit-encryption-v1", 32)
        signing_seed = self._derive(master_secret, b"audit-signing-v1", 32)
        self._signing_key = Ed25519PrivateKey.from_private_bytes(signing_seed)
        self._token_key = self._derive(master_secret, b"guest-token-hashing-v1", 32)

    @staticmethod
    def _derive(master_secret: bytes, info: bytes, length: int) -> bytes:
        return HKDF(
            algorithm=SHA256(),
            length=length,
            salt=hashlib.sha256(b"private-holdem-app-v1").digest(),
            info=info,
        ).derive(master_secret)

    def token_hash(self, token: str) -> str:
        return hashlib.sha256(self._token_key + token.encode()).hexdigest()

    def encrypt_json(self, value: Any, associated_data: str) -> tuple[bytes, bytes]:
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(self._encryption_key).encrypt(
            nonce, canonical_json(value), associated_data.encode()
        )
        return nonce, ciphertext

    def decrypt_json(self, nonce: bytes, ciphertext: bytes, associated_data: str) -> Any:
        plaintext = AESGCM(self._encryption_key).decrypt(
            nonce, ciphertext, associated_data.encode()
        )
        return json.loads(plaintext)

    @property
    def signing_public_key(self) -> str:
        value = self._signing_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return b64url_encode(value)

    def sign(self, value: Any) -> str:
        return b64url_encode(self._signing_key.sign(canonical_json(value)))

    def verify_signature(self, value: Any, signature: str) -> None:
        self._signing_key.public_key().verify(b64url_decode(signature), canonical_json(value))


def card_view(material: dict[str, Any], deck_index: int) -> dict[str, Any]:
    return {
        "code": material["deck"][deck_index],
        "deckIndex": deck_index,
        "salt": material["leafSalts"][deck_index],
        "proof": material["proofs"][deck_index],
    }
