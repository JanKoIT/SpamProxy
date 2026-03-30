import asyncio
import logging
from datetime import datetime, timezone

from .db import async_session
from .quarantine.manager import QuarantineManager

logger = logging.getLogger(__name__)


async def start_background_tasks():
    """Run periodic background tasks."""
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
