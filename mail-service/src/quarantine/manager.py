import email
import logging
from datetime import datetime, timedelta, timezone
from email.policy import default as default_policy
from uuid import UUID

import httpx
import smtplib
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from .models import Quarantine, MailLog, Domain

logger = logging.getLogger(__name__)


async def _rspamd_learn(raw_message: bytes, learn_type: str) -> None:
    """Teach rspamd that a message is spam or ham."""
    endpoint = "learnspam" if learn_type == "spam" else "learnham"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password
            resp = await client.post(
                f"{settings.rspamd_controller_url}/{endpoint}",
                content=raw_message,
                headers=headers,
            )
            resp.raise_for_status()
            logger.info("rspamd %s learned successfully", learn_type)
    except Exception as e:
        logger.warning("rspamd %s learn failed: %s", learn_type, e)


class QuarantineManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def store(
        self,
        mail_log_id: UUID,
        raw_message: bytes,
    ) -> Quarantine:
        parsed = email.message_from_bytes(raw_message, policy=default_policy)
        headers = {k: str(v) for k, v in parsed.items()}
        body_preview = ""
        if parsed.get_body(preferencelist=("plain",)):
            body_part = parsed.get_body(preferencelist=("plain",))
            body_preview = body_part.get_content()[:1000] if body_part else ""

        entry = Quarantine(
            mail_log_id=mail_log_id,
            raw_message=raw_message,
            parsed_headers=headers,
            body_preview=body_preview,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.quarantine_retention_days),
        )
        self.session.add(entry)
        await self.session.commit()
        await self.session.refresh(entry)
        logger.info("Quarantined message %s", mail_log_id)
        return entry

    async def approve(self, quarantine_id: UUID, reviewer_id: UUID | None = None) -> bool:
        result = await self.session.execute(
            select(Quarantine).where(Quarantine.id == quarantine_id)
        )
        entry = result.scalar_one_or_none()
        if not entry or entry.status != "pending":
            return False

        # Get the mail log to find the recipient and backend
        result = await self.session.execute(
            select(MailLog).where(MailLog.id == entry.mail_log_id)
        )
        log_entry = result.scalar_one_or_none()
        if not log_entry:
            return False

        # Deliver via Postfix re-inject port (bypasses content filter + rspamd)
        # Postfix handles domain routing to the correct backend server
        try:
            with smtplib.SMTP("postfix", 10025, timeout=30) as smtp:
                smtp.sendmail(
                    log_entry.mail_from or "",
                    log_entry.rcpt_to,
                    entry.raw_message,
                )
        except Exception:
            logger.exception("Failed to deliver quarantined message %s", quarantine_id)
            return False

        entry.status = "approved"
        entry.reviewed_by = reviewer_id
        entry.reviewed_at = datetime.now(timezone.utc)

        log_entry.action = "delivered"

        await self.session.commit()
        logger.info("Released quarantined message %s", quarantine_id)

        # Learn as ham in rspamd (approved = not spam)
        await _rspamd_learn(entry.raw_message, "ham")

        return True

    async def reject(self, quarantine_id: UUID, reviewer_id: UUID | None = None) -> bool:
        result = await self.session.execute(
            select(Quarantine).where(Quarantine.id == quarantine_id)
        )
        entry = result.scalar_one_or_none()
        if not entry or entry.status != "pending":
            return False

        entry.status = "rejected"
        entry.reviewed_by = reviewer_id
        entry.reviewed_at = datetime.now(timezone.utc)
        await self.session.commit()
        logger.info("Rejected quarantined message %s", quarantine_id)

        # Learn as spam in rspamd (rejected = confirmed spam)
        await _rspamd_learn(entry.raw_message, "spam")

        return True

    async def cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc)
        result = await self.session.execute(
            delete(Quarantine).where(
                Quarantine.expires_at < now,
                Quarantine.status == "pending",
            )
        )
        await self.session.commit()
        count = result.rowcount
        if count > 0:
            logger.info("Cleaned up %d expired quarantine entries", count)
        return count

    async def get_pending_count(self) -> int:
        result = await self.session.execute(
            select(func.count()).where(Quarantine.status == "pending")
        )
        return result.scalar() or 0
