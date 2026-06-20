import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Direct inbox listing -> { items: EmailItem[], nextPageToken } (no chat turn).
// Mirrors chat/index.ts `buildInboxCard` (Composio GMAIL_FETCH_EMAILS + the same
// transform), adds newest-first sorting and Gmail page-token pagination. Fetch a
// SMALL page (≈20): GMAIL_FETCH_EMAILS pulls each message's payload, so large
// max_results is slow and returns empty — page through instead. Identity is
// verified server-side (the caller's Supabase token); a client can't list
// someone else's mail.

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

// Verify the caller's Supabase access token -> their user id (the Composio user_id).
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

// Some emails put full HTML in the text field — strip it so the snippet is
// readable plain text (drops comments, <style>/<script> blocks, tags, entities).
function stripHtml(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Epoch ms for sorting — handles ISO strings (the Date header) and numeric
// epoch-ms strings (Gmail internalDate). Unparseable -> 0 (sorts to the bottom).
function tsOf(m: Record<string, unknown>): number {
  const raw = m.messageTimestamp ?? m.internalDate ?? "";
  if (typeof raw === "number") return raw;
  const s = String(raw);
  const n = /^\d+$/.test(s) ? Number(s) : Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

function pickToken(o: unknown): string | null {
  const r = o as Record<string, unknown> | null | undefined;
  const t = r?.next_page_token ?? r?.nextPageToken;
  return typeof t === "string" && t ? t : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!API_KEY) return json(req, { items: [], nextPageToken: null, error: "composio_unset" }, 500);

  const url = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { items: [], nextPageToken: null, error: "unauthorized" }, 401);

  const tz = url.searchParams.get("tz") || "UTC";
  // Keep the page small: GMAIL_FETCH_EMAILS fetches each message's payload, so a
  // big max_results is slow and returns nothing. Cap at 30.
  const max = Math.min(Math.max(parseInt(url.searchParams.get("max") ?? "20", 10) || 20, 1), 30);
  const pageToken = url.searchParams.get("page_token") || "";

  try {
    const args: Record<string, unknown> = { max_results: max };
    if (pageToken) args.page_token = pageToken;
    const res = await fetch("https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid, arguments: args }),
    });
    const body = await res.json().catch(() => ({}));
    const data = ((body as Record<string, unknown>)?.data ?? body) as Record<string, unknown>;
    const inner = (data?.response_data ?? data?.data ?? data) as Record<string, unknown>;
    const msgs: Record<string, unknown>[] =
      ((data?.messages ?? inner?.messages) as Record<string, unknown>[]) ?? [];
    const nextPageToken = pickToken(data) ?? pickToken(inner);
    const dstr = (d: Date, o: Intl.DateTimeFormatOptions) => {
      try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d); } catch { return ""; }
    };
    const today = dstr(new Date(), { dateStyle: "short" });
    // Newest first — Composio's order isn't reliably by date, so sort explicitly.
    const sorted = (Array.isArray(msgs) ? msgs : []).slice().sort((a, b) => tsOf(b) - tsOf(a));
    const items = sorted.map((m) => {
      const sender = String(m.sender ?? "");
      const mt = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
      const from = mt ? mt[1].trim() : sender;
      const email = mt ? mt[2].trim() : "";
      const labels: string[] = (m.labelIds as string[]) ?? [];
      let time = "";
      const d = new Date(tsOf(m));
      if (tsOf(m) && !isNaN(d.getTime())) {
        time = dstr(d, { dateStyle: "short" }) === today
          ? dstr(d, { hour: "numeric", minute: "2-digit" })
          : dstr(d, { month: "short", day: "numeric" });
      }
      const snippet = stripHtml(String(m.messageText ?? (m.preview as Record<string, unknown>)?.body ?? ""))
        .split(" ").slice(0, 14).join(" ");
      return {
        from: from || email || "Unknown",
        email,
        subject: String(m.subject ?? "(no subject)"),
        snippet,
        time,
        unread: Array.isArray(labels) && labels.includes("UNREAD"),
        draft: Array.isArray(labels) && labels.includes("DRAFT"),
        id: String(m.messageId ?? m.id ?? ""),
        threadId: String(m.threadId ?? m.thread_id ?? ""),
        app: "gmail",
      };
    });
    return json(req, { items, nextPageToken });
  } catch (e) {
    console.error("inbox error:", e);
    return json(req, { items: [], nextPageToken: null, error: "fetch_failed" }, 502);
  }
});
