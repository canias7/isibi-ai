// ============================================================================
// gmail-oauth/connect-key — API-key & keyless connect (no OAuth redirect)
// ----------------------------------------------------------------------------
// Splice these two pieces into supabase/functions/gmail-oauth/index.ts. They
// reuse the file's existing helpers verbatim: verifyUser(), api(), json(),
// pickId(), TOOLKIT, SELF. The frontend already POSTs here (ConnectorsGraph
// connectWithKey -> ${CONNECT_API}/connect-key).
//
// TWO Composio specifics to CONFIRM (the rest is exact) — both visible in
//   GET /api/v3/toolkits/<slug>  ->  auth_config_details  (per-toolkit):
//   (A) the API-key auth_config `type` / scheme, and
//   (B) the credential field name(s) (often `generic_api_key`, sometimes
//       `api_key` / `token` / a header name). They vary per toolkit.
// ============================================================================

// --- piece 1: place next to ensureAuthConfig() -----------------------------
// Find-or-create an auth_config that uses the toolkit's API-key scheme (custom
// auth) instead of Composio-managed OAuth. Keyless toolkits get a NO_AUTH config.
async function ensureKeyAuthConfig(toolkit: string, hasKey: boolean): Promise<string> {
  const existing = await findAuthConfig(toolkit); // reuse: returns an id or null
  if (existing) return existing;
  const auth_config = hasKey
    // (A) CONFIRM: API-key scheme for this toolkit. "use_custom_auth" is the
    // usual v3 value; some toolkits expose API_KEY directly.
    ? { type: "use_custom_auth", credentials: {}, restrict_to_following_tools: [] }
    // keyless / NO_AUTH:
    : { type: "use_composio_managed_auth", credentials: {}, restrict_to_following_tools: [] };
  const res = await api(`/auth_configs`, {
    method: "POST",
    body: JSON.stringify({ toolkit: { slug: toolkit }, auth_config }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`auth_configs create ${res.status}: ${JSON.stringify(body)}`);
  const id = pickId(body) ?? body.auth_config?.id ?? body.id;
  if (!id) throw new Error("no auth_config id from Composio");
  return id;
}

// --- piece 2: add to the routing chain (e.g. right after the connect-init block) ---
if (path === "connect-key") {
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  const authH = req.headers.get("authorization") || "";
  const token = authH.toLowerCase().startsWith("bearer ") ? authH.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  let bodyIn: { app?: string; apiKey?: string } = {};
  try { bodyIn = await req.json(); } catch { /* empty body */ }
  const reqApp = String(bodyIn.app || "").trim();
  const tk = TOOLKIT[reqApp] ?? reqApp;
  const apiKey = typeof bodyIn.apiKey === "string" ? bodyIn.apiKey.trim() : "";
  if (!tk) return json(req, { error: `Unknown app: ${reqApp}` }, 400);

  try {
    const ac = await ensureKeyAuthConfig(tk, !!apiKey);
    // Create the user's connected account. No callback_url => no OAuth redirect;
    // API-key / no-auth accounts are ACTIVE immediately. The key is per-user, so
    // it rides on the connected account (not the shared auth_config).
    const res = await api(`/connected_accounts`, {
      method: "POST",
      body: JSON.stringify({
        auth_config_id: ac,
        user_id: uid,
        // (B) CONFIRM the credential field name(s) for this toolkit's scheme.
        ...(apiKey ? { connection: { state: { authScheme: "API_KEY", val: { generic_api_key: apiKey } } } } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("connect-key failed:", res.status, data?.message || data?.error || "");
      return json(req, { error: "Couldn't connect — check the key and try again." }, 400);
    }
    return json(req, { connected: true });
  } catch (e) {
    console.error("connect-key error:", e);
    return json(req, { error: "Couldn't connect — please try again." }, 500);
  }
}
