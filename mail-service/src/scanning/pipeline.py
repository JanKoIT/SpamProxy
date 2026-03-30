import logging
import time
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..quarantine.manager import QuarantineManager
from ..quarantine.models import MailLog, StatsHourly
from .rspamd import RspamdClient, RspamdResult
from .ai_classifier import AIClassifier

from datetime import datetime, timezone
from sqlalchemy import select

logger = logging.getLogger(__name__)


@dataclass
class ScanResult:
    action: str  # delivered, quarantined, rejected
    rspamd_score: float
    ai_score: float | None
    final_score: float
    rspamd_symbols: dict
    ai_reason: str
    mail_log_id: UUID | None = None


class ScanningPipeline:
    def __init__(self):
        self.rspamd = RspamdClient()
        self.ai = AIClassifier() if settings.ai_enabled else None

    async def scan(
        self,
        raw_message: bytes,
        mail_from: str,
        rcpt_to: list[str],
        direction: str,
        client_ip: str,
        session: AsyncSession,
    ) -> ScanResult:
        start = time.monotonic()

        # Step 1: rspamd scan
        rspamd_result = await self.rspamd.scan(raw_message, mail_from, rcpt_to)
        rspamd_score = rspamd_result.score

        # Step 2: AI classification for grey zone
        ai_score = None
        ai_reason = ""
        if (
            self.ai
            and settings.ai_grey_zone_min <= rspamd_score <= settings.ai_grey_zone_max
        ):
            ai_score, ai_reason = await self.ai.classify(raw_message)
            logger.info("AI score: %.1f (%s)", ai_score, ai_reason)

        # Step 3: Calculate final score
        if ai_score is not None:
            # Weighted combination: 60% rspamd, 40% AI
            final_score = (rspamd_score * 0.6) + (ai_score * 0.4)
        else:
            final_score = rspamd_score

        # Step 4: Determine action
        if final_score >= settings.spam_reject_threshold:
            action = "rejected"
        elif final_score >= settings.spam_quarantine_threshold:
            action = "quarantined"
        else:
            action = "delivered"

        processing_time = int((time.monotonic() - start) * 1000)

        # Step 5: Log to database
        import email as email_lib
        from email.policy import default as default_policy

        parsed = email_lib.message_from_bytes(raw_message, policy=default_policy)
        subject = str(parsed.get("Subject", ""))
        message_id = str(parsed.get("Message-ID", ""))

        log_entry = MailLog(
            message_id=message_id,
            mail_from=mail_from,
            rcpt_to=rcpt_to,
            subject=subject[:500],
            direction=direction,
            client_ip=client_ip,
            size_bytes=len(raw_message),
            rspamd_score=rspamd_score,
            ai_score=ai_score,
            final_score=final_score,
            rspamd_symbols=rspamd_result.symbols,
            action=action,
            processing_time_ms=processing_time,
        )
        session.add(log_entry)
        await session.flush()

        # Step 6: Quarantine if needed
        if action == "quarantined":
            qm = QuarantineManager(session)
            await qm.store(log_entry.id, raw_message)

        # Step 7: Update hourly stats
        await self._update_stats(session, direction, action)

        await session.commit()

        return ScanResult(
            action=action,
            rspamd_score=rspamd_score,
            ai_score=ai_score,
            final_score=final_score,
            rspamd_symbols=rspamd_result.symbols,
            ai_reason=ai_reason,
            mail_log_id=log_entry.id,
        )

    async def _update_stats(self, session: AsyncSession, direction: str, action: str):
        now = datetime.now(timezone.utc)
        hour = now.replace(minute=0, second=0, microsecond=0)

        result = await session.execute(
            select(StatsHourly).where(StatsHourly.hour == hour)
        )
        stats = result.scalar_one_or_none()

        if not stats:
            stats = StatsHourly(hour=hour)
            session.add(stats)

        stats.total_mails += 1
        if direction == "inbound":
            stats.inbound_count += 1
        else:
            stats.outbound_count += 1

        if action == "delivered":
            stats.ham_count += 1
        elif action == "quarantined":
            stats.quarantine_count += 1
            stats.spam_count += 1
        elif action == "rejected":
            stats.rejected_count += 1
            stats.spam_count += 1

    async def close(self):
        await self.rspamd.close()
        if self.ai:
            await self.ai.close()
