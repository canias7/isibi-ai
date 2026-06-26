import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Permanently delete the calling user's account and ALL their data.
// Identity is verified SERVER-SIDE from the caller's Supabase access token, so a
// client can never delete someone else's account. Steps:
//   1) verify the token -> uid
//   2) best-effort: revoke the user's Composio connected accounts (app links)
//   3) delete every row this uid owns across our tables (service role)
//   4) delete the auth user itself (GoTrue admin)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");

// Every table that stores per-user rows (all keyed by user_id). When adding a
// table with a user_id column, add it HERE too — "delete my account" must wipe
// it (ai_usage and app_events were once missed and survived deletion).
const USER_TABLES = [
  "plaid_items", "user_settings", "user_connections", "tool_prefs", "ai_usage", "app_events",
];

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

// Verify the caller's access token and return their user id (never trust a body).
async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// Best-effort: revoke this user's Composio connected accounts so external app
// authorizations don't linger after the account is gone.
async function revokeComposio(uid: string): Promise<void> {
  if (!COMPOSIO_API_KEY) return;
  try {
    const q = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    q.searchParams.set("user_ids", uid);
    const res = await fetch(q.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const items: { id?: string; nanoid?: string }[] = body.items ?? body.data ?? [];
    for (const it of items) {
      const id = it.id ?? it.nanoid;
      if (!id) continue;
      await fetch(`https://backend.composio.dev/api/v3.1/connected_accounts/${id}`, {
        method: "DELETE", headers: { "x-api-key": COMPOSIO_API_KEY },
      }).catch(() => {});
    }
  } catch { /* best effort */ }
}

// Purge the user's Storage objects — generated files/images (chat-files) and
// memory attachments (memory). Deleting the DB rows alone is NOT enough: the
// actual bytes would otherwise outlive the account. Walks each bucket under the
// user's prefix (folders come back with a null id), then bulk-deletes by key.
// Failures are recorded as warnings; they never block the account deletion.
async function purgeStorage(uid: string, headers: Record<string, string>, failed: string[]): Promise<void> {
  for (const bucket of ["chat-files", "memory"]) {
    try {
      const keys: string[] = [];
      const walk = async (prefix: string, depth: number): Promise<void> => {
        if (depth > 3 || keys.length >= 3000) return; // safety caps, far beyond real usage
        for (let off = 0; off < 3000; off += 100) {
          const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ prefix, limit: 100, offset: off }),
          });
          if (!r.ok) { failed.push(`${bucket}:list:${r.status}`); return; }
          const items: { name: string; id?: string | null }[] = await r.json().catch(() => []);
          if (!Array.isArray(items) || !items.length) return;
          for (const it of items) {
            if (it.id == null) await walk(`${prefix}${it.name}/`, depth + 1); // a folder
            else keys.push(`${prefix}${it.name}`);
          }
          if (items.length < 100) return;
        }
      };
      await walk(`${uid}/`, 0);
      for (let i = 0; i < keys.length; i += 100) {
        const dr = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
          method: "DELETE",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prefixes: keys.slice(i, i + 100) }),
        });
        if (!dr.ok) { failed.push(`${bucket}:delete:${dr.status}`); break; }
      }
    } catch {
      failed.push(`${bucket}:err`);
    }
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

  if (!SERVICE_KEY || !SUPABASE_URL) return J({ error: "server not configured" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return J({ error: "unauthorized" }, 401);

  // 2) Revoke external app links first (best-effort; never blocks deletion).
  await revokeComposio(uid);

  // 3) Delete every owned row. We continue past individual failures so one bad
  // table can't strand the account half-deleted.
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  const failed: string[] = [];
  for (const table of USER_TABLES) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(uid)}`, {
        method: "DELETE", headers: { ...headers, prefer: "return=minimal" },
      });
      if (!r.ok && r.status !== 404) failed.push(`${table}:${r.status}`);
    } catch {
      failed.push(`${table}:err`);
    }
  }

  // 3b) Purge the user's Storage objects (their generated files, AI images, and
  // memory attachments) — "delete my account" must remove the bytes too.
  await purgeStorage(uid, headers, failed);

  // 4) Delete the auth user itself (GoTrue admin; requires the service role).
  let userDeleted = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      method: "DELETE", headers: { ...headers, "content-type": "application/json" },
    });
    userDeleted = r.ok;
    if (!r.ok) failed.push(`auth_user:${r.status}`);
  } catch {
    failed.push("auth_user:err");
  }

  // The account is functionally gone once the auth user is deleted; report any
  // non-fatal table issues so they're visible in logs.
  if (!userDeleted) return J({ error: "Could not fully delete the account.", failed }, 500);
  return J({ ok: true, ...(failed.length ? { warnings: failed } : {}) });
});
