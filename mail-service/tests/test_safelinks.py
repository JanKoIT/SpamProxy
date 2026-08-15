"""Standalone tests for the Safe Links rewriter and tokens.

Run:  python -m tests.test_safelinks     (from the mail-service directory)
No pytest / DB / network required - the rewriter is pure and synchronous.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.safelinks.tokens import make_link_token, verify_link_token  # noqa: E402
from src.safelinks.rewriter import (  # noqa: E402
    build_config, rewrite_html, rewrite_plaintext, rewrite_message, MARKER_HEADER,
)

SECRET = "test-secret-000"
BASE = "https://proxy.example.com"


def cfg(**kw):
    trusted = kw.pop("trusted", ["trusted.example"])
    return build_config(SECRET, BASE, trusted, **kw)


def test_token_roundtrip():
    url = "https://evil.example/pay?x=1&y=2"
    tok = make_link_token(url, SECRET)
    assert verify_link_token(tok, SECRET) == url


def test_token_rejects_forgery():
    tok = make_link_token("https://a.example", SECRET)
    try:
        verify_link_token(tok, "wrong-secret")
        assert False, "forged token accepted"
    except ValueError:
        pass


def test_token_rejects_expired():
    tok = make_link_token("https://a.example", SECRET, ttl_seconds=-1)
    try:
        verify_link_token(tok, SECRET)
        assert False, "expired token accepted"
    except ValueError:
        pass


def test_html_rewrites_external_href():
    c = cfg()
    out = rewrite_html('<a href="https://evil.example/x">click</a>', c)
    assert BASE + "/l/" in out
    # original URL is recoverable from the produced token
    tok = out.split("/l/")[1].split('"')[0]
    assert verify_link_token(tok, SECRET) == "https://evil.example/x"


def test_html_skips_trusted_and_schemes():
    c = cfg()
    for href in [
        '<a href="https://trusted.example/ok">t</a>',
        '<a href="https://sub.trusted.example/ok">t</a>',
        '<a href="mailto:a@b.example">m</a>',
        '<a href="#anchor">a</a>',
        '<a href="tel:+123">p</a>',
    ]:
        assert rewrite_html(href, c) == href, href
    # our own links are never double-wrapped
    own = f'<a href="{BASE}/l/abc.def">x</a>'
    assert rewrite_html(own, c) == own


def test_plaintext_rewrite_and_trailing_punct():
    c = cfg()
    out = rewrite_plaintext("Visit https://evil.example/path. Thanks", c)
    assert BASE + "/l/" in out
    assert out.rstrip().endswith(". Thanks".strip()) or ". Thanks" in out
    # trailing period preserved, not part of the token
    assert ". Thanks" in out


def test_message_rewrite_and_idempotent():
    raw = (
        b"From: a@b.example\r\n"
        b"To: c@d.example\r\n"
        b"Subject: hi\r\n"
        b"MIME-Version: 1.0\r\n"
        b"Content-Type: text/html; charset=utf-8\r\n"
        b"\r\n"
        b'<html><body><a href="https://evil.example/x">go</a></body></html>\r\n'
    )
    c = cfg()
    out1 = rewrite_message(raw, c)
    assert b"/l/" in out1
    assert MARKER_HEADER.encode() in out1
    # second pass is a no-op (marker present) -> byte-identical
    out2 = rewrite_message(out1, c)
    assert out2 == out1


def test_message_no_links_untouched():
    raw = (
        b"Subject: hi\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
        b"just plain text, no urls here\r\n"
    )
    c = cfg()
    assert rewrite_message(raw, c) == raw


def test_disabled_when_no_secret_or_base():
    raw = b"Content-Type: text/html\r\n\r\n<a href='https://x.example'>x</a>"
    assert rewrite_message(raw, build_config("", BASE, [])) == raw
    assert rewrite_message(raw, build_config(SECRET, "", [])) == raw


def test_ssrf_guard_blocks_private_ips():
    from src.safelinks.scanner import _host_is_public
    # IP literals need no DNS - deterministic offline.
    assert _host_is_public("8.8.8.8") is True
    for bad in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1",
                "172.16.0.1", "0.0.0.0", "::1", ""]:
        assert _host_is_public(bad) is False, bad


def test_virustotal_stats_verdict():
    from src.safelinks.scanner import _vt_stats_verdict
    assert _vt_stats_verdict({"malicious": 5, "suspicious": 1}, 2)[0] == "malicious"
    assert _vt_stats_verdict({"malicious": 2, "suspicious": 0}, 2)[0] == "malicious"
    assert _vt_stats_verdict({"malicious": 1, "suspicious": 0}, 2)[0] == "suspicious"
    assert _vt_stats_verdict({"malicious": 0, "suspicious": 3}, 2)[0] == "suspicious"
    assert _vt_stats_verdict({"malicious": 0, "suspicious": 0}, 2)[0] == "clean"
    assert _vt_stats_verdict({"harmless": 70}, 2)[0] == "clean"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok   {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
