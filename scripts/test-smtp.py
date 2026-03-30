#!/usr/bin/env python3
"""Send test emails through the SpamProxy for testing."""

import smtplib
import argparse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def send_ham(host: str, port: int, to: str):
    """Send a legitimate test email."""
    msg = MIMEText(
        "Hi,\n\nThis is a legitimate test email from the SpamProxy test suite.\n\n"
        "Best regards,\nTest User"
    )
    msg["Subject"] = "Test Email - Legitimate"
    msg["From"] = "test@example.com"
    msg["To"] = to

    with smtplib.SMTP(host, port) as smtp:
        smtp.sendmail(msg["From"], [to], msg.as_string())
    print(f"[HAM] Sent to {to}")


def send_spam(host: str, port: int, to: str):
    """Send a typical spam test email."""
    msg = MIMEMultipart()
    msg["Subject"] = "URGENT: You have WON $1,000,000!!! Act NOW!!!"
    msg["From"] = "winner-notification@totally-legit-prizes.xyz"
    msg["To"] = to

    body = """
    CONGRATULATIONS!!! You have been SELECTED as the WINNER of our $1,000,000 PRIZE!!!

    To CLAIM your prize, click the link below IMMEDIATELY:
    http://totally-not-a-scam.example.com/claim?id=12345

    You MUST act within 24 HOURS or you will LOSE your prize FOREVER!!!

    Send us your:
    - Full Name
    - Bank Account Number
    - Social Security Number
    - Mother's Maiden Name

    This is NOT a scam! We are a LEGITIMATE company!!!

    Unsubscribe: http://spam.example.com/unsub
    """
    msg.attach(MIMEText(body))

    with smtplib.SMTP(host, port) as smtp:
        smtp.sendmail(msg["From"], [to], msg.as_string())
    print(f"[SPAM] Sent to {to}")


def send_phishing(host: str, port: int, to: str):
    """Send a phishing test email."""
    msg = MIMEText(
        "Dear Customer,\n\n"
        "We have detected unusual activity on your account. "
        "Please verify your identity immediately by clicking the link below:\n\n"
        "http://secure-bank-login.example.com/verify\n\n"
        "If you do not verify within 24 hours, your account will be suspended.\n\n"
        "Thank you,\nSecurity Team"
    )
    msg["Subject"] = "Important: Account Security Alert"
    msg["From"] = "security@your-bank-secure.example.com"
    msg["To"] = to

    with smtplib.SMTP(host, port) as smtp:
        smtp.sendmail(msg["From"], [to], msg.as_string())
    print(f"[PHISHING] Sent to {to}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send test emails through SpamProxy")
    parser.add_argument("--host", default="localhost", help="SMTP host")
    parser.add_argument("--port", type=int, default=25, help="SMTP port")
    parser.add_argument("--to", default="user@example.com", help="Recipient address")
    parser.add_argument("--type", choices=["ham", "spam", "phishing", "all"], default="all")
    args = parser.parse_args()

    if args.type in ("ham", "all"):
        send_ham(args.host, args.port, args.to)
    if args.type in ("spam", "all"):
        send_spam(args.host, args.port, args.to)
    if args.type in ("phishing", "all"):
        send_phishing(args.host, args.port, args.to)
