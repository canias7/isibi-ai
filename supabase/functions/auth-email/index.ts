import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// Supabase Auth "Send Email Hook": GoTrue POSTs every auth email (signup
// confirmation, password reset, magic link, email change, …) here instead of
// sending it itself. We verify the webhook signature, render a branded Go Farther
// email, and send it via the Resend API. Configured in the dashboard
// (Authentication → Hooks → Send Email) with verify_jwt OFF — the request is
// authenticated by the Standard Webhooks signature, not a user JWT.

// Read an env var forgivingly: ignore case and collapse any run of - or _, so
// dashboard secrets entered as RESEND-API-KEY or SEND_EMAIL__HOOK_SECRET still
// match RESEND_API_KEY / SEND_EMAIL_HOOK_SECRET.
function env(name: string): string | undefined {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, "_");
  const target = norm(name);
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (norm(k) === target && v) return v;
  }
  return undefined;
}

const HOOK_SECRET = (env("SEND_EMAIL_HOOK_SECRET") || "").replace("v1,whsec_", "");
const RESEND_API_KEY = env("RESEND_API_KEY");
// Sender must be on a Resend-VERIFIED domain to reach real users. For a quick
// self-test, Resend allows "onboarding@resend.dev" (to your own account email).
const RESEND_FROM = env("RESEND_FROM") || "Go Farther <onboarding@resend.dev>";

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

// Per-action copy. The app signs in with the CODE (passwordless, native), so
// every email makes the code the hero — no buttons: the verify links resolve
// against the project's Site URL, which doesn't apply to the native app.
const COPY: Record<string, { subject: string; title: string; intro: string }> = {
  signup: { subject: "Confirm your email", title: "Confirm your email", intro: "Enter this code in the app to finish setting up Go Farther." },
  recovery: { subject: "Your sign-in code", title: "Get back in", intro: "Enter this code in the app to sign back in." },
  magiclink: { subject: "Your sign-in code", title: "Sign in to Go Farther", intro: "Enter this code in the app. It works once and expires shortly." },
  email_change: { subject: "Confirm your new email", title: "Confirm your new email", intro: "Enter this code in the app to confirm this new address." },
  invite: { subject: "You're invited to Go Farther", title: "You're invited", intro: "Download Go Farther and enter this code to set up your account." },
  reauthentication: { subject: "Confirm it's you", title: "Confirm it's you", intro: "Enter this code in the app to confirm this action." },
  email: { subject: "Your verification code", title: "Your verification code", intro: "Enter this code in the app to continue." },
};

function renderEmail(d: EmailData): { subject: string; html: string } {
  const c = COPY[d.email_action_type] || COPY.email;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;font-size:22px;font-weight:700;color:#111;margin-bottom:18px;">Go&nbsp;Farther</div>
    <div style="background:#ffffff;border-radius:18px;padding:32px 28px;box-shadow:0 1px 4px rgba(0,0,0,0.06);text-align:center;">
      <h1 style="margin:0 0 12px;font-size:21px;color:#111;">${c.title}</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#454a52;">${c.intro}</p>
      <div style="display:inline-block;background:#f4f5f7;border-radius:14px;padding:16px 26px;">
        <span style="font-size:34px;font-weight:700;letter-spacing:8px;color:#111;font-variant-numeric:tabular-nums;">${d.token}</span>
      </div>
      <p style="margin:18px 0 0;font-size:12.5px;color:#8a8f98;">This code expires in about an hour.</p>
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
  // Config healthcheck: shows which sender is active and whether the secrets are
  // readable (booleans only — never the values; the sender is public anyway).
  if (req.method === "GET") {
    return json({ ok: true, from: RESEND_FROM, resendKeySet: !!RESEND_API_KEY, hookSecretSet: !!HOOK_SECRET }, 200);
  }
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
