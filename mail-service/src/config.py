from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://spamproxy:changeme@postgres:5432/spamproxy"

    # SMTP (used for quarantine release)
    smtp_backend_host: str = "mail.example.com"
    smtp_backend_port: int = 25

    # LMTP quarantine intake
    lmtp_port: int = 8024

    # rspamd
    rspamd_url: str = "http://rspamd:11333"
    rspamd_controller_url: str = "http://rspamd:11334"
    rspamd_password: str = ""

    # AI
    ai_provider: str = "openai"  # openai or ollama
    ai_api_key: str = ""
    ai_url: str = "http://ollama:11434"
    ai_model: str = "gpt-4o-mini"
    ai_enabled: bool = True

    # Thresholds
    spam_quarantine_threshold: float = 5.0
    spam_reject_threshold: float = 10.0
    ai_grey_zone_min: float = 3.0
    ai_grey_zone_max: float = 7.0

    # Quarantine
    quarantine_retention_days: int = 30

    # Internal API
    internal_api_port: int = 8025

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
