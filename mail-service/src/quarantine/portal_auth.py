"""End-user portal authentication.

Two token types on top of the same HMAC secret used by report links:

- Magic-link (m): sent to the user's email address, short-lived (15 min),
  one-shot login. Payload: {"m": "<email>", "e": <exp>}
- Session (s): set as HTTP-only cookie after successful magic-link
  redemption, long-lived (30 days). Payload: {"s": "<email>", "e": <exp>}

Only email addresses that are already present in quarantine_recipients
can request or accept a magic link. This ensures the portal never
exposes mail to random registrations - the admin has to add the
recipient (or the daily-report system already tracked them).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Setting

MAGIC_LINK_TTL_SECONDS = 15 * 60
SESSION_TTL_SECONDS = 30 * 24 * 3600
COOKIE_NAME = "spamproxy_portal"


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


def _build(payload: dict, secret: str) -> str:
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    sig = _sign(payload_bytes, secret)
    return f"{payload_b64}.{sig}"


def _verify_raw(token: str, secret: str) -> dict:
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
    return payload


async def make_magic_link_token(session: AsyncSession, email: str) -> str:
    secret = await _get_secret(session)
    payload = {
        "m": email.lower(),
        "e": int(time.time()) + MAGIC_LINK_TTL_SECONDS,
    }
    return _build(payload, secret)


async def verify_magic_link_token(session: AsyncSession, token: str) -> str:
    secret = await _get_secret(session)
    payload = _verify_raw(token, secret)
    if "m" not in payload:
        raise ValueError("not a magic-link token")
    return payload["m"]


async def make_session_token(session: AsyncSession, email: str) -> str:
    secret = await _get_secret(session)
    payload = {
        "s": email.lower(),
        "e": int(time.time()) + SESSION_TTL_SECONDS,
    }
    return _build(payload, secret)


async def verify_session_token(session: AsyncSession, token: str) -> str:
    secret = await _get_secret(session)
    payload = _verify_raw(token, secret)
    if "s" not in payload:
        raise ValueError("not a session token")
    return payload["s"]
