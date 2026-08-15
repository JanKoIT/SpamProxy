"""Real click-time link scanning for Safe Links.

Two independent, optional layers on top of the DNS/blocklist reputation check:

  1. Google Safe Browsing v4 Lookup API - checks a URL against Google's
     threat lists (malware, social engineering / phishing, unwanted software).
     Requires an API key. This is the "real scan".

  2. Redirect resolution - follows HTTP redirects (shorteners, cloaking) to
     the final URL so the destination can be scanned too. Guarded against
     SSRF: any hop that resolves to a non-public IP aborts the chain.

Everything here fails OPEN: on network error / bad key / timeout the caller
still gets a non-malicious result and other checks (blocklist, SURBL) apply.
The interstitial always shows the real destination regardless.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

_SB_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
_SB_THREAT_TYPES = [
    "MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE",
    "POTENTIALLY_HARMFUL_APPLICATION",
]
_THREAT_LABELS = {
    "MALWARE": "Malware",
    "SOCIAL_ENGINEERING": "Phishing / Social Engineering",
    "UNWANTED_SOFTWARE": "Unerwünschte Software",
    "POTENTIALLY_HARMFUL_APPLICATION": "Potenziell schädliche App",
}

# Small in-process TTL cache so repeated clicks on the same link don't hammer
# the API. Keyed by URL -> (expiry_ts, listed_bool, reason).
_CACHE_TTL = 600
_CACHE_MAX = 5000
_sb_cache: dict[str, tuple[float, bool, str]] = {}


def _host_is_public(host: str) -> bool:
    """True only if every A/AAAA record for host is a global (public) IP.
    Blocks SSRF to loopback / private / link-local / reserved ranges."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    if not infos:
        return False
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast
                or addr.is_unspecified or not addr.is_global):
            return False
    return True


async def google_safe_browsing_lookup(url: str, api_key: str,
                                      timeout: float = 4.0) -> tuple[bool, str]:
    """Return (listed, human_reason). listed=True means Google flagged it."""
    if not url or not api_key:
        return False, ""

    now = time.time()
    hit = _sb_cache.get(url)
    if hit and hit[0] > now:
        return hit[1], hit[2]

    try:
        import httpx
    except Exception:
        return False, ""

    body = {
        "client": {"clientId": "spamproxy", "clientVersion": "1.0"},
        "threatInfo": {
            "threatTypes": _SB_THREAT_TYPES,
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": url}],
        },
    }
    listed, reason = False, ""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                _SB_ENDPOINT, params={"key": api_key}, json=body
            )
            r.raise_for_status()
            data = r.json()
            matches = data.get("matches") or []
            if matches:
                types = sorted({m.get("threatType", "") for m in matches})
                labels = ", ".join(_THREAT_LABELS.get(t, t) for t in types if t)
                listed, reason = True, labels or "Von Google Safe Browsing gemeldet"
    except Exception as e:
        logger.warning("Safe Browsing lookup failed for %s: %s", url[:120], e)
        return False, ""  # fail open, don't cache errors

    if len(_sb_cache) > _CACHE_MAX:
        _sb_cache.clear()
    _sb_cache[url] = (now + _CACHE_TTL, listed, reason)
    return listed, reason


async def resolve_final_url(url: str, max_redirects: int = 5,
                            timeout: float = 4.0) -> tuple[str, str]:
    """Follow redirects to the final URL. Returns (final_url, status) where
    status is one of ok | blocked-nonpublic | unreachable | too-many-redirects.
    Aborts (blocked-nonpublic) if any hop points at a non-public IP (SSRF)."""
    try:
        import httpx
    except Exception:
        return url, "unreachable"

    current = url
    headers = {"User-Agent": "SpamProxy-SafeLinks/1.0"}
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            for _ in range(max_redirects):
                host = urlsplit(current).hostname or ""
                if not await asyncio.to_thread(_host_is_public, host):
                    return current, "blocked-nonpublic"
                try:
                    async with client.stream("GET", current, headers=headers) as r:
                        if r.status_code in (301, 302, 303, 307, 308):
                            loc = r.headers.get("location")
                            if not loc:
                                return current, "ok"
                            current = str(httpx.URL(current).join(loc))
                            continue
                        return current, "ok"
                except Exception:
                    return current, "unreachable"
        return current, "too-many-redirects"
    except Exception:
        return current, "unreachable"
