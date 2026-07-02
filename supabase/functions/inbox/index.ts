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
  "capacitor://localhost", "https://gofarther.dev", "https://www.gofarther.dev",
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
  const app = (url.searchParams.get("app") || "gmail").toLowerCase();
  // Search query. Gmail runs it server-side (its `query` arg = full Gmail search
  // syntax over the WHOLE mailbox); Outlook has no reliable Composio search arg,
  // so we widen the fetch and substring-filter here. Either way the result is a
  // real mailbox search, not just a filter over the page the client already has.
  const q = (url.searchParams.get("q") || "").trim().slice(0, 200);

  // ?profile=1 -> the mailbox's own address ({ email }), so the composer can
  // show the real account instead of just "Gmail"/"Outlook".
  if (url.searchParams.get("profile")) {
    try {
      const slug = (app === "outlook" || app === "m365") ? "OUTLOOK_OUTLOOK_GET_PROFILE" : "GMAIL_GET_PROFILE";
      const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${slug}`, {
        method: "POST",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ user_id: uid, arguments: {} }),
      });
      const body = await res.json().catch(() => ({}));
      const data = ((body as Record<string, unknown>)?.data ?? body) as Record<string, unknown>;
      const inner = (data?.response_data ?? data?.data ?? data) as Record<string, unknown>;
      const email = String(inner?.emailAddress ?? inner?.mail ?? inner?.userPrincipalName ?? data?.emailAddress ?? "").trim();
      return json(req, { email });
    } catch {
      return json(req, { email: "" });
    }
  }

  try {
    const dstr = (d: Date, o: Intl.DateTimeFormatOptions) => {
      try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d); } catch { return ""; }
    };
    const today = dstr(new Date(), { dateStyle: "short" });
    const fmtTime = (ms: number): string => {
      const d = new Date(ms);
      if (!ms || isNaN(d.getTime())) return "";
      return dstr(d, { dateStyle: "short" }) === today
        ? dstr(d, { hour: "numeric", minute: "2-digit" })
        : dstr(d, { month: "short", day: "numeric" });
    };

    // ---- Outlook (Microsoft 365) — OUTLOOK_OUTLOOK_LIST_MESSAGES, skip/top paging ----
    // (Composio execute slugs for Outlook are double-prefixed; the Graph response
    // carries `value[]` with from.emailAddress.{name,address}, bodyPreview, etc.)
    if (app === "outlook" || app === "m365") {
      const skip = parseInt(pageToken || "0", 10) || 0;
      const top = q ? 50 : max; // widen for search, then substring-filter the window below
      const res = await fetch("https://backend.composio.dev/api/v3/tools/execute/OUTLOOK_OUTLOOK_LIST_MESSAGES", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ user_id: uid, arguments: { top, skip, folder: "inbox" } }),
      });
      const body = await res.json().catch(() => ({}));
      const data = ((body as Record<string, unknown>)?.data ?? body) as Record<string, unknown>;
      const inner = (data?.response_data ?? data?.data ?? data) as Record<string, unknown>;
      const msgs = ((data?.value ?? data?.messages ?? inner?.value ?? inner?.messages) as Record<string, unknown>[]) ?? [];
      let items = (Array.isArray(msgs) ? msgs : []).map((m) => {
        const fe = ((m.from as Record<string, unknown>)?.emailAddress
          ?? (m.sender as Record<string, unknown>)?.emailAddress ?? {}) as Record<string, unknown>;
        const from = String(fe.name ?? "");
        const email = String(fe.address ?? "");
        const ms = Date.parse(String(m.receivedDateTime ?? m.sentDateTime ?? ""));
        const snippet = stripHtml(String(m.bodyPreview ?? (m.body as Record<string, unknown>)?.content ?? ""))
          .split(" ").slice(0, 14).join(" ");
        return {
          from: from || email || "Unknown",
          email,
          subject: String(m.subject ?? "(no subject)"),
          snippet,
          time: Number.isFinite(ms) ? fmtTime(ms) : "",
          unread: m.isRead === false,
          draft: false,
          id: String(m.id ?? ""),
          threadId: String(m.id ?? ""), // Outlook replies key off the MESSAGE id (OUTLOOK_REPLY_EMAIL)
          ts: Number.isFinite(ms) ? ms : 0, // epoch ms — for merging a combined inbox
          app: "outlook",
        };
      });
      if (q) {
        const ql = q.toLowerCase();
        items = items.filter((it) => `${it.from} ${it.email} ${it.subject} ${it.snippet}`.toLowerCase().includes(ql));
      }
      // Outlook pages by offset; a search returns its matches with no pager.
      const nextPageToken = q ? null : (msgs.length >= top ? String(skip + top) : null);
      return json(req, { items, nextPageToken });
    }

    // ---- Gmail — GMAIL_FETCH_EMAILS, page-token paging ----
    // verbose:false + include_payload:false -> Composio returns lightweight metadata
    // (subject/sender/time/labels/snippet) instead of full message bodies. Full bodies
    // for a whole page overflow the tool's response-size cap and 413 (empty inbox).
    const args: Record<string, unknown> = { max_results: max, verbose: false, include_payload: false };
    if (pageToken) args.page_token = pageToken;
    if (q) args.query = q; // Gmail search syntax — server-side over the whole mailbox
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
    const nextPageToken = q ? null : (pickToken(data) ?? pickToken(inner));
    // Newest first — Composio's order isn't reliably by date, so sort explicitly.
    const sorted = (Array.isArray(msgs) ? msgs : []).slice().sort((a, b) => tsOf(b) - tsOf(a));
    const items = sorted.map((m) => {
      const sender = String(m.sender ?? "");
      const mt = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
      const from = mt ? mt[1].trim() : sender;
      const email = mt ? mt[2].trim() : "";
      const labels: string[] = (m.labelIds as string[]) ?? [];
      const snippet = stripHtml(String(m.messageText ?? m.snippet ?? (m.preview as Record<string, unknown>)?.body ?? ""))
        .split(" ").slice(0, 14).join(" ");
      return {
        from: from || email || "Unknown",
        email,
        subject: String(m.subject ?? "(no subject)"),
        snippet,
        time: fmtTime(tsOf(m)),
        unread: Array.isArray(labels) && labels.includes("UNREAD"),
        draft: Array.isArray(labels) && labels.includes("DRAFT"),
        id: String(m.messageId ?? m.id ?? ""),
        threadId: String(m.threadId ?? m.thread_id ?? ""),
        ts: tsOf(m), // epoch ms — for merging a combined inbox
        app: "gmail",
      };
    });
    return json(req, { items, nextPageToken });
  } catch (e) {
    console.error("inbox error:", e);
    return json(req, { items: [], nextPageToken: null, error: "fetch_failed" }, 502);
  }
});
