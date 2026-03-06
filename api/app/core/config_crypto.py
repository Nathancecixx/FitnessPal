from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
import hashlib
import hmac
import json
import secrets

from fastapi import HTTPException, status

from app.core.config import get_settings


_ITERATIONS = 120_000
_SALT_BYTES = 16
_NONCE_BYTES = 16
_MAC_BYTES = 32


def _require_secret() -> str:
    secret = get_settings().config_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FITNESSPAL_CONFIG_SECRET must be set before saving encrypted AI provider secrets.",
        )
    return secret


def _derive_key(secret: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, _ITERATIONS, dklen=32)


def _keystream(key: bytes, nonce: bytes, size: int) -> bytes:
    chunks: list[bytes] = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < size:
        block = hashlib.sha256(key + nonce + counter.to_bytes(4, "big")).digest()
        chunks.append(block)
        counter += 1
    return b"".join(chunks)[:size]


def encrypt_secret_payload(payload: dict[str, object]) -> str:
    secret = _require_secret()
    salt = secrets.token_bytes(_SALT_BYTES)
    nonce = secrets.token_bytes(_NONCE_BYTES)
    key = _derive_key(secret, salt)
    plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ciphertext = bytes(left ^ right for left, right in zip(plaintext, _keystream(key, nonce, len(plaintext))))
    mac = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
    return urlsafe_b64encode(salt + nonce + mac + ciphertext).decode("utf-8")


def decrypt_secret_payload(ciphertext: str | None) -> dict[str, object]:
    if not ciphertext:
        return {}
    secret = _require_secret()
    raw = urlsafe_b64decode(ciphertext.encode("utf-8"))
    salt = raw[:_SALT_BYTES]
    nonce = raw[_SALT_BYTES : _SALT_BYTES + _NONCE_BYTES]
    mac = raw[_SALT_BYTES + _NONCE_BYTES : _SALT_BYTES + _NONCE_BYTES + _MAC_BYTES]
    encrypted = raw[_SALT_BYTES + _NONCE_BYTES + _MAC_BYTES :]
    key = _derive_key(secret, salt)
    expected = hmac.new(key, nonce + encrypted, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expected):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored AI secret payload is invalid.")
    plaintext = bytes(left ^ right for left, right in zip(encrypted, _keystream(key, nonce, len(encrypted))))
    return json.loads(plaintext.decode("utf-8"))
