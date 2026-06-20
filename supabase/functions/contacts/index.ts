import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Direct contacts listing -> { items: ContactItem[] }. Mirrors chat/index.ts
// buildContactsCard: two Composio GMAIL_SEARCH_PEOPLE calls (broad "other"
// contacts for breadth + saved contacts for photos), merged, de-duped, flattened
// to { name, email, phone, photo? }. Server-verified caller.

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SLUG = "GMAIL_SEARCH_PEOPLE";

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
function rowsOf(b: any): any[] {
  const d = b?.data ?? b;
  const rd = d?.response_data ?? d;
  return rd?.results ?? rd?.people ?? rd?.contacts ?? rd?.connections ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!API_KEY) return json(req, { items: [], error: "composio_unset" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { items: [], error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  const exec = async (extra: Record<string, unknown>): Promise<any> => {
    try {
      const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${SLUG}`, {
        method: "POST",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ user_id: uid, arguments: extra }),
      });
      return await res.json();
    } catch { return {}; }
  };

  try {
    const photoBy = new Map<string, string>();
    const [broad, saved] = await Promise.all([
      exec({ other_contacts: true, person_fields: "names,emailAddresses,phoneNumbers" }),
      exec({ other_contacts: false, person_fields: "names,emailAddresses,phoneNumbers,photos" }),
    ]);
    for (const r of rowsOf(saved)) {
      const p = r?.person ?? r;
      // deno-lint-ignore no-explicit-any
      const url = (p?.photos ?? []).find((ph: any) => ph && ph.url && !ph.default)?.url;
      if (!url) continue;
      if (p?.resourceName) photoBy.set(String(p.resourceName), url);
      const em = p?.emailAddresses?.[0]?.value;
      if (em) photoBy.set(String(em).toLowerCase(), url);
    }
    const rows = [...rowsOf(broad), ...rowsOf(saved)];
    const seen = new Set<string>();
    const items: Record<string, string>[] = [];
    for (const r of rows) {
      const p = r?.person ?? r;
      const name = p?.names?.[0]?.displayName ?? p?.displayName ?? p?.name ?? "";
      const email = p?.emailAddresses?.[0]?.value ?? p?.email ?? p?.emailAddress?.address ?? "";
      const phone = p?.phoneNumbers?.[0]?.value ?? p?.phone ?? "";
      const rn = p?.resourceName ?? "";
      const key = String(rn || email || name || phone).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const item: Record<string, string> = { name: String(name || "").trim(), email: String(email || "").trim(), phone: String(phone || "").trim() };
      const photo = (rn && photoBy.get(String(rn))) || (email && photoBy.get(String(email).toLowerCase())) || "";
      if (photo) item.photo = photo;
      if (item.name || item.email || item.phone) items.push(item);
      if (items.length >= 50) break;
    }
    // Named contacts first, then the rest — nicer than raw API order.
    items.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
    return json(req, { items });
  } catch (e) {
    console.error("contacts error:", e);
    return json(req, { items: [], error: "fetch_failed" }, 502);
  }
});
