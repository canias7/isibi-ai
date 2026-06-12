import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sends an APNs push to the calling user's registered devices. Inert until the
// APNS_* secrets are set (returns a clear error). Called with the user's JWT;
// only ever pushes to that user's own device_tokens.
//
// SILENT mode ({ silent:true } or { type:"reminders-sync" }): sends a background
// content-available push with NO alert/sound — it wakes the app to re-sync
// rather than showing a banner. REMINDERS MUST USE THIS: the device owns the
// visible reminder alert (its local notification), so a server-sent reminder
// must be silent or it double-fires with the local one. (iOS shows an
// already-delivered banner before our JS runs, so the only real guard is to
// never send a *visible* reminder push — hence this contract.)
//
// Secrets to set when you have an APNs Auth Key (.p8):
//   APNS_KEY        full PEM contents of the .p8
//   APNS_KEY_ID     the key's 10-char Key ID
//   APNS_TEAM_ID    your Apple Team ID
//   APNS_BUNDLE_ID  the app bundle id (apns-topic)
//   APNS_HOST       (optional) api.push.apple.com for App Store; default is the
//                   sandbox (api.sandbox.push.apple.com) for TestFlight/dev.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APNS_KEY = Deno.env.get("APNS_KEY");
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");
const APNS_HOST = Deno.env.get("APNS_HOST") || "api.sandbox.push.apple.com";

// CORS allowlist: native app (Capacitor) + local dev. No-Origin requests
// (native fetch / server-to-server) are allowed; unknown browser origins blocked.
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost",
  "http://localhost:5173", "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// APNs provider JWT (ES256), cached ~50 min (Apple allows reuse up to ~60).
let cachedJwt: { token: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
  if (cachedJwt && Date.now() - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const pem = (APNS_KEY || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const input = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  const token = `${input}.${b64url(sig)}`;
  cachedJwt = { token, at: Date.now() };
  return token;
}

function uidFromJwt(req: Request): string | null {
  try {
    const t = (req.headers.get("authorization") || "").replace(/^bearer\s+/i, "");
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.role === "authenticated" && typeof p.sub === "string" ? p.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) {
    return json({ ok: false, error: "APNs not configured - set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID secrets." });
  }
  // Caller is either a signed-in user (their own JWT) or the service role (the
  // workflow runner), which may target a specific user via body.user_id.
  const bearer = (req.headers.get("authorization") || "").replace(/^bearer\s+/i, "").trim();
  const admin = !!SERVICE_KEY && bearer === SERVICE_KEY;

  let title = "Go Farther", body = "Test notification", category = "", extra: Record<string, unknown> = {};
  let bodyUser = "";
  let silent = false;
  try {
    const b = await req.json();
    if (b.title) title = String(b.title);
    if (b.body) body = String(b.body);
    if (b.category) category = String(b.category); // e.g. "GF_REPLY" for an inline-reply action
    if (b.data && typeof b.data === "object") extra = b.data; // context for the action handler (e.g. thread id)
    if (b.user_id) bodyUser = String(b.user_id);
    if (b.silent === true || b.type === "reminders-sync") silent = true; // background re-sync, no banner
  } catch { /* defaults */ }
  // A silent reminders-sync carries the type so the app routes it to a re-arm.
  if (silent) extra = { ...extra, type: "reminders-sync" };

  const uid = admin ? bodyUser : uidFromJwt(req);
  if (!uid || !SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "no user" }, 401);

  // This user's device tokens (service role bypasses RLS).
  const r = await fetch(`${SUPABASE_URL}/rest/v1/device_tokens?user_id=eq.${uid}&select=token`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows: { token: string }[] = r.ok ? await r.json() : [];
  if (!rows.length) return json({ ok: false, error: "no registered devices" });

  const jwt = await apnsJwt();
  // Silent → content-available background wake, no alert/sound (must not show a
  // banner). Visible → the usual alert. apns-push-type/priority follow suit.
  const aps: Record<string, unknown> = silent
    ? { "content-available": 1 }
    : { alert: { title, body }, sound: "default" };
  if (!silent && category) aps.category = category; // makes the notification actionable (inline reply, etc.)
  const apnsPushType = silent ? "background" : "alert";
  const apnsPriority = silent ? "5" : "10"; // background pushes require the lower priority
  const payload = JSON.stringify({ aps, ...extra });

  // Try the configured host first, then fall back to the OTHER environment if
  // Apple says the token doesn't belong here. TestFlight/App Store tokens are
  // production; a dev (Xcode) run is sandbox - and the wrong one returns
  // BadDeviceToken. Trying both makes delivery work regardless of how the build
  // was distributed, instead of silently failing on an env mismatch.
  const hosts = [...new Set([APNS_HOST, "api.push.apple.com", "api.sandbox.push.apple.com"])];
  async function pushTo(token: string) {
    let last = { status: 0, reason: "no attempt", host: "" };
    for (const host of hosts) {
      try {
        const res = await fetch(`https://${host}/3/device/${token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": APNS_BUNDLE_ID!,
            "apns-push-type": apnsPushType,
            "apns-priority": apnsPriority,
          },
          body: payload,
        });
        if (res.ok) return { token: token.slice(0, 8), status: res.status, reason: "", host };
        last = { status: res.status, reason: await res.text(), host };
        // Only an env/token mismatch is worth retrying on the other host.
        if (!/BadDeviceToken|BadEnvironmentKeyInToken|DeviceTokenNotForTopic/i.test(last.reason)) break;
      } catch (e) {
        last = { status: 0, reason: e instanceof Error ? e.message : String(e), host };
      }
    }
    return { token: token.slice(0, 8), ...last };
  }
  const sent = await Promise.all(rows.map(({ token }) => pushTo(token)));
  return json({ ok: true, sent });
});
