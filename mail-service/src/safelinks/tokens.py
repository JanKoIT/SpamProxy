"""HMAC-signed tokens that carry a rewritten URL for click-time protection.

Token format (same shape as report tokens): base64url(payload).base64url(sig)
Payload: {"u": "<original-absolute-url>", "e": <unix-expiry>}

These tokens are STATELESS - the destination URL is embedded and signed, so
no database row is needed per rewritten link. The HMAC signature is the
authorization: a recipient (or attacker) cannot point a safe-link at an
arbitrary URL without knowing the secret. Signing/verifying is synchronous
and takes the secret as an argument so the rewriter can run in a worker
thread without touching the database.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

_DEFAULT_TTL_SECONDS = 30 * 24 * 3600
_MAX_URL_LEN = 4096


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: bytes, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return _b64url_encode(sig)


def make_link_token(url: str, secret: str,
                    ttl_seconds: int = _DEFAULT_TTL_SECONDS) -> str:
    """Create a signed token embedding an absolute http(s) URL."""
    if not secret:
        raise ValueError("secret required")
    payload = {"u": url, "e": int(time.time()) + int(ttl_seconds)}
    payload_bytes = json.dumps(
        payload, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return f"{_b64url_encode(payload_bytes)}.{_sign(payload_bytes, secret)}"


def verify_link_token(token: str, secret: str) -> str:
    """Verify signature + expiry and return the embedded URL.

    Raises ValueError on any malformed/forged/expired token.
    """
    if not token or "." not in token:
        raise ValueError("malformed token")
    payload_b64, sig = token.rsplit(".", 1)
    try:
        payload_bytes = _b64url_decode(payload_b64)
    except Exception as e:
        raise ValueError("malformed payload") from e

    expected = _sign(payload_bytes, secret)
    if not hmac.compare_digest(sig, expected):
        raise ValueError("invalid signature")

    try:
        payload = json.loads(payload_bytes)
    except Exception as e:
        raise ValueError("malformed payload") from e

    if "e" not in payload or int(payload["e"]) < int(time.time()):
        raise ValueError("token expired")
    url = payload.get("u")
    if not isinstance(url, str) or len(url) > _MAX_URL_LEN:
        raise ValueError("invalid url")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("invalid url scheme")
    return url
