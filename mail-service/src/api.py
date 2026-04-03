import email as email_lib
import email.utils
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, func, desc, text

from .config import settings
from .db import async_session
from .quarantine.manager import QuarantineManager
from .quarantine.models import (
    MailLog, Quarantine, StatsHourly, Domain, Setting, User,
    SmtpCredential, DkimKey, RblList, AccessList, ScoringRule, SenderDomain, KeywordRule,
    RspamdPeer,
)
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
    return {"status": "ok", "service": "mail-service"}


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
            query = query.where(
                (MailLog.mail_from.ilike(f"%{search}%"))
                | (MailLog.subject.ilike(f"%{search}%"))
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
    final_score: float | None
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
                (MailLog.mail_from.ilike(f"%{search}%"))
                | (MailLog.subject.ilike(f"%{search}%"))
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
                final_score=m.final_score,
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
    try:
        answers = dns.resolver.resolve(domain, "TXT")
        for rdata in answers:
            txt = rdata.to_text().strip('"')
            if token in txt:
                return True
        # Also check _spamproxy subdomain
        try:
            answers = dns.resolver.resolve(f"_spamproxy.{domain}", "TXT")
            for rdata in answers:
                txt = rdata.to_text().strip('"')
                if token in txt:
                    return True
        except Exception:
            pass
        return False
    except Exception:
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
    async with async_session() as session:
        result = await session.execute(
            select(SenderDomain).where(SenderDomain.id == domain_id)
        )
        sd = result.scalar_one_or_none()
        if not sd:
            raise HTTPException(status_code=404, detail="Not found")

        method = req.method or sd.verification_method

        if method == "dns":
            if not _check_verification_token(sd.domain, sd.verification_token):
                raise HTTPException(
                    status_code=400,
                    detail=f"DNS-Verifikationstoken nicht gefunden. Erstelle einen TXT-Record fuer {sd.domain} oder _spamproxy.{sd.domain} mit: {sd.verification_token}",
                )

        # Verify and activate
        sd.is_verified = True
        sd.verified_at = datetime.now(timezone.utc)
        sd.is_active = True
        if method != sd.verification_method:
            sd.verification_method = method

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

    # Learn locally
    rspamd_client = settings.rspamd_url
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

    # Learn locally on rspamd
    rspamd_url = settings.rspamd_url
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
