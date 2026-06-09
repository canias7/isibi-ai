import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// Supabase Auth "Send Email Hook": GoTrue POSTs every auth email (signup
// confirmation, password reset, magic link, email change, …) here instead of
// sending it itself. We verify the webhook signature, render a branded Go Farther
// email, and send it via the Resend API. Configured in the dashboard
// (Authentication → Hooks → Send Email) with verify_jwt OFF — the request is
// authenticated by the Standard Webhooks signature, not a user JWT.

const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "").replace("v1,whsec_", "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Sender must be on a Resend-VERIFIED domain to reach real users. For a quick
// self-test, Resend allows "onboarding@resend.dev" (to your own account email).
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Go Farther <onboarding@resend.dev>";
const SB_URL = Deno.env.get("SUPABASE_URL") || "https://lkpfeqrelvziltfwpuxi.supabase.co";

interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
}
interface HookPayload {
  user: { email: string; user_metadata?: Record<string, unknown> };
  email_data: EmailData;
}

// Per-action copy. Link types show a button; code-only types (reauthentication,
// generic email) show the 6-digit code.
const COPY: Record<string, { subject: string; title: string; intro: string; cta?: string }> = {
  signup: { subject: "Confirm your email", title: "Confirm your email", intro: "Tap below to confirm your address and finish setting up Go Farther.", cta: "Confirm email" },
  recovery: { subject: "Reset your password", title: "Reset your password", intro: "Tap below to choose a new password. Didn't ask for this? You can safely ignore this email.", cta: "Reset password" },
  magiclink: { subject: "Your sign-in link", title: "Sign in to Go Farther", intro: "Tap below to sign in. This link works once and expires shortly.", cta: "Sign in" },
  email_change: { subject: "Confirm your new email", title: "Confirm your new email", intro: "Tap below to confirm this new email address for your Go Farther account.", cta: "Confirm email" },
  invite: { subject: "You're invited to Go Farther", title: "You're invited", intro: "You've been invited to Go Farther. Tap below to accept and set up your account.", cta: "Accept invite" },
  reauthentication: { subject: "Confirm it's you", title: "Confirm it's you", intro: "Use the code below to confirm this action." },
  email: { subject: "Your verification code", title: "Your verification code", intro: "Use the code below to continue." },
};

function verifyLink(d: EmailData): string {
  const params = new URLSearchParams({
    token: d.token_hash,
    type: d.email_action_type,
    redirect_to: d.redirect_to || "",
  });
  return `${SB_URL}/auth/v1/verify?${params.toString()}`;
}

function renderEmail(d: EmailData): { subject: string; html: string } {
  const c = COPY[d.email_action_type] || COPY.email;
  const link = verifyLink(d);
  const button = c.cta
    ? `<a href="${link}" style="display:inline-block;background:#e7b24e;color:#111;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:12px;">${c.cta}</a>`
    : "";
  const code = `<div style="margin:18px 0 4px;font-size:13px;color:#8a8f98;">${c.cta ? "Or use this code:" : "Your code:"}</div>
    <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#111;">${d.token}</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;font-size:22px;font-weight:700;color:#111;margin-bottom:18px;">Go&nbsp;Farther</div>
    <div style="background:#ffffff;border-radius:18px;padding:32px 28px;box-shadow:0 1px 4px rgba(0,0,0,0.06);text-align:center;">
      <h1 style="margin:0 0 12px;font-size:21px;color:#111;">${c.title}</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#454a52;">${c.intro}</p>
      ${button}
      ${code}
    </div>
    <p style="text-align:center;font-size:12px;color:#9aa0a8;margin:20px 0 0;line-height:1.5;">
      If you didn't request this, you can ignore this email — no changes were made.
    </p>
  </div></body></html>`;
  return { subject: c.subject, html };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: { http_code: 405, message: "Method not allowed" } }, 405);
  if (!RESEND_API_KEY) return json({ error: { http_code: 500, message: "RESEND_API_KEY not set on the server" } }, 500);
  if (!HOOK_SECRET) return json({ error: { http_code: 500, message: "SEND_EMAIL_HOOK_SECRET not set on the server" } }, 500);

  // 1) Verify the Standard Webhooks signature (auth for this endpoint).
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  let data: HookPayload;
  try {
    const wh = new Webhook(HOOK_SECRET);
    data = wh.verify(payload, headers) as HookPayload;
  } catch {
    return json({ error: { http_code: 401, message: "Invalid webhook signature" } }, 401);
  }

  // 2) Render + 3) send via Resend.
  const { user, email_data } = data;
  const { subject, html } = renderEmail(email_data);
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: [user.email], subject, html }),
    });
  } catch {
    return json({ error: { http_code: 502, message: "Could not reach Resend" } }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("resend send failed", res.status, detail.slice(0, 400));
    // Surface to GoTrue so the failure shows in the auth logs (don't leak the body).
    return json({ error: { http_code: res.status, message: `Resend rejected the send (${res.status})` } }, 500);
  }
  // Success: GoTrue expects 200 with an (optionally empty) body.
  return json({}, 200);
});
