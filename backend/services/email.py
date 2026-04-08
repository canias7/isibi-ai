from __future__ import annotations
import os
import resend

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi.ai <onboarding@resend.dev>")


def _init():
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY


async def send_verification_email(to: str, code: str) -> bool:
    """Send a 6-digit verification code to the user's email."""
    _init()

    if not RESEND_API_KEY:
        # Dev fallback: print to console
        print(f"[DEV] Verification code for {to}: {code}")
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
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [to],
            "subject": f"Your isibi.ai verification code: {code}",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False


async def send_login_alert_email(to: str, ip_address: str, device_name: str, timestamp: str) -> bool:
    """Send a new login alert email when login from a new IP is detected."""
    _init()

    if not RESEND_API_KEY:
        print(f"[DEV] Login alert for {to}: new IP {ip_address} from {device_name}")
        return True

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:40px 20px">
      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">New login detected</h2>
      <p style="font-size:14px;color:#666;margin:0 0 24px">A new login to your GoFarther AI account was detected:</p>
      <div style="background:#f5f5f5;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="font-size:14px;color:#333;margin:0 0 8px"><strong>IP Address:</strong> {ip_address}</p>
        <p style="font-size:14px;color:#333;margin:0 0 8px"><strong>Device:</strong> {device_name}</p>
        <p style="font-size:14px;color:#333;margin:0"><strong>Time:</strong> {timestamp}</p>
      </div>
      <p style="font-size:13px;color:#e11d48;font-weight:500;margin:0 0 8px">If this wasn't you, change your password immediately.</p>
      <p style="font-size:12px;color:#999;margin:0">You're receiving this because a login from a new location was detected on your account.</p>
    </div>
    """

    try:
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [to],
            "subject": "New login to your GoFarther AI account",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False


async def send_password_reset_email(to: str, code: str) -> bool:
    """Send a password reset code."""
    _init()

    if not RESEND_API_KEY:
        print(f"[DEV] Password reset code for {to}: {code}")
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
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [to],
            "subject": f"Your isibi.ai password reset code: {code}",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False
