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
    try:
        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            resp = await client.get(url)
            logger.info("Download response: %d, size: %d bytes", resp.status_code, len(resp.content))
            if resp.status_code != 200:
                logger.warning("Download failed: %s -> %d", url, resp.status_code)
                return 0
            if len(resp.content) < 1000:
                logger.warning("Download too small (%d bytes), likely error page", len(resp.content))
                return 0
    except Exception as e:
        logger.exception("Download error for %s: %s", url, e)
        return 0

    os.makedirs(dest_dir, exist_ok=True)
    archive_path = f"{dest_dir}/archive.7z"

    with open(archive_path, "wb") as f:
        f.write(resp.content)
    logger.info("Saved archive: %s (%d bytes)", archive_path, len(resp.content))

    # Extract with 7z (p7zip)
    try:
        result = subprocess.run(
            ["7z", "x", "-y", f"-o{dest_dir}", archive_path],
            capture_output=True, timeout=600,
        )
        if result.returncode != 0:
            logger.warning("7z extract failed (rc=%d): %s", result.returncode, result.stderr.decode()[:500])
            return 0
        logger.info("7z extract stdout: %s", result.stdout.decode()[-200:])
    except FileNotFoundError:
        logger.error("p7zip (7z) not installed! Install with: apt install p7zip-full")
        return 0
    except subprocess.TimeoutExpired:
        logger.error("7z extract timed out")
        return 0
    finally:
        if os.path.exists(archive_path):
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


def _get_trained_months() -> set[str]:
    """Get all months that have been trained."""
    trained_file = f"{DATA_DIR}/trained_months.txt"
    try:
        return set(Path(trained_file).read_text().strip().split("\n"))
    except FileNotFoundError:
        return set()


def _mark_month_trained(month: str):
    trained_file = f"{DATA_DIR}/trained_months.txt"
    os.makedirs(DATA_DIR, exist_ok=True)
    months = _get_trained_months()
    months.add(month)
    Path(trained_file).write_text("\n".join(sorted(months)))


def _generate_months(start_year: int, start_month: int) -> list[str]:
    """Generate list of YYYY-MM strings from start to last complete month."""
    now = datetime.now(timezone.utc)
    # Up to previous month (current month may be incomplete)
    if now.month == 1:
        end_year, end_month = now.year - 1, 12
    else:
        end_year, end_month = now.year, now.month - 1

    months = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        months.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


# How far back to train (monthly archives start from 2023-01 on untroubled.org)
TRAIN_START_YEAR = 2024
TRAIN_START_MONTH = 1
# Max messages to learn per month
MAX_PER_MONTH = 500
# Max months to train per run (to avoid long-running tasks)
MAX_MONTHS_PER_RUN = 3


async def train_spam_monthly() -> int:
    """Download and train from untroubled.org spam archives.
    Trains all missing months from TRAIN_START back to present,
    processing up to MAX_MONTHS_PER_RUN per invocation."""
    trained = _get_trained_months()
    all_months = _generate_months(TRAIN_START_YEAR, TRAIN_START_MONTH)
    missing = [m for m in all_months if m not in trained]

    if not missing:
        logger.info("Bayes spam: all %d months trained (%s to %s)",
                     len(all_months), all_months[0], all_months[-1])
        return 0

    logger.info("Bayes spam: %d months to train, processing up to %d this run",
                len(missing), MAX_MONTHS_PER_RUN)

    total_learned = 0
    for month_str in missing[:MAX_MONTHS_PER_RUN]:
        url = f"{SPAM_BASE_URL}/{month_str}.7z"
        dest = f"{DATA_DIR}/spam-{month_str}"

        try:
            count = await _download_and_extract(url, dest)
            if count == 0:
                logger.warning("No spam files for %s, skipping", month_str)
                # Mark as trained anyway to avoid retrying missing months
                _mark_month_trained(month_str)
                continue

            learned = await _learn_directory(dest, "spam", max_messages=MAX_PER_MONTH)
            logger.info("Bayes trained %d spam messages from %s", learned, month_str)

            _mark_month_trained(month_str)
            total_learned += learned

            # Also update legacy state file for status display
            _set_last_trained(month_str)

        except Exception:
            logger.exception("Spam training failed for %s", month_str)
        finally:
            subprocess.run(["rm", "-rf", dest], capture_output=True)

    return total_learned


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
