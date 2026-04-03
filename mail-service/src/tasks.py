import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from .db import async_session
from .quarantine.manager import QuarantineManager
from .quarantine.models import Setting

logger = logging.getLogger(__name__)

# Default settings - automatically inserted if missing
DEFAULT_SETTINGS = [
    ("spam_quarantine_threshold", 5.0, "scanning", "Score above which mail is quarantined"),
    ("spam_reject_threshold", 10.0, "scanning", "Score above which mail is rejected"),
    ("ai_grey_zone_min", 3.0, "ai", "Minimum rspamd score to trigger AI classification"),
    ("ai_grey_zone_max", 7.0, "ai", "Maximum rspamd score to trigger AI classification"),
    ("ai_enabled", True, "ai", "Enable AI-based spam classification"),
    ("ai_provider", "openai", "ai", "AI provider: openai or ollama"),
    ("ai_model", "gpt-4o-mini", "ai", "AI model to use"),
    ("quarantine_retention_days", 30, "quarantine", "Days to keep quarantined messages"),
    ("proxy_hostname", "proxy.example.com", "smtp", "Hostname for the SMTP proxy"),
    ("max_message_size", 26214400, "smtp", "Maximum message size in bytes (25MB)"),
    ("antivirus_enabled", True, "scanning", "Enable ClamAV virus scanning"),
    ("rbl_enabled", True, "scanning", "Enable DNS blocklist checks (RBL/DNSBL)"),
    ("spamhaus_dqs_key", "", "scanning", "Spamhaus DQS API key (leave empty for free tier)"),
    ("dkim_signing_enabled", True, "smtp", "Enable DKIM signing for outgoing mail"),
    ("spf_enabled", True, "scanning", "Enable SPF verification"),
    ("spf_fail_score", 5.0, "scanning", "Score for SPF hard fail"),
    ("spf_softfail_score", 2.0, "scanning", "Score for SPF soft fail"),
    ("block_google_groups", True, "scanning", "Block spam from Google Groups (freemail senders)"),
    ("block_bulk_unsolicited", True, "scanning", "Block unsolicited bulk mail without proper List-Id"),
    ("mailing_list_score", 0.0, "scanning", "Additional score for all mailing list messages"),
]


async def ensure_default_settings():
    """Insert any missing default settings into the database."""
    async with async_session() as session:
        inserted = 0
        for key, value, category, description in DEFAULT_SETTINGS:
            result = await session.execute(select(Setting).where(Setting.key == key))
            if not result.scalar_one_or_none():
                session.add(Setting(key=key, value=value, category=category, description=description))
                inserted += 1
        if inserted > 0:
            await session.commit()
            logger.info("Inserted %d missing default settings", inserted)


async def start_background_tasks():
    """Run periodic background tasks."""
    # Ensure all settings exist on startup
    try:
        await ensure_default_settings()
    except Exception:
        logger.exception("Failed to ensure default settings")

    while True:
        try:
            await cleanup_expired_quarantine()
        except Exception:
            logger.exception("Background task error")
        await asyncio.sleep(3600)  # Run every hour


async def cleanup_expired_quarantine():
    """Remove expired quarantine entries."""
    async with async_session() as session:
        qm = QuarantineManager(session)
        count = await qm.cleanup_expired()
        if count > 0:
            logger.info("Cleaned up %d expired quarantine entries", count)
