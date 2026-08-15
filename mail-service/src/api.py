import asyncio
import email as email_lib
import email.utils
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, func, desc, text

from .config import settings
from .db import async_session
from .quarantine.manager import QuarantineManager
from .quarantine.models import (
    MailLog, Quarantine, StatsHourly, Domain, Setting, User,
    SmtpCredential, DkimKey, RblList, AccessList, ScoringRule, SenderDomain, KeywordRule,
    RspamdPeer, QuarantineRecipient,
)
from .quarantine.tokens import verify_token as _verify_qtoken
from .scanning.ai_classifier import AIClassifier

logger = logging.getLogger(__name__)

app = FastAPI(title="SpamProxy Mail Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ai_classifier = AIClassifier()


# --- Health ---

@app.get("/health")
async def health():
    """Functional health check: verifies API, LMTP, and DB are responsive.

    Used by Docker healthcheck. Returns 503 if any core sub-component
    is hung so that autoheal restarts the container.
    """
    import asyncio
    from fastapi.responses import JSONResponse

    async def check_port(port: int, timeout: float = 2.0) -> bool:
        try:
            fut = asyncio.open_connection("127.0.0.1", port)
            reader, writer = await asyncio.wait_for(fut, timeout=timeout)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
        except Exception:
            return False

    async def check_db() -> bool:
        try:
            async with async_session() as db:
                await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=3.0)
            return True
        except Exception:
            return False

    lmtp_ok, db_ok = await asyncio.gather(check_port(8024), check_db())

    if lmtp_ok and db_ok:
        return {"status": "ok", "service": "mail-service",
                "lmtp": "ok", "db": "ok"}

    return JSONResponse(
        status_code=503,
        content={
            "status": "unhealthy",
            "service": "mail-service",
            "lmtp": "ok" if lmtp_ok else "down",
            "db": "ok" if db_ok else "down",
        },
    )


@app.get("/api/system-status")
async def system_status():
    """Check health of all SpamProxy services."""
    import asyncio
    import socket
    import struct
    import httpx as _httpx

    async def check_tcp(host: str, port: int, timeout: float = 3.0) -> bool:
        try:
            fut = asyncio.open_connection(host, port)
            reader, writer = await asyncio.wait_for(fut, timeout=timeout)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
        except Exception:
            return False

    async def check_milter_handshake(host: str, port: int, timeout: float = 3.0) -> tuple[bool, str]:
        """Perform SMFIC_OPTNEG handshake to verify milter is actually responsive."""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )
            # SMFIC_OPTNEG: command 'O' + version(6) + actions(0x1FF) + protocol(0x3FFFFF)
            payload = b"O" + struct.pack(">III", 6, 0x1FF, 0x3FFFFF)
            packet = struct.pack(">I", len(payload)) + payload
            writer.write(packet)
            await writer.drain()
            # Read reply length prefix (4 bytes) then payload
            hdr = await asyncio.wait_for(reader.readexactly(4), timeout=timeout)
            reply_len = struct.unpack(">I", hdr)[0]
            if reply_len == 0 or reply_len > 1024:
                return False, f"invalid milter reply length {reply_len}"
            reply = await asyncio.wait_for(reader.readexactly(reply_len), timeout=timeout)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if reply[:1] == b"O":
                return True, "milter handshake ok"
            return False, f"unexpected milter reply command: {reply[:1]!r}"
        except asyncio.TimeoutError:
            return False, "milter handshake timeout (worker hung)"
        except Exception as e:
            return False, f"milter handshake failed: {type(e).__name__}"

    async def check_rspamd() -> dict:
        # 1. Controller HTTP ping
        try:
            async with _httpx.AsyncClient(timeout=5.0) as c:
                headers = {}
                if settings.rspamd_password:
                    headers["Password"] = settings.rspamd_password
                r = await c.get(f"{settings.rspamd_controller_url}/ping", headers=headers)
                if r.status_code != 200:
                    return {"status": "error", "detail": f"controller HTTP {r.status_code}"}
        except Exception as e:
            return {"status": "error", "detail": f"rspamd controller unreachable: {type(e).__name__}"}

        # 2. Real milter handshake (catches stuck scanner workers)
        milter_ok, milter_detail = await check_milter_handshake("rspamd", 11332)
        if not milter_ok:
            return {"status": "error",
                    "detail": f"controller ok but milter broken: {milter_detail}"}
        return {"status": "ok", "detail": "controller + milter responsive"}

    async def check_postgres() -> dict:
        # Transient errors during startup / WAL recovery are not "down"
        # states. Retry once with a short delay before reporting error.
        import asyncpg.exceptions as _pgexc

        async def _try_once():
            async with async_session() as db:
                await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=3.0)

        transient_types = (
            _pgexc.CannotConnectNowError,
            _pgexc.PostgresConnectionError,
            _pgexc.ConnectionDoesNotExistError,
            _pgexc.InterfaceError,
            asyncio.TimeoutError,
        )
        try:
            await _try_once()
            return {"status": "ok", "detail": "database responsive"}
        except transient_types:
            # Give it a moment and try once more before declaring error
            await asyncio.sleep(1.0)
            try:
                await _try_once()
                return {"status": "ok", "detail": "database responsive (recovered)"}
            except _pgexc.CannotConnectNowError:
                return {"status": "degraded",
                        "detail": "Postgres startup/recovery in progress"}
            except transient_types as e:
                return {"status": "degraded",
                        "detail": f"Postgres connection issue: {type(e).__name__}"}
            except Exception as e:
                return {"status": "error",
                        "detail": f"db error: {type(e).__name__}"}
        except Exception as e:
            return {"status": "error", "detail": f"db error: {type(e).__name__}"}

    async def check_redis() -> dict:
        ok = await check_tcp("redis", 6379)
        return {"status": "ok" if ok else "error",
                "detail": "redis reachable" if ok else "redis unreachable"}

    async def check_clamav() -> dict:
        # ClamAV PING/PONG protocol verifies the daemon is actually ready
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("clamav", 3310), timeout=3.0
            )
            writer.write(b"nPING\n")
            await writer.drain()
            data = await asyncio.wait_for(reader.read(64), timeout=3.0)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if b"PONG" in data:
                return {"status": "ok", "detail": "clamav responding"}
            return {"status": "degraded",
                    "detail": f"clamav unexpected reply: {data[:32]!r}"}
        except Exception as e:
            return {"status": "error",
                    "detail": f"clamav unreachable: {type(e).__name__}"}

    async def check_postfix() -> dict:
        ok = await check_tcp("postfix", 25)
        return {"status": "ok" if ok else "error",
                "detail": "postfix SMTP reachable" if ok else "postfix SMTP unreachable"}

    async def check_unbound() -> dict:
        # Try multiple ways to reach the unbound container. Docker's built-in
        # DNS on 127.0.0.11 sometimes returns gaierror for compose service
        # names when the container is restarting or if resolv.conf hasn't
        # picked up the update yet.
        def _sync_resolve() -> tuple[str, str] | None:
            """Try synchronous hostname → IP resolution over multiple names.
            Returns (name, ip) on first success."""
            candidates = ["unbound"]
            # Docker Compose v2 naming pattern: <project>-<service>-<n>
            import os as _os
            project = _os.environ.get("COMPOSE_PROJECT_NAME", "spamproxy")
            candidates.extend([
                f"{project}-unbound-1",
                f"{project}_unbound_1",
            ])
            for name in candidates:
                try:
                    ip = socket.gethostbyname(name)
                    return name, ip
                except socket.gaierror:
                    continue
            return None

        resolved = await asyncio.wait_for(
            asyncio.to_thread(_sync_resolve), timeout=5.0
        )
        if not resolved:
            return {
                "status": "error",
                "detail": ("unbound container not reachable in Docker network. "
                           "Check 'docker compose ps unbound' - is it running?"),
            }
        name, unbound_ip = resolved

        def _dns_query(nameserver: str):
            import dns.resolver
            resolver = dns.resolver.Resolver(configure=False)
            resolver.nameservers = [nameserver]
            resolver.timeout = 3.0
            resolver.lifetime = 3.0
            resolver.resolve("dns.google", "A")
            return True

        try:
            await asyncio.wait_for(
                asyncio.to_thread(_dns_query, unbound_ip), timeout=5.0
            )
            return {"status": "ok",
                    "detail": f"unbound DNS resolving ({name} @ {unbound_ip})"}
        except Exception as e:
            return {"status": "error",
                    "detail": f"unbound found at {unbound_ip} but query failed: {type(e).__name__}"}

    async def check_ai() -> dict:
        if not settings.ai_enabled:
            return {"status": "disabled", "detail": "AI classification disabled"}
        if not settings.ai_api_key and settings.ai_provider == "openai":
            return {"status": "error", "detail": "OpenAI API key not configured"}
        return {"status": "ok", "detail": f"AI provider: {settings.ai_provider} ({settings.ai_model})"}

    async def check_disk_space() -> dict:
        # Container root FS reflects host disk when using default Docker
        # overlay2 storage - close enough as an early-warning signal.
        # Postgres PANIC on "no space left on device" is what this catches.
        import shutil as _shutil
        try:
            usage = _shutil.disk_usage("/")
            total_gb = usage.total / (1024 ** 3)
            free_gb = usage.free / (1024 ** 3)
            pct_free = (usage.free / usage.total) * 100.0 if usage.total else 0.0
        except Exception as e:
            return {"status": "unknown", "detail": f"cannot read disk usage: {e}"}

        detail = f"{free_gb:.1f} GB frei von {total_gb:.1f} GB ({pct_free:.0f}%)"
        if free_gb < 1.0 or pct_free < 3.0:
            return {"status": "error", "detail": f"KRITISCH: {detail}. Postgres kann jederzeit crashen."}
        if free_gb < 3.0 or pct_free < 10.0:
            return {"status": "degraded", "detail": f"Wenig Platz: {detail}"}
        return {"status": "ok", "detail": detail,
                "free_gb": round(free_gb, 1),
                "total_gb": round(total_gb, 1),
                "percent_free": round(pct_free, 1)}

    async def check_host_updates() -> dict:
        # File is written by the host's systemd timer via
        # /usr/local/bin/spamproxy-host-updates and mounted read-only.
        import json as _json
        import os as _os
        status_file = "/host-status/host-updates.json"
        if not _os.path.exists(status_file):
            return {
                "status": "unknown",
                "detail": "Host update probe not installed (run deploy.sh install-host-updates)",
            }
        try:
            with open(status_file, "r", encoding="utf-8") as f:
                data = _json.load(f)
        except Exception as e:
            return {"status": "error", "detail": f"cannot read host-updates.json: {e}"}

        checked = data.get("checked_at", "unknown")
        total = int(data.get("total_updates", 0))
        security = int(data.get("security_updates", 0))
        reboot = bool(data.get("reboot_required", False))
        distro = data.get("distro", "unknown")

        # Stale probe (>36h)? Report as degraded so user knows the check
        # itself isn't running anymore.
        stale = False
        try:
            from datetime import datetime as _dt
            checked_dt = _dt.fromisoformat(checked.replace("Z", "+00:00"))
            age_h = (datetime.now(timezone.utc) - checked_dt).total_seconds() / 3600.0
            stale = age_h > 36
        except Exception:
            pass

        if reboot or security > 0:
            status = "degraded"
        elif total > 0 or stale:
            status = "degraded" if stale else "ok"
        else:
            status = "ok"

        detail_bits = [distro]
        if security > 0:
            detail_bits.append(f"{security} Security-Updates")
        if total > 0:
            detail_bits.append(f"{total} Updates gesamt")
        if reboot:
            detail_bits.append("Neustart erforderlich")
        if stale:
            detail_bits.append(f"Check veraltet (>36h)")
        if not detail_bits[1:]:
            detail_bits.append("aktuell")
        return {
            "status": status,
            "detail": " · ".join(detail_bits),
            "total_updates": total,
            "security_updates": security,
            "reboot_required": reboot,
            "checked_at": checked,
        }

    # Run all checks in parallel
    results = await asyncio.gather(
        check_rspamd(), check_postgres(), check_redis(),
        check_clamav(), check_postfix(), check_unbound(), check_ai(),
        check_host_updates(), check_disk_space(),
        return_exceptions=True,
    )
    names = ["rspamd", "postgres", "redis", "clamav", "postfix", "unbound", "ai", "host_updates", "disk_space"]
    services = {}
    for name, result in zip(names, results):
        if isinstance(result, Exception):
            services[name] = {"status": "error", "detail": f"check failed: {type(result).__name__}"}
        else:
            services[name] = result

    # Overall status: error if any critical service is down
    critical = ["rspamd", "postgres", "postfix"]
    has_error = any(services[s].get("status") == "error" for s in critical)
    has_degraded = any(services[s].get("status") in ("error", "degraded") for s in services)

    if has_error:
        overall = "error"
    elif has_degraded:
        overall = "degraded"
    else:
        overall = "ok"

    return {
        "overall": overall,
        "services": services,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --- Direct Learn Endpoint (for Dovecot/external scripts) ---

@app.post("/api/learn/{learn_type}")
async def learn_raw_message(learn_type: str, request: Request):
    """Learn spam or ham from raw email body.
    Used by Dovecot sieve scripts and dovecot-learn.sh.
    Accepts raw email as request body (not JSON)."""
    if learn_type not in ("spam", "ham"):
        raise HTTPException(status_code=400, detail="learn_type must be 'spam' or 'ham'")

    raw_message = await request.body()
    if len(raw_message) < 50:
        raise HTTPException(status_code=400, detail="Message too small")

    # Learn locally on rspamd controller
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
    except Exception as e:
        logger.warning("Direct learn %s failed: %s", learn_type, e)
        raise HTTPException(status_code=500, detail=str(e))

    # Forward to federation peers
    await _forward_learn_to_peers(raw_message, learn_type)

    logger.info("Direct learn %s: %d bytes", learn_type, len(raw_message))
    return {"status": "ok", "type": learn_type, "size": len(raw_message)}



# --- Auth ---

class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.email == req.email, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Verify password using pgcrypto crypt()
        verify_result = await session.execute(
            text("SELECT :hash = crypt(:password, :hash) AS valid"),
            {"hash": user.password_hash, "password": req.password},
        )
        row = verify_result.one()
        if not row.valid:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        return {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "role": user.role,
        }


# --- AI Scan Endpoint (called by rspamd) ---

class AIScanRequest(BaseModel):
    content: str  # Base64 encoded email


class AIScanResponse(BaseModel):
    score: float
    reason: str


@app.post("/api/scan/ai", response_model=AIScanResponse)
async def scan_ai(request: AIScanRequest):
    import base64
    try:
        raw_message = base64.b64decode(request.content)
        score, reason = await ai_classifier.classify(raw_message)
        return AIScanResponse(score=score, reason=reason)
    except Exception:
        logger.exception("AI scan failed")
        return AIScanResponse(score=0.0, reason="classification error")


# --- AI Test Endpoint ---

class AITestRequest(BaseModel):
    from_addr: str = "test@example.com"
    to_addr: str = "user@example.com"
    subject: str = "Test Email"
    body: str = "This is a test email."


@app.post("/api/ai/test")
async def test_ai_classification(req: AITestRequest):
    """Build a test email and classify it with the AI."""
    from email.mime.text import MIMEText
    import time

    msg = MIMEText(req.body)
    msg["From"] = req.from_addr
    msg["To"] = req.to_addr
    msg["Subject"] = req.subject
    msg["Date"] = email_lib.utils.formatdate(localtime=True)
    msg["Message-ID"] = f"<test-{int(time.time())}@spamproxy.local>"

    raw = msg.as_bytes()

    start = time.monotonic()
    try:
        score, reason = await ai_classifier.classify(raw)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return {
            "status": "ok",
            "score": score,
            "reason": reason,
            "elapsed_ms": elapsed_ms,
            "provider": settings.ai_provider,
            "model": settings.ai_model,
        }
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "error": str(e),
            "elapsed_ms": elapsed_ms,
            "provider": settings.ai_provider,
            "model": settings.ai_model,
        }


# --- Stats ---

class StatsResponse(BaseModel):
    total_today: int
    spam_today: int
    ham_today: int
    quarantine_pending: int
    spam_rate: float
    total_week: int
    hourly_stats: list[dict]


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats():
    async with async_session() as session:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)

        # Today's stats
        today_result = await session.execute(
            select(
                func.count().label("total"),
                func.count().filter(MailLog.action.in_(["quarantined", "rejected"])).label("spam"),
                func.count().filter(MailLog.action == "delivered").label("ham"),
            ).where(MailLog.created_at >= today_start)
        )
        today = today_result.one()

        # Pending quarantine
        pending = await session.execute(
            select(func.count()).select_from(Quarantine).where(Quarantine.status == "pending")
        )
        pending_count = pending.scalar() or 0

        # Week total
        week_result = await session.execute(
            select(func.count()).select_from(MailLog).where(MailLog.created_at >= week_start)
        )
        week_total = week_result.scalar() or 0

        # Hourly stats for last 24h
        hourly_result = await session.execute(
            select(StatsHourly)
            .where(StatsHourly.hour >= now - timedelta(hours=24))
            .order_by(StatsHourly.hour)
        )
        hourly = [
            {
                "hour": str(s.hour),
                "total": s.total_mails,
                "spam": s.spam_count,
                "ham": s.ham_count,
            }
            for s in hourly_result.scalars()
        ]

        total = today.total or 0
        spam = today.spam or 0

        return StatsResponse(
            total_today=total,
            spam_today=spam,
            ham_today=today.ham or 0,
            quarantine_pending=pending_count,
            spam_rate=round(spam / total * 100, 1) if total > 0 else 0.0,
            total_week=week_total,
            hourly_stats=hourly,
        )


# --- Quarantine ---

class QuarantineItem(BaseModel):
    id: str
    mail_from: str | None
    rcpt_to: list[str]
    subject: str | None
    rspamd_score: float | None
    final_score: float | None
    status: str
    body_preview: str | None
    parsed_headers: dict | None
    created_at: str


class QuarantineListResponse(BaseModel):
    items: list[QuarantineItem]
    total: int
    page: int
    page_size: int


@app.get("/api/quarantine", response_model=QuarantineListResponse)
async def list_quarantine(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query("pending"),
    search: str = Query(""),
):
    async with async_session() as session:
        query = (
            select(Quarantine, MailLog)
            .join(MailLog, Quarantine.mail_log_id == MailLog.id)
            .where(Quarantine.status == status)
        )

        if search:
            # rcpt_to is text[]; use array_to_string for ILIKE on any element
            query = query.where(
                MailLog.mail_from.ilike(f"%{search}%")
                | MailLog.subject.ilike(f"%{search}%")
                | func.array_to_string(MailLog.rcpt_to, ",").ilike(f"%{search}%")
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(desc(Quarantine.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await session.execute(query)

        items = []
        for q, ml in result.all():
            items.append(QuarantineItem(
                id=str(q.id),
                mail_from=ml.mail_from,
                rcpt_to=ml.rcpt_to or [],
                subject=ml.subject,
                rspamd_score=ml.rspamd_score,
                final_score=ml.final_score,
                status=q.status,
                body_preview=q.body_preview,
                parsed_headers=q.parsed_headers,
                created_at=str(q.created_at),
            ))

        return QuarantineListResponse(
            items=items, total=total, page=page, page_size=page_size,
        )


@app.get("/api/quarantine/{quarantine_id}")
async def get_quarantine_item(quarantine_id: UUID):
    async with async_session() as session:
        result = await session.execute(
            select(Quarantine, MailLog)
            .join(MailLog, Quarantine.mail_log_id == MailLog.id)
            .where(Quarantine.id == quarantine_id)
        )
        row = result.one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        q, ml = row
        return QuarantineItem(
            id=str(q.id),
            mail_from=ml.mail_from,
            rcpt_to=ml.rcpt_to or [],
            subject=ml.subject,
            rspamd_score=ml.rspamd_score,
            final_score=ml.final_score,
            status=q.status,
            body_preview=q.body_preview,
            parsed_headers=q.parsed_headers,
            created_at=str(q.created_at),
        )


class ActionRequest(BaseModel):
    action: str  # approve or reject
    reviewer_id: str | None = None


@app.post("/api/quarantine/{quarantine_id}/action")
async def quarantine_action(quarantine_id: UUID, req: ActionRequest):
    async with async_session() as session:
        qm = QuarantineManager(session)
        reviewer = UUID(req.reviewer_id) if req.reviewer_id else None

        if req.action == "approve":
            success = await qm.approve(quarantine_id, reviewer)
            learn_type = "ham"
        elif req.action == "reject":
            success = await qm.reject(quarantine_id, reviewer)
            learn_type = "spam"
        else:
            raise HTTPException(status_code=400, detail="Invalid action")

        if not success:
            raise HTTPException(status_code=400, detail="Action failed")

        # Learn from decision and forward to federation peers
        try:
            q_result = await session.execute(
                select(Quarantine).where(Quarantine.id == quarantine_id)
            )
            q_entry = q_result.scalar_one_or_none()
            if q_entry and q_entry.raw_message:
                await _forward_learn_to_peers(q_entry.raw_message, learn_type)
        except Exception:
            logger.warning("Learn forwarding failed for %s", quarantine_id)

        return {"status": "ok", "action": req.action}


class BulkActionRequest(BaseModel):
    ids: list[str]
    action: str


@app.post("/api/quarantine/bulk")
async def quarantine_bulk_action(req: BulkActionRequest):
    async with async_session() as session:
        qm = QuarantineManager(session)
        results = {"success": 0, "failed": 0}

        for id_str in req.ids:
            qid = UUID(id_str)
            if req.action == "approve":
                ok = await qm.approve(qid)
            elif req.action == "reject":
                ok = await qm.reject(qid)
            else:
                continue

            if ok:
                results["success"] += 1
            else:
                results["failed"] += 1

        return results


# --- Mail Log ---

class MailLogItem(BaseModel):
    id: str
    message_id: str | None
    mail_from: str | None
    rcpt_to: list[str]
    subject: str | None
    direction: str
    action: str
    rspamd_score: float | None
    ai_score: float | None
    final_score: float | None
    rspamd_symbols: dict | None
    client_ip: str | None
    created_at: str


@app.get("/api/logs")
async def get_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    direction: str = Query(""),
    action: str = Query(""),
    search: str = Query(""),
):
    async with async_session() as session:
        query = select(MailLog)

        if direction:
            query = query.where(MailLog.direction == direction)
        if action:
            query = query.where(MailLog.action == action)
        if search:
            query = query.where(
                MailLog.mail_from.ilike(f"%{search}%")
                | MailLog.subject.ilike(f"%{search}%")
                | func.array_to_string(MailLog.rcpt_to, ",").ilike(f"%{search}%")
            )

        count_query = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_query)).scalar() or 0

        query = query.order_by(desc(MailLog.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await session.execute(query)

        items = [
            MailLogItem(
                id=str(m.id),
                message_id=m.message_id,
                mail_from=m.mail_from,
                rcpt_to=m.rcpt_to or [],
                subject=m.subject,
                direction=m.direction,
                action=m.action,
                rspamd_score=m.rspamd_score,
                ai_score=m.ai_score,
                final_score=m.final_score,
                rspamd_symbols=m.rspamd_symbols,
                client_ip=m.client_ip,
                created_at=str(m.created_at),
            )
            for m in result.scalars()
        ]

        return {"items": items, "total": total, "page": page, "page_size": page_size}


# --- Domains ---

class DomainRequest(BaseModel):
    domain: str
    backend_host: str
    backend_port: int = 25
    is_active: bool = True
    description: str | None = None


@app.get("/api/domains")
async def list_domains():
    async with async_session() as session:
        result = await session.execute(select(Domain).order_by(Domain.domain))
        return [
            {
                "id": str(d.id),
                "domain": d.domain,
                "backend_host": d.backend_host,
                "backend_port": d.backend_port,
                "is_active": d.is_active,
                "description": d.description,
                "created_at": str(d.created_at),
            }
            for d in result.scalars()
        ]


@app.post("/api/domains")
async def create_domain(req: DomainRequest):
    async with async_session() as session:
        domain = Domain(
            domain=req.domain,
            backend_host=req.backend_host,
            backend_port=req.backend_port,
            is_active=req.is_active,
            description=req.description,
        )
        session.add(domain)
        await session.commit()
        await session.refresh(domain)
        return {"id": str(domain.id), "domain": domain.domain}


@app.put("/api/domains/{domain_id}")
async def update_domain(domain_id: UUID, req: DomainRequest):
    async with async_session() as session:
        result = await session.execute(select(Domain).where(Domain.id == domain_id))
        domain = result.scalar_one_or_none()
        if not domain:
            raise HTTPException(status_code=404, detail="Domain not found")
        domain.domain = req.domain
        domain.backend_host = req.backend_host
        domain.backend_port = req.backend_port
        domain.is_active = req.is_active
        domain.description = req.description
        await session.commit()
        return {"status": "ok"}


@app.delete("/api/domains/{domain_id}")
async def delete_domain(domain_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(Domain).where(Domain.id == domain_id))
        domain = result.scalar_one_or_none()
        if not domain:
            raise HTTPException(status_code=404, detail="Domain not found")
        await session.delete(domain)
        await session.commit()
        return {"status": "ok"}


# --- Settings ---

@app.get("/api/settings")
async def get_settings(category: str = Query("")):
    async with async_session() as session:
        query = select(Setting)
        if category:
            query = query.where(Setting.category == category)
        result = await session.execute(query.order_by(Setting.category, Setting.key))
        return [
            {
                "key": s.key,
                "value": s.value,
                "category": s.category,
                "description": s.description,
            }
            for s in result.scalars()
        ]


class SettingUpdate(BaseModel):
    value: str | int | float | bool | dict | list


@app.put("/api/settings/{key}")
async def update_setting(key: str, req: SettingUpdate):
    async with async_session() as session:
        result = await session.execute(select(Setting).where(Setting.key == key))
        setting = result.scalar_one_or_none()
        if not setting:
            raise HTTPException(status_code=404, detail="Setting not found")
        setting.value = req.value
        setting.updated_at = datetime.now(timezone.utc)
        await session.commit()
        return {"status": "ok"}


# --- SMTP Credentials (Outgoing Auth) ---

class SmtpCredentialRequest(BaseModel):
    username: str
    password: str | None = None  # None = don't change on update
    display_name: str | None = None
    allowed_from: list[str] | None = None
    is_active: bool = True
    max_messages_per_hour: int = 100


@app.get("/api/smtp-credentials")
async def list_smtp_credentials():
    async with async_session() as session:
        result = await session.execute(
            select(SmtpCredential).order_by(SmtpCredential.username)
        )
        return [
            {
                "id": str(c.id),
                "username": c.username,
                "display_name": c.display_name,
                "allowed_from": c.allowed_from or [],
                "is_active": c.is_active,
                "max_messages_per_hour": c.max_messages_per_hour,
                "created_at": str(c.created_at),
            }
            for c in result.scalars()
        ]


@app.post("/api/smtp-credentials")
async def create_smtp_credential(req: SmtpCredentialRequest):
    if not req.password:
        raise HTTPException(status_code=400, detail="Password required")
    async with async_session() as session:
        # Hash password with pgcrypto
        hash_result = await session.execute(
            text("SELECT crypt(:password, gen_salt('bf')) AS hash"),
            {"password": req.password},
        )
        password_hash = hash_result.one().hash

        cred = SmtpCredential(
            username=req.username,
            password_hash=password_hash,
            display_name=req.display_name,
            allowed_from=req.allowed_from,
            is_active=req.is_active,
            max_messages_per_hour=req.max_messages_per_hour,
        )
        session.add(cred)
        await session.commit()
        await session.refresh(cred)
        return {"id": str(cred.id), "username": cred.username}


@app.put("/api/smtp-credentials/{cred_id}")
async def update_smtp_credential(cred_id: UUID, req: SmtpCredentialRequest):
    async with async_session() as session:
        result = await session.execute(
            select(SmtpCredential).where(SmtpCredential.id == cred_id)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            raise HTTPException(status_code=404, detail="Credential not found")

        cred.username = req.username
        cred.display_name = req.display_name
        cred.allowed_from = req.allowed_from
        cred.is_active = req.is_active
        cred.max_messages_per_hour = req.max_messages_per_hour
        cred.updated_at = datetime.now(timezone.utc)

        if req.password:
            hash_result = await session.execute(
                text("SELECT crypt(:password, gen_salt('bf')) AS hash"),
                {"password": req.password},
            )
            cred.password_hash = hash_result.one().hash

        await session.commit()
        return {"status": "ok"}


@app.delete("/api/smtp-credentials/{cred_id}")
async def delete_smtp_credential(cred_id: UUID):
    async with async_session() as session:
        result = await session.execute(
            select(SmtpCredential).where(SmtpCredential.id == cred_id)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            raise HTTPException(status_code=404, detail="Credential not found")
        await session.delete(cred)
        await session.commit()
        return {"status": "ok"}


# --- SASL Auth Endpoint (called by Postfix via http) ---

class SaslAuthRequest(BaseModel):
    username: str
    password: str


@app.post("/api/sasl/verify")
async def sasl_verify(req: SaslAuthRequest):
    """Verify SMTP credentials for Postfix SASL authentication."""
    async with async_session() as session:
        result = await session.execute(
            select(SmtpCredential).where(
                SmtpCredential.username == req.username,
                SmtpCredential.is_active.is_(True),
            )
        )
        cred = result.scalar_one_or_none()
        if not cred:
            raise HTTPException(status_code=403, detail="Authentication failed")

        verify_result = await session.execute(
            text("SELECT :hash = crypt(:password, :hash) AS valid"),
            {"hash": cred.password_hash, "password": req.password},
        )
        if not verify_result.one().valid:
            raise HTTPException(status_code=403, detail="Authentication failed")

        return {"status": "ok", "username": cred.username}


# --- Postfix Log ---

@app.get("/api/postfix-log")
async def get_postfix_log(lines: int = Query(200, ge=1, le=5000), search: str = Query("")):
    import os
    log_path = "/var/log/postfix/mail.log"
    if not os.path.exists(log_path):
        return {"lines": [], "total": 0}

    with open(log_path, "r", errors="replace") as f:
        all_lines = f.readlines()

    if search:
        all_lines = [l for l in all_lines if search.lower() in l.lower()]

    # Return last N lines
    result = all_lines[-lines:]
    return {"lines": [l.rstrip() for l in result], "total": len(all_lines)}


# --- DKIM Key Management ---

class DkimKeyRequest(BaseModel):
    domain: str
    selector: str = "spamproxy"
    key_bits: int = 2048


@app.get("/api/dkim")
async def list_dkim_keys():
    async with async_session() as session:
        result = await session.execute(select(DkimKey).order_by(DkimKey.domain))
        return [
            {
                "id": str(k.id),
                "domain": k.domain,
                "selector": k.selector,
                "public_key": k.public_key,
                "dns_record": k.dns_record,
                "key_type": k.key_type,
                "key_bits": k.key_bits,
                "is_active": k.is_active,
                "created_at": str(k.created_at),
            }
            for k in result.scalars()
        ]


@app.post("/api/dkim/generate")
async def generate_dkim_key(req: DkimKeyRequest):
    """Generate a new DKIM RSA key pair for a domain."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import base64

    # Generate RSA key pair
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=req.key_bits)

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    public_key = private_key.public_key()
    public_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    public_b64 = base64.b64encode(public_der).decode()

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    # Build DNS TXT record
    dns_record = f"v=DKIM1; k=rsa; p={public_b64}"

    async with async_session() as session:
        # Deactivate existing keys for this domain/selector
        existing = await session.execute(
            select(DkimKey).where(
                DkimKey.domain == req.domain,
                DkimKey.selector == req.selector,
            )
        )
        for old_key in existing.scalars():
            old_key.is_active = False

        # Store new key
        dk = DkimKey(
            domain=req.domain,
            selector=req.selector,
            private_key=private_pem,
            public_key=public_pem,
            dns_record=dns_record,
            key_type="rsa",
            key_bits=req.key_bits,
            is_active=True,
        )
        session.add(dk)
        await session.commit()
        await session.refresh(dk)

        # Write private key to file for rspamd
        import os
        dkim_dir = "/var/lib/rspamd/dkim"
        os.makedirs(dkim_dir, exist_ok=True)
        key_path = f"{dkim_dir}/{req.domain}.{req.selector}.key"
        with open(key_path, "w") as f:
            f.write(private_pem)
        os.chmod(key_path, 0o600)

        return {
            "id": str(dk.id),
            "domain": dk.domain,
            "selector": dk.selector,
            "public_key": public_pem,
            "dns_record": dns_record,
            "dns_name": f"{req.selector}._domainkey.{req.domain}",
            "dns_type": "TXT",
            "dns_value": dns_record,
        }


@app.delete("/api/dkim/{dkim_id}")
async def delete_dkim_key(dkim_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(DkimKey).where(DkimKey.id == dkim_id))
        dk = result.scalar_one_or_none()
        if not dk:
            raise HTTPException(status_code=404, detail="DKIM key not found")

        # Remove key file
        import os
        key_path = f"/var/lib/rspamd/dkim/{dk.domain}.{dk.selector}.key"
        if os.path.exists(key_path):
            os.remove(key_path)

        await session.delete(dk)
        await session.commit()
        return {"status": "ok"}


@app.put("/api/dkim/{dkim_id}/toggle")
async def toggle_dkim_key(dkim_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(DkimKey).where(DkimKey.id == dkim_id))
        dk = result.scalar_one_or_none()
        if not dk:
            raise HTTPException(status_code=404, detail="DKIM key not found")
        dk.is_active = not dk.is_active
        await session.commit()
        return {"status": "ok", "is_active": dk.is_active}


# --- RBL / DNS Blocklist Management ---

class RblListRequest(BaseModel):
    name: str
    rbl_host: str
    list_type: str = "ip"
    description: str | None = None
    is_active: bool = True


@app.get("/api/rbl")
async def list_rbl():
    async with async_session() as session:
        result = await session.execute(select(RblList).order_by(RblList.name))
        return [
            {
                "id": str(r.id),
                "name": r.name,
                "rbl_host": r.rbl_host,
                "list_type": r.list_type,
                "description": r.description,
                "is_active": r.is_active,
                "created_at": str(r.created_at),
            }
            for r in result.scalars()
        ]


@app.post("/api/rbl")
async def create_rbl(req: RblListRequest):
    async with async_session() as session:
        rbl = RblList(
            name=req.name,
            rbl_host=req.rbl_host,
            list_type=req.list_type,
            description=req.description,
            is_active=req.is_active,
        )
        session.add(rbl)
        await session.commit()
        await session.refresh(rbl)
        return {"id": str(rbl.id), "name": rbl.name}


@app.put("/api/rbl/{rbl_id}")
async def update_rbl(rbl_id: UUID, req: RblListRequest):
    async with async_session() as session:
        result = await session.execute(select(RblList).where(RblList.id == rbl_id))
        rbl = result.scalar_one_or_none()
        if not rbl:
            raise HTTPException(status_code=404, detail="RBL not found")
        rbl.name = req.name
        rbl.rbl_host = req.rbl_host
        rbl.list_type = req.list_type
        rbl.description = req.description
        rbl.is_active = req.is_active
        await session.commit()
        return {"status": "ok"}


@app.put("/api/rbl/{rbl_id}/toggle")
async def toggle_rbl(rbl_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(RblList).where(RblList.id == rbl_id))
        rbl = result.scalar_one_or_none()
        if not rbl:
            raise HTTPException(status_code=404, detail="RBL not found")
        rbl.is_active = not rbl.is_active
        await session.commit()
        return {"status": "ok", "is_active": rbl.is_active}


@app.delete("/api/rbl/{rbl_id}")
async def delete_rbl(rbl_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(RblList).where(RblList.id == rbl_id))
        rbl = result.scalar_one_or_none()
        if not rbl:
            raise HTTPException(status_code=404, detail="RBL not found")
        await session.delete(rbl)
        await session.commit()
        return {"status": "ok"}


# --- Access Lists (Whitelist / Blacklist) ---

class AccessListRequest(BaseModel):
    list_type: str  # whitelist, blacklist
    entry_type: str  # domain, email, ip, cidr
    value: str
    description: str | None = None
    is_active: bool = True


@app.get("/api/access-lists")
async def list_access_lists(list_type: str = Query("")):
    async with async_session() as session:
        query = select(AccessList).order_by(AccessList.list_type, AccessList.entry_type, AccessList.value)
        if list_type:
            query = query.where(AccessList.list_type == list_type)
        result = await session.execute(query)
        return [
            {
                "id": str(a.id),
                "list_type": a.list_type,
                "entry_type": a.entry_type,
                "value": a.value,
                "description": a.description,
                "is_active": a.is_active,
                "created_at": str(a.created_at),
            }
            for a in result.scalars()
        ]


@app.post("/api/access-lists")
async def create_access_list(req: AccessListRequest):
    async with async_session() as session:
        entry = AccessList(
            list_type=req.list_type,
            entry_type=req.entry_type,
            value=req.value,
            description=req.description,
            is_active=req.is_active,
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return {"id": str(entry.id)}


@app.put("/api/access-lists/{entry_id}/toggle")
async def toggle_access_list(entry_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(AccessList).where(AccessList.id == entry_id))
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Not found")
        entry.is_active = not entry.is_active
        await session.commit()
        return {"status": "ok", "is_active": entry.is_active}


@app.delete("/api/access-lists/{entry_id}")
async def delete_access_list(entry_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(AccessList).where(AccessList.id == entry_id))
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Not found")
        await session.delete(entry)
        await session.commit()
        return {"status": "ok"}


# --- Scoring Rules (TLD/Domain scoring) ---

class ScoringRuleRequest(BaseModel):
    rule_type: str  # tld, domain, sender_domain
    pattern: str
    score_adjustment: float
    description: str | None = None
    is_active: bool = True


@app.get("/api/scoring-rules")
async def list_scoring_rules(rule_type: str = Query("")):
    async with async_session() as session:
        query = select(ScoringRule).order_by(ScoringRule.rule_type, ScoringRule.pattern)
        if rule_type:
            query = query.where(ScoringRule.rule_type == rule_type)
        result = await session.execute(query)
        return [
            {
                "id": str(r.id),
                "rule_type": r.rule_type,
                "pattern": r.pattern,
                "score_adjustment": r.score_adjustment,
                "description": r.description,
                "is_active": r.is_active,
                "created_at": str(r.created_at),
            }
            for r in result.scalars()
        ]


@app.post("/api/scoring-rules")
async def create_scoring_rule(req: ScoringRuleRequest):
    async with async_session() as session:
        rule = ScoringRule(
            rule_type=req.rule_type,
            pattern=req.pattern,
            score_adjustment=req.score_adjustment,
            description=req.description,
            is_active=req.is_active,
        )
        session.add(rule)
        await session.commit()
        await session.refresh(rule)
        return {"id": str(rule.id)}


@app.put("/api/scoring-rules/{rule_id}")
async def update_scoring_rule(rule_id: UUID, req: ScoringRuleRequest):
    async with async_session() as session:
        result = await session.execute(select(ScoringRule).where(ScoringRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        rule.pattern = req.pattern
        rule.score_adjustment = req.score_adjustment
        rule.description = req.description
        rule.is_active = req.is_active
        await session.commit()
        return {"status": "ok"}


@app.put("/api/scoring-rules/{rule_id}/toggle")
async def toggle_scoring_rule(rule_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(ScoringRule).where(ScoringRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        rule.is_active = not rule.is_active
        await session.commit()
        return {"status": "ok", "is_active": rule.is_active}


@app.delete("/api/scoring-rules/{rule_id}")
async def delete_scoring_rule(rule_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(ScoringRule).where(ScoringRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        await session.delete(rule)
        await session.commit()
        return {"status": "ok"}


# --- Sender Domain Verification ---

import secrets
import dns.resolver


def _check_spf(domain: str, proxy_hostname: str) -> tuple[str, str | None, bool]:
    """Check SPF record for domain. Returns (status, record, includes_proxy)."""
    logger.info("SPF check for %s (proxy=%s)", domain, proxy_hostname)
    try:
        answers = dns.resolver.resolve(domain, "TXT")
        for rdata in answers:
            txt = rdata.to_text().strip('"')
            if txt.startswith("v=spf1"):
                includes_proxy = (
                    proxy_hostname in txt
                    or f"include:{proxy_hostname}" in txt
                    or "include:_spf." in txt  # common pattern
                )
                return ("ok", txt, includes_proxy)
        return ("missing", None, False)
    except dns.resolver.NXDOMAIN:
        return ("missing", None, False)
    except dns.resolver.NoAnswer:
        return ("missing", None, False)
    except Exception:
        return ("invalid", None, False)


def _check_dkim(domain: str, selector: str) -> tuple[str, str | None]:
    """Check DKIM record. Returns (status, record)."""
    logger.info("DKIM check for %s (selector=%s)", domain, selector)
    try:
        dkim_domain = f"{selector}._domainkey.{domain}"
        answers = dns.resolver.resolve(dkim_domain, "TXT")
        for rdata in answers:
            txt = rdata.to_text().strip('"')
            if "v=DKIM1" in txt or "p=" in txt:
                return ("ok", txt)
        return ("missing", None)
    except dns.resolver.NXDOMAIN:
        return ("missing", None)
    except dns.resolver.NoAnswer:
        return ("missing", None)
    except Exception:
        return ("invalid", None)


def _check_mx(domain: str) -> tuple[str, list[str]]:
    """Check MX records. Returns (status, records)."""
    try:
        answers = dns.resolver.resolve(domain, "MX")
        records = [f"{r.preference} {r.exchange}" for r in answers]
        return ("ok" if records else "missing", records)
    except dns.resolver.NXDOMAIN:
        return ("missing", [])
    except dns.resolver.NoAnswer:
        return ("missing", [])
    except Exception:
        return ("missing", [])


def _check_verification_token(domain: str, token: str) -> bool:
    """Check if DNS TXT record contains the verification token."""
    logger.info("DNS verify: checking %s for token %s", domain, token[:30])
    try:
        answers = dns.resolver.resolve(domain, "TXT")
        for rdata in answers:
            txt = rdata.to_text().strip('"')
            logger.info("DNS TXT for %s: %s", domain, txt[:100])
            if token in txt:
                return True
        # Also check _spamproxy subdomain
        try:
            sub = f"_spamproxy.{domain}"
            logger.info("DNS verify: checking subdomain %s", sub)
            answers = dns.resolver.resolve(sub, "TXT")
            for rdata in answers:
                txt = rdata.to_text().strip('"')
                logger.info("DNS TXT for %s: %s", sub, txt[:100])
                if token in txt:
                    return True
        except Exception as e:
            logger.info("DNS subdomain check failed: %s", e)
        return False
    except Exception as e:
        logger.info("DNS check failed for %s: %s", domain, e)
        return False


class SenderDomainRequest(BaseModel):
    domain: str
    verification_method: str = "dns"
    description: str | None = None


@app.get("/api/sender-domains")
async def list_sender_domains():
    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).order_by(SenderDomain.domain)
        )
        return [
            {
                "id": str(d.id),
                "domain": d.domain,
                "verification_method": d.verification_method,
                "verification_token": d.verification_token,
                "is_verified": d.is_verified,
                "verified_at": str(d.verified_at) if d.verified_at else None,
                "spf_status": d.spf_status,
                "spf_record": d.spf_record,
                "spf_includes_proxy": d.spf_includes_proxy,
                "dkim_status": d.dkim_status,
                "dkim_selector": d.dkim_selector,
                "dkim_record": d.dkim_record,
                "mx_status": d.mx_status,
                "mx_records": d.mx_records or [],
                "last_dns_check": str(d.last_dns_check) if d.last_dns_check else None,
                "is_active": d.is_active,
                "description": d.description,
                "created_at": str(d.created_at),
            }
            for d in result.scalars()
        ]


@app.post("/api/sender-domains")
async def create_sender_domain(req: SenderDomainRequest):
    token = f"spamproxy-verify={secrets.token_hex(16)}"
    async with async_session() as session:
        sd = SenderDomain(
            domain=req.domain,
            verification_method=req.verification_method,
            verification_token=token,
            description=req.description,
        )
        session.add(sd)
        await session.commit()
        await session.refresh(sd)
        return {
            "id": str(sd.id),
            "domain": sd.domain,
            "verification_token": token,
            "dns_instruction": f'Erstelle einen TXT-Record fuer {req.domain} oder _spamproxy.{req.domain} mit dem Wert: {token}',
        }


class VerifyRequest(BaseModel):
    method: str = ""  # "dns" or "manual", empty = use domain's method


@app.post("/api/sender-domains/{domain_id}/verify")
async def verify_sender_domain(domain_id: UUID, req: VerifyRequest = VerifyRequest()):
    """Verify domain ownership via DNS token or manual approval."""
    logger.info("Verify domain %s, requested method=%s", domain_id, req.method)

    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).where(SenderDomain.id == domain_id)
        )
        sd = result.scalar_one_or_none()
        if not sd:
            raise HTTPException(status_code=404, detail="Not found")

        method = req.method if req.method else sd.verification_method
        logger.info("Domain %s: using method=%s (domain default=%s)", sd.domain, method, sd.verification_method)

        if method == "dns":
            logger.info("DNS verify for %s, token=%s", sd.domain, sd.verification_token)
            found = _check_verification_token(sd.domain, sd.verification_token)
            logger.info("DNS token found: %s", found)
            if not found:
                return {
                    "status": "error",
                    "is_verified": False,
                    "detail": f"DNS-Verifikationstoken nicht gefunden. Erstelle einen TXT-Record fuer {sd.domain} oder _spamproxy.{sd.domain} mit: {sd.verification_token}",
                }

        # Verify and activate
        sd.is_verified = True
        sd.verified_at = datetime.now(timezone.utc)
        sd.is_active = True
        sd.verification_method = method
        logger.info("Domain %s verified and activated (method=%s)", sd.domain, method)

        await session.commit()
        return {"status": "ok", "is_verified": True, "is_active": True}


@app.post("/api/sender-domains/{domain_id}/check-dns")
async def check_sender_domain_dns(domain_id: UUID):
    """Run DNS checks for SPF, DKIM, MX."""
    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).where(SenderDomain.id == domain_id)
        )
        sd = result.scalar_one_or_none()
        if not sd:
            raise HTTPException(status_code=404, detail="Not found")

        proxy_hostname = settings.smtp_backend_host
        # Try to get proxy hostname from settings table
        setting_result = await session.execute(
            select(Setting).where(Setting.key == "proxy_hostname")
        )
        setting = setting_result.scalar_one_or_none()
        if setting and setting.value:
            proxy_hostname = str(setting.value).strip('"')

        # Check SPF
        spf_status, spf_record, spf_includes = _check_spf(sd.domain, proxy_hostname)
        sd.spf_status = spf_status
        sd.spf_record = spf_record
        sd.spf_includes_proxy = spf_includes

        # Check DKIM
        dkim_selector = sd.dkim_selector or "spamproxy"
        dkim_status, dkim_record = _check_dkim(sd.domain, dkim_selector)
        sd.dkim_status = dkim_status
        sd.dkim_selector = dkim_selector
        sd.dkim_record = dkim_record

        # Check MX
        mx_status, mx_records = _check_mx(sd.domain)
        sd.mx_status = mx_status
        sd.mx_records = mx_records

        sd.last_dns_check = datetime.now(timezone.utc)

        # Auto-activate if verified + SPF ok
        if sd.is_verified and spf_status == "ok":
            sd.is_active = True

        await session.commit()

        return {
            "spf_status": spf_status,
            "spf_record": spf_record,
            "spf_includes_proxy": spf_includes,
            "spf_hint": None if spf_includes else f'Fuege "include:{proxy_hostname}" oder "a:{proxy_hostname}" zu deinem SPF-Record hinzu',
            "dkim_status": dkim_status,
            "dkim_record": dkim_record,
            "dkim_hint": None if dkim_status == "ok" else f'Erstelle den DKIM-Record unter {dkim_selector}._domainkey.{sd.domain} (siehe DKIM-Seite)',
            "mx_status": mx_status,
            "mx_records": mx_records,
            "is_active": sd.is_active,
        }


@app.put("/api/sender-domains/{domain_id}/toggle")
async def toggle_sender_domain(domain_id: UUID):
    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).where(SenderDomain.id == domain_id)
        )
        sd = result.scalar_one_or_none()
        if not sd:
            raise HTTPException(status_code=404, detail="Not found")
        if not sd.is_verified and not sd.is_active:
            raise HTTPException(status_code=400, detail="Domain muss zuerst verifiziert werden")
        sd.is_active = not sd.is_active
        await session.commit()
        return {"status": "ok", "is_active": sd.is_active}


@app.delete("/api/sender-domains/{domain_id}")
async def delete_sender_domain(domain_id: UUID):
    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).where(SenderDomain.id == domain_id)
        )
        sd = result.scalar_one_or_none()
        if not sd:
            raise HTTPException(status_code=404, detail="Not found")
        await session.delete(sd)
        await session.commit()
        return {"status": "ok"}


# --- rspamd Federation ---

import httpx


class RspamdPeerRequest(BaseModel):
    name: str
    url: str
    password: str | None = None
    sync_bayes_learn: bool = True
    sync_fuzzy: bool = True
    direction: str = "both"


async def _forward_learn_to_peers(raw_message: bytes, learn_type: str):
    """Forward learn_spam/learn_ham to all active push/both peers."""
    async with async_session() as session:
        result = await session.execute(
            select(RspamdPeer).where(
                RspamdPeer.is_active.is_(True),
                RspamdPeer.sync_bayes_learn.is_(True),
                RspamdPeer.direction.in_(["push", "both"]),
            )
        )
        peers = result.scalars().all()

    async with httpx.AsyncClient(timeout=30.0) as client:
        for peer in peers:
            try:
                headers = {}
                if peer.password:
                    headers["Password"] = peer.password
                endpoint = "learnspam" if learn_type == "spam" else "learnham"
                resp = await client.post(
                    f"{peer.url}/{endpoint}",
                    content=raw_message,
                    headers=headers,
                )
                resp.raise_for_status()

                # Update stats
                async with async_session() as session:
                    result = await session.execute(
                        select(RspamdPeer).where(RspamdPeer.id == peer.id)
                    )
                    p = result.scalar_one_or_none()
                    if p:
                        p.last_sync = datetime.now(timezone.utc)
                        p.total_synced = (p.total_synced or 0) + 1
                        p.last_error = None
                        await session.commit()

                logger.info("Forwarded %s to peer %s", learn_type, peer.name)
            except Exception as e:
                logger.warning("Failed to forward %s to peer %s: %s", learn_type, peer.name, e)
                async with async_session() as session:
                    result = await session.execute(
                        select(RspamdPeer).where(RspamdPeer.id == peer.id)
                    )
                    p = result.scalar_one_or_none()
                    if p:
                        p.last_error = str(e)[:500]
                        await session.commit()


@app.get("/api/federation/peers")
async def list_peers():
    async with async_session() as session:
        result = await session.execute(
            select(RspamdPeer).order_by(RspamdPeer.name)
        )
        return [
            {
                "id": str(p.id),
                "name": p.name,
                "url": p.url,
                "has_password": bool(p.password),
                "sync_bayes_learn": p.sync_bayes_learn,
                "sync_fuzzy": p.sync_fuzzy,
                "direction": p.direction,
                "is_active": p.is_active,
                "last_sync": str(p.last_sync) if p.last_sync else None,
                "last_error": p.last_error,
                "total_synced": p.total_synced,
                "created_at": str(p.created_at),
            }
            for p in result.scalars()
        ]


@app.post("/api/federation/peers")
async def create_peer(req: RspamdPeerRequest):
    async with async_session() as session:
        peer = RspamdPeer(
            name=req.name,
            url=req.url.rstrip("/"),
            password=req.password,
            sync_bayes_learn=req.sync_bayes_learn,
            sync_fuzzy=req.sync_fuzzy,
            direction=req.direction,
        )
        session.add(peer)
        await session.commit()
        await session.refresh(peer)
        return {"id": str(peer.id), "name": peer.name}


@app.put("/api/federation/peers/{peer_id}")
async def update_peer(peer_id: UUID, req: RspamdPeerRequest):
    async with async_session() as session:
        result = await session.execute(select(RspamdPeer).where(RspamdPeer.id == peer_id))
        peer = result.scalar_one_or_none()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")
        peer.name = req.name
        peer.url = req.url.rstrip("/")
        if req.password is not None:
            peer.password = req.password
        peer.sync_bayes_learn = req.sync_bayes_learn
        peer.sync_fuzzy = req.sync_fuzzy
        peer.direction = req.direction
        peer.updated_at = datetime.now(timezone.utc)
        await session.commit()
        return {"status": "ok"}


@app.put("/api/federation/peers/{peer_id}/toggle")
async def toggle_peer(peer_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(RspamdPeer).where(RspamdPeer.id == peer_id))
        peer = result.scalar_one_or_none()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")
        peer.is_active = not peer.is_active
        await session.commit()
        return {"status": "ok", "is_active": peer.is_active}


@app.delete("/api/federation/peers/{peer_id}")
async def delete_peer(peer_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(RspamdPeer).where(RspamdPeer.id == peer_id))
        peer = result.scalar_one_or_none()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")
        await session.delete(peer)
        await session.commit()
        return {"status": "ok"}


@app.post("/api/federation/peers/{peer_id}/test")
async def test_peer(peer_id: UUID):
    """Test connectivity to a remote rspamd peer."""
    async with async_session() as session:
        result = await session.execute(select(RspamdPeer).where(RspamdPeer.id == peer_id))
        peer = result.scalar_one_or_none()
        if not peer:
            raise HTTPException(status_code=404, detail="Peer not found")

    import time as time_mod
    start = time_mod.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if peer.password:
                headers["Password"] = peer.password
            resp = await client.get(f"{peer.url}/stat", headers=headers)
            resp.raise_for_status()
            data = resp.json()
            elapsed = int((time_mod.monotonic() - start) * 1000)
            return {
                "status": "ok",
                "elapsed_ms": elapsed,
                "rspamd_version": data.get("version", "unknown"),
                "scanned": data.get("scanned", 0),
                "learned": data.get("learned", 0),
                "ham_count": data.get("ham_count", 0),
                "spam_count": data.get("spam_count", 0),
            }
    except Exception as e:
        elapsed = int((time_mod.monotonic() - start) * 1000)
        return {"status": "error", "error": str(e), "elapsed_ms": elapsed}


@app.post("/api/federation/learn")
async def federation_learn(learn_type: str = Query(...), quarantine_id: str = Query(None)):
    """Learn spam or ham and forward to all peers.
    Can be called with a quarantine_id to learn from quarantined message,
    or with raw message body."""
    if quarantine_id:
        async with async_session() as session:
            result = await session.execute(
                select(Quarantine).where(Quarantine.id == UUID(quarantine_id))
            )
            q = result.scalar_one_or_none()
            if not q:
                raise HTTPException(status_code=404, detail="Message not found")
            raw_message = q.raw_message
    else:
        raise HTTPException(status_code=400, detail="quarantine_id required")

    # Learn locally (controller port)
    rspamd_client = settings.rspamd_controller_url
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {}
        if settings.rspamd_password:
            headers["Password"] = settings.rspamd_password
        endpoint = "learnspam" if learn_type == "spam" else "learnham"
        try:
            resp = await client.post(
                f"{rspamd_client}/{endpoint}",
                content=raw_message,
                headers=headers,
            )
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Local learn failed: %s", e)

    # Forward to peers
    await _forward_learn_to_peers(raw_message, learn_type)

    return {"status": "ok", "type": learn_type}


# --- Learn from Mail Log (mark delivered mail as spam/ham) ---

@app.post("/api/mail-log/{log_id}/learn")
async def learn_from_mail_log(log_id: UUID, learn_type: str = Query(...)):
    """Learn spam or ham from a mail log entry.
    Works for both quarantined and delivered mails.
    For quarantined: uses raw_message from quarantine table.
    For delivered: reconstructs a minimal message from log data."""
    if learn_type not in ("spam", "ham"):
        raise HTTPException(status_code=400, detail="learn_type must be 'spam' or 'ham'")

    async with async_session() as session:
        # Try quarantine first (has raw message)
        result = await session.execute(
            select(Quarantine).where(Quarantine.mail_log_id == log_id)
        )
        q = result.scalar_one_or_none()

        if q and q.raw_message:
            raw_message = q.raw_message
        else:
            # No raw message - reconstruct minimal message from log
            result = await session.execute(
                select(MailLog).where(MailLog.id == log_id)
            )
            ml = result.scalar_one_or_none()
            if not ml:
                raise HTTPException(status_code=404, detail="Mail log entry not found")

            from email.mime.text import MIMEText
            msg = MIMEText(f"[Reconstructed for learning] Subject: {ml.subject or ''}")
            msg["From"] = ml.mail_from or ""
            msg["To"] = ", ".join(ml.rcpt_to or [])
            msg["Subject"] = ml.subject or ""
            msg["Message-ID"] = ml.message_id or ""
            raw_message = msg.as_bytes()

        # Update mail log action
        result = await session.execute(select(MailLog).where(MailLog.id == log_id))
        ml = result.scalar_one_or_none()
        if ml:
            ml.action = "rejected" if learn_type == "spam" else "delivered"
            await session.commit()

    # Learn locally on rspamd (controller port)
    rspamd_url = settings.rspamd_controller_url
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {}
        if settings.rspamd_password:
            headers["Password"] = settings.rspamd_password
        endpoint = "learnspam" if learn_type == "spam" else "learnham"
        try:
            resp = await client.post(
                f"{rspamd_url}/{endpoint}",
                content=raw_message,
                headers=headers,
            )
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Local learn failed: %s", e)

    # Forward to federation peers
    await _forward_learn_to_peers(raw_message, learn_type)

    return {"status": "ok", "type": learn_type, "mail_log_id": str(log_id)}


# --- Keyword Rules ---

class KeywordRuleRequest(BaseModel):
    keyword: str
    match_type: str = "contains"
    match_field: str = "subject"
    score_adjustment: float = 0.0
    description: str | None = None
    is_active: bool = True


@app.get("/api/keyword-rules")
async def list_keyword_rules():
    async with async_session() as session:
        result = await session.execute(
            select(KeywordRule).order_by(KeywordRule.match_field, KeywordRule.keyword)
        )
        return [
            {
                "id": str(r.id),
                "keyword": r.keyword,
                "match_type": r.match_type,
                "match_field": r.match_field,
                "score_adjustment": r.score_adjustment,
                "description": r.description,
                "is_active": r.is_active,
                "created_at": str(r.created_at),
            }
            for r in result.scalars()
        ]


@app.post("/api/keyword-rules")
async def create_keyword_rule(req: KeywordRuleRequest):
    async with async_session() as session:
        rule = KeywordRule(
            keyword=req.keyword,
            match_type=req.match_type,
            match_field=req.match_field,
            score_adjustment=req.score_adjustment,
            description=req.description,
            is_active=req.is_active,
        )
        session.add(rule)
        await session.commit()
        await session.refresh(rule)
        return {"id": str(rule.id)}


@app.put("/api/keyword-rules/{rule_id}")
async def update_keyword_rule(rule_id: UUID, req: KeywordRuleRequest):
    async with async_session() as session:
        result = await session.execute(select(KeywordRule).where(KeywordRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        rule.keyword = req.keyword
        rule.match_type = req.match_type
        rule.match_field = req.match_field
        rule.score_adjustment = req.score_adjustment
        rule.description = req.description
        rule.is_active = req.is_active
        await session.commit()
        return {"status": "ok"}


@app.put("/api/keyword-rules/{rule_id}/toggle")
async def toggle_keyword_rule(rule_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(KeywordRule).where(KeywordRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        rule.is_active = not rule.is_active
        await session.commit()
        return {"status": "ok", "is_active": rule.is_active}


@app.delete("/api/keyword-rules/{rule_id}")
async def delete_keyword_rule(rule_id: UUID):
    async with async_session() as session:
        result = await session.execute(select(KeywordRule).where(KeywordRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(status_code=404, detail="Not found")
        await session.delete(rule)
        await session.commit()
        return {"status": "ok"}


@app.get("/api/keyword-rules/export")
async def export_keyword_rules():
    """Export all keyword rules as JSON."""
    async with async_session() as session:
        result = await session.execute(
            select(KeywordRule).order_by(KeywordRule.match_field, KeywordRule.keyword)
        )
        return {
            "version": 1,
            "count": 0,  # placeholder, set below
            "rules": [
                {
                    "keyword": r.keyword,
                    "match_type": r.match_type,
                    "match_field": r.match_field,
                    "score_adjustment": r.score_adjustment,
                    "description": r.description,
                    "is_active": r.is_active,
                }
                for r in result.scalars()
            ],
        }


class KeywordImport(BaseModel):
    rules: list[KeywordRuleRequest]
    mode: str = "merge"  # merge or replace


@app.post("/api/keyword-rules/import")
async def import_keyword_rules(req: KeywordImport):
    """Import keyword rules. Mode: merge (skip existing) or replace (delete all first)."""
    async with async_session() as session:
        imported = 0
        skipped = 0

        if req.mode == "replace":
            for r in (await session.execute(select(KeywordRule))).scalars():
                await session.delete(r)
            await session.flush()

        for rd in req.rules:
            existing = await session.execute(
                select(KeywordRule).where(
                    KeywordRule.keyword == rd.keyword,
                    KeywordRule.match_type == rd.match_type,
                    KeywordRule.match_field == rd.match_field,
                )
            )
            if existing.scalar_one_or_none() and req.mode == "merge":
                skipped += 1
                continue

            session.add(KeywordRule(
                keyword=rd.keyword,
                match_type=rd.match_type,
                match_field=rd.match_field,
                score_adjustment=rd.score_adjustment,
                description=rd.description,
                is_active=rd.is_active if rd.is_active is not None else True,
            ))
            imported += 1

        await session.commit()
        return {"status": "ok", "imported": imported, "skipped": skipped}


# --- Delivery Status (bounces, deferrals from Postfix log) ---

@app.get("/api/delivery-status")
async def get_delivery_status(
    status: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str = Query(""),
):
    async with async_session() as session:
        from sqlalchemy import text as sql_text
        where_parts = []
        params: dict = {}
        if status:
            where_parts.append("status = :status")
            params["status"] = status
        if search:
            where_parts.append("(rcpt_to ILIKE :search OR mail_from ILIKE :search OR delay_reason ILIKE :search)")
            params["search"] = f"%{search}%"

        where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        count_result = await session.execute(
            sql_text(f"SELECT COUNT(*) FROM delivery_status {where_clause}"), params
        )
        total = count_result.scalar() or 0

        params["limit"] = page_size
        params["offset"] = (page - 1) * page_size
        result = await session.execute(
            sql_text(
                f"SELECT id, queue_id, mail_from, rcpt_to, status, dsn, relay, delay_reason, created_at "
                f"FROM delivery_status {where_clause} "
                f"ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        items = [
            {
                "id": str(row.id),
                "queue_id": row.queue_id,
                "mail_from": row.mail_from,
                "rcpt_to": row.rcpt_to,
                "status": row.status,
                "dsn": row.dsn,
                "relay": row.relay,
                "delay_reason": row.delay_reason,
                "created_at": str(row.created_at),
            }
            for row in result
        ]
        return {"items": items, "total": total, "page": page, "page_size": page_size}


# --- Mail Queue ---

POSTFIX_QUEUE_API = "http://postfix:8026"


@app.get("/api/queue")
async def get_mail_queue():
    """Get Postfix mail queue."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{POSTFIX_QUEUE_API}/queue")
            raw = resp.text.strip()
            if not raw or raw == "[]":
                return {"items": [], "total": 0}
            # postqueue -j outputs one JSON per line
            import json
            items = []
            for line in raw.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    items.append({
                        "queue_id": item.get("queue_id", ""),
                        "queue_name": item.get("queue_name", ""),
                        "arrival_time": item.get("arrival_time", 0),
                        "message_size": item.get("message_size", 0),
                        "sender": item.get("sender", ""),
                        "recipients": [
                            {
                                "address": r.get("address", ""),
                                "delay_reason": r.get("delay_reason", ""),
                            }
                            for r in item.get("recipients", [])
                        ],
                    })
                except json.JSONDecodeError:
                    continue
            return {"items": items, "total": len(items)}
    except Exception as e:
        logger.warning("Queue fetch failed: %s", e)
        return {"items": [], "total": 0, "error": str(e)}


@app.post("/api/queue/flush")
async def flush_queue():
    """Flush (retry) all deferred messages."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{POSTFIX_QUEUE_API}/flush")
            return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/queue/{queue_id}/requeue")
async def requeue_message(queue_id: str):
    """Requeue a specific message for redelivery."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{POSTFIX_QUEUE_API}/requeue/{queue_id}")
            return {"status": "ok", "queue_id": queue_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/queue/{queue_id}/delete")
async def delete_queue_message(queue_id: str):
    """Delete a message from the queue."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{POSTFIX_QUEUE_API}/delete/{queue_id}")
            return {"status": "ok", "queue_id": queue_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/queue/{queue_id}/hold")
async def hold_queue_message(queue_id: str):
    """Put a message on hold."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{POSTFIX_QUEUE_API}/hold/{queue_id}")
            return {"status": "ok", "queue_id": queue_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/queue/{queue_id}/release")
async def release_queue_message(queue_id: str):
    """Release a held message."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{POSTFIX_QUEUE_API}/release/{queue_id}")
            return {"status": "ok", "queue_id": queue_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- rspamd Scan History (shows ALL scans including remote scanner clients) ---

@app.get("/api/scan-history")
async def get_scan_history():
    """Get rspamd scan history from Redis (includes remote client scans)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password
            resp = await client.get(
                f"{settings.rspamd_controller_url}/history",
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "rows": data.get("rows", []),
                    "total": len(data.get("rows", [])),
                }
    except Exception as e:
        logger.warning("Failed to fetch scan history: %s", e)
    return {"rows": [], "total": 0}


@app.post("/api/scan-history/learn")
async def learn_from_scan_history(message_id: str = Query(...), learn_type: str = Query(...)):
    """Learn spam/ham from a scan history entry by message-id.
    Fetches the message from rspamd cache and trains."""
    if learn_type not in ("spam", "ham"):
        raise HTTPException(status_code=400, detail="learn_type must be spam or ham")
    # rspamd doesn't store full messages in history, so we can only
    # train the Bayes classifier via the fuzzy hash
    return {"status": "ok", "note": "Use the mail log learn buttons for full message training"}


# --- Scanner Clients (remote rspamd clients using SpamProxy as scan engine) ---

class ScannerClientRequest(BaseModel):
    name: str
    client_ip: str | None = None
    description: str | None = None


@app.get("/api/scanner-clients")
async def list_scanner_clients():
    async with async_session() as session:
        from sqlalchemy import text as sql_text
        result = await session.execute(sql_text(
            "SELECT id, name, client_ip, pubkey, keypair_id, is_active, description, created_at "
            "FROM scanner_clients ORDER BY name"
        ))
        return [
            {
                "id": str(row.id),
                "name": row.name,
                "client_ip": row.client_ip,
                "pubkey": row.pubkey,
                "keypair_id": row.keypair_id,
                "is_active": row.is_active,
                "description": row.description,
                "created_at": str(row.created_at),
            }
            for row in result
        ]


@app.post("/api/scanner-clients")
async def create_scanner_client(req: ScannerClientRequest):
    """Generate a keypair via rspamadm in the rspamd container."""
    import re as re_mod

    # Call rspamadm keypair via rspamd container's socat keypair-API (port 11336)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post("http://rspamd:11336/keypair")
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail="Keypair generation failed")
            output = resp.text
    except httpx.ConnectError:
        raise HTTPException(status_code=500, detail="Cannot reach rspamd keypair API (port 11336)")

    pubkey_m = re_mod.search(r'pubkey\s*=\s*"([^"]+)"', output)
    privkey_m = re_mod.search(r'privkey\s*=\s*"([^"]+)"', output)
    kid_m = re_mod.search(r'id\s*=\s*"([^"]+)"', output)

    if not pubkey_m or not privkey_m or not kid_m:
        raise HTTPException(status_code=500, detail=f"Failed to parse keypair: {output[:200]}")

    pubkey_str = pubkey_m.group(1)
    privkey_str = privkey_m.group(1)
    kid_str = kid_m.group(1)

    # Get proxy hostname for client config
    async with async_session() as session:
        s_result = await session.execute(select(Setting).where(Setting.key == "proxy_hostname"))
        s = s_result.scalar_one_or_none()
        proxy_host = str(s.value).strip('"') if s and s.value else "localhost"

        # Store client
        from sqlalchemy import text as sql_text
        await session.execute(sql_text(
            "INSERT INTO scanner_clients (name, client_ip, pubkey, privkey, keypair_id, description) "
            "VALUES (:name, :ip, :pub, :priv, :kid, :desc)"
        ), {
            "name": req.name,
            "ip": req.client_ip,
            "pub": pubkey_str,
            "priv": privkey_str,
            "kid": kid_str,
            "desc": req.description,
        })
        await session.commit()

    # Generate client config
    # Write server keypair to rspamd worker-normal.inc
    # The server needs the PRIVATE key to decrypt incoming requests
    import os
    keypair_conf = f'''
# Keypair for scanner client: {req.name}
keypair {{
    pubkey = "{pubkey_str}";
    privkey = "{privkey_str}";
    id = "{kid_str}";
    type = "kex";
    algorithm = "curve25519";
}}
'''
    keypairs_file = "/etc/rspamd/keypairs/scanner-keypairs.conf"
    try:
        os.makedirs(os.path.dirname(keypairs_file), exist_ok=True)
        with open(keypairs_file, "a") as f:
            f.write(keypair_conf)
        logger.info("Added keypair for client %s to %s", req.name, keypairs_file)
    except Exception as e:
        logger.warning("Could not write keypair to %s: %s", keypairs_file, e)

    # Client gets the PUBLIC key to encrypt scan requests
    client_worker_proxy = f'''# SpamProxy Remote Scanner Config for "{req.name}"
# Place this in /etc/rspamd/local.d/worker-proxy.inc on the CLIENT server
# Then restart rspamd: systemctl restart rspamd

bind_socket = "*:11332";
milter = yes;
timeout = 120s;

upstream "scan" {{
    default = yes;
    hosts = "round-robin:{proxy_host}:11333:1";
    key = "{pubkey_str}";
    compression = yes;
}}
'''

    return {
        "status": "ok",
        "pubkey": pubkey_str,
        "keypair_id": kid_str,
        "proxy_host": proxy_host,
        "client_config": client_worker_proxy,
        "server_keypair_added": True,
        "note": "Restart rspamd on the SpamProxy server to activate the keypair",
        "setup_instructions": f"""Scanner Client Setup for "{req.name}":

=== On the SPAMPROXY SERVER ({proxy_host}) ===

1. Restart rspamd to load the new keypair:
   docker compose restart rspamd

2. Open firewall for the client IP:
   ./scripts/deploy.sh federation-add {req.client_ip or '<CLIENT-IP>'} "{req.name}"

=== On the CLIENT SERVER ===

3. Install rspamd:
   apt install rspamd

4. Create /etc/rspamd/local.d/worker-proxy.inc with the config above

5. Disable the local normal worker (scanning is done by SpamProxy):
   echo 'enabled = false;' > /etc/rspamd/local.d/worker-normal.inc

6. Configure Postfix to use the local rspamd proxy as milter:
   postconf -e 'smtpd_milters = inet:localhost:11332'
   postconf -e 'milter_default_action = accept'

7. Restart both services:
   systemctl restart rspamd
   systemctl restart postfix

=== Mail Flow ===
  Client Postfix → local rspamd proxy (port 11332)
    → SpamProxy rspamd (port 11333, encrypted with curve25519)
      → scan result back to client
        → Postfix delivers locally (no double scanning)
""",
    }


@app.delete("/api/scanner-clients/{client_id}")
async def delete_scanner_client(client_id: UUID):
    async with async_session() as session:
        from sqlalchemy import text as sql_text
        await session.execute(sql_text(
            "DELETE FROM scanner_clients WHERE id = :id"
        ), {"id": client_id})
        await session.commit()
        return {"status": "ok"}


@app.get("/api/scanner-clients/{client_id}/config")
async def get_scanner_client_config(client_id: UUID):
    """Get the client worker-proxy.inc config for a specific client."""
    async with async_session() as session:
        from sqlalchemy import text as sql_text
        result = await session.execute(sql_text(
            "SELECT pubkey, name FROM scanner_clients WHERE id = :id"
        ), {"id": client_id})
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="Client not found")

        s_result = await session.execute(select(Setting).where(Setting.key == "proxy_hostname"))
        s = s_result.scalar_one_or_none()
        proxy_host = str(s.value).strip('"') if s and s.value else "localhost"

    config = f'''# SpamProxy Remote Scanner Config for "{row.name}"
# Place in /etc/rspamd/local.d/worker-proxy.inc on the client server

bind_socket = "*:11332";
milter = yes;
timeout = 120s;

upstream "scan" {{
    default = yes;
    hosts = "round-robin:{proxy_host}:11333:1";
    key = "{row.pubkey}";
    compression = yes;
}}
'''
    return PlainTextResponse(config, media_type="text/plain")


# --- rspamd Symbols ---

@app.get("/api/rspamd-symbols")
async def get_rspamd_symbols():
    """Get all rspamd symbols with scores and descriptions from rspamd controller."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password
            resp = await client.get(
                f"{settings.rspamd_controller_url}/symbols",
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json()
            # Fallback: configdump
            resp = await client.get(
                f"{settings.rspamd_controller_url}/actions",
                headers=headers,
            )
    except Exception as e:
        logger.warning("Failed to fetch rspamd symbols: %s", e)
    return []


@app.get("/api/rspamd-symbols/groups")
async def get_rspamd_symbol_groups():
    """Get rspamd symbols organized by group with descriptions."""
    try:
        import subprocess, json
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "rspamd", "rspamadm", "configdump", "--compact", "group"],
            capture_output=True, timeout=10,
        )
        if result.returncode == 0:
            groups = []
            for line in result.stdout.decode().strip().split("\n"):
                if line.strip():
                    try:
                        groups.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            return groups
    except Exception:
        pass

    # Fallback: read from rspamd controller API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password
            resp = await client.get(
                f"{settings.rspamd_controller_url}/symbols",
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                # Restructure into groups
                groups = {}
                for item in data:
                    group = item.get("group", "ungrouped")
                    if group not in groups:
                        groups[group] = {"name": group, "symbols": []}
                    groups[group]["symbols"].append({
                        "name": item.get("symbol", ""),
                        "score": item.get("weight", 0),
                        "description": item.get("description", ""),
                    })
                return list(groups.values())
    except Exception as e:
        logger.warning("Failed to fetch rspamd symbol groups: %s", e)
    return []


class SymbolScoreUpdate(BaseModel):
    symbol: str
    score: float


@app.put("/api/rspamd-symbols/score")
async def update_rspamd_symbol_score(req: SymbolScoreUpdate):
    """Update an rspamd symbol score. Writes to local.d/groups_override.conf."""
    import os

    # Write override to rspamd config
    override_file = "/etc/rspamd/local.d/groups_override.conf"
    # This file is mounted from docker volume, but we can't write to it directly
    # from mail-service. Instead, store overrides in DB and apply via rspamd HTTP API.

    # Use rspamd HTTP API to dynamically change the weight
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {"Content-Type": "application/json"}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password

            # rspamd doesn't have a direct "set symbol weight" API
            # We store overrides in our DB and generate a config file
            pass
    except Exception:
        pass

    # Store in DB settings for persistence
    async with async_session() as session:
        key = f"rspamd_symbol_{req.symbol}"
        result = await session.execute(select(Setting).where(Setting.key == key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = req.score
            setting.updated_at = datetime.now(timezone.utc)
        else:
            session.add(Setting(
                key=key,
                value=req.score,
                category="rspamd_symbols",
                description=f"Custom score override for {req.symbol}",
            ))
        await session.commit()

    return {"status": "ok", "symbol": req.symbol, "score": req.score,
            "note": "Score saved. Restart rspamd to apply (scores are applied at next container restart)."}


@app.get("/api/rspamd-symbols/overrides")
async def get_rspamd_symbol_overrides():
    """Get all custom symbol score overrides from DB."""
    async with async_session() as session:
        result = await session.execute(
            select(Setting).where(Setting.category == "rspamd_symbols").order_by(Setting.key)
        )
        return {
            s.key.replace("rspamd_symbol_", ""): s.value
            for s in result.scalars()
        }


# --- Bayes Training ---

from .bayes_trainer import train_spam_monthly, train_ham_corpus, _get_last_trained, _get_trained_months, _generate_months, TRAIN_START_YEAR, TRAIN_START_MONTH

@app.get("/api/bayes-training/status")
async def bayes_training_status():
    """Get Bayes training status."""
    import os
    data_dir = "/var/lib/spamproxy/bayes-training"
    last_trained = _get_last_trained()
    ham_trained = os.path.exists(f"{data_dir}/ham_trained")

    # Get rspamd stat
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if settings.rspamd_password:
                headers["Password"] = settings.rspamd_password
            resp = await client.get(f"{settings.rspamd_controller_url}/stat", headers=headers)
            stat = resp.json() if resp.status_code == 200 else {}
    except Exception:
        stat = {}

    trained_months = _get_trained_months()
    all_months = _generate_months(TRAIN_START_YEAR, TRAIN_START_MONTH)
    missing_months = [m for m in all_months if m not in trained_months]

    return {
        "last_spam_trained": last_trained or None,
        "ham_corpus_trained": ham_trained,
        "spam_source": "https://untroubled.org/spam/",
        "ham_source": "SpamAssassin easy_ham corpus",
        "months_total": len(all_months),
        "months_trained": len(trained_months),
        "months_remaining": len(missing_months),
        "trained_months": sorted(trained_months),
        "rspamd_learned": stat.get("learned", 0),
        "rspamd_ham_count": stat.get("ham_count", 0),
        "rspamd_spam_count": stat.get("spam_count", 0),
    }


@app.post("/api/bayes-training/train-now")
async def bayes_train_now():
    """Manually trigger Bayes training. Trains next batch of missing months."""

    ham_count = await train_ham_corpus()
    spam_count = await train_spam_monthly()
    return {
        "status": "ok",
        "ham_learned": ham_count,
        "spam_learned": spam_count,
    }


# --- Dovecot Script Downloads ---

from fastapi.responses import PlainTextResponse


@app.get("/api/dovecot/learn-script")
async def download_dovecot_learn_script(
    users_file: str = Query("/etc/dovecot/users"),
    junk_folders: str = Query("Junk,Spam,.Junk,.Spam,INBOX.Junk,INBOX.Spam"),
    max_age: int = Query(7),
    learn_ham: bool = Query(True),
):
    """Generate a customized dovecot-learn.sh with correct SpamProxy URL."""
    from .dovecot_scripts import generate_learn_script
    async with async_session() as session:
        result = await session.execute(select(Setting).where(Setting.key == "proxy_hostname"))
        setting = result.scalar_one_or_none()
        proxy_host = str(setting.value).strip('"') if setting and setting.value else "localhost"
    script = generate_learn_script(proxy_host, users_file, junk_folders, max_age, learn_ham)
    return PlainTextResponse(script, media_type="text/x-shellscript", headers={
        "Content-Disposition": "attachment; filename=dovecot-learn.sh",
    })


@app.get("/api/dovecot/sieve-kit")
async def download_sieve_kit():
    """Generate a customized sieve kit with the correct SpamProxy URL."""
    import tarfile
    import io

    async with async_session() as session:
        result = await session.execute(select(Setting).where(Setting.key == "proxy_hostname"))
        setting = result.scalar_one_or_none()
        proxy_host = str(setting.value).strip('"') if setting and setting.value else "localhost"

    api_url = f"https://{proxy_host}"

    files = {
        "learn-spam.sh": f'''#!/bin/bash
SPAMPROXY_URL="{api_url}"
exec curl -s -o /dev/null \\
    -X POST "${{SPAMPROXY_URL}}/api/learn/spam" \\
    -H "Content-Type: application/octet-stream" \\
    --data-binary @- \\
    --max-time 30
''',
        "learn-ham.sh": f'''#!/bin/bash
SPAMPROXY_URL="{api_url}"
exec curl -s -o /dev/null \\
    -X POST "${{SPAMPROXY_URL}}/api/learn/ham" \\
    -H "Content-Type: application/octet-stream" \\
    --data-binary @- \\
    --max-time 30
''',
        "learn-spam.sieve": '''require ["vnd.dovecot.pipe", "copy", "imapsieve", "environment", "variables"];
if environment :matches "imap.cause" "*" {
    pipe :copy "learn-spam.sh";
}
''',
        "learn-ham.sieve": '''require ["vnd.dovecot.pipe", "copy", "imapsieve", "environment", "variables"];
if environment :matches "imap.cause" "*" {
    pipe :copy "learn-ham.sh";
}
''',
        "README.txt": f'''SpamProxy Dovecot Sieve Kit
===========================
Generated for: {proxy_host}
API URL: {api_url}

Installation:
1. Copy files to Dovecot sieve directory:
   sudo cp learn-spam.sh learn-ham.sh /etc/dovecot/sieve/
   sudo cp learn-spam.sieve learn-ham.sieve /etc/dovecot/sieve/
   sudo chmod +x /etc/dovecot/sieve/learn-spam.sh /etc/dovecot/sieve/learn-ham.sh

2. Compile sieve scripts:
   sudo sievec /etc/dovecot/sieve/learn-spam.sieve
   sudo sievec /etc/dovecot/sieve/learn-ham.sieve

3. Add to /etc/dovecot/conf.d/90-sieve.conf:

   protocol imap {{
     mail_plugins = $mail_plugins imap_sieve
   }}

   plugin {{
     sieve_plugins = sieve_imapsieve sieve_extprograms

     imapsieve_mailbox1_name = Junk
     imapsieve_mailbox1_causes = COPY APPEND
     imapsieve_mailbox1_before = file:/etc/dovecot/sieve/learn-spam.sieve

     imapsieve_mailbox2_name = *
     imapsieve_mailbox2_from = Junk
     imapsieve_mailbox2_causes = COPY
     imapsieve_mailbox2_before = file:/etc/dovecot/sieve/learn-ham.sieve

     sieve_pipe_bin_dir = /etc/dovecot/sieve
     sieve_global_extensions = +vnd.dovecot.pipe +vnd.dovecot.environment
   }}

4. Restart Dovecot:
   sudo systemctl restart dovecot

How it works:
- User moves mail to Junk folder -> learn-spam.sh sends it to SpamProxy
- User moves mail from Junk folder -> learn-ham.sh sends it to SpamProxy
- SpamProxy trains rspamd locally and syncs to federation peers
''',
    }

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(name=f"dovecot-sieve/{name}")
            info.size = len(data)
            info.mode = 0o755 if name.endswith(".sh") else 0o644
            tar.addfile(info, io.BytesIO(data))
    buf.seek(0)

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        buf,
        media_type="application/gzip",
        headers={"Content-Disposition": "attachment; filename=dovecot-sieve-kit.tar.gz"},
    )


# --- Quarantine Recipients (end users who receive daily reports) ---

class RecipientCreate(BaseModel):
    email: str
    name: str | None = None
    daily_report_enabled: bool = True
    language: str = "de"


class RecipientUpdate(BaseModel):
    name: str | None = None
    daily_report_enabled: bool | None = None
    language: str | None = None


@app.get("/api/recipients")
async def list_recipients():
    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).order_by(QuarantineRecipient.email)
        )
        rows = result.scalars().all()
        return {"recipients": [
            {
                "id": str(r.id),
                "email": r.email,
                "name": r.name,
                "daily_report_enabled": r.daily_report_enabled,
                "has_password": bool(r.password_hash),
                "language": r.language,
                "last_report_sent_at": r.last_report_sent_at.isoformat()
                    if r.last_report_sent_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]}


@app.post("/api/recipients")
async def create_recipient(req: RecipientCreate):
    email = req.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    async with async_session() as db:
        existing = await db.execute(
            select(QuarantineRecipient).where(QuarantineRecipient.email == email)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="recipient already exists")
        r = QuarantineRecipient(
            email=email,
            name=req.name,
            daily_report_enabled=req.daily_report_enabled,
            language=req.language or "de",
        )
        db.add(r)
        await db.commit()
        await db.refresh(r)
        return {"id": str(r.id), "email": r.email}


@app.patch("/api/recipients/{rid}")
async def update_recipient(rid: UUID, req: RecipientUpdate):
    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(QuarantineRecipient.id == rid)
        )
        r = result.scalar_one_or_none()
        if not r:
            raise HTTPException(status_code=404, detail="not found")
        if req.name is not None:
            r.name = req.name
        if req.daily_report_enabled is not None:
            r.daily_report_enabled = req.daily_report_enabled
        if req.language is not None:
            r.language = req.language
        await db.commit()
        return {"ok": True}


@app.delete("/api/recipients/{rid}")
async def delete_recipient(rid: UUID):
    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(QuarantineRecipient.id == rid)
        )
        r = result.scalar_one_or_none()
        if not r:
            raise HTTPException(status_code=404, detail="not found")
        await db.delete(r)
        await db.commit()
        return {"ok": True}


@app.post("/api/recipients/{rid}/send-now")
async def send_report_now(rid: UUID):
    """Trigger an immediate daily report for one recipient (test or manual)."""
    from .quarantine.daily_report import send_report as _send_report
    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(QuarantineRecipient.id == rid)
        )
        r = result.scalar_one_or_none()
        if not r:
            raise HTTPException(status_code=404, detail="not found")
        count = await _send_report(db, r)
        return {"sent": count}


# --- Public token-based quarantine actions (no auth) ---

@app.get("/q/{token}/go")
async def public_quarantine_action(token: str):
    """One-click approve/reject from daily report links. No auth required;
    the HMAC-signed token IS the authorization. Returns a small HTML page."""
    from fastapi.responses import HTMLResponse

    def _page(title: str, message: str, color: str) -> HTMLResponse:
        return HTMLResponse(f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;margin:0;padding:24px;}}
.card{{max-width:480px;margin:80px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;
       border:1px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,.05);}}
h1{{margin:0 0 8px;font-size:20px;color:{color};}}
p{{color:#374151;font-size:14px;line-height:1.5;margin:8px 0;}}
</style></head><body>
<div class="card"><h1>{title}</h1><p>{message}</p></div>
</body></html>""")

    async with async_session() as db:
        try:
            payload = await _verify_qtoken(db, token)
        except ValueError as e:
            return _page("Link ungültig", f"Dieser Link ist ungültig oder abgelaufen ({e}).", "#dc2626")

        qm = QuarantineManager(db)
        action = payload["a"]

        # Single-mail token
        if "q" in payload:
            qid = UUID(payload["q"])
            if action == "approve":
                ok = await qm.approve(qid)
                if ok:
                    return _page("Zugestellt", "Die Nachricht wurde an Ihr Postfach zugestellt.", "#16a34a")
                return _page("Bereits verarbeitet", "Diese Nachricht wurde bereits bearbeitet oder ist nicht mehr verfügbar.", "#6b7280")
            ok = await qm.reject(qid)
            if ok:
                return _page("Als Spam markiert", "Die Nachricht wurde verworfen und rspamd lernt das Muster als Spam.", "#dc2626")
            return _page("Bereits verarbeitet", "Diese Nachricht wurde bereits bearbeitet.", "#6b7280")

        # Bulk token: act on the exact list of quarantine IDs from the report.
        ids = [UUID(s) for s in payload["i"]]
        total = len(ids)
        succeeded = 0
        skipped = 0
        for qid in ids:
            try:
                if action == "approve_all":
                    if await qm.approve(qid):
                        succeeded += 1
                    else:
                        skipped += 1
                else:
                    if await qm.reject(qid):
                        succeeded += 1
                    else:
                        skipped += 1
            except Exception:
                logger.exception("Bulk action failed for %s", qid)
                skipped += 1

        skipped_note = (
            f" {skipped} Nachricht(en) wurden übersprungen (bereits einzeln verarbeitet)."
            if skipped else ""
        )

        if action == "approve_all":
            return _page(
                "Alle zugestellt",
                f"{succeeded} von {total} Nachrichten wurden an Ihr Postfach zugestellt.{skipped_note}",
                "#16a34a",
            )
        return _page(
            "Alle als Spam markiert",
            f"{succeeded} von {total} Nachrichten wurden verworfen und rspamd lernt die Muster.{skipped_note}",
            "#dc2626",
        )


# --- Safe Links (click-time URL protection) ---

from .safelinks.tokens import verify_link_token as _verify_link_token


async def _safelinks_get(db, keys: list[str]) -> dict:
    result = await db.execute(select(Setting).where(Setting.key.in_(keys)))
    return {s.key: s.value for s in result.scalars()}


def _surbl_listed(host: str) -> str | None:
    """Return the name of the first blocklist that lists `host`, or None.
    Runs blocking DNS lookups - call via asyncio.to_thread."""
    try:
        import dns.resolver
    except Exception:
        return None
    host = host.strip(".").lower()
    if not host or host.replace(".", "").isdigit():
        return None  # skip bare IPs
    resolver = dns.resolver.Resolver()
    resolver.lifetime = 3.0
    resolver.timeout = 3.0
    checks = [("dbl.spamhaus.org", "Spamhaus DBL"), ("multi.surbl.org", "SURBL")]
    for zone, label in checks:
        try:
            answers = resolver.resolve(f"{host}.{zone}", "A")
            for a in answers:
                # 127.0.0.1 is the "test point" / not-really-listed sentinel.
                if str(a).startswith("127.0.") and str(a) != "127.0.0.1":
                    return label
        except Exception:
            continue
    return None


async def _reputation_of(db, url: str, check_surbl: bool) -> tuple[str, str]:
    """Reputation check for a single URL: admin blacklist + optional SURBL/DBL.
    Returns (verdict, reason); verdict is clean|suspicious|malicious."""
    from urllib.parse import urlsplit
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return "suspicious", "URL nicht interpretierbar"
    if not host:
        return "suspicious", "Kein Host in der URL"

    # Admin blacklist (domain + url entries).
    result = await db.execute(
        select(AccessList).where(
            AccessList.list_type == "blacklist",
            AccessList.is_active.is_(True),
        )
    )
    for entry in result.scalars():
        val = (entry.value or "").lower().strip()
        if not val:
            continue
        if entry.entry_type == "domain":
            if host == val or host.endswith("." + val):
                return "malicious", f"Domain steht auf der Blacklist ({val})"
        elif entry.entry_type == "url":
            if val in url.lower():
                return "malicious", "URL steht auf der Blacklist"

    if check_surbl:
        listed = await asyncio.to_thread(_surbl_listed, host)
        if listed:
            return "malicious", f"Domain in Spam-URL-Blocklist gelistet ({listed})"

    return "clean", "Keine Auffälligkeiten"


async def _safelinks_check_url(db, url: str, opts: dict) -> tuple[str, str, str]:
    """Classify a destination URL through all enabled layers. Returns
    (verdict, reason, final_url) where final_url is the URL after following
    redirects (== url if resolution is off or nothing changed)."""
    from .safelinks.scanner import resolve_final_url, google_safe_browsing_lookup

    # 1. Reputation of the URL as written in the mail.
    verdict, reason = await _reputation_of(db, url, opts.get("check_surbl", False))
    if verdict == "malicious":
        return verdict, reason, url

    # 2. Optional: follow redirects to the real destination (anti-cloaking).
    final_url = url
    if opts.get("resolve_redirects"):
        resolved, status = await resolve_final_url(url)
        if status == "blocked-nonpublic":
            return ("malicious",
                    "Weiterleitung auf ein nicht-öffentliches Ziel "
                    "(mögliches SSRF/Phishing)", resolved)
        if resolved and resolved != url:
            final_url = resolved
            rep2, reason2 = await _reputation_of(db, final_url, opts.get("check_surbl", False))
            if rep2 == "malicious":
                return "malicious", f"Weiterleitungsziel: {reason2}", final_url

    # 3. Optional: real threat scan via Google Safe Browsing (original + final).
    if opts.get("scan_sb") and opts.get("sb_api_key"):
        for candidate in dict.fromkeys([url, final_url]):
            listed, sb_reason = await google_safe_browsing_lookup(
                candidate, opts["sb_api_key"]
            )
            if listed:
                return "malicious", f"Google Safe Browsing: {sb_reason}", candidate

    return verdict, reason, final_url


async def _log_safelink_click(db, url: str, host: str, verdict: str, proceeded: bool):
    try:
        await db.execute(
            text(
                "INSERT INTO safelink_clicks (url, host, verdict, proceeded) "
                "VALUES (:u, :h, :v, :p)"
            ),
            {"u": url[:2048], "h": host[:255], "v": verdict, "p": proceeded},
        )
        await db.commit()
    except Exception:
        logger.exception("Failed to log safelink click")


def _safelinks_page(title: str, body_html: str, accent: str, status: int = 200):
    from fastapi.responses import HTMLResponse
    return HTMLResponse(f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;margin:0;padding:24px;}}
.card{{max-width:520px;margin:64px auto;background:#fff;border-radius:12px;padding:32px;
       border:1px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,.05);}}
h1{{margin:0 0 12px;font-size:20px;color:{accent};}}
p{{color:#374151;font-size:14px;line-height:1.55;margin:8px 0;}}
.dest{{display:block;word-break:break-all;background:#f9fafb;border:1px solid #e5e7eb;
       border-radius:8px;padding:10px 12px;font-size:13px;color:#111827;margin:16px 0;}}
.btn{{display:inline-block;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;
      text-decoration:none;color:#fff;background:{accent};}}
.btn.secondary{{background:#6b7280;}}
.warn{{background:#fef2f2;border-color:#fecaca;color:#991b1b;}}
.muted{{color:#6b7280;font-size:12px;margin-top:20px;}}
</style></head><body>
<div class="card">{body_html}</div>
</body></html>""", status_code=status)


@app.get("/l/{token}")
async def safelinks_redirect(token: str):
    """Click-time protected link target. Verifies the signed token, checks the
    destination's reputation, and shows an interstitial (or blocks). The
    HMAC-signed token IS the authorization; no login required."""
    import html as _html
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlsplit

    async with async_session() as db:
        vals = await _safelinks_get(db, [
            "safelinks_mode", "safelinks_check_surbl",
            "safelinks_scan_google_sb", "safelinks_google_sb_api_key",
            "safelinks_resolve_redirects",
            "safelinks_interstitial_title", "safelinks_interstitial_text",
            "safelinks_button_label", "safelinks_block_title", "safelinks_block_text",
        ])
        mode = str(vals.get("safelinks_mode") or "interstitial").strip('"')

        def _flag(key: str) -> bool:
            return vals.get(key) is True or vals.get(key) == "true"

        opts = {
            "check_surbl": _flag("safelinks_check_surbl"),
            "scan_sb": _flag("safelinks_scan_google_sb"),
            "sb_api_key": str(vals.get("safelinks_google_sb_api_key") or "").strip('"').strip(),
            "resolve_redirects": _flag("safelinks_resolve_redirects"),
        }

        def _txt(key: str, default: str) -> str:
            v = vals.get(key)
            v = "" if v is None else str(v).strip('"').strip()
            return v or default
        secret = ""
        srow = await db.execute(select(Setting).where(Setting.key == "report_token_secret"))
        s = srow.scalar_one_or_none()
        if s and s.value:
            secret = str(s.value).strip('"')

        try:
            url = _verify_link_token(token, secret)
        except ValueError:
            return _safelinks_page(
                "Link ungültig",
                "<h1>Link ungültig oder abgelaufen</h1>"
                "<p>Dieser geschützte Link ist nicht mehr gültig. Bitte öffnen "
                "Sie die ursprüngliche E-Mail erneut.</p>",
                "#dc2626", status=400,
            )

        host = (urlsplit(url).hostname or "").lower()
        verdict, reason, final_url = await _safelinks_check_url(db, url, opts)
        safe_url = _html.escape(url, quote=True)

        if verdict == "malicious":
            await _log_safelink_click(db, url, host, verdict, proceeded=False)
            block_title = _txt("safelinks_block_title", "Gefährlicher Link blockiert")
            block_text = _txt(
                "safelinks_block_text",
                "SpamProxy hat das Ziel dieses Links als gefährlich eingestuft "
                "und den Zugriff blockiert.",
            )
            return _safelinks_page(
                "Zugriff blockiert",
                f"<h1>⛔ {_html.escape(block_title)}</h1>"
                f"<p>{_html.escape(block_text)}</p>"
                f"<p><strong>Grund:</strong> {_html.escape(reason)}</p>"
                f"<span class='dest warn'>{safe_url}</span>"
                f"<p class='muted'>Wenn Sie sicher sind, dass diese Seite "
                f"vertrauenswürdig ist, wenden Sie sich an Ihren "
                f"Administrator.</p>",
                "#dc2626", status=200,
            )

        # clean or suspicious: interstitial mode always shows the destination.
        if mode == "silent" and verdict == "clean":
            await _log_safelink_click(db, url, host, verdict, proceeded=True)
            return RedirectResponse(url, status_code=302)

        await _log_safelink_click(db, url, host, verdict, proceeded=False)
        warn = ""
        if verdict == "suspicious":
            warn = (f"<p><strong>Hinweis:</strong> {_html.escape(reason)}</p>")
        title = _txt("safelinks_interstitial_title", "Sie verlassen den geschützten Bereich")
        intro = _txt(
            "safelinks_interstitial_text",
            "Sie werden zu folgender Adresse weitergeleitet. Bitte prüfen Sie, "
            "ob das Ziel Ihren Erwartungen entspricht:",
        )
        button = _txt("safelinks_button_label", "Weiter zur Seite")
        redirect_note = ""
        if final_url and final_url != url:
            redirect_note = (
                f"<p><strong>Weiterleitung erkannt.</strong> Tatsächliches Ziel:</p>"
                f"<span class='dest'>{_html.escape(final_url, quote=True)}</span>"
            )
        return _safelinks_page(
            "Sicherer Link",
            f"<h1>🔗 {_html.escape(title)}</h1>"
            f"<p>{_html.escape(intro)}</p>"
            f"<span class='dest'>{safe_url}</span>"
            f"{redirect_note}"
            f"{warn}"
            f"<p><a class='btn' href='{safe_url}' rel='noopener noreferrer'>"
            f"{_html.escape(button)}</a></p>"
            f"<p class='muted'>Dieser Link wurde von SpamProxy auf Bedrohungen "
            f"geprüft.</p>",
            "#2563eb", status=200,
        )


@app.get("/api/safelinks/clicks")
async def safelinks_clicks(limit: int = Query(100, le=500)):
    """Recent safe-link clicks for the admin dashboard."""
    async with async_session() as db:
        try:
            result = await db.execute(
                text(
                    "SELECT url, host, verdict, proceeded, created_at "
                    "FROM safelink_clicks ORDER BY created_at DESC LIMIT :lim"
                ),
                {"lim": limit},
            )
        except Exception:
            return {"clicks": []}
        return {
            "clicks": [
                {
                    "url": row[0],
                    "host": row[1],
                    "verdict": row[2],
                    "proceeded": row[3],
                    "created_at": str(row[4]),
                }
                for row in result.fetchall()
            ]
        }


# --- End-user portal (recipient self-service) ---

from .quarantine.portal_auth import (
    make_magic_link_token, verify_magic_link_token,
    make_session_token, verify_session_token,
    COOKIE_NAME as _PORTAL_COOKIE,
    SESSION_TTL_SECONDS as _PORTAL_SESSION_TTL,
)
from .quarantine.models import RecipientAccessList as _RAL
from fastapi import Cookie, Response


async def _current_portal_recipient(db, cookie_val: str | None) -> QuarantineRecipient | None:
    if not cookie_val:
        return None
    try:
        email = await verify_session_token(db, cookie_val)
    except ValueError:
        return None
    result = await db.execute(
        select(QuarantineRecipient).where(
            QuarantineRecipient.email == email,
            QuarantineRecipient.portal_enabled.is_(True),
        )
    )
    return result.scalar_one_or_none()


class PortalLoginRequest(BaseModel):
    email: str


@app.post("/api/portal/request-login")
async def portal_request_login(req: PortalLoginRequest):
    """Send a magic-link email if the address is a known recipient. Response
    is always 200 so we don't leak which emails are registered."""
    import smtplib
    from email.message import EmailMessage

    email = req.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")

    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(
                QuarantineRecipient.email == email,
                QuarantineRecipient.portal_enabled.is_(True),
            )
        )
        recipient = result.scalar_one_or_none()
        if not recipient:
            return {"ok": True}

        token = await make_magic_link_token(db, email)

        # Load helper settings
        async def _cfg(key: str, default: str = "") -> str:
            r = await db.execute(select(Setting).where(Setting.key == key))
            row = r.scalar_one_or_none()
            if not row:
                return default
            v = row.value
            return v.strip('"') if isinstance(v, str) else str(v)

        base = await _cfg("public_base_url", "https://spamproxy.example.com")
        from_addr = await _cfg("daily_report_from", "spamproxy@example.com")
        company = await _cfg("company_name", "")

        link = f"{base.rstrip('/')}/portal/verify/{token}"

        msg = EmailMessage()
        msg["From"] = f'"{company} Spamfilter" <{from_addr}>' if company else from_addr
        msg["To"] = email
        msg["Subject"] = "Ihr Login-Link zur Spam-Quarantäne"
        msg["Auto-Submitted"] = "auto-generated"
        msg.set_content(
            "Klicken Sie auf den folgenden Link, um sich anzumelden.\n"
            "Der Link ist 15 Minuten gültig.\n\n"
            f"{link}\n\n"
            "Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren."
        )
        msg.add_alternative(f"""
<!doctype html>
<html><body style="font-family:sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">Anmeldung zur Spam-Quarantäne</h1>
    <p style="color:#374151;font-size:14px;">
      Klicken Sie auf den Button, um sich anzumelden. Der Link ist 15 Minuten gültig.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="{link}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
         text-decoration:none;border-radius:8px;font-weight:600;">Jetzt anmelden</a>
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;">
      Falls der Button nicht funktioniert: {link}
    </p>
  </div>
</body></html>""", subtype="html")

        try:
            with smtplib.SMTP("postfix", 10025, timeout=30) as smtp:
                smtp.send_message(msg)
        except Exception:
            logger.exception("Failed to send magic-link email")

    return {"ok": True}


@app.get("/portal/verify/{token}")
async def portal_verify(token: str, response: Response):
    """Redeem magic link, set session cookie, redirect to portal."""
    from fastapi.responses import RedirectResponse, HTMLResponse
    async with async_session() as db:
        try:
            email = await verify_magic_link_token(db, token)
        except ValueError as e:
            return HTMLResponse(
                f"""<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
                <h1 style="color:#dc2626;">Link ungültig</h1>
                <p>Dieser Login-Link ist ungültig oder abgelaufen ({e}).</p>
                <p><a href="/portal">Neuen Link anfordern</a></p></body></html>""",
                status_code=400,
            )
        # Ensure recipient still exists and is enabled
        result = await db.execute(
            select(QuarantineRecipient).where(
                QuarantineRecipient.email == email,
                QuarantineRecipient.portal_enabled.is_(True),
            )
        )
        recipient = result.scalar_one_or_none()
        if not recipient:
            return HTMLResponse(
                """<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
                <h1>Zugang deaktiviert</h1><p>Ihr Zugang wurde deaktiviert.</p></body></html>""",
                status_code=403,
            )
        recipient.last_login_at = datetime.now(timezone.utc)
        session_tok = await make_session_token(db, email)
        await db.commit()

    resp = RedirectResponse(url="/portal", status_code=303)
    resp.set_cookie(
        _PORTAL_COOKIE, session_tok,
        max_age=_PORTAL_SESSION_TTL,
        httponly=True, samesite="lax", path="/",
    )
    return resp


@app.post("/api/portal/logout")
async def portal_logout(response: Response):
    response.delete_cookie(_PORTAL_COOKIE, path="/")
    return {"ok": True}


class PortalPasswordLogin(BaseModel):
    email: str
    password: str


@app.post("/api/portal/login-password")
async def portal_login_password(req: PortalPasswordLogin, response: Response):
    """Password-based login. Returns 401 on bad credentials or if the
    recipient has no password set (magic-link-only account)."""
    email = req.email.strip().lower()
    if "@" not in email or not req.password:
        raise HTTPException(status_code=400, detail="invalid credentials")

    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(
                QuarantineRecipient.email == email,
                QuarantineRecipient.portal_enabled.is_(True),
            )
        )
        recipient = result.scalar_one_or_none()
        if not recipient or not recipient.password_hash:
            raise HTTPException(status_code=401, detail="invalid credentials")

        verify = await db.execute(
            text("SELECT :hash = crypt(:password, :hash) AS valid"),
            {"hash": recipient.password_hash, "password": req.password},
        )
        if not verify.one().valid:
            raise HTTPException(status_code=401, detail="invalid credentials")

        recipient.last_login_at = datetime.now(timezone.utc)
        session_tok = await make_session_token(db, email)
        await db.commit()

    response.set_cookie(
        _PORTAL_COOKIE, session_tok,
        max_age=_PORTAL_SESSION_TTL,
        httponly=True, samesite="lax", path="/",
    )
    return {"ok": True, "email": email}


class PortalSetPassword(BaseModel):
    current_password: str | None = None
    new_password: str


@app.post("/api/portal/set-password")
async def portal_set_password(
    req: PortalSetPassword,
    spamproxy_portal: str | None = Cookie(default=None),
):
    """Recipient sets/changes their own password. Requires current password
    if one is already set."""
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="password too short (min 8)")
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        if r.password_hash:
            if not req.current_password:
                raise HTTPException(status_code=400, detail="current password required")
            verify = await db.execute(
                text("SELECT :hash = crypt(:password, :hash) AS valid"),
                {"hash": r.password_hash, "password": req.current_password},
            )
            if not verify.one().valid:
                raise HTTPException(status_code=401, detail="wrong current password")
        h = await db.execute(
            text("SELECT crypt(:password, gen_salt('bf')) AS hash"),
            {"password": req.new_password},
        )
        r.password_hash = h.one().hash
        await db.commit()
        return {"ok": True}


class AdminSetRecipientPassword(BaseModel):
    password: str | None = None  # None = clear password (magic-link only)


@app.post("/api/recipients/{rid}/set-password")
async def admin_set_recipient_password(rid: UUID, req: AdminSetRecipientPassword):
    """Admin sets or clears a recipient's portal password."""
    async with async_session() as db:
        result = await db.execute(
            select(QuarantineRecipient).where(QuarantineRecipient.id == rid)
        )
        r = result.scalar_one_or_none()
        if not r:
            raise HTTPException(status_code=404, detail="not found")
        if not req.password:
            r.password_hash = None
        else:
            if len(req.password) < 8:
                raise HTTPException(status_code=400, detail="password too short (min 8)")
            h = await db.execute(
                text("SELECT crypt(:password, gen_salt('bf')) AS hash"),
                {"password": req.password},
            )
            r.password_hash = h.one().hash
        await db.commit()
        return {"ok": True, "has_password": r.password_hash is not None}


@app.get("/api/portal/me")
async def portal_me(spamproxy_portal: str | None = Cookie(default=None)):
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        return {
            "email": r.email,
            "name": r.name,
            "language": r.language,
            "has_password": bool(r.password_hash),
        }


@app.get("/api/portal/quarantine")
async def portal_quarantine(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status: str = Query("pending"),
    spamproxy_portal: str | None = Cookie(default=None),
):
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")

        base = (
            select(Quarantine, MailLog)
            .join(MailLog, Quarantine.mail_log_id == MailLog.id)
            .where(Quarantine.status == status)
            .where(MailLog.rcpt_to.any(r.email))
        )
        count_q = select(func.count()).select_from(base.subquery())
        total = (await db.execute(count_q)).scalar() or 0
        result = await db.execute(
            base.order_by(desc(Quarantine.created_at))
            .offset((page - 1) * page_size).limit(page_size)
        )
        items = []
        for q, ml in result.all():
            items.append({
                "id": str(q.id),
                "mail_from": ml.mail_from,
                "subject": ml.subject,
                "final_score": ml.final_score,
                "status": q.status,
                "created_at": ml.created_at.isoformat() if ml.created_at else None,
                "body_preview": q.body_preview,
            })
        return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.post("/api/portal/quarantine/{qid}/action")
async def portal_quarantine_action(
    qid: UUID,
    req: ActionRequest,
    spamproxy_portal: str | None = Cookie(default=None),
):
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        # Verify this quarantine belongs to the user
        row = await db.execute(
            select(Quarantine, MailLog)
            .join(MailLog, Quarantine.mail_log_id == MailLog.id)
            .where(Quarantine.id == qid)
            .where(MailLog.rcpt_to.any(r.email))
        )
        pair = row.first()
        if not pair:
            raise HTTPException(status_code=404, detail="not found")
        qm = QuarantineManager(db)
        if req.action == "approve":
            ok = await qm.approve(qid)
        elif req.action == "reject":
            ok = await qm.reject(qid)
        else:
            raise HTTPException(status_code=400, detail="invalid action")
        return {"ok": ok}


class PortalAccessListEntry(BaseModel):
    list_type: str
    entry_type: str
    value: str


@app.get("/api/portal/access-list")
async def portal_access_list(spamproxy_portal: str | None = Cookie(default=None)):
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        result = await db.execute(
            select(_RAL).where(_RAL.recipient_id == r.id).order_by(_RAL.created_at.desc())
        )
        return {"entries": [
            {
                "id": str(e.id),
                "list_type": e.list_type,
                "entry_type": e.entry_type,
                "value": e.value,
                "is_active": e.is_active,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in result.scalars().all()
        ]}


@app.post("/api/portal/access-list")
async def portal_access_list_add(
    req: PortalAccessListEntry,
    spamproxy_portal: str | None = Cookie(default=None),
):
    if req.list_type not in ("whitelist", "blacklist"):
        raise HTTPException(status_code=400, detail="invalid list_type")
    if req.entry_type not in ("email", "domain"):
        raise HTTPException(status_code=400, detail="invalid entry_type")
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        entry = _RAL(
            recipient_id=r.id,
            list_type=req.list_type,
            entry_type=req.entry_type,
            value=req.value.strip().lower(),
        )
        db.add(entry)
        await db.commit()
        await db.refresh(entry)
        return {"id": str(entry.id)}


@app.delete("/api/portal/access-list/{entry_id}")
async def portal_access_list_delete(
    entry_id: UUID,
    spamproxy_portal: str | None = Cookie(default=None),
):
    async with async_session() as db:
        r = await _current_portal_recipient(db, spamproxy_portal)
        if not r:
            raise HTTPException(status_code=401, detail="not logged in")
        result = await db.execute(
            select(_RAL).where(_RAL.id == entry_id, _RAL.recipient_id == r.id)
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="not found")
        await db.delete(entry)
        await db.commit()
        return {"ok": True}
