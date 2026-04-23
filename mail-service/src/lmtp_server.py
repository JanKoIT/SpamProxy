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
from .quarantine.models import MailLog, StatsHourly, AccessList, ScoringRule, SenderDomain, KeywordRule, Setting, Domain
from .quarantine.manager import QuarantineManager, _rspamd_learn
from .scanning.ai_classifier import AIClassifier
from sqlalchemy import select

logger = logging.getLogger(__name__)


def parse_rspamd_score(parsed_msg) -> tuple[float, dict]:
    score = 0.0
    symbols = {}
    found_header = False

    # Try all known rspamd header names (case-insensitive via email lib)
    header_names = [
        "X-Spamd-Result",
        "X-Spam-Result",
        "X-Rspamd-Result",
        "X-Spam-Status",
        "X-Spam-Score",
    ]

    for hname in header_names:
        values = parsed_msg.get_all(hname) or []
        for raw in values:
            val_str = str(raw).replace("\n", " ").replace("\r", " ").replace("\t", " ")
            found_header = True

            # Format 1: "default: False [3.50 / 15.00]; SYMBOL(0.5)[..]"
            m = re.search(r"\[\s*(-?[\d.]+)\s*/\s*[\d.]+\s*\]", val_str)
            if m:
                try:
                    score = float(m.group(1))
                except ValueError:
                    pass

            # Format 2: "score=6.50"
            if score == 0.0:
                m = re.search(r"score=(-?[\d.]+)", val_str)
                if m:
                    try:
                        score = float(m.group(1))
                    except ValueError:
                        pass

            # Format 3: plain number "6.50"
            if score == 0.0:
                try:
                    score = float(val_str.strip())
                except ValueError:
                    pass

            # Extract symbols (any format with PARENS)
            for sym_match in re.finditer(r"([A-Z][A-Z0-9_]+)\((-?[\d.]+)\)", val_str):
                try:
                    symbols[sym_match.group(1)] = {"score": float(sym_match.group(2))}
                except ValueError:
                    pass

            if score != 0.0:
                break
        if score != 0.0:
            break

    if not found_header:
        # Log the headers we DID find for debugging
        all_headers = sorted(set(parsed_msg.keys()))
        logger.warning(
            "No rspamd headers found. Available headers: %s",
            ", ".join(h for h in all_headers if "spam" in h.lower() or "rspam" in h.lower()) or "(none related)",
        )

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
                            from .api import _check_spf, _check_dkim
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
                # Spoofing detection: inbound mail claiming to be from a local domain
                # is always spoofing (legit outbound uses SASL auth on port 587).
                if not is_outgoing and mail_from and "@" in mail_from:
                    sender_domain = mail_from.split("@")[1].lower()
                    local_dom = await db.execute(
                        select(Domain).where(Domain.domain == sender_domain)
                    )
                    if local_dom.scalar_one_or_none():
                        logger.warning(
                            "REJECTED: inbound mail spoofing local domain %s from %s",
                            sender_domain, client_ip,
                        )
                        log_entry = MailLog(
                            message_id=message_id, mail_from=mail_from,
                            rcpt_to=rcpt_to, subject=subject, direction="inbound",
                            client_ip=client_ip, size_bytes=len(raw_message),
                            rspamd_score=rspamd_score, final_score=99.0,
                            rspamd_symbols=rspamd_symbols or None,
                            action="rejected",
                            processing_time_ms=int((time.monotonic() - start) * 1000),
                        )
                        db.add(log_entry)
                        await self._update_stats(db, "inbound", "rejected")
                        await db.commit()
                        return f"550 5.7.1 Rejected: inbound mail claiming local domain {sender_domain} from external IP {client_ip}. Use authenticated submission (port 587) for outgoing mail."

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
                    list_adj = self._check_mailing_list(
                        parsed, mail_from, client_ip, rspamd_symbols
                    )
                    final_score += list_adj

                    # Fake bounce detection: empty sender without real DSN
                    fake_bounce_adj = self._check_fake_bounce(parsed, mail_from)
                    final_score += fake_bounce_adj

                    # Multi-recipient detection: same mail to many mailboxes
                    multi_rcpt_adj = self._check_multi_recipient(rcpt_to)
                    final_score += multi_rcpt_adj

                    # Check sender auth (rDNS, DKIM, SPF) - may hard-reject
                    auth_result = await self._check_sender_auth(
                        db, rspamd_symbols, mail_from, client_ip, log_extras={
                            "message_id": message_id, "subject": subject,
                            "direction": direction, "client_ip": client_ip,
                            "size_bytes": len(raw_message), "rspamd_score": rspamd_score,
                            "rspamd_symbols": rspamd_symbols or None,
                            "processing_time_ms": int((time.monotonic() - start) * 1000),
                        }
                    )
                    if isinstance(auth_result, str):
                        # Hard rejection - log and return
                        log_entry = MailLog(
                            message_id=message_id, mail_from=mail_from,
                            rcpt_to=rcpt_to, subject=subject, direction=direction,
                            client_ip=client_ip, size_bytes=len(raw_message),
                            rspamd_score=rspamd_score, final_score=99.0,
                            rspamd_symbols=rspamd_symbols or None,
                            action="rejected",
                            processing_time_ms=int((time.monotonic() - start) * 1000),
                        )
                        db.add(log_entry)
                        await self._update_stats(db, "inbound", "rejected")
                        await db.commit()
                        return auth_result
                    final_score += auth_result

                # Check if sender is known (first-time sender detection)
                is_first_sender = False
                force_ai = False
                if not is_outgoing:
                    if mail_from:
                        is_first_sender = await self._track_sender(db, mail_from, final_score)
                        if is_first_sender:
                            # Check if "AI scan first sender" setting is enabled
                            ai_first_result = await db.execute(
                                select(Setting).where(Setting.key == "ai_scan_first_sender")
                            )
                            ai_first_setting = ai_first_result.scalar_one_or_none()
                            if ai_first_setting and (ai_first_setting.value is True or ai_first_setting.value == "true"):
                                force_ai = True
                    elif not mail_from:
                        # Empty sender (bounce) - force AI if it looks suspicious
                        force_ai = fake_bounce_adj > 0

                # AI classification: grey zone OR first-time sender
                ai_score = None
                ai_reason = ""
                should_ai_scan = (
                    self.ai_classifier
                    and settings.ai_enabled
                    and (
                        (settings.ai_grey_zone_min <= final_score <= settings.ai_grey_zone_max)
                        or force_ai
                    )
                )
                if should_ai_scan:
                    try:
                        ai_score, ai_reason = await self.ai_classifier.classify(raw_message)

                        # Load configurable weights from DB
                        rspamd_weight, ai_confidence_thr, ai_floor_off = await self._load_weights(db)
                        ai_weight = 1.0 - rspamd_weight

                        weighted = (final_score * rspamd_weight) + (ai_score * ai_weight)

                        # If AI has high spam confidence, don't let a low rspamd
                        # score dilute it below quarantine threshold.
                        if ai_score >= ai_confidence_thr:
                            final_score = max(weighted, ai_score - ai_floor_off)
                        else:
                            final_score = weighted

                        reason_prefix = "[FIRST SENDER] " if force_ai else ""
                        logger.info("%sAI score=%.1f reason=%s final=%.1f (weights: rspamd=%.1f, ai=%.1f)",
                                   reason_prefix, ai_score, ai_reason, final_score,
                                   rspamd_weight, ai_weight)
                    except Exception:
                        logger.warning("AI classification failed, using rspamd score only")

                # Determine action based on score
                # "discarded" = silently dropped (no bounce, protects reputation)
                # "rejected" = bounced back (only for moderate spam)
                is_spoofed_sender = (
                    mail_from and rcpt_to and
                    mail_from.lower() == rcpt_to[0].lower()
                ) if rcpt_to else False

                # Load thresholds dynamically from DB (editable via UI)
                quar_thr, rej_thr, learn_rejected = await self._load_thresholds(db)

                if final_score >= rej_thr:
                    if final_score >= rej_thr * 1.5 or is_spoofed_sender:
                        # Very high score or spoofed From=To: silently discard
                        # No bounce = no backscatter = protects reputation
                        action = "discarded"
                    else:
                        action = "rejected"
                elif final_score >= quar_thr:
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

            # Auto-learn as spam if rejected/discarded (trains Bayes with
            # high-confidence spam decisions). Fire-and-forget so we don't
            # block SMTP response on rspamd learn endpoint.
            if action in ("rejected", "discarded") and learn_rejected:
                asyncio.create_task(_rspamd_learn(raw_message, "spam"))

            if action == "delivered":
                await asyncio.to_thread(
                    self._reinject, mail_from, rcpt_to, raw_message
                )
                return "250 OK"
            elif action == "quarantined":
                return "250 Message quarantined"
            elif action == "discarded":
                # Silent discard - accept but don't deliver (no bounce)
                logger.info("DISCARDED (no bounce) score=%.1f spoofed=%s", final_score, is_spoofed_sender)
                return "250 OK"
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

    def _check_fake_bounce(self, parsed_msg, mail_from: str) -> float:
        """Detect fake bounces: empty envelope sender without real DSN content."""
        if mail_from:
            return 0.0

        # Real DSN/bounce messages have Content-Type: multipart/report
        content_type = str(parsed_msg.get("Content-Type", "")).lower()
        if "multipart/report" in content_type or "delivery-status" in content_type:
            return 0.0

        # Also allow auto-replies (Auto-Submitted header)
        auto_submitted = str(parsed_msg.get("Auto-Submitted", "")).lower()
        if auto_submitted and auto_submitted != "no":
            return 0.0

        # Empty sender + no DSN = suspicious fake bounce / phishing
        logger.info("Fake bounce detected: empty sender without DSN content type")
        return 5.0

    def _check_multi_recipient(self, rcpt_to: list[str]) -> float:
        """Score boost when the same mail targets multiple mailboxes."""
        if len(rcpt_to) <= 1:
            return 0.0

        # Count unique local parts (different mailboxes)
        unique_locals = set()
        for addr in rcpt_to:
            local = addr.split("@")[0].lower() if "@" in addr else addr.lower()
            unique_locals.add(local)

        if len(unique_locals) <= 1:
            return 0.0

        # +1.5 per extra recipient (2 recipients = +1.5, 3 = +3.0, etc.)
        adj = (len(unique_locals) - 1) * 1.5
        logger.info("Multi-recipient mail: %d unique mailboxes → +%.1f score",
                     len(unique_locals), adj)
        return adj

    async def _check_sender_auth(self, session, rspamd_symbols: dict,
                                 mail_from: str, client_ip: str,
                                 log_extras: dict = None) -> float | str:
        """Check rspamd symbols for missing rDNS, DKIM, SPF.

        Returns a float score adjustment, or a '550 ...' rejection string
        if hard-reject is enabled for the failing check.
        """
        # Load all auth settings at once
        auth_keys = [
            "reject_auth_failures", "reject_no_rdns", "reject_no_spf",
        ]
        result = await session.execute(
            select(Setting).where(Setting.key.in_(auth_keys))
        )
        cfg = {}
        for s in result.scalars():
            cfg[s.key] = s.value is True or s.value == "true"

        if not cfg.get("reject_auth_failures", True):
            return 0.0

        hard_reject_rdns = cfg.get("reject_no_rdns", False)
        hard_reject_spf = cfg.get("reject_no_spf", False)

        # --- Hard rejections (before scoring) ---

        has_no_rdns = "RDNS_NONE" in rspamd_symbols or "HFILTER_HOSTNAME_UNKNOWN" in rspamd_symbols
        spf_fail = "R_SPF_FAIL" in rspamd_symbols
        spf_none = "R_SPF_NA" in rspamd_symbols

        if hard_reject_rdns and has_no_rdns:
            logger.warning("REJECTED: no reverse DNS from %s for <%s>", client_ip, mail_from)
            return f"550 5.7.25 Rejected: sending server {client_ip} has no reverse DNS (rDNS). Configure a valid PTR record."

        if hard_reject_spf and spf_fail:
            sender_domain = mail_from.split("@")[1] if "@" in mail_from else "unknown"
            logger.warning("REJECTED: SPF hard fail from %s for <%s>", client_ip, mail_from)
            return f"550 5.7.23 Rejected: SPF validation failed for {sender_domain}. The sending server is not authorized."

        if hard_reject_spf and spf_none and mail_from:
            sender_domain = mail_from.split("@")[1] if "@" in mail_from else "unknown"
            logger.warning("REJECTED: no SPF record from %s for <%s>", client_ip, mail_from)
            return f"550 5.7.23 Rejected: no SPF record found for {sender_domain}. Add an SPF DNS record."

        # --- Soft scoring (score adjustments) ---
        adj = 0.0

        # No reverse DNS
        if has_no_rdns:
            adj += 4.0
            logger.info("No reverse DNS for sender → +4.0")

        # SPF fail
        if spf_fail:
            adj += 3.0
            logger.info("SPF hard fail → +3.0")
        elif "R_SPF_SOFTFAIL" in rspamd_symbols:
            adj += 1.5
            logger.info("SPF soft fail → +1.5")
        elif spf_none:
            adj += 1.0
            logger.info("No SPF record → +1.0")

        # DKIM fail or missing
        if "R_DKIM_REJECT" in rspamd_symbols:
            adj += 3.0
            logger.info("DKIM signature failed → +3.0")
        elif "DKIM_NONE" in rspamd_symbols or "R_DKIM_NA" in rspamd_symbols:
            adj += 1.0
            logger.info("No DKIM signature → +1.0")

        # Combined: no rDNS + no SPF + no DKIM = very suspicious
        has_no_dkim = "DKIM_NONE" in rspamd_symbols or "R_DKIM_NA" in rspamd_symbols or "R_DKIM_REJECT" in rspamd_symbols
        if has_no_rdns and (spf_fail or spf_none) and has_no_dkim:
            adj += 3.0
            logger.info("No rDNS + no SPF + no DKIM → extra +3.0 (unauthenticated sender)")

        return adj

    def _check_mailing_list(self, parsed_msg, mail_from: str = "",
                             client_ip: str = "",
                             rspamd_symbols: dict | None = None) -> float:
        """Check for Google Groups and mailing list headers, return score adjustment."""
        score = 0.0
        rspamd_symbols = rspamd_symbols or {}

        is_google_group = False
        is_google_infra = False
        is_mailing_list = False

        # --- Google Groups / Google mailer infrastructure detection ---

        # 1. Explicit Google Groups headers
        if parsed_msg.get("X-Google-Group-Id"):
            is_google_group = True
        list_unsub = str(parsed_msg.get("List-Unsubscribe", "")).lower()
        if "googlegroups" in list_unsub:
            is_google_group = True
        list_post = str(parsed_msg.get("List-Post", "")).lower()
        if "googlegroups" in list_post:
            is_google_group = True

        # 2. Google Groups bounce-classifier envelope pattern (e.g. +bncBDK...)
        if mail_from and "+bnc" in mail_from.lower():
            is_google_group = True
            logger.info("Google Groups +bnc envelope pattern: %s", mail_from)

        # 3. Client IP in Google's mail sending ranges
        if client_ip:
            google_prefixes = (
                "209.85.", "64.233.", "66.102.", "66.249.",
                "72.14.", "74.125.", "108.177.", "172.217.",
                "173.194.", "216.58.", "216.239.",
            )
            if any(client_ip.startswith(p) for p in google_prefixes):
                is_google_infra = True

        # 4. Message-ID from Google mailer but From is not Gmail
        msg_id = str(parsed_msg.get("Message-ID", "")).lower()
        from_header = str(parsed_msg.get("From", "")).lower()
        if "mail.gmail.com" in msg_id and "gmail.com" not in from_header \
                and "googlemail.com" not in from_header:
            is_google_infra = True
            logger.info("Google mailer Message-ID with non-Gmail From")

        # 5. rspamd forged maillist symbols are strong spam indicators
        forged_maillist = (
            "FORGED_SENDER_MAILLIST" in rspamd_symbols
            or "FORGED_RECIPIENTS_MAILLIST" in rspamd_symbols
        )

        # General mailing list detection
        if parsed_msg.get("List-Id") or parsed_msg.get("List-Unsubscribe"):
            is_mailing_list = True
        precedence = str(parsed_msg.get("Precedence", "")).lower()
        if precedence in ("bulk", "list"):
            is_mailing_list = True

        # --- Scoring ---

        if is_google_group or is_google_infra:
            freemail_domains = [
                "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
                "mail.ru", "yandex.ru", "qq.com", "163.com", "aol.com",
                "protonmail.com", "icloud.com", "googlemail.com",
            ]
            is_freemail = any(d in from_header for d in freemail_domains)

            if is_freemail:
                score += 6.0
                logger.info("Google Groups spam: freemail sender → +6.0")
            elif forged_maillist:
                # Forged sender on Google infra = almost certainly spam
                score += 6.0
                logger.info("Google infra + forged maillist symbols → +6.0")
            elif is_google_group:
                # Explicit Google Groups from non-freemail, still suspicious
                score += 3.0
                logger.info("Google Groups (non-freemail) → +3.0")
            else:
                # Google infra only (no explicit Group headers) - moderate
                score += 1.5
                logger.info("Google mailer infrastructure → +1.5")

        # Forged mailing list headers without Google Groups (rare but spammy)
        elif forged_maillist:
            score += 4.0
            logger.info("Forged mailing list headers → +4.0")

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

    async def _load_thresholds(self, session) -> tuple[float, float, bool]:
        """Load quarantine/reject thresholds + auto-learn flag from DB."""
        keys = ["spam_quarantine_threshold", "spam_reject_threshold",
                "auto_learn_rejected_spam"]
        defaults = {
            "spam_quarantine_threshold": settings.spam_quarantine_threshold,
            "spam_reject_threshold": settings.spam_reject_threshold,
            "auto_learn_rejected_spam": True,
        }
        result = await session.execute(
            select(Setting).where(Setting.key.in_(keys))
        )
        values = dict(defaults)
        for s in result.scalars():
            if s.key == "auto_learn_rejected_spam":
                values[s.key] = s.value is True or s.value == "true"
            else:
                try:
                    values[s.key] = float(s.value)
                except (ValueError, TypeError):
                    pass

        # Sanity: reject threshold must be >= quarantine threshold
        quar = values["spam_quarantine_threshold"]
        rej = max(values["spam_reject_threshold"], quar)
        return quar, rej, values["auto_learn_rejected_spam"]

    async def _load_weights(self, session) -> tuple[float, float, float]:
        """Load AI scoring weights from settings.
        Returns (rspamd_weight, ai_confidence_threshold, ai_floor_offset)."""
        keys = ["score_rspamd_weight", "ai_confidence_threshold", "ai_floor_offset"]
        defaults = {"score_rspamd_weight": 0.6, "ai_confidence_threshold": 6.0, "ai_floor_offset": 1.0}

        result = await session.execute(
            select(Setting).where(Setting.key.in_(keys))
        )
        values = dict(defaults)
        for s in result.scalars():
            try:
                values[s.key] = float(s.value)
            except (ValueError, TypeError):
                pass

        rw = max(0.0, min(1.0, values["score_rspamd_weight"]))  # clamp to [0, 1]
        return rw, values["ai_confidence_threshold"], values["ai_floor_offset"]

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

    async def _track_sender(self, session, mail_from: str, score: float) -> bool:
        """Track sender and return True if this is a first-time sender."""
        from sqlalchemy import text as sql_text
        sender = mail_from.lower().strip()
        if not sender:
            return False

        result = await session.execute(
            sql_text("SELECT mail_count FROM known_senders WHERE sender = :s"),
            {"s": sender},
        )
        row = result.first()

        if row:
            # Known sender - update stats
            await session.execute(
                sql_text(
                    "UPDATE known_senders SET last_seen = NOW(), mail_count = mail_count + 1, "
                    "avg_score = (avg_score * (mail_count - 1) + :score) / mail_count "
                    "WHERE sender = :s"
                ),
                {"s": sender, "score": score},
            )
            return False
        else:
            # First-time sender
            await session.execute(
                sql_text(
                    "INSERT INTO known_senders (sender, first_seen, last_seen, mail_count, avg_score, was_ai_scanned) "
                    "VALUES (:s, NOW(), NOW(), 1, :score, true) "
                    "ON CONFLICT (sender) DO NOTHING"
                ),
                {"s": sender, "score": score},
            )
            logger.info("First-time sender: %s (score=%.1f)", sender, score)
            return True

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
