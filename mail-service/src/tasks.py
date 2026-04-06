import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, text
from .db import async_session, engine
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


async def ensure_tables():
    """Create any missing tables."""
    async with async_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS delivery_status (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                queue_id VARCHAR(20) NOT NULL,
                mail_from VARCHAR(512),
                rcpt_to VARCHAR(512) NOT NULL,
                status VARCHAR(20) NOT NULL,
                dsn VARCHAR(20),
                relay VARCHAR(255),
                delay_reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        # Update mail_log action constraint to include 'discarded'
        await session.execute(text(
            "ALTER TABLE mail_log DROP CONSTRAINT IF EXISTS mail_log_action_check"
        ))
        await session.execute(text(
            "ALTER TABLE mail_log ADD CONSTRAINT mail_log_action_check "
            "CHECK (action IN ('delivered', 'quarantined', 'rejected', 'discarded', 'error'))"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_delivery_status_created ON delivery_status(created_at DESC)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_delivery_status_status ON delivery_status(status)"
        ))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS scanner_clients (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name VARCHAR(255) NOT NULL,
                client_ip VARCHAR(45),
                pubkey VARCHAR(255) NOT NULL,
                privkey VARCHAR(255) NOT NULL,
                keypair_id VARCHAR(255) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.commit()
        logger.info("Database tables verified")


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
    # Ensure all tables and settings exist on startup
    try:
        await ensure_tables()
        await ensure_default_settings()
    except Exception:
        logger.exception("Failed startup tasks")

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
