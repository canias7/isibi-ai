import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Wingup — the social-media agent's backend. One authenticated endpoint that runs
// the user's connected Instagram tools through Composio (server-side, so the
// Composio key never reaches the client). Identity is verified from the caller's
// Supabase access token; that user id IS the Composio user_id, exactly like the
// gmail-oauth connector.
//
// Called from the app via supabase.functions.invoke('wingup', { body: { action, ... } }).
//
// Posting needs a PUBLIC image URL (Instagram fetches the image itself), so any
// image passed as base64 (a camera/library pick) is first hosted in the public
// `email-assets` bucket — the same bucket the email templates use.
//
// Actions:
//   account            -> connected IG profile (username, id, followers, …)
//   media              -> recent posts (Gallery)
//   insights           -> account insights (Insights)
//   publish            -> { caption?, image_url? | image_b64?+content_type? }  single photo post
//   publish_carousel   -> { caption?, images: [{url?|b64?,content_type?}] }    multi-photo post
//   post_comments      -> { ig_post_id }  comments on one of your posts
//   reply_comment      -> { ig_comment_id, message }
//   conversations      -> DM threads
//   messages           -> { conversation_id }  messages in a thread
//   conversation       -> { conversation_id }  one thread's detail
//   send_dm            -> { recipient_id, text }
//   send_dm_image      -> { recipient_id, image_url? | image_b64?+content_type? }
//   mark_seen          -> { recipient_id }

const API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COMPOSIO_EXEC = "https://backend.composio.dev/api/v3/tools/execute";

// CORS allowlist: native app (Capacitor) + local dev. No-Origin (native fetch /
// curl) is allowed; unknown browser origins are blocked.
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsFor(req), "content-type": "application/json" } });
}

// Verify the caller's Supabase access token and return their user id (or null).
async function verifyUser(token: string | null): Promise<string | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

// Run one Composio tool for this user. Returns the normalized envelope.
interface ExecResult { data: any; successful: boolean; error: string | null }
async function exec(slug: string, uid: string, args: Record<string, unknown> = {}): Promise<ExecResult> {
  const res = await fetch(`${COMPOSIO_EXEC}/${slug}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: uid, arguments: args }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    data: body?.data ?? null,
    successful: body?.successful === true,
    error: body?.error ?? (res.ok ? null : `HTTP ${res.status}`),
  };
}

// Host a base64 image in the public email-assets bucket and return its URL, so
// Instagram (which fetches the image server-side) can reach it. Accepts either a
// raw base64 string or a data: URL.
async function hostImage(uid: string, b64: string, contentType?: string): Promise<string | null> {
  let ct = (contentType || "").toLowerCase();
  let raw = b64;
  const m = /^data:([^;]+);base64,(.*)$/s.exec(b64);
  if (m) { ct = ct || m[1].toLowerCase(); raw = m[2]; }
  if (!ct) ct = "image/jpeg";
  if (!ct.startsWith("image/")) return null;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length > 10 * 1024 * 1024) return null; // 10MB cap, matches templates
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("png") ? "png" : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : "img";
  const path = `${uid}/wingup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/email-assets/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, "content-type": ct, "x-upsert": "true" },
    body: bytes,
  });
  return up.ok ? `${SB_URL}/storage/v1/object/public/email-assets/${path}` : null;
}

// Resolve one image spec { url? , b64? , content_type? } to a public URL.
async function resolveImage(uid: string, spec: { url?: string; b64?: string; content_type?: string }): Promise<string | null> {
  if (spec.b64) return hostImage(uid, spec.b64, spec.content_type);
  const u = (spec.url || "").trim();
  // A data: URL slipped in as `url` — host it too (IG can't fetch data: URLs).
  if (u.startsWith("data:")) return hostImage(uid, u, spec.content_type);
  return /^https?:\/\//i.test(u) ? u : null;
}

// The IG account id ("ig_user_id") that posting tools require — read once from
// the connected account so the client never has to know it.
async function resolveIgUserId(uid: string): Promise<string | null> {
  const r = await exec("INSTAGRAM_GET_USER_INFO", uid);
  const id = r.data?.id ?? r.data?.ig_user_id ?? r.data?.user_id;
  return id != null ? String(id) : null;
}

// Pull a media-container creation id out of a Composio response, however nested.
function creationIdOf(data: any): string | null {
  const id = data?.id ?? data?.creation_id ?? data?.container_id ?? data?.response_data?.id;
  return id != null ? String(id) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  if (!API_KEY) return json(req, { error: "COMPOSIO_API_KEY is not set on the server." }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const uid = await verifyUser(token);
  if (!uid) return json(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  try {
    switch (action) {
      // ---- Reads ----
      case "account": {
        const r = await exec("INSTAGRAM_GET_USER_INFO", uid);
        if (!r.successful) return json(req, { error: r.error || "couldn't load account" }, 502);
        return json(req, { account: r.data });
      }
      case "media": {
        const r = await exec("INSTAGRAM_GET_USER_MEDIA", uid);
        if (!r.successful) return json(req, { error: r.error || "couldn't load media" }, 502);
        return json(req, { media: r.data });
      }
      case "insights": {
        const r = await exec("INSTAGRAM_GET_USER_INSIGHTS", uid);
        if (!r.successful) return json(req, { error: r.error || "couldn't load insights" }, 502);
        return json(req, { insights: r.data });
      }
      case "conversations": {
        const r = await exec("INSTAGRAM_LIST_ALL_CONVERSATIONS", uid);
        if (!r.successful) return json(req, { error: r.error || "couldn't load conversations" }, 502);
        return json(req, { conversations: r.data });
      }
      case "messages": {
        const conversation_id = String(body?.conversation_id || "");
        if (!conversation_id) return json(req, { error: "conversation_id required" }, 400);
        const r = await exec("INSTAGRAM_LIST_ALL_MESSAGES", uid, { conversation_id });
        if (!r.successful) return json(req, { error: r.error || "couldn't load messages" }, 502);
        return json(req, { messages: r.data });
      }
      case "conversation": {
        const conversation_id = String(body?.conversation_id || "");
        if (!conversation_id) return json(req, { error: "conversation_id required" }, 400);
        const r = await exec("INSTAGRAM_GET_CONVERSATION", uid, { conversation_id });
        if (!r.successful) return json(req, { error: r.error || "couldn't load conversation" }, 502);
        return json(req, { conversation: r.data });
      }

      // ---- Publish a single photo ----
      case "publish": {
        const caption = typeof body?.caption === "string" ? body.caption : "";
        const image_url = await resolveImage(uid, { url: body?.image_url, b64: body?.image_b64, content_type: body?.content_type });
        if (!image_url) return json(req, { error: "a JPEG/PNG image (image_url or image_b64) is required" }, 400);
        const ig = await resolveIgUserId(uid);
        if (!ig) return json(req, { error: "Instagram account not connected" }, 400);
        const c = await exec("INSTAGRAM_CREATE_MEDIA_CONTAINER", uid, { ig_user_id: ig, image_url, caption });
        const creation_id = creationIdOf(c.data);
        if (!c.successful || !creation_id) return json(req, { error: c.error || "couldn't stage the post" }, 502);
        const p = await exec("INSTAGRAM_CREATE_POST", uid, { ig_user_id: ig, creation_id });
        if (!p.successful) return json(req, { error: p.error || "couldn't publish the post" }, 502);
        return json(req, { ok: true, id: creationIdOf(p.data) ?? null, creation_id });
      }

      // ---- Publish a carousel (2–10 photos) ----
      case "publish_carousel": {
        const caption = typeof body?.caption === "string" ? body.caption : "";
        const specs: any[] = Array.isArray(body?.images) ? body.images : [];
        if (specs.length < 2) return json(req, { error: "a carousel needs at least 2 images" }, 400);
        if (specs.length > 10) return json(req, { error: "a carousel can hold at most 10 images" }, 400);
        const ig = await resolveIgUserId(uid);
        if (!ig) return json(req, { error: "Instagram account not connected" }, 400);
        const children: string[] = [];
        for (const s of specs) {
          const image_url = await resolveImage(uid, { url: s?.url, b64: s?.b64, content_type: s?.content_type });
          if (!image_url) return json(req, { error: "every carousel item needs a JPEG/PNG image" }, 400);
          const c = await exec("INSTAGRAM_CREATE_MEDIA_CONTAINER", uid, { ig_user_id: ig, image_url, is_carousel_item: true });
          const cid = creationIdOf(c.data);
          if (!c.successful || !cid) return json(req, { error: c.error || "couldn't stage a carousel item" }, 502);
          children.push(cid);
        }
        const car = await exec("INSTAGRAM_CREATE_CAROUSEL_CONTAINER", uid, { ig_user_id: ig, children, caption });
        const creation_id = creationIdOf(car.data);
        if (!car.successful || !creation_id) return json(req, { error: car.error || "couldn't stage the carousel" }, 502);
        const p = await exec("INSTAGRAM_CREATE_POST", uid, { ig_user_id: ig, creation_id });
        if (!p.successful) return json(req, { error: p.error || "couldn't publish the carousel" }, 502);
        return json(req, { ok: true, id: creationIdOf(p.data) ?? null, creation_id });
      }

      // ---- Engage ----
      case "post_comments": {
        const ig_post_id = String(body?.ig_post_id || "");
        if (!ig_post_id) return json(req, { error: "ig_post_id required" }, 400);
        const r = await exec("INSTAGRAM_GET_POST_COMMENTS", uid, { ig_post_id });
        if (!r.successful) return json(req, { error: r.error || "couldn't load comments" }, 502);
        return json(req, { comments: r.data });
      }
      case "reply_comment": {
        const ig_comment_id = String(body?.ig_comment_id || "");
        const message = String(body?.message || "");
        if (!ig_comment_id || !message) return json(req, { error: "ig_comment_id and message required" }, 400);
        const r = await exec("INSTAGRAM_REPLY_TO_COMMENT", uid, { ig_comment_id, message });
        if (!r.successful) return json(req, { error: r.error || "couldn't reply" }, 502);
        return json(req, { ok: true, result: r.data });
      }
      case "send_dm": {
        const recipient_id = String(body?.recipient_id || "");
        const text = String(body?.text || "");
        if (!recipient_id || !text) return json(req, { error: "recipient_id and text required" }, 400);
        const r = await exec("INSTAGRAM_SEND_TEXT_MESSAGE", uid, { recipient_id, text });
        if (!r.successful) return json(req, { error: r.error || "couldn't send message" }, 502);
        return json(req, { ok: true, result: r.data });
      }
      case "send_dm_image": {
        const recipient_id = String(body?.recipient_id || "");
        if (!recipient_id) return json(req, { error: "recipient_id required" }, 400);
        const image_url = await resolveImage(uid, { url: body?.image_url, b64: body?.image_b64, content_type: body?.content_type });
        if (!image_url) return json(req, { error: "a JPEG/PNG image is required" }, 400);
        const r = await exec("INSTAGRAM_SEND_IMAGE", uid, { recipient_id, image_url });
        if (!r.successful) return json(req, { error: r.error || "couldn't send image" }, 502);
        return json(req, { ok: true, result: r.data });
      }
      case "mark_seen": {
        const recipient_id = String(body?.recipient_id || "");
        if (!recipient_id) return json(req, { error: "recipient_id required" }, 400);
        const r = await exec("INSTAGRAM_MARK_SEEN", uid, { recipient_id });
        if (!r.successful) return json(req, { error: r.error || "couldn't mark seen" }, 502);
        return json(req, { ok: true, result: r.data });
      }

      default:
        return json(req, { error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("wingup error:", action, e);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});
