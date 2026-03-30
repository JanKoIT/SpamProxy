-- SpamProxy Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Domains managed by the proxy
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    backend_host VARCHAR(255) NOT NULL,
    backend_port INTEGER NOT NULL DEFAULT 25,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users for web interface and SMTP auth
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mail processing log
CREATE TABLE mail_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(512),
    mail_from VARCHAR(512),
    rcpt_to TEXT[] NOT NULL,
    subject TEXT,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    client_ip VARCHAR(45),
    size_bytes INTEGER,
    rspamd_score REAL,
    ai_score REAL,
    final_score REAL,
    rspamd_symbols JSONB,
    action VARCHAR(20) NOT NULL CHECK (action IN ('delivered', 'quarantined', 'rejected', 'error')),
    backend_host VARCHAR(255),
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mail_log_created_at ON mail_log(created_at DESC);
CREATE INDEX idx_mail_log_action ON mail_log(action);
CREATE INDEX idx_mail_log_direction ON mail_log(direction);
CREATE INDEX idx_mail_log_mail_from ON mail_log(mail_from);

-- Quarantine storage
CREATE TABLE quarantine (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mail_log_id UUID NOT NULL REFERENCES mail_log(id) ON DELETE CASCADE,
    raw_message BYTEA NOT NULL,
    parsed_headers JSONB,
    body_preview TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quarantine_status ON quarantine(status);
CREATE INDEX idx_quarantine_created_at ON quarantine(created_at DESC);
CREATE INDEX idx_quarantine_expires_at ON quarantine(expires_at);

-- Key-value settings
CREATE TABLE settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-aggregated hourly stats
CREATE TABLE stats_hourly (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hour TIMESTAMPTZ NOT NULL UNIQUE,
    total_mails INTEGER NOT NULL DEFAULT 0,
    inbound_count INTEGER NOT NULL DEFAULT 0,
    outbound_count INTEGER NOT NULL DEFAULT 0,
    spam_count INTEGER NOT NULL DEFAULT 0,
    ham_count INTEGER NOT NULL DEFAULT 0,
    quarantine_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    avg_score REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stats_hourly_hour ON stats_hourly(hour DESC);

-- SMTP outgoing credentials (for port 587 SASL auth)
CREATE TABLE smtp_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    allowed_from TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT true,
    max_messages_per_hour INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DKIM keys
CREATE TABLE dkim_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL,
    selector VARCHAR(100) NOT NULL DEFAULT 'spamproxy',
    private_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    dns_record TEXT NOT NULL,
    key_type VARCHAR(10) NOT NULL DEFAULT 'rsa',
    key_bits INTEGER NOT NULL DEFAULT 2048,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(domain, selector)
);

-- DNS Blocklists (RBL/DNSBL)
CREATE TABLE rbl_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    rbl_host VARCHAR(255) NOT NULL,
    list_type VARCHAR(20) NOT NULL DEFAULT 'ip' CHECK (list_type IN ('ip', 'domain', 'url')),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rbl_lists (name, rbl_host, list_type, description, is_active) VALUES
    ('Spamhaus ZEN', 'zen.spamhaus.org', 'ip', 'Spamhaus combined IP blocklist (SBL+XBL+PBL)', true),
    ('Spamhaus DBL', 'dbl.spamhaus.org', 'domain', 'Spamhaus Domain Block List', true),
    ('Barracuda', 'b.barracudacentral.org', 'ip', 'Barracuda Reputation Block List', true),
    ('SpamCop', 'bl.spamcop.net', 'ip', 'SpamCop Blocking List', true),
    ('SORBS', 'dnsbl.sorbs.net', 'ip', 'Spam and Open Relay Blocking System', true),
    ('Abuseat CBL', 'cbl.abuseat.org', 'ip', 'Composite Blocking List', true);

-- Whitelist / Blacklist
CREATE TABLE access_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_type VARCHAR(10) NOT NULL CHECK (list_type IN ('whitelist', 'blacklist')),
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('domain', 'email', 'ip', 'cidr')),
    value VARCHAR(512) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(list_type, entry_type, value)
);

-- TLD / Domain scoring rules
CREATE TABLE scoring_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('tld', 'domain', 'sender_domain')),
    pattern VARCHAR(255) NOT NULL,
    score_adjustment REAL NOT NULL DEFAULT 0.0,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_type, pattern)
);

INSERT INTO scoring_rules (rule_type, pattern, score_adjustment, description) VALUES
    ('tld', '.ru', 3.0, 'Russische TLD - erhoehtes Spam-Risiko'),
    ('tld', '.cn', 3.0, 'Chinesische TLD - erhoehtes Spam-Risiko'),
    ('tld', '.tr', 2.5, 'Tuerkische TLD - erhoehtes Spam-Risiko'),
    ('tld', '.br', 2.0, 'Brasilianische TLD - erhoehtes Spam-Risiko'),
    ('tld', '.in', 2.0, 'Indische TLD - erhoehtes Spam-Risiko'),
    ('tld', '.top', 4.0, 'Spam-TLD'),
    ('tld', '.xyz', 3.5, 'Spam-TLD'),
    ('tld', '.buzz', 4.0, 'Spam-TLD'),
    ('tld', '.click', 4.0, 'Spam-TLD'),
    ('tld', '.de', -1.0, 'Deutsche TLD - vertrauenswuerdig'),
    ('tld', '.com', -0.5, 'Standard-TLD'),
    ('tld', '.org', -0.5, 'Standard-TLD'),
    ('tld', '.net', -0.5, 'Standard-TLD'),
    ('tld', '.eu', -0.5, 'Europaeische TLD');

-- Sender domains (outgoing verification)
CREATE TABLE sender_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    verification_method VARCHAR(20) NOT NULL DEFAULT 'dns' CHECK (verification_method IN ('dns', 'manual')),
    verification_token VARCHAR(64),
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    spf_status VARCHAR(20) DEFAULT 'unchecked' CHECK (spf_status IN ('unchecked', 'ok', 'missing', 'invalid')),
    spf_record TEXT,
    spf_includes_proxy BOOLEAN DEFAULT false,
    dkim_status VARCHAR(20) DEFAULT 'unchecked' CHECK (dkim_status IN ('unchecked', 'ok', 'missing', 'invalid')),
    dkim_selector VARCHAR(100),
    dkim_record TEXT,
    mx_status VARCHAR(20) DEFAULT 'unchecked' CHECK (mx_status IN ('unchecked', 'ok', 'missing')),
    mx_records TEXT[],
    last_dns_check TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remote rspamd servers for federation
CREATE TABLE rspamd_peers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    url VARCHAR(512) NOT NULL,
    password VARCHAR(255),
    sync_bayes_learn BOOLEAN NOT NULL DEFAULT true,
    sync_fuzzy BOOLEAN NOT NULL DEFAULT true,
    direction VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (direction IN ('push', 'pull', 'both')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_sync TIMESTAMPTZ,
    last_error TEXT,
    total_synced INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keyword scoring rules
CREATE TABLE keyword_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword VARCHAR(255) NOT NULL,
    match_type VARCHAR(20) NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'exact', 'regex')),
    match_field VARCHAR(20) NOT NULL DEFAULT 'subject' CHECK (match_field IN ('subject', 'body', 'from', 'any')),
    score_adjustment REAL NOT NULL DEFAULT 0.0,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(keyword, match_type, match_field)
);

INSERT INTO keyword_rules (keyword, match_type, match_field, score_adjustment, description) VALUES
    ('viagra', 'contains', 'any', 5.0, 'Typisches Spam-Keyword'),
    ('casino', 'contains', 'any', 4.0, 'Gambling-Spam'),
    ('lottery', 'contains', 'any', 5.0, 'Lottery-Scam'),
    ('winner', 'contains', 'subject', 3.0, 'Prize-Scam Betreff'),
    ('urgent', 'contains', 'subject', 2.0, 'Dringlichkeits-Spam'),
    ('unsubscribe', 'contains', 'body', -0.5, 'Hat Abmeldelink (eher Newsletter)');

-- Insert default settings
INSERT INTO settings (key, value, category, description) VALUES
    ('spam_quarantine_threshold', '5.0', 'scanning', 'Score above which mail is quarantined'),
    ('spam_reject_threshold', '10.0', 'scanning', 'Score above which mail is rejected'),
    ('ai_grey_zone_min', '3.0', 'ai', 'Minimum rspamd score to trigger AI classification'),
    ('ai_grey_zone_max', '7.0', 'ai', 'Maximum rspamd score to trigger AI classification'),
    ('ai_enabled', 'true', 'ai', 'Enable AI-based spam classification'),
    ('ai_provider', '"openai"', 'ai', 'AI provider: openai or ollama'),
    ('ai_model', '"gpt-4o-mini"', 'ai', 'AI model to use'),
    ('quarantine_retention_days', '30', 'quarantine', 'Days to keep quarantined messages'),
    ('proxy_hostname', '"proxy.example.com"', 'smtp', 'Hostname for the SMTP proxy'),
    ('max_message_size', '26214400', 'smtp', 'Maximum message size in bytes (25MB)'),
    ('antivirus_enabled', 'true', 'scanning', 'Enable ClamAV virus scanning'),
    ('rbl_enabled', 'true', 'scanning', 'Enable DNS blocklist checks (RBL/DNSBL)'),
    ('spamhaus_dqs_key', '""', 'scanning', 'Spamhaus DQS API key (leave empty for free tier)'),
    ('dkim_signing_enabled', 'true', 'smtp', 'Enable DKIM signing for outgoing mail'),
    ('spf_enabled', 'true', 'scanning', 'Enable SPF verification'),
    ('spf_fail_score', '5.0', 'scanning', 'Score for SPF hard fail'),
    ('spf_softfail_score', '2.0', 'scanning', 'Score for SPF soft fail');

-- Insert default admin user (password: changeme)
INSERT INTO users (email, name, password_hash, role) VALUES
    ('admin@example.com', 'Administrator', crypt('changeme', gen_salt('bf')), 'admin');
