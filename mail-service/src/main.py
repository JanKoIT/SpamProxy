import asyncio
import logging

import uvicorn

from .config import settings
from .api import app
from .lmtp_server import start_lmtp_server
from .sasl_server import start_sasl_server
from .tasks import start_background_tasks
from .bayes_trainer import run_training_loop
from .log_parser import run_log_parser

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("spamproxy")


async def main():
    logger.info("Starting SpamProxy Mail Service")

    # Start LMTP server for quarantine intake from Postfix
    lmtp_task = asyncio.create_task(start_lmtp_server())

    # Start Dovecot-compatible SASL auth server for Postfix
    sasl_task = asyncio.create_task(start_sasl_server())

    # Start background tasks (cleanup, stats aggregation)
    bg_task = asyncio.create_task(start_background_tasks())

    # Start automatic Bayes training from spam/ham corpora
    trainer_task = asyncio.create_task(run_training_loop())

    # Start Postfix log parser (tracks bounces, deferrals)
    parser_task = asyncio.create_task(run_log_parser())

    # Start FastAPI (internal API + AI endpoint)
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=settings.internal_api_port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
