"""Rewrite http(s) links in an email body to click-time-protected safe links.

Runs AFTER scanning, just before re-injection, on inbound mail only. Pure and
synchronous so it can run in a worker thread and be unit-tested without a DB or
network. The caller loads config (secret, base URL, trusted domains, ...) and
passes it in.

Design notes:
  - Only <a href> targets in text/html and bare URLs in text/plain are
    rewritten. Image src, cid:, mailto:, tel:, data: and anchors are left
    untouched (rewriting img src would break inline images).
  - Rewriting mutates the body and therefore breaks the *sender's* DKIM
    signature. That is intentional and safe here: rspamd verifies
    DKIM/SPF/DMARC BEFORE this step, and the backend behind the proxy trusts
    the proxy. This is the same trade-off any body-modifying milter makes.
  - Idempotent: a message that already carries the marker header is returned
    unchanged, and links that already point at our own /l/ endpoint are skipped.
"""
from __future__ import annotations

import email as email_lib
import logging
import re
from dataclasses import dataclass, field
from email import policy as email_policy
from urllib.parse import urlsplit

from .tokens import make_link_token

logger = logging.getLogger(__name__)

MARKER_HEADER = "X-SpamProxy-SafeLinks"

# href="...", href='...', or href=bare (no quotes). Group 2/3/4 = the URL.
_HREF_RE = re.compile(
    r"""(href\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))""",
    re.IGNORECASE,
)
# Bare URLs in plain text. Trailing sentence punctuation is trimmed afterwards.
_BARE_URL_RE = re.compile(r"""https?://[^\s<>"'\)\]}]+""", re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?"


@dataclass
class SafeLinksConfig:
    secret: str
    base_url: str
    trusted_domains: frozenset[str] = field(default_factory=frozenset)
    rewrite_plaintext: bool = True
    ttl_seconds: int = 30 * 24 * 3600
    self_host: str = ""  # host of base_url, always trusted


def build_config(secret: str, base_url: str, trusted_domains, *,
                 rewrite_plaintext: bool = True,
                 ttl_seconds: int = 30 * 24 * 3600) -> SafeLinksConfig:
    normalized = frozenset(
        d.strip().lower().lstrip(".") for d in (trusted_domains or []) if d.strip()
    )
    self_host = (urlsplit(base_url).hostname or "").lower()
    return SafeLinksConfig(
        secret=secret,
        base_url=base_url.rstrip("/"),
        trusted_domains=normalized,
        rewrite_plaintext=rewrite_plaintext,
        ttl_seconds=ttl_seconds,
        self_host=self_host,
    )


def _host_is_trusted(host: str, cfg: SafeLinksConfig) -> bool:
    host = host.lower().rstrip(".")
    if not host:
        return True  # nothing to protect
    if cfg.self_host and (host == cfg.self_host or host.endswith("." + cfg.self_host)):
        return True
    for d in cfg.trusted_domains:
        if host == d or host.endswith("." + d):
            return True
    return False


def _should_rewrite(url: str, cfg: SafeLinksConfig) -> bool:
    lowered = url.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        return False
    # Already one of our safe links.
    if cfg.base_url and url.startswith(cfg.base_url + "/l/"):
        return False
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return False
    return not _host_is_trusted(host, cfg)


def _wrap(url: str, cfg: SafeLinksConfig) -> str:
    token = make_link_token(url, cfg.secret, cfg.ttl_seconds)
    return f"{cfg.base_url}/l/{token}"


def rewrite_html(html: str, cfg: SafeLinksConfig) -> str:
    def repl(m: re.Match) -> str:
        prefix = m.group(1)
        raw = m.group(3)
        quote = '"'
        if raw is None:
            raw = m.group(4)
            quote = "'"
        if raw is None:
            raw = m.group(5)
            quote = ""
        url = (raw or "").strip()
        if not _should_rewrite(url, cfg):
            return m.group(0)
        safe = _wrap(url, cfg)
        return f"{prefix}{quote}{safe}{quote}"

    return _HREF_RE.sub(repl, html)


def rewrite_plaintext(text: str, cfg: SafeLinksConfig) -> str:
    def repl(m: re.Match) -> str:
        url = m.group(0)
        trailing = ""
        while url and url[-1] in _TRAILING_PUNCT:
            trailing = url[-1] + trailing
            url = url[:-1]
        if not _should_rewrite(url, cfg):
            return m.group(0)
        return _wrap(url, cfg) + trailing

    return _BARE_URL_RE.sub(repl, text)


def rewrite_message(raw_message: bytes, cfg: SafeLinksConfig) -> bytes:
    """Return the message with body URLs rewritten. On any parsing/serialization
    error the ORIGINAL bytes are returned so delivery is never blocked."""
    if not cfg.secret or not cfg.base_url:
        return raw_message
    try:
        msg = email_lib.message_from_bytes(raw_message, policy=email_policy.default)
    except Exception:
        logger.exception("SafeLinks: parse failed, delivering original")
        return raw_message

    if msg.get(MARKER_HEADER) is not None:
        return raw_message  # already processed

    changed = False
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        if ctype not in ("text/html", "text/plain"):
            continue
        disp = str(part.get_content_disposition() or "").lower()
        if disp == "attachment":
            continue
        try:
            content = part.get_content()
        except Exception:
            continue
        if not isinstance(content, str):
            continue

        if ctype == "text/html":
            new_content = rewrite_html(content, cfg)
            subtype = "html"
        else:
            if not cfg.rewrite_plaintext:
                continue
            new_content = rewrite_plaintext(content, cfg)
            subtype = "plain"

        if new_content != content:
            try:
                part.set_content(new_content, subtype=subtype, charset="utf-8")
                changed = True
            except Exception:
                logger.exception("SafeLinks: could not set rewritten part")

    if not changed:
        return raw_message

    msg[MARKER_HEADER] = "rewritten"
    try:
        return msg.as_bytes(policy=email_policy.SMTP)
    except Exception:
        logger.exception("SafeLinks: serialize failed, delivering original")
        return raw_message
