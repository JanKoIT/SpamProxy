import email
import logging
from email.policy import default as default_policy

import httpx
from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an email spam classifier. Analyze the email and return a spam score from 0.0 to 10.0.

Scoring guidelines:
- 0.0-2.0: Clearly legitimate email (personal correspondence, expected newsletters, business communication)
- 2.0-4.0: Likely legitimate but with some suspicious elements
- 4.0-6.0: Uncertain - could be spam or legitimate
- 6.0-8.0: Likely spam (unsolicited marketing, suspicious links, social engineering)
- 8.0-10.0: Clearly spam (phishing, scam, malware distribution)

Focus on:
- Social engineering patterns (urgency, threats, too-good-to-be-true offers)
- Phishing indicators (mismatched sender/content, credential requests)
- Header anomalies (forged sender, suspicious routing)
- Content patterns (excessive links, hidden text, deceptive formatting)

Respond with ONLY a JSON object: {"score": <float>, "reason": "<brief explanation>"}"""


class AIClassifier:
    def __init__(self):
        self.provider = settings.ai_provider
        if self.provider == "openai":
            self.openai_client = AsyncOpenAI(api_key=settings.ai_api_key)
        self.http_client = httpx.AsyncClient(timeout=60.0)

    async def classify(self, raw_message: bytes) -> tuple[float, str]:
        try:
            parsed = email.message_from_bytes(raw_message, policy=default_policy)

            headers_text = "\n".join(
                f"{k}: {v}" for k, v in list(parsed.items())[:20]
            )

            body = ""
            body_part = parsed.get_body(preferencelist=("plain",))
            if body_part:
                body = body_part.get_content()[:3000]

            user_prompt = f"Headers:\n{headers_text}\n\nBody:\n{body}"

            if self.provider == "openai":
                return await self._classify_openai(user_prompt)
            elif self.provider == "ollama":
                return await self._classify_ollama(user_prompt)
            else:
                logger.warning("Unknown AI provider: %s", self.provider)
                return 0.0, "unknown provider"
        except Exception:
            logger.exception("AI classification failed")
            return 0.0, "classification error"

    async def _classify_openai(self, user_prompt: str) -> tuple[float, str]:
        response = await self.openai_client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=200,
            response_format={"type": "json_object"},
        )
        import json
        result = json.loads(response.choices[0].message.content)
        return float(result.get("score", 0.0)), result.get("reason", "")

    async def _classify_ollama(self, user_prompt: str) -> tuple[float, str]:
        response = await self.http_client.post(
            f"{settings.ai_url}/api/chat",
            json={
                "model": settings.ai_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.1},
            },
        )
        response.raise_for_status()
        import json
        content = response.json()["message"]["content"]
        result = json.loads(content)
        return float(result.get("score", 0.0)), result.get("reason", "")

    async def close(self):
        await self.http_client.aclose()
