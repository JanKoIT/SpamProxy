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
from .scanning.ai_classifier import AIClassifier
from sqlalchemy import select

logger = logging.getLogger(__name__)

QUARANTINE_THRESHOLD = settings.spam_quarantine_threshold
REJECT_THRESHOLD = settings.spam_reject_threshold


def parse_rspamd_score(parsed_msg) -> tuple[float, dict]:
    score = 0.0
    symbols = {}

    # Check ALL X-Spamd-Result headers (mail may have multiple)
    spamd_results = parsed_msg.get_all("X-Spamd-Result") or []
    for spamd_result in spamd_results:
        spamd_str = str(spamd_result)
        score_match = re.search(r"\[\s*(-?[\d.]+)\s*/\s*[\d.]+\s*\]", spamd_str)
        if score_match:
            try:
                score = float(score_match.group(1))
            except ValueError:
                pass
            for sym_match in re.finditer(r"(\w+)\((-?[\d.]+)\)", spamd_str):
                symbols[sym_match.group(1)] = {"score": float(sym_match.group(2))}
            break  # Use first valid result

    # Fallback: X-Spam-Score / X-Spam-Status headers
    if score == 0.0:
        for header_name in ["X-Spam-Score", "X-Spam-Status"]:
            header_val = parsed_msg.get(header_name, "")
            if header_val:
                val_str = str(header_val)
                # X-Spam-Status: Yes, score=6.50
                score_match = re.search(r"score=(-?[\d.]+)", val_str)
                if score_match:
                    try:
                        score = float(score_match.group(1))
                        break
                    except ValueError:
                        pass
                # Plain number
                try:
                    score = float(val_str.strip())
                    break
                except ValueError:
                    pass

    if score == 0.0 and not spamd_results:
        logger.warning("No rspamd headers found - mail may not have been scanned")

    return score, symbols


def extract_client_ip(parsed_msg) -> str:
    """Extract the real external client IP from Received headers."""
    # Get ALL Received headers - the last one is usually the external connection
    received_list = parsed_msg.get_all("Received") or []

    external_ip = ""
    for received in received_list:
        received_str = str(received)
        ip_match = re.search(r"\[(\d+\.\d+\.\d+\.\d+)\]", received_str)
        if ip_match:
            ip = ip_match.group(1)
            # Skip Docker/private IPs, prefer external IPs
            if ip.startswith("172.") or ip.startswith("10.") or ip.startswith("192.168.") or ip == "127.0.0.1":
                if not external_ip:
                    external_ip = ip  # Keep as fallback
            else:
                return ip  # Found external IP

    return external_ip


class ContentFilterHandler:
    def __init__(self):
        self.ai_classifier = AIClassifier() if settings.ai_enabled else None

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

            # For outgoing: check sender domain is verified, active, and has SPF+DKIM
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
                    sd = sd_result.scalar_one_or_none()
                    if not sd:
                        logger.warning(
                            "REJECTED outgoing: sender domain %s not verified",
                            sender_domain,
                        )
                        return f"550 Sender domain {sender_domain} is not verified. Please activate it in the SpamProxy web interface."

                    # Auto-refresh DNS status if stale (older than 1 hour)
                    if not sd.last_dns_check or \
                       (datetime.now(timezone.utc) - sd.last_dns_check.replace(tzinfo=timezone.utc)).total_seconds() > 3600:
                        try:
                            from .api import _check_spf, _check_dkim, Setting
                            proxy_hostname = "localhost"
                            s_result = await check_db.execute(
                                select(Setting).where(Setting.key == "proxy_hostname")
                            )
                            s = s_result.scalar_one_or_none()
                            if s and s.value:
                                proxy_hostname = str(s.value).strip('"')

                            spf_st, spf_rec, spf_inc = _check_spf(sender_domain, proxy_hostname)
                            sd.spf_status = spf_st
                            sd.spf_record = spf_rec
                            sd.spf_includes_proxy = spf_inc

                            dkim_sel = sd.dkim_selector or "spamproxy"
                            dkim_st, dkim_rec = _check_dkim(sender_domain, dkim_sel)
                            sd.dkim_status = dkim_st
                            sd.dkim_record = dkim_rec

                            sd.last_dns_check = datetime.now(timezone.utc)
                            await check_db.commit()
                            logger.info("Auto DNS check for %s: SPF=%s(proxy=%s) DKIM=%s",
                                       sender_domain, spf_st, spf_inc, dkim_st)
                        except Exception:
                            logger.warning("Auto DNS check failed for %s", sender_domain)

                    # Check SPF includes proxy
                    if not sd.spf_includes_proxy:
                        logger.warning(
                            "REJECTED outgoing: sender domain %s SPF does not include proxy",
                            sender_domain,
                        )
                        return f"550 Sender domain {sender_domain}: SPF record does not include the proxy server. Add the proxy to your SPF record."

                    # Check DKIM is configured
                    if sd.dkim_status != "ok":
                        logger.warning(
                            "REJECTED outgoing: sender domain %s has no DKIM record",
                            sender_domain,
                        )
                        return f"550 Sender domain {sender_domain}: DKIM record not found. Generate a DKIM key in the SpamProxy web interface and add the DNS record."

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

                    # Apply mailing list / Google Groups scoring
                    list_adj = self._check_mailing_list(parsed)
                    final_score += list_adj

                # AI classification for grey zone
                ai_score = None
                ai_reason = ""
                if (
                    self.ai_classifier
                    and settings.ai_enabled
                    and settings.ai_grey_zone_min <= final_score <= settings.ai_grey_zone_max
                ):
                    try:
                        ai_score, ai_reason = await self.ai_classifier.classify(raw_message)
                        # Weighted: 60% rspamd+rules, 40% AI
                        final_score = (final_score * 0.6) + (ai_score * 0.4)
                        logger.info("AI score=%.1f reason=%s final=%.1f", ai_score, ai_reason, final_score)
                    except Exception:
                        logger.warning("AI classification failed, using rspamd score only")

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
                    ai_score=ai_score,
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

    def _check_mailing_list(self, parsed_msg) -> float:
        """Check for Google Groups and mailing list headers, return score adjustment."""
        score = 0.0

        is_google_group = False
        is_mailing_list = False

        # Google Groups detection
        if parsed_msg.get("X-Google-Group-Id"):
            is_google_group = True
        list_unsub = str(parsed_msg.get("List-Unsubscribe", "")).lower()
        if "googlegroups" in list_unsub:
            is_google_group = True
        list_post = str(parsed_msg.get("List-Post", "")).lower()
        if "googlegroups" in list_post:
            is_google_group = True

        # General mailing list detection
        if parsed_msg.get("List-Id") or parsed_msg.get("List-Unsubscribe"):
            is_mailing_list = True
        precedence = str(parsed_msg.get("Precedence", "")).lower()
        if precedence in ("bulk", "list"):
            is_mailing_list = True

        # Google Groups + freemail sender = very likely spam
        if is_google_group:
            from_header = str(parsed_msg.get("From", "")).lower()
            freemail_domains = [
                "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
                "mail.ru", "yandex.ru", "qq.com", "163.com", "aol.com",
                "protonmail.com", "icloud.com",
            ]
            for domain in freemail_domains:
                if domain in from_header:
                    score += 6.0  # Google Groups + freemail = spam
                    logger.info("Google Groups spam detected (freemail sender)")
                    break
            else:
                score += 2.0  # Google Groups from non-freemail, still suspicious

        # Bulk mail without proper List-Id
        if precedence == "bulk" and not parsed_msg.get("List-Id"):
            score += 3.0

        return score

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
