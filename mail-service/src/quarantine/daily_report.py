"""Daily quarantine report: builds the HTML mail and sends it via SMTP.

A report is generated per recipient. It lists all currently quarantined
messages where the recipient is in `rcpt_to`. Each row carries two signed
links for one-click approve/reject (no login required).
"""
from __future__ import annotations

import html
import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from .models import MailLog, Quarantine, Setting, QuarantineRecipient
from .tokens import make_token, make_bulk_token

logger = logging.getLogger(__name__)


async def _get_setting(session: AsyncSession, key: str, default: str = "") -> str:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if not row:
        return default
    val = row.value
    if isinstance(val, str):
        return val.strip('"')
    return str(val)


async def fetch_pending_for(session: AsyncSession, email: str) -> Sequence[tuple]:
    """Return list of (quarantine, mail_log) tuples currently pending for the user."""
    result = await session.execute(
        select(Quarantine, MailLog)
        .join(MailLog, Quarantine.mail_log_id == MailLog.id)
        .where(Quarantine.status == "pending")
        .where(MailLog.rcpt_to.any(email))
        .order_by(MailLog.created_at.desc())
    )
    return list(result.all())


def _esc(s: str | None) -> str:
    return html.escape(s or "", quote=True)


async def _company_footer(session: AsyncSession) -> str:
    """Build the company info block shown at the bottom of every report.
    Without proper sender info (name + postal address) the mail looks
    like spam to many filters."""
    name = await _get_setting(session, "company_name")
    addr = await _get_setting(session, "company_address")
    email = await _get_setting(session, "company_email")
    phone = await _get_setting(session, "company_phone")
    website = await _get_setting(session, "company_website")
    imprint = await _get_setting(session, "company_imprint_url")
    privacy = await _get_setting(session, "company_privacy_url")

    if not (name or addr or email):
        # Fallback: at least show the proxy hostname so the mail isn't anonymous
        proxy = await _get_setting(session, "public_base_url", "")
        return (
            '<div style="font-size:11px;color:#9ca3af;">'
            f'Diese automatische Nachricht stammt von Ihrem SpamProxy-System '
            f'({_esc(proxy)}). Bitte kontaktieren Sie Ihren Administrator.'
            '</div>'
        )

    contact_bits = []
    if email:
        contact_bits.append(f'<a href="mailto:{_esc(email)}" style="color:#3b82f6;text-decoration:none;">{_esc(email)}</a>')
    if phone:
        contact_bits.append(_esc(phone))
    if website:
        url = website if website.startswith("http") else f"https://{website}"
        contact_bits.append(f'<a href="{_esc(url)}" style="color:#3b82f6;text-decoration:none;">{_esc(website)}</a>')
    contact_line = " &middot; ".join(contact_bits)

    legal_bits = []
    if imprint:
        legal_bits.append(f'<a href="{_esc(imprint)}" style="color:#6b7280;">Impressum</a>')
    if privacy:
        legal_bits.append(f'<a href="{_esc(privacy)}" style="color:#6b7280;">Datenschutz</a>')
    legal_line = " &middot; ".join(legal_bits)

    return f"""
      <div style="border-top:1px solid #e5e7eb;margin-top:8px;padding-top:12px;font-size:11px;color:#6b7280;line-height:1.6;">
        <div style="font-weight:600;color:#374151;">{_esc(name)}</div>
        {f'<div>{_esc(addr)}</div>' if addr else ''}
        {f'<div>{contact_line}</div>' if contact_line else ''}
        {f'<div style="margin-top:6px;">{legal_line}</div>' if legal_line else ''}
      </div>
    """


async def build_report_html(session: AsyncSession, recipient_email: str,
                             entries: Sequence[tuple], base_url: str) -> str:
    """Render the daily report as HTML."""
    import time as _time

    # Bulk tokens: cutoff = newest mail in this report. Covers everything
    # in the email; mails arriving later are excluded from the bulk action.
    cutoff_dt = max(
        (log.created_at for _, log in entries if log.created_at),
        default=None,
    )
    cutoff_ts = int(cutoff_dt.timestamp()) if cutoff_dt else int(_time.time())
    bulk_approve_tok = await make_bulk_token(
        session, recipient_email, "approve_all", cutoff_ts
    )
    bulk_reject_tok = await make_bulk_token(
        session, recipient_email, "reject_all", cutoff_ts
    )
    bulk_approve_url = f"{base_url.rstrip('/')}/q/{bulk_approve_tok}/go"
    bulk_reject_url = f"{base_url.rstrip('/')}/q/{bulk_reject_tok}/go"

    bulk_bar = f"""
    <tr><td style="padding:14px 24px;background:#eff6ff;border-bottom:1px solid #dbeafe;text-align:right;">
      <span style="font-size:12px;color:#1e40af;margin-right:12px;">
        {len(entries)} Nachricht(en):
      </span>
      <a href="{bulk_approve_url}" style="display:inline-block;padding:8px 14px;margin-right:8px;
         background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
         Alle zustellen
      </a>
      <a href="{bulk_reject_url}" style="display:inline-block;padding:8px 14px;
         background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
         Alle als Spam
      </a>
    </td></tr>
    """

    rows = []
    for q, log in entries:
        approve_tok = await make_token(session, q.id, "approve")
        reject_tok = await make_token(session, q.id, "reject")
        approve_url = f"{base_url.rstrip('/')}/q/{approve_tok}/go"
        reject_url = f"{base_url.rstrip('/')}/q/{reject_tok}/go"
        rows.append(f"""
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:12px 8px;font-size:12px;color:#6b7280;white-space:nowrap;">
            {log.created_at.strftime('%d.%m.%Y %H:%M') if log.created_at else ''}
          </td>
          <td style="padding:12px 8px;font-size:13px;color:#111827;">
            <div style="font-weight:600;">{_esc(log.subject)[:120]}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:2px;">
              {_esc(log.mail_from)} &middot; Score: {log.final_score:.1f}
            </div>
          </td>
          <td style="padding:12px 8px;text-align:right;white-space:nowrap;">
            <a href="{approve_url}" style="display:inline-block;padding:6px 12px;margin-right:6px;
               background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
               Zustellen
            </a>
            <a href="{reject_url}" style="display:inline-block;padding:6px 12px;
               background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
               Spam
            </a>
          </td>
        </tr>
        """)

    body = f"""
    <!doctype html>
    <html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <table cellpadding="0" cellspacing="0" style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:20px 24px;background:#1e3a8a;color:#fff;">
          <h1 style="margin:0;font-size:18px;">Ihre Spam-Quarantäne</h1>
          <p style="margin:4px 0 0;font-size:13px;color:#bfdbfe;">
            {len(entries)} neue Nachrichten warten auf Ihre Entscheidung
          </p>
        </td></tr>
        {bulk_bar}
        <tr><td style="padding:8px 16px;">
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            {''.join(rows)}
          </table>
        </td></tr>
        {bulk_bar if len(entries) >= 5 else ''}
        <tr><td style="padding:16px 24px;background:#f9fafb;font-size:11px;color:#6b7280;">
          Empfänger: {_esc(recipient_email)} &middot; Links gültig für 7 Tage &middot;
          Nicht aufgeführte Mails werden nach 30 Tagen automatisch verworfen.
        </td></tr>
        <tr><td style="padding:14px 24px 20px;background:#f9fafb;">
          {await _company_footer(session)}
        </td></tr>
      </table>
    </body></html>
    """
    return body


async def send_report(session: AsyncSession, recipient: QuarantineRecipient) -> int:
    """Send the daily report to one recipient. Returns number of mails included."""
    entries = await fetch_pending_for(session, recipient.email.lower())
    if not entries:
        return 0

    base_url = await _get_setting(session, "public_base_url",
                                   "https://spamproxy.example.com")
    from_addr = await _get_setting(session, "daily_report_from",
                                    "spamproxy@example.com")
    subject_tpl = await _get_setting(session, "daily_report_subject",
                                      "Ihre Spam-Quarantäne: {count} neue Nachrichten")

    html_body = await build_report_html(session, recipient.email, entries, base_url)

    company_name = await _get_setting(session, "company_name")
    company_email = await _get_setting(session, "company_email")
    company_phone = await _get_setting(session, "company_phone")
    company_addr = await _get_setting(session, "company_address")

    # Build a proper From: with display name so it's not anonymous
    if company_name and "<" not in from_addr:
        from_header = f'"{company_name} Spamfilter" <{from_addr}>'
    else:
        from_header = from_addr

    msg = EmailMessage()
    msg["From"] = from_header
    msg["To"] = recipient.email
    msg["Subject"] = subject_tpl.format(count=len(entries))
    if company_email:
        msg["Reply-To"] = company_email
    # Help receivers see this as transactional, not marketing
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"

    # Text body with footer so plain-text clients also see who sent it
    text_lines = [
        f"Sie haben {len(entries)} Nachricht(en) in der Spam-Quarantäne.",
        "Bitte öffnen Sie die HTML-Version dieser E-Mail, um sie zu verwalten.",
        "",
    ]
    if company_name:
        text_lines.append("--")
        text_lines.append(company_name)
        if company_addr:
            text_lines.append(company_addr)
        if company_email:
            text_lines.append(company_email)
        if company_phone:
            text_lines.append(company_phone)
    msg.set_content("\n".join(text_lines))
    msg.add_alternative(html_body, subtype="html")

    # Send via Postfix re-inject port (bypasses rspamd milter so reports
    # never get caught in our own filter loop)
    try:
        with smtplib.SMTP("postfix", 10025, timeout=30) as smtp:
            smtp.send_message(msg)
        recipient.last_report_sent_at = datetime.now(timezone.utc)
        await session.commit()
        logger.info("Daily report sent to %s (%d mails)", recipient.email, len(entries))
        return len(entries)
    except Exception:
        logger.exception("Failed to send daily report to %s", recipient.email)
        return 0
