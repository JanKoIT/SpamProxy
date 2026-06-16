"""HMAC-signed tokens for one-click quarantine actions in email reports.

Token format: base64url(payload).base64url(signature)

Two token shapes:
  Single: {"q": "<quarantine-uuid>", "a": "approve|reject", "e": <expiry>}
  Bulk:   {"r": "<recipient-email>", "a": "approve_all|reject_all",
           "c": <cutoff-unix-ts>, "e": <expiry>}

Bulk tokens act on all currently pending quarantine entries for the
recipient that were quarantined at or before the cutoff timestamp.
This prevents bulk actions from accidentally including mails that
arrived AFTER the report was sent.

Recipients click links like https://host/q/<token>/go which:
- Validate signature against the configured secret
- Check expiry (7 days by default)
- Execute the action through QuarantineManager
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Setting


_TOKEN_TTL_SECONDS = 7 * 24 * 3600


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


async def _get_secret(session: AsyncSession) -> str:
    result = await session.execute(
        select(Setting).where(Setting.key == "report_token_secret")
    )
    row = result.scalar_one_or_none()
    if not row or not row.value:
        raise RuntimeError("report_token_secret not configured")
    return str(row.value).strip('"')


def _sign(payload: bytes, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return _b64url_encode(sig)


async def make_token(session: AsyncSession, quarantine_id: UUID,
                     action: str, ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
    """Create a signed token for a single-mail quarantine action."""
    secret = await _get_secret(session)
    payload = {
        "q": str(quarantine_id),
        "a": action,
        "e": int(time.time()) + ttl_seconds,
    }
    return _build(payload, secret)


async def make_bulk_token(session: AsyncSession, recipient_email: str,
                          action: str, cutoff_ts: int,
                          ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
    """Create a signed token for a bulk action across one recipient's
    pending quarantine (only mails quarantined at or before cutoff_ts)."""
    if action not in ("approve_all", "reject_all"):
        raise ValueError(f"invalid bulk action: {action}")
    secret = await _get_secret(session)
    payload = {
        "r": recipient_email.lower(),
        "a": action,
        "c": int(cutoff_ts),
        "e": int(time.time()) + ttl_seconds,
    }
    return _build(payload, secret)


def _build(payload: dict, secret: str) -> str:
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    sig = _sign(payload_bytes, secret)
    return f"{payload_b64}.{sig}"


async def verify_token(session: AsyncSession, token: str) -> dict:
    """Verify a token's signature, expiry, and shape.

    Returns the decoded payload dict. Callers inspect:
      - "q" key present → single-mail action: payload["q"], payload["a"]
      - "r" key present → bulk action: payload["r"], payload["a"], payload["c"]

    Raises ValueError on invalid signature, malformed token, or expiry.
    """
    if not token or "." not in token:
        raise ValueError("malformed token")

    payload_b64, sig = token.rsplit(".", 1)
    try:
        payload_bytes = _b64url_decode(payload_b64)
    except Exception as e:
        raise ValueError("malformed token payload") from e

    secret = await _get_secret(session)
    expected_sig = _sign(payload_bytes, secret)
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("invalid signature")

    try:
        payload = json.loads(payload_bytes)
    except Exception as e:
        raise ValueError("malformed payload") from e

    if "e" not in payload or int(payload["e"]) < int(time.time()):
        raise ValueError("token expired")
    if payload.get("a") not in ("approve", "reject", "approve_all", "reject_all"):
        raise ValueError("invalid action")

    if "q" in payload:
        # single-mail token
        UUID(payload["q"])  # validate
        return payload
    if "r" in payload and "c" in payload:
        return payload
    raise ValueError("payload missing fields")
