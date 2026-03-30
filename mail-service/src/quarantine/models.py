import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text, ForeignKey, LargeBinary,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Domain(Base):
    __tablename__ = "domains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain = Column(String(255), unique=True, nullable=False)
    backend_host = Column(String(255), nullable=False)
    backend_port = Column(Integer, nullable=False, default=25)
    is_active = Column(Boolean, nullable=False, default=True)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MailLog(Base):
    __tablename__ = "mail_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(String(512))
    mail_from = Column(String(512))
    rcpt_to = Column(ARRAY(Text), nullable=False)
    subject = Column(Text)
    direction = Column(String(10), nullable=False)
    client_ip = Column(String(45))
    size_bytes = Column(Integer)
    rspamd_score = Column(Float)
    ai_score = Column(Float)
    final_score = Column(Float)
    rspamd_symbols = Column(JSONB)
    action = Column(String(20), nullable=False)
    backend_host = Column(String(255))
    processing_time_ms = Column(Integer)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    quarantine = relationship("Quarantine", back_populates="mail_log", uselist=False)


class Quarantine(Base):
    __tablename__ = "quarantine"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mail_log_id = Column(UUID(as_uuid=True), ForeignKey("mail_log.id", ondelete="CASCADE"), nullable=False)
    raw_message = Column(LargeBinary, nullable=False)
    parsed_headers = Column(JSONB)
    body_preview = Column(Text)
    status = Column(String(20), nullable=False, default="pending")
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_at = Column(DateTime(timezone=True))
    expires_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc) + timedelta(days=30),
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    mail_log = relationship("MailLog", back_populates="quarantine")


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(255), primary_key=True)
    value = Column(JSONB, nullable=False)
    category = Column(String(50), nullable=False, default="general")
    description = Column(Text)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class StatsHourly(Base):
    __tablename__ = "stats_hourly"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hour = Column(DateTime(timezone=True), unique=True, nullable=False)
    total_mails = Column(Integer, nullable=False, default=0)
    inbound_count = Column(Integer, nullable=False, default=0)
    outbound_count = Column(Integer, nullable=False, default=0)
    spam_count = Column(Integer, nullable=False, default=0)
    ham_count = Column(Integer, nullable=False, default=0)
    quarantine_count = Column(Integer, nullable=False, default=0)
    rejected_count = Column(Integer, nullable=False, default=0)
    avg_score = Column(Float)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SmtpCredential(Base):
    __tablename__ = "smtp_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255))
    allowed_from = Column(ARRAY(Text))
    is_active = Column(Boolean, nullable=False, default=True)
    max_messages_per_hour = Column(Integer, default=100)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class DkimKey(Base):
    __tablename__ = "dkim_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain = Column(String(255), nullable=False)
    selector = Column(String(100), nullable=False, default="spamproxy")
    private_key = Column(Text, nullable=False)
    public_key = Column(Text, nullable=False)
    dns_record = Column(Text, nullable=False)
    key_type = Column(String(10), nullable=False, default="rsa")
    key_bits = Column(Integer, nullable=False, default=2048)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RblList(Base):
    __tablename__ = "rbl_lists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False)
    rbl_host = Column(String(255), nullable=False)
    list_type = Column(String(20), nullable=False, default="ip")
    description = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AccessList(Base):
    __tablename__ = "access_lists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    list_type = Column(String(10), nullable=False)  # whitelist, blacklist
    entry_type = Column(String(10), nullable=False)  # domain, email, ip, cidr
    value = Column(String(512), nullable=False)
    description = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SenderDomain(Base):
    __tablename__ = "sender_domains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain = Column(String(255), unique=True, nullable=False)
    verification_method = Column(String(20), nullable=False, default="dns")
    verification_token = Column(String(64))
    is_verified = Column(Boolean, nullable=False, default=False)
    verified_at = Column(DateTime(timezone=True))
    spf_status = Column(String(20), default="unchecked")
    spf_record = Column(Text)
    spf_includes_proxy = Column(Boolean, default=False)
    dkim_status = Column(String(20), default="unchecked")
    dkim_selector = Column(String(100))
    dkim_record = Column(Text)
    mx_status = Column(String(20), default="unchecked")
    mx_records = Column(ARRAY(Text))
    last_dns_check = Column(DateTime(timezone=True))
    is_active = Column(Boolean, nullable=False, default=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ScoringRule(Base):
    __tablename__ = "scoring_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_type = Column(String(20), nullable=False)
    pattern = Column(String(255), nullable=False)
    score_adjustment = Column(Float, nullable=False, default=0.0)
    description = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RspamdPeer(Base):
    __tablename__ = "rspamd_peers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    url = Column(String(512), nullable=False)
    password = Column(String(255))
    sync_bayes_learn = Column(Boolean, nullable=False, default=True)
    sync_fuzzy = Column(Boolean, nullable=False, default=True)
    direction = Column(String(10), nullable=False, default="both")
    is_active = Column(Boolean, nullable=False, default=True)
    last_sync = Column(DateTime(timezone=True))
    last_error = Column(Text)
    total_synced = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class KeywordRule(Base):
    __tablename__ = "keyword_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    keyword = Column(String(255), nullable=False)
    match_type = Column(String(20), nullable=False, default="contains")  # contains, exact, regex
    match_field = Column(String(20), nullable=False, default="subject")  # subject, body, from, any
    score_adjustment = Column(Float, nullable=False, default=0.0)
    description = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
