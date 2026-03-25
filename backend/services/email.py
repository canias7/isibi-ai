from __future__ import annotations
import os
import resend

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi <noreply@isibi.ai>")


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
