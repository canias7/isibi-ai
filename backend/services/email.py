from __future__ import annotations
import asyncio
import html as _html
import logging
import os
import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi.ai <onboarding@resend.dev>")


def _init():
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY


def _send_email_sync(params: dict) -> None:
    """Synchronous email send — meant to be called via asyncio.to_thread()."""
    resend.Emails.send(params)


async def send_verification_email(to: str, code: str) -> bool:
    """Send a 6-digit verification code to the user's email."""
    _init()

    if not RESEND_API_KEY:
        # Dev fallback — log at debug level only (never print codes to stdout)
        logger.debug("Email service not configured — verification email skipped for %s", to)
        return True

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">Verify your email</h2>
      <p style="font-size:14px;color:#666;margin:0 0 32px">Enter this code to finish signing up for isibi.ai:</p>
      <div style="background:#f5f5f5;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#000">{code}</span>
      </div>
      <p style="font-size:12px;color:#999;margin:0">This code expires in 10 minutes. If you didn't sign up, ignore this email.</p>
    </div>
    """

    try:
        await asyncio.to_thread(_send_email_sync, {
            "from": FROM_EMAIL,
            "to": [to],
            "subject": f"Your isibi.ai verification code: {code}",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error("Failed to send verification email to %s: %s", to, e)
        return False


async def send_login_alert_email(to: str, ip_address: str, device_name: str, timestamp: str) -> bool:
    """Send a new login alert email when login from a new IP is detected."""
    _init()

    if not RESEND_API_KEY:
        logger.debug("Email service not configured — login alert skipped for %s", to)
        return True

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">New login detected</h2>
      <p style="font-size:14px;color:#666;margin:0 0 24px">A new login to your GoFarther AI account was detected:</p>
      <div style="background:#f5f5f5;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="font-size:14px;color:#333;margin:0 0 8px"><strong>IP Address:</strong> {_html.escape(ip_address)}</p>
        <p style="font-size:14px;color:#333;margin:0 0 8px"><strong>Device:</strong> {_html.escape(device_name)}</p>
        <p style="font-size:14px;color:#333;margin:0"><strong>Time:</strong> {_html.escape(timestamp)}</p>
      </div>
      <p style="font-size:13px;color:#e11d48;font-weight:500;margin:0 0 8px">If this wasn't you, change your password immediately.</p>
      <p style="font-size:12px;color:#999;margin:0">You're receiving this because a login from a new location was detected on your account.</p>
    </div>
    """

    try:
        await asyncio.to_thread(_send_email_sync, {
            "from": FROM_EMAIL,
            "to": [to],
            "subject": "New login to your GoFarther AI account",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error("Failed to send login alert email to %s: %s", to, e)
        return False


def _send_smtp_sync(host: str, port: int, user: str, password: str, from_addr: str, to: str, subject: str, html: str, attachments: list | None = None) -> None:
    """Synchronous SMTP send — call via asyncio.to_thread().

    attachments: optional list of dicts with keys:
      - filename (str)
      - content (bytes)
      - content_type (str, optional — defaults to application/octet-stream)
    """
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.base import MIMEBase
    from email import encoders

    # When there are attachments we need a "mixed" outer container so that
    # the HTML body and the binary parts can live side-by-side.
    outer_subtype = "mixed" if attachments else "alternative"
    msg = MIMEMultipart(outer_subtype)
    msg["Subject"] = subject
    msg["From"] = from_addr or user
    msg["To"] = to

    if attachments:
        # Put the HTML inside an inner "alternative" part so clients still
        # treat it as the message body.
        body = MIMEMultipart("alternative")
        body.attach(MIMEText(html, "html"))
        msg.attach(body)
        for att in attachments:
            filename = att.get("filename") or "attachment.bin"
            content = att.get("content") or b""
            ctype = att.get("content_type") or "application/octet-stream"
            maintype, _, subtype = ctype.partition("/")
            part = MIMEBase(maintype or "application", subtype or "octet-stream")
            part.set_payload(content)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            msg.attach(part)
    else:
        msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(host, int(port), timeout=30) as server:
        server.ehlo()
        try:
            server.starttls()
            server.ehlo()
        except Exception:
            pass  # Host may not support STARTTLS
        if user and password:
            server.login(user, password)
        server.sendmail(from_addr or user, [to], msg.as_string())


async def send_via_smtp(smtp_settings: dict, to: str, subject: str, html: str, attachments: list | None = None) -> bool:
    """Send an email using the provided SMTP settings dict.
    smtp_settings must contain: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from (optional)
    attachments: optional list of {filename, content (bytes), content_type}.
    """
    try:
        host = smtp_settings.get("smtp_host")
        port = smtp_settings.get("smtp_port") or 587
        user = smtp_settings.get("smtp_user")
        password = smtp_settings.get("smtp_pass")
        from_addr = smtp_settings.get("smtp_from") or user
        if not host or not user or not password:
            logger.warning("SMTP settings incomplete for %s — skipping", to)
            return False
        await asyncio.to_thread(_send_smtp_sync, host, port, user, password, from_addr, to, subject, html, attachments)
        logger.info("SMTP email sent to %s via %s (subject=%s, attachments=%d)", to, host, subject, len(attachments or []))
        return True
    except Exception as e:
        logger.error("SMTP send failed to %s: %s", to, e)
        return False


async def send_generic_email(to: str, subject: str, html: str, attachments: list | None = None) -> bool:
    """Send an arbitrary email via Resend (used for scheduled reports, etc.).
    attachments: optional list of {filename, content (bytes), content_type}.
    """
    _init()

    if not RESEND_API_KEY:
        logger.warning("Email service not configured — generic email skipped for %s (subject=%s)", to, subject)
        return False

    try:
        import base64 as _b64
        payload: dict = {
            "from": FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if attachments:
            # Resend accepts attachments as [{filename, content: base64 str}]
            payload["attachments"] = [
                {
                    "filename": a.get("filename") or "attachment.bin",
                    "content": _b64.b64encode(a.get("content") or b"").decode("ascii"),
                }
                for a in attachments
            ]
        await asyncio.to_thread(_send_email_sync, payload)
        logger.info("Generic email sent to %s (subject=%s, attachments=%d)", to, subject, len(attachments or []))
        return True
    except Exception as e:
        logger.error("Failed to send generic email to %s: %s", to, e)
        return False


async def send_password_reset_email(to: str, code: str) -> bool:
    """Send a password reset code."""
    _init()

    if not RESEND_API_KEY:
        logger.debug("Email service not configured — reset email skipped for %s", to)
        return True

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">Reset your password</h2>
      <p style="font-size:14px;color:#666;margin:0 0 32px">Use this code to reset your isibi.ai password:</p>
      <div style="background:#f5f5f5;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#000">{code}</span>
      </div>
      <p style="font-size:12px;color:#999;margin:0">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>
    """

    try:
        await asyncio.to_thread(_send_email_sync, {
            "from": FROM_EMAIL,
            "to": [to],
            "subject": f"Your isibi.ai password reset code: {code}",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error("Failed to send password reset email to %s: %s", to, e)
        return False
