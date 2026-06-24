import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public unsubscribe endpoint linked in every campaign email. No login — it's a
// link clicked by recipients. The token is HMAC(service key, "uid:email"), minted
// by the `campaigns` function, so a link can only opt out the exact address it was
// made for (no opting out others). On a valid hit we add the address to that
// user's email_suppressions, so future campaigns skip it.
//   GET /unsubscribe?u=<uid>&e=<email>&t=<token>

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json" };

async function unsubToken(uid: string, email: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SB_SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${uid}:${email.toLowerCase()}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// Constant-time string compare (don't leak the token via timing).
function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function page(title: string, msg: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#fff;font-family:system-ui,sans-serif">
<div style="text-align:center;max-width:340px;padding:28px">
<div style="width:54px;height:54px;border-radius:16px;margin:0 auto 16px;background:linear-gradient(135deg,#FF9A4D,#F8514E)"></div>
<h1 style="font-size:20px;margin:0 0 8px">${title}</h1>
<p style="color:#a6a6ae;font-size:14px;line-height:1.5;margin:0">${msg}</p>
</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("u") || "";
  const email = (url.searchParams.get("e") || "").trim();
  const t = url.searchParams.get("t") || "";
  if (!uid || !email || !t) return page("Invalid link", "This unsubscribe link is missing information.");

  const expected = await unsubToken(uid, email);
  if (!ctEq(t, expected)) {
    return page("Invalid link", "This unsubscribe link couldn't be verified.");
  }

  try {
    // Idempotent: upsert on (user_id, email).
    await fetch(`${SB_URL}/rest/v1/email_suppressions?on_conflict=user_id,email`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, email: email.toLowerCase(), reason: "unsubscribe" }),
    });
  } catch (e) {
    console.error("unsubscribe error:", String((e as Error)?.message || e));
    return page("Something went wrong", "Please try again in a moment.");
  }
  return page("You're unsubscribed", `${email} won't receive any more of these emails.`);
});
