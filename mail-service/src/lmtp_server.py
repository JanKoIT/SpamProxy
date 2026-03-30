import asyncio
import email as email_lib
import logging
import re
import smtplib
import time
from datetime import datetime, timezone
from email.policy import default as default_policy

from aiosmtpd.lmtp import LMTP

from .config import settings
from .db import async_session
from .quarantine.models import MailLog, StatsHourly, AccessList, ScoringRule, SenderDomain, KeywordRule
from .quarantine.manager import QuarantineManager
from sqlalchemy import select

logger = logging.getLogger(__name__)

QUARANTINE_THRESHOLD = settings.spam_quarantine_threshold
REJECT_THRESHOLD = settings.spam_reject_threshold


def parse_rspamd_score(parsed_msg) -> tuple[float, dict]:
    score = 0.0
    symbols = {}

    spamd_result = parsed_msg.get("X-Spamd-Result", "")
    if spamd_result:
        spamd_str = str(spamd_result)
        score_match = re.search(r"\[\s*(-?[\d.]+)\s*/\s*[\d.]+\s*\]", spamd_str)
        if score_match:
            try:
                score = float(score_match.group(1))
            except ValueError:
                pass
        for sym_match in re.finditer(r"(\w+)\((-?[\d.]+)\)", spamd_str):
            symbols[sym_match.group(1)] = {"score": float(sym_match.group(2))}

    if score == 0.0:
        spam_score = parsed_msg.get("X-Spam-Score", "")
        if spam_score:
            try:
                score = float(str(spam_score).strip())
            except ValueError:
                pass

    return score, symbols


def extract_client_ip(parsed_msg) -> str:
    received = parsed_msg.get("Received", "")
    if received:
        ip_match = re.search(r"\[(\d+\.\d+\.\d+\.\d+)\]", str(received))
        if ip_match:
            return ip_match.group(1)
    return ""


class ContentFilterHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        start = time.monotonic()
        raw_message = envelope.content
        if isinstance(raw_message, str):
            raw_message = raw_message.encode("utf-8")

        mail_from = envelope.mail_from or ""
        rcpt_to = list(envelope.rcpt_tos)

        try:
            parsed = email_lib.message_from_bytes(raw_message, policy=default_policy)
            subject = str(parsed.get("Subject", ""))[:500]
            message_id = str(parsed.get("Message-ID", ""))
            rspamd_score, rspamd_symbols = parse_rspamd_score(parsed)
            client_ip = extract_client_ip(parsed)
            processing_time = int((time.monotonic() - start) * 1000)

            # Detect outgoing (submission) vs inbound
            is_outgoing = "ORIGINATING" in str(parsed.get("X-Rspamd-Server", "")) or \
                          "sasl_username=" in str(parsed.get("Received", ""))
            direction = "outbound" if is_outgoing else "inbound"

            # For outgoing: check sender domain is verified and active
            if is_outgoing and "@" in mail_from:
                sender_domain = mail_from.split("@")[1].lower()
                async with async_session() as check_db:
                    sd_result = await check_db.execute(
                        select(SenderDomain).where(
                            SenderDomain.domain == sender_domain,
                            SenderDomain.is_verified.is_(True),
                            SenderDomain.is_active.is_(True),
                        )
                    )
                    if not sd_result.scalar_one_or_none():
                        logger.warning(
                            "REJECTED outgoing: sender domain %s not verified",
                            sender_domain,
                        )
                        return f"550 Absenderdomain {sender_domain} ist nicht verifiziert. Bitte im SpamProxy Web-Interface freischalten."

            # Apply whitelist/blacklist and scoring rules
            final_score = rspamd_score
            async with async_session() as db:
                if not is_outgoing:
                    access_action = await self._check_access_lists(db, mail_from, client_ip)
                    if access_action == "whitelist":
                        final_score = -1.0
                    elif access_action == "blacklist":
                        final_score = REJECT_THRESHOLD

                    if access_action is None:
                        score_adj = await self._apply_scoring_rules(db, mail_from)
                        final_score += score_adj

                    # Apply keyword scoring
                    keyword_adj = await self._apply_keyword_rules(
                        db, subject, mail_from, parsed
                    )
                    final_score += keyword_adj

                if final_score >= REJECT_THRESHOLD:
                    action = "rejected"
                elif final_score >= QUARANTINE_THRESHOLD:
                    action = "quarantined"
                else:
                    action = "delivered"

                log_entry = MailLog(
                    message_id=message_id,
                    mail_from=mail_from,
                    rcpt_to=rcpt_to,
                    subject=subject,
                    direction=direction,
                    client_ip=client_ip,
                    size_bytes=len(raw_message),
                    rspamd_score=rspamd_score,
                    final_score=final_score,
                    rspamd_symbols=rspamd_symbols if rspamd_symbols else None,
                    action=action,
                    processing_time_ms=processing_time,
                )
                db.add(log_entry)
                await db.flush()

                if action == "quarantined":
                    qm = QuarantineManager(db)
                    await qm.store(log_entry.id, raw_message)

                await self._update_stats(db, "inbound", action)
                await db.commit()

            logger.info(
                "%s from=%s to=%s subject=%.60s score=%.1f",
                action.upper(), mail_from, rcpt_to, subject, rspamd_score,
            )

            if action == "delivered":
                await asyncio.to_thread(
                    self._reinject, mail_from, rcpt_to, raw_message
                )
                return "250 OK"
            elif action == "quarantined":
                return "250 Message quarantined"
            else:
                return "550 Message rejected as spam"

        except Exception:
            logger.exception("Content filter error")
            try:
                await asyncio.to_thread(
                    self._reinject, mail_from, rcpt_to, raw_message
                )
            except Exception:
                logger.exception("Re-injection also failed")
            return "250 OK (error fallback)"

    async def _apply_keyword_rules(self, session, subject: str, mail_from: str, parsed_msg) -> float:
        """Apply keyword scoring rules."""
        result = await session.execute(
            select(KeywordRule).where(KeywordRule.is_active.is_(True))
        )
        rules = result.scalars().all()
        total_adj = 0.0

        # Extract body for matching
        body = ""
        try:
            body_part = parsed_msg.get_body(preferencelist=("plain",))
            if body_part:
                body = body_part.get_content()[:5000].lower()
        except Exception:
            pass

        subject_lower = (subject or "").lower()
        from_lower = (mail_from or "").lower()

        for rule in rules:
            kw = rule.keyword.lower()
            matched = False

            if rule.match_field == "subject":
                fields = [subject_lower]
            elif rule.match_field == "body":
                fields = [body]
            elif rule.match_field == "from":
                fields = [from_lower]
            else:  # any
                fields = [subject_lower, body, from_lower]

            for field in fields:
                if rule.match_type == "contains":
                    if kw in field:
                        matched = True
                        break
                elif rule.match_type == "exact":
                    if kw == field:
                        matched = True
                        break
                elif rule.match_type == "regex":
                    try:
                        if re.search(rule.keyword, field, re.IGNORECASE):
                            matched = True
                            break
                    except re.error:
                        pass

            if matched:
                total_adj += rule.score_adjustment

        return total_adj

    async def _check_access_lists(self, session, mail_from: str, client_ip: str) -> str | None:
        """Check whitelist/blacklist. Returns 'whitelist', 'blacklist', or None."""
        result = await session.execute(
            select(AccessList).where(AccessList.is_active.is_(True))
        )
        entries = result.scalars().all()

        sender_domain = mail_from.split("@")[1] if "@" in mail_from else ""

        for entry in entries:
            match = False
            if entry.entry_type == "email" and entry.value.lower() == mail_from.lower():
                match = True
            elif entry.entry_type == "domain" and sender_domain.lower().endswith(entry.value.lower().lstrip(".")):
                match = True
            elif entry.entry_type == "ip" and client_ip == entry.value:
                match = True
            elif entry.entry_type == "cidr" and client_ip:
                import ipaddress
                try:
                    if ipaddress.ip_address(client_ip) in ipaddress.ip_network(entry.value, strict=False):
                        match = True
                except ValueError:
                    pass

            if match:
                return entry.list_type

        return None

    async def _apply_scoring_rules(self, session, mail_from: str) -> float:
        """Apply TLD and domain scoring adjustments."""
        result = await session.execute(
            select(ScoringRule).where(ScoringRule.is_active.is_(True))
        )
        rules = result.scalars().all()
        total_adj = 0.0

        sender_domain = mail_from.split("@")[1] if "@" in mail_from else ""

        for rule in rules:
            if rule.rule_type == "tld":
                if sender_domain.lower().endswith(rule.pattern.lower()):
                    total_adj += rule.score_adjustment
            elif rule.rule_type in ("domain", "sender_domain"):
                if sender_domain.lower() == rule.pattern.lower().lstrip("."):
                    total_adj += rule.score_adjustment

        return total_adj

    def _reinject(self, mail_from: str, rcpt_to: list[str], raw_message: bytes):
        with smtplib.SMTP("postfix", 10025, timeout=30) as smtp:
            smtp.sendmail(mail_from, rcpt_to, raw_message)

    async def _update_stats(self, session, direction: str, action: str):
        now = datetime.now(timezone.utc)
        hour = now.replace(minute=0, second=0, microsecond=0)

        result = await session.execute(
            select(StatsHourly).where(StatsHourly.hour == hour)
        )
        stats = result.scalar_one_or_none()

        if not stats:
            stats = StatsHourly(
                hour=hour,
                total_mails=0, inbound_count=0, outbound_count=0,
                spam_count=0, ham_count=0, quarantine_count=0, rejected_count=0,
            )
            session.add(stats)
            await session.flush()

        stats.total_mails = (stats.total_mails or 0) + 1
        if direction == "inbound":
            stats.inbound_count = (stats.inbound_count or 0) + 1
        else:
            stats.outbound_count = (stats.outbound_count or 0) + 1

        if action == "delivered":
            stats.ham_count = (stats.ham_count or 0) + 1
        elif action == "quarantined":
            stats.quarantine_count = (stats.quarantine_count or 0) + 1
            stats.spam_count = (stats.spam_count or 0) + 1
        elif action == "rejected":
            stats.rejected_count = (stats.rejected_count or 0) + 1
            stats.spam_count = (stats.spam_count or 0) + 1


async def start_lmtp_server():
    """Start LMTP server directly in the running asyncio event loop."""
    handler = ContentFilterHandler()

    def factory():
        return LMTP(handler)

    loop = asyncio.get_running_loop()
    server = await loop.create_server(factory, "0.0.0.0", 8024)
    logger.info("Content filter LMTP server listening on port 8024")
    await server.serve_forever()
