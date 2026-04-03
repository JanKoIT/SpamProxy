"""
Automatic Bayes trainer - downloads spam/ham corpora and trains rspamd.

Spam sources:
  - https://untroubled.org/spam/ (monthly archives)

Ham sources:
  - Apache SpamAssassin public corpus (easy_ham)

Runs periodically as background task.
"""

import asyncio
import io
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .config import settings

logger = logging.getLogger(__name__)

SPAM_BASE_URL = "https://untroubled.org/spam"
DATA_DIR = "/var/lib/spamproxy/bayes-training"
STATE_FILE = f"{DATA_DIR}/last_trained.txt"


def _get_last_trained() -> str:
    """Get the last trained month (e.g. '2026-03')."""
    try:
        return Path(STATE_FILE).read_text().strip()
    except FileNotFoundError:
        return ""


def _set_last_trained(month: str):
    os.makedirs(DATA_DIR, exist_ok=True)
    Path(STATE_FILE).write_text(month)


async def _download_and_extract(url: str, dest_dir: str) -> int:
    """Download a .7z archive and extract to dest_dir. Returns number of files."""
    logger.info("Downloading %s ...", url)
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning("Download failed: %s -> %d", url, resp.status_code)
            return 0

    os.makedirs(dest_dir, exist_ok=True)
    archive_path = f"{dest_dir}/archive.7z"

    with open(archive_path, "wb") as f:
        f.write(resp.content)

    # Extract with 7z (p7zip)
    try:
        result = subprocess.run(
            ["7z", "x", "-y", f"-o{dest_dir}", archive_path],
            capture_output=True, timeout=300,
        )
        if result.returncode != 0:
            logger.warning("7z extract failed: %s", result.stderr[:200])
            return 0
    except FileNotFoundError:
        logger.warning("p7zip not installed, trying alternative extraction")
        return 0
    finally:
        os.remove(archive_path)

    # Count extracted files
    count = sum(1 for f in Path(dest_dir).rglob("*") if f.is_file())
    logger.info("Extracted %d files from %s", count, url)
    return count


async def _learn_directory(directory: str, learn_type: str, max_messages: int = 500) -> int:
    """Send messages from directory to rspamd for learning (via controller)."""
    rspamd_url = settings.rspamd_controller_url
    endpoint = "learnspam" if learn_type == "spam" else "learnham"
    learned = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {}
        if settings.rspamd_password:
            headers["Password"] = settings.rspamd_password

        for path in sorted(Path(directory).rglob("*"))[:max_messages]:
            if not path.is_file() or path.suffix == ".7z":
                continue
            try:
                raw = path.read_bytes()
                if len(raw) < 50 or len(raw) > 1_000_000:
                    continue

                resp = await client.post(
                    f"{rspamd_url}/{endpoint}",
                    content=raw,
                    headers=headers,
                )
                if resp.status_code == 200:
                    learned += 1
                else:
                    # rspamd returns 208 for "already learned"
                    pass
            except Exception:
                pass

            # Don't overwhelm rspamd
            if learned % 50 == 0 and learned > 0:
                await asyncio.sleep(1)

    return learned


async def train_spam_monthly():
    """Download and train from the latest untroubled.org spam archive."""
    now = datetime.now(timezone.utc)
    # Train previous month (current month may be incomplete)
    if now.month == 1:
        target_year = now.year - 1
        target_month = 12
    else:
        target_year = now.year
        target_month = now.month - 1

    month_str = f"{target_year}-{target_month:02d}"
    last = _get_last_trained()

    if last >= month_str:
        logger.info("Bayes already trained for %s, skipping", month_str)
        return 0

    url = f"{SPAM_BASE_URL}/{month_str}.7z"
    dest = f"{DATA_DIR}/spam-{month_str}"

    try:
        count = await _download_and_extract(url, dest)
        if count == 0:
            logger.warning("No spam files extracted for %s", month_str)
            return 0

        learned = await _learn_directory(dest, "spam", max_messages=1000)
        logger.info("Bayes trained %d spam messages from %s", learned, month_str)

        _set_last_trained(month_str)
        return learned
    except Exception:
        logger.exception("Spam training failed for %s", month_str)
        return 0
    finally:
        # Cleanup extracted files
        subprocess.run(["rm", "-rf", dest], capture_output=True)


async def train_ham_corpus():
    """Download and train from SpamAssassin easy_ham corpus (one-time)."""
    ham_marker = f"{DATA_DIR}/ham_trained"
    if os.path.exists(ham_marker):
        return 0

    url = "https://spamassassin.apache.org/old/publiccorpus/20030228_easy_ham.tar.bz2"
    dest = f"{DATA_DIR}/ham"

    try:
        logger.info("Downloading ham corpus...")
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning("Ham download failed: %d", resp.status_code)
                return 0

        os.makedirs(dest, exist_ok=True)
        archive = f"{dest}/ham.tar.bz2"
        with open(archive, "wb") as f:
            f.write(resp.content)

        subprocess.run(
            ["tar", "xjf", archive, "-C", dest],
            capture_output=True, timeout=120,
        )
        os.remove(archive)

        learned = await _learn_directory(dest, "ham", max_messages=500)
        logger.info("Bayes trained %d ham messages", learned)

        Path(ham_marker).write_text(str(datetime.now(timezone.utc)))
        return learned
    except Exception:
        logger.exception("Ham training failed")
        return 0
    finally:
        subprocess.run(["rm", "-rf", dest], capture_output=True)


async def run_training_loop():
    """Background task: train Bayes periodically."""
    # Wait for services to be ready
    await asyncio.sleep(60)

    while True:
        try:
            # Train ham corpus (one-time)
            await train_ham_corpus()

            # Train spam from latest month
            await train_spam_monthly()

        except Exception:
            logger.exception("Bayes training loop error")

        # Run daily
        await asyncio.sleep(86400)
