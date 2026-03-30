import logging
from dataclasses import dataclass, field

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


@dataclass
class RspamdResult:
    score: float = 0.0
    required_score: float = 15.0
    action: str = "no action"
    symbols: dict = field(default_factory=dict)
    is_spam: bool = False
    is_skipped: bool = False


class RspamdClient:
    def __init__(self):
        self.base_url = settings.rspamd_url
        self.password = settings.rspamd_password
        self.client = httpx.AsyncClient(timeout=30.0)

    async def scan(self, raw_message: bytes, mail_from: str = "", rcpt_to: list[str] | None = None) -> RspamdResult:
        headers = {}
        if self.password:
            headers["Password"] = self.password
        if mail_from:
            headers["From"] = mail_from
        if rcpt_to:
            headers["Rcpt"] = ",".join(rcpt_to)

        try:
            response = await self.client.post(
                f"{self.base_url}/checkv2",
                content=raw_message,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            symbols = {}
            for name, sym_data in data.get("symbols", {}).items():
                symbols[name] = {
                    "score": sym_data.get("score", 0),
                    "description": sym_data.get("description", ""),
                }

            return RspamdResult(
                score=data.get("score", 0.0),
                required_score=data.get("required_score", 15.0),
                action=data.get("action", "no action"),
                symbols=symbols,
                is_spam=data.get("is_spam", False),
                is_skipped=data.get("is_skipped", False),
            )
        except Exception:
            logger.exception("rspamd scan failed")
            return RspamdResult()

    async def learn_spam(self, raw_message: bytes) -> bool:
        return await self._learn(raw_message, "learnspam")

    async def learn_ham(self, raw_message: bytes) -> bool:
        return await self._learn(raw_message, "learnham")

    async def _learn(self, raw_message: bytes, endpoint: str) -> bool:
        headers = {}
        if self.password:
            headers["Password"] = self.password
        try:
            response = await self.client.post(
                f"{self.base_url}/{endpoint}",
                content=raw_message,
                headers=headers,
            )
            response.raise_for_status()
            return True
        except Exception:
            logger.exception("rspamd %s failed", endpoint)
            return False

    async def close(self):
        await self.client.aclose()
