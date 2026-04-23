import asyncio
import logging
import os
import signal
import sys

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


def _crash_on_critical_failure(name: str):
    """If a critical long-running task dies or hangs, exit the process so
    Docker restarts the container. Silent task death leaves the container
    looking healthy while no mail gets scanned."""
    def callback(task: asyncio.Task):
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return
        if exc is not None:
            logger.critical("Critical task %s crashed: %s", name, exc,
                            exc_info=exc)
        else:
            logger.critical("Critical task %s exited unexpectedly", name)
        # Kill the process group so PID 1 dies and Docker restarts us
        os.kill(os.getpid(), signal.SIGTERM)
    return callback


async def main():
    logger.info("Starting SpamProxy Mail Service")

    # Start LMTP server for quarantine intake from Postfix
    lmtp_task = asyncio.create_task(start_lmtp_server(), name="lmtp")
    lmtp_task.add_done_callback(_crash_on_critical_failure("lmtp"))

    # Start Dovecot-compatible SASL auth server for Postfix
    sasl_task = asyncio.create_task(start_sasl_server(), name="sasl")
    sasl_task.add_done_callback(_crash_on_critical_failure("sasl"))

    # Start background tasks (cleanup, stats aggregation) - non-critical
    asyncio.create_task(start_background_tasks(), name="background")

    # Start automatic Bayes training from spam/ham corpora - non-critical
    asyncio.create_task(run_training_loop(), name="bayes-training")

    # Start Postfix log parser (tracks bounces, deferrals) - non-critical
    asyncio.create_task(run_log_parser(), name="log-parser")

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
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        logger.critical("Mail service exiting: %s", e, exc_info=True)
        sys.exit(1)
