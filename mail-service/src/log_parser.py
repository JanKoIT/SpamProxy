"""
Parses Postfix mail.log for delivery status (sent, bounced, deferred, rejected)
and stores results in the delivery_status table.
"""

import asyncio
import logging
import os
import re
from datetime import datetime, timezone

from sqlalchemy import select, text
from .db import async_session
from .quarantine.models import Base

logger = logging.getLogger(__name__)

LOG_PATH = "/var/log/postfix/mail.log"
STATE_FILE = "/var/lib/spamproxy/bayes-training/log_parser_offset.txt"

# Match: postfix/smtp[PID]: QUEUEID: to=<addr>, relay=host, ..., dsn=X.Y.Z, status=STATUS (reason)
DELIVERY_RE = re.compile(
    r"postfix/smtp\[\d+\]: ([A-F0-9]+): "
    r"to=<([^>]*)>, "
    r"relay=([^,]*), "
    r".*?"
    r"dsn=([0-9.]+), "
    r"status=(\w+) "
    r"\((.+)\)$"
)

# Match: postfix/smtp[PID]: QUEUEID: to=<addr> ... status=bounced
BOUNCE_RE = re.compile(
    r"postfix/smtp\[\d+\]: ([A-F0-9]+): "
    r"to=<([^>]*)>.*"
    r"status=(bounced|deferred) "
    r"\((.+)\)$"
)

# Match sender from cleanup line: postfix/cleanup[PID]: QUEUEID: message-id=...
# or from qmgr: postfix/qmgr[PID]: QUEUEID: from=<sender>
SENDER_RE = re.compile(
    r"postfix/qmgr\[\d+\]: ([A-F0-9]+): from=<([^>]*)>"
)


def _get_offset() -> int:
    try:
        return int(open(STATE_FILE).read().strip())
    except (FileNotFoundError, ValueError):
        return 0


def _set_offset(offset: int):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        f.write(str(offset))


async def parse_postfix_log():
    """Parse new lines from Postfix log and store delivery status."""
    if not os.path.exists(LOG_PATH):
        return 0

    offset = _get_offset()
    file_size = os.path.getsize(LOG_PATH)

    # Log rotated? Reset offset
    if offset > file_size:
        offset = 0

    if offset >= file_size:
        return 0

    # Track senders by queue_id
    senders: dict[str, str] = {}
    deliveries: list[dict] = []

    with open(LOG_PATH, "r", errors="replace") as f:
        f.seek(offset)
        for line in f:
            line = line.strip()

            # Track senders
            m = SENDER_RE.search(line)
            if m:
                senders[m.group(1)] = m.group(2)

            # Track deliveries
            m = DELIVERY_RE.search(line)
            if m:
                queue_id, rcpt, relay, dsn, status, reason = m.groups()
                if status in ("sent", "bounced", "deferred"):
                    deliveries.append({
                        "queue_id": queue_id,
                        "rcpt_to": rcpt,
                        "relay": relay,
                        "dsn": dsn,
                        "status": status,
                        "delay_reason": reason if status != "sent" else None,
                        "mail_from": senders.get(queue_id, ""),
                    })

        new_offset = f.tell()

    if not deliveries:
        _set_offset(new_offset)
        return 0

    # Store in DB
    inserted = 0
    async with async_session() as session:
        for d in deliveries:
            # Avoid duplicates (same queue_id + rcpt + status)
            existing = await session.execute(
                text(
                    "SELECT 1 FROM delivery_status WHERE queue_id = :qid AND rcpt_to = :rcpt AND status = :status LIMIT 1"
                ),
                {"qid": d["queue_id"], "rcpt": d["rcpt_to"], "status": d["status"]},
            )
            if existing.first():
                continue

            await session.execute(
                text(
                    "INSERT INTO delivery_status (queue_id, mail_from, rcpt_to, status, dsn, relay, delay_reason) "
                    "VALUES (:qid, :from, :rcpt, :status, :dsn, :relay, :reason)"
                ),
                {
                    "qid": d["queue_id"],
                    "from": d["mail_from"],
                    "rcpt": d["rcpt_to"],
                    "status": d["status"],
                    "dsn": d["dsn"],
                    "relay": d["relay"],
                    "reason": d["delay_reason"],
                },
            )
            inserted += 1

        await session.commit()

    _set_offset(new_offset)
    if inserted > 0:
        logger.info("Parsed %d delivery status entries from Postfix log", inserted)
    return inserted


async def run_log_parser():
    """Background task: parse Postfix logs every 30 seconds."""
    await asyncio.sleep(10)
    while True:
        try:
            await parse_postfix_log()
        except Exception:
            logger.exception("Log parser error")
        await asyncio.sleep(30)
